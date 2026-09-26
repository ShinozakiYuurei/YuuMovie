/**
 * 戲院經緯度（地圖用）
 *
 * ===== 為什麼單獨一個純模塊 =====
 *
 * 與 lib/booking-fee.ts 同一套理由：地圖彈層是**客戶端組件**，
 * 而 lib/data.ts 依賴 node:fs（只能在構建時跑）。座標是靜態常量，
 * 放這裡兩端都能安全引入，不必把 node 模組拖進瀏覽器包。
 *
 * ===== 座標來源與驗證 =====
 *
 * hkmovie6.com/cinema 的 lat/lon 作為候選值；Google Maps URL 裡的
 * `@lat,lng` 只是視口中心，不能當成戲院座標，只有 `!3d!4d` 才是標記點。
 * 院線官方分店地址是地址基準，再用 OSM 戲院 POI／商場建物範圍交叉核對；
 * 若官方地圖連結本身指到相鄰店舖或舊商場，也不照抄錯點。
 *
 * 本輪複核現有 39 間營業戲院座標，發現並修正百老匯太古城、
 * PALACE ifc、圓方、電影中心、葵芳及 Cinema City 愉景新城等偏移點；
 * 詳見下方 CINEMA_COORD_FIXES。其餘新增院線位置均落在官方地址所指建築／
 * 戲院附近。`cineart-17` 使用 OSM node 3906386531「影藝戲院 Cine-Art House」
 * （amenity=cinema），座標 22.3601423,114.1067897；HK Movie 6 的
 * 22.3600746,114.0720739 與青衣城 2 不符，沒有採用。
 *
 * ===== 已知未顯示資料 =====
 *
 *   `mcl-*` 的 14 個座標目前在 data/cinemas.json 沒有對應戲院，保留以便
 *   MCL 恢復資料時沿用；它們不會出現在目前網站。
 *   emperor-57001「英皇戲院總部」— 這是**辦公地址**（灣仔軒尼詩道288號20樓），
 *   不放映、無場次，故不提供座標；詳情頁與列表頁都不會出現地圖按鈕。
 */
export const CINEMA_COORD: Record<string, [number, number]> = {
  // ---------- hkmovie6.com（OSM 数据） ----------
  'bestar-58001': [22.315687, 114.161959],
  'bestar-58002': [22.3926215131165, 113.976661562701],
  'bestar-58003': [22.453624910937293, 114.17084382432176],
  'broadway-1': [22.277593, 114.166175],
  'broadway-11': [22.357642, 114.126559],
  'broadway-12': [22.3711884, 114.1112548],
  'broadway-2': [22.285597, 114.2171998],
  'broadway-3': [22.3182116, 114.1686743],
  'broadway-4': [22.2856857, 114.1581464],
  'broadway-6': [22.3122535, 114.2251183],
  'broadway-8': [22.310646, 114.168979],
  'cinemacity-55001': [22.263645, 114.238648],
  'cinemacity-55002': [22.376111, 114.111882],
  'cgv-22': [22.3360617, 114.1474753],
  'lumen-1001': [22.3657, 114.1364],
  'emperor-57002': [22.278166497723056, 114.18211762144921],
  'emperor-57003': [22.281543, 114.156444],
  'emperor-57004': [22.247647263575328, 114.16755115355402],
  'emperor-57005': [22.297253, 114.171896],
  'emperor-57006': [22.37372866390155, 114.18053136774547],
  'emperor-57007': [22.368033, 114.114758],
  'emperor-57008': [22.295116, 114.269789],
  'emperor-57010': [22.39094, 113.978537],
  'emperor-57011': [22.1405689, 113.5722182],
  'mcl-002': [22.3230497619697, 114.257580935846],
  'mcl-003': [22.2804764, 114.1865675],
  'mcl-005': [22.3238983284897, 114.211817085634],
  'mcl-009': [22.306996, 114.258641],
  'mcl-012': [22.337284, 114.1744214],
  'mcl-013': [22.5009119, 114.1435079],
  'mcl-015': [22.3389394, 114.1517483],
  'mcl-016': [22.2609187, 114.1297366],
  'mcl-017': [22.2942603, 114.174395],
  'mcl-018': [22.28976724752287, 113.94079104060437],
  'mcl-019': [22.3241165, 114.2145451],
  'mcl-022': [22.331776711529237, 114.19810689668614],

  // ---------- 新增院線（按戲院名稱與地址對照；青衣城採 OSM 戲院 POI） ----------
  'chinachem-plnym': [22.3981941135014, 113.974680751508],
  'cineart-16': [22.3195328701767, 114.208554625293],
  'cineart-17': [22.3601423, 114.1067897],
  'cineart-18': [22.28104, 114.185853],
  'cineart-19': [22.3405130645424, 114.202126711552],
  'cineart-23': [22.4241203, 114.2309567],
  'goldenscene-1': [22.283542701124716, 114.12932739765016],
  'lux-1': [22.3061096, 114.1862591],
  'newport-hyland': [22.3984470587792, 113.975807279294],
  'sunbeam-1': [22.304797078068, 114.19060165661732],

  // ---------- 人工修正（见下方 WHY 表） ----------
  'broadway-10': [22.445241, 114.036971],
  'broadway-13': [22.4570656, 114.0041335],
  'broadway-5': [22.3233392, 114.1723261],
  'broadway-7': [22.3031638, 114.1626641],
  'broadway-9': [22.31696, 114.170653],
  'mcl-014': [22.381136, 114.188373],
  'mcl-021': [22.29986, 114.172688],
};

