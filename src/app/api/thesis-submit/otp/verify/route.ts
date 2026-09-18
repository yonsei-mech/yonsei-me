// 학위논문심사 공고 등록 — 학생 본인 확인 인증번호 확인 API (화면 B "확인하고 계속").
//
// 성공하면 제출 세션 쿠키(thesis_submit, 서명 쿠키 — src/lib/thesis-submit/session.ts)를
// 굽는다. Auth.js 를 거치지 않는다(CMS 관리자 세션과 분리).
//
// 응답 계약은 src/lib/thesis-submit/config.ts 의 OtpVerifyResponse 가 단일 출처다:
//   200 ok · 401 wrong(remaining) · 423 locked · 410 expired · 400 invalid · 5xx server
//
// 시도 횟수 규칙: 비교 **전에** 한 번을 선점한다(claimAttempt). 동시 요청이 같은 횟수를
// 읽어도 선점은 하나만 성공하므로 병렬 요청으로도 비교 횟수가 한도를 넘지 못한다.
// 한도째(5번째) 오답은 wrong 이 아니라 곧바로 locked — "남은 기회 0회"를 보여 주고 다시
// 한 번 더 틀려야 잠기는 헛걸음을 없앤다.

import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  OTP_MAX_ATTEMPTS,
  isAllowedEmail,
  isCodeFormat,
  isThesisSubmitEnabled,
  normalizeEmail,
  type OtpVerifyResponse,
} from '@/lib/thesis-submit/config';
import { thesisOtpStore } from '@/lib/thesis-submit/otp-store';
import { sessionCookie, sessionKeyAvailable } from '@/lib/thesis-submit/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function reply(body: OtpVerifyResponse, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** 16진 해시 두 개를 상수 시간으로 비교 */
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export async function POST(request: Request): Promise<Response> {
  if (!isThesisSubmitEnabled()) return reply({ ok: false, reason: 'disabled' }, 404);

  // 발급 API 와 같은 이유로 JSON 본문만 받는다(교차 출처 위조 차단)
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return reply({ ok: false, reason: 'invalid' }, 400);
  }
  let body: { email?: unknown; code?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; code?: unknown };
  } catch {
    return reply({ ok: false, reason: 'invalid' }, 400);
  }

  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '');
  if (!isAllowedEmail(email) || !isCodeFormat(body.code)) {
    return reply({ ok: false, reason: 'invalid' }, 400);
  }
  const code = body.code;

  // 서명 키가 없으면(프로덕션 AUTH_SECRET 누락) 코드를 소모하기 전에 멈춘다 —
  // 맞혀 놓고 쿠키를 못 굽는 "맞았는데 통과 못 한" 상태를 만들지 않는다.
  if (!sessionKeyAvailable()) {
    console.error('[thesis-submit] AUTH_SECRET 미설정 — 제출 세션을 서명할 수 없다');
    return reply({ ok: false, reason: 'server', message: 'session-key' }, 503);
  }

  const store = thesisOtpStore();
  try {
    const rec = await store.get(email);
    // 잠김이 만료보다 먼저 — 폐기된 코드는 해시가 없지만 "만료"가 아니라 "소진"이다
    if (rec && rec.otpAttempts >= OTP_MAX_ATTEMPTS) return reply({ ok: false, reason: 'locked' }, 423);
    if (!rec || !rec.otpHash || rec.otpExpiresAt == null || rec.otpExpiresAt <= Date.now()) {
      return reply({ ok: false, reason: 'expired' }, 410);
    }

    const used = await store.claimAttempt(email, rec.otpAttempts);
    if (used === null) {
      // 동시 요청에 선점을 빼앗겼다 — 이 요청의 코드는 비교하지 않는다(재시도하면 된다)
      return reply({ ok: false, reason: 'server', message: 'busy' }, 409);
    }

    const hash = createHash('sha256').update(code).digest('hex');
    if (!sameHash(hash, rec.otpHash)) {
      if (used >= OTP_MAX_ATTEMPTS) {
        await store.discard(email);
        return reply({ ok: false, reason: 'locked' }, 423);
      }
      return reply({ ok: false, reason: 'wrong', remaining: OTP_MAX_ATTEMPTS - used }, 401);
    }

    // 성공 — 해시(와 행)를 즉시 폐기하고 세션을 굽는다
    await store.consume(email);
    const cookie = sessionCookie(email);
    if (!cookie) return reply({ ok: false, reason: 'server', message: 'session-key' }, 503);
    const res = reply({ ok: true });
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  } catch (err) {
    console.error('[thesis-submit] 인증번호 확인 실패', err);
    return reply({ ok: false, reason: 'server', message: 'db' }, 500);
  }
}
