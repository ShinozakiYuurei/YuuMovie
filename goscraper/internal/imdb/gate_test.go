package imdb

import "testing"

// YearGateOptions{venueName: 'NT Live', hkYear} mirrors the venue helper used by
// scripts/test-imdb-year-gate.mjs.
func venue(hkYear int) YearGateOptions {
	return YearGateOptions{VenueName: "NT Live", HKYear: hkYear}
}

// TestYearGate pins the gate that decides whether a score is shown at all.
//
// This is a 2026-10-09 audit product. The title matcher is good, and IMDb has no
// years of its own, so a title that looks close enough was being attached to the
// film as though it were the same one. Four groups of cases, each with real
// measurements behind it:
//
//  1. correct matches that must pass;
//  2. measured mismatches that must be rejected;
//  3. stage captures, where IMDb records the RECORDING year and Douban the
//     work's own year, so they are years apart and still the same thing;
//  4. missing data, where there is no second axis and the gate must stand aside.
//
// Expectations come from scripts/test-imdb-year-gate.mjs, which asserts the same
// table against the Node implementation.
func TestYearGate(t *testing.T) {
	check := func(label string, got, want bool) {
		t.Helper()
		if got != want {
			t.Errorf("%s: got %v, want %v", label, got, want)
		}
	}

	t.Run("correct matches pass", func(t *testing.T) {
		check("Street Fighter 2026/2026", YearGateOk(2026, 2026, true, "Street Fighter", YearGateOptions{}), true)
		check("Hidden Heroes 2004/2004", YearGateOk(2004, 2004, true, "Hidden Heroes", YearGateOptions{}), true)
		check("Look Back 2026/2024", YearGateOk(2026, 2024, true, "Look Back", YearGateOptions{}), true)
		// A Japanese film arriving before Douban lists it: the gap runs the other
		// way, which is why the gate is a cap and not a sign test.
		check("haiwaan 2026/2027", YearGateOk(2026, 2027, true, "Haiwaan", YearGateOptions{}), true)
		check("some film 2026/2023", YearGateOk(2026, 2023, true, "Some Film", YearGateOptions{}), true)
		check("Neon Genesis Evangelion 1997/1997", YearGateOk(1997, 1997, true, "Neon Genesis Evangelion", YearGateOptions{}), true)
	})

	t.Run("measured mismatches are rejected", func(t *testing.T) {
		check("跟蹤 Following 2024/2007", YearGateOk(2024, 2007, true, "Following", YearGateOptions{}), false)
		check("玩謝麥高維治 2025/1999", YearGateOk(2025, 1999, true, "Being Related to John Malkovich", YearGateOptions{}), false)
		check("危險人物 2024/1999", YearGateOk(2024, 1999, true, "Stealing Pulp Fiction", YearGateOptions{}), false)
		check("街霸 animation 1994/2026", YearGateOk(1994, 2026, true, "Street Fighter", YearGateOptions{}), false)
		check("小BN 2026/1997", YearGateOk(2026, 1997, true, "Children of Heaven", YearGateOptions{}), false)
		check("胡樂的院子 1991/2018", YearGateOk(1991, 2018, true, "The Nutcracker", YearGateOptions{}), false)
		check("十個拆彈的少年 2024/2015", YearGateOk(2024, 2015, true, "This Land of Mine", YearGateOptions{}), false)
		check("逆權司機 2017/2013", YearGateOk(2017, 2013, true, "A Taxi Driver", YearGateOptions{}), false)
		check("緋砂嬰兒 2013/2007", YearGateOk(2013, 2007, true, "Two Mothers", YearGateOptions{}), false)
	})

	t.Run("stage captures", func(t *testing.T) {
		// The title carries a capture marker, so the wide window applies.
		check("Misanthrope NT 2026/2017", YearGateOk(2026, 2017, true, "National Theatre Live: The Misanthrope", YearGateOptions{}), true)
		check("Earnest NT 2025/2015", YearGateOk(2025, 2015, true, "National Theatre Live: The Importance of Being Earnest", YearGateOptions{}), true)
		check("Les Liaisons NT 2026/1988", YearGateOk(2026, 1988, true, "National Theatre Live: Les Liaisons Dangereuses", YearGateOptions{}), true)
		// No marker in the title, so recognition falls to the year sitting on the
		// Hong Kong year: a new recording is made in the year it is released.
		check("All My Sons 2026/2019 at a venue", YearGateOk(2026, 2019, true, "All My Sons", venue(2026)), true)
		// The case that set the threshold: same venue name, but the mismatched
		// entry is from 2020, six years before the run.
		check("The Audience 2020/2013 at a venue", YearGateOk(2020, 2013, true, "The Audience", venue(2026)), false)
		// Without the venue name there is nothing to recognise a capture by.
		check("All My Sons 2026/2019 no venue", YearGateOk(2026, 2019, true, "All My Sons", YearGateOptions{}), false)
	})

	t.Run("missing data stands aside", func(t *testing.T) {
		check("no Douban year", YearGateOk(2024, 0, true, "Following", YearGateOptions{}), true)
		check("no IMDb year", YearGateOk(0, 2007, true, "Children of Heaven", YearGateOptions{}), true)
		// An unrated entry is most likely one opened for THIS reissue, whose year
		// naturally sits far from Douban's, and rejecting it would also reject the
		// only correct entry.
		check("no rating yet", YearGateOk(2026, 1997, false, "Children of Heaven", YearGateOptions{}), true)
	})
}

