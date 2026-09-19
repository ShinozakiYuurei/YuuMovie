// 决定性测试：POST 过盾后，哪一步导致再被弹回挑战页
// 差异候选：1) base 里混入 signal 被当字符串 header 发出  2) redirect:'manual'  3) accept 头
import crypto from 'node:crypto';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sha = (s) => crypto.createHash('sha512').update(s).digest('hex');
const CHA_RE = /id="cha"[^>]*value="([^"]*)"/;
const G = (b, n) => (b.match(new RegExp('id="' + n + '"[^>]*value="([^"]*)"')) || [])[1];
const sid = process.argv[2] || '37193446';
const target = `https://movie.douban.com/subject/${sid}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function round(label, cfg) {
  const jar = new Map();
  const collect = (r) => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } };
  const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  // 1) 撞墙拿挑战页
  let res = await fetch(target, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' }, redirect: 'manual' });
  collect(res);
  const chUrl = res.headers.get('location');
  res = await fetch(chUrl, { headers: { 'user-agent': UA, cookie: ck() } });
  const body = await res.text();
  if (!CHA_RE.test(body)) { console.log(label, 'no challenge (skip)'); return; }
  const cha = G(body, 'cha');
  let sol = 0; for (let n = 1; n < 6e7; n++) if (sha(cha + n).startsWith('0000')) { sol = n; break; }

  // 2) 过盾
  const postH = { 'user-agent': UA, cookie: ck(), 'content-type': 'application/x-www-form-urlencoded', origin: 'https://sec.douban.com' };
  if (cfg.postRefererFull) postH.referer = chUrl; else postH.referer = 'https://sec.douban.com/c';
  if (cfg.postJunkSignal) postH.signal = '[object AbortSignal]';
  res = await fetch('https://sec.douban.com/c', {
    method: 'POST', headers: postH,
    body: new URLSearchParams({ tok: G(body, 'tok'), cha, sol: String(sol), red: G(body, 'red') }).toString(),
    redirect: 'manual',
  });
  collect(res);
  const gotCookie = /dbsawcv1/.test(ck());
  console.log(`[${label}] POST`, res.status, 'cookie issued?', gotCookie);

  // 3) 回跳取正文
  const loc = res.headers.get('location');
  const getH = { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9', cookie: ck() };
  if (cfg.getAccept) getH.accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  if (cfg.getJunkSignal) getH.signal = '[object AbortSignal]';
  const r2 = await fetch(new URL(loc, 'https://sec.douban.com').href, { headers: getH, redirect: cfg.manual ? 'manual' : 'follow' });
  const b2 = await r2.text();
  const ok = !/id="cha"/.test(b2) && b2.length > 20000;
  console.log(`[${label}] GET`, r2.status, 'len', b2.length, ok ? '✅ 正文' : '❌ 仍是挑战页', '| 弹回:', r2.status === 302 ? (r2.headers.get('location') || '').slice(0, 40) : '-');
  await sleep(3500);
}

await round('1 干净+manual      ', { postRefererFull: true, manual: true });
await round('2 POST带signal垃圾 ', { postRefererFull: true, postJunkSignal: true, manual: true });
await round('3 GET带signal垃圾  ', { postRefererFull: true, getJunkSignal: true, manual: true });
await round('4 GET带accept      ', { postRefererFull: true, getAccept: true, manual: true });
await round('5 referer=/c       ', { postRefererFull: false, manual: true });
