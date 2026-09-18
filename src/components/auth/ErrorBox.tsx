import type { ReactNode } from 'react';

/**
 * 오류 박스 — 색만으로 말하지 않도록 아이콘+문장, alert 로 읽어 준다.
 *
 * CMS 로그인(LoginScreen)과 학위논문심사 공고 등록 본인 확인(ThesisVerifyFlow)이 함께 쓴다.
 * `detail` 을 주면 두 줄 구조가 된다 — 첫 줄(children)은 굵게 "무엇이 잘못됐나",
 * 둘째 줄(detail)은 보통 굵기로 "그래서 어떻게 되나"(남은 기회·대기 시간 등).
 * detail·id 를 생략하면 추출 전 LoginScreen 의 출력과 같다.
 */
export function ErrorBox({
  children,
  detail,
  id,
}: {
  children: ReactNode;
  /** 둘째 줄 — 있으면 첫 줄을 굵은 블록으로 올린다 */
  detail?: ReactNode;
  /** 입력의 aria-describedby 가 가리킬 id (입력 바로 아래 오류일 때) */
  id?: string;
}) {
  return (
    <div
      id={id}
      role="alert"
      className="mt-1 flex gap-2.5 rounded-[2px] border border-[#B42318] bg-[#FDF3F2] px-3.5 py-3 dark:border-[#F2837B] dark:bg-[#1E1518]"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 bg-[#B42318] text-center text-[11px] font-bold leading-4 text-white dark:bg-[#F2837B] dark:text-[#1E1518]"
      >
        !
      </span>
      <span className="text-sm leading-[1.6] text-[#B42318] dark:text-[#F2837B]">
        {detail ? (
          <>
            <strong className="block font-semibold">{children}</strong>
            {detail}
          </>
        ) : (
          children
        )}
      </span>
    </div>
  );
}
