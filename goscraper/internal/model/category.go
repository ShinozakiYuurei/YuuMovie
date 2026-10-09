package model

import (
	"encoding/json"
	"fmt"
)

// Category is a screening's category, which distinguishes three states.
//
// The circuits disagree about it: Broadway, Chinachem and Lumen write no key at
// all, while Sunbeam, Newport, Golden Scene and the GrabTicks circuits write one,
// often null. Collapsing "absent" into "null" changes what lib/data.ts reads, so
// the three states are kept apart here.
//
// It is a value rather than a pointer because encoding/json never calls
// UnmarshalJSON for a null on a pointer field: it just sets the pointer to nil,
// which loses exactly the distinction this type exists to keep.
type Category struct {
	// Present records that the key was written at all.
	Present bool
	// Null records that the written value was null.
	Null bool
	// Value is the decoded value, valid when Null is false.
	Value string
}

// CategoryNull returns a category that was written as null.
func CategoryNull() Category { return Category{Present: true, Null: true} }

// CategoryValue returns a category carrying v.
func CategoryValue(v string) Category { return Category{Present: true, Value: v} }

// CategoryPresent builds a category from a raw value, mapping an empty string to
// an explicit null.
func CategoryPresent(value string) Category {
	if value == "" {
		return CategoryNull()
	}
	return CategoryValue(value)
}

// MarshalJSON writes null when the value is null.
func (c Category) MarshalJSON() ([]byte, error) {
	if c.Null {
		return []byte("null"), nil
	}
	return json.Marshal(c.Value)
}

// UnmarshalJSON records an explicit null as distinct from a value.
func (c *Category) UnmarshalJSON(data []byte) error {
	c.Present = true
	if string(data) == "null" {
		c.Null = true
		c.Value = ""
		return nil
	}
	c.Null = false
	return json.Unmarshal(data, &c.Value)
}

// IsZero lets encoding/json omit the key when the circuit wrote none.
func (c Category) IsZero() bool { return !c.Present }

// String renders the value for logs.
func (c Category) String() string {
	if !c.Present {
		return "<absent>"
	}
	if c.Null {
		return "<null>"
	}
	return fmt.Sprintf("%q", c.Value)
}
