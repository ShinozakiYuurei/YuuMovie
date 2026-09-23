import Link from 'next/link';
import { PosterImage } from './PosterImage';
import type { MovieGroup } from '@/lib/data';
import { formatDurationShort, relativeDay } from '@/lib/format';
import { computeCardRating, ratingTitle } from '@/lib/rating';

/**
 * 电影卡片（合并版本）
 *
 * 海报区域：
 *   只有海报本身，不叠任何角标
 *   （分级角标、版本数角标、底部版本 tag 与语言标签均已移除：用户偏好更干净的卡片）
 *
 * 文字区域（2026-09-21 精简）：
 *   标题（中文，单行截断）
 *   上映中：时长 · 起价
 *   待映：相对天数 + 上映日期
 *   右侧：评分（纯黄文字）
 *
 * ★ 2026-09-21 用户要求去掉的四个元素及理由：
 *   1. 格式标签（IMAX / 4DX / 原版…）—— 卡片上最占位、却最不影响
 *      「要不要看这部片」决策的信息。需要时详情页有完整版本列表。
 *   2. 场次数量 —— 与时长、票价混在一行里，三个数字并列反而都不突出。
 *   3. 评分的胶囊底色与来源小字（綜合 / IMDb / 豆瓣）—— 见下方说明。
 *   4. 影厅／语言标签同理（原先也不在卡片上）。
 *
 * ★ 评分为什么改成「纯黄文字」：
 *   原先是两行徽章（数值 + 來源小字）+ 按来源变化的三套配色（紫/琥珀/绿）。
 *   但卡片上用户只需要知道「这片分高不高」，不需要知道分从哪来 ——
 *   来源与算法是 hover 才需要的信息，放在 tooltip 里即可。
 *   去掉底色后，黄色数字本身就成了视觉锚点，比徽章更轻也更醒目。
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
  // 评分：两边都有取平均，只有一边用那一边，都没有则整块不渲染
  const rating = computeCardRating(group.enrich);

  return (
    <Link
      href={`/movie/${group.slug}`}
      className="hkm-glass hkm-poster-card group flex h-full flex-col overflow-hidden rounded-2xl"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-[var(--hkm-poster-frame)]">
        {poster ? (
          <PosterImage
            src={poster}
            alt={group.displayName}
            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            priority={priority}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-fg-dim">
            無海報
          </div>
        )}

      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {/* 单行中文标题：过长截断，hover 显示全名。

            ★ 2026-09-21 对齐 hkmovie6（用户要求「参考 hkmovie6」）：
              实测 hkmovie6 的标题为 16px / font-weight 700 / line-height 24px，
              其卡片宽 196~225px；我们的卡片桌面端 270px、手机端 172px ——
              空间上完全放得下同样的字号。
              本轮由 15px/600 调到 16px/700。

            ⚠️ 颜色刻意**不跟** hkmovie6 的纯白 #FFFFFF：
              用户在暗色规范里明确指定主文字用 #F4F4F5
              （「微弱的米白，避免亮字在暗底上发光晕开」）。
              参考的是字号与字重，不是配色。 */}
        <h3
          className="line-clamp-1 text-base font-bold leading-snug tracking-tight text-fg"
          title={group.displayName}
        >
          {group.displayName}
        </h3>

        <div className="mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-2">
          {group.status === 'upcoming' && m.openingDate ? (
            <p className="min-w-0 text-xs font-medium text-accent">
              {relativeDay(m.openingDate)}上映 · {m.openingDate}
            </p>
          ) : (
            /* 时长与票价同为「数字 + 单位」形态、同一字重与亮度：
               两者都是选片时的硬指标，之前时长偏暗（次级色）而票价偏亮，
               看上去像两种不同性质的信息。 */
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs font-medium text-fg-soft">
              <span>
                {group.displayDuration ? formatDurationShort(group.displayDuration) : '—'}
              </span>
              {group.minPrice != null && (
                <>
                  <span className="text-fg-faint">·</span>
                  <span>${group.minPrice} 起</span>
                </>
              )}
            </p>
          )}

          {/* 评分：纯黄文字，无底色、无来源小字。
              来源与算法仍保留在 tooltip（hover 才可见，不占视觉）——
              卡片上只需要「分高不高」这一个判断。

              ★ 颜色走 --hkm-score-fg 而不是写死的 #facc15：
                亮黄在暗底上 11.6:1，在明色玻璃上只剩 1.5:1。
                详见 app/globals.css 的令牌注释。 */}
          {rating && (
            <span
              className="ml-auto shrink-0 text-base font-bold leading-none text-[var(--hkm-score-fg)]"
              title={ratingTitle(rating)}
            >
              {rating.value.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}