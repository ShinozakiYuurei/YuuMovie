/**
 * 場次的緊湊傳輸格式（CompactRows）
 *
 * ===== 为什么单独成一个文件 =====
 *
 * lib/data.ts 依赖 node:fs / node:path，只能在服务端（构建时）跑。
 * 而 ShowtimeExplorer 是客户端组件，需要 fromCompact() 还原数据 ——
 * 若从 lib/data.ts 引入，webpack 会把 node:path 打进浏览器包并报错
 * （UnhandledSchemeError: Reading from "node:path" is not handled）。
 *
 * 因此把「编解码」抽到这个**零依赖纯模块**：两端都能安全引入。
 */

import type { Region, Source } from './types';
import type { ShowRow } from './data';

// ★ 只做类型引入（import type），编译后会被完全擦除，
//   不会把 lib/data.ts 的 node:fs / node:path 拖进浏览器包。

/**
 * -------- 紧凑传输（CompactRows）--------
 *
 * 展平后单行 JSON 约 619 字节 —— 影院名/地址/地图链接/购票链接
 * 在 610 行里反复重复。最热的《生化危機》页因此达到 1.7MB。
 *
 * 观察：唯一值其实极少（25 家影院、6 个日期、1 个版本），
 * 故把重复字段抽成字典，行内只存整数索引：
 *
 *   影院 / 影厅 / 日期 / 版本 → 索引数组
 *   行 → [id, 日, 时, 影院, 影厅, 价, 余座%, 满座, 厅座, 购票链, 版本]
 *
 * 实测 368KB → 74KB（省 80%），单行 619 → 114 字节。
 * 代价：客户端多一步 inflate（纯数组拷贝，微秒级）。
 */
export interface CompactRows {
  /** 影院字典：与行内 cinema 索引对应 */
  cinemas: {
    id: string;
    name: string;
    address: string;
    mapUrl: string;
    region: Region | null;
    district: string | null;
    source: Source;
    sourceLabel: string;
  }[];
  /** 影厅名字典 */
  houses: string[];
  /** 日期字典 YYYY-MM-DD */
  dates: string[];
  versions: { key: string; label: string; text: string }[];
  /** 场次行；字段顺序见下方元组 */
  rows: [
    id: string,
    date: number,
    time: string,
    cinema: number,
    house: number,
    price: number | null,
    /** 余座百分比取整；-1 表示未知 */
    remainPct: number,
    soldOut: number,
    seats: number | null,
    bookingUrl: string,
    version: number
  ][];
}

/** 取索引，不存在则新建（避免重复字典项） */
function dictIx<T>(
  map: Map<T, number>,
  list: unknown[],
  key: T,
  make: () => unknown
): number {
  let i = map.get(key);
  if (i === undefined) {
    i = list.length;
    map.set(key, i);
    list.push(make());
  }
  return i;
}

/** ShowRow[] → CompactRows（服务端，构建时） */
export function toCompact(rows: ShowRow[]): CompactRows {
  const cinIx = new Map<string, number>();
  const cinemas: CompactRows['cinemas'] = [];
  const hIx = new Map<string, number>();
  const houses: string[] = [];
  const dIx = new Map<string, number>();
  const dates: string[] = [];
  const vIx = new Map<string, number>();
  const versions: CompactRows['versions'] = [];

  const rowsOut: CompactRows['rows'] = [];

  for (const r of rows) {
    const c = dictIx(cinIx, cinemas, r.cinemaId, () => ({
      id: r.cinemaId,
      name: r.cinemaName,
      address: r.cinemaAddress,
      mapUrl: r.cinemaMapUrl,
      region: r.region,
      district: r.district,
      source: r.source,
      sourceLabel: r.sourceLabel,
    }));
    const h = dictIx(hIx, houses, r.houseName, () => r.houseName);
    const d = dictIx(dIx, dates, r.date, () => r.date);
    const v = dictIx(vIx, versions, r.versionKey, () => ({
      key: r.versionKey,
      label: r.versionLabel,
      text: r.versionText,
    }));

    rowsOut.push([
      r.id,
      d,
      r.time,
      c,
      h,
      r.price,
      r.remainRate == null ? -1 : Math.round(r.remainRate * 100),
      r.soldOut ? 1 : 0,
      r.seats,
      r.bookingUrl,
      v,
    ]);
  }

  return { cinemas, houses, dates, versions, rows: rowsOut };
}

/**
 * CompactRows → ShowRow[]（客户端）
 *
 * startAt 由 date + time 拼成 `YYYY-MM-DDTHH:mm:00+08:00`。
 * 排序用的是字符串比较，与时区无关，故直接拼接即可，无需真实时区换算。
 */
export function fromCompact(c: CompactRows): ShowRow[] {
  return c.rows.map((r) => {
    const cin = c.cinemas[r[3]];
    const ver = c.versions[r[10]];
    const date = c.dates[r[1]];
    const time = r[2];
    return {
      id: r[0],
      startAt: `${date}T${time}:00+08:00`,
      time,
      date,
      price: r[5],
      remainRate: r[6] < 0 ? null : r[6] / 100,
      soldOut: r[7] === 1 ? true : undefined,
      seats: r[8],
      houseName: c.houses[r[4]] ?? '',
      bookingUrl: r[9],
      source: cin.source,
      sourceLabel: cin.sourceLabel,
      cinemaId: cin.id,
      cinemaName: cin.name,
      cinemaAddress: cin.address,
      cinemaMapUrl: cin.mapUrl,
      region: cin.region,
      district: cin.district,
      versionKey: ver.key,
      versionLabel: ver.label,
      versionText: ver.text,
      formats: ver.key === '__base__' ? [] : ver.key.split('|'),
    };
  });
}
