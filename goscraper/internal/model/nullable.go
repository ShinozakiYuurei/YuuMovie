package model

import "encoding/json"

// Nullable is a JSON value that is always written, as null when unset.
//
// Why this exists instead of `*T` + omitempty: the Node scrapers are not
// consistent about the two, and the difference is observable downstream.
//
//   - Chinachem omits `category` entirely from its shows.
//   - Sunbeam writes `category: null`, `version: null`, `language: null`.
//
// lib/data.ts reads these keys directly and lib/compact.ts encodes several of
// them positionally, so "absent" and "null" are not interchangeable. A plain
// pointer with omitempty silently turns every null into an absent key — which
// is exactly what a field-level diff against the Node output catches and a
// record-count check does not.
//
// Unset marshals as JSON null, matching the Node behaviour for these fields.
type Nullable[T any] struct {
	Value T
	Set   bool
}

// SomeNullable returns a Nullable holding v.
func SomeNullable[T any](v T) Nullable[T] { return Nullable[T]{Value: v, Set: true} }

// PtrToNullable converts a pointer into a Nullable, treating nil as unset.
func PtrToNullable[T any](p *T) Nullable[T] {
	if p == nil {
		return Nullable[T]{}
	}
	return Nullable[T]{Value: *p, Set: true}
}

// OrZero returns the held value, or the zero value when unset.
func (n Nullable[T]) OrZero() T {
	if !n.Set {
		var zero T
		return zero
	}
	return n.Value
}

// MarshalJSON writes the held value, or null when unset.
func (n Nullable[T]) MarshalJSON() ([]byte, error) {
	if !n.Set {
		return []byte("null"), nil
	}
	return json.Marshal(n.Value)
}

// UnmarshalJSON reads a value into the Nullable, treating null as unset.
func (n *Nullable[T]) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		n.Set = false
		var zero T
		n.Value = zero
		return nil
	}
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	n.Value = v
	n.Set = true
	return nil
}

// Omittable is a value that is left out of the JSON entirely when unset, and
// written as its value otherwise — the counterpart to Nullable.
//
// It exists because the Node scrapers are inconsistent per circuit, and both
// behaviours are load-bearing: Chinachem's shows have no `category` key at all
// while Sunbeam's carry `category: null`. A single field type has to express
// both, so the choice lives at the call site rather than in a struct tag.
type Omittable[T any] struct {
	Value T
	Set   bool
}

// SomeOmittable returns an Omittable holding v.
func SomeOmittable[T any](v T) Omittable[T] { return Omittable[T]{Value: v, Set: true} }

// MarshalJSON writes the value, or null when unset (which callers combine with
// the omitempty-free tag only when they want a null present).
func (o Omittable[T]) MarshalJSON() ([]byte, error) {
	if !o.Set {
		return []byte("null"), nil
	}
	return json.Marshal(o.Value)
}
