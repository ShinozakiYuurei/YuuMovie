package cinemaphoto

import (
	"testing"
)

// The fixtures below are trimmed from the live pages (2026-10-11). They keep
// the shapes the parsers key on: the escaped JSON-LD blob for coordinates and
// the og:image meta for the banner.

const listFixture = `
<a href="/cinema/8136aeed-d1e8-4805-81f6-9bd18de6250e/%E8%8B%B1%E7%9A%87%E6%88%B2%E9%99%A2%EF%BC%88%E9%8A%85%E9%91%BC%E7%81%A3%E6%99%82%E4%BB%A3%E5%BB%A3%E5%A0%B4%EF%BC%89" class="dropdownItem">
<a href="/cinema/7529616f-6993-4a54-8cea-6815a0bff8ba/%E8%8B%B1%E7%9A%87%E6%88%B2%E9%99%A2_(%E9%8A%85%E9%91%BC%E7%81%A3%E6%99%82%E4%BB%A3%E5%BB%A3%E5%A0%B4)_(Special_Screening)">
<a href="/cinema/f014532e-2605-4bd3-8054-b288ba458518/MOViE_MOViE_Pacific_Place_(%E9%87%91%E9%90%98)">
<a href="/cinema/f014532e-2605-4bd3-8054-b288ba458518/MOViE_MOViE_Pacific_Place_(%E9%87%91%E9%90%98)">
`

func TestParseListDropsSpecialsAndDuplicates(t *testing.T) {
	venues := ParseList(listFixture)
	if len(venues) != 2 {
		t.Fatalf("want 2 venues, got %d: %+v", len(venues), venues)
	}
	if venues[0].UUID != "8136aeed-d1e8-4805-81f6-9bd18de6250e" {
		t.Errorf("unexpected first uuid %q", venues[0].UUID)
	}
	if venues[0].Name != "英皇戲院（銅鑼灣時代廣場）" {
		t.Errorf("name not decoded: %q", venues[0].Name)
	}
	if venues[1].Name != "MOViE MOViE Pacific Place (金鐘)" {
		t.Errorf("underscores should become spaces: %q", venues[1].Name)
	}
}

const venueFixture = `
<meta data-hid="og-image" property="og:image" content="https://storage.movie6.com/cinema/2b39fc_EmperorCinema_CWB_1691721732.jpg">
{\"name\":\"英皇戲院（銅鑼灣時代廣場）\",\"latitude\":22.278166497723056,\"longitude\":114.18211762144921}
`

func TestParseVenuePage(t *testing.T) {
	v := ParseVenuePage(venueFixture)
	if v.Photo != "https://storage.movie6.com/cinema/2b39fc_EmperorCinema_CWB_1691721732.jpg" {
		t.Errorf("photo: %q", v.Photo)
	}
	if v.Lat < 22.27 || v.Lat > 22.28 {
		t.Errorf("lat: %v", v.Lat)
	}
	if v.Lon < 114.18 || v.Lon > 114.19 {
		t.Errorf("lon: %v", v.Lon)
	}
}

func TestNormalizeName(t *testing.T) {
	cases := [][2]string{
		{"百老匯戲院 - 旺角", "百老匯戲院旺角"},
		{"旺角百老匯戲院", "旺角百老匯戲院"},
		{"影藝戲院 (翡翠明珠)", "影藝戲院翡翠明珠"},
		{"影藝戲院(銅鑼灣JP)", "影藝戲院銅鑼灣jp"},
		{"MOViE MOViE Cityplaza (太古城)", "moviemoviecityplaza太古城"},
	}
	for _, c := range cases {
		if got := NormalizeName(c[0]); got != c[1] {
			t.Errorf("NormalizeName(%q) = %q, want %q", c[0], got, c[1])
		}
	}
}

func TestMatchPrefersNameThenFallsBackToDistance(t *testing.T) {
	cinemas := []Cinema{
		{ID: "broadway-9", NameZh: "旺角"},
		{ID: "broadway-13", NameZh: "嘉湖"},
		{ID: "far-away", NameZh: "不存在"},
	}
	display := map[string]string{
		"broadway-9":  "旺角百老匯戲院",
		"broadway-13": "嘉湖百老匯戲院",
	}
	coords := map[string][2]float64{
		"broadway-9":  {22.3192, 114.1694},
		"broadway-13": {22.4567, 114.0017},
		"far-away":    {22.0, 114.0},
	}
	venues := []Venue{
		{UUID: "a", Name: "百老匯戲院 - 旺角", Lat: 22.3192, Lon: 114.1694, Photo: "p1"},
		// 名字不同但坐标重合：靠距离命中。
		{UUID: "b", Name: "嘉湖銀座", Lat: 22.4568, Lon: 114.0018, Photo: "p2"},
		{UUID: "c", Name: "別的戲院", Lat: 22.10, Lon: 114.10, Photo: "p3"},
	}

	got := Match(cinemas, venues, display, coords)
	if len(got) != 2 {
		t.Fatalf("want 2 matches, got %d: %+v", len(got), got)
	}
	if got["broadway-9"].Photo != "p1" {
		t.Errorf("name match failed: %+v", got["broadway-9"])
	}
	if got["broadway-13"].Photo != "p2" {
		t.Errorf("distance match failed: %+v", got["broadway-13"])
	}
	if _, ok := got["far-away"]; ok {
		t.Errorf("a far venue must not match")
	}
}

const geoFixture = `
export const CINEMA_COORD: Record<string, [number, number]> = {
	// ---------- hkmovie6.com（OSM 数据） ----------
	'bestar-58001': [22.315687, 114.161959],
	'broadway-1': [22.277593, 114.166175],
};

export const CINEMA_COORD_FIXES: Record<string, [number, number]> = {
	'ignored-1': [1.0, 2.0],
};
`

func TestParseCoordsStopsAtBlockEnd(t *testing.T) {
	coords := ParseCoords(geoFixture)
	if len(coords) != 2 {
		t.Fatalf("want 2 coords, got %d: %+v", len(coords), coords)
	}
	if coords["broadway-1"][1] != 114.166175 {
		t.Errorf("broadway-1: %+v", coords["broadway-1"])
	}
	if _, ok := coords["ignored-1"]; ok {
		t.Errorf("the FIXES table must not leak into CINEMA_COORD")
	}
}

const namesFixture = `
export const CINEMA_DISPLAY_NAME: Record<string, string> = {
	'broadway-8': '百老匯電影中心',
	'emperor-57002': '英皇戲院（銅鑼灣時代廣場）',
};
`

func TestParseDisplayNames(t *testing.T) {
	names := ParseDisplayNames(namesFixture)
	if len(names) != 2 {
		t.Fatalf("want 2, got %d", len(names))
	}
	if names["broadway-8"] != "百老匯電影中心" {
		t.Errorf("got %q", names["broadway-8"])
	}
}
