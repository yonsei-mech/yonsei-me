'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { FlowLines } from './FlowLines';
import { guardKoreanBreaks } from '@/lib/typography';
import { prefersReducedMotion } from '@/lib/utils';

// SplitText 는 무료 public gsap 패키지에 포함(Club 토큰 불필요) — 히어로와 동일.
gsap.registerPlugin(SplitText);

// SSR 안전 layout effect — 페인트 전에 초기 상태를 잡아 깜빡임을 막는다.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// 목표 교체 간격(ms) — 사용자 지정 3.5초.
const ROTATE_MS = 3500;

/** 로케일 해석이 끝난 교육 목표 한 건 */
export interface GoalItem {
  /** 대형 타이포(영문 제목, 예: "Design & Practice") */
  big: string;
  /** 한글 부제(ko 로케일에서만 전달, en 은 null) */
  sub: string | null;
  /** 설명 본문 */
  body: string;
}

export interface GoalQuickLink {
  label: string;
  href: string;
  /** 연결되는 탭이 무엇인지 설명하는 본문 */
  desc: string;
}

/**
 * 학과 목표 섹션 — hicoda 'goals' 레퍼런스의 회전 타이포를 연세 톤으로 이식.
 * 위치: 홈 '우리의 연구실' ↔ '뉴스 & 행사' 사이.
 *
 * 구성: [헤어라인 + 우측 네이비 박스 헤더] → [좌: 회전 목표 타이포 / 우: 연세 엠블럼
 * (logo.svg, 장식)] → [헤어라인] → [바로가기 카드 4종(제목 + 설명, 호버 시 남색 배경)].
 * 얇은 선들이 레퍼런스처럼 여백을 구조화한다.
 *
 * 회전(3.5초): 짧은 페이드아웃 → 인덱스 교체 → 영문 제목이 SplitText(chars+mask)로
 * 글자 하나씩 아래에서 세로로 솟아오르며 왼쪽부터 순차 등장, 번호·부제·본문은 페이드-라이즈.
 * ⚠️ 회전 블록은 key={idx} 로 매 주기 새로 마운트한다 — SplitText.revert() 가 이전
 * 제목의 스냅샷을 복원해 React 가 갱신한 텍스트를 덮어쓰는 충돌(제목이 안 바뀌는 버그)을
 * 원천 차단(revert 는 버려지는 옛 노드에만 작용).
 *
 * 접근성: 회전 블록은 aria-hidden(글자 분해 + 주기 교체는 SR 에 소음) — 전체 목표
 * 목록을 sr-only <ul> 로 정적 제공. reduced-motion: 회전·타이핑 없이 첫 목표 정적 노출.
 * 데이터: content/editorial-tabs.json 의 undergraduate-goals.items 재사용(학부 페이지와
 * 단일 출처 공유 — 내용 수정은 JSON 한 곳에서).
 */
