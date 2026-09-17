import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Hero } from '@/components/Hero';
import { BoardShell } from '@/components/BoardShell';
import { PostArticle } from '@/components/PostArticle';
import { PostBoardContext } from '@/components/PostBoardContext';
import { pick } from '@/lib/content';
import { fetchNewsBySlug, postsBodyFormat } from '@/lib/posts';
import { locateInBoard } from '@/lib/board-paging';
import { pageMetadata } from '@/lib/page-metadata';
import { htmlToDescription } from '@/lib/excerpt';
import { localeUrl } from '@/lib/seo';
import { SITE_URL } from '@/lib/site';
import { DEFAULT_NEWS_TAB, newsTabHref } from '@/lib/board-links';
import { getNewsTabs } from '../../_shared/tabs';
import { buildPressList } from '../../_shared/list-data';
import type { Locale } from '@/i18n/routing';

// DB 소스 전환(Phase 2): 글이 DB 에 살므로 빌드 시 열거하지 않고 요청 시 렌더 + ISR.
// CMS 쓰기의 revalidateTag('posts') 가 즉시 갱신하고, 이 값은 안전망이다.
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const item = await fetchNewsBySlug(params.slug);
  // 없는 글은 notFound() 로 떨어져 not-found 페이지가 자기 메타를 갖는다 → 여기선 빈 객체.
  if (!item) return {};
  const locale = params.locale as Locale;
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  // 요약이 비어 있는 기사도 있다 — 그대로 두면 레이아웃의 사이트 기본 설명이 붙어
  // 문서마다 같아진다(GSC 중복 신호). 없으면 본문에서 만들어 쓴다.
  const description = pick(item.excerpt, locale).trim() || htmlToDescription(pick(item.body, locale));
  return pageMetadata({
    locale,
    path: `news/press/${params.slug}`,
    title: `${pick(item.title, locale)} | ${tMenu('news.items.news')}`,
    ...(description ? { description } : {}),
    type: 'article',
    image: item.image || null,
    publishedTime: item.date,
    // hreflang + (영문 번역이 없으면) /en noindex. ⚠️ 판정 필드는 사이트맵이 목록 조회로
    // 보는 것과 같아야 한다 — 제목·요약만 넘기고 **본문은 넘기지 않는다**(본문은 목록에
    // 실려 오지 않아, 쓰면 두 곳 판정이 갈리고 hreflang 상호 참조가 깨진다).
    fields: [item.title, item.excerpt],
  });
}

/**
 * 뉴스 기사 상세 (구 `/news/[slug]`).
 * URL 만 `press` 로 갈렸다 — `/news/news/<slug>` 중첩을 피하려는 것이고, 탭 키·라벨은
 * 그대로 '뉴스'다. 구 주소는 `news/[slug]/page.tsx` 리졸버가 308 로 여기 보낸다.
 */
