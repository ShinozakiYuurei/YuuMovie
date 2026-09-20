'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FilterDropdown } from './FilterDropdown';
import type { CinemaFacets, CinemaRow } from '@/lib/data';

/**
 * 戲院瀏覽器：多選篩選（院線 / 影廳規格 / 大區 / 區域）
 *
 * ===== 為什麼是客戶端組件 =====
 *
 * 本站是 output: 'export' 靜態導出 —— 沒有 Node 服務端可以回請求，
 * 靜態 HTML 點擊後無法重新過濾。因此把 42 間戲院展平為 CinemaRow[]
 * 內聯進 HTML，用 JS 實時篩選：點篩選不發任何請求，比 hkmovie6 還快。
 *
 * 資料量極小（42 行 × 幾個短字串），內聯成本可忽略 ——
 * 與場次頁（可能上萬行）不同，那邊要靠 lib/compact.ts 的字典壓縮。
 *
 * ===== 為什麼「規格」這一維是本站獨有的 =====
 *
 * hkmovie6 的戲院頁只有三層：大區 tab / 院線 / 區域。
 * 本站多出「影廳規格」，是因為用戶的需求就是「想找有 IMAX / 4DX 的戲院」——
 * 而這個資訊五個抓取源都不直接提供，得從影厅名 + 場次版本 + 片名合成
 * （推斷規則與依據見 lib/cinema-specs.ts）。
 *
 * 規格為空的戲院（普通廳）不會出現在規格篩選裡；反過來，
 * 一旦用戶勾了任一規格，這些戲院自然被排除 —— 這正是用戶想要的。
 */
