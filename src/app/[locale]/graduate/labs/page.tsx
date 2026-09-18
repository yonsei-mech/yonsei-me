import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LabVideoGallery } from '@/components/LabVideoGallery';
import { getLabsDirectoryRuntime } from '@/lib/content-runtime';
import { buildLabBrochure } from '@/lib/lab-brochure';
import { SectionTabPage, sectionTabMetadata } from '../../_shared/section-tabs';
import type { Locale } from '@/i18n/routing';

// 콘텐츠 소스 전환(Stage A): 연구실이 데이터 레이어를 읽는다 — ISR 안전망
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return sectionTabMetadata(params.locale, 'graduate', 'labs');
}

/** 연구실 소개 — 마크다운 대신 연구실 소개 영상 갤러리 */
export default async function GraduateLabsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const labs = await getLabsDirectoryRuntime();
  const locale = params.locale as Locale;
  // 연구실 소개자료 — /research/labs 와 같은 문서·같은 뷰어(쪽 조인은 서버에서)
  const brochure = buildLabBrochure(labs, locale);

  return (
    <SectionTabPage locale={params.locale} section="graduate" tab="labs">
      <LabVideoGallery items={labs} locale={locale} brochure={brochure} />
    </SectionTabPage>
  );
}
