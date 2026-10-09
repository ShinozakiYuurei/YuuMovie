package enrich

import (
	"context"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/douban"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/imdb"
)

// refreshDouban updates one film's Douban half.
//
// Three things here are not obvious:
//
//   - An entry that already has an id is refreshed BY ID and never re-searched.
//     By-id goes through the mobile rexxar bucket, so it keeps working while the
//     web search is limited, and it takes the hourly search volume from "every
//     entry" down to "only the ones with no match".
//   - An entry that already has an id never falls back to the search branch. When
//     the by-id channel is degraded the old data is kept rather than re-searched,
//     because that re-search is exactly what causes the rate limiting.
//   - A probe failure blocks the SEARCH branch only. The probe uses the web
//     endpoint, by-id uses rexxar, and they are separate buckets: measured, the web
//     endpoint being limited often left rexxar working.
func (r *Runner) refreshDouban(
	ctx context.Context,
	row *Entry,
	item *planItem,
	name string,
	now time.Time,
	opt Options,
	byIDFails *int,
	byIDDegraded *bool,
	searchBlocked bool,
	result *Result,
) {
	doubanAge := ageOf(doubanAt(row), now)
	doubanFresh := row.Douban != nil && !row.Douban.NotFound && doubanAge <= int64(opt.DoubanRefreshDays)*day
	doubanRetry := row.Douban != nil && row.Douban.NotFound && doubanAge <= notFoundTTL

	// A cached entry can already be invalid, and refreshing it by id cannot save
	// that: two kinds of dirt exist.
	//
	//   1. Not a film entry at all (book, music). The rexxar movie endpoint returns
	//      nothing for such an id, so a by-id miss only records one failure, and the
	//      dirty row stays forever, eventually tripping the 5-failure limit and
	//      degrading the by-id channel for every other entry. Measured on 2026-10-09:
	//      three such entries (坂本日常, 次第花開, the chiikawa event) all returned
	//      nothing against rexxar.
	//   2. A same-source name whose year does not agree. These look completely normal
	//      on the movie endpoint and refreshing by id cannot help either: the id is
	//      valid, it is just the wrong film. Only searching again can find the right
	//      one, and that is what the same-source-name year gate does. Queen Budapest
	//      in Hong Kong in 2026 was carrying 《匈牙利狂想曲》 from 1986, which is one.
	//
	// The cleanup runs AFTER doubanFresh and doubanRetry are computed, so those
	// flags still describe the OLD row. The old row is usually fresh and not a miss,
	// so reusing them would skip the search branch and the row would be cleaned but
	// never re-searched: measured on 2026-10-09, queen budapest kept its 1986 entry
	// across two forced runs for exactly that reason.
	staleDouban := false
	if row.Douban != nil && row.Douban.ID != "" {
		notAFilm := !douban.IsMovieSubjectURL(row.Douban.URL)
		sameSource := douban.SameSourceTitle(item.NameZh, item.NameEn)
		wrongYear := sameSource && !douban.CrossYearOk(row.Douban.Year, row.Douban.Year, item.Year)
		if notAFilm || wrongYear {
			row.Douban = nil
			staleDouban = true
			r.store.log("  douban %s: the cached entry is no longer valid, searching again", name)
		}
	}

	if opt.ForceRefresh && row.Douban != nil && row.Douban.ID != "" && !*byIDDegraded {
		subject, err := r.douban.SubjectByID(ctx, row.Douban.ID)
		if err == nil && subject != nil {
			*byIDFails = 0
			// Only overwrite when a score came back. A null keeps the known value
			// rather than risking zeroing a score on one odd response.
			if subject.Rating != nil {
				row.Douban.Rating = subject.Rating
				row.Douban.RatingState = "rated"
				result.DoubanHits++
			}
			row.Douban.At = time.Now().UTC()
		} else if err != nil {
			r.store.log("  douban %s: by-id refresh failed", name)
		} else {
			*byIDFails++
			if *byIDFails >= byIDDegradeAt {
				*byIDDegraded = true
				r.store.log("  douban by-id refresh failed %d times in a row (looks rate limited); skipping by-id refresh for the rest of this run",
					*byIDFails)
			}
		}
		r.pause(doubanPauseMin, doubanPauseMax)
		return
	}

	// An entry with no id is searched, and the volume is small and protected by the
	// probe.
	shouldSearch := !searchBlocked &&
		((opt.ForceRefresh && (row.Douban == nil || row.Douban.ID == "") && !doubanRetry) ||
			(!opt.ForceRefresh && (staleDouban || (!doubanFresh && !doubanRetry)) &&
				(row.Douban == nil || row.Douban.ID == "")))
	if !shouldSearch {
		return
	}

	previous := row.Douban
	found, err := r.douban.Resolve(ctx, item.NameZh, item.NameEn, item.Year, douban.MatchOptions{})
	defer r.pause(doubanPauseMin, doubanPauseMax)
	if err != nil {
		r.store.log("  douban %s: %v", name, err)
		return
	}
	if found != nil {
		parsed := douban.ParseCard(found.Card)
		row.Douban = &Douban{
			ID:           deref(parsed.DoubanID),
			URL:          deref(parsed.DoubanURL),
			Title:        parsed.DoubanTitle,
			Year:         parsed.DoubanYear,
			Rating:       parsed.Rating,
			RatingState:  parsed.RatingState,
			Country:      parsed.Country,
			Genres:       parsed.Genres,
			Director:     parsed.Director,
			Cast:         parsed.Cast,
			QueriedWith:  found.Query,
			Alternatives: found.Alternatives,
			At:           time.Now().UTC(),
		}
		// The same entry occasionally comes back with no score. A known score is
		// kept rather than cleared by one odd response.
		if parsed.Rating == nil && previous != nil && previous.ID == deref(parsed.DoubanID) && previous.Rating != nil {
			row.Douban.Rating = previous.Rating
			row.Douban.RatingState = "rated"
		}
		if parsed.Rating != nil {
			result.DoubanHits++
		}
		return
	}
	if row.Douban == nil || row.Douban.NotFound || !douban.IsMovieSubjectURL(row.Douban.URL) {
		row.Douban = &Douban{NotFound: true, At: time.Now().UTC()}
	}
}

