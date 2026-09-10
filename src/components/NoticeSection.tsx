'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { UnderlineTabs } from './UnderlineTabs';
import { boardPostHref } from '@/lib/board-links';
// 노출 행 수는 서버(page.tsx)와 공유한다 — 서버가 이 값 기준으로 미리 잘라 보내므로
// 두 곳이 어긋나면 화면에서 행이 모자란다. 순수 모듈인 이유는 그 파일 주석 참조.
import { NOTICE_ROWS } from '@/lib/notice-rows';
import { cn } from '@/lib/utils';

export type NoticeCategory = 'undergrad' | 'graduate' | 'external' | 'scholarship';

/** 로케일 해석이 끝난 학과 공지 한 건(부모가 날짜 포맷·제목 해석 완료) */
export interface NoticeSectionItem {
  id: string;
  /** 정렬·시맨틱용 원본 날짜 'YYYY-MM-DD' */
  date: string;
  /** 화면 표시용 포맷 날짜(formatDate 결과) */
  dateText: string;
  title: string;
  category: NoticeCategory;
}

export interface NoticeFilter {
  /** 'all' 또는 NoticeCategory */
  key: string;
  label: string;
}

// 카테고리 배지 톤 — 학과 공지 스캔성을 위한 색 구분(금색 배제 — 사용자 지시).
// 옅은 면 + 진한 글자의 각진 소형 pill. 학부는 브랜드 블루, 나머지는 절제된 액센트.
const BADGE: Record<NoticeCategory, string> = {
  undergrad: 'bg-yonsei-blue/10 text-yonsei-blue',
  graduate: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  external: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  scholarship: 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
};

/** 'N' 배지를 붙일 기간(일). 게시일로부터 이 안이면 새 글로 본다. */
const NEW_DAYS = 7;

/**
 * 공지 한 행 — 1행 제목(+N 배지), 2행 날짜 · 카테고리 배지.
 * 날짜를 제목 아래로 내린 이유: 제목이 읽는 순서의 첫 자리이고, 날짜·분류는 그 글을
 * 이미 고른 뒤에 확인하는 부가 정보다. 행 전체가 게시물 Link.
 */
function NoticeRow({
  item,
  label,
  isNew,
  newBadgeLabel,
  delayIndex,
}: {
  item: NoticeSectionItem;
  label: string;
  isNew: boolean;
  newBadgeLabel: string;
  delayIndex: number;
}) {
  return (
    <li
      className="anim-nav-item border-b border-surface-border"
      style={{ animationDelay: `${Math.min(delayIndex, 8) * 45}ms` }}
    >
      <Link
        // 이 섹션이 받는 네 소스(학부/대학원/외부기관/장학)는 모두 boardKey 가 'notices' 다
        // (posts.ts 의 BOARD_POST_META). 그래서 항목마다 키를 들고 다니지 않고 여기서 고정한다.
        href={boardPostHref({ id: item.id, boardKey: 'notices' })}
        className="group block px-0.5 py-[22px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-base font-semibold leading-snug text-content transition-colors group-hover:text-yonsei-blue sm:text-[19px]">
            {item.title}
          </span>
          {isNew && (
            <span className="inline-grid h-[18px] w-[18px] shrink-0 place-items-center bg-yonsei-navy/[0.12] text-[11px] font-bold leading-none text-yonsei-navy">
              N<span className="sr-only">{newBadgeLabel}</span>
            </span>
          )}
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <time dateTime={item.date} className="text-sm tabular-nums text-content-faint">
            {item.dateText}
          </time>
          <span aria-hidden="true" className="h-3 w-px bg-surface-border" />
          <span
            className={cn(
              'whitespace-nowrap px-[9px] py-[3px] text-xs font-bold',
              BADGE[item.category],
            )}
          >
            {label}
          </span>
        </div>
      </Link>
    </li>
  );
}

