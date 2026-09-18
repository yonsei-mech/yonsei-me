import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { SectionTabPage } from '../../../../_shared/section-tabs';
import { pageMetadata } from '@/lib/page-metadata';
import { NOINDEX_FOLLOW } from '@/lib/seo';
import {
  THESIS_SUBMIT_FORM_PATH,
  THESIS_SUBMIT_PATH,
  isThesisSubmitEnabled,
} from '@/lib/thesis-submit/config';
import { readThesisSession } from '@/lib/thesis-submit/session';
import type { Locale } from '@/i18n/routing';

// 제출 세션 쿠키로 가드하므로 요청마다 렌더한다
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  if (!isThesisSubmitEnabled()) return {};
  const locale = params.locale as Locale;
  const [t, tMenu] = await Promise.all([
    getTranslations({ locale, namespace: 'thesisSubmit' }),
    getTranslations({ locale, namespace: 'menu' }),
  ]);
  const base = await pageMetadata({
    locale,
    path: THESIS_SUBMIT_FORM_PATH.slice(1),
    title: `${t('next.title')} | ${tMenu('graduate.label')}`,
  });
  return { ...base, robots: NOINDEX_FOLLOW };
}

/**
 * 학위논문심사 › 심사 공고 등록 › 공고 내용 입력 — **자리표시 페이지**.
 * 다음 화면(공고 입력·파일 업로드) 디자인이 나오기 전까지 세션 가드와 경로만 먼저 세운다.
 * 본인 확인(제출 세션 쿠키)이 없으면 확인 화면(/submit)으로 돌려보낸다.
 */
export default async function ThesisSubmitFormPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  if (!isThesisSubmitEnabled()) notFound();
  const locale = params.locale as Locale;

  const session = await readThesisSession();
  if (!session) redirect(`/${locale}${THESIS_SUBMIT_PATH}`);

  const t = await getTranslations({ locale, namespace: 'thesisSubmit.next' });

  return (
    <SectionTabPage
      locale={params.locale}
      section="graduate"
      tab="thesis"
      title={t('title')}
      crumbLeaf={t('title')}
    >
      <div className="rounded-card border border-surface-border bg-surface-soft px-6 py-16 text-center">
        <p className="text-base leading-[1.7] text-content">{t('pending')}</p>
        <p className="mt-2 text-sm leading-[1.7] text-content-faint">
          {t('verifiedAs', { email: session.email })}
        </p>
      </div>
    </SectionTabPage>
  );
}
