// 二分定位：为什么 probe 能过盾，而 grabDouban 不能
// 变量：POST 的 referer（/c 还是带 query 的挑战 URL）、GET 挑战页时的 referer、accept 头
import crypto from 'node:crypto';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sha = (s) => crypto.createHash('sha512').update(s).digest('hex');
const sid = process.argv[2] || '37193446';
const target = `https://movie.douban.com/subject/${sid}/`;

async function attempt(label, { postRefererMode, getAccept, chReferer }) {
  const jar = new Map();
  const collect = (r) => {
    for (const c of typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : []) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
  };
  const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  let res = await fetch(target, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' }, redirect: 'manual' });
  collect(res);
  const chUrl = res.headers.get('location');
  const gH = { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9', cookie: ck() };
  if (getAccept) gH.accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  if (chReferer) gH.referer = target;
  res = await fetch(chUrl, gH);
  collect(res);
  const body = await res.text();
  const g = (n) => (body.match(new RegExp('id="' + n + '"[^>]*value="([^"]*)"')) || [])[1];
  const cha = g('cha');
  let sol = 0;
  for (let n = 1; n < 6e7; n++) if (sha(cha + n).startsWith('0000')) { sol = n; break; }
  const pH = {
    'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9', cookie: ck(),
    'content-type': 'application/x-www-form-urlencoded', origin: 'https://sec.douban.com',
    referer: postRefererMode === 'bare' ? 'https://sec.douban.com/c' : chUrl,
  };
  if (getAccept) pH.accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  res = await fetch('https://sec.douban.com/c', { method: 'POST', headers: pH, body: new URLSearchParams({ tok: g('tok'), cha, sol: String(sol), red: g('red') }).toString(), redirect: 'manual' });
  collect(res);
  const st = res.status;
  let final = null;
  if (st >= 300 && st < 400) {
    const loc = res.headers.get('location');
    const r2 = await fetch(new URL(loc, 'https://sec.douban.com').href, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9', cookie: ck() } });
    final = await r2.text();
  }
  console.log(label.padEnd(46), 'POST', st, 'final len', final ? final.length : '-', final && !/id="cha"/.test(final) ? '✅ 过盾' : '❌ 仍是挑战页');
  await new Promise((s) => setTimeout(s, 4000));
}

await attempt('A referer=挑战URL, 无accept, 无chReferer', { postRefererMode: 'full', getAccept: false, chReferer: false });
await attempt('B referer=/c, 有accept, 无chReferer', { postRefererMode: 'bare', getAccept: true, chReferer: false });
await attempt('C referer=挑战URL, 有accept, 无chReferer', { postRefererMode: 'full', getAccept: true, chReferer: false });
await attempt('D referer=/c, 无accept, 有chReferer', { postRefererMode: 'bare', getAccept: false, chReferer: true });
