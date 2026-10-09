package sunbeam

import (
	"testing"
)

func TestParsePosterUnit(t *testing.T) {
	CDN := "https://cdn.sunbeamwhampoa.com"
	s1 := `eventNameTc:"影片",coverUrl:"whampoa/covers/a.jpg",censorshipImageUrl:null`
	p1 := ParsePoster(s1, CDN)
	if p1 == nil || *p1 != "https://cdn.sunbeamwhampoa.com/whampoa/covers/a.jpg" {
		t.Errorf("got %v, want https://cdn.sunbeamwhampoa.com/whampoa/covers/a.jpg", p1)
	}

	s2 := `coverUrl:"https://images.example/poster.jpg"`
	p2 := ParsePoster(s2, CDN)
	if p2 == nil || *p2 != "https://images.example/poster.jpg" {
		t.Errorf("got %v, want https://images.example/poster.jpg", p2)
	}

	s3 := `coverUrl:"whampoa\u002fcovers/a.jpg"`
	p3 := ParsePoster(s3, CDN)
	if p3 == nil || *p3 != "https://cdn.sunbeamwhampoa.com/whampoa/covers/a.jpg" {
		t.Errorf("got %v, want https://cdn.sunbeamwhampoa.com/whampoa/covers/a.jpg", p3)
	}

	s4 := `coverUrl:null`
	p4 := ParsePoster(s4, CDN)
	if p4 != nil {
		t.Errorf("got %v, want nil", p4)
	}
}