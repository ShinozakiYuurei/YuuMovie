package lux

import (
	"strings"
	"testing"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/protobuf"
)

// TestAttendanceReadsBothShapes covers the one field whose encoding is not the
// obvious varint.
func TestAttendanceReadsBothShapes(t *testing.T) {
	asVarint := mustDecode(t, protobuf.AppendInt(nil, showAttendance, 1))
	if got := attendance(asVarint, showAttendance); got != 1 {
		t.Errorf("varint attendance = %d, want 1", got)
	}

	littleEndian := protobuf.AppendTag(nil, showAttendance, protobuf.WireBytes)
	littleEndian = protobuf.AppendVarint(littleEndian, 8)
	littleEndian = append(littleEndian, 1, 0, 0, 0, 0, 0, 0, 0)
	if got := attendance(mustDecode(t, littleEndian), showAttendance); got != 1 {
		t.Errorf("little-endian attendance = %d, want 1", got)
	}
}

// TestParseCinemaPageRejectsAnotherCinema covers the guard that stops another
// venue's page being accepted as this circuit's data.
func TestParseCinemaPageRejectsAnotherCinema(t *testing.T) {
	page := "<html><script>window.__NUXT__=(function(a){return {data:[{cinema:{uuid:\"other\"}}]}})()</script></html>"
	if _, err := parseCinemaPage(page); err == nil {
		t.Fatal("parseCinemaPage accepted a page for a different venue")
	}
}

// TestParseCinemaPageRejectsNoPayload covers the other failure mode: a challenge
// page parses fine as HTML but carries no payload.
func TestParseCinemaPageRejectsNoPayload(t *testing.T) {
	if _, err := parseCinemaPage("<html><body>Just a moment...</body></html>"); err == nil {
		t.Fatal("parseCinemaPage accepted a page with no payload")
	}
}

// TestParseCinemaPageReadsVenue checks the fields taken off a payload: the venue
// name, the address, and the de-duplicated list of programmed days.
func TestParseCinemaPageReadsVenue(t *testing.T) {
	page, err := parseCinemaPage(venueFixture(t))
	if err != nil {
		t.Fatalf("parseCinemaPage: %v", err)
	}
	if page.Name != defaultName {
		t.Errorf("name = %q, want %q", page.Name, defaultName)
	}
	if page.Address != "紅磡寶其利街2號J" {
		t.Errorf("address = %q, want the address the venue page publishes", page.Address)
	}
	if page.MapURL != "" {
		t.Errorf("mapUrl = %q, want empty: this venue publishes none", page.MapURL)
	}
	if len(page.ShowDates) != len(fixtureDays) {
		t.Errorf("dates = %d, want %d", len(page.ShowDates), len(fixtureDays))
	}
	for i := 1; i < len(page.ShowDates); i++ {
		if page.ShowDates[i] <= page.ShowDates[i-1] {
			t.Errorf("dates are not sorted: %v", page.ShowDates)
			break
		}
	}
}

// TestVenueFixtureIsTheRightVenue keeps the fixture honest: if the captured
// page ever belongs to a different venue the tests above would still pass while
// checking nothing.
func TestVenueFixtureIsTheRightVenue(t *testing.T) {
	page, err := parseCinemaPage(venueFixture(t))
	if err != nil {
		t.Fatalf("parseCinemaPage: %v", err)
	}
	if !strings.Contains(page.Address, "寶其利街") {
		t.Errorf("address = %q, want the 寶石戲院 street", page.Address)
	}
}
