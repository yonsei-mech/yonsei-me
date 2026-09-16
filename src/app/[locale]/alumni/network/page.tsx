import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Hero } from '@/components/Hero';
import { Container, NARROW_MAX_W } from '@/components/Container';
import { TabNavBar } from '@/components/TabNavBar';
import { LegacyBoardHash } from '@/components/LegacyBoardHash';
import { InterviewCover } from '@/components/alumni/InterviewCover';
import { InterviewListing } from '@/components/alumni/InterviewListing';
import { pick } from '@/lib/content';
import { fetchAlumniEvents } from '@/lib/posts';
import { alumniEventHref, LEGACY_ALUMNI_HASH } from '@/lib/board-links';
import { formatByline, formatInterviewMonth, type InterviewCard } from '@/lib/alumni-interview';
import { pageMetadata } from '@/lib/page-metadata';
import { getAlumniTabs } from '../_shared/tabs';
import type { Locale } from '@/i18n/routing';

// DB 소스 전환(Phase 2): 목록도 ISR — revalidateTag('posts') 가 즉시 갱신, 이 값은 안전망
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale as Locale;
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  const tSeo = await getTranslations({ locale, namespace: 'seo' });
  return pageMetadata({
    locale,
    path: 'alumni/network',
    // 제목에 그룹명을 붙인다 — 게시판 라벨 한 단어만으로는 검색결과에서 맥락이 없다
    title: `${tMenu('alumni.items.network')} | ${tMenu('alumni.label')}`,
    description: tSeo('alumni.network'),
  });
}

export default async function AlumniNetworkListPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  const tAlumni = await getTranslations({ locale, namespace: 'alumni' });
  const tStub = await getTranslations({ locale, namespace: 'stub' });
  const tIv = await getTranslations({ locale, namespace: 'alumni.interview' });

  const alumniEvents = await fetchAlumniEvents();

  // 로케일 해석은 여기서 끝낸다 — 목록이 클라이언트 컴포넌트라 Localized 를 경계
  // 너머로 넘기면 content/*.json 이 브라우저 번들로 따라간다.
  const cards: InterviewCard[] = alumniEvents.map((e) => ({
    id: e.id,
    href: alumniEventHref(e.id),
    month: formatInterviewMonth(e.date, locale),
    title: pick(e.title, locale),
    // 인터뷰 정보가 없는 구 동문 소식은 바이라인 없이 제목·요약만 나온다
    byline: formatByline(e.interview, locale),
    excerpt: e.excerpt ? pick(e.excerpt, locale) : '',
    ...(e.image ? { image: e.image } : {}),
  }));

  const tabs = await getAlumniTabs(locale);
  const boardName = tMenu('alumni.items.network');

  return (
    <>
      {/* narrow: 히어로 → 남색 바 → 커버 → 목록이 한 좌측선에 선다.
          히어로 제목은 섹션명('동문')이라 h1 은 커버의 큰 제목이 갖는다 —
          한 문서에 큰 제목이 둘이면 구글이 제목 링크를 임의로 골라 쓴다. */}
      <Hero
        title={tAlumni('hero.title')}
        subtitle={tAlumni('hero.subtitle')}
        narrow
        titleTag="p"
        breadcrumb={[{ label: tMenu('alumni.label'), href: '/alumni' }, { label: boardName }]}
      />
      {/* 히어로 하단 남색 내비게이션 바 — 사용자가 명시적으로 요구한 불변 요소 */}
      <TabNavBar navTitle={tMenu('alumni.label')} tabs={tabs} activeKey="network" narrow />

      {/* 커버 밴드(풀블리드) — 이 페이지의 h1 이 여기 있다 */}
      <InterviewCover kicker={tIv('kicker')} title={boardName} lead={tIv('lead')} />

      <Container className={`pb-14 pt-10 md:pb-[104px] md:pt-20 ${NARROW_MAX_W}`}>
        {cards.length > 0 ? (
          <InterviewListing items={cards} />
        ) : (
          /* 빈 상태 — 다른 게시판 목록(BoardList)과 같은 독수리 마스코트 문법(사용자 지정) */
          <div className="flex flex-col items-center gap-5 rounded-card border border-surface-border bg-surface-soft px-6 py-20 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/img/eagle_empty.png" alt="" aria-hidden="true" className="h-20 w-auto opacity-70" />
            <p className="max-w-sm text-content-soft">{tStub('empty')}</p>
          </div>
        )}
      </Container>
      {/* 구 링크 /alumni#network 가 여기로 떨어졌을 때(해시 잔류) 자기 자신이면 무시된다 */}
      <LegacyBoardHash map={LEGACY_ALUMNI_HASH} />
    </>
  );
}
