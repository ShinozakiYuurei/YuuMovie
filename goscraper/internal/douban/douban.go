// Package douban ports the Douban side of the ratings layer.
//
// Ported from scrapers/douban-suggest.js, and it works for the same reason it
// worked there: the JSON endpoints under www.douban.com/j/ do not sit behind the
// proof-of-work challenge that movie.douban.com's HTML pages are behind.
//
// # Why the earlier HTML scrape could not work and this one does
//
// The previous attempt ran into sec.douban.com's SHA-512 proof of work: subject
// pages bounce straight back to a challenge, and the same function passed in a
// probe and failed in the pipeline, with no root cause found. But this family of
// JSON endpoints does NOT carry that shield (measured: HTTP 200, ~300ms, 60 calls
// with no rate limiting), and search_suggest's card_subtitle carries exactly the
// fields the page needed: rating, year, region, genre, director and cast.
//
//	endpoint: https://www.douban.com/j/search_suggest?q=X&tag=movie
//	returns:  { cards: [{ title, url, year, card_subtitle, cover_url, type }] }
//
// # Compliance, explicitly approved by the user on 2026-09-19
//
// www.douban.com/robots.txt disallows /j/, and this endpoint is under that path.
// The user's judgement is that robots.txt constrains search-engine crawlers, that
// the risk is accepted, and that it should be wired in. Three things are done to
// keep the load down because of it: only the increment is queried per run, requests
// are spaced at least 250ms apart, and results are cached for 30 days by default.
// Nothing here is concurrent.
package douban

import (
	"bytes"
	"context"
	"encoding/json"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
)

// suggestRoot is the search endpoint.
const suggestRoot = "https://www.douban.com/j/search_suggest"

// rexxarRoot is the mobile subject endpoint, addressed by id rather than title.
const rexxarRoot = "https://m.douban.com/rexxar/api/v2/movie/"

// searchAgent is the desktop browser agent the search endpoint expects.
const searchAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// mobileAgent is the iOS agent the rexxar endpoint expects.
const mobileAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
	"(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

// movieSubjectPrefix identifies a film entry by URL.
//
// search_suggest is a site-wide search, so the same string can return a book
// (book.douban.com) or a music entry (music.douban.com). Both are wrong in a film
// context, and both were measured: 天鵝湖 came back as a 9.5-rated music album and
// 巴黎聖母院 as a 9.0-rated novel, so the page would show a score whose link
// could only fall back to a search page. Two places disagreeing is the bug.
const movieSubjectPrefix = "https://movie.douban.com/subject/"

// digitsRe checks that the part after the prefix is an id.
var digitsRe = regexp.MustCompile(`^[0-9]+`)

// IsMovieSubjectURL reports whether a URL points at a film entry.
func IsMovieSubjectURL(value string) bool {
	return value != "" &&
		strings.HasPrefix(value, movieSubjectPrefix) &&
		digitsRe.MatchString(value[len(movieSubjectPrefix):])
}

// Card is one search result.
type Card struct {
	Title string
	Year  string
	Sub   string
	ID    string
	URL   string
}

// Subject is what the by-id endpoint returns.
type Subject struct {
	Rating *float64
	Count  int
	Title  string
	Year   string
}

// client talks to both endpoints.
type client struct {
	hc *fetch.Client
}

// newClient builds a client with the per-endpoint agents. Both are set per
// request rather than on the client, because the two endpoints reject each
// other's agent.
func newClient() *client {
	return &client{hc: fetch.New(fetch.WithRetries(1))}
}

// subjectIDRe pulls the numeric id out of a subject URL.
var subjectIDRe = regexp.MustCompile(`/subject/(\d+)`)

// queryRe strips the query string off a subject URL.
var queryRe = regexp.MustCompile(`\?.*$`)

