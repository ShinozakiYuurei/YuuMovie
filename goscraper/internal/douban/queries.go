package douban

import (
	"regexp"
	"strings"
)

// trimWordsRe lists the event, version and format words that are safe to trim off
// a query.
//
// They are kept as one alternation rather than per-word checks because two things
// break when it is done per word: a phrase that straddles two words ("LIVE
// VIEWING", "Infinity Vision開畫日特典首場") is never seen, and a title with an
// event word glued to it ("末日降臨開畫日特典首場") is wrongly read as trimmable.
// Chunk-level stripping followed by an emptiness check handles both.
var trimWordsRe = regexp.MustCompile("(?i)(?:導演映後分享場|映後分享場|映後分享|電影分享會|分享會|見面場|見面會|現場直播|" +
	"特別放映|特別加映|特別版|紀念放映|馬拉松|千秋樂|連映|應援場|應援|謝票場|謝票|首映場|優先場|優先購票|" +
	"開畫日|首場|加場|加碼|安可|重映|encore|screener|fandub|dubbed|subbed|特典場|特典|畫冊|杯墊|限定|" +
	"修復版|菲林版|數位版|日語版|粵語版|國語版|英語版|原聲版|劇場版|hi\\s+bye|meet\\s*&?\\s*greet|" +
	"live\\s+viewing|special\\s+screening|special\\s+viewing|imax\\s+with\\s+laser|infinity\\s+vision|imax|4dx|" +
	"screenx|mx4d|cgs|luxe|dolby|atmos|cinity|dubox|dbox|laser|35mm|16mm|70mm|4k|2k|nt\\s+live|" +
	"the\\s+met|royal\\s+ballet|gff|hkjff|hklgff|hkiff|bc30|bcsunday|kino)")

// trimStripRe is the same list, case-insensitive, for repeated stripping.
var trimStripRe = regexp.MustCompile("(?i)" + trimWordsRe.String())

// connectiveRe removes the connectives that join event words to each other.
var connectiveRe = regexp.MustCompile("(?i)\\b(?:with|and)\\b")

// punctuationRe removes the separators and digits left behind.
var punctuationRe = regexp.MustCompile("[\\s\\-–—·|:：x×+()（）\\[\\]【】《》〈〉「」『』«»≪≫&\\d]+")

// isTrimChunk reports whether a chunk is made only of event, format,
// connective and separator characters, so dropping it leaves a real title.
//
// Requiring the WHOLE chunk to be disposable is the point. An earlier version
// cut tokens off the tail unconditionally, which turned "GIANT – The Play" into
// "GIANT – The" and "Fallen Angels by Noël Coward" into "Fallen Angels", both of
// which came back as an unrelated entry with the same name. A wrong score is worse
// than a missing one, so the cut has to be provably clean.
func isTrimChunk(chunk string) bool {
	if strings.TrimSpace(chunk) == "" {
		return true
	}
	rest := trimStripRe.ReplaceAllString(chunk, "")
	rest = connectiveRe.ReplaceAllString(rest, "")
	rest = punctuationRe.ReplaceAllString(rest, "")
	return rest == ""
}

// bracketPairs are the pairs whose counts must agree.
var bracketPairs = [][2]string{
	{"(", ")"}, {"（", "）"}, {"[", "]"}, {"【", "】"}, {"《", "》"},
	{"「", "」"}, {"『", "』"}, {"«", "»"}, {"≪", "≫"},
}

// balancedBrackets reports whether every bracket pair is balanced.
//
// "天鵝湖 (The" has an unclosed bracket and comes back as the Norwegian ballet
// recording, so an unbalanced candidate is dropped outright rather than searched.
func balancedBrackets(value string) bool {
	for _, pair := range bracketPairs {
		if strings.Count(value, pair[0]) != strings.Count(value, pair[1]) {
			return false
		}
	}
	return true
}

