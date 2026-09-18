/**
 * 교직원용 **예비심사 공고 양식**(관리자 콘솔) — 요청·응답 계약(클라이언트·서버 공용).
 *
 * 학생 공고 입력 화면과 같은 칸(notice.ts 의 ThesisNoticeInput)을 관리자가 채우면, 브라우저가
 * 같은 렌더러로 포스터 PNG 를 만들고 이 계약대로 보낸다. 서버 로직은
 * lib/admin/thesis-staff-post.ts, 라우트는 app/api/admin/thesis/post/route.ts.
 *
 *   POST STAFF_POST_API  (multipart/form-data, 헤더 STAFF_POST_HEADER: 1)
 *     data   = JSON StaffPostData
 *     poster = PNG 2105×1488 (posterPngBlob)
 *   → 200 StaffPostOk | 4xx·5xx StaffPostFail
 *
 * 저장 모양: posts.thesis_submission 에 입력 원본을 남긴다 — 새 글은
 * `{ source:'staff', email: 작성 관리자, submittedAt, notice, status:'approved', review:{decidedAt, decidedBy} }`
 * (계약: review.ts 의 ThesisSubmissionRecord). 그래야 나중에 같은 양식으로 다시 고칠 수 있다.
 *
 * ⚠️ 클라이언트 컴포넌트도 import 한다 — node 전용 모듈을 들이지 마라.
 */
import type { NoticeError, ThesisNoticeInput } from './notice';

export const STAFF_POST_API = '/api/admin/thesis/post';
/**
 * 교차 출처 위조 방지 헤더 — multipart 는 "단순 요청"이라 content-type 으로 못 거른다.
 * 다른 출처가 이 헤더를 붙이려면 CORS preflight 를 통과해야 하는데 이 라우트는 허용하지 않는다
 * (학생 제출 API 의 NOTICE_SUBMIT_HEADER 와 같은 이유).
 */
export const STAFF_POST_HEADER = 'x-cms-thesis-post';

/** 직접 수정한 게시 제목 상한 — 목록 한 줄에 들어가야 의미가 있다 */
export const STAFF_TITLE_MAX = 200;

export interface StaffPostData {
  /** 수정할 글(posts.id). 없으면 새 글 */
  id?: string;
  notice: ThesisNoticeInput;
  /** 게시일 YYYY-MM-DD — 없으면 새 글은 오늘(KST), 수정은 기존 값 유지 */
  date?: string;
  /** 예약 공개 시각 HH:MM(KST) — 없으면 게시일 0시 */
  time?: string;
  /** 직접 수정한 제목 — 없으면 postTitle(notice) = '[YYMMDD] 성명' */
  title?: string;
}

export interface StaffPostOk {
  ok: true;
  id: string;
  /** 학생 제출(승인 대기)을 이 양식으로 고쳐 게시했을 때만 — 학생 게시 안내 메일 결과 */
  mailSent?: boolean;
  /** 고치는 사이 다른 관리자가 먼저 게시했다(내용은 이번 것으로 저장됨, 메일은 그쪽이 보냈다) */
  already?: boolean;
}

export interface StaffPostFail {
  ok?: false;
  error: string;
  /** 칸 검사 오류(cleanNotice 뒤 기준 — 심사위원 번호는 빈 줄을 뺀 순서) */
  errors?: NoticeError[];
}

export type StaffPostResponse = StaffPostOk | StaffPostFail;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isIsoDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
}

export function isHm(t: string): boolean {
  return TIME_RE.test(t);
}

/**
 * posts.created_at 값 — 게시일 + 공개 시각(KST 오프셋을 문자열에 박는다).
 * posts-server 의 payloadToRow 와 같은 규칙: 시각이 없거나 형식이 틀리면 0시.
 */
export function publishCreatedAt(date: string, time?: string | null): string {
  const t = (time ?? '').trim();
  return `${date}T${TIME_RE.test(t) ? t : '00:00'}:00+09:00`;
}
