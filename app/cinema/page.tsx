import type { Metadata } from 'next';
import Link from 'next/link';
import { getCinemasBySource } from '@/lib/data';

// ISR：5 分钟
// 动态渲染：数据从 data/*.json 实时读取，抓取后无需重建
// （构建时静态化会把数据固化进 HTML，导致更新失效）

export const metadata: Metadata = {
  title: '戲院一覽',
  description: '香港各院線戲院地址、地圖及場次資訊。',
};

export default function CinemaListPage() {
  const groups = getCinemasBySource();
  const total = groups.reduce((n, g) => n + g.cinemas.length, 0);

  return (
    <>
      <section className="mb-7">
        <h1 className="text-3xl font-bold tracking-tight">
          戲<span className="bg-gradient-to-r from-[#8b7cff] to-[#22d3ee] bg-clip-text text-transparent">院</span>
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          共 {total} 間戲院，分屬 {groups.length} 條院線。
        </p>
      </section>

      {groups.map((g) => (
        <section key={g.source} className="mb-9">
          <h2 className="mb-3.5 flex items-baseline gap-2 border-b border-white/8 pb-2.5 text-lg font-semibold tracking-tight">
            {g.label}
            <span className="hkm-chip">{g.cinemas.length} 間</span>
          </h2>
          <div className="grid gap-3.5 sm:grid-cols-2">
            {g.cinemas.map((c) => (
              <div key={c.id} className="hkm-glass rounded-2xl p-4">
                <h3 className="font-semibold text-white">{c.nameZh}</h3>
                {c.address && <p className="mt-1 text-xs text-gray-400">{c.address}</p>}
                <div className="mt-3.5 flex gap-2">
                  <Link
                    href={`/cinema/${c.id}`}
                    className="hkm-btn-primary rounded-full px-3.5 py-1.5 text-xs font-semibold"
                  >
                    查看場次
                  </Link>
                  {c.mapUrl && (
                    <a
                      href={c.mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hkm-btn-ghost rounded-full px-3.5 py-1.5 text-xs"
                    >
                      地圖 ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
