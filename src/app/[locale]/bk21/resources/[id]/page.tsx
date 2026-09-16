import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { BoardPostDetail, boardPostMetadata } from '../../../news/_shared/BoardPostDetail';

// DB 소스 전환(Phase 2): 요청 시 렌더 + ISR (revalidateTag('posts') 가 즉시 갱신)
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string; id: string };
}): Promise<Metadata> {
  return boardPostMetadata({ locale: params.locale, id: params.id, board: 'bk21Resources' });
}

/**
 * BK21 자료실 글 상세 — BK21 섹션 소속이라 `/bk21` 아래에 산다(목록은 `/bk21/resources`).
 * 공용 빌더가 BK21 셸·브레드크럼으로 전환하고, 다른 게시판 글이 이 주소로 오면 제 주소로 308 한다.
 */
export default function Bk21ResourcePostPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  setRequestLocale(params.locale);
  return <BoardPostDetail locale={params.locale} id={params.id} board="bk21Resources" />;
}
