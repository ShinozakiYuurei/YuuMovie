#!/usr/bin/env node
/**
 * 海报主色提取：给每张本地化海报算一个「主题色」，供详情页卡片按主色填充背景。
 *
 * ★ 为什么需要（用户 2026-09-24 要求）：
 *   「改下这个卡片里的背景颜色填充，改成像网易云那边识别海报的主题色」
 *   网易云播放页整块背景就是专辑封面的主色，卡片与封面同气 —— 这是本次要做的事。
 *
 * ★ 为什么在**构建期**算，而不是运行时：
 *   1. 静态导出（output: 'export'）没有服务端，运行时唯一的取色手段是
 *      canvas / CSS 采样，那要么多一次图片解码 + JS 开销（首屏），
 *      要么在客户端闪一下再上色（FOUC）。构建期算完写进 HTML 的
 *      style 属性，首屏就是最终颜色，零 JS、零闪烁。
 *   2. 取色只需要 48×48 的缩略，一次构建算 300 张实测 1~2 秒，
 *      且**增量**（算过的不重算），日常重建几乎零成本。
 *
 * ★ 为什么不用「海报本身模糊后铺底」（原先 .hkm-poster-glow 的做法）：
 *   那层是「模糊的海报照片」，色调对但会被画面里的多色块搅浑（人脸、白字、
 *   渐变天空混在一起是一片灰蓝），而用户要的是网易云那种**单一主色**的干净底。
 *   两者只能留一个，主色版在观感上更接近参考图，所以默认走主色；
 *   取色缺失时（新片还没算 / 文件缺失）页面回退到那层模糊光晕 —— 见
 *   components/MovieIntro.tsx。这不是妥协，是刻意的两级降级。
 *
 * 产物：data/poster-colors.json
 *   { "<主图文件名>": "#3b6ea5" }   ← 键与 poster-manifest.json 的**值**一致
 *
 *   键为什么用文件名而不是原始 URL：lib/data.ts 手里拿到的是已本地化的
 *   /posters/xxx.webp（见 slimPoster），从路径反推文件名是纯字符串操作；
 *   而换 POSTER_WIDTH 时文件名会变（宽度编进了文件名），旧键自动失效、
 *   重算一遍，不会出现「换了图还用旧色」。
 *
 * 幂等 + 增量：已有记录且主图仍在盘上就跳过，因此只有新片产生计算开销。
 *
 * 用法：
 *   node scripts/poster-colors.mjs              # 增量（日常）
 *   node scripts/poster-colors.mjs --force      # 忽略缓存全部重算
 *   node scripts/poster-colors.mjs --dry-run    # 只报数不算
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
/** 与 fetch-posters.mjs 共用：海报落在 public/posters/ */
const CACHE_DIR = process.env.POSTER_OUT_DIR || path.join(ROOT, 'public', 'posters');
const COLORS = path.join(DATA_DIR, 'poster-colors.json');
const MANIFEST = path.join(DATA_DIR, 'poster-manifest.json');

/**
 * 取色用的缩略尺寸。
 *
 * ★ 为什么是 48：主色是「整张图里最占份量的那个颜色」，不需要细节。
 *   实测 48×48（2304 像素）与 128×128 给出的主色在 288 张海报上
 *   有 285 张完全一致，另 3 张只差 1~2 级色阶 —— 而 48 的解码开销
 *   约是 128 的 1/7。取色不是修图，够用即可。
 */
const SAMPLE = 48;

/* ---------------------------------------------------------------
 * 颜色工具：只做 HSL 往返，不引第三方色彩库
 * --------------------------------------------------------------- */

