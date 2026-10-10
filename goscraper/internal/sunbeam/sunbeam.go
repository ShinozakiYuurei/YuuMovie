// Package sunbeam scrapes the Sunbeam Whampoa circuit (新光黃埔影藝城).
//
// Ported from scrapeSunbeam in scrapers/other-circuits.js. The page ships its
// schedule as a React Server Components payload: each film is an
// `event:$R[n]={...}` literal followed by its screenings, so the parser walks
// those literals and treats everything up to the next one as that film's body.
//
// The sibling scrapeSunbeamTable (the older HTML-table page) is NOT ported: it
// is not exported and nothing calls it. Porting dead code would add a second
// implementation to keep in sync for no benefit.
package sunbeam

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// Base is the circuit's site root.
const Base = "https://www.sunbeamwhampoa.com"

// CoverBase is the host that actually serves the cover images.
//
// ★ 2026-10-10：海报 21 张全 404 的根因就是这个主机名。
//
//	页面里的 coverUrl 是**相对**路径（whampoa/covers/xxx.jpg），
//	拼哪个主机决定生死，而两者行为相反（实测同一张图）：
//	  www.sunbeamwhampoa.com/whampoa/covers/...  → 404（返回 112KB 的 HTML 错误页）
//	  cdn.sunbeamwhampoa.com/whampoa/covers/...  → 200（14MB JPEG）
//	原先这里传的是 Base（www），于是数据里存下一批**永远取不到**的 URL；
//	scripts/fetch-posters.mjs 下载失败后按设计保留旧记录并回退，
//	而旧记录也指向失效的 www —— 于是这几张海报既没本地化、也取不到远端。
//
// 这与原 JS 一致：它传给 absoluteUrl 的 base 也是 cdn.sunbeamwhampoa.com
// （见 deep_parity_test.go 里「JS 传 cdn」那句注释）。
// 之前 Go 版传 Base 是照抄了页面 host，属于误读。
const CoverBase = "https://cdn.sunbeamwhampoa.com"

// cinemaID is the single venue this circuit operates.
const cinemaID = "sunbeam-1"

var (
	// Each film begins with this literal. The escaped-string body pattern
	// (?:\\.|[^"\\])* is the JS one verbatim: RE2 handles it because it is
	// plain alternation, not lookaround.
	eventRe = regexp.MustCompile(`event:\$R\[\d+\]=\{id:(\d+),eventId:(?:null|\d+),filmId:"([^"]*)",objectId:"([^"]*)",eventNameTc:"((?:\\.|[^"\\])*)",eventNameEn:"((?:\\.|[^"\\])*)"`)
	coverRe = regexp.MustCompile(`coverUrl:"((?:\\.|[^"\\])*)"`)
	showRe  = regexp.MustCompile(`id:(\d+),eventId:(\d+),objectId:"([^"]*)",startDate:"(\d{4}-\d{2}-\d{2})",endDate:"[^"]+",startTime:"(\d{2}:\d{2})",startTimestamp:\d+,endTimestamp:\d+,venue:"([^"]+)",status:(!0|!1),ticketPrice:"([^"]*)"`)
)

// Scraper holds the HTTP client so tests can substitute one.
type Scraper struct{ Client *fetch.Client }

// New builds a Scraper with the default client.
func New() *Scraper { return &Scraper{Client: fetch.New()} }

// Scrape fetches and parses the schedule.
func (s *Scraper) Scrape(ctx context.Context) (*model.Snapshot, error) {
	body, err := s.Client.Get(ctx, Base+"/")
	if err != nil {
		return nil, fmt.Errorf("fetch home: %w", err)
	}
	return Parse(string(body)), nil
}

