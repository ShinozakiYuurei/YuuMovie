import Image from 'next/image';
import { buildIntro, type IntroRating } from '@/lib/intro';
import { formatLabel, type MovieGroup } from '@/lib/data';

/**
 * 影片资料卡（详情页头部）
 *
 * 排版参照 hkmovie6 的影片详情：海报在左，右侧依次是
 * 片名 → 元信息行（上映日期 / 片長 / 級別）→ IMDb 评分 → 资料表 → 简介。
 * 不搬过来的两块：**预告片与影评**（产品明确排除，本站只做排片聚合）。
 *
 * 全服务端渲染，无客户端 JS —— 静态导出下这块是纯 HTML。
 */

/** 评分来源的视觉标识（豆瓣绿 / IMDb 琥珀，与各自官方一致） */
const RATING_STYLE: Record<IntroRating['source'], { bg: string; fg: string; markBg: string; mark: string }> = {
  douban: { bg: 'bg-[rgb(46_150_61/0.14)]', fg: 'text-[#7bd48f]', markBg: 'bg-[#2e963d]', mark: '豆瓣' },
  imdb: { bg: 'bg-[rgb(245_197_24/0.12)]', fg: 'text-[#f0c040]', markBg: 'bg-[#f0c040]', mark: 'IMDb' },
};

/**
 * 评分卡
 *
 * ★ 2026-09-21 用户要求「IMDb 评分和豆瓣评分的卡片，两个尺寸要一样」。
 *
 * 原先宽度由内容决定，实测（1280px 视口）两张卡不一样宽：
 *   IMDb  125.8×48   （「IMDb評分 / 8.4」）
 *   豆瓣  110.0×48   （「豆瓣評分 / 8.5」）
 *   豆瓣  133.3×48   （无分时多出「暫無評分」四个字）
 *
 * 三处宽度都不同，并排看参差不齐。现改为**固定宽度**：
 *   两张卡恒定同宽，不随内容（分数位数 / 有无分）变化。
 *
 * ★ 2026-09-22 二次修复：上面那个 138px 仍然不够，IMDb 无分时又换行了。
 *
 *   实测（1280px 视口，线上 digger-1072）：
 *     IMDb  138×58   「IMDb評分 / — 暫無評分」 ← 换行，比豆瓣高 10px
 *     豆瓣  138×48   「豆瓣評分 / — 暫無評分」
 *   两卡同宽却不等高，并排看更明显 —— 因为换行把高度撑起来了。
 *
 *   根因有两层，138px 只解决了其中一层：
 *     1. **徽章宽度不固定**：IMDb 是 4 个拉丁字母（43px），豆瓣是 2 个汉字
 *        （34px），差 9px。留白余量只按「豆瓣」算，IMDb 就少了 9px。
 *     2. 卡片总宽按内容算，没覆盖「徽章 + 暫無評分」这个最宽组合。
 *
 *   实测四组合所需宽度（含 padding 24 + gap 10）：
 *     IMDb 有分 124 / IMDb 无分 140  ← 140 才是上限
 *     豆瓣 有分 108 / 豆瓣 无分 131
 *   138px 比上限少 2px，于是只有 IMDb 无分这一种组合换行。
 *
 *   修法：
 *     - 徽章改**固定宽**（w-11 = 44px，居中）—— 两个来源的徽章同宽，
 *       文字区起点对齐，卡片也就不再因徽章长短而差 9px。
 *     - 卡片定宽 144px = 24 + 44 + 10 + 63（文字需求实测恒为 63px，
 *       换过 Microsoft JhengHei / PingFang HK / Noto Sans TC / Arial
 *       都量到 63）+ 3px 余量。
 *
 *   为什么不用 whitespace-nowrap 兜底：那只是把「换行」换成「溢出」，
 *   文字会盖到圆角边框上。宽度给够才是真修。
 */
