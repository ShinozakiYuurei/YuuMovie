#!/usr/bin/env node
/**
 * 戲院影廳規格的回归测试（部署自检会跑）
 *
 * 为什么要钉死：规格推断错了页面照样 200、照样好看 ——
 *   只是「有 IMAX 的戲院」这份清单会静默少几家 / 多几家。
 *   用户在戲院页筛 IMAX，看不到 K11 也只会以为「它没有」。
 *
 * 三处证据各有陷阱，本文件把它们逐条钉死：
 *   1. **片名证据必须留着** —— 百老匯的影厅名只有「5院」，
 *      它是不是 IMAX 只能从片名「IMAX 生化危機」看出来。
 *      曾经想过「片名不可靠，只信影厅名」，那样百老匯系的
 *      IMAX / 4DX / 全景聲 会全部消失（占 4DX 的 2/2、IMAX 的 2/5）。
 *   2. **品牌影廳不能认片名** —— the CORONET / House FX 这类是院线
 *      给自家厅起的名字，不会出现在片名里；去测片名只会多出误判面。
 *   3. **正则边界** —— 少了词界，「THX」会命中片名里的任意 thx 子串，
 *      「CGS」同理。这里用 THX/CGS 的反例把它钉住。
 *
 * 規則測試離線；另外掃描本機 data/sources 驗真實廳名，並用空場次 fixture 驗固定配置。
 *
 * 跑法：node_modules/.bin/tsx probe/check-cinema-specs.mts
 */
import { hallSpecsOf, HALL_SPECS, sortSpecs, specLabel } from '../lib/cinema-specs.ts';
import { readFileSync } from 'node:fs';
import { getCinemaRows, getMeta, getCinemaFacets } from '../lib/data.ts';
import { CINEMA_FACILITIES, GUIDE_SPECS, fixedCinemaSpecs, guideCinemaSpecs } from '../lib/cinema-facilities.ts';
import { CINEMA_GUIDES } from '../lib/cinema-guides.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let bad = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`✓ ${name}`);
  } else {
    console.log(`✗ ${name}\n    得到 ${g}\n    期望 ${w}`);
    bad++;
  }
}

// ============================================================
// 1. 三处证据各自能独立命中（缺任一处都会漏掉整条院线）
// ============================================================

eq(
  '戲院中心官方规格：SR 与 SRD 分别命中',
  [
    hallSpecsOf({ houseName: 'SR' }),
    hallSpecsOf({ houseName: 'SRD' }),
  ],
  [['sr'], ['srd']]
);
eq('官方 DTS:X 厅名命中，格式符号可选', hallSpecsOf({ houseName: 'DTS:X' }), ['dtsx']);
eq(
  '普通厅名称含 SRD 子串不可误判为 SR 规格',
  hallSpecsOf({ houseName: '3院 SRD 特別場' }),
  []
);
eq(
  '影厅名证据：MCL 的 LUXE 厅',
  hallSpecsOf({ houseName: 'LUXE', version: '2D 全景聲 英語', title: '生化危機' }),
  ['atmos', 'luxe']
);

eq(
  '场次版本证据：英皇的 IMAX2D / ATMOS2D / DBOX2D',
  hallSpecsOf({ houseName: 'House 5/IMAX*', version: 'IMAX2D', title: '生化危機' }),
  ['imax']
);
eq(
  '场次版本证据：ATMOS2D',
  hallSpecsOf({ houseName: 'House 1', version: 'ATMOS2D', title: '生化危機' }),
  ['atmos']
);
eq(
  '场次版本证据：DBOX2D',
  hallSpecsOf({ houseName: 'House 1', version: 'DBOX2D', title: '生化危機' }),
  ['dbox']
);

// ★ 最关键的一条：百老匯只有片名可依，影厅名「5院」与 version=null 都不含信息
eq(
  '片名证据：百老匯 IMAX（影厅名只有「5院」、version 为 null）',
  hallSpecsOf({ houseName: '5院', version: null, title: 'IMAX 生化危機' }),
  ['imax']
);
eq(
  '片名证据：百老匯 4DX',
  hallSpecsOf({ houseName: '6院', version: null, title: '4DX 沙丘' }),
  ['4dx']
);
eq(
  '片名证据：百老匯 全景聲（括号写法）',
  hallSpecsOf({ houseName: '5院', version: null, title: '生化危機 (全景聲)' }),
  ['atmos']
);

