package chinachem

import (
	"os"
	"testing"
	"time"
)

// These tests run the parser against the real captured page
// (probe/chinachem-home.html) and compare against values produced by the
// ORIGINAL Node implementation (probe/chinachem-reference.mjs).
//
// That pairing is the whole point of the port: the two must agree exactly, or
// the Go scraper will quietly publish a different schedule than the JS one did.
//
// The sample is skipped when absent so the package still builds in a fresh
// checkout; the CI-side probe is what guarantees it exists.
func loadSample(t *testing.T) string {
	t.Helper()
	const p = "../../../probe/chinachem-home.html"
	b, err := os.ReadFile(p)
	if err != nil {
		t.Skipf("sample %s unavailable: %v", p, err)
	}
	return string(b)
}

func TestParseDateTabs(t *testing.T) {
	html := loadSample(t)
	// Fixed clock so the year in the expected values is stable. The page shows
	// only "Oct 09"; the year comes from the current Hong Kong date.
	now := time.Date(2026, 10, 9, 12, 0, 0, 0, hkt)
	tabs := ParseDateTabs(html, now)

	if len(tabs) != 3 {
		t.Fatalf("got %d tabs, want 3: %v", len(tabs), tabs)
	}
	want := map[string]string{
		"01": "2026-10-09",
		"02": "2026-10-10",
		"03": "2026-10-11",
	}
	for k, v := range want {
		if tabs[k] != v {
			t.Errorf("tab %s = %q, want %q", k, tabs[k], v)
		}
	}
}

func TestParsePosters(t *testing.T) {
	html := loadSample(t)
	posters := ParsePosters(html, Base)

	// Reference: probe/chinachem-reference.mjs reports 5 posters.
	if len(posters) != 5 {
		t.Fatalf("got %d posters, want 5: %v", len(posters), posters)
	}
	// Keys are normalised titles; spot-check two with their exact URLs.
	cases := map[string]string{
		"mastermind":         "https://d11i266v7os90q.cloudfront.net/cchem_movie_poster_5214",
		"residentevil":       "https://d11i266v7os90q.cloudfront.net/cchem_movie_poster_5180",
		"thesocialreckoning": "https://d11i266v7os90q.cloudfront.net/cchem_movie_poster_5209",
	}
	for k, v := range cases {
		if posters[k] != v {
			t.Errorf("poster[%s] = %q, want %q", k, posters[k], v)
		}
	}
}

func TestPosterTitleKey(t *testing.T) {
	// The poster list spells one title the mainland way while the schedule uses
	// the Hong Kong spelling; the substitution must bridge them.
	mainland := "\u600e\u9ebd\u53ef\u80fd\u6211\u5bb6\u7684\u7956\u5148\u662f\u4f60\u5bb6\u7684\u9b3c"
	hk := "\u600e\u9ebc\u53ef\u80fd\u6211\u5bb6\u7684\u7956\u5148\u662f\u4f60\u5bb6\u7684\u9b3c"
	if got, want := PosterTitleKey(mainland), PosterTitleKey(hk); got != want {
		t.Errorf("variant spellings must normalise alike: %q vs %q", got, want)
	}
	// Event suffixes are dropped, and non-alphanumerics removed.
	if got := PosterTitleKey("Mastermind (Preview)"); got != "mastermind" {
		t.Errorf("got %q, want mastermind", got)
	}
	// 優先場 keeps its 場: the JS strips a bracketed 優先 but not the longer
	// 優先場 token, and the poster list never uses that form. Asserted as-is
	// so a future cleanup cannot silently change poster matching.
	if got := PosterTitleKey("Mastermind (優先場)"); got != "mastermind優先場" {
		t.Errorf("got %q, want mastermind優先場", got)
	}
	if got := PosterTitleKey("Mastermind (優先)"); got != "mastermind" {
		t.Errorf("got %q, want mastermind", got)
	}
}
