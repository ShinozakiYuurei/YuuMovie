// Package chinachem scrapes the Chinachem (Paris London New York Milan) circuit.
//
// Ported from scrapeChinachem in scrapers/other-circuits.js. The page is a
// server-rendered schedule with one <div id="day-N" class="time-wrap"> per
// date, each holding movie blocks and, inside them, session-type groups.
//
// Two things are easy to get wrong and are called out where they happen: the
// price is parsed as a float and dropped when NaN, and the seat fill is a
// second HTTP request per show.
package chinachem

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/htmlx"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

// Base is the circuit's site root, matching scrapeChinachem in the JS.
const Base = "https://www.cel-cinemas.com"

// cinemaID is the single venue this circuit operates.
const cinemaID = "chinachem-plnym"

var (
	daySectionRe    = regexp.MustCompile(`(?i)<div id="day-(\d+)"[^>]*class="time-wrap"[^>]*>`)
	dayTabRe        = regexp.MustCompile(`(?is)<a[^>]*href="#day-(\d+)"[^>]*>(.*?)</a>`)
	dayLabelRe      = regexp.MustCompile(`([A-Za-z]{3})\s*(\d{1,2})`)
	h4BodyRe        = htmlx.TagBodyRe("h4")
	imgTagRe        = htmlx.OpeningTagRe("img")
	pBodyRe         = htmlx.TagBodyRe("p")
	anchorOpeningRe = htmlx.OpeningTagRe("a")
	sessionRe       = regexp.MustCompile(`(?i)(<a\b[^>]*class="[^"]*\bsession\b[^"]*"[^>]*>.*?</a>)`)
	typeRe          = regexp.MustCompile(`(?i)^(2D|3D|IMAX|4DX|ScreenX)\b`)
	subtitleRe      = regexp.MustCompile(`\(([^)]*)\)`)
	availRe         = regexp.MustCompile(`"avail":"AV"`)
	availAnyRe      = regexp.MustCompile(`"avail":"`)
)

// Scraper holds the HTTP client so tests can point it at a local server.
type Scraper struct {
	Client *fetch.Client
}

// New builds a Scraper with the default client.
func New() *Scraper { return &Scraper{Client: fetch.New()} }

// Scrape fetches and parses the schedule.
func (s *Scraper) Scrape(ctx context.Context) (*model.Snapshot, error) {
	html, err := s.Client.Get(ctx, Base+"/en/home")
	if err != nil {
		return nil, fmt.Errorf("fetch home: %w", err)
	}
	body := string(html)

	posterByTitle := ParsePosters(body, Base)
	tabs := ParseDateTabs(body, time.Now())
	days := daySectionRe.FindAllStringSubmatchIndex(body, -1)

	type movieAcc struct {
		movie model.Movie
		seen  bool
	}
	movies := map[string]*movieAcc{}
	var movieOrder []string
	var shows []model.Show
	seenShows := map[string]bool{}

	for i, day := range days {
		start, end := day[1], len(body)
		if i+1 < len(days) {
			end = days[i+1][0]
		}
		dayNum := body[day[2]:day[3]]
		date, ok := tabs[dayNum]
		if !ok {
			continue
		}
		section := body[start:end]

		for _, movieBlock := range htmlx.BlocksByClass(section, "each-movie-wrap", "div") {
			title := htmlx.Text(htmlx.FirstMatch(h4BodyRe, movieBlock))
			if title == "" {
				continue
			}
			movieID := "chinachem-" + Digest(strings.ToLower(title))

			imageTag := imgTagRe.FindString(movieBlock)
			imageSrc := ""
			if imageTag != "" {
				imageSrc = htmlx.Attr(imageTag, "src")
				if imageSrc == "" {
					imageSrc = htmlx.Attr(imageTag, "data-src")
				}
			}
			poster := posterByTitle[PosterTitleKey(title)]
			if poster == "" && imageSrc != "" && !strings.Contains(imageSrc, "poster-spacer") {
				poster = htmlx.AbsoluteURL(Base, imageSrc)
			}

			acc, exists := movies[movieID]
			if !exists {
				posterPtr := nullableString(poster)
				acc = &movieAcc{movie: model.Movie{
					ID:          movieID,
					Slug:        "",
					NameZh:      "",
					NameEn:      title,
					Genres:      []string{},
					Description: "",
					Poster:      posterPtr,
					DetailURL:   Base + "/en/home",
					Status:      "showing",
					Source:      model.SourceChinachem,
				}}
				movies[movieID] = acc
				movieOrder = append(movieOrder, movieID)
			} else if acc.movie.Poster == nil && poster != "" {
				acc.movie.Poster = nullableString(poster)
			}

			for _, sessionGroup := range htmlx.BlocksByClass(movieBlock, "session-type", "div") {
				typeText := htmlx.Text(htmlx.FirstMatch(pBodyRe, sessionGroup))
				version := ""
				if m := typeRe.FindString(typeText); m != "" {
					version = m
				}
				dialect := strings.TrimSpace(strings.Split(typeRe.ReplaceAllString(typeText, ""), "(")[0])
				// The JS computes the subtitle and then never uses it. Kept as a named
				// discard so the port stays a line-for-line match and the regexp is still
				// exercised.
				_ = htmlx.FirstMatch(subtitleRe, typeText)

				for _, sm := range sessionRe.FindAllStringSubmatch(sessionGroup, -1) {
					anchor := sm[1]
					openingTag := anchorOpeningRe.FindString(anchor)
					bookingURL := htmlx.AbsoluteURL(Base, htmlx.Attr(openingTag, "href"))
					parts := strings.Split(bookingURL, "/")
					id := parts[len(parts)-1]
					if id == "" || seenShows[id] {
						continue
					}
					seenShows[id] = true

					houseName := htmlx.FirstTextByClass(anchor, "p", "schedule_housename")
					timeText := htmlx.FirstTextByClass(anchor, "p", "time")
					priceText := htmlx.FirstTextByClass(anchor, "p", "price")
					price := parsePrice(priceText)

					shows = append(shows, model.Show{
						ID:         "chinachem-" + id,
						MovieID:    movieID,
						CinemaID:   cinemaID,
						HouseName:  houseName,
						StartAt:    date + "T" + timeText + ":00+08:00",
						Date:       date,
						Price:      price,
						Tags:       []string{},
						Version:    nullableString(version),
						Language:   nullableString(dialect),
						BookingURL: bookingURL,
						Source:     model.SourceChinachem,
					})
				}
			}
		}
	}

	if len(shows) == 0 {
		return nil, fmt.Errorf("Chinachem returned no showtimes")
	}

	s.fillSeatAvailability(ctx, shows)

	out := make([]model.Movie, 0, len(movieOrder))
	for _, id := range movieOrder {
		out = append(out, movies[id].movie)
	}

	return &model.Snapshot{
		Movies: out,
		Shows:  shows,
		Cinemas: []model.Cinema{{
			ID:        cinemaID,
			Code:      "PLNYM",
			NameZh:    "巴黎倫敦紐約米蘭戲院",
			Address:   "Hong Lai Garden, Ho Pong Street, TMTL 280, Tuen Mun, N.T.",
			MapURL:    "https://goo.gl/maps/NvkxDVniiQn",
			DetailURL: Base + "/en/home",
			Source:    model.SourceChinachem,
		}},
	}, nil
}

