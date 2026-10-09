package broadway

import (
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/flight"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// scrapeutilHKT is the Hong Kong zone used for every timestamp in this circuit.
func scrapeutilHKT() *time.Location { return scrapeutil.HKT }

// stringOr renders a JSON value as a string, empty when absent.
func stringOr(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	return stringify(m[key])
}

// nilOr returns m[key], tolerating a nil map.
func nilOr(m map[string]any, key string) any {
	if m == nil {
		return nil
	}
	return m[key]
}

func stringify(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		if t {
			return "true"
		}
		return "false"
	case json.Number:
		return t.String()
	}
	return ""
}

// intFromAny reads an integer field, 0 when absent.
func intFromAny(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case json.Number:
		n, _ := t.Int64()
		return int(n)
	case string:
		n, _ := strconv.Atoi(t)
		return n
	}
	return 0
}

// numberFromAny reads a float field and reports whether one was present.
func numberFromAny(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(t, 64)
		return f, err == nil
	}
	return 0, false
}

func intPtr(v any) *int {
	if n := intFromAny(v); n != 0 {
		return &n
	}
	return nil
}

func scrapeutilNullable(s string) *string { return scrapeutil.NullableString(s) }

// nullableString turns an empty string into nil, mirroring `value || null`.
//
// It is the right choice only where the JS used `||`. Where it used `??`,
// an empty string must survive — that is what nullish is for.
func nullableString(s string) *string { return scrapeutil.NullableString(s) }

// nullish mirrors the JavaScript `value ?? null`.
//
// It has to keep "": this circuit publishes an empty dialect on 25 of its
// 191 listings and an empty subtitle on 23, and collapsing those to null
// loses the difference between "no dialect published" and "dialect is
// blank". Only null and a missing key become nil.
func nullish(m map[string]any, key string) *string {
	if m == nil {
		return nil
	}
	value, ok := m[key]
	if !ok || value == nil {
		return nil
	}
	s := stringify(value)
	return &s
}

// nullishInt mirrors `value ?? null` for a number field, keeping 0.
//
// Duration is 0 on 10 listings — the film is unreleased and the runtime is
// simply not known yet — and null would claim the opposite.
func nullishInt(m map[string]any, key string) *int {
	if m == nil {
		return nil
	}
	switch value := m[key].(type) {
	case nil:
		return nil
	case float64:
		n := int(value)
		return &n
	case json.Number:
		n, err := value.Int64()
		if err != nil {
			return nil
		}
		i := int(n)
		return &i
	}
	return nil
}

// firstNonEmpty returns the first non-empty string.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// pickLang resolves a `*_lang` field to its Chinese value, optionally falling
// back to a plain sibling field.
//
// The optional argument exists because callers differ: some want the fallback
// folded in here, others compose it with firstNonEmpty because they have a
// third candidate.
func pickLang(records map[int]string, m map[string]any, langKey string, plainKey ...string) string {
	if lang := flight.LangField(records, nilOr(m, langKey)); lang["zh_hk"] != "" {
		return lang["zh_hk"]
	}
	if len(plainKey) > 0 {
		return stringOr(m, plainKey[0])
	}
	return ""
}

// genresOf reads movieTypes, preferring the Chinese label.
func genresOf(records map[int]string, m map[string]any) []string {
	list, _ := m["movieTypes"].([]any)
	out := make([]string, 0, len(list))
	for _, item := range list {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		lang := flight.LangField(records, entry["name_lang"])
		name := firstNonEmpty(lang["zh_hk"], stringOr(entry, "name"))
		if name != "" {
			out = append(out, name)
		}
	}
	return out
}

// posterOf builds the media URL from the first image.
func posterOf(m map[string]any) *string {
	images, _ := m["images"].([]any)
	if len(images) == 0 {
		return nil
	}
	first := stringify(images[0])
	if first == "" {
		return nil
	}
	url := "https://media.grabticks.com/" + first
	return &url
}

// parseLangJSON decodes a `*_lang` object into a string map.
func parseLangJSON(raw string) map[string]string {
	out := map[string]string{}
	if raw == "" {
		return out
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return out
	}
	for k, v := range m {
		if s, ok := v.(string); ok {
			out[k] = s
		}
	}
	return out
}

// unescapeJSONString decodes a JSON string body.
func unescapeJSONString(s string) string {
	var out string
	if err := json.Unmarshal([]byte(`"`+s+`"`), &out); err != nil {
		return s
	}
	return out
}

// firstGroup returns the first capture group of re in s.
func firstGroup(re interface{ FindStringSubmatch(string) []string }, s string) string {
	m := re.FindStringSubmatch(s)
	if m == nil || len(m) < 2 {
		return ""
	}
	return m[1]
}

// matchBrace returns the offset just past the object starting at i.
func matchBrace(s string, i int) int {
	depth := 0
	for k := i; k < len(s); k++ {
		switch s[k] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return k + 1
			}
		}
	}
	return -1
}

// atoiSuffix parses the numeric part of an id like "broadway-123".
func atoiSuffix(id string) int {
	if i := strings.LastIndex(id, "-"); i >= 0 {
		id = id[i+1:]
	}
	n, _ := strconv.Atoi(id)
	return n
}

// houseNames collects every house name from the document.
func houseNames(doc string) map[int]string {
	out := map[int]string{}
	for _, m := range houseRe.FindAllStringSubmatch(doc, -1) {
		id, err := strconv.Atoi(m[1])
		if err != nil {
			continue
		}
		if _, seen := out[id]; seen {
			continue
		}
		lang := parseLangJSON(m[3])
		name := lang["zh_hk"]
		if name == "" {
			name = unescapeJSONString(m[2])
		}
		out[id] = name
	}
	return out
}

// runPool runs fn(i) for i in [0,n) with a bounded number of goroutines.
func runPool(n, concurrency int, fn func(int)) {
	if n <= 0 {
		return
	}
	if concurrency < 1 {
		concurrency = 1
	}
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()
			fn(idx)
		}(i)
	}
	wg.Wait()
}
