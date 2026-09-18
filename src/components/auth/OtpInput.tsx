'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * 인증번호 분할 6칸 입력 — Claude Design 목업(인증번호 입력.dc.html)의 구조 그대로.
 *
 * 접근성 결정: "단일 input(투명 오버레이) + 시각적 6칸(aria-hidden)".
 * 6개 input 로 쪼개면 iOS·안드로이드의 autocomplete="one-time-code" 코드 제안이
 * 첫 칸만 채우거나 기기마다 분배가 갈리고, 스크린리더가 "편집란 6개"로 읽는다.
 * 단일 input 이면 코드 제안이 6자리를 통째로 채우고, 자동 다음 칸·백스페이스·
 * ←/→·붙여넣기가 전부 브라우저 기본 캐럿 동작이라 키 처리를 새로 만들지 않는다.
 * 대가: 칸 클릭으로 캐럿을 옮길 수 없어 포커스는 항상 끝으로 간다(방향키로 대체).
 *
 * CMS 로그인(LoginScreen)과 학위논문심사 공고 등록 본인 확인(ThesisVerifyFlow)이 함께 쓴다.
 * locked·verified·ariaLabel 은 선택 prop 이고, 생략하면 추출 전 CMS 출력과 같다.
 * - locked  : 코드가 폐기된 상태(5회 소진·만료). 옅은 면의 빈 칸 + input disabled.
 * - verified: 확인 완료. 6칸 강조색 테두리 + input readOnly(초점은 남겨 둔다).
 */
export function OtpInput({
  id,
  value,
  invalid,
  inputRef,
  onChangeValue,
  onComplete,
  locked = false,
  verified = false,
  ariaLabel = '인증번호 6자리 입력',
}: {
  id: string;
  value: string;
  invalid: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onChangeValue: (v: string) => void;
  /** 6자리가 완성된 직후(입력 blur 후) 호출 — 로그인 버튼으로 초점 이동용 */
  onComplete: () => void;
  /** 코드 폐기 상태 — 빈 칸을 옅은 면으로 잠근다(invalid 보다 우선) */
  locked?: boolean;
  /** 확인 완료 상태 — 강조색 테두리, 입력은 읽기 전용 */
  verified?: boolean;
  /** 입력의 접근 이름 (영문 화면용) */
  ariaLabel?: string;
}) {
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const active = Math.min(caret, 5);

  const syncCaret = (el: HTMLInputElement) =>
    setCaret(typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length);

  return (
    <div className="relative flex items-center justify-center gap-[7px] lg:gap-2">
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="one-time-code"
        aria-label={ariaLabel}
        aria-invalid={invalid}
        disabled={locked}
        readOnly={verified}
        value={value}
        // 숫자만 남긴다 — 붙여넣기의 공백·하이픈도 같은 경로로 걸러져 분배된다
        onChange={(e) => {
          const el = e.target;
          const raw = el.value.replace(/\D/g, '').slice(0, 6);
          onChangeValue(raw);
          setCaret(raw.length);
          if (raw.length === 6) {
            window.requestAnimationFrame(() => {
              el.blur();
              onComplete();
            });
          }
        }}
        // 클릭·포커스 시 캐럿을 항상 끝으로 — 칸별 클릭 위치 지정은 지원하지 않는다
        onFocus={(e) => {
          const el = e.target;
          const len = el.value.length;
          window.requestAnimationFrame(() => {
            try {
              el.setSelectionRange(len, len);
            } catch {
              /* type=email 등 일부 상황의 예외 — 캐럿 보정만 포기한다 */
            }
          });
          setFocused(true);
          setCaret(len);
        }}
        onBlur={() => setFocused(false)}
        // ←/→ 는 브라우저 기본 캐럿 이동을 그대로 쓰고 칸 강조에만 반영한다
        onKeyUp={(e) => syncCaret(e.currentTarget)}
        onSelect={(e) => syncCaret(e.currentTarget)}
        // 텍스트·캐럿을 전부 투명하게 — 시각 표현은 아래 6칸이 담당한다.
        // 폰트만은 16px 이상 유지(iOS 가 포커스 시 화면을 확대하는 기준선).
        className="absolute inset-0 z-[2] h-full w-full cursor-text border-0 bg-transparent text-base text-transparent caret-transparent outline-none [-webkit-text-fill-color:transparent]"
      />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        // 잠금 상태는 값이 남아 있어도 빈 칸으로 그린다(폐기된 코드를 보여 주지 않는다)
        const digit = locked ? '' : (value[i] ?? '');
        const isActive = focused && i === active && !locked && !verified;
        return (
          <div
            key={i}
            aria-hidden="true"
            className={cn(
              'relative flex h-12 w-11 items-center justify-center rounded-[2px] border text-xl font-semibold tabular-nums lg:h-[52px] lg:w-12 lg:text-[22px]',
              locked
                ? 'border-surface-border bg-surface-soft text-content'
                : invalid
                  ? 'border-[#B42318] text-[#B42318] dark:border-[#F2837B] dark:text-[#F2837B]'
                  : digit || verified
                    ? 'border-yonsei-blue text-content dark:border-brand'
                    : 'border-surface-border text-content',
              isActive &&
                'outline outline-2 outline-offset-2 outline-yonsei-blue dark:outline-brand',
            )}
          >
            {digit}
            {isActive && !digit && (
              <span className="cms-otp-caret absolute h-6 w-[2px] bg-yonsei-blue dark:bg-brand" />
            )}
          </div>
        );
      })}
    </div>
  );
}
