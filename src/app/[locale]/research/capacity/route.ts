import type { NextRequest } from 'next/server';
import { sectionTabHref } from '@/lib/board-links';
import { legacyRedirect } from '@/lib/legacy-resolver';

// `/research/capacity` → `/research/vision` 308. 연구 역량은 2026-09 에 연구 비전과 한 탭
// ('연구 비전 및 역량')으로 합쳐졌다 — 내용은 그 페이지 아래 단락에 그대로 있다.
// 이 주소로 걸린 구 링크·북마크와 이미 색인된 검색 결과를 새 위치로 보전한다.
// (페이지의 permanentRedirect 는 미들웨어 rewrite 아래서 200 이 된다 — legacy-resolver 참고)

export function GET(req: NextRequest, { params }: { params: { locale: string } }) {
  return legacyRedirect(req, params.locale, sectionTabHref('research', 'vision'));
}
