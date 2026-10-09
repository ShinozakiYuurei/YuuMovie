package mcl

import (
	"encoding/json"
	"strconv"
	"strings"
)

// rawDetail is one entry of GetMovieDetails.aspx.
//
// Only the fields this scraper reads are declared. The endpoint also returns
// trailers and stills, which are deliberately dropped: they are large and
// nothing here consumes them.
type rawDetail struct {
	ID json.RawMessage `json:"id"`
	MN string          `json:"mn"`
	B  struct {
		MRT string `json:"mrt"`
		MC  string `json:"mc"`
		MG  string `json:"mg"`
		ML  string `json:"ml"`
		MS  string `json:"ms"`
	} `json:"b"`
	E struct {
		MD string `json:"md"`
		MC string `json:"mc"`
	} `json:"e"`
	I string `json:"i"`
}

// detail is the normalised metadata for one film.
type detail struct {
	NameZh      string
	NameEn      string
	Duration    *int
	Category    *string
	Dialect     *string
	Subtitle    *string
	Genres      []string
	Director    *string
	Cast        *string
	Description string
}

// parseDetail turns one raw entry into normalised metadata.
//

// The numeric id must match, and when the listing knows the title it must match
// too. The endpoint reuses ids, so binding a detail to the wrong film would
// silently corrupt its card; the listing occasionally omits a film that is still
// scheduling, and that case falls back to the id alone.
func parseDetail(raw []json.RawMessage, id int, title string) *detail {
	if len(raw) != 1 {
		return nil
	}
	var info rawDetail
	if err := json.Unmarshal(raw[0], &info); err != nil {
		return nil
	}

	gotID, err := strconv.Atoi(textOfRaw(info.ID))
	if err != nil || gotID != id {
		return nil
	}
	name := strings.TrimSpace(info.MN)
	if name == "" {
		return nil
	}
	expected := normalizeNFKC(strings.TrimSpace(title))
	if expected != "" && normalizeNFKC(name) != expected {
		return nil
	}

	duration := parseDuration(plainText(info.B.MRT))
	category := strings.ToUpper(plainText(info.B.MC))

	return &detail{
		NameZh:      name,
		NameEn:      verifiedEnglishTitles[strconv.Itoa(id)+"|"+info.MN],
		Duration:    duration,
		Category:    categoryPtr(category),
		Dialect:     nullableText(plainText(info.B.ML)),
		Subtitle:    nullableText(plainText(info.B.MS)),
		Genres:      splitGenres(info.B.MG),
		Director:    nullableText(plainText(info.E.MD)),
		Cast:        nullableText(plainText(info.E.MC)),
		Description: mclSynopsis(info.I),
	}
}

// parseDuration reads the runtime, rejecting implausible values.
func parseDuration(text string) *int {
	m := durationRe.FindStringSubmatch(text)
	if m == nil {
		return nil
	}
	n, err := strconv.Atoi(m[1])
	if err != nil || n <= 0 || n > 400 {
		return nil
	}
	return &n
}

// categoryPtr keeps only the ratings Hong Kong recognises.
func categoryPtr(category string) *string {
	if hkCategories[category] {
		return &category
	}
	return nil
}

// nullableText turns empty text into nil.
func nullableText(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// textOfRaw renders a JSON scalar as a string.
func textOfRaw(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var n float64
	if err := json.Unmarshal(raw, &n); err == nil {
		return strconv.FormatFloat(n, 'f', -1, 64)
	}
	return ""
}
