// Command cinemaphotos fetches a venue photograph for every cinema and writes
// it to public/cinemas/ as a 16:9 JPEG, plus data/cinema-photos.json.
//
// ===== 分工 =====
//
// 匹配规则在 internal/cinemaphoto（名称归一化 + 坐标判据），本命令只负责
// 「跑一遍、下图片、写清单」：
//
//	data/cinemas.json          我们的戏院（id / nameZh）
//	lib/cinema-names.ts        展示名（id → 页面上的名字）
//	lib/cinema-geo.ts          坐标（单一事实源）
//	hkmovie6.com/cinema        场馆列表（59 家）
//	hkmovie6.com/cinema/<uuid> 每家的 og:image + 坐标
//	     ↓
//	public/cinemas/<id>.jpg    1600x900 JPEG，同源提供
//	data/cinema-photos.json    { "<id>": "/cinemas/<id>.jpg" }
//
// ===== 为什么要 Referer =====
//
// storage.movie6.com 校验 Referer：不带就是 403（返回 4KB 的错误页而不是
// 1.1MB 的图）。这是它防盗链的方式，不是我们的配置问题 —— 照带即可。
//
// ===== 增量与自愈 =====
//
// 与 scripts/fetch-posters.mjs 同一策略：照片文件已存在且非空就跳过下载，
// 因此日常重建只有新戏院才有网络开销。--force 全量重下（换了裁切比例时用）。
//
// 非致命：单家戏院失败只跳过它（页面回退到纯文字头部），不阻断整站重建。
// 但**整页抓取失败**（列表页取不到）会以非零退出 —— 那是「源挂了」而不是
// 「某家没有图」，静默继续会让清单里的旧值看起来像新的。
//
// 用法：
//
//	go run ./cmd/cinemaphotos                 # 增量
//	go run ./cmd/cinemaphotos --force         # 全量重下
//	go run ./cmd/cinemaphotos --dry-run       # 只打印匹配结果
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"time"

	xdraw "golang.org/x/image/draw"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/cinemaphoto"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
)

const (
	// PhotoWidth / PhotoHeight 是写出的横幅尺寸。
	//
	// 16:9 1600x900：与影院页 hero 的显示比例一致（桌面端满宽约 1120px，
	// HiDPI 屏需要 2240 物理像素，但原图里有大量 535x370 的小图 ——
	// 1600 是「大图够清晰、小图不放大」与体积之间的平衡点：
	// 实测 59 张合计约 3.5MB（平均 60KB），与海报同一量级。
	PhotoWidth  = 1600
	PhotoHeight = 900
	// quality 取 80：横幅是背景图，压在深色渐变与文字之下，
	// 比海报更能容忍压缩。
	quality = 80
)

