/**
 * icirena 平台抓取器（纯 HTTP 版）
 *
 * ===== 历史 =====
 * 早期版本用 Playwright 启动 Chromium，靠页面自己执行 JS 签名。
 * 代价：单次抓取约 400 秒、内存峰值 740MB、浏览器依赖 656MB。
 *
 * ===== 现在 =====
 * 签名算法已从 webpack 模块中完整提取（模块 28863 / 62193 / 31749）：
 *
 *   OB(prefix, obj):  key 字典序排序后累加 (key + value)
 *                     null / undefined / "" 跳过；object 用 JSON.stringify
 *   Xx(msg, secret):  HMAC-SHA256(msg, secret) → hex 大写
 *
 *   参数合并（与前端一致）：
 *     u = { ...基础参数, ...data, ...query, method }
 *     sign = Xx(OB("", u), SECRET)
 *
 * 已用真实抓包样本验证：3/3 完全命中。
 *
 * 因此可以彻底去掉浏览器：抓取从 ~400 秒降到 ~7 秒，
 * 内存从 740MB 降到几十 MB，656MB 的 Chromium 依赖可完全移除。
 *
 * ===== 数据链路 =====
 *   影片列表 → film.showing / film.comingsoon
 *   影院     → cinema.getCinemas
 *   场次     → filmschedule.list（需 curPage / itemsPerPage）
 */
import crypto from 'node:crypto';

export const CHANNELS = {
  emperor: {
    name: '英皇戲院',
    base: 'https://www.emperorcinemas.com',
    channelCode: 'ECML_WEB_PROD_S_MPS',
    host: 'emperorcinemas.com',
  },
  cinemacity: {
    name: 'Cinema City',
    base: 'https://www.cinemacity.com.hk',
    channelCode: 'CICI_WEB_PROD_S_MPS',
    host: 'cinemacity.com.hk',
  },
  bestar: {
    name: '星達院線',
    base: 'https://www.bestarfilm.hk',
    channelCode: 'XYHK_WEB_PROD_S_MPS',
    host: 'bestarfilm.hk',
  },
};

const API = 'https://gopesa-api.icirena.ai/sync';
const SECRET = '3VIDRSDxD0Ck2b6e9K0RaB9Xo5s81tep';
const APP_KEY = '500000';

const M = {
  cinemas: 'gop.alipic.icirena.own.cinema.getCinemas',
  showing: 'gop.alipic.icirena.own.film.showing',
  comingsoon: 'gop.alipic.icirena.own.film.comingsoon',
  schedule: 'gop.alipic.icirena.own.filmschedule.list',
};

/**
 * 场次抓取的日期窗口（天）
 *
 * filmschedule.list 的 showDate 是**必填**参数——不带它时 API 返回
 * bizCode=0 但 bizValue=[]（静默空结果，很容易误判成「这部片没排片」）。
 *
 * 排片窗口实测并不统一：熱門片通常只有 5 天，
 * 特别场次（如演唱会直播）可能在第 15 天才开始。
 * 因此取 21 天：足够覆盖绝大多数排片，又不至于请求过多。
 */
export const SCHEDULE_DAYS = Number(process.env.ICIRENA_DAYS || 21);

