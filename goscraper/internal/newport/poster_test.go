package newport

import (
	"testing"
)

func TestParsePoster(t *testing.T) {
	block1 := `<div><img src="/images/poster.jpg" alt="film" class="movieImageImg"></div>`
	p1 := ParsePoster(block1, Base)
	if p1 == nil || *p1 != "https://www.theatre.com.hk/images/poster.jpg" {
		t.Errorf("got %v, want https://www.theatre.com.hk/images/poster.jpg", p1)
	}

	block2 := `<img class='movieImageImg' data-src='/lazy.jpg'>`
	p2 := ParsePoster(block2, Base)
	if p2 == nil || *p2 != "https://www.theatre.com.hk/lazy.jpg" {
		t.Errorf("got %v, want https://www.theatre.com.hk/lazy.jpg", p2)
	}
}