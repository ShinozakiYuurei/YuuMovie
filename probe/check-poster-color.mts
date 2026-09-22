#!/usr/bin/env node
/**
 * 「海报主色提取」的回归测试（部署自检会跑）
 *
 * 为什么要钉死：取色规则**全是取舍**，错了不会报错、也不会 404 ——
 *   只是详情页卡片的背景颜色悄悄变了（黑白片被染成紫色、
 *   亮海报把白字压成不可读、深色海报取出来跟画布一样黑）。
 *   这些只有肉眼看详情页才发现，所以和 check-poster-pick.mts 一样
 *   在发布前跑一遍。
 *
 * 只依赖仓库内代码 + 构造的假像素，不读 data/、不联网，
 * 因此可以在本机与服务器上无条件执行（同 check-danger.mts）。
 *
 * 跑法：node_modules/.bin/tsx probe/check-poster-color.mts
 */
import { dominantColor, normalizeAccent } from '../scripts/poster-colors.mjs';

let bad = 0;
function check(what: string, got: unknown, want: unknown, why: string) {
  const ok = got === want;
  if (!ok) {
    console.log(`✗ ${what}\n    得到 ${got}\n    期望 ${want}\n    理由：${why}`);
    bad++;
  }
}

/** 把 [r,g,b] 列表铺成像素缓冲：每色重复 n 次，用来造「面积」 */
function px(list: [number, number, number, number][]) {
  const out: number[] = [];
  for (const [r, g, b, n] of list) for (let i = 0; i < n; i++) out.push(r, g, b);
  return Buffer.from(out);
}

// ---------- 主色提取 ----------

// ① 纯数量会被大面积背景赢走 —— 这正是要加权饱和度的理由
check(
  '深灰底 + 小块彩色 → 取彩色',
  dominantColor(px([[10, 10, 12, 800], [30, 90, 200, 200]])),
  normalizeAccent(30, 90, 200),
  '海报典型构成是「大片黑底 + 彩色主体」，纯数量会取到黑，等于没取色',
);

// ② 彩色块足够大时仍是它
check(
  '彩色为主 → 取彩色',
  dominantColor(px([[200, 60, 50, 700], [240, 240, 240, 300]])),
  normalizeAccent(200, 60, 50),
  '主体色占多数时不该被白字抢走',
);

// ③ 近黑背景不能因为面积大而胜出（权重压到 0.25 后彩色仍赢）
check(
  '近黑底（面积 3 倍）→ 仍取彩色',
  dominantColor(px([[0, 0, 0, 900], [180, 40, 140, 300]])),
  normalizeAccent(180, 40, 140),
  '极暗要压权重而不是直接丢，否则深色海报集体退回中性玻璃',
);

// ④ 整张极暗且无彩（近黑灰）→ 无颜色（不铺色）
//
// ★ 这条期望在加入「覆盖率门槛」后变了，属于**故意**的行为修正：
//   [[8,8,10,500]] 的饱和度 (10-8)/10 = 0.2，低于 0.25 门槛，
//   覆盖率 0% → 判为无颜色。这与「黑白片不铺灰」是同一条原则：
//   把 #1a1a31 这种近黑铺在本来就 #0A0A0C 的卡上本来就看不见，
//   强行铺只会让卡片发灰。
check(
  '整张极暗且无彩 → null',
  dominantColor(px([[8, 8, 10, 500]])),
  null,
  '近黑灰不是「颜色」，铺上去也看不见，应该诚实回退到中性玻璃',
);

// ④b 极暗但**有彩**（深蓝夜色）→ 仍要给出颜色
check(
  '极暗但有彩（深蓝夜色）→ 归一化到可见亮度',
  dominantColor(px([[8, 8, 40, 500]])),
  normalizeAccent(8, 8, 40),
  '深蓝夜色确实有主色，不能因为「暗」就退化成中性玻璃',
);

// ⑤ 空输入不能抛
check('空输入 → null', dominantColor(Buffer.alloc(0)), null, '空图应安全返回，不能崩');

// ⑥ 灰度图（1 通道）也要能处理
check(
  '灰度 1 通道',
  dominantColor(Buffer.from([80, 80, 80, 80]), 1),
  normalizeAccent(80, 80, 80),
  'sharp 对灰度图可能给 1 通道，读取层不能假设一定是 RGB',
);

// ⑦ RGBA（4 通道）：alpha 不参与取色，否则透明区的黑边会拉低主色
check(
  'RGBA 4 通道忽略 alpha',
  dominantColor(Buffer.from([30, 90, 200, 255, 30, 90, 200, 0]), 4),
  normalizeAccent(30, 90, 200),
  '带 alpha 的源要能正确处理（removeAlpha 之外还得兼容，多一层保险）',
);

// ---------- 归一化：三条硬约束 ----------

/** 解析 #rrggbb 回 HSL，用于断言归一化后的饱和度/色相 */
function hslOf(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

/** WCAG 相对亮度 —— 底色是否安全只看它，不看 HSL 的 L */
function relLumOf(hex: string) {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * f(parseInt(hex.slice(1, 3), 16)) +
    0.7152 * f(parseInt(hex.slice(3, 5), 16)) +
    0.0722 * f(parseInt(hex.slice(5, 7), 16))
  );
}