// shrinkPunctRe keeps the book marks out of this particular check, because
// CleanTitle has already turned them into spaces by the time this runs.
var shrinkPunctRe = regexp.MustCompile("[\\s\\-–—·|:：x×()（）\\[\\]【】«»≪≫]+")

// shrinkOk reports whether a shrunken candidate is worth searching.
//
// The CJK floor is 2 characters, not the 3 the general rule uses: after event
// words are removed the two remaining characters are often the real title (the
// bc30 and KINO series are all two characters). A single character is still
// blocked, because 愛 brings back 韩内克's 爱.
func shrinkOk(value string) bool {
	if value == "" {
		return false
	}
	cjk := cjkCount(value)
	if cjk > 0 {
		if cjk < 2 {
			return false
		}
	} else if len(splitFields(value)) < 2 {
		return false
	}
	// What survives has to still be a title, or a query like "日語版" or
	// "開畫日特典首場" comes back with a pile of unrelated entries.
	rest := trimStripRe.ReplaceAllString(value, "")
	rest = shrinkPunctRe.ReplaceAllString(rest, "")
	return len([]rune(rest)) >= 2
}

// cleanCandidate trims orphan separators and folds whitespace.
func cleanCandidate(value string) string {
	value = regexp.MustCompile("^[\\s\\-–—·|:：]+|[\\s\\-–—·|:：]+$").ReplaceAllString(value, "")
	return strings.TrimSpace(spaceRunRe.ReplaceAllString(value, " "))
}

// colonSpaceRe finds a colon followed by a space, which collapses in titles.
var colonSpaceRe = regexp.MustCompile("([:：])\\s+")

// pushCandidate adds one shrunken form, including its brand-stripped and
// colon-collapsed variants.
func pushCandidate(out []string, candidate, query string) []string {
	cleaned := cleanCandidate(candidate)
	if cleaned == "" || cleaned == query {
		return out
	}
	branded := StripFormatBrands(cleaned)
	variants := []string{cleaned}
	if branded != "" && branded != cleaned {
		variants = append(variants, branded)
	}
	for _, variant := range variants {
		collapsed := colonSpaceRe.ReplaceAllString(variant, "$1")
		forms := []string{variant}
		if collapsed != variant {
			forms = append(forms, collapsed)
		}
		for _, form := range forms {
			if form == "" || form == query || containsString(out, form) {
				continue
			}
			if !balancedBrackets(form) || !shrinkOk(form) {
				continue
			}
			out = append(out, form)
		}
	}
	return out
}

// shrinkQueries returns the shorter forms of one query.
//
// Three shapes, because the event words land in three places:
//   - at the tail, where a "Hi Bye" or a bonus note follows the title;
//   - at the head, where 開畫日特典首場 or 日語版 leads it;
//   - glued to a token with no space, as in 末日降臨開畫日特典首場.
func shrinkQueries(query string) []string {
	parts := splitFields(query)
	var out []string

	// Tail: keep the first i tokens. The dropped tail must be wholly disposable.
	for i := len(parts) - 1; i >= 1; i-- {
		if !isTrimChunk(strings.Join(parts[i:], " ")) {
			continue
		}
		out = pushCandidate(out, strings.Join(parts[:i], " "), query)
	}
	// Head: keep the last n tokens.
	for i := 1; i < len(parts); i++ {
		if !isTrimChunk(strings.Join(parts[:i], " ")) {
			continue
		}
		out = pushCandidate(out, strings.Join(parts[i:], " "), query)
	}
	// Glued token: keep the longest disposable SUFFIX's complement, so the
	// prefix before it becomes a candidate. The prefix still has to pass shrinkOk,
	// which is what stops "重映開畫日特典首場" from yielding "重映".
	for t := 0; t < len(parts); t++ {
		token := parts[t]
		if isTrimChunk(token) {
			continue
		}
		runes := []rune(token)
		for start := 1; start < len(runes); start++ {
			if !isTrimChunk(string(runes[start:])) {
				continue
			}
			next := make([]string, len(parts))
			copy(next, parts)
			next[t] = string(runes[:start])
			out = pushCandidate(out, strings.Join(next, " "), query)
			break
		}
	}
	return out
}

