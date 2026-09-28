/**
 * 戲院支付方式（網上購票）
 *
 * ===== 為什麼單獨一個純模塊 =====
 *
 * 跟 lib/booking-fee.ts 同一套理由：院線政策，變動頻率遠低於場次資料，
 * 寫死在這裡而不是塞進每次抓取都會被覆寫的 data/*.json。
 * 改時只需動下面一張表，重新 build 即可（靜態導出會烤進 HTML）。
 *
 * ===== 數據來源與可信度 =====
 *
 * 每個院線都標了 source 和 verified：
 *   verified: true  → 院方官網／官方 App 開發者明文，或已確認來源與渠道的官方付款頁證據
 *   verified: false → 尚未取得足以確認該院線／渠道的支付方式證據
 *
 * UI 上對 verified:false 的院線顯示「支付方式待確認」，
 * 不顯示具體支付方式 —— 顯示錯的比不顯示更糟。
 *
 * ===== 已確認院線（2026-09-27 實查）=====
 *
 * 百老匯  官網 FAQ 明文：
 *   「我們支援多種付款方式，包括VISA、萬事達信用咭、美國運通信用咭、
 *     銀聯、支付寶、微信支付及禮蜜卡，所有交易均以港幣結算。」
 *   數據結構 otherTypes: [visa, master, ae, unionpay, wechat, alipay, octopus]
 *   → 7 種 + 禮蜜卡（院線自家）
 *
 * CGV     官網 FAQ 明文：
 *   中文：「我們目前接受VISA、萬事達卡及銀聯支付。」
 *   英文：「We currently accept Visa & Mastercard for online purchasing.」
 *   數據結構 otherTypes: [master, unionpay]（type: visa）
 *   → 3 種
 *
 * 華懋    官網 FAQ 明文：
 *   中文：「我們暫時只接受VISA 及萬事達信用咭。」
 *   英文：「Credit card payment: VISA, MasterCard and Union Pay.」
 *   → 中英不一致，保守取中文（2 種），英文的 Union Pay 待核實
 *
 * 影藝    官網 FAQ 明文：
 *   中文：「我們暫時只接受VISA及萬事達信用咭。」
 *   英文：「We currently accept Visa and Mastercard for online purchasing.」
 *   數據結構 otherTypes: [visa, master, unionpay]
 *   → FAQ 只寫 2 種，數據結構有 unionpay 但 FAQ 未提及 → 保守記 2 種
 *
 * MCL     官網 FAQ 明文列出網上購票方式：Visa、Mastercard、美國運通、PPS、AlipayHK。
 *         PPS 只適用於電腦網頁版；手機網頁版只接受信用卡。手機 App 另接受 AlipayHK。
 * 新寶    官網 FAQ Q1 明文：網上購票接受 Mastercard 及 Visa。
 * 星達    官網 FAQ 明文：網上及手機訂票接受八達通、支付寶、微信支付、銀聯、VISA 及萬事達信用卡。
 * 新光黃埔 官網《購票條款及細則》第 1 點：
 *         「只支援Visa/MasterCard、PayPal、支付寶、微信支付購票。」
 *         僅確認新光黃埔官網網購，不推廣至其他新光場地、App 或票房；支付寶未細分地區版本。
 *
 * ===== 本次用户确认的官方网页付款页 =====
 *
 * 英皇、Cinema City、高先及 Lumen 的付款方法来自用户提供的付款页截图／文字，
 * 并由用户确认四者均为对应院线的官方付款页，渠道为电脑及手机网页购票。
 * 截图未提供实际付款页 URL，因此 source 使用院方首页作为院线身份链接；
 * 不代表本仓库已独立联网重现该付款页，亦不外推至 App、票房或自助机。
 * 原图标识、用户确认和来源限制记录于 probe/payment-user-provided-policy-evidence-2026-09-27.json。
 * 宝石仍无符合标准的官方支付清单，维持 verified:false。
 */

/** 支付方式 key */
export type PaymentMethod =
  | 'visa'
  | 'mastercard'
  | 'american_express'
  | 'unionpay'
  | 'alipay'
  | 'alipayhk'
  | 'wechat_pay'
  | 'wechat_pay_hk'
  | 'paypal'
  | 'octopus'
  | 'jcb'
  | 'apple_pay'
  | 'google_pay'
  | 'payme'
  | 'gift_card'       // 院線自家禮券/儲值卡
  | 'eps'
  | 'fps'
  | 'pps';

export interface PaymentInfo {
  /** 接受的支付方式 */
  methods: PaymentMethod[];
  /** 出處（院方官網或官方 App 商店 URL） */
  source: string | null;
  /** 一句話說明 */
  note: string;
  /** 是否已從院方官網或官方 App 開發者公開說明確認 */
  verified: boolean;
}

