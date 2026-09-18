/**
 * Brevo(구 Sendinblue) 트랜잭션 메일 발송 — CMS 로그인 인증번호와 학위논문심사 공고 등록
 * 인증번호가 함께 쓴다. 발신 주소·이름·API 키는 기존 env 그대로(BREVO_API_KEY ·
 * OTP_FROM_EMAIL · OTP_FROM_NAME).
 *
 * 설정 확인(mailConfigured)을 발송과 분리한 이유: CMS 라우트는 "메일을 못 보내는 환경"이면
 * 인증번호를 DB 에 저장하기 **전에** 503 을 돌려준다. 발송 함수 안에서만 확인하면 그
 * 순서가 뒤집혀, 받을 수 없는 코드가 저장되고 재발송 쿨다운까지 걸린다.
 */

/** 메일 발송에 필요한 env 가 모두 있는가 */
export function mailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY && process.env.OTP_FROM_EMAIL);
}

export type SendMailResult = { ok: true } | { ok: false; reason: 'unconfigured' | 'failed' };

/**
 * 메일 한 통 발송. 실패는 throw 하지 않고 결과로 돌려준다 — 호출부가 상태코드(503/502)를
 * 고르는 데 필요한 것은 "설정이 없다 / 보냈는데 실패했다" 구분뿐이다.
 * 실패 상세는 서버 로그에만 남긴다(logTag 접두사 — CMS 는 기존 로그와 같은 '[otp]').
 */
export async function sendBrevoMail({
  to,
  subject,
  html,
  logTag = '[mail]',
}: {
  to: string;
  subject: string;
  html: string;
  logTag?: string;
}): Promise<SendMailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.OTP_FROM_EMAIL;
  if (!apiKey || !from) return { ok: false, reason: 'unconfigured' };

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { email: from, name: process.env.OTP_FROM_NAME || '연세대학교 기계공학부' },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      console.error(`${logTag} Brevo 발송 실패`, res.status, await res.text().catch(() => ''));
      return { ok: false, reason: 'failed' };
    }
  } catch (err) {
    console.error(`${logTag} Brevo 요청 오류`, err);
    return { ok: false, reason: 'failed' };
  }
  return { ok: true };
}
