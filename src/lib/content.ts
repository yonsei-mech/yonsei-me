import facultyData from '@content/faculty.json';
import researchData from '@content/research.json';
import newsData from '@content/news.json';
import programsData from '@content/programs.json';
import boardData from '@content/board.json';
import historyData from '@content/history.json';
import staffData from '@content/staff.json';
import type { Locale } from '@/i18n/routing';

/** 한/영 문자열 쌍 → 현재 로케일 값으로 뽑아내는 헬퍼 */
export type Localized<T = string> = { ko: T; en: T };
export function pick<T>(value: Localized<T>, locale: Locale): T {
  return value[locale] ?? value.ko;
}

// ---- 타입 ----
/** 게시물 첨부파일 (있을 때만 상세 페이지에 표시) */
export interface Attachment {
  label: Localized;
  href: string;
  /** 바이트 단위 파일 크기 — 자료실 목록의 "PDF · 1.2MB" 표기용.
   *  CMS 업로드 시 File.size 로 기록되고, 구 데이터(레거시 사이트 링크)는
   *  tools/backfill-attachment-sizes.mjs 가 채운다. 없으면 크기를 생략한다. */
  size?: number;
}

export type FacultyField = 'energy' | 'robotics' | 'design' | 'bio';

export interface Faculty {
  id: string;
  name: Localized;
  title: Localized;
  field: FacultyField;
  specialty: Localized;
  email: string;
  lab: Localized;
  photo: string;
}

export interface Research {
  id: string;
  title: Localized;
  pi: Localized;
  summary: Localized;
  keywords: Localized<string[]>;
  accent: FacultyField;
  image: string;
}

export type NewsCategory = 'general' | 'achievement';

/** 구 분류(notice/seminar)를 '일반'으로 흡수한다 — 뉴스 분류를 일반/성과 2종으로
 *  줄이면서 기존 글이 목록에서 사라지지 않게 하는 읽기 시점 폴백. */
export function normalizeNewsCategory(v: string | null | undefined): NewsCategory {
  return v === 'achievement' ? 'achievement' : 'general';
}

export interface NewsItem {
  slug: string;
  category: NewsCategory;
  date: string;
  title: Localized;
  excerpt: Localized;
  body: Localized;
  image: string;
  attachments?: Attachment[];
  /** 목록 최상단 고정 — DB posts.pinned. git JSON 에는 보통 없다 */
  pinned?: boolean;
}

/** 행정 교직원 (학부 소개 > 교직원 탭) */
export interface StaffMember {
  role: Localized;
  name: Localized;
  phone: string;
  location: Localized;
  email: string;
}

// ---- 접근자 ----
export const faculty = facultyData as Faculty[];
export const staff = staffData as StaffMember[];
export const research = researchData as Research[];

/** 뉴스는 항상 최신순 정렬해서 반환. 분류는 읽는 자리에서 정규화한다 —
 *  JSON 스냅샷에는 아직 구 분류(notice/seminar)로 저장된 글이 남아 있다. */
export const news = (newsData as NewsItem[])
  .slice()
  .map((n) => ({ ...n, category: normalizeNewsCategory(n.category) }))
  .sort((a, b) => (a.date < b.date ? 1 : -1));

export function getNewsBySlug(slug: string): NewsItem | undefined {
  return news.find((n) => n.slug === slug);
}

export interface Program {
  id: string;
  title: Localized;
  desc: Localized;
  image: string;
  href: string;
}

export const programs = programsData as {
  undergraduate: Program[];
  graduate: Program[];
};

export interface Seminar {
  id: string;
  date: string;
  /** 종료일(YYYY-MM-DD, DB end_date) — 없으면 하루 일정 */
  endDate?: string;
  /** 행사일(YYYY-MM-DD, DB event_date) — 캘린더 배치용. 목록의 date 는 게시일이다. */
  eventDate?: string;
  host: Localized;
  title: Localized;
  body: Localized;
  /** 목록 썸네일(DB thumbnail_url) — 없으면 목록에서 흰 공백 */
  image?: string;
  /** 목록 발췌 — 없으면 목록에서 생략 */
  excerpt?: Localized;
  attachments?: Attachment[];
  /** 목록 최상단 고정 — DB posts.pinned. git JSON 에는 보통 없다 */
  pinned?: boolean;
}

