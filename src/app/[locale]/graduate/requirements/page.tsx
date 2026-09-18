import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { GraduateRequirementSteps } from '@/components/GraduateRequirementSteps';
import { getGraduateRequirementsRuntime } from '@/lib/content-runtime';
import { SectionTabPage, sectionTabMetadata } from '../../_shared/section-tabs';

// 콘텐츠 소스 전환(Stage A): 본문이 데이터 레이어를 읽는다 — ISR 안전망
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return sectionTabMetadata(params.locale, 'graduate', 'requirements');
}

/**
 * 졸업 요건 — STEP 스크롤 문법: 좌측 sticky 단계 목차(스크롤스파이) +
 * 좌우 교대 STEP 헤더 + 유의사항 콜아웃 (나열식 EditorialProse 대체).
 * 2026-09 부터 원본은 마크다운 한 덩이가 아니라 STEP 레코드 배열이다
 * (content/graduate-requirements.json — CMS 가 STEP 하나씩 고친다).
 */
export default async function GraduateRequirementsPage({
  params,
}: {
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const steps = await getGraduateRequirementsRuntime();

  return (
    <SectionTabPage locale={params.locale} section="graduate" tab="requirements">
      <GraduateRequirementSteps steps={steps} />
    </SectionTabPage>
  );
}
