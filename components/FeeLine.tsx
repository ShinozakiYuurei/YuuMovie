import { FEE_NO_ONLINE } from '@/lib/booking-fee';

/**
 * 手續費文字（場次頁 / 戲院列表頁 / 戲院詳情頁共用）
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
 * 手續費是次要文字資訊，獨立一行展示；不套用玻璃、底色、描邊或膠囊外觀。
 * 文案順序使用「手續費 $xx」，未知金額顯示「手續費待確認」。
 *
 * ===== 未確認的處理 =====
 *
 * 未確認時不再顯示「—」——那個破折號看起來像壞掉的數字。
 * 改為「手續費待確認」，並只把字色調弱（.hkm-fee--unknown）。
 *
 * ★ 不加虛線邊框、不加任何額外裝飾：用戶明確要求「不要做成虛線藥丸，
 *   寧可留空也不要猜數字；未確認灰字弱化即可」。
 *   弱化到「看得見但不搶眼」就夠了，再加裝飾反而把注意力拉到一個
 *   沒有答案的欄位上。
 *
 * ★ 只改狀態的呈現方式，不編數字：院方沒有公開的固定金額時，
 *   仍然是「沒有數字」，只是不再顯示成一個破折號。
 */
export function FeeLine({
  amount,
  note,
  className = '',
  variant = 'default',
}: {
  /**
   * 每張戲票手續費（HKD）
   *  >= 0 金額（0 = 免手續費）／-1 待確認／-2 不設網上購票（FEE_NO_ONLINE）
   */
  amount: number;
  /** hover 說明：寫明 0 元的來歷（會員豁免）與是否已含在票價內 */
  note: string;
  /** 各頁面自己的外距（如 'mt-1'）；文字樣式由 .hkm-fee 統一給 */
  className?: string;
  /** 'onPhoto'：壓在場館照上時渲染為與地圖按鈕一致的磨砂玻璃膠囊（2026-10-11） */
  variant?: 'default' | 'onPhoto';
}) {
  const text =
    amount === FEE_NO_ONLINE
      ? '不設網上購票'
      : amount < 0
        ? '手續費待確認'
        : `手續費 $${amount}`;

  if (variant === 'onPhoto') {
    return (
      <span
        className={`inline-flex items-center rounded-full border border-white/30 bg-black/40 px-3.5 py-1.5 text-xs font-medium text-white/95 backdrop-blur-sm tabular-nums ${amount < 0 ? 'text-white/75' : ''} ${className}`}
        title={note}
      >
        {text}
      </span>
    );
  }

  return (
    <span
      className={`hkm-fee ${amount < 0 ? 'hkm-fee--unknown' : ''} ${className}`}
      title={note}
    >
      {text}
    </span>
  );
}
