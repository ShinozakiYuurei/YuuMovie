'use client';

import { useMemo, useState } from 'react';
import { formatDate, formatDateShort, relativeDay, weekdayShort } from '@/lib/format';
import { seatLevel, SEAT_STYLE, SEAT_THRESHOLDS } from '@/lib/seat';
import { fromCompact } from '@/lib/compact';
import type { CompactRows } from '@/lib/compact';
import type { Facets, ShowRow } from '@/lib/data';
import { FilterDropdown } from './FilterDropdown';

/**
 * 場次瀏覽器：分層式（篩選 → 日期 → 場次）+ 多選篩選 + 多鍵排序 + 餘座顏色標記
 *
 * ===== 分層結構（對標 hkmovie6）=====
 *
 *   第一層 篩選：院線 / 版本 / 地區 / 區域（同維度 OR、維度間 AND）
 *   第二層 日期：橫向日期條，**一次只看一天**（預設最早一天）
 *   第三層 場次：當日場次，按戲院分組，餘座以顏色標記
 *
 * 為什麼改成「一次一天」：
 *   1. 與 hkmovie6 一致 —— 用戶先確定「哪天有空」再看場次，
 *      而不是在一整面時間牆裡自己找日期分隔線；
 *   2. 只有選中那天的 DOM 被渲染。此前默認渲染 3 天、展開後全部 7 天，
 *      熱門片單頁 HTML 達 1.7MB（服務端渲染壓力 + 手機滾動卡頓）。
 *      現在無論多少天，DOM 恆定為「一天」，HTML 反而更小。
 *
 * ===== 为什么是客户端组件 =====
 *
 * 需求要求「同一维度可勾多个、按 OR 组合」，这是**交互式**筛选：
 * 静态 HTML 无法在点击后重新过滤（本站是 output: 'export' 静态导出，
 * 没有 Node 服务端可回请求）。
 *
 * 因此把场次展平为 ShowRow[] 交给本组件，用 JS 实时筛选/排序。
 * 数据在构建时就内联进 HTML，点击筛选不发任何请求 —— 比 hkmovie6 还快。
 *
 * ===== 颜色分档 =====
 * 分档阈值与色值均来自对 hkmovie6 的实测（见 lib/seat.ts 的详细说明）：
 *   绿 ≥50% 余座、橙 20–49%、红 <20%、深红满座
 */

type SortKey = 'time' | 'price' | 'remain';
type SortDir = 'asc' | 'desc';

interface SortRule {
  key: SortKey;
  dir: SortDir;
}

const SORT_LABEL: Record<SortKey, string> = {
  time: '時間',
  price: '票價',
  remain: '餘座',
};

/** 加入排序链时的默认方向：餘座希望「从多到少」，其余「从小到大」 */
const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  time: 'asc',
  price: 'asc',
  remain: 'desc',
};

const FILTER_LABELS = {
  sources: '所有院線',
  versions: '所有版本',
  regions: '所有地區',
  districts: '所有區域',
} as const;

type FilterDim = keyof typeof FILTER_LABELS;

/**
 * 分层标题：左侧一根强调色竖条 + 标题 + 右侧说明。
 *
 * 三层用同一套标题样式，视觉上形成「篩選 → 日期 → 場次」的层次，
 * 避免此前所有内容挤在一个面板里、分不出先看哪里。
 *
 * ★ 2026-09-19 去掉序号（原为「1 篩選 / 2 日期 / 3 場次」）：
 *   用户明确要求删除。序号属于解释性装饰 —— 三层本身已按顺序自上而下排列，
 *   竖条 + 标题已足够表达层次；数字反而多一层视觉噪音。
 */
function LayerHeader({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight text-fg">
        <span
          aria-hidden
          className="inline-block h-4 w-[3px] rounded-full bg-gradient-to-b from-accent-soft to-accent2"
        />
        {title}
      </h3>
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
      {children && <span className="ml-auto flex items-center gap-2">{children}</span>}
    </div>
  );
}

/** 多選下拉的实现在 ./FilterDropdown.tsx（場次頁與戲院頁共用同一份） */

