package imdb

import (
	"fmt"
	"testing"
)

// TestTitleScoreParity pins every titleScore value against the Node reference.
//
// These are the numbers the ranking sorts on, and pass/fail against a threshold
// would not catch a shift from 82 to 76: both clear the bar, but they rank
// differently against every other candidate. The expectations were produced by
// running scripts/ts-parity.mjs against scrapers/imdb.js.
func TestTitleScoreParity(t *testing.T) {
	cases := []struct {
		query string
		cand  string
		want  int
	}{
		{"Sakamoto Days", "Sakamoto Days", 100},
		{"IMAX Avengers Endgame Encore", "IMAX Avengers Endgame Encore", 100},
		{"The End of Evangelion", "Neon Genesis Evangelion The End of Evangelion", 82},
		{"Avengers Endgame", "Avengers Endgame Encore", 82},
		{"Look Back", "Look Back 駁死回歸", 82},
		{"Avengers Endgame", "IMAX Avengers Endgame", 82},
		{"IMAX Avengers Endgame", "Avengers Endgame", 76},
		{"Evangelion Death True Rebirth", "Neon Genesis Evangelion Death Rebirth", 76},
		{"Taxi", "Taxi", 100},
		{"Hope", "Hope", 100},
		{"The End of Evangelion", "The End of Oak Street", 0},
		{"Evangelion 1.11 You Are Not Alone", "You Are Not Alone", 0},
		{"Rocky 3", "Rocky 4", 0},
		{"Rocky 3", "Rocky 5", 0},
		{"Evangelion 1.0 You Are Not Alone", "Evangelion 3.0 1.0 Thrice Upon a Time", 0},
		{"M", "M the Movie of the Century", 0},
		{"Fall", "Fall 2 Deadpoint", 0},
		{"Fall", "Fall Guys The Ultimate Showdown", 0},
		{"Hope", "Hopeless", 0},
		// The known trade-off: the query is fully contained in the candidate.
		// Noted rather than asserted, because the test above only requires it not
		// to clear the bar and this happens to score 82.
		{"You Are Not Alone", "Evangelion 1.11 You Are Not Alone", 82},
	}
	for _, tc := range cases {
		got := TitleScore(Norm(tc.cand), Norm(tc.query))
		if got != tc.want {
			t.Errorf("query %q against candidate %q = %d, want %d", tc.query, tc.cand, got, tc.want)
		}
	}
}

// TestNormParity pins the normalisation, which the scores above all assume.
func TestNormParity(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"Fall 2: Deadpoint", "fall 2 deadpoint"},
		{"The End of Evangelion", "the end of evangelion"},
		{"M (GFF)", "m gff"},
		{"偵戰 IMPACT", "偵戰 impact"},
		{"ア子は", "ア子は"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := Norm(tc.in); got != tc.want {
			t.Errorf("Norm(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestRankParity pins the two-pass ranking, which is separate from the scoring.
//
// Expectations come from scripts/rk-parity.mjs against scrapers/imdb.js. The
// strict pass drops the 1997 entry entirely, which is the point of having two
// passes at all: the reissue window is opened only when the strict one came back
// short, so a namesake never reaches the top by default.
func TestRankParity(t *testing.T) {
	candidates := []Candidate{
		{ID: "tt-b", Title: "Some Film", Year: 2025, QID: "movie"},
		{ID: "tt-a", Title: "Some Film", Year: 1997, QID: "movie"},
	}

	strict := Rank(candidates, "Some Film", 2026, RankOptions{})
	if len(strict) != 1 || strict[0].Candidate.ID != "tt-b" || strict[0].Score != 112 {
		t.Errorf("strict = %+v, want only tt-b at 112", strict)
	}

	// With the window open the 1997 original comes back, but still second: a year
	// close to the Hong Kong one outranks the original on score.
	reissue := Rank(candidates, "Some Film", 2026, RankOptions{Reissue: true})
	if len(reissue) != 2 {
		t.Fatalf("reissue ranked %d, want 2", len(reissue))
	}
	if reissue[0].Candidate.ID != "tt-b" || reissue[0].Score != 112 {
		t.Errorf("reissue first = %s (%d), want tt-b at 112", reissue[0].Candidate.ID, reissue[0].Score)
	}
	if reissue[1].Candidate.ID != "tt-a" || reissue[1].Score != 104 {
		t.Errorf("reissue second = %s (%d), want tt-a at 104", reissue[1].Candidate.ID, reissue[1].Score)
	}
}

// TestRankRejectsWrongYear checks the year window that keeps namesakes out.
func TestRankRejectsWrongYear(t *testing.T) {
	// "M" 1931 against a 2026 listing: this is the case that forced a cap on the
	// reissue window. Without one, a single-character title reaches Lang's M.
	if ranked := Rank([]Candidate{{ID: "tt-m", Title: "M", Year: 1931, QID: "movie"}},
		"M", 2026, RankOptions{Reissue: true}); len(ranked) != 0 {
		t.Errorf("the 1931 M survived the reissue window: %+v", ranked)
	}

	// "Street Fighter" 1994 does survive here: the title is confident, so the
	// wider window applies. This is exactly why the year gate downstream exists,
	// since a 32-year gap against Douban is what rejects it.
	ranked := Rank([]Candidate{{ID: "tt-sf", Title: "Street Fighter", Year: 1994, QID: "movie"}},
		"Street Fighter", 2026, RankOptions{Reissue: true})
	if len(ranked) != 1 || ranked[0].Score != 104 {
		t.Errorf("ranked = %+v, want tt-sf at 104", ranked)
	}
}

// TestScoreRejectsNonFilms covers the suggestion endpoint's other result types.
func TestScoreRejectsNonFilms(t *testing.T) {
	ranked := Rank([]Candidate{
		{ID: "nm0000001", Title: "Some Person", Year: 2026, QID: "name"},
	}, "Some Person Here", 2026, RankOptions{})
	if len(ranked) != 0 {
		t.Errorf("a person entry was ranked: %+v", ranked[0])
	}
}

// TestTrimmedCandidateFormat pins the cache file's shorthand.
func TestTrimmedCandidateFormat(t *testing.T) {
	got := TrimmedCandidate(Scored{Candidate: Candidate{ID: "tt1", Year: 2026}, Score: 96})
	if got != "tt1:2026:96" {
		t.Errorf("got %q, want tt1:2026:96", got)
	}
	got = TrimmedCandidate(Scored{Candidate: Candidate{ID: "tt2"}, Score: 80})
	if got != fmt.Sprintf("tt2:?:80") {
		t.Errorf("got %q, want tt2:?:80", got)
	}
}
