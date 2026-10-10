#!/usr/bin/env node
/**
 * 旧 slug → 新 slug 的 301 规则回归测试（部署自检会跑）
 *
 * 为什么要钉死：这张表决定「用户点旧链接会去哪」。
 *   错了不会报错、页面照样 200 —— 只是：
 *     - 该重定向的没重定向（旧链接 404，等于没修），
 *     - 或者更糟：把一个**活着的页面**劫走，用户点 A 片被送到 B 片。
 *   后者是静默的数据错误，只有肉眼点链接才发现。
 *
 * 测的是纯函数 computeRedirects（不读 data/、不碰 fs、不联网），
 * 所以服务器与本机都能跑。真实数据的健全性由 probe/check-slug-redirects.mts 守。
 *
 * 跑法：node --import tsx --test scripts/test-slug-redirects.mts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeRedirects, renderMap, buildRedirects } from '../scripts/gen-slug-redirects.mts';

/** 造一部片：一个组 + 若干条目，`canonicalSlug` 那个条目的 slug 即组地址 */
function film(canonicalSlug: string, entries: { id: string; slug: string }[]) {
  return {
    group: { slug: canonicalSlug, versions: [{ movieIds: entries.map((e) => e.id) }] },
    entries,
  };
}

test('组内非代表条目 → canonical slug', () => {
  const { group, entries } = film('avengers-doomsday-1274', [
    { id: 'broadway-1274', slug: 'avengers-doomsday-1274' },
    { id: 'broadway-1418', slug: 'avengers-doomsday-special-screening-1418' },
  ]);
  assert.deepEqual(computeRedirects(entries, [group]), [
    { from: 'avengers-doomsday-special-screening-1418', to: 'avengers-doomsday-1274', id: 'broadway-1418' },
  ]);
});

test('代表条目自己不进表（from === to）', () => {
  const { group, entries } = film('a-1', [{ id: 'src-1', slug: 'a-1' }]);
  assert.deepEqual(computeRedirects(entries, [group]), []);
});

test('★ 绝不劫走活页面：某条目 slug 恰好是别的组的 canonical', () => {
  // 条目 src-9 的 slug 是 "b-2"，而 b-2 是**另一组**的正式地址。
  // 重定向它会把这个真实页面劫走 —— 必须跳过（宁可不重定向）。
  const g1 = { slug: 'a-1', versions: [{ movieIds: ['src-1', 'src-9'] }] };
  const g2 = { slug: 'b-2', versions: [{ movieIds: ['src-2'] }] };
  const entries = [
    { id: 'src-1', slug: 'a-1' },
    { id: 'src-9', slug: 'b-2' },
    { id: 'src-2', slug: 'b-2' },
  ];
  assert.deepEqual(computeRedirects(entries, [g1, g2]), []);
});

test('★ 歧义丢弃：同一旧 slug 指向两个不同的组', () => {
  // 真实场景：两个源各自抓出同名条目、片名清洗后 slug 撞车但归入不同组。
  // 送错片的代价比 404 大，所以整条不要。
  const g1 = { slug: 'a-1', versions: [{ movieIds: ['src-1', 'src-x'] }] };
  const g2 = { slug: 'b-2', versions: [{ movieIds: ['src-y'] }] };
  const entries = [
    { id: 'src-1', slug: 'a-1' },
    { id: 'src-x', slug: 'shared' },
    { id: 'src-y', slug: 'shared' },
  ];
  const got = computeRedirects(entries, [g1, g2]);
  assert.deepEqual(got.filter((e) => e.from === 'shared'), []);
});

test('非 ASCII / 脏 slug 不进表（中文 slug 在 /movie/[slug] 下必然 404）', () => {
  const { group, entries } = film('good-1', [
    { id: 'src-1', slug: 'good-1' },
    { id: 'src-2', slug: '生化危機-src-2' },
    { id: 'src-3', slug: '-leading-dash' },
    { id: 'src-4', slug: 'has space' },
  ]);
  assert.deepEqual(computeRedirects(entries, [group]), []);
});

test('条目不在任何组里时跳过（不猜目的地）', () => {
  const { group, entries } = film('a-1', [{ id: 'src-1', slug: 'a-1' }]);
  const orphan = [{ id: 'src-ghost', slug: 'ghost-slug' }];
  assert.deepEqual(computeRedirects([...entries, ...orphan], [group]), []);
});

test('输出按 from 排序且无重复（表是可复现的）', () => {
  const { group, entries } = film('z-9', [
    { id: 'src-1', slug: 'z-9' },
    { id: 'src-2', slug: 'm-2' },
    { id: 'src-3', slug: 'a-3' },
  ]);
  const got = computeRedirects(entries, [group]);
  assert.deepEqual(got.map((e) => e.from), ['a-3', 'm-2']);
  assert.equal(new Set(got.map((e) => e.from)).size, got.length);
});

