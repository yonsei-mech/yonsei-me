/**
 * 동문 인터뷰 — 공통 규칙 한 곳.
 *
 * 동문 소식·네트워크(`alumniEvents`, /alumni/network)는 2026-09 부터 "동문 인터뷰"
 * 에디토리얼 게시판이다. 목록 카드·상세 헤더·CMS 폼이 **같은 여섯 값**(이름·소속/직함·
 * 학번·제목·요약·대표사진)을 쓰므로, 그중 조립 규칙이 있는 것(바이라인·학번·연월)은
 * 여기 한 곳에서만 만든다. 화면마다 손으로 붙이면 "김연세 동문 · …" 의 가운뎃점 문법이
 * 세 곳에서 조금씩 갈린다.
 *
 * ⚠️ 이 파일은 **클라이언트 번들에도 들어간다**(목록이 클라이언트 컴포넌트다).
 *    그래서 `@/lib/content` 에서 값을 import 하지 않는다 — 그 모듈은 content/*.json 을
 *    통째로 싣는다. 타입만 가져오고, 로케일 선택은 아래 localized() 로 직접 한다.
 */
import type { Localized } from '@/lib/content';
import type { Locale } from '@/i18n/routing';

/** 인터뷰 헤더 6값 중 CMS 전용 입력분 — DB posts.interview (jsonb), null 이면 인터뷰가 아니다 */
export interface AlumniInterview {
  /** 동문 이름 */
  name: Localized;
  /** 소속·직함 (예: "○○자동차 로보틱스랩 책임연구원") */
  role: Localized;
  /** 입학년도 4자리 (예: "2005") — 표기는 ko '05학번' / en 'Entering class of 2005' */
  cohort: string;
  /** 마무리 한 줄 — 질문(예: "김연세 동문에게 ‘설계’란"). 답과 **둘 다** 있을 때만 그린다 */
  closingQ?: Localized;
  /** 마무리 한 줄 — 답 */
  closingA?: Localized;
}

/** pick() 과 같은 규칙이되 **빈 문자열도 한국어로 폴백**한다.
 *  (content.ts 의 pick 은 `??` 라 빈 en 문자열을 그대로 쓴다 — 바이라인이 통째로
 *   비어 버리는 것보다 한국어가 남는 편이 낫다.) */
function localized(value: Localized | undefined, locale: Locale): string {
  if (!value) return '';
  const ko = (value.ko ?? '').trim();
  if (locale === 'ko') return ko;
  const en = (value.en ?? '').trim();
  return en === '' ? ko : en;
}

/**
 * 학번 정규화 — 폼이 2자리('05')로 받아도 저장은 언제나 4자리다.
 * 00~29 는 2000년대, 그 밖은 1900년대로 읽는다(현 재학·졸업생 분포 기준).
 * 숫자가 아니거나 자릿수가 맞지 않으면 빈 문자열 = "학번 없음".
 */
export function normalizeCohort(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 4) return digits;
  if (digits.length === 2) {
    const n = Number(digits);
    return n <= 29 ? `20${digits}` : `19${digits}`;
  }
  return '';
}

/** 4자리 입학년도 → 두 자리 표기('2005' → '05'). 값이 없으면 빈 문자열 */
function cohortShort(cohort: string): string {
  const full = normalizeCohort(cohort);
  return full === '' ? '' : full.slice(2);
}

/**
 * 바이라인 한 줄 — 목록 카드·상세 헤더·이전/다음·관련 인터뷰가 모두 이것만 쓴다.
 *   ko  김연세 동문 · ○○자동차 로보틱스랩 책임연구원 · 기계공학과 05학번
 *   en  Kim Yonsei · Principal Researcher, ○○ Motors · Entering class of 2005
 * 비어 있는 조각은 통째로 뺀다(가운뎃점이 홀로 남지 않게).
 */
export function formatByline(
  interview: AlumniInterview | undefined,
  locale: Locale,
): string {
  if (!interview) return '';
  const name = localized(interview.name, locale);
  const role = localized(interview.role, locale);
  const full = normalizeCohort(interview.cohort);
  const parts: string[] = [];
  if (name) parts.push(locale === 'ko' ? `${name} 동문` : name);
  if (role) parts.push(role);
  if (full) {
    parts.push(locale === 'ko' ? `기계공학과 ${cohortShort(full)}학번` : `Entering class of ${full}`);
  }
  return parts.join(' · ');
}

/** 카드 킥커의 연월 — ko '2026. 09' / en 'Sep 2026'. 날짜가 깨졌으면 빈 문자열 */
export function formatInterviewMonth(date: string, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})/.exec((date ?? '').trim());
  if (!m) return '';
  const [, year, month] = m;
  if (locale === 'ko') return `${year}. ${month}`;
  const label = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
  );
  return `${label} ${year}`;
}

// ── 목록 페이지네이션 ──────────────────────────────────────────────────
// 1페이지는 최신 1편이 큰 카드로 빠지므로 그리드가 6편(=7편), 2페이지부터는 8편씩.
// 두 값이 갈리면 페이지 경계에서 글이 중복·누락되므로 상수를 한 곳에 둔다.

/** 1페이지 그리드 편수 (큰 카드 1편 제외) */
export const INTERVIEW_FIRST_PAGE_GRID = 6;
/** 2페이지 이후 그리드 편수 */
export const INTERVIEW_PAGE_GRID = 8;
/** 1페이지가 소비하는 총 편수 */
const FIRST_PAGE_TOTAL = 1 + INTERVIEW_FIRST_PAGE_GRID;

export function interviewPageCount(total: number): number {
  if (total <= FIRST_PAGE_TOTAL) return 1;
  return 1 + Math.ceil((total - FIRST_PAGE_TOTAL) / INTERVIEW_PAGE_GRID);
}

/** 해당 페이지에 실을 구간 — 1페이지만 featured(최신 1편)를 갖는다 */
export function interviewPageSlice<T>(items: T[], page: number): { featured: T | null; grid: T[] } {
  if (page <= 1) {
    return { featured: items[0] ?? null, grid: items.slice(1, FIRST_PAGE_TOTAL) };
  }
  const start = FIRST_PAGE_TOTAL + (page - 2) * INTERVIEW_PAGE_GRID;
  return { featured: null, grid: items.slice(start, start + INTERVIEW_PAGE_GRID) };
}

/** 목록·상세가 함께 쓰는 카드 뷰모델 — 로케일 해석이 끝난 문자열만 담는다
 *  (목록이 클라이언트 컴포넌트라 Localized 를 경계 너머로 넘기지 않는다). */
export interface InterviewCard {
  id: string;
  /** board-links 의 alumniEventHref 로 만든 경로 — 손으로 조립하지 않는다 */
  href: string;
  /** 킥커의 연월 ('2026. 09') */
  month: string;
  title: string;
  /** 인터뷰 정보가 없는 레거시 글은 빈 문자열 → 카드가 바이라인 줄을 생략한다 */
  byline: string;
  excerpt: string;
  image?: string;
}
