/** 사이트 공용 상수 — 배포 도메인(구조화 데이터·사이트맵·robots 공통).
 *
 *  기본값은 정규 도메인(me.yonsei.ac.kr)이다. 다른 도메인으로 띄워야 하면 코드를
 *  고치지 말고 배포 환경변수(`/etc/yonsei_me/env` 의 `NEXT_PUBLIC_SITE_URL`)를 넣고
 *  다시 빌드한다 — canonical·hreflang·사이트맵·robots·JSON-LD 가 한 번에 따라간다.
 *  NEXT_PUBLIC_ 이라 **빌드 시점에 구워진다**: 값을 바꾸면 재시작이 아니라 재빌드다.
 *  끝 슬래시는 잘라 낸다 — `${SITE_URL}/…` 조립이 이중 슬래시가 되면 안 된다. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'https://me.yonsei.ac.kr';

/** 요청이 실제로 들어온 **공개** 오리진(`https://호스트`).
 *
 *  ⚠️ Route Handler 에서 `new URL(request.url).origin` 을 쓰면 안 된다. 리버스 프록시
 *  뒤의 자체 호스팅(Cafe24)에서는 그 값이 내부 주소(`https://localhost:3000`)로 나온다.
 *  그대로 리다이렉트·OAuth redirect_uri 에 넣으면 사용자가 localhost 로 튕기고 카카오는
 *  주소 불일치로 코드를 거부한다(2026-09-11 실측).
 *
 *  Host 헤더(프록시가 `proxy_set_header Host $host` 로 원본을 넘긴다)를 기준으로 삼고,
 *  프로토콜은 `X-Forwarded-Proto` 를 따른다. 헤더가 없으면 빌드에 박힌 SITE_URL 로 떨어진다. */
export function publicOrigin(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return SITE_URL;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  return `${proto}://${host}`;
}