/** 顯示名稱（繁體中文） */
export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  visa: 'Visa',
  mastercard: 'MasterCard',
  american_express: '美國運通',
  unionpay: '銀聯',
  alipay: '支付寶',
  alipayhk: 'AlipayHK',
  wechat_pay: '微信支付',
  wechat_pay_hk: 'WeChat Pay HK',
  paypal: 'PayPal',
  octopus: '八達通',
  jcb: 'JCB',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  payme: 'PayMe',
  gift_card: '禮券卡',
  eps: 'EPS',
  fps: 'FPS',
  pps: 'PPS 網上繳費靈',
};

/**
 * 院線支付方式表
 *
 * ★ key 是 Source（院線），不是 cinemaId。
 *   支付方式是院線政策，全線一致（除非個別戲院有特殊安排，再用 BY_CINEMA 覆寫）。
 *
 * ★ verified:false 的院線在 UI 上不顯示具體支付方式，只顯示「待確認」。
 *   這是刻意為之 —— 顯示錯的比不顯示更糟。
 */
const BY_SOURCE: Partial<Record<string, PaymentInfo>> = {
  broadway: {
    methods: ['visa', 'mastercard', 'american_express', 'unionpay', 'alipay', 'wechat_pay', 'octopus', 'gift_card'],
    source: 'https://www.cinema.com.hk/hk/info/faq',
    note: '百老匯官網 FAQ：VISA、萬事達、美國運通、銀聯、支付寶、微信支付、八達通及禮蜜卡。',
    verified: true,
  },
  cgv: {
    methods: ['visa', 'mastercard', 'unionpay'],
    source: 'https://cgv.com.hk/zh/info/faq',
    note: 'CGV 官網 FAQ：VISA、萬事達卡及銀聯。',
    verified: true,
  },
  chinachem: {
    // ★ 中英 FAQ 不一致：中文寫「只接受 VISA 及萬事達」，英文寫「VISA, MasterCard and Union Pay」。
    //   保守取中文（院線總部在香港，中文為準），Union Pay 待核實。
    methods: ['visa', 'mastercard'],
    source: 'https://www.cel-cinemas.com/tc/info/faq',
    note: '華懋官網 FAQ（中文）：VISA 及萬事達信用咭。（英文版另列 Union Pay，待核實。）',
    verified: true,
  },
  cineart: {
    // ★ FAQ 明文只寫 VISA + Mastercard。數據結構有 unionpay 但 FAQ 未提及，不納入。
    methods: ['visa', 'mastercard'],
    source: 'https://cinearthouse.com.hk/hk/info/faq',
    note: '影藝官網 FAQ：VISA 及萬事達信用咭。',
    verified: true,
  },

  mcl: {
    methods: ['visa', 'mastercard', 'american_express', 'pps', 'alipayhk'],
    source: 'https://info.mclcinema.com/MCL.Fronts.FAQ/?source=DesktopWeb&language=zh-TW',
    note: 'MCL 官網 FAQ：電腦網頁版接受 Visa、Mastercard、美國運通、PPS、AlipayHK；手機網頁版只接受信用卡；MCL App 接受信用卡及 AlipayHK。PPS 只適用於電腦網頁版。官方使用條款另列八達通，且付款清單與 FAQ 不一致；故未把八達通列為已確認方式。',
    verified: true,
  },

  // ===== 其他院線（各自以 verified 標示核實狀態） =====

  emperor: {
    methods: ['visa', 'mastercard', 'unionpay', 'american_express', 'alipayhk', 'wechat_pay_hk', 'apple_pay'],
    source: 'https://www.emperorcinemas.com/',
    note: '用戶提供並確認為英皇香港官方網頁購票付款頁的資料，列明 Visa、Mastercard、銀聯、美國運通、AlipayHK、WeChat Pay HK 及 Apple Pay。適用於電腦及手機網頁購票；不外推至 App、票房、自助機或澳門戲院。實際付款頁 URL 未提供，來源連結為院方官網。',
    verified: true,
  },
  cinemacity: {
    methods: ['visa', 'mastercard', 'unionpay', 'jcb', 'alipay', 'alipayhk', 'octopus'],
    source: 'https://www.cinemacity.com.hk/',
    note: '用戶提供並確認為 Cinema City 官方網頁購票付款頁的截圖，信用卡／提款卡標示 Visa、Mastercard、銀聯及 JCB，另列支付寶、支付寶香港及八達通。適用於電腦及手機網頁購票；不外推至 App、票房或自助機。實際付款頁 URL 未提供，來源連結為院方官網。',
    verified: true,
  },
  bestar: {
    methods: ['octopus', 'alipay', 'wechat_pay', 'unionpay', 'visa', 'mastercard'],
    source: 'https://www.bestarfilm.hk/activity/detail?wapid=XYHK_WEB_PROD_S_MPS&activityViewCode=ACV1ji27ae3n688j',
    note: '星達官網常見問題第 11 題：網上及手機訂票接受八達通、支付寶、微信支付、銀聯、VISA 及萬事達信用卡。',
    verified: true,
  },
  goldenscene: {
    methods: ['visa', 'mastercard', 'payme'],
    source: 'https://goldenscene.com/',
    note: '用戶提供並確認為高先電影院官方網頁購票付款頁的截圖，列明 Visa、Mastercard 及 PayMe。適用於電腦及手機網頁購票；不外推至 App、票房或自助機。實際付款頁 URL 未提供，來源連結為院方官網。',
    verified: true,
  },
  lumen: {
    methods: ['visa', 'mastercard', 'unionpay', 'alipayhk', 'alipay', 'wechat_pay'],
    source: 'https://www.lumencinema.com.hk/',
    note: '用戶提供並確認為 Lumen Cinema 官方網頁購票付款頁的截圖，列明 Visa、Mastercard、銀聯、AlipayHK、支付寶及 WeChat Pay。適用於電腦及手機網頁購票；不外推至 App、票房或自助機。實際付款頁 URL 未提供，來源連結為院方官網。',
    verified: true,
  },
  newport: {
    methods: ['mastercard', 'visa'],
    source: 'https://www.theatre.com.hk/tc/faq',
    note: '新寶官網 FAQ Q1：網上購票接受 Mastercard 及 Visa 卡。',
    verified: true,
  },
  sunbeam: {
    // 本項只涵蓋目前資料中的新光黃埔影藝城，不代表其他新光場地。
    methods: ['visa', 'mastercard', 'paypal', 'alipay', 'wechat_pay'],
    source: 'https://www.sunbeamwhampoa.com/',
    note: '新光黃埔影藝城官網《購票條款及細則》第 1 點：只支援 Visa/MasterCard、PayPal、支付寶、微信支付購票。適用於該官網網購；不代表 App、票房或其他新光場地。條款未細分支付寶地區版本，故不另確認 AlipayHK。',
    verified: true,
  },
  lux: {
    methods: [],
    source: null,
    note: '寶石戲院無官方網站，且不設網上購票。',
    verified: false,
  },
};

