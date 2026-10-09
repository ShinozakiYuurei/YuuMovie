package runner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

func strPtr(s string) *string { return &s }

// A Chinese slug would 404 under /movie/[slug], which is what made 13 of 25
// ticket-card links point at nothing.
func TestSlugifyIsASCII(t *testing.T) {
	cases := []struct {
		nameZh, nameEn, id, want string
	}{
		{"生化危機", "", "mcl-14789", "movie-mcl-14789"},
		{"", "Call Me by Your Name", "mcl-14743", "call-me-by-your-name-mcl-14743"},
		{"", "IMAX: Resident Evil", "cinemacity-1", "imax-resident-evil-cinemacity-1"},
		{"", "", "broadway-1", "movie-broadway-1"},
		// The base is cut at 60 characters and the trailing dash is trimmed,
		// so a long title keeps its first 60 characters only. Verified against
		// the Node slugify.
		{"", "a:very:long:title:with:many:colons:that:goes:past:sixty:characters:indeed", "x-1",
			"a-very-long-title-with-many-colons-that-goes-past-sixty-char-x-1"},
	}
	for _, c := range cases {
		if got := slugify(c.nameZh, c.nameEn, c.id); got != c.want {
			t.Errorf("slugify(%q, %q, %q) = %q, want %q", c.nameZh, c.nameEn, c.id, got, c.want)
		}
	}
}

func TestSlugifyKeepsOnlyTheIDTail(t *testing.T) {
	// The Node code splits on ":" and keeps the last part, so a colon inside an
	// id cannot leak into the slug.
	if got, want := slugify("", "", "a:b:c"), "movie-c"; got != want {
		t.Errorf("slugify = %q, want %q", got, want)
	}
}

func TestCollectFillsMissingSlug(t *testing.T) {
	sources := map[string]*snapshot{
		"mcl": {
			Movies:  []model.Movie{{ID: "mcl-1", NameZh: "生化危機"}},
			Cinemas: []model.Cinema{{ID: "mcl-c1"}},
			Shows:   []model.Show{{ID: "mcl-s1", MovieID: "mcl-1", CinemaID: "mcl-c1"}},
		},
	}
	got := collect(sources)
	if len(got.Movies) != 1 {
		t.Fatalf("movies = %d", len(got.Movies))
	}
	if got.Movies[0].Slug != "movie-mcl-1" {
		t.Errorf("slug = %q", got.Movies[0].Slug)
	}
}

func TestCollectDropsDuplicateIDs(t *testing.T) {
	sources := map[string]*snapshot{
		"bestar":     {Movies: []model.Movie{{ID: "shared-1", NameEn: "From Bestar"}}},
		"cinemacity": {Movies: []model.Movie{{ID: "shared-1", NameEn: "From Cinema City"}}},
	}
	got := collect(sources)
	if len(got.Movies) != 1 {
		t.Fatalf("movies = %d, want 1 after de-duplication", len(got.Movies))
	}
	// Sorted order decides the winner, so the result is reproducible.
	if got.Movies[0].NameEn != "From Bestar" {
		t.Errorf("winner = %q, want the first circuit in sorted order", got.Movies[0].NameEn)
	}
}

func TestCheckIntegrityCountsOrphans(t *testing.T) {
	result := &model.Result{
		Movies:  []model.Movie{{ID: "mcl-1", Poster: strPtr("p.jpg")}, {ID: "mcl-2"}},
		Cinemas: []model.Cinema{{ID: "mcl-c1", Address: " somewhere "}},
		Shows: []model.Show{
			{ID: "ok", MovieID: "mcl-1", CinemaID: "mcl-c1", BookingURL: "https://x"},
			{ID: "orphan", MovieID: "gone", CinemaID: "mcl-c1", BookingURL: "https://y"},
			{ID: "nobooking", MovieID: "mcl-1", CinemaID: "mcl-c1"},
		},
	}
	got := checkIntegrity(result)
	if got.OrphanShows != 1 {
		t.Errorf("OrphanShows = %d, want 1", got.OrphanShows)
	}
	if got.ShowsWithoutBookingURL != 1 {
		t.Errorf("ShowsWithoutBookingURL = %d, want 1", got.ShowsWithoutBookingURL)
	}
	if got.MoviesWithoutPoster != 1 {
		t.Errorf("MoviesWithoutPoster = %d, want 1", got.MoviesWithoutPoster)
	}
	if got.CinemasWithoutAddress != 0 {
		t.Errorf("CinemasWithoutAddress = %d, want 0", got.CinemasWithoutAddress)
	}
}

func TestLoadSnapshotRejectsStaleData(t *testing.T) {
	dir := t.TempDir()

	write := func(name, savedAt string) {
		raw, _ := json.Marshal(snapshot{
			Movies:  []model.Movie{{ID: "mcl-1"}},
			SavedAt: savedAt,
		})
		if err := os.WriteFile(filepath.Join(dir, name+".json"), raw, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	fresh := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	stale := time.Now().Add(-48 * time.Hour).UTC().Format(time.RFC3339)
	write("fresh", fresh)
	write("stale", stale)
	write("undated", "")

	if loadSnapshot(dir, "fresh", staleAfter) == nil {
		t.Error("a one-hour-old snapshot should be usable")
	}
	if loadSnapshot(dir, "stale", staleAfter) != nil {
		t.Error("a two-day-old snapshot must be rejected")
	}
	if loadSnapshot(dir, "undated", staleAfter) != nil {
		t.Error("an undated snapshot must be rejected")
	}
	if loadSnapshot(dir, "absent", staleAfter) != nil {
		t.Error("a missing snapshot must be rejected")
	}
}

// The run must refuse to publish an empty site rather than blanking it.
func TestRunRefusesEmptyResult(t *testing.T) {
	dir := t.TempDir()
	// Only ask for a circuit that cannot succeed, so the test does not depend on
	// whether the live sites are reachable.
	//
	// Asking for ALL circuits, as this used to, made the test depend on the
	// network being down: with every circuit failing it passed, and on a machine
	// with working connectivity it failed after having scraped every cinema in
	// Hong Kong. That is a property of the outside world, not of the runner.
	_, err := Run(t.Context(), Options{DataDir: dir, Only: []string{"nonexistent"}})
	if err == nil {
		t.Fatal("expected an error when nothing could be scraped")
	}
	if _, statErr := os.Stat(filepath.Join(dir, "movies.json")); statErr == nil {
		t.Error("movies.json must not be written on an empty result")
	}
}
