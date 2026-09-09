import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { EditorialTab, getEditorialTab } from '@/components/EditorialTab';
import { NewsListPage, newsListMetadata } from '../_shared/NewsListPage';
import type { Locale } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return newsListMetadata(params.locale, 'recruit');
}

/**
 * 교수 초빙 — 게시판이 아니라 안내 페이지다(editorial-tabs.json 의 recruit-info).
 * 2026-09 연구 섹션에서 소식 섹션으로 이동했고, 구 /research/recruit 는 route.ts 가 308 한다.
 * DB 를 읽지 않으므로 revalidate 도 없다(빌드 시점 정적).
 */
export default function NewsRecruitPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  return (
    <NewsListPage locale={params.locale} seg="recruit">
      <EditorialTab data={getEditorialTab('recruit-info')} locale={locale} landing="recruit-info" />
    </NewsListPage>
  );
}