function RatingCard({ r }: { r: IntroRating }) {
  const st = RATING_STYLE[r.source];
  const body = (
    <div
      className={`flex w-[144px] items-center gap-2.5 rounded-xl border border-hairline px-3 py-2 ${st.bg}`}
    >
      <span
        className={`flex h-7 w-11 shrink-0 items-center justify-center rounded-md text-[11px] font-bold leading-none ${st.markBg} ${r.source === 'imdb' ? 'text-canvas' : 'text-white'}`}
      >
        {st.mark}
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] leading-none text-fg-dim">{r.label}評分</span>
        <span className="mt-1 flex items-baseline gap-1.5">
          <span className={`text-base font-semibold leading-none ${st.fg}`}>
            {r.value != null ? r.value.toFixed(1) : '—'}
          </span>
          {r.value == null && (
            <span className="text-[10px] leading-none text-fg-dim">暫無評分</span>
          )}
        </span>
      </span>
    </div>
  );
  return r.url ? (
    <a href={r.url} target="_blank" rel="noopener noreferrer" className="hkm-rating-card">
      {body}
    </a>
  ) : (
    body
  );
}

/** 资料表的一行：左标签右值，值为空时整行不渲染（避免一排「—」） */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-hairline-soft py-2 last:border-0 sm:py-2.5">
      <dt className="w-16 shrink-0 text-[13px] leading-relaxed text-fg-dim">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] leading-relaxed text-fg-soft sm:text-sm">{children}</dd>
    </div>
  );
}

