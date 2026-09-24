'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 多選下拉：點擊展開，勾選後不關閉（便於連續多選）
 *
 * ===== 為什麼抽成獨立檔案 =====
 *
 * 場次頁（ShowtimeExplorer）與戲院頁（CinemaExplorer）的篩選面板是同一套交互：
 * 多選、同維度 OR、維度間 AND、選中後不關閉、右側顯示命中數。
 * 原先它内联在 ShowtimeExplorer 里，戲院頁若再抄一份，两份会各自演化 ——
 * 改一个 z-index 修顶栏遮挡、改一个宽度修移动端换行，都要记得改两处。
 *
 * ===== 这里踩过的四个坑（别再改回去） =====
 *
 * 1. **下拉面板 z-[60]，必须高于顶栏 z-50**
 *    原为 z-40，筛选区滚到顶栏下方时展开菜单会被顶栏遮住一截
 *    （表现为「筛选项顶进 sticky header 下面、叠在一起」）。
 *
 * 2. **遮罩 z-[45]，高于筛选面板 z-40、低于顶栏 z-50**
 *    遮罩只负责拦截面板外的点击。若它也提到 50 以上，
 *    用户在菜单展开时点导航会被遮罩吃掉，表现为「导航点不动」。
 *
 * 3. **菜单和遮罩必须 Portal 到 body**
 *    筛选面板的 backdrop-filter 会成为 fixed 子元素的定位包含块；
 *    不脱离面板时，视口坐标会被当作面板内坐标，造成重复偏移。
 *
 * 4. **菜單用 position:fixed + 實測坐標，不能用 absolute left-0**
 *    手機（390px）上篩選區是 2 列網格，右列按鈕的左邊緣約在 200px，
 *    而菜單寬 256px —— `absolute left-0 w-64` 會向右溢出 66px，
 *    把右側的命中數直接切掉（截圖確認）。
 *    左對齊修不了右列，右對齊又會溢出左列，所以改成：
 *    展開時量按鈕的 rect，算出「不越出視窗」的 left 與寬度，用 fixed 定位。
 *    這樣左右兩列、桌面與手機都用同一套邏輯，不必判斷在第幾欄。
 *
 *    滾動/縮放時重新量測並重貼菜單；按鈕完全離開視窗時才關閉。
 */
export interface FilterOption {
  value: string;
  label: string;
  count: number;
  /**
   * 可選分組標題（如戲院頁的「放映格式 / 特色影廳」）
   * 只在值變化時渲染一次小標題，用於解釋「為什麼 IMAX 與 the CORONET 在同一張清單裡」。
   */
  group?: string;
}

