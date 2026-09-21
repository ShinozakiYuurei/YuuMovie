/**
 * 網上購票手續費（每張戲票）
 *
 * ===== 為什麼單獨一個純模塊 =====
 *
 * 場次頁（ShowtimeExplorer）與壓縮傳輸層（lib/compact.ts）都要用它，
 * 而 compact.ts 必須零 node 依賴（要打進瀏覽器 bundle，見該文件頭註釋）。
 * 因此這裡只做**純函數 + 常量表**，不引 node:fs / node:path。
 *
 * ===== 口徑（用戶 2026-09-21 指定）=====
 *
 * 用戶原話：「註冊會員免手續費，也算免手續費。按官方口徑。」
 *
 * 即：**取該院線一般觀眾最可能實際付出的手續費**。
 * 若官網明示「登記（免費）會員即免」，則記 0 —— 因為註冊本身免費，
 * 任何人不花錢就能拿到免手續費的價格，把它當成 0 才符合用戶比價的直覺。
 * 反之，像百老匯的 Insight Pass 手續費連「免費戲票」都要收，
 * 沒有任何豁免途徑，就必須記 10。
 *
 * ===== 各院線數字出處（2026-09-21 實查，非猜測）=====
 *
 *  百老匯  $10  官網 FAQ：「於網上購票，需收取每張戲票HK$10手續費。」
 *               無會員豁免 —— 條款頁明寫連 Insight Pass 的免費戲票
 *               也要付「每張戲票之手續費為港幣$10」，故 scope = all。
 *  MCL     $10  官網 FAQ：「於MCL戲院網頁或手機App訂票，須每票支付HK$10手續費；
 *               在任何情況下，手續費將不設退回。」官網未提會員豁免。
 *  英皇    $0   訂票頁備註：「免費登記成為CINEMER會員，以Facebook或Apple ID
 *               登入，即享全年網上購票免手續費。」非會員 $10（API ticketFee=1000）。
 *  Cinema City
 *          $8   icirena API `ticketFee: 800`；官網場次頁每場標「(包含手續費)」。
 *               會員優惠（85折 / 9折 / 積分）未含手續費豁免。
 *  星達    $0   官網 FAQ：「經星達院線官方網頁及手機應用程式訂票均收取每票$10手續費，
 *               如登記了網上會員則豁免手續費。」（同上，免費登記即免）
 *
 * ===== 維護提示 =====
 *
 * 手續費是**院線政策**，變動頻率遠低於場次資料，因此寫死在這裡而不是
 * 塞進每次抓取都會被覆寫的 data/*.json。
 * 改價時只需動下面一張表，然後重新 build（靜態導出會烤進 HTML）。
 */

import type { Source } from './types';

export interface BookingFee {
  /** 每張戲票手續費（HKD）。0 = 免手續費 */
  amount: number;
  /**
   * 一句話說明（顯示為 hover 提示）
   *
   * 必須寫清楚「0 是怎麼來的」—— 否則用戶看到 $0 會以為永遠免費，
   * 到了付款頁才發現非會員要加錢，比不顯示更糟。
   */
  note: string;
  /** 說明這筆費用是「含在顯示票價裡」還是「結帳時外加」（後綴文案見 feeSuffix） */
  included: boolean;
}

/** 院線預設（同一院線全線一致，故按 source 而非按戲院） */
const BY_SOURCE: Record<Source, BookingFee> = {
  broadway: {
    amount: 10,
    note: '百老匯官網：於網上購票，每張戲票收取 HK$10 手續費（結帳時外加，無會員豁免）。',
    included: false,
  },
  mcl: {
    amount: 10,
    note: 'MCL 官網：於網頁或手機 App 訂票，每票須付 HK$10 手續費（結帳時外加，不設退回）。',
    included: false,
  },
  emperor: {
    amount: 0,
    note: '英皇：免費登記 CINEMER 會員，以 Facebook 或 Apple ID 登入購票即免手續費（非會員每張 HK$10）。',
    included: false,
  },
  cinemacity: {
    amount: 8,
    note: 'Cinema City：每張戲票手續費 HK$8，已包含在顯示票價內，結帳時不再外加。',
    included: true,
  },
  bestar: {
    amount: 0,
    note: '星達：免費登記網上會員即免手續費（非會員每張 HK$10）。',
    included: false,
  },
};

/**
 * 個別戲院覆寫
 *
 * 目前為空 —— 五條院線的手續費都是「全線一致」。
 * 保留這張表是為了避免日後出現例外時去改函數邏輯：
 * 例如某間戲院退出免手續費名單，只需在這裡加一條。
 */
const BY_CINEMA: Record<string, BookingFee> = {};

/** 未知院線的兜底：不顯示數字比顯示錯的數字好 */
const UNKNOWN: BookingFee = {
  amount: 0,
  note: '手續費以院線官方公佈為準。',
  included: false,
};

/**
 * 解析某間戲院的網上手續費
 *
 * @param cinemaId 戲院 id（如 'mcl-017'）—— 優先命中個別覆寫
 * @param source   院線
 */
export function bookingFeeOf(cinemaId: string, source: Source): BookingFee {
  return BY_CINEMA[cinemaId] ?? BY_SOURCE[source] ?? UNKNOWN;
}

/**
 * 手續費行的文案（純文字，供 SEO / 測試 / 非 JSX 場景使用）
 *
 * ★ 2026-09-21 用戶最終定稿：「算了，還是換成"$xx 手續費"這樣子，
 *   然後統一下長度，個位數的 8 元和兩位數的 10 元，最後的長度一樣」
 *
 * 即：**不再加「（已含於票價）/（結帳另加）」後綴**，回到最簡的「$xx 手續費」。
 *   含不含的差異仍可看 hover（note 裡寫得很清楚）。
 *
 * ★ 頁面渲染請用 components/FeeLine.tsx，不要直接用這個函數。
 *   原因：長度對齊（$8 / $10 一樣寬）需要金額單獨成為一個元素、
 *   掛上 .hkm-num，純字串做不到。這個函數只給需要「一行文字」的場合。
 */
export function feeText(amount: number): string {
  return `$${amount} 手續費`;
}
