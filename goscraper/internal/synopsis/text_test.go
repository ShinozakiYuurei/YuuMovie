package synopsis

import "testing"

// TestUsableSynopsis covers the three rejections, all of which occur on the real
// sites.
func TestUsableSynopsis(t *testing.T) {
	cases := []struct{ in, want string }{
		{"--", ""},
		{"", ""},
		// English only: the site answered with something that is not a synopsis.
		{"Introduction :", ""},
		{"很短的", ""},
		// Real copy, kept.
		{"這是一段足夠長的中文簡介，用來判斷長度門檻是否正確。", "這是一段足夠長的中文簡介，用來判斷長度門檻是否正確。"},
	}
	for _, tc := range cases {
		if got := UsableSynopsis(tc.in); got != tc.want {
			t.Errorf("UsableSynopsis(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestCJKGuardMatches proves the character class actually matches, which is the
// failure a Unicode escape would hide: the regexp compiles, the guard reads
// correctly, and it silently never fires.
func TestCJKGuardMatches(t *testing.T) {
	if !cjkRe.MatchString("偵戰") {
		t.Error("the CJK class does not match a Traditional Chinese title")
	}
	if !cjkRe.MatchString("生化危機") {
		t.Error("the CJK class does not match a Simplified Chinese title")
	}
	if cjkRe.MatchString("Avengers Endgame") {
		t.Error("the CJK class matched pure Latin text")
	}
	if cjkRe.MatchString("超風 2026") != true {
		t.Error("the CJK class did not match mixed text")
	}
}

// TestStripHTML covers the shared text pipeline.
func TestStripHTML(t *testing.T) {
	cases := []struct{ in, want string }{
		// Entities resolve after the tags are gone, so an entity that produced a
		// quote cannot be mistaken for markup.
		{"<p>a &amp; b</p>", "a & b"},
		{"<p>&#x4E2D;&#x6587;</p>", "中文"},
		{"<p>&#20013;</p>", "中"},
		// A numeric entity outside the Unicode range is left alone rather than
		// producing a replacement character.
		{"<p>&#x110000;</p>", "&#x110000;"},
		// Line-ending tags become spaces, so two sentences do not run together.
		{"<p>first</p><p>second</p>", "first second"},
		{"a<br>b", "a b"},
		// Unknown named entities are left as written.
		{"<p>a&nbsp;b</p>", "a b"},
		{"<p>a&bogus;b</p>", "a&bogus;b"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := StripHTML(tc.in); got != tc.want {
			t.Errorf("StripHTML(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
