#!/usr/bin/env node
/**
 * 文字对比度的回归测试（部署自检会跑）
 *
 * 为什么要钉死：对比度错了**不会报错、不会 404**，页面照样 200 ——
 *   只是灰字在灰底上变得难读。这种问题只有肉眼看才发现，
 *   而且很容易在后续调样式时被静默改坏（本次就是这么发生的：
 *   卡片从实心改半透明玻璃后，「次级文字 #8A8A94」按实心底算的
 *   5.18:1 前提失效，实际掉到 2.99:1，过了很久才被用户看出来）。
 *
 * 做法：**直接从 app/globals.css 读令牌值**，按 WCAG 公式算对比度。
 *   - 读文件而不是硬编码：硬编码的检查在令牌被改后仍会「通过」，
 *     那是最坏的一种测试（给出虚假的安全感）。
 *   - 不联网、不开浏览器：因此能在部署链路里无条件跑（同 check-danger.mts）。
 *
 * 局限（必须说清楚，避免过度自信）：
 *   这里算的是「文字色 vs 玻璃底色」的**理论**对比度，用的是
 *   --hkm-surface（#18181B）作为背景 —— 而真实页面是半透明玻璃，
 *   身后还有极光与主色层，实测值会比理论值低。
 *   所以真实值另有 probe/verify-real.cjs 用浏览器量（那一步需要起服务，
 *   只在手工验收时跑）。本检查的作用是**挡住令牌被改坏**这个最常见的退化，
 *   而不是替代实测。
 *
 * ★★ 2026-09-25：扩成**两套主题各查一遍** ★★
 *
 *   加入明色主题时发现这个检查有个致命盲区：它用
 *     new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`)
 *   在全文件里找**第一个**匹配 —— 那必然是 :root（暗色）里的那份。
 *   明色主题的 html[data-theme='light'] 块里那套值，
 *   它**一条都读不到**。
 *
 *   后果不是「检查变弱」而是「检查骗人」：
 *   明色令牌被改坏时它照样打印 ✓，给出虚假的安全感 ——
 *   而这份检查存在的全部理由就是「对比度错了不报错、只有肉眼看才发现」。
 *
 *   所以改成按块解析：先切出 :root 与 html[data-theme='light'] 两个
 *   作用域，各自取令牌、各自算、各自判。
 *   明色的底不能用 #18181B —— 那是暗色的卡片色；
 *   它要用自己的 --hkm-surface / --hkm-canvas。
 *
 * 跑法：node_modules/.bin/tsx probe/check-contrast.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');

/**
 * 切出两个主题作用域的 CSS 文本
 *
 * ★ 为什么必须切块而不能全文正则找第一个：
 *   全文找第一个匹配永远是 :root（暗色）那份，明色那套值读不到 ——
 *   于是明色被改坏时检查仍然通过。详见文件头注释。
 *
 * ★ 为什么用「下一个顶层选择器」当结束边界：
 *   两块的写法都是 `选择器 { … }` 且内部没有嵌套大括号
 *   （只有 var() 与普通值），所以从 `{` 到下一个 `}` 就是整块。
 *   用 indexOf('}') 而不是括号配对：这里够用，且不引入解析器的复杂度。
 */
function scope(startMarker: string): string {
  const i = CSS.indexOf(startMarker);
  if (i < 0) throw new Error(`在 app/globals.css 里找不到作用域 ${startMarker}`);
  const open = CSS.indexOf('{', i);
  const close = CSS.indexOf('\n}', open);
  if (open < 0 || close < 0) throw new Error(`作用域 ${startMarker} 的花括号不配对`);
  return CSS.slice(open, close);
}

const DARK_CSS = scope(':root {');
const LIGHT_CSS = scope("html[data-theme='light']");
const PINK_CSS = scope("html[data-theme='pink'] {");

