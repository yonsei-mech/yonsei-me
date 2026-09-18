// 검토 API 호출 — 서버 라우트(src/app/api/admin/thesis/*)는 따로 있고, 여기는 계약대로
// 부르고 응답을 화면이 쓰기 좋은 모양으로 고르는 일만 한다.
//
//   POST /api/admin/thesis/approve  { ids }                 → { results: ApproveResult[] }
//   POST /api/admin/thesis/reject   { id, reason, message } → { ok: true, mailSent } | 4xx { error }
//   POST /api/admin/thesis/review   { id, memo }  → { ok: true }
//   POST /api/admin/thesis/post     multipart(data, poster) → { ok, id, mailSent?, already? } | { error, errors? }
//                                   (교직원 공고 양식 — 계약 lib/thesis-submit/staff-post.ts)

import type { NoticeError } from '@/lib/thesis-submit/notice';
import type { RejectReason } from '@/lib/thesis-submit/review';
import {
  STAFF_POST_API,
  STAFF_POST_HEADER,
  type StaffPostData,
  type StaffPostOk,
  type StaffPostResponse,
} from '@/lib/thesis-submit/staff-post';

export interface ApproveResult {
  id: string;
  ok: boolean;
  /** 이미 게시된 글이었다(다른 관리자가 먼저 처리 등) */
  already?: boolean;
  mailSent?: boolean;
  error?: string;
}

/** 요청 실패 — status 가 있으면 서버가 응답한 것(403 = 권한 없음) */
export class ReviewApiError extends Error {
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.status = status;
  }
}

async function postJson<T>(url: string, body: unknown, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive,
    });
  } catch {
    throw new ReviewApiError('서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.', null);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new ReviewApiError(data?.error || `요청이 실패했습니다 (HTTP ${res.status}).`, res.status);
  }
  return (data ?? {}) as T;
}

/**
 * 승인하고 게시 — 한 건이든 여러 건이든 같은 API.
 * 응답에 빠진 id 는 실패로 친다: 결과를 모르는 글을 "게시했다"고 말하면 안 된다.
 */
export async function approvePosts(ids: string[]): Promise<ApproveResult[]> {
  const data = await postJson<{ results?: ApproveResult[] }>('/api/admin/thesis/approve', { ids });
  const results = Array.isArray(data.results) ? data.results : [];
  return ids.map(
    (id) =>
      results.find((r) => String(r.id) === id) ?? {
        id,
        ok: false,
        error: '서버 응답에 이 글의 처리 결과가 없습니다.',
      },
  );
}

export async function rejectPost(
  id: string,
  reason: RejectReason,
  message: string,
): Promise<{ mailSent: boolean }> {
  const data = await postJson<{ ok?: boolean; mailSent?: boolean }>('/api/admin/thesis/reject', {
    id,
    reason,
    message,
  });
  return { mailSent: data.mailSent === true };
}

export interface ReviewPatch {
  memo?: string;
}

/** 내부 메모 자동 저장. keepalive 는 화면을 떠나는 순간의 마지막 저장용 */
export async function saveReview(id: string, patch: ReviewPatch, keepalive = false): Promise<void> {
  await postJson('/api/admin/thesis/review', { id, ...patch }, keepalive);
}

/** 공고 양식 저장 실패 — 칸 검사 오류가 있으면 errors(서버 기준: 빈 위원 줄을 뺀 번호) */
export class StaffPostError extends ReviewApiError {
  errors: NoticeError[] | null;
  constructor(message: string, status: number | null, errors: NoticeError[] | null) {
    super(message, status);
    this.errors = errors;
  }
}

/** 교직원 공고 양식 — 새 글·수정·학생 제출 '수정 후 게시'. poster = posterPngBlob 결과 */
export async function postStaffNotice(data: StaffPostData, poster: Blob): Promise<StaffPostOk> {
  const body = new FormData();
  body.append('data', JSON.stringify(data));
  body.append('poster', poster, 'poster.png');
  let res: Response;
  try {
    res = await fetch(STAFF_POST_API, { method: 'POST', headers: { [STAFF_POST_HEADER]: '1' }, body });
  } catch {
    throw new StaffPostError('서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.', null, null);
  }
  const json = (await res.json().catch(() => null)) as StaffPostResponse | null;
  if (!res.ok || !json || json.ok !== true) {
    const fail = json && json.ok !== true ? json : null;
    throw new StaffPostError(
      fail?.error || `요청이 실패했습니다 (HTTP ${res.status}).`,
      res.status,
      fail?.errors && fail.errors.length > 0 ? fail.errors : null,
    );
  }
  return json;
}