export interface EventItem {
  id: string;
  date: string;
  /** 종료일(YYYY-MM-DD, DB end_date) — 없으면 하루 행사(구 데이터는 dateLabel 파싱 폴백) */
  endDate?: string;
  dateLabel: Localized;
  title: Localized;
  body: Localized;
  /** 목록 썸네일(DB thumbnail_url) — 없으면 목록에서 흰 공백 */
  image?: string;
  /** 목록 발췌 — 없으면 목록에서 생략 */
  excerpt?: Localized;
  attachments?: Attachment[];
  /** 목록 최상단 고정 — DB posts.pinned. git JSON 에는 보통 없다 */
  pinned?: boolean;
}

export interface Notice {
  id: string;
  date: string;
  title: Localized;
  body: Localized;
  /** 목록 썸네일(DB thumbnail_url) — 없으면 목록에서 흰 공백 */
  image?: string;
  /** 목록 발췌 — 없으면 목록에서 생략 */
  excerpt?: Localized;
  attachments?: Attachment[];
  /** 게시판 자체 분류(posts.category) — 자료실의 '행정 서식'/'규정·내규' 처럼
   *  BoardMeta.categories 를 가진 게시판만 채운다. 공지 4종의 '학부/대학원'은
   *  게시판 키로 갈리므로 이 필드를 쓰지 않는다. */
  category?: string;
  /** 목록 최상단 고정 — DB posts.pinned. git JSON 에는 보통 없다 */
  pinned?: boolean;
}

/** 동문 소식·네트워크 항목 — 세미나형 + "특정 날짜 행사" 플래그.
 *  isEvent=true 면 date 가 행사일로 간주되어 금주 캘린더 '동문'에 표시된다. */
export interface AlumniEvent extends Seminar {
  isEvent?: boolean;
}

export const board = boardData as {
  seminars: Seminar[];
  events: EventItem[];
  noticesUndergrad: Notice[];
  noticesGraduate: Notice[];
  noticesExternal: Notice[];
  noticesScholarship: Notice[];
  thesis: Notice[];
  career: Notice[];
  resources: Notice[];
  alumniEvents: AlumniEvent[];
};

/** 게시판 글(공지/세미나/행사/학위논문/취업)을 상세 페이지에서 단일 형태로 다루기 위한 통합 타입 */
export interface BoardPost {
  id: string;
  date: string;
  title: Localized;
  body: Localized;
  /** 소속 게시판 (뉴스 탭 key와 동일. thesis 만 대학원 메뉴 소속이다 — board-links 참고) */
  boardKey: 'notices' | 'seminars' | 'events' | 'thesis' | 'career' | 'resources';
  /** 부가 정보 한 줄 — 세미나 연사, 행사 기간, 공지 구분(학부/대학원) 등 */
  meta?: Localized;
  /** 편집자가 쓴 요약 — 상세 페이지의 meta description·og:description 이 우선 쓴다.
   *  없으면 본문에서 기계적으로 만든다(lib/excerpt.ts). 목록의 Notice.excerpt 와 같은 값. */
  excerpt?: Localized;
  /** 대표 이미지(썸네일 또는 본문 첫 이미지) — 공유 카드(og:image)에 쓴다 */
  image?: string;
  attachments?: Attachment[];
  /** 게시판 자체 분류(Notice.category 가 그대로 실려 온다) — 자료실의 'form'/'rule'.
   *  상세 화면의 '분류' 메타 줄이 이 값을 읽는다. */
  category?: string;
}

