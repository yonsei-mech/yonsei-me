/**
 * 뉴스 섹션 목록 8종의 데이터 조립 — 구 `/news/page.tsx`(해시 탭 한 장)에서 탭별로 떼어 온 것.
 *
 * 경로 기반 개편으로 페이지가 8개로 갈렸지만 **행 매핑 규칙은 그대로**여야 한다
 * (정렬·분류·발췌·썸네일·검색 인덱스). 그래서 탭 하나 = 함수 하나로 옮겨 두고,
 * 각 page.tsx 는 자기 함수만 부른다. 게시물 링크만 하드코딩(`/news/post/<id>`)에서
 * `@/lib/board-links` 헬퍼로 바뀌었다.
 *
 * fetchBoardData() 를 여러 함수가 각자 부르는 것은 낭비가 아니다 — lib/posts 의
 * unstable_cache 가 전체 목록 1회 조회를 공유한다(페이지당 1회 요청).
 */
import { getTranslations } from 'next-intl/server';
import type { BoardRow } from '@/components/BoardList';
import type { BoardCategory } from '@/components/FilterableBoardList';
import type { ResourceItem } from '@/components/ResourceLibrary';
// 분류 상수는 클라이언트 컴포넌트가 아니라 순수 모듈에서 가져온다 — 이유는 그 파일 주석 참조.
import { CALENDAR_KIND, type CalendarEntry } from '@/lib/calendar-kinds';
import { pick, type BoardPost } from '@/lib/content';
import { fileFormat } from '@/lib/files';
import { parseDateLabelRange } from '@/lib/calendar';
import {
  boardPostHref,
  newsArticleHref,
  newsTabHref,
  sectionTabHref,
} from '@/lib/board-links';
import { fetchNews, fetchBoardData, fetchCalendarPosts, fetchResourceBodies } from '@/lib/posts';
import type { Locale } from '@/i18n/routing';

/**
 * 공지사항을 이루는 하위 게시판 4종.
 *
 * 병합 목록의 태그 배지(buildNoticeList)와 게시물 하단 목록의 헤더(buildBoardContext)가
 * **같은 라벨·같은 분류값**을 써야 해서 표를 한 곳에 둔다. category 는 목록 필터 탭 id
 * 이자 목록 URL 의 `?cat=` 값이기도 하다 — 셋이 갈리면 상세에서 넘어간 목록이 다른
 * 탭으로 열린다.
 */
const NOTICE_BOARDS = [
  { field: 'noticesUndergrad', tagKey: 'noticesUndergrad.title', category: 'undergrad' },
  { field: 'noticesGraduate', tagKey: 'noticesGraduate.title', category: 'graduate' },
  { field: 'noticesExternal', tagKey: 'noticesExternal.title', category: 'external' },
  { field: 'noticesScholarship', tagKey: 'noticesScholarship.title', category: 'scholarship' },
] as const;

