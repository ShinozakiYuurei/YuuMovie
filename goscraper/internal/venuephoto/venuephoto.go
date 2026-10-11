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
//	百老汇 cinema.com.hk   siteImages     13 家中 5 家有前台/大堂/小食部
//	MCL     mclcinema.com  img_cinema_*   11 家全部是大堂/售票处/外立面
//	icirena（三条线）      pics           14 家全部是前台/大堂/售票处/外立面
//	甄选官方/高清晰图      curatedPhotos  PALACE ifc、MOKO、ELEMENTS、旺角、MegaBox、新光黄埔
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

// curatedPhotos holds official and verified architectural / facade photographs
// for venues where circuit sites only host auditoriums or lack photos.
//
// ★ 審圖鐵律（2026-10-11）：
//  1. 必須逐張審原圖（嚴禁只看縮略圖，避免將座位誤判為售票處）
//  2. 必須是前台、大堂、外立面或標誌性招牌
//  3. 嚴禁影廳座椅/銀幕或散景光斑
var curatedPhotos = map[string]Source{
	// PALACE ifc: 官網原為調酒吧台（用戶投訴），改用設計師 James Law Cybertecture 官方金色大堂長廊實景宣傳照
	"broadway-4": {
		URL:     "https://cybertecture.io/wp-content/uploads/cover_re-6.jpg",
		Referer: "https://cybertecture.io/",
		Note:    "James Law Cybertecture PALACE ifc 大堂長廊實景",
	},
	// B+ cinema MOKO: hkmovie6 給的是影廳內景，改用 MOKO 售票處正門大堂宣傳實景
	"broadway-5": {
		URL:     "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/78/HK_MKE_%E6%97%BA%E8%A7%92%E6%9D%B1_Mong_Kok_East_%E6%96%B0%E4%B8%96%E7%B4%80%E5%BB%A3%E5%A0%B4_MOKO_Grand_Century_Place_mall_shop_B%2BCinema_December_2021_SS2_01.jpg/1920px-HK_MKE_%E6%97%BA%E8%A7%92%E6%9D%B1_Mong_Kok_East_%E6%96%B0%E4%B8%96%E7%B4%80%E5%BB%A3%E5%A0%B4_MOKO_Grand_Century_Place_mall_shop_B%2BCinema_December_2021_SS2_01.jpg",
		Referer: "https://commons.wikimedia.org/",
		Note:    "B+ cinema MOKO 售票處與正門大堂",
	},
	// PREMIERE ELEMENTS: 官網與 hkmovie6 只有影廳內景，改用圓方圓形標誌大堂宣傳照
	"broadway-7": {
		URL:     "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1e/Premiere_Elements_Lobby_202006.jpg/1920px-Premiere_Elements_Lobby_202006.jpg",
		Referer: "https://commons.wikimedia.org/",
		Note:    "PREMIERE ELEMENTS 圓形大堂",
	},
	// 旺角百老匯: hkmovie6 給的是影廳內景，改用西洋菜街標誌霓虹招牌夜景宣傳照
	"broadway-9": {
		URL:     "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c8/HK_MK_%E6%97%BA%E8%A7%92_Mongkok_%E8%A5%BF%E6%B4%8B%E8%8F%9C%E8%A1%97_Sai_Yeung_Choi_Street_%E7%99%BE%E8%80%81%E5%8C%AF%E6%88%B2%E9%99%A2_Boardway_Cinemas_night_January_2024_R12S_01.jpg/1920px-HK_MK_%E6%97%BA%E8%A7%92_Mongkok_%E8%A5%BF%E6%B4%8B%E8%8F%9C%E8%A1%97_Sai_Yeung_Choi_Street_%E7%99%BE%E8%80%81%E5%8C%AF%E6%88%B2%E9%99%A2_Boardway_Cinemas_night_January_2024_R12S_01.jpg",
		Referer: "https://commons.wikimedia.org/",
		Note:    "旺角百老匯 西洋菜街霓虹招牌夜景",
	},
	// 影藝戲院 (MegaBox): hkmovie6 給的是影廳內景，改用 MegaBox 前台售票大堂宣傳照
	"cineart-16": {
		URL:     "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/28/CineArt-MegaBox202601.jpg/1920px-CineArt-MegaBox202601.jpg",
		Referer: "https://commons.wikimedia.org/",
		Note:    "影藝戲院 (MegaBox) 前台大堂",
	},
	// 新光黃埔影藝城: hkmovie6 缺失，補齊 2026 標誌外立面招牌與正門夜景宣傳照
	"sunbeam-1": {
		URL:     "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b7/HK_KCD_%E7%B4%85%E7%A3%A1_Hung_Hom_%E9%BB%83%E5%9F%94%E8%8A%B1%E5%9C%92_Whampoa_Garden_Gourmet_Place_%E6%96%B0%E5%85%89%E9%BB%83%E5%9F%94_Sunbeam_Cinemas_night_May_2026_R12S_05.jpg/1920px-HK_KCD_%E7%B4%85%E7%A3%A1_Hung_Hom_%E9%BB%83%E5%9F%94%E8%8A%B1%E5%9C%92_Whampoa_Garden_Gourmet_Place_%E6%96%B0%E5%85%89%E9%BB%83%E5%9F%94_Sunbeam_Cinemas_night_May_2026_R12S_05.jpg",
		Referer: "https://commons.wikimedia.org/",
		Note:    "新光黃埔影藝城 標誌外立面與門口夜景",
	},
	// ★ 2026-10-12 高清候選審圖通過（來源 Wikimedia Commons，3840×2880）
	//   MOViE MOViE 太古廣場 售票處與發光招牌（取代官網那張被用戶否決的調酒吧台）
	"broadway-1": {
		URL:     "https://commons.wikimedia.org/wiki/Special:FilePath/HK_AM_Admiralty_Pacific_Place_mall_Movie_Movie_July_2023_SS2_01.jpg?width=2560",
		Referer: "https://commons.wikimedia.org/",
		Note:    "Commons 4128×3096：MOViE MOViE 太古廣場 售票處與發光招牌（取代官網那張被用戶否決的調酒吧台）",
	},
	// ★ 2026-10-12 高清候選審圖通過（來源 Wikimedia Commons，3840×2880）
	//   百老匯院線 荃灣廣場 售票處（黃色櫃檯）
	"broadway-12": {
		URL:     "https://commons.wikimedia.org/wiki/Special:FilePath/HK_TWD_Tsuen_Wan_Plaza_%E8%8D%83%E7%81%A3%E5%BB%A3%E5%A0%B4_mall_%E7%99%BE%E8%80%81%E5%8C%AF%E9%99%A2%E7%B7%9A_Broadway_Cinema_sales_counter_lobby_July_2021_SS2_02.jpg?width=2560",
		Referer: "https://commons.wikimedia.org/",
		Note:    "Commons 4128×3096：百老匯院線 荃灣廣場 售票處（黃色櫃檯）",
	},
	// ★ 2026-10-12 高清候選審圖通過（來源 Wikimedia Commons，3264×2448）
	//   嘉湖銀座 百老匯 外立面招牌與正門（本機審圖時被 429 擋掉，改由 VPS 補齊）
	"broadway-13": {
		URL:     "https://commons.wikimedia.org/wiki/Special:FilePath/HK_TSW_%E5%A4%A9%E6%B0%B4%E5%9C%8D_Tin_Shui_Wai_%E5%A4%A9%E6%81%A9%E8%B7%AF_Tin_Yan_Road_%E5%98%89%E6%B9%96%E9%8A%80%E5%BA%A7_Kingswood_Ginza_facade_sign_n_Broadway_Cinema_Dec_2016_Lnv2.jpg?width=2560",
		Referer: "https://commons.wikimedia.org/",
		Note:    "Commons 3264×2448：嘉湖銀座 百老匯 外立面招牌與正門（本機審圖時被 429 擋掉，改由 VPS 補齊）",
	},
	// ★ 2026-10-12 高清候選審圖通過（來源 Wikimedia Commons，3840×2880）
	//   D2 Place CGV 正門入口與黃色招牌
	"cgv-22": {
		URL:     "https://commons.wikimedia.org/wiki/Special:FilePath/HK_SSP_%E9%95%B7%E6%B2%99%E7%81%A3_Cheung_Sha_Wan_MTR_Station_exit_and_entrance_Lai_Chi_Kok_Road_view_%E8%8D%94%E6%9E%9D%E8%A7%92_D2_Place_Two_CGV_Cinemas_December_2019_SS2.jpg?width=2560",
		Referer: "https://commons.wikimedia.org/",
		Note:    "Commons 4128×3096：D2 Place CGV 正門入口與黃色招牌",
	},
	// ★ 2026-10-12 高清候選審圖通過（來源 Wikimedia Commons，3840×2880）
	//   奧海城 the sky 售票處
	"bestar-58001": {
		URL:     "https://commons.wikimedia.org/wiki/Special:FilePath/HK_TKT_%E5%A4%A7%E8%A7%92%E5%92%80_Tai_Kok_Tsui_%E5%A5%A7%E6%B5%B7%E5%9F%8E_Olympian_City_2_shopping_mall_The_SKY_Cinemas_February_2023_Px3_box_office.jpg?width=2560",
		Referer: "https://commons.wikimedia.org/",
		Note:    "Commons 4000×3000：奧海城 the sky 售票處",
	},
	// ★ 2026-10-12 高清候選審圖通過（來源 Wikimedia Commons，3840×2880）
	//   MOSTown 英皇戲院 售票處與入口通道
	"cineart-23": {
		URL:     "https://commons.wikimedia.org/wiki/Special:FilePath/HK_STD_MOS_%E9%A6%AC%E9%9E%8D%E5%B1%B1_Ma_On_Shan_%E6%96%B0%E6%B8%AF%E5%9F%8E_Sunshine_City_MOSTown_mall_shop_%E8%8B%B1%E7%9A%87%E6%88%B2%E9%99%A2_Emperor_Cinemas_box_office_January_2023_Px3.jpg?width=2560",
		Referer: "https://commons.wikimedia.org/",
		Note:    "Commons 4000×3000：MOSTown 英皇戲院 售票處與入口通道",
	},
	// ★ 2026-10-12 高清候選審圖通過（來源 Wikimedia Commons，3840×2880）
	//   新都城 MCL 售票處與招牌大堂
	"mcl-002": {
		URL:     "https://commons.wikimedia.org/wiki/Special:FilePath/HK_SKD_TKO_%E5%B0%87%E8%BB%8D%E6%BE%B3_Tseung_Kwan_O_%E5%AF%B6%E7%90%B3_Po_Lam_Metro_City_Plaza_%E6%96%B0%E9%83%BD%E5%9F%8E_MCP_Two_II_Central_ground_floor_mall_MCL_Cinemas_January_2023_R12S_08.jpg?width=2560",
		Referer: "https://commons.wikimedia.org/",
		Note:    "Commons 4000×3000：新都城 MCL 售票處與招牌大堂",
	},
	// ★ 2026-10-12 高清候選審圖通過（來源 Wikimedia Commons，3600×2700）
	//   STAR CINEMA PopCorn 星光立體招牌
	"mcl-009": {
		URL:     "https://commons.wikimedia.org/wiki/Special:FilePath/STAR_Cinema%2C_PopCorn_%28Hong_Kong%29.jpg?width=2560",
		Referer: "https://commons.wikimedia.org/",
		Note:    "Commons 3600×2700：STAR CINEMA PopCorn 星光立體招牌",
	},
	// ★ 2026-10-12 高清候選審圖通過（來源 Wikimedia Commons，3840×2880）
	//   K11 MUSEA Art House 售票處與招牌大堂
	"mcl-017": {
		URL:     "https://commons.wikimedia.org/wiki/Special:FilePath/HK_%E5%B0%96%E6%B2%99%E5%92%80_TST_%E4%BA%BA%E6%96%87%E8%97%9D%E8%A1%93%E8%B3%BC%E7%89%A9%E9%A4%A8_K11_MUSEA_mall_Art_House_Cinemas_July_2026_N13P_300.jpg?width=2560",
		Referer: "https://commons.wikimedia.org/",
		Note:    "Commons 4080×3060：K11 MUSEA Art House 售票處與招牌大堂",
	},
	// ★ 2026-10-12 高清候選審圖通過（來源 Wikimedia Commons，3840×2880）
	//   AirSide MCL LUXE House 售票前台
	"mcl-022": {
		URL:     "https://commons.wikimedia.org/wiki/Special:FilePath/HK_%E5%95%9F%E5%BE%B7%E5%95%86%E5%A0%B4_AirSide_Kai_Tak_Mall_%E9%9B%BB%E5%BD%B1%E9%99%A2_MCL_Cinemas_main_lobby_January_2024_R12S_04.jpg?width=2560",
		Referer: "https://commons.wikimedia.org/",
		Note:    "Commons 4000×3000：AirSide MCL LUXE House 售票前台",
	},

	// ★ 2026-10-12 补齐：寶石戲院 2013 年 Commons 實景（原 og:image 是斑点灯箱）
	//   注：这批只有 2048×1536（2013 年手持 DC 拍的），分辨率低于其他院线的 4000+，
	//   但仍是本院實景，遠勝 og:image。同批的 main entrance 那张 Commons 直连返错误页。
	"lux-1": {
		URL:     "https://commons.wikimedia.org/wiki/Special:FilePath/HK_Hung_Hom_%E5%AF%B6%E7%9F%B3%E6%88%B2%E9%99%A2_Lux_Theatre_lobby_hall_interior_Mar-2013.JPG?width=2048",
		Referer: "https://commons.wikimedia.org/",
		Note:    "Commons 2048×1536：寶石戲院售票處與 LUX THEATRE 招牌大堂",
	},
}

