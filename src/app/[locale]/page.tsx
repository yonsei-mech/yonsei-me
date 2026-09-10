import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HeroSlideshow } from '@/components/HeroSlideshow';
import { LabsSection } from '@/components/LabsSection';
import { NewsEventsSection } from '@/components/NewsEventsSection';
import { InstagramSection } from '@/components/InstagramSection';
import { GoalsSection } from '@/components/GoalsSection';
import { HomeCalendarPanel } from '@/components/HomeCalendarPanel';
// 분류 상수는 클라이언트 컴포넌트가 아니라 순수 모듈에서 가져온다 — 이유는 그 파일 주석 참조.
import { CALENDAR_KIND, type CalendarEntry } from '@/lib/calendar-kinds';
import { NoticeSection, type NoticeCategory } from '@/components/NoticeSection';
import { pick } from '@/lib/content';
import { parseDateLabelRange } from '@/lib/calendar';
import { formatDate, nowKst } from '@/lib/utils';
import {
  fetchNews,
  fetchNewsBySlug,
  fetchBoardData,
  fetchInstagramPosts,
  fetchCalendarPosts,
} from '@/lib/posts';
import instagramData from '@content/instagram.json';
import editorialTabs from '@content/editorial-tabs.json';
import {
  getEnabledPopupsRuntime,
  getHeroSlidesRuntime,
  getLabsDirectoryRuntime,
} from '@/lib/content-runtime';
import { popupImagePreloads } from '@/lib/popup-image';
import { WEBFONTS } from '../webfonts-manifest';
import {
  alumniEventHref,
  boardPostHref,
  newsArticleHref,
  newsTabHref,
  sectionTabHref,
} from '@/lib/board-links';
import { pageMetadata } from '@/lib/page-metadata';
import type { Metadata } from 'next';
import type { Locale } from '@/i18n/routing';

// DB 소스 전환(Phase 2): 홈의 뉴스&행사가 DB 를 읽는다 — ISR 안전망
export const revalidate = 300;

// 홈의 제목은 사이트명 그 자체다 — absolute 로 넘겨 레이아웃 템플릿(`%s | 사이트명`)을
// 건너뛴다(안 그러면 "연세대학교 기계공학부 | 연세대학교 기계공학부" 가 된다).
// og/twitter 까지 pageMetadata 가 통째로 만든다: metadata 병합이 top-level 얕은 병합이라
// 부분만 넣으면 레이아웃 값이 통째로 사라지거나 그대로 남는다(lib/page-metadata.ts 주석).
export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale as Locale;
  const tMeta = await getTranslations({ locale, namespace: 'meta' });
  return pageMetadata({
    locale,
    path: '',
    title: { absolute: tMeta('siteName') },
    description: tMeta('description'),
  });
}

