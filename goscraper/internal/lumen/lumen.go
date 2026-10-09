// Package lumen scrapes the Lumen Cinema circuit.
//
// Ported from scrapeLumen in scrapers/other-circuits.js. This is the most
// involved circuit: it walks a film list, fetches each film's detail page, then
// makes two extra passes — one for ticket prices (which need a cookie-carrying
// redirect) and one for sold-out flags (from the QuickTickets JSON API).
//
// The seat map is not public, so remainRate stays null for every show; only the
// soldOut flag is known, which is why this circuit is the one exception to the
// "colour by remainRate" rule.
package lumen

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/htmlx"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// Base is the circuit's site root.
const Base = "https://www.lumencinema.com.hk"

// cinemaID is the single venue this circuit operates.
const cinemaID = "lumen-1001"

const cinemaCode = "1001"

var (
	detailHrefRe    = regexp.MustCompile(`(?i)href="([^"]*?/Browsing/Movies/Details/[^"]+)"`)
	filmIDRe        = regexp.MustCompile(`(?i)Details/(f-[^/?]+)`)
	runTimeRe       = regexp.MustCompile(`(?i)Run Time:\s*</label>\s*<span>(\d+)`)
	sessionAnchorRe = regexp.MustCompile(`(?is)(<a\b[^>]*class="[^"]*\bsession-time\b[^"]*"[^>]*>.*?</a>)`)
	openTagRe       = htmlx.OpeningTagRe("a")
	timeDatetimeRe  = regexp.MustCompile(`(?i)<time[^>]+datetime="([^"]+)"`)
	altRe           = regexp.MustCompile(`(?i)alt="([^"]+)"`)
	priceRe         = regexp.MustCompile(`(?i)data-original="(\d+)"`)
	mapRe           = regexp.MustCompile(`(?i)maps\.google\.com/maps\?[^"']+`)
)

// Scraper holds the HTTP client so tests can substitute one.
type Scraper struct{ Client *fetch.Client }

// New builds a Scraper with the default client.
func New() *Scraper { return &Scraper{Client: fetch.New()} }

