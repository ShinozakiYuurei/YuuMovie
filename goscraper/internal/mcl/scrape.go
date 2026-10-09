package mcl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/fetch"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// rawGrid is the film list, which carries titles and posters.
type rawGrid struct {
	BA     string `json:"ba"`
	DBA    string `json:"dba"`
	DP     string `json:"dp"`
	TA     string `json:"ta"`
	Movies []struct {
		ID json.RawMessage `json:"id"`
		MN string          `json:"mn"`
		N  string          `json:"n"`
	} `json:"movies"`
}

// rawList is the schedule, which carries screenings but no titles.
type rawList struct {
	Movies []struct {
		ID  json.RawMessage `json:"id"`
		Vst []struct {
			VN string `json:"vn"`
			V  string `json:"v"`
			L  string `json:"l"`
			C  []struct {
				CI json.RawMessage `json:"ci"`
				CN string          `json:"cn"`
				S  []struct {
					SI json.RawMessage `json:"si"`
					SN string          `json:"sn"`
					R  *float64        `json:"r"`
				} `json:"s"`
			} `json:"c"`
		} `json:"vst"`
	} `json:"movies"`
}

// rawCinemaDetail carries the venue address and map link.
type rawCinemaDetail struct {
	ID json.RawMessage `json:"id"`
	A  string          `json:"a"`
	M  string          `json:"m"`
}

// filmMeta is the listing-side data for one film.
type filmMeta struct {
	Name   string
	Poster *string
}

// Scrape fetches the whole circuit.
func (s *Scraper) Scrape(ctx context.Context) (*model.Snapshot, error) {
	grid, list, cinemaDetails, err := s.fetchLists(ctx)
	if err != nil {
		return nil, err
	}

	// Venue address and map link come from their own endpoint; the schedule only
	// knows the venue code and display name.
	cinemaInfo := map[string]filmMeta{}
	for _, c := range cinemaDetails {
		cinemaInfo[textOfRaw(c.ID)] = filmMeta{Name: c.A, Poster: nullableText(c.M)}
	}

	// Titles and posters live in the grid; the schedule only has ids.
	meta := map[string]filmMeta{}
	for _, m := range grid.Movies {
		posterPath := m.N
		if posterPath == "" {
			posterPath = grid.BA + grid.DBA + grid.DP + textOfRaw(m.ID) + grid.TA
		}
		meta[textOfRaw(m.ID)] = filmMeta{
			Name:   m.MN,
			Poster: nullableText(Base + "/" + posterPath),
		}
	}

	// Details are fetched per film, joined on the id first so the title check
	// has something to verify against.
	var targets []mclTarget
	for _, mv := range list.Movies {
		id, err := strconv.Atoi(textOfRaw(mv.ID))
		if err != nil {
			continue
		}
		targets = append(targets, mclTarget{ID: id, Name: meta[textOfRaw(mv.ID)].Name})
	}
	details := s.movieDetails(ctx, targets)

	var movies []model.Movie
	cinemas := map[string]model.Cinema{}
	var shows []model.Show
	now := time.Now()

	for _, mv := range list.Movies {
		key := textOfRaw(mv.ID)
		idInt, _ := strconv.Atoi(key)
		id := Source + "-" + key
		info := meta[key]
		d := details[key]

		// The detail endpoint sometimes omits the spoken language. When every
		// version of this film shares one language it can be filled in from the
		// schedule; with several versions it stays empty rather than labelling the
		// whole film with one version's language.
		languages := map[string]bool{}
		for _, v := range mv.Vst {
			if l := trimSpace(v.L); l != "" {
				languages[l] = true
			}
		}
		var singleLanguage *string
		if len(languages) == 1 {
			for l := range languages {
				singleLanguage = &l
			}
		}

		nameZh := info.Name
		var nameEn string
		var duration *int
		var category, dialect, subtitle *string
		var genres []string
		var director, cast *string
		description := ""
		if d != nil {

			// The grid occasionally omits a film that is still scheduling, such
			// as a one-off opera broadcast. Only the official detail carries its
			// title then, so fall back to it rather than showing a blank card.
			if nameZh == "" {
				nameZh = d.NameZh
			}
			nameEn = d.NameEn
			duration = d.Duration
			category = d.Category
			dialect = d.Dialect
			subtitle = d.Subtitle
			genres = d.Genres
			director = d.Director
			cast = d.Cast
			description = d.Description
		}
		if dialect == nil {
			dialect = singleLanguage
		}
		if genres == nil {
			genres = []string{}
		}

		movies = append(movies, model.Movie{
			ID: id,
			// The slug comes from the LISTING title, never from the detail.
			// Two MET broadcasts are missing from the grid, so their slug stays
			// movie-<id> even though the detail supplies a Chinese title. That is
			// deliberate: the slug is a published URL, and re-deriving it when the
			// grid catches up would break every link already in circulation.
			Slug:        mclSlug(info.Name, idInt),
			NameZh:      nameZh,
			NameEn:      nameEn,
			Duration:    duration,
			Category:    category,
			Dialect:     dialect,
			Subtitle:    subtitle,
			Genres:      genres,
			Director:    director,
			Cast:        cast,
			Description: description,
			Poster:      info.Poster,
			// MovieSet takes the bare numeric id, not the site's mcl- prefix.
			DetailURL: Base + "/MovieSet.aspx?id=" + key,
			Status:    "showing",
			Source:    model.SourceMCL,
		})

		for _, ver := range mv.Vst {
			version := ver.VN
			if version == "" {
				version = ver.V
			}
			for _, c := range ver.C {
				cinemaID := textOfRaw(c.CI)
				if _, seen := cinemas[cinemaID]; !seen {
					venue := cinemaInfo[cinemaID]
					cinemas[cinemaID] = model.Cinema{
						ID:        Source + "-" + cinemaID,
						Code:      cinemaID,
						NameZh:    c.CN,
						Address:   venue.Name,
						MapURL:    venue.MapURL(),
						DetailURL: Base + "/NowShowingByHouse.aspx?ci=" + cinemaID,
						Source:    model.SourceMCL,
					}
				}

				for _, sh := range c.S {
					scheduleID := textOfRaw(sh.SI)
					if scheduleID == "" {
						continue
					}
					si, err := strconv.Atoi(scheduleID)
					if err != nil || si < 0 {
						// si = -1 is the separator row, not a screening.
						continue
					}
					parsed := parseShowDesc(sh.SN, now)
					if parsed == nil {
						continue
					}

					// r is the share of seats STILL FREE. Cross-checked against 49
					// hkmovie6 attendance figures: corr(r, attendance) = -0.986, so
					// assuming remaining fits (mean error 0.009) while assuming sold
					// does not (mean error 0.443). MCL's own seat page recomputes it
					// as 100 - r for its progress bar, which is what makes it easy to
					// misread. Total capacity is not published, so seats stays nil.
					var remain model.Nullable[float64]
					var soldOut *bool
					if sh.R != nil {
						rate := *sh.R / 100
						if rate < 0 {
							rate = 0
						}
						if rate > 1 {
							rate = 1
						}
						remain = model.SomeNullable(rate)
						soldOut = model.BoolPtr(*sh.R <= 0)
					}

					shows = append(shows, model.Show{
						ID:         Source + "-" + scheduleID,
						MovieID:    id,
						CinemaID:   Source + "-" + cinemaID,
						HouseName:  parsed.HouseName,
						StartAt:    parsed.ISO,
						Date:       parsed.Date,
						Price:      parsed.Price,
						RemainRate: remain,
						SoldOut:    soldOut,
						Tags:       []string{},
						Version:    model.PtrToNullable(scrapeutil.NullableString(version)),
						Language:   model.PtrToNullable(scrapeutil.NullableString(ver.L)),
						BookingURL: fmt.Sprintf("%s/MCLSelectSeat.aspx?visLang=%s&ci=%s&si=%s", Base, lang, cinemaID, scheduleID),
						Source:     model.SourceMCL,
					})
				}
			}
		}
	}

	cinemaList := make([]model.Cinema, 0, len(cinemas))
	for _, c := range cinemas {
		cinemaList = append(cinemaList, c)
	}

	if movies == nil {
		movies = []model.Movie{}
	}
	if shows == nil {
		shows = []model.Show{}
	}
	if cinemaList == nil {
		cinemaList = []model.Cinema{}
	}

	return &model.Snapshot{Movies: movies, Shows: shows, Cinemas: cinemaList}, nil
}

