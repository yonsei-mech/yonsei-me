import type { ReactNode } from 'react';
import { Container, NARROW_MAX_W } from '@/components/Container';
import { Prose } from '@/components/Prose';
import { TabNavBar, type TabNavItem } from '@/components/TabNavBar';
import { cn } from '@/lib/utils';

export type { TabNavItem };

/**
 * 세부탭 페이지 공용 셸 — 상단 sticky 남색 내비게이션 바(TabNavBar) + 그 아래 본문.
 * TabbedContent 와 시각적으로 동일하지만, 탭 전환이 클라이언트 상태가 아니라
 * 실제 라우트(페이지)라서 이 컴포넌트는 서버 컴포넌트로 쓸 수 있다.
 */
export function TabPageShell({
  navTitle,
  tabs,
  activeKey,
  title,
  titleTag = 'h2',
  markdown,
  emptyLabel,
  narrow = false,
  children,
}: {
  /** 바의 드롭다운 앞에 표시할 그룹명 (예: "학부") */
  navTitle?: string;
  tabs: TabNavItem[];
  /** 현재 페이지에 해당하는 탭 key */
  activeKey: string;
  /** 큰 제목 (탭 라벨) — 요소는 titleTag 가 정한다 */
  title: string;
  /** 큰 제목을 어떤 요소로 그릴지. 기본 'h2'(히어로 제목이 h1 인 기존 동작).
   *  이 제목을 문서의 대표 제목으로 삼는 페이지는 'h1' 을 넘기고 히어로 쪽을 낮춘다 —
   *  한 문서에 눈에 띄는 제목이 둘이면 구글이 검색결과 제목을 임의로 바꿔 쓴다.
   *  id·클래스·스타일은 동일해서 시각 변화는 없다. */
  titleTag?: 'h1' | 'h2';
  markdown?: string | null;
  /** 본문이 비었을 때 보여 줄 문구. 없으면 빈 상태 자체를 렌더하지 않는다 */
  emptyLabel?: string;
  /** 게시판 목록처럼 좁은 폭(NARROW_MAX_W)이 필요한 페이지용 — 바와 본문에 함께 걸린다 */
  narrow?: boolean;
  /** 마크다운 대신 커스텀 컴포넌트(카드 그리드 등)를 렌더할 때 사용 */
  children?: ReactNode;
}) {
  const containerWidth = narrow ? NARROW_MAX_W : undefined;
  const TitleTag = titleTag;

  return (
    <>
      <TabNavBar navTitle={navTitle} tabs={tabs} activeKey={activeKey} narrow={narrow} />

      <Container className={cn('py-10 lg:py-16', containerWidth)}>
        {/* 본문 (레이아웃에 이미 <main id="main">이 있어 중첩 방지를 위해 section 사용) */}
        <section className="min-w-0" aria-labelledby={`${activeKey}-title`}>
          {/* anim-panel = globals.css 의 panelFadeUp 진입 애니메이션(0.35s) — 라우트 이동 시
              새 페이지가 마운트되며 그대로 재생된다(LandingScope 는 data-land 만 보므로 무관) */}
          <div className="anim-panel relative isolate">
            {/* 장식용 독수리 — 탭 큰 제목 좌상단, 남색(eagle.webp 를 마스크로 틴트) */}
            <span
              aria-hidden="true"
              className="eagle-mask pointer-events-none absolute -left-2 -top-12 -z-10 h-[230px] w-[230px] bg-yonsei-navy opacity-[0.08]"
            />
            {/* 탭 큰 제목 서체 = Paperlogy 6 SemiBold(사용자 지정) — font-semibold(600)가
                text-display-sm 내장 굵기(700)를 덮어 600 파일이 물린다(가짜 볼드 없음). */}
            <TitleTag
              id={`${activeKey}-title`}
              style={{ fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif' }}
              className="mb-10 scroll-mt-24 text-display-sm font-semibold tracking-tight text-content"
            >
              {title}
            </TitleTag>
            {children ? (
              children
            ) : markdown ? (
              <Prose markdown={markdown} />
            ) : emptyLabel ? (
              <div className="flex flex-col items-center gap-4 rounded-card border border-surface-border bg-surface-soft px-6 py-20 text-center">
                <span
                  aria-hidden="true"
                  className="grid h-12 w-12 place-items-center rounded-full bg-yonsei-navy/10 text-yonsei-navy"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path
                      d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <p className="max-w-sm text-content-soft">{emptyLabel}</p>
              </div>
            ) : null}
          </div>
        </section>
      </Container>
    </>
  );
}
