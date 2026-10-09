// Package enrich ports scrapers/enrich.js: the IMDb and Douban score layer.
//
// The circuits do not publish outside ratings, so this runs separately and
// caches into data/enrich.json.
//
// Why the scores live in their own file rather than in movies.json: movies.json is
// rewritten wholesale every two to six hours by the scrape, so scores written into
// it would be wiped, and outside-source fields do not belong in the "raw venue
// data" layer anyway. Separate files mean either side can be re-run or rolled back
// without touching the other.
//
//	chain: title -> v3.sg.media-imdb.com/suggestion -> tt id -> agregarr ratings
//
// Throttling: queries run one film at a time, and Douban requests are spaced
// 250ms or more apart during a forced refresh. Interrupt safety: the cache is
// written after every film.
package enrich

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/douban"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/enrichkey"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/imdb"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// Day is a day in milliseconds, the unit every freshness window is expressed in.
const day = int64(86_400_000)

// Options are the environment switches the Node script reads.
type Options struct {
	// Limit caps how many films this run touches. Zero means all of them.
	Limit int
	// Only restricts the run to titles containing one of these strings.
	Only []string
	// Dry prints the plan and sends nothing.
	Dry bool
	// ForceRefresh ignores cache freshness and refreshes scores.
	ForceRefresh bool
	// RefreshDays is how long an IMDb result stays fresh.
	RefreshDays int
	// DoubanRefreshDays is how long a Douban result stays fresh. It is longer
	// because the scores move slowly.
	DoubanRefreshDays int
	// NoDouban turns Douban off.
	NoDouban bool
	// DoubanOnly refreshes Douban and leaves IMDb alone.
	DoubanOnly bool
	// Log receives progress lines.
	Log func(string)
}

// Defaults fills in the switches the caller left unset.
func (o Options) Defaults() Options {
	if o.RefreshDays == 0 {
		o.RefreshDays = 3
	}
	if o.DoubanRefreshDays == 0 {
		o.DoubanRefreshDays = 14
	}
	return o
}

// notFoundTTL is the shorter retry window for a film that genuinely has no entry.
//
// A miss still has to be cached, or a genuinely absent title would be searched
// twice on every run. It gets a shorter window because a new film may be
// registered shortly afterwards.
const notFoundTTL = 7 * day

// IMDb is the IMDb half of one film's record.
type IMDb struct {
	ID           string   `json:"imdbId"`
	URL          *string  `json:"imdbUrl"`
	Title        *string  `json:"imdbTitle"`
	Year         int      `json:"imdbYear"`
	Rating       *float64 `json:"rating"`
	Votes        *int     `json:"votes"`
	NotFound     bool     `json:"notFound,omitempty"`
	QueriedWith  string   `json:"queriedWith,omitempty"`
	RelaxedYear  bool     `json:"relaxedYear,omitempty"`
	FallbackFrom string   `json:"fallbackFrom,omitempty"`
	Candidates   []string `json:"candidates,omitempty"`
	// ReissueEvidence records that the fallback was allowed by evidence, which is
	// the case worth auditing.
	ReissueEvidence bool `json:"reissueEvidence,omitempty"`
}

// Douban is the Douban half of one film's record.
type Douban struct {
	ID           string   `json:"doubanId,omitempty"`
	URL          string   `json:"doubanUrl,omitempty"`
	Title        *string  `json:"doubanTitle,omitempty"`
	Year         int      `json:"doubanYear,omitempty"`
	Rating       *float64 `json:"rating"`
	RatingState  string   `json:"ratingState,omitempty"`
	Country      *string  `json:"country,omitempty"`
	Genres       []string `json:"genres,omitempty"`
	Director     *string  `json:"director,omitempty"`
	Cast         *string  `json:"cast,omitempty"`
	NotFound     bool     `json:"notFound,omitempty"`
	QueriedWith  string   `json:"queriedWith,omitempty"`
	Alternatives []string `json:"alternatives,omitempty"`
	// At is when this was last refreshed. It lives on the Douban half because
	// Douban's refresh window is longer than IMDb's.
	At time.Time `json:"at,omitempty"`
}

