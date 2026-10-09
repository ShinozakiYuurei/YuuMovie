package douban

import (
	"regexp"
	"strings"
)

// parenRe matches a bracketed run that a venue added: a session, a version or a
// bonus.
//
// 《》 is deliberately NOT in this set (2026-10-08). What is inside those is often
// the real title: "《這個殺手不太冷》(4K導演版)" loses its title entirely if the
// book marks are deleted with the bracket, which leaves an empty string and makes
// the search useless. The book marks are handled by CleanTitle instead, where
// they become spaces.
var parenRe = regexp.MustCompile(`[（(〔\[【{「『][^）)〕\]】}」』]*[）)〕\]】}」』]`)

// tailNoise matches trailing noise: bonus names, session notes, year ranges.
//
// These arrive without brackets, glued to the end of a title, so they need
// their own pass. Example: "…人魚島的秘密 Hi Bye Meet & Greet 見面場" is only the real
// title once the tail is removed.
//
// The three alternatives are compiled separately rather than as one alternation.
// The JavaScript version closes its repetition group with "))+", one ")" more
// than it opened, and relies on the engine reading the extra one as a literal.
// RE2 requires the parentheses to balance exactly and refuses to compile that, so
// the alternatives are applied in turn. The removals are the same because none of
// the three can match inside text another has already removed.
var (
	// A run of event words at the end of a title, with its leading space.
	tailWordsRe = regexp.MustCompile("(?i)(?:\\s+(?:Hi\\s+Bye|Meet\\s*&?\\s*Greet|見面場|特典場|特典|加碼|加場|優先場|優先|場次|見面會|安可|重映|encore|screener|fandub|dubbed|subbed|導演映後分享場|映後分享場|映後分享|電影分享會|分享會|應援場|應援|謝票|畫冊|杯墊|千秋樂|馬拉松|連映|限定|特別放映|特別加映|現場直播|紀念放映|開畫日|優先購票|首映場))+")

	// A release-year range such as "2024-2025".
	tailYearRangeRe = regexp.MustCompile("(?i)\\s+\\d{4}\\s*[–—-]\\s*\\d{2,4}\\b")

	// A festival or brand suffix that runs to the end of the string.
	tailSuffixRe = regexp.MustCompile("(?i)\\s+(?:NT\\s*Live|The\\s*Met|Royal\\s*Ballet|GFF|HKIFF)\\b.*$")
)

// formatBrandPhrases are multi-word brand names.
//
// Venues write the screening spec straight into the title (4DX, CGS, SCREENX,
// Infinity Vision), and searching those returns nothing: the 2026 reissue of
// 復仇者聯盟4 measured this. They exist for SEARCH QUERIES only and are
// deliberately not shared with enrichKey's format list, because changing that
// list would shift every cached key and orphan the existing rows.
//
// Only whole brands and fixed phrases are stripped. "Infinity" or "Vision" on
// their own may be part of a real title (Infinity Pool), so only the pair goes.
var formatBrandPhrases = []string{
	"infinity vision",
	"imax with laser",
}

// formatBrandWords are single-word brand names.
var formatBrandWords = []string{
	"imax", "4dx", "screenx", "cgs", "luxe", "mx4d",
	"dolby", "atmos", "cinity", "dubox", "dbox",
}

// StripFormatBrands removes screening brand words from a title.
func StripFormatBrands(value string) string {
	out := value
	for _, phrase := range formatBrandPhrases {
		out = replaceFold(out, phrase, " ")
	}
	for _, word := range formatBrandWords {
		// The pattern is (^|[^a-z0-9])word(?![a-z0-9]), which RE2 cannot express.
		// The leading boundary is the capture; the trailing one is checked by
		// hand, so "IMAX2D" survives as a different marker.
		re := mustCompile("(?i)(^|[^a-z0-9])" + regexp.QuoteMeta(word))
		out = replaceWordBoundary(re, out)
	}
	// Removing a brand can leave an orphan hyphen behind ("SCREENX - Some Film"),
	// and an emptied bracket looks bad ("(IMAX)" becomes "( )"), so both go.
	out = emptyParenRe.ReplaceAllString(out, " ")
	out = spaceRunRe.ReplaceAllString(out, " ")
	return strings.Trim(separatorTrimRe.ReplaceAllString(out, " "), " ")
}

// emptyParenRe matches brackets left empty by brand removal.
var emptyParenRe = regexp.MustCompile("\\(\\s*\\)|（\\s*）")

// separatorTrimRe strips orphan leading and trailing separators.
var separatorTrimRe = regexp.MustCompile("^[\\s|·•\\-–—]+|[\\s|·•\\-–—]+$")

// bracketTitleRe extracts the title from 《…》.
var bracketTitleRe = regexp.MustCompile("《([^》]+)》")