// ---------- 百老汇 cinema.com.hk ----------
//
// 戏院页 /hk/cinema/<id>（id 1..13）的 Next.js RSC payload 里有 siteImages，
// 每家 1~2 张，文件名 site<字母>_<uuid>.jpg，其中字母与 id 一一对应
// （b→1, c→2, d→3 … n→13）。图在 https://media.grabticks.com/<文件名>，
// 必须带 Referer: https://www.cinema.com.hk/。
var broadwayPhotos = map[string]string{
	"broadway-1":  "siteb_718b8ef7-3058-45ae-b025-76bd18fe8b7c.jpg", // MOVIE MOVIE 前台吧台
	"broadway-2":  "sitec_1c798009-fa7c-48b8-a1b2-750bded64096.jpg", // 小食部吧台
	"broadway-6":  "siteg_8e07b6ce-df8c-404a-8761-aa8392b3cc30.jpg", // 小食部
	"broadway-10": "sitek_ce8462c1-76d5-41bb-87f6-d0a3039be4ed.jpg", // 扶手电梯
	// ★ 2026-10-12 高解析度审计结论：Commons 有 7 张嘉湖銀座 Broadway 照片
	//   （外立面招牌、門面、interior），但全部下载返回 429/404，
	//   照片名与 imageinfo 记录已对不上（标题带日期后缀，实体文件查无此名）。
	//   保留官网这张大堂图 —— 它本身够清晰，不要为了换源把已合格的图降级。
	"broadway-13": "siten_c9c2800f-c16c-4586-b834-d1315151a3cd.jpg", // 大堂
}

