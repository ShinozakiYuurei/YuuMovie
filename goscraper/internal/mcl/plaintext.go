package mcl

import (
	"regexp"
	"strconv"
	"strings"
)

var (
	// brOrCloseRe turns a line break into a space before the tags are dropped.
	brOrCloseRe = regexp.MustCompile(`(?i)<br\s*/?\s*>|</p\s*>`)
	// tagRe removes everything else that looks like markup.
	tagRe = regexp.MustCompile(`<[^>]*>`)
	// spaceRunRe collapses the whitespace the replacements leave behind.
	// Go RE2 treats \s as ASCII only, so the ideographic space (U+3000) has
	// to be listed explicitly. It is everywhere in these synopses — the source
	// uses it to align cast lists — and leaving it in produced runs of full-width
	// blanks that the Node output collapsed.
	spaceRunRe = regexp.MustCompile(`[\s\x{3000}\x{00A0}\x{2000}-\x{200A}\x{202F}\x{205F}\x{3000}]+`)
	// entityRe matches a named entity or a numeric one.
	entityRe = regexp.MustCompile(`(?i)&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|nbsp);`)
)

// namedEntities are the HTML entities this circuit emits.
var namedEntities = map[string]string{
	"amp":  "&",
	"lt":   "<",
	"gt":   ">",
	"quot": "\"",
	"apos": "'",
	"nbsp": " ",
}

// plainText turns the circuit's HTML fragments into bare text.
//
// Numeric entities matter as much as the named five: the synopses carry both,
func plainText(value string) string {
	if value == "" {
		return ""
	}
	s := brOrCloseRe.ReplaceAllString(value, " ")
	s = tagRe.ReplaceAllString(s, " ")
	s = entityRe.ReplaceAllStringFunc(s, replaceEntity)
	return strings.TrimSpace(spaceRunRe.ReplaceAllString(s, " "))
}

// replaceEntity decodes one entity, leaving malformed input untouched.
func replaceEntity(match string) string {
	body := match[1 : len(match)-1]
	if !strings.HasPrefix(body, "#") {
		if decoded, ok := namedEntities[strings.ToLower(body)]; ok {
			return decoded
		}
		return match
	}

	hex := len(body) > 1 && (body[1] == 'x' || body[1] == 'X')
	digits := body[1:]
	base := 10
	if hex {
		digits = body[2:]
		base = 16
	}
	n, err := strconv.ParseInt(digits, base, 64)
	if err != nil {
		return match
	}
	// Out-of-range values and surrogates have no rune; leave them as text.
	if n <= 0 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF) {
		return match
	}
	return string(rune(n))
}
