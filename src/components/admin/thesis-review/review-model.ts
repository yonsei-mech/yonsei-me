// 학생 제출 공고 검토(승인·반려) 화면이 공유하는 순수 도우미 — 판정·표기·URL 상태.
//
// 계약(상태·사유·확인 항목)은 src/lib/thesis-submit/review.ts 가 단일 출처다. 여기는
// 그 계약을 **콘솔 화면에서 어떻게 보이고 거를지**만 다룬다.
// 디자인 원본: Claude Design "학위논문심사 승인 흐름"(https://claude.ai/artifact/5dYMrKEuMsmdhuue1xTrrf)
//
// 내부 운영 도구라 한국어 문자열을 직접 둔다.

import type { BoardKey } from '@/lib/admin/boards';
import type { EditSubmission } from '@/lib/admin/boards';
import type { ReviewStatus } from '@/lib/thesis-submit/review';

/**
 * 학생 제출 → 검토(승인·반려)를 거치는 게시판. 지금은 학위논문심사 하나다.
 * 게시판 키를 화면 곳곳에 흩뿌리지 않도록 판정은 이 목록 하나로만 한다.
 */
export const REVIEW_BOARDS: readonly BoardKey[] = ['thesis'];

export function isReviewBoard(key: BoardKey): boolean {
  return REVIEW_BOARDS.includes(key);
}

/** 사이드바·대시보드가 대기 건수를 붙일 콘솔 항목 id(entries.ts 의 entryId 형식) */
export const REVIEW_ENTRY_ID = 'board:thesis';

/** 목록 상단 필터 — '게시됨'은 approved(학생 제출분) + 제출 기록 없는 일반 글 */
export type ReviewFilter = 'all' | 'pending' | 'approved' | 'rejected';

export const REVIEW_FILTERS: { key: ReviewFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: '승인 대기' },
  { key: 'approved', label: '게시됨' },
  { key: 'rejected', label: '반려' },
];

function isFilter(v: string | null): v is ReviewFilter {
  return v === 'all' || v === 'pending' || v === 'approved' || v === 'rejected';
}

/** 검토 판정에 필요한 레코드 모양(ApiRecord 의 부분집합) */
export interface ReviewableRecord {
  published?: boolean;
  submission?: EditSubmission | null;
}

/**
 * 행의 검토 상태. 제출 기록이 있으면 그 판정(statusOf 결과)을 그대로 쓰고,
 * 없으면(관리자가 직접 쓴 글) published 로만 가른다 — false 면 사이트에 없는 글이다.
 */
export function reviewStatusOf(rec: ReviewableRecord): ReviewStatus {
  if (rec.submission) return rec.submission.status;
  return rec.published === false ? 'pending' : 'approved';
}

export function matchesFilter(rec: ReviewableRecord, filter: ReviewFilter): boolean {
  return filter === 'all' || reviewStatusOf(rec) === filter;
}

/** 검색 단서 — 운영자는 성명·이메일·접수번호로 제출을 기억한다 */
export function reviewSearchKeys(rec: ReviewableRecord): string[] {
  const s = rec.submission;
  if (!s) return [];
  return [s.email, s.receiptNo, s.notice?.presenter ?? '', s.notice?.title ?? ''];
}

// ── KST 표기 ─────────────────────────────────────────────────────────────

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** ISO → KST 구성요소. 파싱 실패면 null */
function kstParts(iso: string): { y: number; m: number; d: number; hh: string; mm: string } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const k = new Date(t + 9 * 60 * 60 * 1000);
  return {
    y: k.getUTCFullYear(),
    m: k.getUTCMonth() + 1,
    d: k.getUTCDate(),
    hh: String(k.getUTCHours()).padStart(2, '0'),
    mm: String(k.getUTCMinutes()).padStart(2, '0'),
  };
}

/** '2026-04-21 14:02' — 검토 화면의 접수 시각(정확한 값) */
export function kstStamp(iso: string): string {
  const p = kstParts(iso);
  if (!p) return iso;
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')} ${p.hh}:${p.mm}`;
}

/** '4월 21일 14:02' — 목록의 접수 시각(훑어보기용) */
export function kstShortStamp(iso: string): string {
  const p = kstParts(iso);
  return p ? `${p.m}월 ${p.d}일 ${p.hh}:${p.mm}` : '';
}

/** '4월 19일' — 목록의 반려일 */
export function kstDay(iso: string): string {
  const p = kstParts(iso);
  return p ? `${p.m}월 ${p.d}일` : '';
}