// Scrape walks the film list and builds the snapshot.
func (s *Scraper) Scrape(ctx context.Context) (*model.Snapshot, error) {

	// Collect detail-page URLs from both listings, remembering each one's status.
	type target struct {
		url    string
		status string
	}
	var order []string
	byURL := map[string]string{}
	for _, route := range []struct{ path, status string }{
		{"/Browsing/Movies/NowShowing", "showing"},
		{"/Browsing/Movies/ComingSoon", "upcoming"},
	} {
		page, err := s.Client.Get(ctx, Base+route.path)
		if err != nil {
			return nil, fmt.Errorf("fetch %s: %w", route.path, err)
		}
		for _, m := range detailHrefRe.FindAllStringSubmatch(string(page), -1) {
			abs := scrapeutil.ResolveURL(Base, m[1])
			if _, seen := byURL[abs]; !seen {
				order = append(order, abs)
			}
			byURL[abs] = route.status
		}
	}

	var movies []model.Movie
	var shows []model.Show
	seenSessions := map[string]bool{}

	for _, detailURL := range order {
		status := byURL[detailURL]
		body, err := s.Client.Get(ctx, detailURL)
		if err != nil {
			continue
		}
		html := string(body)

		filmID := scrapeutil.Digest(detailURL)
		if m := filmIDRe.FindStringSubmatch(detailURL); m != nil {
			filmID = m[1]
		}
		name := htmlx.FirstTextByClass(html, "h3", "boxout-title")
		if name == "" {
			name = htmlx.FirstTextByClass(html, "h2", "film-title")
		}
		if name == "" {
			continue
		}
		runtime := 0
		if m := runTimeRe.FindStringSubmatch(html); m != nil {
			runtime, _ = strconv.Atoi(m[1])
		}
		poster := ParsePoster(filmID)
		blurb := ParseBlurb(html)
		movieID := "lumen-" + strings.TrimPrefix(strings.ToLower(filmID), "f-")
		// The JS strips the f- prefix case-insensitively; mirror that exactly.
		movieID = "lumen-" + stripFilmPrefix(filmID)

		movies = append(movies, model.Movie{
			ID:          movieID,
			NameEn:      name,
			Duration:    scrapeutil.NullableInt(runtime),
			Genres:      []string{},
			Description: blurb,
			Poster:      poster,
			DetailURL:   detailURL,
			Status:      status,
			Source:      model.SourceLumen,
		})

		for _, m := range sessionAnchorRe.FindAllStringSubmatch(html, -1) {
			anchor := m[1]
			opening := openTagRe.FindString(anchor)
			href := htmlx.Attr(opening, "href")
			datetime := htmlx.FirstMatch(timeDatetimeRe, anchor)
			abs := scrapeutil.ResolveURL(Base, href)

			sessionID := ""
			if u, err := url.Parse(abs); err == nil {
				sessionID = u.Query().Get("txtSessionId")
			}
			if sessionID == "" || datetime == "" || seenSessions[sessionID] {
				continue
			}
			seenSessions[sessionID] = true

			shows = append(shows, model.Show{
				ID:         "lumen-" + sessionID,
				MovieID:    movieID,
				CinemaID:   cinemaID,
				HouseName:  "",
				StartAt:    normalizeDateTime(datetime),
				Date:       datetime[:10],
				Tags:       []string{},
				Version:    model.PtrToNullable(scrapeutil.NullableString(htmlx.FirstMatch(altRe, anchor))),
				BookingURL: abs,
				Source:     model.SourceLumen,
			})
		}
	}

	if len(shows) == 0 {
		return nil, fmt.Errorf("Lumen returned no showtimes")
	}

	s.fillPrices(ctx, shows)
	s.fillSoldOut(ctx, shows)

	cinemaURL := Base + "/Browsing/Cinemas/Details/" + cinemaCode
	mapURL := ""
	if page, err := s.Client.Get(ctx, cinemaURL); err == nil {
		if m := mapRe.FindString(string(page)); m != "" {
			mapURL = "https://" + strings.TrimPrefix(strings.TrimPrefix(m, "//"), "https://")
		}
	}
	const addr = "G/F Po Sing Plaza, 1-25 Ta Chuen Ping Street, Kwai Chung, N.T."
	if mapURL == "" {
		mapURL = scrapeutil.MapSearch("Lumen Cinema", addr)
	}

	return &model.Snapshot{
		Movies: movies,
		Shows:  shows,
		Cinemas: []model.Cinema{{
			ID:        cinemaID,
			Code:      cinemaCode,
			NameZh:    "Lumen Cinema",
			Address:   addr,
			MapURL:    mapURL,
			DetailURL: cinemaURL,
			Source:    model.SourceLumen,
		}},
	}, nil
}

// stripFilmPrefix removes a leading f- (any case), matching the JS replace.
func stripFilmPrefix(id string) string {
	if len(id) >= 2 && (id[0] == 'f' || id[0] == 'F') && id[1] == '-' {
		return id[2:]
	}
	return id
}

// normalizeDateTime appends the Hong Kong offset when the page gives a local
// time, or converts an absolute instant into Hong Kong wall-clock time.
//
// The JS adds the offset to an absolute timestamp and re-serialises; doing the
// same keeps startAt comparable with every other circuit's value.
func normalizeDateTime(datetime string) string {
	if strings.HasSuffix(datetime, "Z") || hasNumericOffset(datetime) {
		t, err := time.Parse(time.RFC3339, datetime)
		if err != nil {
			return datetime + "+08:00"
		}
		return t.In(scrapeutil.HKT).Format("2006-01-02T15:04:05") + "+08:00"
	}
	return datetime + "+08:00"
}

func hasNumericOffset(s string) bool {
	if len(s) < 6 {
		return false
	}
	tail := s[len(s)-6:]
	return (tail[0] == '+' || tail[0] == '-') && tail[3] == ':'
}

// ParsePoster builds the CDN poster URL for a film id, mirroring
// parseLumenPoster(). The width and height are part of the URL the site itself
// uses, so they are kept verbatim.
func ParsePoster(filmID string) *string {
	id := stripFilmPrefix(filmID)
	if id == "" {
		return nil
	}
	abs := scrapeutil.ResolveURL(Base, "/CDN/media/entity/get/FilmPosterGraphic/f-"+id+
		"?width=800&height=1200&referenceScheme=Global&allowPlaceHolder=true")
	return &abs
}

