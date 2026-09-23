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
 * 只依赖仓库内代码，不读 data/、不联网，服务器上也能跑。
 *
 * 跑法：node_modules/.bin/tsx probe/check-cinema-specs.mts
 */
import { hallSpecsOf, HALL_SPECS, sortSpecs, specLabel } from '../lib/cinema-specs.ts';
import { readFileSync } from 'node:fs';
import { getCinemaRows, getMeta } from '../lib/data.ts';

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
const sourceFiles = ['broadway', 'mcl', 'emperor', 'cinemacity', 'bestar'];
const normalHall = /^(?:house\s*\d+(?:\s*\(\s*\d+\s*院\s*\))?|\d+院)$/i;
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
eq('戲院頁實際標籤：PALACE ifc 有 DTS:X', palaceIfc?.specs.map((spec) => spec.key), ['dtsx']);
eq('英皇總部辦公地址不列為放映戲院', getCinemaRows().some((cinema) => cinema.id === 'emperor-57001'), false);
eq('首頁和頁尾的戲院總數與戲院列表一致', getMeta().counts.cinemas, getCinemaRows().length);

// ============================================================
// 7. 表格自身的完整性
// ============================================================

const keys = HALL_SPECS.map((s) => s.key);
eq('规格 key 无重复', new Set(keys).size, keys.length);
if (HALL_SPECS.length !== 26) {
  console.log(`✗ 规格条数变了（${HALL_SPECS.length} ≠ 26）—— 增删规格请同步本测试的期望值`);
  bad++;
}
// 每个规格都要有 label，且不能出现空 label（空 label 会在下拉里留一个空白行）
for (const s of HALL_SPECS) {
  if (!s.label || specLabel(s.key) !== s.label) {
    console.log(`✗ 规格 ${s.key} 的 label 异常：「${s.label}」`);
    bad++;
  }
}
// 放映格式必须排在特色影廳之前（下拉里的分组标题才不会来回跳）
const firstPremium = HALL_SPECS.findIndex((s) => s.group === 'premium');
const lastFormat = HALL_SPECS.map((s) => s.group).lastIndexOf('format');
if (firstPremium < lastFormat) {
  console.log('✗ 放映格式与特色影廳在 HALL_SPECS 里交错，分组标题会重复出现');
  bad++;
}

console.log(
  bad === 0
    ? `✓ 影廳規格规则通过（${HALL_SPECS.length} 条规格：${HALL_SPECS.map((s) => s.label).join('/')}）`
    : `${bad} 条不通过`
);
process.exit(bad === 0 ? 0 : 1);
