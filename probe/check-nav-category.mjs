// 詳情頁的「歸屬」必須與它所在的列表一致（用戶 2026-09-23 回報的那個 bug）
//
// 用戶原話：「即将上映的电影，点进去子目录显示在現正上映；
//           而且顶上的色块也标在现正上映上」。
//
// 背景：詳情頁路由是 /movie/<slug>，**同一個前綴裝著上映中與待映兩種片**，
// 所以歸屬無法從路徑推導。先前兩處寫死了「現正上映」：
//   1. app/movie/[slug]/page.tsx 的麵包屑 <Link href="/showing">現正上映</Link>
//   2. components/NavLinks.tsx 的 pathname.startsWith('/movie') → 亮現正上映
// 於是《BLUE LOCK 藍色監獄》（待映）點進去兩處都標成現正上映。
//
// 這個 bug 有三個特性，決定了必須用「掃產物」的探針而不是單元測試：
//   - 編譯過、構建過、頁面 200，沒有任何報錯（tsc 與 next build 都全綠）
//   - 只在「同時有上映中與待映兩種詳情頁」的數據下才顯形（本機數據恰好有）
//   - 錯誤表現是「文案不對」，只有人眼看得出來
//
// 斷言用的是**產物之間的交叉一致性**，不需要 data/、不聯網：
//   A. 每個 /movie 頁都帶 data-movie-nav，且麵包屑的連結與文案跟它一致
//   B. 「歸屬為 upcoming 的詳情頁集合」==「/upcoming/ 頁面上連結到的 slug 集合」
//      （B 是關鍵：它把「詳情頁說自己是什麼」與「用戶是從哪個列表點進來的」
//        釘在一起 —— 正是用戶抱怨的那個矛盾）
//
// 用法：node probe/check-nav-category.mjs out
//      node probe/check-nav-category.mjs /home/web/html
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || 'out';
const movieDir = path.join(ROOT, 'movie');

// 目錄不存在 ≠ 沒有問題，而是檢查沒跑起來。分開報，不要混成同一個信號。
if (!fs.existsSync(movieDir)) {
  console.error(`✖ ${movieDir} 不存在 —— 這不是「沒問題」，是產物沒生成或路徑給錯`);
  process.exit(2);
}

const read = (p) => fs.readFileSync(p, 'utf8');
const slugs = fs.readdirSync(movieDir).filter((s) =>
  fs.existsSync(path.join(movieDir, s, 'index.html'))
);

if (slugs.length === 0) {
  console.error(`✖ ${movieDir} 下沒有任何 movie 頁 —— 檢查沒真的跑起來，不能算通過`);
  process.exit(2);
}

/** 詳情頁的分類標記與麵包屑 */
const RE_NAV = /data-page-nav="(showing|upcoming)"/;
// 用 data-crumb 而不是 class 定位：class 是會變的樣式細節，
// 拿它當鈎子會在改樣式時讓守卫靜默失效（或假報「找不到麵包屑」）。
const RE_CRUMB = /<nav[^>]*data-crumb[^>]*><a[^>]*href="([^"]*)"[^>]*>([^<]*)</;
// 頂欄色塊的實現方式：CSS 靠 body:has([data-page-nav=…]) 命中 a[data-nav=…]。
// 只驗麵包屑是不夠的 —— 用戶投訴的是「麵包屑 + 色塊」兩處，
// 而色塊完全由這條 CSS 規則驅動，改了選擇器/忘了加 data-nav 都會靜默失效。
// 三類（showing/upcoming/cinema）都要在，漏一類就有一類頁面的頂欄不亮。
const RE_CSS_RULE = /body:has\(\[data-page-nav=showing\]\)\s*a\[data-nav=showing\]/;
const RE_CSS_CINEMA = /body:has\(\[data-page-nav=cinema\]\)\s*a\[data-nav=cinema\]/;

const EXPECT = {
  showing: { href: '/showing/', label: '現正上映' },
  upcoming: { href: '/upcoming/', label: '即將上映' },
};

const problems = [];
const byNav = { showing: new Set(), upcoming: new Set() };

for (const slug of slugs) {
  const h = read(path.join(movieDir, slug, 'index.html'));
  const nav = RE_NAV.exec(h)?.[1];
  if (!nav) {
    problems.push(`${slug}: 缺 data-movie-nav（詳情頁的歸屬無從得知，頂欄色塊會亮錯）`);
    continue;
  }
  byNav[nav].add(slug);

  const crumb = RE_CRUMB.exec(h);
  if (!crumb) {
    problems.push(`${slug}: 找不到麵包屑 nav`);
    continue;
  }
  const [, href, label] = crumb;
  const want = EXPECT[nav];
  if (href !== want.href || label !== want.label) {
    problems.push(
      `${slug}: 歸屬=${nav}，麵包屑卻是「${label} → ${href}」，應為「${want.label} → ${want.href}」`
    );
  }
}

/** 列表頁上實際被連結到的 slug（用戶點進來的那條路） */
function linkedSlugs(listPage) {
  const f = path.join(ROOT, listPage, 'index.html');
  if (!fs.existsSync(f)) return null;
  const out = new Set();
  for (const m of read(f).matchAll(/href="\/movie\/([^"/]+)\//g)) out.add(m[1]);
  return out;
}

const linkedUpcoming = linkedSlugs('upcoming');
const linkedShowing = linkedSlugs('showing');

