/**
 * 뉴스 섹션 목록 페이지 공용 껍데기 — 히어로 + 세부탭 셸(남색 바) + 레거시 해시 구제.
 *
 * 예전에는 `/news` 한 장이 8개 탭을 해시로 갈아 끼웠다. 해시는 서버로 오지 않아
 * 검색엔진에게 게시판 8개가 URL 하나로 보였다 — 그래서 탭마다 진짜 경로를 준다.
 * 페이지가 9장으로 갈렸으므로 히어로·탭·메타 조립은 이 파일 한 곳에 모아 둔다.
 *
 * 셸은 TabPageShell(narrow) 이다 — 개편 전 `/news` 가 갖고 있던 히어로 하단 남색
 * 내비게이션 바(홈 아이콘 + 그룹명 + 현재 탭 드롭다운)를 그대로 유지하기 위해서다.
 * 탭 전환만 클라이언트 상태가 아니라 실제 라우트 이동이라 서버 컴포넌트로 쓴다.
 */
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Hero } from '@/components/Hero';
import { TabPageShell } from '@/components/TabPageShell';
import { LegacyBoardHash } from '@/components/LegacyBoardHash';
import {
  DEFAULT_NEWS_TAB,
  LEGACY_NEWS_HASH,
  NEWS_TABS,
  newsTabHref,
  type NewsTabSeg,
} from '@/lib/board-links';
import { pageMetadata } from '@/lib/page-metadata';
import { getNewsTabs } from './tabs';
import type { Locale } from '@/i18n/routing';

/** seg → `menu.news.items.*` 메시지 키 (URL 세그먼트와 라벨 키가 press/news 에서 갈린다) */
function labelKeyOf(seg: NewsTabSeg): string {
  const tab = NEWS_TABS.find((t) => t.seg === seg);
  // NewsTabSeg 는 NEWS_TABS 에서 파생된 타입이라 실행 중 여기 걸릴 수 없다(방어).
  if (!tab) throw new Error(`알 수 없는 뉴스 탭 세그먼트: ${seg}`);
  return tab.labelKey;
}

/** 게시판 라벨 ("공지사항", "자료실" …) */
export async function newsTabLabel(locale: Locale, seg: NewsTabSeg): Promise<string> {
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  return tMenu(`news.items.${labelKeyOf(seg)}`);
}

/** 목록이 비었을 때 문구 — 9개 페이지가 같은 값을 쓴다 */
export async function newsEmptyLabel(locale: Locale): Promise<string> {
  const tStub = await getTranslations({ locale, namespace: 'stub' });
  return tStub('empty');
}

/**
 * 목록 페이지 metadata.
 * title 은 `게시판 라벨 | 소식` — 여기에 레이아웃 템플릿이 ` | 사이트명` 을 더 붙인다.
 * description 은 게시판마다 사람이 쓴 문장(`seo.news.<라벨키>`)이다. 예전엔
 * "라벨 · 소식 섹션 설명" 을 기계적으로 조립했는데, 그런 문구는 구글이 스니펫으로
 * 쓰지 않고 목록 표를 대신 긁어 갔다(실측).
 */
export async function newsListMetadata(locale: string, seg: NewsTabSeg): Promise<Metadata> {
  const l = locale as Locale;
  const [tMenu, tSeo, label] = await Promise.all([
    getTranslations({ locale: l, namespace: 'menu' }),
    getTranslations({ locale: l, namespace: 'seo' }),
    newsTabLabel(l, seg),
  ]);
  return pageMetadata({
    locale: l,
    // pageMetadata 는 선행 슬래시 없는 경로를 받는다
    path: newsTabHref(seg).slice(1),
    title: `${label} | ${tMenu('news.label')}`,
    // seo 키는 URL 세그먼트가 아니라 **라벨 키**다(press 탭의 키는 'news')
    description: tSeo(`news.${labelKeyOf(seg)}`),
  });
}

/**
 * 목록 페이지 껍데기. children 은 해당 탭의 목록 컴포넌트다.
 * ⚠️ setRequestLocale 은 라우트 진입점(page.tsx)이 부른다 — 여기서 부르면 이미
 *    데이터 조립이 끝난 뒤라 늦다.
 */
export async function NewsListPage({
  locale,
  seg,
  children,
}: {
  locale: string;
  seg: NewsTabSeg;
  children: ReactNode;
}) {
  const l = locale as Locale;
  const tMenu = await getTranslations({ locale: l, namespace: 'menu' });
  const tNews = await getTranslations({ locale: l, namespace: 'news' });
  const tabs = await getNewsTabs(l);
  const label = await newsTabLabel(l, seg);

  return (
    <>
      {/* narrow: 히어로 글줄 → 남색 바 → 목록이 같은 좌측선에 서도록(개편 전 `/news` 와 동일) */}
      {/* 히어로 제목은 '소식'(8개 탭 공통)이라 h1 은 아래 탭 제목(게시판 라벨)이 갖는다 —
          한 문서에 큰 제목이 둘이면 구글이 제목 링크를 임의로 골라 쓴다. 시각 변화 없음. */}
      <Hero
        title={tNews('hero.title')}
        subtitle={tNews('hero.subtitle')}
        narrow
        titleTag="p"
        // 그룹 크럼은 기본 탭으로 보낸다 — `/news` 로 걸면 크럼 클릭마다 308 을 한 번 더 탄다
        breadcrumb={[
          { label: tMenu('news.label'), href: newsTabHref(DEFAULT_NEWS_TAB) },
          { label },
        ]}
      />
      {/* 히어로 아래 남색 내비게이션 바(홈 + 그룹명 + 현재 게시판 드롭다운) —
          개편 전 TabbedContent 의 바를 라우트 기반으로 되살린 것. title 은 큰 제목이라
          게시판 라벨(= 탭 라벨)을 넘긴다(이 화면에서는 h1). */}
      <TabPageShell
        navTitle={tMenu('news.label')}
        tabs={tabs}
        activeKey={seg}
        title={label}
        titleTag="h1"
        narrow
      >
        {children}
      </TabPageShell>
      {/* 구 `/news#seminars` 북마크 구제 — 해시는 서버에 오지 않아 클라이언트에서만 잡힌다 */}
      <LegacyBoardHash map={LEGACY_NEWS_HASH} />
    </>
  );
}
