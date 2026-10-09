package broadway

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// slugify builds the route slug for a film.
//
// The English name wins and the Chinese one is never mixed in: the English
// side already carries the format marker ("IMAX Resident Evil"), so joining
// both would repeat it and yield "imax-resident-evil-imax-1286". Where this
// circuit has no English name at all, scrape.js recomputes the slug at merge
// time through its ASCII-only slugify, so a Chinese base here is corrected
// downstream rather than 404ing.
func slugify(nameZh, nameEn string, id int) string {
	base := strings.ToLower(firstNonEmpty(nameEn, nameZh))
	tail := strconv.Itoa(id)
	if i := strings.LastIndex(tail, ":"); i >= 0 {
		tail = tail[i+1:]
	}
	var b strings.Builder
	prevDash := false
	for i := 0; i < len(base); i++ {
		c := base[i]
		isAlnum := (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
		if isAlnum {
			b.WriteByte(c)
			prevDash = false
			continue
		}
		// Collapse every run of non-alphanumerics into one dash.
		if !prevDash {
			b.WriteByte('-')
			prevDash = true
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		return "movie-" + tail
	}
	return s + "-" + tail
}

var tagStripRe = regexp.MustCompile(`<[^>]*>`)

// One backslash: inside a raw string a doubled \\ would mean a literal
// backslash followed by s, which matches nothing in a synopsis.
var spaceRunRe = regexp.MustCompile(`\s+`)
var nbspRe = regexp.MustCompile(`&nbsp;`)
var ampRe = regexp.MustCompile(`&amp;`)

// stripHTML removes tags, decodes the two entities the circuit emits and
// collapses whitespace.
//
// The entities matter: this circuit stores synopses as HTML fragments, and
// 87 of 196 synopses still carried a literal "&nbsp;" when only the tags were
// stripped.
func stripHTML(s string) string {
	s = tagStripRe.ReplaceAllString(s, " ")
	s = nbspRe.ReplaceAllString(s, " ")
	s = ampRe.ReplaceAllString(s, "&")
	return strings.TrimSpace(spaceRunRe.ReplaceAllString(s, " "))
}

// hktISO converts an instant to Hong Kong wall-clock time with milliseconds,
// matching the JS toISOString().replace('Z', '+08:00').
func hktISO(s string) string {
	if s == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return ""
	}
	return t.In(scrapeutilHKT()).Format("2006-01-02T15:04:05.000") + "+08:00"
}

// hktDate returns the Hong Kong calendar date of an instant.
func hktDate(s string) string {
	if s == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return ""
	}
	return t.In(scrapeutilHKT()).Format("2006-01-02")
}