// BracketTitle returns the title inside 《…》, which is what a venue writes when
// the real title is inside book marks.
//
// Example: "《空槍》T-Shirt特典場" -> "空槍", and "《我阿爹想旅行》行得㗎啦見面場" ->
// "我阿爹想旅行". A fully decorated name cannot be found by Douban, but
// over-stripping can take the title with it, so this is kept as its own candidate.
func BracketTitle(value string) string {
	if match := bracketTitleRe.FindStringSubmatch(value); match != nil {
		return strings.TrimSpace(match[1])
	}
	return ""
}

// crossNormRe drops everything that is not a letter, digit, kana or CJK.
//
// This is the normalisation for the cross-check, and it removes case, spaces and
// punctuation entirely, so "Queen Budapest (2026)" and "queen budapest" are
// recognised as the same word.
var crossNormRe = regexp.MustCompile("[^a-z0-9぀-ヿ一-鿿]")

// crossNorm is the shared normalisation for the cross-check.
func crossNorm(value string) string {
	return crossNormRe.ReplaceAllString(strings.ToLower(value), "")
}

// SameSourceTitle reports whether the Chinese and English columns hold the same
// word, which means there is no translation ambiguity to lean on.
//
// "Queen Budapest (2026)" is written the same way in both columns, so the two
// columns verify each other and the cross axis is worthless: the only thing left
// to tell two films of that name apart is the year.
func SameSourceTitle(zh, en string) bool {
	a := crossNorm(zh)
	return a != "" && a == crossNorm(en)
}

// CrossYearOk is the year gate for same-source-name entries, and it is much
// stricter than PickCard's.
//
// PickCard allows 45 years back because a Hong Kong reissue of a translated title
// can be decades newer than the original (月黑高飛 in 2026 is The Shawshank
// Redemption from 1994). But that is only safe when there is an INDEPENDENT cross
// axis. A same-source name has no translation ambiguity to catch it, Douban's year
// should sit next to the Hong Kong year, and leniency there only admits mismatches:
// Queen Budapest in Hong Kong in 2026 came back as 《匈牙利狂想曲》 from 1986, 40
// years off.
//
// Three years covers a cross-year release and a next-year sequel, and cannot let
// a work 40 years away slip through. A missing year does not reject: there is
// nothing to judge by, and a real entry should not be lost for it.
func CrossYearOk(cardYear, doubanYear, year int) bool {
	if year == 0 || doubanYear == 0 {
		return true
	}
	return abs(cardYear-year) <= 3
}

// bookMarkRe splits the book marks out of a title.
var bookMarkRe = regexp.MustCompile("[《》]")

// trailingDashRe strips a trailing dash left by a removed bracket.
var trailingDashRe = regexp.MustCompile(`[\s\-–—]+$`)

// CleanTitle removes venue decoration: bracketed notes, 【】, book marks, tail
// noise and extra whitespace.
func CleanTitle(value string) string {
	out := parenRe.ReplaceAllString(value, " ")
	// Brackets can nest or sit side by side, so two passes are needed.
	out = parenRe.ReplaceAllString(out, " ")
	out = tailWordsRe.ReplaceAllString(out, " ")
	out = tailYearRangeRe.ReplaceAllString(out, " ")
	out = tailSuffixRe.ReplaceAllString(out, " ")
	out = bookMarkRe.ReplaceAllString(out, " ")
	out = spaceRunRe.ReplaceAllString(out, " ")
	return strings.TrimSpace(trailingDashRe.ReplaceAllString(out, ""))
}

// PickCard returns the card that corresponds to this film.
//
// Why this cannot compare titles as strictly as IMDb does: Douban's title is in
// SIMPLIFIED Chinese and the data stores TRADITIONAL (超风 against 超風), so a
// string comparison can never match. search_suggest has already ranked by
// relevance and the first result is what it considers the match, so the only
// check here is the YEAR gate, which keeps a same-name series or an older version
// out. The original card is kept so a human can check it.
//
// The window: Douban's year is the ORIGINAL premiere year, so a reissue sits far
// below the Hong Kong year (EVA 1997 against Hong Kong 2026). 45 years back is
// therefore allowed, but nothing forward.
func PickCard(cards []Card, year int) *Card {
	if len(cards) == 0 {
		return nil
	}
	if year == 0 {
		return &cards[0]
	}
	for i := range cards {
		cardYear := 0
		if cards[i].Year != "" {
			cardYear, _ = strconvAtoi(cards[i].Year)
		}
		if cardYear == 0 {
			// No year on the card: not a reason to reject.
			return &cards[i]
		}
		if cardYear <= year+1 && year-cardYear <= 45 {
			return &cards[i]
		}
	}
	return nil
}
