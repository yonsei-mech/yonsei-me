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
  return sectionTabMetadata(params.locale, 'bk21', 'vision');
}

/** BK21 비전 및 목표 — content/pages/bk21-vision.md 를 Prose 로 렌더(셸이 처리).
 *  2026-09 섹션 독립 전에는 /graduate/bk21 한 장이 이 파일 하나였다. */
export default async function Bk21VisionPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const markdown = await getPageMarkdownRuntime('bk21-vision');

  return <SectionTabPage locale={params.locale} section="bk21" tab="vision" markdown={markdown} />;
}
