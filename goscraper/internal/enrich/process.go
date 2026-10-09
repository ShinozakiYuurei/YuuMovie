package enrich

import (
	"context"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/douban"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/imdb"
)

// processOne handles one film and returns its row.
//
// The order inside is load-bearing and each step exists because of a bug that
// order already caused:
//
//  1. Douban, then IMDb, because the IMDb reissue fallback reads Douban's year as
//     its evidence.
//  2. The IMDb year gate is applied to a row that ALREADY has an id, before the
//     retry and force-search conditions, because those two read the cleared state.
//     Run afterwards, all three branches would fall through and the row would be
//     counted as reused with nothing done, which is the same trap Douban's stale
//     cleanup hit.
//  3. doubanLearnedLater, so a film whose Douban year arrived after the last IMDb
//     attempt is searched immediately instead of waiting out a cooldown it does
//     not need. Measured on 2026-10-09: thirteen new films matched on Douban while
//     IMDb sat at no score because they had no id, and the card showed 暫無評分
//     until the cooldown expired.
func (r *Runner) processOne(
	ctx context.Context,
	cache *Cache,
	manual map[string]map[string]any,
	item *planItem,
	now time.Time,
	opt Options,
	doubanDone *int,
	byIDFails *int,
	byIDDegraded *bool,
	doubanDegraded *bool,
	result *Result,
) *Entry {
	row := cache.Entries[item.Key]
	if row == nil {
		row = &Entry{}
		cache.Entries[item.Key] = row
	}
	row.Key = item.Key
	row.MovieIDs = item.MovieIDs
	row.NameZh = stringPtr(item.NameZh)
	row.NameEn = stringPtr(item.NameEn)
	row.Year = item.Year

	override := manual[item.Key]
	manualIMDbID := manualID(manual, item.Key)
	if override != nil {
		row.Manual = override
	}
	name := item.NameZh
	if name == "" {
		name = item.NameEn
	}

	// ---------- Douban ----------
	if !opt.NoDouban {
		// Re-probe every 30 films: rate limiting can begin mid-run (measured: fine
		// at 18:33, empty from 18:37), and a probe at the start alone does not catch
		// it, which would write false misses for the second half.
		if !opt.Dry && !*doubanDegraded && !opt.DoubanOnly &&
			*doubanDone > 0 && *doubanDone%probeEvery == 0 {
			found, err := r.douban.Resolve(ctx, probeZh, probeEn, 0, douban.MatchOptions{})
			if err != nil || found == nil {
				*doubanDegraded = true
				r.store.log("  douban interface rate limited partway through; skipping searches and miss writes for the rest of this run")
			}
		}
		*doubanDone++
		r.refreshDouban(ctx, row, item, name, now, opt, byIDFails, byIDDegraded, *doubanDegraded, result)
	}

	// ---------- IMDb ----------
	doubanYear := 0
	if row.Douban != nil {
		doubanYear = row.Douban.Year
	}
	retryDeferred := false

	// A row that already has an id still has to re-run the year gate, audit
	// 2026-10-09. A by-id refresh only reads the score, so it never re-checks
	// whether that id is still this film, and every mismatch attached before the
	// gate existed stays attached forever. Measured: 跟蹤, Hong Kong 2026, still
	// showed IMDb "Following" (2024, a different film, 17 years out) while Douban
	// was already correct.
	//
	// The check is the same as the search side: scored, too far from Douban's
	// year, and not a stage capture.
	//
	// It has to sit BEFORE retryDeferred and forceSearch, because both read the
	// cleared state.
	if row.IMDb != nil && row.IMDb.ID != "" && !row.IMDb.NotFound && row.IMDb.Rating != nil &&
		!imdb.YearGateOk(row.IMDb.Year, doubanYear, true, deref(row.IMDb.Title), imdb.YearGateOptions{
			VenueName: venueName(item),
			HKYear:    item.Year,
		}) {
		r.store.log("  imdb %s: %s 《%s》%d fails the year gate (douban %d), dropping the id and searching again",
			name, row.IMDb.ID, deref(row.IMDb.Title), row.IMDb.Year, doubanYear)
		row.IMDb = nil
	}

	// Douban arrived late: this IMDb attempt happened before the Douban row landed.
	// Douban's year is an INPUT to the reissue fallback, so the attempt was made
	// with half the information and waiting out a cooldown gains nothing. This is a
	// one-shot condition: after the re-search, updatedAt moves past douban.at, and
	// it only holds again once Douban refreshes 14 days later, so it does not knock
	// hourly.
	updatedAt := row.UpdatedAt
	doubanLearnedLater := manualIMDbID == "" &&
		(row.IMDb == nil || row.IMDb.ID == "") &&
		doubanYear != 0 &&
		!row.Douban.At.IsZero() && row.Douban.At.After(updatedAt)

	// A film with no id does not re-run the title search every hour; it keeps the
	// one-week retry window.
	if !doubanLearnedLater && opt.ForceRefresh && manualIMDbID == "" &&
		(row.IMDb == nil || row.IMDb.ID == "") &&
		ageOf(updatedAt, now) <= notFoundTTL {
		retryDeferred = true
	}
	// Under FORCE, a row with no recognised id is either new or past its cooldown,
	// and both mean an actual search.
	forceSearch := opt.ForceRefresh && !opt.DoubanOnly && manualIMDbID == "" &&
		(row.IMDb == nil || row.IMDb.ID == "") && !retryDeferred

	if err := r.refreshIMDb(ctx, row, item, name, opt, doubanYear, manualIMDbID,
		retryDeferred, forceSearch, result); err != nil {
		r.store.log("  imdb %s: %v", name, err)
	}

	// A film without an id that is still inside its one-week retry window keeps its
	// old timestamp, or an hourly run would extend the cooldown forever.
	if !retryDeferred {
		row.UpdatedAt = time.Now().UTC()
	}
	return row
}

// venueName is what the year gate treats as the venue's own listing name.
func venueName(item *planItem) string {
	if item.NameEn != "" {
		return item.NameEn
	}
	return item.NameZh
}

// deref reads a pointer string.
func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// manualID reads the hand-written IMDb id for a key.
func manualID(manual map[string]map[string]any, key string) string {
	entry, ok := manual[key]
	if !ok {
		return ""
	}
	value, _ := entry["imdbId"].(string)
	return value
}
