'use client';

import { CINEMA_GUIDE_URL, type CinemaGuideContent } from '@/lib/cinema-guides';
import { CINEMA_FACILITIES } from '@/lib/cinema-facilities';

export function CinemaGuideDialog({
  cinemaId,
  name,
  address,
  guide,
  guideSpecs = [],
  onClose,
}: {
  cinemaId: string;
  name: string;
  address: string;
  guide: CinemaGuideContent;
  /**
   * 只有第三方觀眾指南支持、院方未公布的規格。
   * 必須與「已核實規格」分開顯示 —— 兩者的可信度不同（見 GUIDE_SPECS 註釋）。
   */
  guideSpecs?: { key: string; label: string }[];
  onClose: () => void;
}) {
  const facilities = CINEMA_FACILITIES[cinemaId];
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--hkm-scrim)] p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={name + ' 指南'}
      onClick={onClose}
    >
      <div
        className="hkm-panel flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-fg">{name}</h3>
            <p className="mt-0.5 truncate text-xs text-fg-muted">{address}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="shrink-0 rounded-full border border-hairline-strong px-2.5 py-1 text-xs text-fg-soft transition hover:border-accent/50 hover:text-fg"
          >
            關閉
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
          {facilities && (
            <section>
              <h4 className="text-sm font-semibold text-fg">已核實規格與特色影廳</h4>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-fg-soft">
                {facilities.details.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                {facilities.sources.map((source) => (
                  <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">
                    {source.label} ↗
                  </a>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-fg-muted">
                核對日期：{facilities.verifiedOn}。規格按影廳而異，不代表每廳或每場均提供；場次格式以售票頁為準。
              </p>
            </section>
          )}
          {guideSpecs.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold text-fg">觀眾指南整理的規格</h4>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {guideSpecs.map((spec) => (
                  <span key={spec.key} className="hkm-chip">{spec.label}</span>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-fg-muted">
                以上規格來自第三方《觀眾指南》整理，
                <strong className="font-semibold text-fg-soft">並非院方公布</strong>
                。院方未公開此戲院的放映／音響規格，因此不列入上一節的「已核實規格」；
                同一戲院可能只有部分影廳具備這些規格，以現場及售票頁為準。
              </p>
            </section>
          )}
          <section>
            <h4 className="text-sm font-semibold text-fg">觀眾指南：場地概況與設備</h4>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-fg-soft">
              {guide.highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          </section>
          {guide.features && guide.features.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold text-fg">影院特色與設施</h4>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-fg-soft">
                {guide.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </section>
          )}
          {guide.rooms && guide.rooms.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold text-fg">影廳介紹與選座</h4>
              <div className="mt-2 space-y-3">
                {guide.rooms.map((room) => (
                  <article key={room.name} className="rounded-xl border border-hairline px-3 py-3">
                    <h5 className="text-sm font-semibold text-fg">{room.name}</h5>
                    {room.description && (
                      <p className="mt-1 text-sm leading-relaxed text-fg-soft">{room.description}</p>
                    )}
                    {room.experience && room.experience.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-fg-soft">
                        {room.experience.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    )}
                    {room.seatTips && room.seatTips.length > 0 && (
                      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                        選座建議：{room.seatTips.join('；')}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
          {guide.route && (
            <section>
              <h4 className="text-sm font-semibold text-fg">交通指南</h4>
              <p className="mt-2 text-sm leading-relaxed text-fg-soft">{guide.route}</p>
            </section>
          )}
          {guide.note && (
            <p className="rounded-xl border border-hairline px-3 py-2 text-sm leading-relaxed text-fg-muted">
              {guide.note}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline px-4 py-3">
          <a
            href={CINEMA_GUIDE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hkm-btn-ghost rounded-full px-3.5 py-1.5 text-xs"
          >
            查看完整指南 ↗
          </a>
          <span className="text-[11px] leading-relaxed text-fg-dim">
            影廳體驗與選座建議為原指南整理的觀眾回饋，實際以現場為準；路線細節及圖片請查看原文檔。
          </span>
        </div>
      </div>
    </div>
  );
}
