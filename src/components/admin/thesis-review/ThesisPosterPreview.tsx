'use client';

// 교직원 공고 양식의 미리보기 — 사이트 상세 머리(게시판 경로·제목·게시일) + 포스터 캔버스.
//
// 포스터는 학생 입력 화면과 같은 렌더러(poster-canvas.ts 의 renderPoster, 자리표시 글 켬)로
// 입력마다 다시 그린다(짧은 디바운스). 배율 = 캔버스 CSS 폭 × devicePixelRatio / 1403 이라
// 레티나에서도 글자가 흐리지 않다. 게시하면 같은 렌더러가 만든 PNG 가 본문 이미지 한 장이 된다.
//
// 좁은 화면에서는 부모가 이 칸을 숨겼다 보였다 한다(편집|미리보기 전환) — 숨겨진 동안은
// 폭이 0 이라 그리지 않고, 보이는 순간 ResizeObserver 가 배율을 잡아 그린다.

import { useEffect, useRef, useState } from 'react';
import { POSTER_REF, posterAlt, type ThesisNoticeInput } from '@/lib/thesis-submit/notice';
import { renderPoster } from '@/lib/thesis-submit/poster-canvas';
import { cn } from '@/lib/utils';

export function ThesisPosterPreview({
  notice,
  boardLabel,
  title,
  pubDate,
  scheduleBadge,
  headingId,
}: {
  notice: ThesisNoticeInput;
  boardLabel: string;
  /** 게시 제목 — 비었으면 자리표시 */
  title: string;
  pubDate: string;
  /** 예약 배지 문구('예약 09:00') — 공개 시각이 아직 안 왔을 때만 */
  scheduleBadge: string | null;
  headingId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const update = () => {
      const w = c.getBoundingClientRect().width;
      if (w <= 0) return;
      const s = Math.round(((w * (window.devicePixelRatio || 1)) / POSTER_REF.width) * 1000) / 1000;
      setScale((prev) => (prev === s ? prev : s));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const firstPaint = useRef(true);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || scale <= 0) return;
    const delay = firstPaint.current ? 0 : 150;
    firstPaint.current = false;
    const h = window.setTimeout(() => {
      renderPoster(c, notice, scale, { placeholders: true }).catch((err) =>
        console.error('[thesis-post] 미리보기 렌더 실패', err),
      );
    }, delay);
    return () => window.clearTimeout(h);
  }, [notice, scale]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div className="flex flex-col gap-1.5">
          <span className="cms-eyebrow dark:text-brand">Preview</span>
          <h2 id={headingId} className="font-subhead text-lg font-bold leading-tight text-content">
            사이트에 보이는 모습
          </h2>
        </div>
        <span className="text-xs text-content-faint">입력하는 대로 바뀝니다</span>
      </div>

      <div className="mt-4 border border-surface-border bg-surface">
        <article className="px-4 pb-5 pt-4 sm:px-[22px] sm:pb-7 sm:pt-[22px]">
          <div className="flex flex-col gap-2 border-b-2 border-yonsei-navy pb-3.5 dark:border-brand">
            <span className="text-[11px] text-content-faint">대학원 › {boardLabel}</span>
            <p
              className={cn(
                'font-subhead text-[22px] font-bold leading-snug tabular-nums',
                title ? 'text-content' : 'text-content-faint',
              )}
            >
              {title || '[YYMMDD] 성명'}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums text-content-faint">
              <span>{pubDate ? pubDate.replace(/-/g, '.') : '게시일 없음'}</span>
              {scheduleBadge && (
                <span className="bg-yonsei-navy px-1.5 py-0.5 text-[11px] font-bold text-white dark:bg-brand dark:text-brand-fg">
                  {scheduleBadge}
                </span>
              )}
            </div>
          </div>
          {/* 포스터는 흰 종이 — 다크 모드에서도 흰 바탕(학과 양식 그대로) */}
          <div className="mt-4 border border-surface-border bg-white">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={posterAlt(notice)}
              className="block aspect-[1403/992] w-full"
            />
          </div>
        </article>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-content-faint">
        게시하면 이 포스터 이미지 한 장이 게시물 본문이 됩니다. 빈 칸은 회색 자리표시 글로 보입니다.
      </p>
    </div>
  );
}
