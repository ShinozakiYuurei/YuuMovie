package enrich

import "encoding/json"

// CacheJSON returns the cache as indented JSON, so a run's output can be diffed
// against the Node script's file.
//
// The timestamps are left as they are written rather than being normalised: the
// comparison is field by field, and a fake timestamp would hide a real difference
// in when something was refreshed.
func (r *Runner) CacheJSON() ([]byte, error) {
	cache := r.store.loadCache()
	raw, err := json.MarshalIndent(cache, "", " ")
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}
