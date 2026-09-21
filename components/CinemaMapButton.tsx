'use client';

import { useState } from 'react';
import { CinemaMapDialog } from './CinemaMapDialog';

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
}: {
  cinemaId: string;
  name: string;
  address: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hkm-btn-ghost mt-3 inline-block rounded-full px-3.5 py-1.5 text-xs"
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
