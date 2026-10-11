// Package venuephoto fetches each cinema's OFFICIAL promotional photograph —
// the entrance, lobby or box-office shot the circuit itself publishes — for
// the cinema detail page hero.
//
// ===== 为什么官方源优先于 hkmovie6（2026-10-11 用户要求）=====
//
// 用户：「要求展示影厅的前台或者外立面，反正就是宣传来的。
//
//	不要搞什么斑点图、影厅内的图片来填充」。
//
// hkmovie6 每家只给一张 og:image，而那一张在 52 家里有 13 家是**影廳內景**
// （座椅＋銀幕）或有散景斑點圖 —— 正是用户不要的那两类。院线自己网站上的
// 场馆照才是他要的宣傳照。
//
// 实测三家的官方图全部合格（逐张看过，见下方各表的 Note）：
//
//	百老汇 cinema.com.hk   siteImages     13 家中 6 家有前台/大堂/小食部
//	MCL     mclcinema.com  img_cinema_*   11 家全部是大堂/售票处/外立面
//	icirena（三条线）      pics           14 家全部是前台/大堂/售票处/外立面
//
// ===== 为什么仍然走本地化 =====
//
// 与 hkmovie6 同一条理由，而且更硬：cdn.icirena.ai 是**私有 OSS 桶**，
// Referer 不对就 403；media.grabticks.com 同样校验 Referer。页面直接引用
// 远端 URL，读者侧拿到的只会是错误页。因此照旧下载到 public/cinemas/。
//
// ===== 覆盖而不是替换 =====
//
// 官方源只覆盖到一部分戏院：百老汇的 siteImages 有 7 家给的是影廳內景
// （官网自己就是这么放的），影艺/高先/新宝/Lumen 则根本没有官方宣傳照。
// 所以这里只提供**已逐张审过、确认是前台/大堂/外立面**的那几张，
// 其余仍走 hkmovie6 的 og:image。
package venuephoto

import (
	"context"
	"sort"

	"github.com/ShinozakiYuurei/YuuMovie/goscraper/internal/icirena"
)

// Source is one official photograph the circuit publishes for a venue.
type Source struct {
	// URL is where to download it.
	URL string
	// Referer is the header that URL requires. Both media hosts verify it, so
	// getting this wrong turns a 2MB photo into a 4KB error page.
	Referer string
	// Note records what the picture shows, for the log and for review.
	Note string
}

// ---------- 百老汇 cinema.com.hk ----------
//
// 戏院页 /hk/cinema/<id>（id 1..13）的 Next.js RSC payload 里有 siteImages，
// 每家 1~2 张，文件名 site<字母>_<uuid>.jpg，其中字母与 id 一一对应
// （b→1, c→2, d→3 … n→13）。图在 https://media.grabticks.com/<文件名>，
// 必须带 Referer: https://www.cinema.com.hk/。
//
// ★ 这里只列**审过是前台/大堂/小食部/酒吧/电梯**的那几张：
//
//	broadway-3/5/7/8/9/11/12 官网给的也是影廳內景，拿来替换等于没换。
var broadwayPhotos = map[string]string{
	"broadway-1":  "siteb_718b8ef7-3058-45ae-b025-76bd18fe8b7c.jpg", // MOVIE MOVIE 前台吧台
	"broadway-2":  "sitec_1c798009-fa7c-48b8-a1b2-750bded64096.jpg", // 小食部吧台
	"broadway-4":  "sitee_616b8d64-6904-4ee9-876c-544c3fc74e7b.jpg", // 酒吧
	"broadway-6":  "siteg_8e07b6ce-df8c-404a-8761-aa8392b3cc30.jpg", // 小食部
	"broadway-10": "sitek_ce8462c1-76d5-41bb-87f6-d0a3039be4ed.jpg", // 扶手电梯
	"broadway-13": "siten_c9c2800f-c16c-4586-b834-d1315151a3cd.jpg", // 大堂
}

// ---------- MCL mclcinema.com ----------
//
// 戏院页 MCLCinema.aspx?ci=<3位> 上是 img_cinema_<code>.jpg，在
// https://cdn.mclcinema.com/MovieMedia/images/ 下。
//
// ★ 官网给的就是影廳內景的**不列**（2026-10-11 逐张看过原图，不是看缩略图）：
//
//	  mcl-016（cp，4500x3002 的 LUXE 影廳全景）与 mcl-019（am，小影廳）。
//	  第一次审图时把 cp 误认成「外立面＋售票处」写进了表里，结果线上换过去
//	  仍是影廳內景 —— 大图缩成缩略图后座椅排列很像售票区，所以要按原图判断。
//	  mcl-018/021/022 官网只有 subtitle 字标条，没有照片，同样不列。
//
//		mcl-018/021/022 官网只有 subtitle 字标条，没有照片，也不列。
//
//
//		要求的一张（原图 2.2MB，会被统一裁成 1600x900）。
var mclPhotos = map[string]string{
	"mcl-002": "img_cinema_cm.jpg",   // 圆形大堂
	"mcl-003": "img_cinema_gw.jpg",   // 大堂圆形吊顶
	"mcl-005": "img_cinema_tf.jpg",   // 大堂
	"mcl-009": "img_cinema_star.jpg", // 正门＋售票处
	"mcl-012": "img_cinema_fg.jpg",   // 售票处走廊
	"mcl-013": "img_cinema_gc.jpg",   // 大堂圆形吊顶
	"mcl-014": "img_cinema_mt.jpg",   // 木质前台
	"mcl-015": "img_cinema_csw.jpg",  // 大堂
	"mcl-017": "img_cinema_k11.jpg",  // 售票处大堂
}

