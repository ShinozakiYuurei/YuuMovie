#!/usr/bin/env node
/**
 * 剧情简介补全：院线不提供简介的影片，从第三方资料站取。
 *
 * 为什么单独一步、单独缓存（data/synopsis.json）：
 *   与 enrich.js 同样的理由 —— data/movies.json 每次抓取被整体重写，
 *   外部来源的文案不该混进「院线原始数据」这一层；分开存，谁重跑都不影响对方。
 *
 * 来源顺序（2026-10-04 用户指定）：
 *   1. wmoov.com   —— 发行商文案（用户点名要的那份）
 *   2. kinohk.com  —— Astro 服务端渲染可直接抓；robots.txt 明确欢迎爬虫，注明出处
 *   3. hkmovie6.com —— Nuxt SPA + Cloudflare，未接入（见文件末尾说明）
 *
 * ⚠️ wmoov / hkmovie6 都有 Cloudflare 盾：**本机（大陆）403，香港 VPS 200**。
 *   所以本脚本只在 VPS 上跑得通，本地开发请用 DRY=1 或离线 fixture 测纯函数。
 *
 * 用法（在 VPS 上跑）：
 *   node scrapers/synopsis.js              # 增量：只补「整组都没有简介」的片
 *   FORCE_REFRESH=1 node scrapers/synopsis.js
 *   ONLY=末日降臨,奧涅金 node scrapers/synopsis.js
 *   DRY=1 node scrapers/synopsis.js        # 不发请求，只看计划
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { synopsisKey } from '../lib/synopsis-key.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(OUT, 'synopsis.json');
const MOVIES_FILE = path.join(OUT, 'movies.json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DRY = process.env.DRY === '1';
/** SYNOPSIS_FORCE=1 强制重查（缓存的「查不到」有 7 天 TTL；评分那轮不带这个，免得每小时敲门） */
const FORCE_REFRESH = process.env.FORCE_REFRESH === '1' || process.env.SYNOPSIS_FORCE === '1';
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = Number(process.env.LIMIT || 0);
/** 有简介后多久重查一次（简介基本不变，周期可以长） */
const REFRESH_DAYS = Number(process.env.REFRESH_DAYS ?? 30);
/** 查不到时多久重试一次（新片可能晚点才有简介） */
const NOT_FOUND_TTL_DAYS = Number(process.env.NOT_FOUND_TTL_DAYS ?? 7);
/** 请求间隔：这两个站都没给 API，串行 + 停顿，别把人家当 CDN 用 */
const GAP_MS = Number(process.env.GAP_MS ?? 700);

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

async function fetchText(url, { attempts = 3, timeoutMs = 20000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, 'accept-language': 'zh-HK,zh;q=0.9' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      return await res.text();
    } catch (error) {
      last = error;
      if (i < attempts - 1) await sleep(600 * (i + 1));
    }
  }
  throw last;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML → 纯文字（与其它 scraper 同一口径：先断行、再去标签、最后解实体） */
export function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
      const named = ENTITIES[entity.toLowerCase()];
      if (named) return named;
      if (entity[0] === '#') {
        const hex = entity[1] && entity[1].toLowerCase() === 'x';
        const n = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)) return String.fromCodePoint(n);
      }
      return match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const hasCJK = (s) => /[\u3400-\u9fff]/.test(s);

/** 简介是否可用：必须含中文、不能是「--」这类占位、长度够一段话 */
export function usableSynopsis(text) {
  const t = String(text || '').trim();
  if (!t || !hasCJK(t)) return '';
  if (/^[-—–\s]+$/.test(t)) return '';
  return t.length >= 20 ? t : '';
}

// ---------- wmoov ----------

/** wmoov 链接 title 属性里的固定尾巴：「…電影資料、預告、戲院」 */
const WMOOV_TITLE_SUFFIX = /(電影資料|電影預告|預告|上映戲院|放映時間|戲院).*$/;

