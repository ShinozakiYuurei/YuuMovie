package synopsis

import (
	"sort"
	"strings"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/synopsiskey"
)

// TitleAgrees reports whether an English title from a source is the same film as
// the venue's.
//
// A wrong film here is the commonest accident on these sites: an old film or a
// remake under a shared name. This is the last gate before a synopsis is attached,
// and it has to be generous, because the two sides genuinely write the name
// differently.
//
// Two kinds of generosity, both measured:
//
//  1. One name contains the other. The venue appends event and version tails:
//     "Avengers: Doomsday Special Screening", "... (Japanese Version)", while the
//     source site carries only the film itself.
//  2. The word sets overlap by 80% or more. The venue omits "The Movie":
//     cgv writes "Chiikawa The Secret Of The Mermaid Island - Japanese Version"
//     while wmoov writes "Chiikawa The Movie: The Secret Of The Mermaid Island".
//     A genuinely different film overlaps far less: "Avengers: Endgame" against
//     "Avengers: Doomsday" is 50%, and that is what still gets rejected.
func TitleAgrees(expectedEn, actualEn string) bool {
	a := synopsiskey.Key(expectedEn)
	b := synopsiskey.Key(actualEn)
	// With no name on one side there is nothing to judge, and refusing would lose
	// every film the venue only lists in Chinese.
	if a == "" || b == "" {
		return true
	}
	if a == b || strings.HasPrefix(a, b) || strings.HasPrefix(b, a) ||
		strings.Contains(a, b) || strings.Contains(b, a) {
		return true
	}

	small, big := wordSet(a), wordSet(b)
	if len(small) > len(big) {
		small, big = big, small
	}
	if len(small) == 0 {
		return true
	}
	hits := 0
	for word := range small {
		if _, ok := big[word]; ok {
			hits++
		}
	}
	return float64(hits)/float64(len(small)) >= 0.8
}

// wordSet splits a key into its distinct words.
func wordSet(value string) map[string]bool {
	out := map[string]bool{}
	for _, word := range strings.Fields(value) {
		if word != "" {
			out[word] = true
		}
	}
	return out
}

// minKeyLength is the shortest a fallback key may be.
//
// Four characters is the floor because a shorter one would let "M" reach every
// index entry that starts with M.
const minKeyLength = 4

// matchWmoov finds the wmoov entries for a key, giving ground in three steps.
//
//  1. An exact hit, which is the common shape and is tried first so that "空槍"
//     is not taken by "空槍2".
//  2. A prefix, either way round. Venue names often carry an event tail
//     ("復仇者聯盟5：末日降臨 開畫日特典首場") while the source site carries only
//     the film.
//  3. A substring. The name can be sandwiched between brand and language marks:
//     the venue writes "【Infinity Vision】復仇者聯盟5：末日降臨 (早鳥) LUXE" and
//     "粵語版 - 誤闖遺忘島" while the source site has only
//     "復仇者聯盟5：末日降臨" and "誤闖遺忘島". Neither earlier step reaches
//     those; measured 2026-10-04.
//
// When it falls back it takes the LONGEST matching key, which is the most specific
// one, and only when that is unique. Where the pick is ambiguous it gives up: a
// wrong synopsis on a film is worse than a missing one, because a reader has no way
// to tell. The English-name check on top is the last gate.
func matchWmoov(index map[string][]WmoovEntry, key string) []WmoovEntry {
	if list := index[key]; len(list) > 0 {
		return list
	}
	for _, keys := range [][]string{prefixKeys(index, key), substringKeys(index, key)} {
		if best, ok := longestUnique(keys, index); ok {
			return best
		}
	}
	return nil
}

// matchKinohk is matchWmoov for kinohk.
func matchKinohk(index map[string][]KinohkEntry, key string) []KinohkEntry {
	if list := index[key]; len(list) > 0 {
		return list
	}
	for _, keys := range [][]string{prefixKeys(index, key), substringKeys(index, key)} {
		if best, ok := longestUnique(keys, index); ok {
			return best
		}
	}
	return nil
}

// matchHkmovie6 is matchWmoov for hkmovie6.
func matchHkmovie6(index map[string][]Hkmovie6Entry, key string) []Hkmovie6Entry {
	if list := index[key]; len(list) > 0 {
		return list
	}
	for _, keys := range [][]string{prefixKeys(index, key), substringKeys(index, key)} {
		if best, ok := longestUnique(keys, index); ok {
			return best
		}
	}
	return nil
}

// prefixKeys returns the index keys where one is a prefix of the other.
func prefixKeys[T any](index map[string][]T, key string) []string {
	var out []string
	for candidate := range index {
		if len(candidate) < minKeyLength {
			continue
		}
		if strings.HasPrefix(candidate, key) || strings.HasPrefix(key, candidate) {
			out = append(out, candidate)
		}
	}
	sort.Strings(out)
	return out
}

// substringKeys returns the index keys where one is contained in the other.
func substringKeys[T any](index map[string][]T, key string) []string {
	var out []string
	for candidate := range index {
		if len(candidate) < minKeyLength {
			continue
		}
		if strings.Contains(candidate, key) || strings.Contains(key, candidate) {
			out = append(out, candidate)
		}
	}
	sort.Strings(out)
	return out
}

// longestUnique picks the longest of the keys, but only when exactly one is that
// long. Two equally long candidates are an ambiguity and yield nothing.
func longestUnique[T any](keys []string, index map[string][]T) ([]T, bool) {
	if len(keys) == 0 {
		return nil, false
	}
	longest := 0
	for _, key := range keys {
		if len(key) > longest {
			longest = len(key)
		}
	}
	var best []string
	for _, key := range keys {
		if len(key) == longest {
			best = append(best, key)
		}
	}
	if len(best) != 1 {
		return nil, false
	}
	return index[best[0]], true
}
