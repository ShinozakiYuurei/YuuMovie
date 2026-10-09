package sunbeam

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

// TestDeepFieldParity compares every field of every record against the Node
// output. Counts agreeing is not enough: a field can be renamed, dropped or
// retyped while the record count stays identical, which is exactly the class of
// bug the Chinachem port had to chase.
//
// Two differences are expected and asserted rather than ignored:
//
//   - poster host. The JS passes cdn.sunbeamwhampoa.com as the base, but the
//     page's own coverUrl values are absolute on www.sunbeamwhampoa.com, so
//     resolving them yields the www host. Both serve the same object; the www
//     form is what the page itself links to.
//
//   - null vs absent for category/version/language. Chinachem omits these keys
//     while Sunbeam writes null. Every reader is a truthiness test, so the two
//     are equivalent, and Go writes null uniformly.
func TestDeepFieldParity(t *testing.T) {
	const refPath = "../../../tmp/sunbeam-node.json"
	raw, err := os.ReadFile(refPath)
	if err != nil {
		t.Skipf("reference unavailable: %v", err)
	}
	var ref map[string]any
	if err := json.Unmarshal(raw, &ref); err != nil {
		t.Fatalf("parse reference: %v", err)
	}

	snap := Parse(loadSample(t))
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

// nullEquivalent lists the fields where Go writes null and Node may omit the key.
var nullEquivalent = map[string]bool{"category": true, "version": true, "language": true}

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
			wv, present := wrec[k]
			if !present {
				if nullEquivalent[k] && gv == nil {
					continue
				}
				t.Errorf("%s %s: field %q present in Go but absent in Node", kind, id, k)
				continue
			}
			if k == "poster" {
				if gs, ws, ok := gv.(string), wv.(string), true; ok && samePosterObject(gs, ws) {
					continue
				}
			}
			if !reflect.DeepEqual(gv, wv) {
				t.Errorf("%s %s .%s: go=%v node=%v", kind, id, k, gv, wv)
			}
		}
		for k := range wrec {
			if _, present := grec[k]; !present {
				t.Errorf("%s %s: field %q absent in Go but present in Node", kind, id, k)
			}
		}
	}
}

// samePosterObject reports whether two URLs point at the same cover, ignoring
// the host. The JS resolves relative covers against cdn.sunbeamwhampoa.com
// while the page's own values are absolute on www.sunbeamwhampoa.com.
func samePosterObject(a, b string) bool {
	if a == b {
		return true
	}
	ai, bi := strings.Index(a, "/whampoa/"), strings.Index(b, "/whampoa/")
	if ai < 0 || bi < 0 {
		return false
	}
	return a[ai:] == b[bi:]
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
