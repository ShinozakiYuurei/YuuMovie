// Package htmlx holds the HTML helpers the circuit scrapers share.
//
// The Node side used a lookahead to find an opening tag whose class attribute
// contains a given name:
//
//	new RegExp('<' + tag + '\\b(?=[^>]*class="[^"]*\\b' + cls + '\\b[^"]*")[^>]*>', 'gi')
//
// RE2 has no lookahead, so the tag is matched without the class guard and the
// class attribute is checked afterwards on the matched text. That is not just
// a workaround: it is how the JS behaved anyway, since the lookahead only ever
// inspected the same tag text the match already covered.
package htmlx

import (
	"regexp"
	"strconv"
	"strings"
)

// ClassAttrRe matches a class="..." attribute inside an opening tag.
var ClassAttrRe = regexp.MustCompile(`(?i)\bclass\s*=\s*"([^"]*)"`)

// HasClassWord reports whether the class attribute of an opening tag contains
// name as a whole word, mirroring \b in the original pattern.
//
// The boundary test treats only ASCII alphanumerics and _ as word characters,
// which is what \b means in JS and in RE2 alike.
func HasClassWord(tag, name string) bool {
	m := ClassAttrRe.FindStringSubmatch(tag)
	if m == nil {
		return false
	}
	for _, field := range strings.Fields(m[1]) {
		if field == name {
			return true
		}
	}
	return false
}

// OpeningTagRe builds a regexp matching any opening tag of the given name.
// The class filter is applied by the caller through HasClassWord, because RE2
// cannot assert it inside the pattern.
func OpeningTagRe(tag string) *regexp.Regexp {
	return regexp.MustCompile(`(?i)<` + regexp.QuoteMeta(tag) + `\b[^>]*>`)
}

// TagTokenRe matches any opening or closing tag of the given name, used for
// the depth scan in BlocksByClass.
func TagTokenRe(tag string) *regexp.Regexp {
	return regexp.MustCompile(`(?i)<\/?` + regexp.QuoteMeta(tag) + `\b[^>]*>`)
}

// BlocksByClass returns every element of the given tag whose class attribute
// contains className, including nested content.
//
// It is a direct port of blocksByClass in scrapers/other-circuits.js: find an
// opening tag, then walk same-name tags counting depth until the element
// closes. Self-closing tags (<br/>) do not change depth, matching the JS.
func BlocksByClass(html, className, tag string) []string {
	opening := OpeningTagRe(tag)
	token := TagTokenRe(tag)

	var blocks []string
	for _, loc := range opening.FindAllStringIndex(html, -1) {
		if !HasClassWord(html[loc[0]:loc[1]], className) {
			continue
		}
		depth := 1
		end := -1
		// Resume the token scan just past this opening tag.
		rest := html[loc[1]:]
		for _, tloc := range token.FindAllStringIndex(rest, -1) {
			tagText := rest[tloc[0]:tloc[1]]
			switch {
			case strings.HasPrefix(tagText, "</"):
				depth--
			case strings.HasSuffix(tagText, "/>"):
				// self-closing: no depth change
			default:
				depth++
			}
			if depth == 0 {
				end = loc[1] + tloc[1]
				break
			}
		}
		if end >= 0 {
			blocks = append(blocks, html[loc[0]:end])
		}
	}
	return blocks
}

// StripTags removes tags and collapses whitespace, like text() in
// other-circuits.js. Entities are decoded by DecodeEntities.
func StripTags(s string) string {
	s = regexp.MustCompile(`<[^>]*>`).ReplaceAllString(s, " ")
	return strings.Join(strings.Fields(s), " ")
}

// Text mirrors text() in other-circuits.js: strip tags, decode entities,
// collapse runs of whitespace.
func Text(s string) string {
	return DecodeEntities(StripTags(s))
}

// DecodeEntities decodes the handful of HTML entities the circuits emit.
// Numeric references are decoded too, as the JS does.
func DecodeEntities(s string) string {
	r := strings.NewReplacer(
		"&amp;", "&",
		"&quot;", "\"",
		"&#39;", "'",
		"&apos;", "'",
		"&lt;", "<",
		"&gt;", ">",
		"&nbsp;", " ",
		"&#160;", " ",
	)
	s = r.Replace(s)
	// Numeric character references: &#123;
	s = numRefRe.ReplaceAllStringFunc(s, func(m string) string {
		n, err := strconv.Atoi(m[2 : len(m)-1])
		if err != nil || n < 0 || n > 0x10FFFF {
			return m
		}
		return string(rune(n))
	})
	return s
}

var numRefRe = regexp.MustCompile(`&#\d+;`)

// FirstTextByClass returns the text of the first element of the given tag
// whose class contains className, mirroring firstText() in other-circuits.js.
//
// The JS pattern used a non-greedy body match, so a nested same-name element
// would end the capture early — that behaviour is kept here.
func FirstTextByClass(html, tag, className string) string {
	opening := OpeningTagRe(tag)
	closeRe := regexp.MustCompile(`(?i)</` + regexp.QuoteMeta(tag) + `\s*>`)
	for _, loc := range opening.FindAllStringIndex(html, -1) {
		if !HasClassWord(html[loc[0]:loc[1]], className) {
			continue
		}
		body := html[loc[1]:]
		if c := closeRe.FindStringIndex(body); c != nil {
			return Text(body[:c[0]])
		}
		return ""
	}
	return ""
}
