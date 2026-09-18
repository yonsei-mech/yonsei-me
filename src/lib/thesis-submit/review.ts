/**
 * 학생 제출 예비심사 공고의 **검토(승인·반려) 계약** — 클라이언트·서버 공용.
 *
 * 디자인 원본: Claude Design "학위논문심사 승인 흐름"(https://claude.ai/artifact/5dYMrKEuMsmdhuue1xTrrf)
 * + "학위논문심사 메일 4종"(https://claude.ai/artifact/2T49XBSezNL9dpEeGh18ah).
 * 디자인 이후 바뀐 점: 공고문은 파일 업로드가 아니라 자동 생성 포스터, 예비심사 전용,
 * 지도교수·학번·전화는 받지 않는다, 금색 배지 금지(블루).
 *
 * 저장: 상태는 posts.thesis_submission(jsonb)의 status/review 에 둔다(스키마 변경 없음).
 * 사이트 노출 여부의 단일 출처는 여전히 posts.published — approved 일 때만 true.
 * status 가 없는 기존 제출분은 published 로 판정한다(false = pending, true = approved).
 *
 * ⚠️ 클라이언트 컴포넌트도 import 한다 — node 전용 모듈을 들이지 마라.
 */
import type { ThesisNoticeInput } from './notice';

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** 반려 사유 — 포스터가 자동 생성이라 디자인의 '양식 오류·파일 문제'는 뺐다 */
export const REJECT_REASONS = [
  '일시·장소 확인 필요',
  '심사위원 정보 오류',
  '논문 제목·성명 오류',
  '예비심사 공고 아님',
  '기타',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const REJECT_MESSAGE_MAX = 1000;
export const REVIEW_MEMO_MAX = 1000;

/** 관리자 검토 기록 — thesis_submission.review */
export interface ThesisReview {
  /** 내부 메모 — 학생에게 보이지 않는다(디자인의 '확인 항목' 체크리스트는 2026-09-18 뺐다) */
  memo?: string;
  /** 승인·반려 시각(ISO)과 처리한 관리자(CMS 로그인 이메일, dev 는 'dev') */
  decidedAt?: string;
  decidedBy?: string;
  rejectReason?: RejectReason;
  /** 학생에게 보낸 반려 메시지 */
  rejectMessage?: string;
  /** 결과 안내 메일 발송 성공 여부(승인·반려 공통) — 실패해도 결정은 유지된다 */
  mailSent?: boolean;
}

/** posts.thesis_submission 전체 모양(notice.ts 의 ThesisSubmissionMeta + 검토 상태) */
export interface ThesisSubmissionRecord {
  email: string;
  submittedAt: string;
  notice: ThesisNoticeInput;
  status?: ReviewStatus;
  review?: ThesisReview;
}

/** 저장된 기록 + published 로 현재 상태를 판정한다(status 없는 기존 제출분 호환) */
export function statusOf(rec: { status?: unknown } | null | undefined, published: boolean): ReviewStatus {
  const s = rec?.status;
  if (s === 'pending' || s === 'approved' || s === 'rejected') return s;
  return published ? 'approved' : 'pending';
}

/**
 * 접수번호 — 'TH-2026-1021-3812' (TH-연도-심사일 MMDD-게시물 id).
 * 게시물 id 로 유일하고, 학생·학과가 전화로 부르기 쉬운 모양(디자인의 TH-YYYY-MMDD-NN 형식).
 * id 를 모르면(dev 폴백 등) 'DEV'.
 */
export function receiptNo(notice: Pick<ThesisNoticeInput, 'date'>, postId: number | string | null): string {
  const [y = '0000', m = '00', d = '00'] = (notice.date || '').split('-');
  return `TH-${y}-${m}${d}-${postId ?? 'DEV'}`;
}
