package douban

import (
	"reflect"
	"testing"
)

// TestExpandQueriesParity pins the whole query list, in order, against the Node
// reference.
//
// This list decides whether Douban is asked at all, and a dropped or reordered
// query silently changes which entry comes back, so the comparison is on the
// full slice rather than on "contains".
//
// Expectations come from scripts/douban-queries-parity.mjs against
// scrapers/douban-suggest.js. Every case here is a shape that once cost a film
// its score.
func TestExpandQueriesParity(t *testing.T) {
	cases := []struct {
		zh   string
		en   string
		want []string
	}{
		// The cleaned form is one character, so it is dropped: "M" would come
		// back with a pile of unrelated M entries.
		{"M (GFF)", "", []string{"M (GFF)"}},
		// The title inside the book marks is its own candidate, and two characters
		// is long enough for it.
		{"《這個殺手不太冷》(4K導演版)", "", []string{
			"《這個殺手不太冷》(4K導演版)",
			"這個殺手不太冷",
		}},
		// The bracketed title combines with the shrunken tail: the bonus note
		// drops off, and the book-mark and brand-stripped variants come along.
		{"《空槍》T-Shirt特典場", "", []string{
			"《空槍》T-Shirt特典場",
			"空槍",
			"空槍 T-Shirt特典場",
			"《空槍》T-Shirt",
			"空槍 T-Shirt",
		}},
		// The meet-and-greet drops off the tail and the rest is the title.
		{"我阿爹想旅行 行得㗎啦見面場", "", []string{
			"我阿爹想旅行 行得㗎啦見面場",
			"我阿爹想旅行 行得㗎啦",
		}},
		// The extra session drops off but the English name survives: the base
		// queries are placed first precisely so a shrunken form cannot evict it.
		{"復仇者聯盟4：終局之戰 加碼", "Avengers Endgame", []string{
			"復仇者聯盟4：終局之戰 加碼",
			"復仇者聯盟4：終局之戰",
			"Avengers Endgame",
		}},
		// A reissue behaves the same way, and this is the case the shrink pass was
		// added for: the original query returns nothing.
		{"復仇者聯盟4：終局之戰 重映", "Avengers Endgame", []string{
			"復仇者聯盟4：終局之戰 重映",
			"復仇者聯盟4：終局之戰",
			"Avengers Endgame",
		}},
		// A glued event word: everything after it is wholly disposable, so the
		// prefix becomes a candidate.
		{"末日降臨開畫日特典首場", "", []string{
			"末日降臨開畫日特典首場",
			"末日降臨",
		}},
		// Nothing is left after stripping, so no candidate is produced: "重映" on
		// its own would bring back the wrong film.
		{"重映開畫日特典首場", "", []string{"重映開畫日特典首場"}},
		// An unbalanced bracket is dropped rather than searched: this one comes
		// back as the Norwegian ballet recording.
		{"天鵝湖 (The", "", []string{"天鵝湖 (The"}},
		// "The" is not an event word, so the tail cannot be cut. This is the
		// counter-example that stopped unconditional tail cutting.
		{"GIANT – The Play", "", []string{"GIANT – The Play"}},
		// "by" is not an event word either, so "Fallen Angels" must NOT appear:
		// it comes back as an unrelated entry of the same name.
		{"Fallen Angels by Noel Coward", "", []string{"Fallen Angels by Noel Coward"}},
		// Two characters is enough for a shrunken candidate, which is what the
		// bc30 and KINO series rely on.
		{"日麗", "", []string{"日麗"}},
		// Names made only of event words, so nothing survives.
		{"日語版", "", []string{"日語版"}},
		{"開畫日特典首場", "", []string{"開畫日特典首場"}},
		// The same name in both columns is one query, not two.
		{"Queen Budapest", "Queen Budapest", []string{"Queen Budapest"}},
		// Chinese leads and the English name is kept: Douban's primary title is
		// Chinese, so the English name is a much weaker key but still worth asking.
		{"超風", "Super Typhoon", []string{"超風", "Super Typhoon"}},
		// A single character is still blocked when it is all that is left.
		{"愛", "", []string{"愛"}},
		// "2D" is not in the brand list, so it stays part of the title.
		{"2D 龍珠", "", []string{"2D 龍珠"}},
	}
	for _, tc := range cases {
		got := ExpandQueries(tc.zh, tc.en)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("ExpandQueries(%q, %q)\n got %q\nwant %q", tc.zh, tc.en, got, tc.want)
		}
	}
}