/** 颜色图例（与 hkmovie6 的余座标记一致） */
function SeatLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-soft">
      <span className="text-fg-muted">餘座：</span>
      {(['plenty', 'limited', 'few', 'soldout'] as const).map((lv) => (
        <span key={lv} className="flex items-center gap-1.5">
          {/* 图例用 .dot（饱和实色）：SEAT_STYLE.bg 现在是 12~16% 的淡彩底，
              作为 12px 小方块会几乎看不见，起不到「色卡」的作用。 */}
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: SEAT_STYLE[lv].dot }}
          />
          {SEAT_STYLE[lv].label}
        </span>
      ))}
      <span className="tabular-nums text-fg-dim">
        綠 ≥{Math.round(SEAT_THRESHOLDS.plenty * 100)}% ・ 橙{' '}
        {Math.round(SEAT_THRESHOLDS.limited * 100)}–
        {Math.round(SEAT_THRESHOLDS.plenty * 100) - 1}% ・ 紅 &lt;
        {Math.round(SEAT_THRESHOLDS.limited * 100)}%
      </span>
    </div>
  );
}

/**
 * 单张场次卡片：底色由余座率决定
 *
 * ★ 2026-09-21 用户要求的三项修改：
 *   1. 去掉票价后面的「· 100%」（余座百分比）—— 色底已经表达了同一件事，
 *      而价格行只该回答「多少钱」。图例在筛选区下方，看一次就够。
 *   2. 时间 / 戏院 / 票价三行居中对齐。
 *   3. 去掉 `title` 属性 —— 鼠标长放会弹出一长串「9月21日（週一） · 00:35 ·
 *      旺角百老匯戲院 · 1院 · 原版 · $65 · 餘 100% · 共 260 座」，
 *      既遮挡相邻卡片，也与卡片上的信息重复。
 *
 *      无障碍信息改用 `aria-label`：屏幕阅读器照旧能念出完整场次，
 *      但它**不会**产生悬停小弹窗。
 *
 * ★ 2026-09-21 第二轮：中行由影厅名换成「影片版本·语言」（用户指定）。
 *   原先中行是 `houseName`（「1院」「House 1」）—— 对「选哪一场」
 *   几乎没有帮助；而「这场是 IMAX 还是原版、什么语言」才是关键信息。
 *   文案规则见 lib/versions.ts 的 formatVersionText。
 *   厅名仍然保留在 `aria-label` 里（无障碍需要完整的场次描述）。
 *
 * ★ 宽度由 `w-[104px] shrink-0` 改为 `w-full`：
 *   父容器换成自适应网格（见下方 grid-cols-[repeat(auto-fill,...)]）。
 *   原先固定 104px 在手机上会剩一段死白（3 张占 328px，容器 329px，
 *   第 4 张放不下就换行，行尾留空）—— 这正是用户说的「很别扭」。
 */
function ShowtimeCard({ row }: { row: ShowRow }) {
  const lv = seatLevel(row.remainRate, row.soldOut);
  const st = lv ? SEAT_STYLE[lv] : null;
  const pct = row.remainRate == null ? null : Math.round(row.remainRate * 100);

  // 仅供屏幕阅读器：完整场次信息（不产生悬停弹窗）
  const label = [
    formatDate(row.date),
    row.time,
    row.cinemaName,
    row.houseName,
    row.versionLabel,
    row.price != null ? `$${row.price}` : null,
    pct != null ? `餘 ${pct}%` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <a
      href={row.bookingUrl}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={label}
      className="flex w-full flex-col items-center justify-center rounded-xl border px-1.5 py-2 text-center transition hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
      style={
        st
          ? { backgroundColor: st.bg, borderColor: st.border, color: st.text }
          : {
              backgroundColor: 'rgb(255 255 255 / 0.05)',
              borderColor: 'rgb(255 255 255 / 0.08)',
              color: '#e8ebf3',
            }
      }
    >
      <span className="tabular-nums text-base font-bold leading-tight">
        {lv === 'soldout' ? '滿座' : row.time}
      </span>
      <span className="mt-1 w-full truncate text-xs leading-tight opacity-95">
        {row.versionText}
      </span>
      <span className="tabular-nums text-xs leading-tight opacity-90">${row.price ?? '—'}</span>
    </a>
  );
}

