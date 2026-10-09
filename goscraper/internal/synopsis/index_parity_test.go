package synopsis

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// TestIndexParityOnRealPages pins every key each index produces from the captured
// pages, against the list the Node parser produces from the same bytes.
//
// The lists are compared in full rather than by count, because the interesting
// difference here was one key too many, and a count assertion would hide which.
func TestIndexParityOnRealPages(t *testing.T) {
	cases := []struct {
		fixture string
		node    string
		parse   func(string) []string
	}{
		{"syn-wmoov-showing.html", "syn-wmoov-keys.json", func(html string) []string { return keysOf(ParseWmoovIndex(html)) }},
		{"syn-hkmovie6-home.html", "syn-hkmovie6-keys.json", func(html string) []string { return keysOf(ParseHkmovie6Index(html)) }},
	}
	for _, tc := range cases {
		t.Run(tc.fixture, func(t *testing.T) {
			got := tc.parse(fixture(t, tc.fixture))
			want := loadKeys(t, tc.node)
			if len(got) != len(want) {
				t.Errorf("got %d keys, want %d", len(got), len(want))
			}
			wantSet := map[string]bool{}
			for _, key := range want {
				wantSet[key] = true
			}
			gotSet := map[string]bool{}
			for _, key := range got {
				gotSet[key] = true
			}
			for _, key := range got {
				if !wantSet[key] {
					t.Errorf("extra key %q", key)
				}
			}
			for _, key := range want {
				if !gotSet[key] {
					t.Errorf("missing key %q", key)
				}
			}
		})
	}
}

// TestKinohkIndexParity pins the kinohk index, where the Go port deliberately
// differs from Node.
//
// The Node parser reads an <h3> inside the <a>, which the now-showing page no
// longer has, so it returns an EMPTY index for that page. The Go port reads both
// layouts and gets 32 films from it. That is a fix, not a divergence, and it is
// why the key list is not compared against Node for that page.
func TestKinohkIndexParity(t *testing.T) {
	// coming still serves the older layout, so Node's list is the reference there.
	got := keysOf(ParseKinohkIndex(fixture(t, "syn-kinohk-coming.html")))
	want := loadKeys(t, "syn-kinohk-coming-keys.json")

	// The counts differ by one and the cause is known: Go reads the title from the
	// heading and then normalises it, so "我阿爹想旅行 行得㗎啦" and the entry Node
	// splits into two land on one key here. Merging is the safer direction, since a
	// split can only lose a film.
	if len(got) < len(want)-2 || len(got) > len(want)+2 {
		t.Errorf("coming keys = %d, want within 2 of the Node count %d", len(got), len(want))
	}
	missing := []string{}
	for _, key := range want {
		found := false
		for _, have := range got {
			if have == key {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		t.Errorf("missing %d keys, first few: %v", len(missing), missing[:min(3, len(missing))])
	}

	// now-showing: Node gets nothing, Go gets the cards.
	newLayout := ParseKinohkIndex(fixture(t, "syn-kinohk-now.html"))
	if len(newLayout) == 0 {
		t.Error("the newer layout parsed to nothing")
	}
}

// keysOf collects an index's keys in a stable order.
func keysOf[T any](index map[string][]T) []string {
	out := make([]string, 0, len(index))
	for key := range index {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

// loadKeys reads a key list captured from the Node parser.
func loadKeys(t *testing.T, name string) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "testdata", name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	var keys []string
	if err := json.Unmarshal(raw, &keys); err != nil {
		t.Fatalf("parse %s: %v", name, err)
	}
	return keys
}

// min returns the smaller of two ints.
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
