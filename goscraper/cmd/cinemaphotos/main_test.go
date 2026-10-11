package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

// 這個檔案釘住裁切管線的兩條性質（2026-10-11 用戶：「要求图片能填充满，不要留这么大黑边」）：
//
//  1. 畫布被填滿 —— 源圖是純色時，輸出不能出現任何黑像素。
//     舊版「小圖不放大、居中貼上」會讓 535x370 的源圖在 1600x900 上
//     留下約 58% 的黑邊，而黑邊是**烘進 JPEG** 的（頁面的 object-cover
//     只按容器裁，裁不掉圖裡本來就有的黑），線上 52 家 42 家中招。
//  2. 不拉伸 —— 源圖裡的方形標記在輸出裡仍要是方形。
//     少了這條，「直接拉滿」也能讓測試 1 通過，但人會被拍扁。

// solidSource 造一張純色源圖，並在正中畫一個白色方塊當比例尺。
func solidSource(w, h, box int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	base := color.RGBA{200, 120, 60, 255}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, base)
		}
	}
	if box > 0 {
		x0 := (w - box) / 2
		y0 := (h - box) / 2
		for y := y0; y < y0+box; y++ {
			for x := x0; x < x0+box; x++ {
				if image.Pt(x, y).In(img.Bounds()) {
					img.Set(x, y, color.RGBA{255, 255, 255, 255})
				}
			}
		}
	}
	return img
}

// encode 把源圖編成 PNG 位元組後走真正的 encodeBanner。
func encode(t *testing.T, src image.Image) image.Image {
	t.Helper()
	var raw bytes.Buffer
	if err := png.Encode(&raw, src); err != nil {
		t.Fatalf("png encode: %v", err)
	}
	target := filepath.Join(t.TempDir(), "out.jpg")
	if err := encodeBanner(raw.Bytes(), target); err != nil {
		t.Fatalf("encodeBanner: %v", err)
	}
	f, err := os.Open(target)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	return img
}

// isDark 判斷「接近純黑」。JPEG 有損，純色源圖的邊角可能壓出幾個單位的偏差，
// 因此用閾值而不是等於 0 —— 黑邊是整片 0，真內容不會壓到 12 以下。
func isDark(c color.Color) bool {
	r, g, b, _ := c.RGBA()
	return r>>8 < 12 && g>>8 < 12 && b>>8 < 12
}

func TestEncodeBannerFillsCanvas(t *testing.T) {
	// 535x370 是實測最常見的源圖尺寸（hkmovie6 的場館照），也是黑邊最嚴重的一檔。
	cases := []struct{ w, h int }{
		{535, 370},
		{400, 300},
		{8192, 5464},
		{4000, 1000},
		{1600, 900},
	}
	for _, c := range cases {
		out := encode(t, solidSource(c.w, c.h, 0))
		if b := out.Bounds(); b.Dx() != PhotoWidth || b.Dy() != PhotoHeight {
			t.Errorf("%dx%d: got %dx%d, want %dx%d", c.w, c.h, b.Dx(), b.Dy(), PhotoWidth, PhotoHeight)
			continue
		}
		// 掃描四角與四邊中點：純色源圖在這些位置都必須是內容，不能是黑。
		b := out.Bounds()
		probes := [][2]int{
			{b.Min.X, b.Min.Y},
			{b.Max.X - 1, b.Min.Y},
			{b.Min.X, b.Max.Y - 1},
			{b.Max.X - 1, b.Max.Y - 1},
			{b.Min.X + b.Dx()/2, b.Min.Y},
			{b.Min.X, b.Min.Y + b.Dy()/2},
			{b.Max.X - 1, b.Min.Y + b.Dy()/2},
			{b.Min.X + b.Dx()/2, b.Max.Y - 1},
		}
		for _, p := range probes {
			if isDark(out.At(p[0], p[1])) {
				t.Errorf("%dx%d: black at (%d,%d) — canvas is not filled", c.w, c.h, p[0], p[1])
				break
			}
		}
	}
}

func TestEncodeBannerDoesNotStretch(t *testing.T) {
	// 源圖比 16:9 窄（535x370），cover 會裁掉上下 —— 方形標記必須還是方形。
	out := encode(t, solidSource(535, 370, 100))
	bd := out.Bounds()
	minX, minY, maxX, maxY := bd.Dx(), bd.Dy(), -1, -1
	for y := bd.Min.Y; y < bd.Max.Y; y++ {
		for x := bd.Min.X; x < bd.Max.X; x++ {
			r, g, b, _ := out.At(x, y).RGBA()
			if r>>8 > 200 && g>>8 > 200 && b>>8 > 200 {
				if x < minX {
					minX = x
				}
				if x > maxX {
					maxX = x
				}
				if y < minY {
					minY = y
				}
				if y > maxY {
					maxY = y
				}
			}
		}
	}
	if maxX < 0 {
		t.Fatal("the white marker vanished — crop moved it out of frame")
	}
	w := maxX - minX + 1
	h := maxY - minY + 1
	ratio := float64(w) / float64(h)
	if ratio < 0.9 || ratio > 1.1 {
		t.Errorf("marker became %dx%d (ratio %.3f) — image was stretched, not cover-cropped", w, h, ratio)
	}
}

func TestEncodeBannerKeepsCropCentered(t *testing.T) {
	// 寬源圖（4000x1000）要裁掉左右；白色標記放在正中，裁完仍該在正中。
	out := encode(t, solidSource(4000, 1000, 200))
	bd := out.Bounds()
	minX, maxX := bd.Dx(), -1
	for y := bd.Min.Y; y < bd.Max.Y; y += 3 {
		for x := bd.Min.X; x < bd.Max.X; x++ {
			r, g, b, _ := out.At(x, y).RGBA()
			if r>>8 > 200 && g>>8 > 200 && b>>8 > 200 {
				if x < minX {
					minX = x
				}
				if x > maxX {
					maxX = x
				}
			}
		}
	}
	if maxX < 0 {
		t.Fatal("marker missing")
	}
	center := (minX + maxX) / 2
	if diff := center - bd.Dx()/2; diff < -8 || diff > 8 {
		t.Errorf("marker centre %d, canvas centre %d — crop is not centred", center, bd.Dx()/2)
	}
}

func TestEncodeBannerDegenerateSources(t *testing.T) {
	// 退化尺寸不能 panic（1x1、極窄、極扁）。
	for _, c := range []struct{ w, h int }{{1, 1}, {1, 500}, {500, 1}} {
		out := encode(t, solidSource(c.w, c.h, 0))
		if b := out.Bounds(); b.Dx() != PhotoWidth || b.Dy() != PhotoHeight {
			t.Errorf("%dx%d: got %dx%d", c.w, c.h, b.Dx(), b.Dy())
		}
	}
}
