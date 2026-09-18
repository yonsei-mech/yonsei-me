import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { SectionTabPage } from '../../../../_shared/section-tabs';
import {
  ThesisNoticeForm,
  type NoticeFormLabels,
} from '@/components/thesis-submit/ThesisNoticeForm';
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
    title: `${t('notice.title')} | ${tMenu('graduate.label')}`,
  });
  return { ...base, robots: NOINDEX_FOLLOW };
}

/**
 * 학위논문심사 › 예비심사 공고 등록 › 공고 내용 입력.
 *
 * 학생은 칸만 채운다(발표자·논문 제목·심사위원·일시·장소). 포스터는 학과 양식대로 브라우저가
 * 그리고(poster-canvas.ts), 제출하면 그 이미지 한 장이 학위논문심사 게시물 본문이 된다 —
 * 학과사무실이 관리자 콘솔에서 확인하고 '게시하기'를 눌러야 공개된다.
 * 입력 계약·검사·문구의 단일 출처는 src/lib/thesis-submit/notice.ts.
 *
 * 본인 확인(제출 세션 쿠키)이 없으면 확인 화면(/submit)으로 돌려보낸다. 입력 중에 세션이
 * 끝나면 제출 API 가 401 을 주고, 화면은 sessionStorage 초안을 남긴 채 확인 화면으로 안내한다.
 *
 * 문구는 화면 B 와 같은 방식 — 서버가 thesisSubmit.notice 를 읽어 props 로 내린다
 * (클라이언트 provider 화이트리스트에 넣으면 전 페이지 RSC 페이로드에 실린다).
 * 자리표시자({n}·{max}·{path} 등)가 있는 값은 t.raw 로 원문을 넘겨 클라이언트가 채운다.
 */
export default async function ThesisSubmitFormPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  if (!isThesisSubmitEnabled()) notFound();
  const locale = params.locale as Locale;

  const session = await readThesisSession();
  if (!session) redirect(`/${locale}${THESIS_SUBMIT_PATH}`);

  const t = await getTranslations({ locale, namespace: 'thesisSubmit.notice' });
  const raw = (key: string) => t.raw(key) as string;

  const labels: NoticeFormLabels = {
    scope: t.rich('scope', { b: (chunks) => <strong className="font-semibold">{chunks}</strong> }),
    verifiedAs: t('verifiedAs', { email: session.email }),
    sectionPresenter: t('sectionPresenter'),
    presenterLabel: t('presenterLabel'),
    titleLabel: t('titleLabel'),
    titleHint: t('titleHint'),
    sectionCommittee: t('sectionCommittee'),
    committeeHint: t('committeeHint'),
    chairLabel: t('chairLabel'),
    memberLabel: raw('memberLabel'),
    rowFieldAria: raw('rowFieldAria'),
    nameLabel: t('nameLabel'),
    honorificLabel: t('honorificLabel'),
    affiliationLabel: t('affiliationLabel'),
    namePlaceholder: t('namePlaceholder'),
    affiliationPlaceholder: t('affiliationPlaceholder'),
    honorifics: { 교수님: t('honorificProfessor'), 박사님: t('honorificDoctor') },
    removeMember: t('removeMember'),
    removeMemberAria: raw('removeMemberAria'),
    addMember: t('addMember'),
    sectionWhen: t('sectionWhen'),
    dateLabel: t('dateLabel'),
    timeLabel: t('timeLabel'),
    placeLabel: t('placeLabel'),
    placePlaceholder: t('placePlaceholder'),
    previewTitle: t('previewTitle'),
    postTitleLabel: t('postTitleLabel'),
    previewCaption: t('previewCaption'),
    download: t('download'),
    downloading: t('downloading'),
    downloadFailed: t('downloadFailed'),
    submit: t('submit'),
    submitting: t('submitting'),
    submitNote: t('submitNote'),
    errors: {
      presenterRequired: t('errors.presenterRequired'),
      titleRequired: t('errors.titleRequired'),
      chairRequired: t('errors.chairRequired'),
      memberNameRequired: t('errors.memberNameRequired'),
      membersTooFew: t('errors.membersTooFew'),
      membersTooMany: raw('errors.membersTooMany'),
      tooLong: raw('errors.tooLong'),
      dateRequired: t('errors.dateRequired'),
      datePast: t('errors.datePast'),
      timeRequired: t('errors.timeRequired'),
      placeRequired: t('errors.placeRequired'),
      format: t('errors.format'),
    },
    sessionTitle: t('sessionTitle'),
    sessionDetail: t('sessionDetail'),
    sessionLink: t('sessionLink'),
    rate: t('rate'),
    failedTitle: t('failedTitle'),
    tryLater: t('tryLater'),
    networkDetail: t('networkDetail'),
    doneTitle: t('doneTitle'),
    doneDesc: t('doneDesc'),
    doneList: t('doneList'),
    devSaved: raw('devSaved'),
  };

  return (
    <SectionTabPage
      locale={params.locale}
      section="graduate"
      tab="thesis"
      title={t('title')}
      crumbLeaf={t('title')}
    >
      <ThesisNoticeForm labels={labels} verifyHref={`/${locale}${THESIS_SUBMIT_PATH}`} />
    </SectionTabPage>
  );
}