for (const [page, linked, nav] of [
  ['/upcoming/', linkedUpcoming, 'upcoming'],
  ['/showing/', linkedShowing, 'showing'],
]) {
  if (!linked) {
    console.error(`✖ ${page} 頁不存在 —— 檢查沒真的跑起來`);
    process.exit(2);
  }
  if (linked.size === 0) {
    console.error(`✖ ${page} 上一條 /movie 連結都沒有 —— 檢查沒真的跑起來`);
    process.exit(2);
  }
  // 列表頁連結到的片，其詳情頁歸屬必須與列表一致。
  // 同一 slug 若同時出現在兩份列表，靜態路由只能產生一張詳情頁；
  // 它按 all-source canonical 組決定歸屬（例如 canonical upcoming），
  // 因此這種重複 slug 不可要求同一頁同時屬於 showing 與 upcoming。
  for (const s of linked) {
    const sharedAcrossLists = linkedUpcoming.has(s) && linkedShowing.has(s);
    if (sharedAcrossLists) {
      if (!byNav.showing.has(s) && !byNav.upcoming.has(s)) {
        problems.push(`${page} 連結的重複 slug /movie/${s}/ 沒有 canonical 詳情頁`);
      }
      continue;
    }
    if (!byNav[nav].has(s)) {
      const actual = byNav.showing.has(s) ? 'showing' : byNav.upcoming.has(s) ? 'upcoming' : '（無標記）';
      problems.push(`${page} 連結的 /movie/${s}/ 詳情頁歸屬是 ${actual}，應為 ${nav}`);
    }
  }
}

console.log(
  `詳情頁 ${slugs.length} 頁｜上映中 ${byNav.showing.size}｜待映 ${byNav.upcoming.size}` +
    `｜列表連結 /upcoming ${linkedUpcoming.size}、/showing ${linkedShowing.size}`
);

/*
 * C. 頂欄色塊的機制必須還在
 *
 * 用戶投訴的兩處之一是「顶上的色块也标在现正上映上」。色塊不是 React state
 * 畫的，而是 globals.css 這條 :has() 規則 + 導航項上的 data-nav 屬性：
 *   body:has([data-movie-nav=upcoming]) a[data-nav=upcoming] { … 色塊 … }
 * 三者（詳情頁的 data-movie-nav、導航項的 data-nav、CSS 規則）缺一不可，
 * 而**任何一處缺失都不報錯**：頁面照樣 200、只是色塊不亮或亮錯。
 * 所以這裡直接從產物裡把三個前提都驗一遍。
 */
const cssDir = path.join(ROOT, '_next', 'static', 'css');
if (!fs.existsSync(cssDir)) {
  console.error(`✖ ${cssDir} 不存在 —— 檢查沒真的跑起來`);
  process.exit(2);
}
const css = fs
  .readdirSync(cssDir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => read(path.join(cssDir, f)))
  .join('\n');
if (!RE_CSS_RULE.test(css)) {
  problems.push('產物 CSS 裡找不到 body:has([data-page-nav=showing]) a[data-nav=showing] 規則 —— 詳情頁的頂欄色塊不會亮');
}
if (!RE_CSS_CINEMA.test(css)) {
  problems.push('產物 CSS 裡找不到 body:has([data-page-nav=cinema]) a[data-nav=cinema] 規則 —— 戲院詳情頁的頂欄不會亮');
}
// 戲院詳情頁必須自己帶上歸屬標記（它不屬於 /movie，不在上面的迴圈裡）
//
// ★ 掃**全部**戲院頁而不是抽一間：先前只抽第一間，結果改壞其他戲院頁
//   （如 mcl-021）時守衛完全不叫 —— 抽樣只能證明「有一間對」，
//   不能證明「每一間都對」，而這正是這類 bug 的典型形態（大部分頁面正常）。
//   戲院頁約 44 個，逐個讀 HTML 的開銷可忽略。
const cinemaDir = path.join(ROOT, 'cinema');
if (fs.existsSync(cinemaDir)) {
  const cinemas = fs
    .readdirSync(cinemaDir)
    .filter((s) => fs.existsSync(path.join(cinemaDir, s, 'index.html')));
  for (const c of cinemas) {
    const h = read(path.join(cinemaDir, c, 'index.html'));
    if (!/data-page-nav="cinema"/.test(h)) {
      problems.push(`cinema/${c}/index.html 缺 data-page-nav="cinema" —— 頂欄「戲院」不會亮`);
    }
    // 麵包屑也要指向 /cinema（與頂欄同一落點）
    const crumb = RE_CRUMB.exec(h);
    if (!crumb || crumb[1] !== '/cinema/' || crumb[2] !== '戲院') {
      problems.push(
        `cinema/${c}/index.html 的麵包屑是「${crumb?.[2] ?? '（找不到）'} → ${crumb?.[1] ?? '—'}」，應為「戲院 → /cinema/」`
      );
    }
  }
}
// 導航項必須帶 data-nav（CSS 與 aria-current 都靠它）
for (const listPage of ['showing', 'upcoming', 'cinema']) {
  const f = path.join(ROOT, listPage, 'index.html');
  if (!fs.existsSync(f)) continue;
  const h = read(f);
  for (const nav of ['showing', 'upcoming', 'cinema']) {
    if (!h.includes(`data-nav="${nav}"`)) {
      problems.push(`${listPage}/index.html 的頂欄缺 data-nav="${nav}" 的導航項`);
    }
  }
}

if (problems.length) {
  for (const p of problems.slice(0, 15)) console.log('  ✗ ' + p);
  if (problems.length > 15) console.log(`  …另有 ${problems.length - 15} 條`);
  console.log(`✗ ${problems.length} 條歸屬不一致`);
  process.exit(1);
}
console.log('✓ 詳情頁歸屬與所在列表全部一致');
