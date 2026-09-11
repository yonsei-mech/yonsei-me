'use client';

import { useEffect, useLayoutEffect } from 'react';
import { HOME_REVEAL_CLASS } from '@/components/HomeReveal';

// SSR 에서 useLayoutEffect 경고를 피하는 동형 훅 (LandingScope 와 동일 관례)
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * 홈에 머무는 동안 <html> 에 `home-reveal` 을 유지한다 — 클라이언트 내비게이션 담당.
 *
 * HomeRevealScript(인라인)는 문서를 처음 받을 때 한 번만 돈다(클라이언트 내비게이션으로
 * 끼워진 <script> 는 실행되지 않는다). 그래서
 *  - 하위 페이지로 들어와 홈으로 이동하면 클래스가 없다 → 레이아웃 단계(페인트 전)에 붙인다.
 *  - 홈으로 들어와 하위 페이지로 떠나면 클래스가 남는다 → 정리 함수가 페인트 전에 뗀다.
 *    안 떼면 body::before 의 100svh 마진이 하위 페이지를 한 화면 아래로 밀어낸다.
 * 레이아웃 이펙트여야 하는 이유: useEffect(와 그 정리)는 페인트 뒤에 돌아, 떠난 직후 하위
 * 페이지가 한 프레임 동안 한 화면 아래로 밀려 그려질 수 있다.
 * 홈 쪽은 클래스가 붙든 안 붙든 최종 레이아웃이 같다(래퍼의 mt-[100svh] 폴백) — 이 컴포넌트는
 * 레이아웃을 바꾸지 않고 "누가 그 마진을 지느냐"만 맞춘다. 배경은 HomeReveal.tsx 주석 참고.
 * ⚠️ 홈 DOM 이 화면에 남은 채 스크롤된 상태에서 클래스만 떼지 말 것 — Lenis 가 꺼진 환경
 * (reduced-motion)에서 Chrome 스크롤 앵커링이 scrollY 를 100svh 끌어올린다(실측). 떠날 때는
 * 홈 DOM 과 같은 커밋에서 떨어져 문제없고, 붙일 때는 튀지 않는다(홈↔공지 왕복·페이지 맨
 * 아래 왕복 모두 프로덕션과 scrollY 동일, 2026-09-11 CDP).
 */
export function HomeRevealFlag() {
  useIsoLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add(HOME_REVEAL_CLASS);
    return () => root.classList.remove(HOME_REVEAL_CLASS);
  }, []);

  return null;
}
