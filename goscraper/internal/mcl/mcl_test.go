package mcl

import (
	"encoding/json"
	"testing"
	"time"
)

// The `i` field mixes a plot with gift-redemption terms. Copying it wholesale
// turns the detail page into a shopping notice, which is what the user reported.
func TestSynopsisCutsTheNotice(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "notice only",
			in:   "凡購買《英雄本色》4K 修復版戲票 1 張，可獲贈...",
			want: "",
		},
		{
			name: "plot then notice",
			in:   "小馬哥與 friends 再度出擊。備註：...",
			want: "小馬哥與 friends 再度出擊。",
		},
		{
			name: "plot only",
			in:   "一個關於復仇的故事。",
			want: "一個關於復仇的故事。",
		},
		{
			name: "dangling label removed",
			in:   "劇情簡介在此。MCL獨家觀影特典",
			want: "劇情簡介在此。",
		},
	}
	for _, c := range cases {
		if got := mclSynopsis(c.in); got != c.want {
			t.Errorf("%s: mclSynopsis = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestPlainTextDecodesEntities(t *testing.T) {
	if got, want := plainText("<p>a &amp; b</p>"), "a & b"; got != want {
		t.Errorf("plainText = %q, want %q", got, want)
	}
	if got, want := plainText("x&#8212;y"), "x—y"; got != want {
		t.Errorf("plainText numeric entity = %q, want %q", got, want)
	}
	if got, want := plainText("x&#x2014;y"), "x—y"; got != want {
		t.Errorf("plainText hex entity = %q, want %q", got, want)
	}
	// A malformed entity must survive as text rather than vanish.
	if got, want := plainText("a &nope; b"), "a &nope; b"; got != want {
		t.Errorf("plainText unknown entity = %q, want %q", got, want)
	}
}

// r is the share still FREE. Reading it as sold would invert the seat colour.
func TestShowDescKeepsTheFreeShare(t *testing.T) {
	d := parseShowDesc("星期四, 9月24日, 02:10 PM, IMAX/12院 $210", mustTime(t, "2026-09-20T10:00:00+08:00"))
	if d == nil {
		t.Fatal("parseShowDesc returned nil")
	}
	if d.ISO != "2026-09-24T14:10:00+08:00" {
		t.Errorf("ISO = %q", d.ISO)
	}
	if d.Date != "2026-09-24" {
		t.Errorf("Date = %q", d.Date)
	}
	if d.Price == nil || *d.Price != 210 {
		t.Errorf("Price = %v, want 210", d.Price)
	}
	if d.HouseName != "IMAX/12院" {
		t.Errorf("HouseName = %q", d.HouseName)
	}
}

// The line carries no year, so it is inferred from the current Hong Kong
// month: a date more than one month ahead belongs to next year.
func TestShowDescInfersTheYear(t *testing.T) {
	d := parseShowDesc("星期二, 12月30日, 07:00 PM, 廳 A", mustTime(t, "2026-10-09T10:00:00+08:00"))
	if d == nil {
		t.Fatal("parseShowDesc returned nil")
	}
	if want := "2026-12-30"; d.Date != want {
		t.Errorf("Date = %q, want %q", d.Date, want)
	}
}

func TestShowDescIgnoresSeparators(t *testing.T) {
	if d := parseShowDesc("nonsense", time.Now()); d != nil {
		t.Errorf("expected nil for unparseable text, got %+v", d)
	}
}

// The id must match, and the title too when the listing knows it.
func TestParseDetailRejectsMismatchedID(t *testing.T) {
	raw := detailJSON(14743, "以你的名字呼喚我 (特別放映)")
	if d := parseDetail(raw, 14744, "以你的名字呼喚我 (特別放映)"); d != nil {
		t.Errorf("expected nil for wrong id, got %+v", d)
	}
	if d := parseDetail(raw, 14743, "以你的名字呼喚我 (特別放映)"); d == nil {
		t.Error("expected a match")
	}
	if d := parseDetail(raw, 14743, "另一部片"); d != nil {
		t.Errorf("expected nil for wrong title, got %+v", d)
	}
}

// The two endpoints render parentheses differently, so the comparison has to
// fold the full-width forms.
func TestNormalizeNFKC(t *testing.T) {
	// Full-width parentheses fold to half-width with no space, which is what
	// String.normalize("NFKC") does on the JS side.
	if got, want := normalizeNFKC("以你的名字呼喚我（特別放映）"), "以你的名字呼喚我(特別放映)"; got != want {
		t.Errorf("normalizeNFKC = %q, want %q", got, want)
	}
	if got, want := normalizeNFKC("ＡＢＣ　１２"), "ABC 12"; got != want {
		t.Errorf("normalizeNFKC full-width = %q, want %q", got, want)
	}
}

func TestParseDetailCategoryAndDuration(t *testing.T) {
	d := parseDetail(detailJSON(1, "某片"), 1, "某片")
	if d == nil {
		t.Fatal("expected a detail")
	}
	if d.Category == nil || *d.Category != "IIB" {
		t.Errorf("Category = %v, want IIB", d.Category)
	}
	if d.Duration == nil || *d.Duration != 100 {
		t.Errorf("Duration = %v, want 100", d.Duration)
	}
	if len(d.Genres) != 2 {
		t.Errorf("Genres = %v, want two entries", d.Genres)
	}
}

func detailJSON(id int, name string) []json.RawMessage {
	body := map[string]any{
		"id": id,
		"mn": name,
		"b":  map[string]any{"mrt": "100 分鐘", "mc": "iib", "mg": "劇情、動作", "ml": "粵語", "ms": "中英字幕"},
		"e":  map[string]any{"md": "導演甲", "mc": "演員乙"},
		"i":  "劇情簡介在此。",
	}
	raw, _ := json.Marshal(body)
	return []json.RawMessage{raw}
}

func mustTime(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}
