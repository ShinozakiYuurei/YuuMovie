// Package model defines the on-disk data shapes shared with the Node side.
//
// The Go scraper writes the same JSON as scrape.js so lib/data.ts keeps working
// untouched: field names, null-vs-absent semantics and the sources/ snapshot
// layout are all part of the contract. See lib/types.ts for the TypeScript side.
package model

// Source identifies a cinema circuit.
type Source string

// Circuits, in the order scrape.js knows them.
const (
	SourceBroadway    Source = "broadway"
	SourceMCL         Source = "mcl"
	SourceEmperor     Source = "emperor"
	SourceCinemaCity  Source = "cinemacity"
	SourceBestar      Source = "bestar"
	SourceCGV         Source = "cgv"
	SourceChinachem   Source = "chinachem"
	SourceCineArt     Source = "cineart"
	SourceGoldenScene Source = "goldenscene"
	SourceLumen       Source = "lumen"
	SourceLux         Source = "lux"
	SourceNewport     Source = "newport"
	SourceSunbeam     Source = "sunbeam"
)

// KnownSources lists every circuit, used to carry forward snapshots that this
// run did not scrape (scrape.js does the same via KNOWN_SOURCES).
var KnownSources = []Source{
	SourceBroadway, SourceMCL, SourceEmperor, SourceCinemaCity, SourceBestar,
	SourceCGV, SourceChinachem, SourceCineArt, SourceGoldenScene, SourceLumen,
	SourceLux, SourceNewport, SourceSunbeam,
}

// Movie is one circuit listing. The same film appears once per version
// (IMAX / 4DX / ...); grouping into a single movie happens in lib/data.ts,
// never here.
type Movie struct {
	ID          string   `json:"id"`
	Slug        string   `json:"slug"`
	NameZh      string   `json:"nameZh"`
	NameEn      string   `json:"nameEn"`
	OpeningDate *string  `json:"openingDate"`
	Duration    *int     `json:"duration"`
	Category    *string  `json:"category"`
	Dialect     *string  `json:"dialect"`
	Subtitle    *string  `json:"subtitle"`
	Genres      []string `json:"genres"`
	Director    *string  `json:"director"`
	Cast        *string  `json:"cast"`
	Description string   `json:"description"`
	Poster      *string  `json:"poster"`
	Trailer     *string  `json:"trailer"`
	DetailURL   string   `json:"detailUrl"`
	Status      string   `json:"status"` // showing | upcoming
	Source      Source   `json:"source"`
	// Cross-circuit merge fields, only set when the same film runs elsewhere.
	AlsoAt  []Source `json:"alsoAt,omitempty"`
	Sources []Source `json:"sources,omitempty"`
}

// Cinema is one venue.
type Cinema struct {
	ID        string `json:"id"`
	Code      string `json:"code"`
	NameZh    string `json:"nameZh"`
	Address   string `json:"address"`
	MapURL    string `json:"mapUrl"`
	DetailURL string `json:"detailUrl"`
	Source    Source `json:"source"`
	// Region / District / Specs are derived by the read layer, not scraped.
	Region   *string `json:"region,omitempty"`
	District *string `json:"district,omitempty"`
}

// Show is one screening.
//
// Seats means "total seats" and RemainRate is the share of seats still
// available (0-1) — the colour coding depends on RemainRate alone. Circuits
// that publish a sold/remaining percentage instead have it converted during
// scraping; circuits that publish nothing leave both null. See lib/seat.ts.
type Show struct {
	ID         string   `json:"id"`
	MovieID    string   `json:"movieId"`
	CinemaID   string   `json:"cinemaId"`
	HouseName  string   `json:"houseName"`
	StartAt    string   `json:"startAt"` // ISO8601 with +08:00 offset
	Date       string   `json:"date"`    // YYYY-MM-DD, Hong Kong local
	Price      *float64 `json:"price"`
	Seats      *int     `json:"seats"`
	RemainRate *float64 `json:"remainRate,omitempty"`
	SoldOut    bool     `json:"soldOut,omitempty"`
	Tags       []string `json:"tags"`
	Category   *string  `json:"category,omitempty"`
	Version    *string  `json:"version,omitempty"`
	Language   *string  `json:"language,omitempty"`
	BookingURL string   `json:"bookingUrl"`
	Source     Source   `json:"source"`
}

// Snapshot is what one circuit produces in a run, and what data/sources/<name>.json
// holds for fallback. SavedAt drives the 24h staleness window in scrape.js.
type Snapshot struct {
	Movies  []Movie  `json:"movies"`
	Shows   []Show   `json:"shows"`
	Cinemas []Cinema `json:"cinemas"`
	SavedAt string   `json:"savedAt,omitempty"`
}

// Result is the merged output: data/movies.json, data/shows.json, data/cinemas.json.
type Result struct {
	Movies  []Movie  `json:"movies"`
	Shows   []Show   `json:"shows"`
	Cinemas []Cinema `json:"cinemas"`
}

// Meta mirrors data/meta.json. The read layer and the deploy guard both read
// counts.shows, so the field names must stay identical.
type Meta struct {
	LastUpdated string        `json:"lastUpdated"`
	Sources     []string      `json:"sources"`
	Counts      MetaCounts    `json:"counts"`
	Errors      []SourceError `json:"errors"`
	DurationMs  int64         `json:"durationMs"`
	Integrity   *Integrity    `json:"integrity,omitempty"`
}

// MetaCounts are the headline totals shown on /showing and checked by
// rebuild-static.sh (it aborts the publish below 100 shows).
type MetaCounts struct {
	Movies   int `json:"movies"`
	Showing  int `json:"showing"`
	Upcoming int `json:"upcoming"`
	Cinemas  int `json:"cinemas"`
	Shows    int `json:"shows"`
}

// SourceError records a circuit that failed, without failing the whole run.
type SourceError struct {
	Source string `json:"source"`
	Error  string `json:"error"`
}

// Integrity counts the dangling references the deploy guard warns about.
type Integrity struct {
	OrphanShows            int `json:"orphanShows"`
	ShowsWithoutBookingURL int `json:"showsWithoutBookingUrl"`
	MoviesWithoutPoster    int `json:"moviesWithoutPoster"`
	CinemasWithoutAddress  int `json:"cinemasWithoutAddress"`
}
