/**
 * 手續費行（場次頁 / 戲院列表頁 / 戲院詳情頁共用）
 *
 * ===== 為什麼是一個組件，而不是各頁面自己寫 JSX =====
 *
 * 這一行在三個地方出現。2026-09-21 一天之內被用戶改了五次文案：
 *   「$10 手續費」→ 加「（已含）」→「（已含於票價）」→ 外加也補「（結帳另加）」
 *   → 全部去掉，回到「$xx 手續費」+ 統一長度
 *
 * 每次都是三處一起改，且中間確實漏改過一處（場次頁漏了，靠事後 grep 才發現）。
 * 抽成組件後，文案與樣式只有這一份，改一次三處同步。
 *
 * ===== 為什麼不是「回傳字串的純函數」（lib/booking-fee.ts 的 feeText）=====
 *
 * 因為長度對齊需要**金額單獨成為一個元素**：
 *   .hkm-num 給金額一個 min-width:3ch 的盒子，$8 與 $10 的右邊界才會對齊
 *   （見 app/globals.css 的說明）。
 * 一個純字串 "$8 手續費" 無法只給其中一段上樣式，故必須是組件。
 *
 * ===== 為什麼沒有 'use client' =====
 *
 * 它是純展示、無 hooks、無事件。被客戶端組件（ShowtimeExplorer）引入時
 * 會編進客戶端 bundle，被服務端組件（戲院詳情頁）引入時就在服務端渲染 ——
 * 兩邊都能用，不必也不該標 'use client'。
 */
export function FeeLine({
  amount,
  note,
  className = '',
}: {
  /** 每張戲票手續費（HKD）。0 = 免手續費，仍顯示 $0 */
  amount: number;
  /** hover 說明：寫明 0 元的來歷（會員豁免）與是否已含在票價內 */
  note: string;
  /** 各頁面自己的外距與字號（如 'mt-2 text-sm text-fg'） */
  className?: string;
}) {
  return (
    <p className={className}>
      {/*
       * 金額與「手續費」三字同色（用戶 2026-09-21：「把手續費的字體顏色
       * 和前面的金額一致」）—— 顏色由調用方的 className 統一給（text-fg）。
       *
       * .hkm-num 負責 $8 / $10 長度一致（用戶同日：「統一下長度，
       * 個位數的 8 元和兩位數的 10 元，最後的長度一樣」）。
       * ★ 左對齊而非右對齊：本行是「$ + 數字 + 手續費」整串左起排，
       *   右對齊會把 $ 推歪（實測 $0 起於 x=21、$10 起於 x=14），
       *   左對齊才能讓三者的起點全部一致。理由詳見 app/globals.css。
       * tabular-nums 讓 $10 內部兩個數字等寬。
       */}
      <span className="hkm-num font-semibold tabular-nums" title={note}>
        ${amount}
      </span>{' '}
      <span title={note}>手續費</span>
    </p>
  );
}
