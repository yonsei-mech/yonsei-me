// 게시글 admin API — 목록(GET)·작성(POST). 백엔드 전환 Phase 3.
// 프로덕션은 Auth.js 세션(=GitHub allowlist) 필수, dev 는 CMS 개방 모드와 동일하게 우회.
// 쓰기 성공 시 revalidateTag('posts') → 사이트(ISR)가 재배포 없이 수 초 내 갱신된다.

import { revalidateTag } from 'next/cache';
import {
  adminDb,
  BODY_RAW_MIGRATION_HINT,
  endDateError,
  interviewError,
  isMissingBodyRawColumn,
  isValidBoard,
  payloadToRow,
  requireAdmin,
  rowToEditRecord,
  withoutBodyRaw,
  type AdminPostPayload,
} from '@/lib/admin/posts-server';

export const runtime = 'nodejs';

/** GET /api/admin/posts?board=news — 게시판 글 목록(편집 레코드 형태, 최신순) */
export async function GET(request: Request): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const board = new URL(request.url).searchParams.get('board') ?? '';
  if (!isValidBoard(board)) {
    return Response.json({ error: '알 수 없는 게시판입니다.' }, { status: 400 });
  }
  const { data, error } = await adminDb()
    .from('posts')
    .select('*, attachments(*)')
    .eq('board', board)
    // 고정 글을 맨 위로 — CMS 목록이 사이트 목록과 같은 순서로 보여야 관리자가
    // "고정한 결과"를 이 화면에서 그대로 확인할 수 있다(클라이언트 재정렬 불필요).
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: (data ?? []).map(rowToEditRecord) });
}

/** POST /api/admin/posts — 새 글 작성 */
export async function POST(request: Request): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const payload = (await request.json()) as AdminPostPayload;
  if (!isValidBoard(payload.board)) {
    return Response.json({ error: '알 수 없는 게시판입니다.' }, { status: 400 });
  }
  if (!payload.titleKo?.trim() || !payload.date?.trim()) {
    return Response.json({ error: '제목과 날짜는 필수입니다.' }, { status: 400 });
  }
  // 종료일(기간 일정) 검증 — 형식·순서(종료 ≥ 시작)
  const endErr = endDateError(payload);
  if (endErr) return Response.json({ error: endErr }, { status: 400 });
  // 동문 인터뷰 — 이름·소속·학번 필수 + 길이 상한(인터뷰 게시판이 아니면 통과)
  const ivErr = interviewError(payload);
  if (ivErr) return Response.json({ error: ivErr }, { status: 400 });

  const row = payloadToRow(payload);
  const insert = (r: object) => adminDb().from('posts').insert(r).select('id').single();
  let { data, error } = await insert(row);
  // body_raw 컬럼이 아직 없는 DB — 원문 모드가 아니면 그 칼럼만 빼고 예전처럼 저장한다
  if (error && isMissingBodyRawColumn(error)) {
    if (payload.bodyRaw === true) {
      return Response.json({ error: BODY_RAW_MIGRATION_HINT }, { status: 400 });
    }
    ({ data, error } = await insert(withoutBodyRaw(row)));
  }
  if (error || !data) {
    const msg = error?.code === '23505' ? '이미 같은 slug 의 글이 있습니다.' : (error?.message ?? '저장에 실패했습니다.');
    return Response.json({ error: msg }, { status: 400 });
  }

  const atts = (payload.attachments ?? []).filter((a) => a.href?.trim());
  if (atts.length > 0) {
    const r = await adminDb().from('attachments').insert(
      atts.map((a, i) => ({
        post_id: data.id,
        label_ko: a.labelKo?.trim() || null,
        label_en: a.labelEn?.trim() || null,
        url: a.href.trim(),
        sort: i,
        // 업로드로 붙인 첨부만 크기를 안다(URL 직접 입력은 null → 목록에서 크기 생략)
        size_bytes: a.size && a.size > 0 ? a.size : null,
      })),
    );
    if (r.error) return Response.json({ error: r.error.message }, { status: 500 });
  }

  revalidateTag('posts');
  return Response.json({ id: String(data.id) });
}