export function GoalsSection({
  heading,
  goals,
  links,
  linksLabel,
}: {
  heading: string;
  goals: GoalItem[];
  links: GoalQuickLink[];
  linksLabel: string;
}) {
  const [idx, setIdx] = useState(0);
  const blockRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLParagraphElement | null>(null);

  // --- 3.5초 주기 교체: 짧게 페이드아웃 → 인덱스 교체(다음 effect 가 타이핑 인) ---
  useEffect(() => {
    if (goals.length <= 1 || prefersReducedMotion()) return;
    const id = window.setInterval(() => {
      if (document.hidden) return; // 백그라운드 탭에선 교체 정지
      const block = blockRef.current;
      if (!block) return;
      gsap.to(block, {
        autoAlpha: 0,
        duration: 0.25,
        ease: 'power1.in',
        onComplete: () => setIdx((i) => (i + 1) % goals.length),
      });
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [goals.length]);

  // --- 타이핑 인: idx 변경(및 초기 마운트) 시 제목 글자가 세로로 하나씩 솟아오름 ---
  useIsoLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    const block = blockRef.current;
    const titleEl = titleRef.current;
    if (!block || !titleEl) return;

    // mask:'chars' — 글자마다 클립 래퍼가 생겨 아래에서 '가려진 채 솟아오르는' 세로 등장
    const split = SplitText.create(titleEl, { type: 'chars', mask: 'chars', aria: 'none' });
    const fades = gsap.utils.toArray<HTMLElement>(block.querySelectorAll('[data-goal-fade]'));

    // 페인트 전 초기 상태 — 이전 목표의 페이드아웃(autoAlpha 0)에서 이어받는다.
    gsap.set(block, { autoAlpha: 1 });
    gsap.set(split.chars, { yPercent: 110 });
    gsap.set(fades, { autoAlpha: 0, y: 14 });

    const tl = gsap.timeline();
    // 왼쪽에서 오른쪽으로, 글자 하나씩 세로로 솟아오르며 등장
    tl.to(split.chars, { yPercent: 0, duration: 0.5, stagger: 0.045, ease: 'power3.out' }, 0);
    tl.to(fades, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out' }, 0.3);

    return () => {
      tl.kill();
      split.revert();
    };
  }, [idx]);

  if (!goals.length) return null;
  const goal = goals[idx];

  return (
    // 모바일 밀도 최적화: 상하 패딩 py-12, sm+ 은 기존 리듬(py-section-lg) 유지
    <section
      aria-labelledby="goals-heading"
      className="full-bleed relative overflow-hidden bg-surface py-12 sm:py-section-lg"
    >
      {/* 배경 유선 장식(Cornell CHE 참조) — 우측 여백(엠블럼 존)을 스윕 번들이 채운다.
          좌측은 마스크로 페이드아웃해 회전 타이포 가독성 보존. 콘텐츠 컨테이너가
          relative(아래)라 선은 항상 텍스트 뒤 레이어. 모바일은 밀도 우선 — 숨김. */}
      <FlowLines
        variant="sweep"
        gid="flow-goals"
        preserve="xMaxYMin slice"
        className="absolute right-0 top-0 hidden h-full w-[68%] opacity-20 [-webkit-mask-image:linear-gradient(to_right,transparent,black_28%)] [mask-image:linear-gradient(to_right,transparent,black_28%)] sm:block"
      />
      <div className="relative mx-auto w-full max-w-[1360px] px-6 sm:px-10 lg:px-16">
        {/* 헤더 행 — 왼쪽으로 길게 뻗는 헤어라인 + 우측 네이비 박스(선 디자인 ①) */}
        <div className="flex items-center gap-6">
          <span aria-hidden="true" className="h-px flex-1 bg-surface-border" />
          <h2
            id="goals-heading"
            className="inline-block bg-yonsei-navy px-4 py-2 text-base font-bold text-white sm:px-5 sm:py-2.5 sm:text-lg"
          >
            {heading}
          </h2>
        </div>

        {/* 본문 행 — 좌: 회전 타이포 / 우: 연세 엠블럼(장식) */}
        <div className="mt-6 flex items-center gap-10 lg:mt-4 lg:gap-16">
          {/* key={idx}: 매 주기 새 노드 마운트 — SplitText.revert 의 옛 스냅샷 복원이
              새 제목을 덮어쓰지 못하게 한다(제목 안 바뀌던 버그의 수정). */}
          <div
            key={idx}
            ref={blockRef}
            aria-hidden="true"
            className="min-h-[12rem] flex-1 sm:min-h-[16rem] lg:min-h-[17rem]"
          >
            {/* 번호 검정·금색 마침표 삭제 — 금색 배제(사용자 지시) */}
            <p data-goal-fade className="text-sm font-bold tracking-[0.35em] text-content">
              0{idx + 1}
            </p>
            <p
              ref={titleRef}
              className="mt-2 text-[clamp(2.1rem,5.4vw,4.4rem)] font-extrabold leading-[1.08] tracking-tight text-yonsei-navy dark:text-yonsei-blue"
            >
              {goal.big}
            </p>
            {goal.sub && (
              <p data-goal-fade className="mt-3 text-lg font-bold text-content">
                {goal.sub}
              </p>
            )}
            {/* measure 는 사이트 공통 상한(max-w-prose)으로 — 3xl(48rem)은 한글 본문에 과대 */}
            <p data-goal-fade className="mt-2 max-w-prose text-sm leading-relaxed text-content-soft sm:text-base">
              {guardKoreanBreaks(goal.body)}
            </p>
          </div>

          {/* 연세 원형 엠블럼 — 우측 여백을 채우는 장식(넓은 화면에서만) */}
          {/* width/height 는 종횡비(logo.svg viewBox 588.56561×588.53918 ≈ 1:1)만 알려
              레이아웃 시프트를 막는 값 — 실제 크기는 w-40/xl:w-48 과 preflight 의
              img{height:auto} 가 정한다. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt=""
            aria-hidden="true"
            draggable={false}
            width={589}
            height={589}
            className="hidden w-40 shrink-0 select-none self-center lg:block xl:w-48"
          />
        </div>

        {/* 전체 목표 목록 — 스크린리더 전용 정적 콘텐츠 */}
        <ul className="sr-only">
          {goals.map((g) => (
            <li key={g.big}>
              {g.big}
              {g.sub ? ` (${g.sub})` : ''} — {g.body}
            </li>
          ))}
        </ul>

        {/* 구분 헤어라인(선 디자인 ②) + 바로가기 카드 — 버튼 상단을 위로 올려 카드를
            세로로 키우고, 제목(줄바꿈 금지·크게) + 연결 탭 설명 본문 구성. */}
        <nav
          aria-label={linksLabel}
          className="mt-4 border-t border-surface-border pt-6 lg:mt-5 lg:pt-7"
        >
          {/* 모바일 2×2(데스크톱 모드의 밀도를 반응형으로 재현 — 4줄 스택 해소), sm 2열 → lg 4열 */}
          <ul className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4 lg:gap-4">
            {links.map((l) => (
              <li key={l.href} className="h-full">
                <Link
                  href={l.href}
                  className="group flex h-full flex-col justify-between gap-4 border border-surface-border bg-surface px-4 py-4 transition-colors hover:border-yonsei-navy hover:bg-yonsei-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue sm:gap-7 sm:px-6 sm:py-7"
                >
                  <span className="flex items-center justify-between gap-3 text-base font-bold text-content transition-colors group-hover:text-white sm:text-xl">
                    <span className="whitespace-nowrap">{l.label}</span>
                    <span
                      aria-hidden="true"
                      className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    >
                      ↗
                    </span>
                  </span>
                  <span className="text-xs leading-snug text-content-soft transition-colors group-hover:text-white/80 sm:text-sm sm:leading-relaxed">
                    {l.desc}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}
