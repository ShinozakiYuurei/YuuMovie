'use client';

import { useMemo, useState } from 'react';
import { formatDate, formatDateShort, relativeDay, weekdayShort } from '@/lib/format';
import { seatLevel, SEAT_STYLE, SEAT_THRESHOLDS } from '@/lib/seat';
import { fromCompact } from '@/lib/compact';
import type { CompactRows } from '@/lib/compact';
import type { Facets, ShowRow } from '@/lib/data';

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
 * 三层用同一套标题样式，视觉上形成「1 篩選 → 2 日期 → 3 場次」的层次，
 * 避免此前所有内容挤在一个面板里、分不出先看哪里。
 */
function LayerHeader({
  step,
  title,
  hint,
  children,
}: {
  step: string;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight text-white">
        <span
          aria-hidden
          className="inline-block h-4 w-[3px] rounded-full bg-gradient-to-b from-[#8b7cff] to-[#22d3ee]"
        />
        <span className="text-xs font-medium tabular-nums text-gray-400">{step}</span>
        {title}
      </h3>
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
      {children && <span className="ml-auto flex items-center gap-2">{children}</span>}
    </div>
  );
}

/** 多选下拉：点击展开，勾选后不关闭（便于连续多选） */
function FilterDropdown({
  dim,
  options,
  selected,
  onChange,
}: {
  dim: FilterDim;
  options: { value: string; label: string; count: number }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const has = selected.length > 0;

  const toggle = (v: string) => {
    onChange(has && selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
          has
            ? 'border-accent/60 bg-accent/15 text-white'
            : 'border-white/12 bg-white/5 text-gray-200 hover:border-white/25 hover:text-white'
        }`}
      >
        <span className="truncate font-medium">
          {has
            ? selected.length === 1
              ? options.find((o) => o.value === selected[0])?.label ?? FILTER_LABELS[dim]
              : `${FILTER_LABELS[dim].replace('所有', '')} · ${selected.length} 項`
            : FILTER_LABELS[dim]}
        </span>
        <svg
          className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <>
          {/* 点击遮罩关闭 */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 z-40 mt-1.5 max-h-80 w-64 overflow-y-auto rounded-xl border border-white/12 bg-[#12141b] p-1.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.95)]">
            {options.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">無可選項</p>}

            {options.map((o) => {
              const on = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-white/10"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? 'border-accent bg-accent' : 'border-white/30'
                    }`}
                  >
                    {on && (
                      <svg className="h-3 w-3 text-white" viewBox="0 0 10 10" fill="none" aria-hidden>
                        <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    )}
                  </span>
                  <span className={`flex-1 truncate ${on ? 'font-medium text-white' : 'text-gray-200'}`}>
                    {o.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-gray-400">{o.count}</span>
                </button>
              );
            })}

            {has && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
              >
                清除此項
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** 颜色图例（与 hkmovie6 的余座标记一致） */
function SeatLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-300">
      <span className="text-gray-400">餘座：</span>
      {(['plenty', 'limited', 'few', 'soldout'] as const).map((lv) => (
        <span key={lv} className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: SEAT_STYLE[lv].bg }}
          />
          {SEAT_STYLE[lv].label}
        </span>
      ))}
      <span className="tabular-nums text-gray-500">
        綠 ≥{Math.round(SEAT_THRESHOLDS.plenty * 100)}% ・ 橙{' '}
        {Math.round(SEAT_THRESHOLDS.limited * 100)}–
        {Math.round(SEAT_THRESHOLDS.plenty * 100) - 1}% ・ 紅 &lt;
        {Math.round(SEAT_THRESHOLDS.limited * 100)}%
      </span>
    </div>
  );
}

