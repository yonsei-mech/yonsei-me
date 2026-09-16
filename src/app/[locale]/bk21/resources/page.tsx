import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ResourceLibrary } from '@/components/ResourceLibrary';
import { buildResourceItems } from '../../news/_shared/list-data';
import { SectionTabPage, sectionTabMetadata } from '../../_shared/section-tabs';
import type { Locale } from '@/i18n/routing';

// BK21 자료실이 DB(posts)를 읽으므로 페이지를 ISR — revalidateTag('posts')가 즉시 갱신
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return sectionTabMetadata(params.locale, 'bk21', 'resources');
}

/**
 * BK21 자료실 — 구 사이트의 자료실(bk21/files.do)과 사업성과(bk21/progress.do)를
 * 한 게시판(DB board='bk21Resources')으로 합친 화면. 소식 자료실과 같은 전용 목록
 * (ResourceLibrary — "받아 가는 파일")을 쓰되 분류 집합이 3종이라 라벨을 여기서 넘긴다.
 * 분류 **값**은 CMS 표(BK21_RESOURCE_CATEGORIES)가 단일 출처이고, 라벨은 messages 라서
 * 서버 컴포넌트인 이 자리에서 둘을 잇는다(클라이언트에 bk21 네임스페이스를 더 싣지 않는다).
 */
export default async function Bk21ResourcesPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  const items = await buildResourceItems(locale, 'bk21Resources');
  const t = await getTranslations({ locale: params.locale, namespace: 'bk21' });

  return (
    <SectionTabPage locale={params.locale} section="bk21" tab="resources">
      {/* ResourceLibrary 는 자체 빈 상태 문구를 갖는다 — emptyLabel 을 받지 않는다 */}
      <ResourceLibrary
        items={items}
        locale={locale}
        categories={[
          { id: 'result', label: t('library.catResult'), badge: 'solid' },
          { id: 'rule', label: t('library.catRule'), badge: 'outline' },
          { id: 'form', label: t('library.catForm'), badge: 'outline' },
        ]}
      />
    </SectionTabPage>
  );
}
