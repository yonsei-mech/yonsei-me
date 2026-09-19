// 미들웨어: next-intl 로케일 라우팅 + 관리자 콘솔(/contentmanagement) 인증 게이트.
//
// 사이트 전 라우트가 이 지점을 통과한다. 보호 경로가 아니면 기존 next-intl
// 동작을 100% 그대로 유지해야 한다(홈·뉴스 등 모든 페이지가 영향받으므로).
// Auth.js v5 는 엣지에서 도는 미들웨어용으로 "엣지 안전 authConfig"만 쓴다.

import createMiddleware from 'next-intl/middleware';
import NextAuth from 'next-auth';
import { routing } from './i18n/routing';
import authConfig from './auth.config';

const { auth } = NextAuth(authConfig);
const intl = createMiddleware(routing);

// 보호 경로: /ko/contentmanagement, /en/contentmanagement (그 하위 포함).
// 단 /contentmanagement/login 은 제외한다 — 로그인 화면 자체가 인증을 요구하면
// 무한 리다이렉트가 된다(부정 전방탐색으로 그 한 갈래만 뚫는다).
const PROTECTED = /^\/(?:ko|en)\/contentmanagement(?!\/login(?:\/|$))(?:\/|$)/;

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // 구 사이트 루트(/me, /me/ 와 영문 미러 /me_en, /me_en/) — 점이 없어 matcher 세 번째
  // 패턴에 걸리는 유일한 구 주소들이다. 그대로 두면 next-intl 이 /ko/me 로 보내 404 가
  // 되므로 인트르 처리 전에 각 언어 홈으로 308 한다. 나머지 `/me/*.do`·`/me_en/*.do` 는
  // 점 때문에 matcher 를 통과하지 못하고 app/me·app/me_en 리졸버로 직행한다.
  if (pathname === '/me' || pathname === '/me/') {
    return Response.redirect(new URL('/ko', req.nextUrl.origin), 308);
  }
  if (pathname === '/me_en' || pathname === '/me_en/') {
    return Response.redirect(new URL('/en', req.nextUrl.origin), 308);
  }

  // 개발 편의: 로컬 dev 서버에서는 콘솔 진입 게이트를 건너뛴다(레이아웃 작업용).
  // NODE_ENV 는 Next.js 가 자동 설정 → 프로덕션 빌드에서는 절대 우회되지 않는다.
  const devBypass = process.env.NODE_ENV !== 'production';

  if (PROTECTED.test(pathname) && !req.auth && !devBypass) {
    // 미인증 → 콘솔 전용 로그인 화면으로(Auth.js 기본 사인인 페이지 대신).
    // 로그인 수단이 셋(GitHub·이메일 인증번호·카카오)이라 기본 화면으로는
    // 안내가 안 된다. 로케일은 요청 경로의 첫 세그먼트를 따른다.
    const locale = pathname.split('/')[1] === 'en' ? 'en' : 'ko';
    const loginUrl = new URL(`/${locale}/contentmanagement/login`, req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return Response.redirect(loginUrl);
  }

  // 보호 경로(인증 통과 포함)와 그 외 모든 경로는 기존 next-intl 처리로.
  return intl(req);
});

export const config = {
  // 내부 경로(_next, api)와 정적 파일(점 포함)을 제외한 모든 경로에 적용.
  // api 제외 유지 → /api/auth/* 는 route 핸들러가 직접 처리(미들웨어 우회).
  matcher: ['/', '/(ko|en)/:path*', '/((?!api|_next|.*\\..*).*)'],
};
