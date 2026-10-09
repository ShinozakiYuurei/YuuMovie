package icirena

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

// Scrape fetches one circuit's films, venues and screenings.
func (s *Scraper) Scrape(ctx context.Context) (*model.Snapshot, error) {
	s.progress("拉取 " + s.Cfg.Name + " 影片與影院 ...")

	// The three list calls are independent.
	var (
		showingJSON *bizValue
		comingJSON  *bizValue
		cinemasJSON *bizValue
		wg          sync.WaitGroup
	)
	wg.Add(3)
	go func() { defer wg.Done(); showingJSON, _ = s.call(ctx, methodShowing, nil, 3) }()
	go func() { defer wg.Done(); comingJSON, _ = s.call(ctx, methodComingSoon, nil, 3) }()
	go func() { defer wg.Done(); cinemasJSON, _ = s.call(ctx, methodCinemas, nil, 3) }()
	wg.Wait()

	showingRaw := decodeFilmsOrNil(showingJSON)
	showing := s.collectFilms(showingRaw, "showing")
	coming := s.collectFilms(decodeFilmsOrNil(comingJSON), "upcoming")
	cinemas := s.collectCinemas(cinemasJSON)

	s.progress(fmt.Sprintf("  影片 %d 部 | 待映 %d 部 | 影院 %d 間",
		len(showing), len(coming), len(cinemas)))

	movies := append(append([]model.Movie{}, showing...), coming...)

	var shows []model.Show
	if s.withSchedule && len(showing) > 0 {
		groups := s.fetchSchedules(ctx, showingRaw)
		films := map[string]bool{}
		for _, f := range showingRaw {
			films[filmKeyOf(f)] = true
		}
		shows = s.normalizeSchedules(films, groups)
	}

	return &model.Snapshot{
		Movies:  movies,
		Shows:   shows,
		Cinemas: cinemas,
	}, nil
}

// filmKeyOf returns the id the schedule map is keyed by.
func filmKeyOf(f rawFilm) string {
	return firstNonEmpty(textOf(f.FilmUniqueID), textOf(f.FilmID))
}

// fetchSchedules walks the film × date matrix.
//
// showDate is mandatory: without it the API answers bizCode 0 with an empty
// bizValue, which looks like success. That is how the three circuits once showed
// "films but no screenings".
func (s *Scraper) fetchSchedules(ctx context.Context, films []rawFilm) map[string][]rawScheduleGroup {
	if s.maxMovies > 0 && len(films) > s.maxMovies {
		films = films[:s.maxMovies]
	}

	today := todayHK()
	days := ScheduleDays()
	dates := make([]string, 0, days)
	for i := 0; i < days; i++ {
		dates = append(dates, addDays(today, i))
	}

	type job struct {
		film string
		date string
	}
	var jobs []job
	for _, f := range films {
		key := filmKeyOf(f)
		if key == "" {
			continue
		}
		for _, d := range dates {
			jobs = append(jobs, job{film: key, date: d})
		}
	}

	s.progress(fmt.Sprintf("  抓取场次：%d 部影片 × %d 天", len(films), len(dates)))

	results := make([][]rawScheduleGroup, len(jobs))
	var ok, fail int
	var mu sync.Mutex

	start := time.Now()
	runPool(len(jobs), s.concurrency, func(i int) {
		j := jobs[i]
		out, err := s.call(ctx, methodSchedule, map[string]string{
			"filmUniqueId": j.film,
			"showDate":     j.date,
			"curPage":      "1",
			"itemsPerPage": "100",
		}, 3)
		mu.Lock()
		defer mu.Unlock()
		if err != nil {
			fail++
			return
		}
		ok++
		var groups []rawScheduleGroup
		if e := s.biz(out, &groups); e == nil {
			results[i] = groups
		}
	})

	// Merge by film, then drop duplicate screenings.
	merged := make(map[string][]rawScheduleGroup, len(films))
	var deduped int
	for i, j := range jobs {
		if results[i] == nil {
			continue
		}
		merged[j.film] = append(merged[j.film], results[i]...)
	}
	for key, groups := range merged {
		out := make([]rawScheduleGroup, 0, len(groups))
		seen := map[string]bool{}
		for _, g := range groups {
			list := make([]rawSchedule, 0, len(g.Schedules))
			for _, sc := range g.Schedules {
				id := textOf(sc.ScheduleID)
				if id == "" || seen[id] {
					deduped++
					continue
				}
				seen[id] = true
				list = append(list, sc)
			}
			if len(list) > 0 {
				g.Schedules = list
				out = append(out, g)
			}
		}
		merged[key] = out
	}

	s.progress(fmt.Sprintf("  场次完成：成功 %d / 失败 %d 请求，去重 %d 条，耗时 %.1fs",
		ok, fail, deduped, time.Since(start).Seconds()))

	return merged
}

// decodeFilmsOrNil decodes a film list, treating an absent payload as empty.
func decodeFilmsOrNil(out *bizValue) []rawFilm {
	var films []rawFilm
	if err := (&Scraper{}).biz(out, &films); err != nil {
		return nil
	}
	return films
}
