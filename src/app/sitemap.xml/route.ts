import { routing, type Locale } from '@/i18n/routing';
import { alternateLinks, hasEnglishVersion, localeUrl } from '@/lib/seo';
import { fetchNews, fetchAllBoardPosts, fetchAlumniEvents } from '@/lib/posts';
import { getClubsRuntime } from '@/lib/content-runtime';
import { getFacultyProfileNames } from '@/lib/faculty';
import {
  CONTENT_SECTIONS,
  NEWS_TABS,
  alumniEventHref,
  boardPostHref,
  newsArticleHref,
  newsTabHref,
  sectionTabHref,
  type ContentSection,
} from '@/lib/board-links';

// 검색엔진용 XML 사이트맵 → /sitemap.xml
// 커스텀 핸들러를 쓰는 이유: 게시판(DB) 페처가 죽어도 그룹만 생략하고 200 을
// 유지하기 위해서다(아래 safe 참고 — metadata route 는 throw 시 통째로 500).
// 한때 XSL 스타일시트(사람용 디자인) 처리 지시문을 붙였으나 GSC 가 사이트맵을
// 읽지 못하는 문제가 반복되어 제거 — 순수 XML 만 응답한다.
// 게시판(DB) 항목 포함 — ISR 로 주기 갱신.
//
// ── 이 파일의 SEO 설계 (GSC 실측 색인 127 / 미색인 2,520 을 고친 조치) ──
// 1) hreflang: `localePrefix: 'always'` 라 모든 문서가 /ko/… 와 /en/… 두 URL 로
//    존재하는데, 그 둘이 한 쌍이라는 신호가 어디에도 없어 서로를 중복으로
//    떨어뜨리고 있었다('사용자가 선택한 표준이 없는 중복 페이지' 23건).
//    → 각 <url> 안에 그 문서의 alternate 전체 집합을 넣는다.
// 2) 번역 없는 /en 제외: 이관 아카이브 뉴스·게시판 글은 영문판이 한국어 원문
//    그대로다. 이런 /en 문서 1,200여 개가 크롤 예산을 먹고 중복 판정을 받아
//    정작 실제 콘텐츠가 '발견됨-미색인'(2,451)으로 밀려 있었다.
//    → koOnly 로 판정되면 /en URL 자체를 싣지 않는다.
// 3) 게시판 URL 은 경로 기반(2026-08 개편): /news/<탭>, /news/<탭>/<id>,
//    /news/press/<slug>, /graduate/thesis/<id>, /alumni/network[/<id>].
//    2차 개편에서 콘텐츠 4개 섹션(소개·학부·대학원·연구)의 세부탭도 경로가 됐다:
//    /about/history … /research/social (CONTENT_SECTIONS 22개).
//    구 경로(/news, /about, /undergraduate, /graduate, /research, /news/post/<id>,
//    /alumni/post/<id>)는 전부 308 리다이렉트라 사이트맵에 싣지 않는다 —
//    리다이렉트 URL 은 색인 대상이 아니고 크롤 홉만 늘린다.
//    ⚠️ 경로를 여기서 문자열로 조립하지 마라. @/lib/board-links 헬퍼가 단일 출처이고,
//       손으로 적으면 다음 개편 때 사이트맵만 옛 경로를 광고하게 된다.
export const revalidate = 300;

/** XML 특수문자 이스케이프.
 *  따옴표까지 접는 이유: hreflang 링크가 URL 을 **속성값**으로 쓰기 때문이다
 *  (퍼센트 인코딩된 URL 엔 나올 일이 없지만, 방어선은 출력 지점에 둔다). */
function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * 사이트맵의 최소 단위는 **문서**지 URL 이 아니다.
 * 한 문서의 ko/en 엔트리는 반드시 같은 alternate 집합을 가져야 하므로(hreflang 상호
 * 참조 규약), 로케일별로 따로 만들지 않고 문서 하나에서 두 URL 을 함께 찍어 낸다.
 */
