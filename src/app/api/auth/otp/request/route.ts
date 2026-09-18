// 이메일 인증번호(OTP) 발급 API — 로그인 화면의 "인증번호 받기" 버튼.
//
// 발급한 6자리 코드는 sha256 해시로만 저장한다(cms_users.otp_hash). 검증은
// Auth.js Credentials 프로바이더('email-otp', src/auth.ts)가 한다.
//
// ⚠️ 이 경로는 /api/auth/[...nextauth] 캐치올보다 구체적이라 Next 라우팅에서
// 우선한다 — Auth.js 핸들러와 충돌하지 않는다.
//
// 메일 HTML(otpEmailHtml)과 Brevo 호출(sendBrevoMail)은 2026-09 학위논문심사 공고 등록의
// 학생 본인 확인이 같은 메일을 쓰게 되어 src/lib/mail/ 로 옮겼다. 이 라우트가 보내는
// 메일(제목·HTML)과 응답·로그는 옮기기 전과 같다(인자 없는 otpEmailHtml = CMS 문구).

import { createHash, randomInt } from 'node:crypto';
import { findUserByEmail, setOtp } from '@/lib/admin/cms-users';
import { otpEmailHtml } from '@/lib/mail/otp-email';
import { mailConfigured, sendBrevoMail } from '@/lib/mail/brevo';

export const runtime = 'nodejs';

/** 코드 유효 시간 — 메일 도착 지연을 감안해 넉넉히 10분 */
const TTL_MS = 10 * 60 * 1000;
/** 재발송 쿨다운 — 메일 폭탄·비용 방지 */
const RESEND_COOLDOWN_MS = 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request): Promise<Response> {
  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return Response.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return Response.json({ error: '이메일 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  // dev 는 DB·메일을 거치지 않고 고정 코드로 로그인 UI 를 돌린다
  // (src/auth.ts authorize 의 dev 분기와 짝 — 프로덕션 빌드에는 없는 경로).
  if (process.env.NODE_ENV !== 'production') {
    return Response.json({ ok: true, devCode: '000000' });
  }

  let user;
  try {
    user = await findUserByEmail(email);
  } catch (err) {
    console.error('[otp] cms_users 조회 실패', err);
    return Response.json({ error: '일시적인 오류입니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 });
  }

  // 계정 존재 여부를 그대로 알린다. 내부 운영 도구라 열거 공격의 이득이 없고,
  // "등록되지 않았다"를 숨기면 실무자가 오타인지 미등록인지 알 수 없다.
  if (!user) {
    return Response.json(
      { error: '등록된 계정이 아닙니다. 학과 관리자에게 등록을 요청해 주세요.' },
      { status: 404 },
    );
  }

  if (user.otpSentAt) {
    const elapsed = Date.now() - Date.parse(user.otpSentAt);
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      return Response.json(
        { error: '잠시 후 다시 요청해 주세요.', retryAfter },
        { status: 429 },
      );
    }
  }

  // 설정 확인은 저장보다 먼저 — 받을 수 없는 코드를 저장하고 쿨다운까지 거는 일을 막는다
  if (!mailConfigured()) {
    return Response.json(
      { error: '메일 발송이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.' },
      { status: 503 },
    );
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  try {
    await setOtp(user.id, createHash('sha256').update(code).digest('hex'), new Date(Date.now() + TTL_MS));
  } catch (err) {
    console.error('[otp] 인증번호 저장 실패', err);
    return Response.json({ error: '일시적인 오류입니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 });
  }

  const sent = await sendBrevoMail({
    to: email,
    subject: `[기계공학부 CMS] 인증번호 ${code}`,
    html: otpEmailHtml(code),
    logTag: '[otp]',
  });
  if (!sent.ok) {
    return Response.json(
      { error: '메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}
