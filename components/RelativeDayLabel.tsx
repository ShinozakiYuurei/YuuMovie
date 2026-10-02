'use client';

import { useEffect, useState } from 'react';
import { relativeDay } from '@/lib/format';

/** 香港時區（UTC+8）下一個零點的 epoch ms */
function nextHkMidnight(now: number): number {
  const HK = 8 * 3600_000;
  return (Math.floor((now + HK) / 86400_000) + 1) * 86400_000 - HK;
}

/**
 * 「今天／明天／後天／N 天後」標籤：**掛載後**才計算，構建產物裡沒有它
 *
 * ===== 為什麼不能在服務端算 =====
 *
 * 本站是 SSG（output: 'export'），HTML 在構建那一刻定稿，而頁面每 2–6 小時
 * 才重建一次；相對日期卻跟著**瀏覽時刻**走 —— 構建時算好的「明天上映」，
 * 一過香港午夜就變成錯的（用戶實測：首頁與 /upcoming 的卡片跨天後錯位），
 * 且要等到下一次重建才自行修正。
 *
 * 所以相對日期只能在瀏覽器裡算：服務端（首屏）不輸出任何相對日期，
 * 掛載後才補上。這與 lib/use-live-now.ts 剔除已開映場次是同一套取捨 ——
 * 首次渲染與構建產物一致（這裡是「都不顯示」），掛載後才貼近真實時間。
 *
 * ===== 為什麼不是每分鐘 tick =====
 *
 * 相對日期一天只變一次（香港午夜），沒有必要像場次剔除那樣每分鐘重算。
 * 這裡是「掛載時算一次 + 只在下一個香港零點醒來」，外加回到前台時補算
 * （背景標籤頁的計時器會被節流甚至暫停，手機鎖屏再解鎖就是這種情況）。
 * 一張卡片一個沉睡的 timeout，一天只觸發一次。
 */
export function RelativeDayLabel({ date }: { date: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setLabel(relativeDay(date, Date.now()));
    update(); // 掛載後立即算一次，不必等到午夜

    let timer = 0;
    const armMidnight = () => {
      // +1 秒越過零點，避免計時器精度讓回調落在 23:59:59.999
      timer = window.setTimeout(() => {
        update();
        armMidnight();
      }, nextHkMidnight(Date.now()) - Date.now() + 1000);
    };
    armMidnight();

    const onVisible = () => {
      if (document.visibilityState === 'visible') update();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [date]);

  return <>{label}</>;
}