export function CinemaExplorer({ rows, facets }: { rows: CinemaRow[]; facets: CinemaFacets }) {
  const [sources, setSources] = useState<string[]>([]);
  const [specs, setSpecs] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);

  /** 多選篩選：同維度內 OR，維度之間 AND */
  const filtered = useMemo(() => {
    const pass = (sel: string[], v: string | null) =>
      sel.length === 0 || (v != null && sel.includes(v));
    return rows.filter(
      (r) =>
        pass(sources, r.source) &&
        pass(regions, r.region) &&
        pass(districts, r.district) &&
        // 規格是「任一命中即可」：勾了 IMAX + 4DX，兩種戲院都要留下
        (specs.length === 0 || r.specs.some((x) => specs.includes(x.key)))
    );
  }, [rows, sources, specs, regions, districts]);

  /**
   * 按院線分組展示
   *
   * 保留原本的「院線分節 + 標題」結構（這是 hkmovie6 沒有的層次，
   * 用戶在戲院頁第一眼想知道的是「這條院線有哪幾間」）。
   * 篩選後某條院線可能全空 —— 那一節整段不渲染，不留空標題。
   */
  const groups = useMemo(() => {
    const order = facets.sources.map((s) => s.value);
    const m = new Map<string, CinemaRow[]>();
    for (const r of filtered) {
      if (!m.has(r.source)) m.set(r.source, []);
      m.get(r.source)!.push(r);
    }
    return order
      .filter((s) => m.has(s))
      .map((s) => ({
        source: s,
        label: facets.sources.find((x) => x.value === s)!.label,
        cinemas: m.get(s)!,
      }));
  }, [filtered, facets.sources]);

  const active = sources.length + specs.length + regions.length + districts.length;
  const clearAll = () => {
    setSources([]);
    setSpecs([]);
    setRegions([]);
    setDistricts([]);
  };

  return (
    <div>
      {/* ============ 第一層：篩選 ============
       *
       * ★ 與場次頁同一套 sticky 策略：緊貼頂欄下緣（top = 頂欄高度變數），
       *   z-40 低於頂欄（z-50）、高於內容與遮罩（z-30）。
       *   背景用不透明面板色（.hkm-panel-sticky），否則滾動時會透出戲院卡片。
       *
       * ★ 移動端不啟用 sticky：面板約 200px，小屏上常駐會把戲院列表
       *   擠得幾乎看不見 —— 這裡的取捨與場次頁一致。
       */}
      <section
        className="hkm-panel-sticky mb-7 rounded-2xl p-4 sm:sticky sm:z-40"
        style={{ top: 'var(--hkm-header-h)' }}
      >
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-fg">
            <span
              aria-hidden
              className="inline-block h-4 w-[3px] rounded-full bg-gradient-to-b from-accent-soft to-accent2"
            />
            篩選
          </h2>
          <span className="text-xs text-fg-muted">同類可多選（或），跨類需同時符合（且）</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="tabular-nums text-xs text-fg-soft">
              {filtered.length} / {rows.length} 間
            </span>
            {active > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="rounded-full border border-hairline-strong px-3 py-1 text-xs text-fg-soft transition hover:border-accent/50 hover:text-fg"
              >
                清除全部
              </button>
            )}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <FilterDropdown
            placeholder="所有院線"
            options={facets.sources}
            selected={sources}
            onChange={setSources}
          />
          <FilterDropdown
            placeholder="所有規格"
            options={facets.specs}
            selected={specs}
            onChange={setSpecs}
          />
          <FilterDropdown
            placeholder="所有地區"
            options={facets.regions}
            selected={regions}
            onChange={setRegions}
          />
          <FilterDropdown
            placeholder="所有區域"
            options={facets.districts}
            selected={districts}
            onChange={setDistricts}
          />
        </div>
      </section>

      {/* ============ 第二層：按院線分節的戲院卡片 ============ */}
      {filtered.length === 0 ? (
        <p className="hkm-panel rounded-2xl py-16 text-center text-base text-fg-soft">
          沒有符合篩選條件的戲院
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.source} className="mb-9">
            <h2 className="mb-3.5 flex items-baseline gap-2 border-b border-hairline pb-2.5 text-lg font-semibold tracking-tight">
              {g.label}
              <span className="hkm-chip">{g.cinemas.length} 間</span>
            </h2>
            <div className="grid gap-3.5 sm:grid-cols-2">
              {g.cinemas.map((c) => (
                <div key={c.id} className="hkm-glass rounded-2xl p-4">
                  {/*
                   * 戲院名 + 完整地址
                   *
                   * ★ 2026-09-21 用戶指定（同場次頁同一條）：「把戲院後面的地區區域
                   *   補充為完整地址」。原本這裡是「香港 · 南區」這種大區·十八區 ——
                   *   那是**篩選維度的殘留**（上方已有「所有地區 / 所有區域」下拉），
                   *   對「這間戲院怎麼去」沒幫助，故換成完整地址。
                   *   地址仍可 hover 地圖按鈕查看（下方 mapUrl 連結）。
                   */}
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <h3 className="font-semibold text-fg">{c.nameZh}</h3>
                    {c.address && <span className="text-xs text-fg-muted">{c.address}</span>}
                  </div>
                  {/*
                   * 手續費行（原為地址）
                   *
                   * ★ 2026-09-21 用戶指定：戲院名下方那行改為手續費（免則標 $0）。
                   *   與場次頁（components/ShowtimeExplorer.tsx）保持同一視覺語言 ——
                   *   手續費是選戲院時的決策資訊，地址退到地圖按鈕的 hover 提示。
                   *
                   * ★ 同日再修：「手續費」三字原本用次级色 text-fg-muted，
                   *   与前面的金额（text-fg）不同色；用户要求两者一致，故整行 text-fg。
                   *   （「（已含）」仍留次级色：它是限定语，不是主信息。）
                   */}
                  <p className="mt-1 text-xs text-fg">
                    <span className="font-semibold tabular-nums" title={c.fee.note}>
                      ${c.fee.amount}
                    </span>{' '}
                    <span title={c.fee.note}>手續費</span>
                    {c.fee.amount > 0 && c.fee.included && (
                      <span className="text-fg-dim">（已含）</span>
                    )}
                  </p>

                  {/*
                   * 規格標籤：只列出這間戲院真的有的。
                   * 用 hkm-chip 與場次頁的版本標籤保持同一視覺語言，
                   * 不加顏色 —— 顏色在本站是「餘座」的專屬語義，別處不許佔用。
                   */}
                  {c.specs.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {c.specs.map((s) => (
                        <span key={s.key} className="hkm-chip">
                          {s.label}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-3.5 flex gap-2">
                    <Link
                      href={`/cinema/${c.id}`}
                      className="hkm-btn-primary rounded-full px-3.5 py-1.5 text-xs font-semibold"
                    >
                      查看場次
                    </Link>
                    {c.mapUrl && (
                      <a
                        href={c.mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hkm-btn-ghost rounded-full px-3.5 py-1.5 text-xs"
                      >
                        地圖 ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
