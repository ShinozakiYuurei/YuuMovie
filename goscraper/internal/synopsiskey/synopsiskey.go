package synopsiskey

import (
	"regexp"
	"strings"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/enrichkey"
)

// wrappersRe matches the bracketed marks a venue wraps a title in.
//
// The brackets are replaced rather than emptied, so two titles differing only by
// their wrapping land on one key.
//
// The class is written with literal runes because Go's regexp has no Unicode
// escape syntax: a backslash-u sequence would reach the engine as an unknown escape
// and match the literal letters u, 3, 0, 0, a instead, which silently disables the
// fold this is here to perform.
var wrappersRe = regexp.MustCompile(`[《》〈〉「」『』【】〔〕［］\[\]]`)

// variants are the folds applied before the enrich key.
//
// They are measured equivalences, not guesses. The platforms write different
// glyphs for the same word in film festival names, and the full-width period is a
// separator three sites use between two titles that enrichKey does not treat as
// one.
var variants = []struct {
	pattern *regexp.Regexp
	to      string
}{
	{regexp.MustCompile("麽"), "麼"},
	{regexp.MustCompile("裡"), "裏"},
	{regexp.MustCompile("．"), "·"},
}

// Key normalises a title into its synopsis key. An empty name yields an empty key,
// which is never looked up, and that is how a film with no title is skipped.
func Key(name string) string {
	if name == "" {
		return ""
	}
	text := wrappersRe.ReplaceAllString(name, " ")
	for _, variant := range variants {
		text = variant.pattern.ReplaceAllString(text, variant.to)
	}
	return strings.TrimSpace(enrichkey.Key(text))
}
