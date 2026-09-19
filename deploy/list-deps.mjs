#!/usr/bin/env node
/**
 * 解析某个包的完整依赖树（递归），输出空格分隔的包名列表。
 * 用于打包时收集抓取器所需依赖（standalone 产物不含它们）。
 *
 * 用法：node deploy/list-deps.mjs https-proxy-agent
 */
import fs from 'node:fs';
import path from 'node:path';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('用法: node deploy/list-deps.mjs <package> [...]');
  process.exit(1);
}

const NM = path.join(process.cwd(), 'node_modules');
const seen = new Set();

function readPkg(name) {
  // 处理嵌套 node_modules（npm 会为冲突版本做嵌套）
  const candidates = [
    path.join(NM, name, 'package.json'),
  ];
  // 也检查嵌套路径
  for (const c of candidates) {
    try {
      return JSON.parse(fs.readFileSync(c, 'utf8'));
    } catch {
      /* try next */
    }
  }
  return null;
}

function walk(names) {
  for (const name of names) {
    if (seen.has(name)) continue;
    const pkg = readPkg(name);
    if (!pkg) continue; // 未安装则跳过
    seen.add(name);
    walk(Object.keys(pkg.dependencies || {}));
    // optionalDependencies 也尽量带上
    walk(Object.keys(pkg.optionalDependencies || {}));
  }
}

walk(roots);
console.log([...seen].join(' '));
