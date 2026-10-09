package model

import (
	"encoding/json"
	"testing"
)

// A snapshot round trip has to keep an explicit null. It did not once: the
// category collapsed into the unset state and the next write dropped the key,
// losing the difference lib/data.ts reads between "no category" and "null".
func TestCategorySurvivesRoundTrip(t *testing.T) {
	type row struct {
		Category Category `json:"category,omitzero"`
	}

	cases := []struct {
		name string
		json string
	}{
		{"absent", `{}`},
		{"explicit null", `{"category":null}`},
		{"value", `{"category":"IIA"}`},
	}

	for _, c := range cases {
		var got row
		if err := json.Unmarshal([]byte(c.json), &got); err != nil {
			t.Fatalf("%s: unmarshal: %v", c.name, err)
		}
		encoded, err := json.Marshal(got)
		if err != nil {
			t.Fatalf("%s: marshal: %v", c.name, err)
		}
		if string(encoded) != c.json {
			t.Errorf("%s: round trip gave %s, want %s", c.name, encoded, c.json)
		}
	}
}

func TestCategoryPresent(t *testing.T) {
	if got := CategoryPresent(""); !got.Present || !got.Null {
		t.Errorf("empty category should be a present null, got %+v", got)
	}
	if got := CategoryPresent("IIA"); !got.Present || got.Null || got.Value != "IIA" {
		t.Errorf("IIA should be a present value, got %+v", got)
	}
	var absent Category
	if absent.Present {
		t.Error("the zero value must mean absent")
	}
}
