import Link from 'next/link';
import { getShowingGroups, getMeta, formatLabel } from '@/lib/data';
import { MovieGroupCard } from '@/components/MovieGroupCard';

// 动态渲染：数据从 data/*.json 实时读取，抓取后无需重建

export default function HomePage() {
  const all = getShowingGroups();
  // 低配 VPS（2C2G）优化：首页只渲染前 60 组。
  // 数据涨到 275 部后，整页渲染会让 HTML 达到 700KB+、TTFB 0.5s+，
  // 首屏变得很慢。60 组足以覆盖全部热映片（其余多为长尾/无场次）。
  const groups = all.slice(0, 60);
  const meta = getMeta();
  const hiddenCount = all.length - groups.length;

  return (
    <>
      <section className="mb-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              現正<span className="bg-gradient-to-r from-[#8b7cff] to-[#22d3ee] bg-clip-text text-transparent">上映</span>
            </h1>
            <p className="mt-2 text-sm text-gray-400">
              點擊電影查看全部版本（IMAX / 4DX / 全景聲等）及場次，直接跳轉院線官方購票頁。
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <span className="hkm-chip">{groups.length} 部電影</span>
            <span className="hkm-chip">{meta.counts.shows} 場次</span>
          </div>
        </div>
      </section>

      {/* hkm-stagger：纯 CSS 逐个入场（--i 传入序号做延时，见 globals.css） */}
      <div className="hkm-stagger grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {groups.map((g, i) => (
          <div key={g.key} style={{ '--i': i } as React.CSSProperties} className="h-full">
            <MovieGroupCard group={g} />
          </div>
        ))}
      </div>

      {groups.length === 0 && <p className="py-20 text-center text-gray-500">暫無上映資料</p>}

      {hiddenCount > 0 && (
        <p className="mt-6 text-center text-xs text-gray-500">
          另有 {hiddenCount} 部上映中電影，可從「戲院」頁按戲院查看場次
        </p>
      )}

      <div className="hkm-glass mt-12 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-white">即將上映</h2>
            <p className="mt-1 text-sm text-gray-400">
              共 {meta.counts.upcoming} 部電影等待上映，查看上映日期與預告片。
            </p>
          </div>
          <Link href="/upcoming" className="hkm-btn-primary rounded-full px-4 py-2 text-xs font-semibold">
            查看全部 →
          </Link>
        </div>
      </div>
    </>
  );
}
