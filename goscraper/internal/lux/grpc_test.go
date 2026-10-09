package lux

import (
	"strings"
	"testing"
)

// TestFrameRoundTrip checks the five byte header the API expects.
func TestFrameRoundTrip(t *testing.T) {
	got := frame([]byte{0x0a, 0x03, 'a', 'b', 'c'})
	if len(got) != 10 {
		t.Fatalf("frame length = %d, want 10", len(got))
	}
	if got[0] != 0 {
		t.Errorf("flag byte = %#x, want 0", got[0])
	}
	if got[1] != 0 || got[2] != 0 || got[3] != 0 || got[4] != 5 {
		t.Errorf("length header = %#x, want 00000005", got[1:5])
	}
}

// TestFramesReadsMessages checks that data frames are separated and returned.
func TestFramesReadsMessages(t *testing.T) {
	body := append(frame([]byte("one")), frame([]byte("two"))...)
	body = append(body, trailerFrame("grpc-status: 0\r\n")...)
	messages, err := frames(body)
	if err != nil {
		t.Fatalf("frames: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("got %d messages, want 2", len(messages))
	}
	if string(messages[0]) != "one" || string(messages[1]) != "two" {
		t.Errorf("messages = %q / %q", messages[0], messages[1])
	}
}

// TestFramesAcceptsZeroStatus checks the normal trailer, which is present and
// says success. Without accepting it every live call would fail.
func TestFramesAcceptsZeroStatus(t *testing.T) {
	body := append(frame([]byte("data")), trailerFrame("grpc-status: 0\r\n")...)
	messages, err := frames(body)
	if err != nil {
		t.Fatalf("frames: %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("got %d messages, want 1", len(messages))
	}
}

// TestFramesRejectsNonZeroStatus is the important one: the API answers HTTP 200
// for application errors, so a trailer with a failing status has to raise.
func TestFramesRejectsNonZeroStatus(t *testing.T) {
	body := trailerFrame("grpc-status: 16\r\ngrpc-message: token expired\r\n")
	_, err := frames(body)
	if err == nil {
		t.Fatal("frames accepted a failing status")
	}
	if !strings.Contains(err.Error(), "token expired") {
		t.Errorf("error = %v, want the trailer message", err)
	}
}

// TestFramesRejectsMissingStatus guards against silently accepting a body with
// no trailer at all, which is what a truncated response looks like.
func TestFramesRejectsMissingStatus(t *testing.T) {
	if _, err := frames(frame([]byte("only data"))); err == nil {
		t.Fatal("frames accepted a body with no status trailer")
	}
}

// TestSchedulePayload checks the request encoding: field 1 is the cinema uuid as
// a string, field 2 the date as a varint.
func TestSchedulePayload(t *testing.T) {
	payload := schedulePayload(cinemaID, 1791504000)
	fields, err := decode(payload)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(fields) != 2 {
		t.Fatalf("got %d fields, want 2", len(fields))
	}
	if got := fieldText(fields[0]); got != cinemaID {
		t.Errorf("cinema id = %q, want %q", got, cinemaID)
	}
	if fields[1].Number != 2 {
		t.Errorf("date field number = %d, want 2", fields[1].Number)
	}
	if int64(fields[1].Varint) != 1791504000 {
		t.Errorf("date = %d, want 1791504000", fields[1].Varint)
	}
}

// trailerFrame builds a trailer frame with the 0x80 flag.
func trailerFrame(text string) []byte {
	payload := []byte(text)
	framed := frame(payload)
	framed[0] = 0x80
	return framed
}
