package lux

import (
	"sort"
	"time"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/model"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/protobuf"
	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/scrapeutil"
)

// Protobuf field numbers, as observed on the wire.
//
// A day's response is a repeated field 1, each holding a localised block whose
// field 1 is the film and field 3 holds the screenings. Nothing about this is
// documented, so the numbers are pinned here rather than guessed at the point of
// use.
const (
	fieldDay        = 1 // repeated per film shown that day
	fieldMovieBlock = 1 // inside a day: the film message
	fieldVersion    = 2 // inside a day: the version label, e.g. "2D"
	fieldShowBlock  = 3 // inside a day: repeated, the screenings
)

// Film field numbers.
const (
	filmID          = 1
	filmName        = 2
	filmOpening     = 3
	filmPoster      = 4
	filmDuration    = 9
	filmDescription = 14
)

// Show field numbers.
const (
	showHouse      = 1
	showStart      = 2
	showPrice      = 3
	showID         = 5
	showAttendance = 12
	showBookingURL = 13
)

// normalize turns the day's protobuf responses into a snapshot.
//
// Order matters for parity with the Node output: days are walked in the order
// they were requested and each day's films in wire order, with the first
// sighting of a film or show winning. The venue page is decoded on the way out so
// the cinema row always reflects the live address.
func normalize(page *cinemaPage, responses map[int64][]byte) (*model.Snapshot, error) {
	dates := make([]int64, 0, len(responses))
	for date := range responses {
		dates = append(dates, date)
	}
	sort.Slice(dates, func(i, j int) bool { return dates[i] < dates[j] })

	movies := map[string]model.Movie{}
	var movieOrder []string
	shows := map[string]model.Show{}
	var showOrder []string
	today := scrapeutil.TodayHKT()

	for _, date := range dates {
		fields, err := protobuf.Decode(responses[date])
		if err != nil {
			return nil, err
		}
		fallbackDate := epochDate(date)

		for _, day := range fields {
			if day.Number != fieldDay || day.Wire != protobuf.WireBytes {
				continue
			}
			localized, err := protobuf.Decode(day.Bytes)
			if err != nil {
				return nil, err
			}
			movieField := protobuf.Find(localized, fieldMovieBlock)
			if movieField == nil || movieField.Wire != protobuf.WireBytes {
				continue
			}
			movie, ok := buildMovie(movieField.Bytes, today)
			if !ok {
				continue
			}
			if _, seen := movies[movie.ID]; !seen {
				movieOrder = append(movieOrder, movie.ID)
			}
			movies[movie.ID] = movie

			version := protobuf.FindText(localized, fieldVersion)
			for _, item := range localized {
				if item.Number != fieldShowBlock || item.Wire != protobuf.WireBytes {
					continue
				}
				show, ok := buildShow(item.Bytes, movie.ID, version, fallbackDate)
				if !ok {
					continue
				}
				if _, seen := shows[show.ID]; seen {
					continue
				}
				showOrder = append(showOrder, show.ID)
				shows[show.ID] = show
			}
		}
	}

	return &model.Snapshot{
		Movies:  pick(movies, movieOrder),
		Shows:   pick(shows, showOrder),
		Cinemas: []model.Cinema{{ID: venueID, Code: "LUX", NameZh: page.Name, Address: page.Address, MapURL: mapURLFor(page), DetailURL: cinemaURL, Source: model.SourceLux}},
	}, nil
}

// buildMovie maps one film message.
//
// The API publishes the Chinese title only, so the English name stays empty
// rather than being guessed at, and no credits are available at all.
func buildMovie(data []byte, today string) (model.Movie, bool) {
	fields, err := protobuf.Decode(data)
	if err != nil {
		return model.Movie{}, false
	}
	id := protobuf.FindText(fields, filmID)
	name := protobuf.FindText(fields, filmName)
	if id == "" || name == "" {
		return model.Movie{}, false
	}

	openingEpoch := findVarint(fields, filmOpening)
	opening := epochDate(openingEpoch)
	status := "showing"
	if opening != "" && opening > today {
		status = "upcoming"
	}

	return model.Movie{
		ID:          sourceKey + "-" + id,
		NameZh:      name,
		OpeningDate: model.NullablePtr(model.PtrToNullable(scrapeutil.NullableString(opening))),
		// Duration goes through the JS's Number(x) || null, so a zero means the
		// site did not publish it rather than a zero-length film.
		Duration:    nullableInt(findVarint(fields, filmDuration)),
		Genres:      []string{},
		Description: protobuf.FindText(fields, filmDescription),
		Poster:      scrapeutil.NullableString(protobuf.FindText(fields, filmPoster)),
		DetailURL:   site + "/movie/" + id,
		Status:      status,
		Source:      model.SourceLux,
	}, true
}

