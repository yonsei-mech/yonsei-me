import { legacyNotFound } from '@/lib/legacy-resolver';

// `/research/internships/<id>` → 404. 인턴 모집 게시판은 2026-09 에 폐지됐고 글 하나하나에
// 대응하는 새 문서가 없다 — 목록으로 떠넘기면 구글이 소프트 404 로 읽고, 사람은 자기가
// 찾던 글이 어디 갔는지 알 수 없다. 여기서 정직하게 404 를 낸다.
// (페이지의 notFound() 는 미들웨어 rewrite 아래서 200 이 된다 — legacy-resolver 참고)

export function GET(_req: Request, { params }: { params: { locale: string; id: string } }) {
  return legacyNotFound(params.locale);
}