/**
 * wmoov 任意页 → Map<归一化片名, [{id,title}]>
 *
 * ★ 2026-10-04：不能只认 <h3> 里的链接。
 *   实测「現正上映」页有 166 部片，但 <h3> 只有 59 个 —— 其余在侧栏
 *   <ul class="nav-movie"> 里，而且那些 <a> 的内文常常是空的（图片链接），
 *   片名只在 title 属性上。只认 <h3> 会漏掉三分之二的片（首轮补全就是这么漏的）。
 *   所以改为：凡是 /movie/details/<id> 的链接都收，片名取 title 属性（剥掉固定尾巴）。
 */
export function parseWmoovIndex(html) {
  const map = new Map();
  const add = (id, raw) => {
    const title = stripHtml(raw).replace(WMOOV_TITLE_SUFFIX, '').trim();
    const key = synopsisKey(title);
    if (!key) return;
    const list = map.get(key) || [];
    if (!list.some((x) => x.id === id)) list.push({ id, title });
    map.set(key, list);
  };
  for (const [, id, title] of html.matchAll(/<a\b[^>]*href="\/movie\/details\/(\d+)"[^>]*title="([^"]*)"/gi)) {
    add(id, title);
  }
  // 没有 title 属性的列表项（个别版式）再退回读内文
  for (const [, id, inner] of html.matchAll(/<h3>\s*<a href="\/movie\/details\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    add(id, inner);
  }
  return map;
}

/** wmoov 详情页 → { zh, en }（名稱那行的「中文 (English)」） */
export function parseWmoovNames(html) {
  const m = html.match(/<dt>\s*名稱\s*[:：]?\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i);
  if (!m) return { zh: '', en: '' };
  const full = stripHtml(m[1]);
  const en = full.match(/\(([^()]*)\)\s*$/)?.[1] || '';
  return { zh: full.replace(/\s*\([^()]*\)\s*$/, '').trim(), en: en.trim() };
}

