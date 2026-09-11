'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { menu } from './menu';
import { sectionTabHref } from '@/lib/board-links';
import { LocaleToggle } from './LocaleToggle';
import { Container } from './Container';
import { Logo } from './Logo';
import { IntentLink } from './IntentLink';

function Chevron({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={cn('h-3.5 w-3.5 transition-transform duration-200', className)}
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 상단 글로벌 헤더 — Cornell식 편집형 내비게이션.
 * 히어로 위에서는 투명(흰 텍스트), 스크롤/드로어 열림 시 흰 배경 + 진한 텍스트로 반전.
 * 메뉴 항목은 전부 실제 경로 링크다(탭 경로화 이후 해시 문법 폐기 — menu.ts 참고).
 */
export function Header() {
  const t = useTranslations('nav');
  const tMenu = useTranslations('menu');
  const pathname = usePathname();
  // 메가메뉴 시트 폭만 로케일로 갈린다(레이아웃 문법은 동일 — 아래 그리드 주석 참고).
  // 국문은 항목이 짧아 영문 폭(5xl)을 쓰면 글자 주위가 허해진다.
  const isKo = useLocale() === 'ko';
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null); // 모바일 아코디언

  // 메가메뉴는 CSS hover/focus-within 으로 열리므로, 항목 클릭 후에도 마우스가
  // 제자리면 계속 떠 있다 → 클릭 시 억제(suppress)해 즉시 닫고, 마우스가 nav 를
  // 벗어나거나(재호버 대비) 포커스가 다시 들어오면(키보드 대비) 해제한다.
  const [megaSuppressed, setMegaSuppressed] = useState(false);
  function onNavClick(e: React.MouseEvent) {
    if ((e.target as Element).closest('a')) {
      setMegaSuppressed(true);
      // 클릭된 링크에 남은 포커스가 focus-within 으로 패널을 다시 열지 않도록
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }

  // 라우트 변경 시 메뉴 닫기
  useEffect(() => {
    setOpen(false);
    setExpanded(null);
  }, [pathname]);

  // 스크롤 시 헤더를 흰 배경으로 반전 (히어로 위에서는 투명).
  // 임계값 80px, rAF 스로틀 — 스크롤마다 setState 하지 않고 프레임당 1회만 판정.
  useEffect(() => {
    let ticking = false;
    const update = () => {
      ticking = false;
      setScrolled(window.scrollY > 80);
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 드로어 열림 시 ESC 닫기 + 스크롤 잠금
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  function isActive(href: string) {
    const base = href.split('#')[0];
    return pathname === base || pathname.startsWith(`${base}/`);
  }

  const solid = scrolled || open;

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-colors duration-300',
        solid
          ? 'border-b border-surface-border bg-surface text-content shadow-sm'
          : 'bg-transparent text-white',
        // 슬라이드다운은 "스크롤로 고정"될 때만 — 드로어 열림(open)으로 solid 가 된
        // 경우엔 헤더가 이미 제자리이므로 움직이면 어색하다.
        scrolled && 'header-slide-in',
      )}
    >
      <Container>
        {/* 데스크톱: 로고↔첫 항목, 마지막 항목↔우측 버튼 간격도 항목 사이 간격과
            동일하도록 nav 의 justify-evenly 바깥 여백이 그대로 경계 간격이 된다(gap 없음) */}
        <div className="flex h-16 items-center justify-between gap-4 xl:gap-0 lg:h-20">
          {/* 로고 락업(엠블럼 | 헤어라인 | 연세체 워드마크) — 밝은 헤더에선 네이비로 전환 */}
          <Link
            href="/"
            className="flex shrink-0 items-center focus-visible:outline-yonsei-blue"
          >
            <Logo onLight={solid} />
          </Link>

          {/* 데스크톱 내비게이션 — 상단 항목 아무거나 호버/포커스하면 전폭 시트가 한 번에
              열리고, 6개 메뉴 그룹이 구분선으로 나뉜 컬럼에 모두 펼쳐진다(어느 항목을
              가리켜도 전체 지도를 한눈에 보여주는 방식).
              self-stretch: nav 를 헤더 전체 높이로 늘려 링크→패널 마우스 이동 중
              hover 가 끊기는 데드존을 없앤다 */}
          <nav
            aria-label="주 메뉴"
            onClick={onNavClick}
            onMouseLeave={() => setMegaSuppressed(false)}
            onFocus={() => setMegaSuppressed(false)}
            className="group/nav hidden min-w-0 self-stretch xl:flex xl:flex-1 xl:items-center"
          >
            {/* 딤 스크림 — 메뉴가 열리면 헤더 아래 페이지를 살짝 눌러 글라스 시트가
                배경 사진 위에서도 또렷이 읽히게 하고 시선을 메뉴로 모은다.
                시트보다 먼저 그려져 항상 그 뒤(아래)에 깔린다 */}
            <div
              aria-hidden="true"
              className={cn(
                // transition-all 금지 — 뷰포트 전체를 덮는 레이어라 all 로 두면 바뀌지도
                // 않는 속성까지 전이 후보가 된다. 실제로 변하는 두 가지만 전이한다.
                'pointer-events-none invisible fixed inset-x-0 bottom-0 top-16 bg-black/15 opacity-0 transition-[opacity,visibility] duration-200 lg:top-20',
                !megaSuppressed &&
                  'group-hover/nav:visible group-hover/nav:opacity-100 group-focus-within/nav:visible group-focus-within/nav:opacity-100',
              )}
            />

            {/* justify-evenly: 바깥 2 + 사이 6 = 8개 여백을 모두 동일하게 분배 →
                "글자 사이 여백"이 일정하고, 로고·우측 버튼과의 경계 간격도 같아진다.
                li 를 헤더 높이까지 늘려 top-full = 시트 상단.

                국문 ≥1360px: 상단 항목을 메가메뉴 시트처럼 뷰포트 중앙의 6등분
                그리드에 얹는다(fixed 전폭 + mx-auto + px-6 + grid-cols-6) —
                evenly 는 항목 폭 따라 중심이 흔들려 컬럼과 최대 ±31px 어긋났다.
                폭은 시트(874px)보다 좁은 828px — 사용자 지시로 상단 글자 사이
                간격만 좁힌 값(중심 간격 130px, 3xl 기준 +10px 재조정)이라 컬럼
                중심과는 바깥쪽일수록 조금 어긋나지만(중앙 대칭이라 좌우 균형은
                유지) 시트는 건드리지 않는다.
                1360px 미만은 첫 라벨이 로고를 침범해(1280px에서 약 27px) evenly 로
                폴백. 영문은 시트가 5xl(1024px)라 1440px에서도 로고와 겹쳐 제외. */}
            <ul
              className={cn(
                'flex h-full w-full items-stretch justify-evenly',
                isKo &&
                  'min-[1360px]:fixed min-[1360px]:inset-x-0 min-[1360px]:top-0 min-[1360px]:mx-auto min-[1360px]:grid min-[1360px]:h-20 min-[1360px]:max-w-[828px] min-[1360px]:grid-cols-6 min-[1360px]:px-6',
              )}
            >
              {menu.map((group) => (
                <li
                  key={group.key}
                  className={cn('flex items-center', isKo && 'min-[1360px]:justify-center')}
                >
                  <Link
                    href={group.href}
                    aria-current={isActive(group.href) ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-1.5 whitespace-nowrap py-2 text-[15px] font-medium transition-colors',
                      solid
                        ? isActive(group.href)
                          ? 'text-content'
                          : 'text-content-soft hover:text-content'
                        : isActive(group.href)
                          ? 'text-white'
                          : 'text-white/85 hover:text-white',
                    )}
                  >
                    {tMenu(`${group.key}.label`)}
                    <Chevron
                      className={cn(
                        !megaSuppressed && 'group-hover/nav:rotate-180',
                        solid ? 'text-content-faint' : 'text-white/60',
                      )}
                    />
                  </Link>
                </li>
              ))}
            </ul>

            {/* 전폭 시트 + 가운데 정렬 그리드 — 국문·영문 공통.
                각 컬럼 상단에 카테고리명(구분선 포함)을 표시한다. 이전의 라벨정렬형은
                폐기(영문 라벨이 라벨 폭에서 잘게 줄바꿈되는 문제 + 두 벌 유지 비용).
                컬럼 수는 메뉴 그룹 수(6)와 같아야 한다 — 7이면 남는 한 칸이
                오른쪽 死공간이 되어 내용 전체가 컬럼 절반(약 79px)만큼 왼쪽으로
                치우쳐 보인다. 폭을 5xl 로 좁혀 6등분해도 컬럼 폭은 그대로 유지된다.

                시트 폭은 로케일별 — "가장 긴 항목 좌우로 20px" 기준을 각 언어의 실측
                글자폭에 적용한 값이다. 국문 최장은 '동문 소식·네트워크' 96.5px 라
                컬럼 136.5px(=96.5+20*2) × 6 + 좌우 px-6 = 867px 이고, 서브픽셀
                반올림으로 한쪽이 19.5px 로 깎여 874px 로 올려 잡았다. 영문은 최장이
                'Social Challenge Board' 133.8px 로 훨씬 길어 5xl(1024px)을 유지한다
                — 국문 폭을 영문에 씌우면 항목 절반이 줄바꿈된다. 컬럼 안쪽 패딩
                (px-2.5)은 두 언어가 공유하므로 건드리지 말 것: 여기를 키우면 영문
                내용상자가 좁아져 'Social Challenge Board' 가 두 줄로 깨진다. */}
            <div
              className={cn(
                'invisible fixed inset-x-0 top-16 translate-y-1 opacity-0 transition-[opacity,transform,visibility] duration-200 lg:top-20',
                !megaSuppressed &&
                  'group-hover/nav:visible group-hover/nav:translate-y-0 group-hover/nav:opacity-100 group-focus-within/nav:visible group-focus-within/nav:translate-y-0 group-focus-within/nav:opacity-100',
              )}
            >
              <div className="border-b border-t border-surface-border mega-glass text-content">
                <div className={cn('mx-auto w-full px-6', isKo ? 'max-w-[874px]' : 'max-w-5xl')}>
                  <div className="grid grid-cols-6 divide-x divide-surface-border">
                    {menu.map((group) => (
                      <div key={group.key} className="px-2.5 pb-8 pt-6 text-center">
                        <IntentLink
                          href={group.href}
                          className="block border-b border-surface-border pb-3 text-sm font-bold text-content transition-colors hover:text-yonsei-blue"
                        >
                          {tMenu(`${group.key}.label`)}
                        </IntentLink>
                        <ul className="mt-3.5 space-y-0.5">
                          {group.items.map((sub) => (
                            <li key={sub.key}>
                              <IntentLink
                                href={sub.href}
                                className="block py-1.5 text-[13px] leading-snug text-content-soft transition-colors hover:text-yonsei-navy"
                              >
                                {tMenu(`${group.key}.items.${sub.key}`)}
                              </IntentLink>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden sm:block">
              <LocaleToggle tone={solid ? 'light' : 'dark'} />
            </div>

            {/* CTA — Cornell 'Give →' 스타일. 소개 페이지의 '입학 안내' 탭으로 연결 */}
            <Link
              href={sectionTabHref('about', 'admission')}
              className={cn(
                'group hidden items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors lg:inline-flex',
                solid
                  ? 'bg-yonsei-navy text-white hover:bg-yonsei-blue'
                  : 'bg-white text-yonsei-navy hover:bg-yonsei-blue hover:text-white',
              )}
            >
              {t('admission')}
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
              >
                <path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>

            {/* 모바일/태블릿 메뉴 토글 */}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={open ? t('close') : t('menu')}
              className={cn(
                'grid h-10 w-10 place-items-center xl:hidden',
                solid ? 'text-content hover:bg-surface-soft' : 'text-white hover:bg-white/10',
              )}
            >
              <span aria-hidden="true" className="relative block h-4 w-5">
                <span
                  className={cn(
                    'absolute left-0 top-0 h-0.5 w-5 bg-current transition-transform duration-200',
                    open && 'translate-y-[7px] rotate-45',
                  )}
                />
                <span
                  className={cn(
                    'absolute left-0 top-[7px] h-0.5 w-5 bg-current transition-opacity duration-200',
                    open && 'opacity-0',
                  )}
                />
                <span
                  className={cn(
                    'absolute bottom-0 left-0 h-0.5 w-5 bg-current transition-transform duration-200',
                    open && '-translate-y-[7px] -rotate-45',
                  )}
                />
              </span>
            </button>
          </div>
        </div>
      </Container>

      {/* 모바일 드로어 (아코디언) — 흰 배경.
          메뉴가 전부 경로 링크가 된 지금은 pathname 변경 effect 만으로도 대부분 닫히지만,
          현재 페이지와 같은 경로를 다시 눌렀을 때(pathname 불변)도 닫혀야 하므로
          링크 클릭이면 무조건 닫는 클릭 위임을 유지한다. */}
      <div
        id="mobile-menu"
        onClick={(e) => {
          if ((e.target as Element).closest('a')) {
            setOpen(false);
            setExpanded(null);
          }
        }}
        className={cn(
          'max-h-[calc(100dvh-4rem)] overflow-y-auto xl:hidden',
          open ? 'block' : 'hidden',
        )}
      >
        <nav aria-label="모바일 메뉴" className="border-t border-surface-border bg-surface">
          <Container>
            <ul className="flex flex-col py-2">
              {menu.map((group) => {
                const isExp = expanded === group.key;
                return (
                  <li key={group.key} className="border-b border-surface-border/60 last:border-0">
                    <div className="flex items-center">
                      <IntentLink
                        href={group.href}
                        className="flex-1 px-3 py-3 text-base font-semibold text-content hover:text-yonsei-navy"
                      >
                        {tMenu(`${group.key}.label`)}
                      </IntentLink>
                      <button
                        type="button"
                        onClick={() => setExpanded(isExp ? null : group.key)}
                        aria-expanded={isExp}
                        aria-label={tMenu(`${group.key}.label`)}
                        className="grid h-10 w-10 place-items-center text-content-faint hover:bg-surface-soft"
                      >
                        <Chevron className={cn(isExp && 'rotate-180')} />
                      </button>
                    </div>
                    {isExp && (
                      <ul className="pb-2 pl-3">
                        {group.items.map((sub) => (
                          <li key={sub.key}>
                            <IntentLink
                              href={sub.href}
                              className="block px-3 py-2 text-sm text-content-soft hover:bg-surface-soft hover:text-yonsei-navy"
                            >
                              {tMenu(`${group.key}.items.${sub.key}`)}
                            </IntentLink>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-surface-border py-4">
              <LocaleToggle tone="light" />
            </div>
          </Container>
        </nav>
      </div>
    </header>
  );
}
