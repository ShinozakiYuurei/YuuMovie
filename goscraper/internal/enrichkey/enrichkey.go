// Package enrichkey ports lib/enrich-key.js, the cache key for a film's scores.
//
// Why this file exists rather than being inlined into the enricher: lib/data.ts
// is TypeScript and imports this exact module, so the two sides must compute
// IDENTICAL keys or the cached IMDb scores stop matching the movies they belong
// to. lib/versions.ts's normalizeTitle also has a zone like this: stripping format
// words helps merge the same film across circuits, and this one only serves the
// cache lookup. That means an explicit merge that is right stays mergeable, but an
// accidental one is not.
//
// The rewrite steps are conservative on purpose: no aggressive simplification and
// no fuzzy matching. Both sides read the same string out of data/movies.json, so
// any cross-language normalisation would introduce merges the other side does not
// have.
package enrichkey

import (
	"regexp"
	"strings"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/titleword"
)

// formatWords are the markers that say a title is showing in some format and
// therefore do not identify a different film.
//
// This list is separate from the one douban.StripFormatBrands uses for search
// queries. Changing this one shifts every cached key and orphans the rows that
// exist, so it only ever grows deliberately.
var formatWords = []string{
	"imax", "imax3d", "4dx", "dbox", "mx4d", "dolby", "dolbyatmos", "atmos",
	"3d", "2d", "4k", "2k", "cinity", "screenx", "dubox",
	"廳", "巨幕", "全景聲", "杜比", "立體", "優先場", "特別場", "加映場",
	"優先", "完場", "加長場", "重映", "粵語", "國語", "原聲", "字幕",
}

// Key normalises a title into its enrichment key.
//
// An empty name yields an empty key, and an empty key is never looked up, which
// is how a film with no title at all is skipped.
func Key(name string) string {
	if name == "" {
		return ""
	}
	s := name

	// Brackets and their contents go first: a venue writes "火之海盜（IMAX 3D）"
	// or "火之海盜（4K修復）", which would collide on the closing bracket.
	s = bracketRe.ReplaceAllString(s, " ")
	// Whatever follows a slash, colon or half-width pipe is the venue's own routing,
	// not part of the title: "龍珠 | 荃灣 - 沙田".
	s = splitAfterRe.Split(s, 2)[0]

	// Format words are removed WITH a boundary, so a film whose title genuinely
	// contains "3D" is not cut in half.
	for _, word := range formatWords {
		s = stripWord(s, word)
	}

	// Punctuation becomes a space, whitespace is squeezed, and the result is
	// lowercased.
	s = punctuationRe.ReplaceAllString(s, " ")
	s = strings.ToLower(spaceRunRe.ReplaceAllString(s, " "))
	return strings.TrimSpace(s)
}

// bracketRe matches a bracketed run of any kind.
var bracketRe = regexp.MustCompile(`[（(〔[【{「『＜<][^（()）)〕\][\]}」』＞>]*[）)〕\]】}」』＞>]`)

// splitAfterRe matches the routing separators.
var splitAfterRe = regexp.MustCompile(`[|｜]`)

// punctuationRe turns punctuation into spaces.
var punctuationRe = regexp.MustCompile(`[：:·・・—–\-_,，。、!！?？'"“”‘’]`)

// spaceRunRe folds runs of whitespace.
var spaceRunRe = regexp.MustCompile("\\s+")

// asciiOnly reports whether every rune is ASCII, which decides how a format word
// is matched: an ASCII word needs its boundaries checked so "3D" does not cut
// "Doraemon" style words in half, while a CJK word is matched literally because
// there are no word boundaries in that script.
func asciiOnly(value string) bool {
	for _, r := range value {
		if r > 0x7f {
			return false
		}
	}
	return true
}

// stripWord removes one format word.
func stripWord(value, word string) string {
	if word == "" {
		return value
	}
	if !asciiOnly(word) {
		// A CJK word needs no boundary check: 視界 is not part of any longer token
		// that means something else, and cutting it out is exactly what the
		// JavaScript does with a plain case-insensitive replace.
		return literalFoldRe(word).ReplaceAllString(value, " ")
	}
	// The JavaScript pattern is (^|[^a-z0-9])word(?![a-z0-9]), which RE2 cannot
	// express. The leading boundary is a real capture; the trailing one is checked
	// by hand after the match, so "IMAX2D" survives.
	re := regexp.MustCompile("(?i)(^|[^a-z0-9])" + regexp.QuoteMeta(word))
	return titleword.ReplaceWordBoundary(re, value)
}

// literalFoldRe builds a case-insensitive literal pattern.
func literalFoldRe(literal string) *regexp.Regexp {
	return regexp.MustCompile("(?i)" + regexp.QuoteMeta(literal))
}
