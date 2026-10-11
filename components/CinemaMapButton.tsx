'use client';

import { useState } from 'react';
import { CinemaMapDialog, preloadLeaflet } from './CinemaMapDialog';

/**
 * 戲院詳情頁的地圖按鈕 + 彈層
 *
 * ===== 為什麼需要這個薄包裝 =====
 *
 * app/cinema/[id]/page.tsx 是**服務端組件**（靜態導出時在構建期渲染），
 * 而彈層需要 useState 管理開關、且要動態載入 Leaflet（瀏覽器 API）。
 * 服務端組件不能直接用 state，所以把「按鈕 + 彈層」這對綁定抽成
 * 一個最小的客戶端組件 —— 頁面本身仍保持服務端渲染。
 *
 * 只傳三個字串（id / name / address）而不是整個 Cinema 物件：
 * 這是 RSC 邊界，傳得越少序列化成本越低，也避免把 mapUrl 等
 * 已不再使用的欄位帶過去。
 */
export function CinemaMapButton({
  cinemaId,
  name,
  address,
  variant = 'default',
}: {
  cinemaId: string;
  name: string;
  address: string;
  /**
   * 'onPhoto'：按鈕壓在場館照上時用白色玻璃（2026-10-11）
   *
   * ★ 為什麼需要一個變體：預設的 .hkm-btn-ghost 用的是主題令牌
   *   （--hkm-ghost-*），它在畫布色上有足夠對比，但壓在一張明暗不定的
   *   照片上就不一定 —— 遇到亮照片時灰字會糊進背景。
   *   白色玻璃 + 深色陰影在照片上兩種明暗都成立。
   *
   * ★ 為什麼是變體而不是把預設樣式也改成白色：沒有照片的戲院頁
   *   （新光黃埔、英皇戲院總部）用的是純文字頭部，那裡白色按鈕
   *   在淺色主題下會直接消失。兩處背景性質不同，樣式就該不同。
   */
  variant?: 'default' | 'onPhoto';
}) {
  const [open, setOpen] = useState(false);
  const className =
    variant === 'onPhoto'
      ? 'inline-block rounded-full border border-white/30 bg-black/35 px-3.5 py-1.5 text-xs text-white backdrop-blur-sm transition hover:border-white/60 hover:bg-black/50'
      : 'hkm-btn-ghost mt-3 inline-block rounded-full px-3.5 py-1.5 text-xs';

  return (
    <>
      <button
        type="button"
        onMouseEnter={preloadLeaflet}
        onFocus={preloadLeaflet}
        onClick={() => setOpen(true)}
        className={className}
      >
        在地圖開啟
      </button>
      {open && (
        <CinemaMapDialog
          cinemaId={cinemaId}
          name={name}
          address={address}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}