export function MovieIntro({ group }: { group: MovieGroup }) {
  const a = buildIntro(group);
  // 「粵語 / 英語（中字）」：只有一侧有值时不留孤立括号
  const lang = a.language
    ? `${a.language}${a.subtitleLang ? `（${a.subtitleLang}字幕）` : ''}`
    : null;

  return (
    <header className="hkm-panel hkm-enter relative overflow-hidden rounded-2xl p-4 sm:p-6">
      {/*
       * 海报主色氛围光：把同一张海报模糊后铺在顶部背景。
       *
       * ★ 用户 2026-09-21：「提取左侧海报的主色调，在顶部大背景区域做
       *   一层极淡的高斯模糊（Glassmorphism）」。
       *   用海报本身而不是构建期提取的色值 —— 同一 URL 命中浏览器缓存，
       *   不产生额外请求，且色调与海报 100% 一致。
       *
       * aria-hidden：纯装饰。
       * 用原生 <img> 而不是 next/image：这里不需要尺寸优化（原图已在本
       *   地且会被模糊掉），而 next/image 在 unoptimized 下会多包一层。
       */}
      {a.poster && (
        <div className="hkm-poster-glow" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.poster} alt="" />
        </div>
      )}

      <div className="relative flex flex-col gap-5 sm:flex-row sm:gap-6">
        {/* 海报 */}
        <div className="w-44 shrink-0 self-center sm:self-start sm:w-56 lg:w-64">
          {a.poster ? (
            <Image
              src={a.poster}
              alt={a.title}
              width={256}
              height={384}
              priority
              sizes="(max-width: 640px) 176px, (max-width: 1024px) 224px, 256px"
              className="hkm-poster w-full rounded-xl object-cover"
            />
          ) : (
            <div className="flex aspect-[2/3] items-center justify-center rounded-xl border border-hairline bg-veil text-xs text-fg-dim">
              無海報
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* 片名 */}
          <h1 className="text-2xl font-bold leading-tight tracking-tight text-fg sm:text-3xl">
            {a.title}
          </h1>
          {a.subtitle && <p className="mt-1.5 truncate text-sm text-fg-muted">{a.subtitle}</p>}

          {/* 元信息行：hkmovie6 在片名下方直接排「上映日期 · 片長 · 級別」 */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-fg-muted">
            {a.openingDate && (
              <span>
                上映日期: <span className="text-fg-soft">{a.openingDate}</span>
              </span>
            )}
            {a.duration != null && (
              <span className="flex items-center gap-3">
                <span className="h-3 w-px bg-hairline-strong" />
                片長: <span className="text-fg-soft">{a.duration} 分鐘</span>
              </span>
            )}
            <span className="flex items-center gap-3">
              <span className="h-3 w-px bg-hairline-strong" />
              級別:{' '}
              {a.category ? (
                <span className="ml-1 rounded bg-veil-strong px-1.5 py-0.5 text-[11px] font-semibold text-fg">
                  {a.category}
                </span>
              ) : (
                <span className="text-fg-dim">TBC</span>
              )}
            </span>
          </div>

          {/* 评分（豆瓣 + IMDb）
              ★ 2026-09-22 始终显示两张卡，保持布局一致。
              无分时显示「— 暫無評分」，不整块隐藏。 */}
          <div className="mt-4 flex flex-wrap gap-2">
            {a.ratings.map((r) => (
              <RatingCard key={r.source} r={r} />
            ))}
          </div>

          {/* 版本標籤（IMAX / 4DX …）*/}
          {group.allFormats.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {group.allFormats.map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-accent/35 bg-accent/12 px-2.5 py-0.5 text-[11px] font-semibold text-accent"
                >
                  {formatLabel(f)}
                </span>
              ))}
            </div>
          )}

          {/* 资料表 */}
          <dl className="mt-5">
            {a.genres.length > 0 && (
              <Row label="類型">
                <span className="flex flex-wrap gap-1.5">
                  {a.genres.map((g) => (
                    <span key={g} className="hkm-chip">
                      {g}
                    </span>
                  ))}
                </span>
              </Row>
            )}
            {lang && <Row label="語言">{lang}</Row>}
            {a.director && <Row label="導演">{a.director}</Row>}
            {a.cast.length > 0 && (
              <Row label="演員">{a.cast.join('、')}</Row>
            )}
          </dl>

          {/* 行动：只做「看场次」与官方入口，不做预告片 */}
          <div className="mt-5 flex flex-wrap gap-2">
            {group.totalShows > 0 && (
              <a
                href="#versions"
                className="hkm-btn-primary flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold"
              >
                {/*
                 * ★ 2026-09-21 用户要求：把「查看 358 個場次」换成「图标 + 場次」。
                 *
                 * 图标用 Ticket（票券轮廓）—— 用户给的参考图是电影票/胶片风格，
                 * Ticket 是最贴近的那个（候选对比见 components 里的提交说明：
                 * film / clapperboard / popcorn / armchair / theater 都不如它贴切）。
                 * 内联 SVG 而不装图标库：全站只此一处用图标，
                 * 为它引入 lucide-react 会往首屏包里多加一个依赖。
                 */}
                <svg
                  className="h-4 w-4 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
                  <path d="M13 5v2" />
                  <path d="M13 17v2" />
                  <path d="M13 11v2" />
                </svg>
                場次
              </a>
            )}
            <a
              href={group.primary.detailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hkm-btn-ghost rounded-full px-5 py-2.5 text-sm"
            >
              院線原始頁面
            </a>
          </div>
        </div>
      </div>

      {/* 简介
        *
        * ★ 2026-09-21 用户要求：
        *   3. 去掉下面那行「評分資料更新於 … 來源豆瓣 / IMDb …」小字，
        *      并把「劇情簡介」放大成类似标题的作用。
        *   4. 正文字距与行高略显拥挤 → 行高调到 1.6~1.8，
        *      颜色从纯白微调为 rgba(255,255,255,0.85)。
        *
        * 「剧情简介」从 text-sm（14px）提到 text-lg（18px）/ font-semibold，
        * 与页面主标题（text-2xl~3xl）拉开层级但仍明显是标题；
        * 标题左侧沿用与场次区一致的强调色竖条（视觉语言统一）。
        *
        * 正文：leading-[1.75] 落在用户要求的 1.6~1.8 中值；
        * 颜色用 rgba(255,255,255,0.85)（用户明确给的写法，而不是令牌变量 ——
        * 这是「纯白微调」的精确值，用令牌反而对不上）。
        * 字号也一并从 13/14px 提到 15px：行高放宽后小字号会显得更小。
        */}
      {a.summary && (
        <section className="mt-5 border-t border-hairline-soft pt-5">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
            <span
              aria-hidden
              className="inline-block h-4 w-[3px] rounded-full bg-gradient-to-b from-accent-soft to-accent2"
            />
            劇情簡介
          </h2>
          <p
            className="max-w-3xl whitespace-pre-line text-[15px] leading-[1.75] sm:text-base"
            style={{ color: 'rgb(255 255 255 / 0.85)' }}
          >
            {a.summary}
          </p>
        </section>
      )}
    </header>
  );
}