export default async function HomePage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;
  const t = await getTranslations({ locale, namespace: 'home' });
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  const labs = await getLabsDirectoryRuntime();
  // 히어로 배경 — CMS '메인 이미지' 탭이 편집한다. 정적 import 였으나 런타임 조회로
  // 바꿨다: 정적 import 는 빌드 시점에 값이 굳어 CMS 저장이 재배포 전까지 안 보인다.
  const heroSlidesData = await getHeroSlidesRuntime();

  // 팝업 공지 사진 preload — 홈의 LCP 요소다.
  // 팝업의 노출 판정은 전부 브라우저(PopupNotice)가 한다. 그런데 그 판정은 하이드레이션
  // 뒤에야 끝나서, 사진 요청이 문서 로드보다 1초 넘게 늦고 HTML 만 봐서는 발견되지도
  // 않는다. 그래서 **요청만** HTML 로 앞당긴다 — 실제로 그릴지는 여전히 브라우저가 정한다.
  // ⚠️ 여기서 거르는 것은 "홈에는 뜰 수 없는 것"과 "이미 끝난 것" 둘뿐이다. 시각·화면폭·
  //    localStorage 판정은 정적 생성 시점에 할 수 없고, 잘못 거르면 preload 가 헛돈다.
  //    시작 전(start 미래)도 남긴다 — 페이지가 ISR(revalidate 300)이라 여기의 '지금'은
  //    이미 낡은 값이고, 몇 KB 를 아끼자고 곧 뜰 팝업을 놓치는 편이 손해다.
  // 기기 분기는 link 의 media 가 한다(서버는 화면 폭을 모른다).
  const popupNow = nowKst();
  const popupPreloads = (await getEnabledPopupsRuntime())
    .filter((p) => {
      const pages = p.pages?.length ? p.pages : ['home'];
      if (!pages.includes('home')) return false;
      return !(p.end && popupNow > p.end);
    })
    .flatMap((p) => popupImagePreloads(p));

  // 게시판 데이터 — 기존 매핑 코드 유지를 위해 모듈 상수와 같은 이름의 지역 변수로
  const news = await fetchNews();
  const board = await fetchBoardData();
  // 캘린더 전용 일정 — 아래 calRaw 는 배열 리터럴이라 spread 안에서 await 할 수 없다.
  const calendarPosts = await fetchCalendarPosts();
  // 인스타그램 그리드 — CMS '인스타그램' 게시판(최신 8개). 캡션은 로케일 해석(빈 en 은 ko 폴백).
  const instagramItems = (await fetchInstagramPosts()).slice(0, 8).map((p) => ({
    href: p.url,
    image: p.image,
    caption: pick(p.caption, locale).trim() || p.caption.ko,
  }));

  // 학과 목표(content/editorial-tabs.json 의 undergraduate-goals.items 재사용 —
  // 학부 페이지와 단일 출처 공유). 대형 타이포는 영문 제목, 부제는 ko 로케일만.
  type RawGoal = { title: { ko: string; en: string }; body: { ko: string; en: string } };
  const goalsRaw =
    (editorialTabs as Record<string, { items?: RawGoal[] }>)['undergraduate-goals']?.items ?? [];
  const goals = goalsRaw.map((g) => ({
    big: g.title.en,
    sub: locale === 'ko' ? g.title.ko : null,
    body: pick(g.body, locale),
  }));
  // 바로가기 4종 — menu.ts 와 동일 라우트, 라벨은 기존 menu.* 키 재사용.
  // desc(연결 탭 설명)만 home.goals.links.* 신규 키.
  const goalLinks = [
    {
      label: tMenu('about.items.faculty'),
      href: sectionTabHref('about', 'faculty'),
      desc: t('goals.links.faculty'),
    },
    {
      label: tMenu('research.items.labs'),
      href: sectionTabHref('research', 'labs'),
      desc: t('goals.links.labs'),
    },
    {
      label: tMenu('undergraduate.items.courses'),
      href: sectionTabHref('undergraduate', 'courses'),
      desc: t('goals.links.courses'),
    },
    {
      label: tMenu('about.items.careers'),
      href: sectionTabHref('about', 'careers'),
      desc: t('goals.links.careers'),
    },
  ];

  // 히어로 슬라이드(content/hero-slides.json) — 로케일 라벨 해석 후 클라이언트로 전달.
  // 라벨 문구는 research-gallery 와 동일 분야명 재사용(콘텐츠/코드 분리).
  // linkLabel = 분야 목록의 '연구 분야 바로가기' 화살표 링크 접근성 라벨(ICU 보간).
  // (레코드 형태는 content-runtime 의 HeroSlideRecord — imageMobile 이 없으면 가로 원본 폴백)
  const heroSlides = heroSlidesData.map((s) => ({
    field: s.field,
    label: pick(s.title, locale),
    image: s.image,
    ...(s.imageMobile ? { imageMobile: s.imageMobile } : {}),
    linkLabel: t('heroSlideshow.fieldLink', { field: pick(s.title, locale) }),
  }));

  // 뉴스 카드 발췌문 — excerpt 를 먼저 쓰고, 비어 있으면 본문을 평문으로 눌러 첫 문단만 쓴다.
  // ⚠️ body 의 형식은 소스에 따라 다르다(posts.ts 주석): db=정화된 HTML, git=마크다운.
  // 그래서 태그 제거와 마크다운 기호 제거를 둘 다 통과시킨다. 문단 경계는 블록 종료 태그
  // (</p>, <br>, </li>…)와 빈 줄 양쪽을 인정하고, 공백을 접은 뒤 220자에서 자른다
  // (카드는 4줄 말줄임이라 그 이상은 어차피 보이지 않는다).
  const toPlainSummary = (raw: string) => {
    const plain = raw
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '') // 스크립트·스타일 통째로 제거
      .replace(/<\/(p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, '\n\n') // 블록 경계 → 빈 줄
      .replace(/<[^>]+>/g, '') // 나머지 태그 제거
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // ![alt](src) 이미지 삭제
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [텍스트](url) → 텍스트
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p.length > 0) // 첫 '내용 있는' 문단
      ?.replace(/^\s*(?:[#>*-]+|\d+\.)\s*/gm, '') // 줄머리 기호 제거
      .replace(/\s+/g, ' ')
      .trim();
    if (!plain) return '';
    // 상한은 카드 3줄(한글 기준 150자 안팎)보다 넉넉히 — 실제로 자르는 건 line-clamp 다.
    return plain.length > 400 ? `${plain.slice(0, 400).trimEnd()}…` : plain;
  };

  // 본문 첫 이미지 — 홈 뉴스 카드는 thumbnail 이 아니라 **이것**을 먼저 쓴다.
  // ⚠️ 이유(실측): 같은 기사에 파일이 두 벌인데 thumbnail 쪽이 원본을 가로로 잘라 낸 별개
  // 파일이다. 예) 2026-07-28-post-6 — 본문 653x241(2.71, 연구실 로고+인물+그림이 다 든
  // 원본) / 썸네일 378x225(1.68, 왼쪽 로고·인물을 잘라 낸 조각). 잘린 쪽을 쓰면 CSS 로
  // 무엇을 하든 사라진 픽셀은 돌아오지 않는다.
  // body 형식은 소스마다 다르다(posts.ts): db=정화된 HTML, git=마크다운 → 둘 다 훑는다.
  const firstBodyImage = (raw: string) => {
    const html = raw.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (html?.[1]) return html[1];
    return raw.match(/!\[[^\]]*\]\(\s*([^)\s]+)/)?.[1];
  };

  // 뉴스 섹션 데이터: 뉴스(news.json)만 날짜 내림차순 상위 6건(사용자 지시로 행사 제외 —
  // 행사는 아래 '학사 일정' 섹션이 이미 담당한다). 리디자인 후 한 페이지에 대형 카드 한 장이라
  // 12건이면 화살표를 열두 번 눌러야 해서 6건으로 줄였다. 카드가 쓰는 단일 형태로 정규화한다.
  // ⚠️ 목록 조회(fetchNews)는 본문을 싣지 않는다 — 전체 게시물이 1,000건을 넘으면서
  //    캐시 한도(2MB)를 넘겨 매 요청이 DB 를 다시 읽었기 때문이다(lib/posts.ts 주석 참조).
  //    그런데 아래 대표 카드는 본문에서 요약 3줄과 첫 사진을 뽑아 쓴다. 그래서 먼저
  //    상위 6건을 고른 뒤 **그 6건만** 상세 조회로 본문을 채운다(캐시 항목은 글 하나 크기).
  const topNews = news
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 6);
  const topNewsWithBody = await Promise.all(
    topNews.map(async (n) => (await fetchNewsBySlug(n.slug)) ?? n),
  );

  const newsEventItems = topNewsWithBody
    .map((n) => {
      // 로케일 값이 비면 ko 로 폴백(pick 은 빈 문자열을 폴백하지 않는다 — en 이 비는 데이터가 흔하다).
      // excerpt/body 는 타입상 필수지만 git JSON 이 부분적으로 비어 있을 수 있어 방어적으로 읽는다.
      const excerpt = n.excerpt ? (pick(n.excerpt, locale).trim() || n.excerpt.ko).trim() : '';
      const body = n.body ? (pick(n.body, locale).trim() || n.body.ko).trim() : '';
      // 홈 대표 카드는 **본문**을 3줄까지 보여 준다(사용자 지시). excerpt 는 한두 문장짜리
      // 요약이라 3줄을 채우지 못해 카드가 휑했다 — 본문이 없을 때만 폴백으로 쓴다.
      // 자르는 일은 line-clamp-3 이 하고(…까지 붙여 준다), 아래 글자 수 상한은 3줄보다
      // 넉넉히 잡아 두어 '…'가 두 번 붙는 일이 없게 한다.
      const summary = (body ? toPlainSummary(body) : '') || excerpt;
      return {
        date: n.date,
        title: pick(n.title, locale).trim() || n.title.ko,
        // 좌측 대표 카드 = 본문 원본 우선, 없으면 thumbnail 폴백
        // (빈 문자열이면 플레이스홀더로 처리되도록 undefined)
        image: (body ? firstBodyImage(body) : undefined) || n.image || undefined,
        // 우측 목록 3행 = 게시물 대표사진 그대로(사용자 지시 — 작은 칸에는 썸네일이 맞다)
        thumb: n.image || undefined,
        // 뉴스 기사 상세는 /news/press/<slug> (탭 세그먼트와 자리를 나눠 쓰므로 헬퍼로만 만든다)
        href: newsArticleHref(n.slug),
        kind: 'news' as const,
        // 대표 카드 칩이 성과 글을 구분해 표시한다(뉴스 분류 — DB posts.category)
        category: n.category === 'achievement' ? ('achievement' as const) : ('general' as const),
        ...(summary ? { summary } : {}),
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 6);

  // 학과 일정 — 홈 일정 패널(HomeCalendarPanel)이 '달' 단위로 잘라 보여주므로, 여기서는
  // 정렬·건수 제한 없이 소스 넷을 CalendarEntry[] 로 합치기만 한다(예전에는 '예정→과거'로
  // 정렬해 12건을 잘랐는데, 그러면 화면에 지금이 몇 월인지가 남지 않았다).
  // 소스: 행사 게시판 · 세미나 게시판 · 동문 행사(isEvent) · CMS '일정 (캘린더)' 게시판.
  // 조립 문법은 뉴스 '일정' 탭(news/page.tsx)과 같게 두어 두 화면이 같은 것을 보게 한다.
  // 로케일 값이 비어 있으면 기본 로케일(ko)로 폴백 — pick 은 빈 문자열("")을 폴백하지 않으므로
  // 직접 처리해, 부분 번역 데이터에서 빈 제목 행이 생기는 것을 막는다.
  const orKo = (v: { ko: string; en: string }) => pick(v, locale).trim() || v.ko;
  // '오늘'은 KST 기준(서버가 UTC 여도 한국 날짜 경계를 쓴다). 패널이 처음 펼칠 달의 기준이며,
  // 서버에서 계산해 내려야 클라이언트 타임존과 어긋나는 하이드레이션 불일치가 없다.
  const calToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const initialMonth = calToday.slice(0, 7);
  const calendarEntries: CalendarEntry[] = [
    ...board.events.map((e) => {
      // 구조화된 endDate(DB end_date)가 있으면 그것을 신뢰하고, 없으면(구 데이터) 사람이
      // 손으로 적은 dateLabel 을 파싱한 범위로 폴백한다.
      const r = e.endDate
        ? { start: e.date, end: e.endDate }
        : parseDateLabelRange(e.date, orKo(e.dateLabel));
      return {
        id: e.id,
        date: r.start,
        endDate: r.end,
        title: orKo(e.title),
        kind: 'event' as const,
        // 게시판 글 경로는 boardPostHref 단일 출처 — 행사 게시판이라 boardKey 는 'events'
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
    // 동문 행사는 전용 kind 를 두지 않고 'event' 로 접는다 — 캘린더의 종류는 5종
    // (행사/세미나/학사일정/모집·신청/시험)으로 고정돼 있고, 학생에게 동문 행사도
    // 그냥 행사다. 별도 색·배지를 늘리면 범례만 길어지고 구분 실익이 없다.
    ...board.alumniEvents
      .filter((a) => a.isEvent && a.date)
      .map((a) => ({
        id: `al-${a.id}`, // 게시판 글과 id 공간이 겹치므로(둘 다 DB 연번) 접두사로 분리
        date: a.date,
        endDate: a.endDate ?? a.date,
        title: orKo(a.title),
        kind: 'event' as const,
        href: alumniEventHref(a.id),
      })),
    // 캘린더 전용 일정 — 개강·수강신청 변경·시험 기간처럼 게시글 없이 캘린더에만
    // 올려야 하는 학사일정. 저장처는 위 항목들과 같은 Supabase posts 테이블이고
    // (board='calendar', CMS '일정 (캘린더)' 게시판), CMS 저장이 revalidateTag('posts')
    // 를 부르므로 재배포 없이 수 초 내 반영된다. href 가 없으면 키 자체를 빼서
    // 패널이 링크 아닌 정적 행으로 그리게 한다(누를 곳이 없는데 눌리면 안 된다).
    ...calendarPosts.map((ev) => ({
      id: `cal-${ev.id}`,
      date: ev.start,
      endDate: ev.end ?? ev.start,
      title: orKo(ev.title),
      kind: CALENDAR_KIND[ev.category] ?? 'academic',
      ...(ev.href ? { href: ev.href } : {}),
    })),
  ];

  // 학과 공지 — 4개 공지 배열(학부/대학원/외부기관/장학)을 최신순으로 합쳐 카테고리 태그.
  // 행 링크는 게시물 상세(/news/post/[id]). 탭 필터·2열 배치는 NoticeSection 이 담당.
  const noticeSources: { key: NoticeCategory; list: typeof board.noticesUndergrad }[] = [
    { key: 'undergrad', list: board.noticesUndergrad },
    { key: 'graduate', list: board.noticesGraduate },
    { key: 'external', list: board.noticesExternal },
    { key: 'scholarship', list: board.noticesScholarship },
  ];
  const noticeItems = noticeSources
    .flatMap(({ key, list }) =>
      list.map((n) => ({
        id: n.id,
        date: n.date,
        dateText: formatDate(n.date, locale),
        title: orKo(n.title), // en 이 비면 ko 로 폴백(부분 번역 데이터에서 빈 제목 방지)
        category: key,
      })),
    )
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const noticeFilters = (['all', 'undergrad', 'graduate', 'external', 'scholarship'] as const).map(
    (k) => ({ key: k, label: t(`notices.filters.${k}`) }),
  );

  return (
    <>
      {/* 팝업 공지 사진 preload — React 가 <head> 로 끌어올린다(hoisting).
          href·imageSrcSet·imageSizes 는 카드가 그릴 <img> 와 **같은 값**이어야 한다
          (lib/popup-image.ts 가 두 곳의 단일 출처다) — 어긋나면 사진을 두 번 받는다. */}
      {popupPreloads.map((l) => (
        <link
          key={l.key}
          rel="preload"
          as="image"
          href={l.href}
          imageSrcSet={l.imageSrcSet}
          imageSizes={l.imageSizes}
          media={l.media}
          fetchPriority="high"
        />
      ))}

      {/* 히어로 제목 서체(지마켓산스 Bold, 홈 전용) 조각 preload — 팝업이 없는 방문에서는 이
          제목이 LCP 요소다. unicode-range 조각은 CSS 파싱·레이아웃 뒤에야 요청되므로 제목
          "연세대학교 기계공학부"가 쓰는 조각을 HTML 단계에서 먼저 띄운다. 목록은 /ko·/en
          데스크톱·모바일 CDP 실측(2026-09-10)에서 실제 요청된 조각 5개(라틴 123 + 한글
          116~119). 제목 문구나 구간표(tools/fonts/korean-slices.json)를 바꾸면 다시 재라 —
          빠진 조각은 늦게 올 뿐 글자가 빠지진 않는다. 다른 페이지엔 이 서체가 없어
          layout 이 아니라 여기 둔다. */}
      {['123', '119', '118', '117', '116'].map((id) => {
        const href = WEBFONTS.gmarket[id];
        return href ? (
          <link
            key={`gmarket-${id}`}
            rel="preload"
            href={href}
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        ) : null;
      })}

      {/* 1. 애니메이션 히어로 — 고정 배경 레이어(hicoda 식 "fixed background reveal").
          inset-0 으로 모바일 URL바 수축·확장에도 항상 뷰포트를 가득 채우고, 히어로
          그라디언트(위→아래)를 이 래퍼가 직접 갖는다. -z-10(음수)이라 in-flow 인
          푸터 아래로 깔려, 페이지 하단에서 푸터가 히어로를 덮는다. mt-[100svh] 콘텐츠
          래퍼가 스크롤에 따라 이 위로 슬라이드해 덮는다(순수 CSS 레이어링, JS 스크롤
          핸들러 없음). */}
      <div
        id="sec-hero"
        className="fixed inset-0 -z-10"
        style={{ backgroundImage: 'linear-gradient(#3f7ad2, #1d4a92)' }}
      >
        <HeroSlideshow
          slides={heroSlides}
          title={t('heroSlideshow.title')}
          navLabel={t('heroSlideshow.navLabel')}
          taglines={[
            t('heroSlideshow.tagline1'),
            t('heroSlideshow.tagline2'),
            t('heroSlideshow.tagline3'),
          ]}
          aboutLabel={t('heroSlideshow.about')}
        />
      </div>

      {/* 콘텐츠 래퍼 — 고정 히어로 위로 슬라이드되어 덮는 흰 판(연구실~인스타그램 네 섹션).
          mt(패딩 아님)여야 초기 화면에서 히어로가 보이고, 마진 영역은 히트테스트가 안 돼
          히어로의 재생/일시정지·인디케이터 버튼을 클릭할 수 있다. 상단은 각진 직각 엣지로
          히어로를 덮는다(그림자·둥근 모서리 없음 — 사용자 지시). ⚠️ transform/will-change/
          filter 금지 — containing block 이 생기면 내부의 position:fixed 가 뷰포트 대신 이
          래퍼 기준이 된다. */}
      <div className="relative z-10 mt-[100svh] bg-surface">
        {/* ⚠️ 다음 작업(예정): 이 콘텐츠 래퍼 맨 위에 공지사항·일정 섹션을 순서대로
            한 섹션씩 추가한다(사용자 지시). 현재 첫 섹션은 학과 목표. */}

        {/* 홈에서 제거된 섹션들(컴포넌트는 보존, 홈에서만 미사용):
            · 연구 분야 갤러리 "여섯 갈래의 연구" → 히어로 슬라이드쇼와 기능 통합(ResearchGallery.tsx)
            · 프로그램 탭 "기계공학부의 체계"(ProgramTabs.tsx)
            · 공지 쇼케이스(NoticeShowcase.tsx) */}

        {/* 1. 학과 목표 — hicoda 'goals' 식 회전 타이포(3.5초, 글자 하나씩 등장) +
            바로가기 버튼 4종. */}
        <div id="sec-goals" className="scroll-mt-16 lg:scroll-mt-20">
          <GoalsSection
            heading={t('goals.label')}
            linksLabel={t('goals.linksLabel')}
            goals={goals}
            links={goalLinks}
          />
        </div>

        {/* 2. 공지 & 일정 — 한 섹션에 좌 공지 리스트(탭 필터 + 4건) / 우 월간 일정 패널.
            예전에는 공지 8건(2열) 아래에 일정 캐러셀을 붙였는데, 세로로 길기만 하고
            "이번 달에 뭐가 있나"를 못 읽었다. 지금은 두 게시판을 좌우로 나란히 놓고
            각 열이 자기 MORE 를 갖는다(가는 곳이 서로 다른 게시판이다). */}
        <div id="sec-notices" className="scroll-mt-16 lg:scroll-mt-20">
          <NoticeSection
            items={noticeItems}
            heading={t('notices.title')}
            listLabel={t('notices.listLabel')}
            moreLabel={t('notices.more')}
            moreHref={newsTabHref('notices')}
            emptyLabel={t('notices.empty')}
            newBadgeLabel={t('notices.newBadge')}
            filters={noticeFilters}
          >
            <HomeCalendarPanel
              entries={calendarEntries}
              initialMonth={initialMonth}
              locale={locale}
              title={t('calendar.title')}
              moreLabel={t('calendar.viewMore')}
              moreHref={newsTabHref('calendar')}
              prevLabel={t('calendar.prevMonth')}
              nextLabel={t('calendar.nextMonth')}
              emptyLabel={t('calendar.emptyMonth')}
            />
          </NoticeSection>
        </div>

        {/* 3. 뉴스 — 뉴스(news.json) 카드만(행사 제외, 사용자 지시). */}
        <div id="sec-news" className="scroll-mt-16 lg:scroll-mt-20">
          <NewsEventsSection items={newsEventItems} />
        </div>

        {/* 4. 우리의 연구실 — 연구실 쇼케이스(네이비 라벨 + 마퀴 + 카드 캐러셀).
            사용자 지시로 뉴스 & 행사 아래(인스타그램 밴드 위)로 이동. */}
        <div id="sec-labs" className="scroll-mt-16 lg:scroll-mt-20">
          <LabsSection labs={labs} locale={locale} />
        </div>

        {/* 5. 인스타그램 (맨 아래) — 밴드 + 실제 게시물 그리드. 게시물은 CMS
            '인스타그램' 게시판(Supabase)에서 즉시 반영, 대표 핸들·URL 과 보조 계정
            (accounts)은 content/instagram.json 에서 관리. 게시물이 없으면 밴드만 렌더. */}
        <InstagramSection
          handle={instagramData.handle}
          url={instagramData.url}
          tagline={t('instagram.tagline')}
          followLabel={t('instagram.follow')}
          externalLabel={t('instagram.external')}
          openLabel={t('instagram.open')}
          accounts={instagramData.accounts}
          items={instagramItems}
        />
      </div>
    </>
  );
}
