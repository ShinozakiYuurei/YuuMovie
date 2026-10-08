package titleword

import (
	"regexp"
	"testing"
)

// The contract these tests pin: ReplaceWordBoundary must behave exactly like
//
//	s.replace(new RegExp('(^|[^a-z0-9])' + esc + '(?![a-z0-9])', 'gi'), '$1 ')
//
// from lib/enrich-key.js / scrapers/douban-suggest.js. Every case below was
// checked against the Node implementation. A regression here silently changes
// which listings get merged — exactly the class of bug that only shows up as
// two cards for one film, or one card for two films.

func mustRe(t *testing.T, pat string) *regexp.Regexp {
	t.Helper()
	re, err := regexp.Compile(pat)
	if err != nil {
		t.Fatalf("compile %q: %v", pat, err)
	}
	return re
}

func TestReplaceWordBoundary(t *testing.T) {
	re := mustRe(t, "(?i)(^|[^a-z0-9])IMAX")

	cases := []struct {
		name string
		in   string
		want string
	}{
		// The token is stripped and replaced by its captured boundary + space.
		{"leading token", "IMAX \u5fa9\u4ec7\u8005", "  \u5fa9\u4ec7\u8005"},
		{"mid token", "復仇者 IMAX 終局", "復仇者   終局"},
		{"trailing token", "\u5fa9\u4ec7\u8005 IMAX", "\u5fa9\u4ec7\u8005  "},
		// The guard must NOT fire when the token is glued to more letters:
		// IMAX2D is a different format marker and has to survive.
		{"suffix keeps it", "IMAX2D \u5fa9\u4ec7\u8005", "IMAX2D \u5fa9\u4ec7\u8005"},
		{"prefix keeps it", "myIMAX", "myIMAX"},
		// Only ASCII counts as a word character, so a Chinese neighbour is a
		// valid boundary — that is why the helper checks bytes, not runes.
		{"cjk neighbour is a boundary", "\u5fa9\u4ec7\u8005IMAX\u7d42\u5c40", "\u5fa9\u4ec7\u8005 \u7d42\u5c40"},
		{"no match", "\u5fa9\u4ec7\u8005\u7d42\u5c40", "\u5fa9\u4ec7\u8005\u7d42\u5c40"},
		{"empty", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ReplaceWordBoundary(re, tc.in); got != tc.want {
				t.Errorf("ReplaceWordBoundary(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestReplaceWordBoundaryMultiple(t *testing.T) {
	re := mustRe(t, "(?i)(^|[^a-z0-9])4DX")
	// Two tokens: the scan must not skip the second one.
	got := ReplaceWordBoundary(re, "4DX \u5fa9\u4ec7\u8005 4DX")
	want := "  復仇者  "
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestIsASCIIAlnum(t *testing.T) {
	for _, c := range []byte{'a', 'Z', '0', '9'} {
		if !IsASCIIAlnum(c) {
			t.Errorf("IsASCIIAlnum(%q) = false, want true", c)
		}
	}
	// Chinese bytes must read as non-word, or Chinese titles never match.
	for _, c := range []byte("\u5fa9\u4ec7\u8005") {
		if IsASCIIAlnum(c) {
			t.Errorf("IsASCIIAlnum(0x%02x) = true, want false", c)
		}
	}
	for _, c := range []byte{'-', ' ', '_', '.'} {
		if IsASCIIAlnum(c) {
			t.Errorf("IsASCIIAlnum(%q) = true, want false", c)
		}
	}
}
