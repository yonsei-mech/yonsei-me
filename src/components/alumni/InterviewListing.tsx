'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { BoardPagination } from '@/components/BoardPagination';
import {
  interviewPageCount,
  interviewPageSlice,
  type InterviewCard,
} from '@/lib/alumni-interview';
import { InterviewPhoto, MoreLink } from './InterviewBits';

/** URL 쿼리 키 — 새로고침·공유·뒤로가기에서 보던 페이지가 유지되도록 주소에 싣는다 */
const QS_PAGE = 'page';

/**
 * 동문 인터뷰 목록 — 1페이지는 "최신 1편(큰 카드) + 지난 6편", 2페이지부터 8편씩.
 *
 * 클라이언트 컴포넌트인 이유는 페이지 전환뿐이다. 로케일 해석은 서버가 끝내
 * 문자열(InterviewCard)로 넘기므로 이 파일은 content/*.json 을 번들에 끌고 오지 않는다.
 *
 * ⚠️ useSearchParams 를 쓰지 않는다 — 정적 생성(SSG) 페이지에서 Suspense 경계를 요구해
 *    빌드가 깨지거나 CSR bailout 이 난다. FilterableBoardList 와 같은 방식으로
 *    이펙트 안에서 window.location.search 를 읽고 replaceState 로 되쓴다.
 *    트레이드오프도 같다: 첫 페인트는 언제나 1페이지이고 하이드레이션 직후 전환된다.
 */