// ============================================================
// 2. 普通厅戲院不得被推断出任何规格
// ============================================================

eq(
  '普通厅：无任何证据 → 空',
  hallSpecsOf({ houseName: '3院', version: '2D 英語', title: '生化危機' }),
  []
);
eq(
  '普通厅：2D / 3D / 粵語版 都不是「影厅规格」',
  hallSpecsOf({ houseName: 'House 2', version: '2D 粵語', title: '毒舌大狀 (粵語版)' }),
  []
);
// 4K修復版 / 菲林版 是**影片**规格（片源），不是影厅规格 —— 不该进这一维
eq(
  '片源规格不进影厅规格：4K修復版 / 菲林版',
  hallSpecsOf({ houseName: '4院', version: null, title: '花樣年華 4K修復版' }),
  []
);

eq('Dolby 7.1 不誤標 Atmos', hallSpecsOf({ houseName: 'Dolby 7.1' }), ['dolby71']);
eq('杜比 7.1 不誤標 Atmos', hallSpecsOf({ houseName: '杜比 7.1' }), ['dolby71']);
eq('Dolby Vision 不誤標 Atmos', hallSpecsOf({ version: '杜比 Vision' }), []);
eq('舊片名獨立杜比格式標記仍可識別', hallSpecsOf({ title: '電影 (杜比)' }), ['atmos']);
eq('4K 激光硬件不能從片名／版本推斷', hallSpecsOf({ title: '4K 修復電影', version: '4K Laser' }), []);
eq('Screen X 廳名有空格也能識別', hallSpecsOf({ houseName: '影院 4–Screen X' }), ['screenx']);
eq('RealD Cinema 是品牌廳，不誤當 RealD 3D 場次', hallSpecsOf({ houseName: 'RealD Cinema' }), ['realdcinema']);
eq('RealD 3D 格式仍可識別', hallSpecsOf({ version: 'RealD 3D' }), ['reald']);
eq('AuroMax 3D 音響不等同於 3D 電影片源', hallSpecsOf({ houseName: 'AuroMax 3D' }), ['auromax']);

// ============================================================
// 3. 品牌影廳只认影厅名（片名/版本里出现同名词不算）
// ============================================================

eq(
  '品牌影廳：影厅名命中',
  hallSpecsOf({ houseName: 'the CORONET', version: '2D', title: '生化危機' }),
  ['coronet']
);
eq(
  '品牌影廳：片名里出现同名词不算',
  hallSpecsOf({ houseName: '3院', version: '2D', title: 'House FX 特別場' }),
  []
);
eq(
  '品牌影廳：MOViEMAXX / MM Plus 各自独立',
  hallSpecsOf({ houseName: 'MOViEMAXX', version: null, title: '復仇者聯盟4' }),
  ['moviemaxx']
);
eq(
  '品牌影廳：MM Plus 不能命中 MOViEMAXX（词界）',
  hallSpecsOf({ houseName: 'MM Plus', version: null, title: '復仇者聯盟4' }),
  ['mmplus']
);
eq(
  '品牌影廳：百老匯 The Oval Office',
  hallSpecsOf({ houseName: 'The Oval Office', version: null, title: '蜘蛛俠：英雄重生' }),
  ['ovaloffice']
);
eq(
  '品牌影廳：百老匯 MM MOMENTS',
  hallSpecsOf({ houseName: 'MM MOMENTS', version: null, title: '末世橡樹街' }),
  ['mmmoments']
);
eq(
  '品牌影廳名稱必須完整命中，不把普通影廳中的詞語當品牌廳',
  hallSpecsOf({ houseName: 'MM MOMENTS 影廳', version: null, title: '電影' }),
  ['mmmoments']
);
eq(
  '非品牌影廳標題不因片名提及 The Oval Office 而命中',
  hallSpecsOf({ houseName: '3院', version: null, title: 'The Oval Office' }),
  []
);

// ============================================================
// 4. 正则边界（少了 \b 会静默误命中）
// ============================================================

