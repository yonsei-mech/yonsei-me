import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LabList } from '@/components/LabList';
import { pick } from '@/lib/content';
import { type ResearchField } from '@/lib/faculty';
import { getLabsDirectoryRuntime, getLabSummariesRuntime } from '@/lib/content-runtime';
import { buildLabBrochure } from '@/lib/lab-brochure';
import { SectionTabPage, sectionTabMetadata } from '../../_shared/section-tabs';
import galleryData from '@content/research-gallery.json';
import type { Locale } from '@/i18n/routing';

// 연구실 목록·AI 요약이 데이터 레이어를 읽는다 — ISR 안전망(CMS 저장 시 태그 갱신)
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return sectionTabMetadata(params.locale, 'research', 'labs');
}

/**
 * 연구실 목록.
 * 구 탭에는 `research-labs` 마크다운도 매달려 있었지만 LabList 가 우선 렌더돼
 * 한 번도 화면에 나온 적이 없다 — 그래서 옮기지 않았다.
 */
export default async function ResearchLabsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  // 연구실 목록 — 소스(db/git)는 lib/content-runtime 이 판별.
  const labs = await getLabsDirectoryRuntime();

  // 분야 인트로 — research-gallery.json(분야명·설명·대표 이미지)을 로케일 해석해
  // 연구실 목록의 분야 선택 헤더로 재사용(콘텐츠 단일 출처).
  const fieldIntros = (
    galleryData as { field: string; title: { ko: string; en: string }; description: { ko: string; en: string }; image: string }[]
  ).map((g) => ({
    field: g.field as ResearchField,
    title: pick(g.title, locale),
    description: pick(g.description, locale),
    image: g.image,
  }));

  // 연구실 AI 연구요약 — 지도교수 한글 이름으로 조인한다(lab-summaries.json 키 = professorKo).
  // 로케일 해석을 서버에서 끝내 한쪽 언어만 클라이언트로 보낸다(번들에 한/영 양쪽 금지).
  // 개행은 공백으로 접는다 — 패널이 whitespace-pre-line 이라 개행이 그대로 빈 줄이 된다.
  const labSummaries = Object.fromEntries(
    Object.entries(await getLabSummariesRuntime()).map(([professorKo, text]) => [
      professorKo,
      pick(text, locale).replace(/\r\n|\r|\n/g, ' ').replace(/\s{2,}/g, ' ').trim(),
    ]),
  );

  // 연구실 소개자료(구 사이트 사이드바 PDF) — 쪽 ↔ 연구실 조인과 로케일 해석을 서버에서 끝낸다
  const brochure = buildLabBrochure(labs, locale);

  return (
    <SectionTabPage locale={params.locale} section="research" tab="labs">
      <LabList items={labs} fieldIntros={fieldIntros} summaries={labSummaries} brochure={brochure} />
    </SectionTabPage>
  );
}
