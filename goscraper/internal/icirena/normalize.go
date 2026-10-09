package icirena

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
)

// rawFilm is one entry of the film.showing / film.comingsoon payloads.
//
// Only the fields this scraper reads are declared; the platform sends many more
// and ignoring them keeps the decoder honest about what it depends on.
type rawFilm struct {
	FilmUniqueID json.RawMessage `json:"filmUniqueId"`
	FilmID       json.RawMessage `json:"filmId"`
	FilmName     json.RawMessage `json:"filmName"`
	FilmEnName   string          `json:"filmEnName"`
	ShowDate     json.RawMessage `json:"showDate"`
	Duration     *int            `json:"duration"`
	Rating       string          `json:"rating"`
	FilmLang     string          `json:"filmLang"`
	FilmSubTitle string          `json:"filmSubTitleName"`
	FilmTypeName string          `json:"filmTypeName"`
	Directors    string          `json:"directors"`
	Actors       string          `json:"actors"`
	Introduction string          `json:"introduction"`
	Poster       string          `json:"poster"`
	FilmTrailer  string          `json:"filmTrailer"`
}

// rawCinema is one venue inside a city.
type rawCinema struct {
	CinemaLinkID json.RawMessage `json:"cinemaLinkId"`
	CinemaName   string          `json:"cinemaName"`
	ShortName    string          `json:"shortName"`
	Address      string          `json:"address"`
}

// rawSchedule is one screening slot.
type rawSchedule struct {
	ScheduleID    json.RawMessage `json:"scheduleId"`
	ShowTime      json.RawMessage `json:"showTime"`
	HallName      string          `json:"hallName"`
	DisplayPrice  json.RawMessage `json:"displayPrice"`
	HallSeatCount *float64        `json:"hallSeatCount"`
	SeatRate      *float64        `json:"seatRate"`
	FilmVersion   string          `json:"filmVersion"`
	FilmLang      string          `json:"filmLang"`
}

// rawScheduleGroup pairs a venue with its screenings for one film.
type rawScheduleGroup struct {
	CinemaInfo struct {
		CinemaLinkID json.RawMessage `json:"cinemaLinkId"`
	} `json:"cinemaInfo"`
	Schedules []rawSchedule `json:"schedules"`
}

// rawCinemaCity is one city block of the cinema payload.
type rawCinemaCity struct {
	Cinemas []rawCinema `json:"cinemas"`
}

// hktISO converts the platform's millisecond timestamp to Hong Kong wall-clock
// time, matching toHkt().
func hktISO(ms float64, ok bool) string {
	if !ok {
		return ""
	}
	t := time.UnixMilli(int64(ms)).In(hktZone())
	return t.Format("2006-01-02T15:04:05.000") + "+08:00"
}

// filmNameZh reads the title, which is sometimes a plain string and sometimes a
// JSON object carrying a Traditional Chinese key.
func filmNameZh(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return ""
	}
	for _, key := range []string{"zh_hk", "zh_HK", "zh-TW"} {
		if v, ok := obj[key]; ok {
			var out string
			if err := json.Unmarshal(v, &out); err == nil {
				return out
			}
		}
	}
	return ""
}

// textOf reads a value that may be a string, a number or null.
func textOf(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var n float64
	if err := json.Unmarshal(raw, &n); err == nil {
		return strconv.FormatFloat(n, 'f', -1, 64)
	}
	return ""
}

// dashToNull treats the platform's "--" placeholder as absent.
func dashToNull(s string) *string {
	if s == "" || s == "--" {
		return nil
	}
	return &s
}

// genres splits the pipe-separated type list.
func genres(value string) []string {
	if value == "" {
		return []string{}
	}
	parts := strings.Split(value, "|")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// normalizeFilm maps one raw film onto the shared model.
func (s *Scraper) normalizeFilm(f rawFilm, status string) model.Movie {
	key := firstNonEmpty(textOf(f.FilmUniqueID), textOf(f.FilmID))
	src := Source(s.Cfg)

	date := ""
	if iso := hktISO(numberOf(f.ShowDate)); iso != "" {
		date = iso[:10]
	}
	var openingDate *string
	if date != "" {
		openingDate = &date
	}

	rating := f.Rating
	var category *string
	if rating != "" && rating != "--" {
		category = &rating
	}

	return model.Movie{
		ID:          string(src) + "-" + key,
		NameZh:      filmNameZh(f.FilmName),
		NameEn:      f.FilmEnName,
		OpeningDate: openingDate,
		Duration:    f.Duration,
		Category:    category,
		Dialect:     nullable(f.FilmLang),
		Subtitle:    nullable(f.FilmSubTitle),
		Genres:      genres(f.FilmTypeName),
		Director:    dashToNull(f.Directors),
		Cast:        dashToNull(f.Actors),
		Description: f.Introduction,
		Poster:      nullable(f.Poster),
		Trailer:     nullable(f.FilmTrailer),
		DetailURL: fmt.Sprintf("%s/showtimes?wapid=%s&filmUniqueId=%s",
			s.Cfg.Base, s.Cfg.ChannelCode, key),
		Status: status,
		Source: src,
	}
}

// normalizeCinema maps one venue onto the shared model.
func (s *Scraper) normalizeCinema(c rawCinema) model.Cinema {
	link := textOf(c.CinemaLinkID)
	src := Source(s.Cfg)
	name := c.CinemaName
	if name == "" {
		name = c.ShortName
	}
	return model.Cinema{
		ID:      string(src) + "-" + link,
		Code:    link,
		NameZh:  name,
		Address: c.Address,
		Source:  src,
	}
}

// normalizeSchedules flattens the per-film schedule map into screenings.
//
// seatRate is the percentage already SOLD, cross-checked against 20 hkmovie6
// attendance figures: seatRate was below attendance in every case, which is the
// opposite of what a remaining-share reading would produce. Reading it as
// remaining would invert the seat colour on every row.
func (s *Scraper) normalizeSchedules(films map[string]bool, groups map[string][]rawScheduleGroup) []model.Show {
	src := Source(s.Cfg)
	keys := make([]string, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sortStrings(keys)

	out := make([]model.Show, 0, 1024)
	for _, filmKey := range keys {
		if len(films) > 0 && !films[filmKey] {
			continue
		}
		movieID := string(src) + "-" + filmKey
		for _, group := range groups[filmKey] {
			cinemaLink := textOf(group.CinemaInfo.CinemaLinkID)
			for _, sc := range group.Schedules {
				scheduleID := textOf(sc.ScheduleID)
				if scheduleID == "" {
					continue
				}
				startAt := hktISO(numberOf(sc.ShowTime))
				if startAt == "" {
					continue
				}
				out = append(out, s.normalizeShow(src, movieID, cinemaLink, scheduleID, startAt, sc))
			}
		}
	}
	return out
}
