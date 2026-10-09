package scrapeutil

import (
	"net/url"
	"strings"
)

// ResolveURL resolves ref against base, falling back to base on any parse
// error. The fallback is not laziness: absoluteUrl() in the JS does the same,
// and callers treat the result as a URL to show, so returning an error would
// drop an entire circuit over one malformed href.
func ResolveURL(base, ref string) string {
	if ref == "" {
		return base
	}
	b, err := url.Parse(base)
	if err != nil {
		return base
	}
	ref2, err := url.Parse(strings.TrimSpace(ref))
	if err != nil {
		return base
	}
	return b.ResolveReference(ref2).String()
}
