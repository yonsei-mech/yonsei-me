import localFont from 'next/font/local';

/**
 * 자체 호스팅 폰트.
 *
 * 왜 자체 호스팅: 이전에는 CSS 에서 'Pretendard' 이름만 지정하고 폰트 파일을
 * 싣지 않아, 방문자 기기에 Pretendard 가 설치돼 있어야만 의도한 서체로 보였다
 * (없으면 OS 기본 고딕으로 대체 → 기기마다 다른 모습). 사이트에 포함하면 모든
 * 기기에서 동일하게 렌더된다.
 *
 * ⚠️ Pretendard(--font-sans)와 지마켓산스(--font-hero)는 **여기 없다** (2026-09-10).
 * 두 폰트는 next/font 가 통짜 woff2(2.06MB + 591KB)를 매 첫 방문마다 preload 하던
 * 것을 버리고, 구글 폰트식 unicode-range 동적 서브셋으로 옮겼다 —
 * `src/app/webfonts.css`(생성물, 손대지 말 것)가 @font-face 를 싣고, 패밀리는
 * `globals.css` 의 :root 가 --font-sans / --font-hero 로 연결한다. 브라우저는 페이지에
 * 실제로 나온 글자가 속한 조각만 내려받으며 글리프는 하나도 빠지지 않는다.
 * 원본·생성기·재생성 방법: `tools/fonts/README.md`. next/font/local 은 unicode-range
 * 분할을 표현할 수 없어(src 배열이 weight/style 만 받는다) 이 둘은 CSS 로 간다.
 *
 * - display: 'swap' — 폰트 로드 전에는 폴백으로 즉시 텍스트 표시(빈 화면 방지)
 * - next/font 가 지표 보정된 폴백까지 변수에 자동 포함해 CLS 를 줄인다(Paperlogy).
 *   Pretendard·지마켓의 같은 보정값은 webfonts.css 의 'Pretendard Fallback' /
 *   'GmarketSans Fallback' 이 그대로 갖고 있다.
 */

/**
 * 세부탭 제목 전용 폰트 Paperlogy(사용자 지정, 2026-07-21).
 * 한 변수(--font-subhead)에 두 굵기를 실어 사용처의 font-weight 로 파일이 갈린다:
 *  - 600(6SemiBold): TabbedContent 탭 큰 제목("학과 소개" 등) — font-semibold
 *  - 700(7Bold): EditorialTab 제목·슬로건, AboutIntro 인트로 제목 — font-bold
 * 원본 TTF(public/fonts/Paperlogy-1.000)는 fontTools 로 woff2(각 ~160KB) 변환해
 * 자체 호스팅. 지정 굵기 파일이 그대로 쓰여 가짜 볼드 합성이 없다.
 */
export const paperlogy = localFont({
  src: [
    { path: './fonts/Paperlogy-6SemiBold.woff2', weight: '600' },
    { path: './fonts/Paperlogy-7Bold.woff2', weight: '700' },
  ],
  variable: '--font-subhead',
  display: 'swap',
  fallback: ['Pretendard', 'system-ui', 'sans-serif'],
});
