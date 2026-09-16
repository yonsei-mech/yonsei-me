import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { StaffTable } from '@/components/StaffTable';
import { getStaffRuntime } from '@/lib/content-runtime';
import { SectionTabPage, sectionTabMetadata } from '../../_shared/section-tabs';

// 콘텐츠 소스 전환(Stage A): 교직원이 데이터 레이어를 읽는다 — ISR 안전망
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return sectionTabMetadata(params.locale, 'about', 'staff');
}

/**
 * 행정 교직원 표 — 데이터는 content/staff.json (콘텐츠/코드 분리).
 * 표 마크업은 StaffTable 이 갖는다(BK21 FOUR > 교육연구단 현황 탭과 공유).
 */
export default async function AboutStaffPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const staff = await getStaffRuntime();

  return (
    <SectionTabPage locale={params.locale} section="about" tab="staff">
      <StaffTable staff={staff} locale={params.locale} />
    </SectionTabPage>
  );
}
