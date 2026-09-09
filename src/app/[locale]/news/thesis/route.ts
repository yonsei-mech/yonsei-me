import type { NextRequest } from 'next/server';
import { sectionTabHref } from '@/lib/board-links';
import { legacyRedirect } from '@/lib/legacy-resolver';

// `/news/thesis` → `/graduate/thesis` 308. 학위논문심사는 2026-09 에 소식 섹션에서 대학원
// 섹션으로 옮겼다(찾는 사람이 대학원생이라 그쪽 메뉴에 있어야 한다). 게시판 자체는 그대로다.
// ⚠️ 이 라우트가 `/news/<seg>` 자리의 정적 세그먼트 'thesis' 를 계속 점유하므로, 같은 slug 의
//    뉴스 기사는 열리지 않는다 — board-links 의 RESERVED_NEWS_SLUGS 가 그 예약을 지킨다.
// (페이지의 permanentRedirect 는 미들웨어 rewrite 아래서 200 이 된다 — legacy-resolver 참고)

export function GET(req: NextRequest, { params }: { params: { locale: string } }) {
  return legacyRedirect(req, params.locale, sectionTabHref('graduate', 'thesis'));
}
