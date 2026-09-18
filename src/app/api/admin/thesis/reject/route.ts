// 학생 제출 예비심사 공고 — 반려.
// POST { id, reason: RejectReason, message } → { ok: true, mailSent } | 400/404/409/500 { error }
// 검토 대기 건만 반려한다(published 는 false 유지) — 학생에게 반려 안내 메일(사유·메시지·
// 다시 제출하기 링크). 결정 로직은 lib/admin/thesis-review.ts 의 rejectSubmission.

import { requireAdmin } from '@/lib/admin/posts-server';
import { rejectSubmission, reviewActor } from '@/lib/admin/thesis-review';
import type { RejectReason } from '@/lib/thesis-submit/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) {
    denied.headers.set('Cache-Control', 'no-store');
    return denied;
  }

  let body: { id?: unknown; reason?: unknown; message?: unknown } | null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400, headers: NO_STORE });
  }
  const id = typeof body.id === 'number' ? String(body.id) : typeof body.id === 'string' ? body.id : '';
  const message = body.message === undefined ? '' : body.message;

  // 사유·메시지 검사는 rejectSubmission 이 한다(REJECT_REASONS·REJECT_MESSAGE_MAX)
  const out = await rejectSubmission(id, body.reason as RejectReason, message as string, await reviewActor());
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status, headers: NO_STORE });
  return Response.json({ ok: true, mailSent: out.mailSent }, { headers: NO_STORE });
}
