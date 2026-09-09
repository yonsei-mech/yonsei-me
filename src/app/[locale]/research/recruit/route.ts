import type { NextRequest } from 'next/server';
import { newsTabHref } from '@/lib/board-links';
import { legacyRedirect } from '@/lib/legacy-resolver';

// `/research/recruit` → `/news/recruit` 308. 교수 초빙 안내는 2026-09 에 연구 섹션에서
// 소식 섹션으로 옮겼다(연구 탭은 연구 활동만 남긴다). 이 주소로 걸린 구 링크·북마크와
// 이미 색인된 검색 결과를 새 위치로 보전하려고 리다이렉트를 남긴다.
// (페이지의 permanentRedirect 는 미들웨어 rewrite 아래서 200 이 된다 — legacy-resolver 참고)

export function GET(req: NextRequest, { params }: { params: { locale: string } }) {
  return legacyRedirect(req, params.locale, newsTabHref('recruit'));
}
