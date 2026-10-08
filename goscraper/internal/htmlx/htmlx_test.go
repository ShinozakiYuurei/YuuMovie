package htmlx

import (
	"strings"
	"testing"
)

// These cases pin the behaviour of the lookahead-free rewrite. The original
// JS used a lookahead to require a class on the opening tag:
//
//	new RegExp('<' + tag + '\\b(?=[^>]*class="[^"]*\\b' + cls + '\\b[^"]*")[^>]*>', 'gi')
//
// Matching first and checking the class afterwards must give the same answer.

func TestHasClassWord(t *testing.T) {
	cases := []struct {
		tag  string
		name string
		want bool
	}{
		{`<div class="each-movie-wrap">`, "each-movie-wrap", true},
		{`<div class="a each-movie-wrap b">`, "each-movie-wrap", true},
		{`<div class='each-movie-wrap'>`, "each-movie-wrap", false},
		// Substring must NOT match: the JS \\b guards this.
		{`<div class="noteach-movie-wrap">`, "each-movie-wrap", false},
		{`<div class="each-movie-wrapx">`, "each-movie-wrap", false},
		{`<div class="other">`, "each-movie-wrap", false},
		{`<div>`, "each-movie-wrap", false},
		{`<div class="session-type active">`, "session-type", true},
	}
	for _, tc := range cases {
		if got := HasClassWord(tc.tag, tc.name); got != tc.want {
			t.Errorf("HasClassWord(%q, %q) = %v, want %v", tc.tag, tc.name, got, tc.want)
		}
	}
}

func TestBlocksByClass(t *testing.T) {
	html := `<div class="each-movie-wrap"><h4>A</h4><div class="session-type">` +
		`<a class="session" href="/b/1">t</a></div></div>` +
		`<div class="other">skip</div>` +
		`<div class="each-movie-wrap"><h4>B</h4></div>`

	blocks := BlocksByClass(html, "each-movie-wrap", "div")
	if len(blocks) != 2 {
		t.Fatalf("got %d blocks, want 2: %q", len(blocks), blocks)
	}
	if !strings.Contains(blocks[0], "session-type") {
		t.Errorf("first block should include its nested content, got %q", blocks[0])
	}
	if strings.Contains(blocks[0], "skip") {
		t.Errorf("first block must stop at its own close tag, got %q", blocks[0])
	}
	if strings.Contains(blocks[1], "session") {
		t.Errorf("second block should be its own element, got %q", blocks[1])
	}
}

func TestBlocksByClassSelfClosing(t *testing.T) {
	// <br/> must not change depth, or every block containing one would run
	// past its close tag.
	html := `<div class="w">a<br/>b</div><div class="w">c</div>`
	blocks := BlocksByClass(html, "w", "div")
	if len(blocks) != 2 {
		t.Fatalf("got %d blocks, want 2: %q", len(blocks), blocks)
	}
	if !strings.Contains(blocks[0], "b") {
		t.Errorf("first block should contain b, got %q", blocks[0])
	}
}

func TestTextAndEntities(t *testing.T) {
	cases := []struct{ in, want string }{
		{`<p>Hello <b>world</b></p>`, "Hello world"},
		{`a &amp; b`, "a & b"},
		{`&quot;q&quot;`, `"q"`},
		{`x&nbsp;y`, "x y"},
		{`&#65;&#66;`, "AB"},
		{"  lots\n\tof   space ", "lots of space"},
	}
	for _, tc := range cases {
		if got := Text(tc.in); got != tc.want {
			t.Errorf("Text(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestFirstTextByClass(t *testing.T) {
	html := `<a class="session" href="/x"><p class="schedule_housename">1院</p>` +
		`<p class="time">13:40</p><p class="price">80</p></a>`
	if got := FirstTextByClass(html, "p", "schedule_housename"); got != "1院" {
		t.Errorf("housename = %q, want 1院", got)
	}
	if got := FirstTextByClass(html, "p", "time"); got != "13:40" {
		t.Errorf("time = %q, want 13:40", got)
	}
	if got := FirstTextByClass(html, "p", "price"); got != "80" {
		t.Errorf("price = %q, want 80", got)
	}
	if got := FirstTextByClass(html, "p", "missing"); got != "" {
		t.Errorf("missing = %q, want empty", got)
	}
}