// 「THX」若不带词界，会命中任何含 thx 子串的片名
eq(
  '词界：THX 不命中 "THXTHX" 这类子串之外的情形',
  hallSpecsOf({ houseName: '5院', version: null, title: 'THXTHX 大冒險' }),
  []
);
eq('词界：THX 正常命中', hallSpecsOf({ houseName: 'THX', version: null, title: '奧德賽' }), ['thx']);
eq(
  '词界：CGS 不命中 "CGSX"',
  hallSpecsOf({ houseName: '6院', version: null, title: 'CGSX 大冒險' }),
  []
);
eq('词界：CGS 正常命中', hallSpecsOf({ houseName: '6院', version: null, title: 'CGS 復仇者聯盟4' }), ['cgs']);

// D-BOX 的两种写法（bestar 写 DBOX2D，MCL 影厅名写 D-BOX）
eq('D-BOX 连字符写法', hallSpecsOf({ houseName: 'Vivo(尊尚影院) D-BOX', version: null, title: '' }), ['dbox', 'vivo']);
eq('D-BOX 无连字符写法', hallSpecsOf({ houseName: '3院', version: 'DBOX2D', title: '' }), ['dbox']);

// ============================================================
// 5. 一条场次可同时带多个规格，且输出按展示顺序稳定
// ============================================================

eq(
  '多规格同时命中（MCL MOVIE TOWN 的 MX4D 厅）',
  hallSpecsOf({ houseName: 'MX4D 動感影院', version: '2D MX4D 英語', title: '生化危機 MX4D' }),
  ['mx4d']
);
eq(
  '多规格同时命中（澳門葡京人：IMAX + ATMOS + MX4D + CORONET）',
  hallSpecsOf({ houseName: 'House 7/IMAX*', version: 'IMAX2D', title: '生化危機' }),
  ['imax']
);

// 输出顺序 = HALL_SPECS 顺序（放映格式在前、特色影廳在后），
// 与 sortSpecs 一致 —— 页面上标签顺序必须稳定，不能随命中顺序抖动
const many = hallSpecsOf({
  houseName: 'LUXE',
  version: '2D 全景聲 英語',
  title: 'IMAX 4DX 生化危機',
});
eq('多规格输出顺序稳定（= HALL_SPECS 顺序）', many, sortSpecs(many));
eq('多规格集合正确', [...many].sort(), ['4dx', 'atmos', 'imax', 'luxe'].sort());

// ============================================================
// 6. 現有院線資料的影廳名稱覆蓋
// ============================================================

// 各抓取源会更新影厅名格式；对实际存档源逐条扫描，任何未识别的非编号厅
// 都需要人工判断是否是新特色厅，以免出现「规则单测通过、真实数据仍漏标签」。
const sourceFiles = ['broadway', 'mcl', 'emperor', 'cinemacity', 'bestar', 'cgv', 'cineart', 'chinachem', 'goldenscene', 'lumen', 'lux', 'newport', 'sunbeam'];
const normalHall = /^(?:house\s*\d+(?:\s*\(\s*\d+\s*院\s*\))?|\d+\s*(?:號\s*)?院|影院\s*\d+)$/i;
const unknownHalls = new Set<string>();
for (const source of sourceFiles) {
  const data = JSON.parse(readFileSync(new URL(`../data/sources/${source}.json`, import.meta.url), 'utf8'));
  const movies = new Map(data.movies.map((movie: { id: string; nameZh?: string; nameEn?: string }) => [movie.id, movie.nameZh || movie.nameEn || '']));
  for (const show of data.shows) {
    const house = String(show.houseName || '').trim();
    if (!house || normalHall.test(house)) continue;
    const matched = hallSpecsOf({ houseName: house, version: show.version, title: movies.get(show.movieId) || '' });
    if (!matched.length) unknownHalls.add(`${source}: ${house}`);
  }
}
eq('實際院線資料中沒有未識別的特色影廳名稱', [...unknownHalls].sort(), []);

const cinemaCentre = getCinemaRows().find((cinema) => cinema.id === 'broadway-8');
eq('戲院頁實際標籤：百老匯電影中心有 SR 與 SRD', cinemaCentre?.specs.map((spec) => spec.key), ['sr', 'srd']);
const palaceIfc = getCinemaRows().find((cinema) => cinema.id === 'broadway-4');
eq('戲院頁實際標籤：PALACE ifc 有 DTS:X 及 Dolby 7.1', palaceIfc?.specs.map((spec) => spec.key), ['dtsx', 'dolby71']);
eq('英皇總部辦公地址不列為放映戲院', getCinemaRows().some((cinema) => cinema.id === 'emperor-57001'), false);
eq('首頁和頁尾的戲院總數與戲院列表一致', getMeta().counts.cinemas, getCinemaRows().length);

