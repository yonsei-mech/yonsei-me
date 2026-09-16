import type { NextRequest } from 'next/server';
import { sectionDefaultHref } from '@/lib/board-links';
import { legacyRedirect } from '@/lib/legacy-resolver';

// `/bk21` → 기본 탭(/bk21/vision) 308. 다른 콘텐츠 섹션(/about·/graduate …)과 같은 규칙이다
// — 섹션 루트 자체는 문서가 아니고, 탭이 곧 경로다. 해시(#people 등)는 브라우저가
// 리다이렉트를 따라가며 보존하고, 기본 탭의 LegacyBoardHash 가 최종 탭으로 옮긴다.
// (페이지의 permanentRedirect 는 미들웨어 rewrite 아래서 200 이 된다 — legacy-resolver 참고)

export function GET(req: NextRequest, { params }: { params: { locale: string } }) {
  return legacyRedirect(req, params.locale, sectionDefaultHref('bk21'));
}
