import { useId } from 'react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * 화면 B 좌측 안내 — "이렇게 진행됩니다"(3단계) + "미리 준비하세요" + 양식·문의·관리자 안내.
 * (디자인 원본: files/학위논문심사 공고 등록 디자인/spec.md §3 좌측 안내 카드)
 *
 * 같은 내용을 두 모양으로 그린다:
 *  - lg 이상: 옅은 면 카드(8px 라운드 — 사이트 빈 상태 카드와 같은 값) — 폼 왼쪽 열.
 *  - lg 미만: 네이티브 <details> 접이식(기본 닫힘) — 폼보다 위, 폼을 먼저 보이게 접어 둔다.
 * 한쪽은 CSS 로 display:none 이라 보조기기에 중복으로 읽히지 않는다.
 *
 * 단계 표시는 폼 상태를 따른다(verified): 확인 전엔 1단계가 "지금 단계", 확인 뒤엔
 * 1단계 완료(체크) · 2단계 "다음 단계". 그래서 이 컴포넌트는 ThesisVerifyFlow(클라이언트)
 * 안에서 렌더된다.
 */

export interface ThesisGuideLabels {
  eyebrow: string;
  title: string;
  show: string;
  hide: string;
  steps: { title: string; desc: string }[];
  stepNow: string;
  stepNext: string;
  /** 완료 단계 앞에 스크린리더로만 읽는 접두 ("완료:") */
  stepDone: string;
  prepTitle: string;
  prep: string[];
  template: string;
  contactLabel: string;
  adminNote: string;
  adminLink: string;
}

/** 문의처 — 교직원 데이터(대학원 담당)에서 온다. 없으면 문의 줄을 숨긴다 */
export interface ThesisContact {
  office: string;
  location: string;
  phone: string;
  email: string;
}

const ACCENT_TEXT = 'text-yonsei-blue dark:text-brand';

export function ThesisSubmitGuide({
  labels,
  contact,
  templateUrl,
  verified,
}: {
  labels: ThesisGuideLabels;
  contact: ThesisContact | null;
  templateUrl: string | null;
  verified: boolean;
}) {
  const titleId = useId();
  const body = (
    <GuideBody labels={labels} contact={contact} templateUrl={templateUrl} verified={verified} />
  );

  return (
    <>
      {/* 데스크톱 카드 */}
      <section
        aria-labelledby={titleId}
        className="hidden rounded-card border border-surface-border bg-surface-soft p-10 lg:block"
      >
        <p className={cn('text-[12px] font-bold uppercase leading-[18px] tracking-[0.18em]', ACCENT_TEXT)}>
          {labels.eyebrow}
        </p>
        <h2
          id={titleId}
          className="mt-2.5 font-subhead text-[22px] font-bold leading-[1.35] tracking-[-0.01em] text-content"
        >
          {labels.title}
        </h2>
        <div className="mt-7">{body}</div>
      </section>

      {/* 모바일 접이식 — 요약 문구는 [open] 상태로 CSS 가 바꾼다(스크립트 없이 동작) */}
      <details className="group rounded-card border border-surface-border bg-surface-soft lg:hidden">
        <summary className="flex h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 text-[15px] font-semibold leading-[22px] text-content [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">{labels.show}</span>
          <span className="hidden group-open:inline">{labels.hide}</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className={cn('h-5 w-5 shrink-0 group-open:rotate-180', ACCENT_TEXT)}
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="border-t border-surface-border px-5 pb-6 pt-5">{body}</div>
      </details>
    </>
  );
}

function GuideBody({
  labels,
  contact,
  templateUrl,
  verified,
}: {
  labels: ThesisGuideLabels;
  contact: ThesisContact | null;
  templateUrl: string | null;
  verified: boolean;
}) {
  return (
    <>
      {/* 3단계 — 32px 사각 번호 + 1px 세로 연결선 */}
      <ol>
        {labels.steps.map((s, i) => {
          const done = verified && i === 0;
          const current = verified ? i === 1 : i === 0;
          const last = i === labels.steps.length - 1;
          return (
            <li
              key={s.title}
              aria-current={current ? 'step' : undefined}
              className={cn('relative grid grid-cols-[32px_minmax(0,1fr)] gap-x-4', !last && 'pb-6')}
            >
              {!last && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute bottom-0 left-[15px] top-8 w-px',
                    // 옅은 면 위에서도 사라지지 않는 헤어라인(테두리 토큰은 면과 거의 같아 묻힌다)
                    done ? 'bg-yonsei-blue dark:bg-brand' : 'bg-content-faint/30',
                  )}
                />
              )}
              <span
                aria-hidden="true"
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-[2px] border text-sm font-bold leading-none tabular-nums',
                  current
                    ? 'border-brand bg-brand text-brand-fg'
                    : done
                      ? 'border-yonsei-blue bg-surface text-yonsei-blue dark:border-brand dark:text-brand'
                      : 'border-content-faint/30 bg-surface text-content',
                )}
              >
                {done ? <CheckIcon className="h-4 w-4" strokeWidth={2.5} /> : i + 1}
              </span>
              <div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-bold leading-6 text-content">
                  {done && <span className="sr-only">{labels.stepDone}</span>}
                  {s.title}
                  {current && (
                    <span
                      className={cn(
                        'inline-block rounded-[2px] border border-yonsei-blue px-1.5 py-px text-[11.5px] font-bold leading-4 dark:border-brand',
                        ACCENT_TEXT,
                      )}
                    >
                      {verified ? labels.stepNext : labels.stepNow}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm leading-[1.7] text-content-faint">{s.desc}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* 미리 준비하세요 — 표시 전용 체크(체크박스가 아니다) */}
      <h3 className="mt-7 border-t border-surface-border pt-7 font-subhead text-lg font-semibold leading-[1.4] tracking-[-0.01em] text-content">
        {labels.prepTitle}
      </h3>
      <ul className="mt-3.5 grid gap-1.5">
        {labels.prep.map((p) => (
          <li
            key={p}
            className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 text-[14.5px] leading-[1.65] text-content"
          >
            <CheckIcon className={cn('mt-1 h-4 w-4', ACCENT_TEXT)} strokeWidth={2} />
            <span>{p}</span>
          </li>
        ))}
      </ul>

      {templateUrl && (
        <a
          href={templateUrl}
          className={cn(
            'mt-2.5 inline-flex min-h-[44px] items-center gap-2 text-[14.5px] font-semibold leading-5 hover:underline',
            ACCENT_TEXT,
          )}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className="h-4 w-4 shrink-0"
          >
            <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{labels.template}</span>
        </a>
      )}

      {contact && (
        <p className="mt-2.5 text-[13.5px] leading-[1.75] text-content-faint">
          <b className="mr-1.5 font-bold text-content">{labels.contactLabel}</b>
          {contact.office} · {contact.location}
          <br />
          {contact.phone} · {contact.email}
        </p>
      )}

      <p className="mt-6 border-t border-surface-border pt-[18px] text-[12.5px] leading-[1.7] text-content-faint">
        {labels.adminNote}{' '}
        {/* prefetch 끔 — 관리자 콘솔은 인증 게이트가 있어 미리 가져와도 로그인 화면으로 튕긴다 */}
        <Link
          href="/contentmanagement"
          prefetch={false}
          className={cn(
            'whitespace-nowrap font-semibold underline decoration-1 underline-offset-[3px]',
            ACCENT_TEXT,
          )}
        >
          {labels.adminLink}
        </Link>
      </p>
    </>
  );
}

export function CheckIcon({ className, strokeWidth = 2.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
