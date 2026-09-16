import type { CSSProperties } from 'react';

/** 밴드에 함께 노출하는 보조 계정(아웃라인 버튼) */
export interface InstagramAccount {
  /** @ 없는 핸들 */
  handle: string;
  /** 계정 URL(새 창) */
  url: string;
}

/** 공용 인스타그램 아이콘(선형) — currentColor */
function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

// 배경 워시 — 인스타그램 브랜드 그라디언트를 아주 옅게(8~10% 알파) 가로로 깔아
// '인스타그램 밴드'라는 정체성만 주고 사이트 네이비 톤을 해치지 않는다.
const washStyle: CSSProperties = {
  background:
    'linear-gradient(115deg, rgba(254, 218, 117, 0.12), rgba(214, 41, 118, 0.08) 45%, rgba(79, 91, 213, 0.12))',
};

/**
 * 인스타그램 섹션 — 홈 맨 아래(연구실 아래, 푸터 위).
 * 밴드(헤드라인 + 계정 버튼들, 옅은 인스타 그라디언트 워시 배경 유지 — 사용자 지시)만 렌더한다.
 *
 * 밴드 우측은 '버튼 확장형' — 대표 계정은 채운 네이비 버튼, 보조 계정은 아웃라인 버튼
 * (hover 시 네이비로 반전). 계정이 하나뿐이면 자동으로 기존 단일 버튼 모습이 된다.
 *
 * 문구는 부모(page)가 messages 에서 해석해 props 로 넘긴다(서버 컴포넌트 유지).
 * 핸들·URL·보조 계정(accounts)은 content/instagram.json — 계정이 바뀌면 JSON 만 수정.
 */
export function InstagramSection({
  handle,
  url,
  tagline,
  followLabel,
  externalLabel,
  accounts = [],
}: {
  handle: string;
  url: string;
  /** 밴드 헤드라인(로케일 해석 완료) */
  tagline: string;
  /** 버튼 라벨("팔로우하기") */
  followLabel: string;
  /** 새 창 안내(접근성) */
  externalLabel: string;
  /** 대표 계정 외 보조 계정 — 아웃라인 버튼으로 이어 붙는다 */
  accounts?: InstagramAccount[];
}) {
  return (
    <section
      aria-labelledby="instagram-heading"
      className="full-bleed relative overflow-hidden bg-surface"
    >
      {/* 배경 워시 (장식) — 인스타그램 컨셉 컬러 유지(사용자 지시) */}
      <div aria-hidden="true" className="absolute inset-0" style={washStyle} />
      <div
        className={
          // 계정 버튼이 셋이라 헤드라인과 한 줄에 들어가는 xl 부터만 좌우 배치,
          // 그 아래는 세로 스택(버튼 셋은 여전히 한 줄에 나란히 들어간다).
          'relative mx-auto flex w-full max-w-[1360px] flex-col gap-6 px-6 pb-12 pt-12 sm:px-10 lg:px-16 lg:pb-14 lg:pt-14 xl:flex-row xl:items-center xl:justify-between'
        }
      >
        {/* 좌: 아이콘 + 헤드라인 (버튼이 한 줄에 다 못 들어가는 lg 미만에선 가운데 정렬) */}
        <div className="flex items-center justify-center gap-4 lg:justify-start">
          <InstagramGlyph className="h-9 w-9 shrink-0 text-yonsei-navy dark:text-white" />
          <h2 id="instagram-heading" className="text-xl font-bold tracking-tight text-content sm:text-2xl">
            {tagline}
          </h2>
        </div>

        {/* 우: 계정 버튼들 — 대표 계정은 채운 네이비, 보조 계정은 아웃라인.
            lg 미만에선 버튼 셋이 한 줄에 안 들어가 대표 계정만 따로 떨어지므로 2열 그리드로
            바꾸고 대표 계정에 col-span-2 를 줘, 폭이 아래 두 버튼 + 간격의 합과 정확히 맞게 한다
            (보조 계정이 셋 이상이면 2열로 이어지며 대표 계정은 계속 전체 폭). */}
        <div className="grid grid-cols-2 gap-2.5 lg:flex lg:flex-wrap lg:items-center xl:justify-end">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`@${handle} ${followLabel} — ${externalLabel}`}
            className="col-span-2 inline-flex items-center justify-center gap-2.5 bg-yonsei-navy px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-yonsei-blue lg:col-auto"
          >
            <InstagramGlyph className="h-[1.1em] w-[1.1em]" />
            <span>
              @{handle} {followLabel}
            </span>
            <span aria-hidden="true">↗</span>
          </a>

          {accounts.map((a) => (
            <a
              key={a.url}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`@${a.handle} ${followLabel} — ${externalLabel}`}
              className="inline-flex items-center justify-center gap-2 border border-yonsei-navy/45 bg-white/60 px-5 py-[13px] text-sm font-bold text-yonsei-navy transition-colors hover:border-yonsei-navy hover:bg-yonsei-navy hover:text-white dark:border-white/40 dark:bg-white/5 dark:text-white dark:hover:border-white dark:hover:bg-white dark:hover:text-yonsei-navy"
            >
              <span>@{a.handle}</span>
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
