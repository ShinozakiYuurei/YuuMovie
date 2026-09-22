/**
 * 「已開映場次」的實時判定（服務端與客戶端共用）
 *
 * ===== 為什麼需要它（2026-09-22 用戶回報的 bug）=====
 *
 * 本站是 SSG（next.config.ts 的 output: 'export'），nginx 直接發 out/ 裡的
 * 純 HTML —— **頁面內容在構建那一刻就定稿了**。
 *
 * lib/data.ts 的 load() 確實會按「當前時間」剔除已開映場次，但那個「當前時間」
 * 是**構建時間**。定時器每 3 小時才重建一次，於是構建之後才開映的場次會一直
 * 留在頁面上，直到下一次重建 —— 用戶 22:01 在《歡迎來龍餐館》頁面看到
 * 20:50 的場次（早已開映）就是這個原因。
 *
 * 抓取頻率再高也治不了：場次時間在持續流逝，任何「定時重建」都必然有窗口。
 * 唯一能貼著時鐘走的只有**用戶瀏覽器裡的 JS**。
 *
 * 因此把判定抽成這個零依賴純模組：
 *   - 服務端（lib/data.ts）在構建時用它過濾一次，HTML 不至於帶上早已過期的場次
 *   - 客戶端（components/ShowtimeExplorer.tsx、components/CinemaShowtimes.tsx）
 *     在**掛載後**再過濾一次，並隨時間推移自動剔除
 *
 * 兩端共用同一份規則，不會出現「服務端剔了、客戶端又放回來」的口徑分歧。
 */

/**
 * 場次時刻 → epoch ms
 *
 * startAt 形如 `2026-09-22T20:50:00+08:00`（帶時區偏移）。
 * 用 Date.parse 而不是自己切字串：偏移量顯式寫在串裡，
 * 解析結果與服務器/瀏覽器所在時區無關 —— 這一點很重要，
 * 香港站不該因為訪客身在日本就多看到一小時的場次。
 */
export function showStartMs(startAt: string | null | undefined): number | null {
  if (!startAt) return null;
  const t = Date.parse(startAt);
  return Number.isFinite(t) ? t : null;
}

/**
 * 這場次是否「仍可購買」（尚未開映）
 *
 * @param now 當前時間（epoch ms）。
 *            **傳 null 表示「時間未知」** —— 此時一律回 true（保留）。
 *
 * 為什麼 now 允許為 null：
 *   客戶端組件第一次渲染必須與服務端產物**逐字一致**，否則 React 會報
 *   hydration mismatch。而客戶端的 Date.now() 與構建時的 Date.now() 必然不同，
 *   所以首次渲染先傳 null（= 全部保留，等同構建結果），
 *   掛載後再傳真實時間重新過濾。詳見 lib/use-live-now.ts。
 *
 * 邊界（與 lib/data.ts 原有邏輯逐條對齊，不可隨意改）：
 *   - startAt 缺失        → 剔除（連時間都沒有的場次沒有展示價值）
 *   - startAt 無法解析    → **保留**（寧可多顯示，也不要因數據髒而吞掉場次）
 *   - 恰好等於 now        → 保留（>= 而非 >，與構建時一致）
 */
export function isLiveShow(startAt: string | null | undefined, now: number | null): boolean {
  if (now == null) return true;
  if (!startAt) return false;
  const t = showStartMs(startAt);
  if (t == null) return true; // 時間異常時保留
  return t >= now;
}

/**
 * 客戶端重新過濾的間隔
 *
 * 60 秒：與構建層的 DATA_CACHE_TTL_MS 同量級，取捨也相同 ——
 * 已開映的場次最多多留 1 分鐘（對比修復前的「最多 3 小時」已是量級改善），
 * 而每分鐘只重算一次很小的數組，不會造成可感知的卡頓。
 *
 * 不做得更短：場次粒度是 5 分鐘，30 秒與 60 秒在用戶感知上沒有差別，
 * 卻要多一倍的定時器喚醒（移動端會影響耗電）。
 */
export const LIVE_TICK_MS = 60_000;
