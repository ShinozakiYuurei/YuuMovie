package mcl

import (
	"regexp"
	"strconv"
	"strings"
)

var (
	// noticeMarker finds the first sign that the text has stopped being a synopsis.
	//
	// The `i` field carries the plot AND the screening notes, sometimes in one
	// paragraph: a normal show gets a plain synopsis, while a special or early-bird
	// show gets gift-redemption terms ("凡購買…戲票 1 張，可獲贈…"), and films like
	// the 4K A Better Tomorrow restore simply concatenate the two. Copying the field
	// wholesale turns the detail page's plot section into a shopping notice, which is
	// what the user reported on 2026-10-04.
	//
	// The markers come from checking all 107 cached details that day: 29 were
	// truncated, of which 9 became empty, and no real synopsis was cut away.
	noticeMarker = regexp.MustCompile("備註|凡購買|條款及細則|\U0001F381|紀念選映限定特典|MCL獨家觀影特典|限定特典|觀影特典|特典場送|放映時間")

	// noticeDanglingRe strips the label fragments a cut leaves at the end.
	//
	// These are tag-like words rather than sentences, so a truncated plot ending
	// in "MCL獨家" would read as broken text.
	noticeDanglingRe = regexp.MustCompile("(?:\\s*(?:紀念選映|MCL獨家|獨家|應援|直播|限定特典|觀影特典|特典))+$")

	// trailingPunctuationRe removes the separators a cut leaves behind.
	trailingPunctuationRe = regexp.MustCompile(`[\s、，；：|·]+$`)

	// specialProgrammeRe removes the bracketed label from the genre list.
	specialProgrammeRe = regexp.MustCompile(`\s*[（(]特備節目[）)]\s*`)

	// genreSplitRe separates the genre list.
	genreSplitRe = regexp.MustCompile(`[、/,，;；]`)

	// durationRe reads the runtime, with or without a unit.
	durationRe = regexp.MustCompile(`(?i)^([0-9]{1,3})(?:\s*(?:分鐘|分|minutes?|mins?))?$`)
)

// mclSynopsis strips the screening notes off the end of a plot summary.
func mclSynopsis(value string) string {
	text := plainText(value)
	notice := noticeMarker.FindStringIndex(text)
	if notice == nil {
		return text
	}
	text = text[:notice[0]]
	text = noticeDanglingRe.ReplaceAllString(text, "")
	text = trailingPunctuationRe.ReplaceAllString(text, "")
	return strings.TrimSpace(text)
}

// mclSlug builds the route slug for a film.
//
// MCL publishes no English title, so the Chinese name is the only base. That is
// why the slug is generated from the title here rather than from nameEn: a newly
// filled-in English name must not change an already published
// /movie/movie-mcl-14743 link.
func mclSlug(title string, id int) string {
	base := strings.ToLower(title)
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
		if !prevDash {
			b.WriteByte('-')
			prevDash = true
		}
	}
	s := strings.Trim(b.String(), "-")
	if len(s) > 60 {
		s = s[:60]
	}
	s = strings.TrimRight(s, "-")
	if s == "" {
		return "movie-mcl-" + strconv.Itoa(id)
	}
	return s + "-mcl-" + strconv.Itoa(id)
}

// splitGenres trims and drops empty entries.
func splitGenres(value string) []string {
	text := specialProgrammeRe.ReplaceAllString(plainText(value), "")
	parts := genreSplitRe.Split(text, -1)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