interface SitemapDoc {
  /** 로케일 접두사 없는 경로(선행 슬래시 없음, 홈은 '') — @/lib/seo 의 path 규약 */
  path: string;
  /** 영문 번역이 없어 /en 이 ko 의 중복인 문서. 이 값 하나가 곧 alternate 집합이다 */
  koOnly?: boolean;
  /** 문서 자신의 최종 수정일(W3C Datetime). 모르면 넣지 않는다 — 아래 w3cDate 참고 */
  lastmod?: string;
}

/**
 * 'YYYY-MM-DD'(또는 그 접두사를 가진 ISO 문자열) → W3C Datetime.
 * 형식이 아니거나 달력에 없는 날짜면 undefined 를 돌려 **lastmod 를 통째로 생략**한다.
 *
 * ⚠️ 거짓 lastmod 는 없는 것보다 나쁘다. 예전엔 모든 URL 이 "요청 시각"이라 사이트맵을
 *    가져올 때마다 전 URL 이 방금 바뀐 것처럼 보였고, 그렇게 어긋난 lastmod 를 만난
 *    크롤러는 그 사이트의 lastmod 를 이후로 신뢰하지 않는다.
 * ⚠️ Date.parse 만으로는 부족하다 — V8 은 '2020-06-31'을 7월 1일로 굴려서 받아 준다.
 *    ISO 로 되돌려 같은 문자열인지 확인해야 실제로 존재하는 날짜인지 걸러진다.
 */
