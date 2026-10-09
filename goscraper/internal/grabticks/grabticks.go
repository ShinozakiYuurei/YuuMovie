// Package grabticks scrapes the circuits that share the GrabTicks platform:
// CGV and CineArt.
//
// Ported from scrapers/grabticks.js. Both serve a Next.js Flight payload, so the
// parsing lives in internal/flight; this package is the schema layer on top.
//
// The English-title correction table is not cosmetic: the circuits list the
// Evangelion films under their Japanese home-video numbering (1.11) while the
// official cinema titles and the IMDb data use 1.0, and the mismatch showed up
// on the site before it was corrected.
package grabticks

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/flight"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// Channel describes one circuit on the platform.
type Channel struct {
	Source string
	Base   string
	Route  string
}

// Channels are the two circuits this platform serves.
var Channels = map[string]Channel{
	"cgv":     {Source: "cgv", Base: "https://cgv.com.hk", Route: "zh"},
	"cineart": {Source: "cineart", Base: "https://cinearthouse.com.hk", Route: "hk"},
}

// correctedEnglishTitles maps the circuit's spelling to the official one. The
// keys are the strings as returned, verbatim.
var correctedEnglishTitles = map[string]string{
	"Evangelion: 1.11 You Are (Not) Alone.": "Evangelion: 1.0 You Are (Not) Alone",
	"Evangelion: 1.11 You Are (Not) Alone":  "Evangelion: 1.0 You Are (Not) Alone",
}

func correctedEnglish(en string) string {
	if fixed, ok := correctedEnglishTitles[en]; ok {
		return fixed
	}
	return en
}

// Scraper holds the HTTP client so tests can substitute one.
type Scraper struct{ Client *fetch.Client }

// New builds a Scraper with the default client.
func New() *Scraper { return &Scraper{Client: fetch.New()} }

// rawPage is the decoded payload of one page, before normalisation.
type rawPage struct {
	records    map[int]string
	movies     []map[string]any
	shows      []map[string]any
	sites      []map[string]any
	siteGroups []map[string]any
	houses     []map[string]any
}

func decodePage(html string) (*rawPage, error) {
	doc := flight.Extract(html)
	if doc == "" {
		return nil, fmt.Errorf("GrabTicks page has no Flight payload")
	}
	p := &rawPage{records: flight.Records(doc)}
	_ = flight.ValueAfter(doc, "movies", &p.movies)
	_ = flight.ValueAfter(doc, "shows", &p.shows)
	_ = flight.ValueAfter(doc, "showSites", &p.sites)
	_ = flight.ValueAfter(doc, "siteGroups", &p.siteGroups)
	_ = flight.ValueAfter(doc, "houses", &p.houses)
	return p, nil
}

// ScrapeCineArt fetches the CineArt listing, which already carries everything.
func (s *Scraper) ScrapeCineArt(ctx context.Context) (*model.Snapshot, error) {
	cfg := Channels["cineart"]
	body, err := s.Client.Get(ctx, cfg.Base+"/"+cfg.Route)
	if err != nil {
		return nil, fmt.Errorf("fetch cineart: %w", err)
	}
	page, err := decodePage(string(body))
	if err != nil {
		return nil, err
	}
	snap := normalize(cfg, page, scrapeutil.NowHKT())
	if len(snap.Cinemas) == 0 || len(snap.Shows) == 0 {
		return nil, fmt.Errorf("CineArt returned incomplete show data")
	}
	return snap, nil
}

var movieLinkRe = regexp.MustCompile(`href=["']/zh/movie/(\d+)`)