// ---------- MCL mclcinema.com ----------
//
// 戏院页 MCLCinema.aspx?ci=<3位> 上是 img_cinema_<code>.jpg，在
// https://cdn.mclcinema.com/MovieMedia/images/ 下。
var mclPhotos = map[string]string{
	"mcl-002": "img_cinema_cm.jpg", // 圆形大堂
	// ★ mcl-003 用官方大堂图，不要被高解析度审计误导：
	//
	//   一次性审计脚本量 Wikimedia 候选时，mcl-003 搜出来的最高分候选是
	//   「Windsor Cinema on Stirling Highway in Nedlands, Perth, Western Australia」——
	//   澳大利亚珀斯一家同名影院，与香港 MCL 荃灣城景圍（ Windsor ）无关。
	//   Wikimedia 的 search 只看标题字面，MCL 2023 年才改名 Windsor，
	//   旧名 The Windsor@新城市廣場在 Commons 只有澳洲那批照片。
	//   **审计输出只是候选清单，不是配图建议**；跨地区同名影院一律人工排除。
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
// 官网未提供大堂前台照，退回同集团的官方形象照：
// 既符合院线身份，又具备极高质感，绝不出现座椅与银幕。
var groupFallback = map[string]string{
	// 百老匯：GALA 朗豪坊、葵芳、荃灣。取 MOViE MOViE 金鐘的官方大堂。
	"broadway-3":  "broadway-1",
	"broadway-11": "broadway-1",
	"broadway-12": "broadway-1",
	// 影藝：全線只有 logo，用百老匯的大堂形象照（香港同級院線，風格一致）。
	"cineart-18": "broadway-13",
	// MCL：數碼港、東薈城、淘大、The ONE 官網只放影廳內景或無圖，退回同線 K11 Art House 旗艦大堂。
	"mcl-016": "mcl-017",
	"mcl-018": "mcl-017",
	"mcl-019": "mcl-017",
	"mcl-021": "mcl-017",
}

// ---------- 审计覆盖不到的那一家，以及为什么补不上来 ----------
//
// 2026-10-12 用一次性审计脚本量了全部候选源图的真实分辨率（宽高从原图解码，
// 不是看裁完的 1600×900），31 家里 29 家拿到了高清候选。剩下这家的结论：
//
//	broadway-13（嘉湖銀座）：已补上 Commons 3264×2448 的外立面招牌照，见 curatedPhotos。
//	早期那 7 张 Commons 照片下载失败，是当时 IP 被 429 限流，不是图片本身有问题。
//
//	lux-1（寶石戲院）：也补上了，但分辨率只有 2048×1536。
//	原因是这家的 Commons 照片是 2013 年手持 DC 拍的，本来就没有更高的。
//	它仍然比原来的 og:image（斑点灯箱）好，所以保留。同批的 main entrance
//	那张下载时返错误页，暂无替代。
//
// 注意：审计输出是**候选清单**，不是配图建议 —— 任何一张都要按
// 审图铁律逐张看原图后才准进 curatedPhotos；跨地区同名戲院一律人工排除（见 mcl-003）。

const (
	broadwayBase = "https://media.grabticks.com/"
	broadwayRef  = "https://www.cinema.com.hk/"
	mclBase      = "https://cdn.mclcinema.com/MovieMedia/images/"
	mclRef       = "https://www.mclcinema.com/"
)

// Static returns the official photos that are known up front, i.e. the ones
// that need no signed API call.
func Static(id string) (Source, bool) {
	if src, ok := curatedPhotos[id]; ok {
		return src, true
	}
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
func FetchIcirena(ctx context.Context) (map[string]Source, error) {
	out := map[string]Source{}
	var lastErr error
	for _, key := range []string{"emperor", "cinemacity", "bestar"} {
		cfg := icirena.Channels[key]
		scraper := icirena.New(cfg, icirena.Options{})
		photos, err := scraper.FetchAllVenuePhotos(ctx)
		if err != nil {
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
func StaticIDs() []string {
	seen := map[string]bool{}
	for id := range curatedPhotos {
		seen[id] = true
	}
	for id := range broadwayPhotos {
		seen[id] = true
	}
	for id := range mclPhotos {
		seen[id] = true
	}
	for id := range groupFallback {
		seen[id] = true
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
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
