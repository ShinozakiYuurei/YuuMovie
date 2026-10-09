// Command ogcardgen 生成全站的社交分享卡片图（Open Graph / X Card）。
//
// ===== 它解决什么 =====
//
// 把站点链接贴到 X 上时预览卡片的两种情况（用户 2026-10-09 提出）：
//  1. 首页 / /showing / /upcoming / /cinema / 影院详情页**没有图** —— 只有一行文字；
//  2. 电影详情页给的是**竖版海报**（2:3），塞进 1.91:1 的大图卡片会被裁掉上下两端。
//
// 本命令按页生成 1200×630 的横版卡片，写到 public/og/ 下，
// 页面 metadata 引用 /og/<key>.jpg。
//
// ===== 分工：谁决定写什么，谁决定长什么样 =====
//
//   scripts/gen-og-plan.mts（TS）→ data/og-plan.json（文案与数据）
//   cmd/ogcardgen（Go）          → public/og/*.jpg（画图）
//
// 为什么文案不在这里算：「哪部片是一组、组用哪个 slug、卡片上写什么字」
// 全是 lib/data.ts 里踩过坑的页面语义（片名归并、组级字段挑选、英文名清洗）。
// 在 Go 里重写一遍必然与页面慢慢分叉，而「卡片上的片名和页面不一致」
// 是最难被发现的一类错。Go 只负责把给到的文案画成图。
//
// ===== 输入 =====
//
//   data/og-plan.json     卡片计划（见 scripts/gen-og-plan.mts）
//   public/posters/*.webp 已本地化的海报
//   app/fonts/NotoSansHK-Variable.woff2  站点正文字体
//
// ===== 输出 =====
//
//   public/og/home.jpg / showing.jpg / upcoming.jpg / cinema.jpg
//   public/og/movie-<slug>.jpg / cinema-<id>.jpg
//
// 为什么单独放 public/og 而不是 public/ 根下：卡片要按需清理
// （电影下画后它的卡片就该消失），单独一个目录便于整体重建，
// 放根目录会与 favicon 之类混在一起、清理时容易误删。
//
// ===== 增量与自愈 =====
//
// 与 scripts/fetch-posters.mjs 同一策略：文件已存在且非空就跳过，
// 日常重建只生成新片与新戏院的卡片。--force 全量重生成（改了版面之后用）。
//
// 用法：
//   go run ./cmd/ogcardgen                 # 增量
//   go run ./cmd/ogcardgen --force         # 全量重生成
//   go run ./cmd/ogcardgen --only=movie    # 只生成电影卡片（调试用）
package main

import (
	"encoding/json"
	"fmt"
	"image"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/ogcard"
	_ "golang.org/x/image/webp"
)

type plan struct {
	Counts struct {
		Showing  int `json:"showing"`
		Upcoming int `json:"upcoming"`
		Cinemas  int `json:"cinemas"`
		Shows    int `json:"shows"`
		Sources  int `json:"sources"`
	} `json:"counts"`
	HomePosters     []string `json:"homePosters"`
	ShowingPosters  []string `json:"showingPosters"`
	UpcomingPosters []string `json:"upcomingPosters"`
	CinemaPosters   []string `json:"cinemaPosters"`
	Movies          []struct {
		Slug     string `json:"slug"`
		Title    string `json:"title"`
		Subtitle string `json:"subtitle"`
		Meta     string `json:"meta"`
		Rating   string `json:"rating"`
		Extra    string `json:"extra"`
		Poster   string `json:"poster"`
		Accent   string `json:"accent"`
	} `json:"movies"`
	Cinemas []struct {
		ID      string   `json:"id"`
		Name    string   `json:"name"`
		Address string   `json:"address"`
		Pills   []string `json:"pills"`
		Posters []string `json:"posters"`
	} `json:"cinemas"`
}

