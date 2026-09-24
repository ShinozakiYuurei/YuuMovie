'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 深色／淡粉色主題切換鈕（頂欄右端）
 *
 * 首次訪問由 app/layout.tsx 的啟動腳本按 prefers-color-scheme 決定，
 * 這裡在兩種主題間切換並記住手動選擇。
 *
 * ===== 為什麼圖示用 CSS 切換而不是 React state =====
 *
 * 這是一個常見的坑：元件必須知道「現在是哪個主題」才能畫出正確的圖示，
 * 而主題是**執行期**才知道的（localStorage / 系統偏好）。
 * 若用 useState + useEffect 讀出來，就會出現：
 *   服務端渲染 → 假設深色 → 畫太陽
 *   hydrate 後    → 讀到淡粉色 → 換成月亮
 * 使用者看到圖示閃一下（hydration mismatch 的典型症狀）。
 *
 * 這裡的做法是把所有圖示都渲染進 HTML，由 CSS 依
 * html[data-theme] 決定顯示哪一顆（見 globals.css 的 .hkm-theme-*）。
 * 這樣：
 *   · 服務端與客戶端渲染的 HTML 完全相同 → 不可能 mismatch；
 *   · 啟動腳本在首次繪製前就設好了 data-theme → 首屏就是對的圖示；
 *   · React state 只控制短暫的藥丸過場，不影響首屏圖示。
 *
 * ===== 為什麼 aria-label 是固定的 =====
 *
 * 無障礙上「按鈕名稱」應該描述**動作**，這個按鈕的動作是切換主題；
 * 名稱固定比依主題動態改寫更穩定，也避免了需要 JS 動態更新的名稱。
 * 真正的狀態由 `aria-pressed` 之外的語意（按鈕旁的 title）與
 * 視覺圖示表達；螢幕閱讀器使用者按下去就能得到結果，不會困惑。
 */

/** 目前實際生效的主題（以 <html> 上的 data-theme 為唯一事實來源） */
type Theme = 'dark' | 'pink';

function currentTheme(): Theme {
  const theme = document.documentElement.dataset.theme;
  return theme === 'dark' ? 'dark' : 'pink';
}

/** 把主題寫進 DOM，並同步瀏覽器 UI（行動端網址列顏色） */
export function applyTheme(theme: Theme) {
  const el = document.documentElement;
  el.dataset.theme = theme;
  /*
   * ★ .dark 類也必須一起維護，不能只寫 data-theme。
   *   Tailwind 的 dark: 變體（@custom-variant dark）與 shadcn 元件的
   *   暗色樣式都只認 .dark 類。只寫 data-theme 會得到「頁面變白了、
   *   但 shadcn 元件仍停在暗色」的半明半暗狀態。
   */
  el.classList.toggle('dark', theme === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const color = theme === 'dark' ? '#111113' : '#fff0f6';
    meta.setAttribute('content', color);
  }
}

export function ThemeToggle() {
  const [expanded, setExpanded] = useState(false);
  const [animating, setAnimating] = useState(false);
  const animationLock = useRef(false);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const chooseTheme = (theme: Theme) => {
    applyTheme(theme);
    try {
      localStorage.setItem('hkm-theme', theme);
    } catch {
      return;
    }
  };

  const toggle = () => {
    if (animationLock.current) return;
    const next = currentTheme() === 'dark' ? 'pink' : 'dark';

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      chooseTheme(next);
      return;
    }

    animationLock.current = true;
    setAnimating(true);
    setExpanded(true);
    timers.current = [
      window.setTimeout(() => chooseTheme(next), 320),
      window.setTimeout(() => setExpanded(false), 460),
      window.setTimeout(() => {
        setAnimating(false);
        animationLock.current = false;
      }, 820),
    ];
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-disabled={animating}
      aria-label="切換深色與淡粉色主題"
      title="切換深色與淡粉色主題"
      /*
       * 尺寸與 hover 語言沿用頂欄其他元素：
       *   rounded-full + bg-veil-strong 是 NavLinks 的 hover 樣式，
       *   圓形是為了與導航的膠囊區分（它是圖示鈕，不是導航項）。
       * h-9 w-9 而非 h-8 w-8：觸控目標要接近 44px 才好點，
       * 但頂欄高度只有 56px，36px 是「好點」與「不擠」的折中。
       */
      className={`hkm-theme-toggle ml-1${expanded ? ' is-expanded' : ''}`}
    >
      {/*
       * 太陽：表示下一步切到淡粉色。深色主題時顯示，圖示由 CSS 控制。
       */}
      <svg
        className="hkm-theme-sun h-[18px] w-[18px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>

      {/* 花朵：表示下一步切到淡粉色。淺色主題時顯示。 */}
      <svg
        className="hkm-theme-flower h-[18px] w-[18px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 12c-2.5-2.2-4.5-4.2-2.8-5.9 1.1-1.1 2.4-.3 2.8 1.2.4-1.5 1.7-2.3 2.8-1.2C16.5 7.8 14.5 9.8 12 12Z" />
        <path d="M12 12c2.2-2.5 4.2-4.5 5.9-2.8 1.1 1.1.3 2.4-1.2 2.8 1.5.4 2.3 1.7 1.2 2.8C16.2 16.5 14.2 14.5 12 12Z" />
        <path d="M12 12c2.5 2.2 4.5 4.2 2.8 5.9-1.1 1.1-2.4.3-2.8-1.2-.4 1.5-1.7 2.3-2.8 1.2C7.5 16.2 9.5 14.2 12 12Z" />
        <path d="M12 12c-2.2 2.5-4.2 4.5-5.9 2.8-1.1-1.1-.3-2.4 1.2-2.8-1.5-.4-2.3-1.7-1.2-2.8C7.8 7.5 9.8 9.5 12 12Z" />
        <circle cx="12" cy="12" r="1.25" />
      </svg>

      {/* 月亮：表示下一步切到深色。淡粉色主題時顯示。 */}
      <svg
        className="hkm-theme-moon h-[18px] w-[18px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
      </svg>
      <span className="hkm-theme-toggle__pill" aria-hidden="true">
        <span className="hkm-theme-toggle__swatch hkm-theme-toggle__swatch--light" />
        <span className="hkm-theme-toggle__swatch hkm-theme-toggle__swatch--dark" />
      </span>
    </button>
  );
}
