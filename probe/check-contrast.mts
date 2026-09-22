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
 * 跑法：node_modules/.bin/tsx probe/check-contrast.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');

/** 从 CSS 里取一个自定义属性的值（只认 `:root` 里那种 `--x: #hex;` 写法） */
function token(name: string): string {
  const re = new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, 'i');
  const m = CSS.match(re);
  if (!m) throw new Error(`在 app/globals.css 里找不到 --${name}（检查是否被改名或删掉）`);
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

const surface = hexToRgb(token('hkm-surface'));
const canvas = hexToRgb(token('hkm-canvas'));

/**
 * 每档文字的 AA 要求。
 *
 * 4.5:1 是 AA 正文标准。本站最小的正文只有 11px（评分卡的标签、
 * 场次卡的小字），远低于「大字号」的 18.66px/24px 门槛，
 * 所以**全部按 4.5 要求**，没有可以放宽的档位。
 *
 * faint（#5A5A63）刻意排除：它只用于装饰性分隔符「·」，
 * 不承载信息，文件里也明确标注了「勿用于正文」。
 */
const TIERS: { name: string; min: number }[] = [
  { name: 'hkm-fg', min: 4.5 },
  { name: 'hkm-fg-soft', min: 4.5 },
  { name: 'hkm-fg-muted', min: 4.5 },
  { name: 'hkm-fg-dim', min: 4.5 },
];

let bad = 0;
console.log('  令牌              卡片底(#18181B)   画布(#0A0A0C)   要求');
for (const t of TIERS) {
  const c = hexToRgb(token(t.name));
  const onSurface = ratio(c, surface);
  const onCanvas = ratio(c, canvas);
  const ok = onSurface >= t.min && onCanvas >= t.min;
  if (!ok) bad++;
  console.log(
    `  ${t.name.padEnd(18)} ${onSurface.toFixed(2).padStart(6)}:1        ${onCanvas.toFixed(2).padStart(6)}:1      ` +
      `${t.min}:1  ${ok ? '✓' : '✗'}`,
  );
}

/*
 * 装饰色只做「不许被误当成正文」的守卫：它必须**确实**不达 AA。
 * 若哪天有人把它调亮到过 AA，说明有人开始拿它当正文用了 ——
 * 那时要么改用 dim，要么把这条断言改掉并想清楚。
 */
const faint = ratio(hexToRgb(token('hkm-fg-faint')), surface);
if (faint >= 4.5) {
  console.log(
    `\n  ⚠️ --hkm-fg-faint 现在 ${faint.toFixed(2)}:1 已过 AA —— ` +
      `它本应只做装饰。若确实要拿它当正文用，请改成本检查的 TIERS 里的一项。`,
  );
}

// 层级关系也要成立：越重要的字必须越亮（防止改令牌时把顺序搞乱）
const order = TIERS.map((t) => ({ name: t.name, l: lum(hexToRgb(token(t.name))) }));
for (let i = 1; i < order.length; i++) {
  if (order[i].l >= order[i - 1].l) {
    console.log(`\n  ✗ 层级颠倒：${order[i].name} 不比 ${order[i - 1].name} 暗`);
    bad++;
  }
}

console.log(bad === 0 ? '\n✓ 文字对比度令牌全部达 AA（4.5:1）' : `\n${bad} 项不通过`);
if (bad) process.exit(1);
