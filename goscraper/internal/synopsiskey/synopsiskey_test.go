package synopsiskey

import "testing"

// TestKeyParity pins the synopsis key against the Node reference.
//
// The key is the cache key for a synopsis AND the join key across venues, so a
// change here orphans the cache and re-attaches synopses to the wrong films.
// Expectations come from scripts/synopsis-key-parity.mjs against
// lib/synopsis-key.js.
func TestKeyParity(t *testing.T) {
	cases := []struct{ in, want string }{
		// The wrapper fold is the whole reason this key exists: a venue writes
		// 《社交清算》 and a reference site writes 社交清算.
		{"《社交清算》", "社交清算"},
		{"社交清算", "社交清算"},
		{"《空槍》", "空槍"},
		{"空槍", "空槍"},
		// And it must NOT merge a sequel with its predecessor: that is the case the
		// IMDb title scorer refuses for the same reason.
		{"空槍2", "空槍2"},
		// The wrapped form only merges the wrapper, not the prefix: 劇場版 is part of
		// what the venue published and the plain title is a different key. This is
		// what matchIndex's fallback is for.
		{"劇場版《魔法少女小圓》", "劇場版 魔法少女小圓"},
		{"魔法少女小圓", "魔法少女小圓"},
		// The three measured glyph folds: two film-festival word variants and the
		// full-width period three sites write between two titles.
		{"超風_金剛", "超風 金剛"},
		{"超風·金剛", "超風 金剛"},
		// The enrich rules still apply underneath.
		{"IMAX 生化危機", "生化危機"},
		{"Avengers Endgame", "avengers endgame"},
		{"Some Film (2026)", "some film"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := Key(tc.in); got != tc.want {
			t.Errorf("Key(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestKeyMergesWrappersOnly is the property the fold must hold: it merges, and it
// merges toward the plain form.
func TestKeyMergesWrappersOnly(t *testing.T) {
	if Key("《空槍》") != Key("空槍") {
		t.Error("the book marks did not merge")
	}
	if Key("「空槍」") != Key("空槍") {
		t.Error("the corner brackets did not merge")
	}
	if Key("【空槍】") != Key("空槍") {
		t.Error("the lenticular brackets did not merge")
	}
	if Key("空槍") == Key("空槍2") {
		t.Error("a sequel merged with its predecessor")
	}
}

// TestFoldIsApplied proves the variant folds actually fire, which is the failure a
// character class written with an unsupported escape would hide.
func TestFoldIsApplied(t *testing.T) {
	// The three folds, from lib/synopsis-key.js. Each pair is the two glyphs the
	// platforms use for one word.
	pairs := [][2]string{
		{"\u9ebd", "\u9ebc"},
		{"\u88e1", "\u88cf"},
	}
	for _, pair := range pairs {
		if Key("A"+pair[0]) != Key("A"+pair[1]) {
			t.Errorf("the fold from U+%04X did not fire", rune(pair[0][0]))
		}
	}
	// The full-width period is a separator, folded to the middle dot.
	if Key("A\uff0eB") != Key("A\u00b7B") {
		t.Error("the full-width period fold did not fire")
	}
}
