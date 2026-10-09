// Package flight parses Next.js React Server Component payloads.
//
// Both the Broadway and GrabTicks circuits serve their data this way: the page
// ships `self.__next_f.push([1,"..."])` chunks whose concatenation is a
// Flight document, and the useful values live inside it as JSON.
//
// The parsing is fiddly for two reasons that cost real bugs in the Node
// implementation, both preserved here:
//
//  1. Long strings are hoisted into separate records and the field position
//     holds only a reference like "$37". Reading the field directly yields the
//     literal text "$37", which is how a description once ended up rendering as
//     a dollar sign and a number.
//
//  2. Record ids are HEXADECIMAL. CineArt's payload contains references like
//     "$3a", so parsing ids as decimal silently loses half the records.
//
// A third trap is avoided rather than reproduced: the `T` prefix is followed by
// a BYTE length, and descriptions are mostly Chinese at three bytes per
// character, so slicing by that length always overshoots. Boundaries are found
// by scanning JSON structure instead.
package flight

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

var pushRe = regexp.MustCompile(`self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)`)

// Extract concatenates every pushed chunk into one document, mirroring
// extractRsc(). A chunk that is not a JSON string is skipped, which is what the
// JS did with its empty catch.
func Extract(html string) string {
	var b strings.Builder
	for _, m := range pushRe.FindAllStringSubmatch(html, -1) {
		var chunk string
		if err := json.Unmarshal([]byte(`"`+m[1]+`"`), &chunk); err != nil {
			continue
		}
		b.WriteString(chunk)
	}
	return b.String()
}

// SliceArray returns the text of the JSON array stored under key, or "" when
// absent. Boundaries come from bracket counting, mirroring sliceArray().
func SliceArray(s, key string) string {
	marker := `"` + key + `":[`
	i := strings.Index(s, marker)
	if i < 0 {
		return ""
	}
	start := strings.IndexByte(s[i:], '[')
	if start < 0 {
		return ""
	}
	start += i
	depth := 0
	for k := start; k < len(s); k++ {
		switch s[k] {
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				return s[start : k+1]
			}
		}
	}
	return ""
}

// recordRe finds a record header: an id, then ":T", then a hex byte length,
// then a comma. The id must not be preceded by an identifier character, or a
// timestamp like "...37:52.688Z" would be read as id 37.
var recordRe = regexp.MustCompile(`(?:^|[^0-9A-Za-z_])([0-9a-fA-F]+):T[0-9a-fA-F]+,`)

// Records maps a record id to the raw text of its value, mirroring
// buildRecordMap().
//
// Ids are parsed as hexadecimal, matching the JS after its 2026-10-04 fix.
func Records(rsc string) map[int]string {
	out := map[int]string{}
	for _, loc := range recordRe.FindAllStringSubmatchIndex(rsc, -1) {
		id64, err := strconv.ParseInt(rsc[loc[2]:loc[3]], 16, 64)
		if err != nil {
			continue
		}
		id := int(id64)
		if _, seen := out[id]; seen {
			continue
		}
		start := loc[1]
		end := scanJSONValue(rsc, start)
		if end < 0 {
			continue
		}
		out[id] = rsc[start:end]
	}
	return out
}

// scanJSONValue returns the end offset of the JSON value starting at start, or
// -1. It mirrors scanJsonValue() in scrapers/broadway.js.
func scanJSONValue(s string, start int) int {
	if start >= len(s) {
		return -1
	}
	switch s[start] {
	case '"':
		k := start + 1
		for k < len(s) {
			if s[k] == '\\' {
				k += 2
				continue
			}
			if s[k] == '"' {
				return k + 1
			}
			k++
		}
		return -1
	case '{', '[':
		open := s[start]
		var close byte
		if open == '{' {
			close = '}'
		} else {
			close = ']'
		}
		depth := 0
		inString := false
		for k := start; k < len(s); k++ {
			c := s[k]
			if inString {
				if c == '\\' {
					k++
					continue
				}
				if c == '"' {
					inString = false
				}
				continue
			}
			switch c {
			case '"':
				inString = true
			case open:
				depth++
			case close:
				depth--
				if depth == 0 {
					return k + 1
				}
			}
		}
		return -1
	}
	k := start
	for k < len(s) && !strings.ContainsRune(",]}", rune(s[k])) {
		k++
	}
	return k
}

