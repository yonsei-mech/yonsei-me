import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Hero } from '@/components/Hero';
import { Container, NARROW_MAX_W } from '@/components/Container';
import { TabNavBar } from '@/components/TabNavBar';
import { PostArticle } from '@/components/PostArticle';
import { BoardShell } from '@/components/BoardShell';
import {
  InterviewArticle,
  type InterviewNeighbor,
} from '@/components/alumni/InterviewArticle';
import { pick } from '@/lib/content';
import { fetchAlumniEventById, fetchAlumniEvents, postsBodyFormat } from '@/lib/posts';
import { alumniEventHref } from '@/lib/board-links';
import {
  formatByline,
  formatInterviewMonth,
  type InterviewCard,
} from '@/lib/alumni-interview';
import { pageMetadata } from '@/lib/page-metadata';
import { htmlToDescription } from '@/lib/excerpt';
import { getAlumniTabs } from '../../_shared/tabs';
import type { Locale } from '@/i18n/routing';

// DB 소스 전환(Phase 2): 요청 시 렌더 + ISR (revalidateTag('posts') 가 즉시 갱신)
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string; id: string };
}): Promise<Metadata> {
  const event = await fetchAlumniEventById(params.id);
  // 없는 글은 notFound() 로 떨어져 not-found 페이지가 자기 메타를 갖는다 → 여기선 빈 객체.
  if (!event) return {};
  const locale = params.locale as Locale;
  // description 이 비면 레이아웃의 사이트 기본 설명이 그대로 붙어 문서마다 같아진다
  // (GSC 중복 신호). 요약이 있으면 그것을, 없으면 본문에서 만들어 쓴다.
  const description =
    (event.excerpt ? pick(event.excerpt, locale).trim() : '') ||
    htmlToDescription(pick(event.body, locale));
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  return pageMetadata({
    locale,
    path: `alumni/network/${params.id}`,
    title: `${pick(event.title, locale)} | ${tMenu('alumni.items.network')}`,
    ...(description ? { description } : {}),
    type: 'article',
    image: event.image ?? null,
    publishedTime: event.date,
    // 판정 필드는 사이트맵(목록 조회)과 동일한 제목·요약만 — 본문은 넘기지 않는다.
    fields: [event.title, event.excerpt],
  });
}

