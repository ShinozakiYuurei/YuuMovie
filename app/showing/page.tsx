import type { Metadata } from 'next';
import { getShowingGroups, getMeta } from '@/lib/data';
import { MovieGroupCard } from '@/components/MovieGroupCard';

// 动态渲染：数据运行时读取

export const metadata: Metadata = {
  title: '全部上映中電影',
  description: '香港現正上映電影完整清單，含各格式版本（IMAX / 4DX / 菲林 / 特典場）與場次。',
};

/**
 * 全部上映中電影（不分页、不截断）
 *
 * 为什么单独一页：首页为压 2C2G 的 TTFB 只渲染前 60 组
 * （见 app/page.tsx），但热映片里有一批「单日一两场」的长尾
 * （艺术影院 / 影展场 / 重映特典場），它们在首页拿不到位置，
 * 只按场次排序就沉到 100 名开外，用户会觉得「这部电影不见了」。
 * 例：《M》(GFF)、《忽男忽女・後篇》这类 1–2 场的条目。
 *
 * 本页渲染全部组（当前 ~170 组），是静态导出，nginx 直接发文件，
 * 不影响首页首屏。
 */
export default function ShowingAllPage() {
  const groups = getShowingGroups();
  const meta = getMeta();

  return (
    <>
      <section className="mb-7">
        <h1 className="text-3xl font-bold tracking-tight">
          全部<span className="bg-gradient-to-r from-[#8b7cff] to-[#22d3ee] bg-clip-text text-transparent">上映中</span>
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          共 {groups.length} 部電影，按場次多寡排列。含僅放一两場的藝術影院、影展及特典長尾。
        </p>
        <p className="mt-1 text-xs text-gray-500">
          資料來源共 {meta.counts.movies} 部電影 / {meta.counts.shows} 場次
        </p>
      </section>

      <div className="hkm-stagger grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {groups.map((g, i) => (
          <div
            key={g.key}
            style={{ '--i': Math.min(i, 30) } as React.CSSProperties}
            className="h-full"
          >
            {/*
             * 首屏优先级：只给第一行（5 张）开 priority。
             * 网格是 lg:grid-cols-5，第一行即首屏可见区域。
             * 这里可能有上百张卡片，绝不能全开 —— 详见 PosterImage.tsx 注释。
             */}
            <MovieGroupCard group={g} priority={i < 5} />
          </div>
        ))}
      </div>

      {groups.length === 0 && <p className="py-20 text-center text-gray-500">暫無上映資料</p>}
    </>
  );
}
