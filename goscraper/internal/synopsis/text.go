package synopsis

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// breakRe matches the tags that end a line of text, so their content is not run
// together when the tags are removed.
var breakRe = regexp.MustCompile("(?i)<br\\s*/?\\s*>|</p>|</div>")

// tagRe matches any remaining tag.
var tagRe = regexp.MustCompile("<[^>]*>")

// entityRe matches an HTML entity, named or numeric.
var entityRe = regexp.MustCompile("(?i)&(#x?[0-9a-f]+|[a-z]+);")

// spaceRunRe folds runs of whitespace.
var spaceRunRe = regexp.MustCompile(`\\s+`)

// entities are the named ones this project has ever needed. Anything else is left
// as written, which is better than guessing.
var entities = map[string]string{
	"amp": "&", "lt": "<", "gt": ">", "quot": `"`, "apos": "'", "nbsp": " ",
}

// StripHTML turns markup into plain text.
//
// The order is the same as every other scraper here: break the lines first, drop
// the tags, resolve the entities, squeeze the whitespace. Doing it in any other
// order would run two sentences together wherever a <p> sat.
func StripHTML(value string) string {
	text := breakRe.ReplaceAllString(value, " ")
	text = tagRe.ReplaceAllString(text, "")
	text = entityRe.ReplaceAllStringFunc(text, func(match string) string {
		groups := entityRe.FindStringSubmatch(match)
		entity := groups[1]
		if named, ok := entities[strings.ToLower(entity)]; ok {
			return named
		}
		if entity[0] == '#' {
			hex := len(entity) > 1 && (entity[1] == 'x' || entity[1] == 'X')
			digits := entity[1:]
			if hex {
				digits = entity[2:]
			}
			n, err := strconv.ParseUint(digits, base(hex), 32)
			if err != nil {
				return match
			}
			// A code point outside the Unicode range, or a surrogate half, is not a
			// character and would panic or produce junk if it were passed through.
			if n == 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) {
				return match
			}
			return string(rune(n))
		}
		return match
	})
	return strings.TrimSpace(spaceRunRe.ReplaceAllString(text, " "))
}

// base returns the radix for a numeric entity.
func base(hex bool) int {
	if hex {
		return 16
	}
	return 10
}

// cjkRe matches a CJK character. The upper bound is written out as a literal
// because Go's regexp has no \\uXXXX syntax.
var cjkRe = regexp.MustCompile("[㐀-鿿]")

// placeholderRe matches text that is only dashes and spaces.
var placeholderRe = regexp.MustCompile("^[-—–\\s]+$")

// UsableSynopsis reports whether a synopsis is worth keeping.
//
// Three things are rejected, and all three have been seen in the wild:
//
//   - nothing, or text with no Chinese in it, which means the site answered with
//     something other than a synopsis;
//   - a placeholder such as "--";
//   - a fragment shorter than 20 characters, which is a tagline rather than a
//     synopsis and reads badly on a card.
func UsableSynopsis(text string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || !cjkRe.MatchString(trimmed) {
		return ""
	}
	if placeholderRe.MatchString(trimmed) {
		return ""
	}
	if utf8Len(trimmed) < 20 {
		return ""
	}
	return trimmed
}

// utf8Len counts runes, which is what "length" means for the 20-character floor.
func utf8Len(value string) int { return len([]rune(value)) }

// unusedUnicode keeps the unicode import honest for a future caller.
var _ = unicode.IsLetter