export default async function AlumniNetworkDetailPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;
  const event = await fetchAlumniEventById(params.id);
  const t = await getTranslations({ locale, namespace: 'news' });
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  const tAlumni = await getTranslations({ locale, namespace: 'alumni' });
  const tIv = await getTranslations({ locale, namespace: 'alumni.interview' });

  // 없는 글은 진짜 404 다(예전 인라인 "찾을 수 없음" 렌더는 HTTP 200 → GSC Soft 404).
  if (!event) notFound();

  const boardName = tMenu('alumni.items.network');
  const tabs = await getAlumniTabs(locale);

  // 히어로·크럼은 인터뷰와 레거시 글이 같다 — 아래 두 갈래가 공유한다.
  const hero = (
    <Hero
      // 히어로 제목은 이 문서가 속한 **섹션**이다 — 목록(/alumni/network)과 같은 '동문'.
      // 예전에는 소식 게시판에서 복사해 온 news.hero 를 그대로 써서 크럼은 '동문'인데
      // 큰 제목만 '소식'이었다(와이어프레임 확정본도 '동문').
      title={tAlumni('hero.title')}
      subtitle={tAlumni('hero.subtitle')}
      // 게시판 크럼의 href 는 JSON-LD 용이다 — 화면에서는 마지막 항목이라 링크로 그려지지
      // 않지만, 중간 항목에 item 이 없으면 구글이 crumbLeaf 까지 버린다(Hero 의 ③ 주석).
      breadcrumb={[
        { label: tMenu('alumni.label'), href: '/alumni' },
        { label: boardName, href: '/alumni/network' },
      ]}
      crumbLeaf={pick(event.title, locale)}
      titleTag="p"
    />
  );

  // ── 인터뷰 글 — 에디토리얼 레이아웃 ──
  if (event.interview) {
    // 이웃·관련은 이미 정렬된 목록(byPinnedDate)에서 고른다. 날짜순 이웃이므로
    // '이전'은 더 오래된 글(배열 뒤), '다음'은 더 최신 글(배열 앞)이다.
    const all = await fetchAlumniEvents();
    const idx = all.findIndex((e) => e.id === event.id);
    const toNeighbor = (i: number): InterviewNeighbor | null => {
      const n = all[i];
      if (!n) return null;
      return {
        href: alumniEventHref(n.id),
        title: pick(n.title, locale),
        byline: formatByline(n.interview, locale),
      };
    };
    const related: InterviewCard[] = all
      .filter((e) => e.id !== event.id)
      .slice(0, 3)
      .map((e) => ({
        id: e.id,
        href: alumniEventHref(e.id),
        month: formatInterviewMonth(e.date, locale),
        title: pick(e.title, locale),
        byline: formatByline(e.interview, locale),
        excerpt: '',
        ...(e.image ? { image: e.image } : {}),
      }));

    return (
      <>
        {hero}
        <TabNavBar navTitle={tMenu('alumni.label')} tabs={tabs} activeKey="network" narrow />
        <Container className={`pb-14 pt-10 md:pb-24 md:pt-[72px] ${NARROW_MAX_W}`}>
          <InterviewArticle
            month={formatInterviewMonth(event.date, locale)}
            title={pick(event.title, locale)}
            byline={formatByline(event.interview, locale)}
            excerpt={event.excerpt ? pick(event.excerpt, locale) : ''}
            {...(event.image ? { image: event.image } : {})}
            body={pick(event.body, locale)}
            {...(event.interview.closingQ
              ? { closingQ: pick(event.interview.closingQ, locale) }
              : {})}
            {...(event.interview.closingA
              ? { closingA: pick(event.interview.closingA, locale) }
              : {})}
            prev={idx >= 0 ? toNeighbor(idx + 1) : null}
            next={idx >= 0 ? toNeighbor(idx - 1) : null}
            related={related}
            {...(event.attachments && event.attachments.length > 0
              ? {
                  attachments: event.attachments.map((a) => ({
                    label: pick(a.label, locale),
                    href: a.href,
                  })),
                }
              : {})}
            backHref="/alumni/network"
            labels={{
              kicker: tIv('kicker'),
              closing: tIv('closing'),
              prev: tIv('prev'),
              next: tIv('next'),
              latestNote: tIv('latestNote'),
              related: tIv('related'),
              attachments: t('detail.attachmentsLabel'),
              backToList: t('backToList'),
            }}
          />
        </Container>
      </>
    );
  }

  // ── 인터뷰 정보가 없는 구 동문 소식 — 기존 게시물 렌더 그대로(폴백) ──
  return (
    <>
      {hero}
      <BoardShell tabs={tabs} activeKey="network" navTitle={tMenu('alumni.label')}>
        <PostArticle
          boardName={boardName}
          title={pick(event.title, locale)}
          titleTag="h1"
          date={event.date}
          metaValue={pick(event.host, locale)}
          body={pick(event.body, locale)}
          bodyFormat={postsBodyFormat()}
          attachments={event.attachments}
          attachmentLabels={event.attachments?.map((a) => pick(a.label, locale))}
          backHref="/alumni/network"
          labels={{
            title: t('detail.titleLabel'),
            date: t('detail.dateLabel'),
            metaRow: t('detail.authorLabel'),
            attachments: t('detail.attachmentsLabel'),
            backToList: t('backToList'),
            share: t('detail.share'),
            copyUrl: t('detail.copyUrl'),
            copied: t('detail.copied'),
            copyFailed: t('detail.copyFailed'),
          }}
          locale={locale}
        />
      </BoardShell>
    </>
  );
}
