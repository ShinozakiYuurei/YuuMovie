'use client';

/**
 * 明／暗主題切換鈕（頂欄右端）
 *
 * ===== 為什麼是「兩態切換」而不是三態（淺色 / 深色 / 跟隨系統）=====
 *
 * 使用者 2026-09-25 的選擇是：「首次訪問跟隨系統，之後記住手動選擇」。
 * 這句話本身就定義了兩態就夠 —— 「跟隨系統」是**尚未表達偏好時的預設值**，
 * 而不是一個需要長期停留的選項。三態會多出一個永遠只被用一次的按鈕狀態，
 * 而使用者一旦點過任何一顆，那個狀態就再也回不去了（除非再點一次「跟隨系統」，
 * 但那個按鈕的存在反而讓人以為預設值被改掉了）。
 *
 * 所以：預設值由 app/layout.tsx 的啟動腳本按 prefers-color-scheme 決定，
 * 這裡只負責「點一下換到另一邊並記住」。
 *
 * ===== 為什麼圖示用 CSS 切換而不是 React state =====
 *
 * 這是一個常見的坑：元件必須知道「現在是哪個主題」才能畫出正確的圖示，
 * 而主題是**執行期**才知道的（localStorage / 系統偏好）。
 * 若用 useState + useEffect 讀出來，就會出現：
 *   服務端渲染 → 假設深色 → 畫太陽
 *   hydrate 後    → 讀到淺色 → 換成月亮
 * 使用者看到圖示閃一下（hydration mismatch 的典型症狀）。
 *
 * 這裡的做法是把**兩顆圖示都渲染進 HTML**，由 CSS 依
 * html[data-theme] 決定顯示哪一顆（見 globals.css 的 .hkm-theme-*）。
 * 這樣：
 *   · 服務端與客戶端渲染的 HTML 完全相同 → 不可能 mismatch；
 *   · 啟動腳本在首次繪製前就設好了 data-theme → 首屏就是對的圖示；
 *   · 元件本身可以完全沒有 state。
 *
 * ===== 為什麼 aria-label 是固定的 =====
 *
 * 無障礙上「按鈕名稱」應該描述**動作**，而這個按鈕在兩種狀態下
 * 動作都是「切換明暗」—— 名稱固定反而比動態改寫更準確，
 * 也避免了「名稱依主題變化」這種需要 JS 才能正確的寫法。
 * 真正的狀態由 `aria-pressed` 之外的語意（按鈕旁的 title）與
 * 視覺圖示表達；螢幕閱讀器使用者按下去就能得到結果，不會困惑。
 */

/** 目前實際生效的主題（以 <html> 上的 data-theme 為唯一事實來源） */
function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** 把主題寫進 DOM，並同步瀏覽器 UI（行動端網址列顏色） */
export function applyTheme(theme: 'light' | 'dark') {
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
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#111113' : '#f1f2f6');
}

export function ThemeToggle() {
  const toggle = () => {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try {
      localStorage.setItem('hkm-theme', next);
    } catch {
      /* 隱私模式下 localStorage 可能拋錯：切換本身仍然有效，只是記不住 */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="切換淺色／深色主題"
      title="切換淺色／深色主題"
      /*
       * 尺寸與 hover 語言沿用頂欄其他元素：
       *   rounded-full + bg-veil-strong 是 NavLinks 的 hover 樣式，
       *   圓形是為了與導航的膠囊區分（它是圖示鈕，不是導航項）。
       * h-9 w-9 而非 h-8 w-8：觸控目標要接近 44px 才好點，
       * 但頂欄高度只有 56px，36px 是「好點」與「不擠」的折中。
       */
      className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-veil-strong hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {/*
       * 太陽：表示「切到淺色」。預設（深色）時顯示。
       * className 帶 hkm-theme-sun 由 CSS 控制顯隱，見 globals.css。
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

      {/* 月亮：表示「切到深色」。淺色主題時顯示。 */}
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
    </button>
  );
}
