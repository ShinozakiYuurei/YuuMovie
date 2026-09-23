import type { Metadata } from 'next';
import { getUpcomingGroupsByMonth, getMeta } from '@/lib/data';
import { MovieGroupCard } from '@/components/MovieGroupCard';
import { formatMonth } from '@/lib/format';

// 动态渲染：数据运行时读取

export const metadata: Metadata = {
  title: '即將上映電影',
  description: '香港即將上映電影一覽，按月歸類，包含上映日期、片長及場次資訊。',
};

/**
 * 即将上映（按月归类）
 *
 * 为什么不按具体日期分组：待映片开画日很分散（实测 25 部散在 13 个日期上），
 * 按日分组会让几乎每个小节只有 1 部，页面被标题切碎。
 * 按月后只剩 6 个分组（10 月 15 部），一眼能看出「这个月有什么」。
 */
export default function UpcomingPage() {
  const months = getUpcomingGroupsByMonth();
  const meta = getMeta();
  const total = months.reduce((n, m) => n + m.groups.length, 0);

  return (
    <>
      <section className="mb-7">
        <h1 className="text-3xl font-bold tracking-tight">
          即將<span className="hkm-grad-text">上映</span>
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          共 {total} 部電影，按月歸類，月內按上映日期排列。
        </p>
      </section>

      {months.map((m) => (
        <section key={m.month} className="mb-9">
          <div className="mb-3.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline pb-2.5">
            <h2 className="text-lg font-semibold tracking-tight text-fg">
              {m.month === '未定' ? '上映日期未定' : formatMonth(m.month)}
            </h2>
            <span className="ml-auto text-xs text-fg-dim">{m.groups.length} 部</span>
          </div>
          <div className="hkm-stagger grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {m.groups.map((grp, i) => (
              <div
                key={grp.key}
                style={{ '--i': i } as React.CSSProperties}
                className="h-full"
              >
                {/* 首屏优先级：仅当月第一行（5 张），见 PosterImage.tsx 注释 */}
                <MovieGroupCard group={grp} priority={i < 5} />
              </div>
            ))}
          </div>
        </section>
      ))}

      {months.length === 0 && <p className="py-20 text-center text-fg-dim">暫無即將上映資料</p>}
    </>
  );
}
