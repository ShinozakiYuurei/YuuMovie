package newport

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"
)

func loadSamples(t *testing.T) (string, string) {
	t.Helper()
	en, err := os.ReadFile("../../../probe/newport-en.html")
	if err != nil {
		t.Skipf("fixture unavailable: %v", err)
	}
	zh, err := os.ReadFile("../../../probe/newport-tc.html")
	if err != nil {
		t.Skipf("fixture unavailable: %v", err)
	}
	return string(en), string(zh)
}

// referenceTime matches the date the fixture was captured, so DMYDate resolves
// the year the same way the live scrape did.
var referenceTime = time.Date(2026, 10, 9, 12, 0, 0, 0, scrapeutilHKT())

func scrapeutilHKT() *time.Location { return time.FixedZone("HKT", 8*60*60) }

// TestDeepFieldParity compares every field against the Node output.
// remainRate is excluded: the fixture was captured without seats and
// scrapeNewport re-fetches the seat plans, which change as people book.
func TestDeepFieldParity(t *testing.T) {
	const refPath = "../../../tmp/newport-node.json"
	raw, err := os.ReadFile(refPath)
	if err != nil {
		t.Skipf("reference unavailable: %v", err)
	}
	var ref map[string]any
	if err := json.Unmarshal(raw, &ref); err != nil {
		t.Fatalf("parse reference: %v", err)
	}

	en, zh := loadSamples(t)
	snap := Parse(en, zh, referenceTime)

	goRaw, err := json.Marshal(map[string]any{
		"movies":  snap.Movies,
		"shows":   snap.Shows,
		"cinemas": snap.Cinemas,
	})
	if err != nil {
		t.Fatalf("marshal go: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(goRaw, &got); err != nil {
		t.Fatalf("reparse go: %v", err)
	}

	for _, kind := range []string{"movies", "shows", "cinemas"} {
		diffRecords(t, kind, got[kind], ref[kind])
	}
}

// nullEquivalent lists fields where Go writes null and Node may omit the key.
// Every reader in lib/ is a truthiness test, so the two are equivalent; see the
// Nullable doc comment in internal/model.
var nullEquivalent = map[string]bool{
	"category": true, "version": true, "language": true,
	"remainRate": true, "seats": true, "soldOut": true,
}

// ignored lists fields whose values legitimately differ between the two runs.
var ignored = map[string]bool{"remainRate": true, "seats": true}

func diffRecords(t *testing.T, kind string, got, want any) {
	t.Helper()
	g := indexByID(t, kind, got)
	w := indexByID(t, kind, want)
	for id, grec := range g {
		wrec, ok := w[id]
		if !ok {
			t.Errorf("%s %s missing from the Node reference", kind, id)
			continue
		}
		for k, gv := range grec {
			if ignored[k] {
				continue
			}
			wv, present := wrec[k]
			if !present {
				if nullEquivalent[k] && gv == nil {
					continue
				}
				t.Errorf("%s %s: field %q present in Go but absent in Node", kind, id, k)
				continue
			}
			if !reflect.DeepEqual(gv, wv) {
				t.Errorf("%s %s .%s: go=%v node=%v", kind, id, k, gv, wv)
			}
		}
		for k := range wrec {
			if ignored[k] {
				continue
			}
			if _, present := grec[k]; !present {
				t.Errorf("%s %s: field %q absent in Go but present in Node", kind, id, k)
			}
		}
	}
}

func indexByID(t *testing.T, kind string, v any) map[string]map[string]any {
	t.Helper()
	list, ok := v.([]any)
	if !ok {
		t.Fatalf("%s is not a list: %T", kind, v)
	}
	out := map[string]map[string]any{}
	for _, item := range list {
		rec, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("%s item is not an object: %T", kind, item)
		}
		id, _ := rec["id"].(string)
		out[id] = rec
	}
	return out
}
