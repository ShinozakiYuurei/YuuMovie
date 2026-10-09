// Package newport scrapes the Newport / Hyland Theatre circuit (凱都戲院).
//
// Ported from scrapeNewport in scrapers/other-circuits.js. It fetches both the
// English and Chinese listings because the English page has the schedule while
// the Chinese page has the Chinese film titles, joined on the numeric movie id.
//
// Two details are easy to get wrong and are noted where they matter: the
// release-date year comes from the page, not from today, and the session rows
// are parsed out of a single text line rather than from separate elements.
package newport

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/htmlx"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// Base is the circuit's site root.
const Base = "https://www.theatre.com.hk"

// cinemaID is the single venue this circuit operates.
const cinemaID = "newport-hyland"

const address = "136 Heung Sze Wui Road, Tuen Mun, N.T."

var (
	movieIDRe  = regexp.MustCompile(`data-movie-id="(\d+)"`)
	hrefEnRe   = regexp.MustCompile(`href="/en/movie/(\d+)`)
	hrefZhRe   = regexp.MustCompile(`href="/tc/movie/(\d+)`)
	labelTopic = regexp.MustCompile(`(?is)<label\b[^>]*class="[^"]*\bmovieTopic\b[^"]*"[^>]*>(.*?)</label>`)
	releaseRe  = regexp.MustCompile(`(?i)Release Date:\s*(\d{1,2})/(\d{1,2})/(\d{4})`)
	durationRe = regexp.MustCompile(`(?i)Duration:\s*(\d+)\s*mins`)
	categoryRe = regexp.MustCompile(`(?i)Category:\s*(\S+)`)
	languageRe = regexp.MustCompile(`(?i)Language:\s*(.*?)(?:\s+Hyland\s+\(TM\)|\s+\d{1,2}/\d{2}|$)`)
	parenRe    = regexp.MustCompile(`\(([^)]*)\)`)
	liRe       = regexp.MustCompile(`(?is)<li\b[^>]*data-index=['"]([^'"]+)['"][^>]*>(.*?)</li>`)
	imgTagRe   = htmlx.OpeningTagRe("img")
	// One session row: date, time, meridiem, house, price.
	rowRe = regexp.MustCompile(`(\d{1,2})/(\d{1,2}).*?(\d{1,2}):(\d{2})\s*(AM|PM)\s*House\s*([^ ]+)\s*HK\$([\d.]+)`)
)

// Scraper holds the HTTP client so tests can substitute one.
type Scraper struct{ Client *fetch.Client }

// New builds a Scraper with the default client.
func New() *Scraper { return &Scraper{Client: fetch.New()} }

// Scrape fetches both language listings and merges them.
func (s *Scraper) Scrape(ctx context.Context) (*model.Snapshot, error) {
	enBody, err := s.Client.Get(ctx, Base+"/en/movie/nowshowing?view=list")
	if err != nil {
		return nil, fmt.Errorf("fetch en listing: %w", err)
	}
	zhBody, err := s.Client.Get(ctx, Base+"/tc/movie/nowshowing?view=list")
	if err != nil {
		return nil, fmt.Errorf("fetch tc listing: %w", err)
	}
	snap := Parse(string(enBody), string(zhBody), scrapeutil.NowHKT())
	if len(snap.Shows) == 0 {
		return nil, fmt.Errorf("Newport returned no showtimes")
	}
	s.fillSeatAvailability(ctx, snap.Shows)
	return snap, nil
}