/** 香港时区的今天 YYYY-MM-DD */
export function hkToday() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 日期偏移（UTC 天加减，避免本地时区干扰） */
export function addDays(d0, n) {
  const d = new Date(`${d0}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 复刻前端 OB：字典序拼接 key+value，跳过空值 */
function OB(prefix, obj) {
  const keys = Object.keys(obj).sort();
  return keys.reduce((acc, k) => {
    const v = obj[k];
    if (v === null || v === undefined || v === '') return acc;
    if (v && typeof v === 'object') return acc + k + JSON.stringify(v);
    return acc + k + String(v);
  }, prefix);
}

/** 复刻前端 Xx：HMAC-SHA256 → hex 大写 */
function Xx(msg, secret) {
  return crypto.createHmac('sha256', secret).update(msg).digest('hex').toUpperCase();
}

/** 解析响应里的业务数据 */
function bizOf(json) {
  return json?.result?.bizValue ?? null;
}

/**
 * 调用一次 API（带重试）
 *
 * 实测该 API 会偶发 ECONNRESET（服务端限流/断连），
 * 单次重试即可恢复，因此这里内置指数退避重试。
 *
 * @param {string} method  API method
 * @param {object} cfg     渠道配置（含 channelCode / host）
 * @param {object} extra   额外 data 参数
 */
async function call(method, cfg, extra = {}, tries = 3) {
  let lastErr;
  for (let t = 0; t < tries; t++) {
    try {
      return await callOnce(method, cfg, extra);
    } catch (e) {
      lastErr = e;
      if (t < tries - 1) await new Promise((r) => setTimeout(r, 600 * (t + 1)));
    }
  }
  throw lastErr;
}

async function callOnce(method, cfg, extra = {}) {
  const ts = String(Date.now());
  const baseParams = {
    app_key: APP_KEY,
    sign_method: 'sha256',
    timestamp: ts,
    format: 'json',
    simplify: 'true',
  };
  const data = {
    empCode: '',
    leaseCode: '',
    channelCode: cfg.channelCode,
    larkSid: '',
    version: 'H5',
    appVersion: 'H5_5.0',
    __cv__: 'WEBSITE',
    ...extra,
  };

  const u = { ...baseParams, ...data, method };
  const sign = Xx(OB('', u), SECRET);

  const qs = new URLSearchParams({ method, ...baseParams, sign });
  const body = new URLSearchParams(data).toString();

  const res = await fetch(`${API}?${qs}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Origin: cfg.base,
      Referer: `${cfg.base}/`,
    },
    body,
    signal: AbortSignal.timeout(30000),
  });

  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} → HTTP ${res.status}: ${txt.slice(0, 120)}`);
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`${method} → 非 JSON 响应: ${txt.slice(0, 120)}`);
  }
}

/**
 * 抓取单个院线（纯 HTTP，无需浏览器）
 *
 * 与旧版保持相同的返回结构，便于复用 normalizeIcirena()。
 */
export async function scrapeIcirena({
  channel,
  proxy, // 保留参数以兼容旧调用；纯 HTTP 走系统代理，不再需要
  withSchedule = true,
  maxMovies = 0,
  onProgress,
} = {}) {
  const cfg = CHANNELS[channel];
  if (!cfg) throw new Error(`未知院线: ${channel}`);

  // ---------- 1. 影片列表 + 影院 ----------
  onProgress?.(`拉取 ${cfg.name} 影片与影院 ...`);
  const [showingJson, comingJson, cinemasJson] = await Promise.all([
    call(M.showing, cfg),
    call(M.comingsoon, cfg).catch(() => null),
    call(M.cinemas, cfg).catch(() => null),
  ]);

  const showing = bizOf(showingJson) || [];
  const comingsoon = comingJson ? bizOf(comingJson) || [] : [];
  const cinemas = cinemasJson ? bizOf(cinemasJson) : null;

  onProgress?.(
    `  影片 ${showing.length} 部 | 待映 ${comingsoon.length} 部 | 影院 ${
      cinemas?.cities?.reduce((n, c) => n + (c.cinemas?.length || 0), 0) ?? 0
    } 間`
  );

  // ---------- 2. 场次（影片 × 日期 矩阵）----------
  //
  // ★ 关键修正：filmschedule.list 必须带 showDate
  //
  //   曾经只传 filmUniqueId + 分页参数，API 返回 bizCode="0"（成功）
  //   但 bizValue=[] —— 静默空结果，没有任何报错。
  //   于是三家 icirena 院线的场次一直是 0（英皇/City/星達共 15 間影院
  //   在站上「只有影片没有排片」），而 MCL / 百老匯照常。
  //
  //   实测补上 showDate 后立刻返回真实场次。
  //   排片窗口不统一（熱門片 5 天、特别场次可能第 15 天才开始），
  //   故逐日拉取 SCHEDULE_DAYS 天并合并去重。
  const schedules = new Map();

  if (withSchedule && showing.length) {
    const targets = maxMovies > 0 ? showing.slice(0, maxMovies) : showing;
    const today = hkToday();
    const dates = Array.from({ length: SCHEDULE_DAYS }, (_, i) => addDays(today, i));
    onProgress?.(`  抓取场次：${targets.length} 部影片 × ${dates.length} 天`);

    const t0 = Date.now();
    let ok = 0;
    let fail = 0;

    // 并发抓取：纯 HTTP 很轻，实测 6 路并发稳定无失败（210 请求 / 40s）
    const CONCURRENCY = Number(process.env.ICIRENA_CONCURRENCY || 6);

    // 作业矩阵：影片 × 日期。按影片分批，同一批内尽量覆盖多天，
    // 这样进度日志的电影粒度依然清晰。
    const jobs = [];
    for (const film of targets) {
      const fid = film.filmUniqueId || film.filmId;
      if (!fid) continue;
      for (const d of dates) jobs.push([fid, d]);
    }

    // 每部影片的合并结果：Map<scheduleId, group>
    for (const film of targets) {
      const fid = film.filmUniqueId || film.filmId;
      if (fid) schedules.set(fid, []);
    }

    let done = 0;
    for (let i = 0; i < jobs.length; i += CONCURRENCY) {
      const batch = jobs.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async ([fid, d]) => {
          try {
            const j = await call(M.schedule, cfg, {
              filmUniqueId: fid,
              showDate: d,
              curPage: '1',
              itemsPerPage: '100',
            });
            const v = bizOf(j);
            return [fid, Array.isArray(v) ? v : []];
          } catch {
            return [fid, null];
          }
        })
      );

      for (const [fid, v] of results) {
        if (v === null) {
          fail++;
          continue;
        }
        ok++;
        const acc = schedules.get(fid);
        if (acc && v.length) acc.push(...v);
      }

      done += batch.length;
      if (done % (CONCURRENCY * 20) === 0 || done === jobs.length) {
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        const shows = [...schedules.values()].reduce(
          (n, gs) => n + gs.reduce((m, g) => m + (g.schedules?.length || 0), 0),
          0
        );
        onProgress?.(`    进度 ${done}/${jobs.length}，已取 ${shows} 場（${el}s）`);
      }
    }

    // 同一 scheduleId 会跨日期重复出现（分页/日期窗口重叠），去重后
    // 保证下游 normalizeIcirena 不会产出重复场次。
    let deduped = 0;
    for (const [fid, groups] of schedules) {
      const merged = [];
      const seen = new Set();
      for (const g of groups) {
        const list = (g.schedules || []).filter((s) => {
          const k = s.scheduleId;
          if (!k || seen.has(k)) {
            deduped++;
            return false;
          }
          seen.add(k);
          return true;
        });
        if (list.length) merged.push({ ...g, schedules: list });
      }
      schedules.set(fid, merged);
    }

    const shows = [...schedules.values()].reduce(
      (n, gs) => n + gs.reduce((m, g) => m + (g.schedules?.length || 0), 0),
      0
    );
    onProgress?.(
      `  场次完成：成功 ${ok} / 失败 ${fail} 请求，去重 ${deduped} 条，得 ${shows} 場，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`
    );
  }

  return {
    channel,
    name: cfg.name,
    channelCode: cfg.channelCode,
    base: cfg.base,
    cinemas,
    showing,
    comingsoon,
    schedules,
  };
}