// Entry is one film's cached scores.
type Entry struct {
	Key      string   `json:"key"`
	MovieIDs []string `json:"movieIds"`
	NameZh   *string  `json:"nameZh"`
	NameEn   *string  `json:"nameEn"`
	Year     int      `json:"year"`
	// UpdatedAt is the row-level timestamp. It lives at the top level rather than
	// inside the IMDb half because that half has no such field.
	UpdatedAt time.Time      `json:"updatedAt,omitempty"`
	IMDb      *IMDb          `json:"imdb,omitempty"`
	Douban    *Douban        `json:"douban,omitempty"`
	Manual    map[string]any `json:"manual,omitempty"`
}

// Counts are the totals written into the cache file.
type Counts struct {
	Entries       int `json:"entries"`
	WithRating    int `json:"withRating"`
	NotFound      int `json:"notFound"`
	DoubanRating  int `json:"doubanRating"`
	DoubanMissing int `json:"doubanMissing"`
	Manual        int `json:"manual"`
}

// Cache is data/enrich.json.
type Cache struct {
	Version   int               `json:"version"`
	UpdatedAt time.Time         `json:"updatedAt"`
	Entries   map[string]*Entry `json:"entries"`
	Counts    Counts            `json:"counts,omitempty"`
}

// Movie is the slice of data/movies.json this layer reads.
type Movie struct {
	ID          string  `json:"id"`
	NameZh      string  `json:"nameZh"`
	NameEn      string  `json:"nameEn"`
	OpeningDate *string `json:"openingDate"`
}

// store reads and writes the cache.
type store struct {
	cacheFile  string
	manualFile string
	moviesFile string
	opt        Options
}

// openStore resolves the paths relative to root.
func openStore(root string, opt Options) *store {
	data := filepath.Join(root, "data")
	return &store{
		cacheFile:  filepath.Join(data, "enrich.json"),
		manualFile: filepath.Join(data, "enrich-manual.json"),
		moviesFile: filepath.Join(data, "movies.json"),
		opt:        opt.Defaults(),
	}
}

// log writes a progress line when a logger is set.
func (s *store) log(format string, args ...any) {
	if s.opt.Log != nil {
		s.opt.Log(fmt.Sprintf(format, args...))
	}
}

// loadCache reads the cache, tolerating a missing or corrupt file.
func (s *store) loadCache() *Cache {
	cache := &Cache{Version: 2, Entries: map[string]*Entry{}}
	raw, err := os.ReadFile(s.cacheFile)
	if err != nil {
		return cache
	}
	if err := json.Unmarshal(raw, cache); err != nil {
		return &Cache{Version: 2, Entries: map[string]*Entry{}}
	}
	if cache.Entries == nil {
		cache.Entries = map[string]*Entry{}
	}
	return cache
}

// loadManual reads the hand-written overrides.
func (s *store) loadManual() map[string]map[string]any {
	out := map[string]map[string]any{}
	raw, err := os.ReadFile(s.manualFile)
	if err != nil {
		return out
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]map[string]any{}
	}
	return out
}

// loadMovies reads data/movies.json.
func (s *store) loadMovies() ([]Movie, error) {
	raw, err := os.ReadFile(s.moviesFile)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", s.moviesFile, err)
	}
	var movies []Movie
	if err := json.Unmarshal(raw, &movies); err != nil {
		return nil, fmt.Errorf("parse %s: %w", s.moviesFile, err)
	}
	return movies, nil
}

