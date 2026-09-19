import crypto from 'node:crypto';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sha=s=>crypto.createHash('sha512').update(s).digest('hex');
const G=(b,n)=>(b.match(new RegExp('id="'+n+'"[^>]*value="([^"]*)"'))||[])[1];
const sid=process.argv[2]||'37193446';
const target=`https://movie.douban.com/subject/${sid}/`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function round(label,redirect){
  const jar=new Map();
  const collect=r=>{for(const c of r.headers.getSetCookie?r.headers.getSetCookie():[]){const kv=c.split(';')[0];const i=kv.indexOf('=');if(i>0)jar.set(kv.slice(0,i).trim(),kv.slice(i+1).trim())}};
  const ck=()=>[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
  let res=await fetch(target,{headers:{'user-agent':UA,'accept-language':'zh-CN,zh;q=0.9'},redirect:'manual'});collect(res);
  res=await fetch(res.headers.get('location'),{headers:{'user-agent':UA,cookie:ck()}});
  const b=await res.text(); if(!/id="cha"/.test(b)){console.log(label,'无挑战页，跳过');return}
  const cha=G(b,'cha');let sol=0;for(let n=1;n<6e7;n++)if(sha(cha+n).startsWith('0000')){sol=n;break}
  res=await fetch('https://sec.douban.com/c',{method:'POST',headers:{'user-agent':UA,cookie:ck(),'content-type':'application/x-www-form-urlencoded',origin:'https://sec.douban.com',referer:target},body:new URLSearchParams({tok:G(b,'tok'),cha,sol:String(sol),red:G(b,'red')}).toString(),redirect:'manual'});
  collect(res);
  const loc=res.headers.get('location');
  const r2=await fetch(new URL(loc,'https://sec.douban.com').href,{headers:{'user-agent':UA,'accept-language':'zh-CN,zh;q=0.9',cookie:ck()},redirect});
  const b2=await r2.text();
  console.log(label.padEnd(22),r2.status,'len',b2.length,b2.length>20000&&!/id="cha"/.test(b2)?'✅':'❌ 挑战页','| 是否跟了302:',redirect);
  await sleep(3500);
}
await round('manual',     'manual');
await round('follow',     'follow');
