/**
 * 게시판 셸(BoardShell)의 뉴스 탭 배열 — 8개.
 *
 * 목록 8페이지와 뉴스 소속 상세 6라우트가 모두 같은 탭 줄을 그리므로 여기 한 곳에서만 만든다.
 * (`_shared` 는 밑줄 접두사라 Next 라우팅에서 제외되는 비공개 폴더다.)
 *
 * 콘텐츠 섹션(소개·학부·대학원·연구)의 탭은 `_shared/section-tabs` 의 sectionTabs 가 만든다 —
 * 학위논문심사처럼 콘텐츠 섹션에 사는 게시판 상세는 그쪽을 쓴다.
 *
 * ⚠️ 탭 key/href 를 손으로 적지 마라 — `@/lib/board-links` 의 NEWS_TABS·newsTabHref 가
 *    URL 문법의 단일 출처다. 라벨만 메시지(`menu.news.items.*`)에서 온다.
 */
import { getTranslations } from 'next-intl/server';
import type { BoardShellTab } from '@/components/BoardShell';
import { NEWS_TABS, newsTabHref } from '@/lib/board-links';
import type { Locale } from '@/i18n/routing';

/**
 * 뉴스 섹션 8개 탭.
 * key = URL 세그먼트(= 게시판 boardKey. 뉴스 기사만 'press' 로 갈린다.
 *       일정·교수 초빙은 게시판이 아닌 탭이라 대응하는 boardKey 가 없다),
 * href = 실제 경로(`/news/<seg>`) — 해시가 아니라 크롤 가능한 링크다.
 */
export async function getNewsTabs(locale: Locale): Promise<BoardShellTab[]> {
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  return NEWS_TABS.map(({ seg, labelKey }) => ({
    key: seg,
    label: tMenu(`news.items.${labelKey}`),
    href: newsTabHref(seg),
  }));
}
