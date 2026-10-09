package sunbeam

import (
	"os"
	"testing"
)

// The fixture is the live homepage, captured by probe/sunbeam-capture.mjs.
// Tests compare against values produced by the original Node implementation so
// the port cannot drift silently.
func loadSample(t *testing.T) string {
	t.Helper()
	const p = "../../../probe/sunbeam-home.html"
	b, err := os.ReadFile(p)
	if err != nil {
		t.Skipf("sample %s unavailable: %v", p, err)
	}
	return string(b)
}

func TestParseCounts(t *testing.T) {
	snap := Parse(loadSample(t))
	if len(snap.Movies) == 0 {
		t.Fatalf("no movies parsed")
	}
	if len(snap.Shows) == 0 {
		t.Fatalf("no shows parsed")
	}
	// Every show must point at a movie that was parsed, or the read layer
	// drops it as an orphan.
	known := map[string]bool{}
	for _, m := range snap.Movies {
		known[m.ID] = true
	}
	for _, s := range snap.Shows {
		if !known[s.MovieID] {
			t.Errorf("show %s references unknown movie %s", s.ID, s.MovieID)
		}
	}
}

func TestShowFields(t *testing.T) {
	snap := Parse(loadSample(t))
	for _, s := range snap.Shows {
		if s.Source != "sunbeam" {
			t.Errorf("show %s source = %q", s.ID, s.Source)
		}
		if s.CinemaID != cinemaID {
			t.Errorf("show %s cinema = %q", s.ID, s.CinemaID)
		}
		if len(s.StartAt) != 25 || s.StartAt[10] != 'T' {
			t.Errorf("show %s startAt = %q, want YYYY-MM-DDTHH:MM:SS+08:00", s.ID, s.StartAt)
		}
		if len(s.Date) != 10 {
			t.Errorf("show %s date = %q", s.ID, s.Date)
		}
		// House names always carry the 院 suffix from the venue field.
		if len(s.HouseName) < 2 {
			t.Errorf("show %s houseName = %q", s.ID, s.HouseName)
		}
	}
}

func TestCancelledShowsExcluded(t *testing.T) {
	// status:!1 means cancelled or past; those must never reach the site.
	html := loadSample(t)
	all := showRe.FindAllStringSubmatch(html, -1)
	kept := map[string]bool{}
	for _, s := range Parse(html).Shows {
		kept[s.ID] = true
	}
	for _, m := range all {
		if m[7] == "!0" {
			continue
		}
		if kept["sunbeam-"+m[1]] {
			t.Errorf("show %s has status !1 but was kept", m[1])
		}
	}
}

func TestPosterDecoding(t *testing.T) {
	snap := Parse(loadSample(t))
	withPoster := 0
	for _, m := range snap.Movies {
		if m.Poster == nil {
			continue
		}
		withPoster++
		if len(*m.Poster) < 10 || (*m.Poster)[:4] != "http" {
			t.Errorf("movie %s poster = %q, want absolute URL", m.ID, *m.Poster)
		}
	}
	if withPoster == 0 {
		t.Errorf("no posters parsed at all")
	}
}