/** 从给定作用域里取一个自定义属性（只认 `--x: #hex;` 写法） */
function tokenIn(scopeCss: string, name: string, where: string): string {
  const re = new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, 'i');
  const m = scopeCss.match(re);
  if (!m) throw new Error(`在 ${where} 里找不到 --${name}（检查是否被改名或删掉）`);
  return m[1];
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG 相对亮度 */
function lum([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * 每档文字的 AA 要求。
 *
 * 4.5:1 是 AA 正文标准。本站最小的正文只有 11px（评分卡的标签、
 * 场次卡的小字），远低于「大字号」的 18.66px/24px 门槛，
 * 所以**全部按 4.5 要求**，没有可以放宽的档位。
 *
 * faint 刻意排除：它只用于装饰性分隔符「·」，不承载信息，
 * 文件里也明确标注了「勿用于正文」。
 */
const TIERS: { name: string; min: number }[] = [
  { name: 'hkm-fg', min: 4.5 },
  { name: 'hkm-fg-soft', min: 4.5 },
  { name: 'hkm-fg-muted', min: 4.5 },
  { name: 'hkm-fg-dim', min: 4.5 },
];

/**
 * 逐主题检查
 *
 * ★ 明色的底必须用它自己的 --hkm-surface / --hkm-canvas：
 *   暗色的卡片底是 #18181B、明色是 #FFFFFF，
 *   拿错底算出来的数字毫无意义（而且会两边都错）。
 *
 * ★ 层级方向**两套主题相反**：
 *   暗色是「越重要的字越亮」（fg 最亮、faint 最暗）
 *   明色是「越重要的字越暗」（fg 最黑、faint 最浅）
 *   所以亮度单调性的判定方向也要跟着换。
 *   第一版忘了这一点，明色会被判「层级颠倒」—— 而它其实完全正确。
 */
function checkTheme(
  label: string,
  scopeCss: string,
  /** 越重要的字是否应该越亮（暗色 true / 明色 false） */
  heavierIsBrighter: boolean,
): number {
  let bad = 0;
  const surface = hexToRgb(tokenIn(scopeCss, 'hkm-surface', label));
  const canvas = hexToRgb(tokenIn(scopeCss, 'hkm-canvas', label));
  const hex = (n: string) => `#${hexToRgb(tokenIn(scopeCss, n, label)).map((v) => v.toString(16).padStart(2, '0')).join('')}`;

  console.log(`\n  ── ${label} ──  卡片底 ${hex('hkm-surface')} / 画布 ${hex('hkm-canvas')}`);
  console.log('  令牌              卡片底        画布        要求');
  for (const t of TIERS) {
    const c = hexToRgb(tokenIn(scopeCss, t.name, label));
    const onSurface = ratio(c, surface);
    const onCanvas = ratio(c, canvas);
    const ok = onSurface >= t.min && onCanvas >= t.min;
    if (!ok) bad++;
    console.log(
      `  ${t.name.padEnd(18)} ${onSurface.toFixed(2).padStart(6)}:1    ${onCanvas.toFixed(2).padStart(6)}:1    ` +
        `${t.min}:1  ${ok ? '✓' : '✗'}`,
    );
  }

  /*
   * 装饰色只做「不许被误当成正文」的守卫：它必须**确实**不达 AA。
   * 若哪天有人把它调到过 AA，说明有人开始拿它当正文用了 ——
   * 那时要么改用 dim，要么把这条断言改掉并想清楚。
   */
  const faint = ratio(hexToRgb(tokenIn(scopeCss, 'hkm-fg-faint', label)), surface);
  if (faint >= 4.5) {
    console.log(
      `  ⚠️ --hkm-fg-faint 现在 ${faint.toFixed(2)}:1 已过 AA —— ` +
        `它本应只做装饰。若确实要拿它当正文用，请改成本检查的 TIERS 里的一项。`,
    );
  }

  // 层级关系也要成立：越重要的字必须越「重」（防止改令牌时把顺序搞乱）
  const order = TIERS.map((t) => ({ name: t.name, l: lum(hexToRgb(tokenIn(scopeCss, t.name, label))) }));
  for (let i = 1; i < order.length; i++) {
    const inverted = heavierIsBrighter ? order[i].l >= order[i - 1].l : order[i].l <= order[i - 1].l;
    if (inverted) {
      console.log(`  ✗ 层级颠倒：${order[i].name} 不比 ${order[i - 1].name} ${heavierIsBrighter ? '暗' : '亮'}`);
      bad++;
    }
  }
  return bad;
}

let bad = 0;
bad += checkTheme('暗色（:root）', DARK_CSS, true);
bad += checkTheme("明色（html[data-theme='light']）", LIGHT_CSS, false);
bad += checkTheme("淡粉（html[data-theme='pink']）", PINK_CSS, false);

console.log(bad === 0 ? '\n✓ 三套主题的文字对比度令牌全部达 AA（4.5:1）' : `\n${bad} 项不通过`);
if (bad) process.exit(1);