/**
 * 個別戲院覆寫
 *
 * 用戶確認的英皇付款頁只證明香港官方網頁購票方式；本專案亦含澳門英皇戲院，
 * 未有澳門付款頁證據前，不將香港清單外推至 emperor-57011。
 */
const BY_CINEMA: Record<string, PaymentInfo> = {
  'emperor-57011': {
    methods: [],
    source: null,
    note: '用戶提供的英皇付款頁資料未確認澳門戲院的網頁購票方式；暫不套用香港英皇清單。',
    verified: false,
  },
};

/** 未知院線的兜底 */
const UNKNOWN: PaymentInfo = {
  methods: [],
  source: null,
  note: '未確認支付方式。',
  verified: false,
};

/**
 * 查詢某間戲院的支付方式
 *
 * @param cinemaId 戲院 id（如 'mcl-017'）—— 優先命中個別覆寫
 * @param source   院線
 */
export function paymentMethodsOf(cinemaId: string, source: string): PaymentInfo {
  return BY_CINEMA[cinemaId] ?? BY_SOURCE[source] ?? UNKNOWN;
}

/**
 * 某院線是否已確認支付方式
 *
 * UI 上對 verified:false 的院線顯示「支付方式待確認」而非具體列表。
 */
export function isPaymentVerified(source: string, cinemaId?: string): boolean {
  if (cinemaId) return paymentMethodsOf(cinemaId, source).verified;
  return BY_SOURCE[source]?.verified ?? false;
}

/**
 * 取得所有已確認支付方式的院線列表（用於篩選選項）
 *
 * 返回 [{ value: source, label: 院線名, methods: [...] }]
 */
export function getVerifiedPaymentSources(): { source: string; methods: PaymentMethod[] }[] {
  return Object.entries(BY_SOURCE)
    .filter(([, info]) => info?.verified && info.methods.length > 0)
    .map(([source, info]) => ({ source, methods: info!.methods }));
}

/**
 * 取得所有出現過的支付方式（用於篩選下拉選項）
 *
 * 只從 verified:true 的院線收集，避免把未確認的支付方式放進篩選器。
 */
export function getAllPaymentMethods(): PaymentMethod[] {
  const set = new Set<PaymentMethod>();
  for (const info of Object.values(BY_SOURCE)) {
    if (info?.verified) {
      for (const m of info.methods) set.add(m);
    }
  }
  return [...set];
}
