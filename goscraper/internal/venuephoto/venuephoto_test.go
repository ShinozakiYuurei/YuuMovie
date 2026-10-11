package venuephoto

import "testing"

// TestStaticCoversKnownCircuits pins which cinemas get an official photo.
//
// 意图：改表时要有人看一眼「换掉的是哪几家」。这张表就是「不再显示影廳內景」
// 的白名单，删一行等于让那家退回 hkmovie6 的 og:image（多半又是座椅＋銀幕）。
func TestStaticCoversKnownCircuits(t *testing.T) {
	want := []string{
		// 百老汇：只收审过是前台/大堂/小食部/酒吧/电梯的。
		// ★ broadway-3/5/7/8/9/11/12 官网给的也是影廳內景，故不在表内。
		"broadway-1", "broadway-2", "broadway-4", "broadway-6", "broadway-10", "broadway-13",
		// MCL：全部是大堂/售票处/走廊。
		// ★ mcl-016（cp）与 mcl-019（am）官网给的就是影廳內景，故不在表内。
		"mcl-002", "mcl-003", "mcl-005", "mcl-009", "mcl-012",
		"mcl-013", "mcl-014", "mcl-015", "mcl-017",
	}
	// 比集合而不是比顺序：StaticIDs 排的是字符串序，broadway-10 必然排在
	// broadway-2 前面，把顺序也钉死只会让人为了改表去迁就它。
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
func TestStaticBuildsAbsoluteURLsWithReferer(t *testing.T) {
	cases := map[string]string{
		"broadway-1":  "https://media.grabticks.com/",
		"broadway-13": "https://media.grabticks.com/",
		"mcl-002":     "https://cdn.mclcinema.com/MovieMedia/images/",
	}
	for id, wantPrefix := range cases {
		src, ok := Static(id)
		if !ok {
			t.Fatalf("Static(%q) missing", id)
		}
		if len(src.URL) <= len(wantPrefix) || src.URL[:len(wantPrefix)] != wantPrefix {
			t.Errorf("Static(%q).URL = %q, want prefix %q", id, src.URL, wantPrefix)
		}
		// Referer 缺了就是 403 → 4KB 错误页，不是图。
		if src.Referer == "" {
			t.Errorf("Static(%q).Referer is empty", id)
		}
		if src.Note == "" {
			t.Errorf("Static(%q).Note is empty", id)
		}
	}
}

// TestStaticRejectsUnknown pins the fall-through: anything not in the table
// must return false so the caller keeps hkmovie6's og:image.
func TestStaticRejectsUnknown(t *testing.T) {
	for _, id := range []string{
		"broadway-3", // 官网只有散景斑點圖
		"broadway-7", // 官网只有影廳內景
		"mcl-016",    // ★ 官网是 4500x3002 的 LUXE 影廳全景，看着像售票区，其实是影廳
		"mcl-019",    // 官网只有影廳內景
		"emperor-57011",
		"",
	} {
		if _, ok := Static(id); ok {
			t.Errorf("Static(%q) = ok, want miss (should fall back to hkmovie6)", id)
		}
	}
}
