/** 사이트 공용 상수 — 배포 도메인(구조화 데이터·사이트맵·robots 공통).
 *
 *  컷오버(me.yonsei.ac.kr DNS 이전) 때는 코드를 고치지 않고 Vercel 환경변수
 *  `NEXT_PUBLIC_SITE_URL=https://me.yonsei.ac.kr` 만 넣고 재배포하면 된다 —
 *  canonical·hreflang·사이트맵·robots·JSON-LD 가 한 번에 새 도메인을 가리킨다.
 *  되돌리려면 그 변수를 지운다(기본값이 현행 Vercel 도메인).
 *  끝 슬래시는 잘라 낸다 — `${SITE_URL}/…` 조립이 이중 슬래시가 되면 안 된다. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'https://yonsei-me.vercel.app';

/** 요청이 실제로 들어온 **공개** 오리진(`https://호스트`).
 *
 *  ⚠️ Route Handler 에서 `new URL(request.url).origin` 을 쓰면 안 된다. 리버스 프록시
 *  뒤의 자체 호스팅(Cafe24)에서는 그 값이 내부 주소(`https://localhost:3000`)로 나온다.
 *  그대로 리다이렉트·OAuth redirect_uri 에 넣으면 사용자가 localhost 로 튕기고 카카오는
 *  주소 불일치로 코드를 거부한다(2026-09-11 실측).
 *
 *  Host 헤더(프록시가 `proxy_set_header Host $host` 로 원본을 넘긴다)를 기준으로 삼고,
 *  프로토콜은 `X-Forwarded-Proto` 를 따른다. 헤더가 없으면 빌드에 박힌 SITE_URL 로 떨어진다.
 *  Vercel 에서도 Host 가 공개 도메인이라 결과가 같다. */
export function publicOrigin(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return SITE_URL;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  return `${proto}://${host}`;
}
