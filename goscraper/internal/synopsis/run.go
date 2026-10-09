package synopsis

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/synopsiskey"
)

// Source names, as they are written into the cache.
const (
	sourceWmoov    = "wmoov"
	sourceKinohk   = "kinohk"
	sourceHkmovie6 = "hkmovie6"
)

// Index URLs. wmoov and hkmovie6 are behind Cloudflare and need the egress proxy;
// kinohk does not and its robots.txt explicitly welcomes crawlers.
var (
	wmoovIndexURLs    = []string{"https://wmoov.com/movie/showing", "https://wmoov.com/movie/upcoming"}
	hkmovie6IndexURLs = []string{"https://hkmovie6.com/"}
	kinohkIndexURLs   = []string{"https://kinohk.com/movies/now-showing", "https://kinohk.com/coming"}
)

// wmoovBase and kinohkBase build the detail URLs.
const (
	wmoovBase    = "https://wmoov.com/movie/details/"
	kinohkBase   = "https://kinohk.com"
	hkmovie6Base = "https://hkmovie6.com"
)

// hit is one successful lookup.
type hit struct {
	Zh        string
	Source    string
	URL       string
	Canonical string
}

// Result reports what a run did.
type Result struct {
	Planned   int
	Processed int
	Found     int
}

// Run does one pass.
func (r *Runner) Run(ctx context.Context) (Result, error) {
	movies, err := r.loadMovies()
	if err != nil {
		return Result{}, err
	}
	if len(movies) == 0 {
		return Result{}, fmt.Errorf("no movies in %s, run the scrape first", r.MoviesPath())
	}

	r.cache = r.loadCache()
	now := time.Now()

	need := FilmsNeedingSynopsis(movies)
	if len(r.opt.Only) > 0 {
		need = filterOnly(need, r.opt.Only)
	}
	need = r.filterFresh(need, now)
	if r.opt.Limit > 0 && len(need) > r.opt.Limit {
		need = need[:r.opt.Limit]
	}

	labels := make([]string, 0, len(need))
	for _, item := range need {
		labels = append(labels, label(item))
	}
	r.log("films needing a synopsis: %d%s", len(need), suffixIf(labels))
	if r.opt.Dry || len(need) == 0 {
		return Result{Planned: len(need)}, nil
	}

	// The three indexes are built once and reused for every film, which is what
	// makes the serial gap affordable: the pages are fetched three times in total,
	// not once per film.
	wmoov := r.buildWmoovIndex(ctx)
	hkmovie6 := r.buildHkmovie6Index(ctx)
	kinohk := r.buildKinohkIndex(ctx)

	result := Result{Planned: len(need)}
	for _, item := range need {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		found, err := r.lookup(ctx, item, wmoov, kinohk, hkmovie6)
		if err != nil {
			// A failed lookup is written as a miss, exactly as the JavaScript does.
			// The TTL is what keeps that from being permanent: the next run retries.
			r.log("  ! %s: %v", label(item), err)
		}
		if found != nil {
			record := &Record{Zh: found.Zh, Source: &found.Source, URL: &found.URL, At: time.Now().UTC()}
			r.cache.Entries[item.Key] = record
			// Also filed under the source site's own title. The venue's entry may read
			// "CGS...Infinity Vision" while another venue reads the plain title, and
			// the group-level lookup has to find the same text under the plain key.
			if found.Canonical != "" && found.Canonical != item.Key {
				r.cache.Entries[found.Canonical] = record
			}
			result.Found++
			r.log("  ok %s <- %s (%d chars)", label(item), found.Source, len([]rune(found.Zh)))
		} else {
			r.cache.Entries[item.Key] = &Record{At: time.Now().UTC()}
			r.log("  -- %s: no source had it", label(item))
		}
		if err := r.save(); err != nil {
			return result, err
		}
		result.Processed++
	}

	r.log("filled %d/%d, cache %s", result.Found, len(need), r.CachePath())
	return result, nil
}

