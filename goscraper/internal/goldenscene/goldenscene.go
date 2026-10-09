// Package goldenscene scrapes the Golden Scene circuit (高先電影院).
//
// Ported from scrapeGoldenScene in scrapers/other-circuits.js. The site is a
// Nuxt application: each page embeds its state as window.__NUXT__, a devalue
// payload that the Node scraper evaluated with node:vm. Here the devalue package
// parses it directly, which is what makes the circuit available to Go at all.
//
// Two things are easy to get wrong and are called out where they happen: the
// version tags arrive as an array of localised objects that has to be flattened
// to a single string, and occupancyRate is the percentage already taken, so the
// remaining share is one minus it.
package goldenscene

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/devalue"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// Base is the circuit's site root.
const Base = "https://goldenscene.com"

// Source is the circuit key used in generated ids.
const Source = "goldenscene"

// cinemaID is the single venue this circuit operates.
const cinemaID = Source + "-1"

// cinemaCode is the code shown on the site.
const cinemaCode = "GSC"

// cinemaName is the venue's Chinese display name.
const cinemaName = "高先電影院"

// cinemaAddress is the street address in Chinese, matching the site's own form.
const cinemaAddress = "堅尼地城吉席街2號"

// defaultMaxPages caps how many film pages one run visits. The listing pages
// carry every film, so this is a safety valve rather than a limit.
const defaultMaxPages = 60

// pageConcurrency is how many film pages are fetched at once.
const pageConcurrency = 4

// movieHrefRe finds the film links on the three listing pages.
var movieHrefRe = regexp.MustCompile(`(?i)href="(/movie/[^"#]+)"`)

// scriptRe pulls the payload script out of a page.
var scriptRe = regexp.MustCompile(`(?is)<script[^>]*>(.*?)</script>`)

// listingRoutes are the three lists the site maintains. A film can appear in
// more than one: a special screening of an already-released film, for instance.
var listingRoutes = []string{
	"/?movieList=SHOWING",
	"/?movieList=UPCOMING",
	"/?movieList=SPECIAL",
}

// Scraper holds the HTTP client so tests can substitute one.
type Scraper struct {
	Client *fetch.Client
}

// New builds a Scraper with the default client.
func New() *Scraper { return &Scraper{Client: fetch.New()} }

// Scrape walks the listing pages, then each film page.
func (s *Scraper) Scrape(ctx context.Context, maxPages int) (*model.Snapshot, error) {
	if maxPages <= 0 {
		maxPages = defaultMaxPages
	}

	urls, err := s.discover(ctx)
	if err != nil {
		return nil, err
	}
	if maxPages > len(urls) {
		maxPages = len(urls)
	}
	urls = urls[:maxPages]

	pages := make([]filmPage, len(urls))
	runPool(len(urls), pageConcurrency, func(i int) {
		page, err := s.fetchFilmPage(ctx, urls[i])
		if err != nil || page == nil {
			// A film page that will not parse must not lose the circuit: the
			// remaining pages still carry the schedule.
			return
		}
		pages[i] = *page
	})

	movies := map[string]model.Movie{}
	var movieOrder []string
	shows := map[string]model.Show{}
	var showOrder []string

	for _, page := range pages {
		if page.State == nil {
			continue
		}
		movie, ok := page.State["movie"].(map[string]any)
		if !ok {
			continue
		}
		uuid, _ := movie["uuid"].(string)
		if uuid == "" {
			continue
		}

		movieID := Source + "-" + uuid
		opening := epochDate(movie["releaseAt"])
		status := "showing"
		if opening != "" && opening > scrapeutil.TodayHKT() {
			status = "upcoming"
		}

		category := localized(movie["category"])
		dialect := localized(movie["language"])

		if _, seen := movies[movieID]; !seen {
			movieOrder = append(movieOrder, movieID)
		}
		movies[movieID] = model.Movie{
			ID:          movieID,
			NameZh:      localized(movie["name"]),
			NameEn:      enText(movie["name"]),
			OpeningDate: model.NullablePtr(model.PtrToNullable(nullable(opening))),
			Duration:    intPtr(number(movie["duration"])),

			// Duration and price both go through the same Number(x) || null
			// treatment, so zero means unknown rather than free.
			Category:    nullable(category),
			Dialect:     nullable(dialect),
			Subtitle:    nullable(localized(movie["subtitle"])),
			Genres:      nameList(movie["genres"]),
			Director:    joinNames(movie["directors"]),
			Cast:        joinNames(movie["casts"]),
			Description: firstNonEmpty(localized(movie["synopsis"]), enText(movie["synopsis"])),
			Poster:      scrapeutil.NullableString(text(movie["posterUrl"])),
			Trailer:     firstString(movie["trailerUrls"]),
			DetailURL:   page.URL,
			Status:      status,
			Source:      model.SourceGoldenScene,
		}

		days, _ := page.State["schedule"].([]any)
		for _, rawDay := range days {
			day, ok := rawDay.(map[string]any)
			if !ok {
				continue
			}
			date := epochDate(day["date"])
			items, _ := day["shows"].([]any)
			for _, rawItem := range items {
				item, ok := rawItem.(map[string]any)
				if !ok {
					continue
				}
				show, ok := s.buildShow(item, movieID, date, page.URL, category, dialect)
				if !ok {
					continue
				}
				if _, seen := shows[show.ID]; seen {
					continue
				}
				showOrder = append(showOrder, show.ID)
				shows[show.ID] = show
			}
		}
	}

	if len(shows) == 0 {
		return nil, fmt.Errorf("Golden Scene returned no showtimes")
	}

	movieList := make([]model.Movie, 0, len(movieOrder))
	for _, id := range movieOrder {
		movieList = append(movieList, movies[id])
	}
	showList := make([]model.Show, 0, len(showOrder))
	for _, id := range showOrder {
		showList = append(showList, shows[id])
	}

	return &model.Snapshot{
		Movies: movieList,
		Shows:  showList,
		Cinemas: []model.Cinema{{
			ID:        cinemaID,
			Code:      cinemaCode,
			NameZh:    cinemaName,
			Address:   cinemaAddress,
			MapURL:    scrapeutil.MapSearch(cinemaName, cinemaAddress),
			DetailURL: Base + "/cinema",
			Source:    model.SourceGoldenScene,
		}},
	}, nil
}

