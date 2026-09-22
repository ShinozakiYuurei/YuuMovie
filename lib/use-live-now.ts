'use client';

import { useEffect, useState } from 'react';
import { LIVE_TICK_MS } from './live';

/**
 * 「當前時間」hook：給客戶端組件做實時剔除已開映場次用
 *
 * ===== 為什麼第一次回傳 null =====
 *
 * 本站是 SSG：客戶端組件的首屏 HTML 是**構建時**渲染出來的，
 * 瀏覽器拿到的就是那份 HTML，React 隨後 hydrate 時必須產出**完全相同**的樹。
 *
 * 若首次渲染就直接回傳 Date.now()，那麼「構建時尚未開映、用戶打開時已開映」
 * 的那些場次就會在 hydrate 時憑空消失 —— React 判定為 hydration mismatch
 * （HTML 有、JS 渲染沒有），報錯並整棵樹回退成客戶端渲染，得不償失。
 *
 * 所以刻意分兩步：
 *   1. 首次渲染回傳 null → isLiveShow 一律保留 → 與構建產物逐字一致，無警告
 *   2. 掛載後（useEffect 內）才寫入真實時間 → 過期的場次此時才消失
 *
 * 代價是「已開映場次在 JS 跑起來前會短暫可見」。對比修復前的
 * 「一直可見直到下一次重建（最多 3 小時）」，這個代價完全可以接受，
 * 而且它只在慢網絡/禁用 JS 的邊緣情況下才被察覺。
 *
 * ===== 為什麼還要監聽 visibilitychange =====
 *
 * 移動端瀏覽器（以及後台的桌面標籤頁）會把 setInterval 節流甚至完全暫停。
 * 用戶晚上 21:00 打開頁面、手機鎖屏、22:00 再打開 —— 期間定時器一次都沒跑，
 * 頁面上還留著 21:30 的場次。回到前台時補一次 tick 就能立刻修正。
 */
export function useLiveNow(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick(); // 掛載後立即對齊一次，不必等第一個間隔

    const timer = window.setInterval(tick, LIVE_TICK_MS);
    const onVisible = () => {
      // 只在回到前台時補算；轉到後台不用管（反正沒人看）
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return now;
}
