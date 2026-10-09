package douban

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/titleword"
)

// spaceRunRe folds runs of whitespace.
var spaceRunRe = regexp.MustCompile("\\s+")

// mustCompile builds a pattern that is known good at build time.
func mustCompile(pattern string) *regexp.Regexp { return regexp.MustCompile(pattern) }

// replaceFold replaces every case-insensitive occurrence of a literal.
//
// The pattern is escaped because these are fixed phrases from the list above,
// not user input, and one of them contains a space that would otherwise read as
// a pattern.
func replaceFold(value, literal, replacement string) string {
	re := regexp.MustCompile("(?i)" + regexp.QuoteMeta(literal))
	return re.ReplaceAllString(value, replacement)
}

// replaceWordBoundary strips a token only when it is not glued to more letters.
//
// This is titleword.ReplaceWordBoundary: RE2 has no lookahead, so the trailing
// guard the JavaScript pattern carried is checked by hand. "IMAX2D" is a
// different format marker and has to survive, while "IMAX Avengers" does not.
func replaceWordBoundary(re *regexp.Regexp, value string) string {
	return titleword.ReplaceWordBoundary(re, value)
}

// abs returns the absolute value.
func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// strconvAtoi parses a decimal int, returning zero when it cannot.
func strconvAtoi(value string) (int, error) {
	return strconv.Atoi(strings.TrimSpace(value))
}
