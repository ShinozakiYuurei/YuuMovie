#!/usr/bin/env node
/**
 * 旧 slug 重定向表的健全性检查（部署自检会跑）
 *
 * 为什么需要：这张表决定「用户点旧链接会去哪」，错了不报错、页面照样 200。
 *   规则本身由 scripts/test-slug-redirects.mts 用 fixture 钉死；
 *   这里守的是**真实数据下的整体性质**，三条都是无法用 fixture 表达的：
 *
 *   1. 表里的 from 必须是**当前数据里真实存在的条目 slug**
 *      —— 凭空多出来的条目意味着生成逻辑读错了字段。
 *   2. from 绝不能是任何组的 canonical
 *      —— 否则会把一个活着的页面 301 走（用户点 A 片被送到 B 片）。
 *   3. to 必须是当前真实存在的组地址
 *      —— 否则重定向到 404，比不重定向更糟（多一跳还到不了）。
 *
 * 另外顺带统计覆盖率：组内非代表条目应当**全部**进表
 *   （518 条目 − 253 组 = 265 条），漏掉就意味着有旧地址没被救回来。
 *
 * 不联网、只依赖仓库内代码与 data/，服务器上也能跑。
 *
 * 跑法：node_modules/.bin/tsx probe/check-slug-redirects.mts
 */
import { getAllMovies, getMovieGroups } from '../lib/data.ts';
import {
  computeRedirects,
  renamedRedirects,
  RENAMED_SLUGS,
  type GroupSource,
  type SlugSource,
} from '../scripts/gen-slug-redirects.mts';

const movies = getAllMovies();
const groups = getMovieGroups();

const derived = computeRedirects(movies as SlugSource[], groups as unknown as GroupSource[]);
const legacy = renamedRedirects(groups as unknown as GroupSource[]);
const entries = [...derived, ...legacy].sort((a, b) => a.from.localeCompare(b.from));
const canonicalSlugs = new Set(groups.map((g) => g.slug));
const knownSlugs = new Set(movies.map((m) => m.slug));
/** 改名遗留地址的 from 不是任何条目 slug（正是它存在的原因），单独放行。 */
const renamedFroms = new Set(RENAMED_SLUGS.map((r) => r.from));

let bad = 0;

// ---- 1. from 必须是真实存在的条目 slug ----
const ghost = entries.filter((e) => !knownSlugs.has(e.from) && !renamedFroms.has(e.from));
for (const e of ghost) {
  console.log(`  ✗ 表里的 from 不是任何条目的 slug：${e.from}（条目 ${e.id}）`);
  bad++;
}

// ---- 2. from 绝不能是活着的组地址 ----
const hijack = entries.filter((e) => canonicalSlugs.has(e.from));
for (const e of hijack) {
  console.log(`  ✗ from 是活页面，会被劫走：${e.from} → ${e.to}`);
  bad++;
}

// ---- 3. to 必须是真实存在的组地址 ----
const deadEnd = entries.filter((e) => !canonicalSlugs.has(e.to));
for (const e of deadEnd) {
  console.log(`  ✗ to 不是任何组地址（会 301 到 404）：${e.from} → ${e.to}`);
  bad++;
}

// ---- 4. 覆盖率：组内每个非代表条目都应在表里 ----
const canonicalOf = new Map<string, string>();
for (const g of groups) {
  for (const v of g.versions) for (const id of v.movieIds) canonicalOf.set(id, g.slug);
}
const expected = new Set<string>();
for (const m of movies) {
  const to = canonicalOf.get(m.id);
  if (to && m.slug && m.slug !== to && !canonicalSlugs.has(m.slug)) expected.add(m.slug);
}
const got = new Set(entries.map((e) => e.from));
const missing = [...expected].filter((s) => !got.has(s));
for (const s of missing) {
  console.log(`  ✗ 应当重定向却没进表：${s}`);
  bad++;
}
const extra = [...got].filter((s) => !expected.has(s) && !renamedFroms.has(s));
for (const s of extra) {
  console.log(`  ✗ 表里有不该出现的条目：${s}`);
  bad++;
}

// ---- 5. 改名遗留地址：声明的必须解析出目标；anchor 下画后必须自动退出 ----
const aliveIds = new Set<string>();
for (const g of groups) for (const v of g.versions) for (const id of v.movieIds) aliveIds.add(id);
for (const r of RENAMED_SLUGS) {
  const hit = entries.find((e) => e.from === r.from);
  const anchorAlive = aliveIds.has(r.anchorId);
  if (anchorAlive && !hit) {
    console.log(`  ✗ 改名遗留地址没进表：${r.from}（anchor ${r.anchorId}）`);
    bad++;
  }
  if (!anchorAlive && hit) {
    console.log(`  ✗ anchor 已下画，遗留地址却还在表里：${r.from}`);
    bad++;
  }
  if (hit && !canonicalSlugs.has(hit.to)) {
    console.log(`  ✗ 遗留地址指向不存在的组：${r.from} → ${hit.to}`);
    bad++;
  }
}

console.log(
  `重定向表：${entries.length} 条（含改名遗留 ${legacy.length}）｜ 组 ${groups.length} ｜ ` +
    `条目 ${movies.length} ｜ 应有 ${expected.size}`
);
if (bad) {
  console.log(`✗ ${bad} 项检查不通过`);
  process.exit(1);
}
console.log('✓ 旧 slug 重定向表健全（无劫持、无死胡同、覆盖完整）');