/** 공지사항 — 4개 공지 게시판 병합 목록 + 상단 필터 탭 정의 */
export async function buildNoticeList(
  locale: Locale,
): Promise<{ items: BoardRow[]; categories: BoardCategory[] }> {
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  const tNews = await getTranslations({ locale, namespace: 'news' });
  const tBoard = await getTranslations({ locale, namespace: 'board' });
  const board = await fetchBoardData();

  // 공지사항: 학부/대학원/외부기관/장학생 4개 공지 게시판을 하나로 병합, 최신순
  // (클릭 → 상세). category 로 상단 필터 탭에서 구분한다.
  const noticeBoards = NOTICE_BOARDS.map(({ field, tagKey, category }) => ({
    rows: board[field],
    tagKey,
    category,
  }));
  const items: BoardRow[] = noticeBoards
    .flatMap(({ rows, tagKey, category }) =>
      rows.map((n) => ({
        id: n.id,
        date: n.date,
        title: pick(n.title, locale),
        // 공지사항만 본문 미리보기를 끈다(사용자 지시) — 발췌는 화면에 그리지 않고
        // 검색 색인으로만 남긴다. 다른 게시판은 그대로 subtitle 에 실어 미리보기를 낸다.
        searchText: n.excerpt ? pick(n.excerpt, locale) : undefined,
        tag: tBoard(tagKey),
        href: boardPostHref({ id: n.id, boardKey: 'notices' }),
        image: n.image,
        category,
        pinned: n.pinned,
      })),
    )
    // 4개 게시판을 병합하는 자리라 소스별 정렬이 흩어진다 — 고정 우선을 여기서 다시 세운다
    .sort(
      (a, b) =>
        (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || ((a.date ?? '') < (b.date ?? '') ? 1 : -1),
    );

  // 공지 필터 탭(학부/대학원/외부기관/장학생 선발 — '전체' 없음, 첫 탭이 기본)
  const categories: BoardCategory[] = [
    { id: 'undergrad', label: tMenu('undergraduate.label') },
    { id: 'graduate', label: tMenu('graduate.label') },
    { id: 'external', label: tNews('noticeCats.external') },
    { id: 'scholarship', label: tNews('noticeCats.scholarship') },
  ];

  return { items, categories };
}

/** 뉴스 기사(press 탭) — 다른 게시판과 동일한 에디토리얼 목록 + 일반/성과 필터 */
export async function buildPressList(
  locale: Locale,
): Promise<{ items: BoardRow[]; categories: BoardCategory[]; categoryLabel: string }> {
  const tNews = await getTranslations({ locale, namespace: 'news' });
  const news = await fetchNews();

  // 뉴스 — 다른 게시판과 동일한 에디토리얼 목록 (구 NewsBoard 카드/목록 토글 폐지)
  const items: BoardRow[] = news.map((item) => ({
    id: item.slug,
    date: item.date,
    title: pick(item.title, locale),
    subtitle: pick(item.excerpt, locale),
    tag: tNews(`categories.${item.category}`),
    href: newsArticleHref(item.slug),
    image: item.image || undefined,
    category: item.category,
    pinned: item.pinned,
  }));

  // 뉴스 필터 탭(전체/일반/성과)
  const categories: BoardCategory[] = [
    { id: 'general', label: tNews('categories.general') },
    { id: 'achievement', label: tNews('categories.achievement') },
  ];

  return { items, categories, categoryLabel: tNews('filter.newsCategoryLabel') };
}

/** 행사 */
export async function buildEventRows(locale: Locale): Promise<BoardRow[]> {
  const board = await fetchBoardData();
  return board.events.map((e) => ({
    id: e.id,
    date: e.date,
    title: pick(e.title, locale),
    subtitle: e.excerpt ? pick(e.excerpt, locale) : undefined,
    tag: pick(e.dateLabel, locale),
    href: boardPostHref({ id: e.id, boardKey: 'events' }),
    image: e.image,
    pinned: e.pinned,
  }));
}

/** 세미나 — 부제는 연사(host) 줄 */
export async function buildSeminarRows(locale: Locale): Promise<BoardRow[]> {
  const tBoard = await getTranslations({ locale, namespace: 'board' });
  const board = await fetchBoardData();
  return board.seminars.map((s) => ({
    id: s.id,
    date: s.date,
    title: pick(s.title, locale),
    subtitle: `${tBoard('seminars.hostLabel')}: ${pick(s.host, locale)}`,
    href: boardPostHref({ id: s.id, boardKey: 'seminars' }),
    image: s.image,
    pinned: s.pinned,
  }));
}

/** 학위논문심사 */
export async function buildThesisRows(locale: Locale): Promise<BoardRow[]> {
  const board = await fetchBoardData();
  return board.thesis.map((t) => ({
    id: t.id,
    date: t.date,
    title: pick(t.title, locale),
    subtitle: t.excerpt ? pick(t.excerpt, locale) : undefined,
    href: boardPostHref({ id: t.id, boardKey: 'thesis' }),
    image: t.image,
    pinned: t.pinned,
  }));
}

/** 취업 정보 */
export async function buildCareerRows(locale: Locale): Promise<BoardRow[]> {
  const board = await fetchBoardData();
  return board.career.map((c) => ({
    id: c.id,
    date: c.date,
    title: pick(c.title, locale),
    subtitle: c.excerpt ? pick(c.excerpt, locale) : undefined,
    href: boardPostHref({ id: c.id, boardKey: 'career' }),
    image: c.image,
    pinned: c.pinned,
  }));
}

/**
 * 일정(캘린더) — 게시판이 아니라 달력이라 상세가 없다.
 * 행사·세미나 게시판 + CMS '일정 (캘린더)' 게시판 3소스를 합친다.
 */
export async function buildCalendarEntries(locale: Locale): Promise<CalendarEntry[]> {
  const board = await fetchBoardData();
  // 캘린더('일정' 탭)는 행사·세미나 게시판 + CMS '일정 (캘린더)' 게시판을 함께 읽는다.
  // 앞의 둘은 글이 있는 일정이고, 뒤는 본문 없이 달력에만 올리는 학사일정·모집·시험이다
  // (홈 캘린더는 이미 셋을 합쳐 보여주는데 이 탭만 빠져 있었다).
  // 기간: 구조화된 endDate(DB end_date, CMS 시작–종료 피커)가 있으면 그것을 신뢰하고,
  // 없으면(구 데이터) 수동 dateLabel 을 파싱하던 기존 폴백을 유지한다.
  // 배열 리터럴의 spread 안에서 await 하지 않도록 미리 받아 둔다(홈 page.tsx 와 같은 관례).
  const calendarPosts = await fetchCalendarPosts();
  // pick 은 빈 문자열을 폴백하지 않는다(`??` 기반). 영문 제목을 비워 둔 글이 많아
  // 영어 화면 캘린더에 날짜만 있고 제목이 빈칸인 바가 뜨고 있었다 — 홈 page.tsx 의
  // orKo 와 같은 규칙으로 한국어에 떨어뜨린다.
  const orKo = (v: { ko: string; en: string }) => pick(v, locale).trim() || v.ko;
  return [
    ...board.events.map((e) => {
      const r = e.endDate
        ? { start: e.date, end: e.endDate }
        : parseDateLabelRange(e.date, pick(e.dateLabel, locale).trim() || e.dateLabel.ko);
      return {
        id: e.id,
        date: r.start,
        endDate: r.end,
        title: orKo(e.title),
        kind: 'event' as const,
        href: boardPostHref({ id: e.id, boardKey: 'events' }),
      };
    }),
    ...board.seminars.map((s) => ({
      id: s.id,
      // 세미나의 date 는 게시일이다 — 캘린더는 행사일에 놓고, 없는 구 글만 게시일 폴백
      date: s.eventDate ?? s.date,
      endDate: s.endDate ?? s.eventDate ?? s.date, // 종료일 없으면 하루
      title: orKo(s.title),
      kind: 'seminar' as const,
      href: boardPostHref({ id: s.id, boardKey: 'seminars' }),
    })),
    ...calendarPosts.map((ev) => ({
      id: `cal-${ev.id}`, // 게시판 글과 id 공간이 겹치므로(둘 다 DB 연번) 접두사로 분리
      date: ev.start,
      endDate: ev.end ?? ev.start, // 종료일 없으면 하루
      title: orKo(ev.title),
      kind: CALENDAR_KIND[ev.category] ?? 'academic',
      // 링크가 없으면 키 자체를 빼서 EventCalendar 가 비링크 바로 그리게 한다
      ...(ev.href ? { href: ev.href } : {}),
    })),
  ];
}

/** 자료실 — 전용 목록(ResourceLibrary) + 서버 생성 검색 인덱스 */
export async function buildResourceItems(locale: Locale): Promise<ResourceItem[]> {
  const board = await fetchBoardData();
  // 자료실: 다른 게시판과 달리 "받아 가는 파일"이라 전용 목록(ResourceLibrary)을 쓴다.
  // 검색 인덱스(contentText)는 여기 서버에서 만든다 — 본문 HTML 을 클라이언트로 통째로
  // 넘기지 않기 위해 태그를 지우고 공백을 접어 소문자 한 줄로 눌러 둔다
  // (본문은 관리자가 쓴 신뢰 소스라 정규식 제거로 충분하다).
  // 제목은 여기서 뺀다 — ResourceItem.title 로 이미 내려가고, 공용 검색 바의
  // 범위(제목/내용/제목+내용)를 가르려면 제목과 내용 인덱스가 분리돼 있어야 한다.
  // 본문은 게시판 목록이 아니라 자료실 전용 조회로 따로 받는다 — 목록 조회는 Vercel
  // Data Cache 2MB 한도 때문에 본문 컬럼을 싣지 않는다(lib/posts.ts 의 LIST_COLUMNS).
  const resourceBodies = await fetchResourceBodies();
  return board.resources.map((r) => {
    const title = pick(r.title, locale);
    const desc = r.excerpt ? pick(r.excerpt, locale) : undefined;
    const attachments = (r.attachments ?? []).map((a) => {
      const label = pick(a.label, locale);
      return { label, href: a.href, size: a.size, format: fileFormat(label, a.href) };
    });
    const body = resourceBodies[r.id];
    const plainBody = body ? pick(body, locale).replace(/<[^>]*>/g, ' ') : '';
    return {
      id: r.id,
      date: r.date,
      title,
      desc,
      category: r.category === 'form' || r.category === 'rule' ? r.category : undefined,
      href: boardPostHref({ id: r.id, boardKey: 'resources' }),
      pinned: r.pinned,
      attachments,
      contentText: [desc ?? '', plainBody, ...attachments.map((a) => a.label)]
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase(),
    };
  });
}

/**
 * 게시물 하단 이전/다음 글의 데이터 (PostBoardContext 용).
 *
 * 각 게시판의 목록 페이지가 쓰는 **바로 그 빌더**를 부른다 — 순서가 조금이라도 다르면
 * 이전/다음이 목록 화면에서 보이는 앞뒤 글과 어긋난다.
 *
 * ⚠️ 범위는 하위 게시판까지 내려간다. 공지사항 탭은 학부·대학원·외부기관·장학 4개
 *    게시판을 합친 화면이라, 학부 공지 글 다음에 대학원 공지가 이어지면 "이 게시판의
 *    앞뒤 글"이라는 약속이 깨진다(사용자 지시). 반면 뉴스 기사의 일반/성과는 한 게시판
 *    **안의** 분류라 나누지 않는다.
 *
 * 모르는 게시판이면 null — 호출자는 아무것도 그리지 않는다.
 */
export async function buildBoardContext(
  locale: Locale,
  boardKey: BoardPost['boardKey'],
  currentId: string,
): Promise<{ rows: BoardRow[]; boardName: string; listHref: string } | null> {
  const tMenu = await getTranslations({ locale, namespace: 'menu' });

  switch (boardKey) {
    case 'notices': {
      const tBoard = await getTranslations({ locale, namespace: 'board' });
      const { items } = await buildNoticeList(locale);
      const current = items.find((r) => r.id === currentId);
      const sub = NOTICE_BOARDS.find((b) => b.category === current?.category);
      // 하위 게시판을 못 찾으면(목록에 없는 글) 병합 목록 그대로 — 화면을 비우는 것보다 낫다
      if (!sub) {
        return {
          rows: items,
          boardName: tMenu('news.items.notices'),
          listHref: newsTabHref('notices'),
        };
      }
      return {
        rows: items.filter((r) => r.category === sub.category),
        // 목록의 태그 배지와 같은 라벨 — 헤더가 다른 말을 하면 같은 게시판인지 알 수 없다
        boardName: tBoard(sub.tagKey),
        listHref: `${newsTabHref('notices')}?cat=${sub.category}`,
      };
    }
    case 'seminars':
      return {
        rows: await buildSeminarRows(locale),
        boardName: tMenu('news.items.seminars'),
        listHref: newsTabHref('seminars'),
      };
    case 'events':
      return {
        rows: await buildEventRows(locale),
        boardName: tMenu('news.items.events'),
        listHref: newsTabHref('events'),
      };
    case 'thesis':
      // 학위논문심사만 대학원 메뉴 소속이라 목록이 /graduate 아래에 있다(2026-09 이관)
      return {
        rows: await buildThesisRows(locale),
        boardName: tMenu('graduate.items.thesis'),
        listHref: sectionTabHref('graduate', 'thesis'),
      };
    case 'career':
      return {
        rows: await buildCareerRows(locale),
        boardName: tMenu('news.items.career'),
        listHref: newsTabHref('career'),
      };
    case 'resources': {
      // 자료실은 전용 목록(ResourceLibrary)이라 행 타입이 BoardRow 가 아니다 — 순서는
      // 같은 빌더가 정한 그대로 두고, 하단 목록이 쓰는 최소 필드만 옮겨 담는다.
      const items = await buildResourceItems(locale);
      return {
        rows: items.map((r) => ({
          id: r.id,
          date: r.date,
          title: r.title,
          href: r.href,
          pinned: r.pinned,
        })),
        boardName: tMenu('news.items.resources'),
        listHref: newsTabHref('resources'),
      };
    }
    default:
      return null;
  }
}
