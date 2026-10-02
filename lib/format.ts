/** 格式化香港时间：从 ISO(+08:00) 取 HH:mm */
export function formatTime(iso: string): string {
  return iso.slice(11, 16);
}

/** 格式化日期：2026-09-17 → 9月17日（週四） */
const WD = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export function formatDate(iso: string): string {
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return `${m}月${day}日（${WD[wd]}）`;
}

export function formatDateShort(iso: string): string {
  const d = iso.slice(0, 10);
  const [, m, day] = d.split('-').map(Number);
  return `${m}/${day}`;
}

/**
 * 格式化月份：2026-10-08 → 2026年10月
 *
 * 用于「即将上映」按月归类的小节标题。带上年份是必要的：
 * 片单会跨年（当前数据里 2026-09 ~ 2027-03），只写「10月」会有两个。
 */
export function formatMonth(iso: string): string {
  const d = (iso || '').slice(0, 10);
  const [y, m] = d.split('-').map(Number);
  if (!y || !m) return '上映日期未定';
  return `${y}年${m}月`;
}

/** 星期几的简写：週四（用于日期条第二行，与 formatDate 的括号写法区分） */
export function weekdayShort(iso: string): string {
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split('-').map(Number);
  return WD[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
}

export function formatDuration(min: number | null): string {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}小時${m}分` : `${m}分鐘`;
}

/**
 * 时长（紧凑版）：94 → 「94分鐘」，134 → 「134分鐘」
 *
 * ★ 与 formatDuration 的区别（2026-09-21 新增）：
 *   formatDuration 输出「1小時34分」，是**口语化**写法，适合详情页
 *   （那里有充足横向空间，且是句读式阅读）。
 *   但海报卡片的信息行是「数字 + 单位」的并列结构（`$40 起`、评分 `7.9`），
 *   「1小時34分」在这里会显得零碎，且与旁边的票价长度不一致 ——
 *   改用「134分鐘」后，时长与票价同为「数值 + 量词」形态，一眼可比较。
 *
 * 为什么不写成「2.2小時」：分钟的精度对选片有意义（90 vs 94 分钟），
 * 小时小数反而要心算。统一用分钟，单位一致才可比。
 */
export function formatDurationShort(min: number | null): string {
  if (!min) return '—';
  return `${min}分鐘`;
}

/**
 * 相對今天的天數描述：今天／明天／後天／N 天後／已過 N 天
 *
 * @param now 當前時間（epoch ms）。**傳 null 表示「時間未知」→ 回傳 null**
 *
 * ★ 為什麼「現在」必須由調用方傳入，而不是在這裡 new Date()（2026-10-02 修復）
 *
 *   本站是 SSG（output: 'export'），頁面每 2–6 小時才重建一次，而
 *   「今天／明天／後天」是相對**瀏覽時刻**的：構建時算好寫進 HTML 的相對
 *   日期，一過香港午夜就會錯位 —— 用戶實測首頁與 /upcoming 顯示
 *   「明天上映」，其實當天已經上映了。抓取、重建頻率再高也治不了：
 *   相對日期永遠會過期，唯一能貼著時鐘走的只有瀏覽器裡的 JS。
 *
 *   所以把時間交給調用方：
 *     · 服務端（首屏 HTML）傳 null → 不輸出相對日期，HTML 不含時間主張
 *     · 客戶端掛載後傳真實時間 → 才顯示「今天／明天／後天」
 *   與 lib/live.ts 的 isLiveShow()、lib/use-live-now.ts 是同一套取捨。
 */
export function relativeDay(date: string, now: number | null): string | null {
  if (now == null) return null;
  // 「今天」按香港時區（UTC+8）判定：香港站的一天就是香港的一天，
  // 不該因為訪客身在日本而提前一小時跨日。
  const todayStr = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
  const diff = Math.round(
    (new Date(date + 'T00:00:00Z').getTime() - new Date(todayStr + 'T00:00:00Z').getTime()) / 86400_000
  );
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '後天';
  if (diff < 0) return `已過 ${-diff} 天`;
  return `${diff} 天後`;
}
