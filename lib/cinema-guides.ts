export interface CinemaGuideRoom {
  name: string;
  description?: string;
  experience?: string[];
  seatTips?: string[];
}

export interface CinemaGuideContent {
  sectionTitle: string;
  highlights: string[];
  features?: string[];
  rooms?: CinemaGuideRoom[];
  route?: string;
  note?: string;
}

export const CINEMA_GUIDE_URL = 'https://docs.qq.com/doc/DZUFmSnZmQ0h2bHl3';

export const CINEMA_GUIDES: Record<string, CinemaGuideContent> = {
  'cgv-22': {
    sectionTitle: 'CGV D2 Place Cinema',
    highlights: ['院線列有 Cinema 1、K Star、SWEETBOX 及 ScreenX 影廳；戲院位於 D2 Place 二期 11 樓。', '指南說明 ScreenX 兩側揚聲器嵌入牆內，不影響觀影。'],
    rooms: [
      { name: 'House 3', description: '小型銀幕；指南評為亮度不錯、畫面尚算銳利，複雜畫面可見像素感，原作者推測為 2K 放映。音效尚可，沙發座椅舒適。', seatTips: ['E–G 排。'] },
    ],
    route: '荔枝角站 D1 出口出站後掉頭左轉，沿街直行至掛有 D2 TWO 招牌的第二個入口，乘電梯到 11 樓。',
  },
  'chinachem-plnym': {
    sectionTitle: '巴黎倫敦紐約米蘭戲院',
    highlights: ['華懋院線屯門戲院，設 4 個影廳；院線資料列總座位約 1,026 個。', '原指南列出由屯門站前往戲院商場的室外步行路線。'],
    rooms: [{ name: 'House 2', description: '原指南觀眾回饋稱影廳坡度較差。' }],
    route: '屯門站 F2 出口出站後前行並左轉下坡；沿河邊左轉走約 50 米，岔路走左邊再行約 50 米到戲院所在商場。原指南稱室內路線尚待補充。',
  },
  'cineart-16': {
    sectionTitle: '影藝戲院 MegaBox',
    highlights: ['院線資料列 1–7 院及 VIP House，7 院為 IMAX。', '指南提供免費穿梭巴士、室外步行及室內步行路線；原作者稱天氣許可時露天路線較短。'],
    route: '可由九龍灣站 A 出口經德福廣場前往。原指南稱乾爽天氣適合走較短的露天路線；下雨可選室內路線，另可搭免費穿梭巴士。到 MegaBox 後乘可到 9–17 樓的電梯至 11 樓；原指南亦提供扶手電梯上樓備用路線。',
  },
  'cineart-19': {
    sectionTitle: '影藝戲院 荷里活',
    highlights: ['位於鑽石山荷里活廣場 3 樓；院線資料列 6 個影廳。', '原指南提供由鑽石山站前往戲院的商場路線。'],
    route: '鑽石山站 C2 出口前往荷里活廣場，連乘扶手電梯上 3 樓，按戲院指示前往。',
  },
  'cineart-17': {
    sectionTitle: '影藝戲院 青衣城',
    highlights: ['位於青衣城 2；院線資料列 6 個影廳。', '指南記錄由青衣站 A1 出口進商場後需上行兩層。'],
    route: '青衣站 A1 出口經走廊進商場，往內走乘扶手電梯上二樓，再步行約 20 米乘另一段扶手電梯到戲院。',
  },
  'cineart-18': {
    sectionTitle: '影藝戲院 銅鑼灣 JP',
    highlights: ['院線資料列 2 個影廳；House 1、2 均為大型銀幕，指南提醒較後排視線角度和距離不理想。'],
    rooms: [
      { name: 'House 1', description: '大型銀幕，亮度尚可、音效中規中矩。', seatTips: ['若想視線與銀幕平行，指南建議前四排，但會較沉浸；E 排前有走廊可伸腳。避免坐太後。'] },
      { name: 'House 2', description: '大型銀幕，亮度及音效中等；右側出口燈較亮，對暗場有影響。', seatTips: ['前四排較接近平視；E 排前有走廊。避免坐太後。'] },
    ],
    route: '銅鑼灣站 E 出口左轉，步行不到 100 米到翡翠明珠廣場，乘扶手電梯上樓到票房。指南提醒 E 出口扶手電梯可能故障，可由 F1 出口過馬路後接回原路。',
  },
  'cineart-23': {
    sectionTitle: '影藝戲院 新港城中心',
    highlights: ['位於馬鞍山新港城中心；院線資料列 4 個影廳。', '原指南提供由馬鞍山站 B 出口步行前往商場的簡短路線。'],
    route: '馬鞍山站 B 出口出站右轉，走十多米左轉，再走十多米右轉直行即可。',
  },
  'goldenscene-1': {
    sectionTitle: '高先電影院',
    highlights: ['位於堅尼地城吉席街；1–4 院均為小型寬銀幕。', '原指南提到戲院內有燒賣皇后魚蛋小食。'],
    rooms: [
      { name: 'House 1', description: '指南觀眾回饋稱聲音不錯。', seatTips: ['謝票場亦可考慮 B 排。'] },
      { name: 'House 2、3', description: '原指南觀眾回饋稱整體表現尚可，House 2 分辨率觀感像 2K。', seatTips: ['House 2 的 B 排亦可考慮。'] },
      { name: 'House 4', description: '小型寬銀幕。' },
    ],
    route: '堅尼地城站 B 出口出站後沿路直行約 160 米。',
  },
  'lumen-1001': {
    sectionTitle: 'Lumen Cinema',
    highlights: ['位於葵涌打磚坪街；官方頁列出未來數日場次及網上訂票連結。', '指南附有由葵興站步行前往戲院的逐段圖示路線。'],
    rooms: [
      { name: 'House 1 VIP 院', seatTips: ['C 排。'] },
      { name: 'House 3', seatTips: ['F、G 排。'] },
      { name: 'House 5', description: '指南收錄觀眾回饋，提到播映彩蛋時燈光不關、座位間距較窄。', seatTips: ['8、9、10 號居中。'] },
    ],
    route: '葵興站 A 出口過馬路，依原指南圖片經天橋、行人路及斜坡步行前往戲院；路線轉向較多，建議開啟原文圖片。',
  },
  'lux-1': {
    sectionTitle: '寶石戲院 Lux Theatre',
    highlights: ['位於紅磡寶其利街；公開資料未列官方網上售票網站，即時排片請以院方公佈為準。', '原指南說明此步行路線僅作地圖參考。'],
    route: '黃埔站 B 出口出站右轉，沿路直行約 400 米。',
  },
  'newport-hyland': {
    sectionTitle: '凱都戲院 Hyland Theatre',
    highlights: ['新寶院線屯門戲院；本條目暫未整理原指南中的影廳及路線回饋。'],
    route: '屯門站 F2 出口出站後右轉離開高架橋底，再左轉沿河邊走約 50 米；岔路走右邊再走約 50 米，到路口過馬路左轉，沿路直行約 50 米到戲院。原指南建議開啟原文圖片辨認轉向。',
  },
  'sunbeam-1': {
    sectionTitle: '新光黃埔影藝城',
    highlights: ['位於黃埔天地螢幕圈；設 4 個影廳。House 2、4 均為大型銀幕；原指南提醒 House 2 坡度較差，前排觀眾可能遮住畫面底部。', '官方節目表提供每日電影、場次、語言及級別。'],
    rooms: [
      { name: 'House 2', description: '大型銀幕；寬銀幕電影的投影畫面較小。指南評為亮度尚可，音量和低音不錯，但坡度較差。' },
      { name: 'House 4', description: '大型銀幕。' },
    ],
    route: '黃埔站 C1 出口電梯上來後左轉即到戲院入口。',
  },
  'emperor-57001': { sectionTitle: 'Emperor Cinema 英皇戲院總覽', highlights: ['原指南按分店列出影廳設備與到達路線；此卡對應院線總覽。'] },
  'emperor-57002': {
    sectionTitle: '銅鑼灣時代廣場（TS）',
    highlights: ['全院採用 4K 放映機及 Dolby SL 音響；House 3、5 設 Dolby Atmos。House 1–5 各有不同畫幅及銀幕配置。'],
    features: ['所有座位均設 USB 插口及無線充電槽；Cinefan／香港電影節場次不提供充電。'],
    rooms: [
      { name: 'House 1', description: '中小型銀幕，可在寬銀幕與遮幅間切換；指南評為亮度不錯、音效中規中矩。', experience: ['暗場的 Sony 放映機藍底現象不太明顯。'] },
      { name: 'House 3', description: 'Sony 單機放映，設 Dolby Atmos。', seatTips: ['原指南推薦 E–G 排。'] },
      { name: 'House 4', description: '中型銀幕，兩側幕簾可調整至遮幅；指南評為亮度和音量優秀。' },
      { name: 'House 5', description: 'Dolby Atmos 影廳；銀幕下方擋板可下降以擴大投影畫面。', experience: ['指南記錄音量較大，Sony 放映機暗場藍底不太明顯。'], seatTips: ['G–I 排。'] },
    ],
    route: '由銅鑼灣站 A 出口進入商場，乘扶手電梯到地庫後按指引前往地面層，再乘可到 13 樓的電梯；亦可由 F 出口右轉，使用直達高層的電梯。',
  },
  'emperor-57003': {
    sectionTitle: '中環娛樂行',
    highlights: ['指南主要介紹 House 4、5，兩廳均為小型寬銀幕；原指南亦列 Sony／Christie 放映設備、Doremi 伺服器及 JBL 音響。', '全院採用 Dolby 7.1；設無障礙設施、真皮沙發及較寬座距，指南提醒留意座椅小桌板。'],
    rooms: [
      { name: 'House 4', description: '畫面亮度不錯；指南提到 Sony 放映機暗場有淡淡藍光。' },
      { name: 'House 5', description: '小型寬銀幕影廳；7.1 環繞聲映前示範效果強、音量大。', experience: ['指南提到幕布有霉漬。'] },
    ],
    route: '中環站 D1 出口右轉，直行約 150 米，戲院入口在斜右方。',
  },
  'emperor-57004': {
    sectionTitle: '黃竹坑 THE SOUTHSIDE',
    highlights: ['目前收錄 House 4；指南標示為小型遮幅銀幕。原指南設備摘要列 Barco 放映機與 Dolby 7.1 音響，其中一院為 4K。'],
    rooms: [{ name: 'House 4', description: '小型遮幅銀幕；原指南沒有提供選座建議。' }],
    route: '黃竹坑站 B 出口左轉入商場，沿環形屏左側前行再左轉，乘扶手電梯連上兩層至 L3；下扶手電梯後左轉即見戲院。',
  },
  'emperor-57005': {
    sectionTitle: '尖沙咀 iSQUARE 國際廣場（IS）',
    highlights: ['House 5 為 IMAX with Laser；指南列 Sony 4K 激光放映機，幕布約 20.94 × 11.8 米（另附測量備註）。', 'House 2、3 設 Dolby SLS 7.1；House 3 曾作 HKIFF／Cinefan 放映場地。'],
    features: ['the CORONET 貴賓院設無線充電、USB 插座、獨立閱讀燈、掛衣鈎及專屬休息室。', '指南推薦附近大家乐重慶大廈及大快活裕華國際大廈，步行約 3 分鐘。'],
    rooms: [
      { name: 'IMAX（House 5）', description: '原指南稱幕布約 20.94 × 11.8 米，並記錄座位多、滿場時較擠。', experience: ['低音較強；指南亦記錄兩側光污染及部分場次低頻表現的觀眾回饋。'], seatTips: ['16、17 列居中；H–I 排較沉浸，J–K 排可收入整幅銀幕，L–M 排平視銀幕中央。'] },
      { name: 'House 1', description: 'Sony 單機激光、小型銀幕；指南評為聲音充沛、畫面清晰，冷氣較冷。', seatTips: ['10 號座居中；D 排較沉浸，F–G 排平視銀幕。'] },
      { name: 'House 2', description: '雙 Sony 激光放映機，亮度高，配 Dolby SLS 7.1；暗場或見淡藍底。', seatTips: ['E–J 排均可考慮；G–H 排約為平視。'] },
      { name: 'House 3', description: 'HKIFF／Cinefan 常租影廳，Sony 雙機激光及 Dolby SLS 7.1。指南後續更新提到畫質、亮度及聲音表現曾轉差。', seatTips: ['7–9 列居中，推薦 E–G 排；斜列座位宜選 E–G 排。'] },
    ],
    route: '港鐵尖沙咀站 H 出口可直接進入 iSQUARE，乘電梯上 7 樓。地面亦有兩條路：商場入口右側扶手梯下地庫，超市入口左側有直達 7 樓的電梯；或用商場正門左側的地面電梯。',
  },
  'emperor-57006': {
    sectionTitle: '大圍圍方',
    highlights: ['全院採用 4K RGB 激光放映機及 Dolby 音響；House 1 設 Dolby Atmos，配置 44 個揚聲器。House 5、6 的原指南資料亦包含銀幕狀況及選座回饋。'],
    rooms: [
      { name: 'House 1', description: '小型遮幅銀幕，設 Dolby Atmos；指南評為亮度及音效不錯，三色匯聚略有偏差。' },
      { name: 'House 5', description: '寬銀幕；指南評為亮度及音效中上，並記錄銀幕有污漬／受潮回饋。', seatTips: ['D、E 排距離銀幕不如想像中近。'] },
      { name: 'House 6', description: '小型寬銀幕。', seatTips: ['F 排 10、11 號約為皇帝位；C 排較沉浸，D 排可剛好收入銀幕。'] },
    ],
    route: '大圍站 B 出口出站後走到盡頭乘扶手電梯；出扶手電梯右轉到 GODIVA，再左轉。沿左側乘扶手電梯至 L5，或用 SaSa 右側的升降機；到 L5 左轉再右轉，戲院在扶手電梯後方。',
  },
  'emperor-57007': {
    sectionTitle: '荃灣荃新天地',
    highlights: ['全院 Sony 4K 激光放映；House 1 設 Dolby Atmos，House 2、4 設 Dolby SLS 7.1。'],
    rooms: [
      { name: 'House 1', description: '座位呈弧形；指南評為全景聲、亮度及清晰度不錯，強光畫面時銀幕略顯髒。', seatTips: ['I–L 排。'] },
      { name: 'House 2', description: '小型銀幕，Dolby SLS 7.1，音量足、聲音細節清楚。', seatTips: ['G–I 排；指南稱坡度一般。'] },
      { name: 'House 3', description: '小型銀幕；低音不錯，音量一般。中央為走道，6 號位比 5 號位更居中。', seatTips: ['E、F 排平視；D 排需稍微仰頭。F 排 6–8 號前有護欄，雖不擋視線但較妨礙放腳。'] },
      { name: 'House 4', description: '小型銀幕，Dolby SLS 7.1，音量足、聲音細節清楚。', seatTips: ['F、G 排；指南稱坡度尚可。'] },
    ],
    route: '露天路線由荃灣西站 E2 出口出發，步行至 Citywalk 2 期，從 KFC 旁扶手電梯上樓。另可由 C3 出口經天橋到如心廣場，再經行人天橋進入荃新天地；原指南附有分段圖片指引。',
  },
  'emperor-57008': {
    sectionTitle: '將軍澳日出康城',
    highlights: ['指南記錄該院六間影廳採用 Sony 4K 激光放映機及 Dolby Vision／7.1；目前收錄 House 3（中型銀幕）。'],
    rooms: [{ name: 'House 3', description: 'Dolby 7.1 聲音定位感較弱；原指南觀眾回饋提到暗場有明顯且不均勻的藍斑。' }],
    route: '務必由康城站 B 出口前往：上扶手電梯到 L3 後右轉，繼續乘扶手電梯到 L4，沿麥當勞、KFC 旁走廊直行至盡頭左轉。',
    note: '原指南特別提醒地圖上的 C1 出口資訊有誤，請不要走 C1。',
  },
  'emperor-57010': {
    sectionTitle: '屯門新都商場',
    highlights: ['全院 Sony 4K 放映機（並非全激光）及 CLOU 聲音系統；原指南目前只收錄 House 1 的影廳資訊。'],
    rooms: [{ name: 'House 1', description: '指南未附影廳體驗或選座評價。' }],
    route: '屯門站 C 出口出發，步行約 10–12 分鐘：經 V City、屯門市廣場及華都大道天橋，進入新都商場後再步行數分鐘到戲院。原指南附有逐段圖片指引。',
  },
  'emperor-57011': {
    sectionTitle: '澳門葡京人',
    highlights: ['IMAX with Laser 位於 House 7；原指南記錄幕布約 24.59 × 11.80 米。', '另收錄 Sony 4K 激光、Dolby 音響、MX4D、遮幅及寬銀幕等影廳資料。'],
    rooms: [
      { name: 'IMAX（House 7）', description: '指南評為亮度屬二代激光 IMAX 正常水平，音量足、低音有座椅震感。', seatTips: ['17、18 列居中；G 排有欄杆。H–I 排較沉浸，J–K 排平視銀幕中央且較不易被擋。'] },
      { name: 'House 1（MX4D）', description: '中小型寬銀幕；提供 MX4D 動感體驗。' },
      { name: 'House 6', description: '中型遮幅銀幕；指南評為低音、聲壓充足，畫面清晰明亮。' },
    ],
  },
  'broadway-1': {
    sectionTitle: 'MOViE MOViE Pacific Place 金鐘',
    highlights: ['指南提到戲院前身為 AMC、外籍觀眾較多，票價相對較高。', 'House 4 左右擋板可配合不同畫幅，原指南評為亮度及低音充足。', '原指南列 Barco 2K／4K 激光放映機及 RealD PWS 銀幕；MM Plus、The Oval Office VIP 影廳設環繞音響和電動躺椅。'],
    rooms: [{ name: 'House 4', description: '中小型銀幕，左右擋板可配合不同畫幅；指南評為亮度及低音充足，並記錄有觀眾感到震動座椅力度很強。' }],
    route: '金鐘站 C1 出口左側乘扶手電梯到金鐘廊，按指示前往太古廣場；到商場後乘扶手電梯下一層，沿通道直走至盡頭。',
  },
  'broadway-2': {
    sectionTitle: 'MOViE MOViE Cityplaza 太古城',
    highlights: ['正對戲院有麥當勞；指南列出 House 1–6 的觀眾回饋。', '原院線設備摘要列 Barco 4K 激光放映，部分影廳設 Dolby Atmos；MOViEMAXX 使用 RealD 銀幕及 AuroMax。'],
    rooms: [
      { name: 'House 1', description: '坡度不太理想；要近銀幕就需仰頭，較後座位則距離遠。指南另提到銀幕略偏左。', seatTips: ['首選 F 排，其次 G 排；不介意仰頭可選 D、E 排；7、8 號較居中。'] },
      { name: 'House 4', description: '中型銀幕，指南評為亮度不錯、聲音細節清晰。', seatTips: ['E–G 排。'] },
      { name: 'House 5', description: '中型銀幕；指南觀察到銀幕偏右。', seatTips: ['可略選中線右側座位。'] },
      { name: 'MOViEMAXX（House 6）', description: '中型銀幕；指南收錄觀眾反映畫面有長條白塊，空鏡時較明顯。' },
    ],
    route: '太古站 E2／E3 出口過馬路即到太古城中心戲院入口。',
  },
  'broadway-3': {
    sectionTitle: 'GALA CINEMA 朗豪坊（GL）',
    highlights: ['House 2、4 可在寬銀幕與遮幅間切換；House 5 為 CINITY LED 十米不透聲版本，銀幕約 10.24 × 5.41 米。', '原指南所列 House 2 使用 QSC 音響；House 1 為 4DX，House 3、4 支援高幀率。'],
    rooms: [
      { name: 'House 2', description: '中小型銀幕，可切換畫幅；指南評為亮度較高、聲音普通，幕布有輕微霉漬。', seatTips: ['10 列正對銀幕；F–H 排較近，不必抬頭太多。'] },
      { name: 'House 4', description: '中小型銀幕，可切換畫幅；指南記錄亮度較高、聲音普通及幕布有霉漬。', seatTips: ['7、8 列正對；建議 G、H 排。'] },
      { name: 'House 5（CINITY LED）', description: '屏幕安裝位置較高，指南建議靠前，以免畫面顯得太小。', seatTips: ['9 列正對；建議 G、H 排，稍需抬頭。'] },
    ],
    route: '旺角站 E1 出口出站直行，路口左轉即見戲院入口；1 樓票房左側有直達 8 樓的電梯。',
  },
  'broadway-4': {
    sectionTitle: 'PALACE ifc（PI）',
    highlights: ['原指南介紹 House 4、5，兩院均為中小型銀幕。', '全院 5 個影廳共 544 個座位，座椅為電動躺椅；1–4 院採 Dolby 7.1，5 院採 DTS:X。'],
    rooms: [
      { name: 'House 4', description: '亮度合格、聲音細節清晰；座椅比其他百老匯戲院舒適。', seatTips: ['C–E 排。'] },
      { name: 'House 5', description: '亮度和音效都在可接受水平；原指南圖片顯示銀幕稍高。', seatTips: ['原指南以 F8 為例，仍需稍微仰頭。'] },
    ],
    route: '香港站 F 出口前往 ifc 商場，乘扶手電梯到正門後再上樓；出扶手電梯左轉直行，沿左側店舖走約 30 米。',
  },
  'broadway-5': {
    sectionTitle: 'B+ cinema MOKO（MOKO）',
    highlights: ['數碼 IMAX（House 5）銀幕約 16.33 × 9.26 米；指南記錄環繞聲明顯、小廳低音感較突出。', '原指南列 1–4 院配置 Dolby 7.1。'],
    rooms: [
      { name: 'IMAX（House 5）', description: '指南稱為全港最小 IMAX 銀幕，畫面亮度與清晰度屬一般數碼 IMAX 水平。', seatTips: ['15、16 列居中；G、H 排推薦，F 排較沉浸。'] },
      { name: 'House 1', description: '小型寬銀幕，座椅靠背舒適、前後排距較寬。', seatTips: ['D、E 排可剛好收入銀幕；D 排更沉浸。9 號略偏左，10 號較居中。'] },
      { name: 'House 3', seatTips: ['C 排較沉浸；D 排可收入銀幕但需稍仰頭，E、F 排較穩妥。'] },
    ],
    route: '旺角東站 D 出口可直接前往。由旺角站 D3 出口也可到：左轉後在路口右轉，步行約 200 米、過馬路及一個紅綠燈，再按指示前往商場；路線於旺角東站 D 出口附近接合。',
  },
  'broadway-6': {
    sectionTitle: 'B+ cinema apm（APM）',
    highlights: ['指南收錄 House 2、4、5 及 4DX House 6 的觀眾資料。', '原指南列多個影廳使用 USL 8 Channels 音響；RealD Cinema 影廳配置 4K 激光放映機、RealD 銀幕及 Dolby Atmos。'],
    rooms: [
      { name: 'House 2', description: '中型銀幕；指南認為影廳較長，全景聲效果一般。', seatTips: ['J 排。'] },
      { name: 'House 4', description: '指南評為音響效果不錯、亮度足，並記錄使用 Marvin audio。', seatTips: ['G–I 排的 7、8 號。'] },
      { name: 'House 5', description: '小型銀幕，設電動升降板。' },
      { name: 'House 6', description: '4DX 動感影廳。' },
    ],
    route: '觀塘站 A2 出口出站後右手邊乘扶手電梯，多段上行至 6 樓；看到黃色取票機即到。',
  },
  'broadway-7': {
    sectionTitle: 'PREMIERE ELEMENTS（PE）',
    highlights: ['House 1 為 CGS with THX Ultimate，House 6 為 CGS with Laser；原設備摘要列其餘多院採 4K／Dolby 音響，其中 2–5、8–12 院使用 Dolby 7.1。'],
    rooms: [
      { name: 'CGS with THX Ultimate（House 1）', description: '指南評為聲音還原自然、低音不錯；亮度一般，近看清晰度較差，畫面有細微抖動。', seatTips: ['F 排沉浸，G 排剛好收入銀幕，H 排平視；不宜坐太前。'] },
      { name: 'CGS with Laser（House 6）', description: '比 THX 院亮；銀幕較低。', seatTips: ['G–I 排；滿屏放映時不建議坐 F 排或更前，以免第一排遮畫面。'] },
      { name: 'House 2', description: '中型寬銀幕、SLS 音響，亮度和音量尚可；坡度一般。', seatTips: ['E 排更沉浸但需仰頭；I 排平視但離銀幕較遠。'] },
      { name: 'House 4', description: '中型銀幕，可切換遮幅／寬銀幕；坡度較差。', seatTips: ['避免太前，建議 F、G 排。'] },
      { name: 'House 5（VIP）', description: '小型銀幕，座椅靠背及腿托可電動調節。', seatTips: ['原指南認為 B 排較均衡；A、B 排需仰頭，C、D 排離銀幕較遠。'] },
      { name: 'House 7、8', description: '中型遮幅銀幕；House 7 色彩及亮度舒適，House 8 亮度和音量尚可。', seatTips: ['G–I 排；H、I 排平視，F、G 排更沉浸。'] },
      { name: 'House 12', description: '迷你銀幕、Dolby 7.1。', seatTips: ['D–F 排；原指南不建議坐 C 排之前。'] },
    ],
    features: ['House 5 VIP 院座位設 USB 充電插座。'],
    route: '可由九龍站 C 出口進入圓方商場，乘扶手電梯至商場層後步行約 200 米，到 Haagen-Dazs 附近再乘扶手電梯上樓；亦可由柯士甸站 C 出口經香港西九龍站、兩條自動人行道進入圓方。',
  },
  'broadway-8': {
    sectionTitle: '百老匯電影中心 cinematheque（BC）',
    highlights: ['指南稱 House 1–4 設計相近，影廳體驗大致相若；House 4 可切換寬銀幕與遮幅。', 'House 4 銀幕約 8 × 5 米（原指南註明測量有誤差）。'],
    rooms: [{ name: 'House 1–4', description: '指南整體評為亮度高、音效合格，並特別稱 House 4 音效最好。', seatTips: ['E、F 排為指南作者推薦；影廳較小，邊角座位影響相對有限。AB 排較難受，C 排仍可接受。'] }],
    route: '油麻地站 C 出口；原指南建議用高德或 Google 地圖搜尋「駿發花園」，並提醒首次到訪可先熟悉電影中心入口。',
  },
  'broadway-9': {
    sectionTitle: '百老匯旺角',
    highlights: ['House 1、2 均為中型銀幕，分別以寬銀幕及遮幅為主；指南建議選用震動座椅。', '原指南列 1–5 院使用 USL 8 Channels 環音系統。'],
    rooms: [
      { name: 'House 1、2', description: '指南評為亮度高、音效不錯；座椅有震動功能。', seatTips: ['原指南沒有列出固定最佳排數。'] },
      { name: 'House 5', description: '小型遮幅銀幕，亮度不錯、音效中規中矩；影廳較長且坡度較差。', seatTips: ['第 6 列為中間列；不建議坐得太後。第一排需仰頭，但可用椅背支撐。'] },
    ],
    route: '旺角站 D3 出口出站直行，經大快活招牌和店舖，百老匯旺角在大快活旁邊。',
  },
  'broadway-10': {
    sectionTitle: 'MY CINEMA YOHO MALL',
    highlights: ['數碼 IMAX（House 1）銀幕約 20.94 × 11.8 米；行距寬敞，方便伸腳及中途出入。指南亦收錄觀眾對坡度及音場的不同意見。', '原指南列其他影廳採 Barco 4K 激光放映及 RealD PWS 銀幕，部分配置 USL 8 Channels 或 DTS:X 音響。'],
    rooms: [
      { name: '數碼 IMAX（House 1）', description: '指南記錄低音及環繞聲定位充足、高音稍刺耳；銀幕約 20.94 × 11.8 米。觀眾回饋對坡度及後排音場有不同看法。' },
      { name: 'House 7', description: '中型遮幅銀幕；多數影廳的座位布局以走道為中線。', seatTips: ['想更沉浸可選 C8；日常可選 E11／F11。指南稱 8 號比 11 號更居中，G 排稍後。'] },
    ],
    route: '由元朗站 K 出口前往形點商場一期；到屏幕下方左轉，沿右側前行至扶手電梯後繼續向右，即到 MY CINEMA。',
  },
  'broadway-11': {
    sectionTitle: '百老匯葵芳',
    highlights: ['指南建議不熟路的觀眾選較直接的路線 1；路線 2 較繞。原指南列 1–5 院使用 USL 8 Channels 環音系統。'],
    rooms: [{ name: 'House 5', description: '指南評為音效尚可、後置聲道定位感強。', seatTips: ['F–H 排，6、7 列居中。'] }],
    route: '葵芳站 C 出口左轉入地下行人隧道，往前走十多米後右轉，沿葵青劇院方向前行至商場和戲院售票處。另可由 E 出口經天橋入商場，但原指南稱較繞。',
  },
  'broadway-12': {
    sectionTitle: '百老匯荃灣',
    highlights: ['原指南列 1–4 院使用 USL 8 Channels 環音系統，並提供由荃灣西站出發、經如心商場、灣景廣場及荃灣廣場的逐段圖示路線。'],
    route: '荃灣西站 C3 出口乘扶手電梯上樓後左轉，沿通道前行並過天橋進入如心商場；按圖示左轉繞過半圓形通道，經凑凑火鍋及戶外天橋到灣景廣場，再過天橋進入荃灣廣場。靠右沿商場通道前行，按戲院指示乘扶手電梯下到一樓。路線較長，建議開啟原文圖片確認轉向。',
  },
  'broadway-13': {
    sectionTitle: '百老匯嘉湖',
    highlights: ['原指南列 1–4 院使用 USL 8 Channels 環音系統，並建議由天水圍站轉乘輕鐵前往嘉湖商場。'],
    route: '天水圍站 E2 出口轉乘輕鐵 705（往濕地公園）或 751（往天逸），在銀座站下車；過斑馬線到對面街，左轉進商場，再按扶手電梯及走廊指示前往戲院。',
  },
  'cinemacity-55001': {
    sectionTitle: 'Cinema City 柴灣',
    highlights: ['原院線設備摘要列 Dolby 7.1 音響及 QSC 音響設備；指南另提供由柴灣站 A 出口經商場人行天橋前往戲院的路線。'],
    rooms: [
      { name: 'House 1', description: '小型寬銀幕，指南評為亮度尚可、小廳音效及低音不錯。' },
      { name: 'House 2', description: '小型遮幅銀幕，亮度及小廳音效尚可；座椅較硬。', seatTips: ['第 3 列居中。'] },
    ],
    route: '柴灣站 A 出口進商場後按指示走人行天橋；在第二個分叉口左轉乘電梯到地面，再沿通往戲院的小路直行至票房。',
  },
  'cinemacity-55002': {
    sectionTitle: 'Cinema City CANDY PARK',
    highlights: ['原院線設備摘要列 Dolby 7.1 音響；House 5 使用 Barco 4K 放映機、B&W 音響及 X-Spatial 音場優化。', '指南提供由荃灣站前往愉景新城商場戲院的步行路線。'],
    route: '荃灣站 A 出口右轉直行，進入通往愉景新城的走廊；沿走廊直行至愉景新城商場入口，進商場後靠右走到對面，乘扶手電梯下樓並按指示轉入戲院售票處。',
  },
  'bestar-58001': {
    sectionTitle: 'the sky',
    highlights: ['House 1 為中大型遮幅銀幕；原指南評為亮度尚可，Dolby Atmos 聲音定位準確，低音不錯。', 'House 4 Vivo 尊尚影院設電動沙發，可躺臥觀影。'],
    rooms: [
      { name: 'House 1', description: 'JBL 喇叭及 Dolby Atmos；座椅寬敞、坐距較闊，出口燈對畫面影響不大。', seatTips: ['原指南註明第 9 列最靠近銀幕中間，正中間為台階。'] },
      { name: 'House 4（Vivo 尊尚影院）', description: '中型遮幅銀幕，設電動沙發；指南觀眾回饋提到三色匯聚不準，圖像邊緣有色溢。', seatTips: ['第 6 列為正中間。'] },
      { name: 'House 6', description: '中大型遮幅銀幕；指南觀眾回饋提到對焦稍模糊。' },
    ],
    route: '奧運站 D3 出口經天橋進入奧海城二期，乘 GODIVA 右側扶手電梯下樓，沿右側走廊前行十多米後右轉，再走數十米乘通往戲院的電梯。',
  },
  'bestar-58002': {
    sectionTitle: 'StagE',
    highlights: ['House 1–3 的觀眾回饋均不建議選 E 排及更前座位；House 4 亦不建議 F 排及更前座位。'],
    rooms: [
      { name: 'House 1', description: '指南觀眾回饋稱影廳坡度較差。', seatTips: ['避免 E 排及更前。'] },
      { name: 'House 2–3', seatTips: ['避免 E 排及更前。'] },
      { name: 'House 4', seatTips: ['避免 F 排及更前。'] },
    ],
    route: '屯門站 C 出口前往 V City，沿商場走廊、天橋及屯門市廣場方向步行，再依原指南圖片轉入戲院直達電梯；慢走約 10–12 分鐘，建議查看原文圖片辨認轉向。',
  },
  'bestar-58003': {
    sectionTitle: '嘉禾大埔',
    highlights: ['原指南建議由大埔墟站轉乘小巴前往戲院。'],
    route: '大埔墟站 A3 出口前往小巴站，乘 20A 或 20P 到大埔中心五期站（約 4 分鐘）；下車後從車站後方小徑走到盡頭，即見戲院。',
  },
  'mcl-002': {
    sectionTitle: 'MCL 新都城戲院',
    highlights: ['原指南收錄 House 5、6 的選座建議；原院線設備摘要列全院 Dolby 7.1，House 1、3 配置 Barco 4K 激光放映機。'],
    rooms: [
      { name: 'House 5', seatTips: ['E、F 排。'] },
      { name: 'House 6', seatTips: ['E、F、G 排。'] },
    ],
    route: '由寶琳站經商場通道前往新都城中心二期，左轉直行約 30 米，再右轉約 10 米，留意左側往地面的扶手電梯；下樓左轉即見票房，影廳入口在票房後方。',
  },
  'mcl-003': {
    sectionTitle: 'MCL 皇室',
    highlights: ['銅鑼灣站 E 出口扶手電梯有時停用，原指南另列 F1 出口備用走法。'],
    features: ['觀眾回饋稱自助售票機不能掃碼取票，需到前台或小食部列印；另有觀眾提到沙發移動時聲音較大。'],
    route: '銅鑼灣站 E 出口左轉，先到翡翠明珠廣場，再到皇室大廈；進入皇室堡後乘扶手電梯至 4 樓。若 E 出口扶手電梯停用，可由 F1 出口過馬路接回原路。詳細位置及路線圖片請查看原指南。',
  },
  'mcl-005': {
    sectionTitle: 'MCL 德福（TC）',
    highlights: ['原院線設備摘要列全院 Sony 4K 放映，House 1 為 MX4D；House 2、3 使用 QSC 音響及 Dolby Atmos。', '指南收錄 House 1、3、5 的影廳資料。'],
    rooms: [
      { name: 'House 1（MX4D）', description: '小型寬銀幕，設 MX4D 動感體驗。' },
      { name: 'House 3', description: '小型銀幕。' },
      { name: 'House 5', description: '小型銀幕。', seatTips: ['第 8 列為中間列。'] },
    ],
    route: '九龍灣站 A 出口右轉，乘扶手電梯進入德福廣場；到商場層後再乘前方短扶手電梯上樓，按 MCL 戲院指示前往。',
  },
  'mcl-009': {
    sectionTitle: 'Star Cinema',
    highlights: ['原指南收錄 House 2、5；House 5 選座建議為 D、E、F 排。'],
    rooms: [{ name: 'House 5', seatTips: ['D、E、F 排。'] }],
    route: '將軍澳站 C 出口前往 PopCorn 商場，入商場後右轉直行約 50 米，到第二組扶手電梯乘電梯上樓即見戲院入口。',
  },
  'mcl-012': {
    sectionTitle: 'FESTIVAL GRAND CINEMA（FG）',
    highlights: ['原指南收錄 House 2、3、4、5、7；House 2–5 採 QSC 音響，House 7 為 Dolby 7.1。', '九龍塘站 H 出口接東鐵線，C1 出口接觀塘線；原指南提醒未滿 18 歲觀看三級片需留意查證要求。'],
    rooms: [
      { name: 'House 2', description: '小型銀幕、QSC 音響，音量充足。', seatTips: ['F、G 排。'] },
      { name: 'House 3', description: '小型銀幕、QSC 音響；坡度一般，指南提醒座椅排列傾斜，需依原圖確認正中位置。', seatTips: ['F–H 排；正中座位以原指南標記為準。'] },
      { name: 'House 4', description: '小型銀幕；音量、亮度及清晰度均有正面評價。', seatTips: ['指南稱可較靠前坐，E 排亦可。'] },
      { name: 'House 5', description: '小型遮幅銀幕；QSC 音響，音量及亮度充足。' },
      { name: 'House 7', description: '小型銀幕，Dolby 7.1 環繞聲；坡度尚可。', seatTips: ['G–I 排。'] },
    ],
    route: '九龍塘站依所乘路線由 H（東鐵線）或 C1（觀塘線）出口出站，經通往又一城的樓梯進入商場，再按原指南圖片搭扶手電梯上樓。',
    note: '未滿 18 歲觀眾觀看三級片可能會被查證；請以影院當日要求為準。',
  },
  'mcl-013': {
    sectionTitle: 'MCL 粉嶺戲院',
    highlights: ['原院線設備摘要列 Dolby 7.1 音響；指南列由粉嶺站轉乘巴士前往逸峯廣場的路線。'],
    rooms: [
      { name: 'House 2', seatTips: ['E、F 排。'] },
      { name: 'House 3', seatTips: ['D、E、F 排。'] },
    ],
    route: '粉嶺站 A2 出口右轉，走約 60 米左轉，再直行約 80 米並過紅綠燈；到粉嶺名都巴士站乘 78A、278A 或 505，到逸峯站（約 6 分鐘），從站後入口進逸峯廣場，入商場後向前再左轉。',
  },
  'mcl-014': {
    sectionTitle: 'Movie Town',
    highlights: ['House 5 為 Samsung Onyx Cinema LED；原指南列約 10.3 × 5.4 米、4096 × 2160 像素，並稱銀幕可升降至合適放映高度。', '原院線設備摘要列 House 1、4 配 Barco 4K 激光及 Dolby Atmos；指南附由沙田站前往票房及檢票口的指引。'],
    rooms: [
      { name: 'Onyx Cinema LED（House 5）', description: 'Samsung LED 銀幕；原指南列為小型 LED 屏幕，可升降至合適放映高度。' },
      { name: 'House 6', seatTips: ['N11 為指南標示的中間座位。'] },
    ],
    route: '沙田站 A 出口進入商場後向右前方走，乘向下扶手電梯；下樓右轉直行至分叉路，直行往票房、左轉往自助取票機。票房斜對面有扶手電梯下到戲院檢票口。',
  },
  'mcl-015': {
    sectionTitle: 'MCL 長沙灣戲院',
    highlights: ['原指南稱由荔枝角站步行較由長沙灣站近，並提供 House 1、2 選座建議。'],
    rooms: [
      { name: 'House 1', seatTips: ['E、F、G 排。'] },
      { name: 'House 2', seatTips: ['E、F、G 排。'] },
    ],
    route: '荔枝角站 B1 出口過馬路後沿人行道直行，到麗新商業中心樓下，由 7-Eleven 左側入口進入戲院。',
  },
  'mcl-016': {
    sectionTitle: 'MCL 數碼港',
    highlights: ['原設備摘要列 Barco 4K 激光放映、LUXE RealD 銀幕與 JBL Dolby Atmos；指南提供兩種小巴接駁方式。'],
    route: '路線一：銅鑼灣站 D1 出口左轉，在對面乘 69X 小巴至總站（原指南記錄票價 $11.5，金額可能變動）。路線二：堅尼地城站 A 出口轉乘 58M 小巴到數碼港。',
  },
  'mcl-017': {
    sectionTitle: 'K11 Art House（AH）',
    highlights: ['IMAX with Laser（House 12）銀幕約 20.7 × 11.77 米；原設備摘要亦列 Dolby Atmos、4K 激光及 Dolby 7.1 影廳。', '原指南對 IMAX 低音、銀幕振動及暗場表現有較早期的觀眾回饋；部分瑕疵附有後續修復更新。'],
    rooms: [
      { name: 'IMAX（House 12）', description: '坡度尚可、座位數較少；指南評為暗場光污染少、沉浸感足，但低音偏弱。', seatTips: ['J、K 排沉浸；L、M 排可完整收入銀幕；最後一排 N 低音更弱。'] },
      { name: 'House 1', description: '中小型遮幅銀幕；亮度高、音量充足，採 Dolby SLS 7.1 及 JBL 喇叭。', seatTips: ['6 列居中，E–G 排；F、G 排平視，E 排略仰頭。'] },
      { name: 'House 2', description: '中型遮幅銀幕，亮度高、音量尚可；右側出口燈牌令暗場沉浸感稍弱。', seatTips: ['9、10 列居中，E–G 排。'] },
      { name: 'House 3', description: '中型遮幅銀幕，音量充足；指南提到右側出口燈牌有少量光污染。', seatTips: ['10、11 列居中；F–H 排，G10、G11 為指南標示的佳位。'] },
      { name: 'House 5、6', description: '大型遮幅銀幕，音量足；指南稱台階燈較亮、暗場偏灰。', seatTips: ['G 排約為平視銀幕。'] },
    ],
    features: ['檢票處旁休息區有 USB 插座、英標插座及無線充電座（指南提醒無線充電座未必好用）。'],
    route: '尖沙咀站 E 出口（通往半島酒店）或尖東站 J1／J2 出口，前往商場 L4。尖東 J 出口路線：入商場左轉直行，到下行扶手電梯後右轉，經消防門乘電梯直達 L4。',
  },
  'mcl-018': {
    sectionTitle: 'MCL 東薈城',
    highlights: ['原設備摘要列全院 4K 激光放映、House 1 Dolby Atmos 及 House 2–4 Dolby 7.1；指南提供由東涌站 B 出口經商場前往戲院的路線。'],
    route: '東涌站 B 出口進商場，連乘兩段扶手電梯到商場層，再按原指南圖示逐層乘扶手電梯上 3 至 6 樓前往戲院。',
  },
  'mcl-019': {
    sectionTitle: 'MCL 淘大',
    highlights: ['原指南列出 House 1–3 選座建議；大部分座位設有 USB 充電插座。'],
    features: ['大部分座椅設有 USB 充電插座。'],
    rooms: [
      { name: 'House 1', seatTips: ['H、J 排。'] },
      { name: 'House 2', seatTips: ['H–L 排。'] },
      { name: 'House 3', seatTips: ['H、J 排。'] },
    ],
    route: '九龍灣站 A 出口向前走十多米左轉上天橋，過馬路後直行約 30 米右轉；沿人行道走約 100 米，過紅綠燈後右轉約 40 米，再左轉約 30 米到淘大商場外，按戲院燈牌方向前往。',
  },
  'mcl-021': {
    sectionTitle: 'The One',
    highlights: ['原設備摘要列 NEC 4K RGB 激光放映及 KRIX／Dolby 7.1 音響；指南收錄 House 2、3、5 觀感，House 2 正中為 K9 列。'],
    rooms: [
      { name: 'House 2', description: '小型遮幅銀幕。', seatTips: ['K9 列居中。'] },
      { name: 'House 3', description: '小型遮幅銀幕；指南觀眾回饋稱環繞聲不突出、主要聲音來自前方，聲壓尚可、亮度足。' },
      { name: 'House 5', description: '小型遮幅銀幕；指南提到逃生出口燈牌較亮，會影響暗場觀感。', seatTips: ['J 排平視銀幕但位置較後，可考慮靠前一些。'] }
    ],
    route: '尖沙咀站 B1 出口出站右轉直行，經商場招牌下方入口進中庭，乘兩段扶手電梯至 UG2；右轉乘最內側電梯上樓。票房及 1、2 院在 L6，3、4 院在 L8，5、6 院在 L10。',
  },
  'mcl-022': {
    sectionTitle: 'MCL AIRSIDE',
    highlights: ['7 個影廳、約 900 個座位；設 LUXE RealD 銀幕。LUXE（House 1）選座建議為 H–J 排；House 6 為小型遮幅銀幕。', '原設備摘要列全院 NEC 激光放映，部分影廳配置 JBL、Dolby Atmos 或 Dolby 7.1。'],
    rooms: [
      { name: 'LUXE（House 1）', seatTips: ['H–J 排。'] },
      { name: 'House 2', seatTips: ['7、8 號居中。'] },
      { name: 'House 4', seatTips: ['不建議 F 排及更前位置。'] },
      { name: 'House 6', description: '小型遮幅銀幕。' },
    ],
    route: '啟德站 C 出口往 AIRSIDE，沿直路乘短、長兩段扶手電梯到地面；左轉可乘升降機，或右轉連乘扶手電梯到 L5。由扶手電梯抵達後左轉，從升降機抵達則出來即見戲院。',
  },
};
