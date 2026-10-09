package enrich

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/douban"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/enrichkey"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/imdb"
)

// Douban health probe, added 2026-10-08
//
// When the interface is rate limited it answers HTTP 200 with an empty cards
// list, which a single response cannot tell apart from "this film genuinely is
// not there". A bulk re-search would write a whole batch as not-found and then
// lock it behind the 7-day cooldown.
//
// So a film that certainly exists is searched first. If the probe finds nothing,
// the whole Douban pass for this run is skipped: nothing is searched and no miss
// is written, and the next run retries naturally once the interface recovers.
const probeZh = "阿凡達"
const probeEn = "Avatar"

// probeEvery is how often the probe repeats DURING a run.
//
// Rate limiting can start partway through: measured, a run at 18:33 was fine and
// from 18:37 the whole stretch returned empty. A probe at the start alone does not
// catch that, and the second half of the run would write false misses.
const probeEvery = 30

// byIDDegradeAt is how many consecutive by-id failures count as the channel being
// rate limited.
const byIDDegradeAt = 5

// ratingPause is the wait after a rating request.
const ratingPauseMin, ratingPauseMax = 180, 420

// doubanPause is the wait after a Douban search.
const doubanPauseMin, doubanPauseMax = 250, 450

// Result is what a run reports back.
type Result struct {
	Planned    int
	Work       int
	Processed  int
	IMDBHits   int
	DoubanHits int
	Reused     int
}

// Runner performs one pass.
type Runner struct {
	store  *store
	imdb   *imdb.Client
	douban *douban.Matcher
	random *rand.Rand
}

// NewRunner builds a Runner.
func NewRunner(root string, opt Options) *Runner {
	opt = opt.Defaults()
	return &Runner{
		store:  openStore(root, opt),
		imdb:   imdb.NewClient(),
		douban: douban.NewMatcher(),
		random: rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// Run does one pass over the plan.
func (r *Runner) Run(ctx context.Context) (Result, error) {
	opt := r.store.opt
	movies, err := r.store.loadMovies()
	if err != nil {
		return Result{}, err
	}
	if len(movies) == 0 {
		return Result{}, fmt.Errorf("no movies in %s, run the scrape first", r.store.moviesFile)
	}

	cache := r.store.loadCache()
	manual := r.store.loadManual()
	plan := buildPlan(movies)

	todo := plan
	if len(opt.Only) > 0 {
		todo = filterOnly(plan, opt.Only)
	}

	now := time.Now()
	work := r.selectWork(todo, cache, manual, now, opt)
	list := work
	if opt.Limit > 0 && len(list) > opt.Limit {
		list = list[:opt.Limit]
	}

	// Douban has to run before IMDb: the reissue fallback reads Douban's year as
	// its evidence, so an IMDb attempt made first would be deciding without half
	// the input. The two live in separate try blocks because Douban being down
	// must not stop IMDb.
	doubanDegraded := false
	if !opt.NoDouban && !opt.Dry {
		found, err := r.douban.Resolve(ctx, probeZh, probeEn, 0, douban.MatchOptions{})
		if err != nil || found == nil {
			doubanDegraded = true
		}
		if doubanDegraded {
			r.store.log("  douban interface looks rate limited (the probe found nothing); skipping searches and miss writes for this run")
		}
	}

	r.store.log("enrichment: %d unique films | %d due | %d this run | %d reused",
		len(plan), len(work), len(list), len(todo)-len(work))

	if opt.Dry {
		for i, item := range list {
			if i >= 40 {
				break
			}
			name := item.NameZh
			if name == "" {
				name = item.NameEn
			}
			r.store.log("  - %s -> key=%q year=%d", name, item.Key, item.Year)
		}
		r.store.log("DRY: no requests sent")
		return Result{Planned: len(plan), Work: len(work)}, nil
	}

	result := Result{Planned: len(plan), Work: len(work)}
	var doubanDone, byIDFails int
	byIDDegraded := false
	start := time.Now()

	for _, item := range list {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		row := r.processOne(ctx, cache, manual, item, now, opt,
			&doubanDone, &byIDFails, &byIDDegraded, &doubanDegraded, &result)
		if err := r.store.save(cache); err != nil {
			return result, err
		}
		result.Processed++
		if result.Processed%25 == 0 {
			per := time.Since(start).Seconds() / float64(result.Processed)
			remaining := (float64(len(list)-result.Processed) * per) / 60
			r.store.log("  ... %d/%d (%.1fs each, about %.1f min left)",
				result.Processed, len(list), per, remaining)
		}
		_ = row
	}

	r.store.log("done: %d films (IMDb new %d, reused %d; douban new %d) in %s",
		result.Processed, result.IMDBHits, result.Reused, result.DoubanHits,
		time.Since(start).Round(time.Second))
	return result, nil
}

// selectWork picks the films this run should touch.
func (r *Runner) selectWork(todo []*planItem, cache *Cache, manual map[string]map[string]any, now time.Time, opt Options) []*planItem {
	if opt.ForceRefresh {
		// A forced refresh covers more than the recognised rows. It also has to
		// cover films with NO record at all, and rows whose only record is a miss
		// that has passed its 7-day cooldown. Each side is judged by its own
		// cooldown so an old miss is not re-searched every hour.
		var out []*planItem
		for _, item := range todo {
			row := cache.Entries[item.Key]
			if row == nil {
				out = append(out, item)
				continue
			}
			if (row.IMDb != nil && row.IMDb.ID != "") ||
				(row.Douban != nil && row.Douban.ID != "") ||
				manualID(manual, item.Key) != "" {
				out = append(out, item)
				continue
			}
			imdbCooled := row.IMDb != nil && row.IMDb.NotFound &&
				ageOf(row.UpdatedAt, now) <= notFoundTTL
			doubanCooled := row.Douban != nil && row.Douban.NotFound &&
				ageOf(row.Douban.At, now) <= notFoundTTL
			if !imdbCooled || !doubanCooled {
				out = append(out, item)
			}
		}
		return out
	}

	if opt.DoubanOnly {
		// IMDb is already fresh, and re-running its searches would cost the 212
		// lookups this switch exists to avoid.
		var out []*planItem
		for _, item := range todo {
			row := cache.Entries[item.Key]
			if row == nil || row.Douban == nil {
				out = append(out, item)
				continue
			}
			ag := ageOf(row.Douban.At, now)
			if row.Douban.NotFound {
				if ag > notFoundTTL {
					out = append(out, item)
				}
				continue
			}
			if ag > int64(opt.DoubanRefreshDays)*day {
				out = append(out, item)
			}
		}
		return out
	}

	var out []*planItem
	for _, item := range todo {
		if needsWork(cache.Entries[item.Key], opt, now) {
			out = append(out, item)
		}
	}
	return out
}

// filterOnly keeps the films whose key contains one of the given strings.
func filterOnly(plan []*planItem, only []string) []*planItem {
	var out []*planItem
	for _, item := range plan {
		for _, needle := range only {
			if strings.Contains(item.Key, enrichkey.Key(needle)) || strings.Contains(item.Key, strings.ToLower(needle)) {
				out = append(out, item)
				break
			}
		}
	}
	return out
}
