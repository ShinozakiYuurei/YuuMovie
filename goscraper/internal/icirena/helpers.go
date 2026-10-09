package icirena

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// hktZone is Hong Kong time: a fixed offset with no DST since 1979.
func hktZone() *time.Location { return scrapeutil.HKT }

// nullable turns an empty string into nil.
func nullable(s string) *string { return scrapeutil.NullableString(s) }

// firstNonEmpty returns the first non-empty candidate.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// sortStrings keeps map iteration out of the output order.
func sortStrings(values []string) { sort.Strings(values) }

// numberOf reads a numeric field, reporting whether one was present.
//
// The platform sends these as either a number or a numeric string depending on
// the endpoint, so both forms have to be accepted.
func numberOf(raw json.RawMessage) (float64, bool) {
	if len(raw) == 0 {
		return 0, false
	}
	var n float64
	if err := json.Unmarshal(raw, &n); err == nil {
		return n, true
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		f, err := strconv.ParseFloat(s, 64)
		return f, err == nil
	}
	return 0, false
}

// normalizeShow maps one screening onto the shared model.
func (s *Scraper) normalizeShow(src model.Source, movieID, cinemaLink, scheduleID, startAt string, sc rawSchedule) model.Show {
	var price *float64
	if cents, ok := numberOf(sc.DisplayPrice); ok && textOf(sc.DisplayPrice) != "" {
		// displayPrice arrives in cents.
		rounded := math.Round(cents / 100)
		price = &rounded
	}

	var seats *int
	if sc.HallSeatCount != nil {
		n := int(*sc.HallSeatCount)
		seats = &n
	}

	var remain model.Nullable[float64]
	var soldOut *bool
	if sc.SeatRate != nil {
		rate := 1 - *sc.SeatRate/100
		if rate < 0 {
			rate = 0
		}
		if rate > 1 {
			rate = 1
		}
		remain = model.SomeNullable(rate)
		soldOut = model.BoolPtr(*sc.SeatRate >= 100)
	}

	return model.Show{
		ID:         string(src) + "-" + scheduleID,
		MovieID:    movieID,
		CinemaID:   string(src) + "-" + cinemaLink,
		HouseName:  sc.HallName,
		StartAt:    startAt,
		Date:       startAt[:10],
		Price:      price,
		Seats:      seats,
		RemainRate: remain,
		SoldOut:    soldOut,
		Tags:       []string{},
		Version:    model.PtrToNullable(nullable(sc.FilmVersion)),
		Language:   model.PtrToNullable(nullable(sc.FilmLang)),
		BookingURL: fmt.Sprintf("%s/seat?wapid=%s&scheduleId=%s&cinemaId=%s",
			s.Cfg.Base, s.Cfg.ChannelCode, scheduleID, cinemaLink),
		Source: src,
	}
}

// collectCinemas flattens the city blocks.
func (s *Scraper) collectCinemas(payload *bizValue) []model.Cinema {
	// The payload is an object keyed by city rather than a bare array, so
	// decoding straight into a slice yields nothing and the circuit looks empty.
	var wrapper struct {
		Cities []rawCinemaCity `json:"cities"`
	}
	if err := s.biz(payload, &wrapper); err != nil {
		return nil
	}
	out := make([]model.Cinema, 0, 32)
	for _, city := range wrapper.Cities {
		for _, c := range city.Cinemas {
			out = append(out, s.normalizeCinema(c))
		}
	}
	return out
}

func (s *Scraper) collectFilms(films []rawFilm, status string) []model.Movie {
	out := make([]model.Movie, 0, len(films))
	for _, f := range films {
		out = append(out, s.normalizeFilm(f, status))
	}
	return out
}

// collectFilms maps an already-decoded film list onto the model.