export default async function NewsArticlePage({
  params,
}: {
  params: { locale: string; slug: string };
}) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;
  const item = await fetchNewsBySlug(params.slug);
  const t = await getTranslations({ locale, namespace: 'news' });
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  const tMeta = await getTranslations({ locale, namespace: 'meta' });

  // 없는 글은 진짜 404 다. 예전에는 "찾을 수 없음" 문구를 200 으로 렌더해 GSC 가
  // Soft 404 로 적발했다 — notFound() 로 [locale]/not-found.tsx 를 띄운다.
  if (!item) notFound();

  const boardName = tMenu('news.items.news');

  // 기사 구조화 데이터(NewsArticle) — 구글 뉴스·검색결과의 기사 인식 신호.
  // description 은 generateMetadata 와 **같은 규칙**으로 만든다(요약 없으면 본문에서).
  const articleDescription =
    pick(item.excerpt, locale).trim() || htmlToDescription(pick(item.body, locale));
  // NewsItem 에는 수정일 필드가 없다 — dateModified 를 datePublished 로 채우면 거짓
  // 갱신 신호가 되므로 아예 넣지 않는다. 날짜가 깨진 글은 datePublished 도 생략한다.
  const datePublished = item.date && !Number.isNaN(Date.parse(item.date)) ? item.date : '';
  // 썸네일은 루트 상대 경로(/img/board/…)로 저장되기도 한다 — JSON-LD 에는 metadataBase
  // 같은 기준점이 없으니 절대 URL 로 만들어 넣는다(R2 업로드분은 이미 절대 URL).
  const articleImage = item.image
    ? item.image.startsWith('/')
      ? `${SITE_URL}${item.image}`
      : item.image
    : `${SITE_URL}/og/cover.jpg`;
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    // headline 은 NewsArticle 필수값이라 빈 문자열이면 구조화 데이터 자체가 무효다.
    // DB 소스는 loc() 이 이미 한국어로 폴백하지만, git JSON 소스는 title.en 이 빈
    // 문자열로 들어 있어 pick() 의 `??` 가 안 걸린다 — 여기서 한 번 더 받아 낸다.
    headline: pick(item.title, locale).trim() || item.title.ko,
    ...(articleDescription ? { description: articleDescription } : {}),
    ...(datePublished ? { datePublished } : {}),
    image: [articleImage],
    inLanguage: locale === 'ko' ? 'ko-KR' : 'en-US',
    mainEntityOfPage: localeUrl(locale, `news/press/${params.slug}`),
    author: { '@type': 'Organization', name: tMeta('siteName') },
    publisher: {
      '@type': 'Organization',
      name: tMeta('siteName'),
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.svg` },
    },
  };
  const tabs = await getNewsTabs(locale);

  // 본문 아래 '같은 게시판 목록' — 뉴스 기사 목록은 게시판 하나뿐이라 분류(일반/성과)로
  // 쪼개지 않는다. ⚠️ 이 게시판의 행 id 는 DB 연번이 아니라 **slug** 다
  // (buildPressList 가 `id: item.slug`) — 현재 글도 같은 키로 찾아야 한다.
  const { items: pressRows } = await buildPressList(locale);
  const slice = locateInBoard(pressRows, params.slug);

  return (
    <>
      <script
        type="application/ld+json"
        // 제목·본문이 CMS 콘텐츠라 `</script>` 가 섞여 들어올 수 있다 — '<' 를 유니코드
        // 이스케이프해 스크립트 블록이 조기 종료(=XSS)되지 않게 한다.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd).replace(/</g, '\\u003c') }}
      />
      {/* 히어로 제목은 섹션명('소식')이라 h1 은 본문의 기사 제목이 갖는다(시각 변화 없음).
          crumbLeaf 는 JSON-LD 에만 붙는 마지막 항목 — 화면 크럼은 게시판까지만 그린다. */}
      <Hero
        title={t('hero.title')}
        subtitle={t('hero.subtitle')}
        // 게시판 크럼의 href 는 JSON-LD 용이다 — 화면에서는 마지막 항목이라 링크로 그려지지
        // 않지만, 중간 항목에 item 이 없으면 구글이 crumbLeaf 까지 버린다(Hero 의 ③ 주석).
        breadcrumb={[
          { label: tMenu('news.label'), href: newsTabHref(DEFAULT_NEWS_TAB) },
          { label: boardName, href: newsTabHref('press') },
        ]}
        crumbLeaf={pick(item.title, locale)}
        titleTag="p"
      />
      <BoardShell tabs={tabs} activeKey="press" navTitle={tMenu('news.label')}>
        <PostArticle
          boardName={boardName}
          title={pick(item.title, locale)}
          titleTag="h1"
          date={item.date}
          metaValue={t(`categories.${item.category}`)}
          body={pick(item.body, locale)}
          bodyFormat={postsBodyFormat()}
          attachments={item.attachments}
          attachmentLabels={item.attachments?.map((a) => pick(a.label, locale))}
          backHref={newsTabHref('press')}
          labels={{
            title: t('detail.titleLabel'),
            date: t('detail.dateLabel'),
            metaRow: t('detail.categoryLabel'),
            attachments: t('detail.attachmentsLabel'),
            backToList: t('backToList'),
            share: t('detail.share'),
            copyUrl: t('detail.copyUrl'),
            copied: t('detail.copied'),
            copyFailed: t('detail.copyFailed'),
          }}
          locale={locale}
        />
        <PostBoardContext
          slice={slice}
          labels={{
            prev: t('context.prev'),
            next: t('context.next'),
            none: t('context.none'),
            navLabel: t('context.navLabel'),
          }}
        />
      </BoardShell>
    </>
  );
}
