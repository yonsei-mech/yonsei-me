/** 현행 학부 홈페이지의 6개 대분류 메뉴 구조.
 *  labelKey는 messages의 menu.<group>.label / menu.<group>.items.<key> 를 가리킨다.
 *  세부항목 추가/수정은 이 파일과 메시지 파일만 편집하면 된다.
 *
 *  ⚠️ 세부항목은 이제 **전부 경로**다 — 해시(`/about#history`)는 서버로 전송되지 않아
 *     검색엔진에게 섹션 하나가 URL 하나로 보였다. 2026-08 2차 개편에서 콘텐츠 4개 섹션
 *     (소개·학부·대학원·연구)도 게시판처럼 탭마다 진짜 경로를 갖는다.
 *     경로 문법의 단일 출처는 @/lib/board-links — 여기서 문자열을 조립하지 말 것.
 *     key 는 라벨 조회 키라 URL 세그먼트와 다를 수 있다(뉴스: key 'news' ↔ /news/press). */
import { newsTabHref, sectionTabHref } from '@/lib/board-links';

export interface MenuSubItem {
  key: string;
  href: string;
}

export interface MenuGroup {
  key: string;
  href: string;
  items: MenuSubItem[];
}

export const menu: MenuGroup[] = [
  {
    key: 'about',
    href: '/about',
    items: [
      { key: 'history', href: sectionTabHref('about', 'history') },
      { key: 'faculty', href: sectionTabHref('about', 'faculty') },
      { key: 'staff', href: sectionTabHref('about', 'staff') },
      { key: 'directions', href: sectionTabHref('about', 'directions') },
      { key: 'admission', href: sectionTabHref('about', 'admission') },
      { key: 'careers', href: sectionTabHref('about', 'careers') },
    ],
  },
  {
    key: 'undergraduate',
    href: '/undergraduate',
    items: [
      { key: 'goals', href: sectionTabHref('undergraduate', 'goals') },
      { key: 'requirements', href: sectionTabHref('undergraduate', 'requirements') },
      { key: 'checker', href: sectionTabHref('undergraduate', 'checker') },
      { key: 'mileage', href: sectionTabHref('undergraduate', 'mileage') },
      { key: 'courses', href: sectionTabHref('undergraduate', 'courses') },
      { key: 'curriculum', href: sectionTabHref('undergraduate', 'curriculum') },
      { key: 'clubs', href: sectionTabHref('undergraduate', 'clubs') },
      { key: 'scholarship', href: sectionTabHref('undergraduate', 'scholarship') },
    ],
  },
  {
    key: 'graduate',
    href: '/graduate',
    items: [
      { key: 'requirements', href: sectionTabHref('graduate', 'requirements') },
      // 학위논문심사는 게시판이지만 대학원 메뉴 소속이다(상세는 /graduate/thesis/<id>)
      { key: 'thesis', href: sectionTabHref('graduate', 'thesis') },
      { key: 'courses', href: sectionTabHref('graduate', 'courses') },
      { key: 'labs', href: sectionTabHref('graduate', 'labs') },
      { key: 'bk21', href: sectionTabHref('graduate', 'bk21') },
    ],
  },
  {
    key: 'research',
    href: '/research',
    items: [
      // 연구 비전과 연구 역량은 2026-09 에 한 탭('연구 비전 및 역량')으로 합쳤다
      { key: 'vision', href: sectionTabHref('research', 'vision') },
      { key: 'labs', href: sectionTabHref('research', 'labs') },
      { key: 'social', href: sectionTabHref('research', 'social') },
    ],
  },
  {
    key: 'news',
    href: '/news',
    items: [
      { key: 'notices', href: newsTabHref('notices') },
      // 라벨 키는 'news' 지만 URL 세그먼트는 'press' 다(/news/news 중첩 회피 — board-links 참고)
      { key: 'news', href: newsTabHref('press') },
      { key: 'events', href: newsTabHref('events') },
      { key: 'seminars', href: newsTabHref('seminars') },
      { key: 'career', href: newsTabHref('career') },
      { key: 'resources', href: newsTabHref('resources') },
      // 교수 초빙은 게시판이 아닌 안내 페이지다(2026-09 연구 섹션에서 이관)
      { key: 'recruit', href: newsTabHref('recruit') },
      // 학위논문심사는 2026-09 에 대학원 메뉴로 옮겼다 — 위 graduate 그룹 참고
      { key: 'calendar', href: newsTabHref('calendar') },
    ],
  },
  {
    key: 'alumni',
    href: '/alumni',
    items: [
      // /alumni 자체가 '동문회 소개' 페이지다(리다이렉트가 아니라 그 콘텐츠를 직접 렌더)
      { key: 'association', href: '/alumni' },
      // '동문 뉴스'는 2026-09 에 폐지했다(구 주소는 /alumni 로 308)
      { key: 'network', href: '/alumni/network' },
    ],
  },
];
