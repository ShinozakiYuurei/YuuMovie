package broadway

import "regexp"

// hasCJK reports whether a string contains a Chinese character.
//
// The character class is written with literal runes: Go's regexp does not
// accept the \uXXXX escapes that the JS original used.
var cjkRe = regexp.MustCompile("[㐀-䶿一-鿿豈-﫿]")

func hasCJK(s string) bool { return cjkRe.MatchString(s) }
