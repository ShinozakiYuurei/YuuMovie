package broadway

import "testing"

func TestStripHTMLCollapsesWhitespace(t *testing.T) {
	// A raw-string regex with a doubled backslash compiles fine and matches
	// nothing, so the whitespace silently survives into the published data.
	got := stripHTML("<p>第一段&nbsp;&nbsp;&nbsp;第二段</p>")
	if want := "第一段 第二段"; got != want {
		t.Fatalf("stripHTML = %q, want %q", got, want)
	}
}

func TestStripHTMLDecodesEntities(t *testing.T) {
	if got, want := stripHTML("a &amp; b"), "a & b"; got != want {
		t.Fatalf("stripHTML = %q, want %q", got, want)
	}
}

func TestSlugifyPrefersEnglishName(t *testing.T) {
	// The English title already carries the format marker, so joining both
	// names produced "imax-resident-evil-imax-1286".
	if got, want := slugify("生化危機", "IMAX Resident Evil", 1286), "imax-resident-evil-1286"; got != want {
		t.Fatalf("slugify = %q, want %q", got, want)
	}
}

func TestSlugifyFallsBackToChinese(t *testing.T) {
	// With no English title the base is empty once non-ASCII is dropped, so
	// the id alone carries the slug.
	if got, want := slugify("生化危機", "", 1286), "movie-1286"; got != want {
		t.Fatalf("slugify = %q, want %q", got, want)
	}
}

func TestHasCJK(t *testing.T) {
	cases := []struct {
		text string
		want bool
	}{
		{"粵語", true},
		{"English only", false},
		{"", false},
	}
	for _, c := range cases {
		if got := hasCJK(c.text); got != c.want {
			t.Fatalf("hasCJK(%q) = %v, want %v", c.text, got, c.want)
		}
	}
}

func TestNullableStringTurnsEmptyIntoNil(t *testing.T) {
	// Mirrors `value || null`, which does collapse "" to null.
	if got := nullableString(""); got != nil {
		t.Fatalf("nullableString(\"\") = %q, want nil", *got)
	}
	if got := nullableString("x"); got == nil || *got != "x" {
		t.Fatalf("nullableString(\"x\") = %v, want pointer to x", got)
	}
}

func TestNullishKeepsEmptyString(t *testing.T) {
	// Mirrors `value ?? null`, which keeps "". The circuit publishes an empty
	// dialect on 25 of 191 listings, so collapsing it would be a real loss.
	m := map[string]any{"blank": "", "nulled": nil, "filled": "粤语"}

	if got := nullish(m, "absent"); got != nil {
		t.Fatalf("nullish(absent) = %q, want nil", *got)
	}
	if got := nullish(m, "nulled"); got != nil {
		t.Fatalf("nullish(nulled) = %q, want nil", *got)
	}
	if got := nullish(m, "blank"); got == nil || *got != "" {
		t.Fatalf("nullish(blank) = %v, want pointer to empty string", got)
	}
	if got := nullish(m, "filled"); got == nil || *got != "粤语" {
		t.Fatalf("nullish(filled) = %v, want pointer to 粤语", got)
	}
}

func TestNullishIntKeepsZero(t *testing.T) {
	// Duration is 0 on unreleased films; null would claim the opposite.
	m := map[string]any{"zero": float64(0), "real": float64(96), "nulled": nil}

	if got := nullishInt(m, "zero"); got == nil || *got != 0 {
		t.Fatalf("nullishInt(zero) = %v, want pointer to 0", got)
	}
	if got := nullishInt(m, "real"); got == nil || *got != 96 {
		t.Fatalf("nullishInt(real) = %v, want pointer to 96", got)
	}
	if got := nullishInt(m, "nulled"); got != nil {
		t.Fatalf("nullishInt(nulled) = %d, want nil", *got)
	}
	if got := nullishInt(m, "absent"); got != nil {
		t.Fatalf("nullishInt(absent) = %d, want nil", *got)
	}
}