// lookup tries the three sources in the order the user chose on 2026-10-04:
// wmoov's distributor copy first, then kinohk, then hkmovie6.
func (r *Runner) lookup(ctx context.Context, item Need, wmoov map[string][]WmoovEntry, kinohk map[string][]KinohkEntry, hkmovie6 map[string][]Hkmovie6Entry) (*hit, error) {
	if found := r.fromWmoov(ctx, item, wmoov); found != nil {
		return found, nil
	}
	if found := r.fromKinohk(ctx, item, kinohk); found != nil {
		return found, nil
	}
	return r.fromHkmovie6(ctx, item, hkmovie6), nil
}

// fromWmoov looks a film up on wmoov, the distributor's own copy.
func (r *Runner) fromWmoov(ctx context.Context, item Need, index map[string][]WmoovEntry) *hit {
	for _, candidate := range matchWmoov(index, item.Key) {
		url := wmoovBase + candidate.ID
		html, err := r.scraper.getText(ctx, url)
		if err != nil {
			r.gap(ctx)
			continue
		}
		names := ParseWmoovNames(html)
		if !TitleAgrees(item.NameEn, names.En) {
			// The names disagree, so this is another film under the same name. The
			// gate exists because wmoov lists reruns and remakes side by side.
			r.log("    skip %s: the English name does not match (%s)", url, names.En)
			r.gap(ctx)
			continue
		}
		zh := UsableSynopsis(ParseWmoovSynopsis(html))
		r.gap(ctx)
		if zh != "" {
			return &hit{Zh: zh, Source: sourceWmoov, URL: url, Canonical: synopsiskey.Key(candidate.Title)}
		}
	}
	return nil
}

// fromKinohk looks a film up on kinohk.
//
// The English-name gate runs BEFORE the page is fetched, because the index already
// carries the name and there is no reason to spend a request on a film that is
// already known to be the wrong one.
func (r *Runner) fromKinohk(ctx context.Context, item Need, index map[string][]KinohkEntry) *hit {
	for _, candidate := range matchKinohk(index, item.Key) {
		if !TitleAgrees(item.NameEn, candidate.En) {
			continue
		}
		url := kinohkBase + candidate.Slug
		html, err := r.scraper.getText(ctx, url)
		if err != nil {
			r.gap(ctx)
			continue
		}
		zh := UsableSynopsis(ParseKinohkSynopsis(html))
		r.gap(ctx)
		if zh != "" {
			return &hit{Zh: zh, Source: sourceKinohk, URL: url, Canonical: synopsiskey.Key(candidate.Title)}
		}
	}
	return nil
}

// fromHkmovie6 looks a film up on hkmovie6.
func (r *Runner) fromHkmovie6(ctx context.Context, item Need, index map[string][]Hkmovie6Entry) *hit {
	for _, candidate := range matchHkmovie6(index, item.Key) {
		url := hkmovie6Base + candidate.Slug
		html, err := r.scraper.getText(ctx, url)
		if err != nil {
			r.gap(ctx)
			continue
		}
		zh := UsableSynopsis(ParseHkmovie6Synopsis(html))
		r.gap(ctx)
		if zh != "" {
			return &hit{Zh: zh, Source: sourceHkmovie6, URL: url, Canonical: synopsiskey.Key(candidate.Title)}
		}
	}
	return nil
}

// buildWmoovIndex reads both wmoov listing pages.
func (r *Runner) buildWmoovIndex(ctx context.Context) map[string][]WmoovEntry {
	out := map[string][]WmoovEntry{}
	for _, url := range wmoovIndexURLs {
		html, err := r.scraper.getText(ctx, url)
		if err != nil {
			r.log("  ! wmoov index %s failed: %v", url, err)
			r.gap(ctx)
			continue
		}
		mergeWmoov(out, ParseWmoovIndex(html))
		r.gap(ctx)
	}
	r.log("  wmoov index: %d films", len(out))
	return out
}