/**
 * 座標修正原因
 *
 * `from` 記錄原始或此前錯誤值，`to` 是目前採用值。保留原因方便複查：
 * 座標錯了不會報錯，只會把用戶導到隔壁街，是最難發現的一類 bug。
 */
export const CINEMA_COORD_FIXES: Record<string, { from: [number, number]; to: [number, number]; why: string }> = {
  'bestar-58001': {
    from: [22.315295, 114.162074],
    to: [22.315687, 114.161959],
    why: '原點距奧海城戲院約45m；新值取 OSM amenity=cinema「the sky (奧海城)」POI，與星達官方分店地址相符',
  },
  'broadway-1': {
    from: [22.2776729735249, 114.16556552047],
    to: [22.277593, 114.166175],
    why: '原點落在太古廣場內的 Armani Exchange；新值取 OSM amenity=cinema「MOViE MOViE Pacific Place」POI，符合百老匯官方 88 Queensway 地址',
  },
  'broadway-2': {
    from: [22.285597, 114.2150058],
    to: [22.285597, 114.2171998],
    why: '原點是官方 Google Maps URL 的視口中心，反查落在 Mercedes-Benz；新值採官方百老匯地圖 !3d!4d 標記點，亦與 OSM 戲院 POI 相符',
  },
  'broadway-4': {
    from: [22.2851404, 114.1572794],
    to: [22.2856857, 114.1581464],
    why: '原點反查落在 IFC 港鐵入口；新值取 OSM amenity=cinema「Broadway Circuit」POI，符合官方 8 Finance Street IFC Mall 地址',
  },
  'broadway-6': {
    from: [22.3123504338574, 114.225464165102],
    to: [22.3122535, 114.2251183],
    why: '原點落在 apm 的 Apple Store；新值採百老匯官方 B+ cinema (apm) 地圖 !3d!4d 標記點',
  },
  'broadway-13': {
    from: [22.4519484, 113.9826573],
    to: [22.4570656, 114.0041335],
    why: '原值偏 2.3km，反查落在「D1, 新圍」（元朗一處無關地點）；新值為 +WOO嘉湖（天恩路 12;18 號，與地址吻合）',
  },
  'mcl-021': {
    from: [22.2998755, 114.1726943],
    to: [22.29986, 114.172688],
    why: '原值偏 199m，反查落在「彌敦道 134A」；新值為 The ONE（彌敦道 100 號）',
  },
  'mcl-014': {
    from: [22.3812305, 114.1863488],
    to: [22.381136, 114.188373],
    why: '原值偏 208m，反查落在「沙田正街 1 號」；新值為新城市廣場（沙田正街 18 號）',
  },
  'broadway-10': {
    from: [22.4445422, 114.0336104],
    to: [22.445241, 114.036971],
    why: '原值偏 200m，反查落在「攸田東路 9 號」；新值為形點 YOHO MALL（朗日路 9 號）',
  },
  'broadway-5': {
    from: [22.3235449, 114.1704488],
    to: [22.3233392, 114.1723261],
    why: '原值偏 193m，反查落在「花園街市場」；新值為百老匯戲院（太子道西 193 號，即 MOKO 現址）',
  },
  'broadway-7': {
    from: [22.3036045, 114.1613826],
    to: [22.3031638, 114.1626641],
    why: '先前修正點實際落在 Union Square；現改用 OSM amenity=cinema「Premiere Elements」POI，地址 Austin Road West 1 與官方圓方分店資料吻合',
  },
  'broadway-8': {
    from: [22.3107009, 114.1667297],
    to: [22.310646, 114.168979],
    why: '原點反查落在 Ferry Street，與官方眾坊街3號駿發花園地址不符；新值取 OSM amenity=cinema「Broadway Cinematheque」POI',
  },
  'broadway-9': {
    from: [22.3170779, 114.1684628],
    to: [22.31696, 114.170653],
    why: '改用 OSM 的「百老匯戲院」（西洋菜南街 6-12 號，與地址吻合；原值反查落在隔壁 Nike 門店）',
  },
  'broadway-11': {
    from: [22.3574671, 114.1239739],
    to: [22.357642, 114.126559],
    why: '原點反查落在葵喜街，與官方新都會廣場地址相距約270m；新值取 OSM amenity=cinema「Broadway Circuit」POI（興芳路223號）',
  },
  'cinemacity-55002': {
    from: [22.3761805, 114.1095579],
    to: [22.376111, 114.111882],
    why: '原點在愉景新城建物範圍以西約120m；新值取 OSM Discovery Park 建物範圍中心，與官方 398 Castle Peak Road 地址相符',
  },
  'cineart-17': {
    from: [22.3600746, 114.0720739],
    to: [22.3601423, 114.1067897],
    why: 'HK Movie 6 原值偏離青衣城2約 3.5km；新值取 OSM node 3906386531「影藝戲院 Cine-Art House」（amenity=cinema）',
  },
};

