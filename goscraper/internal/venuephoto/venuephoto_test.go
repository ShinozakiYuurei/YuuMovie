package venuephoto

import (
	"strings"
	"testing"
)

// TestStaticCoversKnownCircuits pins which cinemas get a photo.
//
// 2026-10-12 更新：Commons 高清審圖通過的 11 家進了 curatedPhotos，
// 其中 bestar-58001 / cgv-22 / cineart-23 / mcl-022 是新增覆蓋，
// broadway-12 從 groupFallback（借 broadway-1 的圖）升級為自有圖，
// lux-1（寶石戲院）補上 2048×1536 的售票處實景（原 og:image 是斑點圖）。
func TestStaticCoversKnownCircuits(t *testing.T) {
	want := []string{
		// 百老匯：前台/大堂/小食部/廚房/扶手櫃，以及審圖通過的 Commons 售票處與外立面
		"broadway-1", "broadway-2", "broadway-6", "broadway-10", "broadway-12", "broadway-13",
		// MCL：大堂/售票處/凸肚廚，以及審圖通過的 Commons 售票處與星光招牌
		"mcl-002", "mcl-003", "mcl-005", "mcl-009", "mcl-012",
		"mcl-013", "mcl-014", "mcl-015", "mcl-017", "mcl-022",
		// 官方/高清晰圖（前台/大堂/外立面）
		"broadway-4", "broadway-5", "broadway-7", "broadway-9", "cineart-16", "sunbeam-1",
		// 審圖通過的 Commons 售票處與正門
		"bestar-58001", "cgv-22", "cineart-23", "lux-1",
		// 院線沒有官方照的：退回同集團形象照，見 groupFallback。
		"broadway-3", "broadway-11", "cineart-18",
		"mcl-016", "mcl-018", "mcl-019", "mcl-021",
	}
	got := map[string]bool{}
	for _, id := range StaticIDs() {
		got[id] = true
	}
	for _, id := range want {
		if !got[id] {
			t.Errorf("StaticIDs() missing %q (full: %v)", id, StaticIDs())
		}
		delete(got, id)
	}
	if len(got) != 0 {
		t.Errorf("StaticIDs() has extras: %v", got)
	}
}

// TestStaticBuildsAbsoluteURLsWithReferer checks the two fields every media
// host actually requires.
//
// 兩類來源都要覆蓋：院線官網 CDN（要 Referer 才給圖）與 Wikimedia
// Special:FilePath（審圖通過的 10 家走這條）。
func TestStaticBuildsAbsoluteURLsWithReferer(t *testing.T) {
	cases := map[string]string{
		// 院線官網 / 官方網站
		"broadway-2": "https://media.grabticks.com/",
		"mcl-003":    "https://cdn.mclcinema.com/MovieMedia/images/",
		"broadway-4": "https://cybertecture.io/wp-content/uploads/",
		"sunbeam-1":  "https://thumb.wikimedia.org/wikipedia/commons/",
		// Commons 審圖通過（2026-10-12）
		"broadway-1":  "https://commons.wikimedia.org/wiki/Special:FilePath/",
		"broadway-13": "https://commons.wikimedia.org/wiki/Special:FilePath/",
		"mcl-002":     "https://commons.wikimedia.org/wiki/Special:FilePath/",
		"lux-1":       "https://commons.wikimedia.org/wiki/Special:FilePath/",
		"cgv-22":      "https://commons.wikimedia.org/wiki/Special:FilePath/",
	}
	for id, wantPrefix := range cases {
		src, ok := Static(id)
		if !ok {
			t.Fatalf("Static(%q) missing", id)
		}
		if len(src.URL) <= len(wantPrefix) || src.URL[:len(wantPrefix)] != wantPrefix {
			t.Errorf("Static(%q).URL = %q, want prefix %q", id, src.URL, wantPrefix)
		}
		if src.Referer == "" {
			t.Errorf("Static(%q).Referer is empty", id)
		}
		if src.Note == "" {
			t.Errorf("Static(%q).Note is empty", id)
		}
	}
}

// TestStaticRejectsUnknown pins the fall-through.
func TestStaticRejectsUnknown(t *testing.T) {
	for _, id := range []string{
		"emperor-57011",
		"non-existent-cinema",
		"",
	} {
		if _, ok := Static(id); ok {
			t.Errorf("Static(%q) = ok, want miss", id)
		}
	}
}

// TestGroupFallbackPointsAtRealPhotos guards the group-fallback table.
//
// broadway-12 不再在表內：2026-10-12 審圖通過了它自己的 Commons 售票處照，
// curatedPhotos 優先於 groupFallback，所以它有自己的圖。
func TestGroupFallbackPointsAtRealPhotos(t *testing.T) {
	ids := []string{"broadway-3", "broadway-11", "cineart-18", "mcl-016", "mcl-018", "mcl-019", "mcl-021"}
	for _, id := range ids {
		src, ok := Static(id)
		if !ok {
			t.Fatalf("Static(%q) = miss, want group fallback", id)
		}
		if src.URL == "" || src.Referer == "" {
			t.Errorf("Static(%q) = {URL:%q Referer:%q}, want both set", id, src.URL, src.Referer)
		}
		if !strings.Contains(src.Note, "同集團形象照") {
			t.Errorf("Static(%q).Note = %q, want it to say it is a group fallback", id, src.Note)
		}
	}
}
