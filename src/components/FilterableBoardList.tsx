'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BoardList, type BoardRow } from '@/components/BoardList';
import {
  BoardFilterBar,
  emptyFilter,
  isFilterActive,
  matchesFilter,
  type BoardFilterState,
  type SearchScope,
} from '@/components/BoardFilterBar';
import { BoardPagination } from '@/components/BoardPagination';
import { BoardCategoryTabs } from '@/components/BoardCategoryTabs';
import { BOARD_PAGE_SIZE } from '@/lib/board-paging';
import type { Locale } from '@/i18n/routing';

/** 한 페이지에 싣는 글 수 — 행 높이 ~180px 기준으로 한 페이지가 대략 2,000px.
 *  이보다 길어지면 "스크롤로 끝까지 훑는" 목록이 되어 페이지 넘김의 의미가 사라진다.
 *  값은 lib/board-paging 이 단일 출처다 — 게시물 하단의 '같은 게시판 목록'이 이 목록의
 *  페이지 번호로 링크를 걸기 때문에, 두 곳이 각자 10을 들고 있으면 언젠가 갈라진다. */
const PAGE_SIZE = BOARD_PAGE_SIZE;

/** URL 쿼리 키 — 새로고침·공유·뒤로가기에서 보던 페이지가 유지되도록 상태를 주소에 싣는다.
 *  한 페이지에 이 컴포넌트가 하나만 놓인다는 전제(게시판 라우트 1:1)라 접두어를 두지 않는다. */
const QS_PAGE = 'page';
const QS_CAT = 'cat';
const QS_QUERY = 'q';
const QS_SCOPE = 'in';

/** '내용' 검색 대상은 화면에 없다 — 목록 행은 발췌를 그리지 않으므로 숨은 색인(searchText)을 본다
 *  (없으면 부제. 세미나 연사 줄처럼 실제로 보이는 부제는 그대로 검색된다). */
function matchesRow(row: BoardRow, f: BoardFilterState): boolean {
  return matchesFilter({ title: row.title, subtitle: row.searchText ?? row.subtitle }, f);
}

/** ?in= 값 검증 — 모르는 값이면 기본 범위(제목+내용)로 떨어뜨린다 */
function isSearchScope(value: string | null): value is SearchScope {
  return value === 'both' || value === 'title' || value === 'content';
}

/** 카테고리 필터 탭 정의 (예: 공지사항의 학부/대학원) */
export interface BoardCategory {
  /** BoardRow.category 와 매칭되는 식별자 */
  id: string;
  label: string;
}

/**
 * BoardList를 검색 바(범위 셀렉트 + 검색어, +선택적 카테고리 탭)로 감싼 래퍼.
 * 검색 범위는 제목/내용(발췌)/제목+내용 — BoardRow.title/subtitle 대상 클라이언트 필터.
 * props는 BoardList와 동일. 필터가 활성일 때만 결과 건수를 노출하고,
 * 필터 결과가 0건이면 검색 전용 empty 문구를 보여준다.
 *
 * categories 를 넘기면 상단에 언더라인 탭(전체 + 각 카테고리)이 뜨고,
 * BoardRow.category 로 목록을 걸러낸다(공지사항 학부/대학원 등).
 */
