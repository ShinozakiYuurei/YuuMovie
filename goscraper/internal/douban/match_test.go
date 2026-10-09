package douban

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestIsMovieSubjectURL(t *testing.T) {
	movieURL := "https://movie.douban.com/subject/123/"
	bookURL := "https://book.douban.com/subject/456/"
	musicURL := "https://music.douban.com/subject/789/"
	if !IsMovieSubjectURL(movieURL) {
		t.Errorf("movie.douban.com should be accepted")
	}
	if IsMovieSubjectURL(bookURL) {
		t.Errorf("book.douban.com should be rejected")
	}
	if IsMovieSubjectURL(musicURL) {
		t.Errorf("music.douban.com should be rejected")
	}
	if IsMovieSubjectURL("") {
		t.Errorf("empty URL should be rejected")
	}
}

var reNormAlnum = regexp.MustCompile(`[^a-z0-9\x{3040}-\x{30ff}\x{4e00}-\x{9fff}]`)

func normSameSource(s string) string {
	return reNormAlnum.ReplaceAllString(strings.ToLower(strings.TrimSpace(s)), "")
}

func TestDoubanMatchEnrichAudit(t *testing.T) {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "../../../data"
	}
	enrichPath := filepath.Join(dataDir, "enrich.json")
	b, err := os.ReadFile(enrichPath)
	if err != nil {
		t.Skipf("enrich.json not found at %s, skipping real-data audit", enrichPath)
		return
	}

	type doubanEntry struct {
		NotFound    bool     `json:"notFound"`
		Rating      *float64 `json:"rating"`
		RatingState string   `json:"ratingState"`
		DoubanURL   string   `json:"doubanUrl"`
		DoubanTitle string   `json:"doubanTitle"`
		DoubanYear  *int     `json:"doubanYear"`
	}
	type item struct {
		NameZh string       `json:"nameZh"`
		NameEn string       `json:"nameEn"`
		Year   *int         `json:"year"`
		Douban *doubanEntry `json:"douban"`
	}
	type enrichWrapper struct {
		Entries map[string]item `json:"entries"`
	}

	var wrapper enrichWrapper
	if err := json.Unmarshal(b, &wrapper); err != nil {
		t.Fatalf("failed to parse enrich.json: %v", err)
	}

	checked := 0
	for key, entry := range wrapper.Entries {
		d := entry.Douban
		if d == nil || d.NotFound {
			continue
		}
		checked++
		if d.Rating != nil && d.RatingState != "unreleased" && !IsMovieSubjectURL(d.DoubanURL) {
			t.Errorf("%s: rating %.1f attached to non-movie douban URL %s (%s)", key, *d.Rating, d.DoubanURL, d.DoubanTitle)
		}
		if d.Rating != nil && d.DoubanYear != nil && entry.Year != nil {
			ne := normSameSource(entry.NameEn)
			nz := normSameSource(entry.NameZh)
			sameSource := ne != "" && ne == nz
			if sameSource && math.Abs(float64(*d.DoubanYear-*entry.Year)) > 10 {
				t.Errorf("%s: same-source title year mismatch (HK %d vs Douban %d) but rated %.1f (%s)", key, *entry.Year, *d.DoubanYear, *d.Rating, d.DoubanTitle)
			}
		}
	}
	t.Logf("Checked %d Douban enrich entries from %s", checked, enrichPath)
}
