// 卡片链接必须都落在 generateStaticParams 生成的 slug 集合里。
//
// 为什么需要这条守卫：movie 详情页是 `dynamicParams = false` 的静态导出，
// 页面的**唯一**来源是 app/movie/[slug]/page.tsx 里
//   for (const g of getMovieGroups()) slugs.add(g.slug)   ← 全量池
// 而列表页卡片链接来自 getShowingGroups() / getUpcomingGroups()，
// 它们是**过滤池**。只要两个池对同一部片选出不同的 primary，slug 就会分叉，
// 卡片链接指向未生成的页面 → 404。
//
// 这个 bug 不会让构建失败、不会让类型检查报错，页面照样 200，
// 只有 probe/check-published-links.mjs 在**部署到服务器之后**才会发现。
// 那次失败代价是一次完整的服务器构建（2C2G 上数分钟），
// 且必须回滚才能恢复发布 —— 所以要在本地自检阶段就钉死。
//
// 2026-09-22 实际踩到：《善男信女》《怎麼可能我家的祖先是你家的鬼》
// 各有 showing + upcoming 两个条目，两个池选出的 primary 不同 → 3 条死链。
import { getMovieGroups, getShowingGroups, getUpcomingGroups } from '../lib/data.ts';

const pages = new Set(getMovieGroups().map((g) => g.slug));
const linked = new Map<string, string>();
for (const g of getShowingGroups()) linked.set(g.slug, 'showing');
for (const g of getUpcomingGroups()) linked.set(g.slug, 'upcoming');

const dead = [...linked].filter(([s]) => !pages.has(s));

console.log(
  `组页 ${pages.size} ｜ showing 卡片 ${getShowingGroups().length} ｜ upcoming 卡片 ${getUpcomingGroups().length}`
);
if (dead.length) {
  for (const [slug, from] of dead) console.log(`  ✗ ${from} 页链接 /movie/${slug}/ 无对应页面`);
  console.log(`✗ ${dead.length} 条卡片链接指向未生成的页面`);
  process.exit(1);
}
console.log('✓ 卡片链接全部有对应页面');
