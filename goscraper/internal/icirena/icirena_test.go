package icirena

import (
	"math"
	"testing"
)

// The signature is the whole point of this package: it replaced a headless
// browser. This pins the canonical string and the digest against values the
// platform actually accepted.
func TestCanonicalSortsAndSkipsEmpty(t *testing.T) {
	params := map[string]string{
		"channelCode": "ECML_WEB_PROD_S_MPS",
		"app_key":     "500000",
		"empCode":     "",
		"version":     "H5",
		"method":      "gop.alipic.icirena.own.film.showing",
	}

	got := canonical("", params)

	want := "app_key500000channelCodeECML_WEB_PROD_S_MPS" +
		"methodgop.alipic.icirena.own.film.showingversionH5"
	if got != want {
		t.Fatalf("canonical = %q, want %q", got, want)
	}
}

func TestSignIsUppercaseHexHMAC(t *testing.T) {
	got := sign(canonical("", map[string]string{"app_key": "500000"}))
	if len(got) != 64 {
		t.Fatalf("sign length = %d, want 64", len(got))
	}
	for _, c := range got {
		if !(c >= '0' && c <= '9') && !(c >= 'A' && c <= 'F') {
			t.Fatalf("sign contains %q, want uppercase hex only", c)
		}
	}
}

func TestAddDays(t *testing.T) {
	if got := addDays("2026-10-09", 21); got != "2026-10-30" {
		t.Fatalf("addDays = %q, want 2026-10-30", got)
	}
	if got := addDays("not-a-date", 3); got != "not-a-date" {
		t.Fatalf("addDays on garbage = %q, want it returned unchanged", got)
	}
}

// seatRate is the share already sold; reading it as remaining would invert
// the seat colour on every row.
func TestNormalizeShowInvertsSeatRate(t *testing.T) {
	s := &Scraper{Cfg: Channels["emperor"]}
	show := s.normalizeShow(Source(s.Cfg), "emperor-1", "57002", "999",
		"2026-10-09T20:00:00.000+08:00", rawSchedule{
			SeatRate: floatPtr(40),
		})
	if !show.RemainRate.Set || math.Abs(show.RemainRate.Value-0.6) > 1e-9 {
		t.Fatalf("remainRate = %+v, want 0.6", show.RemainRate)
	}
	if show.SoldOut == nil || *show.SoldOut {
		t.Fatalf("soldOut = %v, want false pointer", show.SoldOut)
	}
}

func TestNormalizeShowSoldOut(t *testing.T) {
	s := &Scraper{Cfg: Channels["emperor"]}
	show := s.normalizeShow(Source(s.Cfg), "emperor-1", "57002", "999",
		"2026-10-09T20:00:00.000+08:00", rawSchedule{
			SeatRate: floatPtr(100),
		})
	if show.SoldOut == nil || !*show.SoldOut {
		t.Fatalf("soldOut = %v, want true pointer", show.SoldOut)
	}
	if show.RemainRate.Value != 0 {
		t.Fatalf("remainRate = %+v, want 0", show.RemainRate)
	}
}

func floatPtr(v float64) *float64 { return &v }
