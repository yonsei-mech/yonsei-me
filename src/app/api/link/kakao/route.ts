// 카카오 "계정 연결" 시작 — 이미 로그인한 사용자의 cms_users 행에 카카오
// 회원번호를 붙인다(다음부터 카카오 버튼 한 번으로 로그인).
//
// Auth.js 를 거치지 않고 직접 OAuth 를 도는 이유: Auth.js 의 카카오 로그인은
// "인증"이고 여기는 "연결"이다. 어댑터가 없어 계정 링크 기능을 쓸 수 없고,
// 로그인 흐름을 타면 세션이 카카오 계정으로 갈아치워진다.
//
// ⚠️ 카카오 개발자 콘솔 → 카카오 로그인 → Redirect URI 에 아래 두 개를 모두
// 등록해야 한다(로그인용/연결용이 다르다):
//   https://<도메인>/api/auth/callback/kakao   (Auth.js 로그인)
//   https://<도메인>/api/link/kakao/callback   (이 파일의 연결 흐름)

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { publicOrigin } from '@/lib/site';

export const runtime = 'nodejs';

// CSRF 방어용 state 보관 쿠키. route.ts 는 GET/POST 외의 export 를 허용하지
// 않아 공유 상수로 뽑지 못한다 — 콜백 파일에 같은 이름이 복제돼 있다(동시 수정).
const KAKAO_STATE_COOKIE = 'kakao_link_state';

export async function GET(request: Request): Promise<Response> {
  // 프록시 뒤에서는 request.url 이 내부 주소라 카카오가 redirect_uri 를 거부한다 — @/lib/site 참고
  const origin = publicOrigin(request);

  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(`${origin}/ko/contentmanagement/login`, 302);
  }

  const clientId = process.env.AUTH_KAKAO_ID;
  if (!clientId) {
    return NextResponse.redirect(`${origin}/ko/contentmanagement?kakao=error`, 302);
  }

  const state = randomUUID();
  const authorize = new URL('https://kauth.kakao.com/oauth/authorize');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', `${origin}/api/link/kakao/callback`);
  authorize.searchParams.set('state', state);

  const res = NextResponse.redirect(authorize.toString(), 302);
  res.cookies.set(KAKAO_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return res;
}
