'use client';

// 콘텐츠 관리 콘솔 로그인 — 사이트 크롬 없이 화면 전체를 쓰는 독립 진입 화면.
// 레이아웃·상태 시각화는 Claude Design 목업(CMS 로그인.dc.html)이 원본이다:
// 좌측 네이비 패널(사이트 헤더와 같은 자리의 로고 락업 + 독수리 워터마크) +
// 우측 폼(이메일 → 인증번호 단계 전환), 오류는 붉은 박스, 카카오 안내는
// 소셜 버튼 아래 별도 박스.
//
// 수단이 셋(이메일 인증번호 · 카카오 · GitHub)이지만 셋을 나란히 놓으면
// "나는 뭘 눌러야 하나"가 매번 새 결정이 된다. 그래서 기본 경로인 이메일
// 인증번호만 폼으로 펼쳐 두고, 나머지 둘은 구분선 아래 보조 수단으로 내린다.
//
// 인증번호 검증은 fetch 가 아니라 Auth.js 의 signIn('email-otp') 이다.
// 세션 쿠키를 굽는 주체가 Auth.js 라, 코드 확인만 따로 API 로 하면 "맞았는데
// 로그인은 안 된" 상태가 생긴다.
//
// 버튼·강조색은 시맨틱 토큰(brand)을 쓴다 — 다크모드에서 네이비가 배경에
// 묻히므로 밝은 블루(#60A5FA) + 어두운 글자로 자동 반전되어야 한다.
//
// 내부 운영 도구라 한국어 UI 문자열을 컴포넌트에 직접 둔다.

import { signIn } from 'next-auth/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Logo } from '@/components/Logo';
// 오류 박스·6칸 입력은 학위논문심사 공고 등록(학생 본인 확인)과 함께 쓰려고
// src/components/auth/ 로 옮겼다(2026-09). 이 화면의 출력은 옮기기 전과 같다.
import { ErrorBox } from '@/components/auth/ErrorBox';
import { OtpInput } from '@/components/auth/OtpInput';

interface Props {
  /** 로그인 후 돌아갈 콘솔 경로에 쓸 로케일 */
  locale: string;
}

/** 재전송 잠금(초) — 서버 발송 제한과 같은 값이라 눌러 봐야 429 가 나는 시간대를 없앤다 */
const RESEND_SECONDS = 60;

/** 미연결 카카오 안내 — 오류가 아니라 "다음에 할 일"이라 붉은 박스 대신 안내 박스로 말한다 */
const KAKAO_UNLINKED_MSG =
  '아직 연결되지 않은 카카오 계정입니다. 먼저 이메일 인증으로 로그인한 뒤, 콘솔의 계정 영역에서 카카오 계정을 연결해 주세요.';

