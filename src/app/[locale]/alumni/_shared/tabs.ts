import { getTranslations } from 'next-intl/server';
import type { BoardShellTab } from '@/components/BoardShell';
import type { Locale } from '@/i18n/routing';

/**
 * 동문 섹션의 2개 탭 — 목록 2개와 상세 1개가 모두 같은 셸을 그리므로 여기 한 곳에서 만든다.
 * (예전에는 상세 페이지마다 같은 배열을 복사해 뒀고, 탭이 늘거나 경로가 바뀌면 어긋났다.)
 * '동문 뉴스'는 2026-09 에 폐지했다(구 주소는 동문회 소개로 308 — 그 폴더의 route.ts).
 *
 * key 는 라벨 조회 키(menu.alumni.items.<key>)이자 활성 탭 판정 키다.
 * href 문법의 출처는 @/lib/board-links 의 주석 — /alumni 자체가 '동문회 소개' 목록이고,
 * 게시판은 그 아래 경로를 갖는다(LEGACY_ALUMNI_HASH 가 구 해시 링크를 여기로 보낸다).
 */
export const ALUMNI_TABS = [
  { key: 'association', href: '/alumni' },
  { key: 'network', href: '/alumni/network' },
] as const;

export type AlumniTabKey = (typeof ALUMNI_TABS)[number]['key'];

/** BoardShell 에 넘길 탭 배열 (라벨은 메가메뉴와 같은 menu.alumni.items.* 메시지) */
export async function getAlumniTabs(locale: Locale): Promise<BoardShellTab[]> {
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  return ALUMNI_TABS.map(({ key, href }) => ({
    key,
    href,
    label: tMenu(`alumni.items.${key}`),
  }));
}
