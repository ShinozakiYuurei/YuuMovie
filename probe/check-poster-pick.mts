#!/usr/bin/env node
/**
 * 「选哪张海报」的回归测试（部署自检会跑）
 *
 * 为什么要钉死：这套规则**全是取舍**，而且错了没有任何报错 ——
 *   卡片上只是悄悄换了一张封面，页面照样 200、照样有图，
 *   只有肉眼看首页才发现「怎么全变成 IMAX 角标版了」。
 *   2026-09-21 上一版就是纯按分辨率挑，把生化危機换成了
 *   「FILMED FOR IMAX」另一套物料，用户报上来才发现。
 *
 * 规则（用户 2026-09-21 定）：
 *   原版（香港官方宣传海报）> IMAX > 其他格式版；同级内取最清晰。
 *   例外：未本地化的远端海报一律让位给已本地化的（否则用户侧裂图，
 *        www.mclcinema.com 对用户网络不可达，见 lib/data.ts 注释）。
 *
 * 只依赖仓库内代码 + 构造的假数据，不读 data/、不联网，
 * 因此可以在本机与服务器上无条件执行（同 check-danger.mts）。
 *
 * 跑法：node_modules/.bin/tsx probe/check-poster-pick.mts
 */
import { pickPosterByTier } from '../lib/data.ts';
import { hasFormatMarker } from '../lib/versions.ts';
import type { Movie } from '../lib/types.ts';

const W = (pairs: Record<string, number>) => new Map(Object.entries(pairs));

/** 造一条最小可用的 Movie：只有片名与海报参与选图 */
function mv(name: string, poster: string): Movie {
  return { nameZh: name, nameEn: '', poster } as unknown as Movie;
}

type Case = {
  what: string;
  list: Movie[];
  widths: Map<string, number>;
  want: string;
  /** 期望不成立时给出的解释 */
  why: string;
};