export function InterviewListing({ items }: { items: InterviewCard[] }) {
  const t = useTranslations('alumni.interview');
  const [page, setPage] = useState(1);
  /** URL 을 상태에 반영하기 전에는 URL 쓰기를 막는 빗장(FilterableBoardList 와 같은 이유로 state) */
  const [urlApplied, setUrlApplied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const pageCount = interviewPageCount(items.length);
  const current = Math.min(Math.max(1, page), pageCount);
  const { featured, grid } = interviewPageSlice(items, current);

  // URL → 상태 (마운트 1회). 정수가 아니면 무시, 범위를 벗어나면 클램프.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get(QS_PAGE);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isInteger(parsed)) {
        const max = interviewPageCount(items.length);
        const next = Math.min(Math.max(1, parsed), max);
        if (next !== 1) setPage(next);
      }
    }
    setUrlApplied(true);
    // 마운트 1회만 — items 는 정적 생성 시점에 확정된 prop 이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 상태 → URL. push 가 아니라 replaceState — 페이지를 넘길 때마다 히스토리가 쌓이면
  // 뒤로가기가 목록 안에서 헛돈다. 1페이지는 키를 지워 목록의 기본 주소와 같게 둔다.
  useEffect(() => {
    if (!urlApplied) return;
    const url = new URL(window.location.href);
    if (current > 1) url.searchParams.set(QS_PAGE, String(current));
    else url.searchParams.delete(QS_PAGE);
    const next = `${url.pathname}${url.search}${url.hash}`;
    const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === here) return;
    window.history.replaceState(null, '', next);
  }, [urlApplied, current]);

  /** 페이지를 넘기면 목록 머리로 — 안 그러면 새 페이지의 중간부터 보인다.
   *  헤더(64/80) + sticky 탭 바(48) 아래에 첫 줄이 오도록 오프셋을 준다. */
  function goToPage(next: number) {
    setPage(next);
    const el = rootRef.current;
    if (!el) return;
    const headerH = window.matchMedia('(min-width: 1024px)').matches ? 80 : 64;
    const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - headerH - 60);
    const lenis = (window as unknown as { lenis?: { scrollTo: (t: number, o?: object) => void } })
      .lenis;
    if (lenis) lenis.scrollTo(top, { immediate: true });
    else window.scrollTo(0, top);
  }

  return (
    <div ref={rootRef}>
      {featured && <FeaturedCard card={featured} latestLabel={t('latest')} moreLabel={t('more')} readLabel={t('readInterview')} />}

      {/* 지난 인터뷰 — 2px 남색 룰 아래로 2열 그리드 */}
      <div
        className={`flex items-baseline justify-between border-b-2 border-yonsei-navy pb-3 md:pb-4 ${
          featured ? 'mt-14 md:mt-24' : ''
        }`}
      >
        <h2
          style={{ fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif' }}
          className="m-0 text-[20px] font-semibold tracking-[-0.01em] text-content md:text-[26px]"
        >
          {t('past')}
        </h2>
        <span className="text-[12px] text-content-faint md:text-[14px]">
          {t('count', { count: items.length })}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-16">
        {grid.map((card) => (
          <GridCard key={card.id} card={card} moreLabel={t('more')} readLabel={t('readInterview')} />
        ))}
      </div>

      <div className="md:mt-4">
        <BoardPagination page={current} pageCount={pageCount} onChange={goToPage} />
      </div>
    </div>
  );
}

/** 최신 1편 — 옅은 파란 면 위 2열(사진 560 + 글). 모바일은 세로로 쌓는다 */
function FeaturedCard({
  card,
  latestLabel,
  moreLabel,
  readLabel,
}: {
  card: InterviewCard;
  latestLabel: string;
  moreLabel: string;
  readLabel: string;
}) {
  return (
    <Link
      href={card.href}
      className="group mb-0 grid items-center gap-5 bg-surface-soft p-5 text-content md:grid-cols-[560px_minmax(0,1fr)] md:gap-14 md:p-11"
    >
      <InterviewPhoto
        src={card.image}
        priority
        iconSize={64}
        sizes="(min-width: 768px) 560px, 100vw"
        className="h-[207px] w-full md:h-[373px]"
      />
      <div className="flex flex-col items-start">
        <span className="text-[11px] font-bold tracking-[0.14em] text-yonsei-blue md:text-[12px]">
          {latestLabel}
          {card.month && ` · ${card.month}`}
        </span>
        <h3 className="mt-3 text-pretty text-[23px] font-bold leading-[1.4] tracking-[-0.02em] text-content transition-colors group-hover:text-yonsei-navy md:mt-[18px] md:text-[32px]">
          {card.title}
        </h3>
        {card.byline && (
          <p className="mt-3.5 text-[13px] font-semibold leading-[1.5] text-yonsei-navy md:mt-[22px] md:text-[16px]">
            {card.byline}
          </p>
        )}
        {card.excerpt && (
          <p className="mt-3 line-clamp-3 text-[14px] leading-[1.75] text-content md:mt-[18px] md:line-clamp-none md:text-[16px] md:leading-[1.85]">
            {card.excerpt}
          </p>
        )}
        <span className="mt-[18px] md:mt-[30px]">
          <MoreLink label={moreLabel} size="lg" />
        </span>
        <span className="sr-only">{readLabel}</span>
      </div>
    </Link>
  );
}

/** 지난 인터뷰 한 장 — PC 는 200px 정사각 사진 + 글, 모바일은 96px 썸네일 리스트 행 */
function GridCard({
  card,
  moreLabel,
  readLabel,
}: {
  card: InterviewCard;
  moreLabel: string;
  readLabel: string;
}) {
  return (
    <Link
      href={card.href}
      className="group grid grid-cols-[96px_minmax(0,1fr)] gap-4 border-b border-surface-border py-5 text-content md:grid-cols-[200px_minmax(0,1fr)] md:gap-7 md:py-9"
    >
      <InterviewPhoto
        src={card.image}
        iconSize={28}
        sizes="(min-width: 768px) 200px, 96px"
        className="h-24 w-24 md:h-[200px] md:w-[200px]"
      />
      <div className="flex flex-col items-start">
        {card.month && (
          <span className="text-[10px] font-bold tracking-[0.14em] text-yonsei-blue md:text-[11px]">
            {card.month}
          </span>
        )}
        <h3 className="mt-1.5 line-clamp-2 text-pretty text-[16px] font-bold leading-[1.45] tracking-[-0.02em] text-content transition-colors group-hover:text-yonsei-navy md:mt-2.5 md:line-clamp-none md:text-[20px]">
          {card.title}
        </h3>
        {card.byline && (
          <p className="mt-2 text-[12px] font-semibold leading-[1.4] text-yonsei-navy md:mt-3 md:text-[14px]">
            {card.byline}
          </p>
        )}
        {/* 모바일 카드는 요약·more 를 생략한다 — 96px 행 안에서 3줄이 넘으면 목록이
            리스트가 아니라 벽이 된다(디자인 확정본 Mobile.src.html). */}
        {card.excerpt && (
          /* display 를 다투지 않도록 노출 토글은 바깥 span, line-clamp 는 안쪽 p 가 갖는다
             (line-clamp 는 -webkit-box, hidden/block 도 display 라 한 요소에 겹치면 진다) */
          <div className="mt-2.5 hidden md:block">
            <p className="line-clamp-2 text-[14px] leading-[1.7] text-content-faint">
              {card.excerpt}
            </p>
          </div>
        )}
        <span className="mt-3.5 hidden md:block">
          <MoreLink label={moreLabel} />
        </span>
        <span className="sr-only">{readLabel}</span>
      </div>
    </Link>
  );
}