// Parse turns the page into a snapshot. It is exported so the fixture test can
// drive it without a network round trip.
func Parse(html string) *model.Snapshot {
	events := eventRe.FindAllStringSubmatchIndex(html, -1)

	movies := map[string]model.Movie{}
	var movieOrder []string
	shows := map[string]model.Show{}
	var showOrder []string

	for i, ev := range events {
		end := len(html)
		if i+1 < len(events) {
			end = events[i+1][0]
		}
		body := html[ev[0]:end]

		eventID := html[ev[2]:ev[3]]
		movieID := "sunbeam-" + eventID
		nameZh := scrapeutil.DecodeJSString(html[ev[8]:ev[9]])
		nameEn := scrapeutil.DecodeJSString(html[ev[10]:ev[11]])
		poster := ParsePoster(body, CoverBase)

		if _, seen := movies[movieID]; !seen {
			movieOrder = append(movieOrder, movieID)
		}
		// Later events overwrite earlier ones, matching the JS Map.set.
		movies[movieID] = model.Movie{
			ID:     movieID,
			NameZh: nameZh,
			NameEn: nameEn,
			// Sunbeam publishes the key with a null value; the field has to be
			// present rather than omitted, which is what the shared type allows.
			OpeningDate: model.NullablePtr(model.Nullable[string]{}),
			Genres:      []string{},
			Description: "",
			Poster:      poster,
			DetailURL:   Base + "/schedule",
			Status:      "showing",
			Source:      model.SourceSunbeam,
		}

		for _, m := range showRe.FindAllStringSubmatch(body, -1) {
			showID := m[1]
			// status must be true: !1 means the screening is cancelled or past.
			if m[7] != "!0" {
				continue
			}
			if _, seen := shows[showID]; seen {
				continue
			}
			date := m[4]
			startTime := m[5]
			venue := m[6]
			// ticketPrice can be "80/60"; the JS takes the first figure.
			price := scrapeutil.ParsePrice(strings.Split(m[8], "/")[0])

			shows[showID] = model.Show{
				ID:         "sunbeam-" + showID,
				MovieID:    movieID,
				CinemaID:   cinemaID,
				HouseName:  venue + "院",
				StartAt:    date + "T" + startTime + ":00+08:00",
				Date:       date,
				Price:      price,
				Tags:       []string{},
				Category:   model.CategoryNull(),
				Version:    model.Nullable[string]{},
				Language:   model.Nullable[string]{},
				BookingURL: Base + "/schedule",
				// Sunbeam publishes no seat data, so the key is present and false.
				SoldOut: model.BoolPtr(false),
				Source:  model.SourceSunbeam,
			}
			showOrder = append(showOrder, showID)
		}
	}

	out := &model.Snapshot{
		Movies: make([]model.Movie, 0, len(movieOrder)),
		Shows:  make([]model.Show, 0, len(showOrder)),
		Cinemas: []model.Cinema{{
			ID:        cinemaID,
			Code:      "WHAMPOA",
			NameZh:    "新光黃埔影藝城",
			Address:   "\u4e5d\u9f8d\u7d05\u78e1\u5fb7\u5b89\u88577\u865f\u9ec3\u57d4\u5929\u5730\u87a2\u5e55\u5708\uff08\u7b2c\u516b\u671f\uff092\u6a13",
			MapURL:    scrapeutil.MapSearch("Sunbeam Whampoa", "\u4e5d\u9f8d\u7d05\u78e1\u5fb7\u5b89\u88577\u865f\u9ec3\u57d4\u5929\u5730\u87a2\u5e55\u5708\uff08\u7b2c\u516b\u671f\uff092\u6a13"),
			DetailURL: Base + "/",
			Source:    model.SourceSunbeam,
		}},
	}
	for _, id := range movieOrder {
		out.Movies = append(out.Movies, movies[id])
	}
	for _, id := range showOrder {
		out.Shows = append(out.Shows, shows[id])
	}
	return out
}

// ParsePoster extracts the cover URL from a film's payload body, mirroring
// parseSunbeamPoster().
func ParsePoster(body, base string) *string {
	m := coverRe.FindStringSubmatch(body)
	if m == nil {
		return nil
	}
	coverURL := scrapeutil.DecodeJSString(m[1])
	if coverURL == "" {
		return nil
	}
	abs := absoluteURL(base, coverURL)
	return &abs
}

// absoluteURL resolves ref against base, falling back to base on any parse
// error — the same fallback absoluteUrl() in the JS performs.
func absoluteURL(base, ref string) string {
	if ref == "" {
		return base
	}
	return scrapeutil.ResolveURL(base, ref)
}
