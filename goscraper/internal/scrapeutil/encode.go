package scrapeutil

import (
	"encoding/hex"
	"strings"
)

// encodeURIComponent mirrors the JavaScript function of the same name: it leaves
// A-Za-z0-9 and -_.!~*'() alone and percent-encodes every other byte.
//
// net/url.QueryEscape is NOT a substitute: it escapes !'()* and turns spaces
// into +. The difference is visible in every cinema map link, which is why this
// is a byte-for-byte reimplementation rather than a call to the standard
// library.
func encodeURIComponent(s string) string {
	const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if strings.IndexByte(unreserved, c) >= 0 {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteString(strings.ToUpper(hex.EncodeToString([]byte{c})))
	}
	return b.String()
}
