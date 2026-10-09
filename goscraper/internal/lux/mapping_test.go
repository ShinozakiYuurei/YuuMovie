package lux

import (
	"strings"
	"testing"
)

// TestCapturedDaysDecode runs the whole mapping over the real captured replies.
//
// The assertions are on the values that are easy to get wrong rather than on a
// snapshot: what the API publishes may change next week, but the mapping from
// field numbers to fields has to hold.
func TestCapturedDaysDecode(t *testing.T) {
	snapshot, err := normalize(&cinemaPage{Name: defaultName, Address: "紅磡寶其利街2號J"}, fixtureResponses(t))
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if len(snapshot.Movies) == 0 {
		t.Fatal("no movies decoded")
	}
	if len(snapshot.Shows) != 16 {
		t.Errorf("shows = %d, want 16", len(snapshot.Shows))
	}
	if len(snapshot.Cinemas) != 1 {
		t.Fatalf("cinemas = %d, want 1", len(snapshot.Cinemas))
	}
	if snapshot.Cinemas[0].MapURL == "" {
		t.Error("mapUrl is empty; the venue page publishes none so a search is built")
	}

	for _, movie := range snapshot.Movies {
		if !strings.HasPrefix(movie.ID, sourceKey+"-") {
			t.Errorf("movie id = %q, want the %s- prefix", movie.ID, sourceKey)
		}
		if movie.NameZh == "" {
			t.Errorf("movie %s has no Chinese title", movie.ID)
		}
		if movie.Source != "lux" {
			t.Errorf("movie %s source = %q", movie.ID, movie.Source)
		}
	}

	for _, show := range snapshot.Shows {
		if !strings.HasPrefix(show.StartAt, "20") || !strings.HasSuffix(show.StartAt, "+08:00") {
			t.Errorf("show %s startAt = %q, want an ISO time with +08:00", show.ID, show.StartAt)
		}
		if len(show.Date) != 10 {
			t.Errorf("show %s date = %q", show.ID, show.Date)
		}
		// The venue is not bookable online, so availability is never published
		// and the seat fields have to stay null rather than reading as zero.
		if show.Seats != nil {
			t.Errorf("show %s seats = %v, want null", show.ID, *show.Seats)
		}
		if show.RemainRate.Set {
			t.Errorf("show %s remainRate is set, want null", show.ID)
		}
		if show.SoldOut == nil {
			t.Errorf("show %s soldOut is absent, want an explicit bool", show.ID)
		}
		if show.CinemaID != venueID {
			t.Errorf("show %s cinemaId = %q, want %q", show.ID, show.CinemaID, venueID)
		}
	}
}

// TestCapturedDaysMatchNodeOutput pins the mapping to the Node reference output
// for the same six captured responses.
func TestCapturedDaysMatchNodeOutput(t *testing.T) {
	snapshot, err := normalize(&cinemaPage{Name: defaultName, Address: "紅磡寶其利街2號J"}, fixtureResponses(t))
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}

	movie := snapshot.Movies[0]
	if movie.NameZh != "偵戰" {
		t.Errorf("title = %q", movie.NameZh)
	}
	if movie.Duration == nil || *movie.Duration != 90 {
		t.Errorf("duration = %v, want 90", movie.Duration)
	}
	if movie.Status != "showing" {
		t.Errorf("status = %q, want showing", movie.Status)
	}
	if movie.OpeningDate == nil || !movie.OpeningDate.Set || movie.OpeningDate.Value != "2026-10-08" {
		t.Errorf("openingDate = %v, want 2026-10-08", movie.OpeningDate)
	}
	if movie.Poster == nil || *movie.Poster == "" {
		t.Error("poster is empty")
	}
	if movie.DetailURL != site+"/movie/"+strings.TrimPrefix(movie.ID, sourceKey+"-") {
		t.Errorf("detailUrl = %q", movie.DetailURL)
	}

	show := snapshot.Shows[0]
	if show.HouseName != "House 1" {
		t.Errorf("house = %q, want House 1", show.HouseName)
	}
	if show.StartAt != "2026-10-09T19:00:00.000+08:00" {
		t.Errorf("startAt = %q", show.StartAt)
	}
	if show.Date != "2026-10-09" {
		t.Errorf("date = %q", show.Date)
	}
	if show.Price == nil || *show.Price != 50 {
		t.Errorf("price = %v, want 50", show.Price)
	}
	if show.Version.OrZero() != "2D" {
		t.Errorf("version = %q, want 2D", show.Version.OrZero())
	}
	if *show.SoldOut {
		t.Error("soldOut is true, want false")
	}
	if show.BookingURL != cinemaURL {
		t.Errorf("bookingUrl = %q, want the venue page", show.BookingURL)
	}
}
