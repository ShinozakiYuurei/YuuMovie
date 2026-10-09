// Package runner drives a full scrape: one circuit at a time, each saved to its
// own snapshot, then merged into the four data files the site reads.
//
// Ported from scrape.js. The behaviour that matters, and why, is in each
// function's comment; in short:
//
//   - A circuit that fails keeps its previous snapshot for up to 24 hours. Going
//     staler would show screenings that already started.
//   - icirena returning films but no screenings counts as a failure, not an empty
//     schedule: it once wiped three circuits' timetables because the API silently
//     answered with an empty array.
//   - Circuits not visited this run are merged in from their snapshots. The deploy
//     splits the scrape into a light and a heavy pass, and without this the second
//     pass would erase the first one's results.
//   - An empty result refuses to write. Better to keep the last good data than to
//     publish a blank site.
package runner

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

// staleAfter is how long a snapshot may stand in for a failed circuit.
const staleAfter = 24 * time.Hour

// Options configures a run.
type Options struct {
	// DataDir holds movies.json, shows.json, cinemas.json and meta.json, with
	// snapshots under sources/ inside it.
	DataDir string
	// Only limits the run to these circuits; empty means all of them.
	Only []string
	// MaxMovies caps how many films each circuit walks, for debugging.
	MaxMovies int
	// SkipSchedule skips the per-film schedule pass on the circuits that have
	// one, for a fast partial refresh.
	SkipSchedule bool
	// Concurrency bounds the Broadway detail pass.
	Concurrency int
	// Log receives one line per milestone.
	Log func(string)
}

// circuit is one scrapeable source.
type circuit struct {
	// Name is the snapshot key and the id prefix.
	Name string
	// Label is what the log prints.
	Label string
	// Scrape returns the circuit data.
	Scrape func(ctx context.Context, opts Options) (*model.Snapshot, error)
	// NeedsSchedule marks the circuits whose per-film schedule pass can be
	// skipped. Those are the icirena ones, where the pass is a film-by-date
	// matrix and by far the most expensive part.
	NeedsSchedule bool
}

// snapshot is what gets written to sources/<name>.json.
type snapshot struct {
	Movies  []model.Movie  `json:"movies"`
	Shows   []model.Show   `json:"shows"`
	Cinemas []model.Cinema `json:"cinemas"`
	SavedAt string         `json:"savedAt"`
}

// Run performs a full scrape and writes the output files.
//
// It returns the metadata it wrote so a caller can report on it without reading
// the file back.
func Run(ctx context.Context, opts Options) (*model.Meta, error) {
	started := time.Now()
	log := opts.Log
	if log == nil {
		log = func(string) {}
	}

	outDir := opts.DataDir
	srcDir := filepath.Join(outDir, "sources")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		return nil, fmt.Errorf("create %s: %w", srcDir, err)
	}

	var errors []model.SourceError
	sources := map[string]*snapshot{}

	// Order matters: it decides which circuit's copy of a duplicated id wins,
	// and the Node run had the same order, so the two produce the same merged set.
	for _, c := range circuits() {
		if !opts.wants(c.Name) {
			continue
		}
		log("▶ " + c.Label + " ...")
		snap, err := c.Scrape(ctx, opts)
		if err != nil {
			log("  ⚠️ 失敗: " + err.Error())
			errors = append(errors, model.SourceError{Source: c.Name, Error: err.Error()})
			if fallback := loadSnapshot(srcDir, c.Name, staleAfter); fallback != nil {
				sources[c.Name] = fallback
				log("  ↩ 沿用上次快照（" + fallback.SavedAt + "）")
			}
			continue
		}

		// Films with no screenings means an incomplete answer, not an empty
		// schedule. Treating it as success is what once cleared three circuits'
		// timetables when the icirena API answered bizCode 0 with nothing in it.
		if c.NeedsSchedule && len(snap.Shows) == 0 && len(snap.Movies) > 0 {
			log("  ⚠️ 場次為 0，視為不完整")
			errors = append(errors, model.SourceError{Source: c.Name, Error: "schedules empty (partial)"})
			if fallback := loadSnapshot(srcDir, c.Name, staleAfter); fallback != nil && len(fallback.Shows) > 0 {
				sources[c.Name] = fallback
				log("  ↩ 沿用上次快照（" + fallback.SavedAt + "），避免排片被清空")
				continue
			}
		}

		sources[c.Name] = toSnapshot(snap, time.Now())
		if err := saveSnapshot(srcDir, c.Name, sources[c.Name]); err != nil {
			log("  ⚠️ 保存 " + c.Name + " 快照失败: " + err.Error())
		}
		log(fmt.Sprintf("  影片 %d | 影院 %d | 場次 %d",
			len(snap.Movies), len(snap.Cinemas), len(snap.Shows)))
	}

	// Merge in the circuits this run did not visit. The deploy splits the scrape
	// into two passes, so without this the second pass would drop the first one's
	// results and the circuit count would oscillate between runs.
	for _, name := range model.KnownSources {
		key := string(name)
		if sources[key] != nil {
			continue
		}
		snap := loadSnapshot(srcDir, key, staleAfter)
		if snap == nil {
			continue
		}
		if len(snap.Shows) > 0 || len(snap.Cinemas) > 0 {
			sources[key] = snap
			log("  ＋ 并入快照 " + key + "（" + snap.SavedAt + "）")
		}
	}

	result := collect(sources)
	log(fmt.Sprintf("\n▶ 合併：影片 %d | 影院 %d | 場次 %d",
		len(result.Movies), len(result.Cinemas), len(result.Shows)))

	if errors == nil {
		// The Node runner started from an empty array, so meta.json carries []
		// rather than null on a clean run, and lib/data.ts reads it directly.
		errors = []model.SourceError{}
	}

	meta := &model.Meta{
		// Millisecond precision, as new Date().toISOString() writes it.
		LastUpdated: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		Sources:     sortedNames(sources),
		Counts: model.MetaCounts{
			Movies:   len(result.Movies),
			Showing:  countStatus(result.Movies, "showing"),
			Upcoming: countStatus(result.Movies, "upcoming"),
			Cinemas:  len(result.Cinemas),
			Shows:    len(result.Shows),
		},
		Errors:     errors,
		DurationMs: time.Since(started).Milliseconds(),
	}

	// Refuse to publish an empty site.
	if len(result.Movies) == 0 || len(result.Shows) == 0 {
		return nil, fmt.Errorf("抓取結果為空，拒絕寫入（保留上次資料）")
	}

	meta.Integrity = checkIntegrity(result)
	if meta.Integrity.OrphanShows > 0 {
		log(fmt.Sprintf("  ⚠️ 懸空場次 %d 條", meta.Integrity.OrphanShows))
		errors = append(errors, model.SourceError{
			Source: "merge",
			Error:  fmt.Sprintf("orphan shows: %d", meta.Integrity.OrphanShows),
		})
		meta.Errors = errors
	}
	if meta.Integrity.ShowsWithoutBookingURL > 0 {
		log(fmt.Sprintf("  ⚠️ 缺購票連結 %d 條", meta.Integrity.ShowsWithoutBookingURL))
	}

	if err := writeOutput(outDir, result, meta); err != nil {
		return nil, err
	}

	log(fmt.Sprintf("\n✅ 完成，耗時 %.1fs", time.Since(started).Seconds()))
	return meta, nil
}
