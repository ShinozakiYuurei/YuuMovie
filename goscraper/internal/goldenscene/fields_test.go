package goldenscene

import "testing"

func TestLocalizedReadsZhHK(t *testing.T) {
	value := map[string]any{"zhHK": "IIA", "enGB": "IIA"}
	if got := localized(value); got != "IIA" {
		t.Errorf("localized = %q, want IIA", got)
	}
	if got := localized(map[string]any{"enGB": "English"}); got != "" {
		t.Errorf("localized without zhHK = %q, want empty", got)
	}
	if got := localized("plain"); got != "" {
		t.Errorf("localized on a string = %q, want empty", got)
	}
}

// versionTags nest the localised name one level deeper than genres do.
func TestNameListUnwrapsNestedName(t *testing.T) {
	tags := []any{
		map[string]any{"name": map[string]any{"zhHK": "2D", "enGB": "2D"}},
		map[string]any{"name": map[string]any{"zhHK": "粵語", "enGB": "Cantonese"}},
	}
	got := nameList(tags)
	if len(got) != 2 || got[0] != "2D" || got[1] != "粵語" {
		t.Errorf("nameList = %v, want the nested names", got)
	}
}