// Suggest returns the film entries for one query.
//
// A nil result with a nil error means the request FAILED, which is not the same
// as an empty result, and the difference is load-bearing: an empty result is a
// real answer and gets cached as not-found, while a failure must NOT be cached or
// the 7-day retry window is spent on a timeout.
func (c *client) Suggest(ctx context.Context, query string) ([]Card, error) {
	if query == "" {
		return []Card{}, nil
	}
	raw := suggestRoot + "?q=" + url.QueryEscape(query) + "&tag=movie"
	body, err := c.hc.GetWithHeaders(ctx, raw, map[string]string{
		"User-Agent": searchAgent,
		"Referer":    "https://www.douban.com/",
		"Accept":     "application/json",
	})
	if err != nil {
		return nil, err
	}
	var payload struct {
		Cards []struct {
			Title        string `json:"title"`
			URL          string `json:"url"`
			Year         string `json:"year"`
			CardSubtitle string `json:"card_subtitle"`
		} `json:"cards"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(body), &payload); err != nil {
		return nil, err
	}
	var out []Card
	for _, row := range payload.Cards {
		if row.Title == "" {
			continue
		}
		clean := queryRe.ReplaceAllString(row.URL, "")
		if !IsMovieSubjectURL(clean) {
			continue
		}
		card := Card{
			Title: strings.TrimSpace(row.Title),
			Sub:   strings.TrimSpace(row.CardSubtitle),
			URL:   clean,
		}
		if row.Year != "" {
			card.Year = strings.TrimSpace(row.Year)
		}
		if match := subjectIDRe.FindStringSubmatch(row.URL); match != nil {
			card.ID = match[1]
		}
		out = append(out, card)
	}
	return out, nil
}

// SubjectByID reads one entry's score by id.
//
// Why this channel exists separately (2026-10-08): the web search and the mobile
// rexxar endpoint are TWO INDEPENDENT rate-limit buckets, and measurement showed
// the search can be limited while rexxar still works, and the reverse. An entry
// that already has an id never needs its title searched again, and doing a full
// re-search every hour is the root of the rate limiting. Reading by id takes the
// search volume for "over a hundred identified entries" down to zero.
//
// robots: m.douban.com/robots.txt disallows only notification_chart and market;
// this endpoint is not on the list, unlike the /j/ path on www.
//
// A nil result means the request failed or was limited, and the caller must not
// write that to the cache.
func (c *client) SubjectByID(ctx context.Context, id string) (*Subject, error) {
	if id == "" {
		return nil, nil
	}
	raw := rexxarRoot + url.PathEscape(id)
	body, err := c.hc.GetWithHeaders(ctx, raw, map[string]string{
		"User-Agent": mobileAgent,
		"Referer":    "https://m.douban.com/",
		"Accept":     "application/json",
	})
	if err != nil {
		return nil, err
	}
	var payload struct {
		Code   any    `json:"code"`
		Msg    string `json:"msg"`
		Title  string `json:"title"`
		Year   string `json:"year"`
		Rating *struct {
			Value *float64 `json:"value"`
			Count *int     `json:"count"`
		} `json:"rating"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(body), &payload); err != nil {
		return nil, err
	}
	// A limited or signed-out reply carries code plus msg (subject_ip_rate_limit /
	// need_login) and no title.
	if payload.Code != nil || payload.Title == "" {
		return nil, nil
	}
	out := &Subject{Title: payload.Title, Year: payload.Year}
	if payload.Rating != nil {
		if payload.Rating.Count != nil {
			out.Count = *payload.Rating.Count
		}
		// An unreleased entry comes back as rating 0 / count 0, and writing that
		// would display a 0.0 score.
		if payload.Rating.Value != nil && *payload.Rating.Value > 0 && out.Count > 0 {
			value := *payload.Rating.Value
			out.Rating = &value
		}
	}
	return out, nil
}

// Parsed is what a card yields.
type Parsed struct {
	// These three are pointers because the cache file writes them as JSON null
	// when the card carried no value, and a plain string would write "" instead,
	// which reads back as a different record.
	DoubanID    *string
	DoubanURL   *string
	DoubanTitle *string
	DoubanYear  int
	Rating      *float64
	// RatingState is "rated", "pending" (present but not yet scored) or
	// "unreleased". The last two have to be told apart: one means the film exists
	// with no score, the other that a score should not exist yet.
	RatingState string
	Country     *string
	Genres      []string
	Director    *string
	Cast        *string
}

// ratingRe matches the leading score segment.
var ratingRe = regexp.MustCompile(`^([0-9.]+)分$`)

// yearRe matches a bare four-digit year.
var yearRe = regexp.MustCompile(`^[0-9]{4}$`)

// ParseCard reads a card's subtitle.
//
// The shape is "8.3分 / 2023 / 中国大陆 / 科幻 冒险 灾难 / 郭帆 / 吴京 刘德华",
// with the first segment being 暂无评分 when the film has no score yet and
// 尚未上映 when it has not been released. The segment count varies because some
// cards carry no director or cast, so they are taken by position and loosely.
func ParseCard(card Card) Parsed {
	parts := splitSlash(card.Sub)
	out := Parsed{
		DoubanID:    orNilEmpty(card.ID),
		DoubanURL:   orNilEmpty(card.URL),
		DoubanTitle: orNilEmpty(card.Title),
		Genres:      []string{},
	}
	if card.Year != "" {
		if year, err := strconv.Atoi(card.Year); err == nil && year != 0 {
			out.DoubanYear = year
		}
	}

	i := 0
	// at returns the segment at an index, or empty when the card is shorter than
	// expected. The JavaScript reads parts[i] off the end and gets undefined,
	// which its tests treat as falsy; here a missing segment has to be an empty
	// string for the same reason.
	at := func(index int) string {
		if index < 0 || index >= len(parts) {
			return ""
		}
		return parts[index]
	}
	if match := ratingRe.FindStringSubmatch(at(0)); match != nil {
		if value, err := strconv.ParseFloat(match[1], 64); err == nil {
			out.Rating = &value
		}
		out.RatingState = "rated"
		i = 1
	} else if at(0) == "暂无评分" {
		out.RatingState = "pending"
		i = 1
	} else if at(0) == "尚未上映" {
		out.RatingState = "unreleased"
		i = 1
	}

	// The card's own year field wins; the subtitle year is the fallback for when
	// the field is absent.
	if yearRe.MatchString(at(i)) {
		if out.DoubanYear == 0 {
			if year, err := strconv.Atoi(at(i)); err == nil {
				out.DoubanYear = year
			}
		}
		i++
	}
	if at(i) != "" && out.Country == nil {
		country := at(i)
		out.Country = &country
		i++
	}
	if at(i) != "" && len(out.Genres) == 0 {
		out.Genres = strings.Fields(at(i))
		i++
	}
	if at(i) != "" && out.Director == nil {
		director := at(i)
		out.Director = &director
		i++
	}
	if at(i) != "" && out.Cast == nil {
		cast := at(i)
		out.Cast = &cast
	}
	return out
}

// splitSlash splits on "/", trimming and dropping empty segments.
func splitSlash(value string) []string {
	var out []string
	for _, part := range strings.Split(value, "/") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// orNilEmpty turns an empty string into nil.
func orNilEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
