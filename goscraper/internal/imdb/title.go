package imdb

import (
	"regexp"
	"strings"
)

// TitleScore rates how likely a candidate title is the same film as a query.
// Zero means "not a match"; anything at or above strongTitle is treated as
// trustworthy enough to widen the reissue year window.
//
// The one design decision that matters here is the DIRECTION of an inclusion.
// n is the candidate (IMDb), q is the query (the venue listing):
//
//   - the candidate containing every word of the query scores 82. IMDb habitually
//     carries the full series name ("Neon Genesis Evangelion: The End of
//     Evangelion") while the listing gives only the subtitle, so this direction is
//     safe.
//   - the query containing the whole candidate can only score 76, and only when
//     the extra words are all format or stop words. Otherwise "Evangelion: 1.11
//     You Are (Not) Alone" matches the unrelated "You Are Not Alone", because the
//     word it dropped is the distinguishing one. That has happened in production.
//   - a single-word title is never included against anything: "Fall" is a prefix
//     of "Fall 2: Deadpoint" and "M" is a prefix of everything.
//   - a sequel number may not be swallowed: "Rocky 3" and "Rocky 4" differ only
//     in that digit, and that digit is the whole difference.
//
// The scores are only meaningful relative to each other. 82 is not "same film"
// and 76 is not "possibly the same film" in any absolute sense: they are what the
// ranking has always used, and the year gate is what keeps 76 from turning into a
// wrong score on screen.
func TitleScore(n, q string) int {
	if n == "" || q == "" {
		return 0
	}
	if n == q {
		return 100
	}

	tn := strings.Split(n, " ")
	tq := strings.Split(q, " ")

	// Single-word titles only ever match exactly, which was handled above. "M"
	// would otherwise swallow "M the Movie of the Century" and "Fall" would
	// swallow "Fall 2: Deadpoint", which is a different film.
	if len(tn) == 1 || len(tq) == 1 {
		return 0
	}

	nOnly := difference(tn, tq)
	qOnly := difference(tq, tn)
	matched := len(tq) - len(qOnly)

	// Candidate ⊇ query: IMDb added a series prefix or suffix.
	if len(qOnly) == 0 {
		return 82
	}
	// Query ⊇ candidate: the candidate is missing words, and that is only the same
	// film when everything it dropped is a format or stop word.
	if len(nOnly) == 0 && allFiller(qOnly) {
		return 76
	}
	// Both sides have words of their own: the query's extras must all be format or
	// stop words, the candidate may have at most two, and at least three words
	// must be in common.
	//
	// The shared-word floor is not decoration. It is what makes "Evangelion: Death
	// (True)² & Rebirth" match the 1997 "Neon Genesis Evangelion: Death &
	// Rebirth": the query's extra is "true" and the candidate's are "neon" and
	// "genesis", which would otherwise read as two different films.
	if allFiller(qOnly) && len(nOnly) <= 2 && matched >= 3 {
		return 76
	}
	// Version numbering written differently ("1.11" against "1.0"): only a numeric
	// difference is allowed, and at least four content words must match.
	core := 0
	for _, word := range tq {
		if contains(tn, word) && !isFiller(word) && !isDigits(word) {
			core++
		}
	}
	if allDigits(nOnly) && allDigits(qOnly) && core >= 4 {
		return 76
	}

	// Substring containment needs the overlap to cover most of the longer string,
	// otherwise "Evangelion 1.11 You Are (Not) Alone" swallows "You Are Not Alone".
	if strings.Contains(n, q) || strings.Contains(q, n) {
		shorter, longer := len(n), len(q)
		if shorter > longer {
			shorter, longer = longer, shorter
		}
		if float64(shorter)/float64(longer) >= 0.6 {
			return 62
		}
		return 0
	}
	return 0
}

// stopTokens are words that carry no distinguishing power and may be dropped.
//
// Numbers and the words part/one/two are deliberately absent: they are exactly
// what separates a sequel from its predecessor, and one cut from another. A
// version difference (1.11 against 1.0) has its own channel below, keyed on the
// shared content words instead.
var stopTokens = map[string]bool{
	"the": true, "a": true, "an": true, "of": true, "and": true, "or": true,
	"to": true, "in": true, "on": true, "le": true, "la": true, "les": true,
	"el": true, "un": true, "une": true, "der": true, "die": true, "das": true,
	"il": true, "movie": true, "film": true, "version": true, "true": true,
	"final": true,
}

// formatTokens are screening formats, festivals and version markers that get
// appended to a venue's title and are not part of it.
//
// This is separate from stopTokens because these are not grammatical filler but
// BUSINESS prefixes: "IMAX Avengers Endgame Encore" and "Avengers Endgame" are the
// same film and the two words are the difference. Parenthesised ones are already
// removed by CleanTitle; this set covers the forms written bare into the title.
var formatTokens = map[string]bool{
	"imax": true, "encore": true, "2d": true, "3d": true, "dolby": true,
	"atmos": true, "screenx": true, "4dx": true, "mx4d": true, "dbox": true,
	"omni": true, "pulselx": true, "supernx": true, "miramax": true,
	"reissue": true, "restored": true, "remastered": true, "cineport": true,
	"gff": true, "hkiff": true, "hklgff": true, "bc30": true, "apaaa": true,
	"bcsunday": true,
}

// isFiller reports whether a token may be dropped without changing the film.
func isFiller(token string) bool {
	return stopTokens[token] || formatTokens[token]
}

// allFiller reports whether every token may be dropped.
func allFiller(tokens []string) bool {
	for _, token := range tokens {
		if !isFiller(token) {
			return false
		}
	}
	return true
}

// allDigits reports whether every token is a bare number.
func allDigits(tokens []string) bool {
	for _, token := range tokens {
		if !isDigits(token) {
			return false
		}
	}
	return true
}

// digitsRe matches a token that is only digits, which is how a sequel number is
// recognised.
var digitsRe = regexp.MustCompile(`^\d+$`)

// isDigits reports whether a token is a bare number.
func isDigits(token string) bool { return digitsRe.MatchString(token) }

// difference returns the tokens of a that do not appear in b.
func difference(a, b []string) []string {
	var out []string
	for _, token := range a {
		if !contains(b, token) {
			out = append(out, token)
		}
	}
	return out
}

// contains reports whether the list holds the token.
func contains(list []string, token string) bool {
	for _, item := range list {
		if item == token {
			return true
		}
	}
	return false
}

// nonWordRe folds everything that is neither a letter, a digit, CJK nor kana into
// a space.
//
// The ranges are written out rather than as \u escapes because Go's regexp has no
// \uXXXX syntax; and \s would not cover the full-width space U+3000, which does
// appear in venue titles.
var nonWordRe = regexp.MustCompile("[^a-z0-9぀-ヿ一-鿿 ]")

// spaceRunRe folds runs of whitespace.
var spaceRunRe = regexp.MustCompile(`\s+`)

// Norm lowercases a title and turns punctuation into spaces, keeping CJK and
// kana.
func Norm(value string) string {
	out := nonWordRe.ReplaceAllString(strings.ToLower(value), " ")
	return strings.TrimSpace(spaceRunRe.ReplaceAllString(out, " "))
}