// ParseBlurb extracts the synopsis paragraph, mirroring parseLumenBlurb().
//
// The paragraph carries a fixed "Introduction :" label that must be stripped:
// it is a page label, not prose. Returning it would make a film with no real
// synopsis look like it has one, which stops the group-level fallback from
// picking a different source's text.
func ParseBlurb(html string) string {
	raw := htmlx.FirstTextByClass(html, "p", "boxout-blurb")
	return strings.TrimSpace(introLabelRe.ReplaceAllString(raw, ""))
}

var introLabelRe = regexp.MustCompile(`(?i)^Introduction\s*:\s*`)

// fillPrices looks up the ticket price for every session.
//
// Vista only exposes the price on the seat-selection page, behind a redirect
// that requires carrying a cookie — hence GetWithCookieRedirect. A failure
// leaves the price null rather than dropping the show.
func (s *Scraper) fillPrices(ctx context.Context, shows []model.Show) {
	var mu sync.Mutex
	bySession := map[string]*float64{}
	runPool(len(shows), 4, func(i int) {
		sessionID := strings.TrimPrefix(shows[i].ID, "lumen-")
		ticketURL := fmt.Sprintf("%s/Ticketing/visSelectTickets.aspx?cinemacode=%s&txtSessionId=%s&visLang=1",
			Base, cinemaCode, sessionID)
		page, err := s.Client.GetWithCookieRedirect(ctx, ticketURL)
		if err != nil {
			return
		}
		m := priceRe.FindStringSubmatch(string(page))
		if m == nil {
			return
		}
		cents, err := strconv.Atoi(m[1])
		if err != nil {
			return
		}
		price := float64(cents) / 100
		mu.Lock()
		bySession[sessionID] = &price
		mu.Unlock()
	})
	for i := range shows {
		if p, ok := bySession[strings.TrimPrefix(shows[i].ID, "lumen-")]; ok {
			shows[i].Price = p
		}
	}
}

// quickTicketRow is one entry of the QuickTickets Sessions response.
type quickTicketRow struct {
	ID      any  `json:"Id"`
	SoldOut bool `json:"SoldOut"`
}

// fillSoldOut marks sessions the QuickTickets API reports as sold out.
//
// The seat map is not public, so this boolean is the only availability signal
// for this circuit; remainRate stays null by design. The API is queried per film
// with a Day/Evening split, which covers the whole day in two requests.
func (s *Scraper) fillSoldOut(ctx context.Context, shows []model.Show) {
	filmIDs := map[string]bool{}
	var order []string
	for _, show := range shows {
		filmID := "f-" + strings.TrimPrefix(show.MovieID, "lumen-")
		if !filmIDs[filmID] {
			filmIDs[filmID] = true
			order = append(order, filmID)
		}
	}

	var mu sync.Mutex
	soldOut := map[string]bool{}
	runPool(len(order), 3, func(i int) {
		filmID := order[i]
		for _, timeFilter := range []string{"Day", "Evening"} {
			body := url.Values{}
			body.Set("Movies", filmID)
			body.Set("Cinemas", cinemaCode)
			body.Set("ShowTypes", "2D")
			body.Set("Time", timeFilter)
			body.Set("Date", "")
			payload, err := s.Client.PostForm(ctx, Base+"/Browsing/QuickTickets/Sessions", body.Encode())
			if err != nil {
				continue
			}
			trimmed := strings.TrimSpace(string(payload))
			// A non-JSON body means the endpoint answered with an error page.
			if !strings.HasPrefix(trimmed, "[") {
				continue
			}
			var rows []quickTicketRow
			if err := json.Unmarshal([]byte(trimmed), &rows); err != nil {
				continue
			}
			mu.Lock()
			for _, row := range rows {
				id := stringifyID(row.ID)
				if id != "" {
					soldOut[id] = row.SoldOut
				}
			}
			mu.Unlock()
		}
	})

	for i := range shows {
		sessionID := strings.TrimPrefix(shows[i].ID, "lumen-")
		if sold, ok := soldOut[sessionID]; ok && sold {
			shows[i].SoldOut = true
		}
	}
}

// stringifyID renders an Id that may arrive as a number or a string.
func stringifyID(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatInt(int64(t), 10)
	case json.Number:
		return t.String()
	}
	return ""
}

// runPool runs fn(i) for i in [0,n) with a bounded number of goroutines.
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
		sem <- struct{}{}
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()
			fn(idx)
		}(i)
	}
	wg.Wait()
}
