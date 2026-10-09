package mcl

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// mclTarget is one film whose details are wanted.
type mclTarget struct {
	// ID is the numeric film id.
	ID int
	// Name is the listing title, used to validate the detail. It may be empty
	// when the grid omitted a film that is still scheduling.
	Name string
}

// detailCachePath is where metadata is cached between runs.
//
// The cache is written to data/mcl-details.json, next to the snapshots, so a
// deployment that mounts data/ as a volume keeps it across rebuilds.
func detailCachePath() string {
	if p := os.Getenv("MCL_DETAIL_CACHE"); p != "" {
		return p
	}
	return filepath.Join("data", "mcl-details.json")
}

// readCache loads the cache, treating any unreadable file as empty.
func readCache(path string) map[string]cacheEntry {
	out := map[string]cacheEntry{}
	raw, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]cacheEntry{}
	}
	return out
}

// writeCache saves the cache atomically, so a crash mid-write cannot leave a
// truncated file that would drop every cached record.
func writeCache(path string, cache map[string]cacheEntry) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	raw, err := json.Marshal(cache)
	if err != nil {
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, path)
}

// trimDetail keeps only the metadata fields.
//
// The endpoint also returns trailers and stills, which are large and unused;
// caching them would bloat the file for no benefit. The id and title stay
// because every read re-validates them.
func trimDetail(raw json.RawMessage) []json.RawMessage {
	var in map[string]json.RawMessage
	if err := json.Unmarshal(raw, &in); err != nil {
		return []json.RawMessage{raw}
	}
	out := map[string]json.RawMessage{}
	for _, key := range []string{"id", "mn", "b", "e", "i"} {
		if v, ok := in[key]; ok {
			out[key] = v
		}
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		return []json.RawMessage{raw}
	}
	return []json.RawMessage{encoded}
}
