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

/**
 * 外部补充数据（data/enrich.json 的一条）
 *
 * 由 scrapers/enrich.js 写入，**不进 movies.json**：
 * movies.json 每 2–6 小时被 scrape.js 整体重写，
 * 混在一起会被冲掉；分开存才能做到「评分长期缓存、只增量补新片」。
 * 读取层（lib/data.ts）按 enrichment key 叠加到电影组上。
 *
 * 2026-09-19：一度取消豆瓣（HTML 页要过 sec.douban.com 的 PoW 盾且反复弹回），
 * 后因发现 movie/www 的 /j/search_suggest **不挂那道盾**而重新接入评分。
 * 该路径在 robots.txt 的 Disallow: /j/ 下，用户已明确批准使用并要求长缓存少敲门。
 * 发行商仍无可靠源（院线数据/IMDb 均无此字段），未做。
 */
export interface EnrichEntry {
  key: string;
  movieIds?: string[];
  nameZh?: string | null;
  nameEn?: string | null;
  year?: number | null;
  updatedAt?: string | null;

  /**
   * 豆瓣评分（data/douban 部分）
   *
   * ★ 只用它的**数字**，不用它的中文文本。
   *   豆瓣主标题/类型/人名都是简体（「目黑莲」「剧情」），
   *   而本站是繁體，且导演/演员/类型已从院线数据拿到中文（百老匯的
   *   cast_lang.zh_hk 就是繁体）。混用会出现「目黑蓮 / 目黑莲」两种写法同屏。
   *   所以下面 genres/director/cast/country 只存盘供人工核对，不进页面。
   */
  douban?: {
    notFound?: boolean;
    doubanId?: string | null;
    doubanUrl?: string | null;
    doubanTitle?: string | null;
    doubanYear?: number | null;
    /** null = 匹到了条目但还没出分（新片常见） */
    rating?: number | null;
    /** rated=有分 pending=暂无评分 unreleased=尚未上映 */
    ratingState?: 'rated' | 'pending' | 'unreleased' | null;
    /** 以下四项是简体，仅存盘不展示（见上面说明） */
    country?: string | null;
    genres?: string[] | null;
    director?: string | null;
    cast?: string | null;
    queriedWith?: string;
    /** 接口返回的前 3 个候选，用于人工核对匹错 */
    alternatives?: string[] | null;
    /** 本字段自己的抓取时间（刷新周期与 IMDb 不同） */
    at?: string | null;
  } | null;

  /** IMDb 评分（查不到时 notFound=true，而不是缺字段） */
  imdb?: {
    notFound?: boolean;
    /** 允许 null：人工只给分数不给 id 时不编造 id */
    imdbId?: string | null;
    imdbUrl?: string | null;
    imdbTitle?: string | null;
    imdbYear?: number | null;
    /** null = 条目存在但人数不足，尚未出分 */
    rating?: number | null;
    votes?: number | null;
    queriedWith?: string;
  } | null;

  /**
   * 人工覆盖（data/enrich-manual.json）
   *
   * 片名自动匹配偶尔会撞到同名旧片，这时候直接写死 imdbId；
   * 也可只给 rating（无自动源的冷门片）。
   */
  manual?: {
    imdbId?: string | null;
    rating?: number | null;
    votes?: number | null;
    note?: string;
  } | null;
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
  /**
   * 影廳規格（如 ['imax','atmos'] / ['luxe']）
   *
   * 读取层由「影厅名 + 场次版本 + 片名」三处证据推断（见 lib/cinema-specs.ts），
   * 非抓取字段。只列出**本戲院真的有**的规格 —— 空数组表示没有可识别的规格厅
   * （普通厅戏院占多数，它们不出现在筛选结果里是对的）。
   */
  specs?: string[];
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
