/**
 * MCL 院线抓取器
 *
 * 数据源：https://www.mclcinema.com/MCLWebAPI2/
 *  - GetNowShowingGrid.aspx?l=zh-TW  → 影片清单（id / 片名 / 海报）
 *  - GetNowShowingList.aspx?l=zh-TW  → 场次（影院 / 版本 / 时间 / 余座）
 *
 * 购票深链：MCLSelectSeat.aspx?visLang=zh-TW&ci={影院码}&si={场次ID}
 *
 * ⚠️ MCL 在中国大陆网络不可达（TCP 超时），需香港出口 IP。
 *    通过 MCL_PROXY 环境变量传入代理，例如 http://127.0.0.1:10010
 */

import https from 'node:https';

// https-proxy-agent 按需加载：香港 VPS 直连 MCL 时无需该依赖，
// 缺失也不影响（避免部署环境依赖不全导致启动失败）。
let _HttpsProxyAgent = null;
async function getProxyAgent(proxy) {
  if (!proxy) return undefined;
  if (!_HttpsProxyAgent) {
    try {
      ({ HttpsProxyAgent: _HttpsProxyAgent } = await import('https-proxy-agent'));
    } catch (e) {
      throw new Error(
        '指定了 MCL_PROXY 但缺少 https-proxy-agent 依赖。' +
          '本机若可直连 MCL，请勿设置 MCL_PROXY。'
      );
    }
  }
  return new _HttpsProxyAgent(proxy);
}

const BASE = 'https://www.mclcinema.com';
const API = `${BASE}/MCLWebAPI2`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const LANG = 'zh-TW';

/**
 * 发请求取 JSON。
 * 注意：Node 内置 fetch 不读 http_proxy，且 undici 的 ProxyAgent 与内置 dispatcher 版本
 * 不兼容（invalid onRequestStart method），故这里用 node:https + https-proxy-agent。
 */
async function getJson(path, { proxy } = {}) {
  const url = `${API}/${path}`;
  const agent = await getProxyAgent(proxy);

  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent,
        headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' },
        timeout: 30000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`${path} → HTTP ${res.statusCode}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`${path} → JSON 解析失败: ${e.message}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`${path} → 超时`)));
    req.on('error', reject);
  });
}

/**
 * 解析 MCL 的场次描述字符串。
 * 格式：`星期四, 9月24日, 02:10 PM, IMAX/12院 $210`
 * 注意：**不含年份**，需按当前时间推断（处理 12 月 → 1 月跨年）。
 */
