package synopsis

import (
	"net/url"
	"regexp"
	"strings"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/synopsiskey"
)

// WmoovEntry is one film in the wmoov index.
type WmoovEntry struct {
	ID    string
	Title string
}

// KinohkEntry is one film in the kinohk index.
type KinohkEntry struct {
	Slug  string
	Title string
	En    string
}

// Hkmovie6Entry is one film in the hkmovie6 index.
type Hkmovie6Entry struct {
	Slug  string
	Title string
}

// Index maps a synopsis key to the source entries under it.
//
// It is a list rather than a single entry because a key can genuinely have more
// than one: "Look Back" appears on wmoov twice, as "Look Back 驀然回首" and as
// "Look Back -驀然回首-". The caller walks the list and the English-name gate
// decides which one, if either, is the right film.
type Index struct {
	Wmoov    map[string][]WmoovEntry
	Kinohk   map[string][]KinohkEntry
	Hkmovie6 map[string][]Hkmovie6Entry
}

// NewIndex builds an empty index.
func NewIndex() *Index {
	return &Index{
		Wmoov:    map[string][]WmoovEntry{},
		Kinohk:   map[string][]KinohkEntry{},
		Hkmovie6: map[string][]Hkmovie6Entry{},
	}
}

// MergeWmoov folds another page's wmoov entries in.
func (i *Index) MergeWmoov(other map[string][]WmoovEntry) {
	for key, list := range other {
		for _, entry := range list {
			if !hasWmoov(i.Wmoov[key], entry.ID) {
				i.Wmoov[key] = append(i.Wmoov[key], entry)
			}
		}
	}
}

// MergeKinohk folds another page's kinohk entries in.
func (i *Index) MergeKinohk(other map[string][]KinohkEntry) {
	for key, list := range other {
		for _, entry := range list {
			if !hasKinohk(i.Kinohk[key], entry.Slug) {
				i.Kinohk[key] = append(i.Kinohk[key], entry)
			}
		}
	}
}

// MergeHkmovie6 folds another page's hkmovie6 entries in.
func (i *Index) MergeHkmovie6(other map[string][]Hkmovie6Entry) {
	for key, list := range other {
		for _, entry := range list {
			if !hasHkmovie6(i.Hkmovie6[key], entry.Slug) {
				i.Hkmovie6[key] = append(i.Hkmovie6[key], entry)
			}
		}
	}
}

func hasWmoov(list []WmoovEntry, id string) bool {
	for _, entry := range list {
		if entry.ID == id {
			return true
		}
	}
	return false
}

func hasKinohk(list []KinohkEntry, slug string) bool {
	for _, entry := range list {
		if entry.Slug == slug {
			return true
		}
	}
	return false
}

func hasHkmovie6(list []Hkmovie6Entry, slug string) bool {
	for _, entry := range list {
		if entry.Slug == slug {
			return true
		}
	}
	return false
}

// ---------- wmoov ----------

// wmoovTitleSuffixRe is the fixed tail in wmoov's link title attribute:
// "...電影資料、預告、戲院".
var wmoovTitleSuffixRe = regexp.MustCompile("(電影資料|電影預告|預告|上映戲院|放映時間|戲院).*$")

// wmoovLinkRe matches a detail link that carries a title attribute.
//
// Every /movie/details/<id> link is collected, not just the ones inside an <h3>:
// the "now showing" page lists 166 films and only 59 are in an <h3>, with the rest
// in a sidebar <ul class="nav-movie"> whose links are often image links with EMPTY
// inner text and the name only in the title attribute. Reading <h3> alone missed
// two thirds of the films, which is how the first pass under-filled the cache.
var wmoovLinkRe = regexp.MustCompile(`(?i)<a\b[^>]*href="/movie/details/(\d+)"[^>]*title="([^"]*)"`)

// wmoovHeadingRe matches the list items with no title attribute, whose name is in
// the inner text instead. A few layouts have those.
var wmoovHeadingRe = regexp.MustCompile(`(?i)<h3>\s*<a href="/movie/details/(\d+)"[^>]*>([\s\S]*?)</a>`)

// ParseWmoovIndex reads any wmoov page.
func ParseWmoovIndex(html string) map[string][]WmoovEntry {
	out := map[string][]WmoovEntry{}
	add := func(id, raw string) {
		title := strings.TrimSpace(wmoovTitleSuffixRe.ReplaceAllString(StripHTML(raw), ""))
		key := synopsiskey.Key(title)
		if key == "" {
			return
		}
		if hasWmoov(out[key], id) {
			return
		}
		out[key] = append(out[key], WmoovEntry{ID: id, Title: title})
	}
	for _, match := range wmoovLinkRe.FindAllStringSubmatch(html, -1) {
		add(match[1], match[2])
	}
	for _, match := range wmoovHeadingRe.FindAllStringSubmatch(html, -1) {
		add(match[1], match[2])
	}
	return out
}