// ScrapeCGV walks the movie listing because its schedule is spread across one
// page per film. maxMovies limits the walk for testing; 0 means all.
//
// Each page is normalised SEPARATELY and only the finished records are merged.
// That detail is load-bearing: every page carries its own React Flight record
// table, and a description stored as "$1e" only means something against the
// table of the page it came from. Merging the tables first — which is what the
// Node scraper does — makes ids collide across pages, so one film's reference
// resolves against another film's table and picks up the wrong synopsis. The
// live Node output contains exactly that: cgv-979 publishes the literal text
// "$1e" as its description, and cgv-932 shares a synopsis with cgv-842.
func (s *Scraper) ScrapeCGV(ctx context.Context, maxMovies int) (*model.Snapshot, error) {
	cfg := Channels["cgv"]
	listing, err := s.Client.Get(ctx, cfg.Base+"/"+cfg.Route+"/movie")
	if err != nil {
		return nil, fmt.Errorf("fetch cgv listing: %w", err)
	}

	seen := map[string]bool{}
	var ids []string
	for _, m := range movieLinkRe.FindAllStringSubmatch(string(listing), -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			ids = append(ids, m[1])
		}
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("CGV movie listing returned no movie links")
	}
	if maxMovies > 0 && maxMovies < len(ids) {
		ids = ids[:maxMovies]
	}

	// Fetch and normalise each page on its own; a failed film is skipped rather
	// than failing the circuit, matching the JS.
	perPage := make([]*model.Snapshot, len(ids))
	now := scrapeutil.NowHKT()
	var mu sync.Mutex
	runPool(len(ids), 3, func(i int) {
		body, err := s.Client.Get(ctx, cfg.Base+"/"+cfg.Route+"/movie/"+ids[i])
		if err != nil {
			return
		}
		page, err := decodePage(string(body))
		if err != nil {
			return
		}
		snap := normalize(cfg, page, now)
		mu.Lock()
		perPage[i] = snap
		mu.Unlock()
	})

	return mergeSnapshots(perPage), nil
}

