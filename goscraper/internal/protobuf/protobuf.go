// Package protobuf decodes and encodes the subset of the protocol that the Lux
// circuit needs.
//
// Ported from the hand-rolled helpers in scrapers/other-circuits.js. The schema
// was never published, so this reads the wire format generically — field number
// plus wire type — rather than generating types from a .proto. That is enough
// because the payloads are plain messages: a handful of varints, strings and
// nested messages.
//
// One thing the wire format makes awkward: a field can be a varint in one
// message and a length-delimited message in another, so callers pick by number
// and check the wire type.
package protobuf

import (
	"encoding/binary"
	"fmt"
	"math"
)

// Wire types.
const (
	WireVarint  = 0
	WireFixed64 = 1
	WireBytes   = 2
	WireFixed32 = 5
)

// Field is one decoded protobuf field.
//
// Varint holds the decoded number for WireVarint, Bytes the payload for
// WireBytes, and Fixed the raw bits for the fixed-width types.
type Field struct {
	Number int
	Wire   int
	Varint uint64
	Bytes  []byte
	Fixed  uint64
}

// Num returns the varint as a float64, which is what the JS did after
// converting through Number(). It cannot be called Number: the struct already
// has a Number field for the field number, and Go forbids the two sharing a
// name.
func (f Field) Num() float64 { return float64(f.Varint) }

// Text returns the payload decoded as UTF-8.
func (f Field) Text() string { return string(f.Bytes) }

// Float32 reads a fixed32 as a float, little-endian as protobuf specifies.
func (f Field) Float32() float64 { return float64(math.Float32frombits(uint32(f.Fixed))) }

// Float64 reads a fixed64 as a float, little-endian.
func (f Field) Float64() float64 { return math.Float64frombits(f.Fixed) }

// Int64LE reads a length-delimited payload as a little-endian signed integer.
//
// The Lux API encodes an attendance ratio this way rather than as a varint, so
// both forms have to be handled.
func (f Field) Int64LE() int64 { return int64(binary.LittleEndian.Uint64(f.Bytes)) }

// Find returns the first field with the given number, or nil.
func Find(fields []Field, number int) *Field {
	for i := range fields {
		if fields[i].Number == number {
			return &fields[i]
		}
	}
	return nil
}

// FindBytes returns the first length-delimited field with that number.
func FindBytes(fields []Field, number int) []byte {
	if f := Find(fields, number); f != nil && f.Wire == WireBytes {
		return f.Bytes
	}
	return nil
}

// FindText returns the text of the first length-delimited field with that number.
func FindText(fields []Field, number int) string {
	if f := Find(fields, number); f != nil && f.Wire == WireBytes {
		return f.Text()
	}
	return ""
}

// Decode reads a message into its fields, in wire order.
func Decode(data []byte) ([]Field, error) {
	var out []Field
	for len(data) > 0 {
		tag, n := binary.Uvarint(data)
		if n <= 0 {
			return nil, fmt.Errorf("invalid protobuf tag")
		}
		data = data[n:]

		field := Field{Number: int(tag >> 3), Wire: int(tag & 7)}
		if field.Number == 0 {
			return nil, fmt.Errorf("invalid protobuf field number 0")
		}

		switch field.Wire {
		case WireVarint:
			value, n := binary.Uvarint(data)
			if n <= 0 {
				return nil, fmt.Errorf("invalid protobuf varint")
			}
			field.Varint = value
			data = data[n:]
		case WireFixed64:
			if len(data) < 8 {
				return nil, fmt.Errorf("truncated protobuf fixed64")
			}
			field.Fixed = binary.LittleEndian.Uint64(data)
			data = data[8:]
		case WireBytes:
			length, n := binary.Uvarint(data)
			if n <= 0 {
				return nil, fmt.Errorf("invalid protobuf length")
			}
			data = data[n:]
			if uint64(len(data)) < length {
				return nil, fmt.Errorf("truncated protobuf bytes")
			}
			field.Bytes = data[:length]
			data = data[length:]
		case WireFixed32:
			if len(data) < 4 {
				return nil, fmt.Errorf("truncated protobuf fixed32")
			}
			field.Fixed = uint64(binary.LittleEndian.Uint32(data))
			data = data[4:]
		default:
			return nil, fmt.Errorf("unsupported protobuf wire type %d", field.Wire)
		}

		out = append(out, field)
	}
	return out, nil
}

// AppendVarint appends a base-128 varint.
func AppendVarint(dst []byte, value uint64) []byte {
	for value >= 0x80 {
		dst = append(dst, byte(value)|0x80)
		value >>= 7
	}
	return append(dst, byte(value))
}

// AppendTag appends the tag byte for a field number and wire type.
func AppendTag(dst []byte, field, wire int) []byte {
	return AppendVarint(dst, uint64(field)<<3|uint64(wire))
}

// AppendString appends a length-delimited string field.
func AppendString(dst []byte, field int, value string) []byte {
	dst = AppendTag(dst, field, WireBytes)
	dst = AppendVarint(dst, uint64(len(value)))
	return append(dst, value...)
}

// AppendInt appends a varint field.
func AppendInt(dst []byte, field int, value uint64) []byte {
	dst = AppendTag(dst, field, WireVarint)
	return AppendVarint(dst, value)
}
