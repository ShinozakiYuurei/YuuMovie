package goldenscene

import (
	"strconv"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// localized reads the Traditional Chinese value out of a {zhHK, enGB} object.
//
// This circuit writes every user-visible string twice, once per language, and
// the site is a Traditional Chinese one, so zhHK is what the Node scraper took
// first. enGB is only the fallback.
func localized(value any) string {
	obj, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	if s, _ := obj["zhHK"].(string); s != "" {
		return s
	}
	return ""
}

// enText reads the English value out of a {zhHK, enGB} object.
func enText(value any) string {
	obj, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	s, _ := obj["enGB"].(string)
	return s
}

// text reads a plain string field.
func text(value any) string {
	s, _ := value.(string)
	return s
}

// number reads a numeric field, treating anything else as zero.
func number(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case string:
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return 0
		}
		return f
	}
	return 0
}

// optionalNumber reports a numeric field and whether one was there at all.
//
// The distinction matters for the price: the site publishes a literal 0 for a
// free screening, and the JS reads it with Number.isFinite, so an absent price
// (null) has to stay null rather than collapse to 0 and render as free.
func optionalNumber(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case string:
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return 0, false
		}
		return f, true
	}
	return 0, false
}

// nullable turns an empty string into nil.
func nullable(s string) *string { return scrapeutil.NullableString(s) }

// intPtr turns zero into nil, matching the Number(x) || null the JS uses.
func intPtr(n float64) *int {
	i := int(n)
	if i == 0 {
		return nil
	}
	return &i
}

// optionalFloat keeps a zero price and drops an absent one.
//
// Unlike the duration, the price is read with Number.isFinite(Number(x)) rather
// than `|| null`, so a free screening really does publish 0 and dropping it would
// render as "price unknown".
func optionalFloat(value any) *float64 {
	n, ok := optionalNumber(value)
	if !ok {
		return nil
	}
	return &n
}

// nameList flattens a list of localised objects into plain names, dropping
// entries with neither language.
//
// It is used for genres, where each item is {zhHK, enGB}, and for versionTags,
// which the site renders as one space-joined label.
func nameList(value any) []string {
	list, ok := value.([]any)
	if !ok {
		return []string{}
	}
	out := make([]string, 0, len(list))
	for _, item := range list {

		// versionTags wrap the localised pair in a `name` field, one level
		// deeper than genres and credits do.
		if obj, ok := item.(map[string]any); ok {
			if nested, ok := obj["name"]; ok {
				item = nested
			}
		}

		if s := firstNonEmpty(localized(item), enText(item)); s != "" {
			out = append(out, s)
			continue
		}
		if s := text(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// joinNames flattens a list into one comma-separated credit line.
func joinNames(value any) *string {
	names := nameList(value)
	if len(names) == 0 {
		return nil
	}
	return scrapeutil.NullableString(strings.Join(names, ", "))
}

// firstNonEmpty returns the first non-empty candidate.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// firstString reads a list of plain strings and returns the first.
func firstString(value any) *string {
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	for _, item := range list {
		if s := text(item); s != "" {
			return &s
		}
	}
	return nil
}

// epochDate converts the site's second-based timestamp to a Hong Kong date.
func epochDate(value any) string {
	seconds := number(value)
	if seconds == 0 {
		return ""
	}
	return time.Unix(int64(seconds), 0).In(scrapeutil.HKT).Format("2006-01-02")
}

// epochHkt converts the site's second-based timestamp to Hong Kong wall-clock
// time with the +08:00 offset the rest of the data uses.
func epochHkt(value any) string {
	seconds := number(value)
	if seconds == 0 {
		return ""
	}
	return time.Unix(int64(seconds), 0).In(scrapeutil.HKT).Format("2006-01-02T15:04:05.000") + "+08:00"
}
