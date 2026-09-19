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

export function formatDuration(min: number | null): string {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}小時${m}分` : `${m}分鐘`;
}

/** 相对今天的天数描述 */
export function relativeDay(date: string): string {
  const today = new Date();
  const todayStr = new Date(today.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const diff = Math.round(
    (new Date(date + 'T00:00:00Z').getTime() - new Date(todayStr + 'T00:00:00Z').getTime()) / 86400_000
  );
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '後天';
  if (diff < 0) return `已過 ${-diff} 天`;
  return `${diff} 天後`;
}
