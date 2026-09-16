/**
 * 구 교수 상세 URL(`/faculty/name_search.do?mode=view&userId=…`) → 새 교수 상세 1홉 308 리졸버.
 *
 * 구 학과 사이트의 교수진 목록이 걸던 "교원정보" 링크 28건이다. 다른 구 주소와 달리
 * `/me/` 접두가 **없는** 호스트 루트 경로라 app/me 리졸버가 잡지 못해, 컷오버 뒤
 * 전부 404 가 된다. 쿼리 중 의미 있는 값은 `userId`(base64) 하나이고 `mode`·`sosokcd`
 * 는 무시한다 — 구 CMS 에서도 상세를 가르는 것은 userId 뿐이다.
 *
 * ⚠️ 1홉 보장의 전제는 app/me 와 같다 — 미들웨어 matcher 가 **점이 든 경로를 통과시키지
 *    않으므로** `/faculty/name_search.do` 는 next-intl 의 로케일 rewrite 없이 여기로
 *    직행한다. 정적 세그먼트 `faculty` 가 `[locale]` 보다 먼저 잡히는 것도 같은 이유로
 *    안전하다(`/ko/faculty/…` 는 로케일 세그먼트가 앞에 있어 이 라우트에 닿지 않는다).
 *
 * ⚠️ 왜 페이지가 아니라 Route Handler 인가는 lib/legacy-resolver.ts 주석 참조
 *    (rewrite 된 페이지 렌더는 308/404 를 잃고 200 을 내보낸다).
 */
import type { NextRequest } from 'next/server';
import gen from '@/lib/legacy-faculty.gen.json';
import { legacyNotFound, legacyRedirect } from '@/lib/legacy-resolver';

// 답이 경로가 아니라 **쿼리**로 갈린다(같은 name_search.do 가 교수마다 다른 곳으로 간다).
// 정적 평가로 한 답이 굳으면 전 요청이 같은 교수에게 가므로 요청마다 계산한다.
export const dynamic = 'force-dynamic';

// tools/legacy-redirects/build-faculty-map.mjs 산출물(교수 31명). 출처인
// content/faculty-profiles/*.json 은 합계 3.3MB 라 라우트가 직접 읽지 않는다 —
// userId → 이름 두 필드만 굳힌 수 KB 스냅숏이 리다이렉트에 필요한 전부다.
const MAP = gen as Record<string, string>;

/** 자기 소유 키만 읽는다 — 객체 리터럴 인덱싱은 'constructor' 같은 입력에도 값을 준다. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** 매핑에 없는 userId 가 갈 곳 — 구 교원정보시스템(같은 CMS 가 아직 살아 있는 호스트).
 *  lib/faculty.ts 의 facultyInfoSystemUrl 과 같은 규칙(me → devcms)이다. 홈으로
 *  떠넘기면 찾던 교수와 무관한 페이지가 되므로, 원본이 답할 수 있는 곳에 넘긴다. */
const FACULTY_INFO_ORIGIN = 'https://devcms.yonsei.ac.kr';

export async function GET(req: NextRequest) {
  // searchParams 는 이미 디코딩된 값을 준다(`%3D%3D` → `==`). 다만 base64 의 `+` 가
  // 인코딩되지 않은 채 오면 폼 규칙으로 공백이 되므로, 조회 전에 되돌린다.
  const userId = req.nextUrl.searchParams.get('userId')?.replace(/ /g, '+');
  if (!userId) return legacyNotFound('ko'); // 목록·검색 폼 주소 — 대응 상세가 없다

  const name = own(MAP, userId);
  if (name) return legacyRedirect(req, 'ko', `/faculty/${encodeURIComponent(name)}`);

  // 우리 프로필에 없는 교원(퇴임·타 학과) — 쿼리를 그대로 들고 원본 CMS 로.
  return Response.redirect(
    `${FACULTY_INFO_ORIGIN}/faculty/name_search.do?${req.nextUrl.searchParams.toString()}`,
    308,
  );
}