export function FilterableBoardList({
  items,
  locale,
  emptyLabel,
  categories,
  categoryLabel,
  showAll = true,
  compactDate = false,
}: {
  items: BoardRow[];
  locale: Locale;
  emptyLabel: string;
  categories?: BoardCategory[];
  /** 카테고리 탭 그룹의 스크린리더 이름. 기본값이 "공지 구분"이라 공지 외
   *  게시판(뉴스 등)에서는 그 게시판의 문구를 넘겨야 한다. */
  categoryLabel?: string;
  /** '전체' 탭 노출 여부. 끄면 첫 분류가 기본 탭이고 목록은 항상 한 분류만 보여준다. */
  showAll?: boolean;
  /** 발췌 없는 행의 제목–날짜 간격을 좁힌다(BoardList 로 전달, 공지사항 전용) */
  compactDate?: boolean;
}) {
  const t = useTranslations('news');
  // 기본 탭 — '전체'가 없으면 첫 분류. URL 에는 기본값이 아닐 때만 싣는다.
  const defaultCat = showAll || !categories?.length ? 'all' : categories[0].id;
  const [filter, setFilter] = useState(emptyFilter);
  const [cat, setCat] = useState(defaultCat);
  const [page, setPage] = useState(1);
  /** URL 쿼리를 상태에 반영하기 전에는 URL 쓰기를 막는 빗장.
   *  ref 가 아니라 state 인 이유: 마운트 커밋에서 동기화 이펙트가 "아직 기본값인" 상태로
   *  주소를 덮어써 ?page=3 을 지우는 일이 없어야 하는데, 그러려면 이펙트 선언 순서와
   *  무관하게 마운트 렌더의 클로저가 false 를 봐야 한다(ref 는 같은 커밋에서 이미 true). */
  const [urlApplied, setUrlApplied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // 'N' 배지 기준 시각 — 첫 렌더에 잡으면 정적 HTML 과 어긋나(하이드레이션 불일치) 마운트 후에 채운다
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  const searchActive = isFilterActive(filter);
  const catActive = !!categories && cat !== 'all';

  const filtered = useMemo(() => {
    let list = items;
    if (catActive) list = list.filter((item) => item.category === cat);
    if (searchActive) list = list.filter((item) => matchesRow(item, filter));
    return list;
  }, [items, catActive, cat, searchActive, filter]);

  /** 조건이 바뀌면 1페이지로 — 3페이지를 보던 중 검색하면 결과가 1페이지뿐일 수 있다.
   *  예전에는 useEffect(() => setPage(1), [cat, filter]) 였지만, 아래 URL 복원이
   *  cat/filter 를 세팅하는 순간 그 이펙트가 뒤따라 돌아 복원한 페이지를 1로 되돌린다.
   *  cat/filter 가 바뀌는 경로는 이 두 핸들러뿐이므로 리셋을 호출 지점으로 옮겨 경합을 없앴다
   *  (규칙 자체는 동일 — 탭 전환·검색 제출·검색 초기화 모두 여기를 지난다). */
  function changeCat(next: string) {
    setCat(next);
    setPage(1);
  }
  function changeFilter(next: BoardFilterState) {
    setFilter(next);
    setPage(1);
  }

  /** URL → 상태 (마운트 1회).
   *  useSearchParams 를 쓰지 않는다 — 정적 생성(SSG) 페이지에서 Suspense 경계를 요구해
   *  빌드가 깨지거나 CSR bailout 이 난다. 대신 이펙트 안에서 window.location.search 를 읽는다.
   *  트레이드오프: 서버 HTML 과 첫 렌더가 같아야 하므로 초기 state 로는 URL 을 못 읽는다 →
   *  첫 페인트는 항상 1페이지이고, 하이드레이션 직후 지정 페이지로 전환된다. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // cat — categories 에 실제로 있는 key 일 때만. 없는 값을 그대로 쓰면 목록이 통째로 빈다.
    const rawCat = params.get(QS_CAT);
    const nextCat = rawCat && categories?.some((c) => c.id === rawCat) ? rawCat : defaultCat;

    // q / in — 검색어가 없으면 범위만 복원해도 의미가 없으므로 필터 전체를 비활성으로 둔다.
    const rawQuery = params.get(QS_QUERY) ?? '';
    const rawScope = params.get(QS_SCOPE);
    const nextFilter: BoardFilterState =
      rawQuery.trim() === ''
        ? emptyFilter
        : { query: rawQuery, scope: isSearchScope(rawScope) ? rawScope : 'both' };

    // page — 정수가 아니면 무시, 1 미만은 1, 마지막 페이지 초과는 클램프.
    // 클램프 기준은 방금 정한 cat/q 를 적용한 목록이다(렌더의 current 계산과 같은 규칙).
    let nextPage = 1;
    const rawPage = params.get(QS_PAGE);
    if (rawPage !== null) {
      const parsed = Number(rawPage);
      if (Number.isInteger(parsed)) {
        let list = items;
        if (nextCat !== 'all') list = list.filter((item) => item.category === nextCat);
        if (isFilterActive(nextFilter)) {
          list = list.filter((item) => matchesRow(item, nextFilter));
        }
        const maxPage = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        nextPage = Math.min(Math.max(1, parsed), maxPage);
      }
    }

    if (nextCat !== defaultCat) setCat(nextCat);
    if (nextFilter !== emptyFilter) setFilter(nextFilter);
    if (nextPage !== 1) setPage(nextPage);
    setUrlApplied(true);
    // 마운트 1회만 — items/categories 는 정적 생성 시점에 확정된 props 다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const paged = useMemo(
    () => filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    [filtered, current],
  );

  /** 상태 → URL.
   *  push 가 아니라 replaceState — 페이지를 넘길 때마다 히스토리가 쌓이면 뒤로가기가
   *  목록 안에서 헛돈다. 라우터를 거치지 않으므로 리렌더도 없다.
   *  기본값(1페이지·전체 카테고리·빈 검색)은 키를 지워 주소를 깨끗하게 유지하고,
   *  해시(레거시 해시 구제 컴포넌트가 쓴다)와 우리 것이 아닌 쿼리 키는 건드리지 않는다.
   *  싣는 값은 page 가 아니라 화면에 실제로 그려진 current 다(클램프 결과와 주소가 어긋나지 않게). */
  useEffect(() => {
    if (!urlApplied) return;
    const url = new URL(window.location.href);
    const params = url.searchParams;

    if (current > 1) params.set(QS_PAGE, String(current));
    else params.delete(QS_PAGE);

    if (catActive && cat !== defaultCat) params.set(QS_CAT, cat);
    else params.delete(QS_CAT);

    if (searchActive) {
      params.set(QS_QUERY, filter.query);
      if (filter.scope !== 'both') params.set(QS_SCOPE, filter.scope);
      else params.delete(QS_SCOPE);
    } else {
      params.delete(QS_QUERY);
      params.delete(QS_SCOPE);
    }

    const next = `${url.pathname}${url.search}${url.hash}`;
    const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === here) return; // 같은 주소를 다시 쓰지 않는다
    window.history.replaceState(null, '', next);
  }, [urlApplied, current, catActive, cat, defaultCat, searchActive, filter]);

  /** 페이지를 넘기면 목록 머리로 되돌린다 — 안 그러면 새 페이지의 중간부터 보인다.
   *  헤더(64/80) + sticky 탭 바(48) 아래에 목록 첫 줄이 오도록 오프셋을 준다.
   *  Lenis 가 있으면 그쪽 위치까지 맞춰야 다음 휠에서 옛 위치로 튀지 않는다. */
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

  // 검색어가 적용돼 있으면 건수 노출(카테고리만으로는 목록이 곧 결과라 생략)
  const showCount = searchActive;

  return (
    <div ref={rootRef}>
      {categories && categories.length > 0 && (
        <BoardCategoryTabs
          active={cat}
          onChange={changeCat}
          ariaLabel={categoryLabel ?? t('filter.categoryLabel')}
          showAll={showAll}
          categories={categories.map((c) => ({
            ...c,
            count: items.filter((it) => it.category === c.id).length,
          }))}
        />
      )}
      <BoardFilterBar
        value={filter}
        onChange={changeFilter}
        resultCount={showCount ? filtered.length : null}
      />
      <BoardList
        items={paged}
        locale={locale}
        emptyLabel={searchActive ? t('search.empty') : emptyLabel}
        compactDate={compactDate}
        now={now}
      />
      {/* 빈 목록에서는 페이지 컨트롤이 의미가 없다 — 빈 상태 안내만 남긴다 */}
      {filtered.length > 0 && (
        <BoardPagination page={current} pageCount={pageCount} onChange={goToPage} />
      )}
    </div>
  );
}
