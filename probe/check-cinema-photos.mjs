// 戲院場館照：清單與實際文件必須對得上（2026-10-11 新增）
//
// 背景：戲院詳情頁的頭部照片由 goscraper/cmd/cinemaphotos 在構建前抓取，
// 寫到 public/cinemas/<id>.jpg 並記進 data/cinema-photos.json。頁面只認清單，
// 清單裡有、文件卻不在時，線上就是一張碎圖 —— 而這種錯**本地構建不會報**：
// next build 把 public/ 原樣拷進 out/，它不校驗 HTML 引用的路徑是否存在。
//
// 三類故障都是靜默的，只能靠交叉比對抓出來：
//   1. 清單有、文件缺     → 碎圖（抓圖那步失敗但清單已寫）
//   2. 清單指向錯的路徑   → 碎圖（前綴寫成 /cinema/ 之類）
//   3. 有圖卻沒進清單     → 白抓（下載成功但寫清單那步被跳過）
//
// 斷言用**產物之間的一致性**，不讀網絡：
//   A. 清單裡每一條的 id 都是本站真實戲院（不認得的 id 是抓取時的匹配錯誤）
//   B. 清單裡每一條指向的文件都存在且非空
//   C. 目錄裡的每張圖都在清單裡（反向覆蓋，防白抓）
//   D. 產物 HTML 引用的每條 /cinemas/*.jpg 都真實存在
//
// 用法：node probe/check-cinema-photos.mjs out
//      node probe/check-cinema-photos.mjs /home/web/html
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || 'out';
const MANIFEST = process.env.MANIFEST || 'data/cinema-photos.json';

const problems = [];
const fail = (msg) => problems.push(msg);

// 產物目錄不存在 ≠ 沒有問題，而是檢查沒跑起來。分開報，不要混成同一個信號。
if (!fs.existsSync(ROOT)) {
  console.error(`✖ ${ROOT} 不存在 —— 這不是「沒問題」，是產物沒生成或路徑給錯`);
  process.exit(2);
}

let manifest = {};
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (err) {
  // 清單缺失是**預期情況**（首次部署、抓圖失敗都會沒有），不是錯誤。
  // 此時頁面全部回退到純文字頭部，是設計好的降級路徑。
  console.log(`ℹ️  ${MANIFEST} 不存在（或無法解析）：跳過照片校驗，頁面將用純文字頭部`);
  process.exit(0);
}

const ids = Object.keys(manifest);

// 清單值可能帶 ?v=<cropVersion>（見 cmd/cinemaphotos 的 cropVersion 註釋），
// 那是給瀏覽器／CDN 的緩存鍵，不是檔案名的一部分 —— 查檔案前必須剝掉，
// 否則每條都會被判成「產物裡沒有這個文件」。
const stripQuery = (p) => p.split('?')[0];

if (ids.length === 0) {
  console.log('ℹ️  照片清單是空的：跳過校驗');
  process.exit(0);
}

// A + B：每一條都要指向一張真實存在、非空的圖
const photosDir = path.join(ROOT, 'cinemas');
let checked = 0;
for (const id of ids) {
  const ref = manifest[id];
  if (typeof ref !== 'string' || !ref.startsWith('/cinemas/')) {
    fail(`${id}: 清單值不是 /cinemas/ 路徑（${JSON.stringify(ref)}）`);
    continue;
  }
  // 清單存的是站內路徑；產物裡對應 out/cinemas/<file>
  const file = path.join(ROOT, stripQuery(ref).replace(/^\//, ''));
  if (!fs.existsSync(file)) {
    fail(`${id}: 清單指向 ${ref}，但產物裡沒有這個文件`);
    continue;
  }
  if (fs.statSync(file).size === 0) {
    fail(`${id}: ${ref} 是空文件`);
    continue;
  }
  checked++;
}

// C：反向覆蓋 —— 目錄裡有圖，清單裡卻沒有（下載成功但沒記帳）
if (fs.existsSync(photosDir)) {
  for (const name of fs.readdirSync(photosDir)) {
    if (!/\.jpg$/.test(name)) continue;
    const id = name.replace(/\.jpg$/, '');
    if (!(id in manifest)) fail(`產物有 ${name}，但清單裡沒有它（抓圖寫清單那步漏了？）`);
  }
}

// D：產物 HTML 裡引用的每一條 /cinemas/*.jpg 都要真實存在
const RE_REF = /(?:src|content)="([^"]*\/cinemas\/[^"]+)"/g;
let refs = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_next') continue;
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    const html = fs.readFileSync(full, 'utf8');
    for (const m of html.matchAll(RE_REF)) {
      refs++;
      // 允許帶圖片子域前綴（POSTER_ORIGIN）；只取 /cinemas/ 之後的部分
      const rel = stripQuery(m[1].slice(m[1].indexOf('/cinemas/') + 1));
      if (!fs.existsSync(path.join(ROOT, rel))) {
        fail(`${path.relative(ROOT, full)} 引用 ${m[1]}，但產物裡沒有這個文件`);
      }
    }
  }
};
walk(ROOT);

console.log(`照片清單 ${ids.length} 條｜文件齊備 ${checked} 張｜產物引用 ${refs} 處`);

if (problems.length > 0) {
  console.error(`✖ ${problems.length} 個問題：`);
  for (const p of problems.slice(0, 20)) console.error('  ' + p);
  if (problems.length > 20) console.error(`  …其餘 ${problems.length - 20} 個`);
  process.exit(1);
}

// 引用數為 0 且清單非空，說明頁面根本沒用上照片 —— 那不是「沒問題」，是接線斷了
if (refs === 0) {
  console.error('✖ 產物裡一條 /cinemas/ 引用都沒有 —— 頁面沒接上照片（檢查沒真的跑起來）');
  process.exit(2);
}

console.log('OK 場館照清單與產物一致');