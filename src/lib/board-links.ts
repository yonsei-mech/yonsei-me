/**
 * 게시판 URL 단일 출처 — 목록·상세·레거시 해시의 경로 문법이 전부 여기서 나온다.
 *
 * 문법 (2026-08 개편):
 *   /news/<탭>                게시판 목록 (탭이 곧 경로)
 *                             단, 교수 초빙(recruit)은 게시판이 아닌 안내 탭이다
 *                             (2026-09 연구 섹션에서 이관 — 상세 라우트가 없다)
 *   /news/<탭>/<id>           게시판 글 상세 (소속 게시판이 URL 에 있다)
 *   /news/press/<slug>        뉴스 기사 상세 (탭 키 'news' 는 URL 에서 'press' —
 *                             /news/news/ 중첩을 피한다. 라벨·boardKey 는 그대로)
 *   /research/internships/<id> 인턴 모집 상세 (연구 메뉴 소속 게시판 — 목록은
 *                             /research#internships 콘텐츠 탭에 남는다)
 *   /alumni/news, /alumni/network  동문 게시판 목록 (/alumni 자체는 동문회 소개)
 *
 * ⚠️ 게시물 링크를 손으로 조립하지 마라 — boardPostHref/newsArticleHref 를 쓴다.
 *    경로가 또 바뀌면 여기 한 곳만 고치면 되도록 하기 위한 파일이다.
 * ⚠️ DB posts.board 값·boardKey('news' 없음, internships 포함 7종)는 이 파일과 무관한
 *    저장 계층 식별자다 — URL 을 바꾸려고 boardKey 를 개명하면 안 된다.
 */
import type { BoardPost } from '@/lib/content';

/** 뉴스 섹션 탭 — seg 가 URL 세그먼트, labelKey 가 menu.news.items.* 메시지 키 */
export const NEWS_TABS = [
  { seg: 'notices', labelKey: 'notices' },
  { seg: 'press', labelKey: 'news' }, // 뉴스 기사 — URL 만 press, 라벨은 기존 키
  { seg: 'events', labelKey: 'events' },
  { seg: 'seminars', labelKey: 'seminars' },
  { seg: 'career', labelKey: 'career' },
  { seg: 'resources', labelKey: 'resources' },
  { seg: 'recruit', labelKey: 'recruit' }, // 교수 초빙 — 게시판이 아닌 안내 탭
  { seg: 'thesis', labelKey: 'thesis' },
  { seg: 'calendar', labelKey: 'calendar' },
] as const;

export type NewsTabSeg = (typeof NEWS_TABS)[number]['seg'];

/** 뉴스 섹션 기본 탭 — /news 진입 시 이 목록으로 보낸다 */
export const DEFAULT_NEWS_TAB: NewsTabSeg = 'notices';

/** 로케일 접두사 없는 목록 경로 ('/news/notices' 형태) */
export function newsTabHref(seg: NewsTabSeg): string {
  return `/news/${seg}`;
}

/** 뉴스 기사 상세 (구 /news/[slug]) */
export function newsArticleHref(slug: string): string {
  return `/news/press/${slug}`;
}

/**
 * 게시판 글 상세 — boardKey 로 소속 섹션까지 결정한다.
 * internships 는 연구 메뉴 소속이라 /research 아래로 간다(상세 셸도 연구 컨텍스트).
 */
export function boardPostHref(post: Pick<BoardPost, 'id' | 'boardKey'>): string {
  if (post.boardKey === 'internships') return `/research/internships/${post.id}`;
  return `/news/${post.boardKey}/${post.id}`;
}

/** 동문 게시판 상세 */
export function alumniNewsHref(slug: string): string {
  return `/alumni/news/${slug}`;
}
export function alumniEventHref(id: string): string {
  return `/alumni/network/${id}`;
}

/**
 * 레거시 해시(#탭키) → 새 경로. 구 링크 `/news#seminars` 는 서버에 해시가 오지 않아
 * 308 로 /news/notices#seminars 에 떨어진다(브라우저가 해시를 보존) — 목록 페이지의
 * LegacyBoardHash 가 이 표로 최종 목적지로 replace 한다.
 */
export const LEGACY_NEWS_HASH: Record<string, string> = Object.fromEntries(
  NEWS_TABS.map(({ seg, labelKey }) => [labelKey, newsTabHref(seg)]),
);
export const LEGACY_ALUMNI_HASH: Record<string, string> = {
  association: '/alumni',
  news: '/alumni/news',
  network: '/alumni/network',
};

/**
 * 뉴스 기사 slug 예약어 — /news/<seg> 정적 폴더와 /news/[slug] 리다이렉트 리졸버가
 * 같은 자리를 쓰므로, slug 가 탭 세그먼트와 같으면 영구히 가려진다(정적 세그먼트 우선).
 * CMS slug 검증에서 이 목록을 거부해야 한다.
 */
export const RESERVED_NEWS_SLUGS: readonly string[] = [...NEWS_TABS.map((t) => t.seg), 'post'];

// ── 콘텐츠 섹션 탭 (2026-08 2차 개편: about·undergraduate·graduate·research 도 경로화) ──
// 탭 키 = URL 세그먼트 = menu.<섹션>.items.<키> 메시지 키 (menu.ts 와 동일한 키 체계).
// 첫 항목이 기본 탭 — 섹션 루트(/about 등)는 그리로 308 한다.
export const CONTENT_SECTIONS = {
  about: ['history', 'faculty', 'staff', 'directions', 'admission', 'careers'],
  undergraduate: [
    'goals',
    'requirements',
    'checker',
    'mileage',
    'courses',
    'curriculum',
    'clubs',
    'scholarship',
  ],
  graduate: ['requirements', 'courses', 'labs', 'bk21'],
  // 'recruit'(교수 초빙)는 2026-09 에 소식 섹션(/news/recruit)으로 옮겼다 — NEWS_TABS 참고
  research: ['vision', 'capacity', 'labs', 'internships', 'social'],
} as const;

export type ContentSection = keyof typeof CONTENT_SECTIONS;

/** 콘텐츠 섹션 탭의 목록 경로 ('/undergraduate/checker' 형태) */
export function sectionTabHref(section: ContentSection, key: string): string {
  return `/${section}/${key}`;
}

/** 섹션 루트가 308 하는 기본 탭 */
export function sectionDefaultHref(section: ContentSection): string {
  return sectionTabHref(section, CONTENT_SECTIONS[section][0]);
}

/**
 * 섹션에서 **빠져나간** 탭의 구 해시 → 새 위치.
 * CONTENT_SECTIONS 에 없으니 자동 파생이 안 되는데, 구 `/research#recruit` 북마크는
 * 남아 있다(섹션 루트 308 → 기본 탭 → LegacyBoardHash 가 여기서 최종 목적지를 찾는다).
 * 탭을 다른 섹션으로 옮길 때마다 한 줄씩 늘려 구 링크를 살려 둔다.
 */
const LEGACY_SECTION_HASH_EXTRA: Partial<Record<ContentSection, Record<string, string>>> = {
  research: { recruit: newsTabHref('recruit') }, // 2026-09 소식 섹션으로 이관
};

/** 레거시 해시(/undergraduate#checker 등) → 새 경로 — LegacyBoardHash 용 */
export function legacySectionHash(section: ContentSection): Record<string, string> {
  return {
    ...Object.fromEntries(
      CONTENT_SECTIONS[section].map((key) => [key, sectionTabHref(section, key)]),
    ),
    ...(LEGACY_SECTION_HASH_EXTRA[section] ?? {}),
  };
}