// mergeSnapshots combines per-page results, keeping the first record seen for
// each id. Order follows the page order so the output is stable across runs.
func mergeSnapshots(pages []*model.Snapshot) *model.Snapshot {
	out := &model.Snapshot{}
	seenMovie := map[string]bool{}
	seenShow := map[string]bool{}
	seenCinema := map[string]bool{}
	for _, page := range pages {
		if page == nil {
			continue
		}
		for _, m := range page.Movies {
			if seenMovie[m.ID] {
				continue
			}
			seenMovie[m.ID] = true
			out.Movies = append(out.Movies, m)
		}
		for _, s := range page.Shows {
			if seenShow[s.ID] {
				continue
			}
			seenShow[s.ID] = true
			out.Shows = append(out.Shows, s)
		}
		for _, c := range page.Cinemas {
			if seenCinema[c.ID] {
				continue
			}
			seenCinema[c.ID] = true
			out.Cinemas = append(out.Cinemas, c)
		}
	}
	return out
} // normalize turns a decoded payload into the snapshot shape, mirroring
// normalizeGrabTicks().
func normalize(cfg Channel, raw *rawPage, now time.Time) *model.Snapshot {
	records := raw.records
	if records == nil {
		records = map[int]string{}
	}
	today := now.Format("2006-01-02")

	movieByID := map[string]map[string]any{}
	var movieOrder []string
	for _, m := range raw.movies {
		id := stringify(m["id"])
		if id == "" {
			continue
		}
		if _, seen := movieByID[id]; !seen {
			movieOrder = append(movieOrder, id)
		}
		movieByID[id] = m
	}

	// Sites can arrive grouped; flatten the groups and fall back to the flat
	// list, exactly as the JS does.
	var sites []map[string]any
	for _, group := range raw.siteGroups {
		items, _ := group["items"].([]any)
		for _, item := range items {
			im, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if site, ok := im["site"].(map[string]any); ok {
				sites = append(sites, site)
			}
		}
	}
	if len(sites) == 0 {
		sites = raw.sites
	}

	houses := map[string]map[string]any{}
	for _, h := range raw.houses {
		houses[stringify(h["id"])] = h
	}
	for _, site := range sites {
		if list, ok := site["houses"].([]any); ok {
			for _, item := range list {
				if h, ok := item.(map[string]any); ok {
					houses[stringify(h["id"])] = h
				}
			}
		}
	}

	var movies []model.Movie
	for _, id := range movieOrder {
		m := movieByID[id]
		opening := datePart(stringify(m["openingDate"]))
		nameZh := grabLang(records, firstNonNil(m["name_lang"], m["title_lang"], m["name"]))
		if nameZh == "" {
			nameZh = firstString(m["title"], m["name"])
		}
		nameEn := correctedEnglish(grabLang(records, firstNonNil(m["name_lang"], m["title_lang"], m["name"]), "en"))
		if nameEn == "" {
			nameEn = correctedEnglish(firstString(m["title"], m["name"]))
		}

		var genres []string
		if types, ok := m["movieTypes"].([]any); ok {
			for _, t := range types {
				tm, ok := t.(map[string]any)
				if !ok {
					continue
				}
				if g := grabLang(records, firstNonNil(tm["name_lang"], tm["name"])); g != "" {
					genres = append(genres, g)
				}
			}
		}
		if genres == nil {
			genres = []string{}
		}

		status := "showing"
		if opening != "" && opening > today {
			status = "upcoming"
		}

		var poster *string
		if images, ok := m["images"].([]any); ok && len(images) > 0 {
			if u := imageURL(firstString(images[0])); u != "" {
				poster = &u
			}
		}

		movies = append(movies, model.Movie{
			ID:          cfg.Source + "-" + id,
			NameZh:      nameZh,
			NameEn:      nameEn,
			OpeningDate: model.NullablePtr(model.PtrToNullable(scrapeutil.NullableString(opening))),
			Duration:    nullableNumberToInt(m["duration"]),
			Category:    scrapeutil.NullableString(firstString(m["category"])),
			Dialect:     scrapeutil.NullableString(grabLang(records, firstNonNil(m["dialect_lang"], m["dialect"]))),
			Subtitle:    scrapeutil.NullableString(grabLang(records, firstNonNil(m["subtitle_lang"], m["subtitle"]))),
			Genres:      genres,
			Director:    scrapeutil.NullableString(grabLang(records, firstNonNil(m["director_lang"], m["director"]))),
			Cast:        scrapeutil.NullableString(grabLang(records, firstNonNil(m["cast_lang"], m["cast"]))),
			Description: plainText(grabLang(records, firstNonNil(m["description_lang"], m["description"]))),
			Poster:      poster,
			Trailer:     scrapeutil.NullableString(firstString(m["trailer"])),
			DetailURL:   cfg.Base + "/" + cfg.Route + "/movie/" + id,
			Status:      status,
			Source:      model.Source(cfg.Source),
		})
	}

	// Cinemas, de-duplicated by id.
	var cinemas []model.Cinema
	seenSite := map[string]bool{}
	for _, site := range sites {
		siteID := stringify(site["id"])
		if siteID == "" || seenSite[siteID] {
			continue
		}
		seenSite[siteID] = true
		name := grabLang(records, firstNonNil(site["name_lang"], site["name"]))
		if name == "" {
			name = firstString(site["shortName"], site["name"])
		}
		rawAddress := grabLang(records, firstNonNil(site["address_lang"], site["address"]))
		address := plainText(rawAddress)
		// One CineArt site returns "." instead of an address; the real one is
		// recorded here because the circuit never published it.
		if rawAddress == "." {
			if cfg.Source == "cineart" && siteID == "23" {
				address = "L2, Phase 4, MOSTown, 18 On Luk Street, Ma On Shan, N.T."
			} else {
				address = ""
			}
		}
		mapURL := firstString(site["googleMapUrl"])
		if mapURL == "" {
			mapURL = scrapeutil.MapSearch(strings.TrimSpace(name+" "+address), "")
		}
		cinemas = append(cinemas, model.Cinema{
			ID:        cfg.Source + "-" + siteID,
			Code:      firstString(site["code"], site["id"]),
			NameZh:    name,
			Address:   address,
			MapURL:    mapURL,
			DetailURL: cfg.Base + "/" + cfg.Route,
			Source:    model.Source(cfg.Source),
		})
	}

	// Shows.
	var shows []model.Show
	seenShow := map[string]bool{}
	for _, show := range raw.shows {
		id := stringify(show["id"])
		movieObj, _ := show["movie"].(map[string]any)
		siteObj, _ := show["site"].(map[string]any)
		movieID := ""
		if movieObj != nil {
			movieID = stringify(movieObj["id"])
		}
		siteID := ""
		if siteObj != nil {
			siteID = stringify(siteObj["id"])
		}
		startAt := hktISO(stringify(show["time"]))
		date := datePart(stringify(show["date"]))
		if id == "" || movieID == "" || siteID == "" || date == "" || startAt == "" || seenShow[id] {
			continue
		}
		seenShow[id] = true

		movie := movieByID[movieID]
		if movie == nil {
			movie = movieObj
		}
		houseObj, _ := show["house"].(map[string]any)
		houseID := ""
		if houseObj != nil {
			houseID = stringify(houseObj["id"])
		}
		houseName := ""
		if h := houses[houseID]; h != nil {
			houseName = grabLang(records, firstNonNil(h["name_lang"], h["name"]))
		}
		if houseName == "" {
			houseName = houseID
		}

		var attrs []string
		for _, key := range []string{"attr1", "attr2", "attr3", "attr4", "attr5"} {
			am, ok := movie[key].(map[string]any)
			if !ok {
				continue
			}
			if a := grabLang(records, firstNonNil(am["name_lang"], am["name"])); a != "" {
				attrs = append(attrs, a)
			}
		}
		version := strings.Join(attrs, " ")

		seats := 0
		if n, ok := numberValue(show["seats"]); ok {
			seats = int(n)
		}
		available, hasAvailable := numberValue(show["avaliable"])

		// remainRate needs both a seat count and an available count; the JS wrote
		// null otherwise, and a division by zero would produce NaN in the JSON.
		var remain model.Nullable[float64]
		if seats > 0 && hasAvailable {
			rate := available / float64(seats)
			if rate < 0 {
				rate = 0
			}
			if rate > 1 {
				rate = 1
			}
			remain = model.SomeNullable(rate)
		}

		var tags []string
		for _, key := range []string{"tags", "manualTags"} {
			if list, ok := show[key].([]any); ok {
				for _, t := range list {
					if s, ok := t.(string); ok {
						tags = append(tags, s)
					}
				}
			}
		}
		if tags == nil {
			tags = []string{}
		}

		var price *float64
		if n, ok := numberValue(show["price"]); ok {
			price = &n
		}

		shows = append(shows, model.Show{
			ID:         cfg.Source + "-" + id,
			MovieID:    cfg.Source + "-" + movieID,
			CinemaID:   cfg.Source + "-" + siteID,
			HouseName:  houseName,
			StartAt:    startAt,
			Date:       date,
			Price:      price,
			Seats:      scrapeutil.NullableInt(seats),
			RemainRate: remain,
			SoldOut:    model.BoolPtr(hasAvailable && available <= 0),
			Tags:       tags,
			Category:   model.NullablePtr(model.PtrToNullable(scrapeutil.NullableString(firstString(movie["category"])))),
			Version:    model.PtrToNullable(scrapeutil.NullableString(version)),
			Language:   model.PtrToNullable(scrapeutil.NullableString(grabLang(records, firstNonNil(movie["dialect_lang"], movie["dialect"])))),
			BookingURL: cfg.Base + "/" + cfg.Route + "/show/" + id,
			Source:     model.Source(cfg.Source),
		})
	}

	return &model.Snapshot{Movies: movies, Shows: shows, Cinemas: cinemas}
}