func main() {
	root := os.Getenv("APP_DIR")
	if root == "" {
		root = "."
	}
	force := hasFlag("--force")
	only := flagValue("--only")

	planPath := filepath.Join(root, "data", "og-plan.json")
	posterDir := filepath.Join(root, "public", "posters")
	outDir := filepath.Join(root, "public", "og")

	var p plan
	b, err := os.ReadFile(planPath)
	if err != nil {
		die("读取 %s 失败：%v\n   （先跑：node --import tsx scripts/gen-og-plan.mts）", planPath, err)
	}
	if err := json.Unmarshal(b, &p); err != nil {
		die("解析 %s 失败：%v", planPath, err)
	}

	if err := os.MkdirAll(outDir, 0o755); err != nil {
		die("创建 %s 失败：%v", outDir, err)
	}

	fonts, err := ogcard.LoadFonts(filepath.Join(root, "app", "fonts", "NotoSansHK-Variable.woff2"))
	if err != nil {
		die("%v", err)
	}

	fmt.Printf("▶ 生成分享卡片（%d 部电影 / %d 间戏院）\n", len(p.Movies), len(p.Cinemas))

	// 海报缓存：同一张海报会出现在电影卡与书架里，
	// 解码一次约 20ms，缓存后整轮省下几百毫秒。
	cache := map[string]image.Image{}
	load := func(name string) image.Image {
		if name == "" {
			return nil
		}
		if img, ok := cache[name]; ok {
			return img
		}
		f, err := os.Open(filepath.Join(posterDir, name))
		if err != nil {
			cache[name] = nil
			return nil
		}
		defer f.Close()
		img, _, err := image.Decode(f)
		if err != nil {
			cache[name] = nil
			return nil
		}
		cache[name] = img
		return img
	}
	loadAll := func(names []string) []image.Image {
		var out []image.Image
		for _, n := range names {
			if img := load(n); img != nil {
				out = append(out, img)
			}
		}
		return out
	}

	start := time.Now()
	made, skipped, failed := 0, 0, 0

	emit := func(name string, kind string, render func() *ogcard.Card) {
		if only != "" && kind != only {
			return
		}
		path := filepath.Join(outDir, name)
		if !force {
			if st, err := os.Stat(path); err == nil && st.Size() > 0 {
				skipped++
				return
			}
		}
		card := render()
		if card == nil {
			failed++
			fmt.Printf("  ⚠️ %s：渲染返回空\n", name)
			return
		}
		if err := card.Save(path, 86); err != nil {
			failed++
			fmt.Printf("  ⚠️ %s：写文件失败 %v\n", name, err)
			return
		}
		made++
	}

	// ---------- 固定页面 ----------
	emit("home.jpg", "home", func() *ogcard.Card {
		return ogcard.RenderShelf(fonts, ogcard.ShelfCard{
			Title:       "Yuu",
			TitleAccent: "Movie",
			Subtitle:    "香港上映及即將上映電影資訊",
			Pills: []string{
				fmt.Sprintf("%d 部上映中", p.Counts.Showing),
				fmt.Sprintf("%d 部即將上映", p.Counts.Upcoming),
				fmt.Sprintf("%d 間戲院", p.Counts.Cinemas),
				fmt.Sprintf("%d 場次", p.Counts.Shows),
			},
			Posters:     loadAll(p.HomePosters),
			Footer:      "整合百老匯 · MCL · 英皇 · Cinema City 等院線",
			CenterTitle: true,
		})
	})

	emit("showing.jpg", "showing", func() *ogcard.Card {
		return ogcard.RenderShelf(fonts, ogcard.ShelfCard{
			Title:       "全部上映中電影",
			Subtitle:    "香港現正上映電影完整清單，含各格式版本（IMAX / 4DX / 菲林 / 特典場）與場次。",
			Pills:       []string{fmt.Sprintf("%d 部", p.Counts.Showing), "按場次多寡排列"},
			Posters:     loadAll(p.ShowingPosters),
			Footer:      "YuuMovie · 上映及即將上映",
			CenterTitle: true,
		})
	})

	emit("upcoming.jpg", "upcoming", func() *ogcard.Card {
		return ogcard.RenderShelf(fonts, ogcard.ShelfCard{
			Title:       "即將上映電影",
			Subtitle:    "香港即將上映電影一覽，按月歸類，包含上映日期、片長及場次資訊。",
			Pills:       []string{fmt.Sprintf("%d 部", p.Counts.Upcoming), "按月歸類"},
			Posters:     loadAll(p.UpcomingPosters),
			Footer:      "YuuMovie · 上映及即將上映",
			CenterTitle: true,
		})
	})

	emit("cinema.jpg", "cinema", func() *ogcard.Card {
		return ogcard.RenderShelf(fonts, ogcard.ShelfCard{
			Title:       "戲院一覽",
			Subtitle:    "香港各院線戲院地址、地圖、影廳規格（IMAX / 4DX / 全景聲…）及場次資訊。",
			Pills:       []string{fmt.Sprintf("%d 間戲院", p.Counts.Cinemas), fmt.Sprintf("%d 條院線", p.Counts.Sources)},
			Posters:     loadAll(p.CinemaPosters),
			Footer:      "YuuMovie · 上映及即將上映",
			CenterTitle: true,
		})
	})

	// ---------- 电影详情页 ----------
	for _, m := range p.Movies {
		m := m
		emit("movie-"+safeName(m.Slug)+".jpg", "movie", func() *ogcard.Card {
			accent := colAccent
			if m.Accent != "" {
				accent = ogcard.Hex(m.Accent)
			}
			return ogcard.RenderMovie(fonts, ogcard.MovieCard{
				Title:    m.Title,
				Subtitle: m.Subtitle,
				Meta:     m.Meta,
				Rating:   m.Rating,
				Extra:    m.Extra,
				Poster:   load(m.Poster),
				Accent:   accent,
			})
		})
	}

	// ---------- 戏院详情页 ----------
	for _, c := range p.Cinemas {
		c := c
		emit("cinema-"+safeName(c.ID)+".jpg", "cinema-detail", func() *ogcard.Card {
			return ogcard.RenderShelf(fonts, ogcard.ShelfCard{
				Title:    c.Name,
				Subtitle: c.Address,
				Pills:    c.Pills,
				Posters:  loadAll(c.Posters),
				Footer:   "今日及近期場次 · 票價 · 官方購票連結",
			})
		})
	}

	fmt.Printf("✔ 卡片：新生成 %d，跳过 %d，失败 %d（%.1fs）\n",
		made, skipped, failed, time.Since(start).Seconds())
	if failed > 0 {
		// 单张失败不算致命：对应页面会回退到品牌卡（见 lib/og.ts），
		// 但要在部署日志里看得见，否则会静默退化成一堆一样的卡片。
		fmt.Printf("  ⚠️ %d 张卡片生成失败，对应页面将回退到品牌卡\n", failed)
	}
}

var colAccent = ogcard.Hex("#8b7cff")

// safeName 把 slug / id 收敛成安全的文件名。
//
// slug 由 lib/data.ts 生成（已限 ASCII），影院 id 形如 broadway-palace-ifc；
// 这里仍做一次过滤：文件名要进 URL，任何斜杠或奇怪字符都会变成 404 或路径穿越。
func safeName(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-.")
	if out == "" {
		out = "x"
	}
	return out
}

func hasFlag(f string) bool {
	for _, a := range os.Args[1:] {
		if a == f {
			return true
		}
	}
	return false
}

func flagValue(f string) string {
	prefix := f + "="
	for i, a := range os.Args[1:] {
		if a == f && i+2 <= len(os.Args[1:]) {
			return os.Args[i+2]
		}
		if strings.HasPrefix(a, prefix) {
			return strings.TrimPrefix(a, prefix)
		}
	}
	return ""
}

func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "✖ "+format+"\n", args...)
	os.Exit(1)
}
