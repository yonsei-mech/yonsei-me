import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { DetailNavBar } from '@/components/DetailNavBar';
import { FacultyProfileArticle } from '@/components/FacultyProfileArticle';
import { getFacultyProfileNames } from '@/lib/faculty';
import {
  getFacultyDirectoryRuntime,
  getFacultyProfileRuntime,
  getFacultySummariesRuntime,
} from '@/lib/content-runtime';
import { pick } from '@/lib/content';
import { sectionTabHref } from '@/lib/board-links';
import { pageMetadata } from '@/lib/page-metadata';
import { localeUrl } from '@/lib/seo';
import { SITE_URL } from '@/lib/site';
import { routing, type Locale } from '@/i18n/routing';

// 콘텐츠 소스 전환(Stage A): 직위·연구실을 채우는 인명록이 데이터 레이어를 읽는다 — ISR 안전망
export const revalidate = 300;

// content/faculty-profiles 의 파일명(한글 이름)이 그대로 slug 다 — 빌드 시 전수 프리렌더.
export function generateStaticParams() {
  const names = getFacultyProfileNames();
  return routing.locales.flatMap((locale) => names.map((slug) => ({ locale, slug })));
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const locale = params.locale as Locale;
  const name = decodeURIComponent(params.slug);
  // CMS 학술활동 편집(content_files)이 재배포 없이 반영되도록 데이터 레이어를 읽는다
  const profile = await getFacultyProfileRuntime(name);
  if (!profile) return {};
  const record = (await getFacultyDirectoryRuntime()).find((f) => f.name === profile.name) ?? null;
  const tSeo = await getTranslations({ locale, namespace: 'seo' });
  // en 로케일이면 영문 필드를 우선하고 없으면 한국어로 폴백 — 인명록 그리드와 같은 규칙
  const isEn = locale === 'en';
  const displayName = (isEn && profile.nameEn) || profile.name;
  const position = record?.title ?? '';
  const specialty = (isEn && record?.specialtyEn) || record?.specialty || '';
  const labName = record?.lab ? (isEn && record.lab.nameEn) || record.lab.nameKo : '';
  // 예전 description 은 직위 한 단어("교수")뿐이라 수십 명이 똑같았다 —
  // 이름·직위·전공분야(+연구실)로 교수마다 다른 문장을 만든다.
  const base = specialty
    ? tSeo('facultyProfile', { name: displayName, position, specialty })
    : tSeo('facultyProfileBasic', { name: displayName, position });
  const description = labName ? `${base} ${tSeo('facultyProfileLab', { lab: labName })}` : base;
  return pageMetadata({
    locale,
    // 교수 프로필은 항상 양 로케일이 존재한다(같은 데이터를 두 언어 셸로 렌더) → fields 없음.
    // 디코드한 이름을 넘긴다 — pageAlternates 가 세그먼트를 다시 퍼센트 인코딩한다.
    path: `faculty/${name}`,
    title: profile.nameEn ? `${profile.name} (${profile.nameEn})` : profile.name,
    description,
    // 공유 카드는 기본 커버 대신 교수 사진을 쓴다(있을 때)
    image: record?.photo ?? null,
  });
}

export default async function FacultyProfilePage({
  params,
}: {
  params: { locale: string; slug: string };
}) {
  setRequestLocale(params.locale);
  const name = decodeURIComponent(params.slug);
  const profile = await getFacultyProfileRuntime(name);
  if (!profile) notFound();

  // 직위·보직·연구실·사진은 프로필 JSON 에 없다 — 같은 이름의 인명록 레코드에서 가져온다
  const record = (await getFacultyDirectoryRuntime()).find((f) => f.name === profile.name) ?? null;

  // AI 연구요약 — CMS 가 관리하는 별도 파일(교수 한글 이름이 키)에서 읽어 로케일을
  // 서버에서 해석해 넘긴다. 연구실 목록과 달리 개행은 접지 않는다 — 이 패널은 문단
  // 구분(빈 줄)을 그대로 살려 보여 주는 것이 기존 표시다.
  const summaries = await getFacultySummariesRuntime();
  const summaryPair = summaries[profile.name];
  const aiSummary = summaryPair ? pick(summaryPair, params.locale as 'ko' | 'en') : null;

  const t = await getTranslations({ locale: params.locale, namespace: 'faculty' });
  const tNav = await getTranslations({ locale: params.locale, namespace: 'nav' });
  // 홈 라벨은 히어로 브레드크럼과 같은 출처를 쓴다(nav 에는 home 키가 없다)
  const tCrumb = await getTranslations({ locale: params.locale, namespace: 'breadcrumb' });
  const tMeta = await getTranslations({ locale: params.locale, namespace: 'meta' });

  // 인물 구조화 데이터(JSON-LD) — 교수 이름 검색에서 이 페이지가 그 사람의 학과 프로필임을
  // 명시한다(지식패널·사이트링크 신호). 빈 값은 키째 뺀다 — null 을 실으면 무효 값이 된다.
  const locale = params.locale as Locale;
  const isEn = locale === 'en';
  const photo = record?.photo ?? null;
  const personJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.name,
    ...(profile.nameEn ? { alternateName: profile.nameEn } : {}),
    ...(record?.title ? { jobTitle: record.title } : {}),
    worksFor: {
      '@type': 'CollegeOrUniversity',
      name: tMeta('siteName'),
      url: `${SITE_URL}/${locale}`,
    },
    ...(profile.email ? { email: profile.email } : {}),
    ...(profile.phone ? { telephone: profile.phone } : {}),
    // 사진 경로는 R2 절대 URL 이거나 사내 상대 경로다 — 구조화 데이터는 절대 URL 이어야 한다
    ...(photo ? { image: photo.startsWith('http') ? photo : `${SITE_URL}${photo}` } : {}),
    url: localeUrl(locale, `faculty/${name}`),
    ...((isEn && record?.specialtyEn) || record?.specialty
      ? { knowsAbout: (isEn && record?.specialtyEn) || record?.specialty }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // 자체 데이터(인명록·프로필 JSON) — 사용자 입력 미포함, XSS 벡터 없음
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
      />
      {/* 히어로 제목은 섹션명('교수진')이라 h1 은 본문의 교수 이름이 갖는다(시각 변화 없음) */}
      <Hero
        title={t('hero.title')}
        breadcrumb={[
          { label: tNav('faculty'), href: sectionTabHref('about', 'faculty') },
          { label: profile.name },
        ]}
        titleTag="p"
      />
      {/* 히어로 아래 sticky 바 — 이력이 수백 행이라 상단에 탈출구가 없으면
          맨 아래 버튼까지 스크롤해야만 목록으로 돌아갈 수 있다 */}
      <DetailNavBar
        homeLabel={tCrumb('home')}
        sectionLabel={tNav('faculty')}
        sectionHref={sectionTabHref('about', 'faculty')}
        currentLabel={profile.name}
      />
      {/* 상단 여백을 30px 로 줄인다 — 본문 첫 요소가 "목록으로" 버튼이라 섹션 기본
          리듬(py-section)만큼 띄우면 탈출구가 화면 밖으로 밀려난다.
          cn 은 tailwind-merge 가 아니라 단순 join 이므로 ! 로 확실히 덮는다. */}
      <Section className="!pt-[30px]">
        <FacultyProfileArticle
          profile={profile}
          record={record}
          locale={params.locale}
          aiSummary={aiSummary}
          titleTag="h1"
        />
      </Section>
    </>
  );
}
