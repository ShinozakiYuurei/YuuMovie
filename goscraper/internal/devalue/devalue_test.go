package devalue

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// A payload in the exact shape Nuxt emits: shared values referenced by
// position, unicode-escaped slashes, and an empty array.
func TestEvalResolvesReferences(t *testing.T) {
	script := `window.__NUXT__=(function(a,b,c){return {layout:"default",data:[{splash:[],movie:{name:{zhHK:"我阿爹想旅行",enGB:a},url:b,flag:c,count:2}}]}}("2D","https:\u002F\u002Fexample.com\u002Fa.jpg",true));`

	v, err := Eval(script)
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	root, ok := v.(map[string]any)
	if !ok {
		t.Fatalf("root is %T", v)
	}
	data := root["data"].([]any)
	first := data[0].(map[string]any)
	movie := first["movie"].(map[string]any)

	if got := movie["name"].(map[string]any)["enGB"]; got != "2D" {
		t.Errorf("enGB = %v, want the first argument", got)
	}
	if got := movie["url"]; got != "https://example.com/a.jpg" {
		t.Errorf("url = %v, want the decoded slash escapes", got)
	}
	if got := movie["count"]; got != 2.0 {
		t.Errorf("count = %v", got)
	}
	if got := first["splash"].([]any); len(got) != 0 {
		t.Errorf("splash = %v, want an empty array", got)
	}
}

// The point of the package is that it refuses anything outside the grammar,
// rather than misreading it.
func TestEvalRejectsExpressions(t *testing.T) {
	cases := map[string]string{
		"call":     `window.__NUXT__=(function(a){return {x:a()}}(1));`,
		"operator": `window.__NUXT__=(function(a){return {x:a+1}}(1));`,
		"computed": `window.__NUXT__=(function(a){return {[a]:1}}("k"));`,
		"unknown":  `window.__NUXT__=(function(a){return {x:window}}(1));`,
		"noassign": `var x = 1;`,
	}
	for name, script := range cases {
		if _, err := Eval(script); err == nil {
			t.Errorf("%s: expected an error, got none", name)
		}
	}
}

// Live payloads must parse. These were captured from goldenscene.com.
func TestEvalOnCapturedPage(t *testing.T) {
	raw, err := osReadFile("../../testdata/gsc-page.html")
	if err != nil {
		t.Skip("no captured page")
	}
	payload := extractPayload(string(raw))
	if payload == "" {
		t.Fatal("captured page has no payload")
	}
	v, err := Eval(payload)
	if err != nil {
		t.Fatalf("Eval on a real page: %v", err)
	}
	root := v.(map[string]any)
	data := root["data"].([]any)
	first := data[0].(map[string]any)
	movie, ok := first["movie"].(map[string]any)
	if !ok {
		t.Fatal("no movie on the page")
	}
	if uuid, _ := movie["uuid"].(string); uuid == "" {
		t.Error("movie.uuid is empty")
	}
}

var scriptTagRe = regexp.MustCompile(`(?is)<script[^>]*>(.*?)</script>`)

func extractPayload(html string) string {
	for _, m := range scriptTagRe.FindAllStringSubmatch(html, -1) {
		if strings.Contains(m[1], "window.__NUXT__=") {
			return m[1]
		}
	}
	return ""
}

func osReadFile(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}
