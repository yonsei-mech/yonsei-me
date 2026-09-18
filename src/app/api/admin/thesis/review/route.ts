// 학생 제출 예비심사 공고 — 검토 기록(내부 메모) 저장.
// POST { id, memo: string } → { ok: true } | 400/404/500 { error }
// review.memo 만 병합한다(상태·결정 기록은 그대로) — lib/admin/thesis-review.ts 의 saveReview.

import { requireAdmin } from '@/lib/admin/posts-server';
import { saveReview } from '@/lib/admin/thesis-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) {
    denied.headers.set('Cache-Control', 'no-store');
    return denied;
  }

  let body: { id?: unknown; memo?: unknown } | null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400, headers: NO_STORE });
  }
  const id = typeof body.id === 'number' ? String(body.id) : typeof body.id === 'string' ? body.id : '';
  const out = await saveReview(id, { memo: body.memo });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status, headers: NO_STORE });
  return Response.json({ ok: true }, { headers: NO_STORE });
}
