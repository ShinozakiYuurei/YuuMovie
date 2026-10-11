// Package cinemaphoto fetches a venue photograph for each cinema page.
//
// ===== 为什么需要它（2026-10-11 用户要求）=====
//
// 用户：「优化电影院点进去的页面，像图二一样添加影院的图片」。
//
// 戏院详情页此前只有标题 + 地址 + 手续费 + 场次列表，没有任何场馆照片。
// 十三个院线抓取源都不提供场馆照片 —— 它们给的是场次、票价与影片海报，
// 场馆照不在其中。因此照片只能来自外部，来源选 hkmovie6 的戏院页：
// 每家的 og:image 就是该场馆的横幅照（同一张图也是它页面里的
// mainBackground 背景），实测 59 家里 57 家有图。
//
// ===== 为什么照片必须本地化 =====
//
// 与 scripts/fetch-posters.mjs 同一套理由，而且更硬：
//  1. storage.movie6.com 对**用户侧网络**不可达（本站读者多在大陆）；
//  2. 该 CDN **校验 Referer** —— 实测不带 Referer 直接 403（1.1MB 的原图
//     会变成 4KB 的错误页）。页面引用远端 URL 只会得到一片碎图。
//
// 因此照片下载到 public/cinemas/ 同源提供，与海报同一条路。
//
// ===== 匹配：名称给候选，坐标做判据 =====
//
// hkmovie6 的戏院名与本站的显示名写法常不同（「百老匯戲院 - 旺角」vs
// 「旺角百老匯戲院」），单看名字会漏配；而同一商场里两家戏院的名字又
// 很像，单看坐标会错配。因此两条依据并用：
//
//  1. 名称归一化后相等        → 接受
//  2. 否则坐标距离 < 300m     → 接受
//
// 两条都不满足 → 该戏院没有照片，页面回退到纯文字头部（优雅降级）。
//
// 坐标读 lib/cinema-geo.ts（正则提取，与 probe/verify-all-cinemas.mjs
// 同一做法）：那是全站座标的单一事实源，在 Go 里重抄一份必然慢慢分叉。
package cinemaphoto

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
)

// Base 是 hkmovie6 的站根。戏院列表与详情都在它下面。
const Base = "https://hkmovie6.com"

// Referer 是下载场馆照时必须带的头。
//
// ★ 这不是可选礼节：storage.movie6.com 校验它，缺了直接 403。
//
//	实测同一张 1.1MB 的原图，带 Referer 200 / 不带 403（4KB 错误页）。
const Referer = Base + "/"

// matchRadiusMeters 是坐标判据的半径。
//
// 取 300m：同一家戏院在不同数据源里的坐标偏差实测都在 300m 内
// （最大 285m，见 MOViE MOViE Cityplaza），而不同戏院相距远大于此。
// 再放宽会把相邻两家并成一家。
const matchRadiusMeters = 300

// requestTimeout 限定单页抓取，与 synopsis 同一量级。
const requestTimeout = 20 * time.Second

// Scraper holds the HTTP client so tests can substitute one.
type Scraper struct {
	// Site fetches hkmovie6. It answers this machine with 403 (Cloudflare),
	// so on a non-Hong-Kong host it must go through the egress proxy.
	Site *fetch.Client
}

// New builds a Scraper using the proxy named by CINEMA_PROXY, falling back to
// the ones the other Hong-Kong-only circuits already use.
func New() *Scraper {
	return &Scraper{Site: fetch.New(fetch.WithProxy(proxyURL()), fetch.WithTimeout(requestTimeout))}
}

