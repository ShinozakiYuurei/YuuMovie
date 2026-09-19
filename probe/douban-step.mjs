// 分步复现 sec.douban.com 的 PoW 流程，定位 POST 之后为什么仍是挑战页
import crypto from 'node:crypto';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H = { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' };
const jar = new Map();
const collect = (r) => {
  for (const c of typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : []) {
    const kv = c.split(';')[0];
    const i = kv.indexOf('=');
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
};
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const sha = (s) => crypto.createHash('sha512').update(s).digest('hex');

const sid = process.argv[2] || '37193446';

let r = await fetch(`https://movie.douban.com/subject/${sid}/`, { headers: H, redirect: 'manual' });
collect(r);
console.log('1', r.status, r.headers.get('location')?.slice(0, 60), 'cookies:', ck());

const chUrl = r.headers.get('location');
r = await fetch(chUrl, { headers: { ...H, cookie: ck(), referer: `https://movie.douban.com/subject/${sid}/` } });
collect(r);
const b = await r.text();
console.log('2', r.status, 'len', b.length, 'cookies:', ck());

const g = (n) => (b.match(new RegExp('id="' + n + '"[^>]*value="([^"]*)"')) || [])[1];
const cha = g('cha');
const tok = g('tok');
const red = g('red');
console.log('cha len', cha?.length, 'tok len', tok?.length, 'red', red);

const t0 = Date.now();
let sol = 0;
for (let n = 1; n < 6e7; n++) if (sha(cha + n).startsWith('0000')) { sol = n; break; }
console.log('solved', sol, 'in', Date.now() - t0, 'ms');

// A. 表单 POST（浏览器行为）
r = await fetch('https://sec.douban.com/c', {
  method: 'POST',
  headers: {
    ...H,
    cookie: ck(),
    'content-type': 'application/x-www-form-urlencoded',
    referer: chUrl,
    origin: 'https://sec.douban.com',
  },
  body: new URLSearchParams({ tok, cha, sol: String(sol), red }).toString(),
  redirect: 'manual',
});
collect(r);
console.log('3 POST ->', r.status, 'loc:', r.headers.get('location')?.slice(0, 90), 'cookies:', ck());
let body = await r.text();
console.log('  body len', body.length, 'still-challenge:', /id="cha"/.test(body), 'title:', (body.match(/<title>([^<]*)/) || [])[1]);

if (r.status >= 300 && r.status < 400) {
  const loc = r.headers.get('location');
  const next = loc.startsWith('http') ? loc : new URL(loc, 'https://sec.douban.com').href;
  r = await fetch(next, { headers: { ...H, cookie: ck() }, redirect: 'manual' });
  collect(r);
  body = await r.text();
  console.log('4 follow ->', r.status, 'len', body.length, 'challenge:', /id="cha"/.test(body));
  console.log('  url', r.url, '| title:', (body.match(/<title>([^<]*)/) || [])[1]);
  if (!/id="cha"/.test(body)) {
    console.log('  rating:', (body.match(/property="v:average"[^>]*>\s*([\d.]*)\s*</) || [])[1]);
    console.log('  info?', body.includes('<div id="info"'));
  }
}