/** 取座標；無座標（如英皇總部辦公地址）回傳 null */
export function cinemaCoord(id: string): [number, number] | null {
  return CINEMA_COORD[id] ?? null;
}

// ---------- GCJ-02 坐标转换（瓦片用高德，WGS-84 坐标需偏移 ~595m） ----------

const GCJ_AXIS = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

/** 判断坐标是否在中国大陆范围（在此范围内 WGS-84 ↔ GCJ-02 才有意义；HK/MO/TW 也算） */
function outOfGcjChina(lat: number, lon: number): boolean {
  // 包含港澳台一并偏移：HK 在 lon 113.8–114.5，lat 22.1–22.6 落在范围内
  if (lon < 72.004 || lon > 137.8347) return true;
  if (lat < 0.8293 || lat > 55.8271) return true;
  return false;
}

/**
 * WGS-84 → GCJ-02（高德/腾讯/百度坐标系）
 *
 * 香港实测偏移约 595m（不转换则标记会落在 6 个街口之外）。
 * 公式来自测绘局公开算法；若坐标不在大陆/港澳/台湾范围，原样返回。
 */
export function wgs84ToGcj02(lat: number, lon: number): [number, number] {
  if (outOfGcjChina(lat, lon)) return [lat, lon];
  const dLat = transformLat(lon - 105, lat - 35);
  const dLon = transformLon(lon - 105, lat - 35);
  const rad = (lat / 180) * Math.PI;
  let magic = Math.sin(rad);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const adjLat = (dLat * 180) / (((GCJ_AXIS * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  const adjLon = (dLon * 180) / ((GCJ_AXIS / sqrtMagic) * Math.cos(rad) * Math.PI);
  return [lat + adjLat, lon + adjLon];
}

function transformLat(x: number, y: number): number {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return r;
}

function transformLon(x: number, y: number): number {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return r;
}

/**
 * 地圖外鏈（高德地圖網頁版）
 *
 * ⚠️ 參數必須是 **GCJ-02**（高德坐標系），不能傳 WGS-84：
 *   URL 帶了 coordinate=gaode，高德會把收到的值當 GCJ-02 直接用；
 *   若傳 WGS-84 原值，高德不會再偏移，標記就落在 ~595m 外。
 *   調用方請先過 wgs84ToGcj02()。
 */
export function amapUrl(gcjLat: number, gcjLon: number): string {
  return `https://uri.amap.com/marker?position=${gcjLon.toFixed(6)},${gcjLat.toFixed(6)}&name=戲院&src=hkmovie&coordinate=gaode&callnative=1`;
}

/**
 * 地圖外鏈（Google 地圖）
 *
 * ⚠️ 座標必須是 WGS-84，不能傳 GCJ-02：Google 用 WGS-84，
 *    傳偏移後的座標會讓標記落在 ~595m 外。
 *
 * 大陸用戶點了打不開（實測 maps.google.com 8–9s 逾時），
 * 但香港/海外訪客有用 —— 這是次要出口，不影響彈層載入。
 */
export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/**
 * 地圖外鏈（OpenStreetMap）—— **目前無人引用，保留為備用**
 *
 * 2026-09-26 起彈層瓦片改用高德，UI 已移除 OSM 外鏈按鈕（用戶指定）。
 * 此函數保留，以便日後高德 key 出問題時快速切回 OSM 出口。
 *
 * ★ 為什麼是 openstreetmap.de 而不是 openstreetmap.org
 *
 *   實測（2026-09-21，大陸直連）：
 *     www.openstreetmap.org      → 8s 逾時（不可達）
 *     tile.openstreetmap.org     → 8s 逾時（不可達）
 *     karte.openstreetmap.de     → 0.85s  ✅
 *     tile.openstreetmap.de      → 1.2s   ✅
 *
 *   德國 OSM 官方鏡像在大陸可達，而主站不可達。故外鏈一律用 .de。
 *   直接給 karte 子域（www.openstreetmap.de/karte/ 會多一次 302 跳轉）。
 *
 * ⚠️ 只給座標不給標記參數：karte.openstreetmap.de 的 permalink 只支援
 *    「#map=zoom/lat/lon」 這種 hash 形式，不支援 marker 參數
 *    （試過 ?mlat=&mlon= 無效）。用戶打開後看到的是該位置的地圖，
 *    雖然沒有大頭針，但配合戲院名與地址足以定位。
 */
export function osmUrl(lat: number, lon: number, zoom = 17): string {
  return `https://karte.openstreetmap.de/#map=${zoom}/${lat}/${lon}`;
}
