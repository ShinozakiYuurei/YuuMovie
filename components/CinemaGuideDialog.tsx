'use client';

import { CINEMA_GUIDE_URL, type CinemaGuideContent } from '@/lib/cinema-guides';

export function CinemaGuideDialog({
  name,
  address,
  guide,
  onClose,
}: {
  name: string;
  address: string;
  guide: CinemaGuideContent;
  onClose: () => void;
}) {
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
          <p className="text-sm font-semibold text-accent">{guide.sectionTitle}</p>
          <section>
            <h4 className="text-sm font-semibold text-fg">影廳與設備</h4>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-fg-soft">
              {guide.highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
          </section>
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
            內容為指南摘要；最新路線與圖片以原文檔為準。
          </span>
        </div>
      </div>
    </div>
  );
}
