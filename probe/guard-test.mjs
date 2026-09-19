import { createJar, grabDouban } from '../scrapers/douban-guard.js';
const jar = createJar();
const t0 = Date.now();
const { status, url, body } = await grabDouban('https://movie.douban.com/subject/' + (process.argv[2]||'37193446') + '/', { jar });
console.log('status', status, 'len', body.length, 'ms', Date.now() - t0);
console.log('challenge?', /id="cha"/.test(body), '| info?', body.includes('<div id="info"'), '| rate-markers:', /访问太频繁/.test(body), /rate/i.test(body.slice(0,2000)));
console.log('head:', body.slice(0,180).replace(/\s+/g,' '));
