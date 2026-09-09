import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FilterableBoardList } from '@/components/FilterableBoardList';
import { buildThesisRows } from '../../news/_shared/list-data';
import { SectionTabPage, sectionTabMetadata } from '../../_shared/section-tabs';
import type { Locale } from '@/i18n/routing';

// 학위논문심사 게시판이 DB(posts)를 읽으므로 페이지를 ISR — revalidateTag('posts')가 즉시 갱신
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return sectionTabMetadata(params.locale, 'graduate', 'thesis');
}

/**
 * 학위논문심사 목록 — 게시판이지만 **대학원 메뉴 소속**이라 `/graduate` 아래에 산다
 * (2026-09 소식 섹션에서 이관. 구 `/news/thesis` 는 308).
 * 상세(`/graduate/thesis/<id>`)의 부모 경로이기도 하다.
 */
export default async function GraduateThesisPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  // 행 매핑 규칙(정렬·발췌·썸네일)은 소식 섹션에 있을 때와 같은 빌더를 그대로 쓴다
  const items = await buildThesisRows(locale);
  // 목록이 비었을 때 문구 — 본문 없음 문구(stub.body)와 다른 값이다
  const tStub = await getTranslations({ locale: params.locale, namespace: 'stub' });

  return (
    <SectionTabPage locale={params.locale} section="graduate" tab="thesis">
      <FilterableBoardList items={items} locale={locale} emptyLabel={tStub('empty')} />
    </SectionTabPage>
  );
}
