package mcl

import (
	"strings"
	"unicode"
)

// nfkcWidthRe finds the full-width forms NFKC folds to ASCII.
//
// The comparison between the listing title and the detail title has to be
// normalisation-insensitive: the same film comes back as "以你的名字呼喚我 (特別放映)"
// from one endpoint and "以你的名字呼喚我（特別放映）" from the other, and a byte
// comparison would reject a valid match and silently drop the metadata.
func normalizeNFKC(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r == '\u3000':
			b.WriteRune(' ')
		case r >= '\uFF01' && r <= '\uFF5E':
			// Full-width ASCII maps back to its half-width twin.
			b.WriteRune(r - 0xFEE0)
		default:
			if unicode.IsSpace(r) {
				b.WriteRune(' ')
				continue
			}
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}
