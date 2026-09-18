// 교직원용 예비심사 공고 양식 — 새 글·수정(학생 제출 '수정 후 게시' 포함). 관리자 콘솔 전용.
//
// POST multipart/form-data (헤더 x-cms-thesis-post: 1)
//   data   = JSON { id?, notice, date?, time?, title? }
//   poster = PNG 2105×1488 (브라우저 posterPngBlob)
// → 200 { ok:true, id, mailSent?, already? } | 4xx·5xx { error, errors? }
// 계약: lib/thesis-submit/staff-post.ts · 로직: lib/admin/thesis-staff-post.ts(saveStaffPost).
//
// ⚠️ 다른 admin API 와 같이 dev(CMS 개방 모드)에서도 **프로덕션 DB·R2 에 쓴다**
//    (.env.local 에 프로덕션 키). 화면 검증은 요청을 가로채서 할 것.

import { requireAdmin } from '@/lib/admin/posts-server';
import { saveStaffPost } from '@/lib/admin/thesis-staff-post';
import { reviewActor } from '@/lib/admin/thesis-review';
import { NOTICE_POSTER_MAX_BYTES } from '@/lib/thesis-submit/config';
import { STAFF_POST_HEADER } from '@/lib/thesis-submit/staff-post';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const bad = (error: string) => Response.json({ ok: false, error }, { status: 400, headers: NO_STORE });

export async function POST(request: Request): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) {
    denied.headers.set('Cache-Control', 'no-store');
    return denied;
  }

  if (request.headers.get(STAFF_POST_HEADER) !== '1') return bad('요청 형식이 올바르지 않습니다.');
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
    return bad('요청 형식이 올바르지 않습니다.');
  }
  // 본문을 읽기 전에 크기부터 — 포스터 상한 + JSON·경계 문자열 여유
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > NOTICE_POSTER_MAX_BYTES + 256 * 1024) {
    return bad('포스터 이미지가 너무 큽니다.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad('요청 형식이 올바르지 않습니다.');
  }
  const data = form.get('data');
  const poster = form.get('poster');
  if (typeof data !== 'string' || data.length > 64 * 1024) return bad('요청 형식이 올바르지 않습니다.');

  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return bad('요청 형식이 올바르지 않습니다.');
  }
  // 크기 검사는 읽기 전에 — 규격 검사(isPosterPng)는 saveStaffPost 가 한다
  let bytes: Buffer | null = null;
  if (poster instanceof Blob && poster.size > 0 && poster.size <= NOTICE_POSTER_MAX_BYTES) {
    bytes = Buffer.from(await poster.arrayBuffer());
  }

  const out = await saveStaffPost(raw, bytes, await reviewActor());
  return Response.json(out.body, { status: out.status, headers: NO_STORE });
}
