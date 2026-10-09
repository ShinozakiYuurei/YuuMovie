package enrich

// PlanItem is one film in the plan, in the shape the diff compares.
type PlanItem struct {
	Key      string   `json:"key"`
	Year     int      `json:"year"`
	NameZh   string   `json:"nameZh"`
	NameEn   string   `json:"nameEn"`
	Queries  []string `json:"queries"`
	MovieIDs []string `json:"ids"`
}

// Plan builds the fold of the circuit listings, without sending anything.
//
// It is exported so a plan can be compared against the Node reference without
// running a pass, which is what makes a difference in the key or the year
// visible before any score is fetched.
func Plan(root string) ([]PlanItem, error) {
	s := openStore(root, Options{})
	movies, err := s.loadMovies()
	if err != nil {
		return nil, err
	}
	items := buildPlan(movies)
	out := make([]PlanItem, 0, len(items))
	for _, item := range items {
		ids := item.MovieIDs
		if ids == nil {
			ids = []string{}
		}
		out = append(out, PlanItem{
			Key:      item.Key,
			Year:     item.Year,
			NameZh:   item.NameZh,
			NameEn:   item.NameEn,
			Queries:  item.Queries,
			MovieIDs: ids,
		})
	}
	return out, nil
}
