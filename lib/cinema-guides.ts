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
  'cgv-22': { sectionTitle: 'CGV D2 Place Cinema', highlights: ['院線列有 Cinema 1、K Star、SWEETBOX 及 ScreenX 影廳。', '位於 D2 Place 二期 11 樓。'] },
  'chinachem-plnym': { sectionTitle: '巴黎倫敦紐約米蘭戲院', highlights: ['華懋院線在屯門的戲院，設 4 個影廳，官方資料列總座位約 1,026 個。'] },
  'cineart-16': { sectionTitle: '影藝戲院 MegaBox', highlights: ['位於 MegaBox 11 樓；院線資料列 1–7 院及 VIP House，7 院為 IMAX。'] },
  'cineart-19': { sectionTitle: '影藝戲院 荷里活', highlights: ['位於鑽石山荷里活廣場 3 樓；院線資料列 6 個影廳。'] },
  'cineart-17': { sectionTitle: '影藝戲院 青衣城', highlights: ['位於青衣城 2；院線資料列 6 個影廳。'] },
  'cineart-18': { sectionTitle: '影藝戲院 銅鑼灣 JP', highlights: ['位於 JP 廣場；院線資料列 2 個影廳。'] },
  'cineart-23': { sectionTitle: '影藝戲院 新港城中心', highlights: ['位於馬鞍山新港城中心；院線資料列 4 個影廳。'] },
  'goldenscene-1': { sectionTitle: '高先電影院', highlights: ['位於堅尼地城吉席街 2 號。', '設 4 個影廳，官方列出 1–4 院座位數為 81、64、58、80。'] },
  'lumen-1001': { sectionTitle: 'Lumen Cinema', highlights: ['位於葵涌打磚坪街 1–25 號。', '官方頁列出影片未來數日場次並提供網上訂票連結。'] },
  'lux-1': { sectionTitle: '寶石戲院 Lux Theatre', highlights: ['位於紅磡寶其利街 2J 號。', '公開資料未列官方網上售票網站；即時排片請以院方公佈為準。'] },
  'newport-hyland': { sectionTitle: '凱都戲院 Hyland Theatre', highlights: ['新寶院線屯門戲院；官方場次頁列出影廳、時間及票價。'] },
  'sunbeam-1': { sectionTitle: '新光黃埔影藝城', highlights: ['位於黃埔天地螢幕圈 2 樓，設 4 個影廳。', '官方節目表提供每日電影、場次、語言及級別。'] },
  'emperor-57001': { sectionTitle: 'Emperor Cinema 英皇戲院總覽', highlights: ['原指南按分店列出影廳設備與到達路線；此卡對應院線總覽。'] },
  'emperor-57002': { sectionTitle: '銅鑼灣時代廣場（TS）', highlights: ['指南列出 House 2、3、5；全院採用 Dolby SL 音響及 4K 放映機。', 'House 3、5 設 Dolby Atmos；3 號院有 36 個揚聲器，5 號院有 48 個。'] },
  'emperor-57003': { sectionTitle: '中環娛樂行', highlights: ['全院採用 Dolby 7.1；戲院以無障礙設計為主。', '座椅為真皮沙發、座距較寬；指南提醒留意座椅小桌板。'], note: '指南列出 Sony／Christie 放映設備、Doremi 伺服器及 JBL 音響。' },
  'emperor-57004': { sectionTitle: '黃竹坑 THE SOUTHSIDE', highlights: ['目前收錄 House 4；全院使用 Barco 放映機與 Dolby 7.1 音響，其中一院為 4K。'], route: '港鐵黃竹坑站 B 出口。' },
  'emperor-57005': { sectionTitle: '尖沙咀 iSQUARE 國際廣場（IS）', highlights: ['目前收錄 House 5、2、3；設有 IMAX with Laser，另有 Dolby SL 影廳。', '指南提到 IMAX with Laser 新一代放映系統及 Sony 4K 激光放映機。'], route: '由尖沙咀站 H 出口進入 iSQUARE，沿路直走到電梯間乘電梯上 7 樓。' },
  'emperor-57006': { sectionTitle: '大圍圍方', highlights: ['目前收錄 House 1、6；全院採用 4K RGB 激光放映機及 Dolby 音響。', '其中一院設 Dolby Atmos，並配置 44 個揚聲器。'], route: '由大圍站 B 出口進入圍方，跟指示乘扶手電梯上樓。' },
  'emperor-57007': { sectionTitle: '荃灣荃新天地', highlights: ['目前收錄 House 2、4、5；全院 Sony 4K 激光放映機及 Dolby SL 音響。', '其中一院設 Dolby Atmos，支援 40 個獨立訊號輸出。'], route: '港鐵荃灣西站 E2 出口；指南另列露天及天橋路線。' },
  'emperor-57008': { sectionTitle: '將軍澳日出康城', highlights: ['目前收錄 House 3；六間影廳均採用 Sony 4K 激光放映機，配 Dolby Vision／7.1 音響。'], route: '康城站 B 出口。', note: '指南特別提醒：地圖上的 C1 出口資訊有誤，請不要走 C1。' },
  'emperor-57010': { sectionTitle: '屯門新都商場', highlights: ['全院配置 Sony 4K 放映機（並非全激光）；採用 CLOU 聲音系統。'], route: '屯門站 C 出口，步行約 10–12 分鐘。' },
  'emperor-57011': { sectionTitle: '澳門葡京人', highlights: ['設 IMAX with Laser；另有 8 個獨立影廳採用 Sony 4K 激光放映機與 Dolby SL。', '指南列出 Dolby Atmos 影廳及 MX4D 影廳。'] },
  'broadway-1': { sectionTitle: 'MOViE MOViE Pacific Place 金鐘', highlights: ['採用 Barco 2K／4K 激光放映機與 RealD PWS 銀幕。', 'MM Plus 及 The Oval Office VIP 影廳配置環繞音響與電動躺椅。'], route: '金鐘站 C1 出口，按指示前往太古廣場。', note: '指南提到此戲院前身為 AMC，票價相對較高。' },
  'broadway-2': { sectionTitle: 'MOViE MOViE Cityplaza 太古城', highlights: ['House 2、4、5 為目前收錄影廳；全院配置 Barco 4K 激光放映機。', '部分影廳設 Dolby Atmos；MOViEMAX 影廳有 RealD 銀幕與 AuroMax 系統。'], route: '太古站 E2／E3 出口，過馬路到太古城中心。' },
  'broadway-3': { sectionTitle: 'GALA CINEMA 朗豪坊（GL）', highlights: ['目前收錄 House 2、4、5；配 QSC 音響，部分影廳設 Dolby Atmos。', 'House 5 為 CINITY LED 影廳；House 1 為 4DX，House 3、4 支援高幀率。'], route: '旺角站 E1 出口。' },
  'broadway-4': { sectionTitle: 'PALACE ifc（PI）', highlights: ['5 個影廳共 544 個座位；1–4 院採 Dolby 7.1，5 院採 DTS:X。', '全院為電動躺椅；指南特別列出 4 院及 5 院設備。'], route: '香港站 F 出口，按指示前往國際金融中心。' },
  'broadway-5': { sectionTitle: 'B+ cinema MOKO（MOKO）', highlights: ['目前收錄 IMAX House 5、House 1、2；1–4 院配置 Dolby 7.1。', 'IMAX 銀幕約 16.33 × 9.26 米。'], route: '旺角東站 D 出口，或旺角站 D3 出口。' },
  'broadway-6': { sectionTitle: 'B+ cinema apm（APM）', highlights: ['目前收錄 House 2、5、6；多個影廳使用 USL 8 Channels 音響。', 'RealD Cinema 影廳配置 4K 激光放映機、RealD 銀幕及 Dolby Atmos。'], route: '觀塘站 A2 出口。' },
  'broadway-7': { sectionTitle: 'PREMIERE ELEMENTS（PE）', highlights: ['多數影廳配置 4K 放映及 Dolby 音響；2–5、8–12 院使用 Dolby 7.1。', '6 院為 CGS 4K 激光巨幕；THX 院配置 CGS 4K 放映及 THX 音效。'], route: '九龍站 C 出口，乘扶手電梯到 Elements 商場。' },
  'broadway-8': { sectionTitle: '百老匯電影中心 cinematheque（BC）', highlights: ['位於油麻地眾坊街，1996 年開幕；全院使用 Barco 放映機。', '指南列出 Dolby SR／SR D、JBL 音響及 RealD 3D 影廳。'], route: '油麻地站 C 出口；指南建議地圖搜尋「發發花園」。' },
  'broadway-9': { sectionTitle: '百老匯旺角', highlights: ['目前收錄 House 1、2、5；1–5 院採用 USL 8 Channels 環音系統。'], route: '旺角站 D3 出口，出站後直行。' },
  'broadway-10': { sectionTitle: 'MY CINEMA YOHO MALL', highlights: ['設 1 個數碼 IMAX 影廳，銀幕約 21 × 11.3 米。', '其他影廳採 Barco 4K 激光放映與 RealD PWS 銀幕；部分影廳配置 USL 8 Channels 或 DTS:X。'], route: '元朗站 K 出口。' },
  'broadway-11': { sectionTitle: '百老匯葵芳', highlights: ['目前收錄 House 5；1–5 院使用 USL 8 Channels 環音系統。'], route: '葵芳站 C 出口；指南列出兩條室內路線，建議選路線 2。' },
  'broadway-12': { sectionTitle: '百老匯荃灣', highlights: ['1–4 院使用 USL 8 Channels 環音系統。'], route: '荃灣西站 C3 出口。' },
  'broadway-13': { sectionTitle: '百老匯嘉湖', highlights: ['1–4 院使用 USL 8 Channels 環音系統。'], route: '天水圍站 E2 出口；指南亦列出 705、751 號巴士路線。' },
  'cinemacity-55001': { sectionTitle: 'Cinema City 柴灣', highlights: ['全院採用 Dolby 7.1 音響及 QSC 音響設備。'], route: '柴灣站 A 出口。' },
  'cinemacity-55002': { sectionTitle: 'Cinema City CANDY PARK', highlights: ['全院採用 Dolby 7.1；5 院配置 Barco 4K 放映機、B&W 音響及 X-Spatial 音場優化。'], route: '荃灣西站 A 出口。' },
  'bestar-58001': { sectionTitle: 'the sky', highlights: ['指南介紹全院配置 Dolby Atmos 的影廳。'], route: '奧運站 D3 出口。' },
  'bestar-58002': { sectionTitle: 'StagE', highlights: ['全院配置 Dolby Atmos、QSC 音響及 Barco 4K 激光放映機。', '部分影廳設 D-BOX 動感座椅。'], route: '屯門站 C 出口，步行約 10–12 分鐘。' },
  'bestar-58003': { sectionTitle: '嘉禾大埔', highlights: ['指南列有影廳及到達路線資訊。'], route: '大埔墟站 A3 出口。' },
  'mcl-002': { sectionTitle: 'MCL 新都城戲院', highlights: ['全院採用 Dolby 7.1；1、3 院配置 Barco 4K 激光放映機。'], route: '寶琳站 A2 出口，沿商場通道前往新都城中心二期。' },
  'mcl-003': {
    sectionTitle: 'MCL 皇室',
    highlights: ['銅鑼灣站 E 出口扶手電梯有時停用，原指南另列 F1 出口備用走法。'],
    features: ['觀眾回饋稱自助售票機不能掃碼取票，需到前台或小食部列印；另有觀眾提到沙發移動時聲音較大。'],
    route: '銅鑼灣站 E 出口左轉，先到翡翠明珠廣場，再到皇室大廈；進入皇室堡後乘扶手電梯至 4 樓。若 E 出口扶手電梯停用，可由 F1 出口過馬路接回原路。詳細位置及路線圖片請查看原指南。',
  },
  'mcl-005': { sectionTitle: 'MCL 德福（TC）', highlights: ['全院 Sony 4K 放映；House 1 為 MX4D，House 2、3 配置 QSC 音響及 Dolby Atmos。'], route: '九龍灣站 A 出口。' },
  'mcl-009': { sectionTitle: 'Star Cinema', highlights: ['指南標示影廳設備資料待補充。'], route: '將軍澳站 C 出口，前往 PopCorn 商場。' },
  'mcl-012': { sectionTitle: 'FESTIVAL GRAND CINEMA（FG）', highlights: ['目前收錄 House 2、3、4、5、7；1 院設 Dolby Atmos。', 'Festival Suite 為 Barco 放映及 Dolby Surround 7.1 音效；指南附有年齡提示。'], route: '九龍塘站前往又一城。', note: '原指南提醒未滿 18 歲觀影者留意影片級別及證件要求。' },
  'mcl-013': { sectionTitle: 'MCL 粉嶺戲院', highlights: ['全院採用 Dolby 7.1 音響。'], route: '粉嶺站 A2 出口。' },
  'mcl-014': { sectionTitle: 'Movie Town', highlights: ['House 5 為 Samsung Onyx LED 銀幕，約 10.3 × 5.4 米、4096 × 2160 像素。', '1、4 院配置 Barco 4K 激光及 Dolby Atmos；其他影廳另有 RealD XL、Dolby 7.1、B&W 音響。'], route: '沙田站 A 出口。' },
  'mcl-015': { sectionTitle: 'MCL 長沙灣戲院', highlights: ['全院 Sony 4K 放映；1、2 院為激光放映，配置 B&W 音響與 Dolby 7.1。'], route: '荔枝角站 B1 出口；指南指出由荔枝角出發較近。' },
  'mcl-016': { sectionTitle: 'MCL 數碼港', highlights: ['全院 Barco 4K 激光放映；LUXE 影廳配 RealD 銀幕及 JBL Dolby Atmos。', '2、3 院配置 Dolby Atmos 與 Buttkicker 動感座椅。'], route: '堅尼地城站 D1 出口，按指南轉乘小巴前往數碼港。' },
  'mcl-017': { sectionTitle: 'K11 Art House（AH）', highlights: ['設 IMAX with Laser；部分影廳配 Dolby Atmos、4K 激光放映及 Dolby 7.1。', '指南列出 VIP 影廳及 3D 影廳。'], route: '尖沙咀東站 J 出口；尖東 J1／J2 出口亦可到達，戲院位於 L4。' },
  'mcl-018': { sectionTitle: 'MCL 東薈城', highlights: ['全院 4K 激光放映；1 院 Dolby Atmos，2–4 院 Dolby 7.1。'], route: '東涌站 B 出口。' },
  'mcl-019': { sectionTitle: 'MCL 淘大', highlights: ['全院 Barco 4K 激光放映；1 院 Dolby Atmos，2、3 院使用 Barco 放映機。'], route: '九龍灣站 A 出口。' },
  'mcl-021': { sectionTitle: 'The One', highlights: ['House 2、3、5；全院 NEC 4K RGB 激光放映及 KRIX／Dolby 7.1 音響。'], route: '尖沙咀站 C1 出口。' },
  'mcl-022': { sectionTitle: 'MCL AIRSIDE', highlights: ['7 個影廳、約 900 個座位；設 LUXE 影廳及 RealD 銀幕。', '全院 NEC 激光放映；部分影廳配置 JBL、Dolby Atmos 或 Dolby 7.1。'], route: '啟德站 C 出口。' },
};