const cases: Case[] = [
  {
    what: '原版与 IMAX 都清晰 → 选原版',
    list: [mv('IMAX 生化危機', '/p/imax.webp'), mv('生化危機', '/p/base.webp')],
    widths: W({ '/p/imax.webp': 800, '/p/base.webp': 800 }),
    want: '/p/base.webp',
    why: 'IMAX 物料是另一套图（生化危機：街头奔跑 vs 门框倒吊），用户要原版',
  },
  {
    what: 'IMAX 更清晰、原版较糊 → 仍选原版',
    list: [mv('IMAX 生化危機', '/p/imax.webp'), mv('生化危機', '/p/base.webp')],
    widths: W({ '/p/imax.webp': 800, '/p/base.webp': 400 }),
    want: '/p/base.webp',
    why: '分辨率不能盖过「原版优先」，否则又退回 2026-09-20 那版的行为',
  },
  {
    what: '没有原版 → 选 IMAX',
    list: [mv('IMAX 復仇者聯盟4：終局之戰 加碼重映', '/p/imax.webp'), mv('4DX 復仇者聯盟4：終局之戰 加碼重映', '/p/4dx.webp')],
    widths: W({ '/p/imax.webp': 800, '/p/4dx.webp': 800 }),
    want: '/p/imax.webp',
    why: '用户规则第二档：原版缺失时用 IMAX',
  },
  {
    what: '前两档都没有 → 其他版本之间仍先比片名纯净度',
    list: [mv('MX4D 劇場版 CHIIKAWA 人魚島的秘密', '/p/mx4d.webp'), mv('4DX 劇場版 CHIIKAWA 人魚島的秘密', '/p/4dx.webp')],
    widths: W({ '/p/4dx.webp': 400, '/p/mx4d.webp': 800 }),
    want: '/p/4dx.webp',
    why: '「4DX」比「MX4D」少一个字符，纯净度胜出。两者都是合法格式海报，谁赢都无所谓 —— 这里只是把实际行为钉下来，防的是将来改动时静默变了却没发现',
  },
  {
    what: '纯净度相同时才比清晰度',
    list: [mv('生化危機', '/p/small.webp'), mv('生化危機', '/p/big.webp')],
    widths: W({ '/p/small.webp': 290, '/p/big.webp': 800 }),
    want: '/p/big.webp',
    why: '同名同档，取更清晰的（MCL 290w vs 百老匯 800w）—— 这是最常见的情形',
  },
  {
    what: '原版里 MCL 290w 与其他院线 800w 并存 → 取 800w',
    list: [mv('奧德賽', 'https://www.mclcinema.com/a.jpg'), mv('奧德賽', '/p/broadway.webp')],
    widths: W({ '/p/broadway.webp': 800 }),
    want: '/p/broadway.webp',
    why: '同层内要比清晰度；未本地化的远端图不进比较',
  },
  {
    what: '原版未本地化、组内另有已本地化的 IMAX → 宁可给 IMAX',
    list: [mv('生化危機', 'https://www.mclcinema.com/a.jpg'), mv('IMAX 生化危機', '/p/imax.webp')],
    widths: W({ '/p/imax.webp': 800 }),
    want: '/p/imax.webp',
    why: 'mclcinema 对用户网络不可达，远端原版图等于裂图，这是唯一一处破例',
  },
  {
    what: '原版带语言标记 → 不算原版',
    list: [mv('劇場版 CHIIKAWA 人魚島的秘密 (日語版)', '/p/jp.webp'), mv('劇場版 CHIIKAWA 人魚島的秘密 (粵語版)', '/p/cant.webp')],
    widths: W({ '/p/jp.webp': 400, '/p/cant.webp': 800 }),
    want: '/p/cant.webp',
    why: '两个都不是原版（都在第二档），于是比清晰度',
  },
  {
    what: 'bestar 的「(日)」缩写也算带标记 → 不能当成原版',
    list: [mv('劇場版 CHIIKAWA 人魚島的秘密 (日)', '/p/bestar.webp'), mv('劇場版 CHIIKAWA 人魚島的秘密 (粵語版)', '/p/cant.webp')],
    widths: W({ '/p/bestar.webp': 800, '/p/cant.webp': 400 }),
    want: '/p/bestar.webp',
    why: '两者同档时取更清晰的；关键是 (日) 不能单独占「原版」档（否则会用印着日語版横幅的图）',
  },
  {
    what: '整组都带「重映」标记 → 仍要选出重映的香港官方海报，而不是 IMAX 通用物料',
    list: [
      mv('復仇者聯盟4：終局之戰 加碼重映', '/p/hk-official.webp'),
      mv('IMAX 復仇者聯盟4：終局之戰 加碼重映', '/p/imax-english.webp'),
    ],
    widths: W({ '/p/hk-official.webp': 800, '/p/imax-english.webp': 800 }),
    want: '/p/hk-official.webp',
    why: '实测：IMAX 那张是英文 REASSEMBLE 通用图，加碼重映那张（MCU 神級英雄集結）才是香港官方海报',
  },
  {
    what: '同档同宽时，选片名最素的（不要冠名物料）',
    list: [
      mv('(IV) 復仇者聯盟4：終局之戰 加碼重映', '/p/infinity.webp'),
      mv('復仇者聯盟4：終局之戰 加碼重映', '/p/official.webp'),
    ],
    widths: W({ '/p/infinity.webp': 800, '/p/official.webp': 800 }),
    want: '/p/official.webp',
    why: 'emperor 的 (IV) 是 Infinity Vision 缩写，那张图顶着彩色横带；官方那张才是香港海报',
  },
  {
    what: '顺序反过来也要得到同一张（不能靠遍历顺序碰运气）',
    list: [
      mv('復仇者聯盟4：終局之戰 加碼重映', '/p/official.webp'),
      mv('(IV) 復仇者聯盟4：終局之戰 加碼重映', '/p/infinity.webp'),
    ],
    widths: W({ '/p/infinity.webp': 800, '/p/official.webp': 800 }),
    want: '/p/official.webp',
    why: '旧实现在同档同宽时保留先到的，换顺序就换封面（不可复现）',
  },
  {
    what: '纯净度相同时才比清晰度（tier 2 同样适用）',
    list: [mv('生化危機', '/p/small.webp'), mv('生化危機', '/p/big.webp')],
    widths: W({ '/p/small.webp': 290, '/p/big.webp': 800 }),
    want: '/p/big.webp',
    why: '同名同档，取更清晰的（MCL 290w vs 百老匯 800w）',
  },
  {
    what: '完全没有海报 → 返回 null',
    list: [{ nameZh: '無海報片', nameEn: '', poster: null } as unknown as Movie],
    widths: W({}),
    want: '',
    why: '调用方据此渲染「無海報」占位',
  },
];