// buildKinohkIndex reads both kinohk listing pages.
func (r *Runner) buildKinohkIndex(ctx context.Context) map[string][]KinohkEntry {
	out := map[string][]KinohkEntry{}
	for _, url := range kinohkIndexURLs {
		html, err := r.scraper.getText(ctx, url)
		if err != nil {
			r.log("  ! kinohk index %s failed: %v", url, err)
			r.gap(ctx)
			continue
		}
		mergeKinohk(out, ParseKinohkIndex(html))
		r.gap(ctx)
	}
	r.log("  kinohk index: %d films", len(out))
	return out
}

// buildHkmovie6Index reads the hkmovie6 home page.
func (r *Runner) buildHkmovie6Index(ctx context.Context) map[string][]Hkmovie6Entry {
	out := map[string][]Hkmovie6Entry{}
	for _, url := range hkmovie6IndexURLs {
		html, err := r.scraper.getText(ctx, url)
		if err != nil {
			r.log("  ! hkmovie6 index %s failed: %v", url, err)
			r.gap(ctx)
			continue
		}
		mergeHkmovie6(out, ParseHkmovie6Index(html))
		r.gap(ctx)
	}
	r.log("  hkmovie6 index: %d films", len(out))
	return out
}

// loadMovies reads the listings, accepting both the array and the object form.
func (r *Runner) loadMovies() ([]Movie, error) {
	raw, err := os.ReadFile(r.MoviesPath())
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", r.MoviesPath(), err)
	}
	// movies.json has been written both as a bare array and as an object holding
	// one, so both are accepted.
	var wrapper struct {
		Movies []Movie `json:"movies"`
	}
	if err := json.Unmarshal(raw, &wrapper); err == nil && wrapper.Movies != nil {
		return wrapper.Movies, nil
	}
	var movies []Movie
	if err := json.Unmarshal(raw, &movies); err != nil {
		return nil, fmt.Errorf("parse %s: %w", r.MoviesPath(), err)
	}
	return movies, nil
}

// filterFresh drops the films that are already inside their window.
//
// The two windows differ: a found synopsis is kept for RefreshDays because synopses
// barely change, while a miss is retried after NotFoundTTLDays because a new film
// may only get its text later.
func (r *Runner) filterFresh(need []Need, now time.Time) []Need {
	var out []Need
	for _, item := range need {
		if r.opt.ForceRefresh {
			out = append(out, item)
			continue
		}
		record := r.cache.Entries[item.Key]
		if record != nil && record.Zh != "" {
			if isFresh(record, r.opt.RefreshDays, now) {
				continue
			}
		} else if isFresh(record, r.opt.NotFoundTTLDays, now) {
			continue
		}
		out = append(out, item)
	}
	return out
}

// filterOnly keeps the films whose name contains one of the given strings.
func filterOnly(need []Need, only []string) []Need {
	var out []Need
	for _, item := range need {
		for _, needle := range only {
			if strings.Contains(item.NameZh, needle) || strings.Contains(item.NameEn, needle) {
				out = append(out, item)
				break
			}
		}
	}
	return out
}

// label is the film's display name.
func label(item Need) string {
	if item.NameZh != "" {
		return item.NameZh
	}
	return item.NameEn
}

// suffixIf renders a list, or an empty string when there is none.
func suffixIf(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return ": " + strings.Join(values, "、")
}

// mergeWmoov folds one page's entries into the accumulated index.
func mergeWmoov(into, from map[string][]WmoovEntry) {
	index := &Index{Wmoov: into}
	index.MergeWmoov(from)
}

// mergeKinohk folds one page's entries into the accumulated index.
func mergeKinohk(into, from map[string][]KinohkEntry) {
	index := &Index{Kinohk: into}
	index.MergeKinohk(from)
}

// mergeHkmovie6 folds one page's entries into the accumulated index.
func mergeHkmovie6(into, from map[string][]Hkmovie6Entry) {
	index := &Index{Hkmovie6: into}
	index.MergeHkmovie6(from)
}
