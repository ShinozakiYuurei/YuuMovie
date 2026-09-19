// 单变量矩阵：GET 头固定用「已验证可过盾」的那套，逐一试 POST 头差异
import crypto from 'node:crypto';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sha = (s) => crypto.createHash('sha512').update(s).digest('hex');
const G = (b, n) => (b.match(new RegExp('id="' + n + '"[^>]*value="([^"]*)"')) || [])[1];
const sid = process.argv[2] || '37193446';
const target = `https://movie.douban.com/subject/${sid}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function round(label, postH) {
  const jar = new Map();
  const collect = (r) => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } };
  const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  let res = await fetch(target, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' }, redirect: 'manual' });
  collect(res);
  const chUrl = res.headers.get('location');
  res = await fetch(chUrl, { headers: { 'user-agent': UA, cookie: ck() } });
  const b0 = await res.text();
  const cha = G(b0, 'cha');
  let sol = 0; for (let n = 1; n < 6e7; n++) if (sha(cha + n).startsWith('0000')) { sol = n; break; }

  res = await fetch('https://sec.douban.com/c', {
    method: 'POST',
    headers: { 'user-agent': UA, cookie: ck(), 'content-type': 'application/x-www-form-urlencoded', ...postH },
    body: new URLSearchParams({ tok: G(b0, 'tok'), cha, sol: String(sol), red: G(b0, 'red') }).toString(),
    redirect: 'manual',
  });
  collect(res);
  const cookie = /dbsawcv1/.test(ck()) ? 'cookie✅' : 'cookie❌';

  // GET 固定：探针里验证过的最简一套
  const loc = res.headers.get('location');
  const r2 = await fetch(new URL(loc, 'https://sec.douban.com').href, {
    headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9', cookie: ck() },
    redirect: 'manual',
  });
  const b2 = await r2.text();
  const ok = b2.length > 20000 && !/id="cha"/.test(b2);
  console.log(`[${label}] POST ${res.status} ${cookie} → GET ${r2.status} len ${b2.length} ${ok ? '✅' : '❌'}`);
  await sleep(4000);
}

await round('ref=挑战URL        ', { origin: 'https://sec.douban.com', referer: 'https://sec.douban.com/c?x=1' });
await round('ref=/c            ', { origin: 'https://sec.douban.com', referer: 'https://sec.douban.com/c' });
await round('ref=target        ', { origin: 'https://sec.douban.com', referer: target });
await round('无origin,ref=/c   ', { referer: 'https://sec.douban.com/c' });
await round('accept=html       ', { origin: 'https://sec.douban.com', referer: 'https://sec.douban.com/c', accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' });
await round('accept=*/*        ', { origin: 'https://sec.douban.com', referer: 'https://sec.douban.com/c', accept: '*/*' });
await round('accept=json       ', { origin: 'https://sec.douban.com', referer: 'https://sec.douban.com/c', accept: 'application/json' });
await round('AL=zh-CN,zh;q=0.9 ', { origin: 'https://sec.douban.com', referer: 'https://sec.douban.com/c', 'accept-language': 'zh-CN,zh;q=0.9' });
await round('AL=长串           ', { origin: 'https://sec.douban.com', referer: 'https://sec.douban.com/c', 'accept-language': 'zh-CN,zh;q=0.9,zh-HK;q=0.8,en;q=0.5' });
await round('AL=zh-HK          ', { origin: 'https://sec.douban.com', referer: 'https://sec.douban.com/c', 'accept-language': 'zh-HK,zh;q=0.9' });
