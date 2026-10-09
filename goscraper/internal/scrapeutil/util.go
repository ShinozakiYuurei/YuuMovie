// Package scrapeutil holds the small helpers every circuit scraper needs.
//
// They mirror the free functions at the top of scrapers/other-circuits.js.
// Keeping them here rather than duplicating per circuit matters because the
// id scheme (Digest) and the Hong Kong date handling are part of the data
// contract with lib/data.ts: the same inputs must produce the same ids and the
// same dates, or slugs and grouping shift between runs.
package scrapeutil

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// HKT is the fixed Hong Kong offset. The territory has had no DST since 1979,
// so a fixed zone is correct and keeps the arithmetic free of tzdata lookups.
var HKT = time.FixedZone("HKT", 8*60*60)

// Digest is the 14-character sha1 prefix the JS used for generated ids.
//
// Truncating to 14 hex chars is deliberate: it is what the live data already
// contains, so changing it would rewrite every sunbeam/newport id and orphan
// the existing rows in data/sources/*.json.
func Digest(value string) string {
	sum := sha1.Sum([]byte(value))
	return hex.EncodeToString(sum[:])[:14]
}

// TodayHKT is the current date in Hong Kong as YYYY-MM-DD, matching todayHkt().
func TodayHKT() string { return NowHKT().Format("2006-01-02") }

// NowHKT is the current instant expressed in Hong Kong wall-clock time.
func NowHKT() time.Time { return time.Now().In(HKT) }

// DateFromDMY formats a date, zero-padding month and day, like dateFromDmy().
func DateFromDMY(day, month, year int) string {
	return fmt.Sprintf("%04d-%02d-%02d", year, month, day)
}

// DMYDate resolves a day/month pair to a full date near today, like dmyDate().
//
// Schedules list "10/1" without a year, so the year is inferred from the
// current month: a January date seen in December is next year's, and a December
// date seen in January belongs to the previous year. Without this the site
// would show next January's screenings as a year in the past for one week
// every December.
func DMYDate(day, month int, now time.Time) string {
	year := now.In(HKT).Year()
	currentMonth := int(now.In(HKT).Month())
	if currentMonth == 12 && month == 1 {
		year++
	}
	if currentMonth == 1 && month == 12 {
		year--
	}
	return DateFromDMY(day, month, year)
}

// MapSearch builds the Google Maps search URL the JS used, so the "open in
// maps" link on cinema pages keeps pointing at the same place.
func MapSearch(name, address string) string {
	// The JS built the query as [name, address].filter(Boolean).join(' '),
	// so an empty address contributes nothing — not even a trailing space.
	query := name
	if address != "" {
		query += " " + address
	}
	return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query)
}

var scriptStyleRe = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>|<style[^>]*>.*?</style>`)

// StripScripts removes script and style blocks, like stripScripts().
//
// Several circuits embed the schedule as JSON inside a <script>, and leaving it
// in makes class-based block scanning pick up matches from the data as well as
// the markup.
func StripScripts(html string) string { return scriptStyleRe.ReplaceAllString(html, " ") }

var jsHexEscapeRe = regexp.MustCompile(`(?i)\\x([0-9a-f]{2})`)

// DecodeJSString unescapes a JavaScript string literal body, like
// decodeJsString().
//
// The JS normalises \\xHH escapes to \\u00HH and then runs JSON.parse on the
// quoted result, falling back to the raw text when that throws. Both steps are
// reproduced here: the fallback is load-bearing, because a malformed escape in
// a film title should degrade to visible-but-wrong text rather than dropping
// the whole film.
func DecodeJSString(value string) string {
	normalized := jsHexEscapeRe.ReplaceAllStringFunc(value, func(m string) string {
		return `\u00` + m[2:]
	})
	var out string
	if err := json.Unmarshal([]byte(`"`+normalized+`"`), &out); err != nil {
		return normalized
	}
	return out
}

// ParsePrice converts a price string to a float, returning nil when it is not
// a number. The JS wrote `Number.isFinite(price) ? price : null`, and the
// distinction matters: a null price renders as "price unknown" while 0 would
// render as free.
func ParsePrice(s string) *float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	return &f
}

// NullableString returns nil for an empty string, matching the JS where an
// absent value became null rather than "".
func NullableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// NullableInt returns nil for a non-positive parse, used for durations where
// the page omits the value or prints 0.
func NullableInt(n int) *int {
	if n == 0 {
		return nil
	}
	return &n
}
