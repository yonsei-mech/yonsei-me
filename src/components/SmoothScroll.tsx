'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// SSR 에서 useLayoutEffect 경고를 피하는 동형 훅 (LandingScope 와 동일 관례)
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * 전역 부드러운 스크롤(Lenis) — 레퍼런스(이화여대 140주년) 설정 이식.
 *  - lerp: 0.1 — 매 프레임 목표까지 남은 거리의 10%만 따라가 관성 감속을 만든다.
 *  - smoothWheel: 마우스 휠 입력을 부드럽게 보간, wheelMultiplier 1, 세로 방향.
 *  - easing: 지수 감속 곡선 (t)=>Math.min(1, 1.001 - 2^(-10t)) (Lenis 기본과 동일).
 *
 * GSAP 연동: 이 사이트는 ScrollTrigger 로 섹션 등장을 제어하므로 반드시 동기화해야 한다.
 * Lenis 스크롤마다 ScrollTrigger.update 를 호출하고, Lenis 의 rAF 루프를 GSAP 티커로
 * 구동한다(rAF 중복 방지 + 스무딩된 위치 기준으로 트리거가 정확히 발화). lagSmoothing(0)
 * 으로 프레임 지연 보정을 꺼 Lenis 와 리듬을 맞춘다.
 *
 * 접근성: prefers-reduced-motion 이면 초기화하지 않아 네이티브 스크롤을 그대로 둔다.
 *
 * 레이아웃 호환: Lenis 는 트랜스폼이 아니라 '네이티브 윈도우 스크롤'을 스무딩하므로,
 * 홈의 고정 히어로(position:fixed inset-0)와 sticky(탭 바·STEP 목차 등)가 그대로 동작한다.
 * 전역 인스턴스는 레퍼런스와 동일하게 window.lenis 로 노출한다(디버그/프로그램 스크롤용).
 *
 * 라우트 전환 호환(아래 useIsoLayoutEffect): Next 는 페이지를 바꾸면 새 세그먼트를 맨 위로
 * 스크롤하는데, 그 순간 Lenis 가 휠 관성 애니메이션 중(isScrolling === 'smooth')이면
 * 외부 스크롤 이벤트를 무시하고 다음 프레임에 자기 animatedScroll(옛 페이지의 위치)을
 * 다시 써 버린다. 실측: 교수 상세에서 휠로 내려간 직후(≈1초 안에) "목록으로"를 누르면
 * 목록이 상세의 스크롤 위치(예: 1004px)로 열려 탭·첫 카드가 화면 밖에 있었다.
 * 경로가 바뀌는 커밋의 레이아웃 단계에서 진행 중인 애니메이션을 끊고 내부 위치를 실제
 * 스크롤에 맞춘다(stop→start 는 Lenis 내부 reset 의 공개 경로). 이 컴포넌트가 라우터
 * 트리보다 앞선 형제라 Next 의 스크롤 복원(componentDidMount/Update)보다 먼저 돌고,
 * 그 뒤의 네이티브 scroll 이벤트는 유휴 상태의 Lenis 가 그대로 받아들인다.
 */
export function SmoothScroll() {
  const lenisRef = useRef<Lenis | null>(null);
  // next/navigation 의 usePathname — 로케일 접두사를 포함한 실제 경로(/ko/…)라 KO↔EN 전환도
  // 라우트 전환으로 잡힌다(next-intl 의 usePathname 은 접두사를 떼 같은 값이 된다).
  const pathname = usePathname();

  useIsoLayoutEffect(() => {
    const lenis = lenisRef.current;
    // 모달 등이 이미 멈춰 둔 상태면 건드리지 않는다 — start() 가 잠금을 풀어 버린다
    if (!lenis || lenis.isStopped) return;
    lenis.stop();
    lenis.start();
  }, [pathname]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lenis = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
      wheelMultiplier: 1,
      orientation: 'vertical',
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      // 중첩 스크롤 영역을 Lenis 가 직접 판정하게 한다(1.3 의 hasNestedScroll):
      // 제스처 방향으로 **실제로 더 스크롤할 여지가 있는** 요소일 때만 비켜 준다.
      // 이게 없으면 중첩 영역마다 data-lenis-prevent 를 손으로 달아야 하는데, 그
      // 속성은 방향을 가리지 않아 "가로로만 스크롤되는 표"에서 세로 휠까지 막았다.
      allowNestedScroll: true,
    });

    (window as unknown as { lenis?: Lenis }).lenis = lenis;
    lenisRef.current = lenis;

    lenis.on('scroll', ScrollTrigger.update);
    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(raf);
      lenis.off('scroll', ScrollTrigger.update);
      lenis.destroy();
      lenisRef.current = null;
      delete (window as unknown as { lenis?: Lenis }).lenis;
    };
  }, []);

  return null;
}
