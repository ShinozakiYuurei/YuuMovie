// 复制 grabDouban 的原始实现并加日志，找出 POST 为什么没拿到正文
import crypto from 'node:crypto';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sha=s=>crypto.createHash('sha512').update(s).digest('hex');
const CHA_RE=/id="cha"[^>]*value="([^"]*)"/;
const TOK_RE=/id="tok"[^>]*value="([^"]*)"/;
const RED_RE=/id="red"[^>]*value="([^"]*)"/;
const DIFF_RE=/id="difficulty"[^>]*value="(\d+)"/;
const jar=new Map();
const collect=r=>{for(const c of r.headers.getSetCookie?r.headers.getSetCookie():[]){const kv=c.split(';')[0];const i=kv.indexOf('=');if(i>0)jar.set(kv.slice(0,i).trim(),kv.slice(i+1).trim())}};
const ck=()=>[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
const url='https://movie.douban.com/subject/'+(process.argv[2]||'37193446')+'/';
const timeout={signal:AbortSignal.timeout(25000)};
const base={'user-agent':UA,'accept-language':'zh-CN,zh;q=0.9,zh-HK;q=0.8,en;q=0.5',accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',...timeout};
let res=await fetch(url,{...base,redirect:'manual'});collect(res);
for(let i=0;i<3&&res.status>=300&&res.status<400;i++){const loc=res.headers.get('location');if(!loc)break;res=await fetch(new URL(loc,res.url||url).href,{...base,cookie:ck(),redirect:'manual'});collect(res)}
let body=await res.text();
console.log('pre  status',res.status,'len',body.length,'cha',CHA_RE.test(body));
if(CHA_RE.test(body)){
  const cha=body.match(CHA_RE)[1];
  const tok=(body.match(TOK_RE)||[])[1]||'';
  const red=(body.match(RED_RE)||[])[1]||'';
  const diff=Number((body.match(DIFF_RE)||[])[1]||4);
  let sol=0;for(let n=1;n<6e7;n++)if(sha(cha+n).startsWith('0'.repeat(diff))){sol=n;break}
  console.log('tok len',tok.length,'red',red,'diff',diff,'sol',sol);
  const hdrs={...base,cookie:ck(),'content-type':'application/x-www-form-urlencoded',referer:'https://sec.douban.com/c',origin:'https://sec.douban.com'};
  console.log('POST headers keys:',Object.keys(hdrs).join(','));
  res=await fetch('https://sec.douban.com/c',{method:'POST',headers:hdrs,body:new URLSearchParams({tok,cha,sol:String(sol),red}).toString(),redirect:'manual'});collect(res);
  console.log('POST status',res.status,'loc',res.headers.get('location'));
  for(let i=0;i<3&&res.status>=300&&res.status<400;i++){const loc=res.headers.get('location');if(!loc)break;res=await fetch(new URL(loc,res.url).href,{...base,cookie:ck(),redirect:'manual'});collect(res);console.log(' follow',i,res.status,res.headers.get('location'))}
  body=await res.text();
  console.log('final status',res.status,'len',body.length,'cha',/id="cha"/.test(body),'info?',body.includes('<div id="info"'));
}
