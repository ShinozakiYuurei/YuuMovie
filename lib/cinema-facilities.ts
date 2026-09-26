/**
 * 院方明示的固定設備／特色影廳（2026-09-26 核對）。
 *
 * 場次只能證明「最近有放」，不能代表影院全部設備。此表以穩定影院 ID
 * 補齊規格，保留官方來源和適用影廳；不代表每個影廳／每場電影都有同樣規格。
 * 未取得可靠資料的影院不硬加標籤，更不能把 4K 修復片源當作放映機規格。
 */
export interface CinemaFacilitySource {
  label: string;
  url: string;
}

export interface CinemaFacilities {
  specs: string[];
  /** 精確到影廳的官方配置摘要；無明示廳號時不自行補號。 */
  details: string[];
  sources: CinemaFacilitySource[];
  verifiedOn: string;
}

const VERIFIED_ON = '2026-09-26';

function official(
  specs: string[], details: string[], label: string, url: string
): CinemaFacilities {
  return { specs, details, sources: [{ label, url }], verifiedOn: VERIFIED_ON };
}

function emperor(specs: string[], details: string[]): CinemaFacilities {
  return official(specs, details, '英皇官方固定影廳資料', 'https://www.emperorcinemas.com/cinema/list');
}

function cinemaCity(specs: string[], details: string[]): CinemaFacilities {
  return official(specs, details, 'Cinema City 官方固定影廳資料', 'https://www.cinemacity.com.hk');
}

function bestar(specs: string[], details: string[]): CinemaFacilities {
  return official(specs, details, '星達官方固定影廳資料', 'https://www.bestarfilm.hk');
}

function mcl(id: string, specs: string[], details: string[]): CinemaFacilities {
  return {
    specs, details, verifiedOn: VERIFIED_ON,
    sources: [
      { label: 'MCL 官方影院資料', url: `https://www.mclcinema.com/MCLCinema.aspx?ci=${id}` },
      { label: 'MCL 官方固定影廳表', url: `https://www.mclcinema.com/MCLWebAPI2/GetCinemaDetails.aspx?l=1&ci=${id}&r=etmfrp` },
    ],
  };
}

function cineart(specs: string[], details: string[]): CinemaFacilities {
  return official(specs, details, '影藝官方固定影廳資料', 'https://cinearthouse.com.hk/hk');
}

function broadway(id: number, specs: string[], details: string[]): CinemaFacilities {
  return {
    specs,
    details,
    sources: [{ label: '百老匯官方影院／影廳資料', url: `https://www.cinema.com.hk/hk/cinema/${id}` }],
    verifiedOn: VERIFIED_ON,
  };
}