// TestYearGateMaxGap pins the threshold itself, because the value is a
// judgement made from a distribution rather than a constant anyone should tune.
func TestYearGateMaxGap(t *testing.T) {
	if IMDbDoubanYearMaxGap != 3 {
		t.Fatalf("max gap = %d, want 3", IMDbDoubanYearMaxGap)
	}
	// The band around the threshold is documented as empty in the data: 0-2 is
	// all correct and 4+ contains confirmed mismatches. A gap of exactly 3 is the
	// documented edge.
	if !YearGateOk(2026, 2023, true, "x", YearGateOptions{}) {
		t.Error("a gap of 3 was rejected")
	}
	if YearGateOk(2026, 2022, true, "x", YearGateOptions{}) {
		t.Error("a gap of 4 was accepted")
	}
}

// TestReissueEvidence pins the rule that unlocks the fallback.
func TestReissueEvidence(t *testing.T) {
	if !IsReissueEvidence(1997, 2026) {
		t.Error("a 29-year gap was not treated as a reissue")
	}
	// A genuinely new film with an old namesake: same-name films sit alongside
	// each other, so this must NOT unlock the fallback.
	if IsReissueEvidence(2026, 2026) {
		t.Error("the same year unlocked a fallback")
	}
	// No Douban data means no evidence, and no evidence means no fallback.
	if IsReissueEvidence(0, 2026) {
		t.Error("no Douban year unlocked a fallback")
	}
	if IsReissueEvidence(1997, 0) {
		t.Error("no Hong Kong year unlocked a fallback")
	}
}

