import type { NextRequest } from 'next/server';
import { legacyRedirect } from '@/lib/legacy-resolver';

// `/alumni/news` → `/alumni` 308. 동문 뉴스 게시판은 2026-09 에 폐지했다 — 동문 소식은
// '동문 소식·네트워크'(/alumni/network) 하나로 모으고, 이 주소는 동문 섹션의 첫 화면인
// 동문회 소개로 보낸다(섹션 안에서 가장 가까운 살아 있는 화면).
// (페이지의 permanentRedirect 는 미들웨어 rewrite 아래서 200 이 된다 — legacy-resolver 참고)

export function GET(req: NextRequest, { params }: { params: { locale: string } }) {
  return legacyRedirect(req, params.locale, '/alumni');
}
