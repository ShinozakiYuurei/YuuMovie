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
 * ===== 已確認院線數字出處（原有資料於 2026-09-21 實查）=====
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
 * ===== 新增院線補查（2026-09-25）=====
 *  華懋（chinachem） $5  官方 FAQ：網站網上購票每票收 HK$5.00 服務費。
 *       https://www.cel-cinemas.com/en/info/faq
 *  Lumen              $10 官方選票頁明列「The service charge is HK$10 for each ticket」。
 *       https://www.lumencinema.com.hk/Ticketing/visSelectTickets.aspx
 *  新寶（newport）    院線預設仍未確認：官方 FAQ 只稱每票「$6 or more」，不足以推定全線固定額。
 *       凱都戲院（屯門）分店資料另列 Online Admin Fee: HK$6，並由用戶確認按 $6 記錄，
 *       因此只在 BY_CINEMA 覆寫該分店；分店頁同時註明目前沒有網上售票，見該筆提示。
 *  其餘新增院線暫無足以確認統一金額的院方證據；不採用 HK Movie 6 的 fee 欄位。
 *
 * ===== 用戶指定金額（2026-09-26，非抓取證據）=====
 *  這幾項先前都查無官方公開的固定金額（停用設定或無網售），由用戶拍板後寫入。
 *  註解一律標明出處，避免後來的人誤以為有官方依據：
 *
 *   CGV（cgv）         $8   院方場次資料 online surcharge 設定
 *                          （surchargeGroups 名為「$$8」，price 8），
 *                          但 surchargeType 標為 active:false（停用）。
 *  影藝（cineart）     $10  同上，設定停用（Online transaction，price 10）。
 *  高先（goldenscene） $0   用戶指定免手續費；官網接 Tixis 但未公開價目。
 *  寶石（lux）         $0   用戶指定免手續費；HK Movie 6 標該院 purchasable=false
 *                          （沒有網上售票）。
 *                          ⚠️ 「免手續費」與「不能網上買」是兩回事：
 *                             若日後確認無網售，此項應改為表達「不設網上購票」。
 *
 *  至此 53 間戲院全數有確切金額，UI 不再出現「手續費待確認」。
 *
 * ===== 新光補查（2026-09-26）=====
 *  新光（sunbeam）   $10  官方購票站 www.sunbeamwhampoa.com 的結帳元件明列
 *       「手續費 (N張×$10)」，serviceFee 由票數 ×1000（分）計算得出；
 *       與票價小計分列、加總為應付總額，故屬結帳外加而非含在票價內。
 *       證據是院方自家結帳頁面的常數，不是推測，因此由「未確認」改記 $10。
 *       （站內另有 payment-processing-fee 模組，那是按付款方式計的支付通道費，
 *         與每票手續費是兩回事，不混用。）
 *
 * ===== 維護提示 =====
 *
 * 手續費是**院線政策**，變動頻率遠低於場次資料，因此寫死在這裡而不是
 * 塞進每次抓取都會被覆寫的 data/*.json。
 * 改價時只需動下面一張表，然後重新 build（靜態導出會烤進 HTML）。
 */

import type { Source } from './types';