export function parseShowDesc(desc) {
  if (!desc) return null;
  const m = desc.match(
    /^(星期[一二三四五六日]),\s*(\d{1,2})月(\d{1,2})日,\s*(\d{1,2}):(\d{2})\s*(AM|PM),\s*(.*?)\s*\$?(\d+)?$/
  );
  if (!m) return null;

  const [, , monthStr, dayStr, hourStr, minStr, ampm, houseRaw, priceStr] = m;
  const month = Number(monthStr);
  const day = Number(dayStr);
  let hour = Number(hourStr) % 12;
  if (ampm === 'PM') hour += 12;

  // 推断年份：以香港时间为准，若月份已过则视为下一年
  const nowHkt = new Date(Date.now() + 8 * 3600_000);
  let year = nowHkt.getUTCFullYear();
  const nowMonth = nowHkt.getUTCMonth() + 1;
  if (month < nowMonth - 1) year += 1;

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minStr).padStart(2, '0')}:00+08:00`;

  // 影厅名与价格：`IMAX/12院 $210`
  const priceM = houseRaw.match(/\$(\d+)/);
  const price = priceStr ? Number(priceStr) : priceM ? Number(priceM[1]) : null;
  const houseName = houseRaw.replace(/\s*\$?\d+\s*$/, '').trim();

  return { iso, date: iso.slice(0, 10), price, houseName };
}

/** 抓取 MCL 全部数据 */
export async function scrapeMcl({ proxy } = {}) {
  const [grid, list, cinemaDetails] = await Promise.all([
    getJson(`GetNowShowingGrid.aspx?l=${LANG}`, { proxy }),
    getJson(`GetNowShowingList.aspx?l=${LANG}`, { proxy }),
    // 影院地址 / 地图，独立端点
    getJson(`GetCinemaDetails.aspx?l=${LANG}`, { proxy }).catch(() => []),
  ]);

  // 影院地址映射
  const cinemaInfo = new Map();
  for (const c of Array.isArray(cinemaDetails) ? cinemaDetails : []) {
    cinemaInfo.set(String(c.id), { address: c.a || '', mapUrl: c.m || '' });
  }

  // 影片元数据（片名 + 海报）
  const meta = new Map();
  for (const m of grid.movies || []) {
    const posterPath = m.n || `${grid.ba}${grid.dba}${grid.dp}${m.id}${grid.ta}`;
    meta.set(String(m.id), {
      name: m.mn || '',
      poster: `${BASE}/${posterPath}`,
    });
  }

  const movies = [];
  const cinemas = new Map();
  const shows = [];

  for (const mv of list.movies || []) {
    const id = `mcl-${mv.id}`;
    const info = meta.get(String(mv.id)) || { name: '', poster: null };

    movies.push({
      id,
      nameZh: info.name,
      poster: info.poster,
      // MCL 未提供片长/分级等，留空由其他院线数据或人工补全
      duration: null,
      category: null,
      dialect: null,
      subtitle: null,
      genres: [],
      director: null,
      cast: null,
      description: '',
      trailer: null,
      detailUrl: `${BASE}/MovieSet.aspx?id=${id}`,
      status: 'showing',
      source: 'mcl',
    });

    for (const ver of mv.vst || []) {
      for (const c of ver.c || []) {
        const cinemaId = String(c.ci);
        if (!cinemas.has(cinemaId)) {
          const info = cinemaInfo.get(cinemaId) || { address: '', mapUrl: '' };
          cinemas.set(cinemaId, {
            id: `mcl-${cinemaId}`,
            code: cinemaId,
            nameZh: c.cn || '',
            address: info.address,
            mapUrl: info.mapUrl,
            detailUrl: `${BASE}/NowShowingByHouse.aspx?ci=${cinemaId}`,
            source: 'mcl',
          });
        }

        for (const s of c.s || []) {
          if (!s.si || s.si < 0) continue; // si = -1 是分隔行
          const parsed = parseShowDesc(s.sn);
          if (!parsed) continue;

          shows.push({
            id: `mcl-${s.si}`,
            movieId: id,
            cinemaId: `mcl-${cinemaId}`,
            houseName: parsed.houseName,
            startAt: parsed.iso,
            date: parsed.date,
            price: parsed.price,
            // ★ MCL 的 r 是「剩余座位百分比」（0–100），**不是已售率**
            //
            //   已用 hkmovie6 的 attendance（入座率）交叉验证 49 个场次：
            //     corr(r, attendance) = -0.986
            //     假设 r=剩余率 → 误差均值 0.009 / 标准差 0.041（几乎完美）
            //     假设 r=已售率 → 误差均值 0.443 / 标准差 0.468（完全不吻合）
            //
            //   ⚠️ 注意：MCL 官网自己会把 r 反算成「已售」来画进度条宽度
            //   （custom-mcl-select-seat.js: SessionRemain = 100 - SessionRemain），
            //   容易被误读成已售率。以实测交叉验证为准。
            //
            //   MCL 不提供影厅总座位数，故 seats 置 null（不猜测）。
            seats: null,
            remainRate:
              typeof s.r === 'number'
                ? Math.min(1, Math.max(0, s.r / 100))
                : null,
            soldOut: typeof s.r === 'number' ? s.r <= 0 : undefined,
            version: ver.vn || ver.v || null,
            language: ver.l || null,
            tags: [],
            // ★ 购票深链
            bookingUrl: `${BASE}/MCLSelectSeat.aspx?visLang=${LANG}&ci=${cinemaId}&si=${s.si}`,
            source: 'mcl',
          });
        }
      }
    }
  }

  return { movies, cinemas: [...cinemas.values()], shows };
}
