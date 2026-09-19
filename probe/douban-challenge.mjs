// 探针：看 sec.douban.com 挑战页真实结构，确认 PoW 参数
import { createJar } from '../scrapers/douban-guard.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H = { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' };

const sid = process.argv[2] || '37193446';
const jar = createJar();

let r = await fetch(`https://movie.douban.com/subject/${sid}/`, { headers: H, redirect: 'manual' });
jar.collect(r);
console.log('step1', r.status, '->', r.headers.get('location'));
r = await fetch(r.headers.get('location'), { headers: { ...H, cookie: jar.header() }, redirect: 'manual' });
jar.collect(r);
const b = await r.text();
console.log('step2', r.status, 'len', b.length, 'cookie:', jar.header());
console.log('=== BODY ===');
console.log(b);
