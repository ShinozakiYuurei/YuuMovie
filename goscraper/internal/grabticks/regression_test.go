package grabticks

import (
	"encoding/json"
	"os"
	"testing"
)

// TestNoRawRecordReferences is a regression guard for a real data bug.

// The Node CGV scraper publishes at least one film whose description is the
// literal text "$1e" — an unresolved React Flight record reference. It happens
// because each film page carries its own record table, and merging 25 pages
// before resolving the references makes ids collide across pages: one film's
// "$1e" resolves against another film's table and picks up the wrong synopsis.
//
// The Go port resolves each page against its own table before merging, so the
// references never cross pages. This test fails if that ever regresses, because
// the symptom is invisible in aggregate counts and only shows up on the site as
// one film wearing another film's synopsis.
func TestNoRawRecordReferences(t *testing.T) {
	const refPath = "../../../tmp/cgv-go.json"
	raw, err := os.ReadFile(refPath)
	if err != nil {
		t.Skipf("reference unavailable: %v", err)
	}
	var snap struct {
		Movies []struct {
			ID          string  `json:"id"`
			Description string  `json:"description"`
			Director    *string `json:"director"`
			Cast        *string `json:"cast"`
		} `json:"movies"`
	}
	if err := json.Unmarshal(raw, &snap); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(snap.Movies) == 0 {
		t.Skip("no movies in the reference")
	}
	for _, m := range snap.Movies {
		if isRecordRef(m.Description) {
			t.Errorf("%s: description is a raw record reference %q", m.ID, m.Description)
		}
		if m.Director != nil && isRecordRef(*m.Director) {
			t.Errorf("%s: director is a raw record reference %q", m.ID, *m.Director)
		}
		if m.Cast != nil && isRecordRef(*m.Cast) {
			t.Errorf("%s: cast is a raw record reference %q", m.ID, *m.Cast)
		}
	}
}

// isRecordRef reports whether a value is still an unresolved Flight reference.
func isRecordRef(s string) bool {
	if len(s) < 2 || s[0] != '$' {
		return false
	}
	for i := 1; i < len(s); i++ {
		c := s[i]
		isHex := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
		if !isHex {
			return false
		}
	}
	return true
}

// TestDescriptionsAreUnique guards the other half of the same bug: two films
// sharing one synopsis means a reference resolved against the wrong page's
// table. Legitimate duplicates are essentially impossible for these circuits.
func TestDescriptionsAreUnique(t *testing.T) {
	const refPath = "../../../tmp/cgv-go.json"
	raw, err := os.ReadFile(refPath)
	if err != nil {
		t.Skipf("reference unavailable: %v", err)
	}
	var snap struct {
		Movies []struct {
			ID          string `json:"id"`
			Description string `json:"description"`
		} `json:"movies"`
	}
	if err := json.Unmarshal(raw, &snap); err != nil {
		t.Fatalf("parse: %v", err)
	}
	seen := map[string]string{}
	for _, m := range snap.Movies {
		if m.Description == "" {
			continue
		}
		if other, dup := seen[m.Description]; dup {
			t.Errorf("%s and %s share a description (%q...)", other, m.ID, firstRunes(m.Description, 30))
			continue
		}
		seen[m.Description] = m.ID
	}
}

func firstRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