export interface BookingFee {
  /** 每張戲票手續費（HKD）。0 = 免手續費，負值 = 未確認 */
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

/** 院線預設（已確認為全線一致時按 source；分店例外再用 BY_CINEMA） */
const BY_SOURCE: Partial<Record<Source, BookingFee>> = {
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
  chinachem: {
    amount: 5,
    note: '華懋院線官方 FAQ：網站網上購票每張戲票收 HK$5.00 服務費。',
    included: false,
  },
  lumen: {
    amount: 10,
    note: 'Lumen 官方網上選票頁列明每張戲票收 HK$10 服務費。',
    included: false,
  },
  // CGV / 影藝：院方場次資料的網上手續費設定（surchargeGroups）分別為每票 HK$8
  // 與 HK$10。兩者的 surchargeType 目前標為 active:false，先前因此判為停用、
  // 不認列；2026-09-26 用戶指定按此金額記錄，故在此寫死。
  // ★ note 必須保留「設定標為停用、以結帳金額為準」這句：
  //   這不是結帳實測值，寫清楚才不會被後來的人當成已驗證的收費。
  cgv: {
    amount: 8,
    note: 'CGV：院方場次資料的網上手續費設定為每票 HK$8（online surcharge）；該設定目前標為停用，實際以結帳金額為準。',
    included: false,
  },
  cineart: {
    amount: 10,
    note: '影藝：院方場次資料的網上交易手續費設定為每票 HK$10（Online transaction）；該設定目前標為停用，實際以結帳金額為準。',
    included: false,
  },
  // 高先 / 寶石：2026-09-26 用戶指定「免手續費」，記 0。
  //
  // ★ 這兩家先前查無官方公開的固定每票金額（高先接 Tixis 但未公開價目；
  //   寶石在 HK Movie 6 標 purchasable=false），所以一直維持「未確認」。
  //   現在的 0 是用戶拍板，不是抓到的證據 —— 註解寫清楚，
  //   後來的人改價時才不會誤以為這 0 有官方出處。
  //
  // ★ note 只對訪客說「免手續費」：内部查證過程不該出現在給訪客看的 hover。
  //
  // ⚠️ 待確認：寶石在 HK Movie 6 標 purchasable=false（該院沒有網上售票）。
  //   「免手續費」與「根本不能網上買」是兩回事 —— 若確認無網售，
  //   這一項將來應改為表達「不設網上購票」而非 $0。
  goldenscene: {
    amount: 0,
    note: '高先電影院：網上購票免手續費。',
    included: false,
  },
  lux: {
    amount: 0,
    note: '寶石戲院：網上購票免手續費。',
    included: false,
  },
  newport: {
    amount: -1,
    note: '新寶官方 FAQ 只列網上訂票每票 HK$6 或以上，未有確切固定金額；請以結帳金額為準。',
    included: false,
  },
  sunbeam: {
    amount: 10,
    note: '新光黃埔影藝城官方購票站結帳頁明列「手續費 (每張 ×HK$10)」，與票價分列、結帳時外加。',
    included: false,
  },
};

/**
 * 個別戲院覆寫
 *
 * 新寶院線 FAQ 的「HK$6 或以上」不作全線固定額；凱都戲院（屯門）分店資料
 * 明列 Online Admin Fee: HK$6，故只對這間戲院記錄固定 $6，不外推到其他分店。
 */
const BY_CINEMA: Record<string, BookingFee> = {
  'newport-hyland': {
    amount: 6,
    note: '凱都戲院（屯門）分店資料列 Online Admin Fee: HK$6；院線 FAQ 列網上購票每票 HK$6 起。分店頁亦註明目前沒有網上售票，實際收取方式以院方公布為準。',
    included: false,
  },
};

/** 未知院線的兜底：不顯示數字比顯示錯的數字好 */
const UNKNOWN: BookingFee = {
  amount: -1,
  note: '未確認手續費；請以院線官方購票頁結帳金額為準。',
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
 * 手續費的純文字文案（供 SEO / 測試 / 非 JSX 場景使用）
 *
 * ★ 2026-09-26 改版：配合用戶「手續費的文字和佈局看著突兀不協調」的要求，
 *   文案改為「標籤在前、金額在後」，未確認不再顯示破折號：
 *     「手續費 $10」/「手續費 $0」/「手續費待確認」
 *
 *   這同時取代了 2026-09-21 定稿的「$xx 手續費」（金額在前）——
 *   藥丸排在一起時，標籤起點一致才掃得快。
 *
 * ★ 頁面渲染請用 components/FeeLine.tsx，不要直接用這個函數。
 *   原因：藥丸是 inline-flex 的盒子（.hkm-chip + .hkm-fee），
 *   未確認還要另外掛 .hkm-fee--unknown 的虛線樣式，純字串做不到。
 *   這個函數只給需要「一行文字」的場合（如 SEO 描述、測試斷言）。
 */
export function feeText(amount: number): string {
  return amount < 0 ? '手續費待確認' : '手續費 $' + amount;
}
