import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // dev 서버(npm run dev)와 프로덕션(next build/start)이 같은 .next 폴더를
  // 공유하면 서로의 산출물을 덮어써 500 에러가 나므로, dev는 별도 폴더를 쓴다.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  images: {
    formats: ['image/avif', 'image/webp'],
    // 최적화 결과 캐시 수명. Next 는 원본 응답의 Cache-Control 을 따라가는데 R2 객체에는
    // 그 헤더가 없어서 기본 60초마다 같은 사진을 다시 최적화했다(Vercel Hobby 에서
    // Image Optimization·Active CPU 를 그대로 먹는다). 업로드 키는 랜덤 접미사가 붙어
    // 내용이 바뀌지 않으므로(withRandomSuffix) 30일 보관이 안전하다.
    minimumCacheTTL: 60 * 60 * 24 * 30,
    // CMS 첨부(썸네일 등)는 외부 스토리지에 저장된다 — next/image 는 허용 목록에
    // 없는 외부 도메인을 거부하므로 열어 준다. R2 퍼블릭 도메인(pub-*.r2.dev)이
    // 현행이고, Blob 도메인은 과거 업로드 잔존분 호환용(정리 후 제거 예정).
    remotePatterns: [
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' },
      // 현행 학과 사이트에서 옮겨 온 게시물은 썸네일·본문 이미지를 미러링하지 않고
      // 원본 URL 을 그대로 가리킨다. 이 항목이 없으면 뉴스 목록·홈 캐러셀의
      // next/image 가 전부 400 으로 떨어진다.
      // me 말고도 www·engineering·urban·devcms 등 교내 다른 서브도메인의 사진을
      // 본문에 끌어다 쓴 글이 있어(뉴스 3건은 www) 학교 도메인 전체를 연다.
      { protocol: 'https', hostname: '*.yonsei.ac.kr' },
    ],
  },
  experimental: {
    // ISR 전환(Stage A)으로 fs 읽기가 빌드 시점이 아니라 요청 시점에 실행된다:
    // content/*.json·*.md 폴백(lib/content-runtime), content/faculty-profiles(교수 상세),
    // public/img/history·faculty 의 readdir(파일명 규약 매칭). 서버리스 함수 번들에
    // 이 파일들이 없으면 폴백이 빈 값으로 떨어지므로 전 라우트에 강제 포함시킨다.
    // 키는 라우트 경로에 picomatch({contains:true})로 매칭된다 — '**' 만 '/[locale]'
    // (홈)까지 포함한다('/**/*' 는 한 세그먼트 라우트를 놓친다).
    outputFileTracingIncludes: {
      '**': ['./content/**', './public/img/history/**', './public/img/faculty/**'],
    },
  },
  // PageSpeed "Best Practices" 가 잡는 보안 헤더 4종. 전 경로에 붙인다.
  // CSP 는 넣지 않는다 — 전 페이지가 정적 생성이라 요청마다 nonce 를 만들 수 없고,
  // nonce 없는 CSP 는 인라인 스크립트(next-intl 메시지·GSAP 초기화) 때문에
  // 'unsafe-inline' 을 열어야 해서 의미가 없다. 넣으려면 동적 렌더링이 전제다.
  async headers() {
    return [
      {
        // 동적 서브셋 폰트 조각(public/webfonts, 생성물). public/ 정적 파일은 Vercel 이
        // max-age=0(매 방문 재검증)으로 내보내는데, 파일명에 내용 해시가 들어가므로
        // (tools/fonts/split-dynamic-subset.py) next/font 가 쓰던 것과 같은 immutable 1년을 건다.
        source: '/webfonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // 저장소에 든 정적 사진(연구실 카드 33장, 독수리 마스크, 로고 등). public/ 은
        // 기본이 max-age=0, must-revalidate 라 재방문마다 카드 32장을 전부 재검증했다
        // (304 여도 왕복은 그대로 든다). 파일명에 내용 해시가 없어 immutable 은 못 쓰므로
        // 1시간 신선 + 1일 stale-while-revalidate 로 절충한다. CMS 가 올리는 콘텐츠
        // 사진은 R2(랜덤 접미사 키 = 사실상 immutable)에 있으니 이 규칙과 무관하고,
        // 저장소 사진을 교체 배포했을 때 최대 1시간 옛 사진이 보이는 것은 감수한다.
        source: '/img/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=86400' }],
      },
      {
        source: '/(.*)',
        headers: [
          // 카카오 로그인 팝업(CMS)이 opener 를 써야 해서 allow-popups 변형을 쓴다.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
