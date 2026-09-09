import { legacyNotFound } from '@/lib/legacy-resolver';

// `/alumni/news/<slug>` → 410 Gone. 동문 뉴스 게시판은 2026-09 에 폐지됐고 글 하나하나에
// 대응하는 새 문서가 영영 생기지 않는다 — 목록으로 떠넘기면 구글이 소프트 404 로 읽고, 사람은
// 자기가 찾던 글이 어디 갔는지 알 수 없다. 404 가 아니라 410 인 이유는 "영구 삭제" 신호라
// 색인에서 빨리 빠지기 때문(legacy-resolver 의 legacyNotFound 주석 참고).
// (페이지의 notFound() 는 미들웨어 rewrite 아래서 200 이 된다 — legacy-resolver 참고)

export function GET(_req: Request, { params }: { params: { locale: string; slug: string } }) {
  return legacyNotFound(params.locale, 410);
}
