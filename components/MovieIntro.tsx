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

function RatingCard({ r }: { r: IntroRating }) {
  const st = RATING_STYLE[r.source];
  const body = (
    <div className={`flex items-center gap-2.5 rounded-xl border border-hairline px-3 py-2 ${st.bg}`}>
      <span
        className={`flex h-7 items-center rounded-md px-1.5 text-[11px] font-bold leading-none ${st.markBg} ${r.source === 'imdb' ? 'text-canvas' : 'text-white'}`}
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
    <header className="hkm-panel hkm-enter rounded-2xl p-4 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
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
              className="w-full rounded-xl border border-hairline-strong object-cover shadow-[0_16px_40px_-24px_rgba(0,0,0,0.95)]"
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

          {/* 评分（豆瓣 + IMDb）*/}
          {a.ratings.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {a.ratings.map((r) => (
                <RatingCard key={r.source} r={r} />
              ))}
            </div>
          )}

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
                className="hkm-btn-primary rounded-full px-5 py-2.5 text-sm font-semibold"
              >
                查看 {group.totalShows} 個場次
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

      {/* 简介 */}
      {a.summary && (
        <section className="mt-5 border-t border-hairline-soft pt-4">
          <h2 className="mb-2 text-sm font-semibold text-fg-soft">劇情簡介</h2>
          <p className="max-w-3xl whitespace-pre-line text-[13px] leading-relaxed text-fg-muted sm:text-sm">
            {a.summary}
          </p>
        </section>
      )}

      {a.enrichAt && (
        <p className="mt-4 text-[11px] text-fg-dim">
          評分資料更新於 {a.enrichAt.slice(0, 10)}，來源豆瓣 / IMDb；上映、場次與票價以院線官方公佈為準。
        </p>
      )}
    </header>
  );
}