// MapURL returns the venue map link.
func (f filmMeta) MapURL() string {
	if f.Poster == nil {
		return ""
	}
	return *f.Poster
}

// trimSpace is strings.TrimSpace, named locally to keep the loops short.
func trimSpace(s string) string { return strings.TrimSpace(s) }

// fetchLists pulls the three list endpoints.
func (s *Scraper) fetchLists(ctx context.Context) (*rawGrid, *rawList, []rawCinemaDetail, error) {
	var (
		grid    rawGrid
		list    rawList
		cinemas []rawCinemaDetail
		wg      sync.WaitGroup
		gridErr error
		listErr error
	)

	wg.Add(3)
	go func() {
		defer wg.Done()
		gridErr = s.get(ctx, "GetNowShowingGrid.aspx?l="+lang, &grid)
	}()
	go func() {
		defer wg.Done()
		listErr = s.get(ctx, "GetNowShowingList.aspx?l="+lang, &list)
	}()
	go func() {
		defer wg.Done()
		// The venue endpoint is optional; a failure only costs the addresses.
		_ = s.get(ctx, "GetCinemaDetails.aspx?l="+lang, &cinemas)
	}()
	wg.Wait()

	// Each goroutine writes its own variable and wg.Wait() establishes the
	// happens-before edge, so no lock is needed here.
	if gridErr != nil {
		return nil, nil, nil, gridErr
	}
	if listErr != nil {
		return nil, nil, nil, listErr
	}
	return &grid, &list, cinemas, nil
}

// get fetches one endpoint and decodes it.
func (s *Scraper) get(ctx context.Context, path string, v any) error {
	return s.getWith(ctx, s.Client, path, v)
}

// getDetail is get against the non-retrying detail client.
func (s *Scraper) getDetail(ctx context.Context, path string, v any) error {
	client := s.detailClient
	if client == nil {
		client = s.Client
	}
	return s.getWith(ctx, client, path, v)
}

// getWith is the shared request path.
func (s *Scraper) getWith(ctx context.Context, client *fetch.Client, path string, v any) error {

	// The site answers 302 when it is rate limiting a client that has been
	// hammering the list endpoints. A short pause and a second try clears it
	// most of the time, and the caller already runs inside a time budget.
	var (
		body []byte
		err  error
	)
	for attempt := 0; attempt < listAttempts; attempt++ {
		body, err = client.GetWithHeaders(ctx, apiRoot+"/"+path, map[string]string{
			"Accept": "application/json, text/plain, */*",
		})
		if err == nil || !isRedirect(err) {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}

	if err := json.Unmarshal(body, v); err != nil {
		return fmt.Errorf("%s → JSON 解析失败: %w", path, err)
	}
	return nil
}

// isRedirect reports whether err is the rate-limit redirect.
func isRedirect(err error) bool {
	var es *fetch.ErrStatus
	return errors.As(err, &es) &&
		(es.Status == http.StatusFound || es.Status == http.StatusMovedPermanently)
}
