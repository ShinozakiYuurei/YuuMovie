package sunbeam

import (
	"encoding/json"
	"os"
	"testing"
)

// TestFixtureMatchesNodeReference is the parity gate: the Go parser must produce
// the same movies and shows as the Node implementation did on the same page.
//
// The reference lives in tmp/sunbeam-node.json (written by
// probe/sunbeam-capture.mjs) and the page in probe/sunbeam-home.html. When the
// reference is absent the test skips rather than failing, so a fresh checkout
// still builds.
func TestFixtureMatchesNodeReference(t *testing.T) {
	const refPath = "../../../tmp/sunbeam-node.json"
	raw, err := os.ReadFile(refPath)
	if err != nil {
		t.Skipf("reference %s unavailable: %v", refPath, err)
	}
	var ref struct {
		Movies []map[string]any `json:"movies"`
		Shows  []map[string]any `json:"shows"`
	}
	if err := json.Unmarshal(raw, &ref); err != nil {
		t.Fatalf("parse reference: %v", err)
	}

	snap := Parse(loadSample(t))

	if len(snap.Movies) != len(ref.Movies) {
		t.Errorf("movies: go=%d node=%d", len(snap.Movies), len(ref.Movies))
	}
	if len(snap.Shows) != len(ref.Shows) {
		t.Errorf("shows: go=%d node=%d", len(snap.Shows), len(ref.Shows))
	}

	// Compare ids as sets: order follows the page, but a missing id means a
	// film or screening silently disappeared.
	refMovies := map[string]bool{}
	for _, m := range ref.Movies {
		refMovies[m["id"].(string)] = true
	}
	for _, m := range snap.Movies {
		if !refMovies[m.ID] {
			t.Errorf("movie %s not in the Node reference", m.ID)
		}
	}
	refShows := map[string]bool{}
	for _, s := range ref.Shows {
		refShows[s["id"].(string)] = true
	}
	for _, s := range snap.Shows {
		if !refShows[s.ID] {
			t.Errorf("show %s not in the Node reference", s.ID)
		}
	}
}
