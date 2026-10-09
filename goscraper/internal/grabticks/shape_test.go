package grabticks

import (
	"os"
	"testing"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/flight"
)

// TestCgvPayloadShape prints what the decoder actually sees, so a schema drift
// shows up as a concrete value rather than an empty field.
func TestCgvPayloadShape(t *testing.T) {
	html, err := os.ReadFile("../../../probe/cgv-movie-932.html")
	if err != nil {
		t.Skipf("fixture unavailable: %v", err)
	}
	page, err := decodePage(string(html))
	if err != nil {
		t.Fatalf("decodePage: %v", err)
	}
	t.Logf("records=%d movies=%d shows=%d sites=%d groups=%d houses=%d",
		len(page.records), len(page.movies), len(page.shows), len(page.sites), len(page.siteGroups), len(page.houses))
	for i, m := range page.movies {
		if i >= 3 {
			break
		}
		t.Logf("movie[%d] id=%v", i, m["id"])
		for _, k := range []string{"name_lang", "description_lang", "director_lang", "cast_lang", "dialect_lang", "movieTypes"} {
			v, present := m[k]
			t.Logf("  %s present=%v type=%T value=%.90v", k, present, v, v)
		}
	}

	// Also show what LangField makes of the description.
	if len(page.movies) > 0 {
		m := page.movies[0]
		lm := flight.LangField(page.records, m["description_lang"])
		t.Logf("LangField(description_lang) keys=%d zh_hk len=%d", len(lm), len(lm["zh_hk"]))
	}
}
