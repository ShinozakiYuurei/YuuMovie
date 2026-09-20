'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
 * ===== 这里踩过的两个坑（别再改回去） =====
 *
 * 1. **下拉面板 z-[60]，必须高于顶栏 z-50**
 *    原为 z-40，筛选区滚到顶栏下方时展开菜单会被顶栏遮住一截
 *    （表现为「筛选项顶进 sticky header 下面、叠在一起」）。
 *
 * 2. **遮罩 z-30，必须低于顶栏 z-50**
 *    遮罩只负责拦截面板外的点击。若它也提到 50 以上，
 *    用户在菜单展开时点导航会被遮罩吃掉，表现为「导航点不动」。
 *
 * 3. **菜單用 position:fixed + 實測坐標，不能用 absolute left-0**
 *    手機（390px）上篩選區是 2 列網格，右列按鈕的左邊緣約在 200px，
 *    而菜單寬 256px —— `absolute left-0 w-64` 會向右溢出 66px，
 *    把右側的命中數直接切掉（截圖確認）。
 *    左對齊修不了右列，右對齊又會溢出左列，所以改成：
 *    展開時量按鈕的 rect，算出「不越出視窗」的 left 與寬度，用 fixed 定位。
 *    這樣左右兩列、桌面與手機都用同一套邏輯，不必判斷在第幾欄。
 *
 *    代價是滾動/縮放時 fixed 菜單會與按鈕錯位 —— 因此監聽 scroll / resize
 *    直接關閉菜單。用戶在 sticky 篩選區展開菜單後立刻滾動是極少數情況，
 *    關掉比「跟著跑」或「錯位」都好。
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
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const has = selected.length > 0;

  /** 量按鈕位置 → 算出不越出視窗的 fixed 坐標 */
  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = Math.min(256, vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    setPos({ top: r.bottom + 6, left, width });
  }, []);

  const openMenu = () => {
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // capture: true —— sticky 容器自身也可能成为滚动容器
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

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
        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
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

      {open && pos && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-[60] max-h-80 overflow-y-auto rounded-xl border border-hairline-strong bg-surface-hover p-1.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.95)]"
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
        </>
      )}
    </div>
  );
}
