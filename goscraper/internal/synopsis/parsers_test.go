package synopsis

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/synopsiskey"
)

// fixture reads a captured page. The fixtures are real pages from the three
// sources, taken through the Hong Kong egress because two of them sit behind
// Cloudflare, so the parsers are checked against what the sites actually serve.
func fixture(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "testdata", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(raw)
}

// TestParseWmoovIndexOnRealPage pins the index against the values produced from the
// same captured page by scripts/synopsis-parity.mjs.
func TestParseWmoovIndexOnRealPage(t *testing.T) {
	index := ParseWmoovIndex(fixture(t, "syn-wmoov-showing.html"))
	// 157 keys and 158 entries: one title legitimately appears twice.
	if len(index) != 157 {
		t.Errorf("keys = %d, want 157", len(index))
	}
	entries := 0
	for _, list := range index {
		entries += len(list)
	}
	if entries != 158 {
		t.Errorf("entries = %d, want 158", entries)
	}

	// The duplicate proves a key can hold more than one entry, and the
	// English-name gate is what decides between them.
	list := index[synopsiskey.Key("Look Back 驀然回首")]
	if len(list) != 2 {
		t.Fatalf("Look Back has %d entries, want 2", len(list))
	}
	if list[0].ID != "72252" || list[1].ID != "65013" {
		t.Errorf("ids = %s, %s, want 72252, 65013", list[0].ID, list[1].ID)
	}

	always := index[synopsiskey.Key("Always Lalisa")]
	if len(always) != 1 || always[0].ID != "73328" {
		t.Errorf("Always Lalisa = %+v", always)
	}
}

// TestParseWmoovDetailOnRealPage pins the detail parsers against the reference
// strings from the same captured page.
func TestParseWmoovDetailOnRealPage(t *testing.T) {
	html := fixture(t, "syn-wmoov-detail.html")

	names := ParseWmoovNames(html)
	// The English name uses hyphens inside the parentheses rather than a colon,
	// which is the shape that makes the Chinese/English split worth having.
	if names.Zh != "劇場版 魔法少女小圓〈瓦爾普吉斯的迴天〉" {
		t.Errorf("zh = %q", names.Zh)
	}
	if names.En != "Puella Magi Madoka Magica the Movie -Walpurgisnacht Rising-" {
		t.Errorf("en = %q", names.En)
	}

	const want = "在看似平靜的世界中，那幾位熟悉的魔法少女再度集結，面對與瓦爾普吉斯之夜相關的嶄新威脅。" +
		"曉美焰必須直視過去的抉擇與內心掙扎，為了守護鹿目圓而踏上未知的旅程。" +
		"在絕望與希望交織的黑暗奇幻中，讓故事繼續展開，那麽，讓夢境的帷幕再度升起……"
	if got := ParseWmoovSynopsis(html); got != want {
		t.Errorf("synopsis:\n got %q\nwant %q", got, want)
	}
}

// TestParseKinohkOnRealPage covers both layouts the site currently serves.
//
// This is the fix. The JavaScript reads an h3 inside the a, and the now-showing
// page no longer has that: it serves an article with the title in an h2 and an
// overlay anchor. The old parser returns an EMPTY index for that page, which is a
// silent failure \u2014 every film looks like a miss, and a miss costs a week of
// cooldown.
func TestParseKinohkOnRealPage(t *testing.T) {
	newLayout := ParseKinohkIndex(fixture(t, "syn-kinohk-now.html"))
	if len(newLayout) == 0 {
		t.Fatal("the now-showing page parsed to nothing; the new layout is not handled")
	}
	list := newLayout[synopsiskey.Key("我阿爹想旅行")]
	if len(list) != 1 {
		t.Fatalf("我阿爹想旅行 = %+v", list)
	}
	if list[0].Slug != "/movie/我阿爹想旅行" {
		t.Errorf("slug = %q", list[0].Slug)
	}
	if list[0].Title != "我阿爹想旅行" {
		t.Errorf("title = %q", list[0].Title)
	}
	if list[0].En != "Good Trip" {
		t.Errorf("en = %q, want Good Trip", list[0].En)
	}

	// The coming page still serves the old layout and has to keep working.
	oldLayout := ParseKinohkIndex(fixture(t, "syn-kinohk-coming.html"))
	if len(oldLayout) != 119 {
		t.Errorf("coming keys = %d, want 119: the old layout must still parse", len(oldLayout))
	}
}

// TestParseKinohkSynopsisOnRealPage pins the synopsis, which is the paragraph BEFORE
// the site credit rather than the credit itself.
func TestParseKinohkSynopsisOnRealPage(t *testing.T) {
	got := ParseKinohkSynopsis(fixture(t, "syn-kinohk-detail.html"))
	if got == "" {
		t.Fatal("no synopsis parsed")
	}
	// The credit is kinohk's attribution and must not be part of the text.
	for _, marker := range []string{"本站整理", "資料由本站"} {
		if strings.Contains(got, marker) {
			t.Errorf("the credit leaked into the synopsis: %q", got)
		}
	}
	const prefix = "Yorushika由作曲家n-buna同主音suis組成"
	if !strings.HasPrefix(got, prefix) {
		t.Errorf("synopsis = %q, want it to start with %q", got, prefix)
	}

	if ParseKinohkSynopsis("<p>沒有這種東西</p>") != "" {
		t.Error("a page with no credit yielded a synopsis")
	}
}

// TestParseHkmovie6OnRealPage covers the index and the detail page.
func TestParseHkmovie6OnRealPage(t *testing.T) {
	index := ParseHkmovie6Index(fixture(t, "syn-hkmovie6-home.html"))
	if len(index) != 189 {
		t.Errorf("keys = %d, want 189", len(index))
	}
	// The title is percent-encoded in the path with underscores for spaces.
	const wantSlug = "/movie/a1e7c35a-2afa-4334-9685-dcda00b7d688/%E8%B6%85%E9%A2%A8"
	found := false
	for _, entries := range index {
		for _, entry := range entries {
			if entry.Slug == wantSlug {
				found = true
				if entry.Title != "超風" {
					t.Errorf("title = %q, want 超風", entry.Title)
				}
			}
		}
	}
	if !found {
		t.Error("the captured detail page's own film is not in the index")
	}

	got := ParseHkmovie6Synopsis(fixture(t, "syn-hkmovie6-detail.html"))
	const prefix = "超風從大陸來港，渴望成為真正的自己"
	if !strings.HasPrefix(got, prefix) {
		t.Errorf("synopsis = %q, want it to start with %q", got, prefix)
	}

	if ParseHkmovie6Synopsis("<div>沒有Synopsis</div>") != "" {
		t.Error("a page with no container yielded a synopsis")
	}
}
