'use client';

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { CustomEase } from 'gsap/CustomEase';
import styles from './HeroSlideshow.module.css';
import { prefersReducedMotion } from '@/lib/utils';

// SplitText·CustomEase 는 이제 무료 public gsap 패키지에 포함(Club 토큰 불필요).
gsap.registerPlugin(SplitText, CustomEase);
// crisp 슬라이드쇼의 wipe 이징 그대로 이식.
CustomEase.create('hero-wipe', '0.625, 0.05, 0, 1');

// SSR 안전 layout effect — 클라이언트에선 페인트 전에 초기 상태를 잡아 깜빡임을 막고,
// 서버 렌더 시 useLayoutEffect 경고를 피한다.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// 자동 전환 간격(ms) — 사용자가 '슬라이드쇼'임을 인지하도록 천천히 순환한다.
const AUTO_ADVANCE_MS = 6500;

// ── 히어로 사진 서빙 ────────────────────────────────────────────────────
// next/image 를 쓰지 않고 <picture> 를 직접 짜는 이유: 화면비에 따라 가로본/세로본이라는
// 서로 다른 크롭을 내려줘야 하는데(아트디렉션), next/image 는 한 소스만 다룬다.
// 최적화는 그대로 Next 이미지 라우트가 한다 — URL 형식만 손으로 만든다.
//
// ⚠️ w 는 next.config 의 deviceSizes 목록에 있는 값만 허용된다(그 외는 400).
const OPT_WIDTHS = [640, 750, 828, 1080, 1200, 1920, 2048] as const;
const OPT_QUALITY = 75;