// deepParse unwraps the double encoding Flight records use, mirroring
// deepParse(): a record's value is a JSON string whose content is itself JSON.
func deepParse(v string) any {
	var cur any = v
	for i := 0; i < 3; i++ {
		s, ok := cur.(string)
		if !ok {
			break
		}
		t := strings.TrimSpace(s)
		if !strings.HasPrefix(t, "{") && !strings.HasPrefix(t, "[") && !strings.HasPrefix(t, `"`) {
			break
		}
		var next any
		if err := json.Unmarshal([]byte(t), &next); err != nil {
			break
		}
		if ns, ok := next.(string); ok && ns == s {
			break
		}
		cur = next
	}
	return cur
}

// LangField resolves a `*_lang` field into a string map, mirroring langField().
//
// The value may be a map, a JSON string holding a map, or a `$N` reference to a
// hoisted record. A bare string is returned under the "en" key, which is what
// the JS did so callers can still read something.
func LangField(records map[int]string, value any) map[string]string {
	out := map[string]string{}
	switch v := value.(type) {
	case string:
		if ref, ok := parseRef(v); ok {
			raw, found := records[ref]
			if !found {
				return out
			}
			return flatten(deepParse(raw))
		}
		// The payload also stores these fields as a JSON string, so parse it
		// the way parseLang() does rather than treating the text as the value.
		var decoded any
		if err := json.Unmarshal([]byte(strings.TrimSpace(v)), &decoded); err == nil {
			return flatten(decoded)
		}
		if strings.TrimSpace(v) != "" {
			out["en"] = v
		}
		return out
	default:
		return flatten(value)
	}
}

var refRe = regexp.MustCompile(`^\$([0-9a-fA-F]+)$`)

// parseRef recognises a Flight record reference such as "$37" or "$3a".
func parseRef(s string) (int, bool) {
	m := refRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return 0, false
	}
	v, err := strconv.ParseInt(m[1], 16, 64)
	if err != nil {
		return 0, false
	}
	return int(v), true
}

// flatten turns a decoded record into a string map.
func flatten(v any) map[string]string {
	out := map[string]string{}
	m, ok := v.(map[string]any)
	if !ok {
		if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
			out["en"] = s
		}
		return out
	}
	for k, val := range m {
		switch t := val.(type) {
		case string:
			out[k] = t
		default:
			if b, err := json.Marshal(t); err == nil {
				out[k] = string(b)
			}
		}
	}
	return out
}

// Pick returns the first non-empty value among the given keys, in order.
// Callers pass the preference order (for example zh_hk then zh then en).
func Pick(m map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := m[k]; v != "" {
			return v
		}
	}
	return ""
}

// ValueAfter returns the LARGEST JSON array stored under key in a Flight
// document, decoded into v. It reports whether anything was found.
//
// Largest, not first: a page can contain several arrays under the same key, and
// the one nested inside a component prop is a truncated copy. The CGV film page
// is the concrete case — its first `movies` array holds one element with no
// description or movieTypes, while the second holds the full catalogue. The JS
// took the first and appeared to work only because it merges 25 film pages and
// some of them happen to carry the complete list first.
func ValueAfter(doc, key string, v any) bool {
	marker := "\"" + key + "\":"
	best := ""
	from := 0
	for {
		rel := strings.Index(doc[from:], marker)
		if rel < 0 {
			break
		}
		pos := from + rel
		start := pos + len(marker)
		for start < len(doc) && isSpaceByte(doc[start]) {
			start++
		}
		from = pos + len(marker)
		if start >= len(doc) || doc[start] != '[' {
			continue
		}
		end := scanJSONValue(doc, start)
		if end < 0 {
			continue
		}
		candidate := doc[start:end]
		if len(candidate) > len(best) {
			best = candidate
		}
		from = end
	}
	if best == "" {
		return false
	}
	return json.Unmarshal([]byte(best), v) == nil
}

func isSpaceByte(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}