export function LoginScreen({ locale }: Props) {
  const consoleUrl = `/${locale}/contentmanagement`;

  // 단계는 둘뿐이다: 이메일을 받는 화면 → 코드를 받는 화면.
  // 한 화면에 둘 다 두면(코드 칸을 미리 비워 두면) 아직 오지도 않은 번호를
  // 넣으라고 재촉하는 꼴이라, 실제로 발송에 성공했을 때만 다음 칸을 연다.
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 카카오 미연결 안내(오류 박스가 아니라 안내 박스) */
  const [kakaoNotice, setKakaoNotice] = useState(false);
  /** 로그인 성공 → 콘솔로 이동하는 사이의 확인 표시 */
  const [done, setDone] = useState(false);
  /** dev 서버가 내려주는 고정 코드 — 메일 발송 없이 흐름을 시험할 수 있게 안내만 한다 */
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const emailFieldId = useId();
  const codeFieldId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  /** 6자리 완성 시 초점을 넘겨받는 로그인 버튼 (OtpInput onComplete) */
  const loginBtnRef = useRef<HTMLButtonElement>(null);

  // ?error= 안내 — useSearchParams 는 이 프로젝트에서 정적 생성과 충돌해 금지다.
  // 읽은 뒤 쿼리를 지운다: 새로고침해도 남아 있으면 이미 해결된 사정을 계속 말한다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get('error');
    if (!key) return;
    if (key === 'kakao-unlinked') setKakaoNotice(true);
    else if (key === 'AccessDenied') setError('허용되지 않은 계정입니다. 학과 관리자에게 문의해 주세요.');
    else setError('로그인하지 못했습니다. 다시 시도해 주세요.');
    params.delete('error');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);

  // 재전송 카운트다운
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  // 단계가 바뀌면 그 단계의 입력으로 초점을 옮긴다 — 코드를 받아 놓고 커서를
  // 직접 찾아 클릭하게 두면 6자리를 넣기까지의 동작이 두 배가 된다.
  useEffect(() => {
    if (step === 'email') emailRef.current?.focus();
    else codeRef.current?.focus();
  }, [step]);

  const requestCode = useCallback(async (target: string): Promise<boolean> => {
    setError(null);
    setSending(true);
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target }),
      });
      const data: { error?: string; devCode?: string; retryAfter?: number } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        // 429 는 남은 대기 시간을 알려 준다 — 그만큼 재전송을 잠가야 버튼이
        // "눌리지만 매번 실패하는" 상태로 남지 않는다.
        if (res.status === 429 && typeof data.retryAfter === 'number') {
          setCooldown(Math.max(1, Math.ceil(data.retryAfter)));
        }
        setError(data.error ?? '인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return false;
      }
      setDevCode(data.devCode ?? null);
      setCooldown(RESEND_SECONDS);
      return true;
    } catch {
      setError('네트워크 오류로 인증번호를 보내지 못했습니다.');
      return false;
    } finally {
      setSending(false);
    }
  }, []);

  async function onSubmitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    const target = email.trim();
    if (!target) {
      setError('이메일을 입력해 주세요.');
      return;
    }
    if (await requestCode(target)) {
      setCode('');
      setKakaoNotice(false);
      setStep('code');
    }
  }

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (verifying) return;
    setError(null);
    setVerifying(true);
    try {
      const res = await signIn('email-otp', { email: email.trim(), code, redirect: false });
      if (res?.error) {
        setError('인증번호가 올바르지 않거나 만료되었습니다. 다시 확인해 주세요.');
        setCode('');
        codeRef.current?.focus();
        return;
      }
      // router.push 가 아니라 전체 이동 — 세션 쿠키가 막 생겼으므로 서버
      // 컴포넌트를 새 요청으로 다시 그려야 콘솔이 인증된 상태로 뜬다.
      // 이동까지의 공백 동안 확인 박스를 보여 "눌렀는데 조용한" 순간을 없앤다.
      setDone(true);
      window.location.href = consoleUrl;
    } catch {
      setError('로그인 처리 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      {/* 좌측 브랜드 패널 — 다크모드에서도 네이비 계열을 유지한다(더 깊은 톤으로만
          가라앉힘). 이 면은 배경이 아니라 "학과의 도구"라는 표시라, 배경색이
          그대로 반전되면 정체가 흐려진다. */}
      <aside className="relative flex shrink-0 flex-col gap-3.5 overflow-hidden bg-yonsei-navy px-5 pb-6 text-white dark:bg-[#0A1424] lg:w-[42%] lg:justify-between lg:gap-12 lg:px-0 lg:pb-[60px]">
        {/* 독수리 워터마크 — 데스크톱 전용. 선 장식 대신 학교 상징을 은은하게 깐다. */}
        <div
          aria-hidden="true"
          className="eagle-mask pointer-events-none absolute -bottom-10 -right-[70px] hidden h-[420px] w-[420px] bg-white opacity-[0.12] dark:opacity-[0.16] lg:block"
        />
        {/* 로고 락업 — 실제 사이트 헤더와 같은 자리·크기(모바일 h-16, 데스크톱 h-20,
            1440 뷰포트 기준 좌측 인셋 72px = 컨테이너 max 1360 + px-8). */}
        <div className="relative flex h-16 items-center lg:h-20 lg:px-[72px]">
          <Logo />
        </div>
        <div className="relative lg:pl-[72px] lg:pr-14">
          <p className="mb-3.5 text-[12px] font-bold uppercase tracking-[0.22em] text-white/85">
            Yonsei Mechanical Engineering
          </p>
          <h2 className="font-subhead text-[21px] font-bold leading-[1.35] tracking-[-0.02em] lg:text-[40px] lg:leading-[1.18]">
            콘텐츠 관리 콘솔
          </h2>
          <p className="mt-5 hidden max-w-[22em] text-base leading-[1.75] text-white/70 dark:text-[#BAC5D6] lg:block">
            학과 홈페이지의 모든 콘텐츠를 한곳에서 편집합니다
          </p>
        </div>
      </aside>

      {/* 우측 폼 — 세로·가로 모두 가운데. 폼 폭을 400px 로 묶어 두면 넓은 화면에서도
          한 줄 길이가 읽기 좋은 범위에 남는다. */}
      <div className="flex flex-1 bg-surface px-5 pb-9 pt-6 lg:items-center lg:justify-center lg:p-16">
        <div className="w-full lg:max-w-[400px]">
          <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-yonsei-blue dark:text-brand">
            Content Management
          </p>
          <h1 className="mt-2.5 font-subhead text-[28px] font-bold tracking-[-0.01em] text-content">
            관리자 로그인
          </h1>
          <p className="mt-2.5 text-[15px] leading-[1.7] text-content-faint">
            등록된 학과 이메일로 인증번호를 받아 로그인합니다.
          </p>

          {step === 'email' ? (
            <form onSubmit={onSubmitEmail} className="mt-8 flex flex-col gap-2.5" noValidate>
              <label htmlFor={emailFieldId} className="text-sm font-semibold text-content">
                이메일
              </label>
              <input
                ref={emailRef}
                id={emailFieldId}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@yonsei.ac.kr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-[50px] w-full rounded-[2px] border border-surface-border bg-surface px-3.5 text-base text-content outline-none transition-colors placeholder:text-[#a8b0ba] focus:border-yonsei-blue"
              />
              <button
                type="submit"
                disabled={sending}
                className="mt-1.5 h-[52px] w-full rounded-[2px] bg-brand text-base font-semibold text-brand-fg transition-colors duration-200 ease-out-expo hover:bg-brand-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? '전송 중…' : '인증번호 받기'}
              </button>
              {error && <ErrorBox>{error}</ErrorBox>}
            </form>
          ) : (
            <form onSubmit={onSubmitCode} className="mt-8 flex flex-col gap-2.5" noValidate>
              <p className="text-sm leading-[1.6] text-content-faint">
                인증번호를 <strong className="font-semibold text-content">{email}</strong> 로
                보냈습니다.
              </p>
              <label htmlFor={codeFieldId} className="text-sm font-semibold text-content">
                인증번호 6자리
              </label>
              <OtpInput
                id={codeFieldId}
                value={code}
                invalid={Boolean(error)}
                inputRef={codeRef}
                onChangeValue={(v) => {
                  setCode(v);
                  if (error) setError(null);
                }}
                // 6자리가 차면 로그인 버튼으로 초점만 옮긴다 — 자동 제출은 하지
                // 않는다(오입력을 확인할 틈을 준다). 목업의 동작 명세 그대로.
                onComplete={() => loginBtnRef.current?.focus()}
              />
              {/* 오류는 6칸 바로 아래 — 시선이 머무는 곳에서 말한다(목업 배치) */}
              {error && <ErrorBox>{error}</ErrorBox>}
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[13px] text-content-faint">코드는 10분간 유효합니다</span>
                <button
                  type="button"
                  onClick={() => void requestCode(email.trim())}
                  disabled={sending || cooldown > 0}
                  className="-m-1.5 p-1.5 text-[13px] font-semibold text-yonsei-blue hover:underline disabled:cursor-not-allowed disabled:text-content-faint disabled:no-underline dark:text-brand dark:disabled:text-content-faint"
                >
                  {cooldown > 0 ? `재전송 (${cooldown}초)` : '인증번호 재전송'}
                </button>
              </div>
              {devCode && (
                <p className="text-[12px] font-semibold text-content-faint">
                  개발 모드 코드: {devCode}
                </p>
              )}
              <button
                ref={loginBtnRef}
                type="submit"
                disabled={verifying || code.length !== 6}
                className="mt-2 h-[52px] w-full rounded-[2px] bg-brand text-base font-semibold text-brand-fg transition-colors duration-200 ease-out-expo hover:bg-brand-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {verifying ? '확인 중…' : '로그인'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setDevCode(null);
                  setStep('email');
                }}
                className="-mx-1.5 mt-0.5 self-start p-1.5 text-[13.5px] text-content-faint hover:text-yonsei-blue hover:underline dark:hover:text-brand"
              >
                다른 이메일로 로그인
              </button>
            </form>
          )}

          {done && (
            <div
              role="status"
              className="mt-4 rounded-[2px] border border-yonsei-blue bg-surface-soft px-3.5 py-3 text-sm font-semibold leading-[1.6] text-yonsei-blue dark:border-brand dark:text-brand"
            >
              확인되었습니다. 콘텐츠 관리 콘솔로 이동합니다…
            </div>
          )}

          <div className="my-7 flex items-center gap-3.5" aria-hidden="true">
            <span className="h-px flex-1 bg-surface-border" />
            <span className="text-[12.5px] tracking-[0.08em] text-content-faint">또는</span>
            <span className="h-px flex-1 bg-surface-border" />
          </div>

          <div className="flex flex-col gap-2.5">
            {/* 카카오는 브랜드 규격(노랑 #FEE500 + 검정 85%)을 지켜야 하는 유일한 예외라
                사이트 토큰을 쓰지 않고 다크모드에서도 그대로 둔다. */}
            <button
              type="button"
              onClick={() => void signIn('kakao', { callbackUrl: consoleUrl })}
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[2px] bg-[#FEE500] text-base font-semibold text-black/85 transition-[filter] duration-200 ease-out-expo hover:brightness-[0.96]"
            >
              <KakaoMark />
              카카오로 시작하기
            </button>
            <button
              type="button"
              onClick={() => void signIn('github', { callbackUrl: consoleUrl })}
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[2px] border border-surface-border bg-surface text-[15px] font-semibold text-content transition-colors duration-200 ease-out-expo hover:border-yonsei-blue hover:text-yonsei-blue dark:hover:border-brand dark:hover:text-brand"
            >
              <GithubMark />
              GitHub으로 로그인
            </button>
          </div>

          {kakaoNotice && (
            <div
              role="status"
              className="mt-3.5 rounded-[2px] border border-surface-border bg-surface-soft p-3.5"
            >
              <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-yonsei-blue dark:text-brand">
                Kakao
              </p>
              <p className="mt-2 text-sm leading-[1.7] text-content">{KAKAO_UNLINKED_MSG}</p>
            </div>
          )}

          <div className="mt-8 border-t border-surface-border pt-[18px]">
            <p className="text-[12.5px] leading-[1.7] text-content-faint">
              이 콘솔은 학과 관계자 전용입니다 · 계정 문의: 기계공학부 사무실
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 카카오 말풍선 심볼 — 외부 이미지를 물어오지 않도록 인라인 SVG 로 둔다 */
function KakaoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3.2c-5.08 0-9.2 3.26-9.2 7.28 0 2.57 1.7 4.82 4.26 6.11-.19.68-.68 2.47-.78 2.85-.12.48.18.47.37.34.15-.1 2.4-1.63 3.38-2.3.63.09 1.29.14 1.97.14 5.08 0 9.2-3.26 9.2-7.28S17.08 3.2 12 3.2Z" />
    </svg>
  );
}

/** GitHub 마크 — currentColor 라 버튼 호버 색을 그대로 따라간다 */
function GithubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  );
}