func main() {
	root := flag.String("root", ".", "project root holding data/ and lib/")
	force := flag.Bool("force", false, "re-download every photo")
	dry := flag.Bool("dry-run", false, "print the plan and write nothing")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	if err := run(ctx, *root, *force, *dry); err != nil {
		fmt.Fprintln(os.Stderr, "cinemaphotos failed:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, root string, force, dry bool) error {
	cinemas, err := readCinemas(filepath.Join(root, "data", "cinemas.json"))
	if err != nil {
		return err
	}
	display, err := readText(filepath.Join(root, "lib", "cinema-names.ts"))
	if err != nil {
		return err
	}
	geo, err := readText(filepath.Join(root, "lib", "cinema-geo.ts"))
	if err != nil {
		return err
	}
	displayNames := cinemaphoto.ParseDisplayNames(display)
	coords := cinemaphoto.ParseCoords(geo)

	scraper := cinemaphoto.New()
	venues, err := scraper.FetchList(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("hkmovie6 戏院列表：%d 家\n", len(venues))

	// 逐家取 og:image 与坐标。串行 + 间隔：这不是 CDN 的批量接口，
	// 而是一个被 Cloudflare 保护的站点，并发抓 59 页容易触发限流。
	withPhoto := make([]cinemaphoto.Venue, 0, len(venues))
	for i := range venues {
		v := venues[i]
		detail, err := scraper.FetchVenue(ctx, v.UUID)
		if err != nil {
			fmt.Printf("  ⚠️ %s 详情抓取失败：%v\n", v.Name, err)
			withPhoto = append(withPhoto, v)
			continue
		}
		v.Photo = detail.Photo
		v.Lat = detail.Lat
		v.Lon = detail.Lon
		withPhoto = append(withPhoto, v)
		time.Sleep(200 * time.Millisecond)
	}

	matched := cinemaphoto.Match(cinemas, withPhoto, displayNames, coords)
	fmt.Printf("匹配到 %d / %d 家\n", len(matched), len(cinemas))

	outDir := filepath.Join(root, "public", "cinemas")
	if !dry {
		if err := os.MkdirAll(outDir, 0o755); err != nil {
			return err
		}
	}

	manifest := map[string]string{}
	var downloaded, skipped, failed int
	client := fetch.New(fetch.WithTimeout(60*time.Second), fetch.WithRetries(2))

	for _, id := range cinemaphoto.SortedIDs(matched) {
		venue := matched[id]
		if venue.Photo == "" {
			fmt.Printf("  · %s（%s）：无照片\n", id, venue.Name)
			continue
		}
		target := filepath.Join(outDir, id+".jpg")
		if !force && !dry {
			if info, err := os.Stat(target); err == nil && info.Size() > 0 {
				skipped++
				manifest[id] = "/cinemas/" + id + ".jpg"
				continue
			}
		}
		if dry {
			fmt.Printf("  · %s（%s）→ %s\n", id, venue.Name, venue.Photo)
			manifest[id] = "/cinemas/" + id + ".jpg"
			continue
		}

		data, err := client.GetWithHeaders(ctx, venue.Photo, map[string]string{
			"Referer": cinemaphoto.Referer,
			"Accept":  "image/avif,image/webp,image/*,*/*;q=0.8",
		})
		if err != nil {
			fmt.Printf("  ⚠️ %s 下载失败：%v\n", id, err)
			failed++
			continue
		}
		if err := encodeBanner(data, target); err != nil {
			fmt.Printf("  ⚠️ %s 转码失败：%v\n", id, err)
			failed++
			continue
		}
		downloaded++
		manifest[id] = "/cinemas/" + id + ".jpg"
	}

	if dry {
		fmt.Printf("dry-run：将写 %d 条\n", len(manifest))
		return nil
	}

	if err := writeManifest(filepath.Join(root, "data", "cinema-photos.json"), manifest); err != nil {
		return err
	}
	fmt.Printf("下载 %d 张 / 跳过 %d 张 / 失败 %d 张，清单 %d 条\n",
		downloaded, skipped, failed, len(manifest))
	return nil
}

// encodeBanner decodes whatever the CDN served and writes a 16:9 JPEG.
//
// 源图尺寸差异极大（实测 460x300 到 8192x5464，还有 PNG），
// 因此统一按 cover 裁到 16:9：先等比缩放到「填满目标框」，再居中裁。
// 直接拉伸会把人拍扁，而 hero 的宽度是固定的，留白又会露出底色。
//
// ===== 为什么是 JPEG 而不是海报用的 WebP =====
//
// 海报管线（scripts/fetch-posters.mjs）用 sharp 转 WebP；Go 这边没有等价的
// 有损 WebP 编码器 —— 现成的 nativewebp 只做**无损** VP8L（实测照片 1600x900
// 要 1MB 以上，是 JPEG 的五倍），而 libwebp 的 Go 绑定要 cgo，为一张背景图
// 在服务器上引入 C 工具链不划算。
// JPEG 是标准库自带（纯 Go、无 cgo），且 hero 是不透明照片，不需要 WebP 的
// 透明通道。体积实测与海报同一量级。
func encodeBanner(data []byte, target string) error {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	if sw == 0 || sh == 0 {
		return fmt.Errorf("empty image")
	}

	// cover：缩放比取「填满目标框」所需的最大值，这样两边都不会有留白。
	scale := PhotoWidth / float64(sw)
	if s := PhotoHeight / float64(sh); s > scale {
		scale = s
	}
	// 小图不放大：535x370 的源拉到 1600 只会更糊，保持原尺寸居中放置。
	if sw < PhotoWidth {
		scale = 1
	}
	dw := int(float64(sw)*scale + 0.5)
	dh := int(float64(sh)*scale + 0.5)

	scaled := image.NewRGBA(image.Rect(0, 0, dw, dh))
	xdraw.CatmullRom.Scale(scaled, scaled.Bounds(), src, b, xdraw.Src, nil)

	// 居中裁出 16:9。图比目标小时先铺一块同尺寸的底再叠上去（不放大）。
	out := image.NewRGBA(image.Rect(0, 0, PhotoWidth, PhotoHeight))
	offX := (PhotoWidth - dw) / 2
	offY := (PhotoHeight - dh) / 2
	xdraw.Draw(out, image.Rect(offX, offY, offX+dw, offY+dh), scaled, image.Point{}, xdraw.Src)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: quality}); err != nil {
		return fmt.Errorf("encode jpeg: %w", err)
	}
	// 先写临时名再改名：构建中途被 kill 时不会留下半张图，
	// 而页面是按清单引用的 —— 半张图会显示成灰块。
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, target)
}

// readCinemas loads data/cinemas.json.
func readCinemas(path string) ([]cinemaphoto.Cinema, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var out []cinemaphoto.Cinema
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return out, nil
}

// readText reads a source file the matcher parses.
func readText(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// writeManifest writes the id to path map the page reads.
func writeManifest(path string, manifest map[string]string) error {
	raw, err := json.MarshalIndent(manifest, "", " ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

var _ = jpeg.DefaultQuality
