// 게시글 admin API — 일괄 삭제·게시판 이동(POST). 백엔드 전환 Phase 3.
// CMS 목록의 다중선택 기능이 사용한다. Git 시절의 "파일 두 번 커밋" 곡예가
// SQL 업데이트 한 번으로 줄어드는 지점.

import { revalidateTag } from 'next/cache';
import { adminDb, isValidBoard, requireAdmin } from '@/lib/admin/posts-server';

export const runtime = 'nodejs';

interface BulkBody {
  action: 'delete' | 'move' | 'pin' | 'unpin';
  ids: (number | string)[];
  targetBoard?: string;
}

export async function POST(request: Request): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as BulkBody;
  const ids = (body.ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) {
    return Response.json({ error: '대상 글이 없습니다.' }, { status: 400 });
  }

  if (body.action === 'delete') {
    const { error } = await adminDb().from('posts').delete().in('id', ids);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    revalidateTag('posts');
    return Response.json({ ok: true, count: ids.length });
  }

  // 고정/해제 — 행마다 다른 값을 계산할 게 없어 한 번의 update 로 끝난다.
  // 행별 토글 버튼도 ids 한 개짜리로 이 경로를 함께 쓴다(경로가 갈리면 규칙도 갈린다).
  if (body.action === 'pin' || body.action === 'unpin') {
    const { error } = await adminDb()
      .from('posts')
      .update({ pinned: body.action === 'pin' })
      .in('id', ids);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    revalidateTag('posts');
    return Response.json({ ok: true, count: ids.length });
  }

  if (body.action === 'move') {
    const target = body.targetBoard ?? '';
    if (!isValidBoard(target)) {
      return Response.json({ error: '알 수 없는 대상 게시판입니다.' }, { status: 400 });
    }
    const isNewsTarget = target === 'news';

    // 대상 게시판 규칙에 맞춰 행별 보정 — 뉴스형은 slug·category 가 필요하고,
    // 뉴스형이 아니면 slug 를 비워 unique 충돌 여지를 없앤다.
    const { data: rows, error: selErr } = await adminDb()
      .from('posts')
      .select('id, slug, category, created_at')
      .in('id', ids);
    if (selErr) return Response.json({ error: selErr.message }, { status: 500 });

    for (const r of rows ?? []) {
      const patch: Record<string, unknown> = { board: target };
      if (isNewsTarget) {
        patch.slug = r.slug ?? `${String(r.created_at).slice(0, 10)}-post-${r.id}`;
        // 뉴스 분류는 일반/성과 2종 — 다른 값 집합을 쓰던 게시판(자료실 form/rule)이나
        // 구 뉴스 분류(notice/seminar)에서 옮겨 와도 '일반'으로 눕힌다.
        patch.category = r.category === 'achievement' ? 'achievement' : 'general';
      } else {
        patch.slug = null;
      }
      const { error } = await adminDb().from('posts').update(patch).eq('id', r.id);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }

    revalidateTag('posts');
    return Response.json({ ok: true, count: ids.length });
  }

  return Response.json({ error: '알 수 없는 작업입니다.' }, { status: 400 });
}
