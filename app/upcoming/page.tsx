import type { Metadata } from 'next';
import { getUpcomingGroupsByDate, getMeta } from '@/lib/data';
import { MovieGroupCard } from '@/components/MovieGroupCard';
import { relativeDay } from '@/lib/format';

// 动态渲染：数据运行时读取

export const metadata: Metadata = {
  title: '即將上映電影',
  description: '香港即將上映電影一覽，包含上映日期、片長、預告片及購票資訊。',
};

export default function UpcomingPage() {
  const allDates = getUpcomingGroupsByDate();
  const meta = getMeta();

  // 同首页：限制渲染总量，避免 HTML 过大拖慢首屏（2C2G VPS）
  const MAX_UPCOMING = 60;
  let budget = MAX_UPCOMING;
  const groups = allDates
    .map((g) => {
      const take = Math.max(0, Math.min(budget, g.groups.length));
      budget -= take;
      return { ...g, groups: g.groups.slice(0, take) };
    })
    .filter((g) => g.groups.length > 0);

  const total = allDates.reduce((n, g) => n + g.groups.length, 0);

  return (
    <>
      <section className="mb-7">
        <h1 className="text-3xl font-bold tracking-tight">
          即將<span className="bg-gradient-to-r from-[#8b7cff] to-[#22d3ee] bg-clip-text text-transparent">上映</span>
        </h1>
        <p className="mt-2 text-sm text-gray-400">共 {total} 部電影，按上映日期排列。</p>
      </section>

      {groups.map((g) => (
        <section key={g.date} className="mb-9">
          <div className="mb-3.5 flex items-baseline gap-3 border-b border-white/8 pb-2.5">
            <h2 className="text-lg font-semibold tracking-tight text-white">{g.date}</h2>
            <span className="hkm-chip text-accent">{relativeDay(g.date)}</span>
            <span className="ml-auto text-xs text-gray-500">{g.groups.length} 部</span>
          </div>
          <div className="hkm-stagger grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {g.groups.map((grp, i) => (
              <div
                key={grp.key}
                style={{ '--i': i } as React.CSSProperties}
                className="h-full"
              >
                <MovieGroupCard group={grp} />
              </div>
            ))}
          </div>
        </section>
      ))}

      {groups.length === 0 && <p className="py-20 text-center text-gray-500">暫無即將上映資料</p>}
    </>
  );
}
