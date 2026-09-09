import type { NextRequest } from 'next/server';
import { sectionTabHref } from '@/lib/board-links';
import { legacyRedirect } from '@/lib/legacy-resolver';

// `/faculty` → 학부소개 › 교수진 탭(/about/faculty) 308.
//
// 교수진 목록의 정본은 섹션 탭 페이지다(헤더 메뉴·홈·구 URL 리졸버가 전부 그리로 간다).
// 예전엔 여기에 같은 인명록을 그리는 별도 페이지가 있었는데, 상단 바가 섹션 드롭다운
// 없는 축소판(홈 | 교수진)이라 교수 상세에서 "목록으로"로 돌아온 사용자가 소개 섹션의
// 다른 탭으로 갈 길을 잃었다(사용자 신고). 페이지를 없애고 정본으로 보내 한 목록만 남긴다.
// (페이지의 permanentRedirect 는 미들웨어 rewrite 아래서 200 이 된다 — legacy-resolver 참고)

export function GET(req: NextRequest, { params }: { params: { locale: string } }) {
  return legacyRedirect(req, params.locale, sectionTabHref('about', 'faculty'));
}