// 固定配置的關鍵漏標：即使近期沒排該格式，也必須可篩選。
const rows = getCinemaRows();
for (const [id, key] of [['broadway-2', 'atmos'], ['broadway-5', 'atmos'], ['broadway-10', 'dtsx'], ['broadway-3', 'cinity'], ['broadway-11', 'usl8']]) {
  eq(`影院固定設備補齊：${id} / ${key}`, rows.find((c) => c.id === id)?.specs.some((s) => s.key === key), true);
}

// ★ 每間戲院都必須有配置條目。
//   缺條目的後果是**靜默**的：卡片照樣顯示「規格資料待確認」，而詳情頁
//   連「已核實規格與特色影廳」一節都不會出現 —— 看起來就像忘了做，
//   而不是「已核實、官方沒有公佈」。2026-09-26 的寶石戲院（lux-1）正是這樣。
eq(
  '每間戲院都有官方配置條目（缺者詳情頁會少一整節）',
  rows.filter((c) => !CINEMA_FACILITIES[c.id]).map((c) => c.id),
  []
);
// 官方介紹已給出設備原文的分店，規格不得退回空集合（回退了不會報錯）。
eq(
  '影藝青衣城官方介紹的 4K／激光／杜比 7.1／ATMOS 已入表',
  sortSpecs(fixedCinemaSpecs('cineart-17')),
  sortSpecs(['4k', 'laser', 'dolby71', 'atmos'])
);
eq('寶石戲院有配置條目（詳情頁不再整節缺失）', CINEMA_FACILITIES['lux-1'] !== undefined, true);
const facets = getCinemaFacets(rows);
for (const { value, count } of facets.specs) {
  eq(`規格篩選計數一致：${value}`, count, rows.filter((c) => c.specs.some((s) => s.key === value)).length);
}

