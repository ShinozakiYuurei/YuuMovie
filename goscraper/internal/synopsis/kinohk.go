package synopsis

import (
	"regexp"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/synopsiskey"
)

// The two card shapes the site currently serves.
//
//   - /movies/now-showing wraps each card in an <article>. Its <a> is an overlay
//     covering the whole card and carries only the href and an aria-label; the title
//     lives in an <h2> and the English name in the <p> after it.
//   - /coming still wraps the card in the <a> itself, with the title in an <h3>.
//
// Both are matched. Reading only the older shape parses the newer pages to NOTHING,
// which is a silent failure rather than an error: the index comes back empty and
// every film looks like a miss, and a miss costs a week of cooldown. Measured
// 2026-10-09: now-showing has 32 <article> and 0 <h3>, coming has 137 <h3> and 0
// <article>, and the Node parser returns 0 keys for the now-showing page.
//
// Each card is bounded by ITS OWN closing tag rather than by the next link. Cutting
// at the next link loses a film: a card with no English name is followed by a
// section heading, and that heading's text is then read as this card's title, which
// pushes the real entry out of the index. That is how LINKIN PARK: UNSHATTER was
// being dropped.
var (
	kinohkArticleCardRe = regexp.MustCompile(`(?is)<article\b[\s\S]*?</article>`)
	kinohkAnchorCardRe  = regexp.MustCompile(`(?is)<a\b[^>]*href="/movie/[^"?#]+"[\s\S]*?</a>`)
)

// kinohkHrefRe reads the slug out of a card's link.
var kinohkHrefRe = regexp.MustCompile(`(?i)<a\b[^>]*href="(/movie/[^"?#]+)"`)

// kinohkTitleRe matches the title in the newer layout's <h2>.
var kinohkTitleRe = regexp.MustCompile(`(?is)<h2\b[^>]*>([\s\S]*?)</h2>`)

// kinohkOldTitleRe matches the title in the older layout's <h3>.
var kinohkOldTitleRe = regexp.MustCompile(`(?is)<h3\b[^>]*>([\s\S]*?)</h3>`)

// kinohkAliasSpanRe matches the alias span, which sits inside the older title.
var kinohkAliasSpanRe = regexp.MustCompile(`(?is)<span[\s\S]*?</span>`)

// kinohkEnglishRe matches the English name, which is the first <p> in the card.
var kinohkEnglishRe = regexp.MustCompile(`(?is)<p[^>]*>([^<]*)</p>`)

// ParseKinohkIndex reads a kinohk listing page, whichever layout it serves.
func ParseKinohkIndex(html string) map[string][]KinohkEntry {
	out := map[string][]KinohkEntry{}
	seenSlugs := map[string]bool{}
	for _, re := range []*regexp.Regexp{kinohkArticleCardRe, kinohkAnchorCardRe} {
		for _, card := range re.FindAllString(html, -1) {
			addKinohkCard(out, seenSlugs, card)
		}
	}
	return out
}

// addKinohkCard folds one card into the index.
func addKinohkCard(out map[string][]KinohkEntry, seenSlugs map[string]bool, block string) {
	href := kinohkHrefRe.FindStringSubmatch(block)
	if href == nil {
		return
	}
	slug := href[1]
	if seenSlugs[slug] {
		return
	}

	titleMatch := kinohkTitleRe.FindStringSubmatch(block)
	if titleMatch == nil {
		titleMatch = kinohkOldTitleRe.FindStringSubmatch(block)
	}
	if titleMatch == nil {
		return
	}
	// The older layout wraps an alias in a span inside the title, and that span is
	// not part of the name.
	title := StripHTML(kinohkAliasSpanRe.ReplaceAllString(titleMatch[1], ""))

	key := synopsiskey.Key(title)
	if key == "" {
		return
	}
	if hasKinohk(out[key], slug) {
		return
	}

	en := ""
	if english := kinohkEnglishRe.FindStringSubmatch(block); english != nil {
		en = StripHTML(english[1])
	}
	seenSlugs[slug] = true
	out[key] = append(out[key], KinohkEntry{Slug: slug, Title: title, En: en})
}

// kinohkCreditRe finds the site credit that sits immediately after the synopsis.
//
// The synopsis is the paragraph BEFORE this credit, and the credit has to be
// stripped: it is kinohk's attribution, not part of the text.
var kinohkCreditRe = regexp.MustCompile(`簡介由本站整理|簡介由本站|資料由本站`)

// kinohkParagraphRe matches one paragraph.
var kinohkParagraphRe = regexp.MustCompile(`(?is)<p[^>]*>([\s\S]*?)</p>`)

// ParseKinohkSynopsis reads the synopsis, which is the paragraph before the credit.
func ParseKinohkSynopsis(html string) string {
	marker := kinohkCreditRe.FindStringIndex(html)
	if marker == nil {
		return ""
	}
	before := html[:marker[0]]
	paragraphs := kinohkParagraphRe.FindAllStringSubmatch(before, -1)
	if len(paragraphs) == 0 {
		return ""
	}
	last := paragraphs[len(paragraphs)-1]
	return StripHTML(last[1])
}
