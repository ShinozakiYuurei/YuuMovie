package runner

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

// wants reports whether the run should visit this circuit.
func (o Options) wants(name string) bool {
	if len(o.Only) == 0 {
		return true
	}
	for _, only := range o.Only {
		if only == name {
			return true
		}
	}
	return false
}

// collect merges every source into one set.
//
// It deliberately does NOT merge films across circuits: grouping by title is the
// read layer job (lib/data.ts getMovieGroups). The scraper collects what each
// circuit published, including one entry per format version, because dropping
// them would break the "versions and screenings" list on the detail page.
func collect(sources map[string]*snapshot) *model.Result {
	out := &model.Result{
		Movies:  []model.Movie{},
		Cinemas: []model.Cinema{},
		Shows:   []model.Show{},
	}

	seenMovie := map[string]bool{}
	seenCinema := map[string]bool{}

	// Sorted so the result does not depend on map iteration order.
	for _, name := range sortedNames(sources) {
		data := sources[name]
		for i := range data.Movies {
			m := data.Movies[i]
			if m.ID == "" || seenMovie[m.ID] {
				continue
			}
			seenMovie[m.ID] = true
			if m.Slug == "" {
				m.Slug = slugify(m.NameZh, m.NameEn, m.ID)
			}
			out.Movies = append(out.Movies, m)
		}
		for _, c := range data.Cinemas {
			if c.ID == "" || seenCinema[c.ID] {
				continue
			}
			seenCinema[c.ID] = true
			out.Cinemas = append(out.Cinemas, c)
		}
		out.Shows = append(out.Shows, data.Shows...)
	}

	return out
}

// slugify builds the route slug, ASCII only.
//
// Only [a-z0-9] survives. A Chinese slug works in the dev server but 404s on the
// static export under /movie/[slug], which is how 13 of 25 ticket-card links once
// pointed at nothing: the user saw a page with a synopsis and no screenings. MCL
// has no English title, so its slug would otherwise be entirely Chinese.
func slugify(nameZh, nameEn, id string) string {
	tail := id
	if i := strings.LastIndex(id, ":"); i >= 0 {
		tail = id[i+1:]
	}
	base := nameEn
	if base == "" {
		base = nameZh
	}

	var b strings.Builder
	prevDash := false
	for i := 0; i < len(base); i++ {
		c := base[i]
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
			b.WriteByte(c)
			prevDash = false
		case c >= 'A' && c <= 'Z':
			b.WriteByte(c + ('a' - 'A'))
			prevDash = false
		default:
			if !prevDash {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}

	s := strings.Trim(b.String(), "-")
	if len(s) > 60 {
		s = s[:60]
	}
	s = strings.TrimRight(s, "-")
	if s == "" {
		return "movie-" + tail
	}
	return s + "-" + tail
}

// checkIntegrity counts the references the deploy guard warns about.
func checkIntegrity(result *model.Result) *model.Integrity {
	movieIDs := map[string]bool{}
	for _, m := range result.Movies {
		movieIDs[m.ID] = true
	}
	cinemaIDs := map[string]bool{}
	for _, c := range result.Cinemas {
		cinemaIDs[c.ID] = true
	}

	out := &model.Integrity{}
	for _, s := range result.Shows {
		if !movieIDs[s.MovieID] || !cinemaIDs[s.CinemaID] {
			out.OrphanShows++
		}
		if s.BookingURL == "" {
			out.ShowsWithoutBookingURL++
		}
	}
	for _, m := range result.Movies {
		if m.Poster == nil || *m.Poster == "" {
			out.MoviesWithoutPoster++
		}
	}
	for _, c := range result.Cinemas {
		if c.Address == "" {
			out.CinemasWithoutAddress++
		}
	}
	return out
}

func countStatus(movies []model.Movie, status string) int {
	n := 0
	for _, m := range movies {
		if m.Status == status {
			n++
		}
	}
	return n
}

func sortedNames(sources map[string]*snapshot) []string {
	out := make([]string, 0, len(sources))
	for name := range sources {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func toSnapshot(snap *model.Snapshot, at time.Time) *snapshot {
	// Millisecond precision, matching the ISO string the Node runner wrote.
	out := &snapshot{SavedAt: at.UTC().Format("2006-01-02T15:04:05.000Z")}
	if snap.Movies != nil {
		out.Movies = snap.Movies
	}
	if snap.Shows != nil {
		out.Shows = snap.Shows
	}
	if snap.Cinemas != nil {
		out.Cinemas = snap.Cinemas
	}
	return out
}

// saveSnapshot writes one circuit snapshot.
//
// A snapshot that fails to write is a warning, not an error: the merged output
// still gets written this run, and only the next run's fallback is lost.
func saveSnapshot(dir, name string, snap *snapshot) error {
	raw, err := json.MarshalIndent(snap, "", " ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, name+".json"), raw, 0o644)
}

// loadSnapshot reads a snapshot if it is younger than maxAge.
//
// Anything unreadable, unparsable or undated counts as absent.
func loadSnapshot(dir, name string, maxAge time.Duration) *snapshot {
	raw, err := os.ReadFile(filepath.Join(dir, name+".json"))
	if err != nil {
		return nil
	}
	var snap snapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		return nil
	}
	if snap.SavedAt == "" {
		return nil
	}
	saved, err := time.Parse("2006-01-02T15:04:05.000Z", snap.SavedAt)
	if err != nil {
		// Fall back for snapshots written without milliseconds.
		saved, err = time.Parse(time.RFC3339, snap.SavedAt)
	}
	if err != nil {
		return nil
	}
	if time.Since(saved) > maxAge {
		return nil
	}
	return &snap
}

// writeOutput writes the four files the site reads.
func writeOutput(dir string, result *model.Result, meta *model.Meta) error {
	files := []struct {
		name  string
		value any
	}{
		{"movies.json", result.Movies},
		{"shows.json", result.Shows},
		{"cinemas.json", result.Cinemas},
		{"meta.json", meta},
	}
	for _, file := range files {
		raw, err := json.MarshalIndent(file.value, "", " ")
		if err != nil {
			return fmt.Errorf("encode %s: %w", file.name, err)
		}
		if err := os.WriteFile(filepath.Join(dir, file.name), raw, 0o644); err != nil {
			return fmt.Errorf("write %s: %w", file.name, err)
		}
	}
	return nil
}
