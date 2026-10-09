package enrich

import (
	"testing"
	"time"
)

// TestNeedsWorkOrder pins the order of the two short-circuits in needsWork,
// which is the order two bugs were fixed in.
func TestNeedsWorkOrder(t *testing.T) {
	now := time.Now()
	yesterday := now.Add(-24 * time.Hour)

	// A forced full refresh must override the miss cooldown. Checking the miss
	// first would let the 7-day window win and nothing would run at all.
	t.Run("refresh days zero beats the miss cooldown", func(t *testing.T) {
		row := &Entry{
			UpdatedAt: now,
			IMDb:      &IMDb{NotFound: true},
			Douban:    &Douban{NotFound: true, At: now},
		}
		opt := Options{RefreshDays: 0}.Defaults()
		if !needsWork(row, opt, now) {
			t.Error("a forced refresh was blocked by the miss cooldown")
		}
	})

	// A miss is always due, because a miss never counts as fresh.
	//
	// The one-week retry window is NOT here. It lives in processOne's
	// retryDeferred, which is what stops the hourly run from re-searching a miss
	// every hour; needsWork only decides whether the row is a candidate at all.
	// A miss still gets cached, which is why the two halves are separate.
	t.Run("a miss is always due", func(t *testing.T) {
		opt := Options{NoDouban: true}.Defaults()
		fresh := &Entry{UpdatedAt: now, IMDb: &IMDb{NotFound: true}}
		if !needsWork(fresh, opt, now) {
			t.Error("a miss was treated as fresh")
		}
		stale := &Entry{UpdatedAt: now.Add(-8 * 24 * time.Hour), IMDb: &IMDb{NotFound: true}}
		if !needsWork(stale, opt, now) {
			t.Error("a miss past its window was not due")
		}
	})

	// Douban is judged separately, because it is a newer source and older rows
	// have no Douban field at all.
	t.Run("a missing douban half always needs work", func(t *testing.T) {
		opt := Options{}.Defaults()
		row := &Entry{UpdatedAt: now, IMDb: &IMDb{ID: "tt1", Rating: floatPtr(7.5)}}
		if !needsWork(row, opt, now) {
			t.Error("a row that had never been through Douban was skipped")
		}
	})

	// Both halves fresh means nothing to do.
	t.Run("both halves fresh", func(t *testing.T) {
		opt := Options{}.Defaults()
		row := &Entry{
			UpdatedAt: now,
			IMDb:      &IMDb{ID: "tt1", Rating: floatPtr(7.5)},
			Douban:    &Douban{ID: "1", Rating: floatPtr(8.0), At: now},
		}
		if needsWork(row, opt, now) {
			t.Error("a fully fresh row was queued")
		}
	})

	// Douban's window is longer than IMDb's, so an IMDb-only staleness must not
	// queue the row.
	t.Run("douban outlasts imdb", func(t *testing.T) {
		opt := Options{}.Defaults()
		row := &Entry{
			UpdatedAt: yesterday,
			IMDb:      &IMDb{ID: "tt1", Rating: floatPtr(7.5)},
			Douban:    &Douban{ID: "1", Rating: floatPtr(8.0), At: yesterday},
		}
		if needsWork(row, opt, now) {
			t.Error("a row was queued only because IMDb aged past its window")
		}
	})
}

// TestBuildPlanFoldsByKey covers the fold that keeps one lookup per film.
func TestBuildPlanFoldsByKey(t *testing.T) {
	date := "2026-09-17"
	movies := []Movie{
		// Sunbeam publishes no opening date, so it must not win the year.
		{ID: "sunbeam-248", NameZh: "生化危機", NameEn: "RESIDENT EVIL"},
		{ID: "broadway-1286", NameZh: "生化危機", NameEn: "RESIDENT EVIL", OpeningDate: &date},
		{ID: "cgv-842", NameZh: "IMAX 生化危機", NameEn: "IMAX Resident Evil", OpeningDate: &date},
		// A film with no usable name is skipped entirely.
		{ID: "x-1", NameZh: "", NameEn: ""},
	}
	plan := buildPlan(movies)
	if len(plan) != 1 {
		t.Fatalf("plan has %d items, want 1", len(plan))
	}
	item := plan[0]
	if item.Key != "生化危機" {
		t.Errorf("key = %q, want 生化危機", item.Key)
	}
	if item.Year != 2026 {
		t.Errorf("year = %d, want 2026: the dateless listing must not win it", item.Year)
	}
	// Every distinct name is a query, English first because IMDb matches it best.
	// The IMAX-prefixed listing contributes two more: the name differs and
	// nothing is stripped here, because fetchIMDb does that per query afterwards.
	if len(item.Queries) != 4 {
		t.Errorf("queries = %q, want all four distinct names", item.Queries)
	}
	if item.Queries[0] != "RESIDENT EVIL" || item.Queries[1] != "生化危機" {
		t.Errorf("queries = %q, want English first", item.Queries)
	}
}

// TestYearOf covers the date reading.
func TestYearOf(t *testing.T) {
	if got := yearOf(nil); got != 0 {
		t.Errorf("yearOf(nil) = %d, want 0", got)
	}
	date := "2026-09-17"
	if got := yearOf(&date); got != 2026 {
		t.Errorf("yearOf = %d, want 2026", got)
	}
	bad := "unknown"
	if got := yearOf(&bad); got != 0 {
		t.Errorf("yearOf = %d, want 0", got)
	}
}

// TestExpandQueries covers the three forms per name.
func TestExpandQueries(t *testing.T) {
	got := expandQueries([]string{"M (GFF)"})
	if len(got) != 2 {
		t.Fatalf("queries = %q, want the name and its bracket-free form", got)
	}
	if got[0] != "M (GFF)" || got[1] != "M" {
		t.Errorf("queries = %q", got)
	}

	// A brand is stripped as well, since Broadway writes those into the title.
	// The bracket-free form is the same string here, so it is not repeated.
	branded := expandQueries([]string{"IMAX Avengers Endgame"})
	if len(branded) != 2 {
		t.Fatalf("queries = %q, want two distinct forms", branded)
	}
	if branded[1] != "Avengers Endgame" {
		t.Errorf("brand-stripped = %q, want Avengers Endgame", branded[1])
	}
}

// TestCountEntries pins the totals the cache file publishes.
func TestCountEntries(t *testing.T) {
	entries := map[string]*Entry{
		"a": {IMDb: &IMDb{ID: "tt1", Rating: floatPtr(7.5)}, Douban: &Douban{ID: "1", Rating: floatPtr(8.0)}},
		"b": {IMDb: &IMDb{NotFound: true}, Douban: &Douban{NotFound: true}},
		"c": {IMDb: &IMDb{ID: "tt2"}},
	}
	counts := countEntries(entries, 2)
	if counts.Entries != 3 {
		t.Errorf("entries = %d, want 3", counts.Entries)
	}
	if counts.WithRating != 1 {
		t.Errorf("withRating = %d, want 1", counts.WithRating)
	}
	if counts.NotFound != 1 {
		t.Errorf("notFound = %d, want 1", counts.NotFound)
	}
	if counts.DoubanRating != 1 {
		t.Errorf("doubanRating = %d, want 1", counts.DoubanRating)
	}
	// c has no Douban half and b's is a miss, so both count as missing.
	if counts.DoubanMissing != 2 {
		t.Errorf("doubanMissing = %d, want 2", counts.DoubanMissing)
	}
	if counts.Manual != 2 {
		t.Errorf("manual = %d, want 2", counts.Manual)
	}
}

// floatPtr returns a pointer to a rating.
func floatPtr(v float64) *float64 { return &v }
