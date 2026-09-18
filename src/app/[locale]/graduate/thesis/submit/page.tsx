import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { SectionTabPage } from '../../../_shared/section-tabs';
import { ThesisVerifyFlow, type ThesisVerifyLabels } from '@/components/thesis-submit/ThesisVerifyFlow';
import { getStaffRuntime } from '@/lib/content-runtime';
import { pick } from '@/lib/content';
import { pageMetadata } from '@/lib/page-metadata';
import { NOINDEX_FOLLOW } from '@/lib/seo';
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MINUTES,
  THESIS_NOTICE_TEMPLATE_URL,
  THESIS_SUBMIT_FORM_PATH,
  THESIS_SUBMIT_PATH,
  isThesisSubmitEnabled,
} from '@/lib/thesis-submit/config';
import { readThesisSession } from '@/lib/thesis-submit/session';
import type { Locale } from '@/i18n/routing';

// 제출 세션 쿠키를 읽어 분기하므로 요청마다 렌더한다(정적 생성·ISR 금지)
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
    // pageMetadata 는 선행 슬래시 없는 경로를 받는다
    path: THESIS_SUBMIT_PATH.slice(1),
    title: `${t('title')} | ${tMenu('graduate.label')}`,
    description: t('lead'),
  });
  // 입력 폼 화면이라 색인하지 않는다(링크는 따라가게 둔다). 사이트맵에도 싣지 않는다.
  return { ...base, robots: NOINDEX_FOLLOW };
}

/**
 * 학위논문심사 › 심사 공고 등록 — 화면 B "본인 확인·안내" (디자인 원본:
 * files/학위논문심사 공고 등록 디자인/spec.md §3).
 *
 * 대학원생이 학교 이메일로 본인을 확인하면 공고 입력 화면(/submit/form)으로 넘어간다.
 * 셸은 학위논문심사 탭 아래 개별 문서로 그린다(SectionTabPage title 오버라이드 — BK21
 * 보고서 뷰어와 같은 방식). 탭 바의 현재 항목은 "학위논문심사"로 남는다.
 *
 * 문구는 서버에서 thesisSubmit 네임스페이스를 읽어 props 로 내린다 — 클라이언트 provider
 * 화이트리스트(CLIENT_MESSAGE_NAMESPACES)에 넣으면 전 페이지 RSC 페이로드에 실린다.
 * 카운트다운·이메일처럼 값이 바뀌는 문구는 t.raw 로 자리표시자를 그대로 넘겨 클라이언트가 채운다.
 */
export default async function ThesisSubmitPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  if (!isThesisSubmitEnabled()) notFound();
  const locale = params.locale as Locale;

  // 이미 본인 확인을 마친 사용자는 다음 화면으로 — 인증을 두 번 시키지 않는다
  const session = await readThesisSession();
  if (session) redirect(`/${locale}${THESIS_SUBMIT_FORM_PATH}`);

  const [t, staff] = await Promise.all([
    getTranslations({ locale, namespace: 'thesisSubmit' }),
    getStaffRuntime(),
  ]);

  // 문의처 — 교직원 데이터의 대학원 담당 항목(이름은 싣지 않는다). 없으면 문의 줄을 숨긴다.
  const office = staff.find((s) => s.role?.ko === '대학원');
  const contact = office
    ? {
        office: t('guide.contactOffice'),
        location: pick(office.location, locale),
        phone: office.phone,
        email: office.email,
      }
    : null;

  const raw = (key: string) => t.raw(key) as string;
  const labels: ThesisVerifyLabels = {
    guide: {
      eyebrow: t('guide.eyebrow'),
      title: t('guide.title'),
      show: t('guide.show'),
      hide: t('guide.hide'),
      steps: [
        { title: t('guide.step1Title'), desc: t('guide.step1Desc') },
        { title: t('guide.step2Title'), desc: t('guide.step2Desc') },
        { title: t('guide.step3Title'), desc: t('guide.step3Desc') },
      ],
      stepNow: t('guide.stepNow'),
      stepNext: t('guide.stepNext'),
      stepDone: t('guide.stepDone'),
      prepTitle: t('guide.prepTitle'),
      prep: [t('guide.prep1'), t('guide.prep2'), t('guide.prep3'), t('guide.prep4')],
      template: t('guide.template'),
      contactLabel: t('guide.contactLabel'),
      adminNote: t('guide.adminNote'),
      adminLink: t('guide.adminLink'),
    },
    form: {
      eyebrow: t('form.eyebrow'),
      title: t('form.title'),
      desc: t('form.desc'),
      emailLabel: t('form.emailLabel'),
      emailPlaceholder: t('form.emailPlaceholder'),
      emailHint: t('form.emailHint'),
      emailEmpty: t('form.emailEmpty'),
      emailDomain: t('form.emailDomain'),
      send: t('form.send'),
      sending: t('form.sending'),
      retryIn: raw('form.retryIn'),
      rateTitle: t('form.rateTitle'),
      rateDetail: raw('form.rateDetail'),
      sendFailed: t('form.sendFailed'),
      verifyFailed: t('form.verifyFailed'),
      tryLater: t('form.tryLater'),
      networkDetail: t('form.networkDetail'),
      sentTo: raw('form.sentTo'),
      codeLabel: t('form.codeLabel'),
      codeAria: t('form.codeAria'),
      validity: t('form.validity', { minutes: OTP_TTL_MINUTES }),
      resend: t('form.resend'),
      resendIn: raw('form.resendIn'),
      resent: t('form.resent'),
      confirm: t('form.confirm'),
      verifying: t('form.verifying'),
      wrongTitle: t('form.wrongTitle'),
      wrongRemaining: raw('form.wrongRemaining'),
      reissueTitle: t('form.reissueTitle'),
      lockedDetail: t('form.lockedDetail', { count: OTP_MAX_ATTEMPTS }),
      expiredDetail: t('form.expiredDetail', { minutes: OTP_TTL_MINUTES }),
      reissue: t('form.reissue'),
      reissueIn: raw('form.reissueIn'),
      verified: t('form.verified'),
      verifiedButton: t('form.verifiedButton'),
      changeEmail: t('form.changeEmail'),
      privacyNote: t('form.privacyNote'),
      privacyLink: t('form.privacyLink'),
      devCode: raw('form.devCode'),
    },
  };

  return (
    <SectionTabPage
      locale={params.locale}
      section="graduate"
      tab="thesis"
      title={t('title')}
      crumbLeaf={t('title')}
    >
      {/* 셸의 탭 큰 제목은 아래 여백이 40px(mb-10) — 이 화면은 제목 바로 아래 리드 문단이
          붙는 구성(디자인: 모바일 12 / 데스크톱 16)이라 그 차이만큼 끌어올린다 */}
      <p className="-mt-7 text-base leading-[1.7] text-content-faint lg:-mt-6">{t('lead')}</p>
      <ThesisVerifyFlow
        locale={locale}
        labels={labels}
        contact={contact}
        templateUrl={THESIS_NOTICE_TEMPLATE_URL}
        formHref={`/${locale}${THESIS_SUBMIT_FORM_PATH}`}
      />
    </SectionTabPage>
  );
}