// save writes the cache after every film, so an interrupted run keeps its work.
func (s *store) save(cache *Cache) error {
	cache.UpdatedAt = time.Now().UTC()
	cache.Counts = countEntries(cache.Entries, len(s.loadManual()))
	raw, err := json.MarshalIndent(cache, "", " ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.cacheFile, append(raw, '\n'), 0o644)
}

// countEntries recomputes the totals the cache file publishes.
func countEntries(entries map[string]*Entry, manualCount int) Counts {
	counts := Counts{Entries: len(entries), Manual: manualCount}
	for _, entry := range entries {
		if entry.IMDb != nil {
			if entry.IMDb.Rating != nil {
				counts.WithRating++
			}
			if entry.IMDb.NotFound {
				counts.NotFound++
			}
		}
		if entry.Douban == nil {
			counts.DoubanMissing++
		} else {
			if entry.Douban.Rating != nil {
				counts.DoubanRating++
			}
			if entry.Douban.NotFound {
				counts.DoubanMissing++
			}
		}
	}
	return counts
}

// yearOf reads the release year off an opening date.
func yearOf(value *string) int {
	if value == nil {
		return 0
	}
	match := yearRe.FindStringSubmatch(*value)
	if match == nil {
		return 0
	}
	year, _ := strconv.Atoi(match[1])
	return year
}

// yearRe takes the leading four digits of a date.
var yearRe = regexp.MustCompile("^([0-9]{4})")

// planItem is one film to look up, after the circuit listings have been folded
// together by key.
type planItem struct {
	Key    string
	NameZh string
	NameEn string
	Year   int
	// Queries are the names to search, best first. The English name leads because
	// IMDb matches it best, with the Chinese name as support.
	Queries  []string
	MovieIDs []string
}

// buildPlan folds the circuit listings by enrichment key.
//
// The same film appears once per circuit, and the scores only need looking up
// once. The first listing sets the year and names; later ones fill any gap.
func buildPlan(movies []Movie) []*planItem {
	order := []string{}
	byKey := map[string]*planItem{}
	for _, movie := range movies {
		key := enrichkey.Key(movie.NameZh)
		if key == "" {
			key = enrichkey.Key(movie.NameEn)
		}
		if key == "" {
			continue
		}
		year := yearOf(movie.OpeningDate)
		item, seen := byKey[key]
		if !seen {
			item = &planItem{Key: key, NameZh: movie.NameZh, NameEn: movie.NameEn, Year: year}
			for _, name := range []string{movie.NameEn, movie.NameZh} {
				if name != "" {
					item.Queries = append(item.Queries, name)
				}
			}
			byKey[key] = item
			order = append(order, key)
			continue
		}
		item.MovieIDs = append(item.MovieIDs, movie.ID)
		if item.Year == 0 && year != 0 {
			item.Year = year
		}
		if item.NameZh == "" {
			item.NameZh = movie.NameZh
		}
		if item.NameEn == "" {
			item.NameEn = movie.NameEn
		}
		for _, name := range []string{movie.NameEn, movie.NameZh} {
			if name != "" && !containsString(item.Queries, name) {
				item.Queries = append(item.Queries, name)
			}
		}
	}
	out := make([]*planItem, 0, len(order))
	for _, key := range order {
		out = append(out, byKey[key])
	}
	return out
}

// containsString reports whether the list holds the value.
func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// needsWork reports whether a cached entry has to be refreshed.
//
// A miss is cached too, but with the shorter retry window, and Douban is judged
// separately: it is a newer source, so older cache rows have no Douban field at
// all, and skipping it because IMDb is fresh would leave those rows without a
// score forever.
func needsWork(row *Entry, opt Options, now time.Time) bool {
	if row == nil {
		return true
	}
	// The full-refresh switch is checked FIRST. The miss short-circuit has to come
	// after it, or forcing a refresh would be overridden by the 7-day retry
	// window and nothing would run at all.
	if opt.RefreshDays == 0 {
		return true
	}
	age := ageOf(row.UpdatedAt, now)
	fresh := row.IMDb != nil && !row.IMDb.NotFound && age <= int64(opt.RefreshDays)*day
	if opt.NoDouban {
		return !fresh
	}
	if row.Douban == nil {
		return true
	}
	doubanAge := ageOf(row.Douban.At, now)
	doubanFresh := doubanAge <= int64(opt.DoubanRefreshDays)*day
	if row.Douban.NotFound {
		return !(fresh && doubanAge <= notFoundTTL)
	}
	return !(fresh && doubanFresh)
}

// ageOf returns how long ago t was, in milliseconds.
func ageOf(t, now time.Time) int64 {
	if t.IsZero() {
		return 1 << 62
	}
	return now.Sub(t).Milliseconds()
}

// stringPtr returns a pointer to a string, or nil when it is empty.
func stringPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// nowHKT is exposed so the caller's logs agree with the scrapers.
func nowHKT() time.Time { return scrapeutil.NowHKT() }

// unexported keeps the douban and imdb imports honest where the plan is built
// without them.
var _ = douban.IsMovieSubjectURL
var _ = imdb.URL
var _ = strings.TrimSpace