// grabLang resolves a `*_lang` field, mirroring grabLang() in grabticks.js.
//
// An unresolvable `$N` reference yields an empty string rather than the literal
// "$37": writing the reference into the data is the bug this guards against.
func grabLang(records map[int]string, value any, lang ...string) string {
	m := flight.LangField(records, value)
	if len(m) > 0 {
		if len(lang) > 0 && lang[0] != "" {
			return m[lang[0]]
		}
		return flight.Pick(m, "zh_hk", "zhHK", "zh", "en", "enGB")
	}
	if s, ok := value.(string); ok {
		trimmed := strings.TrimSpace(s)
		if refRe.MatchString(trimmed) {
			return ""
		}
		return s
	}
	return ""
}

var refRe = regexp.MustCompile(`^\$[0-9a-fA-F]+$`)

var tagStripRe = regexp.MustCompile(`<[^>]*>`)
var spaceRe = regexp.MustCompile(`\s+`)

// plainText strips tags and entities and collapses whitespace, mirroring
// plainText().
func plainText(s string) string {
	s = tagStripRe.ReplaceAllString(s, " ")
	s = strings.ReplaceAll(s, "&nbsp;", " ")
	s = strings.ReplaceAll(s, "&#160;", " ")
	s = strings.ReplaceAll(s, "&amp;", "&")
	return strings.TrimSpace(spaceRe.ReplaceAllString(s, " "))
}

var datePartRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}`)

func datePart(s string) string {
	return datePartRe.FindString(s)
}

// hktISO converts an instant to Hong Kong wall-clock time, mirroring hktIso().
func hktISO(s string) string {
	if s == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		// Some payloads omit the zone; try the bare form the JS accepts.
		if t2, err2 := time.Parse("2006-01-02T15:04:05", s); err2 == nil {
			return t2.Format("2006-01-02T15:04:05") + "+08:00"
		}
		return ""
	}
	// toISOString() always emits milliseconds and the JS replaced only the
	// trailing Z, so the .000 has to be present for the strings to match.
	return t.In(scrapeutil.HKT).Format("2006-01-02T15:04:05.000") + "+08:00"
}

// imageURL builds a media URL, mirroring imageUrl().
func imageURL(v string) string {
	if v == "" {
		return ""
	}
	lower := strings.ToLower(v)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return v
	}
	return "https://media.grabticks.com/" + strings.TrimPrefix(v, "/")
}

// firstNonNil returns the first non-nil argument.
func firstNonNil(values ...any) any {
	for _, v := range values {
		if v != nil {
			return v
		}
	}
	return nil
}

// firstString returns the first value that renders as a non-empty string.
func firstString(values ...any) string {
	for _, v := range values {
		s := stringify(v)
		if s != "" {
			return s
		}
	}
	return ""
}

// stringify renders a JSON value as the JS would when interpolating it.
func stringify(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		if t {
			return "true"
		}
		return "false"
	case json.Number:
		return t.String()
	}
	return ""
}

// numberValue extracts a numeric value, reporting whether it was a number at all.
func numberValue(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		if t == "" {
			return 0, false
		}
		f, err := strconv.ParseFloat(t, 64)
		return f, err == nil
	}
	return 0, false
}

// nullableNumberToInt converts a duration-like value, treating 0 as absent.
func nullableNumberToInt(v any) *int {
	if n, ok := numberValue(v); ok {
		return scrapeutil.NullableInt(int(n))
	}
	return nil
}

// runPool runs fn(i) for i in [0,n) with a bounded number of goroutines.
func runPool(n, concurrency int, fn func(int)) {
	if n <= 0 {
		return
	}
	if concurrency < 1 {
		concurrency = 1
	}
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()
			fn(idx)
		}(i)
	}
	wg.Wait()
}