// TestCleanTitleParity pins the cleaning the query list is built on.
func TestCleanTitleParity(t *testing.T) {
	cases := []struct{ in, want string }{
		{"M (GFF)", "M"},
		{"《這個殺手不太冷》(4K導演版)", "這個殺手不太冷"},
		// T-Shirt is not an event word, so the bonus note cannot be cut and the
		// shrunken form is what the query list adds rather than this one.
		{"《空槍》T-Shirt特典場", "空槍 T-Shirt特典場"},
		// 行得㗎啦 is part of the promotional line, not an event word, so it stays
		// here for the same reason.
		{"我阿爹想旅行 行得㗎啦見面場", "我阿爹想旅行 行得㗎啦見面場"},
		{"復仇者聯盟4：終局之戰 重映", "復仇者聯盟4：終局之戰"},
		// A year range is tail noise without brackets.
		{"Some Film 2024-2025", "Some Film"},
		// The festival forms that hide after the title.
		{"Some Film NT Live", "Some Film"},
		{"Some Film Royal Ballet", "Some Film"},
		// A trailing dash left by a removed bracket.
		{"Some Film -", "Some Film"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := CleanTitle(tc.in); got != tc.want {
			t.Errorf("CleanTitle(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestStripFormatBrandsParity pins the brand stripping.
func TestStripFormatBrandsParity(t *testing.T) {
	cases := []struct{ in, want string }{
		{"IMAX Avengers Endgame", "Avengers Endgame"},
		{"Avengers Endgame 4DX", "Avengers Endgame"},
		// "Infinity" alone may be part of a real title (Infinity Pool), so only
		// the pair goes.
		{"Infinity Pool", "Infinity Pool"},
		{"Film Infinity Vision", "Film"},
		// A brand glued to letters is a different marker and survives.
		{"IMAX2D Film", "IMAX2D Film"},
		// An emptied bracket is cleaned up rather than left as "( )".
		{"Film (IMAX)", "Film"},
		{"Film", "Film"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := StripFormatBrands(tc.in); got != tc.want {
			t.Errorf("StripFormatBrands(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestParseCardParity pins the subtitle parsing, including the three rating
// states that have to stay apart.
func TestParseCardParity(t *testing.T) {
	card := Card{
		Title: "生化危機",
		Year:  "2026",
		Sub:   "暂无评分 / 2026 / 美国 / 动作 恐怖 / 马丁内斯",
		ID:    "37068446",
		URL:   "https://movie.douban.com/subject/37068446/",
	}
	parsed := ParseCard(card)
	if parsed.RatingState != "pending" {
		t.Errorf("ratingState = %q, want pending", parsed.RatingState)
	}
	if parsed.Rating != nil {
		t.Errorf("rating = %v, want null", *parsed.Rating)
	}
	if parsed.DoubanYear != 2026 {
		t.Errorf("doubanYear = %d, want 2026", parsed.DoubanYear)
	}
	if parsed.Country == nil || *parsed.Country != "美国" {
		t.Errorf("country = %v", parsed.Country)
	}
	if len(parsed.Genres) != 2 {
		t.Errorf("genres = %v, want two", parsed.Genres)
	}
	if parsed.Director == nil || *parsed.Director != "马丁内斯" {
		t.Errorf("director = %v", parsed.Director)
	}

	rated := ParseCard(Card{Sub: "8.3分 / 2023 / 中国大陆 / 科幻 冒险 灾难 / 郭帆 / 吴京 刘德华"})
	if rated.RatingState != "rated" || rated.Rating == nil || *rated.Rating != 8.3 {
		t.Errorf("rated = %+v", rated)
	}
	if rated.DoubanYear != 2023 {
		t.Errorf("doubanYear = %d, want 2023", rated.DoubanYear)
	}
	if rated.Cast == nil || *rated.Cast != "吴京 刘德华" {
		t.Errorf("cast = %v", rated.Cast)
	}

	// Present but with no score yet, which is a different state from "not
	// released": one means the film exists, the other that a score should not
	// exist yet.
	unreleased := ParseCard(Card{Sub: "尚未上映 / 2026 / 中国大陆"})
	if unreleased.RatingState != "unreleased" {
		t.Errorf("ratingState = %q, want unreleased", unreleased.RatingState)
	}
}

// TestPickCardParity pins the year window.
func TestPickCardParity(t *testing.T) {
	cards := []Card{
		{Title: "A", Year: "1986"},
		{Title: "B", Year: "2026"},
	}
	// 1986 is 40 years back, inside the reissue window.
	if got := PickCard(cards, 2026); got == nil || got.Title != "A" {
		t.Error("the 1986 entry was not accepted as a reissue")
	}
	// Nothing forward beyond one year.
	if got := PickCard([]Card{{Title: "C", Year: "2030"}}, 2026); got != nil {
		t.Errorf("a future entry was accepted: %+v", got)
	}
	// A card with no year is not rejected.
	if got := PickCard([]Card{{Title: "D"}}, 2026); got == nil {
		t.Error("a card with no year was rejected")
	}
	// With no Hong Kong year the first card stands.
	if got := PickCard(cards, 0); got == nil || got.Title != "A" {
		t.Error("with no year the first card was not taken")
	}
}

// TestCrossYearParity pins the same-source-name gate, which is much stricter.
func TestCrossYearParity(t *testing.T) {
	// Queen Budapest: Hong Kong 2026, Douban returned 1986.
	if CrossYearOk(1986, 1986, 2026) {
		t.Error("a 40-year-old namesake passed")
	}
	if !CrossYearOk(2026, 2026, 2026) {
		t.Error("the same year was rejected")
	}
	// Three years is the documented edge.
	if !CrossYearOk(2023, 2023, 2026) {
		t.Error("a gap of 3 was rejected")
	}
	if CrossYearOk(2022, 2022, 2026) {
		t.Error("a gap of 4 was accepted")
	}
	// Nothing to judge by stands aside.
	if !CrossYearOk(0, 0, 2026) {
		t.Error("missing years were rejected")
	}
}