function w3cDate(value: string | null | undefined): string | undefined {
  const day = String(value ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const t = Date.parse(day);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString().slice(0, 10) === day ? day : undefined;
}

export async function GET() {
  const docs: SitemapDoc[] = [];
  const add = (doc: SitemapDoc) => docs.push(doc);

  // 공개 정적 경로 (관리자 콘솔은 noindex 라 제외).
  // 정적 페이지는 사람이 번역한 UI 라 항상 양 로케일을 싣는다(koOnly 아님).
  // lastmod 는 넣지 않는다 — 배포 시각은 문서의 수정일이 아니다.
  const STATIC_PATHS = [
    '',
    'admission',
    // 콘텐츠 세부탭 22개 — 소개 6 · 학부 8 · 대학원 5 · 연구 3.
    // 섹션 루트(/about 등)는 기본 탭으로 308 이라 싣지 않는다(그래서 여기 없다).
    // CONTENT_SECTIONS 에서 뽑아 오므로 탭이 늘면 사이트맵도 따라온다.
    // (CONTENT_SECTIONS 가 as const 라 값이 서로 다른 리터럴 튜플이다 —
    //  유니온 튜플에는 .map 을 바로 못 부르므로 readonly string[] 으로 넓힌다)
    ...(Object.keys(CONTENT_SECTIONS) as ContentSection[]).flatMap((section) =>
      (CONTENT_SECTIONS[section] as readonly string[]).map((key) =>
        sectionTabHref(section, key).slice(1),
      ),
    ),
    // 소식 탭 8개 — 탭이 곧 경로다(/news 자체는 기본 탭으로 308, 그래서 빠졌다).
    // 게시판 6개 + 일정(달력) + 교수 초빙(안내 페이지).
    // (학위논문심사는 2026-09 에 대학원 섹션으로 옮겨 위 CONTENT_SECTIONS 쪽에서 나온다.)
    // NEWS_TABS 에서 뽑아 오므로 탭이 늘면 사이트맵도 따라온다.
    ...NEWS_TABS.map((t) => newsTabHref(t.seg).slice(1)),
    'alumni', // /alumni 는 '동문회 소개' 콘텐츠 페이지 자신이다(리다이렉트 아님)
    'alumni/network',
    'faculty',
    'contact',
    'sitemap',
    'privacy',
    'legal',
  ];
  for (const path of STATIC_PATHS) add({ path });

  // 동적 페이지 — 게시판 데이터 레이어(db/git)에서 열거.
  // 페처는 DB 문제 시 throw 하므로 그룹별로 방어한다: 하나가 죽어도 사이트맵
  // 전체가 500 이 되지 않고(과거 GSC '읽을 수 없음' 원인), 해당 그룹만 생략된다.
  const safe = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      console.error(`[sitemap] ${label} 열거 실패 — 해당 그룹만 생략:`, err);
    }
  };

  // ⚠️⚠️ 번역 유무 판정에는 **제목과 요약만** 쓴다. 본문은 절대 쓰지 말 것.
  //   목록 조회(posts.ts 의 LIST_COLUMNS)에는 본문이 실려 오지 않아 여기선 늘 빈
  //   문자열이다. 본문으로 판정하면 사이트맵은 "번역 없음", 상세 페이지의
  //   documentMetadata() 는 "번역 있음"으로 갈려 hreflang 상호 참조가 깨진다
  //   (ko 는 en 을 가리키는데 en 은 noindex 인 모순 신호).
  //   판정 필드는 상세 페이지 쪽과 **반드시 같아야** 한다.

  await safe('news', async () => {
    for (const n of await fetchNews()) {
      add({
        path: newsArticleHref(n.slug).slice(1),
        koOnly: !hasEnglishVersion(n.title, n.excerpt),
        lastmod: w3cDate(n.date),
      });
    }
  });

  await safe('board', async () => {
    // BoardPost 에는 excerpt 가 없다(통합 타입에 실리지 않는다) — 제목만으로 판정한다.
    // 실측상 이관 게시글은 title_en 이 null 이라 이것만으로 전부 걸러진다.
    for (const p of await fetchAllBoardPosts()) {
      add({
        // boardKey 가 소속 섹션까지 결정한다 — thesis 는 /graduate 아래로 간다.
        path: boardPostHref(p).slice(1),
        koOnly: !hasEnglishVersion(p.title),
        lastmod: w3cDate(p.date),
      });
    }
  });

  await safe('clubs', async () => {
    // 동아리 상세는 사람이 만든 이중 언어 페이지다 — 정적 페이지와 같이 양 로케일 유지.
    for (const club of await getClubsRuntime()) add({ path: `undergraduate/clubs/${club.slug}` });
  });

  await safe('faculty-profiles', async () => {
    // content/faculty-profiles/<한글이름>.json 의 파일명이 그대로 slug 다
    // (faculty/[slug]/page.tsx 의 generateStaticParams 와 같은 출처).
    // 한글 slug 의 퍼센트 인코딩은 localeUrl 이 처리한다.
    // 학술활동 표라 언어 중립이고 주변 UI 는 번역돼 있으므로 양 로케일 유지.
    for (const name of getFacultyProfileNames()) add({ path: `faculty/${name}` });
  });

  await safe('alumni-events', async () => {
    // AlumniEvent 는 Seminar 확장이라 excerpt 가 선택 필드다 — 있으면 함께 본다.
    for (const e of await fetchAlumniEvents()) {
      add({
        path: alumniEventHref(e.id).slice(1),
        koOnly: !hasEnglishVersion(e.title, e.excerpt),
        lastmod: w3cDate(e.date),
      });
    }
  });

  /** 문서 하나 → <url> 블록들(koOnly 면 ko 하나, 아니면 ko/en 둘). */
  const renderDoc = ({ path, koOnly = false, lastmod }: SitemapDoc): string => {
    // alternate 집합은 문서당 한 번만 계산한다 — 로케일별로 따로 만들면
    // 언젠가 두 엔트리의 목록이 갈리고, 그 순간 hreflang 신호 전체가 무시된다.
    // x-default 는 alternateLinks 안에서 항상 기본 로케일(ko)을 가리킨다.
    const alternates = alternateLinks(path, { koOnly }).map(
      ({ hreflang, href }) =>
        `    <xhtml:link rel="alternate" hreflang="${esc(hreflang)}" href="${esc(href)}"/>`,
    );
    const locales: readonly Locale[] = koOnly ? [routing.defaultLocale] : routing.locales;
    return locales
      .map((locale) =>
        [
          '  <url>',
          `    <loc>${esc(localeUrl(locale, path))}</loc>`,
          ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
          ...alternates,
          '  </url>',
        ].join('\n'),
      )
      .join('\n');
  };

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' +
      ' xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...docs.map(renderDoc),
    '</urlset>',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