export function FilterDropdown({
  placeholder,
  options,
  selected,
  onChange,
}: {
  /** 未選中時的文案（如「所有院線」）；選中多項時自動取「院線 · 3 項」 */
  placeholder: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(
    null
  );
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const has = selected.length > 0;

  /**
   * 量按鈕位置 → 算出不越出視窗的 fixed 坐標與可用高度
   *
   * 高度也要算：菜單有 21 條規格，在 720px 高的視窗裡展開後會超出下邊 ——
   * 原先固定 `max-h-80`（320px）並不管「按鈕下面只剩多少空間」，
   * 結果靠下的選項（「特色影廳」那一整組）直接被切在視窗外，
   * 又因為無法滾動（見上面的說明），用戶根本選不到。
   *
   * 現在：下方空間夠就往下展開；不夠就翻到按鈕上方；
   * 兩邊都不夠（矮屏）則取空間大的一側，並把高度限在該側空間內 ——
   * 無論哪種情形，菜單都完整落在視窗裡且可滾動。
   */
  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(256, vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));

    const GAP = 6;
    const MARGIN = 8;
    const below = vh - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const flip = below < 200 && above > below;
    /*
     * 高度上限 420px（約 11 項）而非原先的 320px：
     * 規格有 21 條 + 2 個分組標題，320px 只看得到 8 項，
     * 在 1080p 這種完全裝得下的屏幕上還要滾兩次 —— 沒必要。
     * 420px 仍不到 1080p 視窗的一半，不會顯得突兀。
     */
    const maxH = Math.max(120, Math.min(420, flip ? above : below));
    const top = flip ? Math.max(MARGIN, r.top - GAP - maxH) : r.bottom + GAP;

    setPos({ top, left, width, maxH });
  }, []);

  const openMenu = () => {
    place();
    setOpen(true);
  };

  /**
   * 滾動/縮放：**重新貼合按鈕**，而不是關閉菜單
   *
   * ===== 為什麼不「一滾就關」（踩過的坑，2026-09-21）=====
   *
   * 最初寫的是「監聽 scroll 就 close」，因為菜單是 position:fixed、
   * 位置是展開時量一次定下來的 —— 頁面一滾就會與按鈕錯位。
   *
   * 但這個策略有三個漏斗，全部都會把菜單意外關掉：
   *   1. **菜單自己的滾動**（規格 21 條裝不下，必須能滾）——
   *      原先加了 capture:true，內層 scroll 也傳到 window，一滾就自關。
   *      用户看到的就是「無法滑動、選不到下面的項」。
   *   2. **瀏覽器的 scroll anchoring** —— 選中一項後我們重渲染了清單，
   *      瀏覽器為了「保持可見內容不跳」會把頁面微調幾個像素（實測 300 → 305），
   *      這也觸發 scroll 事件。於是「勾完一項菜單就消失」，多選直接沒法用。
   *   3. **focus 引起的滾動** —— 聚焦按鈕時瀏覽器會把元素滾入視口。
   *
   * 與其不斷給 close 加例外，不如換個方向：**錯位就修正位置**。
   * 重跑 place() 用的是按鈕**當下**的 rect，所以菜單會一直貼着按鈕，
   * 用户滾動頁面時菜單跟着走 —— 比「突然消失」體驗好，也不會漏掉任何一種滾動來源。
   *
   * 唯一該關的情形是「按鈕已經完全離開視窗」：那時菜單已經沒有錨點，
   * 飄在屏幕中間只會讓用户莫名其妙。
   */
  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = (e: Event) => {
      // 菜單自身的滾動不算「頁面滾動」—— 那是用户在翻選項，位置不需要修正
      const t = e.target;
      if (t instanceof Node && menuRef.current?.contains(t)) return;

      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // 按鈕已完全滾出視窗 → 失去錨點，關閉
      if (r.bottom < 0 || r.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      place();
    };
    window.addEventListener('scroll', onScrollOrResize);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, place]);

  const toggle = (v: string) => {
    onChange(has && selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };

  const short = placeholder.replace('所有', '');

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`relative flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
          has
            ? 'border-accent/60 bg-accent/15 text-fg'
            : 'border-hairline-strong bg-veil text-fg-soft hover:border-hairline-strong hover:bg-veil-strong hover:text-fg'
        }`}
      >
        <span className="truncate font-medium">
          {has
            ? selected.length === 1
              ? options.find((o) => o.value === selected[0])?.label ?? placeholder
              : `${short} · ${selected.length} 項`
            : placeholder}
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

      {open && pos && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[45]" onClick={() => setOpen(false)} aria-hidden />
          <div
            ref={menuRef}
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH }}
            className="hkm-glass-pop fixed z-[60] overflow-y-auto overscroll-contain rounded-xl p-1.5"
          >
            {options.length === 0 && <p className="px-3 py-2 text-sm text-fg-muted">無可選項</p>}

            {options.map((o, i) => {
              const on = selected.includes(o.value);
              // 只在分組標題變化時插一條小標題（第一項若帶分組也照樣顯示）
              const showGroup = !!o.group && o.group !== options[i - 1]?.group;
              return (
                <div key={o.value}>
                  {showGroup && (
                    <p className="px-3 pb-1 pt-2 text-[11px] font-medium tracking-wide text-fg-dim">
                      {o.group}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-veil-strong"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on ? 'border-accent bg-accent' : 'border-hairline-strong'
                      }`}
                    >
                      {on && (
                        /*
                         * 勾選標記維持純白：它是「圖形物件」（WCAG 1.4.11 要求 3:1），
                         * 而兩套主題的強調色都達標 ——
                         *   暗色 #8B7CFF 上的白 3.4:1、淺色 #6B46E5 上的白 5.6:1。
                         * （同在按鈕上的**文字**則不然：暗色那顆白字只有 3.4:1，
                         *  不到正文 AA 的 4.5 —— 這也是主按鈕在淺色下要換深紫的原因。）
                         */
                        <svg className="h-3 w-3 text-white" viewBox="0 0 10 10" fill="none" aria-hidden>
                          <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      )}
                    </span>
                    <span className={`flex-1 truncate ${on ? 'font-medium text-fg' : 'text-fg-soft'}`}>
                      {o.label}
                    </span>
                    <span className="shrink-0 tabular-nums text-xs text-fg-muted">{o.count}</span>
                  </button>
                </div>
              );
            })}

            {has && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-fg-soft transition hover:bg-veil-strong hover:text-fg"
              >
                清除此項
              </button>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
