// 扫描已发布站点里所有指向 /movie/<slug> 的链接，比对是否有对应静态页
// 用法：node check-published-links.mjs /home/web/html
// 目录不存在时 readdirSync 会抛异常 —— 给个清楚的错，不要和"死链"混成一个信号
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/home/web/html';
if (!fs.existsSync(path.join(ROOT, 'movie'))) {
  console.error(`✖ ${ROOT}/movie 不存在，这不是"无死链"，是站点没同步出来`);
  process.exit(2);
}
const pages = new Set(fs.readdirSync(path.join(ROOT, 'movie')));

let tot = 0;
let bad = 0;
const dead = [];

const RE_HREF = new RegExp(' href="/movie/([^"/]+)/', 'g');

const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (e.name === '_next' || e.name === 'movie') continue;
      walk(p);
      continue;
    }
    if (!e.name.endsWith('.html')) continue;
    const h = fs.readFileSync(p, 'utf8');
    for (const m of h.matchAll(RE_HREF)) {
      tot++;
      if (!pages.has(m[1])) {
        bad++;
        if (dead.length < 10) dead.push(`${path.relative(ROOT, p)} -> /movie/${m[1]}/`);
      }
    }
  }
};

// 只递一次根目录：walk 本身会递归进 cinema/ upcoming/ showing/，
// 逐个目录再扫一遍会把链接计成 2 倍（不能影响死链判定，但会把指标给错）。
walk(ROOT);

console.log('静态 movie 页:', pages.size);
console.log('/movie 链接总数:', tot, '| 死链:', bad);
if (dead.length) console.log('样例:\n' + dead.join('\n'));
// 退出码必须真实反映结论。本文件原先只 console.log("FAIL 存在死链")
// 而不设 exit code，导致部署脚本的 `|| die` 形同虚设 —— 扫出死链仍被
// 当成健康发布。反过来，扫到 0 条链接也不是健康证据，而是检查根本没跑起来
// （这种假绿我自己已经踩过一次），所以一并判失败。
if (tot === 0) {
  console.log('FAIL 一条 /movie 链接都没扫到 —— 检查没真的跑起来，不能算通过');
  process.exit(2);
}
console.log(bad === 0 ? 'OK 无死链' : `FAIL 存在 ${bad} 条死链`);
process.exit(bad === 0 ? 0 : 1);
