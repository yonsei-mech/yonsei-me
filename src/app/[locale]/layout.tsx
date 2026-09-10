import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { HeaderChrome } from '@/components/HeaderChrome';
import { SiteChrome } from '@/components/SiteChrome';
import { SmoothScroll } from '@/components/SmoothScroll';
import { ScrollRestoration } from '@/components/ScrollRestoration';
import { PerfLiteScript } from '@/components/PerfLiteScript';
import { PopupNotice } from '@/components/PopupNotice';
import { getEnabledPopupsRuntime } from '@/lib/content-runtime';
import { pickMessageNamespaces } from '@/lib/i18n-client-namespaces';
import { SITE_URL } from '@/lib/site';
import '../globals.css';
// 웹폰트 @font-face(unicode-range 동적 서브셋, 생성물). 첫 페인트에 필요한 core·히어로 조각만
// 여기(렌더 차단)에 있고, 나머지 조각은 WEBFONTS_REST_CSS 를 <head> 인라인 스크립트가 비차단으로
// 끼운다. next/font 는 더 쓰지 않는다 — 배경·재생성은 tools/fonts/README.md.
import '../webfonts.css';
import { WEBFONTS, WEBFONTS_REST_CSS } from '../webfonts-manifest';

// 모든 로케일을 정적으로 프리렌더 → 성능(SSG)
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'meta' });
  return {
    title: {
      default: t('siteName'),
      // `제목 | 사이트명` — 구글의 제목 링크 지침이 권하는 브랜딩 형태이자,
      // 여기 붙는 이름이 아래 WebSite JSON-LD 의 name 과 **같은 문자열**이어야
      // 구글이 이것을 사이트명으로 인식한다. 예전엔 shortName('기계공학부')을
      // 가운뎃점으로 붙였는데, 구글이 그 꼬리를 잘라 내 제목을 "교직원" 한 단어로
      // 표시하고 사이트명은 호스팅사(Vercel)로 떨어졌다.
      template: `%s | ${t('siteName')}`,
    },
    description: t('description'),
    // 배포 도메인 단일 출처(robots·sitemap·JSON-LD 와 동일). 예전엔 여기만 학교
    // 도메인이 하드코딩돼 있어 sitemap 이 가리키는 주소와 어긋났다.
    metadataBase: new URL(SITE_URL),
    openGraph: {
      title: t('siteName'),
      description: t('description'),
      siteName: t('siteName'),
      locale: params.locale === 'ko' ? 'ko_KR' : 'en_US',
      type: 'website',
      // 정적 커버(public/og/cover.jpg) — 처음엔 opengraph-image.tsx 라우트였지만
      // @vercel/og 가 woff2 폰트를 못 읽어 빌드가 깨졌다(Unsupported OpenType
      // signature wOF2). 같은 디자인을 헤드리스 Chrome 으로 한 번 구워 정적 자산으로
      // 쓴다 — 런타임 폰트 파싱이 사라져 어떤 환경에서도 깨질 수 없다.
      // 치수는 og 표준 1200×630 — lib/page-metadata.ts 의 기본값과 같은 파일이다.
      images: [
        {
          url: '/og/cover.jpg',
          width: 1200,
          height: 630,
          alt: '연세대학교 기계공학부 · School of Mechanical Engineering',
        },
      ],
    },
    // 트위터/X 카드 — og:image 를 그대로 쓰되 큰 이미지 카드로 표시되게 한다
    twitter: { card: 'summary_large_image' },
    // './' 는 현재 경로로 해석된다 — 하위 페이지가 각자 자기 URL 을 정본으로 갖는다.
    // 절대 경로를 쓰면 모든 페이지가 한 URL 을 가리켜 색인에서 사라진다.
    alternates: {
      canonical: './',
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const { locale } = params;

  if (!routing.locales.includes(locale as never)) {
    notFound();
  }

  // 정적 렌더링 활성화
  setRequestLocale(locale);

  // 브라우저로 내려보낼 메시지는 클라이언트가 실제로 쓰는 네임스페이스만 고른다
  // (전량은 모든 문서의 RSC 페이로드에 인라인된다 — ko 15KB · en 23KB).
  // 목록 관리·안전망(`npm run check:i18n`)은 lib/i18n-client-namespaces.ts 주석 참고.
  const messages = pickMessageNamespaces(await getMessages());
  const t = await getTranslations({ locale, namespace: 'nav' });
  const tMeta = await getTranslations({ locale, namespace: 'meta' });
  const tPopup = await getTranslations({ locale, namespace: 'popup' });

  // 팝업 공지 — '노출' 이 켜진 것만 통째로 내려보내고, 게재 기간·기기·페이지 판정은
  // 브라우저가 한다(정적 페이지라 서버에서 거르면 끝난 팝업이 남는다).
  const popups = await getEnabledPopupsRuntime();

  // 조직 구조화 데이터(JSON-LD) — 검색엔진에 기관 정보를 명시(사이트링크·지식패널 신호).
  // 로케일별 이름을 넣고 반대 로케일 명칭은 alternateName 으로 제공한다.
  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollegeOrUniversity',
    name: tMeta('siteName'),
    alternateName:
      locale === 'ko' ? 'Yonsei University School of Mechanical Engineering' : '연세대학교 기계공학부',
    url: `${SITE_URL}/${locale}`,
    logo: `${SITE_URL}/logo.svg`,
    parentOrganization: {
      '@type': 'CollegeOrUniversity',
      name: locale === 'ko' ? '연세대학교' : 'Yonsei University',
      url: 'https://www.yonsei.ac.kr',
    },
  };

  // 사이트명 구조화 데이터(JSON-LD) — 검색결과 헤더에 표시할 **사이트 이름**의 1차 신호다.
  // 이게 없으면 구글은 도메인에서 이름을 유추하는데, 서브도메인은 상위 도메인의 이름으로
  // 떨어진다 — yonsei-me.vercel.app 이 "Vercel" 로 표시된 실측 원인이 이것이다.
  //
  // url 은 로케일 URL 이 아니라 **루트**(`${SITE_URL}/`) 다. 구글은 사이트를 홈에서
  // 판정하고, 홈이 리다이렉트하면 그 목적지(/ → 307 → /ko)를 평가한다.
  // name 은 `<title>` 템플릿이 붙이는 접미사와 같은 문자열이어야 인식률이 높다.
  const siteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: tMeta('siteName'),
    alternateName:
      locale === 'ko'
        ? ['연세대 기계공학부', 'Yonsei University School of Mechanical Engineering', 'Yonsei ME']
        : ['연세대학교 기계공학부', 'Yonsei ME'],
    url: `${SITE_URL}/`,
  };

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Pretendard 'core' 조각(KS X 1001 상용 2,350자 + 라틴·기호 전부, ~740KB) preload.
            어느 페이지든 본문 거의 전부가 이 한 파일에서 나온다 — unicode-range 폰트는 CSS
            파싱·레이아웃 뒤에야 요청되므로 HTML 단계에서 먼저 띄워 폴백→본체 교체(swap)
            시점을 앞당긴다. 희귀 음절 조각(PretendardVariable.<n>.woff2)은 실제로 나올 때만
            내려받으니 preload 하지 않는다. 파일명은 tools/fonts/split-dynamic-subset.py 가
            정한다(scheme='core'). 홈 히어로 전용 지마켓 조각은 [locale]/page.tsx 가, 세부탭
            제목의 Paperlogy core 는 TabPageShell 이 따로 preload 한다(쓰는 페이지에서만). */}
        <link
          rel="preload"
          href={WEBFONTS.pretendard.core}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* 나머지 조각(희귀 음절·히어로 밖 지마켓·Paperlogy 희귀 음절)의 @font-face 묶음을
            **비차단**으로 끼운다. <link rel=stylesheet> 로 두면 렌더 차단 CSS 가 150KB 늘어난다
            (PageSpeed "렌더링 차단 요청" 600ms 의 원인이 이것이었다). 동적으로 삽입한 스타일시트는
            렌더를 막지 않고, 파싱 즉시 실행되므로 critical CSS 와 거의 동시에 받기 시작한다.
            늦게 와도 글자가 빠지진 않는다 — KS X 1001 밖 음절만 폴백 서체로 잠깐 보였다 바뀐다.
            자체 생성 정적 문자열(사용자 입력 미포함) — XSS 벡터 없음. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var l=document.createElement('link');l.rel='stylesheet';l.href=${JSON.stringify(WEBFONTS_REST_CSS)};document.head.appendChild(l)})()`,
          }}
        />
      </head>
      <body className="min-h-dvh bg-surface antialiased">
        {/* GPU 가속 꺼짐 판정 → html.perf-lite. 헤더가 파싱되기 전에 실행돼야
            무거운 backdrop-filter 가 한 프레임도 그려지지 않는다 */}
        <PerfLiteScript />
        {/* 전역 부드러운 스크롤(Lenis) — reduced-motion 시 자동 비활성 */}
        <SmoothScroll />
        {/* 새로고침 시 이전 스크롤 위치 복원을 끈다(맨 아래에서 시작하는 문제) */}
        <ScrollRestoration />
        <script
          type="application/ld+json"
          // 자체 생성 정적 데이터(사용자 입력 미포함) — XSS 벡터 없음
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <script
          type="application/ld+json"
          // 자체 생성 정적 데이터(사용자 입력 미포함) — XSS 벡터 없음
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
        <NextIntlClientProvider messages={messages}>
          <a href="#main" className="skip-link">
            {t('skipToContent')}
          </a>
          {/* 팝업 공지 — 게재 기간 안에만, 지정한 페이지에서만 스스로 뜬다 */}
          <PopupNotice
            popups={popups}
            locale={locale}
            labels={{
              close: tPopup('close'),
              hideToday: tPopup('hideToday'),
              dialog: tPopup('dialog'),
            }}
          />
          {/* 콘텐츠 관리 콘솔 전체에서 사이트 헤더를 감춘다(HeaderChrome) — 독립 전체 화면이라 */}
          <HeaderChrome>
            <Header />
          </HeaderChrome>
          <main id="main" className="overflow-x-clip">
            {children}
          </main>
          {/* 콘텐츠 관리 콘솔에서는 푸터도 렌더하지 않는다(SiteChrome) */}
          <SiteChrome>
            <Footer />
          </SiteChrome>
        </NextIntlClientProvider>
        {/* Vercel Web Analytics — 프로덕션에서만 /_vercel/insights 로 집계(퍼스트파티
            경로라 광고 차단기에 잘 안 걸린다). 쿠키를 심지 않아 동의 배너가 필요 없다. */}
        <Analytics />
        {/* Vercel Speed Insights — 실사용자 Web Vitals(CWV) 수집. Analytics 와 같은
            퍼스트파티 경로(/_vercel/speed-insights)·무쿠키 방식이다. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
