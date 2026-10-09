package enrichkey

import "testing"

// TestKeyParity pins the enrichment key against the Node reference.
//
// The key is the cache key for a film's scores, so a change here would orphan
// every cached row and quietly re-attribute scores between films. Expectations
// come from scripts/enrich-key-parity.mjs against lib/enrich-key.js.
func TestKeyParity(t *testing.T) {
	cases := []struct{ in, want string }{
		// A format prefix is stripped on both sides of the language split.
		{"IMAX 生化危機", "生化危機"},
		{"IMAX Resident Evil", "resident evil"},
		{"M (GFF)", "m"},
		// Book marks are NOT brackets here, unlike in the Douban cleaner where they
		// are kept because they often hold the real title. The Node key's bracket
		// set has no 《》, so the marks survive; only the punctuation pass touches
		// what is inside them.
		{"《空槍》", "《空槍》"},
		// The half-width pipe and the full-width one both cut the rest of the string.
		{"DORAEMON｜哆啦A夢", "doraemon"},
		// A routing separator cuts everything after it.
		{"DORAEMON | 哆啦A夢", "doraemon"},
		{"超風", "超風"},
		{"龍珠 4K", "龍珠"},
		// Only the listed word goes: 視界 on its own is part of 杜比視界 and
		// stays, while 杜比 does not appear in this list.
		{"死侍2 杜比視界", "死侍2 視界"},
		{"Some Film (2026)", "some film"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := Key(tc.in); got != tc.want {
			t.Errorf("Key(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestKeyKeepsGenuineDigits guards the boundary check: a film whose title really
// contains a format word must not be cut in half.
func TestKeyKeepsGenuineDigits(t *testing.T) {
	// "3D" is in the list, but here it is glued to letters, so the boundary does
	// not hold and the token survives.
	if got := Key("D3D Film"); got != "d3d film" {
		t.Errorf("Key = %q, want the glued token to survive", got)
	}
	// With a real boundary it goes.
	if got := Key("Film 3D"); got != "film" {
		t.Errorf("Key = %q, want the bounded token removed", got)
	}
}

// TestKeyIsStable guards the property the whole cache depends on: the same
// listing written two ways must land on one key, or the same film is looked up
// twice and stored twice.
func TestKeyIsStable(t *testing.T) {
	pairs := [][2]string{
		{"IMAX 生化危機", "生化危機"},
		{"生化危機 (IMAX 3D)", "生化危機"},
		{"龍珠 4K", "龍珠"},
	}
	for _, pair := range pairs {
		if Key(pair[0]) != Key(pair[1]) {
			t.Errorf("Key(%q) = %q but Key(%q) = %q", pair[0], Key(pair[0]), pair[1], Key(pair[1]))
		}
	}
}
