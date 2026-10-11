// 部署早退守卫的回归测试（2026-10-11 新增）
//
// ===== 它守什么 =====
//
// deploy/vps-deploy.sh 的工作区护栏有三条分支：接管空仓库 / 早退（已是最新）/
// 正常重建。其中「早退」原本只比 git HEAD，而 HEAD 与「站点产物」是两回事：
// 部署被 flock 跳过时代码已切到目标 commit、rebuild-static.sh 却没跑，
// 站点仍是上一版。此时重跑 sync.sh，HEAD 相等 → 直接早退「已是最新」，
// 线上却还是旧的。
//
// 2026-10-11 用户要求「部署默认 ENRICH=0」后，原先靠 ENRICH=1 绕过这个分支的
// 那条路没了，判据必须补成「HEAD 相符 且 .deploy-info 记的就是它」。
//
// ===== 为什么用「跑真实片段」而不是断言字符串 =====
//
// 这个守卫的正确性全在 bash 的控制流里，而它的第一版就踩了一个纯 bash 的坑：
// `_deployed=$(...)` 被夹在 `if ... then` 与 `elif` 之间 —— bash 会把那一行
// 当作第一个分支体的一部分，`$CUR` 非空时整块跳过，变量永远未定义，
// 守卫静默失效（`set -u` 下还会直接报错退出）。
// 字符串断言看不出这种错，只有真的把那段 if 链跑一遍才会暴露。
//
// 所以这里从 vps-deploy.sh 里**切出真实的那一段**（不是抄一份），套上桩函数执行，
// 对六种情形断言它该早退还是该重建。切取范围由两个 banner 界定，
// 它们被改动时本测试会明确报错而不是静默变成空测试。
//
// 用法：node probe/check-deploy-guard.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, 'deploy', 'vps-deploy.sh');

if (!fs.existsSync(SRC)) {
  console.error(`✖ ${SRC} 不存在 —— 这不是「没问题」，是检查没跑起来`);
  process.exit(2);
}

const text = fs.readFileSync(SRC, 'utf8');
const START = '# ---------- 1 工作区护栏 ----------';
const END = '# ---------- 2 切到目标版本 ----------';
const startIdx = text.indexOf(START);
const endIdx = text.indexOf(END);
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
  console.error('✖ 找不到工作区护栏那一段（banner 被改名或删除？）—— 检查已失效，不能算通过');
  process.exit(2);
}
const guardBlock = text.slice(startIdx, endIdx);

// 桩：让那段代码在不碰 git / 文件系统的前提下可执行
const sim = [
  '#!/usr/bin/env bash',
  'set -uo pipefail',
  'dirty_paths() { [ -n "$dirty" ] && echo "m"; }',
  'take_over() { echo TAKE_OVER; }',
  'log() { echo "LOG: $*"; }',
  'verify_site() { echo VERIFY; }',
  'die() { echo "DIE: $*"; }',
  // BK 由真实脚本在顶部初始化（new_backup 负责赋值）；桩里必须一并给，
  // 否则「工作区脏」那条分支引用 $BK 时会在 set -u 下直接退出 ——
  // 那是桩不全，会被误报成守卫坏了。
  'BK=""',
  'new_backup() { BK=/tmp/hkm-bk; mkdir -p "$BK"; }',
  'stash_collisions() { :; }',
  '_deployed=$(cut -f1 "$APP_DIR/.deploy-info" 2>/dev/null || echo "")',
  guardBlock,
].join('\n');

const simPath = path.join(os.tmpdir(), 'hkm-guard-sim.sh');
fs.writeFileSync(simPath, sim);

const cases = [
  {
    name: 'HEAD == 目标 且 .deploy-info 也是它 → 早退',
    env: { CUR: 'abc', TARGET: 'abc', dirty: '' },
    deployed: 'abc',
    expect: 'EARLY-EXIT',
  },
  {
    name: 'HEAD == 目标 但 .deploy-info 是旧版本（flock 跳过）→ 重建',
    env: { CUR: 'abc', TARGET: 'abc', dirty: '' },
    deployed: 'old',
    expect: 'REBUILD',
  },
  {
    name: '.deploy-info 不存在（首次部署）→ 重建',
    env: { CUR: 'abc', TARGET: 'abc', dirty: '' },
    deployed: null,
    expect: 'REBUILD',
  },
  {
    name: '工作区脏 → 重建（并走备份分支）',
    env: { CUR: 'abc', TARGET: 'abc', dirty: 'x' },
    deployed: 'abc',
    expect: 'REBUILD',
  },
  {
    name: 'SCRAPE=1 → 强制重建',
    env: { CUR: 'abc', TARGET: 'abc', dirty: '', SCRAPE: '1' },
    deployed: 'abc',
    expect: 'REBUILD',
  },
  {
    name: 'ENRICH=1 → 强制重建',
    env: { CUR: 'abc', TARGET: 'abc', dirty: '', ENRICH: '1' },
    deployed: 'abc',
    expect: 'REBUILD',
  },
];

let pass = 0;
const failures = [];
for (const c of cases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hkm-guard-'));
  if (c.deployed !== null) {
    fs.writeFileSync(path.join(dir, '.deploy-info'), `${c.deployed}\tmsg\tts`);
  }
  const res = spawnSync('bash', [simPath], {
    env: { ...process.env, ...c.env, APP_DIR: dir },
    encoding: 'utf8',
  });
  fs.rmSync(dir, { recursive: true, force: true });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  // 未定义变量会让 bash 在 set -u 下直接退出 —— 那是守卫坏掉，不是「重建」
  if (/unbound variable/.test(out)) {
    failures.push(`${c.name}: bash 报 unbound variable —— 守卫里的赋值没被执行到`);
    continue;
  }
  const got = out.includes('服务器已是目标版本') ? 'EARLY-EXIT' : 'REBUILD';
  if (got === c.expect) pass++;
  else failures.push(`${c.name}: 得到 ${got}，期望 ${c.expect}`);
}

console.log(`部署早退守衛：${pass}/${cases.length} 情形符合預期`);

if (failures.length > 0) {
  console.error(`✖ ${failures.length} 个问题：`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}

console.log('OK 早退守衛行為與預期一致');