// 用完全沒有場次的獨立讀取進程驗整條資料管線，避免只測表、不測 data.ts 接入。
const fixtureDir = mkdtempSync(join(tmpdir(), 'hkmovie-fixed-specs-'));
try {
  writeFileSync(join(fixtureDir, 'cinemas.json'), JSON.stringify(Object.keys(CINEMA_FACILITIES).map((id) => ({
    id, code: id, nameZh: id, address: '', mapUrl: '', detailUrl: '', source: id.split('-')[0],
  }))));
  writeFileSync(join(fixtureDir, 'movies.json'), '[]');
  writeFileSync(join(fixtureDir, 'shows.json'), '[]');
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { getCinemaRows } from ${JSON.stringify(new URL('../lib/data.ts', import.meta.url).href)};
    console.log(JSON.stringify(getCinemaRows().map(c => ({id:c.id, specs:c.specs.map(s=>s.key)}))));
  `], { env: { ...process.env, DATA_DIR: fixtureDir }, encoding: 'utf8' });
  eq('空場次 fixture 讀取成功', result.status, 0);
  if (result.status === 0) {
    const fixtureRows = JSON.parse(result.stdout.trim()) as { id: string; specs: string[] }[];
    for (const [id, facilities] of Object.entries(CINEMA_FACILITIES)) {
      eq(`沒有排片仍保留固定配置：${id}`, fixtureRows.find((c) => c.id === id)?.specs, sortSpecs([...facilities.specs, ...guideCinemaSpecs(id)]));
    }
  } else console.log(result.stderr);
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}
eq('未確認影院不硬補規格', fixedCinemaSpecs('unverified-cinema'), []);
eq('未確認影院不硬補指南規格', guideCinemaSpecs('unverified-cinema'), []);

// ============================================================
// 6b. 觀眾指南層（第三方）的來源完整性
// ============================================================
// 這一層是 2026-09-26 用戶指定放寬「只採院方明示」後新增的，代價是可信度較低，
// 因此必須用程式把兩件事鈎死：
//   1. 指南標籤必須真的能在指南原文裡找到依據（防止這一層脫離原文、變成杜撰）
//   2. 只有指南支持、官方與場次都沒有的規格，必須記進 guideSpecs（卡片要標來源）
const GUIDE_KEYWORD: Record<string, RegExp> = {
  imax: /imax/i,
  atmos: /atmos|全景聲/i,
  '4dx': /4dx/i,
  mx4d: /mx4d/i,
  luxe: /luxe/i,
  onyx: /onyx/i,
  dtsx: /dts\s*:?\s*x/i,
  auromax: /auromax/i,
  dolby71: /dolby\s*(?:sls\s*)?7\.1|杜比\s*7\.1/i,
  usl8: /usl\s*8/i,
  '4k': /4k/i,
  laser: /激光|鐳射|雷射|laser/i,
  masterimage: /masterimage/i,
  srdex: /srd\s*-\s*ex/i,
  thx: /thx/i,
  cgs: /cgs/i,
  screenx: /screen\s*x/i,
  cinity: /cinity/i,
  reald: /reald/i,
  dbox: /d-?box/i,
  '3d': /3d/i,
};
for (const [id, keys] of Object.entries(GUIDE_SPECS)) {
  eq(`指南規格 ${id} 的 key 全部有效`, keys.every((k) => HALL_SPECS.some((s) => s.key === k)), true);
  eq(`指南規格 ${id} 不重複`, new Set(keys).size, keys.length);
  const guide = CINEMA_GUIDES[id];
  eq(`指南規格 ${id} 有對應的指南條目`, guide !== undefined, true);
  if (!guide) continue;
  const text = JSON.stringify(guide);
  const unsupported = keys.filter((k) => !GUIDE_KEYWORD[k] || !GUIDE_KEYWORD[k].test(text));
  eq(`指南規格 ${id} 每條都能在指南原文找到依據`, unsupported, []);
}

// 指南層確實把「官方不公布設備」的戲院救回來了：這三間在 2026-09-26 前是空的。
for (const [id, key] of [['mcl-002', 'dolby71'], ['mcl-013', 'dolby71'], ['mcl-021', '4k']]) {
  eq(`官方不公布設備的戲院由指南補齊：${id} / ${key}`, fixedCinemaSpecs(id).concat(guideCinemaSpecs(id)).includes(key), true);
}
// 官方已有的規格不得被記成「僅指南支持」（否則卡片會把院方公布的事實標成指南來源）。
eq(
  '官方已公布的規格不會被標成指南來源',
  Object.keys(GUIDE_SPECS).filter((id) => guideCinemaSpecs(id).some((k) => fixedCinemaSpecs(id).includes(k))),
  []
);
// 全表断言，不依賴本地 data/ 裡剛好有哪些戲院（本機只有 40 間，服務器更多）。
eq(
  'guideSpecs 只裝指南來源的規格（不得含官方已公布或查不到的 key）',
  rows.filter((r) => r.guideSpecs.some((k) => !guideCinemaSpecs(r.id).includes(k))).map((r) => r.id),
  []
);
eq(
  '指南規格全部進了戲院頁的規格集合（否則篩選看不到）',
  rows.filter((r) => guideCinemaSpecs(r.id).some((k) => !r.specs.some((s) => s.key === k))).map((r) => r.id),
  []
);
eq(
  '官方已公布的規格不會被標成「僅指南支持」',
  rows.filter((r) => r.guideSpecs.some((k) => fixedCinemaSpecs(r.id).includes(k))).map((r) => r.id),
  []
);
eq(
  '指南規格都有對應的戲院配置條目（否則 fixture 與戲院頁都覆蓋不到）',
  Object.keys(GUIDE_SPECS).filter((id) => !CINEMA_FACILITIES[id]),
  []
);

// ============================================================
// 6c. 「普通影廳」（standard）—— 用戶 2026-09-26 指定補上
// ============================================================
// 官方與第三方都沒有公佈設備規格的戲院，卡片本來是空的。這個標籤把
// 「已查過、官方廳名全是編號廳」這件事說出來，讓卡片不再像漏做。
//
// ★ 兩個方向都要鈎死，因為它同時有「漏標」與「多標」兩種靜默失效：
//   漏標 → 卡片又退回空的（用戶最初投訴的就是這個）
//   多標 → 跟「4K 放映」同時出現，被讀成矛盾（見 cinema-specs.ts 的說明）
eq(
  '沒有戲院是「完全沒有規格標籤」的（否則卡片又會退回空的）',
  rows.filter((r) => r.specs.length === 0).map((r) => r.id),
  []
);
eq(
  '「普通影廳」不與其他規格同時出現',
  rows.filter((r) => r.specs.some((s) => s.key === 'standard') && r.specs.length > 1).map((r) => r.id),
  []
);
// 反方向：官方廳名帶品牌／高階格式的戲院不得被標成「普通影廳」——
// 這是這個標籤唯一可能說謊的方向（MCL 有品牌廳時一定會寫進廳名，
// 如「IMAX/12院」「LUXE」「Onyx Cinema LED」；影藝寫「7院 / IMAX」「VIP House」）。
const brandedHallName = /imax|luxe|onyx|mx4d|4dx|coronet|house fx|white box|black box|family house|festival suite|vivo|oval office|mm plus|mm moments|moviemaxx|cgs|thx|screen\s*x|cinity|real\s*d|k\s*star|sweetbox|vip|兒童影院/i;
eq(
  '「普通影廳」只給官方廳名沒有品牌／高階格式的戲院',
  Object.entries(CINEMA_FACILITIES)
    .filter(([id, f]) => f.specs.includes('standard') && brandedHallName.test(
      [...(CINEMA_FACILITIES[id]?.details ?? [])].join(' ') + ' ' + JSON.stringify(GUIDE_SPECS[id] ?? [])
    ))
    .map(([id]) => id),
  []
);
eq('「普通影廳」是合法規格 key', HALL_SPECS.some((s) => s.key === 'standard'), true);
const copy = fixedCinemaSpecs('broadway-4');
copy.push('fake');
eq('固定配置回傳副本，不被呼叫方修改', fixedCinemaSpecs('broadway-4'), ['dtsx', 'dolby71']);
for (const [id, facilities] of Object.entries(CINEMA_FACILITIES)) {
  eq(`${id} 配置鍵全部有效`, facilities.specs.every((key) => HALL_SPECS.some((spec) => spec.key === key)), true);
  eq(`${id} 固定規格不重複`, new Set(facilities.specs).size, facilities.specs.length);
  eq(`${id} 有配置摘要與 HTTPS 來源`, facilities.details.length > 0 && facilities.sources.length > 0 && facilities.sources.every((s) => s.url.startsWith('https://')), true);
}

// ============================================================
// 7. 表格自身的完整性
// ============================================================

const keys = HALL_SPECS.map((s) => s.key);
eq('规格 key 无重复', new Set(keys).size, keys.length);
if (HALL_SPECS.length !== 40) {
  console.log(`✗ 规格条数变了（${HALL_SPECS.length} ≠ 40）—— 增删规格请同步本测试的期望值`);
  bad++;
}
// 每个规格都要有 label，且不能出现空 label（空 label 会在下拉里留一个空白行）
for (const s of HALL_SPECS) {
  if (!s.label || specLabel(s.key) !== s.label) {
    console.log(`✗ 规格 ${s.key} 的 label 异常：「${s.label}」`);
    bad++;
  }
}
// 分组必须按声明顺序**连续成块**：下拉里靠「与上一个选项 group 不同」插小标题，
// 一旦交错，同一个标题会在清单里重复出现好几次。
const GROUP_ORDER = ['format', 'premium', 'hall'];
const seenGroups = HALL_SPECS.map((s) => s.group);
const orderedGroups = GROUP_ORDER.filter((g) => seenGroups.includes(g)).flatMap((g) => seenGroups.filter((x) => x === g));
if (JSON.stringify(seenGroups) !== JSON.stringify(orderedGroups)) {
  console.log(`✗ HALL_SPECS 的分组不是按 ${GROUP_ORDER.join(' → ')} 连续成块：${seenGroups.join(',')}`);
  bad++;
}

console.log(
  bad === 0
    ? `✓ 影廳規格规则通过（${HALL_SPECS.length} 条规格：${HALL_SPECS.map((s) => s.label).join('/')}）`
    : `${bad} 条不通过`
);
process.exit(bad === 0 ? 0 : 1);
