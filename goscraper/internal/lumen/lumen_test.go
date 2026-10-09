package lumen

import (
	"os"
	"testing"
)

func loadSamples(t *testing.T) (string, string) {
	t.Helper()
	now, err := os.ReadFile("../../../probe/lumen-NowShowing.html")
	if err != nil {
		t.Skipf("fixture unavailable: %v", err)
	}
	soon, err := os.ReadFile("../../../probe/lumen-ComingSoon.html")
	if err != nil {
		t.Skipf("fixture unavailable: %v", err)
	}
	return string(now), string(soon)
}

// TestListParsing checks that the detail links the scraper depends on are
// present in both captured listings.
func TestListParsing(t *testing.T) {
	now, soon := loadSamples(t)
	for _, tc := range []struct{ name, html string }{{"NowShowing", now}, {"ComingSoon", soon}} {
		matches := detailHrefRe.FindAllStringSubmatch(tc.html, -1)
		if len(matches) == 0 {
			t.Errorf("%s: no detail links found", tc.name)
		}
		// Every link must resolve to an absolute URL on the circuit's host, or
		// the detail fetch would go somewhere else entirely.
		for _, m := range matches {
			if m[1] == "" {
				t.Errorf("%s: empty detail href", tc.name)
			}
		}
	}
}

// TestParsePoster pins the CDN URL shape; the site links to it directly, so a
// change here means broken posters across the whole circuit.
func TestParsePoster(t *testing.T) {
	p := ParsePoster("f-1234")
	if p == nil {
		t.Fatal("nil poster for a valid id")
	}
	want := Base + "/CDN/media/entity/get/FilmPosterGraphic/f-1234" +
		"?width=800&height=1200&referenceScheme=Global&allowPlaceHolder=true"
	if *p != want {
		t.Errorf("poster = %q, want %q", *p, want)
	}
	// The f- prefix is optional in the input.
	if q := ParsePoster("1234"); q == nil || *q != want {
		t.Errorf("bare id should resolve to the same URL")
	}
	if q := ParsePoster(""); q != nil {
		t.Errorf("empty id should give nil, got %v", *q)
	}
}

// TestParseBlurb pins the "Introduction :" stripping. Returning the bare label
// would make a film with no synopsis look like it has one, which stops the
// group-level fallback from choosing another source's text.
func TestParseBlurb(t *testing.T) {
	cases := []struct{ in, want string }{
		{`<p class="boxout-blurb">Introduction :<br /><br />A suspect vanishes.</p>`, "A suspect vanishes."},
		{`<p class="boxout-blurb">Introduction :</p>`, ""},
		{`<p class="boxout-blurb">Just prose.</p>`, "Just prose."},
	}
	for _, tc := range cases {
		if got := ParseBlurb(tc.in); got != tc.want {
			t.Errorf("ParseBlurb(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestStripFilmPrefix covers the case-insensitive f- removal that feeds the
// movie id, so the ids stay stable no matter how the page spells the prefix.
func TestStripFilmPrefix(t *testing.T) {
	cases := map[string]string{"f-123": "123", "F-123": "123", "123": "123", "fx-1": "fx-1"}
	for in, want := range cases {
		if got := stripFilmPrefix(in); got != want {
			t.Errorf("stripFilmPrefix(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestNormalizeDateTime pins the two shapes the page emits: a bare local time
// that just needs the offset appended, and an absolute instant that has to be
// converted into Hong Kong wall-clock time.
func TestNormalizeDateTime(t *testing.T) {
	if got := normalizeDateTime("2026-10-09T19:30"); got != "2026-10-09T19:30+08:00" {
		t.Errorf("local time = %q", got)
	}
	// 11:30Z is 19:30 in Hong Kong.
	if got := normalizeDateTime("2026-10-09T11:30:00Z"); got != "2026-10-09T19:30:00+08:00" {
		t.Errorf("UTC instant = %q", got)
	}
	if got := normalizeDateTime("2026-10-09T11:30:00+00:00"); got != "2026-10-09T19:30:00+08:00" {
		t.Errorf("offset instant = %q", got)
	}
}
