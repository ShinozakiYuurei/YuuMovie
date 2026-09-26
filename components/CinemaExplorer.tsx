'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FilterDropdown } from './FilterDropdown';
import { FeeLine } from './FeeLine';
import { CinemaMapDialog, preloadLeaflet } from './CinemaMapDialog';
import { CinemaGuideDialog } from './CinemaGuideDialog';
import { CINEMA_GUIDES } from '@/lib/cinema-guides';
import { CINEMA_COORD } from '@/lib/cinema-geo';
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
 * 而這個資訊抓取源不一定提供，需合併院方固定配置與影廳名／場次版本／片名。
 * （官方配置及來源見 lib/cinema-facilities.ts，識別規則見 lib/cinema-specs.ts）。
 *
 * 暫未確認規格的戲院不會出現在規格篩選裡；反過來，
 * 一旦用戶勾了任一規格，這些戲院自然被排除 —— 這正是用戶想要的。
 */
/** 有座標才顯示地圖按鈕（座標表見 lib/cinema-geo.ts） */
function hasCoord(id: string): boolean {
  return CINEMA_COORD[id] != null;
}

export function CinemaExplorer({ rows, facets }: { rows: CinemaRow[]; facets: CinemaFacets }) {
  const [sources, setSources] = useState<string[]>([]);
  const [specs, setSpecs] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  /** 目前開啟地圖彈層的戲院 id（null = 未開啟） */
  const [mapId, setMapId] = useState<string | null>(null);
  const [guideId, setGuideId] = useState<string | null>(null);

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

  const districtOptions = useMemo(() => {
    const selectedRegions = new Set(regions);
    const counts = new Map<string, number>();

    for (const row of rows) {
      if (
        selectedRegions.size > 0 &&
        (row.region == null || !selectedRegions.has(row.region))
      ) {
        continue;
      }
      if (row.district == null || row.district === '') continue;
      counts.set(row.district, (counts.get(row.district) ?? 0) + 1);
    }

    return facets.districts
      .filter((option) => counts.has(option.value))
      .map((option) => ({ ...option, count: counts.get(option.value)! }));
  }, [facets.districts, regions, rows]);

  const changeRegions = (nextRegions: string[]) => {
    const selectedRegions = new Set(nextRegions);
    const availableDistricts = new Set(
      rows
        .filter(
          (row) =>
            nextRegions.length === 0 ||
            (row.region != null && selectedRegions.has(row.region))
        )
        .map((row) => row.district)
        .filter((district): district is string => district != null && district !== '')
    );

    setRegions(nextRegions);
    setDistricts((current) => current.filter((district) => availableDistricts.has(district)));
  };

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
       *   z-40 低於頂欄（z-50）與遮罩（z-45），高於內容。
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
            onChange={changeRegions}
          />
          <FilterDropdown
            placeholder="所有區域"
            options={districtOptions}
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
            <div className="grid gap-3.5 lg:grid-cols-2">
              {g.cinemas.map((c) => (
                <div key={c.id} className="hkm-glass flex min-h-[184px] flex-col rounded-2xl p-4">
                  {/*
                   * 戲院名 + 完整地址
                   *
                   * ★ 2026-09-21 用戶指定（同場次頁同一條）：「把戲院後面的地區區域
                   *   補充為完整地址」。原本這裡是「香港 · 南區」這種大區·十八區 ——
                   *   那是**篩選維度的殘留**（上方已有「所有地區 / 所有區域」下拉），
                   *   對「這間戲院怎麼去」沒幫助，故換成完整地址。
                   *   地址仍可 hover 地圖按鈕查看（下方 mapUrl 連結）。
                   */}
                  <h3 className="font-semibold text-fg">{c.nameZh}</h3>
                  {c.address && (
                    <p className="mt-1 text-xs text-fg-muted">{c.address}</p>
                  )}
                  {/* 手續費獨立一行，以一般次要文字顯示，不套用玻璃或標籤樣式。 */}
                  <FeeLine amount={c.fee.amount} note={c.fee.note} className="mt-2.5" />

                  {/*
                   * 規格標籤：只列出這間戲院真的有的。
                   * 用 hkm-chip 與場次頁的版本標籤保持同一視覺語言，
                   * 不加顏色 —— 顏色在本站是「餘座」的專屬語義，別處不許佔用。
                   *
                   * 其中只有第三方觀眾指南支持的規格（c.guideSpecs）用**虛線**標籤，
                   * 並在下方加一行註記 —— 用戶 2026-09-26 指定放寬「只採院方明示」
                   * 時的前提就是附來源標註（見 lib/cinema-facilities.ts 的 GUIDE_SPECS）。
                   */}
                  {c.specs.length > 0 ? (
                    <>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {c.specs.map((s) => {
                          const fromGuide = c.guideSpecs.includes(s.key);
                          return (
                            <span
                              key={s.key}
                              className={fromGuide ? 'hkm-chip hkm-chip-guide' : 'hkm-chip'}
                              title={fromGuide ? '來源：觀眾指南整理，非院方公布' : undefined}
                            >
                              {s.label}
                            </span>
                          );
                        })}
                      </div>
                      {c.guideSpecs.length > 0 && (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-fg-dim">
                          虛線標籤來自觀眾指南整理，非院方公布
                        </p>
                      )}
                    </>
                  ) : (
                    /*
                     * ★ 沒有規格標籤時，文案不能寫「待確認」（2026-09-26 用戶要求改）。
                     *
                     * 這幾間是**查過、而院方沒有公佈**，不是我們漏了做：
                     *   - MCL 官方「設施」表只有影院／座位數目／輪椅座位三欄
                     *     （見 custom-mcl-cinema-common.js 的 Facilities 渲染）
                     *   - 影藝官網該分店的介紹欄是佔位文字（Test Site／.／1）
                     *   - 華懋官網只有「配備先進的數碼影音設備」這種籠統句
                     *   - 寶石戲院連官網都沒有，新寶院線官網也不列此影院
                     * 第三方觀眾指南對這幾間亦只記選座與路線。
                     * 寫「待確認」會讓用戶以為是我們還沒查（用戶就是這樣誤讀的）。
                     */
                    <p
                      className="mt-2.5 text-xs text-fg-muted"
                      title="已查核院方官網／官方 API 與第三方觀眾指南；院方未公佈這間戲院的放映與音響規格。不代表現場沒有相關設備。"
                    >
                      已核實：院方未公佈放映／音響規格
                    </p>
                  )}

                  <div className="mt-auto flex gap-2 pt-3.5">
                    <Link
                      href={`/cinema/${c.id}`}
                      className="hkm-btn-primary rounded-full px-3.5 py-1.5 text-xs font-semibold"
                    >
                      查看場次
                    </Link>
                    {/*
                     * 地圖按鈕
                     *
                     * ★ 條件是「有座標」而不是「有 mapUrl」（2026-09-21 修正）
                     *
                     *   地圖改用 OpenStreetMap 後，座標來源是 lib/cinema-geo.ts，
                     *   與舊的 Google mapUrl 完全脫鉤 —— 而**有座標但沒 mapUrl 的
                     *   戲院有 16 間**（英皇全線、Cinema City 兩間、星達全線）。
                     *   若仍用 mapUrl 作條件，這 16 間會根本看不到地圖按鈕。
                     */}
                    {hasCoord(c.id) && (
                      <button
                        type="button"
                        onMouseEnter={preloadLeaflet}
                        onFocus={preloadLeaflet}
                        onClick={() => setMapId(c.id)}
                        className="hkm-btn-ghost rounded-full px-3.5 py-1.5 text-xs"
                      >
                        地圖
                      </button>
                    )}
                    {CINEMA_GUIDES[c.id] && (
                      <button
                        type="button"
                        onClick={() => setGuideId(c.id)}
                        className="hkm-btn-ghost rounded-full px-3.5 py-1.5 text-xs"
                      >
                        指南
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {/* 地圖彈層（OpenStreetMap）；選型與大陸可達性實測見 CinemaMapDialog.tsx */}
      {mapId &&
        (() => {
          const c = rows.find((x) => x.id === mapId);
          return c ? (
            <CinemaMapDialog
              cinemaId={c.id}
              name={c.nameZh}
              address={c.address}
              onClose={() => setMapId(null)}
            />
          ) : null;
        })()}
      {guideId &&
        (() => {
          const c = rows.find((x) => x.id === guideId);
          const guide = CINEMA_GUIDES[guideId];
          return c && guide ? (
            <CinemaGuideDialog
              cinemaId={c.id}
              name={c.nameZh}
              address={c.address}
              guide={guide}
              guideSpecs={c.specs.filter((s) => c.guideSpecs.includes(s.key))}
              onClose={() => setGuideId(null)}
            />
          ) : null;
        })()}
    </div>
  );
}