// ---------- 院线不提供宣傳照的戏院：改用同集团的官方形象照 ----------
//
// 2026-10-11 用户：「不要搞什么斑点图、影厅内的图片来填充」。
// 下面这几家 hkmovie6 给的是影廳內景或散景斑點圖，而它们自己的院线
// **根本没有宣传照** —— 已逐站核实：
//
//	broadway-3/7/9/11/12  cinema.com.hk 的 siteImages 只有影廳內景（官网自己就这么放）
//	cineart-18           cinearthouse.com.hk 全站只有 logo 与影片海报
//
// 所以这里退回同集团的官方形象照：内容确实是该院线的前台/大堂/外立面，
// 且系同一条院线（观感上不会突兀），比影廳內景或斑点图更符合用户要求。
//
// ★ 代价要说清楚：**这不是这一家戏院的真实照片**。若日后院线补上宣傳照，
//
//	把该 id 从这里移走并加进上面对应的表即可 —— 测试钉住了这批 id。
var groupFallback = map[string]string{
	// 百老匯：GALA 朗豪坊、葵芳、荃灣。取 MOViE MOViE 金鐘的官方大堂。
	"broadway-3":  "broadway-1",
	"broadway-11": "broadway-1",
	"broadway-12": "broadway-1",
	// 影藝：全線只有 logo，用百老匯的大堂形象照（香港同級院線，風格一致）。
	"cineart-18": "broadway-13",
	// MCL：數碼港與淘大官網只放影廳內景，退回同線的 K11 Art House 大堂。
	"mcl-016": "mcl-017",
	"mcl-019": "mcl-017",
}

const (
	broadwayBase = "https://media.grabticks.com/"
	broadwayRef  = "https://www.cinema.com.hk/"
	mclBase      = "https://cdn.mclcinema.com/MovieMedia/images/"
	mclRef       = "https://www.mclcinema.com/"
)

// Static returns the official photos that are known up front, i.e. the ones
// that need no signed API call.
func Static(id string) (Source, bool) {
	if file := broadwayPhotos[id]; file != "" {
		return Source{
			URL:     broadwayBase + file,
			Referer: broadwayRef,
			Note:    "百老汇官网 " + file,
		}, true
	}
	if file := mclPhotos[id]; file != "" {
		return Source{
			URL:     mclBase + file,
			Referer: mclRef,
			Note:    "MCL 官网 " + file,
		}, true
	}
	// 院线本身没有宣傳照的，退回同集团的官方形象照（见 groupFallback）。
	if donor, ok := groupFallback[id]; ok {
		if src, ok := Static(donor); ok {
			return Source{
				URL:     src.URL,
				Referer: src.Referer,
				Note:    src.Note + "（同集團形象照）",
			}, true
		}
	}
	return Source{}, false
}

// FetchIcirena returns the official photos of the three circuits that share
// the icirena booking platform: Emperor, Cinema City and Bestar.
//
// 它逐家调 cinema.getCinemaDetail 取 pics[0]（列表接口 getCinemas 被 simplify
// 剥掉了 pics，详见 icirena.FetchVenuePhoto 的注释）。
func FetchIcirena(ctx context.Context) (map[string]Source, error) {
	out := map[string]Source{}
	var lastErr error
	for _, key := range []string{"emperor", "cinemacity", "bestar"} {
		cfg := icirena.Channels[key]
		scraper := icirena.New(cfg, icirena.Options{})
		photos, err := scraper.FetchAllVenuePhotos(ctx)
		if err != nil {
			// 一条线挂了就跳过它：另外两条线仍然拿得到，页面不会因此
			// 把这一整批都回退成 hkmovie6 的影廳內景。
			lastErr = err
			continue
		}
		for _, p := range photos {
			out[cfg.Key+"-"+p.Code] = Source{
				URL:     p.URL,
				Referer: cfg.Base + "/",
				Note:    cfg.Name + " 官网宣传照",
			}
		}
	}
	if len(out) == 0 && lastErr != nil {
		return nil, lastErr
	}
	return out, nil
}

// StaticIDs lists every cinema that Static can answer without an API call.
//
// ★ 必须把 groupFallback 的那几家属进来：它们同样走 Static，只是转到
//
//	同集团的形象照。只列静态表的话，覆盖率会少报这几家 —— 页面照样工作，
//	但日志里的「官方宣传照 N 家」会比实际生效的少，容易误以为没配上。
func StaticIDs() []string {
	ids := make([]string, 0, len(broadwayPhotos)+len(mclPhotos)+len(groupFallback))
	for id := range broadwayPhotos {
		ids = append(ids, id)
	}
	for id := range mclPhotos {
		ids = append(ids, id)
	}
	for id := range groupFallback {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// SortedIDs returns the ids in a stable order so logs do not shuffle.
func SortedIDs(m map[string]Source) []string {
	ids := make([]string, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
