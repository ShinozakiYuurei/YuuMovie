const fs = require('fs');
const { spawnSync } = require('child_process');
const conf = fs.readFileSync('C:/Users/Yuurei/.ssh/cindy.conf', 'utf8');
const hostLine = conf.split(/\r?\n/).find(l => /^Host\s/.test(l.trim()));
const alias = hostLine.trim().split(/\s+/)[1];
const opts = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', alias];
const remote = [
  'whoami',
  'systemctl list-timers --no-pager | grep -E \'hk-movie|NEXT\' | head -8',
  'ps -eo pid,user,etime,cmd | grep -E \'rebuild-static|next build|scrape\' | grep -v grep | head -6',
  'cat /opt/hk-movie/.deploy-info 2>/dev/null || true',
].join('; ');
const r = spawnSync('ssh', [...opts, remote], { encoding: 'utf8' });
console.log('exit', r.status);
console.log(r.stdout || '');
console.error(r.stderr || '');
