/**
 * 구 학과 사이트(me.yonsei.ac.kr) URL → 새 사이트 1홉 308 리졸버의 본체.
 *
 * 한국어(`/me/…`)와 영문 미러(`/me_en/…`)가 꼬리 구조를 공유하므로 표와 분기를 여기
 * 한 곳에 두고, 각 Route Handler 는 목적지 로케일만 달리 넘긴다.
 *
 * 분기 순서(위에서 실패하면 아래로 흘린다 — 지워진 글이 404 대신 제 게시판에 닿는다):
 *   ① mode=download → 첨부 R2 원본     ② articleNo → 글 상세
 *   ③ 게시판 .do → 새 목록             ④ 정적 .do → 손 매핑 경로     ⑤ 404
 */
import type { NextRequest } from 'next/server';
import gen from '@/lib/legacy-redirects.gen.json';
import {
  CONTENT_SECTIONS,
  boardPostHref,
  newsArticleHref,
  newsTabHref,
  sectionTabHref,
  type ContentSection,
} from '@/lib/board-links';
import { legacyNotFound, legacyRedirect } from '@/lib/legacy-resolver';
import { boardKeyOf, fetchNewsSlugById } from '@/lib/posts';

/** 홈. `'/'` 를 쓰면 `/ko/` 가 되어 Next 의 슬래시 정규화 308 이 한 홉 더 붙는다. */
const HOME = '';

interface LegacyMap {
  /** articleNo → [저장 계층 board 값, DB posts.id] */
  posts: Record<string, [string, number]>;
  /** "articleNo:attachNo" → 미러링된 R2 절대 URL */
  attachments: Record<string, string>;
}
// tools/legacy-redirects/build-map.mjs 산출물(게시물 3,544 · 첨부 2,217). 구 게시물
// 집합은 닫혀 있어 스냅숏으로 충분하다 — 요청마다 DB 를 켜지 않으려는 것이 요점.
const MAP = gen as unknown as LegacyMap;

/** 자기 소유 키만 읽는다 — 객체 리터럴 인덱싱은 'constructor' 같은 입력에도 값을 준다. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** 콘텐츠 섹션 탭 경로 — 탭 키를 컴파일 타임에 검사한다(탭이 개명되면 빌드가 깨진다). */
function tab<S extends ContentSection>(
  section: S,
  key: (typeof CONTENT_SECTIONS)[S][number],
): string {
  return sectionTabHref(section, key);
}

/** 공지 목록의 분류 탭 — FilterableBoardList 가 ?cat= 로 복원한다(list-data 의 categories 와 같은 값).
 *  기본 탭인 'undergrad' 는 싣지 않는다 — 목록이 하이드레이션 직후 주소에서 지우는 값이다. */
function noticeList(cat?: 'graduate' | 'external' | 'scholarship'): string {
  return cat ? `${newsTabHref('notices')}?cat=${cat}` : newsTabHref('notices');
}

/**
 * 구 게시판 .do → 새 목록 경로. 키는 `/me/` 를 뗀 소문자 꼬리.
 * 글 상세(mode=view)가 매핑에서 빠졌을 때의 폴백 목적지이기도 하다.
 */
const BOARD_LISTS: Record<string, string> = {
  'community/notice.do': noticeList(), // 학부 공지 — 공지 목록의 기본 탭
  'community/notice2.do': noticeList('graduate'),
  'community/notice3.do': noticeList('external'),
  'community/notice4.do': noticeList('scholarship'),
  'community/news.do': newsTabHref('press'),
  'community/seminar.do': newsTabHref('seminars'),
  'community/seminar_graduate1.do': newsTabHref('events'),
  'community/job.do': newsTabHref('career'),
  'community/degree_thesis_review.do': newsTabHref('thesis'),
  'community/information.do': newsTabHref('resources'),
};

/**
 * 구 정적 페이지 .do → 새 경로. 키는 `/me/` 를 뗀 소문자 꼬리, 값은 로케일 없는 경로.
 * 목적지는 전부 실재하는 라우트다(app 디렉터리·CONTENT_SECTIONS 대조 완료).
 * ⚠️ `graduation.do` 가 faculty/ 와 graduate/ 양쪽에 있다 — 꼬리 전체로만 찾는 이유다.
 */