export function getAllBoardPosts(): BoardPost[] {
  return [
    ...board.noticesUndergrad.map((n): BoardPost => ({
      ...n,
      boardKey: 'notices',
      meta: { ko: '학부 공지', en: 'Undergraduate' },
    })),
    ...board.noticesGraduate.map((n): BoardPost => ({
      ...n,
      boardKey: 'notices',
      meta: { ko: '대학원 공지', en: 'Graduate' },
    })),
    ...board.noticesExternal.map((n): BoardPost => ({
      ...n,
      boardKey: 'notices',
      meta: { ko: '외부기관 공지', en: 'External' },
    })),
    ...board.noticesScholarship.map((n): BoardPost => ({
      ...n,
      boardKey: 'notices',
      meta: { ko: '장학생 선발공고', en: 'Scholarship' },
    })),
    ...board.seminars.map((s): BoardPost => ({
      id: s.id,
      date: s.date,
      title: s.title,
      body: s.body,
      boardKey: 'seminars',
      meta: s.host,
      attachments: s.attachments,
    })),
    ...board.events.map((e): BoardPost => ({
      id: e.id,
      date: e.date,
      title: e.title,
      body: e.body,
      boardKey: 'events',
      meta: e.dateLabel,
      attachments: e.attachments,
    })),
    ...board.thesis.map((t): BoardPost => ({ ...t, boardKey: 'thesis' })),
    ...board.career.map((c): BoardPost => ({ ...c, boardKey: 'career' })),
    ...board.resources.map((r): BoardPost => ({ ...r, boardKey: 'resources' })),
  ];
}

export function getBoardPost(id: string): BoardPost | undefined {
  return getAllBoardPosts().find((p) => p.id === id);
}

/** 동문 소식·네트워크 — board.json 의 alumniEvents(세미나형), 최신순.
 *  뉴스 상세(getAllBoardPosts)와 섞지 않고 동문 전용 라우트에서만 쓴다. */
export const alumniEvents = board.alumniEvents
  .slice()
  .sort((a, b) => (a.date < b.date ? 1 : -1));

export function getAlumniEventById(id: string): AlumniEvent | undefined {
  return alumniEvents.find((e) => e.id === id);
}

// ---- 금주 캘린더 통합 엔트리 ----
/** 캘린더 표시 카테고리. 'event'=행사 게시판, 'alumni'=동문 소식·네트워크(행사 표시분) */
export type CalendarCategory = 'event' | 'alumni';

export interface CalendarEntry {
  id: string;
  /** 행사일 (YYYY-MM-DD) */
  date: string;
  title: Localized;
  category: CalendarCategory;
}

/**
 * 금주 캘린더에 표시할 엔트리 — 행사 게시판 전체 + 동문 소식·네트워크 중
 * isEvent 로 표시된 항목(특정 날짜 행사)을 합친다. 각 항목의 date 를 행사일로 쓴다.
 * 링크 라우트: event → /news/post/[id], alumni → /alumni/post/[id].
 */
export function getCalendarEntries(): CalendarEntry[] {
  const events: CalendarEntry[] = board.events.map((e) => ({
    id: e.id,
    date: e.date,
    title: e.title,
    category: 'event',
  }));
  const alumni: CalendarEntry[] = board.alumniEvents
    .filter((a) => a.isEvent && a.date)
    .map((a) => ({ id: a.id, date: a.date, title: a.title, category: 'alumni' }));
  return [...events, ...alumni];
}

// 캘린더 전용 일정(개강·수강신청 변경·시험 기간처럼 게시글 없이 달력에만 올리는
// 학사일정)은 더 이상 이 파일에 없다. content/calendar.json + GitHub 커밋 경로로
// 두었더니 홈이 빌드 타임 인라인으로 읽어 재배포 전에는 반영되지 않았고, 같은
// 달력에 함께 뜨는 행사 게시판 일정(Supabase → revalidateTag)과 갱신 속도가
// 달라졌다. 지금은 게시판 글과 완전히 같은 경로를 탄다 —
// posts 테이블(board='calendar') → lib/posts.ts 의 fetchCalendarPosts().

// ---- 연혁 ----
/** 학과 연혁 이벤트. date는 "YYYY-MM" 형태 */
export interface HistoryEvent {
  date: string;
  title: Localized;
}

/** 연혁은 항상 최근→과거 내림차순으로 반환 */
export const history = (historyData as HistoryEvent[])
  .slice()
  .sort((a, b) => (a.date < b.date ? 1 : -1));
