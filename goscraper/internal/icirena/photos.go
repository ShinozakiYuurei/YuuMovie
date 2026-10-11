package icirena

import (
	"context"
	"encoding/json"
	"strings"
)

// VenuePhoto is the official promotional photograph the booking platform
// publishes for one venue.
//
// 它来自 cinema.getCinemaDetail 的 pics 字段，是院线自己的宣传照
// （前台／大堂／外立面），不是影廳內景 —— 2026-10-11 用户明确要求
// 戏院页 hero 用后者，不要用前者。
type VenuePhoto struct {
	// Code is the venue's cinemaLinkId, the numeric suffix of our ids
	// (emperor-57002 → "57002").
	Code string
	// Name is the venue's display name on the circuit's site.
	Name string
	// URL is the first published picture; empty when the venue has none.
	URL string
}

// detail is the part of the getCinemaDetail payload we care about.
type venueDetail struct {
	CinemaLinkID string   `json:"cinemaLinkId"`
	CinemaName   string   `json:"cinemaName"`
	Pics         []string `json:"pics"`
}

// FetchVenuePhoto returns the official promotional photograph for one venue.
//
// ★ 为什么必须走 getCinemaDetail 而不是 getCinemas（2026-10-11 实测）：
//
//	getCinemas 是列表接口，simplify=true 之后每家只剩 id/地址/名称，
//	pics 被整个剥掉 —— 实测返回里连 "pics" 这个键都没有。
//	getCinemaDetail 才带 pics，且 pics[0] 就是院线自己的场馆宣传照。
//
// 早先用浏览器抓 getCinemas 偶尔能看到 pics，是因为那个请求带了
// 不简化的参数；跟着官网的参数走反而不稳，所以固定用 detail。
func (s *Scraper) FetchVenuePhoto(ctx context.Context, cinemaLinkID string) (VenuePhoto, error) {
	payload, err := s.call(ctx, methodCinemaDetail, map[string]string{
		"cinemaLinkId": cinemaLinkID,
	}, 3)
	if err != nil {
		return VenuePhoto{}, err
	}
	var detail venueDetail
	if err := s.biz(payload, &detail); err != nil {
		return VenuePhoto{}, err
	}
	photo := VenuePhoto{
		Code: strings.TrimSpace(detail.CinemaLinkID),
		Name: detail.CinemaName,
	}
	// ★ Code 以我们传进去的为准：接口偶尔把它写成数字或别的形态，
	//   而调用方拿着 id 拼 URL，用回读值会拼错。
	photo.Code = cinemaLinkID
	for _, u := range detail.Pics {
		if u = strings.TrimSpace(u); u != "" {
			photo.URL = u
			break
		}
	}
	return photo, nil
}

// FetchAllVenuePhotos returns the official photograph of every venue on the
// circuit, in the order the listing gives them.
//
// 逐家串行：这是同一个被 CDN 保护的接口，并发打过去容易被限流，
// 而戏院数只有个位数到十几个，串行也只要几秒。
func (s *Scraper) FetchAllVenuePhotos(ctx context.Context) ([]VenuePhoto, error) {
	payload, err := s.call(ctx, methodCinemas, nil, 3)
	if err != nil {
		return nil, err
	}
	var wrapper struct {
		Cities []struct {
			Cinemas []struct {
				CinemaLinkID json.RawMessage `json:"cinemaLinkId"`
				CinemaName   string          `json:"cinemaName"`
			} `json:"cinemas"`
		} `json:"cities"`
	}
	if err := s.biz(payload, &wrapper); err != nil {
		return nil, err
	}
	var out []VenuePhoto
	for _, city := range wrapper.Cities {
		for _, c := range city.Cinemas {
			code := textOf(c.CinemaLinkID)
			if code == "" {
				continue
			}
			photo, err := s.FetchVenuePhoto(ctx, code)
			if err != nil || photo.URL == "" {
				// 单家失败不中断整条线：这家没有官方照时页面该回退到
				// 别的来源，而不是让整批都拿不到。
				continue
			}
			photo.Name = c.CinemaName
			out = append(out, photo)
		}
	}
	return out, nil
}
