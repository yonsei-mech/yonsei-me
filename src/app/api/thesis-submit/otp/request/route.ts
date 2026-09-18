// 학위논문심사 공고 등록 — 학생 본인 확인 인증번호 발급 API (화면 B "인증번호 받기"·재전송).
//
// ⚠️ CMS 로그인 발급(/api/auth/otp/request)과 완전히 분리된 경로다. cms_users 를 읽지도
//    쓰지도 않고, Auth.js 세션을 만들지도 않는다(학생에게 관리자 세션이 생기면 안 된다).
//
// 응답 계약은 src/lib/thesis-submit/config.ts 의 OtpRequestResponse 가 단일 출처다.
// 서버는 문구를 보내지 않는다 — 클라이언트가 reason 으로 로케일 문구를 고른다.
//
// 순서: 기능 플래그 → 본문·도메인 → 이메일 쿨다운(60초) → IP 제한(10분 10회, 메모리) →
//       메일 설정 확인 → 발급(해시 저장) → 메일 발송.
// 이메일 쿨다운을 IP 제한보다 먼저 보는 이유: 같은 주소를 연타한 요청은 메일을 보내지
// 않으므로 IP 한도를 깎을 이유가 없다.

import { createHash, randomInt } from 'node:crypto';
import { getTranslations } from 'next-intl/server';
import {
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MINUTES,
  OTP_TTL_MS,
  isAllowedEmail,
  isThesisSubmitEnabled,
  normalizeEmail,
  type OtpRequestResponse,
} from '@/lib/thesis-submit/config';
import { DEV_OTP_CODE, thesisOtpStore } from '@/lib/thesis-submit/otp-store';
import { takeIpSlot } from '@/lib/thesis-submit/ip-limit';
import { otpEmailHtml, type OtpEmailCopy } from '@/lib/mail/otp-email';
import { mailConfigured, sendBrevoMail } from '@/lib/mail/brevo';
import { routing, type Locale } from '@/i18n/routing';

export const runtime = 'nodejs';
// 요청마다 다른 응답(쿨다운·발급) — 캐시 금지
export const dynamic = 'force-dynamic';

function reply(body: OtpRequestResponse, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** 인증번호 메일 제목·문구 — messages 의 thesisSubmit.mail.* (요청 로케일) */
async function mailFor(locale: Locale, code: string): Promise<{ subject: string; copy: OtpEmailCopy }> {
  const t = await getTranslations({ locale, namespace: 'thesisSubmit.mail' });
  const minutes = OTP_TTL_MINUTES;
  return {
    subject: t('subject', { code }),
    copy: {
      lang: locale,
      brandName: t('brandName'),
      brandTagline: t('brandTagline'),
      preheader: t('preheader', { code, minutes }),
      eyebrow: t('eyebrow'),
      heading: t('heading'),
      instruction: t('instruction'),
      validity: t('validity', { minutes }),
      cautionLines: [t('caution1'), t('caution2')],
      footer: t('footer'),
    },
  };
}

export async function POST(request: Request): Promise<Response> {
  if (!isThesisSubmitEnabled()) return reply({ ok: false, reason: 'disabled' }, 404);

  // JSON 본문만 받는다 — 다른 출처의 <form enctype="text/plain"> 은 이 헤더를 못 붙이고,
  // fetch 로 붙이면 CORS preflight 에서 막힌다(교차 출처 요청 위조 차단).
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return reply({ ok: false, reason: 'invalid' }, 400);
  }
  let body: { email?: unknown; locale?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; locale?: unknown };
  } catch {
    return reply({ ok: false, reason: 'invalid' }, 400);
  }

  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '');
  if (!isAllowedEmail(email)) return reply({ ok: false, reason: 'domain' }, 400);
  const locale: Locale = routing.locales.includes(body.locale as Locale)
    ? (body.locale as Locale)
    : routing.defaultLocale;

  const isDev = process.env.NODE_ENV !== 'production';
  const store = thesisOtpStore();
  const now = Date.now();

  let existing;
  try {
    existing = await store.get(email);
  } catch (err) {
    console.error('[thesis-submit] 인증 기록 조회 실패', err);
    return reply({ ok: false, reason: 'server', message: 'db' }, 500);
  }

  // 같은 주소 재발송 쿨다운 — 남은 초를 알려 주면 화면이 그만큼 버튼을 잠근다(B4)
  if (existing?.otpSentAt != null) {
    const elapsed = now - existing.otpSentAt;
    if (elapsed >= 0 && elapsed < OTP_RESEND_COOLDOWN_MS) {
      const retryAfter = Math.max(1, Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000));
      return reply({ ok: false, reason: 'rate', retryAfter }, 429);
    }
  }

  // 한 곳에서 여러 주소로 퍼붓는 것 — 화면에는 같은 B4 로 보인다
  const ipRetry = takeIpSlot(request, now);
  if (ipRetry !== null) return reply({ ok: false, reason: 'rate', retryAfter: ipRetry }, 429);

  // 설정 확인은 저장보다 먼저 — 받을 수 없는 코드를 저장하고 쿨다운까지 거는 일을 막는다
  if (!isDev && !mailConfigured()) {
    console.error('[thesis-submit] 메일 발송 env(BREVO_API_KEY·OTP_FROM_EMAIL) 미설정');
    return reply({ ok: false, reason: 'server', message: 'mail-unconfigured' }, 503);
  }

  // dev 는 고정 코드(메일 없이 흐름 시험) — 저장소도 dev 에선 메모리다
  const code = isDev ? DEV_OTP_CODE : String(randomInt(0, 1_000_000)).padStart(6, '0');
  try {
    await store.issue(email, createHash('sha256').update(code).digest('hex'), now + OTP_TTL_MS, now);
  } catch (err) {
    console.error('[thesis-submit] 인증번호 저장 실패', err);
    return reply({ ok: false, reason: 'server', message: 'db' }, 500);
  }

  // 메일 문구는 dev 에서도 조립한다 — 번역 키 누락을 발송 없이도 여기서 드러내려는 것
  let mail: { subject: string; copy: OtpEmailCopy };
  try {
    mail = await mailFor(locale, code);
  } catch (err) {
    console.error('[thesis-submit] 메일 문구 조립 실패', err);
    return reply({ ok: false, reason: 'server', message: 'mail-copy' }, 500);
  }
  const html = otpEmailHtml(code, mail.copy);

  if (isDev) return reply({ ok: true, devCode: DEV_OTP_CODE });

  const sent = await sendBrevoMail({ to: email, subject: mail.subject, html, logTag: '[thesis-submit]' });
  if (!sent.ok) {
    // 받지 못한 코드의 발급 기록을 되돌린다 — 남겨 두면 60초 쿨다운이 걸려 화면의
    // "다시 시도" 버튼이 곧바로 429 를 맞는다(재시도 가능해야 한다). 새 발급이 이전 코드를
    // 이미 덮어썼으므로 지워도 잃는 것이 없다.
    await store.consume(email).catch((err) => console.error('[thesis-submit] 발급 기록 되돌리기 실패', err));
    return reply(
      { ok: false, reason: 'server', message: sent.reason === 'unconfigured' ? 'mail-unconfigured' : 'mail-failed' },
      sent.reason === 'unconfigured' ? 503 : 502,
    );
  }
  return reply({ ok: true });
}
