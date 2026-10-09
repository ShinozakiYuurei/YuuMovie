package lux

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// The fixtures are real gRPC-Web replies captured from the API, one per
// programmed day. They are checked in so the wire-format mapping is verified
// without the network and without a live token.
var fixtureDays = []int64{
	1791504000,
	1791590400,
	1791676800,
	1791763200,
	1791849600,
	1791936000,
}

// loadFixture reads one captured day response.
func loadFixture(t *testing.T, date int64) []byte {
	t.Helper()
	path := filepath.Join("..", "..", "testdata", "lux-day-"+itoa(date)+".bin")
	return readFixture(t, path)
}

// venueFixture reads the captured venue page.
//
// The page is only reachable through the Hong Kong egress, so a copy is checked
// in: without it the page parsing could not be tested at all offline.
func venueFixture(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "testdata", "lux-page.html")
	return string(readFixture(t, path))
}

// readFixture reads a fixture file.
func readFixture(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return data
}

// fixtureResponses loads every captured day, unwrapping the gRPC-Web frames so
// the mapping sees the same bare protobuf message the live path hands it.
func fixtureResponses(t *testing.T) map[int64][]byte {
	t.Helper()
	out := map[int64][]byte{}
	for _, date := range fixtureDays {
		messages, err := frames(loadFixture(t, date))
		if err != nil {
			t.Fatalf("fixture %d: %v", date, err)
		}
		if len(messages) != 1 {
			t.Fatalf("fixture %d has %d messages, want 1", date, len(messages))
		}
		out[date] = messages[0]
	}
	return out
}

// itoa formats an epoch for a filename.
func itoa(value int64) string { return strconv.FormatInt(value, 10) }