/** wmoov 详情页 → 简介正文（发行商文案，在 <p id="description" itemprop="description">） */
export function parseWmoovSynopsis(html) {
  const m =
    html.match(/<p[^>]*id="description"[^>]*>([\s\S]*?)<\/p>/i) ||
    html.match(/<p[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/p>/i);
  return m ? stripHtml(m[1]) : '';
}

// ---------- kinohk ----------

/** kinohk 列表 → Map<归一化片名, [{slug,title,en}]> */
export function parseKinohkIndex(html) {
  const map = new Map();
  for (const m of html.matchAll(/<a href="(\/movie\/[^"?#]+)"[\s\S]*?<\/a>/g)) {
    const slug = m[1];
    const block = m[0];
    const h3 = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (!h3) continue;
    // h3 里除了片名还有一个「（別名）」的 span，先剥掉
    const title = stripHtml(h3[1].replace(/<span[\s\S]*?<\/span>/gi, ''));
    const en = stripHtml(block.match(/<p[^>]*>([^<]*)<\/p>/i)?.[1] || '');
    const key = synopsisKey(title);
    if (!key) continue;
    const list = map.get(key) || [];
    if (!list.some((x) => x.slug === slug)) list.push({ slug, title, en });
    map.set(key, list);
  }
  return map;
}

/**
 * kinohk 详情页 → 简介正文
 *
 * 该站的简介紧挨着一个「簡介由本站整理」的出处标注，取它**前面**那个 <p>。
 * 标注必须一起剥掉：那是 kinohk 的署名，不是简介的一部分。
 */
export function parseKinohkSynopsis(html) {
  const marker = html.search(/簡介由本站整理|簡介由本站|資料由本站/);
  if (marker < 0) return '';
  const before = html.slice(0, marker);
  const blocks = [...before.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  const last = blocks[blocks.length - 1];
  return last ? stripHtml(last[1]) : '';
}

// ---------- 主流程 ----------

/** 收集「整组都没有简介」的影片（按 synopsisKey 归一，跨院线去重） */
export function filmsNeedingSynopsis(movies) {
  const byKey = new Map();
  for (const movie of movies) {
    const name = movie.nameZh || movie.nameEn || '';
    const key = synopsisKey(name);
    if (!key) continue;
    const row = byKey.get(key) || { key, nameZh: movie.nameZh || '', nameEn: movie.nameEn || '', hasText: false };
    if ((movie.description || '').trim()) row.hasText = true;
    if (!row.nameZh && movie.nameZh) row.nameZh = movie.nameZh;
    if (!row.nameEn && movie.nameEn) row.nameEn = movie.nameEn;
    byKey.set(key, row);
  }
  return [...byKey.values()].filter((row) => !row.hasText);
}

function isFresh(entry, ttlDays, now) {
  if (!entry || !entry.at) return false;
  const age = now - Date.parse(entry.at);
  return Number.isFinite(age) && age < ttlDays * 86400_000;
}

/**
 * 英文片名对不上就别用：同名旧片/重拍是这类站点最常见的事故。
 *
 * 但允许「包含」：院线的活动场名字更长（Avengers: Doomsday Special Screening
 * vs 资料站的 Avengers: Doomsday），那是同一部片，不是另一部。
 */
function titleAgrees(expectedEn, actualEn) {
  const a = synopsisKey(expectedEn);
  const b = synopsisKey(actualEn);
  if (!a || !b) return true;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * 在索引里找一部片（三级退让，越往后越宽松、也越保守）
 *
 * 1. 精确命中 —— 最常见的形态，优先用它，避免「空槍」被「空槍2」抢走。
 * 2. 前缀 —— 一方是另一方的前缀。院线片名常带活动尾巴
 *    （「復仇者聯盟5：末日降臨 開畫日特典首場」），资料站只有正片名。
 * 3. 子串 —— 片名被品牌/语言标记夹在中间：院线叫
 *    「【Infinity Vision】復仇者聯盟5：末日降臨 (早鳥) LUXE」「CGS…Infinity Vision」
 *    「粵語版 - 誤闖遺忘島」，而资料站只有「復仇者聯盟5：末日降臨」「誤闖遺忘島」。
 *    前两级都够不到，只有子串能命中（2026-10-04 实测）。
 *
 * 退让时取**最长**的那个键（最具体），并且只在唯一时采用：
 * 有歧义宁缺毋滥，错配一部片的简介比缺简介更糟。
 * 英文片名的比对（titleAgrees）是最后一道闸。
 */
export function matchIndex(index, key) {
  const exact = index.get(key);
  if (exact && exact.length) return exact;
  for (const test of [(k) => k.startsWith(key) || key.startsWith(k), (k) => k.includes(key) || key.includes(k)]) {
    const keys = [...index.keys()].filter((k) => k.length >= 4 && test(k));
    if (!keys.length) continue;
    const longest = Math.max(...keys.map((k) => k.length));
    const best = keys.filter((k) => k.length === longest);
    if (best.length !== 1) continue;
    return index.get(best[0]) || [];
  }
  return [];
}

async function fromWmoov(row, index) {
  const candidates = matchIndex(index, row.key);
  for (const candidate of candidates) {
    const url = 'https://wmoov.com/movie/details/' + candidate.id;
    const html = await fetchText(url);
    const names = parseWmoovNames(html);
    if (!titleAgrees(row.nameEn, names.en)) {
      log('    跳过 ' + url + '：英文名不符（' + names.en + '）');
      await sleep(GAP_MS);
      continue;
    }
    const zh = usableSynopsis(parseWmoovSynopsis(html));
    await sleep(GAP_MS);
    if (zh) return { zh, source: 'wmoov', url, canonical: synopsisKey(candidate.title) };
  }
  return null;
}

async function fromKinohk(row, index) {
  const candidates = matchIndex(index, row.key);
  for (const candidate of candidates) {
    if (!titleAgrees(row.nameEn, candidate.en)) continue;
    const url = 'https://kinohk.com' + candidate.slug;
    const html = await fetchText(url);
    const zh = usableSynopsis(parseKinohkSynopsis(html));
    await sleep(GAP_MS);
    if (zh) return { zh, source: 'kinohk', url, canonical: synopsisKey(candidate.title) };
  }
  return null;
}

async function main() {
  const moviesFile = readJson(MOVIES_FILE, null);
  const movies = moviesFile ? (Array.isArray(moviesFile) ? moviesFile : moviesFile.movies || []) : [];
  if (!movies.length) {
    log('✖ 读不到 data/movies.json，先跑 scrape.js');
    process.exitCode = 1;
    return;
  }

  const cache = readJson(CACHE_FILE, { entries: {} });
  if (!cache.entries) cache.entries = {};

  const now = Date.now();
  let need = filmsNeedingSynopsis(movies);
  if (ONLY.length) need = need.filter((row) => ONLY.some((w) => row.nameZh.includes(w) || row.nameEn.includes(w)));
  need = need.filter((row) => {
    const hit = cache.entries[row.key];
    if (FORCE_REFRESH) return true;
    if (hit && hit.zh) return !isFresh(hit, REFRESH_DAYS, now);
    return !isFresh(hit, NOT_FOUND_TTL_DAYS, now);
  });
  if (LIMIT > 0) need = need.slice(0, LIMIT);

  log('待补简介 ' + need.length + ' 部' + (need.length ? '：' + need.map((r) => r.nameZh || r.nameEn).join('、') : ''));
  if (DRY || !need.length) return;

  const wmoovIndex = await buildIndex([
    'https://wmoov.com/movie/showing',
    'https://wmoov.com/movie/upcoming',
  ], parseWmoovIndex, 'wmoov');
  const kinohkIndex = await buildIndex([
    'https://kinohk.com/movies/now-showing',
    'https://kinohk.com/coming',
  ], parseKinohkIndex, 'kinohk');

  let found = 0;
  for (const row of need) {
    const label = row.nameZh || row.nameEn;
    let hit = null;
    try {
      hit = await fromWmoov(row, wmoovIndex);
      if (!hit) hit = await fromKinohk(row, kinohkIndex);
    } catch (error) {
      log('  ⚠️ ' + label + '：' + error.message);
    }
    if (hit) {
      const record = { zh: hit.zh, source: hit.source, url: hit.url, at: new Date().toISOString() };
      cache.entries[row.key] = record;
      // 同时按资料站的正片名存一份：院线那条叫「CGS…Infinity Vision」、别的院线叫正片名，
      // 组级兜底要能用正片名查到同一段文案。
      if (hit.canonical && hit.canonical !== row.key) cache.entries[hit.canonical] = record;
      found++;
      log('  ✓ ' + label + ' ← ' + hit.source + '（' + hit.zh.length + ' 字）');
    } else {
      cache.entries[row.key] = { zh: '', source: null, url: null, at: new Date().toISOString() };
      log('  · ' + label + '：两个来源都没有');
    }
    // 每部写盘一次：中断也不丢已抓到的
    cache.updatedAt = new Date().toISOString();
    writeJson(CACHE_FILE, cache);
  }

  log('补全 ' + found + '/' + need.length + '，缓存 ' + CACHE_FILE);
}

async function buildIndex(urls, parse, name) {
  const map = new Map();
  for (const url of urls) {
    try {
      const html = await fetchText(url);
      for (const [key, list] of parse(html)) {
        const cur = map.get(key) || [];
        for (const item of list) if (!cur.some((x) => JSON.stringify(x) === JSON.stringify(item))) cur.push(item);
        map.set(key, cur);
      }
    } catch (error) {
      log('  ⚠️ ' + name + ' 索引 ' + url + ' 失败：' + error.message);
    }
    await sleep(GAP_MS);
  }
  log('  ' + name + ' 索引：' + map.size + ' 部');
  return map;
}

// hkmovie6 暂未接入：它是 Nuxt SPA，页面内容由客户端渲染，
// 且站点在 Cloudflare 之后（本机 403、香港 VPS 200）。
// 要接的话得先找到它的数据接口（_payload.json 或 /api/*），目前 wmoov + kinohk 已覆盖。

if (process.argv[1] && process.argv[1].endsWith('synopsis.js')) {
  main().catch((error) => {
    console.error('✖ 补全失败：' + (error && error.stack ? error.stack : error));
    process.exitCode = 1;
  });
}