const STATIC_PAGES: Record<string, string> = {
  '': HOME, // 미들웨어가 먼저 잡지만, matcher 가 바뀌어도 /me 가 살아 있게 둔다
  'index.do': HOME,
  'sitemap.do': '/sitemap', // 사용자용 HTML 사이트맵이 그대로 있다
  'legal_notice.do': '/legal',
  'privacy.do': '/privacy',
  'calender_main.do': newsTabHref('calendar'),

  // 학부 소개
  'faculty/intro.do': tab('about', 'history'),
  'faculty/history.do': tab('about', 'history'),
  'faculty/education.do': tab('undergraduate', 'goals'),
  'faculty/graduation.do': tab('undergraduate', 'requirements'),
  'faculty/professor_list.do': tab('about', 'faculty'),
  'faculty/schedule.do': newsTabHref('calendar'), // 학사일정
  'facultyjob/facultyjob.do': newsTabHref('recruit'), // 교수초빙안내(2026-09 소식 섹션으로 이관)

  // 대학원·연구
  'graduate/graduate_intro.do': tab('graduate', 'requirements'),
  'graduate/capacity.do': tab('research', 'capacity'),
  'graduate/graduation.do': tab('graduate', 'requirements'),
  'graduate/labs.do': tab('graduate', 'labs'),
  'graduate/research.do': tab('research', 'vision'),
  'research/lab2.do': tab('research', 'labs'),
  'research/social_problems.do': tab('research', 'social'),

  // 커뮤니티(게시판이 아닌 안내 페이지들)
  'community/map.do': tab('about', 'directions'),
  'community/circles.do': tab('undergraduate', 'clubs'),
  'community/scholar.do': tab('undergraduate', 'scholarship'),
  'community/scholar_yonsei.do': tab('undergraduate', 'scholarship'),
  'community/faculty.do': tab('about', 'staff'), // 교직원

  // BK21 — 구 사이트는 연도별 사업계획서까지 페이지를 나눴지만 새 사이트는 한 장이다
  'bk21/bk21_plan.do': tab('graduate', 'bk21'),
  'bk21/bk21_plan_2021.do': tab('graduate', 'bk21'),
  'bk21/bk21_plan_2022.do': tab('graduate', 'bk21'),
  'bk21/bk21_plan_2023.do': tab('graduate', 'bk21'),
  'bk21/bk21_plan_2024.do': tab('graduate', 'bk21'),
  'bk21/edu.do': tab('graduate', 'bk21'),
  'bk21/people.do': tab('graduate', 'bk21'),
  'bk21/progress.do': tab('graduate', 'bk21'),
  'bk21/vision.do': tab('graduate', 'bk21'),
  'bk21/vision_1.do': tab('graduate', 'bk21'),
  'bk21/files.do': newsTabHref('resources'), // BK21 자료실
};

/** 게시판 목록 조회 — 꼬리 전체가 먼저, 없으면 파일명. 구 사이트가 같은 게시판을
 *  다른 디렉터리에서도 링크했을 때를 위한 폴백이고, 게시판 파일명 10개는 유일하다. */
function boardListOf(tail: string): string | undefined {
  return own(BOARD_LISTS, tail) ?? own(BOARD_LISTS, tail.slice(tail.lastIndexOf('/') + 1));
}

/**
 * 매핑 항목 → 새 글 상세 경로.
 *
 * ⚠️ 스냅숏의 첫 값은 **저장 계층 board 값**이지 주소 세그먼트가 아니다.
 *    그대로 쓰면 공지 4종(1,745건)이 /news/noticesUndergrad/… 로 가 전부 404 다 —
 *    boardKeyOf(lib/posts) 가 공지 합류 규칙의 단일 출처다.
 * ⚠️ 뉴스(285건)만 주소가 id 가 아니라 slug 라 DB 에서 되찾는다. 못 찾으면
 *    undefined 를 돌려 호출부가 뉴스 목록으로 폴백한다(체인 없이 한 홉 그대로).
 */
async function postHref(entry: [string, number] | undefined): Promise<string | undefined> {
  if (!Array.isArray(entry)) return undefined;
  const [board, id] = entry;
  if (board === 'news') {
    const slug = await fetchNewsSlugById(String(id));
    return slug ? newsArticleHref(slug) : undefined;
  }
  const boardKey = boardKeyOf(board);
  return boardKey ? boardPostHref({ id: String(id), boardKey }) : undefined;
}

export async function resolveLegacyDo(
  req: NextRequest,
  path: string[] | undefined,
  locale: 'ko' | 'en',
): Promise<Response> {
  // 대소문자만 다른 링크(BK21_plan.do)가 흔해 소문자로 맞춰 찾는다 — 표의 키도 소문자다.
  const tail = (path ?? []).join('/').toLowerCase();
  const q = req.nextUrl.searchParams;
  const articleNo = q.get('articleNo');
  const attachNo = q.get('attachNo');
  // 나머지 쿼리(article.offset·srSearchVal…)와 해시는 구 CMS 의 목록 상태라 버린다.

  // ① 첨부 다운로드 — 미러링해 둔 R2 원본으로 직행(외부 절대 URL).
  if (q.get('mode') === 'download' && articleNo && attachNo) {
    const file = own(MAP.attachments, `${articleNo}:${attachNo}`);
    if (typeof file === 'string') return Response.redirect(file, 308);
    // 매핑 없는 첨부(미러링 실패분 등)는 그 글 상세 → 게시판 목록 순으로 흘려보낸다.
  }

  // ② 글 상세 — articleNo 는 구 사이트 전체에서 유일하므로 어느 .do 로 들어왔든 같은 글이다.
  if (articleNo) {
    const href = await postHref(own(MAP.posts, articleNo));
    if (href) return legacyRedirect(req, locale, href);
    // 지워진 글 → 아래로 흘려 그 게시판 목록에 내려놓는다(가장 가까운 살아 있는 페이지).
  }

  // ③ 게시판 목록 (mode=list·mode 없음·모르는 mode 전부)
  const list = boardListOf(tail);
  if (list) return legacyRedirect(req, locale, list);

  // ④ 정적 페이지
  const page = own(STATIC_PAGES, tail);
  if (page !== undefined) return legacyRedirect(req, locale, page);

  // ⑤ 매핑 없음 — 홈으로 떠넘기지 않는다. 지어낸 목적지는 없느니만 못하다.
  return legacyNotFound(locale);
}
