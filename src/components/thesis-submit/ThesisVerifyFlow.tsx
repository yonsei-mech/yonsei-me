'use client';

/**
 * 학위논문심사 › 심사 공고 등록 — 화면 B "본인 확인" (좌측 안내 + 우측 인증 폼).
 * 디자인 원본: files/학위논문심사 공고 등록 디자인/spec.md §3, 프레임 B1~B8(design-src/frames-*).
 *
 * 두 열을 **한 클라이언트 컴포넌트**가 그린다 — 확인이 끝나면(B8) 좌측 안내의 단계 표시
 * (1단계 완료 · 2단계 "다음 단계")가 폼 상태를 따라 바뀌어야 하기 때문이다.
 *
 * 폼은 CMS 로그인(LoginScreen)과 같은 시각 언어·부품(OtpInput·ErrorBox)을 쓰지만 인증은
 * 완전히 별개다: /api/thesis-submit/otp/* + 서명 쿠키. Auth.js signIn 을 부르지 않는다.
 *
 * 상태(프레임 ID):
 *   B1 이메일 기본 · B2 전송 중 · B3 도메인 오류(입력 아래) · B4 요청 과다(버튼 아래)
 *   B5 인증번호 기본 · B6 오입력(6칸 아래) · B7 폐기(5회 소진·만료, 6칸 아래) · B8 확인 완료
 * 오류 배치 규칙: 입력이 틀린 오류는 그 입력 바로 아래, 입력과 무관한 오류는 버튼 아래.
 * 발송 실패(5xx)·네트워크 오류는 B4 자리(버튼 아래)에 두고 버튼은 활성으로 남긴다.
 *
 * 주 버튼은 `disabled` 대신 `aria-disabled` 로 잠근다 — 누른 버튼이 곧바로 disabled 가
 * 되면 초점이 문서 처음으로 튕겨 키보드·스크린리더 사용자가 자리를 잃는다(B2·B4·B7·B8).
 * 제출 핸들러가 같은 조건을 다시 확인하므로 Enter 로 우회되지 않는다.
 *
 * 탭 리로드 복원: 모바일에서 메일 앱을 오가다 탭이 다시 로드되면 입력 단계를 잃는다.
 * sessionStorage 에 {email, sentAt} 만 남겨(코드 등 비밀은 저장 금지) 발급 10분 안이면
 * 인증번호 단계로 되돌리고 재전송 카운트다운을 이어 간다. 히스토리에 단계를 push 하지 않는다.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { ErrorBox } from '@/components/auth/ErrorBox';
import { OtpInput } from '@/components/auth/OtpInput';
import { cn } from '@/lib/utils';
import {
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  PENDING_STORAGE_KEY,
  isAllowedEmail,
  normalizeEmail,
  type OtpRequestResponse,
  type OtpVerifyResponse,
} from '@/lib/thesis-submit/config';
import {
  CheckIcon,
  ThesisSubmitGuide,
  type ThesisContact,
  type ThesisGuideLabels,
} from './ThesisSubmitGuide';

/** 폼 문구 — 서버 페이지가 messages(thesisSubmit.form)에서 읽어 내려 준다.
 *  {seconds}·{email}·{count}·{code} 자리표시자가 있는 값은 원문 그대로 오고 여기서 채운다. */
export interface ThesisFormLabels {
  eyebrow: string;
  title: string;
  desc: string;
  emailLabel: string;
  emailPlaceholder: string;
  emailHint: string;
  emailEmpty: string;
  emailDomain: string;
  send: string;
  sending: string;
  /** {seconds} */
  retryIn: string;
  rateTitle: string;
  /** {seconds} */
  rateDetail: string;
  sendFailed: string;
  verifyFailed: string;
  tryLater: string;
  networkDetail: string;
  /** {email} — 이메일은 굵게 끼워 넣는다 */
  sentTo: string;
  codeLabel: string;
  codeAria: string;
  validity: string;
  resend: string;
  /** {seconds} */
  resendIn: string;
  resent: string;
  confirm: string;
  verifying: string;
  wrongTitle: string;
  /** {count} */
  wrongRemaining: string;
  reissueTitle: string;
  lockedDetail: string;
  expiredDetail: string;
  reissue: string;
  /** {seconds} */
  reissueIn: string;
  verified: string;
  verifiedButton: string;
  changeEmail: string;
  privacyNote: string;
  privacyLink: string;
  /** {code} */
  devCode: string;
}

