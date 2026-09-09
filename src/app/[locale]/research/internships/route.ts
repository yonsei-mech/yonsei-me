import type { NextRequest } from 'next/server';
import { sectionTabHref } from '@/lib/board-links';
import { legacyRedirect } from '@/lib/legacy-resolver';

// `/research/internships` → `/research/labs` 308. 인턴 모집 게시판은 2026-09 에 폐지했다
// (학과가 더 운영하지 않는다). 대체 화면이 없으므로 가장 가까운 살아 있는 탭인 연구실
// 목록으로 보낸다 — 인턴을 찾던 사람이 연구실을 통해 문의할 수 있는 자리다.
// (페이지의 permanentRedirect 는 미들웨어 rewrite 아래서 200 이 된다 — legacy-resolver 참고)

export function GET(req: NextRequest, { params }: { params: { locale: string } }) {
  return legacyRedirect(req, params.locale, sectionTabHref('research', 'labs'));
}
