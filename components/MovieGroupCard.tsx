import Link from 'next/link';
import { PosterImage } from './PosterImage';
import type { MovieGroup } from '@/lib/data';
import { formatLabel } from '@/lib/data';
import { formatDuration, relativeDay } from '@/lib/format';
import { computeCardRating, ratingTitle } from '@/lib/rating';

/**
 * 电影卡片（合并版本）
 *
 * 海报区域：
 *   只有海报本身，不叠任何角标
 *   （分级角标、版本数角标、底部版本 tag 与语言标签均已移除：用户偏好更干净的卡片）
 *
 * 文字区域：
 *   标题 / 英文片名
 *   上映中：时长 · 场次 · 起价
 *   待映：相对天数 + 上映日期
 *   格式版本（IMAX / 4DX …；无格式标记则显示「原版」）
 *   右下角：綜合評分徽章（(IMDb + 豆瓣) ÷ 2，只有一方时直接用那一方）
 *
 * 标题：单行中文，过长截断（hover 显示全名）；不再另起一行显示外文名
 */
export function MovieGroupCard({
  group,
  priority = false,
}: {
  group: MovieGroup;
  /**
   * 首屏可见的卡片传 true：海报立即加载并提高抓取优先级。
   *
   * ★ 为什么需要（2026-09-19 实测）：线上首页 16 张海报**全部**是
   *   loading="lazy"（0 张 eager），包括首屏第一行。lazy 要等浏览器
   *   完成布局、判定接近视口后才发请求，对首屏图等于凭空多一轮串行等待，
   *   直接推后 LCP。详见 components/PosterImage.tsx 的注释。
   *
   *   默认 false，由调用方按「是否首屏」显式开启 —— 避免全部卡片
   *   都抢带宽，反而拖慢真正的 LCP 元素。
   */
  priority?: boolean;
}) {
  const m = group.primary;
  // ★ 海报用 group.displayPoster 而不是 primary.poster：
  //   primary 按「原版优先 + 场次最多」选，与海报清晰度无关，
  //   而 MCL 只提供 290×390、其他院线给 800×1125（见 pickDisplayPoster）。
  //   兜底回 primary.poster：极端情况下（没跑过抓图）两者相同，不会白图。
  const poster = group.displayPoster || m.poster;
  // 综合评分：两边都有取平均，只有一边用那一边，都没有则整块不渲染
  const rating = computeCardRating(group.enrich);

  return (
    <Link
      href={`/movie/${group.slug}`}
      className="hkm-glass group flex h-full flex-col overflow-hidden rounded-2xl"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-black">
        {poster ? (
          <PosterImage
            src={poster}
            alt={group.displayName}
            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            priority={priority}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-fg-dim">
            無海報
          </div>
        )}

      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {/* 单行中文标题：过长截断，hover 显示全名 */}
        <h3
          className="line-clamp-1 text-[13px] font-semibold leading-snug tracking-tight text-fg"
          title={group.displayName}
        >
          {group.displayName}
        </h3>

        <div className="mt-auto pt-2">
          {group.status === 'upcoming' && m.openingDate ? (
            <p className="text-[11px] font-medium text-accent">
              {relativeDay(m.openingDate)}上映 · {m.openingDate}
            </p>
          ) : (
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-fg-muted">
              <span>{group.displayDuration ? formatDuration(group.displayDuration) : '—'}</span>
              {group.totalShows > 0 && (
                <>
                  <span className="text-fg-faint">·</span>
                  <span>{group.totalShows} 場</span>
                </>
              )}
              {group.minPrice != null && (
                <>
                  <span className="text-fg-faint">·</span>
                  <span className="font-medium text-fg-soft">${group.minPrice} 起</span>
                </>
              )}
            </p>
          )}

          {/* 格式版本（替代此前的院线）+ 右下角综合评分 */}
          <div className="mt-1.5 flex items-end justify-between gap-2">
            <span className="hkm-chip min-w-0 truncate">
              {group.allFormats.length > 0
                ? group.allFormats
                    .slice(0, 2)
                    .map(formatLabel)
                    .join(' · ') +
                  (group.allFormats.length > 2 ? ` +${group.allFormats.length - 2}` : '')
                : '原版'}
            </span>

            {rating && (
              <span
                className={`hkm-score hkm-score-${rating.source} shrink-0`}
                title={ratingTitle(rating)}
              >
                <span className="hkm-score-value">{rating.value.toFixed(1)}</span>
                <span className="hkm-score-label">{rating.label}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}