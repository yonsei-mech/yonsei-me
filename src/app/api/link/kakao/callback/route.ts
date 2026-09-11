// 카카오 "계정 연결" 콜백 — 인가 코드를 토큰으로 바꿔 회원번호를 읽고
// 현재 로그인한 cms_users 행에 저장한다. 시작점은 ../route.ts.
//
// ⚠️ 이 경로(/api/link/kakao/callback)를 카카오 개발자 콘솔의 Redirect URI 에
// 등록해야 한다 — Auth.js 로그인용(/api/auth/callback/kakao)과 별개다.
//
// 결과는 전부 콘솔로 되돌아가며 ?kakao= 로 알린다:
//   linked(성공) / denied(사용자 취소) / conflict(다른 계정이 선점) /
//   norow(cms_users 행 없음 — env allowlist 폴백 관리자) / error(그 외)

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findUserByKakaoId, linkKakao } from '@/lib/admin/cms-users';
import { publicOrigin } from '@/lib/site';

export const runtime = 'nodejs';

// 시작 라우트와 같은 이름이어야 한다(route.ts 는 상수 export 를 허용하지 않아 복제).
const KAKAO_STATE_COOKIE = 'kakao_link_state';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // 쿼리(code·state)는 request.url 에서 읽어도 되지만, 오리진은 프록시 뒤에서 내부 주소가
  // 되므로 헤더 기준으로 구한다 — 인가 요청 때와 redirect_uri 가 한 글자라도 다르면
  // 카카오가 코드를 거부한다. @/lib/site 의 publicOrigin 주석 참고.
  const origin = publicOrigin(request);

  /** 콘솔로 복귀 + state 쿠키 폐기(한 번 쓰면 끝) */
  const back = (result: string) => {
    const res = NextResponse.redirect(`${origin}/ko/contentmanagement?kakao=${result}`, 302);
    res.cookies.set(KAKAO_STATE_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  };

  // 사용자가 카카오 동의 화면에서 취소한 경우
  if (url.searchParams.get('error')) return back('denied');

  const state = url.searchParams.get('state');
  const cookieState = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${KAKAO_STATE_COOKIE}=`))
    ?.slice(KAKAO_STATE_COOKIE.length + 1);
  if (!state || !cookieState || state !== cookieState) return back('error');

  const code = url.searchParams.get('code');
  if (!code) return back('error');

  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(`${origin}/ko/contentmanagement/login`, 302);
  }
  // cms_users 행이 없는 세션(env allowlist 폴백으로 들어온 관리자)은 붙일 곳이 없다
  const uid = session.user.uid;
  if (!uid) return back('norow');

  const clientId = process.env.AUTH_KAKAO_ID;
  const clientSecret = process.env.AUTH_KAKAO_SECRET;
  if (!clientId) return back('error');

  try {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      // redirect_uri 는 인가 요청 때와 **한 글자도** 같아야 카카오가 코드를 받아준다
      redirect_uri: `${origin}/api/link/kakao/callback`,
      code,
    });
    if (clientSecret) form.set('client_secret', clientSecret);

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: form.toString(),
    });
    if (!tokenRes.ok) {
      console.error('[kakao-link] 토큰 교환 실패', tokenRes.status, await tokenRes.text().catch(() => ''));
      return back('error');
    }
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) return back('error');

    const meRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!meRes.ok) {
      console.error('[kakao-link] 사용자 조회 실패', meRes.status);
      return back('error');
    }
    // 카카오 회원번호는 JS 안전 정수 범위를 넘길 수 있어 문자열로 다룬다
    const me = (await meRes.json()) as { id?: number | string };
    if (me.id === undefined || me.id === null) return back('error');
    const kakaoId = String(me.id);

    const owner = await findUserByKakaoId(kakaoId);
    if (owner && owner.id !== uid) return back('conflict');
    if (!owner) await linkKakao(uid, kakaoId);

    return back('linked');
  } catch (err) {
    console.error('[kakao-link] 연결 실패', err);
    return back('error');
  }
}
