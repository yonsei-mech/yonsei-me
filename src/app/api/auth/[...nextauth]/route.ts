// Auth.js v5 route 핸들러 — /api/auth/* (signin, callback, signout, session 등).
import { NextRequest } from 'next/server';
import { handlers } from '@/auth';
import { publicOrigin } from '@/lib/site';

/** 요청 URL 의 오리진을 공개 오리진으로 바꿔 Auth.js 에 넘긴다.
 *
 *  Auth.js 라우트는 `AUTH_URL` 이 없으면 `request.url` 로 OAuth redirect_uri·콜백 기준 주소를 만든다.
 *  자체 호스팅(Cafe24) 리버스 프록시 뒤에서는 그 오리진이 내부 주소(`https://localhost:3000`)라
 *  GitHub·카카오에 `redirect_uri=https://localhost:3000/api/auth/callback/…` 가 나갔다(2026-09-13 실측).
 *  `AUTH_URL` 로 고정하면 미들웨어 rewrite 가 깨지므로(DEPLOYMENT_GUIDE G-16) 라우트에서만 바꾼다 —
 *  Auth.js 가 `AUTH_URL` 이 있을 때 하는 일(next-auth/lib/env.js 의 reqWithEnvURL)과 같은 방식이다.
 *
 *  `publicOrigin` 이 믿는 `X-Forwarded-Host` 는 Cafe24 nginx 가 `$host` 로 덮어쓰고(DEPLOYMENT_GUIDE 9-7),
 *  Vercel 은 자기가 채운다. Vercel·로컬 dev 는 두 오리진이 같아 요청을 그대로 넘긴다. */
function withPublicOrigin(req: NextRequest): NextRequest {
  const origin = publicOrigin(req);
  const { href, origin: current } = req.nextUrl;
  if (origin === current) return req;
  return new NextRequest(href.replace(current, origin), req);
}

export const GET = (req: NextRequest) => handlers.GET(withPublicOrigin(req));
export const POST = (req: NextRequest) => handlers.POST(withPublicOrigin(req));
