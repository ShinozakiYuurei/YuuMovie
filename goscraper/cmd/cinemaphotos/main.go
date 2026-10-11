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
	// 空导入注册解码器 —— 少一个就是「image: unknown format」：
	//
	// ★ WebP 这一行不是可選的（2026-10-11 首次上線實測踩到）：
	//   請求帶了 Accept: image/webp（見下方 download 處），而 storage.movie6.com
	//   **照做** —— 同一張圖按 Accept 返回 JPEG 或 WebP（實測 1.15MB → 647KB）。
	//   只註冊 JPEG/PNG 時，絕大多數戲院都會解碼失敗（首跑 53 家裡 48 家失敗），
	//   而錯誤訊息只有一句 "image: unknown format"，看不出是格式問題。
	//
	// GIF 純屬保險：目前沒有 .gif 源圖，但它是 image.Decode 的標準成員，
	// 註冊的代價只是幾 KB 二進位。
	_ "golang.org/x/image/webp"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	xdraw "golang.org/x/image/draw"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/cinemaphoto"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/venuephoto"
)

const (
	// PhotoWidth / PhotoHeight 是写出的横幅尺寸。
	//
	// 16:9 1600x900：与影院页 hero 的显示比例一致（桌面端满宽约 1120px，
	// HiDPI 屏需要 2240 物理像素，而 hkmovie6 的原图大量只有 535x370 ——
	// 1600 是「放大后仍不算太软」与体积之间的平衡点。
	// ★ 填满画布后单张体积比早期的「黑边版」大：大片纯黑压得极省，
	//   现在每个像素都是照片内容。
	PhotoWidth  = 1600
	PhotoHeight = 900
	// quality 取 80：横幅是背景图，压在深色渐变与文字之下，
	// 比海报更能容忍压缩。
	quality = 80

	// cropVersion 是裁切管线的版本号；改了任何影响像素输出的逻辑（裁切比例、
	// 放大策略、质量）都要 +1。
	//
	// ★ 为什么必须有它（2026-10-11 加）：增量逻辑只看「文件是否存在且非空」，
	//   不比对内容 —— 改了裁切而版本号没动，已存在的旧图会被**永远跳过**：
	//   线上继续是带黑边的老图，而日志里只有「跳过 N 张」，看不出异常。
	//   版本不符时本次全量重下，跑完写回新版本。
	//
	// ★ 它同时是 URL 上的缓存键（见 photoURL）：圖片子域與瀏覽器都按檔名
	//   （这里是 /cinemas/<id>.jpg）缓存 1 天，换了裁切但 URL 不变的话，
	//   老读者最长 24 小时仍看到旧图 —— 那正是「明明修了却没变」的观感。
	//   带上版本号后，新图立刻是新的 URL，无需等缓存过期。
	//
	// 2026-10-11 第二次 +1（2 → 3）：改用院线官网的宣傳照（前台/大堂/外立面），
	// 见 internal/venuephoto。换的不只是像素，还有「每家取哪一张」——
	// 增量逻辑只认文件在不在，不换版本号的话 13 家旧图会被永远跳过。
	cropVersion = 3
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
	// 裁切管线换版 → 磁盘上的旧图是按旧规则烘的，必须整批重来（见 cropVersion）。
	// 放在最前面：下面的循环只判「文件在不在」，到那里就晚了。
	markerPath := filepath.Join(root, "data", "cinema-photos.version")
	if !force {
		raw, err := os.ReadFile(markerPath)
		if err != nil || strings.TrimSpace(string(raw)) != strconv.Itoa(cropVersion) {
			force = true
			fmt.Printf("裁切管线版本与 %s 不符（want %d），本次全量重下\n", markerPath, cropVersion)
		}
	}

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

	// 官方宣传照优先（2026-10-11 用户要求：前台/大堂/外立面，不要影廳內景）。
	// hkmovie6 的 og:image 只作回退 —— 它在 13 家里给的是影廳內景或散景斑點圖。
	official := map[string]venuephoto.Source{}
	for _, id := range venuephoto.StaticIDs() {
		src, _ := venuephoto.Static(id)
		official[id] = src
	}
	if got, err := venuephoto.FetchIcirena(ctx); err != nil {
		fmt.Printf("⚠️ icirena 官方照抓取失败（该三条线沿用 hkmovie6）：%v\n", err)
	} else {
		for id, src := range got {
			official[id] = src
		}
	}
	fmt.Printf("官方宣传照：%d 家\n", len(official))

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
		// 官方宣传照优先；官方没有才回退 hkmovie6 的 og:image。
		src, referer, origin := venue.Photo, cinemaphoto.Referer, "hkmovie6"
		if officialSrc, ok := official[id]; ok {
			src, referer, origin = officialSrc.URL, officialSrc.Referer, officialSrc.Note
		}
		if src == "" {
			fmt.Printf("  · %s（%s）：无照片\n", id, venue.Name)
			continue
		}
		target := filepath.Join(outDir, id+".jpg")
		if !force && !dry {
			if info, err := os.Stat(target); err == nil && info.Size() > 0 {
				skipped++
				manifest[id] = photoURL(id)
				continue
			}
		}
		if dry {
			fmt.Printf("  · %s（%s）→ %s [%s]\n", id, venue.Name, src, origin)
			manifest[id] = photoURL(id)
			continue
		}

		data, err := client.GetWithHeaders(ctx, src, map[string]string{
			"Referer": referer,
			"Accept":  "image/avif,image/webp,image/*,*/*;q=0.8",
		})
		if err != nil {
			fmt.Printf("  ⚠️ %s 下载失败：%v\n", id, err)
			failed++
			dropStale(target)
			continue
		}
		if err := encodeBanner(data, target); err != nil {
			fmt.Printf("  ⚠️ %s 转码失败：%v\n", id, err)
			failed++
			dropStale(target)
			continue
		}
		downloaded++
		manifest[id] = photoURL(id)
	}

	if dry {
		fmt.Printf("dry-run：将写 %d 条\n", len(manifest))
		return nil
	}

	if err := writeManifest(filepath.Join(root, "data", "cinema-photos.json"), manifest); err != nil {
		return err
	}
	// 记下本次用的裁切版本，下次增量跑靠它判断旧图能不能复用。
	// 写在收尾（而非开头）是有意的：中途失败时保持旧版本号，
	// 下次仍然全量重下 —— 不会把「没跑完」当成「跑过了」。
	if err := os.WriteFile(markerPath, []byte(strconv.Itoa(cropVersion)+"\n"), 0o644); err != nil {
		return err
	}
	fmt.Printf("下载 %d 张 / 跳过 %d 张 / 失败 %d 张，清单 %d 条\n",
		downloaded, skipped, failed, len(manifest))
	return nil
}

