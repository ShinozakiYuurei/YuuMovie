package synopsis

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/synopsiskey"
)

// day is a day in milliseconds, the unit both freshness windows use.
const day = int64(86_400_000)

// Options are the environment switches the JavaScript reads.
type Options struct {
	// Limit caps how many films this run touches. Zero means all of them.
	Limit int
	// Only restricts the run to titles containing one of these strings.
	Only []string
	// Dry prints the plan and sends nothing.
	Dry bool
	// ForceRefresh re-checks everything, including rows whose "not found" entry is
	// still inside its window. The scoring pass does not set it, so that job does
	// not knock hourly.
	ForceRefresh bool
	// RefreshDays is how long a found synopsis stays fresh. Synopses barely change,
	// so this is long.
	RefreshDays int
	// NotFoundTTLDays is how long a miss is retried. A new film may only get its
	// synopsis later.
	NotFoundTTLDays int
	// GapMS is the pause between requests. Neither site offers an API, so this is
	// serial with a gap, and they are not treated like a CDN.
	GapMS int
	// Log receives progress lines.
	Log func(string)
}

// Defaults fills in the switches the caller left unset.
func (o Options) Defaults() Options {
	if o.RefreshDays == 0 {
		o.RefreshDays = 30
	}
	if o.NotFoundTTLDays == 0 {
		o.NotFoundTTLDays = 7
	}
	if o.GapMS == 0 {
		o.GapMS = 700
	}
	return o
}

// Movie is the slice of data/movies.json this layer reads.
type Movie struct {
	ID          string `json:"id"`
	NameZh      string `json:"nameZh"`
	NameEn      string `json:"nameEn"`
	Description string `json:"description"`
}

// Record is one cached synopsis.
type Record struct {
	Zh     string    `json:"zh"`
	Source *string   `json:"source"`
	URL    *string   `json:"url"`
	At     time.Time `json:"at"`
}

// Cache is data/synopsis.json.
type Cache struct {
	UpdatedAt time.Time          `json:"updatedAt"`
	Entries   map[string]*Record `json:"entries"`
}

// Need is one film that still needs a synopsis.
type Need struct {
	Key    string
	NameZh string
	NameEn string
}

// FilmsNeedingSynopsis returns the films whose whole group lacks a synopsis.
//
// Grouped by key so a film listed at several venues is looked up once, and the
// whole group is skipped when ANY of its listings already carries text: the group is
// what the page shows, so one venue having it is enough.
func FilmsNeedingSynopsis(movies []Movie) []Need {
	order := []string{}
	byKey := map[string]*Need{}
	hasText := map[string]bool{}
	for _, movie := range movies {
		name := movie.NameZh
		if name == "" {
			name = movie.NameEn
		}
		key := synopsiskey.Key(name)
		if key == "" {
			continue
		}
		if strings.TrimSpace(movie.Description) != "" {
			hasText[key] = true
		}
		need, seen := byKey[key]
		if !seen {
			need = &Need{Key: key, NameZh: movie.NameZh, NameEn: movie.NameEn}
			byKey[key] = need
			order = append(order, key)
		}
		if need.NameZh == "" && movie.NameZh != "" {
			need.NameZh = movie.NameZh
		}
		if need.NameEn == "" && movie.NameEn != "" {
			need.NameEn = movie.NameEn
		}
	}
	var out []Need
	for _, key := range order {
		if !hasText[key] {
			out = append(out, *byKey[key])
		}
	}
	return out
}

// isFresh reports whether a record is inside its window.
func isFresh(record *Record, ttlDays int, now time.Time) bool {
	if record == nil || record.At.IsZero() {
		return false
	}
	age := now.Sub(record.At).Milliseconds()
	return age >= 0 && age < int64(ttlDays)*day
}

// Runner performs one pass.
type Runner struct {
	root    string
	scraper *Scraper
	opt     Options
	cache   *Cache
}

// NewRunner builds a Runner rooted at the project directory.
func NewRunner(root string, opt Options) *Runner {
	return &Runner{root: root, scraper: New(), opt: opt.Defaults()}
}

// CachePath is where the cache lives.
func (r *Runner) CachePath() string { return filepath.Join(r.root, "data", "synopsis.json") }

// MoviesPath is where the listings live.
func (r *Runner) MoviesPath() string { return filepath.Join(r.root, "data", "movies.json") }

// loadCache reads the cache, tolerating a missing or corrupt file.
func (r *Runner) loadCache() *Cache {
	cache := &Cache{Entries: map[string]*Record{}}
	raw, err := os.ReadFile(r.CachePath())
	if err != nil {
		return cache
	}
	if err := json.Unmarshal(raw, cache); err != nil {
		return &Cache{Entries: map[string]*Record{}}
	}
	if cache.Entries == nil {
		cache.Entries = map[string]*Record{}
	}
	return cache
}

// save writes the cache. It runs after every film, so an interrupted run keeps
// what it already fetched.
func (r *Runner) save() error {
	r.cache.UpdatedAt = time.Now().UTC()
	raw, err := json.Marshal(r.cache)
	if err != nil {
		return err
	}
	// Written to a temporary name and renamed, so a run killed mid-write cannot
	// leave a half-written cache behind.
	tmp := r.CachePath() + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, r.CachePath())
}

// log writes a progress line when a logger is set.
func (r *Runner) log(format string, args ...any) {
	if r.opt.Log != nil {
		r.opt.Log(fmt.Sprintf(format, args...))
	}
}

// gap waits between requests.
func (r *Runner) gap(ctx context.Context) {
	timer := time.NewTimer(time.Duration(r.opt.GapMS) * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}

// CacheJSON returns the cache as indented JSON, for a diff against the Node file.
func (r *Runner) CacheJSON() ([]byte, error) {
	raw, err := json.MarshalIndent(r.cache, "", " ")
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}
