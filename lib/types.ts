export type Source = 'broadway' | 'mcl' | 'emperor' | 'cinemacity' | 'bestar';

export interface Movie {
  id: string;
  slug: string;
  nameZh: string;
  nameEn: string;
  openingDate: string | null;
  duration: number | null;
  category: string | null;
  dialect: string | null;
  subtitle: string | null;
  genres: string[];
  director: string | null;
  cast: string | null;
  description: string;
  poster: string | null;
  trailer: string | null;
  detailUrl: string;
  status: 'showing' | 'upcoming';
  source: Source;
  /** 该片还在哪些院线上映（跨院线合并时产生） */
  alsoAt?: Source[];
  /** 全部有该片场次的院线（含 primary） */
  sources?: Source[];
}

export interface Cinema {
  id: string;
  code: string;
  nameZh: string;
  address: string;
  mapUrl: string;
  detailUrl: string;
  source: Source;
  /**
   * 大區（香港 / 九龍 / 新界 / 澳門）
   * 读取层由地址推断（见 lib/region.ts），非抓取字段
   */
  region?: Region | null;
  /** 十八區（中西區 / 油尖旺區 …）；澳門无此值 */
  district?: string | null;
}

/** 香港大區（与 hkmovie6 的「所有地區」一致） */
export type Region = '香港' | '九龍' | '新界' | '澳門';

export interface Show {
  id: string;
  movieId: string;
  cinemaId: string;
  houseName: string;
  startAt: string;
  date: string;
  price: number | null;
  /**
   * 影厅总座位数
   *
   * ⚠️ 历史语义混乱（见 lib/seat.ts 的说明）：
   *   百老匯  = 总座位数
   *   MCL    = 剩余座位百分比（0–100）
   *   icirena = 已售百分比（0–100）
   * 现已统一为「总座位数」；三源原始值在抓取时已折算，
   * 无法取得总座位数的源（MCL）为 null。
   */
  seats: number | null;
  /**
   * 剩余可选座位占比（0–1），颜色标记的唯一依据
   *
   * 各源算法（已用 hkmovie6 的 attendance 交叉验证，见 lib/seat.ts）：
   *   百老匯  = avaliable / seats
   *   MCL    = r / 100              （r 本身就是剩余率，corr 与入座率 -0.986）
   *   icirena = 1 - seatRate / 100  （seatRate 是已售率）
   * null 表示该源未提供座位信息
   */
  remainRate?: number | null;
  /** 是否已满座（hkmovie6 用独立深红档表示） */
  soldOut?: boolean;
  tags: string[];
  category?: string | null;
  version?: string | null;
  language?: string | null;
  bookingUrl: string;
  source: Source;
}

export interface Meta {
  lastUpdated: string;
  sources: string[];
  counts: {
    movies: number;
    showing: number;
    upcoming: number;
    cinemas: number;
    shows: number;
  };
  errors: unknown[];
  durationMs: number;
  integrity?: Integrity;
}

export interface Integrity {
  orphanShows: number;
  showsWithoutBookingUrl: number;
  moviesWithoutPoster: number;
  cinemasWithoutAddress: number;
}