// wmoovNamesRe matches the name row, which holds "Chinese (English)".
var wmoovNamesRe = regexp.MustCompile(`(?i)<dt>\s*名稱\s*[:：]?\s*</dt>\s*<dd>([\s\S]*?)</dd>`)

// trailingParenRe matches the "(English)" tail of a name row.
var trailingParenRe = regexp.MustCompile(`\s*\([^()]*\)\s*$`)

// trailingParenCaptureRe captures the same tail.
var trailingParenCaptureRe = regexp.MustCompile(`\(([^()]*)\)\s*$`)

// WmoovNames is the pair of names on a wmoov detail page.
type WmoovNames struct {
	Zh string
	En string
}

// ParseWmoovNames reads the name row.
func ParseWmoovNames(html string) WmoovNames {
	match := wmoovNamesRe.FindStringSubmatch(html)
	if match == nil {
		return WmoovNames{}
	}
	full := StripHTML(match[1])
	en := trailingParenCaptureRe.FindStringSubmatch(full)
	if en == nil {
		return WmoovNames{Zh: strings.TrimSpace(trailingParenRe.ReplaceAllString(full, ""))}
	}
	return WmoovNames{
		Zh: strings.TrimSpace(trailingParenRe.ReplaceAllString(full, "")),
		En: strings.TrimSpace(en[1]),
	}
}

// wmoovSynopsisRe matches the distributor's copy, which sits in a <p> carrying an
// id first and an itemprop second; either one is accepted because the two layouts
// differ on which is present.
var (
	wmoovSynopsisByIDRe = regexp.MustCompile(`(?i)<p[^>]*id="description"[^>]*>([\s\S]*?)</p>`)
	wmoovSynopsisPropRe = regexp.MustCompile(`(?i)<p[^>]*itemprop="description"[^>]*>([\s\S]*?)</p>`)
)

// ParseWmoovSynopsis reads the distributor's copy.
func ParseWmoovSynopsis(html string) string {
	if match := wmoovSynopsisByIDRe.FindStringSubmatch(html); match != nil {
		return StripHTML(match[1])
	}
	if match := wmoovSynopsisPropRe.FindStringSubmatch(html); match != nil {
		return StripHTML(match[1])
	}
	return ""
}

// ---------- hkmovie6 ----------

// hkmovie6LinkRe matches a film link. The title is in the path:
// /movie/<uuid>/<URL-encoded title>, with underscores for spaces, as in
// 柴可夫斯基《尤金．奧涅金》_(The_Met_2026).
//
// The site is a Nuxt application but it is SERVER-rendered, so the links and the
// text are both in the HTML and no browser is needed.
var hkmovie6LinkRe = regexp.MustCompile(`(?i)href="(/movie/[0-9a-f-]{36}/[^"?#]+)"`)

// ParseHkmovie6Index reads the hkmovie6 home page.
func ParseHkmovie6Index(html string) map[string][]Hkmovie6Entry {
	out := map[string][]Hkmovie6Entry{}
	for _, match := range hkmovie6LinkRe.FindAllStringSubmatch(html, -1) {
		slug := match[1]
		// The last path segment is the title, percent-encoded. A malformed escape
		// is skipped rather than kept as raw bytes: a key built from those would
		// never match anything.
		decoded, err := url.PathUnescape(lastSegment(slug))
		if err != nil {
			continue
		}
		title := strings.TrimSpace(strings.ReplaceAll(decoded, "_", " "))
		key := synopsiskey.Key(title)
		if key == "" {
			continue
		}
		if hasHkmovie6(out[key], slug) {
			continue
		}
		out[key] = append(out[key], Hkmovie6Entry{Slug: slug, Title: title})
	}
	return out
}

// lastSegment returns the part of a path after the final slash.
func lastSegment(path string) string {
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[i+1:]
	}
	return path
}

// hkmovie6SynopsisRe matches the synopsis container and its first block.
var hkmovie6SynopsisRe = regexp.MustCompile(`(?i)<div[^>]*class="[^"]*\bsynopsis\b[^"]*"[^>]*>\s*<div[^>]*>([\s\S]*?)</div>`)

// ParseHkmovie6Synopsis reads the first block inside the synopsis container.
func ParseHkmovie6Synopsis(html string) string {
	match := hkmovie6SynopsisRe.FindStringSubmatch(html)
	if match == nil {
		return ""
	}
	return StripHTML(match[1])
}