let bad = 0;

for (const c of cases) {
  const got = pickPosterByTier(c.list, c.widths) ?? '';
  if (got !== c.want) {
    console.log(`✗ ${c.what}\n    期望 ${c.want || '(null)'}，实际 ${got || '(null)'}\n    理由：${c.why}`);
    bad++;
  }
}

/**
 * 档位判定的边界：这些写法必须被判成「带会换图的标记」
 */
const mustHaveMarker = [
  ['劇場版 CHIIKAWA 人魚島的秘密 (日)', 'bestar 的方言缩写，图上印着「日語版」横幅'],
  ['劇場版 CHIIKAWA 人魚島的秘密 (日語版)', '明写'],
  ['(日語版) 劇場版 CHIIKAWA 人魚島的秘密', '英皇写在前面'],
  ['IMAX 奧德賽', '格式前缀'],
  ['奧德賽 IMAX with Laser', 'MCL 写在后面'],
  ['35mm 菲林版 奧德賽', '胶片格式'],
  ['(IMAX 特典場) 復仇者聯盟4：終局之戰', '英皇的组合写法'],
  ['劇場版 CHIIKAWA 人魚島的秘密 (粵語版)', '语言版'],
  ['霸王別姬 (4K修復版)', '修复版物料'],
];
/**
 * 这些必须判成「原版」（否则会平白掉到 IMAX 档，选错封面）。
 *
 * 后半批是**不改变画面**的标记（重映 / 影展名 / 场次类型 / 活动标签）——
 * 它们只说明这是哪一场，物料还是官方那一套。
 */
const mustBeBase = [
  ['生化危機', '裸片名'],
  ['奧德賽', '裸片名'],
  ['復仇者聯盟5：末日降臨', '裸片名'],
  ['劇場版 CHIIKAWA 人魚島的秘密', 'MCL 的裸片名'],
  ['八仙！', '裸片名'],
  ['Look Back 驀然回首', '中英混排'],
  ['復仇者聯盟4：終局之戰 加碼重映', '整组都带重映标记，不能因此全组没有原版档'],
  ['故鄉異客 (GFF)', '影展名不改物料'],
  ['【Infinity Vision】復仇者聯盟4：終局之戰', '活动标签不改物料'],
  ['破・地獄 (bc30 x APAAA)', '活动标签不改物料'],
  ['鐵達尼號  (3D版)', '2D/3D 是默认规格，无专属物料'],
];

for (const [n, why] of mustHaveMarker) {
  if (!hasFormatMarker(n)) {
    console.log(`✗ 漏判版本标记: ${n}（${why}）`);
    bad++;
  }
}
for (const [n, why] of mustBeBase) {
  if (hasFormatMarker(n)) {
    console.log(`✗ 误判为带标记: ${n}（${why}）`);
    bad++;
  }
}

console.log(bad === 0 ? `✓ 选图规则 ${cases.length} 例 + 标记判定 ${mustHaveMarker.length + mustBeBase.length} 例全部通过` : `${bad} 条不通过`);
process.exit(bad === 0 ? 0 : 1);