export interface ThesisVerifyLabels {
  guide: ThesisGuideLabels;
  form: ThesisFormLabels;
}

/** 확인 완료 → 공고 입력 화면 이동까지의 대기(진행 막대 길이와 같다) */
const VERIFIED_REDIRECT_MS = 1200;

/** "{seconds}초 후" 같은 자리표시자 채우기 — ICU 가 필요 없는 단순 치환만 쓴다 */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

// ── sessionStorage (사파리 프라이빗 등에서 접근 자체가 throw 할 수 있다) ──────
function readPending(): { email: string; sentAt: number } | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { email?: unknown; sentAt?: unknown };
    if (typeof v.email !== 'string' || typeof v.sentAt !== 'number') return null;
    return { email: v.email, sentAt: v.sentAt };
  } catch {
    return null;
  }
}
function writePending(email: string, sentAt: number) {
  try {
    window.sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ email, sentAt }));
  } catch {
    /* 저장 불가 환경 — 복원만 포기한다 */
  }
}
function clearPending() {
  try {
    window.sessionStorage.removeItem(PENDING_STORAGE_KEY);
  } catch {
    /* 무시 */
  }
}

/** 버튼 아래(입력과 무관한) 오류 — rate 의 남은 초는 cooldown 이 가진다 */
type ActionError = { kind: 'rate' } | { kind: 'send' | 'verify'; network: boolean };

/** 인증번호 단계의 결과 상태 (idle=B5, wrong=B6, locked=B7, verified=B8) */
type CodeState =
  | { kind: 'idle' }
  | { kind: 'wrong'; remaining: number }
  | { kind: 'locked'; cause: 'attempts' | 'expired' }
  | { kind: 'verified' };

type FocusTarget = 'email' | 'code' | 'main';

const MAIN_BTN =
  'flex h-[52px] w-full items-center justify-center gap-2 rounded-[2px] bg-brand text-base font-semibold text-brand-fg transition-colors duration-200 ease-out-expo';
const ACCENT_TEXT = 'text-yonsei-blue dark:text-brand';

