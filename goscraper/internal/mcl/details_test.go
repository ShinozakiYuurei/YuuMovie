package mcl

import (
	"encoding/json"
	"testing"
)

func TestParseDetailContract(t *testing.T) {
	entry := `{"id":14743,"mn":"以你的名字呼喚我 (特別放映)","b":{"mrt":"132","mc":"III","mg":"劇情、愛情 (特備節目)","ml":"","ms":""},"e":{"md":"魯卡加達連奴","mc":"<p>添麥菲查洛美、艾米漢默</p>"},"i":"<p>艾利奧與奧利華在意大利相識，譜寫出一段夏日戀曲。</p>"}`
	raw := []json.RawMessage{json.RawMessage(entry)}

	// 1. Correct match
	d := parseDetail(raw, 14743, "以你的名字呼喚我 (特別放映)")
	if d == nil {
		t.Fatal("expected non-nil detail on exact match")
	}
	if d.NameZh != "以你的名字呼喚我 (特別放映)" {
		t.Errorf("NameZh = %q", d.NameZh)
	}
	if d.Duration == nil || *d.Duration != 132 {
		t.Errorf("Duration = %v, want 132", d.Duration)
	}
	if d.Category == nil || *d.Category != "III" {
		t.Errorf("Category = %v, want III", d.Category)
	}
	if d.Description != "艾利奧與奧利華在意大利相識，譜寫出一段夏日戀曲。" {
		t.Errorf("Description = %q", d.Description)
	}

	// 2. ID mismatch rejects
	if parseDetail(raw, 99999, "以你的名字呼喚我 (特別放映)") != nil {
		t.Error("mismatched id should yield nil")
	}

	// 3. Title mismatch rejects
	if parseDetail(raw, 14743, "完全不同片名") != nil {
		t.Error("mismatched title should yield nil")
	}
}