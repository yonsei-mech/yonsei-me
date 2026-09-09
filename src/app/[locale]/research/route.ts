import type { NextRequest } from 'next/server';
import { sectionDefaultHref } from '@/lib/board-links';
import { legacyRedirect } from '@/lib/legacy-resolver';

// `/research` → 기본 탭(연구 비전) 308. 탭이 경로가 되면서(/research/<탭>) 이 주소
// 자체는 화면이 아니게 됐다 — 구 링크·북마크를 기본 탭으로 보낸다. 해시(#labs 등)는
// 브라우저가 리다이렉트를 따라가며 보존하고, 기본 탭 페이지의 LegacyBoardHash 가 최종
// 탭으로 옮긴다.
// (페이지의 permanentRedirect 는 미들웨어 rewrite 아래서 200 이 된다 — legacy-resolver 참고)

export function GET(req: NextRequest, { params }: { params: { locale: string } }) {
  return legacyRedirect(req, params.locale, sectionDefaultHref('research'));
}
