/**
 * 复核 fallback 行：把「采用」和「跳过」两个条目的真实片名都查出来人工判
 *
 * fallback 规则的前提是「首选候选是重映版（无分）→ 改用更早的原版」。
 * 但如果首选候选本身就是**错配**（片名相近的另一部片），
 * 这条规则会把它换成同样错配、甚至更离谱的老片。
 *
 * ratings-stylesheet 不返回片名，所以用原来的查询词重跑一次 suggest，
 * 把候选列表（含片名）打出来。11 行 = 十几次请求，很轻。
 *
 * 用法：node probe/fb-audit.mjs [仓库根目录]
 */
import fs from 'node:fs';
import { imdbSuggest } from '../scrapers/imdb.js';

const base = process.argv[2] || '.';
const cache = JSON.parse(fs.readFileSync(`${base}/data/enrich.json`, 'utf8')).entries;
const rows = Object.values(cache).filter((v) => v.imdb?.fallbackFrom);
console.log(`共 ${rows.length} 行 fallback（首选无分才回退）\n`);

const movies = JSON.parse(fs.readFileSync(`${base}/data/movies.json`, 'utf8')).movies || [];
const byId = new Map(movies.map((m) => [m.id, m]));

for (const v of rows) {
  const src = (v.movieIds || []).map((id) => byId.get(id)).filter(Boolean);
  console.log(`── ${v.nameZh}${v.nameEn ? ' / ' + v.nameEn : ''}（港映 ${v.year}）`);
  console.log(`   采用 ${v.imdb.imdbId}「${v.imdb.imdbTitle}」${v.imdb.imdbYear} → ${v.imdb.rating}`);
  console.log(`   跳过 ${v.imdb.fallbackFrom}（relaxedYear=${!!v.imdb.relaxedYear}）`);
  for (const q of [v.nameEn, v.nameZh].filter(Boolean)) {
    const cands = await imdbSuggest(q).catch(() => []);
    for (const c of (cands || []).slice(0, 4)) {
      console.log(`      ${c.id} ${c.year ?? '?'}「${c.title}」${c.sortie || ''}`);
    }
    break; // 一个查询词够看候选了
  }
  for (const m of src.slice(0, 1)) console.log(`   源[${m.chain}] open=${m.openingDate} en=${m.nameEn || '-'}`);
  console.log();
  await new Promise((r) => setTimeout(r, 500));
}