function optimized(src: string, width: number): string {
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${OPT_QUALITY}`;
}

function buildSrcSet(src: string): string {
  return OPT_WIDTHS.map((w) => `${optimized(src, w)} ${w}w`).join(', ');
}

// 세로 크롭본(9:16)이 세로 화면을 cover 로 덮으면 폭이 화면보다 최대 1.35배까지 커진다
// (높이에 맞춰 확대되므로). 100vw 로 알리면 그만큼 모자란 파일을 받아 뿌옇게 나온다.
// 원본이 1620px 이라 과요청해도 그 이상은 안 나가므로 넉넉히 잡는다.
const PORTRAIT_SIZES = '135vw';

// ── 슬라이드 지연 마운트 ────────────────────────────────────────────────
// 6장이 겹쳐 쌓여 있고 전부 뷰포트 안이라 loading="lazy" 가 아무 일도 하지 않았다 —
// 첫 로드에 6장(모바일 640KB)이 한꺼번에 나갔고, 그중 5장은 최소 6.5초 뒤에나 쓰인다.
// 그래서 <picture> 자체를 마운트 집합으로 통제한다:
//   · SSR/첫 렌더 {0,1} → 정적 HTML 에 슬라이드 0 이 들어가 파싱 중에 바로 받는다.
//   · 페인트 직전 레이아웃 이펙트에서 추첨된 시작 슬라이드 k 를 추가(빈 히어로 방지).
//   · load 이후 유휴 시간에 k+1, k+2 … 순서로 하나씩(직전 장의 decode 완료를 기다린 뒤)
//     — 첫 전환(6.5초)보다 한참 먼저 도착하면서 LCP 경쟁은 하지 않는다.
//   · 그래도 못 받은 슬라이드로 넘어가야 하면 goTo 가 최대 800ms 기다렸다 전환한다.
// 슬라이드 래퍼(.slide/.parallax, 패럴랙스 ref·role·aria)는 그대로 두고 <picture> 만
// 조건부다. .parallax 가 position:absolute; inset:0 이라 사진이 없어도 레이아웃은 같다.
const INITIAL_MOUNTED = [0, 1];
/** 아직 못 받은 슬라이드로 전환해야 할 때 기다려 주는 상한(ms). */
const DECODE_WAIT_CAP = 800;

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type HeroSlide = {
  /** 연구 분야 키(research-gallery.json 과 동일) */
  field: string;
  /** 로케일 해석이 끝난 분야 라벨 */
  label: string;
  /** /img/hero/*.jpg 원본 경로(next/image 가 최적화 서빙) */
  image: string;
  /** /img/hero-mobile/*.jpg — 세로(9:16) 크롭본. 없으면 가로 원본으로 폴백한다. */
  imageMobile?: string;
  /** '연구 분야 바로가기' 화살표 링크의 접근성 라벨(로케일 해석 완료) — 없으면 링크 미표시 */
  linkLabel?: string;
};

type Props = {
  slides: HeroSlide[];
  /** 히어로 제목(예: "연세대학교 기계공학부") */
  title: string;
  /** 분야 목록 nav 의 aria-label */
  navLabel: string;
  /** 제목 아래에서 주기 교체되는 카피(로케일 해석 완료) */
  taglines: string[];
  /** 좌상단 학부 소개 링크 라벨(예: "기계공학부란? →" — 화살표 포함·로케일 해석 완료) */
  aboutLabel: string;
};

/**
 * 홈 히어로 — Osmo "crisp-slideshow" 전환 + "gallery-to-overlay" 분야 목록 포팅.
 * (crisp-loading 등장 로더는 사용자 지시로 삭제 — 접속 즉시 완성 상태로 시작한다)
 *
 * 시작 슬라이드는 마운트 시 랜덤 추첨 — 방문마다 다른 연구 분야로 시작.
 * 슬라이드 전환(crisp-slideshow): CustomEase wipe + 패럴랙스(슬라이드 래퍼
 * overflow:hidden 클리핑으로 왼쪽 끝부터 닦아내듯 리빌). 6.5초 자동 전환 = 하단
 * 진행 바 트윈 완료가 트리거(표시와 전환이 정확히 동기). 분야 텍스트 클릭=슬라이드
 * 전환(미리보기), 더블클릭·화살표=연구 페이지 해당 분야로 이동. 호버/포커스 시
 * 자동 전환 일시정지. 제목 아래 회전 카피는 슬라이드 전환과 동시에 교체된다.
 * 분야 목록(gallery-to-overlay): :has() 호버로 호버 항목만 선명, 나머지 흐림(순수 CSS).
 *
 * 불변 조건: 부모 #sec-hero(fixed inset-0 -z-10, 그라디언트 배경)는 이미지 로드 전 폴백.
 * reduced-motion: 자동 전환·카피/전환 애니메이션 없이 정적 노출(수동 전환은 가능).
 */
export function HeroSlideshow({ slides, title, navLabel, taglines, aboutLabel }: Props) {
  const heroRef = useRef<HTMLElement | null>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const parallaxRefs = useRef<Array<HTMLDivElement | null>>([]);
  const taglineRef = useRef<HTMLParagraphElement | null>(null);
  // 하단 진행 바 — 채움 트윈의 완료가 곧 자동 전환 트리거(타이밍 완전 동기)
  const barRef = useRef<HTMLDivElement | null>(null);
  const barTweenRef = useRef<gsap.core.Tween | null>(null);
  // 분야명 더블클릭 시 연구 페이지 해당 분야로 이동(화살표 링크와 동일 목적지)
  const router = useRouter();

  // 현재 슬라이드 인덱스 — nav 의 aria-current/블루 강조에만 쓰인다.
  // 슬라이드 .current 클래스(가시성)는 GSAP 와의 충돌을 피해 명령형으로만 토글한다.
  const [current, setCurrent] = useState(0);
  const currentRef = useRef(0);
  const animatingRef = useRef(false);
  const pausedRef = useRef(false); // nav 호버/포커스 시 자동 전환 일시정지
  // 회전 카피 인덱스 — 슬라이드 전환과 동시에 교체(reduced-motion 은 즉시 교체)
  const [tagIdx, setTagIdx] = useState(0);

  // --- 마운트된 슬라이드 집합(위 '슬라이드 지연 마운트' 주석 참조) ---
  // 진실은 ref 에 두고 렌더만 강제한다 — 전환 직전 동기 판정(goTo)이 필요해서
  // setState 의 비동기 반영을 기다릴 수 없다. 초기값이 상수라 hydration 은 안전하다.
  const imgRefs = useRef<Array<HTMLImageElement | null>>([]);
  const mountedRef = useRef<Set<number>>(new Set(INITIAL_MOUNTED));
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const mount = useCallback(
    (i: number) => {
      if (i < 0 || i >= slides.length || mountedRef.current.has(i)) return;
      mountedRef.current.add(i);
      rerender();
    },
    [slides.length],
  );

  /** 슬라이드 i 를 마운트하고 디코딩까지 끝나길(최대 cap ms) 기다린다. */
  const ensureReady = useCallback(
    async (i: number, cap: number) => {
      mount(i);
      const until = performance.now() + cap;
      // React 가 <img> 를 붙일 때까지 프레임 단위로 기다린다(대개 1프레임).
      while (!imgRefs.current[i] && performance.now() < until) await raf();
      const img = imgRefs.current[i];
      if (!img) return false;
      if (img.complete && img.naturalWidth > 0) return true;
      const left = Math.max(0, until - performance.now());
      // decode() 는 src 가 바뀌면 reject 한다 — 실패해도 전환은 막지 않는다.
      await Promise.race([img.decode().catch(() => undefined), delay(left)]);
      return img.complete && img.naturalWidth > 0;
    },
    [mount],
  );

  // --- 회전 카피 전진 — 슬라이드 전환과 동시에 다음 문구로(사용자 지시: 배경과 동기).
  // 짧은 페이드아웃 → 교체(아래 layout effect 가 글자 타이핑 인). reduced-motion 은
  // 애니메이션 없이 즉시 교체. ---
  const advanceTagline = useCallback(() => {
    if (taglines.length <= 1) return;
    const el = taglineRef.current;
    if (!el || prefersReducedMotion()) {
      setTagIdx((i) => (i + 1) % taglines.length);
      return;
    }
    gsap.to(el, {
      autoAlpha: 0,
      duration: 0.25,
      ease: 'power1.in',
      onComplete: () => setTagIdx((i) => (i + 1) % taglines.length),
    });
  }, [taglines.length]);

  // --- 슬라이드 전환(wipe + 패럴랙스), crisp navigate() 이식 ---
  const runTransition = useCallback((target: number) => {
    const prev = currentRef.current;
    if (animatingRef.current || target === prev) return;
    const direction = target > prev ? 1 : -1;

    const outSlide = slideRefs.current[prev];
    const outInner = parallaxRefs.current[prev];
    const inSlide = slideRefs.current[target];
    const inInner = parallaxRefs.current[target];
    if (!outSlide || !outInner || !inSlide || !inInner) return;

    animatingRef.current = true;
    gsap
      .timeline({
        defaults: { duration: 1.5, ease: 'hero-wipe' },
        onStart: () => {
          inSlide.classList.add(styles.current);
          // 들어오는 슬라이드를 최상단으로 → 전환 끝에서 나가는 슬라이드의 패럴랙스
          // 잔상이 opacity:0 로 툭 사라져 보이던 '끊김'을 항상 덮어 가린다.
          outSlide.style.zIndex = '1';
          inSlide.style.zIndex = '2';
          currentRef.current = target;
          setCurrent(target);
          advanceTagline();
        },
        onComplete: () => {
          outSlide.classList.remove(styles.current);
          outSlide.style.zIndex = '';
          animatingRef.current = false;
        },
      })
      .to(outSlide, { xPercent: -direction * 100 }, 0)
      .to(outInner, { xPercent: direction * 75 }, 0)
      .fromTo(inSlide, { xPercent: direction * 100 }, { xPercent: 0 }, 0)
      .fromTo(inInner, { xPercent: -direction * 75 }, { xPercent: 0 }, 0);
  }, [advanceTagline]);

  // 전환 게이트 — 사진이 아직 없는 슬라이드로 크로스페이드하면 빈 화면이 스친다.
  // 이미 받아 둔 경우(대부분)는 예전과 똑같이 즉시 전환하고, 아주 느린 회선의 첫
  // 몇 초에만 최대 DECODE_WAIT_CAP 을 기다렸다 전환한다. 기다리는 동안 들어온
  // 새 요청(사용자 클릭·다음 자동 전환)이 우선이다.
  const goRequest = useRef(0);
  const goTo = useCallback(
    (target: number) => {
      if (target === currentRef.current) return;
      const seq = ++goRequest.current;
      const img = imgRefs.current[target];
      if (mountedRef.current.has(target) && img?.complete && img.naturalWidth > 0) {
        runTransition(target);
        return;
      }
      void ensureReady(target, DECODE_WAIT_CAP).then(() => {
        if (seq !== goRequest.current) return; // 더 최근 요청에 밀렸다
        runTransition(target);
      });
    },
    [ensureReady, runTransition],
  );

  // --- 마운트: 시작 슬라이드 추첨(방문마다 다른 연구 분야로 시작) ---
  // SSR/첫 렌더는 0 으로 일치시키고 페인트 전 layout effect 에서 확정 → 깜빡임·
  // hydration 불일치 없음. 추첨 결과 k 는 곧 화면에 보일 슬라이드라 여기서 함께
  // 마운트한다(레이아웃 이펙트의 setState 는 페인트 전에 동기 반영된다).
  const startIdxRef = useRef(0);
  useIsoLayoutEffect(() => {
    const k = Math.floor(Math.random() * slides.length);
    startIdxRef.current = k;
    mount(k);
    slideRefs.current[k]?.classList.add(styles.current);
    currentRef.current = k;
    setCurrent(k);
    // StrictMode(dev)는 이 이펙트를 두 번 실행한다 — 정리 없이는 서로 다른 두 슬라이드에
    // .current 가 남아 두 장이 겹쳐 보인다(프로덕션에선 언마운트 때만 실행되므로 무해).
    return () => {
      slideRefs.current[k]?.classList.remove(styles.current);
    };
    // slides.length 는 정적 콘텐츠 파생 고정값 — 마운트 1회만 실행하면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 나머지 슬라이드: load 이후 유휴 시간에 '다음에 보일 순서'대로 하나씩 ---
  // 직전 장의 decode 가 끝난 뒤 다음 장을 붙여, 첫 페인트/LCP 와 대역폭을 다투지
  // 않으면서도 첫 전환(6.5초) 전에 전부 도착한다.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const k = startIdxRef.current;
      for (let n = 1; n <= slides.length; n += 1) {
        if (cancelled) return;
        const i = (k + n) % slides.length;
        if (mountedRef.current.has(i)) continue;
        await ensureReady(i, 15000);
      }
    };
    const schedule = () => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => void run(), { timeout: 1500 });
      } else {
        window.setTimeout(() => void run(), 1500);
      }
    };
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', schedule);
    };
  }, [ensureReady, slides.length]);

  // --- 자동 전환 = 하단 진행 바 트윈 — 바가 좌→우로 다 차면(6.5초) 다음 슬라이드.
  // setInterval 대신 바 자체가 타이머라 표시와 전환이 정확히 동기다.
  // current 가 바뀔 때마다(자동·수동 모두) 0부터 다시 채운다.
  useEffect(() => {
    if (prefersReducedMotion() || slides.length <= 1) return;
    const bar = barRef.current;
    if (!bar) return;
    const tween = gsap.fromTo(
      bar,
      { scaleX: 0 },
      {
        scaleX: 1,
        duration: AUTO_ADVANCE_MS / 1000,
        ease: 'none',
        onComplete: () => goTo((currentRef.current + 1) % slides.length),
      },
    );
    barTweenRef.current = tween;
    if (pausedRef.current || document.hidden) tween.pause();
    const onVis = () => {
      if (document.hidden) tween.pause();
      else if (!pausedRef.current) tween.play();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      barTweenRef.current = null;
      tween.kill();
    };
  }, [current, goTo, slides.length]);

  // --- 교체된 카피 타이핑 인 — 학과목표 섹션과 동일(SplitText chars 마스크 라이즈,
  // 글자 하나씩 왼쪽부터). 인덱스 0 복귀를 포함한 모든 교체에 걸린다(이전 구현은
  // 0 복귀를 건너뛰어 한 사이클마다 빈 구간이 생기던 버그). 최초 마운트만 스킵
  // (초기 카피는 첫 렌더에 정적 노출). p 는 key={tagIdx} 로 매 교체
  // 리마운트 — SplitText.revert 가 옛 텍스트 스냅샷으로 새 문구를 덮는 충돌 차단. ---
  const tagFirstRender = useRef(true);
  useIsoLayoutEffect(() => {
    if (tagFirstRender.current) {
      tagFirstRender.current = false;
      return;
    }
    const el = taglineRef.current;
    if (!el || prefersReducedMotion()) return;
    const split = SplitText.create(el, { type: 'chars', mask: 'chars', aria: 'none' });
    gsap.set(el, { autoAlpha: 1 });
    gsap.set(split.chars, { yPercent: 110 });
    const tween = gsap.to(split.chars, {
      yPercent: 0,
      duration: 0.5,
      stagger: 0.03,
      ease: 'power3.out',
    });
    return () => {
      tween.kill();
      split.revert();
    };
  }, [tagIdx]);

  // --- 언마운트 정리: 진행 중 트윈 kill(전역) ---
  useEffect(() => {
    const hero = heroRef.current;
    return () => {
      if (hero) gsap.killTweensOf(hero.querySelectorAll('*'));
    };
  }, []);

  return (
    <section ref={heroRef} className={styles.hero} aria-roledescription="carousel">
      {/* 슬라이드 스택 — 트랜스폼은 래퍼 div 에만, next/image 엔 걸지 않는다 */}
      <div className={styles.slides}>
        {slides.map((s, i) => (
          <div
            key={s.field}
            ref={(el) => {
              slideRefs.current[i] = el;
            }}
            className={styles.slide}
            role="group"
            aria-roledescription="slide"
            aria-label={s.label}
            aria-hidden={current !== i}
          >
            <div
              ref={(el) => {
                parallaxRefs.current[i] = el;
              }}
              className={styles.parallax}
            >
              {/* 아트디렉션 — 세로로 긴 화면(≤3:4)에서는 세로 크롭본을 쓴다.
                  <source> 는 조건에 맞는 하나만 내려받으므로 두 벌을 다 받지 않는다.
                  마운트 집합에 든 슬라이드만 그린다(위 '슬라이드 지연 마운트' 참조). */}
              {mountedRef.current.has(i) && (
                <picture>
                  {s.imageMobile && (
                    <source
                      media="(max-aspect-ratio: 3/4)"
                      srcSet={buildSrcSet(s.imageMobile)}
                      sizes={PORTRAIT_SIZES}
                    />
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element -- <picture> 아트디렉션은 next/image 로 표현할 수 없다 */}
                  <img
                    ref={(el) => {
                      imgRefs.current[i] = el;
                    }}
                    src={optimized(s.image, 1200)}
                    srcSet={buildSrcSet(s.image)}
                    sizes="100vw"
                    alt=""
                    className={styles.image}
                    draggable={false}
                    decoding="async"
                    loading={i === 0 ? 'eager' : 'lazy'}
                    // 첫 화면에 실제로 보이는 슬라이드가 LCP 후보다(시작 슬라이드는 추첨).
                    fetchPriority={i === 0 || i === current ? 'high' : 'auto'}
                  />
                </picture>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 가독성 스크림(그림자 금지 → 균일 다크 + 하단 그라디언트) */}
      <div className={styles.scrim} aria-hidden="true" />

      {/* 타이틀 블록 — 레퍼런스(홍익 조형대)식 좌측 하단 배치: 대형 제목 + 회전 카피 */}
      <div className={styles.titleBlock}>
        {/* 제목 바로 위 학부 소개 링크 — 히어로 개편 때 사라진 (구)AnimatedHero 흰 밑줄 링크 복원.
            제목 좌측선에 맞춰 그 위에 얹는다(titleBlock 이 pointer-events:none 이라 링크만 auto). */}
        <Link href="/about" className={styles.about}>
          {aboutLabel}
        </Link>
        <h1 className={styles.title}>
          {title}
        </h1>
        {/* 회전 카피 — hicoda 식 라인 마스크(클립 안에서 솟아오름/빠져나감).
            주기 교체는 SR 에 소음이라 aria-hidden, 전체 문구는 아래 sr-only 로 제공 */}
        <div className={styles.taglineClip} aria-hidden="true">
          <p key={tagIdx} ref={taglineRef} className={styles.tagline}>
            {taglines[tagIdx] ?? ''}
          </p>
        </div>
        <p className="sr-only">{taglines.join('. ')}</p>
      </div>

      {/* 우측 하단 분야 목록 — 항상 노출(모바일 포함, 크기만 축소).
          호버/포커스 동안 자동 전환을 멈춰 사용자의 선택을 방해하지 않는다. */}
      <nav
        className={styles.nav}
        aria-label={navLabel}
        onMouseEnter={() => {
          pausedRef.current = true;
          barTweenRef.current?.pause();
        }}
        onMouseLeave={() => {
          pausedRef.current = false;
          if (!document.hidden) barTweenRef.current?.play();
        }}
        onFocusCapture={() => {
          pausedRef.current = true;
          barTweenRef.current?.pause();
        }}
        onBlurCapture={() => {
          pausedRef.current = false;
          if (!document.hidden) barTweenRef.current?.play();
        }}
      >
        <ul className={styles.list}>
          {slides.map((s, i) => (
            <li key={s.field} className={`${styles.item}${current === i ? ` ${styles.current}` : ''}`}>
              {/* inner: [바로가기 화살표(현재 분야만)] [분야명 버튼] — 화살표를 왼쪽에 두어
                  우측 정렬된 분야명 끝선이 흔들리지 않는다. 텍스트 클릭=슬라이드 전환(미리보기),
                  더블클릭=연구 페이지의 해당 분야로 이동(화살표와 동일 목적지 — 키보드·터치
                  접근은 화살표 링크가 담당). */}
              <div className={styles.inner}>
                {current === i && s.linkLabel && (
                  <Link
                    href={`/research?field=${s.field}#labs`}
                    className={styles.quick}
                    aria-label={s.linkLabel}
                    title={s.linkLabel}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={styles.quickIcon}>
                      <path
                        d="M7 17 17 7M9 7h8v8"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Link>
                )}
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => goTo(i)}
                  onDoubleClick={() => router.push(`/research?field=${s.field}#labs`)}
                  // 누르기 전에 사진부터 — 목록에서 먼 분야로 건너뛰어도 빈 화면이 없다.
                  onPointerEnter={() => mount(i)}
                  onTouchStart={() => mount(i)}
                  onFocus={() => mount(i)}
                  aria-current={current === i ? 'true' : undefined}
                >
                  <span className={styles.dot} aria-hidden="true" />
                  <span>{s.label}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      </nav>

      {/* 하단 진행 바 — 다음 슬라이드까지 남은 시간 표시(장식, 전환과 완전 동기).
          reduced-motion·단일 슬라이드에선 자동 전환이 없으므로 렌더하지 않는다. */}
      {slides.length > 1 && (
        <div className={styles.progressTrack} aria-hidden="true">
          <div ref={barRef} className={styles.progressFill} />
        </div>
      )}
    </section>
  );
}
