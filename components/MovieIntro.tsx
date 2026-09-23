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

/** 评分来源的视觉标识（豆瓣绿 / IMDb 琥珀，与各自官方一致）
 *
 * markSize：徽章字号。两个来源**故意不同**，理由见 RatingCard 的注释
 * （拉丁字母与汉字的墨迹尺寸差得很远，同字号并不等于同视觉大小）。
 *
 * ★ 2026-09-24 底色由**半透明**改为**不透明**：
 *   原先写的是 rgb(245 197 24 / 0.12) 这种「品牌色 + 低透明度」，
 *   它压在卡片背景上，而卡片背景又压着主色层 —— 三层叠出来的颜色
 *   随海报而变。实测《生化危機》（红色主色）那张：
 *     卡面叠成 rgb(73,44,36)，而卡上的「IMDb評分」标签是 #90909A，
 *     对比度只剩 3.98:1，**不达 AA**。
 *   即：标签的可读性本不该取决于身后是什么海报。
 *
 *   修法：预先算好「品牌色混一点暗底」的不透明值，写死。
 *   暗底取 #18181B（卡片基色），混色比例与原来的 0.12/0.14 视觉接近：
 *     IMDb   0.12 × #F5C518 + 0.88 × #18181B ≈ rgb(46 40 20)
 *     豆瓣   0.14 × #2E963D + 0.86 × #18181B ≈ rgb(34 41 25)
 *   实测（probe/rating-bg.cjs）三张片最差：
 *     半透明（原）.. IMDb 3.82:1 / 豆瓣 3.87:1   ✗
 *     不透明（新）.. IMDb 4.65:1 / 豆瓣 4.75:1   ✓
 *   观感上仍是「黄底 / 绿底」，只是不再受身后主色干扰。
 * ★ 2026-09-25：底色与文字色改由 --hkm-rating-* 令牌提供。
 *   上面那组不透明值是**暗色主题**的取值；加入明色主题后，
 *   「深底 + 亮字」在浅色玻璃上会变成「深块贴在白卡上」——
 *   不仅突兀，深底上的亮绿 #7bd48f 也只有 3.1:1。
 *   明色改用浅底 + 深字（豆瓣 #166534 / IMDb #92400E，均 6.4:1）。
 *   品牌徽章（豆瓣绿 / IMDb 黄）两套主题保持一致 —— 那是标识，不随主题变。
 *
 * ⚠️ 所以不能再写 Tailwind 任意值 bg-[rgb(34_41_25)]：
 *   Tailwind 对任意值里的 var() 会做下划线 → 空格的转换，
 *   但 rgb(var(--x)) 这种嵌套形式容易踩到它自己的解析边界。
 *   这两张卡的底色直接走内联 style（值只有一处，可读性也更好）。
 */
const RATING_STYLE: Record<
  IntroRating['source'],
  { fg: string; markBg: string; mark: string; markSize: number }
