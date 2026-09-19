/**
 * icirena 平台数据归一化
 *
 * 2026-09-18：抓取已改为纯 HTTP（见 icirena-http.js），
 * 本文件只保留「原始 API 数据 → 统一结构」的纯函数，不再依赖 Playwright。
 *
 * 归一化职责：
 *   - 影院 / 影片 / 场次 三类数据映射到统一字段
 *   - icirena 毫秒时间戳 → 香港时区 ISO
 *   - 生成购票深链（/seat?wapid=...&scheduleId=...&cinemaId=...）
 */

export function normalizeIcirena(raw) {
  const { channel, cinemas, showing, comingsoon, schedules, base, channelCode } = raw;
  const out = { movies: [], cinemas: [], shows: [] };
  const parseLang = (v) => {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return {};
      }
    }
    return v || {};
  };

  /** icirena 时间戳（毫秒字符串）→ HKT ISO */
  const toHkt = (t) => {
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return new Date(n + 8 * 3600_000).toISOString().replace('Z', '+08:00');
  };

  // ---------- 影院 ----------
  const cinemaById = new Map();
  if (cinemas?.cities) {
    for (const city of cinemas.cities) {
      for (const c of city.cinemas || []) {
        const id = `${channel}-${c.cinemaLinkId}`;
        const item = {
          id,
          code: String(c.cinemaLinkId),
          nameZh: c.cinemaName || c.shortName || '',
          address: c.address || '',
          mapUrl: '',
          detailUrl: '',
          source: channel,
        };
        out.cinemas.push(item);
        cinemaById.set(String(c.cinemaLinkId), item);
      }
    }
  }

  // ---------- 影片 ----------
  const pushFilm = (f, status) => {
    const zh = typeof f.filmName === 'string' ? f.filmName : parseLang(f.filmName).zh_hk || '';
    const en = f.filmEnName || '';
    const id = `${channel}-${f.filmUniqueId || f.filmId}`;

    out.movies.push({
      id,
      slug: '',
      nameZh: zh,
      nameEn: en,
      openingDate: toHkt(f.showDate)?.slice(0, 10) ?? null,
      duration: f.duration ?? null,
      category: f.rating && f.rating !== '--' ? f.rating : null,
      dialect: f.filmLang || null,
      subtitle: f.filmSubTitleName || null,
      genres: f.filmTypeName ? String(f.filmTypeName).split('|').filter(Boolean) : [],
      director: f.directors === '--' ? null : f.directors || null,
      cast: f.actors === '--' ? null : f.actors || null,
      description: f.introduction || '',
      poster: f.poster || null,
      trailer: f.filmTrailer || null,
      detailUrl: `${base}/showtimes?wapid=${channelCode}&filmUniqueId=${f.filmUniqueId || f.filmId}`,
      status,
      source: channel,
      _filmUniqueId: f.filmUniqueId || f.filmId,
    });
  };

  for (const f of Array.isArray(showing) ? showing : []) pushFilm(f, 'showing');
  for (const f of Array.isArray(comingsoon) ? comingsoon : []) pushFilm(f, 'upcoming');

  // ---------- 场次 ----------
  for (const [filmUniqueId, groups] of schedules || []) {
    const movieId = `${channel}-${filmUniqueId}`;
    for (const g of Array.isArray(groups) ? groups : []) {
      const cid = String(g.cinemaInfo?.cinemaLinkId || '');
      for (const s of g.schedules || []) {
        const scheduleId = s.scheduleId;
        if (!scheduleId) continue;

        const startAt = toHkt(s.showTime);
        if (!startAt) continue;

        out.shows.push({
          id: `${channel}-${scheduleId}`,
          movieId,
          cinemaId: `${channel}-${cid}`,
          houseName: s.hallName || '',
          startAt,
          date: startAt.slice(0, 10),
          price: s.displayPrice ? Math.round(Number(s.displayPrice) / 100) : null,
          // ★ 总座位数：hallSeatCount 是影厅容量
          seats: typeof s.hallSeatCount === 'number' ? s.hallSeatCount : null,
          // ★ seatRate 是「**已售**百分比」（0–100），不是剩余率
          //
          //   已用 hkmovie6 的 attendance（入座率）交叉验证 20 个场次：
          //   全部满足 seatRate ≤ hkmovie6入座率（差值中位 17），
          //   且差值全为正 —— 因为我们的快照抓得更早，票仍在继续售出。
          //   若 seatRate 是剩余率，该不等式不会成立。
          //
          //   故剩余率 = 1 - seatRate/100
          remainRate:
            typeof s.seatRate === 'number'
              ? Math.min(1, Math.max(0, 1 - s.seatRate / 100))
              : null,
          soldOut: typeof s.seatRate === 'number' ? s.seatRate >= 100 : undefined,
          tags: [],
          version: s.filmVersion || null,
          language: s.filmLang || null,
          // ★ 购票深链（已实测）
          bookingUrl: `${base}/seat?wapid=${channelCode}&scheduleId=${scheduleId}&cinemaId=${cid}`,
          source: channel,
        });
      }
    }
  }

  return out;
}
