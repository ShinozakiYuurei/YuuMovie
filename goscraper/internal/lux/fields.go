package lux

import (
	"strconv"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// number reads a numeric field from the page payload, treating anything else as
// zero. The devalue evaluator produces float64 for every number, but a string
// is accepted too because the site is not consistent about quoting dates.
func number(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case string:
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return 0
		}
		return f
	}
	return 0
}

// textOrFirstString reads a string field, accepting either a plain string or a
// list of them.
//
// The venue's name and address arrive as plain strings, but the sibling circuit
// publishes the same kind of value as a list, and the site has no reason to
// pick one shape for the life of the project. Reading only the list form is what
// silently dropped the venue's real address and left the fallback in place, so
// both are handled.
func textOrFirstString(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	list, ok := value.([]any)
	if !ok {
		return ""
	}
	for _, item := range list {
		if s, ok := item.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

// nullableInt turns zero into nil, matching the Number(x) || null the JS uses
// for durations.
func nullableInt(value int64) *int {
	if value == 0 {
		return nil
	}
	n := int(value)
	return &n
}

// nullableFloat turns zero into nil, matching the Number(x) || null the JS uses
// for prices.
func nullableFloat(value int64) *float64 {
	if value == 0 {
		return nil
	}
	f := float64(value)
	return &f
}

// mapURLFor builds the map link for the venue.
//
// The site publishes no map link for this address, so the search URL the JS
// built is used instead. When the page does carry one it wins.
func mapURLFor(page *cinemaPage) string {
	if page.MapURL != "" {
		return page.MapURL
	}
	return scrapeutil.MapSearch(mapQueryName, page.Address)
}
