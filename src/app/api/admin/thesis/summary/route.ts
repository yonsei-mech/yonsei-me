// 학생 제출 예비심사 공고 — 검토 대기 요약(대시보드 카드).
// GET → { count, nearest: { id, date, presenter } | null }
// 결정 로직·대기 판정은 lib/admin/thesis-review.ts 가 단일 출처다.

import { pendingSummary } from '@/lib/admin/thesis-review';
import { requireAdmin } from '@/lib/admin/posts-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) {
    denied.headers.set('Cache-Control', 'no-store');
    return denied;
  }
  try {
    return Response.json(await pendingSummary(), { headers: NO_STORE });
  } catch (err) {
    console.error('[thesis-review] 대기 요약 실패', err);
    return Response.json({ error: '검토 대기 목록을 읽지 못했습니다.' }, { status: 500, headers: NO_STORE });
  }
}
