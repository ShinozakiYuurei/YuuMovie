package sunbeam

import (
	"testing"
)

func TestParsePosterUnit(t *testing.T) {
	CDN := CoverBase
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

// ★ 2026-10-10 新增（21 张海报 404 的回归守卫）：
//
//	相对封面路径必须解析到 cdn.sunbeamwhampoa.com，**不能**是 www。
//	实测同一张图 www 返回 404（HTML 错误页）、cdn 返回 200（JPEG），
//	而 Parse() 传的 base 决定拼出哪个主机 —— 这条断言就是那道守卫。
func TestCoverBaseServesImages(t *testing.T) {
	if CoverBase != "https://cdn.sunbeamwhampoa.com" {
		t.Errorf("CoverBase = %q, want cdn host", CoverBase)
	}
	got := ParsePoster(`coverUrl:"whampoa/covers/a.jpg"`, CoverBase)
	if got == nil {
		t.Fatal("ParsePoster returned nil")
	}
	if *got != "https://cdn.sunbeamwhampoa.com/whampoa/covers/a.jpg" {
		t.Errorf("got %q, want the cdn form", *got)
	}
}