/**
 * '공지 & 일정' 통합 섹션 — 학과 공지 리스트(좌) + (children 으로 받은) 학과 일정 패널(우)을
 * 한 섹션에 나란히 담는다.
 *
 * 구성:
 *  - 섹션 헤더 행: 네이비 박스 제목 + 헤어라인. MORE 는 여기 두지 않는다 — 좌·우 두 열이
 *    각자 다른 게시판으로 가므로, 섹션 전체를 대표하는 '더보기'가 성립하지 않는다.
 *  - 2열 grid(모바일 1열, lg 부터 우열 고정폭). 좌열 = 소제목 + 필터 탭 + 공지 4건,
 *    우열 = children(HomeCalendarPanel).
 *  - 공지 리스트를 2열 8건에서 1열 4건으로 줄인 이유: 우열에 일정 패널이 들어오면서
 *    가로 폭이 절반이 됐고, 제목이 잘려 무슨 공지인지 못 읽히는 게 더 큰 손실이다.
 *
 * 데이터(4개 공지 배열: 학부/대학원/외부기관/장학)는 page.tsx(서버)가 최신순으로 합쳐
 * props 로 넘긴다. 탭 전환은 클라이언트에서 필터링. reduced-motion: 정적 노출.
 */
export function NoticeSection({
  items,
  counts: countsProp,
  heading,
  listLabel,
  moreLabel,
  moreHref,
  emptyLabel,
  newBadgeLabel,
  filters,
  children,
}: {
  items: NoticeSectionItem[];
  /**
   * 탭 배지에 찍을 건수(키='all' + 각 카테고리). 생략하면 items 로 센다.
   * ⚠️ items 를 서버가 미리 잘라 보내는 경우(홈) 반드시 넘겨야 한다 — 안 넘기면
   * 배지가 "전체 132" 대신 잘린 개수를 찍어 화면이 달라진다.
   */
  counts?: Record<string, number>;
  heading: string;
  /** 공지 리스트 소제목(예: "공지사항") — 일정 소제목과 같은 장치로 두 반쪽의 위계를 통일 */
  listLabel: string;
  moreLabel: string;
  moreHref: string;
  emptyLabel: string;
  /** 'N' 배지의 스크린리더 문구(예: "새 글") */
  newBadgeLabel: string;
  /** [전체, 학부, 대학원, 외부기관, 장학] — key='all' 포함 */
  filters: NoticeFilter[];
  /** 우열에 놓을 콘텐츠(학과 일정 패널 HomeCalendarPanel) */
  children?: ReactNode;
}) {
  const [active, setActive] = useState('all');

  // 'N' 배지 기준 시각 — 서버에서 계산하면 정적 생성 시점에 굳어 버리고, 첫 렌더에서
  // 계산하면 서버 HTML 과 달라져 하이드레이션 불일치가 난다. 마운트 후에 채운다.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  // 탭별 건수(배지) — 'all' 은 전체, 나머지는 카테고리별.
  // 서버가 건수를 넘겨줬으면 그것을 쓴다(서버가 items 를 미리 잘라 보내는 경우 items 로
  // 세면 잘린 개수가 찍힌다).
  const counts = useMemo(() => {
    if (countsProp) return countsProp;
    const c: Record<string, number> = { all: items.length };
    for (const f of filters) if (f.key !== 'all') c[f.key] = 0;
    for (const it of items) c[it.category] = (c[it.category] ?? 0) + 1;
    return c;
  }, [countsProp, items, filters]);

  // 카테고리 → 배지 라벨(필터 라벨 재사용)
  const catLabel = (cat: NoticeCategory) => filters.find((f) => f.key === cat)?.label ?? cat;

  // 최근 NEW_DAYS 일 이내면 새 글. now 가 아직 null(마운트 전)이면 배지를 달지 않아
  // 서버가 그린 HTML 과 첫 렌더가 정확히 일치한다. 날짜가 깨져 NaN 이어도 false 다.
  const isNew = (date: string) => now !== null && now - Date.parse(date) <= NEW_DAYS * 86400e3;

  // 필터 적용 후 상위 NOTICE_ROWS 건(1열).
  const visible = useMemo(
    () =>
      (active === 'all' ? items : items.filter((i) => i.category === active)).slice(0, NOTICE_ROWS),
    [items, active],
  );

  return (
    // 모바일 밀도 최적화: 상하 패딩 py-12, sm+ 은 기존 리듬(py-section-lg) 유지
    <section aria-labelledby="notices-heading" className="full-bleed bg-surface py-12 sm:py-section-lg">
      <div className="mx-auto w-full max-w-[1360px] px-6 sm:px-10 lg:px-16">
        {/* 섹션 헤더 — 네이비 박스 제목(다른 홈 섹션과 통일) + 헤어라인.
            MORE 는 좌·우 각 열의 소헤더로 내려갔다(가는 곳이 서로 다른 게시판이다). */}
        <div className="flex items-center gap-6">
          <h2
            id="notices-heading"
            className="inline-block bg-yonsei-navy px-4 py-2 text-base font-bold text-white sm:px-5 sm:py-2.5 sm:text-lg"
          >
            {heading}
          </h2>
          <span aria-hidden="true" className="h-px flex-1 bg-surface-border" />
        </div>

        {/* 2열 — 좌 공지 / 우 일정 패널. lg 미만에서는 세로로 쌓인다(우열 폭 고정값이
            좁은 화면에서는 성립하지 않는다). 우열 폭은 lg 416px → xl 512px. */}
        <div className="mt-[25px] grid grid-cols-1 gap-y-12 lg:grid-cols-[minmax(0,1fr)_416px] lg:gap-x-12 xl:grid-cols-[minmax(0,1fr)_512px] xl:gap-x-[72px]">
          {/* ── 좌: 공지 ── */}
          <div className="min-w-0">
            {/* 소헤더 — 사각 마커 + 라벨, 우측 끝에 더보기. 우열 일정 패널 소헤더와 같은
                장치로, 두 열이 한 섹션 안의 형제임을 드러낸다.
                라벨과 더보기를 잇던 헤어라인은 삭제(사용자 지시) — 그 선이 폭을 채우던
                역할을 justify-between 이 대신한다. */}
            <div className="flex items-center justify-between gap-5">
              <h3 className="flex shrink-0 items-center gap-2.5 text-base font-bold text-content">
                <span aria-hidden="true" className="h-2 w-2 bg-yonsei-navy" />
                {listLabel}
              </h3>
              <Link
                href={moreHref}
                className="group inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-content transition-colors hover:text-yonsei-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
              >
                {moreLabel}
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                  ›
                </span>
              </Link>
            </div>

            {/* 필터 탭 — 사이트 공통 UnderlineTabs(건수 배지). 좁은 화면은 가로 스크롤. */}
            <div className="mt-3 overflow-x-auto">
              <UnderlineTabs
                active={active}
                onChange={setActive}
                ariaLabel={heading}
                tabs={filters.map((f) => ({
                  id: f.key,
                  label: (
                    <>
                      <span className="whitespace-nowrap">{f.label}</span>
                      <span
                        className={cn(
                          'text-xs font-medium tabular-nums',
                          active === f.key ? 'text-yonsei-blue' : 'text-content-faint',
                        )}
                      >
                        {counts[f.key] ?? 0}
                      </span>
                    </>
                  ),
                }))}
              />
            </div>

            {visible.length > 0 ? (
              // key={active} 로 필터 전환 시 행 스태거 등장을 재트리거(교과목 편람과 동일 패턴).
              <ul key={active} className="mt-4">
                {visible.map((it, i) => (
                  <NoticeRow
                    key={it.id}
                    item={it}
                    label={catLabel(it.category)}
                    isNew={isNew(it.date)}
                    newBadgeLabel={newBadgeLabel}
                    delayIndex={i}
                  />
                ))}
              </ul>
            ) : (
              <div className="mt-10 flex flex-col items-center justify-center gap-4 py-16 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/img/eagle_empty.png" alt="" aria-hidden="true" className="h-16 w-auto opacity-70" />
                <p className="text-sm font-medium text-content-faint">{emptyLabel}</p>
              </div>
            )}
          </div>

          {/* ── 우: 학과 일정 패널(children = HomeCalendarPanel) ── */}
          {children && <div className="min-w-0">{children}</div>}
        </div>
      </div>
    </section>
  );
}