// maxQueries caps how many searches one film may cost.
//
// The base queries come first and the shrunken forms only fill what is left, so
// a long title's tail-shrunk forms cannot push the English name out of the list.
const maxQueries = 12

// ExpandQueries builds the full query list for one film.
//
// A cleaned query that is too short is DROPPED rather than down-weighted.
// search_suggest does not compare titles, it only ranks by relevance, and Douban's
// title is simplified (超风) while the data stores traditional (超風), so the
// strings cannot be compared locally and there is no way to tell locally whether
// the match was right. "M (GFF)" cleans to "M" and comes back with a pile of
// unrelated M entries; showing no score is better than that. Whether the match was
// right is recorded in alternatives for a human to check.
func ExpandQueries(zh, en string) []string {
	zh = strings.TrimSpace(zh)
	en = strings.TrimSpace(en)
	zhClean := StripFormatBrands(CleanTitle(zh))
	enClean := StripFormatBrands(CleanTitle(en))

	candidates := []struct {
		query    string
		needLong bool
		shortOK  bool
	}{
		{zh, false, false},
		// The title inside 《…》 is its own candidate: two characters (空槍) is
		// enough, which is looser than the general rule, and a single character is
		// still blocked.
		{BracketTitle(zh), false, true},
		// An unchanged clean name contributes nothing, rather than repeating the
		// search that the original entry already covers.
		{differs(zhClean, zh), true, false},
		{en, true, false},
		{differs(enClean, en), true, false},
	}
	// The JavaScript builds each cleaned candidate as `zhClean === zh ? '' :
	// zhClean`, so an unchanged clean name contributes nothing rather than
	// duplicating the search. That is done here when the list is built.
	var queries []string
	for _, c := range candidates {
		if c.query == "" {
			continue
		}
		if c.needLong && !longEnough(c.query) {
			continue
		}
		if c.shortOK && !bracketLongEnough(c.query) {
			continue
		}
		if containsString(queries, c.query) {
			continue
		}
		queries = append(queries, c.query)
	}
	// Fill the remaining slots with shrunken forms.
	base := append([]string(nil), queries...)
outer:
	for _, q := range base {
		for _, alt := range shrinkQueries(q) {
			if !containsString(queries, alt) {
				queries = append(queries, alt)
			}
			if len(queries) >= maxQueries {
				break outer
			}
		}
	}
	return queries
}

// longEnough is the general "long enough to search" rule: three CJK characters,
// or two Latin words.
func longEnough(value string) bool {
	if value == "" {
		return false
	}
	if cjk := cjkCount(value); cjk > 0 {
		return cjk >= 3
	}
	return len(splitFields(value)) >= 2
}

// bracketLongEnough is the looser rule for the 《…》 candidate: two characters.
func bracketLongEnough(value string) bool {
	if value == "" {
		return false
	}
	if cjk := cjkCount(value); cjk > 0 {
		return cjk >= 2
	}
	return len(splitFields(value)) >= 2
}

// cjkCountRe matches one CJK or kana character.
//
// The ranges are written out as literal characters rather than \\uXXXX escapes,
// because Go's regexp has no such syntax.
var cjkCountRe = regexp.MustCompile("[぀-ヿ一-鿿]")

// cjkCount counts CJK and kana characters.
func cjkCount(value string) int { return len(cjkCountRe.FindAllString(value, -1)) }

// splitFields splits on whitespace, dropping empties.
func splitFields(value string) []string { return strings.Fields(value) }

// containsString reports whether the list holds the value.
func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// differs returns value when it is not the same as original, and empty
// otherwise, which is how an unchanged candidate is skipped.
func differs(value, original string) string {
	if value == original {
		return ""
	}
	return value
}

// removeString drops the first occurrence of a value.
func removeString(list []string, value string) []string {
	for i, item := range list {
		if item == value {
			return append(list[:i:i], list[i+1:]...)
		}
	}
	return list
}