export function ShowtimeExplorer({
  compact,
  facets,
}: {
  compact: CompactRows;
  facets: Facets;
}) {
  // 紧凑字典 → 完整行（一次性，纯数组映射）
  const rows = useMemo(() => fromCompact(compact), [compact]);

  const [sel, setSel] = useState<Record<FilterDim, string[]>>({
    sources: [],
    versions: [],
    regions: [],
    districts: [],
  });
  const [sortRules, setSortRules] = useState<SortRule[]>([{ key: 'time', dir: 'asc' }]);
  /** 用户点选的日期；null = 尚未选（跟随筛选结果的第一天） */
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  const setDim = (dim: FilterDim) => (next: string[]) => setSel((s) => ({ ...s, [dim]: next }));

  /** 多选筛选：同维度内 OR，维度之间 AND */
  const filtered = useMemo(() => {
    const pass = (dim: FilterDim, v: string | null) => {
      const s = sel[dim];
      return s.length === 0 || (v != null && s.includes(v));
    };
    return rows.filter(
      (r) =>
        pass('sources', r.source) &&
        pass('versions', r.versionKey) &&
        pass('regions', r.region) &&
        pass('districts', r.district)
    );
  }, [rows, sel]);

  /** 多键排序：按 sortRules 顺序逐级比较 */
  const sorted = useMemo(() => {
    const val = (r: ShowRow, k: SortKey): number | string => {
      if (k === 'time') return r.startAt;
      if (k === 'price') return r.price ?? Number.POSITIVE_INFINITY;
      return r.remainRate ?? -1;
    };
    const out = [...filtered];
    out.sort((a, b) => {
      for (const { key, dir } of sortRules) {
        const x = val(a, key);
        const y = val(b, key);
        let c = 0;
        if (typeof x === 'string' && typeof y === 'string') c = x.localeCompare(y);
        else c = (x as number) - (y as number);
        if (c !== 0) return dir === 'asc' ? c : -c;
      }
      return 0;
    });
    return out;
  }, [filtered, sortRules]);

  /** 第二层数据：日期 → 影院 → 场次（sorted 已按时间升序，故影院顺序即当日最早场次顺序） */
  const byDate = useMemo(() => {
    const m = new Map<string, Map<string, ShowRow[]>>();
    for (const r of sorted) {
      if (!m.has(r.date)) m.set(r.date, new Map());
      const byCinema = m.get(r.date)!;
      if (!byCinema.has(r.cinemaId)) byCinema.set(r.cinemaId, []);
      byCinema.get(r.cinemaId)!.push(r);
    }
    return m;
  }, [sorted]);

  const days = useMemo(() => [...byDate.keys()].sort(), [byDate]);

  // 筛选变化后原选中日期可能已不存在 → 自动落到第一天（不写回 state，避免额外渲染）
  const activeDate = pickedDate && days.includes(pickedDate) ? pickedDate : days[0] ?? null;
  const activeByCinema = activeDate ? byDate.get(activeDate)! : null;

  const toggleSort = (key: SortKey) => {
    setSortRules((rules) => {
      const i = rules.findIndex((r) => r.key === key);
      if (i >= 0) {
        // 已在链中：切换方向；再点一次则移出
        const next = [...rules];
        const cur = next[i];
        if (cur.dir === SORT_DEFAULT_DIR[key]) {
          next[i] = { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
          return next;
        }
        next.splice(i, 1);
        return next.length ? next : [{ key: 'time', dir: 'asc' }];
      }
      return [...rules, { key, dir: SORT_DEFAULT_DIR[key] }];
    });
  };

  const activeFilters =
    sel.sources.length + sel.versions.length + sel.regions.length + sel.districts.length;

  const clearAll = () => {
    setSel({ sources: [], versions: [], regions: [], districts: [] });
    setSortRules([{ key: 'time', dir: 'asc' }]);
    setPickedDate(null);
  };

  const dayCount = activeByCinema
    ? [...activeByCinema.values()].reduce((n, l) => n + l.length, 0)
    : 0;

  return (
    <div>
      {/*
       * ============ 第一層：篩選 ============
       *
       * ★ 2026-09-19 改为二级 sticky bar（用户建议）。
       *
       * 问题：筛选面板高约 200px，向下滚动后完全滚出视口 ——
       *   用户想改筛选条件必须滚回顶部，而在几百条场次的长列表里
       *   这个往返代价很高。
       *
       * 做法：
       *   - sticky top-[var(--hkm-header-h)]：紧贴在顶栏下边缘，
       *     两者不重叠（顶栏高度是变量，单一事实源）
       *   - z-40：低于顶栏（z-50），保证顶栏永远在上层；
       *     但高于内容与遮罩（z-30）
       *   - 背景改用不透明底色：hkm-panel 是半透明（0.66）+ 模糊，
       *     作为 sticky 元素时会透出下方滚动的场次列表，视觉上「叠在一起」。
       *     这里换成接近实心的面板色，并保留毛玻璃以维持观感一致。
       *
       * ★ 移动端只在 sm 及以上启用 sticky：
       *   面板约 200px（标题+四个下拉+排序行），在小屏上占近 1/3 视口，
       *   常驻会把场次列表挤得几乎看不见 —— 得不偿失。
       *   手机用户滚回顶部改筛选的代价，低于永久失去 1/3 屏幕。
       *
       * 为什么不让整个 200px 面板常驻：同上述理由，故把座位图例
       *   （纯说明性，看完一次就不再需要）移出 sticky 区。
       */}
      <section
        className="hkm-panel-sticky rounded-2xl p-4 sm:sticky sm:z-40"
        style={{ top: 'var(--hkm-header-h)' }}
      >
        <LayerHeader title="篩選" hint="同類可多選（或），跨類需同時符合（且）">
          <span className="tabular-nums text-xs text-fg-soft">
            {sorted.length} / {rows.length} 場
          </span>
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-full border border-hairline-strong px-3 py-1 text-xs text-fg-soft transition hover:border-accent/50 hover:text-fg"
            >
              清除全部
            </button>
          )}
        </LayerHeader>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <FilterDropdown placeholder={FILTER_LABELS.sources} options={facets.sources} selected={sel.sources} onChange={setDim('sources')} />
          <FilterDropdown placeholder={FILTER_LABELS.versions} options={facets.versions} selected={sel.versions} onChange={setDim('versions')} />
          <FilterDropdown placeholder={FILTER_LABELS.regions} options={facets.regions} selected={sel.regions} onChange={setDim('regions')} />
          <FilterDropdown placeholder={FILTER_LABELS.districts} options={facets.districts} selected={sel.districts} onChange={setDim('districts')} />
        </div>

        {/* 排序（可多键叠加） */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          <span className="text-xs text-fg-muted">排序</span>
          {(['time', 'price', 'remain'] as const).map((k) => {
            const i = sortRules.findIndex((r) => r.key === k);
            const on = i >= 0;
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleSort(k)}
                title={on ? '點擊切換方向，再點移除' : '加入排序'}
                className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition ${
                  on
                    ? 'border-accent/60 bg-accent/15 text-fg'
                    : 'border-hairline-strong bg-veil text-fg-soft hover:bg-veil-strong hover:text-fg'
                }`}
              >
                {/*
                 * ★ 2026-09-19 去掉优先级序号（原为 {i + 1}）：
                 *   用户明确要求不显示。
                 *
                 *   多键排序的先后顺序仍由 sortRules 数组顺序决定（逻辑未变），
                 *   只是不再把序号画到按钮上。方向箭头 ↑↓ 保留 —— 那表达的是
                 *   「升序/降序」，与「第几个排序键」是两回事，删了会丢失信息。
                 */}
                {SORT_LABEL[k]}
                {on && <span className="text-[10px]">{sortRules[i].dir === 'asc' ? '↑' : '↓'}</span>}
              </button>
            );
          })}
        </div>

        {/*
         * 座位图例不放进 sticky 区。
         *
         * ★ 为什么：sticky 区会**永久占据**屏幕顶部。图例（约 45px）
         *   是纯说明性内容，用户看完一次就够了；把它留在 sticky 里
         *   等于用宝贵的视口换一条不再需要的信息。
         *   现改为紧随 sticky 面板之后（仍在筛选层内，语义不变）。
         */}
      </section>

      <div className="hkm-panel mt-2.5 rounded-2xl px-4 py-3">
        <SeatLegend />
      </div>

      {sorted.length === 0 ? (
        <p className="hkm-panel mt-6 rounded-2xl py-16 text-center text-base text-fg-soft">
          沒有符合篩選條件的場次
        </p>
      ) : (
        <>
          {/* ============ 第二層：日期 ============ */}
          <section className="mt-8">
            <LayerHeader
              title="日期"
              hint={`共 ${days.length} 個放映日`}
            />

            {/* 横向日期条：一次只看一天，点击切换（不发请求，数据已在客户端） */}
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {days.map((d) => {
                const on = d === activeDate;
                const n = [...byDate.get(d)!.values()].reduce((m, l) => m + l.length, 0);
                const rel = relativeDay(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPickedDate(d)}
                    className={`flex w-[76px] shrink-0 flex-col items-center rounded-xl border px-2 py-2 transition ${
                      on
                        ? 'border-fg bg-fg text-canvas shadow-[0_8px_24px_-14px_rgba(255,255,255,0.45)]'
                        : 'border-hairline-strong bg-veil text-fg-soft hover:border-hairline-strong hover:bg-veil-strong hover:text-fg'
                    }`}
                  >
                    <span className="tabular-nums text-sm font-bold leading-tight">
                      {formatDateShort(d)}
                    </span>
                    <span className={`text-xs leading-tight ${on ? 'text-canvas/70' : 'text-fg-muted'}`}>
                      {weekdayShort(d)}
                    </span>
                    <span
                      className={`mt-0.5 text-[11px] leading-tight ${
                        on ? 'font-medium text-canvas/70' : 'text-fg-muted'
                      }`}
                    >
                      {rel === '今天' || rel === '明天' || rel === '後天' ? rel : `${n} 場`}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ============ 第三層：場次 ============ */}
          <section className="mt-7">
            <LayerHeader
              title="場次"
              hint={`${formatDate(activeDate!)}　${dayCount} 場 · ${activeByCinema!.size} 間戲院`}
            />

            <div className="space-y-3">
              {[...activeByCinema!.entries()].map(([cinemaId, list]) => {
                const c = list[0];
                return (
                  <div key={cinemaId} className="hkm-panel rounded-2xl p-4">
                    <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <h4 className="text-sm font-semibold text-fg">{c.cinemaName}</h4>
                      <span className="hkm-chip">{c.sourceLabel}</span>
                      {c.region && (
                        <span className="text-xs text-fg-soft">
                          {c.region}
                          {c.district ? ` · ${c.district}` : ''}
                        </span>
                      )}
                      {c.cinemaMapUrl && (
                        /*
                         * 地圖連結同時兼任「地址的容器」：
                         * 地址不再单独占一行（那一行 2026-09-21 用户指定改为手续费），
                         * 但地址仍是有用信息，故挂到这里的 title 上按需可见。
                         */
                        <a
                          href={c.cinemaMapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={c.cinemaAddress ? `地址：${c.cinemaAddress}` : undefined}
                          className="ml-auto shrink-0 text-xs text-fg-muted hover:text-fg"
                        >
                          地圖 ↗
                        </a>
                      )}
                    </div>

                    {/*
                     * 手續費行（原為戲院地址）
                     *
                     * ★ 用户 2026-09-21：「把电影院名下面的地址换成手续费。
                     *   当网上购票免手续费时候，标明 $0 手續費；
                     *   当网上购票需手续费时，表明 $xx 手續費」
                     *
                     * 金额用 text-fg（主文字）而「手續費」三字用 text-fg-muted：
                     * 用户扫这一行时找的是数字，不是「手续费」这个词。
                     * 0 元同样显示（$0）—— 显式告诉用户「这里不额外收钱」
                     * 比留空更有信息量，也正是用户要的。
                     *
                     * title 写明 0 元的来历（会员豁免）与是否已含在票价内，
                     * 避免用户到付款页才发现口径不同。
                     */}
                    <p className="mb-3 text-xs leading-relaxed text-fg-muted">
                      <span
                        className="font-semibold tabular-nums text-fg"
                        title={c.cinemaFeeNote}
                      >
                        ${c.cinemaFee}
                      </span>{' '}
                      <span title={c.cinemaFeeNote}>手續費</span>
                      {c.cinemaFee > 0 && c.cinemaFeeIncluded && (
                        <span className="text-fg-dim">（已含）</span>
                      )}
                    </p>

                    {/*
                     * 自适应网格（用户 2026-09-21：「手机上场次卡片很别扭，改成自适应」）。
                     *
                     * 原来是 `flex flex-wrap gap-2` + 卡片固定 `w-[104px] shrink-0`：
                     * 容器宽 329px（手机）时 3 张占 328px，第 4 张放不下就换行，
                     * 行尾留一条死白；容器更宽时卡片也不跟着变大。
                     *
                     * 改用 auto-fill + minmax(92px, 1fr)：
                     *   - 每张卡片自动均分可用宽度，行尾不再有空白；
                     *   - 列数据屏幕宽度自适应（手机 3 列、平板 7 列、桌面 10 列）；
                     *   - 用 auto-fill 而不是 auto-fit：auto-fit 会把空轨道折叠，
                     *     只有 2 张卡片时它们会被拉到半屏宽，反而难看。
                     *
                     * 92px 下界是实测选出的（面板内宽 = 视口 - 32页面 - 32面板）：
                     *   320px → 2 列×132px（小屏极窄，宁少不多）
                     *   360px → 3 列×93px     375px → 3 列×106px
                     *   414px → 3 列×114px    1024px → 9 列×99px
                     * 比原来的固定 104px 窄一点，但换来「窄屏能多放一列、宽屏卡片跟着变宽」。
                     */}
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
                      {list.map((r) => (
                        <ShowtimeCard key={r.id} row={r} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