// photoURL builds the manifest value for one cinema banner.
//
// 帶 ?v=<cropVersion> 是為了繞開快取：檔名固定（就是戲院 id），而內容會隨
// 裁切管線改變 —— 見 cropVersion 的註釋。查詢串不影響 nginx 的 location
// 匹配與靜態檔案查找，只改變瀏覽器／CDN 的快取鍵。
func photoURL(id string) string {
	return "/cinemas/" + id + ".jpg?v=" + strconv.Itoa(cropVersion)
}

// dropStale removes a previously written banner whose replacement failed.
//
// ★ 为什么必须删（2026-10-11）：清单是每轮**重建**的，失败的 id 不会写进去，
// 于是旧文件会变成「产物有、清单没有」的孤儿 —— 这正是
// probe/check-cinema-photos.mjs 的反向覆盖要拦的情况（部署会被判失败）。
// 删掉后状态重新一致：页面回退纯文字头部，且文件不存在 → 下一轮增量
// 会**只重试这一家**，不会因为要等下一次换版而永远停在旧图上。
//
// 注意不是「失败就放弃」：删掉的是可以随时重生成的产物（源图在 hkmovie6）。
func dropStale(target string) {
	if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
		fmt.Printf("    ⚠️ 清理旧图 %s 失败：%v\n", target, err)
	}
}

// encodeBanner decodes whatever the CDN served and writes a 16:9 JPEG.
//
// 源图尺寸差异极大（实测 460x300 到 8192x5464，还有 PNG），
// 因此统一按 cover 裁到 16:9：先在源图上取居中的那一块 16:9，再缩放填满画布。
// 直接拉伸会把人拍扁，而 hero 的宽度是固定的，留白又会露出底色。
//
// ★ 小图也必须放大（2026-10-11 用户反馈「要求图片能填充满，不要留这么大黑边」）。
// 此前这里是「源图窄于目标宽就不放大，原尺寸居中贴上去」，而 hkmovie6
// 的场馆照大多只有 535x370 —— 于是 1600x900 的画布四周全是黑。
// 更糟的是黑边**烘进了 JPEG**：页面上的 object-cover 只按容器裁，裁不掉
// 图里本来就有的黑，52 家里 42 家如此。放大确实更软，但 hero 上压着由下
// 往上的黑渐变与文字，轻微发软远好过一多半面积是纯黑。
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

	// cover：先在源图上取居中的 16:9 那一块，再把它缩放进画布。
	//
	// ★ 顺序是「先裁后缩」而不是「先缩后裁」（2026-10-11 改）：
	//   先缩整张的话，中间缓冲按「填满」的尺寸膨胀 —— 一张 400x3000 的竖图
	//   要 1600x12000 的 RGBA（约 77MB），而线上是 2C2G 的机器。
	//   先裁后缩的中间产物只有目标画布那么大，而且只重采样一次，更清晰。
	//
	// ★ 小图同样放大（见上方注释）—— 不放大就会在画布四周留下烘死的黑边。
	targetAR := float64(PhotoWidth) / float64(PhotoHeight)
	cw, ch := sw, sh
	if float64(sw)/float64(sh) > targetAR {
		// 源图比 16:9 更宽：裁掉左右两侧。
		cw = int(float64(sh)*targetAR + 0.5)
	} else {
		// 源图比 16:9 更高：裁掉上下两端。
		ch = int(float64(sw)/targetAR + 0.5)
	}
	if cw < 1 {
		cw = 1
	}
	if ch < 1 {
		ch = 1
	}
	crop := image.Rect(
		b.Min.X+(sw-cw)/2, b.Min.Y+(sh-ch)/2,
		b.Min.X+(sw-cw)/2+cw, b.Min.Y+(sh-ch)/2+ch,
	)

	out := image.NewRGBA(image.Rect(0, 0, PhotoWidth, PhotoHeight))
	xdraw.CatmullRom.Scale(out, out.Bounds(), src, crop, xdraw.Src, nil)

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