export const CINEMA_FACILITIES: Record<string, CinemaFacilities> = {
  'broadway-1': broadway(1, ['usl8', 'auromax', 'mmplus', 'ovaloffice'], [
    'MM Plus：AuroMax 3D 音響；The Oval Office 及 H2–H5：USL 8 Channels。',
  ]),
  'broadway-2': broadway(2, ['atmos', 'usl8', 'auromax', 'moviemaxx', 'mmmoments'], [
    'H1、H5：Dolby Atmos；MOViEMAXX：AuroMax 3D；H2–H4 及 MM MOMENTS：USL 8 Channels。',
  ]),
  'broadway-3': broadway(3, ['atmos', '4dx', 'cinity', 'dolby71'], [
    '設 4DX 影廳；官方影院介紹明示 CINITY LED 配 Dolby Atmos。影廳表另列 H3 為 Dolby Atmos、其餘影廳 Dolby 7.1。',
    'CINITY LED 的廳號在本次官方介紹中未明示，不沿用觀眾指南的廳號推定。',
  ]),
  'broadway-4': broadway(4, ['dtsx', 'dolby71'], [
    'H5：DTS:X；H1–H4：Dolby 7.1。',
  ]),
  'broadway-5': broadway(5, ['imax', 'atmos', 'dolby71'], [
    'IMAX 影廳：IMAX 5.1；H4：Dolby Atmos；H1–H3：Dolby 7.1。',
  ]),
  'broadway-6': broadway(6, ['atmos', '4dx', 'usl8', 'realdcinema'], [
    'RealD Cinema：Dolby Atmos；另設 4DX 影廳；H1、H3–H5 及 4DX 廳：USL 8 Channels。',
    'RealD Cinema 是品牌影廳，不等同於每一場均為 RealD 3D 放映。',
  ]),
  'broadway-7': broadway(7, ['atmos', 'thx', 'dolby71', 'vip'], [
    'THX 廳、H6、H7：Dolby Atmos；H5 為 VIP 影廳；其餘影廳 Dolby 7.1。',
  ]),
  'broadway-8': broadway(8, ['sr', 'srd'], [
    'H1：SR；H2–H4：SRD。',
  ]),
  'broadway-9': broadway(9, ['usl8'], [
    'H1–H5：USL 8 Channels；本次官方影廳表未列品牌特色廳。',
  ]),
  'broadway-10': broadway(10, ['imax', 'dtsx', 'usl8'], [
    'IMAX 影廳：IMAX 5.1；H3：DTS:X；H2、H4–H8：USL 8 Channels。',
  ]),
  'broadway-11': broadway(11, ['usl8'], [
    'H1–H5：USL 8 Channels；本次官方影廳表未列品牌特色廳。',
  ]),
  'broadway-12': broadway(12, ['usl8'], [
    'H1–H4：USL 8 Channels；本次官方影廳表未列品牌特色廳。',
  ]),
  'broadway-13': broadway(13, ['usl8'], [
    'H1–H4：USL 8 Channels；本次官方影廳表未列品牌特色廳。',
  ]),

  'emperor-57002': emperor(['atmos', '3d'], [
    'House 3、House 5：Dolby Atmos；官方固定配置另列 House 1、2、5 支援 3D。',
  ]),
  'emperor-57003': emperor(['coronet', '3d'], [
    'the CORONET：12 座貴賓廳；House 1、2、4 及 the CORONET 支援 3D。',
  ]),
  'emperor-57004': emperor(['3d'], [
    '官方固定配置列 4 個普通影廳，House 2 支援 3D；本次未確認其他高階放映／音響規格。',
  ]),
  'emperor-57005': emperor(['imax', 'coronet', '3d'], [
    'House 5：IMAX；the CORONET：16 座貴賓廳；House 1 固定配置列 48 幀支援。',
    'House 1、2 及 the CORONET 支援 3D，IMAX 廳支援 IMAX 3D；此配置表未列激光規格。',
  ]),
  'emperor-57006': emperor(['atmos', '3d'], [
    'House 1：Dolby Atmos，支援 Atmos 2D／3D；其他影廳規格不可由此擴展推定。',
  ]),
  'emperor-57007': emperor(['atmos', '3d'], [
    'House 1：Dolby Atmos，支援 Atmos 2D／3D；House 2 另列 3D 支援。',
  ]),
  'emperor-57008': emperor(['3d'], [
    '官方固定配置列 6 個普通影廳，House 1、3、4、6 支援 3D；本次未確認 Dolby Vision 或其他高階設備。',
    'Plus+ 為分店品牌，並非單一特色影廳。',
  ]),
  'emperor-57010': emperor(['3d'], [
    '官方固定配置列 4 個普通影廳，House 2–4 支援 3D；本次未確認其他高階放映／音響規格。',
  ]),
  'emperor-57011': emperor(['imax', 'atmos', 'mx4d', 'coronet', '3d'], [
    'House 1：MX4D；House 6：Dolby Atmos；House 7：IMAX；各特殊格式以指定場次為準。',
    '另設 the CORONET Ⅰ（30 座）及 the CORONET Ⅱ（18 座）貴賓廳；官方固定配置亦列 3D 支援。',
  ]),

  'cinemacity-55001': cinemaCity(['3d'], [
    '官方固定配置列 1–5 院，均支援 2D／3D；本次未確認高階音響規格或品牌特色廳。',
  ]),
  'cinemacity-55002': cinemaCity(['3d', 'kidshouse'], [
    '5 院別名為「兒童影院」（96 座）；1–5 院均列 2D／3D 支援。',
  ]),

  'bestar-58001': bestar(['atmos', 'dbox', 'vivo', '3d'], [
    '1–6 院及 Vivo：Dolby Atmos；1 院、5 院及 Vivo 設 D-BOX 售票配置，支援 2D／3D。',
    'Vivo 為 69 座尊尚影院；同一影廳的普通／D-BOX 模式會重複列於官方表，不能視為額外影廳。',
  ]),
  'bestar-58002': bestar(['atmos', 'dbox', '3d'], [
    '1–4 院：Dolby Atmos；2 院設 D-BOX 配置；官方亦列 2D／3D 支援。',
  ]),
  'bestar-58003': bestar(['dbox', 'dolby71', '3d'], [
    '1、3、4 院：Dolby 7.1；4 院設 D-BOX 配置；1–4 院支援 2D／3D。',
    '2 院音響欄未明示，不能將 Dolby 7.1 擴展為全院配置。',
  ]),

  'mcl-017': mcl('017', ['imax', 'whitebox', 'blackbox'], [
    '12 院：IMAX（368 座）；4 院：White Box（117 座）；11 院：Black Box（30 座）。',
    '只按固定影廳表補齊；院線共用的 IMAX 激光眼鏡提示不作設備證據。',
  ]),
  'mcl-014': mcl('014', ['mx4d', 'onyx', 'realdcinema', 'housefx'], [
    '1、4 院：House FX；2 院：RealD Cinema；5 院：Onyx Cinema LED；7 院：MX4D 動感影院。',
    'RealD Cinema 是品牌影廳，不等同於每場均為 RealD 3D。',
  ]),
  'mcl-012': mcl('012', ['festivalsuite'], [
    '8 院：Festival Suite（18 座）；其餘 1–7 院為普通命名，固定表未明示音響／放映機規格。',
  ]),
  'mcl-022': mcl('022', ['luxe'], [
    '1 院：LUXE（305 座），另設 2–7 院；固定表未明示放映機及音響型號。',
  ]),
  'mcl-016': mcl('016', ['luxe', 'housefx', 'familyhouse'], [
    '1 院：LUXE；2 院：Family House；3、4 院在官方固定表分別名為 House FX 2、House FX 3。',
  ]),
  'mcl-005': mcl('005', ['housefx'], [
    '2、3 院：House FX；另設 1、4–6 院；固定表未明示音響／放映機型號。',
  ]),
  // 以下 6 間官方固定表的廳名全是「N院」這類通用名（MCL 有品牌廳時會寫進廳名，
  // 如「IMAX/12院」「LUXE」「Onyx Cinema LED」），且官方「設施」表只有
  // 影院 / 座位數目 / 輪椅座位三欄（見 custom-mcl-cinema-common.js 的 Facilities 渲染）。
  // 2026-09-26 逐節點驗證 API 的 r 參數（t=票價 m=地圖 f=影廳表 r=提醒 p=推廣）
  // 亦無設備字段，官網 .aspx 頁當日被 Queue-it 等候室擋住。故無可引用的設備原文。
  'mcl-021': mcl('021', [], [
    '官方固定表列 1–6 院，廳名無品牌標示；官方「設施」表只列影院／座位數目／輪椅座位，未列音響與放映機。',
    '未取得足以確認設備的院方資料，不等同於沒有相關設備。',
  ]),
  'mcl-003': mcl('003', ['standard'], [
    '官方固定表列 1–3 院，廳名無品牌標示；官方「設施」表只列影院／座位數目／輪椅座位，未列音響與放映機。',
    '未取得足以確認設備的院方資料，不等同於沒有相關設備。',
  ]),
  'mcl-009': mcl('009', ['standard'], [
    '官方固定表列 1–6 院，廳名無品牌標示；官方「設施」表只列影院／座位數目／輪椅座位，未列音響與放映機。',
    '未取得足以確認設備的院方資料，不等同於沒有相關設備。',
  ]),
  'mcl-002': mcl('002', [], [
    '官方固定表列 1–6 院，廳名無品牌標示；官方「設施」表只列影院／座位數目／輪椅座位，未列音響與放映機。',
    '未取得足以確認設備的院方資料，不等同於沒有相關設備。',
  ]),
  'mcl-013': mcl('013', [], [
    '官方固定表列 1–3 院，廳名無品牌標示；官方「設施」表只列影院／座位數目／輪椅座位，未列音響與放映機。',
    '未取得足以確認設備的院方資料，不等同於沒有相關設備。',
  ]),
  'mcl-015': mcl('015', ['standard'], [
    '官方固定表列 1–4 院，廳名無品牌標示；官方「設施」表只列影院／座位數目／輪椅座位，未列音響與放映機。',
    '未取得足以確認設備的院方資料，不等同於沒有相關設備。',
  ]),
  'mcl-018': mcl('018', [], [
    '官方固定表列 1–4 院；本次未取得足以確認音響／放映機規格的官方資料。',
  ]),
  'mcl-019': mcl('019', [], [
    '官方固定表列 1–3 院；本次未取得足以確認音響／放映機規格的官方資料。',
  ]),

  'cgv-22': official(['screenx', 'kstar', 'sweetbox'], [
    'House 2：K Star；House 3：SWEETBOX；House 4：Screen X；House 1 為普通命名。',
  ], 'CGV 官方固定影廳資料', 'https://cgv.com.hk/zh'),
  'cineart-16': cineart(['imax', 'vip'], [
    '7 院：IMAX；另設 VIP House。固定表未明示 IMAX 激光，不以品牌名稱推定放映機。',
  ]),
  // 「普通影廳」的判據見 lib/cinema-specs.ts 的 standard 規則：官方固定表只列編號廳，
  // 且完全沒有公佈放映／音響規格。用戶 2026-09-26 指定把這幾間補上。
  'cineart-19': cineart(['standard'], [
    '荷里活分店官方固定表列 1–6 院；官方網站該分店的介紹欄仍是佔位文字（未填寫），本次未取得設備說明。',
  ]),
  // 官網（cinearthouse.com.hk）該分店介紹原文：「影藝戲院 - 青衣城，設六間影廳，
  // 提供670多個座位。戲院選用鐳射光學放映科技(4K及2K) ，配備杜比7.1及
  // ATMOS全景聲音效設備，為您提供極致聲畫觀賞體驗。」
  'cineart-17': cineart(['4k', 'laser', 'dolby71', 'atmos'], [
    '官方影院介紹：設六間影廳、670 多個座位，選用鐳射光學放映科技（4K 及 2K），配備杜比 7.1 及 ATMOS 全景聲音效設備。',
    '介紹未逐廳限定，4K 與 2K 放映機並存，不代表每廳均為 4K。',
  ]),
  'cineart-18': cineart([], [
    '銅鑼灣 JP 分店官方固定表列 1–2 院；本次未確認其他設備規格或品牌特色廳。',
  ]),
  'cineart-23': cineart(['standard'], [
    '新港城分店官方固定表列 1–4 院；官方網站該分店的介紹欄仍是佔位文字（未填寫），本次未取得設備說明。',
  ]),
  'goldenscene-1': official(['laser', 'dolby71', '3d'], [
    '官方影院設備頁列 NEC 雷射投影機、Dolby 7.1 環迴立體聲；1、4 院設 3D 播放設備。',
    '放映機解像度未明示，不能從激光投影推定 4K。',
  ], '高先官方影院設備', 'https://goldenscene.com/cinema'),
  'lumen-1001': official(['vip'], [
    '官方影院介紹明示 VIP 尊貴影廳及多間迷你影廳，但未列 VIP 廳號。',
    '售票頁的通用 Dolby Atmos 圖例不作固定設備證據。',
  ], 'Lumen 官方影院介紹', 'https://www.lumencinema.com.hk/Browsing/Cinemas/Details/1001'),
  'newport-hyland': official(['srdex', 'masterimage', '3d'], [
    '1–3 院：SRD-EX 音響；官方另明示 MasterImage 3D 放映設備，未逐院限定。',
  ], '新寶官方凱都影院設備', 'https://www.theatre.com.hk/en/cinema/hyland_theatre?page=cinemaSchedule'),
  'sunbeam-1': official(['4k', 'laser', 'dolby71'], [
    '官方設備頁列 NEC 4K Laser Projector、Dolby Surround 7.1 及 JBL Cinema Grade Speakers；未逐院限定。',
  ], '新光黃埔官方設備', 'https://www.sunbeamwhampoa.com/facilities'),
  'chinachem-plnym': official(['standard'], [
    '官方介紹確認 4 個影廳、共 1,026 座，僅籠統描述數碼影院設備；未明示 4K、激光或 Atmos 等規格。',
    '官網全部頁面（關於我們／戲院包廂／常見問題／條款等）均無設備規格頁。',
    '場次資料顯示廳名為 HOUSE 1–4，均為編號廳。',
  ], '華懋官方影院介紹', 'https://www.cel-cinemas.com/en/info/cinema'),
  // 全站唯一既無官方網站、也不在所屬院線官網列表裡的戲院：
  // 新寶院線官網（theatre.com.hk）的戲院列表只有凱都戲院，未列此影院。
  'lux-1': {
    specs: ['standard'],
    details: [
      '單一影廳（House 1）；寶石戲院不設官方網站，新寶院線官網的戲院列表亦未收錄此影院。',
      '本次未取得足以確認放映／音響規格的院方資料，不等同於沒有相關設備。',
    ],
    sources: [{ label: '新寶院線官方網站', url: 'https://www.theatre.com.hk/tc/cinema' }],
    verifiedOn: VERIFIED_ON,
  },
};