/**
 * ★★ 亮度约束必须用**相对亮度**，不能用 HSL 的 L ★★
 *
 * 第一版这里断言的是 HSL L ∈ [0.30, 0.52]，看着合理（「中低亮度」），
 * 实际放行了一块极亮的黄色底：黄色海报 #EDDD1D 的 HSL L 恰好 0.52，
 * 但相对亮度是 0.72（比纯蓝高 30 倍）。铺到卡片上实测（sweep-lummax.cjs）：
 *   次级文字 #8A8A94 2.95:1 → 1.00:1，连白字都从 9.16:1 掉到 2.91:1。
 * 所以这里改成断言相对亮度 ∈ [0.012, 0.1] —— 它才是感知亮度，
 * 且与 CSS 侧 alpha 稀释后的合成结果直接可比。
 */
for (const [r, g, b] of [[255, 0, 0], [0, 0, 255], [237, 221, 29], [255, 255, 0], [0, 255, 255], [255, 0, 255], [0, 128, 0], [255, 128, 0]] as const) {
  const hex = normalizeAccent(r, g, b);
  if (hex == null) {
    console.log(`✗ rgb(${r},${g},${b}) 有明确彩色却被判成「无颜色」（返回 null）`);
    bad++;
    continue;
  }
  const L = relLumOf(hex);
  const ok = L >= 0.0115 && L <= 0.101;
  if (!ok) {
    console.log(
      `✗ 相对亮度越界: rgb(${r},${g},${b}) → ${hex}（相对亮度 ${L.toFixed(4)}，应在 [0.012, 0.1]）\n` +
        `    这一档最关键的是黄色：HSL L 看不出问题，相对亮度会亮 30 倍，把白字压垮`,
    );
    bad++;
  }
}

/*
 * 灰色主色必须返回 null（不铺色）
 *
 * 实测踩过：第一版把灰归一化成一个灰阶（如 #595959）铺上去，
 * 卡片变成一片灰雾 —— 比不铺还难看。
 * 原因是灰色没有色相，要「看得见」就必须抬到相对亮度 0.1，
 * 而卡片底色只有 0.035，等于把整卡提亮 3 倍；
 * 彩色则不会，因为提亮会被读成「染了那个颜色」而不是「发灰」。
 * 所以「这张海报没有可取的颜色」就应该诚实地返回 null，
 * 由组件回退到中性玻璃（见 components/MovieIntro.tsx）。
 */
for (const [r, g, b] of [[120, 120, 120], [0, 0, 0], [255, 255, 255], [40, 38, 37], [236, 236, 232]] as const) {
  const hex = normalizeAccent(r, g, b);
  if (hex != null) {
    console.log(`✗ 灰色 rgb(${r},${g},${b}) 应返回 null（不铺色），却得到 ${hex} —— 会在卡片上糊一层灰雾`);
    bad++;
  }
}

// 灰图不能编造色相 —— 且必须整张判成「无颜色」（返回 null）
check(
  '灰色像素 → null',
  dominantColor(px([[80, 80, 80, 400], [200, 200, 200, 100]])),
  null,
  '黑白片/老照片没有主题色，铺一层灰比不铺更难看（见 normalizeAccent 注释）',
);

// 极暗 / 极亮的**无色**输入也是「无颜色」，不是「彩色被误判」
for (const [r, g, b] of [[5, 5, 5], [250, 250, 250], [0, 0, 0], [255, 255, 255]] as const) {
  if (normalizeAccent(r, g, b) != null) {
    console.log(`✗ 无色输入 rgb(${r},${g},${b}) 应返回 null`);
    bad++;
  }
}

// 有彩色的图必须保住色相（允许 ±3° 的舍入误差）
for (const [r, g, b] of [[30, 90, 200], [200, 60, 50], [180, 40, 140], [237, 221, 29]] as const) {
  const src = hslOf(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  const hex = normalizeAccent(r, g, b);
  if (hex == null) {
    console.log(`✗ rgb(${r},${g},${b}) 有彩色却返回 null`);
    bad++;
    continue;
  }
  const out = hslOf(hex);
  let dh = Math.abs(src.h - out.h) * 360;
  if (dh > 180) dh = 360 - dh;
  if (dh > 3) {
    console.log(`✗ 色相漂移: rgb(${r},${g},${b}) 源 ${(src.h * 360).toFixed(1)}° → 输出 ${(out.h * 360).toFixed(1)}°`);
    bad++;
  }
}

/*
 * 黑白片 + 一个小彩色 logo → 必须返回 null（不铺色）
 *
 * 实测踩过（probe/gate.mjs）：只靠「选中那一桶的饱和度」会把这类海报判成
 * 有颜色，然后拿那个 logo 的颜色铺满整张卡。覆盖率的天然分界在 3% 附近：
 *   KINO 系黑白剧照（只有绿 logo）0.1%~2.9%  vs  蜘蛛俠真彩色 5.3%
 */
check(
  '黑白底 + 极小彩色块（2%）→ null',
  dominantColor(px([[200, 200, 200, 980], [30, 200, 60, 20]])),
  null,
  '彩色只占 2% 时不应拿它代表整张海报（黑白片 + 小 logo 就是这种情况）',
);

// 彩色占比足够（>3%）时应当给出颜色
check(
  '黑白底 + 明显彩色块（>3%）→ 有颜色',
  dominantColor(px([[200, 200, 200, 900], [30, 90, 200, 100]])) !== null,
  true,
  '彩色占到 10% 时就是这张海报的主色，应该铺上',
);

console.log(bad === 0 ? '✓ 主色提取规则全部通过' : `${bad} 条不通过`);
if (bad) process.exit(1);
