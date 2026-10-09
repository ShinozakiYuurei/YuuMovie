package mcl

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"sync"
	"time"
)

// detailTTL is how long a complete detail record stays fresh.
const detailTTL = 24 * time.Hour

// incompleteDetailTTL is much shorter: a record missing the rating, runtime,
// credits or plot is retried next run, because those fields often arrive later.
const incompleteDetailTTL = 2 * time.Hour

// detailBudget caps the time spent on detail lookups so the endpoint can never
// hold up the schedule scrape, which is the part users actually see.
const detailBudget = 30 * time.Second

// detailConcurrency is deliberately low: the endpoint is the slowest and least
// tolerant call in this circuit.
const detailConcurrency = 3

// detailTimeout bounds a single detail request.
const detailTimeout = 8 * time.Second

// cacheEntry is one cached detail, keyed by the numeric film id.
type cacheEntry struct {
	At  string            `json:"at"`
	Raw []json.RawMessage `json:"raw"`
}

// movieDetails fetches official metadata for each film.
//
// Results are cached on disk between runs, keyed by id, and re-validated on
// every read: the endpoint reuses ids, so a cached record is only trusted when
// it still matches the id AND the title the listing currently shows.
func (s *Scraper) movieDetails(ctx context.Context, targets []mclTarget) map[string]*detail {
	cachePath := detailCachePath()
	cache := readCache(cachePath)
	result := make(map[string]*detail, len(targets))

	var (
		mu       sync.Mutex
		changed  bool
		next     int
		deadline = time.Now().Add(detailBudget)
	)

	worker := func() {
		for {
			mu.Lock()
			if next >= len(targets) {
				mu.Unlock()
				return
			}
			t := targets[next]
			next++
			mu.Unlock()

			key := strconv.Itoa(t.ID)
			saved, hasSaved := cache[key]

			// Without a listing title there is nothing to verify a cached record
			// against, so it has to be re-fetched rather than trusted.
			old := (*detail)(nil)
			if hasSaved && t.Name != "" {
				old = parseDetail(saved.Raw, t.ID, t.Name)
			}

			ttl := incompleteDetailTTL
			if old != nil && old.Duration != nil && old.Category != nil &&
				old.Director != nil && old.Cast != nil && old.Description != "" {
				ttl = detailTTL
			}

			if old != nil && os.Getenv("MCL_DETAILS_FORCE_REFRESH") != "1" {
				if parsed, err := time.Parse(time.RFC3339, saved.At); err == nil &&
					time.Since(parsed) < ttl {
					mu.Lock()
					result[key] = old
					mu.Unlock()
					continue
				}
			}

			if time.Now().After(deadline) {
				// Out of budget: keep whatever was cached rather than dropping it.
				if old != nil {
					mu.Lock()
					result[key] = old
					mu.Unlock()
				}
				continue
			}

			requestCtx, cancel := context.WithTimeout(ctx, detailTimeout)
			var raw []json.RawMessage
			err := s.getDetail(requestCtx,
				fmt.Sprintf("GetMovieDetails.aspx?l=%s&t=s&id=%s&r=beim", lang, key), &raw)
			cancel()

			if err == nil {
				if d := parseDetail(raw, t.ID, t.Name); d != nil {
					mu.Lock()
					result[key] = d
					cache[key] = cacheEntry{
						At:  time.Now().Format(time.RFC3339),
						Raw: trimDetail(raw[0]),
					}
					changed = true
					mu.Unlock()
					continue
				}
				err = fmt.Errorf("ID 或片名与列表不符")
			}

			// A missing detail must not lose the film: the schedule alone still
			// gives it a title, a poster and its screenings.
			if old != nil {
				mu.Lock()
				result[key] = old
				mu.Unlock()
			}
		}
	}

	// A fixed pool. The semaphore is acquired INSIDE the goroutine: filling a
	// buffered channel before starting the workers blocks forever, because
	// nothing is running yet to drain it.
	sem := make(chan struct{}, detailConcurrency)
	var wg sync.WaitGroup
	for i := 0; i < detailConcurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			worker()
		}()
	}
	wg.Wait()

	if changed {
		writeCache(cachePath, cache)
	}
	return result
}
