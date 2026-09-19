import Link from 'next/link';
import { getShowingGroups, getUpcomingGroups, getMeta } from '@/lib/data';
import type { MovieGroup } from '@/lib/data';
import { MovieGroupCard } from '@/components/MovieGroupCard';

/**
 * 首页
 *
 * 结构：两个区块，各「卡片条 + 8 张海报」
 *   1. 現正上映：卡片条点击进 /showing（全部上映中）
 *   2. 即將上映：卡片条点击进 /upcoming
 *
 * 为什么只展示 8 张（用户 2026-09-19 指定）：
 *   原先首页铺 60 组，HTML 达 700KB+，在 2C2G 上首屏 TTFB 0.5s+。
 *   首页的职责是「指路」，不是「列全」—— 完整清单交给 /showing 与 /upcoming，
 *   它们是静态导出的独立页面，nginx 直接发文件，不拖累首页首屏。
 *
 * 排序：场次多者在前（getShowingGroups 已按 totalShows 降序）。
 *   ★ 即将上映的片场次恒为 0（尚未开卖，见 data），所以那一区实际退化为
 *     按上映日期排序 —— getUpcomingGroups 就是这么排的，符合直觉。
 */

/** 首页每个区块展示的海报数 */
const PER_SECTION = 8;

/** 卡片条：标题 + 副标题 + 「查看全部」按钮，整条可点 */
function SectionBar({
  href,
  title,
  subtitle,
  cta,
}: {
  href: string;
  title: React.ReactNode;
  subtitle: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="hkm-glass group/bar flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5"
    >
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white">{title}</h2>
        <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
      </div>
      <span className="hkm-btn-primary shrink-0 rounded-full px-4 py-2 text-xs font-semibold">
        {cta} →
      </span>
    </Link>
  );
}

/** 海报网格（首页固定 8 张） */
function PosterGrid({ groups }: { groups: MovieGroup[] }) {
  return (
    <div className="hkm-stagger mt-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4">
      {groups.map((g, i) => (
        <div key={g.key} style={{ '--i': i } as React.CSSProperties} className="h-full">
          {/*
           * 首屏优先级：只给**第一行**海报（前 4 张）开 priority。
           *
           * 为什么是 4：网格是 lg:grid-cols-4，第一行 4 张即首屏可见区域。
           * 为什么不全开：priority 会让图片立即请求并 fetchpriority=high，
           *   16 张同时抢带宽反而拖慢真正的 LCP 元素（浏览器并发连接有限，
           *   高优先级请求之间仍会互相排队）。只标首屏第一行收益最大。
           */}
          <MovieGroupCard group={g} priority={i < 4} />
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const showing = getShowingGroups().slice(0, PER_SECTION);
  const upcoming = getUpcomingGroups().slice(0, PER_SECTION);
  const meta = getMeta();

  return (
    <div className="space-y-10">
      {/* ── 現正上映 ── */}
      <section>
        <SectionBar
          href="/showing"
          title={
            <>
              現正
              <span className="bg-gradient-to-r from-[#8b7cff] to-[#22d3ee] bg-clip-text text-transparent">
                上映
              </span>
            </>
          }
          subtitle={`共 ${meta.counts.movies} 部電影 · ${meta.counts.shows} 場次，按排片場次排列。`}
          cta="查看全部"
        />
        <PosterGrid groups={showing} />
        {showing.length === 0 && (
          <p className="py-16 text-center text-gray-500">暫無上映資料</p>
        )}
      </section>

      {/* ── 即將上映 ── */}
      <section>
        <SectionBar
          href="/upcoming"
          title={
            <>
              即將
              <span className="bg-gradient-to-r from-[#8b7cff] to-[#22d3ee] bg-clip-text text-transparent">
                上映
              </span>
            </>
          }
          subtitle={`共 ${meta.counts.upcoming} 部電影等待上映，查看上映日期與場次。`}
          cta="查看全部"
        />
        <PosterGrid groups={upcoming} />
        {upcoming.length === 0 && (
          <p className="py-16 text-center text-gray-500">暫無即將上映資料</p>
        )}
      </section>
    </div>
  );
}
