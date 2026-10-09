// Package broadway scrapes the Broadway circuit (百老匯院線).
//
// Ported from scrapers/broadway.js. This is the largest circuit and its data
// is spread across three pages, each of which is needed:
//
//	/hk/movie/ticketing  shows, plus the movies array holding every format
//	                    version (IMAX / 4DX / 全景聲 / 特典場 …)
//	/hk/movie/upcoming   films that have not opened yet
//	/hk/movie/{id}       per-film detail, for the fields the list omits
//
// Two sources must be MERGED rather than picked between. The movies array
// carries every version but misses films that only have screenings; the shows
// carry the screenings but not the versions. Taking one of them loses data in
// both directions — that once left 30 orphan screenings and an incomplete
// version list on the site.
package broadway

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sync"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/flight"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

// Base is the circuit's site root.
const Base = "https://www.cinema.com.hk"

// Source is the circuit key used in generated ids.
const Source = "broadway"

// correctedEnglishTitles maps the circuit's spelling to the official one.
//
// The new-theatre quartet is listed under its Japanese home-video numbering
// (1.11 / 2.22 / 3.33 / 3.0+1.01) while the official cinema titles — and the
// IMDb titles the site matches against — use 1.0 / 2.0 / 3.0 / 3.0+1.0. The
// mismatch was visible on the page.
var correctedEnglishTitles = map[string]string{
	"Evangelion: 1.11 You Are (Not) Alone":    "Evangelion: 1.0 You Are (Not) Alone",
	"Evangelion: 2.22 You Can (Not) Advance":  "Evangelion: 2.0 You Can (Not) Advance",
	"Evangelion: 3.33 You Can (Not) Redo":     "Evangelion: 3.0 You Can (Not) Redo",
	"Evangelion: 3.0+1.01 Thrice Upon A Time": "Evangelion: 3.0+1.0 Thrice Upon a Time",
}

func correctedEnglish(en string) string {
	if fixed, ok := correctedEnglishTitles[en]; ok {
		return fixed
	}
	return en
}

// Scraper holds the HTTP client so tests can substitute one.
type Scraper struct {
	Client *fetch.Client
}

// New builds a Scraper with the default client.
func New() *Scraper { return &Scraper{Client: fetch.New()} }

// decoded is the ticketing page after Flight decoding.
type decoded struct {
	shows   []map[string]any
	movies  []map[string]any
	records map[int]string
}

// houseRe finds house records anywhere in the document.
//
// A keyed lookup cannot be used: the houses array repeats inside every site
// object, so it would only ever find the first one. Scanning for the house
// shape (its code looks like "79_HThe Ov") finds them all.
var houseRe = regexp.MustCompile(`\{"id":(\d+),"active":(?:true|false),"seq":\d+,"code":"\d+_[^"]*","name":"((?:[^"\\]|\\.)*)","name_lang":(\{[^}]*\})`)

// cinemaRe finds cinema records: the branch display name paired with its code.
var cinemaRe = regexp.MustCompile(`"hktaName":"([^"]*)","hktaCode":"([^"]*)"`)

// Scrape walks all three pages and merges the result.
//
// withDetails controls the per-film detail pass. It is the dominant cost — one
// request per film — and it is what fills in director, cast and the Chinese
// synopsis.
func (s *Scraper) Scrape(ctx context.Context, withDetails bool, concurrency int) (*model.Snapshot, []model.Movie, error) {
	if concurrency < 1 {
		concurrency = 3
	}

	tickBody, err := s.Client.Get(ctx, Base+"/hk/movie/ticketing")
	if err != nil {
		return nil, nil, fmt.Errorf("fetch ticketing: %w", err)
	}
	upcomingBody, err := s.Client.Get(ctx, Base+"/hk/movie/upcoming")
	if err != nil {
		return nil, nil, fmt.Errorf("fetch upcoming: %w", err)
	}

	tickDoc := flight.Extract(string(tickBody))
	showsRaw := flight.SliceArray(tickDoc, "shows")
	if showsRaw == "" {
		return nil, nil, fmt.Errorf("shows array not found — the page layout may have changed")
	}
	var rawShows []map[string]any
	if err := json.Unmarshal([]byte(showsRaw), &rawShows); err != nil {
		return nil, nil, fmt.Errorf("parse shows: %w", err)
	}
	var rawMovies []map[string]any
	if raw := flight.SliceArray(tickDoc, "movies"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &rawMovies)
	}
	records := flight.Records(tickDoc)
	houses := houseNames(tickDoc)

	shows := buildShows(rawShows, records, houses)
	cinemas := buildCinemas(tickDoc)

	// Merge: every id in the movies array, plus any film that only appears in
	// the shows. Missing either half loses data.
	rawIDs := map[int]bool{}
	var allIDs []int
	for _, m := range rawMovies {
		id := intFromAny(m["id"])
		if id <= 0 || rawIDs[id] {
			continue
		}
		rawIDs[id] = true
		allIDs = append(allIDs, id)
	}
	for _, sh := range rawShows {
		movie, _ := sh["movie"].(map[string]any)
		if movie == nil {
			continue
		}
		id := intFromAny(movie["id"])
		if id <= 0 || rawIDs[id] {
			continue
		}
		rawIDs[id] = true
		allIDs = append(allIDs, id)
	}

	byID := map[int]map[string]any{}
	for _, m := range rawMovies {
		id := intFromAny(m["id"])
		if id > 0 && byID[id] == nil {
			byID[id] = m
		}
	}

	// Detail pass: one request per film, batched. A failed detail is not fatal —
	// the listing still yields a usable record, just with fewer fields.
	details := map[int]*model.Movie{}
	if withDetails && len(allIDs) > 0 {
		var mu sync.Mutex
		runPool(len(allIDs), concurrency, func(i int) {
			m, err := s.scrapeMovieDetail(ctx, allIDs[i], records, byID[allIDs[i]])
			if err != nil || m == nil {
				return
			}
			mu.Lock()
			details[allIDs[i]] = m
			mu.Unlock()
		})
	}

	var showing []model.Movie
	for _, id := range allIDs {
		m := byID[id]
		if detail, ok := details[id]; ok {
			// The detail page is richer, but the LIST title wins: it carries the
			// format marker ("IMAX", "4DX") that the version grouping keys on.
			if lang := flight.LangField(records, nilOr(m, "name_lang")); lang["zh_hk"] != "" {
				detail.NameZh = lang["zh_hk"]
			}
			if lang := flight.LangField(records, nilOr(m, "name_lang")); lang["en"] != "" {
				detail.NameEn = correctedEnglish(lang["en"])
			}
			if d := hktDate(stringOr(m, "openingDate")); d != "" {
				detail.OpeningDate = model.NullablePtr(model.SomeNullable(d))
			}
			showing = append(showing, *detail)
			continue
		}
		showing = append(showing, minimalMovie(records, m, id))
	}

	upcoming := s.scrapeUpcoming(ctx, string(upcomingBody), concurrency)

	return &model.Snapshot{Movies: showing, Shows: shows, Cinemas: cinemas}, upcoming, nil
}
