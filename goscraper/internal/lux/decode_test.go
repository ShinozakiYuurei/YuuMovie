package lux

import (
	"testing"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/protobuf"
)

// decode reads a protobuf message, failing the test on error.
func decode(data []byte) ([]protobuf.Field, error) { return protobuf.Decode(data) }

// mustDecode reads a protobuf message or fails the test.
func mustDecode(t *testing.T, data []byte) []protobuf.Field {
	t.Helper()
	fields, err := protobuf.Decode(data)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	return fields
}

// fieldText reads a length-delimited field as text.
func fieldText(f protobuf.Field) string { return string(f.Bytes) }