// proxyURL resolves the egress proxy, preferring a cinema-specific setting.
func proxyURL() string {
	for _, name := range []string{"CINEMA_PROXY", "SYNOPSIS_PROXY", "LUX_PROXY", "MCL_PROXY"} {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

// Venue is one hkmovie6 cinema entry.
type Venue struct {
	// UUID is the site's branch code, stable across runs.
	UUID string
	// Name is the display name as the listing writes it.
	Name string
	// Lat / Lon come from the page's structured data; zero when absent.
	Lat float64
	Lon float64
	// Photo is the venue's banner image, empty when the venue has none.
	Photo string
}

var (
	// Cinema links appear twice on the listing (the nav dropdown and the card
	// grid). The UUID identifies a venue; the trailing name is only for logs.
	listRe = regexp.MustCompile("href=\"/cinema/([0-9a-f-]{36})/([^\"?#]+)\"")
	// og:image is the same URL the page paints as its hero background.
	ogImageRe = regexp.MustCompile("property=\"og:image\" content=\"([^\"]+)\"")
	// Coordinates sit in the escaped JSON-LD blob, hence the loose separators.
	latRe = regexp.MustCompile("latitude[^0-9-]{0,10}(-?[0-9]+\\.[0-9]+)")
	lonRe = regexp.MustCompile("longitude[^0-9-]{0,10}(-?[0-9]+\\.[0-9]+)")
)

// ParseList pulls every venue the listing page links to.
//
// "Special Screening" entries are dropped: they are hkmovie6's duplicates of a
// venue for one-off screenings, not a second venue, and matching them would
// let a special-screening row shadow the real one.
func ParseList(html string) []Venue {
	seen := map[string]bool{}
	var out []Venue
	for _, m := range listRe.FindAllStringSubmatch(html, -1) {
		uuid := m[1]
		name := decodeURLName(m[2])
		if strings.Contains(name, "Special Screening") {
			continue
		}
		if seen[uuid] {
			continue
		}
		seen[uuid] = true
		out = append(out, Venue{UUID: uuid, Name: name})
	}
	return out
}

// ParseVenuePage reads the banner photo and the coordinates off a venue page.
func ParseVenuePage(html string) Venue {
	var v Venue
	// ★ og:image 是空字符串时要当「没有照片」而不是「有照片」：新光黃埔的页面
	//   就写着 content=""（该场馆在 hkmovie6 上确实没有横幅图）。不判空的话
	//   后面会拿空 URL 去下载，得到一个语焉不详的失败。
	if m := ogImageRe.FindStringSubmatch(html); m != nil {
		v.Photo = strings.TrimSpace(m[1])
	}
	if m := latRe.FindStringSubmatch(html); m != nil {
		v.Lat, _ = strconv.ParseFloat(m[1], 64)
	}
	if m := lonRe.FindStringSubmatch(html); m != nil {
		v.Lon, _ = strconv.ParseFloat(m[1], 64)
	}
	return v
}

// decodeURLName turns the URL path segment back into a display name.
func decodeURLName(encoded string) string {
	name, err := url.PathUnescape(encoded)
	if err != nil {
		name = encoded
	}
	return strings.TrimSpace(strings.ReplaceAll(name, "_", " "))
}

// FetchList returns every venue on the listing page.
func (s *Scraper) FetchList(ctx context.Context) ([]Venue, error) {
	body, err := s.Site.GetWithHeaders(ctx, Base+"/cinema", map[string]string{
		"Accept-Language": "zh-HK,zh;q=0.9",
	})
	if err != nil {
		return nil, fmt.Errorf("fetch cinema list: %w", err)
	}
	venues := ParseList(string(body))
	if len(venues) == 0 {
		return nil, fmt.Errorf("cinema list parsed to zero venues — the page shape changed")
	}
	return venues, nil
}

// FetchVenue fills in the photo and coordinates for one venue.
func (s *Scraper) FetchVenue(ctx context.Context, uuid string) (Venue, error) {
	body, err := s.Site.GetWithHeaders(ctx, Base+"/cinema/"+uuid, map[string]string{
		"Accept-Language": "zh-HK,zh;q=0.9",
	})
	if err != nil {
		return Venue{}, fmt.Errorf("fetch venue %s: %w", uuid, err)
	}
	return ParseVenuePage(string(body)), nil
}

// Cinema is the slice of data/cinemas.json this layer needs.
type Cinema struct {
	ID     string `json:"id"`
	NameZh string `json:"nameZh"`
}

// Match pairs our cinemas with hkmovie6 venues.
//
// displayName maps a cinema id to the name the site actually shows (see
// lib/cinema-names.ts): the scraped nameZh is often just the district
// ("旺角"), while the page shows the brand-prefixed one
// ("旺角百老匯戲院"). Matching on the raw name would miss those.
//
// The returned map holds only the cinemas that were matched; a cinema without
// an entry simply has no photo.
func Match(cinemas []Cinema, venues []Venue, displayName map[string]string, coords map[string][2]float64) map[string]Venue {
	out := map[string]Venue{}
	for _, c := range cinemas {
		name := displayName[c.ID]
		if strings.TrimSpace(name) == "" {
			name = c.NameZh
		}
		key := NormalizeName(name)
		if key == "" {
			continue
		}

		var byName *Venue
		var byDistance *Venue
		bestDistance := float64(matchRadiusMeters)
		coord, hasCoord := coords[c.ID]

		for i := range venues {
			v := &venues[i]
			if NormalizeName(v.Name) == key {
				byName = v
				break
			}
			if !hasCoord || v.Lat == 0 || v.Lon == 0 {
				continue
			}
			if d := distanceMeters(coord, [2]float64{v.Lat, v.Lon}); d < bestDistance {
				bestDistance = d
				byDistance = v
			}
		}

		switch {
		case byName != nil:
			out[c.ID] = *byName
		case byDistance != nil:
			out[c.ID] = *byDistance
		}
	}
	return out
}

// NormalizeName reduces a cinema name to the part two sources must agree on.
//
// 只保留字母与数字（含 CJK）：两个站点对同一家戏院的名字差异全在
// 空格、括号、连字符与标点上（「百老匯戲院 - 旺角」vs「旺角百老匯戲院」、
// 「影藝戲院 (翡翠明珠)」vs「影藝戲院(銅鑼灣JP)」），而词本身是相同的。
//
// ★ 为什么不逐个列举要删的字符：
// 漏一个就静默失配 —— 而失配的表现只是「这家戏院没照片」，
// 不会有任何报错。反过来只保留「有意义的字符」则天然封闭：
// 将来页面换成别的分隔符也照样成立。
func NormalizeName(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// distanceMeters is the equirectangular approximation. Over the few hundred
// metres this is used for, the error against a proper haversine is negligible.
func distanceMeters(a, b [2]float64) float64 {
	const degToMeters = 111320.0
	dy := (a[0] - b[0]) * degToMeters
	dx := (a[1] - b[1]) * degToMeters * math.Cos((a[0]+b[0])/2*math.Pi/180)
	return math.Sqrt(dx*dx + dy*dy)
}

// ParseCoords extracts the coordinate table from lib/cinema-geo.ts.
//
// Reading the TypeScript file rather than keeping a second copy in Go is
// deliberate: that file is the single source of truth for coordinates (it also
// carries the correction notes), and a duplicate would drift.
func ParseCoords(src string) map[string][2]float64 {
	block := coordBlockRe.FindString(src)
	out := map[string][2]float64{}
	if block == "" {
		return out
	}
	for _, m := range coordEntryRe.FindAllStringSubmatch(block, -1) {
		lat, err1 := strconv.ParseFloat(m[2], 64)
		lon, err2 := strconv.ParseFloat(m[3], 64)
		if err1 != nil || err2 != nil {
			continue
		}
		out[m[1]] = [2]float64{lat, lon}
	}
	return out
}

var (
	coordBlockRe = regexp.MustCompile("(?s)export const CINEMA_COORD:.*?\\n\\};")
	coordEntryRe = regexp.MustCompile("'([a-z0-9-]+)':\\s*\\[(-?[0-9.]+),\\s*(-?[0-9.]+)\\]")
)

// ParseDisplayNames extracts lib/cinema-names.ts's id to display-name table.
func ParseDisplayNames(src string) map[string]string {
	block := displayBlockRe.FindString(src)
	out := map[string]string{}
	if block == "" {
		return out
	}
	for _, m := range displayEntryRe.FindAllStringSubmatch(block, -1) {
		out[m[1]] = m[2]
	}
	return out
}

var (
	displayBlockRe = regexp.MustCompile("(?s)export const CINEMA_DISPLAY_NAME:.*?\\n\\};")
	displayEntryRe = regexp.MustCompile("'([a-z0-9-]+)':\\s*'([^']+)'")
)

// SortedIDs returns the cinema ids in a stable order, so logs and the written
// manifest do not shuffle between runs.
func SortedIDs(m map[string]Venue) []string {
	ids := make([]string, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