/** 单张场次卡片：底色由余座率决定 */
function ShowtimeCard({ row }: { row: ShowRow }) {
  const lv = seatLevel(row.remainRate, row.soldOut);
  const st = lv ? SEAT_STYLE[lv] : null;
  const pct = row.remainRate == null ? null : Math.round(row.remainRate * 100);

  const title = [
    formatDate(row.date),
    row.time,
    row.cinemaName,
    row.houseName,
    row.versionLabel,
    row.price != null ? `$${row.price}` : null,
    pct != null ? `餘 ${pct}%` : null,
    row.seats != null ? `共 ${row.seats} 座` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <a
      href={row.bookingUrl}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={title}
      className="flex w-[104px] shrink-0 flex-col items-center rounded-xl px-2 py-2 text-center transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
      style={
        st
          ? { backgroundColor: st.bg, color: st.text }
          : { backgroundColor: 'rgba(255,255,255,0.07)', color: '#e8ebf3' }
      }
    >
      <span className="tabular-nums text-base font-bold leading-tight">
        {lv === 'soldout' ? '滿座' : row.time}
      </span>
      <span className="mt-1 w-full truncate text-xs leading-tight opacity-95">
        {row.houseName || row.sourceLabel}
      </span>
      <span className="tabular-nums text-xs leading-tight opacity-90">
        ${row.price ?? '—'}
        {pct != null && lv !== 'soldout' ? ` · ${pct}%` : ''}
      </span>
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
      {/* ============ 第一層：篩選 ============ */}
      <section className="hkm-panel rounded-2xl p-4">
        <LayerHeader step="1" title="篩選" hint="同類可多選（或），跨類需同時符合（且）">
          <span className="tabular-nums text-xs text-gray-300">
            {sorted.length} / {rows.length} 場
          </span>
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-full border border-white/15 px-3 py-1 text-xs text-gray-200 transition hover:border-white/35 hover:text-white"
            >
              清除全部
            </button>
          )}
        </LayerHeader>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <FilterDropdown dim="sources" options={facets.sources} selected={sel.sources} onChange={setDim('sources')} />
          <FilterDropdown dim="versions" options={facets.versions} selected={sel.versions} onChange={setDim('versions')} />
          <FilterDropdown dim="regions" options={facets.regions} selected={sel.regions} onChange={setDim('regions')} />
          <FilterDropdown dim="districts" options={facets.districts} selected={sel.districts} onChange={setDim('districts')} />
        </div>

        {/* 排序（可多键叠加） */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
          <span className="text-xs text-gray-400">排序</span>
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
                    ? 'border-accent/60 bg-accent/15 text-white'
                    : 'border-white/12 bg-white/5 text-gray-300 hover:text-white'
                }`}
              >
                {on && <span className="tabular-nums text-[10px] text-accent">{i + 1}</span>}
                {SORT_LABEL[k]}
                {on && <span className="text-[10px]">{sortRules[i].dir === 'asc' ? '↑' : '↓'}</span>}
              </button>
            );
          })}
        </div>

        <div className="mt-3 border-t border-white/10 pt-3">
          <SeatLegend />
        </div>
      </section>

      {sorted.length === 0 ? (
        <p className="hkm-panel mt-6 rounded-2xl py-16 text-center text-base text-gray-300">
          沒有符合篩選條件的場次
        </p>
      ) : (
        <>
          {/* ============ 第二層：日期 ============ */}
          <section className="mt-8">
            <LayerHeader
              step="2"
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
                        ? 'border-white bg-white text-[#0b0d12] shadow-[0_8px_24px_-12px_rgba(255,255,255,0.5)]'
                        : 'border-white/12 bg-white/5 text-gray-200 hover:border-white/30 hover:text-white'
                    }`}
                  >
                    <span className="tabular-nums text-sm font-bold leading-tight">
                      {formatDateShort(d)}
                    </span>
                    <span className={`text-xs leading-tight ${on ? 'text-[#3b3f4d]' : 'text-gray-400'}`}>
                      {weekdayShort(d)}
                    </span>
                    <span
                      className={`mt-0.5 text-[11px] leading-tight ${
                        on ? 'font-medium text-[#3b3f4d]' : 'text-gray-400'
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
              step="3"
              title="場次"
              hint={`${formatDate(activeDate!)}　${dayCount} 場 · ${activeByCinema!.size} 間戲院`}
            />

            <div className="space-y-3">
              {[...activeByCinema!.entries()].map(([cinemaId, list]) => {
                const c = list[0];
                return (
                  <div key={cinemaId} className="hkm-panel rounded-2xl p-4">
                    <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <h4 className="text-sm font-semibold text-white">{c.cinemaName}</h4>
                      <span className="hkm-chip">{c.sourceLabel}</span>
                      {c.region && (
                        <span className="text-xs text-gray-300">
                          {c.region}
                          {c.district ? ` · ${c.district}` : ''}
                        </span>
                      )}
                      {c.cinemaMapUrl && (
                        <a
                          href={c.cinemaMapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto shrink-0 text-xs text-gray-400 hover:text-white"
                        >
                          地圖 ↗
                        </a>
                      )}
                    </div>
                    {c.cinemaAddress && (
                      <p className="mb-3 text-xs leading-relaxed text-gray-400">{c.cinemaAddress}</p>
                    )}

                    <div className="flex flex-wrap gap-2">
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