// buildShow maps one screening.
//
// The venue is not bookable online, so no seat data is published: soldOut comes
// from the attendance ratio and the booking link falls back to the venue page
// when the message carries none.
func buildShow(data []byte, movieID, version, fallbackDate string) (model.Show, bool) {
	fields, err := protobuf.Decode(data)
	if err != nil {
		return model.Show{}, false
	}
	startEpoch := findVarint(fields, showStart)
	id := protobuf.FindText(fields, showID)
	if id == "" || startEpoch == 0 {
		return model.Show{}, false
	}

	date := epochDate(startEpoch)
	if date == "" {
		date = fallbackDate
	}

	soldOut := attendance(fields, showAttendance) == 1
	booking := protobuf.FindText(fields, showBookingURL)
	if booking != "" {
		booking = scrapeutil.ResolveURL(site, booking)
	} else {
		booking = cinemaURL
	}

	return model.Show{
		ID:         sourceKey + "-" + id,
		MovieID:    movieID,
		CinemaID:   venueID,
		HouseName:  protobuf.FindText(fields, showHouse),
		StartAt:    epochHkt(startEpoch),
		Date:       date,
		Price:      nullableFloat(findVarint(fields, showPrice)),
		SoldOut:    model.BoolPtr(soldOut),
		Tags:       []string{},
		Category:   model.CategoryNull(),
		Version:    model.PtrToNullable(scrapeutil.NullableString(version)),
		BookingURL: booking,
		Source:     model.SourceLux,
	}, true
}

// attendance reads the share of seats taken.
//
// This one field is not a varint: it arrives as an 8-byte little-endian value
// inside a length-delimited payload. Some responses do encode it as a varint
// instead, so both shapes are accepted rather than reading zero from half of
// the schedule.
func attendance(fields []protobuf.Field, number int) int64 {
	field := protobuf.Find(fields, number)
	if field == nil {
		return 0
	}
	if field.Wire == protobuf.WireBytes {
		if len(field.Bytes) < 8 {
			return 0
		}
		return field.Int64LE()
	}
	return int64(field.Varint)
}

// findVarint returns a numeric field's value, or zero when it is absent.
//
// Zero is the right answer for an absent duration or price because both are read
// with the JS's Number(x) || null, which turns zero into null downstream.
func findVarint(fields []protobuf.Field, number int) int64 {
	field := protobuf.Find(fields, number)
	if field == nil {
		return 0
	}
	if field.Wire == protobuf.WireBytes {
		// Some numeric fields arrive length-delimited; read a short payload as
		// the varint the server put in it.
		var value uint64
		for _, b := range field.Bytes {
			value = value<<7 | uint64(b&0x7f)
		}
		return int64(value)
	}
	return int64(field.Varint)
}

// pick returns the values in insertion order, which is the order the Node
// scraper published them in and therefore the order the diff expects.
func pick[T any](values map[string]T, order []string) []T {
	out := make([]T, 0, len(order))
	for _, key := range order {
		if value, ok := values[key]; ok {
			out = append(out, value)
		}
	}
	return out
}

// epochDate converts a second-based timestamp to a Hong Kong date.
func epochDate(seconds int64) string {
	if seconds == 0 {
		return ""
	}
	return time.Unix(seconds, 0).In(scrapeutil.HKT).Format("2006-01-02")
}

// epochHkt converts a second-based timestamp to Hong Kong wall-clock time with
// the +08:00 offset the rest of the data uses.
func epochHkt(seconds int64) string {
	if seconds == 0 {
		return ""
	}
	return time.Unix(seconds, 0).In(scrapeutil.HKT).Format("2006-01-02T15:04:05.000") + "+08:00"
}
