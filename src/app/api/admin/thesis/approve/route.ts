// 학생 제출 예비심사 공고 — 승인(게시). 한 건·여러 건 공용.
// POST { ids: string[] (1~50) } → { results: { id, ok, already?, mailSent?, error? }[] }
// 행마다 조건부(published=false · 반려 아님)로 게시하고 학생에게 게시 안내 메일을 보낸다
// (lib/admin/thesis-review.ts 의 approveSubmissions — 결정 로직 단일 출처).

import { requireAdmin } from '@/lib/admin/posts-server';
import { APPROVE_MAX_IDS, approveSubmissions, reviewActor } from '@/lib/admin/thesis-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const bad = (error: string) => Response.json({ error }, { status: 400, headers: NO_STORE });

export async function POST(request: Request): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) {
    denied.headers.set('Cache-Control', 'no-store');
    return denied;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad('요청 형식이 올바르지 않습니다.');
  }
  const raw = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(raw) || raw.length === 0) return bad('게시할 공고를 선택하세요.');
  if (raw.length > APPROVE_MAX_IDS) return bad(`한 번에 ${APPROVE_MAX_IDS}건까지 게시할 수 있습니다.`);
  if (!raw.every((v) => typeof v === 'string' || typeof v === 'number')) return bad('글 번호 형식이 올바르지 않습니다.');
  // 같은 id 가 두 번 오면 한 번만 처리한다(두 번째는 already 로 답하게 되므로 결과를 헷갈리게 한다)
  const ids = Array.from(new Set(raw.map((v) => String(v))));

  const results = await approveSubmissions(ids, await reviewActor());
  return Response.json({ results }, { headers: NO_STORE });
}
