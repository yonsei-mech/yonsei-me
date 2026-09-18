/**
 * 학위논문심사 공고 등록 — 본인 확인을 마친 학생의 제출 세션(서명 쿠키).
 *
 * 형식: `thesis_submit` = base64url(JSON{email,exp}) + "." + base64url(HMAC-SHA256)
 *  - exp 는 epoch 초. httpOnly · sameSite=lax · path=/ · secure(프로덕션) · maxAge 60분.
 *  - 서버에 세션 상태를 두지 않는다(쿠키 자체가 증명). 되돌릴 일(강제 로그아웃)이 없고
 *    수명이 짧아 무상태로 충분하다.
 *
 * ⚠️ Auth.js 를 거치지 않는다 — Auth.js 세션을 만들면 CMS 관리자 세션이 된다.
 * 서명 키: 새 env 를 늘리지 않으려고 기존 AUTH_SECRET 에서 파생한다
 * (sha256('thesis-submit:' + AUTH_SECRET) 을 HMAC 키로 — 용도 접두사로 Auth.js 의 키와
 * 분리). dev 에 AUTH_SECRET 이 없으면 dev 전용 고정 키, 프로덕션에서 없으면 null(=503).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { SESSION_MAX_AGE_S, isAllowedEmail, normalizeEmail } from './config';

export const THESIS_SESSION_COOKIE = 'thesis_submit';

/** HMAC 키 — 프로덕션에서 AUTH_SECRET 이 없으면 null (호출부가 503 으로 바꾼다) */
function sessionKey(): Buffer | null {
  const secret = process.env.AUTH_SECRET;
  if (secret) return createHash('sha256').update(`thesis-submit:${secret}`).digest();
  if (process.env.NODE_ENV !== 'production') {
    return createHash('sha256').update('thesis-submit:dev-only-key').digest();
  }
  return null;
}

/** 서명 키를 쓸 수 있는가 — 확인 API 가 코드를 소모하기 전에 먼저 본다 */
export function sessionKeyAvailable(): boolean {
  return sessionKey() !== null;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payload: string, key: Buffer): Buffer {
  return createHmac('sha256', key).update(payload).digest();
}

/** 쿠키 값 검증 → 이메일. 서명 불일치·만료·형식 오류는 전부 null */
export function verifySessionToken(token: string | null | undefined, now = Date.now()): { email: string } | null {
  if (!token) return null;
  const key = sessionKey();
  if (!key) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const payload = token.slice(0, dot);
  let given: Buffer;
  try {
    given = Buffer.from(token.slice(dot + 1), 'base64url');
  } catch {
    return null;
  }
  const expected = sign(payload, key);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: unknown;
      exp?: unknown;
    };
    const email = typeof data.email === 'string' ? normalizeEmail(data.email) : '';
    if (!isAllowedEmail(email)) return null;
    if (typeof data.exp !== 'number' || data.exp * 1000 <= now) return null;
    return { email };
  } catch {
    return null;
  }
}

/**
 * 발급할 쿠키 — NextResponse.cookies.set(name, value, options) 에 그대로 넘긴다.
 * 서명 키가 없으면(프로덕션 AUTH_SECRET 누락) null.
 */
export function sessionCookie(
  email: string,
  now = Date.now(),
): {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: 'lax';
    path: string;
    secure: boolean;
    maxAge: number;
  };
} | null {
  const key = sessionKey();
  if (!key) return null;
  const exp = Math.floor(now / 1000) + SESSION_MAX_AGE_S;
  const payload = b64url(Buffer.from(JSON.stringify({ email: normalizeEmail(email), exp }), 'utf8'));
  const value = `${payload}.${b64url(sign(payload, key))}`;
  return {
    name: THESIS_SESSION_COOKIE,
    value,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE_S,
    },
  };
}

/** 서버 컴포넌트·라우트에서 현재 요청의 제출 세션 읽기 */
export async function readThesisSession(): Promise<{ email: string } | null> {
  return verifySessionToken(cookies().get(THESIS_SESSION_COOKIE)?.value);
}
