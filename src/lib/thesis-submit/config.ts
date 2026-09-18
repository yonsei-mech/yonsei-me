/**
 * 학위논문심사 공고 직접 제출 — 공용 설정·상수·API 계약(클라이언트·서버 공용).
 *
 * 흐름: 대학원생이 학교 이메일로 본인 확인(화면 B, /graduate/thesis/submit) → 공고 내용
 * 입력(/graduate/thesis/submit/form) → 학과사무실 확인 → 학위논문심사 게시판에 게시.
 * 디자인 원본은 files/학위논문심사 공고 등록 디자인/spec.md.
 *
 * ⚠️ 학생 인증은 CMS 인증과 **완전히 분리**한다. cms_users·Auth.js(signIn('email-otp'))를
 *    재사용하면 학생에게 CMS 관리자 세션이 생긴다. 별도 테이블(thesis_submit_otps) +
 *    별도 API(/api/thesis-submit/*) + 별도 서명 쿠키(thesis_submit)만 쓴다.
 *
 * ⚠️ 이 파일은 클라이언트 컴포넌트(ThesisVerifyFlow)도 import 한다 — node 전용 모듈·
 *    서버 전용 import 를 여기에 들이지 마라. process.env 는 읽기만 하고(서버에서만 의미 있음),
 *    NEXT_PUBLIC_ 이 아니라 클라이언트 번들에는 값이 실리지 않는다.
 */

/**
 * 기능 플래그. main 푸시 = Cafe24 프로덕션 자동 배포라, 제출 흐름 전체(공고 입력·파일
 * 업로드·학과 확인)가 완성되기 전에는 프로덕션에서 꺼져 있어야 한다. 켜려면 서버 env 에
 * THESIS_SUBMIT_ENABLED=1. 꺼져 있으면 두 페이지는 notFound(), API 는 404 JSON.
 */
export function isThesisSubmitEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.THESIS_SUBMIT_ENABLED === '1';
}

// ── 상수 ────────────────────────────────────────────────────────────────

/** 인증번호 유효 시간 — 메일 도착 지연을 감안해 10분(CMS 와 같은 값) */
export const OTP_TTL_MS = 10 * 60 * 1000;
/** 같은 이메일 재발송 쿨다운 — 메일 폭탄·비용 방지(CMS 와 같은 값) */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
/** 오입력 허용 횟수 — 이 횟수째 오답에서 코드를 폐기한다(5번째 오답은 곧바로 locked) */
export const OTP_MAX_ATTEMPTS = 5;
/** 화면 문구에 쓰는 분 단위 유효 시간 */
export const OTP_TTL_MINUTES = OTP_TTL_MS / 60_000;
/** 제출 세션(서명 쿠키) 수명 — 공고 입력을 마칠 만큼 넉넉히 60분 */
export const SESSION_MAX_AGE_S = 60 * 60;

/** IP 단위 발급 제한 — 창 10분에 10회 (메모리 전용, DB 에 IP 를 남기지 않는다) */
export const IP_WINDOW_MS = 10 * 60 * 1000;
export const IP_MAX_REQUESTS = 10;

/** 허용 도메인 — 정확히 `@yonsei.ac.kr` 로 끝나는 주소만(하위 도메인·유사 도메인 불가) */
export const ALLOWED_EMAIL_DOMAIN = 'yonsei.ac.kr';

// ── 경로(로케일 접두사 없음, 선행 슬래시 있음) ─────────────────────────────

export const THESIS_SUBMIT_PATH = '/graduate/thesis/submit';
export const THESIS_SUBMIT_FORM_PATH = '/graduate/thesis/submit/form';

/**
 * 학과 양식(심사 공고문) 파일 URL. 양식 파일이 아직 없어 null — null 이면 안내 카드의
 * "심사 공고문 양식 내려받기" 링크를 렌더하지 않는다. 파일이 생기면 여기에만 넣는다.
 */
export const THESIS_NOTICE_TEMPLATE_URL: string | null = null;

/** 클라이언트 세션 저장소 키 — 모바일 메일 앱 왕복 뒤 탭 리로드 복원용({email, sentAt}만) */
export const PENDING_STORAGE_KEY = 'thesis-submit:pending';

// ── 이메일 정규화·검사 (클라이언트 선검사와 서버 검사가 같은 함수를 쓴다) ──────

/** 저장·비교·발송의 단일 형태 — 앞뒤 공백 제거 + 소문자 */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

const ALLOWED_EMAIL_RE = /^[^\s@]+@yonsei\.ac\.kr$/;

/** 정규화된 주소가 허용 도메인의 형식에 맞는가 (로컬 파트 1자 이상, @ 하나) */
export function isAllowedEmail(normalized: string): boolean {
  return normalized.length <= 254 && ALLOWED_EMAIL_RE.test(normalized);
}

/** 6자리 숫자 코드 형식 */
export function isCodeFormat(code: unknown): code is string {
  return typeof code === 'string' && /^\d{6}$/.test(code);
}

// ── API 계약 ─────────────────────────────────────────────────────────────
// 서버는 문구를 보내지 않는다 — 클라이언트가 reason 으로 로케일 문구를 고른다.
// message 는 서버 로그 대조용 참고값일 뿐 화면에 쓰지 않는다.

/** POST /api/thesis-submit/otp/request  body: { email, locale } */
export type OtpRequestResponse =
  /** 발송 성공. dev 에서만 devCode('000000')가 온다 */
  | { ok: true; devCode?: string }
  /** 400 — 허용 도메인·형식이 아님 */
  | { ok: false; reason: 'domain' }
  /** 429 — 이메일 쿨다운 또는 IP 제한. retryAfter 초 뒤 재시도 가능 */
  | { ok: false; reason: 'rate'; retryAfter: number }
  /** 400 — 본문이 JSON 이 아님 등 요청 자체가 잘못됨 */
  | { ok: false; reason: 'invalid' }
  /** 404 — 기능 플래그 꺼짐 */
  | { ok: false; reason: 'disabled' }
  /** 500(DB) / 502(발송 실패) / 503(메일·서명 키 미설정) */
  | { ok: false; reason: 'server'; message?: string };

/** POST /api/thesis-submit/otp/verify  body: { email, code } */
export type OtpVerifyResponse =
  /** 200 — 확인 완료 + Set-Cookie(thesis_submit) */
  | { ok: true }
  /** 401 — 오답. remaining = 남은 입력 기회(1 이상 — 마지막 오답은 locked 로 온다) */
  | { ok: false; reason: 'wrong'; remaining: number }
  /** 423 — 오입력 한도 소진으로 코드 폐기. 새 코드를 받아야 한다 */
  | { ok: false; reason: 'locked' }
  /** 410 — 유효 시간 경과, 또는 발급 기록 없음(이미 사용·폐기 포함) */
  | { ok: false; reason: 'expired' }
  /** 400 — 이메일·코드 형식 오류 */
  | { ok: false; reason: 'invalid' }
  /** 404 — 기능 플래그 꺼짐 */
  | { ok: false; reason: 'disabled' }
  /** 5xx */
  | { ok: false; reason: 'server'; message?: string };
