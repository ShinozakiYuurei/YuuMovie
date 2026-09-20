import type { Metadata } from 'next';
import { getCinemaFacets, getCinemaRows } from '@/lib/data';
import { CinemaExplorer } from '@/components/CinemaExplorer';

// 动态渲染：数据从 data/*.json 实时读取，抓取后无需重建
// （构建时静态化会把数据固化进 HTML，导致更新失效）

export const metadata: Metadata = {
  title: '戲院一覽',
  description: '香港各院線戲院地址、地圖、影廳規格（IMAX / 4DX / 全景聲…）及場次資訊。',
};

export default function CinemaListPage() {
  const rows = getCinemaRows();
  const facets = getCinemaFacets(rows);
  const specCount = rows.filter((c) => c.specs.length > 0).length;

  return (
    <>
      <section className="mb-7">
        <h1 className="text-3xl font-bold tracking-tight">
          戲<span className="hkm-grad-text">院</span>
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          共 {rows.length} 間戲院，分屬 {facets.sources.length} 條院線
          {specCount > 0 && `，其中 ${specCount} 間設有 IMAX / 4DX 等規格影廳`}。
        </p>
      </section>

      <CinemaExplorer rows={rows} facets={facets} />
    </>
  );
}
