/**
 * 콘텐츠 섹션(소개·학부·대학원·연구) 탭 페이지 공용 껍데기 — 히어로 + 탭 셸 +
 * 레거시 해시 구제 + metadata. 24개 탭 페이지가 전부 이 한 곳을 쓴다.
 *
 * 예전에는 섹션마다 같은 껍데기(AboutTabPage·GraduateTabPage·ResearchTabPage·
 * UndergraduateTabPage + 섹션별 tabs.ts)를 한 벌씩 들고 있었다. 로직은 동일하고
 * 히어로 문구 출처·크럼 모양만 달랐으므로, 그 차이만 SPEC 데이터로 내리고
 * 코드는 하나로 합쳤다. 탭이 경로가 된 이유는 종전과 같다 — 해시는 서버로 오지
 * 않아 검색엔진에게 여러 화면이 URL 하나로 보였다.
 *
 * ⚠️ 탭 key/href 를 손으로 적지 마라 — `@/lib/board-links` 의 CONTENT_SECTIONS·
 *    sectionTabHref 가 URL 문법의 단일 출처다. 라벨만 메시지(`menu.<섹션>.items.*`)에서 온다.
 * ⚠️ setRequestLocale 은 라우트 진입점(page.tsx)이 부른다 — 여기서 부르면 이미
 *    데이터 조립이 끝난 뒤라 늦다.
 * (`_shared` 는 밑줄 접두사라 Next 라우팅에서 제외되는 비공개 폴더다.)
 */
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Hero } from '@/components/Hero';
import { LegacyBoardHash } from '@/components/LegacyBoardHash';
import { TabPageShell, type TabNavItem } from '@/components/TabPageShell';
import {
  CONTENT_SECTIONS,
  legacySectionHash,
  sectionDefaultHref,
  sectionTabHref,
  type ContentSection,
} from '@/lib/board-links';
import { pageMetadata } from '@/lib/page-metadata';
import type { Locale } from '@/i18n/routing';

/** 섹션별 탭 키 — CONTENT_SECTIONS 에서 파생(오타를 타입이 잡는다) */
export type SectionTabKey<S extends ContentSection> = (typeof CONTENT_SECTIONS)[S][number];

/** 메시지 참조: [네임스페이스, 키] */
type Msg = [ns: string, key: string];

/**
 * 섹션별로 실제로 다른 것 전부 — 히어로 문구 출처와 크럼 모양뿐이다.
 * (description 은 예전엔 여기 desc 로 조립했다: "탭 라벨 · 섹션 설명". 구글이 그런
 *  기계적 문구를 스니펫으로 안 쓰고 표 내용을 대신 긁어 갔다 — 탭마다 사람이 쓴
 *  문장을 messages 의 `seo.<섹션>.<탭>` 에 두는 방식으로 바꿨다.)
 */
const SPEC: Record<
  ContentSection,
  {
    heroTitle: Msg;
    heroSubtitle?: Msg;
    /** simple: 그룹 라벨 하나(링크 없음) / linked: 그룹→기본 탭 링크 + 현재 탭 */
    crumb: 'simple' | 'linked';
    /** simple 크럼의 라벨 출처(생략 시 메뉴 라벨) — about 만 nav 라벨을 쓴다 */
    crumbLabel?: Msg;
  }
> = {
  about: {
    heroTitle: ['about', 'hero.title'],
    heroSubtitle: ['about', 'hero.subtitle'],
    crumb: 'simple',
    crumbLabel: ['nav', 'about'],
  },
  undergraduate: {
    heroTitle: ['menu', 'undergraduate.label'],
    crumb: 'linked',
  },
  graduate: {
    heroTitle: ['menu', 'graduate.label'],
    heroSubtitle: ['pages', 'graduate.subtitle'],
    crumb: 'simple',
  },
  research: {
    heroTitle: ['menu', 'research.label'],
    crumb: 'linked',
  },
};

/** [ns, key] → 번역 문자열 (getTranslations 는 next-intl 이 요청 단위로 캐시한다) */
async function msg(locale: Locale, [ns, key]: Msg): Promise<string> {
  const t = await getTranslations({ locale, namespace: ns });
  return t(key);
}

/** 탭 라벨 ("교수진", "나의 졸업요건" …) — 메가메뉴와 같은 메시지 키를 쓴다 */
export async function sectionTabLabel<S extends ContentSection>(
  locale: Locale,
  section: S,
  tab: SectionTabKey<S>,
): Promise<string> {
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  return tMenu(`${section}.items.${tab}`);
}

/**
 * 섹션의 탭 배열 — 탭 페이지(TabPageShell)와 그 섹션에 사는 게시판 상세(BoardShell)가
 * 같은 탭 줄을 그려야 하므로 여기 한 곳에서 만든다(학위논문심사 상세가 두 번째 소비자다).
 * TabNavItem 과 BoardShellTab 은 {key,label,href} 로 같은 모양이라 그대로 넘길 수 있다.
 * ⚠️ CONTENT_SECTIONS 가 as const 라 섹션마다 서로 다른 리터럴 튜플이다 —
 *    유니온 튜플에는 .map 을 바로 못 부르므로 readonly string[] 으로 넓힌다(사이트맵과 동일).
 */
