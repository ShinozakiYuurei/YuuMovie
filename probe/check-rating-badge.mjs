// 詳情頁「級別」的長相必須一致 —— 已定級與未定級（TBC）走同一個藥丸外殼
//
// 用戶原話（2026-09-25）：「統一即將上映電影的分級顯示，效果要跟圖一正在上映的一致」。
// 圖一（現正上映）級別是一枚灰底藥丸「IIA」，圖二（即將上映）只剩一行灰字「TBC」。
//
// 背景：components/MovieIntro.tsx 的元信息行原先用三元把兩種狀態畫成兩種東西 ——
//   有分級 → 徽章（bg-veil-strong + px-1.5 py-0.5 + 11px/600）
//   沒分級 → 一段裸文字（連藥丸外框都沒有，而且還是 13px，比真分級大 2px）
// 這個 bug 有三個特性，決定了必須用「掃產物」的探針：
//   - tsc 全綠、next build 全綠、頁面 200，只有肉眼看得出來
//   - 全站 191 頁裡只有 1 頁是 TBC，所以平時根本碰不到（待映片才會）
//   - 修好之後同樣沒有任何自動信號，改回去也不報錯
//
// 斷言（不需要 data/、不聯網，只掃構建產物）：
//   A. 每個 /movie 頁都有「級別:」那一格，且值節點帶著藥丸類名
//      —— 節點類名逐字固定，所以 TBC 與 IIB 必然同殼
//   B. 產物裡**不存在**舊寫法的痕跡（text-fg-dim 的裸 TBC）
//   C. 同一頁的 JSON-LD contentRating 與徽章同源
//      —— 這是第二個坑：MovieJsonLd 原先讀 group.primary.category（未經
//         「只認港英分級」過濾），於是 emperor 來源的片徽章寫 IIB、
//         結構化數據寫「8.0」。實測 40 頁存在這種頁內矛盾。
//      未定級時結構化數據**整項省略**（TBC 不是有效評級），所以
//      這裡的斷言是「徽章 = TBC ⇒ 無 contentRating；否則必須逐字相同」。
//
// 用法：node probe/check-rating-badge.mjs out
//      node probe/check-rating-badge.mjs /home/web/html
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || 'out';
const movieDir = path.join(ROOT, 'movie');

// 目錄不存在 ≠ 沒問題，而是檢查沒跑起來（與 check-nav-category.mjs 同一口徑）
if (!fs.existsSync(movieDir)) {
  console.error(`✖ ${movieDir} 不存在 —— 這不是「沒問題」，是產物沒生成或路徑給錯`);
  process.exit(2);
}

const read = (p) => fs.readFileSync(p, 'utf8');
const slugs = fs
  .readdirSync(movieDir)
  .filter((s) => fs.existsSync(path.join(movieDir, s, 'index.html')));

if (slugs.length === 0) {
  console.error(`✖ ${movieDir} 下沒有任何 movie 頁 —— 檢查沒真的跑起來，不能算通過`);
  process.exit(2);
}

/*
 * 徽章節點的類名。改樣式時要連這裡一起改 —— 這是**故意**的：
 * 這個探針守的不是「某個顏色」，而是「兩種分級狀態共用同一個外殼」。
 * 若哪天要重做徽章外觀，把它換成新的共用類名即可（而不是讓守衛靜默失效）。
 */
const BADGE_CLASS =
  'ml-1 rounded bg-veil-strong px-1.5 py-0.5 text-[11px] font-semibold text-fg';

// 值節點緊跟在「級別:」後面（React 會在文字與元素之間插 <!-- --> 註解）
const RE_BADGE = new RegExp(
  `級別:<!-- -->\\s*<span class="${BADGE_CLASS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">([^<]*)</span>`
);
// 舊寫法：未定級時渲染成裸文字
const RE_OLD_BARE_TBC = /級別:<!-- -->\s*<span class="text-fg-dim">TBC<\/span>/;
const RE_JSONLD_RATING = /"contentRating":"([^"]*)"/;

const problems = [];
let nTbc = 0;
const seenValues = new Set();

for (const slug of slugs) {
  const h = read(path.join(movieDir, slug, 'index.html'));

  if (RE_OLD_BARE_TBC.test(h)) {
    problems.push(`${slug}: 級別仍是「裸文字 TBC」（無藥丸外殼），與已定級的徽章不同殼`);
  }

  const m = RE_BADGE.exec(h);
  if (!m) {
    // 分兩種情況報，因為修法不同：完全沒有這一格 vs 有但不是徽章
    const hasRow = /級別:/.test(h);
    problems.push(
      hasRow
        ? `${slug}: 有「級別:」但值節點不是共用的藥丸徽章（兩種分級狀態又會長得不一樣）`
        : `${slug}: 找不到「級別:」這一格`
    );
    continue;
  }

  const value = m[1].trim();
  seenValues.add(value);
  if (!value) problems.push(`${slug}: 級別徽章是空的（應為分級或 TBC）`);
  if (value === 'TBC') nTbc++;

  const j = RE_JSONLD_RATING.exec(h);
  const jv = j ? j[1] : null;
  if (value === 'TBC') {
    // 未定級：結構化數據裡必須沒有這一項（TBC 不是評級）
    if (jv !== null) problems.push(`${slug}: 徽章是 TBC，JSON-LD 卻寫了 contentRating「${jv}」（不是有效評級）`);
  } else if (jv !== value) {
    problems.push(`${slug}: 頁面徽章是「${value}」，JSON-LD contentRating 卻是「${jv ?? '（無）'}」`);
  }
}

console.log(
  `詳情頁 ${slugs.length} 頁｜級別取值 ${[...seenValues].sort().join(' / ')}｜其中 TBC ${nTbc} 頁`
);

/*
 * TBC 那條分支必須真的被走到過 —— 否則這個守衛只證明「已定級的頁面沒壞」，
 * 而用戶回報的恰恰是 TBC 那一支。本機 data/ 與線上產物都含待映片，
 * 一旦哪天沒有了，就該有人來確認是資料變了還是分組邏輯壞了。
 */
if (nTbc === 0) {
  problems.push('產物裡一頁 TBC 都沒有 —— 這次檢查沒覆蓋到用戶回報的那條分支（未定級），不能算通過');
}

if (problems.length) {
  for (const p of problems.slice(0, 15)) console.log('  ✗ ' + p);
  if (problems.length > 15) console.log(`  …另有 ${problems.length - 15} 條`);
  console.log(`✗ ${problems.length} 條級別顯示不一致`);
  process.exit(1);
}
console.log('✓ 級別顯示全站一致（已定級與 TBC 同殼），且與 JSON-LD 相符');