/** 官方固定規格，與當期場次完全無關。回傳副本，避免呼叫方修改配置表。 */
export function fixedCinemaSpecs(cinemaId: string): string[] {
  return [...(CINEMA_FACILITIES[cinemaId]?.specs ?? [])];
}

/**
 * 第三方《觀眾指南》整理的設備摘要 → 規格 key。
 *
 * ★ 與 CINEMA_FACILITIES.specs 是**兩層**，不可混為一談：
 *     CINEMA_FACILITIES.specs  院方明示（官網／官方 API），可作事實引用
 *     GUIDE_SPECS              第三方觀眾指南整理，**非院方公布**，UI 必須標明來源
 *
 * ===== 為什麼要這一層（2026-09-26 用戶指定）=====
 *
 * 這些戲院的放映／音響規格院方根本不公布：MCL 官方「設施」表只有
 * 影院／座位數目／輪椅座位三欄；影藝、華懋官網沒有設備欄。
 * 只採院方明示的話，用戶篩「4K」看不到這些戲院 —— 跟
 * 「篩 IMAX 看不到 K11」是同一類靜默失效（頁面照樣 200，只是清單少幾家）。
 *
 * 用戶明確要求放寬「只採院方明示」的規則。卡片上這一層與官方規格用同一種
 * 標籤（用戶 2026-09-26 指定，不要虛線或註記）；來源追蹤放在詳情頁
 * 另開的「觀眾指南整理的規格」一節（見 CinemaGuideDialog）。
 *
 * 每條都必須能在 CINEMA_GUIDES 的文字裡找到對應依據；
 * probe/check-cinema-specs.mts 逐條回查，防止這一層偏離指南原文。
 */