export function ThesisVerifyFlow({
  locale,
  labels,
  contact,
  formHref,
}: {
  locale: string;
  labels: ThesisVerifyLabels;
  contact: ThesisContact | null;
  /** 확인 완료 뒤 전체 이동할 공고 입력 화면(로케일 포함 경로) */
  formHref: string;
}) {
  const L = labels.form;

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  /** B3 — 입력 바로 아래 오류 */
  const [emailError, setEmailError] = useState<'empty' | 'domain' | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  /** B4·발송/확인 실패 — 버튼 아래 오류 */
  const [actionError, setActionError] = useState<ActionError | null>(null);
  /** 인증번호를 실제로 보낸 주소(정규화) — 이메일 입력을 고쳐도 코드 단계는 이 주소를 쓴다 */
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  /** 마지막으로 틀린 코드 — 같은 번호 재제출로 기회를 잃지 않게 주 버튼을 잠근다(B6) */
  const [lastWrong, setLastWrong] = useState<string | null>(null);
  const [codeState, setCodeState] = useState<CodeState>({ kind: 'idle' });
  /** dev 서버가 내려주는 고정 코드 — 메일 없이 흐름을 시험하도록 안내만 한다 */
  const [devCode, setDevCode] = useState<string | null>(null);
  /** 발급 쿨다운 — 어느 주소에 걸린 것인지 함께 둔다(다른 주소로 고치면 풀린다) */
  const [cooldown, setCooldown] = useState<{ email: string; until: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** B4 오류 박스의 스크린리더용 초(처음 값으로 고정 — 매초 다시 읽히지 않게) */
  const [rateSeconds, setRateSeconds] = useState(0);
  /** 화면에 안 보이는 알림(재전송 성공) */
  const [announce, setAnnounce] = useState('');

  const titleId = useId();
  const emailId = useId();
  const hintId = useId();
  const emailErrId = useId();
  const codeId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const mainBtnRef = useRef<HTMLButtonElement>(null);
  /** 다음 렌더 뒤 초점을 옮길 대상 — 단계가 바뀐 뒤에야 대상 요소가 생기므로 이펙트로 옮긴다 */
  const pendingFocus = useRef<FocusTarget | null>(null);
  const redirectTimer = useRef<number | null>(null);

  // 초점 이동 — 매 렌더 뒤 대기 중인 대상이 있으면 옮긴다
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const el =
      target === 'email' ? emailRef.current : target === 'code' ? codeRef.current : mainBtnRef.current;
    el?.focus();
  });

  // 탭 리로드 복원 — 발급 10분 안이면 인증번호 단계로(재전송 카운트다운은 60 - 경과초)
  useEffect(() => {
    const p = readPending();
    if (!p) return;
    const addr = normalizeEmail(p.email);
    const t = Date.now();
    const age = t - p.sentAt;
    if (age < 0 || age >= OTP_TTL_MS || !isAllowedEmail(addr)) {
      clearPending();
      return;
    }
    setEmail(addr);
    setSentTo(addr);
    setStep('code');
    const until = p.sentAt + OTP_RESEND_COOLDOWN_MS;
    if (until > t) setCooldown({ email: addr, until });
    setNow(t);
    pendingFocus.current = 'code';
  }, []);

  // 카운트다운 — 서버 쿨다운보다 먼저 풀리지 않게 올림(ceil)으로 센다
  useEffect(() => {
    if (!cooldown) return;
    const h = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= cooldown.until) setCooldown(null);
    }, 1000);
    return () => window.clearInterval(h);
  }, [cooldown]);

  // 대기가 끝나면 B4 오류 박스도 걷는다("0초 뒤에"를 남기지 않는다)
  useEffect(() => {
    if (!cooldown && actionError?.kind === 'rate') setActionError(null);
  }, [cooldown, actionError]);

  useEffect(
    () => () => {
      if (redirectTimer.current !== null) window.clearTimeout(redirectTimer.current);
    },
    [],
  );

  const cooldownLeft = cooldown ? Math.max(0, Math.ceil((cooldown.until - now) / 1000)) : 0;
  const coolingFor = (addr: string) => cooldown !== null && cooldownLeft > 0 && cooldown.email === addr;

  /** 발급 요청 — 처음 받기(send) · 재전송(resend) · 폐기 뒤 다시 받기(reissue) */
  const requestCode = useCallback(
    async (target: string, mode: 'send' | 'resend' | 'reissue') => {
      setActionError(null);
      setSending(true);
      let data: OtpRequestResponse | null = null;
      try {
        const res = await fetch('/api/thesis-submit/otp/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: target, locale }),
        });
        data = (await res.json().catch(() => null)) as OtpRequestResponse | null;
      } catch {
        setSending(false);
        setActionError({ kind: 'send', network: true });
        return;
      }
      setSending(false);

      if (data?.ok) {
        const t = Date.now();
        setSentTo(target);
        setDevCode(data.devCode ?? null);
        setCooldown({ email: target, until: t + OTP_RESEND_COOLDOWN_MS });
        setNow(t);
        setCode('');
        setLastWrong(null);
        setCodeState({ kind: 'idle' });
        writePending(target, t);
        if (mode === 'send') {
          setStep('code');
        } else {
          // 같은 문장이 연달아 오면 live region 이 다시 읽지 않는다 — 보이지 않는 글자로 바꿔 준다
          setAnnounce((prev) => (prev === L.resent ? `${L.resent}​` : L.resent));
        }
        pendingFocus.current = 'code';
        return;
      }
      if (data && !data.ok && data.reason === 'rate') {
        const secs = Math.max(1, Math.ceil(data.retryAfter));
        const t = Date.now();
        setCooldown({ email: target, until: t + secs * 1000 });
        setNow(t);
        setRateSeconds(secs);
        setActionError({ kind: 'rate' });
        return;
      }
      if (data && !data.ok && data.reason === 'domain' && mode === 'send') {
        // 클라이언트 선검사를 통과했어도 판정의 주인은 서버다
        setEmailError('domain');
        pendingFocus.current = 'email';
        return;
      }
      // 5xx·예상 밖 응답 — 버튼 아래에 두고 버튼은 활성(다시 시도 가능)
      setActionError({ kind: 'send', network: false });
    },
    [locale, L.resent],
  );

  async function onSubmitEmail() {
    if (sending) return;
    const target = normalizeEmail(email);
    if (!target) {
      setEmailError('empty');
      emailRef.current?.focus();
      return;
    }
    if (!isAllowedEmail(target)) {
      setEmailError('domain');
      emailRef.current?.focus();
      return;
    }
    // 쿨다운 중인 같은 주소("이메일 다시 입력" 뒤 곧바로 재요청) — 서버 429 와 같은 B4 로 말한다.
    // 조용히 무시하면 잠긴 버튼을 눌러도 아무 일도 없어 이유를 알 수 없다.
    if (coolingFor(target)) {
      setRateSeconds(cooldownLeft);
      setActionError({ kind: 'rate' });
      return;
    }
    setEmailError(null);
    await requestCode(target, 'send');
  }

  async function onSubmitCode() {
    if (verifying || sending) return;
    if (codeState.kind === 'verified' || codeState.kind === 'locked') return;
    if (code.length !== 6 || code === lastWrong) return;
    setActionError(null);
    setVerifying(true);
    let data: OtpVerifyResponse | null = null;
    try {
      const res = await fetch('/api/thesis-submit/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: sentTo, code }),
      });
      data = (await res.json().catch(() => null)) as OtpVerifyResponse | null;
    } catch {
      setVerifying(false);
      setActionError({ kind: 'verify', network: true });
      return;
    }
    setVerifying(false);

    if (data?.ok) {
      setCodeState({ kind: 'verified' });
      clearPending();
      // 전체 이동 — 서버 컴포넌트가 방금 구운 쿠키를 새 요청으로 읽어야 한다
      redirectTimer.current = window.setTimeout(
        () => window.location.assign(formHref),
        VERIFIED_REDIRECT_MS,
      );
      return;
    }
    if (data && !data.ok) {
      if (data.reason === 'wrong') {
        setCodeState({ kind: 'wrong', remaining: data.remaining });
        setLastWrong(code);
        pendingFocus.current = 'code';
        return;
      }
      if (data.reason === 'locked' || data.reason === 'expired') {
        setCodeState({ kind: 'locked', cause: data.reason === 'locked' ? 'attempts' : 'expired' });
        setCode('');
        setLastWrong(null);
        pendingFocus.current = 'main';
        return;
      }
    }
    setActionError({ kind: 'verify', network: false });
  }

  function onChangeEmail() {
    setStep('email');
    setCode('');
    setLastWrong(null);
    setCodeState({ kind: 'idle' });
    setActionError(null);
    setEmailError(null);
    setDevCode(null);
    clearPending();
    pendingFocus.current = 'email';
  }

  const verified = codeState.kind === 'verified';

  /** 버튼 아래 오류 박스(B4 · 발송/확인 실패) */
  let actionBox: ReactNode = null;
  if (actionError?.kind === 'rate' && cooldownLeft > 0) {
    actionBox = (
      <ErrorBox
        detail={
          <>
            {/* 보이는 초는 매초 바뀌지만 alert 안이라 읽히면 매초 방송된다 — 보이는 쪽은
                보조기기에서 숨기고, 처음 초를 고정한 문장을 대신 읽힌다 */}
            <span aria-hidden="true">{fill(L.rateDetail, { seconds: cooldownLeft })}</span>
            <span className="sr-only">{fill(L.rateDetail, { seconds: rateSeconds })}</span>
          </>
        }
      >
        {L.rateTitle}
      </ErrorBox>
    );
  } else if (actionError && actionError.kind !== 'rate') {
    actionBox = (
      <ErrorBox detail={actionError.network ? L.networkDetail : L.tryLater}>
        {actionError.kind === 'send' ? L.sendFailed : L.verifyFailed}
      </ErrorBox>
    );
  }

  return (
    <div className="mt-6 lg:mt-12 lg:grid lg:grid-cols-[55fr_45fr] lg:items-start lg:gap-x-16">
      <ThesisSubmitGuide
        labels={labels.guide}
        contact={contact}
        verified={verified}
      />

      <div className="mt-8 lg:mt-0 lg:flex lg:justify-center">
        {/* 폼 위 41px = 안내 카드 테두리 1 + 안쪽 40 — 아이브로가 카드 첫 줄과 같은 높이에 온다 */}
        <form
          noValidate
          aria-labelledby={titleId}
          onSubmit={(e) => {
            e.preventDefault();
            void (step === 'email' ? onSubmitEmail() : onSubmitCode());
          }}
          className="w-full max-w-[480px] lg:max-w-[400px] lg:pt-[41px]"
        >
          <p className={cn('text-[12px] font-bold uppercase leading-[18px] tracking-[0.18em]', ACCENT_TEXT)}>
            {L.eyebrow}
          </p>
          <h2
            id={titleId}
            className="mt-2.5 font-subhead text-2xl font-bold leading-[1.3] tracking-[-0.01em] text-content lg:text-[28px]"
          >
            {L.title}
          </h2>
          <p className="mt-2.5 text-[15px] leading-[1.7] text-content-faint">{L.desc}</p>

          {step === 'email'
            ? renderEmailStep()
            : renderCodeStep()}

          {/* 알림 전용(보이지 않음) — 재전송 성공. 카운트다운 숫자는 이 영역 밖에 둔다 */}
          <p role="status" aria-live="polite" className="sr-only">
            {announce}
          </p>

          <p className="mt-8 border-t border-surface-border pt-[18px] text-[12.5px] leading-[1.7] text-content-faint">
            {L.privacyNote}{' '}
            <Link
              href="/privacy"
              prefetch={false}
              className={cn(
                'whitespace-nowrap font-semibold underline decoration-1 underline-offset-[3px]',
                ACCENT_TEXT,
              )}
            >
              {L.privacyLink}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );

  // ── 1단계: 이메일 (B1~B4) ─────────────────────────────────────────────
  function renderEmailStep() {
    const locked = coolingFor(normalizeEmail(email));
    const inert = sending || locked;
    return (
      <div className="mt-7 flex flex-col gap-2.5 lg:mt-8">
        <label htmlFor={emailId} className="text-sm font-semibold leading-5 text-content">
          {L.emailLabel}
        </label>
        <input
          ref={emailRef}
          id={emailId}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={L.emailPlaceholder}
          value={email}
          // 전송 중엔 readOnly(옅은 면) — disabled 는 초점을 잃게 해서 쓰지 않는다
          readOnly={sending}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? emailErrId : hintId}
          onChange={(e) => {
            setEmail(e.target.value);
            // 입력을 고치면 오류를 즉시 걷는다(B3·버튼 아래 오류 모두)
            if (emailError) setEmailError(null);
            if (actionError) setActionError(null);
          }}
          className={cn(
            'h-[50px] w-full rounded-[2px] border px-3.5 text-base outline-none transition-colors placeholder:text-[#A8B0BA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue dark:placeholder:text-[#5E6C84] dark:focus-visible:outline-brand',
            sending ? 'bg-surface-soft text-content-faint' : 'bg-surface text-content',
            emailError ? 'border-[#B42318] dark:border-[#F2837B]' : 'border-surface-border',
          )}
        />
        {emailError ? (
          <ErrorBox id={emailErrId}>{emailError === 'empty' ? L.emailEmpty : L.emailDomain}</ErrorBox>
        ) : (
          <p id={hintId} className="text-[13px] leading-[1.6] text-content-faint">
            {L.emailHint}
          </p>
        )}
        <button
          ref={mainBtnRef}
          type="submit"
          aria-disabled={inert || undefined}
          aria-busy={sending || undefined}
          className={cn(
            MAIN_BTN,
            'mt-1.5',
            inert ? 'cursor-not-allowed opacity-60' : 'hover:bg-brand-muted',
          )}
        >
          {sending ? (
            <>
              <Spinner />
              {L.sending}
            </>
          ) : locked ? (
            fill(L.retryIn, { seconds: cooldownLeft })
          ) : (
            L.send
          )}
        </button>
        {actionBox}
      </div>
    );
  }

  // ── 2단계: 인증번호 (B5~B8) ───────────────────────────────────────────
  function renderCodeStep() {
    const [before, after] = splitOnce(L.sentTo, '{email}');
    const locked = codeState.kind === 'locked';
    const cooling = coolingFor(sentTo);

    let mainLabel: ReactNode;
    let mainInert: boolean;
    let mainType: 'submit' | 'button' = 'submit';
    let mainOnClick: (() => void) | undefined;
    if (verified) {
      mainLabel = (
        <>
          {L.verifiedButton}
          <CheckIcon className="h-[18px] w-[18px]" />
        </>
      );
      mainInert = true;
    } else if (locked) {
      mainType = 'button';
      mainInert = sending || cooling;
      mainLabel = sending ? (
        <>
          <Spinner />
          {L.sending}
        </>
      ) : cooling ? (
        fill(L.reissueIn, { seconds: cooldownLeft })
      ) : (
        L.reissue
      );
      mainOnClick = () => {
        if (!sending && !coolingFor(sentTo)) void requestCode(sentTo, 'reissue');
      };
    } else {
      mainInert = verifying || sending || code.length !== 6 || code === lastWrong;
      mainLabel = verifying ? L.verifying : L.confirm;
    }

    return (
      <div className="mt-7 flex flex-col gap-2.5 lg:mt-8">
        <p className="text-sm leading-[1.6] text-content-faint">
          {before}
          <strong className="font-semibold text-content">{sentTo}</strong>
          {after}
        </p>
        <label htmlFor={codeId} className="text-sm font-semibold leading-5 text-content">
          {L.codeLabel}
        </label>
        <OtpInput
          id={codeId}
          value={code}
          // 붉은 표시는 "지금 보이는 번호가 틀린 번호"일 때만 — 한 칸이라도 고치면 걷힌다
          invalid={codeState.kind === 'wrong' && code === lastWrong}
          locked={locked}
          verified={verified}
          ariaLabel={L.codeAria}
          inputRef={codeRef}
          onChangeValue={(v) => {
            setCode(v);
            if (actionError?.kind === 'verify') setActionError(null);
          }}
          // 6자리가 차면 초점만 주 버튼으로 — 자동 제출하지 않는다(CMS 와 동일)
          onComplete={() => mainBtnRef.current?.focus()}
        />

        {/* 입력이 틀린 오류·상태는 6칸 바로 아래 */}
        {codeState.kind === 'wrong' && (
          <ErrorBox detail={fill(L.wrongRemaining, { count: codeState.remaining })}>{L.wrongTitle}</ErrorBox>
        )}
        {codeState.kind === 'locked' && (
          <ErrorBox detail={codeState.cause === 'attempts' ? L.lockedDetail : L.expiredDetail}>
            {L.reissueTitle}
          </ErrorBox>
        )}
        {verified && (
          <div
            role="status"
            className="mt-1 overflow-hidden rounded-[2px] border border-yonsei-blue bg-surface-soft dark:border-brand"
          >
            <p className={cn('flex gap-2.5 px-3.5 py-3 text-sm font-semibold leading-[1.6]', ACCENT_TEXT)}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
                className="mt-[3px] h-4 w-4 shrink-0"
              >
                <circle cx="12" cy="12" r="9.25" />
                <path d="m7.75 12.25 3 3 5.5-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{L.verified}</span>
            </p>
            <div aria-hidden="true" className="h-0.5 bg-surface-border">
              <i className="thesis-submit-progress block h-full bg-yonsei-blue dark:bg-brand" />
            </div>
          </div>
        )}

        {/* 유효시간 · 재전송 — 폐기(B7)·확인 완료(B8)에서는 숨긴다 */}
        {!locked && !verified && (
          <div className="flex items-center justify-between gap-4 text-[13px] leading-[19.5px] text-content-faint">
            <span>{L.validity}</span>
            <button
              type="button"
              onClick={() => {
                if (!sending && !coolingFor(sentTo)) void requestCode(sentTo, 'resend');
              }}
              // 주 버튼과 같은 이유로 aria-disabled — 누른 뒤 잠겨도 초점이 튕기지 않는다
              aria-disabled={sending || cooling || undefined}
              className={cn(
                '-mx-1.5 -my-3 inline-flex min-h-[44px] shrink-0 items-center px-1.5 text-[13px] font-semibold lg:-my-1.5 lg:min-h-8',
                sending || cooling ? 'cursor-not-allowed text-content-faint' : cn(ACCENT_TEXT, 'hover:underline'),
              )}
            >
              {sending ? L.sending : cooling ? fill(L.resendIn, { seconds: cooldownLeft }) : L.resend}
            </button>
          </div>
        )}

        {devCode && !verified && (
          <p className="text-[12px] font-semibold text-content-faint">{fill(L.devCode, { code: devCode })}</p>
        )}

        <button
          ref={mainBtnRef}
          type={mainType}
          onClick={mainOnClick}
          aria-disabled={mainInert || undefined}
          aria-busy={(locked && sending) || verifying || undefined}
          className={cn(
            MAIN_BTN,
            'mt-2',
            // 확인 완료(B8)는 잠겨 있어도 흐리게 하지 않는다 — 실패가 아니라 끝난 상태다(프레임)
            verified ? 'cursor-default' : mainInert ? 'cursor-not-allowed opacity-60' : 'hover:bg-brand-muted',
          )}
        >
          {mainLabel}
        </button>

        {actionBox}

        {!verified && (
          <button
            type="button"
            onClick={onChangeEmail}
            className="-mx-1.5 -mb-3 -mt-2.5 inline-flex min-h-[44px] items-center self-start px-1.5 text-[13.5px] leading-5 text-content-faint hover:text-yonsei-blue hover:underline dark:hover:text-brand lg:-mb-1.5 lg:-mt-1 lg:min-h-8"
          >
            {L.changeEmail}
          </button>
        )}
      </div>
    );
  }
}

/** "{email}" 같은 자리표시자 하나를 기준으로 앞·뒤를 나눈다(굵은 글자를 끼워 넣으려고) */
function splitOnce(s: string, token: string): [string, string] {
  const i = s.indexOf(token);
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + token.length)];
}

/** "전송 중…" 스피너 링 — 장식(버튼 글자가 그대로 읽힌다) */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="thesis-submit-spin h-4 w-4 shrink-0 rounded-full border-2 border-current border-r-transparent"
    />
  );
}
