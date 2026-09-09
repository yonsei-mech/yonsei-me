import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Hero } from '@/components/Hero';
import { TabPageShell } from '@/components/TabPageShell';
import { LegacyBoardHash } from '@/components/LegacyBoardHash';
import { GuideSections, type GuideSection } from '@/components/AdmissionGuide';
import { LEGACY_ALUMNI_HASH } from '@/lib/board-links';
import { pageMetadata } from '@/lib/page-metadata';
import { getAlumniTabs } from './_shared/tabs';
import assoc from '@content/alumni-association.json';
import type { Locale } from '@/i18n/routing';

// /alumni 는 '동문회 소개' 자체다 — 게시판은 /alumni/network 로 독립했다.
// 여기서 읽는 것은 정적 JSON 뿐이라 DB 페치가 없다(그래서 ISR revalidate 도 없다).
const assocSections = (assoc as { sections: GuideSection[] }).sections;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale as Locale;
  const t = await getTranslations({ locale, namespace: 'alumni' });
  return pageMetadata({
    locale,
    path: 'alumni',
    title: t('hero.title'),
    description: t('hero.subtitle'),
  });
}

export default async function AlumniPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  const tAlumni = await getTranslations({ locale, namespace: 'alumni' });

  const tabs = await getAlumniTabs(locale);

  return (
    <>
      {/* narrow: 히어로 → 남색 바 → 본문이 한 좌측선에 선다(뉴스 목록과 동일) */}
      <Hero
        title={tAlumni('hero.title')}
        subtitle={tAlumni('hero.subtitle')}
        narrow
        breadcrumb={[{ label: tMenu('alumni.label') }]}
      />
      {/* 히어로 하단 남색 내비게이션 바 + 본문 — title 은 h2 큰 제목(현재 탭 라벨) */}
      <TabPageShell
        navTitle={tMenu('alumni.label')}
        tabs={tabs}
        activeKey="association"
        title={tMenu('alumni.items.association')}
        narrow
      >
        <GuideSections sections={assocSections} locale={locale} landingName="alumni-association" />
      </TabPageShell>
      {/* 구 링크 /alumni#news · /alumni#network 를 새 경로로 보낸다 */}
      <LegacyBoardHash map={LEGACY_ALUMNI_HASH} />
    </>
  );
}