// ParseDateTabs maps day-N ids to YYYY-MM-DD, mirroring scrapeDateTabs().
//
// The page prints only "Oct 09", so the year comes from the current date in
// Hong Kong. now is a parameter so the mapping is testable without freezing
// the clock globally.
func ParseDateTabs(html string, now time.Time) map[string]string {
	out := map[string]string{}
	year := now.In(hkt).Year()
	for _, m := range dayTabRe.FindAllStringSubmatch(html, -1) {
		parsed := dayLabelRe.FindStringSubmatch(htmlx.Text(m[2]))
		if parsed == nil {
			continue
		}
		month, ok := monthByName[strings.ToLower(parsed[1])]
		if !ok {
			continue
		}
		day, err := strconv.Atoi(parsed[2])
		if err != nil {
			continue
		}
		out[m[1]] = fmt.Sprintf("%04d-%02d-%02d", year, month, day)
	}
	return out
}

// ParsePosters maps a normalised title key to a poster URL, mirroring
// parseChinachemPosters().
func ParsePosters(html, base string) map[string]string {
	out := map[string]string{}
	for _, slide := range htmlx.BlocksByClass(html, "slide", "div") {
		title := htmlx.Text(htmlx.FirstMatch(h4BodyRe, slide))
		imageTag := imgTagRe.FindString(slide)
		src := ""
		if imageTag != "" {
			src = htmlx.Attr(imageTag, "src")
			if src == "" {
				src = htmlx.Attr(imageTag, "data-src")
			}
		}
		key := PosterTitleKey(title)
		if key != "" && src != "" && !strings.Contains(src, "poster-spacer") {
			out[key] = htmlx.AbsoluteURL(base, src)
		}
	}
	return out
}

var (
	hkt = time.FixedZone("HKT", 8*60*60)
	// The poster list spells one title the mainland way while the schedule
	// spells it the Hong Kong way; without this the poster lookup misses.
	posterTitleFixRe = regexp.MustCompile(`怎麽可能我家的祖先是你家的鬼`)
	posterTitleAlt   = `怎麼可能我家的祖先是你家的鬼`
	posterDropRe     = regexp.MustCompile(`(?i)[（(【\[]\s*(?:preview|chi|sp|meet\s*&\s*greet|優先|优先)\s*[)）】\]](?:\s*sp\b)?`)
	posterTailRe     = regexp.MustCompile(`\s*(?:優先|优先)\s*$`)
	posterKeepRe     = regexp.MustCompile(`[^a-z0-9㐀-鿿]`)
)

// PosterTitleKey normalises a title for poster lookup, mirroring
// posterTitleKey() in other-circuits.js.
func PosterTitleKey(title string) string {
	s := strings.ToLower(strings.TrimSpace(title))
	s = posterTitleFixRe.ReplaceAllString(s, posterTitleAlt)
	s = posterDropRe.ReplaceAllString(s, " ")
	s = posterTailRe.ReplaceAllString(s, " ")
	return posterKeepRe.ReplaceAllString(s, "")
}

// Digest is the 14-char sha1 prefix the JS used for generated ids.
func Digest(value string) string {
	sum := sha1.Sum([]byte(value))
	return hex.EncodeToString(sum[:])[:14]
}

func parsePrice(text string) *float64 {
	if text == "" {
		return nil
	}
	f, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return nil
	}
	return &f
}

func nullableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

var monthByName = map[string]int{
	"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
	"jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