export async function sectionTabs(
  locale: Locale,
  section: ContentSection,
): Promise<TabNavItem[]> {
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  return (CONTENT_SECTIONS[section] as readonly string[]).map((key) => ({
    key,
    label: tMenu(`${section}.items.${key}`),
    href: sectionTabHref(section, key),
  }));
}

/** 본문이 비었을 때 문구 — 전 탭 페이지가 같은 값을 쓴다 */
export async function sectionEmptyLabel(locale: Locale): Promise<string> {
  const tStub = await getTranslations({ locale, namespace: 'stub' });
  return tStub('body');
}

/** 섹션 라벨 — 브레드크럼과 제목이 같은 출처를 쓴다(about 만 nav 라벨) */
async function sectionLabel(locale: Locale, section: ContentSection): Promise<string> {
  const spec = SPEC[section];
  return msg(locale, spec.crumbLabel ?? ['menu', `${section}.label`]);
}

/**
 * 탭 페이지 metadata.
 * title 은 `탭 라벨 | 섹션 라벨` — 여기에 레이아웃 템플릿이 ` | 사이트명` 을 더 붙인다.
 * 탭 라벨만 두면 "교직원" 처럼 맥락 없는 한 단어가 검색결과 제목이 된다(실측).
 * openGraph·twitter 까지 pageMetadata 가 통째로 만든다 — 부분 대입은 얕은 병합에
 * 걸려 레이아웃 값이 통째로 사라지거나 그대로 남는다(lib/page-metadata.ts 주석).
 */
export async function sectionTabMetadata<S extends ContentSection>(
  locale: string,
  section: S,
  tab: SectionTabKey<S>,
): Promise<Metadata> {
  const l = locale as Locale;
  const [label, group, tSeo] = await Promise.all([
    sectionTabLabel(l, section, tab),
    sectionLabel(l, section),
    getTranslations({ locale: l, namespace: 'seo' }),
  ]);
  return pageMetadata({
    locale: l,
    // pageMetadata 는 선행 슬래시 없는 경로를 받는다
    path: sectionTabHref(section, tab).slice(1),
    title: `${label} | ${group}`,
    description: tSeo(`${section}.${tab}`),
  });
}

/**
 * 탭 페이지 껍데기. children 은 해당 탭의 콘텐츠 컴포넌트,
 * markdown 은 콘텐츠 없이 본문 마크다운만 있는 탭(장학금·BK21 등)용이다.
 */
export async function SectionTabPage<S extends ContentSection>({
  locale,
  section,
  tab,
  markdown,
  children,
}: {
  locale: string;
  section: S;
  tab: SectionTabKey<S>;
  /** 마크다운 본문 탭용 (커스텀 컴포넌트를 쓰는 탭은 children) */
  markdown?: string | null;
  children?: ReactNode;
}) {
  const l = locale as Locale;
  const spec = SPEC[section];
  const tMenu = await getTranslations({ locale: l, namespace: 'menu' });
  const tStub = await getTranslations({ locale: l, namespace: 'stub' });
  const menuLabel = tMenu(`${section}.label`);
  const label = await sectionTabLabel(l, section, tab);
  const heroTitle = await msg(l, spec.heroTitle);
  const heroSubtitle = spec.heroSubtitle ? await msg(l, spec.heroSubtitle) : undefined;
  // 그룹 크럼은 기본 탭으로 보낸다 — 섹션 루트로 걸면 크럼 클릭마다 308 을 한 번 더 탄다.
  // simple 크럼은 그룹 하나가 마지막 항목이라 히어로가 링크로 그리지 않는다(시각 변화 없음).
  // href 를 붙이는 이유는 구조화 데이터뿐 — BreadcrumbList 의 각 항목은 URL 이 있어야
  // 검색결과 경로 표기로 쓰인다. 현재 탭은 crumbLeaf 로 JSON-LD 에만 덧붙인다.
  const breadcrumb =
    spec.crumb === 'linked'
      ? [{ label: menuLabel, href: sectionDefaultHref(section) }, { label }]
      : [{ label: await sectionLabel(l, section), href: sectionDefaultHref(section) }];
  const tabs = await sectionTabs(l, section);

  return (
    <>
      {/* 히어로 제목은 섹션명(전 탭 공통)이라 h1 을 본문 쪽 탭 제목에 넘긴다 —
          한 문서에 큰 제목이 둘이면 구글이 제목 링크를 임의로 골라 쓴다.
          시각적으로는 아무것도 바뀌지 않는다(요소만 p/h1 로 교체). */}
      <Hero
        title={heroTitle}
        subtitle={heroSubtitle}
        breadcrumb={breadcrumb}
        crumbLeaf={spec.crumb === 'linked' ? undefined : label}
        titleTag="p"
      />
      <TabPageShell
        navTitle={menuLabel}
        tabs={tabs}
        activeKey={tab}
        title={label}
        titleTag="h1"
        markdown={markdown}
        emptyLabel={tStub('body')}
      >
        {children}
      </TabPageShell>
      {/* 구 해시 북마크(`/about#staff` 등) 구제 — 해시는 서버에 오지 않아, 섹션 루트의
          308 을 따라온 기본 탭에서 클라이언트로만 잡을 수 있다(그래서 기본 탭에만 얹는다) */}
      {tab === CONTENT_SECTIONS[section][0] && <LegacyBoardHash map={legacySectionHash(section)} />}
    </>
  );
}
