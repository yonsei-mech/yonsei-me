import type { NextRequest } from 'next/server';
import { sectionDefaultHref } from '@/lib/board-links';
import { legacyRedirect } from '@/lib/legacy-resolver';

// `/graduate/bk21` → `/bk21/vision` 308. BK21 FOUR 교육연구단은 2026-09 에 대학원의 한 탭에서
// 자기 섹션으로 독립했다 — 구 사이트의 11개 페이지(비전·참여인력·현황·자료실·보고서)를
// 한 장에 담을 수 없었기 때문이다. 메가메뉴 위치는 대학원 아래 그대로다.
// ⚠️ 정적 세그먼트 'bk21' 을 이 라우트가 계속 점유하므로 대학원 섹션에 같은 이름의 탭을
//    다시 만들 수 없다 — board-links 의 CONTENT_SECTIONS.bk21 이 정본 위치다.
// (페이지의 permanentRedirect 는 미들웨어 rewrite 아래서 200 이 된다 — legacy-resolver 참고)

export function GET(req: NextRequest, { params }: { params: { locale: string } }) {
  return legacyRedirect(req, params.locale, sectionDefaultHref('bk21'));
}