export const GUIDE_SPECS: Record<string, string[]> = {
  // 英皇：官方固定表只給廳型（Atmos／IMAX／CORONET），放映機與音響靠指南補。
  'emperor-57002': ['4k'],
  'emperor-57003': ['dolby71'],
  'emperor-57004': ['4k', 'dolby71'],
  'emperor-57005': ['4k', 'laser', 'dolby71'],
  'emperor-57006': ['4k', 'laser'],
  'emperor-57007': ['4k', 'laser', 'dolby71'],
  'emperor-57008': ['4k', 'laser', 'dolby71'],
  // 屯門新都：指南明寫「並非全激光」，故只取 4K，不取激光。
  'emperor-57010': ['4k'],
  'emperor-57011': ['4k', 'laser'],

  // 百老匯：官方固定表只有廳型，放映機／音響由指南補。
  'broadway-1': ['4k', 'laser'],
  'broadway-2': ['4k', 'laser'],
  'broadway-6': ['4k', 'laser'],
  'broadway-7': ['cgs', '4k', 'laser'],
  'broadway-10': ['4k', 'laser'],

  // Cinema City
  'cinemacity-55001': ['dolby71'],
  'cinemacity-55002': ['4k', 'dolby71'],

  // MCL：官方「設施」表只有影院／座位數／輪椅座位，設備全靠指南。
  'mcl-002': ['4k', 'laser', 'dolby71'],
  'mcl-005': ['4k', 'mx4d', 'atmos'],
  'mcl-012': ['dolby71'],
  'mcl-013': ['dolby71'],
  'mcl-014': ['4k', 'laser', 'atmos'],
  'mcl-016': ['4k', 'laser', 'atmos'],
  'mcl-017': ['4k', 'laser', 'atmos', 'dolby71'],
  'mcl-018': ['4k', 'laser', 'atmos', 'dolby71'],
  'mcl-021': ['4k', 'laser', 'dolby71'],
  'mcl-022': ['laser', 'atmos', 'dolby71'],
};

/** 觀眾指南整理的規格（非院方公布）。回傳副本。 */
export function guideCinemaSpecs(cinemaId: string): string[] {
  return [...(GUIDE_SPECS[cinemaId] ?? [])];
}