> = {
  douban: { fg: 'var(--hkm-rating-douban-fg)', markBg: '#2e963d', mark: '豆瓣', markSize: 12.5 },
  imdb: { fg: 'var(--hkm-rating-imdb-fg)', markBg: '#f0c040', mark: 'IMDb', markSize: 11.5 },
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
 *
 * ★ 2026-09-22 三次调整：字眼放大（用户：「IMDb評分/豆瓣評分 字眼可以大點、更協調點」）。
 *
 *   原层级是 標籤10 < 徽章11 < 分數16 —— 標籤比徽章字還小，主次顛倒。
 *   標籤是這張卡在講「這是誰家的評分」，是標題級信息，不该比
 *   僅作裝飾的徽章還弱。現把標籤提到 12px 與徽章同級，分數 16→18。
 *
 *   各字號與卡片寬都是量出來的，不是估的（1280px 視口，線上 digger-1072）：
 *
 *     方案                標籤自然寬  值行自然寬  文字需求  最小卡寬
 *     舊 10/10/16 徽11        63         63        63       141
 *     新 12/12/18 徽12        73         73        73       151   ← 採用
 *     13/13/19 徽13@48        79         79        79       161   （偏大，高度也漲）
 *
 *   文字需求 = max(標籤, 值行) 的**自然寬**（用 nowrap 量，避免被容器截斷
 *   而量到容器寬 —— 这一点踩过，量出来恒等于 clientWidth）。
 *
 *   卡片定宽 155px = 24(px-3) + 44(徽章) + 10(gap-2.5) + 73(文字) + 4(余量)。
 *   余量保留 4px 吸收字体差异（Windows 的 Microsoft JhengHei 比
 *   macOS 的 PingFang HK 略宽），与上次修换行 bug 同一个口径。
 *
 *   徽章仍维持 44px 定宽：IMDb 在 12px 下自然宽约 34px，看似可窄，
 *   但两卡**徽章等宽**才能让文字区起点严格对齐 —— 那正是上一版
 *   修「IMDb 換行」时定下的规矩，不能为了省 10px 退回参差。
 *
 * ★ 2026-09-23 四次调整：徽章里两个 logo 的**视觉大小**对齐
 *   （用户：「这里的 IMDb 和豆瓣的 logo 大小不一致」）。
 *
 *   前三次都在调「卡片」尺寸，这次的问题出在卡片**内部**：
 *   药丸是固定 44×28，但里面塞的是两种文字系统，同 12px 下墨迹差很多：
 *
 *     徽章    墨迹宽×高    占药丸宽   左右留白
 *     IMDb   32.5 × 10.0    74%       各 5.8px   ← 又大又挤
 *     豆瓣   24.0 × 11.8    55%       各 10px    ← 又小又松
 *
 *   根因：拉丁字母**字宽大、x-height 小**（IMDb 四个字母里 I 很窄但 M/D/b 宽，
 *   整体高度只有小写字母那么高），汉字是**方块**（宽高都吃满 em）。
 *   所以「同字号」既不等于同宽、也不等于同高 —— 谁大谁小取决于你量哪个维度。
 *
 *   实测各配对（墨迹包围盒，dpr=4 截屏解码后算，见 probe/rating-logo-ink.cjs）：
 *
 *     IMDb/豆瓣   墨跡面積比   幾何均比   高比
 *     12 / 12      1.15        1.07      0.85   ← 现状，IMDb 明显偏大
 *     11 / 12      0.95        0.97      0.77
 *     11.5 / 12.5  0.97        0.98      0.78   ← 採用
 *     12 / 13      0.98        0.99      0.78
 *     12 / 10      1.24        1.11      1.00   （只等高，面积差更多）
 *
 *   採用「等幾何均」11.5 / 12.5：墨跡面積比 0.97、幾何均比 0.98，
 *   兩個維度同時最接近 1.0。單看某一維都有更好的解，但會讓另一維明顯失配：
 *   「等墨跡高 12/10」高比是 1.00，可面積比反而 1.24，豆瓣看着更小。
 *   字號差 1px 是**故意的**，不是笔误 —— 对齐的是视觉大小，不是 font-size。
 *
 *   药丸宽度仍固定 44px：字号变小后 IMDb 墨迹 31.3px，留白从 5.8 涨到 6.4px，
 *   与豆瓣的 9px 仍不等，但**药丸本身**是等大的，并排看是整齐的。
 *   卡片 155px 也不用改 —— 徽章定宽，文字区需求与字号无关。
 */
function RatingCard({ r }: { r: IntroRating }) {
  const st = RATING_STYLE[r.source];
  const body = (
    <div
      className={`flex w-[155px] items-center gap-2.5 rounded-xl border border-hairline px-3 py-2`}
      style={{
        backgroundColor:
          r.source === 'douban' ? 'var(--hkm-rating-douban-bg)' : 'var(--hkm-rating-imdb-bg)',
      }}
    >
      <span
        className={`flex h-7 w-11 shrink-0 items-center justify-center rounded-md font-bold leading-none ${r.source === 'imdb' ? 'text-canvas' : 'text-white'}`}
        style={{ backgroundColor: st.markBg, fontSize: `${st.markSize}px` }}
      >
        {st.mark}
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] leading-none text-fg-dim">{r.label}評分</span>
        <span className="mt-1 flex items-baseline gap-1.5">
          <span className="text-lg font-semibold leading-none" style={{ color: st.fg }}>
            {r.value != null ? r.value.toFixed(1) : '—'}
          </span>
          {r.value == null && (
            <span className="text-[12px] leading-none text-fg-dim">暫無評分</span>
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
    <header
      className="hkm-panel hkm-enter relative overflow-hidden rounded-2xl p-4 sm:p-6"
      /*
       * ★ 2026-09-24 用户要求：卡片背景改成「像网易云那样按海报主题色填充」。
       *
       * 做法：把主色的 **RGB 通道**写成 CSS 变量，由 .hkm-accent-panel
       *   （见 globals.css）用它拼出「主色 → 透明」的渐变，铺在玻璃面板最底层。
       *
       * 为什么在 HTML 上写 style 而不是构建期生成 288 个 CSS 类：
       *   静态导出下每页只用到**一个**主色，288 个类里 287 个是死代码，
       *   而且会随新片无限增长。一个内联变量既是最小产物，也天然按片变化。
       *
       * 为什么传「27 46 126」而不是「#1b2e7e」：
       *   CSS 侧要写 rgb(var(--x) / 0.34) 这种**带 alpha 的主色**，
       *   hex 做不到（只能靠 color-mix()，它在旧引擎上没回退，
       *   一旦不支持整块背景就全丢）。通道写法则到处都能用。
       *
       * 未取到主色（黑白片 / 老照片，见 scripts/poster-colors.mjs）时不写
       *   这个变量、也不渲染主色层 —— 卡片回到中性玻璃，
       *   下方那层模糊海报光晕照旧。
       */
      style={
        a.accentRgb ? ({ '--hkm-accent-rgb': a.accentRgb } as React.CSSProperties) : undefined
      }
    >
      {/*
       * 背景填充：海报主色
       *
       * ★ 为什么这层放在 .hkm-poster-glow **下面**：
       *   主色是「纯色渐变」，模糊光晕是「海报本身的色块」。
       *   两者同时存在时，光晕在上层会把主色稀释成一片混沌
       *   （又回到改之前那个「看不出是什么颜色」的观感）。
       *   所以主色优先、光晕兜底：有主色时只看主色，
       *   没有主色时才让光晕显形。
       *
       * aria-hidden：纯装饰。
       */}
      {a.accentRgb && <div className="hkm-accent-panel" aria-hidden />}

      {/*
       * 海报光晕（兜底）：主色取不到时才有视觉意义。
       *
       * ★ 用户 2026-09-21：「提取左侧海报的主色调，在顶部大背景区域做
       *   一层极淡的高斯模糊（Glassmorphism）」。
       *   2026-09-24 起主色版成为默认，这层降级为兜底 —— 但**不能删**：
       *   黑白片 / 老照片没有可取的颜色（取色脚本刻意返回 null），
       *   新片的海报也可能还没跑过取色脚本，那时卡片必须有东西撑住背景，
       *   否则会显得比改之前还素。
       *   用海报本身而不是另一张图：同一 URL 命中浏览器缓存，不产生额外请求。
       *
       * 用原生 <img> 而不是 next/image：这里不需要尺寸优化（原图已在本
       *   地且会被模糊掉），而 next/image 在 unoptimized 下会多包一层。
       */}
      {!a.accentRgb && a.poster && (
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
            {/*
             * 級別：**永遠**是一枚藥丸徽章，已定級與未定級（TBC）走同一個殼
             *
             * ★ 2026-09-25 用戶回報：「統一即將上映電影的分級顯示，
             *   效果要跟圖一正在上映的一致」。
             *   圖一（現正上映《狂野雄心》）級別是一枚灰底藥丸「IIA」，
             *   圖二（即將上映《Air/真心為你》）卻只剩一行灰字「TBC」——
             *   同一塊資料卡、同一個字段，兩種長相。
             *
             *   根因是這裡的三元把「有分級」與「沒分級」畫成了兩種東西：
             *   前者是徽章（bg-veil-strong + px-1.5 + py-0.5 + 11px + 600），
             *   後者是一段裸文字，連藥丸外框都沒有。
             *   實測（probe/measure-rating-badge.cjs，1280px 視口）：
             *     已定級 IIA  27.7×20.5  bg rgba(9,9,11,.07)  font 11px
             *     未定級 TBC  24.3×19.5  bg 透明              font 13px
             *   即：TBC 反而比真分級**大 2px**、還沒底沒形。
             *   而全站 191 個詳情頁裡只有 1 頁是 TBC —— 所以這個不一致
             *   平時看不出來，只有待映片才會踩到，正是用戶這次碰上的那條。
             *
             *   修法：外框照抄不變，只把**裡面的字**換成 TBC。
             *   於是兩種狀態同寬（都由同一個 padding / 字號 / 字重決定），
             *   也就順帶解決了「TBC 是拉丁字母、比 IIA 窄」這個次生問題 ——
             *   元信息行裡它後面沒有東西，寬度差幾個 px 不影響任何排版。
             *
             *   TBC 的字色刻意**比照已定級**（text-fg 而非 text-fg-dim）：
             *   「未定級」是一個有效結論（香港送審後未評級就是這樣寫），
             *   不是缺資料。用灰字會讓人以為這一格沒取到值，
             *   而 hkmovie6 的待映片也把 TBC 寫成亮色白字（見 probe/hk6-movie.html
             *   的 bg-neutral-800 + text-white），兩邊一致。
             */}
            <span className="flex items-center gap-3">
              <span className="h-3 w-px bg-hairline-strong" />
              級別:{' '}
              <span className="ml-1 rounded bg-veil-strong px-1.5 py-0.5 text-[11px] font-semibold text-fg">
                {a.category || 'TBC'}
              </span>
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
        *
        * ★ 2026-09-25：那个「精确值」本身成了问题。
        *   它是**暗色专用**的 —— 白 85% 压在浅色玻璃 #FAFAFC 上，
        *   对比度只有 1.2:1，整段简介在白天模式下等于隐形。
        *   所以它现在也是令牌（--hkm-summary-fg）：
        *   暗色仍是 rgb(255 255 255 / 0.85)（逐字未变），
        *   明色换成 rgb(24 24 27 / 0.88)（玻璃 14.6:1）。
        *   保留「比主文字略淡」这层意图（即用户当时要的「微调」），
        *   只是淡的方向随主题反转。
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
            style={{ color: 'var(--hkm-summary-fg)' }}
          >
            {a.summary}
          </p>
        </section>
      )}
    </header>
  );
}
