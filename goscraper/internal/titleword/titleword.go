// Package titleword ports the title-normalisation helpers the scrapers need.
//
// Why this package exists at all: Go's regexp (RE2) has no lookaround, and the
// Node side leans on it in exactly the places that decide whether two listings
// are the same film. Getting these wrong silently merges or splits films, so
// each lookaround is rewritten here rather than approximated.
//
// The rewrites fall into two shapes:
//
//  1. Word-boundary guards like (^|[^a-z0-9])word(?![a-z0-9]) — a negative
//     lookahead that only checks the *following* byte. RE2 cannot express the
//     trailing guard, so the match is done and the boundary is verified by
//     hand on the byte after the match (see ReplaceWordBoundary).
//
//  2. (?<!\d) / (?<=...) guards — a leading or trailing assertion that RE2
//     also cannot express. These become explicit scans (see Strippers below).
//
// This mirrors lib/versions.ts and lib/enrich-key.js; the cases in
// probe/check-danger.mts are the contract both sides must satisfy.
package titleword

import (
	"regexp"
	"strings"
)

// ReplaceWordBoundary replaces every occurrence of re whose trailing byte is
// not ASCII alphanumeric, mimicking
//
//	s.replace(new RegExp('(^|[^a-z0-9])' + word + '(?![a-z0-9])', 'gi'), '$1 ')
//
// from lib/enrich-key.js and scrapers/douban-suggest.js. The leading boundary
// stays in the caller's pattern (RE2 handles that capture); only the trailing
// guard needs this helper. The match is replaced by its captured group plus a
// space — the word itself is dropped, which is what strips the token.
func ReplaceWordBoundary(re *regexp.Regexp, s string) string {
	locs := re.FindAllStringSubmatchIndex(s, -1)
	if len(locs) == 0 {
		return s
	}
	var b strings.Builder
	prev := 0
	for _, loc := range locs {
		start, end := loc[0], loc[1]
		g1s, g1e := loc[2], loc[3]

		// Reject when the byte after the match is alphanumeric: RE2 could not
		// assert that, so it is checked here.
		if end < len(s) && isAlnumByte(s[end]) {
			continue
		}
		b.WriteString(s[prev:start])
		if g1s >= 0 {
			b.WriteString(s[g1s:g1e])
		}
		b.WriteByte(' ')
		prev = end
	}
	b.WriteString(s[prev:])
	return b.String()
}

func isAlnumByte(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
}

// IsASCIIAlnum reports whether the byte is an ASCII letter or digit. Exported
// because lib/versions.ts treats only ASCII as a word character — Chinese is
// deliberately not, or Chinese titles would never match at a boundary.
func IsASCIIAlnum(c byte) bool { return isAlnumByte(c) }
