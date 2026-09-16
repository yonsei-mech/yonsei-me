import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { getPageMarkdownRuntime } from '@/lib/content-runtime';
import { SectionTabPage, sectionTabMetadata } from '../../_shared/section-tabs';

// 콘텐츠 소스 전환(Stage A): 본문이 데이터 레이어를 읽는다 — ISR 안전망
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return sectionTabMetadata(params.locale, 'graduate', 'bk21');
}

/** BK21 FOUR — content/pages/bk21-vision.md 를 Prose 로 렌더(셸이 처리) */
export default async function GraduateBk21Page({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const markdown = await getPageMarkdownRuntime('bk21-vision');

  return <SectionTabPage locale={params.locale} section="graduate" tab="bk21" markdown={markdown} />;
}