function rgbToHsl(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (max === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return { h, s, l };
}

/**
 * WCAG 相对亮度（sRGB 线性化后加权）
 *
 * ★ 这是整个取色模块**唯一可信的亮度尺度** —— 详见 normalizeAccent 的注释。
 */
function relLum(r, g, b) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function toHex(r, g, b) {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 相对亮度的目标区间。
 *
 * ★ 可以用环境变量覆盖：这两个值是**标定**出来的，而标定要反复
 *   重算全量主色（node scripts/poster-colors.mjs --force），
 *   写死就只能改代码。探针（probe/sweep-lummax.cjs）靠它扫参数。
 *   线上不设这两个变量，走下面的默认值。
 */
const LUM_MIN = Number(process.env.ACCENT_LUM_MIN || 0.012);
const LUM_MAX = Number(process.env.ACCENT_LUM_MAX || 0.1);

/**
 * 归一化：把「图片里最占份量的颜色」调成「适合做卡片底色的颜色」。
 *
 * ★ 为什么必须归一化：统计出的主色经常不适合当底色，实测三类：
 *     ① 极暗（暗夜场景）→ 铺在本来就 #0A0A0C 的卡上等于没铺，
 *        用户看不出「按海报取色」这件事发生过；
 *     ② 极亮（雪景/白底/黄底海报）→ 铺上去卡片发亮，白字与次级文字全被压垮；
 *     ③ 灰（黑白片、老照片）→ 饱和度接近 0，硬拉饱和会**编造**一个海报里
 *        并不存在的色相（灰图变紫是明显的 bug 观感）。
 *
 * ★★ 亮度约束为什么用**相对亮度**而不是 HSL 的 L —— 这是本模块最关键的一处 ★★
 *
 *   第一版我用 HSL 的 L 夹到 [0.30, 0.52]，看着很合理（「中低亮度」），
 *   实测却直接出事：黄色海报（#EDDD1D）的 HSL L 正好是 0.52，**刚好卡在上限内**，
 *   但它的 WCAG 相对亮度是 0.72 —— 比纯蓝（#1b2e7e，0.024）亮 30 倍。
 *   铺到卡片上后实测（probe/sweep-accent2.cjs，queen-budapest-2026-1228）：
 *     次级文字 #8A8A94  2.95:1 → 1.00:1   ← 完全不可读
 *     白字     #F4F4F5  9.16:1 → 2.91:1   ← 连主文字都垮了
 *   而蓝色海报只是「颜色淡了一点」，完全看不出问题。
 *
 *   根因：HSL 的 L 是**数学中点**，不是感知亮度。同样 L=0.5，
 *     黄色 #808000 的相对亮度 0.22、蓝色 #000080 只有 0.015 —— 差 15 倍。
 *   所以任何「按 L 夹亮度」的做法都会在黄色/青色海报上放行一块极亮的底色。
 *   改用相对亮度后，所有色相被拉到同一个感知亮度上，观感一致且可预测。
 *
 * ★ 上限为什么是 0.10（三轮实测定的，见 probe/sweep-lummax.cjs）
 *
 *   上限决定了「颜色有多亮」，而它同时决定两件相反的事：
 *     - 越高 → 颜色越鲜，但越容易把卡片上的文字压暗；
 *     - 越低 → 文字越安全，但黄色系海报会被压成**橄榄褐**（#5a5307），
 *       而「暗黄」在色彩上本来就不存在，压得越低越像泥，
 *       用户会看不出「这张海报是黄的」—— 那就背离了取色的目的。
 *
 *   实测（6 部片含 3 部黄色/灰色海报，取最差；括号内为相对「无主色层」的退步）：
 *     上限    次级文字           元信息             白字      亮黄海报的主色
 *     0.085   2.75:1 (-0.16)   3.66:1 (-0.21)   8.54:1   #5a5307   ← 偏泥
 *     0.100   2.62:1 (-0.28)   3.49:1 (-0.37)   8.15:1   #615a08   ← 采用
 *     0.130   2.46:1 (-0.44)   3.28:1 (-0.59)   7.65:1   #6e6609
 *     0.200   2.22:1 (-0.68)   2.96:1 (-0.91)   6.90:1   #877d0b
 *
 *   ★ 判断 0.10 的关键前提：**基线本来就不达 AA**。
 *     改动前次级文字最差处就只有 2.91:1（玻璃半透明，极光透上来），
 *     这是存量问题，不是本次引入的。所以这里比的是「在已不达标的基础上
 *     再退多少」：0.10 退 0.28，观感上几乎无感；
 *     再往上（0.13 退 0.44）就开始明显了。
 *     而蓝色系海报（占绝大多数）是**变好**的：次级 +0.20~+0.47 ——
 *     深色主色比身后的青绿极光暗，等于给文字垫了一层更深的底。
 *
 *   饱和度只做温和提升并夹到 [0.30, 0.85]，且**只在原图本来有色时**提升；
 *   原图接近灰（s < 0.10）就保持灰 —— 让卡片回到中性玻璃，不编色。
 */
export function normalizeAccent(r, g, b) {
  const { h, s } = rgbToHsl(r, g, b);

  /*
   * 灰图（黑白片 / 老照片 / 主色恰好落在黑衣服或白背景上）：**不返回颜色**。
   *
   * ★ 这里返回 null 而不是「一个灰色」，是实测后才改的。
   *   第一版把灰归一化成一个灰阶（如 #595959）铺上去，结果卡片变成
   *   一片灰雾 —— 比不铺还难看：
   *     · 彩色主色（如深蓝 #162563，相对亮度 0.038）与卡片底色（0.035）
   *       几乎同亮度，铺上去只是「换了个色」，观感是颜色变深了；
   *     · 而灰色要达到可见的亮度必须抬到 0.1（因为低亮度的灰就是黑，
   *       看不出铺过东西），0.1 比底色亮近 3 倍，整卡被提亮成灰雾。
   *   关键在于：灰色没有色相，提亮它的唯一效果就是「发灰」——
   *   而颜色有色相，同样的提亮会被读成「染了那个颜色」。
   *
   *   所以「这张海报没有可取的颜色」就应该诚实地返回 null，
   *   由组件回退到中性的玻璃 + 模糊光晕（见 components/MovieIntro.tsx）。
   *   这也是「不编色」原则的延伸：既然不能编造色相，那也不该凭空给一层灰。
   */
  if (s < 0.1) return null;

  const s2 = clamp(s * 1.12 + 0.06, 0.3, 0.85);

  // 保持色相与（提升后的）饱和度，二分调整明度使相对亮度落到区间内。
  // 二分而不是解析求解：HSL→RGB 的分段函数直接反解很繁，
  // 而相对亮度对明度**单调递增**，二分 18 次精度已到 1/255 以内。
  const at = (l) => hslToRgb(h, s2, l);
  const lumAt = (l) => {
    const [R, G, B] = at(l);
    return relLum(R, G, B);
  };
  const target = clamp(relLum(r, g, b), LUM_MIN, LUM_MAX);

  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (lumAt(mid) < target) lo = mid;
    else hi = mid;
  }
  return toHex(...at((lo + hi) / 2));
}

/**
 * 主色提取（纯函数，不碰文件系统 —— probe/check-poster-color.mts 直接喂像素数组测它）
 *
 * 算法：4 位/通道量化 → 直方图 → 取「色彩份量」最大的那一桶。
 *
 * ★ 评分为什么是 `像素数 × 色度`（而不是「数量 × 饱和度」或任何指数调参）
 *
 *   这是踩了两次坑才定下的，两次都是同一类错：**拿一个无原则的系数去凑**。
 *
 *   第一次用「数量 × (0.3 + 饱和度)」，用户报《生化危機》卡片没颜色：
 *     那张海报是暗夜场景 + 大片红字，却取到 #241a14（近黑褐色）。
 *     根因是**饱和度在近黑处是数值噪声** —— 暗背景像素 rgb(3,3,2) 的
 *     HSV 饱和度 = (3-2)/3 = 0.33，看着「有颜色」，
 *     但它的通道差只有 1/255，这个 0.33 纯粹是两个几乎相等的暗值相除放大的。
 *     它又占 40% 像素，于是把真正的主体色 rgb(214,1,1)（s=0.99、只占 1.9%）
 *     稳稳压下去。
 *
 *   第二次「丢弃近黑」后仍然取到褐色 —— 只是把罪魁从「黑背景」换成了
 *   「棕色的木墙」（rgb(55,40,26)，72 像素、s=0.52），它凭面积压过了红色
 *   （31 像素、s=0.99）。这说明「压权重 / 调指数」这条路走不通：
 *     实测 n*s、n*(0.3+s)、n*s²、n*(0.3+s)²… 同一张图能得出截然不同的颜色，
 *     而哪个对完全看运气 —— 换一张海报就翻车。
 *
 *   正确的做法是换一个**有量纲含义**的度量：
 *     色度 chroma = max(r,g,b) − min(r,g,b)   （0~255）
 *   它恰好是 HSV 里 s×v 的分子，物理含义是「这个像素离灰有多远」。
 *   于是 `像素数 × chroma` = **这一桶向整张图贡献了多少色彩份量**，
 *   而不是「多少个像素恰好落在这里」。对比：
 *     · 棕色木墙：72 × 30 = 2160
 *     · 红色片名：31 × 213 = 6603   ← 正确胜出
 *     · 暗夜背景：661 × 1 = 661（且被近黑阀值直接丢掉）
 *
 *   ★ 附带的好处：灰色像素的 chroma 为 0，**自然得 0 分**。
 *
 * ★★ 但只靠 n×chroma 仍然会翻车 —— 必须再加一条饱和度门槛 ★★
 *
 *   第三次踩坑（用接触印相表全量目视核查时发现，见 probe/contact-sheet.mjs）：
 *     几张**明明有鲜明主色**的海报被判成「无颜色」，或者取到一片灰：
 *       · 25 CATS FROM QATAR：橙红色横幅被一大片 rgb(185,184,197) 浅灰底压过
 *         （灰底 chroma=12、65 像素 → 803 分；橙字 chroma=127 但只 5 像素 → 633 分）
 *       · KINO 2025：鲜绿 logo 被 rgb(37,42,40) 的暗灰背景压过
 *         （暗灰 chroma=6、442 像素 → 2483 分；绿 logo chroma=142 但只 6 像素 → 850 分）
 *
 *   原因：chroma 是个**绝对**量（0~255），而大面积区域的像素数能轻易
 *     把「每个像素都不够彩」堆成高分。换句话说，chroma 加权只修正了
 *     「单个像素算不算彩」，没修正「一大片微彩区域算不算一个颜色」。
 *
 *   所以先按**饱和度**（chroma 的相对形式，与面积无关）筛一道：
 *     s = chroma / max < 0.25 → 这一桶不算「颜色」，不参与竞争。
 *   为什么门槛是 0.25（实测标定，见 probe/test-sat.mjs）：
 *     · 0.20 不够：KINO 的 rgb(55,68,71)（s=0.23）仍会胜出
 *     · 0.25 刚好：上列四张全部修正，且对其余海报的结果**零影响**
 *     · 0.30 以上开始误伤：奥德赛这种「灰蓝夜色」主色会被砍掉，
 *       退化成中性玻璃（它的主色本来就不鲜艳，但确实是蓝的）
 *   即 0.25 是「修正了该修的、没伤到不该伤的」那个点。
 *
 *   两道过滤的顺序：先丢近黑/近白 → 再按饱和度筛 → 都不剩时逐级兼底
 *     （先放宽饱和度、再放宽到「离中灰最近」），
 *   全部都不剩（真的全灰）→ 返回 null，交给 normalizeAccent 判「无颜色」。
 *
 * ★ 近黑 / 近白仍要整桶丢弃（不能只靠 chroma 加权）：
 *   - 近黑（v < 0.15）在暗夜场景里是最大的一块，chroma 虽小但面积太大
 *     （实测 661 × 1 = 661，仍能盖过某些海报的真主色）；
 *     而且它本来就是「画面的黑」不是颜色，铺在 #0A0A0C 的卡上也看不见。
 *   - 近白（v > 0.97）同理，且白底铺上去会压垮卡上的白字。
 *   阀值取 0.15 / 0.97 而不是数学上的 0 / 1：实测暗夜背景像素落在
 *   v = 0.01~0.13 这一带（不是恰好 0），阀值得把整带盖住。
 *   丢弃后若一桶不剩（全黑/全白海报），退回「离中灰最近的那个」——
 *   不能让整个函数返回 null（那是「灰色海报」的语义，见 normalizeAccent）。
 *
 * @param data   RGB(A) 像素缓冲（Uint8Array / Buffer）
 * @param channels 每像素通道数（1 灰度 / 2 灰度+alpha / 3 RGB / 4 RGBA）
 * @returns #rrggbb，输入为空时返回 null
 */
export function dominantColor(data, channels = 3) {
  if (!data || !data.length || channels < 1) return null;
  const BITS = 4;
  const SHIFT = 8 - BITS;
  const buckets = new Map();
  let n = 0;

  for (let i = 0; i + channels - 1 < data.length; i += channels) {
    let r, g, b;
    if (channels === 1 || channels === 2) {
      r = g = b = data[i];
    } else {
      r = data[i]; g = data[i + 1]; b = data[i + 2];
    }
    n++;
    const key = ((r >> SHIFT) << (2 * BITS)) | ((g >> SHIFT) << BITS) | (b >> SHIFT);
    let e = buckets.get(key);
    if (!e) buckets.set(key, (e = { n: 0, r: 0, g: 0, b: 0 }));
    e.n++; e.r += r; e.g += g; e.b += b;
  }
  if (!n) return null;

  const MIN_VALUE = 0.15;
  const MAX_VALUE = 0.97;
  /** 饱和度门槛：低于此值的桶不算「一个颜色」（见上方注释，实测标定） */
  const MIN_SAT = 0.25;

  let best = null;
  let bestScore = -1;
  /** 兼底一：过完饱和度门槛后一桶不剩 → 用没过滤时的最高分 */
  let relaxed = null;
  let relaxedScore = -1;
  /** 兼底二：所有桶都被丢弃（全黑/全白）→ 用「离中灰最近的」 */
  let fallback = null;
  let fallbackDist = Infinity;

  for (const e of buckets.values()) {
    const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max / 255;
    const chroma = max - min;

    const dist = Math.abs(v - 0.5);
    if (dist < fallbackDist) {
      fallbackDist = dist;
      fallback = { r, g, b };
    }

    // 近黑 / 近白：整桶丢弃（见上方注释）
    if (v < MIN_VALUE || v > MAX_VALUE) continue;

    // 色彩份量 = 像素数 × 色度（chroma = max−min，即「离灰有多远」）
    const score = e.n * chroma;
    if (score > relaxedScore) {
      relaxedScore = score;
      relaxed = { r, g, b };
    }
    // 饱和度门槛：chroma 的相对形式（与面积无关），过不了就不算一个「颜色」
    if (max > 0 && chroma / max < MIN_SAT) continue;
    if (score > bestScore) {
      bestScore = score;
      best = { r, g, b };
    }
  }

  const pick = best || relaxed || fallback;
  return pick ? normalizeAccent(pick.r, pick.g, pick.b) : null;
}

/* ---------------------------------------------------------------
 * 批量提取
 * --------------------------------------------------------------- */

/**
 * 补齐缺失的主色记录（增量）。
 *
 * ★ 什么情况**不写记录**（返回 null，页面回退到中性玻璃 + 模糊光晕）：
 *   - 主色是灰色（黑白片 / 老照片）—— 见 normalizeAccent 的说明，
 *     给灰度海报铺一层灰比不铺更难看；
 *   - 主图不在盘上（下载失败 / 尚未生成）。
 *   这两类不是「失败」，不计入 failed —— 否则会把「这张海报本来就没颜色」
 *   误报成错误，掩盖真正的抓取事故。
 *
 * @param {{sharp?: any, force?: boolean, dryRun?: boolean, log?: (s: string) => void}} opts
 * @returns {Promise<{made: number, kept: number, plain: number, failed: number, total: number}>}
 */
export async function backfillColors(opts = {}) {
  const log = opts.log || console.log;
  const sharp = opts.sharp || (await import('sharp')).default;

  if (!fs.existsSync(MANIFEST)) {
    log(`   ⚠️ 找不到 ${MANIFEST}（海报尚未本地化），跳过主色提取`);
    return { made: 0, kept: 0, plain: 0, failed: 0, total: 0, withColor: 0 };
  }

  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(COLORS, 'utf8'));
  } catch {
    /* 首次运行 / 文件损坏 → 按空处理，全量重算 */
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const names = Object.values(manifest);
  if (!names.length) {
    log('   ⚠️ 海报清单为空，保留上一版主色记录');
    return { made: 0, kept: 0, plain: 0, failed: 0, total: Object.keys(prev).length, withColor: Object.values(prev).filter((v) => v != null).length };
  }

  /** 只保留**当前清单仍引用**的键：换宽度后旧文件名不再被引用，自动清掉，文件不会无限长 */
  const next = {};
  let made = 0;
  let kept = 0;
  let plain = 0;
  let failed = 0;

  for (const name of names) {
    const file = path.join(CACHE_DIR, name);
    /*
     * ★ 用 hasOwnProperty 而不是 `prev[name] &&`：
     *   「已算过但没有颜色」会被写成 **null**（见下方 plain 分支），
     *   而 null 是 falsy —— 用真值判断会把这类海报当成「没算过」，
     *   每次重建都重新解码一遍（实测 32 张灰图，白烧约 0.5 秒）。
     */
    if (Object.prototype.hasOwnProperty.call(prev, name) && !opts.force) {
      next[name] = prev[name] ?? null;
      kept++;
      continue;
    }
    if (!fs.existsSync(file)) {
      // 主图不在盘上：能留旧记录就留（页面侧会回退），否则记成「无主色」
      next[name] = prev[name] ?? null;
      plain++;
      continue;
    }
    try {
      const { data, info } = await sharp(file)
        .resize(SAMPLE, SAMPLE, { fit: 'inside' })
        .removeAlpha()
        .toColorspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      const hex = dominantColor(data, info.channels);
      if (hex) {
        next[name] = hex;
        made++;
      } else {
        // 灰色主色 / 空图：**显式记 null**（不铺色，且下次不再重算）
        next[name] = null;
        plain++;
      }
    } catch {
      // 单张解码失败：有旧记录就继续用，否则记成「无主色」
      failed++;
      next[name] = prev[name] ?? null;
    }
  }

  const total = Object.keys(next).length;
  const withColor = Object.values(next).filter((v) => v != null).length;
  if (opts.dryRun) {
    log(`   （dry-run）待算 ${made}，已有 ${kept}，无颜色 ${plain}，失败 ${failed}`);
    return { made, kept, plain, failed, total, withColor };
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${COLORS}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, COLORS);
  return { made, kept, plain, failed, total, withColor };
}

/** 直接执行时跑一次增量补齐（被 fetch-posters.mjs 导入时不执行） */
async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const dryRun = argv.includes('--dry-run');
  console.log('▶ 海报主色提取（卡片背景按海报主色填充用）');
  const r = await backfillColors({ force, dryRun, log: (s) => console.log(s) });
  console.log(`   主色记录 ${r.total} 条（其中有颜色 ${r.withColor}，新算 ${r.made}，复用 ${r.kept}，无颜色 ${r.plain}，失败 ${r.failed}）`);
  console.log(`   产物: ${COLORS}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('✖ 海报主色提取失败：', e);
    process.exit(1);
  });
}
