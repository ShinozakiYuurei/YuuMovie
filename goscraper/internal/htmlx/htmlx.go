// Package htmlx holds the HTML helpers the circuit scrapers share.
//
// The Node side used a lookahead to find an opening tag whose class attribute
// contains a given name:
//
//	new RegExp('<' + tag + '\\b(?=[^>]*class="[^"]*\\b' + cls + '\\b[^"]*")[^>]*>', 'gi')
//
// RE2 has no lookahead, so the tag is matched without the class guard and the
// class attribute is checked afterwards on the matched text. That is not just a
// workaround: the lookahead only ever inspected the same tag text the match
// already covered, so the two are equivalent.
package htmlx

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// ClassAttrRe matches a class="..." attribute inside an opening tag.
var ClassAttrRe = regexp.MustCompile(`(?i)\bclass\s*=\s*"([^"]*)"`)

// HasClassWord reports whether the class attribute of an opening tag contains
// name as a whole word, mirroring \b in the original pattern.
//
// \b treats only ASCII alphanumerics and _ as word characters, so splitting on
// whitespace and comparing whole fields is equivalent for the class values the
// circuits emit.
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

// OpeningTagRe builds a regexp matching any opening tag of the given name. The
// class filter is applied by the caller through HasClassWord, because RE2
// cannot assert it inside the pattern.
func OpeningTagRe(tag string) *regexp.Regexp {
	return regexp.MustCompile(`(?i)<` + regexp.QuoteMeta(tag) + `\b[^>]*>`)
}

// OpeningTagOnlyRe is OpeningTagRe under a name that reads better at call sites
// which want a single match rather than a scan.
func OpeningTagOnlyRe(tag string) *regexp.Regexp { return OpeningTagRe(tag) }

// TagTokenRe matches any opening or closing tag of the given name, used for the
// depth scan in BlocksByClass.
func TagTokenRe(tag string) *regexp.Regexp {
	return regexp.MustCompile(`(?i)<\/?` + regexp.QuoteMeta(tag) + `\b[^>]*>`)
}

// TagBodyRe builds a regexp capturing the non-greedy body of a tag, the shape
// the JS used: <tag\b[^>]*>([\s\S]*?)</tag>.
func TagBodyRe(tag string) *regexp.Regexp {
	q := regexp.QuoteMeta(tag)
	return regexp.MustCompile(`(?is)<` + q + `\b[^>]*>(.*?)</` + q + `>`)
}

// BlocksByClass returns every element of the given tag whose class attribute
// contains className, including nested content.
//
// It is a direct port of blocksByClass in scrapers/other-circuits.js: find an
// opening tag, then walk same-name tags counting depth until the element closes.
// Self-closing tags (<br/>) do not change depth, matching the JS.
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

var tagStripRe = regexp.MustCompile(`<[^>]*>`)

// StripTags removes every tag, leaving a space in their place, like the first
// half of text() in other-circuits.js.
func StripTags(s string) string { return tagStripRe.ReplaceAllString(s, " ") }

// Text mirrors text() in other-circuits.js exactly: strip tags, THEN decode
// entities, THEN collapse whitespace.
//
// The order matters. Decoding can introduce whitespace (&nbsp; becomes a
// space), and the JS collapses only after that; collapsing first would leave
// those spaces behind and yield titles with stray double spaces.
func Text(s string) string {
	return strings.Join(strings.Fields(DecodeEntities(StripTags(s))), " ")
}

var (
	numRefRe     = regexp.MustCompile(`&#\d+;`)
	apostropheRe = regexp.MustCompile(`&#39;|&apos;`)
	nbspRe       = regexp.MustCompile(`&nbsp;|&#160;`)
)

// DecodeEntities decodes the HTML entities the circuits emit, in the same order
// as decode() in scrapers/other-circuits.js.
//
// The passes are sequential on purpose: the JS chains .replace() calls, so a
// doubly-escaped &amp;lt; decodes twice and ends up as a literal <. A
// single-pass replacer would stop at &lt; and quietly differ.
func DecodeEntities(s string) string {
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&quot;", "\"")
	s = apostropheRe.ReplaceAllString(s, "'")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = nbspRe.ReplaceAllString(s, " ")
	// Numeric character references: &#123;
	return numRefRe.ReplaceAllStringFunc(s, func(m string) string {
		n, err := strconv.Atoi(m[2 : len(m)-1])
		if err != nil || n < 0 || n > 0x10FFFF {
			return m
		}
		return string(rune(n))
	})
}

// FirstTextByClass returns the text of the first element of the given tag whose
// class contains className, mirroring firstText() in other-circuits.js.
//
// The JS pattern used a non-greedy body match, so a nested same-name element
// would end the capture early; that behaviour is kept here.
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

// AttrRe builds a regexp extracting an attribute value, mirroring attr() in
// scrapers/other-circuits.js.
//
// The name is quoted so an attribute called src cannot match inside data-src
// by accident.
func AttrRe(name string) *regexp.Regexp {
	return regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(name) + `\s*=\s*(?:"([^"]*)"|'([^']*)')`)
}

// Attr returns the value of the named attribute in a tag, entity-decoded. It
// returns an empty string when the attribute is absent, like the JS.
func Attr(tag, name string) string {
	m := AttrRe(name).FindStringSubmatch(tag)
	if m == nil {
		return ""
	}
	if m[1] != "" {
		return DecodeEntities(m[1])
	}
	return DecodeEntities(m[2])
}

// FirstMatch returns the first capture group of re in s, or an empty string.
func FirstMatch(re *regexp.Regexp, s string) string {
	m := re.FindStringSubmatch(s)
	if m == nil || len(m) < 2 {
		return ""
	}
	return m[1]
}

// AbsoluteURL resolves href against base, mirroring absoluteUrl() in
// other-circuits.js — including its fallback: an unparseable href yields the
// base itself rather than an error, because callers treat the result as
// "some URL to show" and an error there would drop a whole circuit.
func AbsoluteURL(base, href string) string {
	if href == "" {
		return base
	}
	b, err := url.Parse(base)
	if err != nil {
		return base
	}
	ref, err := url.Parse(DecodeEntities(strings.TrimSpace(href)))
	if err != nil {
		return base
	}
	return b.ResolveReference(ref).String()
}