/** 'YYYY-MM-DD' → '4월 22일(수)' — 대시보드의 가장 가까운 심사일 */
export function dayWithWeekday(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wd = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${mo}월 ${d}일(${wd})`;
}

/** 오늘(KST) YYYY-MM-DD */
export function todayKstDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ── 본문의 포스터 ──────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * 제출 글의 본문은 자동 생성 포스터 이미지 한 장이다 — 첫 img 를 포스터로 본다.
 * (관리자가 '수정 후 게시'로 본문을 고쳤어도 첫 이미지가 곧 공고문이다.)
 */
export function posterOf(html: string): { src: string; alt: string } | null {
  const tag = /<img\b[^>]*>/i.exec(html ?? '')?.[0];
  if (!tag) return null;
  const attr = (name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  const src = attr('src');
  const value = src?.[1] ?? src?.[2] ?? '';
  if (!value) return null;
  const alt = attr('alt');
  return { src: decodeEntities(value), alt: decodeEntities(alt?.[1] ?? alt?.[2] ?? '') };
}

// ── URL 상태(?status=·?review=) ────────────────────────────────────────────
//
// 콘솔은 화면을 ?screen= 에 싣는다(AdminConsole). 검토 화면의 필터와 열린 제출도 같은
// 쿼리에 얹어 새로고침으로 복원한다. useSearchParams 는 이 프로젝트에서 정적 생성과
// 충돌해 쓰지 않는다(콘솔의 다른 쿼리 처리와 같은 이유·같은 패턴).
//
// 검토 화면을 열 때만 pushState 로 한 칸 쌓는다 — 뒤로가기가 "목록으로"가 되게.
// 콘솔이 화면 전환에 히스토리를 쌓지 않는 이유(미저장 이동 가드 우회)는 여기에 없다:
// 검토 화면의 입력(확인 항목·메모)은 바로 자동 저장된다.

export const STATUS_PARAM = 'status';
export const REVIEW_PARAM = 'review';

/** history.state 에 남기는 표식 — 이 항목을 검토 화면이 쌓았는지 */
const HISTORY_KEY = 'cmsReview';

export function readReviewUrl(): { status: ReviewFilter; review: string | null } {
  if (typeof window === 'undefined') return { status: 'all', review: null };
  const p = new URLSearchParams(window.location.search);
  const s = p.get(STATUS_PARAM);
  return { status: isFilter(s) ? s : 'all', review: p.get(REVIEW_PARAM) || null };
}

function urlWith(patch: { status?: ReviewFilter; review?: string | null }): string {
  const p = new URLSearchParams(window.location.search);
  if (patch.status !== undefined) {
    if (patch.status === 'all') p.delete(STATUS_PARAM);
    else p.set(STATUS_PARAM, patch.status);
  }
  if (patch.review !== undefined) {
    if (patch.review) p.set(REVIEW_PARAM, patch.review);
    else p.delete(REVIEW_PARAM);
  }
  const qs = p.toString();
  return window.location.pathname + (qs ? `?${qs}` : '');
}

/** 필터 바꾸기 — 히스토리를 쌓지 않는다 */
export function replaceReviewUrl(patch: { status?: ReviewFilter; review?: string | null }): void {
  // 표식은 지금 항목의 것을 이어 받는다(Next 가 자기 내부 상태는 따로 복사해 붙인다)
  const mark = (window.history.state as Record<string, unknown> | null)?.[HISTORY_KEY];
  window.history.replaceState(mark ? { [HISTORY_KEY]: mark } : null, '', urlWith(patch));
}

/** 검토 화면 열기 — 뒤로가기로 목록에 돌아오도록 한 칸 쌓는다 */
export function pushReviewUrl(id: string): void {
  window.history.pushState({ [HISTORY_KEY]: id }, '', urlWith({ review: id }));
}

/**
 * 검토 화면 닫기 — 우리가 쌓은 항목 위에 있으면 뒤로 가서 그 칸을 걷어 내고
 * (popstate 가 화면을 닫는다), 새로고침·딥링크로 바로 들어온 경우엔 쿼리만 지운다.
 */
export function leaveReviewUrl(): void {
  const mark = (window.history.state as Record<string, unknown> | null)?.[HISTORY_KEY];
  if (mark && new URLSearchParams(window.location.search).get(REVIEW_PARAM) === mark) {
    window.history.back();
    return;
  }
  replaceReviewUrl({ review: null });
}