// TestReissueGateRegression ports scripts/test-reissue-gate.mjs case for case.
//
// Two gates guard a reissue fallback, and the two failure shapes are identical
// in the candidate list: a same-name new film carrying an old film's score
// (Douban year much earlier) and a wrong film with a close title (Douban year
// close but IMDb title year not). The threshold alone separates neither, so both
// are pinned here.
func TestReissueGateRegression(t *testing.T) {
	if ReissueMinDoubanGap != 5 {
		t.Fatalf("ReissueMinDoubanGap = %d, want 5", ReissueMinDoubanGap)
	}
	if ReissueYearTolerance != 1 {
		t.Fatalf("ReissueYearTolerance = %d, want 1", ReissueYearTolerance)
	}

	gate1 := []struct {
		douban int
		hk     int
		want   bool
		why    string
	}{
		// Real reissues: Douban's original year sits well below the Hong Kong one.
		{1997, 2026, true, "EVA 死與新生 1997 original, 2026 reissue"},
		{1995, 2026, true, "情留半 Heaven 1995"},
		{1990, 2026, true, "開膛正義"},
		{1993, 2025, true, "鬥牛 4K"},
		{1986, 2026, true, "Queen Budapest"},
		{1985, 2026, true, "五月天演唱會"},
		{2021, 2026, true, "gap of 5"},
		{2020, 2026, true, "gap of 6"},
		// Same-name new films: the Hong Kong year equals the Douban year or is
		// adjacent, so no fallback. This is the bug the gate was added for.
		{2026, 2026, false, "Resident Evil 2026 vs the 2002 namesake"},
		{2026, 2026, false, "獨角獸中心 2026"},
		{2026, 2026, false, "魔法使者 2026"},
		{2026, 2026, false, "披薩獸 2026"},
		{2026, 2026, false, "捉妖 2026"},
		{2027, 2027, false, "大破天幕 6 2027"},
		{2024, 2026, false, "gap of 2: a sequel, not a reissue"},
		{2023, 2026, false, "gap of 3"},
		{2022, 2026, false, "gap of 4: still under threshold"},
		// Missing data never counts as evidence.
		{0, 2026, false, "no Douban year"},
		{2026, 0, false, "no Hong Kong year"},
		{0, 0, false, "neither side"},
		{0, 2026, false, "zero is treated as missing"},
		{2026, 0, false, "zero is treated as missing (Hong Kong side)"},
		{2030, 2026, false, "a Douban year later than the release (abnormal data)"},
	}
	for _, tc := range gate1 {
		if got := IsReissueEvidence(tc.douban, tc.hk); got != tc.want {
			t.Errorf("IsReissueEvidence(%d, %d) = %v, want %v: %s",
				tc.douban, tc.hk, got, tc.want, tc.why)
		}
	}

	gate2 := []struct {
		cand   int
		douban int
		want   bool
		why    string
	}{
		// Correct cases: measured true matches are always exact, so the tolerance
		// only leaves room for a festival year against a release year.
		{1997, 1997, true, "EVA 死與新生, exact"},
		{2004, 2004, true, "追擊8月15, exact"},
		{1995, 1995, true, "情留半"},
		{1990, 1990, true, "開膛正義"},
		{1985, 1985, true, "五月天演唱會"},
		{2001, 2001, true, "龍虎門風雲"},
		{1996, 1997, true, "gap of 1: a festival year against a release year"},
		// An entry with no year is not rejected.
		{0, 1997, true, "candidate has no year"},
		// Another film with the same name, years off.
		{2001, 2017, false, "恨世者: Douban 2017 falling back to 2001 The Misanthrope"},
		{2024, 1998, false, "天鵝湖: Douban 1998 falling back to 2024 Swan Lake"},
		{2005, 2026, false, "獨角獸中心: Douban 2026 falling back to 2005"},
		{1993, 2026, false, "披薩獸: Douban 2026 falling back to 1993"},
		{1993, 2026, false, "魔法使者: Douban 2026 falling back to 1993"},
		{2024, 2026, false, "捉妖: gap of 2 is over tolerance"},
		{2002, 2026, false, "Resident Evil: Douban 2026 falling back to 2002"},
		{1997, 2026, false, "gap of 29"},
		{1993, 1998, false, "gap of 5"},
		// A Taxi Driver: Douban 2013 is a different film from IMDb 2017. This is the
		// smallest measured mismatch gap, which is why the tolerance is 1.
		{2017, 2013, false, "A Taxi Driver, the smallest measured mismatch at 4"},
		{2024, 2020, false, "gap of 4"},
		// Missing Douban year: no evidence.
		{2000, 0, false, "no Douban year"},
		{0, 0, false, "neither side"},
	}
	for _, tc := range gate2 {
		if got := MatchesDoubanYear(tc.cand, tc.douban); got != tc.want {
			t.Errorf("MatchesDoubanYear(%d, %d) = %v, want %v: %s",
				tc.cand, tc.douban, got, tc.want, tc.why)
		}
	}
}

// TestMatchesDoubanYear pins the second gate.
func TestMatchesDoubanYear(t *testing.T) {
	// The two counter-examples that forced this gate.
	if MatchesDoubanYear(2001, 2017) {
		t.Error("The Misanthrope 2001 passed against Douban 2017")
	}
	if MatchesDoubanYear(2024, 1998) {
		t.Error("Swan Lake 2024 passed against Douban 1998")
	}
	// The two that are correct, at gap 0.
	if !MatchesDoubanYear(1997, 1997) || !MatchesDoubanYear(2004, 2004) {
		t.Error("a gap of 0 was rejected")
	}
	// An entry with no year is not rejected: some IMDb entries carry none.
	if !MatchesDoubanYear(0, 1997) {
		t.Error("a candidate with no year was rejected")
	}
	// No Douban year means the gate cannot be applied, and says so by failing
	// closed: the caller only runs it once Douban has matched.
	if MatchesDoubanYear(1997, 0) {
		t.Error("the gate passed with no Douban year")
	}
}
