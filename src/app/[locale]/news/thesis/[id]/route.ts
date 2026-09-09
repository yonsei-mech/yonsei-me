import type { NextRequest } from 'next/server';
import { fetchBoardPost } from '@/lib/posts';
import { boardPostHref } from '@/lib/board-links';
import { legacyRedirect, legacyNotFound } from '@/lib/legacy-resolver';

// 구 학위논문심사 상세 주소 `/news/thesis/<id>` → 새 주소 308 리졸버.
// 게시판이 대학원 섹션으로 옮겨 가면서 상세 주소도 `/graduate/thesis/<id>` 가 됐다 —
// 목적지는 글의 boardKey 가 정한다(boardPostHref 가 단일 출처)라 여기에 경로를 적지 않는다.
// 없는 글은 목적지로 떠넘기지 않고 여기서 404 한다.

export async function GET(
  req: NextRequest,
  { params }: { params: { locale: string; id: string } },
) {
  const post = await fetchBoardPost(params.id);
  if (!post) return legacyNotFound(params.locale);
  return legacyRedirect(req, params.locale, boardPostHref(post));
}