// Parse builds the snapshot from both listings. now supplies the year for dates
// that the pages print without one.
func Parse(english, chinese string, now time.Time) *model.Snapshot {
	chineseNames := map[string]string{}
	for _, block := range htmlx.BlocksByClass(scrapeutil.StripScripts(chinese), "whiteDiv", "div") {
		id := ""
		if m := movieIDRe.FindStringSubmatch(block); m != nil {
			id = m[1]
		} else if m := hrefZhRe.FindStringSubmatch(block); m != nil {
			id = m[1]
		}
		if id == "" {
			continue
		}
		chineseNames[id] = htmlx.Text(htmlx.FirstMatch(labelTopic, block))
	}

	var movies []model.Movie
	var shows []model.Show
	seenMovies := map[string]bool{}
	seenShows := map[string]bool{}

	for _, block := range htmlx.BlocksByClass(scrapeutil.StripScripts(english), "whiteDiv", "div") {
		movieID := ""
		if m := movieIDRe.FindStringSubmatch(block); m != nil {
			movieID = m[1]
		} else if m := hrefEnRe.FindStringSubmatch(block); m != nil {
			movieID = m[1]
		}
		if movieID == "" {
			continue
		}
		title := htmlx.Text(htmlx.FirstMatch(labelTopic, block))
		if title == "" {
			title = htmlx.FirstTextByClass(block, "a", "movieTopic")
		}
		if title == "" {
			continue
		}

		info := htmlx.Text(block)
		openingDate := ""
		if m := releaseRe.FindStringSubmatch(info); m != nil {
			day, _ := strconv.Atoi(m[1])
			month, _ := strconv.Atoi(m[2])
			year, _ := strconv.Atoi(m[3])
			openingDate = scrapeutil.DateFromDMY(day, month, year)
		}
		duration := 0
		if m := durationRe.FindStringSubmatch(info); m != nil {
			duration, _ = strconv.Atoi(m[1])
		}
		category := ""
		if m := categoryRe.FindStringSubmatch(info); m != nil {
			category = m[1]
		}
		language := ""
		if m := languageRe.FindStringSubmatch(info); m != nil {
			language = strings.TrimSpace(m[1])
		}
		dialect := ""
		if language != "" {
			dialect = strings.TrimSpace(parenRe.ReplaceAllString(language, ""))
		}
		subtitle := htmlx.FirstMatch(parenRe, language)
		poster := ParsePoster(block, Base)

		status := "showing"
		if openingDate != "" && openingDate > now.Format("2006-01-02") {
			status = "upcoming"
		}

		if !seenMovies[movieID] {
			seenMovies[movieID] = true
			movies = append(movies, model.Movie{
				ID:          "newport-" + movieID,
				NameZh:      chineseNames[movieID],
				NameEn:      title,
				OpeningDate: model.NullablePtr(model.PtrToNullable(scrapeutil.NullableString(openingDate))),
				Duration:    scrapeutil.NullableInt(duration),
				Category:    scrapeutil.NullableString(category),
				Dialect:     scrapeutil.NullableString(dialect),
				Subtitle:    scrapeutil.NullableString(subtitle),
				Genres:      []string{},
				Description: "",
				Poster:      poster,
				DetailURL:   Base + "/en/movie/" + movieID,
				Status:      status,
				Source:      model.SourceNewport,
			})
		}

		for _, m := range liRe.FindAllStringSubmatch(block, -1) {
			sessionID, li := m[1], m[2]
			row := rowRe.FindStringSubmatch(htmlx.Text(li))
			if row == nil || seenShows[sessionID] {
				continue
			}
			seenShows[sessionID] = true

			day, _ := strconv.Atoi(row[1])
			month, _ := strconv.Atoi(row[2])
			date := scrapeutil.DMYDate(day, month, now)
			shows = append(shows, model.Show{
				ID:         "newport-" + sessionID,
				MovieID:    "newport-" + movieID,
				CinemaID:   cinemaID,
				HouseName:  "House " + row[6],
				StartAt:    time12ToHKT(date, row[3], row[4], row[5]),
				Date:       date,
				Price:      scrapeutil.ParsePrice(row[7]),
				Tags:       []string{},
				Category:   model.NullablePtr(model.PtrToNullable(scrapeutil.NullableString(category))),
				Version:    model.Nullable[string]{},
				Language:   model.PtrToNullable(scrapeutil.NullableString(dialect)),
				BookingURL: Base + "/en/ticketing/seatplan/" + sessionID,
				// The key is always present here; the seat pass overwrites it.
				SoldOut: model.BoolPtr(false),
				Source:  model.SourceNewport,
			})
		}
	}

	return &model.Snapshot{
		Movies: movies,
		Shows:  shows,
		Cinemas: []model.Cinema{{
			ID:        cinemaID,
			Code:      "HYLAND",
			NameZh:    "\u51f1\u90fd\u6232\u9662\uff08\u5c6f\u9580\uff09",
			Address:   address,
			MapURL:    scrapeutil.MapSearch("Hyland Theatre", address),
			DetailURL: Base + "/en/cinema/hyland_theatre?page=cinemaSchedule",
			Source:    model.SourceNewport,
		}},
	}
}

// ParsePoster picks the poster image out of a movie block, mirroring
// parseNewportPoster(): the one tagged movieImageImg wins, otherwise the first
// image in the block.
func ParsePoster(block, base string) *string {
	images := imgTagRe.FindAllString(block, -1)
	chosen := ""
	for _, tag := range images {
		if htmlx.HasClassWord(tag, "movieImageImg") {
			chosen = tag
			break
		}
	}
	if chosen == "" && len(images) > 0 {
		chosen = images[0]
	}
	if chosen == "" {
		return nil
	}
	src := htmlx.Attr(chosen, "src")
	if src == "" {
		src = htmlx.Attr(chosen, "data-src")
	}
	if src == "" {
		return nil
	}
	abs := scrapeutil.ResolveURL(base, src)
	return &abs
}

// time12ToHKT converts a 12-hour clock time to the ISO form the site stores,
// mirroring time12ToHkt(). Noon and midnight both map correctly because the
// hour is reduced mod 12 first.
func time12ToHKT(date, hour, minute, meridiem string) string {
	h, _ := strconv.Atoi(hour)
	h = h % 12
	if strings.ToUpper(meridiem) == "PM" {
		h += 12
	}
	return fmt.Sprintf("%sT%02d:%s:00+08:00", date, h, minute)
}