// refreshIMDb updates one film's IMDb half.
func (r *Runner) refreshIMDb(
	ctx context.Context,
	row *Entry,
	item *planItem,
	name string,
	opt Options,
	doubanYear int,
	manualIMDbID string,
	retryDeferred bool,
	forceSearch bool,
	result *Result,
) error {
	// IMDb is judged on its own freshness too. needsWork lets a row through
	// because Douban has not run yet, and IMDb is usually fresh at that point, so
	// without this check every run would redo 212 searches.
	updatedAt := row.UpdatedAt
	imdbFresh := retryDeferred ||
		(!opt.ForceRefresh &&
			(opt.DoubanOnly ||
				(opt.RefreshDays != 0 && row.IMDb != nil &&
					(row.IMDb.NotFound && ageOf(updatedAt, time.Now()) <= notFoundTTL ||
						!row.IMDb.NotFound && ageOf(updatedAt, time.Now()) <= int64(opt.RefreshDays)*day))))

	switch {
	case manualIMDbID != "" && !opt.DoubanOnly:
		// A hand-written id is taken as given: title matching sometimes lands on
		// an unrelated short or television film, and data/enrich-manual.json is
		// where a human overrides it.
		refreshed, err := r.fetchImdbByID(ctx, manualIMDbID, row.IMDb)
		if err != nil {
			return err
		}
		sameID := row.IMDb != nil && row.IMDb.ID == manualIMDbID
		row.IMDb = mergeManual(row.IMDb, refreshed, sameID)
		if row.IMDb.Rating != nil {
			result.IMDBHits++
		}
		return nil

	case opt.ForceRefresh && row.IMDb != nil && row.IMDb.ID != "" && !row.IMDb.NotFound && !opt.DoubanOnly:
		refreshed, err := r.fetchImdbByID(ctx, row.IMDb.ID, row.IMDb)
		if err != nil {
			return err
		}
		row.IMDb = mergeRefreshed(row.IMDb, refreshed)
		// A by-id refresh needs the year gate too, the second round of the
		// 2026-10-09 audit. The stale check above only drops the id when there is
		// NO score, which leaves a state where the id survives and the score was
		// blocked; the next forced run reads the score by id and puts the wrong
		// number back. Measured: that is how 跟蹤's 6.5 came back to life.
		// If the refreshed score still conflicts with Douban's year it is not
		// stored. The id is kept, since the detail page link still uses it.
		if row.IMDb.Rating != nil &&
			!imdb.YearGateOk(row.IMDb.Year, doubanYear, true, deref(row.IMDb.Title), imdb.YearGateOptions{
				VenueName: venueName(item),
				HKYear:    item.Year,
			}) {
			r.store.log("  imdb %s: %s 《%s》%d still fails the year gate (douban %d), not storing the score",
				name, row.IMDb.ID, deref(row.IMDb.Title), row.IMDb.Year, doubanYear)
			row.IMDb.Rating = nil
			row.IMDb.Votes = nil
		}
		if refreshed.Rating != nil {
			result.IMDBHits++
		}
		return nil

	case forceSearch || (!opt.ForceRefresh && !opt.DoubanOnly && !imdbFresh):
		hit, err := r.fetchIMDb(ctx, item, doubanYear)
		if err != nil {
			// A failed search is not written as a miss: it would spend the 7-day
			// window on a network blip.
			return err
		}
		if hit == nil {
			row.IMDb = &IMDb{NotFound: true}
			return nil
		}
		row.IMDb = hit
		if hit.Rating != nil {
			result.IMDBHits++
		}
		return nil
	}

	result.Reused++
	return nil
}

// mergeManual combines a by-id refresh with a manual override.
func mergeManual(previous *IMDb, refreshed IMDb, sameID bool) *IMDb {
	out := &IMDb{}
	if previous != nil {
		*out = *previous
	}
	out.ID = refreshed.ID
	if out.URL == nil {
		out.URL = refreshed.URL
	}
	if refreshed.Rating != nil {
		out.Rating = refreshed.Rating
	} else if !sameID || out.Rating == nil {
		out.Rating = nil
	}
	if out.Rating != nil {
		out.Votes = refreshed.Votes
	} else if !sameID {
		out.Votes = nil
	}
	if refreshed.QueriedWith != "" {
		out.QueriedWith = refreshed.QueriedWith
	} else {
		out.QueriedWith = "manual"
	}
	return out
}

// mergeRefreshed combines a by-id refresh with the existing row.
func mergeRefreshed(previous *IMDb, refreshed IMDb) *IMDb {
	out := &IMDb{}
	*out = *previous
	if refreshed.Rating != nil {
		out.Rating = refreshed.Rating
		out.Votes = refreshed.Votes
	}
	if refreshed.QueriedWith != "" {
		out.QueriedWith = refreshed.QueriedWith
	}
	return out
}

// doubanAt reads the Douban refresh timestamp, or zero.
func doubanAt(row *Entry) time.Time {
	if row.Douban == nil {
		return time.Time{}
	}
	return row.Douban.At
}

// pause waits a randomised interval, which is the throttling.
func (r *Runner) pause(minMS, maxMS int) {
	span := maxMS - minMS
	if span < 1 {
		span = 1
	}
	time.Sleep(time.Duration(minMS+r.random.Intn(span)) * time.Millisecond)
}
