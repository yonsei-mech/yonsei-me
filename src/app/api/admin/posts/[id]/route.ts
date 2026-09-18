// 게시글 admin API — 수정(PUT)·삭제(DELETE). 백엔드 전환 Phase 3.

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
  withoutBodyRaw,
  type AdminPostPayload,
} from '@/lib/admin/posts-server';
import { isUnpublishedSubmission, reviewActor, settleEditPublish } from '@/lib/admin/thesis-review';

export const runtime = 'nodejs';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** PUT /api/admin/posts/[id] — 글 수정(첨부는 전체 교체) */
export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const id = parseId(params.id);
  if (!id) return Response.json({ error: '잘못된 글 번호입니다.' }, { status: 400 });

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

  // 학생 제출 공고의 '게시하기'(= 디자인의 '수정 후 게시') — 저장 전 상태를 읽어 두었다가
  // published false→true 로 바뀌면 승인과 같은 후처리(status·결정 기록·학생 메일)를 한다.
  // 읽기 실패는 저장을 막지 않는다(후처리만 건너뛴다).
  const publishingSubmission =
    payload.board === 'thesis' && payload.published === true
      ? await isUnpublishedSubmission(id).catch((err) => {
          console.error('[thesis-review] 게시 전 상태 읽기 실패', id, err);
          return false;
        })
      : false;

  const row = payloadToRow(payload);
  const update = (r: object) => adminDb().from('posts').update(r).eq('id', id);
  let { error } = await update(row);
  // body_raw 컬럼이 아직 없는 DB — 원문 모드가 아니면 그 칼럼만 빼고 예전처럼 저장한다
  if (error && isMissingBodyRawColumn(error)) {
    if (payload.bodyRaw === true) {
      return Response.json({ error: BODY_RAW_MIGRATION_HINT }, { status: 400 });
    }
    ({ error } = await update(withoutBodyRaw(row)));
  }
  if (error) {
    const msg = error.code === '23505' ? '이미 같은 slug 의 글이 있습니다.' : error.message;
    return Response.json({ error: msg }, { status: 400 });
  }

  // 첨부 전체 교체 — 편집 폼이 항상 전체 목록을 보내므로 단순·확실
  const del = await adminDb().from('attachments').delete().eq('post_id', id);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500 });
  const atts = (payload.attachments ?? []).filter((a) => a.href?.trim());
  if (atts.length > 0) {
    const ins = await adminDb().from('attachments').insert(
      atts.map((a, i) => ({
        post_id: id,
        label_ko: a.labelKo?.trim() || null,
        label_en: a.labelEn?.trim() || null,
        url: a.href.trim(),
        sort: i,
        // 업로드로 붙인 첨부만 크기를 안다(URL 직접 입력은 null → 목록에서 크기 생략)
        size_bytes: a.size && a.size > 0 ? a.size : null,
      })),
    );
    if (ins.error) return Response.json({ error: ins.error.message }, { status: 500 });
  }

  revalidateTag('posts');
  if (publishingSubmission) {
    // 저장은 이미 끝났다 — 후처리 실패는 로그만 남기고 저장 성공으로 답한다
    const settled = await settleEditPublish(id, await reviewActor()).catch((err) => {
      console.error('[thesis-review] 게시 후처리 실패', id, err);
      return null;
    });
    if (settled) return Response.json({ ok: true, mailSent: settled.mailSent });
  }
  return Response.json({ ok: true });
}

/** DELETE /api/admin/posts/[id] — 글 삭제(첨부는 FK cascade) */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const id = parseId(params.id);
  if (!id) return Response.json({ error: '잘못된 글 번호입니다.' }, { status: 400 });

  const { error } = await adminDb().from('posts').delete().eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  revalidateTag('posts');
  return Response.json({ ok: true });
}
