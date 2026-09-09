import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { EditorialTab, getEditorialTab } from '@/components/EditorialTab';
import { VisionInfographic } from '@/components/VisionInfographic';
import { SectionTabPage, sectionTabMetadata } from '../../_shared/section-tabs';
import type { Locale } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return sectionTabMetadata(params.locale, 'research', 'vision');
}

/**
 * 연구 비전 및 역량 — 연구 섹션의 기본 탭(`/research` 는 여기로 308).
 * 2026-09 에 별도 탭이던 '연구 역량'을 아래 단락으로 합쳤다(`/research/capacity` 는 308).
 * 두 글은 한 화면 안에서도 서로 다른 이야기라, 헤어라인 + 큰 상단 여백으로 단락을 가른다
 * (박스·그림자 없이 여백과 선으로만 위계를 만드는 이 사이트의 규칙).
 */
export default function ResearchVisionPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  // 구 해시 북마크 구제(LegacyBoardHash)는 셸이 기본 탭에 자동으로 얹는다
  return (
    <SectionTabPage locale={params.locale} section="research" tab="vision">
      {/* 텍스트 도입부(EditorialTab) 아래에 구 이미지 대신 인포그래픽을 합성 */}
      <EditorialTab data={getEditorialTab('research-vision')} locale={locale} />
      <VisionInfographic locale={locale} />
      <div className="mt-section-lg border-t border-surface-border pt-section-sm">
        {/* landing = GSAP 진입 애니메이션 옵트인. 위 비전 블록은 "빨리 읽히는" 글이라
            일부러 켜지 않았고(사용자 지시), 역량 블록만 종전대로 유지한다.
            titleTag=h2 — 이 페이지 h1("연구 비전 및 역량") 바로 아래라 h3 면 레벨 건너뜀이 된다.
            (위 비전 블록은 title 이 없어 제목을 내지 않으므로 h2 는 여기 하나뿐이다.)
            id=capacity — 통합 전 `/research#capacity` 북마크가 이 단락에 착지하도록. */}
        <EditorialTab
          data={getEditorialTab('research-capacity')}
          locale={locale}
          landing="research-capacity"
          titleTag="h2"
          id="capacity"
        />
      </div>
    </SectionTabPage>
  );
}