test('渲染出的 map 块语法正确：含 default "" 且两条 $uri 写法都收', () => {
  const text = renderMap([{ from: 'old-1', to: 'new-2', id: 'x' }], '2026-10-04T00:00:00Z');
  assert.match(text, /^map \$uri \$hkm_redirect_to \{/m);
  assert.match(text, /^\s*default "";$/m);
  // trailingSlash: true → 请求通常带尾斜杠，但两种都必须命中，
  // 否则直接输入不带斜杠的旧地址会掉进 404
  assert.match(text, /^\s*\/movie\/old-1\/\s+\/movie\/new-2\/;$/m);
  assert.match(text, /^\s*\/movie\/old-1\s+\/movie\/new-2\/;$/m);
  // 最后一个大括号要闭合
  assert.match(text, /^\}$/m);
});

test('空表也要能渲染（首次部署放占位表用）', () => {
  const text = renderMap([], '2026-10-04T00:00:00Z');
  assert.match(text, /^map \$uri \$hkm_redirect_to \{/m);
  assert.match(text, /^\s*default "";$/m);
  assert.match(text, /^\}$/m);
});

// ---------- 长度上限：超了必须拒绝写盘 ----------
//
// 这张表每次重建都重新生成，而站点 conf include 的是固定路径 ——
// 写出一个 nginx 装不下的表，磁盘上的配置就坏了。当下不发作
// （nginx 还在用内存里的旧配置跑），但**容器下次重启就起不来**，
// 而这个 nginx 还带着另外三个站。所以宁可沿用旧表。
// 实测（2026-10-04，530 条真实数据）：最长 108 字符。
test('★ 超长 slug 会被长度守卫识别（写出前拦截，不落盘）', () => {
  // 规则本身不拦长 slug（拦的是写盘那一步），所以这里验的是
  // 「渲染出来的行确实超长」＋「上限常量与 nginx 配置对得上」。
  const longSlug = 'x'.repeat(200);
  const { group, entries } = film('a-1', [
    { id: 'src-1', slug: 'a-1' },
    { id: 'src-2', slug: longSlug },
  ]);
  const got = computeRedirects(entries, [group]);
  assert.equal(got.length, 1);

  const text = renderMap(got, 't');
  const keys = text
    .split('\n')
    .filter((l) => l.trim().startsWith('/movie/'))
    .map((l) => l.trim().split(/\s+/)[0]);
  assert.ok(
    keys.some((k) => k.length > 120),
    `应当有超过 120 字符的 key（实测最长 ${Math.max(...keys.map((k) => k.length))}）`
  );

  // ★ 但它仍必须落在 nginx 装得下的范围内（2026-10-10 上限放宽到 248），
  //   否则真实数据里出现这种长度时，生成器会拒绝写表、旧地址静默 404。
  assert.ok(
    Math.max(...keys.map((k) => k.length)) <= 248,
    `构造出的超长 key 超出 nginx 容量 248，最长 ${Math.max(...keys.map((k) => k.length))}`
  );
});

test('★ 真实数据的键长在 nginx bucket 容量内（当前 256）', () => {
  // 用真实 data/；没有数据的环境（如全新 checkout）跳过而不误报。
  let entries: ReturnType<typeof computeRedirects>;
  try {
    entries = buildRedirects();
  } catch {
    return;
  }
  if (!entries.length) return;
  const longest = Math.max(
    ...entries.flatMap((e) => [`/movie/${e.from}/`, `/movie/${e.to}/`].map((s) => s.length))
  );
  // 256 是 deploy/nginx-static.conf 里 map_hash_bucket_size 的值（2026-10-10 从 128 提上来）。
  // 248 = 256 - 8，与 gen-slug-redirects.mts 的 MAX_KEY_LEN 同源。
  // 超了就必须同步调大那里（而且要走 sync-nginx-conf.sh 才能上线上），
  // 否则生成器会拒绝写表、旧 slug 静默不重定向。
  //
  // ★ 2026-10-10 踩到：CHIIKAWA 特典場的 key 实测 122 字符，正好破 120，
  //   线上那次部署拒绝写表、旧地址静默 404。片名长度没有上限（抓取器不截断），
  //   所以这个阈值必须留够余量，而不是贴着当前最长值。
  assert.ok(
    longest <= 248,
    `最长 key ${longest} 字符，逼近 nginx map_hash_bucket_size 256；` +
      `请同步调大 deploy/nginx-static.conf 与 gen-slug-redirects.mts 的 NGINX_BUCKET_SIZE，并确认线上已同步`
  );
});