// buildShow turns one schedule entry into a screening.
func (s *Scraper) buildShow(item map[string]any, movieID, date, pageURL, category, dialect string) (model.Show, bool) {
	raw, ok := item["show"].(map[string]any)
	if !ok {
		return model.Show{}, false
	}
	uuid, _ := raw["uuid"].(string)
	if uuid == "" {
		return model.Show{}, false
	}
	// status 0 marks a cancelled screening.
	if v, _ := raw["status"].(float64); v == 0 {
		return model.Show{}, false
	}

	house, _ := item["house"].(map[string]any)
	houseName := firstNonEmpty(localized(house["name"]), enText(house["name"]))

	// occupancyRate is the share already taken, so the remaining share is one
	// minus it. The Node scraper clamps the same way.
	occupancy := number(item["occupancyRate"])
	rate := 1 - occupancy/100
	if rate < 0 {
		rate = 0
	}
	if rate > 1 {
		rate = 1
	}

	soldOut := occupancy >= 100
	if v, ok := raw["status"].(float64); ok {
		soldOut = soldOut || v != 1
	}

	return model.Show{
		ID:       Source + "-" + uuid,
		MovieID:  movieID,
		CinemaID: cinemaID,
		// The site labels every screen with a 號院 suffix.
		HouseName:  houseName + "號院",
		StartAt:    epochHkt(raw["startTime"]),
		Date:       date,
		Price:      optionalFloat(raw["price"]),
		Seats:      intPtr(number(house["seats"])),
		RemainRate: model.SomeNullable(rate),
		SoldOut:    model.BoolPtr(soldOut),
		Tags:       []string{},
		Category:   model.CategoryPresent(category),
		// The version tags are a list of localised objects; the site shows them
		// as one space-joined label.
		Version:    model.PtrToNullable(scrapeutil.NullableString(strings.Join(nameList(item["versionTags"]), " "))),
		Language:   model.PtrToNullable(nullable(dialect)),
		BookingURL: pageURL,
		Source:     model.SourceGoldenScene,
	}, true
}

// filmPage is one film page and its decoded payload.
type filmPage struct {
	URL   string
	State map[string]any
}

// discover collects the film URLs from the three listing pages.
func (s *Scraper) discover(ctx context.Context) ([]string, error) {
	seen := map[string]bool{}
	var out []string

	for _, route := range listingRoutes {
		body, err := s.Client.Get(ctx, Base+route)
		if err != nil {
			return nil, fmt.Errorf("golden scene listing %s: %w", route, err)
		}
		for _, m := range movieHrefRe.FindAllStringSubmatch(string(body), -1) {
			full := scrapeutil.ResolveURL(Base, m[1])
			if seen[full] {
				continue
			}
			seen[full] = true
			out = append(out, full)
		}
	}
	return out, nil
}

// fetchFilmPage loads one film page and decodes its payload.
func (s *Scraper) fetchFilmPage(ctx context.Context, url string) (*filmPage, error) {
	body, err := s.Client.Get(ctx, url)
	if err != nil {
		return nil, err
	}

	payload := ""
	for _, m := range scriptRe.FindAllStringSubmatch(string(body), -1) {
		if strings.Contains(m[1], "window.__NUXT__=") {
			payload = m[1]
			break
		}
	}
	if payload == "" {
		return nil, fmt.Errorf("golden scene page has no Nuxt payload: %s", url)
	}

	value, err := devalue.Eval(payload)
	if err != nil {
		return nil, err
	}
	root, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("golden scene payload is not an object: %s", url)
	}
	// The page state sits in data[0], the same slot the Node scraper read.
	data, ok := root["data"].([]any)
	if !ok || len(data) == 0 {
		return nil, fmt.Errorf("golden scene payload has no data: %s", url)
	}
	state, ok := data[0].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("golden scene payload data[0] is not an object: %s", url)
	}
	return &filmPage{URL: url, State: state}, nil
}

func runPool(n, concurrency int, fn func(int)) {
	if n <= 0 {
		return
	}
	if concurrency < 1 {
		concurrency = 1
	}
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			fn(idx)
		}(i)
	}
	wg.Wait()
}
