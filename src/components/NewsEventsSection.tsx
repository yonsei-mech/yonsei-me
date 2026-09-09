'use client';

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { FlowLines } from './FlowLines';

/** 우측 '이전 뉴스' 목록에 세우는 최대 건수(시안 3건) */
const SIDE_COUNT = 3;
/** 스와이프 한 장 넘김 임계(px) */
const SWIPE_PX = 50;

export interface NewsEventItem {
  date: string; // 'YYYY-MM-DD'
  title: string;
  href: string;
  kind: 'news' | 'event';
  /** 뉴스 분류(뉴스 kind 전용) — 대표 카드 칩이 '성과' 글을 구분해 표시한다 */
  category?: 'general' | 'achievement';
  /** 좌측 대표 카드용 — 본문 첫 이미지(원본). 없으면 thumb 로 폴백(page.tsx 에서 조립) */
  image?: string;
  /** 우측 목록용 — 게시물 대표사진(thumbnail). 원본을 가로로 잘라 낸 별개 파일이라
   *  대표 카드에는 쓰지 않지만, 132px 짜리 작은 칸에는 이쪽이 알맞다. */
  thumb?: string;
  /** 카드 본문 발췌 — excerpt 우선, 없으면 body 평문 첫 문단(page.tsx 에서 조립) */
  summary?: string;
}

/** 뉴스 **제목** 전용 서체 — Paperlogy(--font-subhead). 후보 서체를 실제 화면에 갈아 끼워
 *  비교한 뒤 사용자가 확정했다(2026-08-03). 굵기는 **600**(font-semibold)이라
 *  Paperlogy-6SemiBold 파일이 그대로 쓰인다 — 700(font-bold)으로 바꾸면 다른 파일이 걸린다.
 *  ⚠️ 본문·요약은 그대로 Pretendard 다. 제목에만 건다. */
const TITLE_FONT = { fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif' };

/** '01', '06' — 카운터는 두 자리 고정폭이라 숫자가 바뀌어도 폭이 흔들리지 않는다. */
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → 'YYYY. MM. DD' */
const dotDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${y}. ${m}. ${d}`;
};

/** 원형 아이콘 버튼(35px)의 공용 클래스. ⚠️ CircleArrowButton 의 기존 클래스 문자열과
 *  완전히 동일해야 한다 — LabsSection·CareerPaths 가 그 버튼을 그대로 재사용한다. */
const CIRCLE_BTN_CLASS =
  'grid h-[35px] w-[35px] place-items-center rounded-full border border-content/40 text-content transition-colors hover:border-yonsei-blue hover:text-yonsei-blue disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue';

/**
 * 뉴스 단독 섹션 — "좌 대표 뉴스 1건 + 우 목록 3건" 레이아웃. **정적 섹션이다**:
 * 자동 전환·진행 인디케이터·진입 애니메이션을 모두 걷어냈고, 화면이 바뀌는 것은 오직
 * 사용자가 조작했을 때뿐이다(GSAP 의존성 없음).
 *
 * 위→아래:
 *  - 헤더 행: 네이비 라벨 박스(제목) / 헤어라인 / 카운터(01 / 04) / ← → 버튼.
 *    화살표는 양끝에서 막히지 않고 순환한다(disabled 없음).
 *  - 본문 그리드(lg 이상 1fr + 424px): 좌측 대표 카드 + 우측 '이전 뉴스' 3행.
 *    우측 행은 링크가 아니라 **버튼**이라 누르면 그 기사가
 *    대표 자리로 올라온다(본문으로 이동은 대표 카드가 담당).
 *
 * 대표 기사를 바꾸는 경로는 셋뿐 — ← → 화살표, 우측 행 클릭, 터치 스와이프. 전부
 * 사용자 입력이라 카운터의 aria-live 는 항상 'polite' 로 둔다(자동으로 읽히는 일이 없다).
 *
 * ⚠️ 섹션 높이는 어느 화면에서나 **내용이 정하는 자연 높이**다(다른 홈 섹션과 같은
 * py-12 / sm:py-section-lg 리듬). 예전에는 lg 이상에서 min-h-[100svh] 로 '한 화면 고정'을
 * 시도했는데, min-height 만 있는 flex 부모에 대한 자식의 h-full 은 Chrome 에서 auto 로
 * 풀려 남는 높이가 컨테이너에 전달되지 않았고(실측: 섹션 1800px 인데 컨테이너 712px),
 * 그 여백이 전부 카드 아래 빈 공간으로 쌓였다. 뷰포트가 높은 화면(5K iMac·브라우저 축소
 * 보기 등)일수록 공백이 뷰포트에 정비례해 커졌다(높이 1440 에서 728px, 1800 에서
 * 1088px — 2026-09 "맥에서 섹션 간격이 과하게 넓다" 신고의 원인). 뷰포트 높이(vh/svh)에
 * 섹션 높이를 묶지 말 것.
 */
export function NewsEventsSection({ items }: { items: NewsEventItem[] }) {
  const t = useTranslations('home');
  const tStub = useTranslations('stub');

  const total = items.length;
  const hasItems = total > 0;
  // 2건 이상일 때만 조작(화살표·스와이프)이 의미를 갖는다.
  const canCycle = total > 1;

  // 대표 자리에 올라와 있는 기사 인덱스. 포인터 핸들러는 렌더와 무관하게 최신값을 읽어야
  // 해서(제스처 도중 클로저가 낡는다) state 와 ref 를 함께 둔다.
  const [j, setJ] = useState(0);
  const jRef = useRef(0);

  // 스와이프로 끝난 포인터 제스처가 그대로 링크 클릭으로 이어지는 것을 막는 플래그.
  const suppressClickRef = useRef(false);

  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return;
      const i = ((next % total) + total) % total; // 음수 포함 순환
      jRef.current = i;
      setJ(i);
    },
    [total],
  );

  const hero = hasItems ? items[j] : undefined;
  // 우측 목록 = 대표 다음 3건(순환). 1건뿐이면 빈 배열이라 열 자체가 렌더되지 않는다.
  const sideIdx = Array.from({ length: Math.max(0, Math.min(SIDE_COUNT, total - 1)) }, (_, k) =>
    (j + k + 1) % total,
  );

  // ── 포인터 스와이프(터치 전용) ───────────────────────────────────────────
  // 세로 의도(|dy|>|dx|)면 즉시 손을 떼 페이지 세로 스크롤을 가로채지 않는다
  // (그리드에 touch-action:pan-y 도 함께 건다).
  const dragRef = useRef<{ id: number; x: number; y: number; t: number; axis: 'none' | 'x' } | null>(
    null,
  );

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // 마우스는 화살표로 조작한다. 드래그를 열면 본문 텍스트 선택과 부딪힌다.
    if (e.pointerType === 'mouse') return;
    // 직전 스와이프가 남긴 억제 플래그를 흘려보내면 다음 탭이 삼켜진다 — 제스처마다 초기화.
    suppressClickRef.current = false;
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), axis: 'none' };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.axis !== 'none') return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (Math.abs(dy) > Math.abs(dx)) {
      // 세로 스와이프 — 섹션은 관여하지 않고 제스처를 버린다.
      dragRef.current = null;
      return;
    }
    d.axis = 'x';
  }, []);

  const onPointerEnd = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d || d.id !== e.pointerId) return;
      dragRef.current = null;
      if (d.axis !== 'x' || !canCycle) return;

      const dx = e.clientX - d.x;
      // 짧고 빠른 플릭도 한 장 넘김으로 인정한다(임계 50px 를 못 채워도).
      const flick = Math.abs(dx) > 20 && performance.now() - d.t < 250;
      // 스와이프 끝의 click 이 대표 카드 링크를 열어 버리는 것을 막는다.
      suppressClickRef.current = Math.abs(dx) > 10;
      if (dx <= -SWIPE_PX || (flick && dx < 0)) goTo(jRef.current + 1);
      else if (dx >= SWIPE_PX || (flick && dx > 0)) goTo(jRef.current - 1);
    },
    [canCycle, goTo],
  );

  return (
    <section
      aria-labelledby="news-events-heading"
      // 자유 스크롤 홈 섹션 — 자연 높이 + 다른 홈 섹션(공지·연구실·목표)과 통일된 상하
      // 리듬(모바일 py-12, sm+ py-section-lg). ⚠️ lg 에서 min-h-[100svh] 같은 뷰포트 비례
      // 높이를 다시 걸지 말 것 — 파일 상단 주석의 경위(큰 화면에서 카드 아래 공백이 뷰포트에
      // 비례해 커진다).
      className="full-bleed relative bg-surface py-12 sm:py-section-lg"
    >
      {/* 배경 유선 장식(Cornell CHE) — 상단 패딩·헤더 행의 '기존' 여백에만 겹치는 0-높이
          absolute 레이어(자체 높이를 가지는 스트립 금지 — 사용자 지시). 본문에 닿기 전에
          아래로 마스크 소멸. 콘텐츠 컨테이너가 relative 라 항상 텍스트 뒤. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 hidden h-56 overflow-hidden sm:block lg:h-64"
      >
        <FlowLines
          variant="sweep"
          gid="flow-news"
          viewBox="0 150 1512 380"
          className="absolute inset-0 h-full w-full -scale-x-100 opacity-10 [-webkit-mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)] [mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)]"
        />
      </div>

      {/* 헤더와 본문이 한 컨테이너 안에 있다(구 캐러셀과 달리 full-bleed 요소 없음).
          높이는 내용이 정한다 — 헤더 행 + 본문 그리드의 자연 높이. */}
      <div className="relative mx-auto w-full max-w-[1360px] px-6 sm:px-10 lg:px-16">
        {/* 헤더 행 — 좌: 네이비 라벨 박스(각지게) / 사이: 헤어라인(학과 목표 섹션과 동일한
            선 문법) / 우: 카운터 + ← → 화살표(양끝 막힘 없이 순환) */}
        <div className="flex items-center gap-6">
          <h2
            id="news-events-heading"
            className="inline-block bg-yonsei-navy px-4 py-2 text-base font-bold text-white sm:px-5 sm:py-2.5 sm:text-lg"
          >
            {t('newsEvents.title')}
          </h2>
          <span aria-hidden="true" className="h-px flex-1 bg-surface-border" />

          {hasItems && (
            // 자동 전환이 없으니 live 를 끌 이유가 없다 — 카운터가 바뀌는 건 사용자가
            // 화살표·목록·스와이프로 직접 넘겼을 때뿐이라 그때 읽어 주는 것이 맞다.
            <span
              aria-live="polite"
              className="text-[15px] font-bold tabular-nums tracking-[0.02em] text-content-faint"
            >
              {t('newsEvents.counter', { current: pad2(j + 1), total: pad2(total) })}
            </span>
          )}
          {canCycle && (
            <div className="flex items-center gap-2.5">
              <CircleArrowButton
                dir="left"
                onClick={() => goTo(j - 1)}
                label={t('newsEvents.prev')}
              />
              <CircleArrowButton
                dir="right"
                onClick={() => goTo(j + 1)}
                label={t('newsEvents.next')}
              />
            </div>
          )}
        </div>

        {hasItems && hero ? (
          /* 본문 그리드 — lg 이상 1fr + 424px 2열. 높이는 두 열 중 큰 쪽의 자연 높이
             (좌측 카드 = 텍스트 블록 224 + 사진 8/3 + 패딩 ≈ 636, 폭 1360 기준)이고
             뷰포트와 무관하다. 카드 안 텍스트는 줄 수 단위로 높이를 고정해 두었으므로
             (HeroNewsCard 주석 참조) 기사가 바뀌어도 박스 크기는 변하지 않는다.
             그 미만에서는 단순 세로 스택. */
          <div
            className="mt-6 flex flex-col gap-4 lg:mt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_424px] lg:items-stretch lg:gap-6"
            style={{ touchAction: 'pan-y' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onClickCapture={(e) => {
              if (!suppressClickRef.current) return;
              suppressClickRef.current = false;
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <HeroNewsCard item={hero} />

            {/* 우측 '이전 뉴스' 목록 — 각 행은 링크가 아니라 버튼이라, 누르면 그 기사가
                대표 자리로 올라온다(본문으로 이동은 대표 카드가 담당).
                ⚠️ flex + flex-1 이 아니라 **grid-rows-3**. flex-1 은 자식 내용이 길어지면
                기본 min-height:auto 에 걸려 행마다 높이가 달라지지만, grid 트랙은
                (전체높이 − 20px×2) / 3 로 수학적으로 균등하다. 좌측 카드와 같은 그리드
                행에 stretch 로 놓이므로 위·아래 끝선은 구조상 정확히 일치한다. */}
            {sideIdx.length > 0 && (
              <div className="flex flex-col gap-4 lg:grid lg:h-full lg:grid-rows-3 lg:gap-5">
                {sideIdx.map((idx) => {
                  const it = items[idx];
                  return (
                    <button
                      key={`${it.href}-side-${idx}`}
                      type="button"
                      onClick={() => goTo(idx)}
                      aria-label={t('newsEvents.goToTitle', { title: it.title })}
                      // 면은 대표 카드·학사일정 패널과 같은 토큰 한 쌍(rounded-card +
                      // surface-soft) — 다크 모드까지 따라온다.
                      // min-h-0 + overflow-hidden: 안쪽 내용이 무슨 일이 있어도 트랙을
                      // 밀어 늘리지 못하게 잠근다(세 행 높이가 어긋나는 유일한 경로).
                      className="group flex w-full items-center gap-4 rounded-card bg-surface-soft p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue lg:min-h-0 lg:gap-[18px] lg:overflow-hidden lg:p-5"
                    >
                      {/* 목록 썸네일은 thumb(=게시물 대표사진)을 쓴다 — 대표 카드만 본문
                          원본을 쓰고, 작은 칸에서는 잘린 썸네일이 오히려 알맞다(사용자 지시). */}
                      <span className="relative aspect-[4/3] w-[104px] shrink-0 overflow-hidden bg-[#c9daee] lg:w-[132px]">
                        {it.thumb || it.image ? (
                          <Image
                            src={(it.thumb || it.image) as string}
                            alt=""
                            fill
                            draggable={false}
                            sizes="132px"
                            className="object-cover"
                          />
                        ) : (
                          <span className="absolute inset-0 grid place-items-center">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src="/img/eagle_empty.png"
                              alt=""
                              aria-hidden="true"
                              draggable={false}
                              className="h-10 w-auto opacity-60"
                            />
                          </span>
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold tabular-nums text-yonsei-navy">
                          {dotDate(it.date)}
                        </span>
                        {/* button 안에는 phrasing content 만 올 수 있어 p 가 아니라 span 을 쓴다
                            (p 를 넣으면 HTML 검증 위반 + 브라우저가 버튼 밖으로 밀어낼 수 있다). */}
                        {/* 대표 카드와 같은 이유로 제목 2줄·요약 2줄 높이를 항상 잡아 둔다
                            (요약이 비어도 렌더한다) — 트랙 높이는 grid-rows-3 로 균등해도
                            안쪽 내용이 들쭉날쭉하면 세로 가운데 정렬이 매 전환마다 흔들린다. */}
                        {/* block 을 같이 주면 line-clamp 의 display:-webkit-box 를 덮어
                            말줄임(…)이 사라진다 — 높이·여백은 바깥 span 이 맡는다. */}
                        <span className="mt-1.5 block lg:h-[46px]">
                          <span
                            style={TITLE_FONT}
                            className="line-clamp-2 text-[15px] font-semibold leading-[1.45] tracking-[-0.01em] text-content transition-colors group-hover:text-yonsei-blue lg:text-base lg:leading-[23px]"
                          >
                            {it.title}
                          </span>
                        </span>
                        <span className="mt-1.5 block lg:h-[44px]">
                          <span className="line-clamp-2 text-[13px] leading-[1.6] text-content lg:text-[13.5px] lg:leading-[22px]">
                            {it.summary ?? ''}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          // 빈 상태 — 기존 빈 게시판 관례(eagle_empty 마스코트 + stub.empty 문구).
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/eagle_empty.png"
              alt=""
              aria-hidden="true"
              className="h-20 w-auto opacity-70"
            />
            <p className="text-sm font-medium text-content-faint">{tStub('empty')}</p>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * 좌측 대표 카드 — 분류 칩 + 날짜 → 제목 → 요약 → 사진 → 바닥에 못박은 CTA 순.
 * 카드 전체가 게시물로 가는 Link 다.
 *
 * 면은 학사일정 패널(HomeCalendarPanel)과 같은 토큰 한 쌍 — `rounded-card`(8px) +
 * `bg-surface-soft`. 예전의 인라인 그라디언트는 다크 모드를 따라오지 못해 걷어냈다.
 * 교표 워터마크는 사용자 지시로 제거했다(되살리지 말 것).
 */
function HeroNewsCard({ item }: { item: NewsEventItem }) {
  const t = useTranslations('home');
  // 뉴스 칩은 분류를 따른다 — 성과 글은 '성과', 그 외(일반)는 '뉴스'
  const kindLabel =
    item.kind === 'news'
      ? item.category === 'achievement'
        ? t('newsEvents.kindAchievement')
        : t('newsEvents.kindNews')
      : t('newsEvents.kindEvent');

  return (
    <Link href={item.href} draggable={false} className="group relative block lg:h-full">
      {/* ⚠️ lg 이상 아래 패딩 92px — 자세히보기가 absolute 라 흐름에서 빠져 있다. 그만큼
          자리를 비워 두지 않으면 마지막 요소(사진)가 CTA 를 덮는다(짧은 화면에서 실제로
          겹쳤다). 92 = CTA 가 차지하는 76(밑변 50 + 높이 26) + 사진과의 간격 16. */}
      <article className="relative flex h-full flex-col overflow-hidden rounded-card bg-surface-soft p-5 sm:p-7 lg:p-8 lg:pb-[92px] xl:p-10 xl:pb-[92px]">
        {/* 순서: 날짜 → 제목 → 본문 → 사진 → (바닥 고정) 자세히보기.
            텍스트 블록은 lg 이상에서 **블록 전체**가 고정 높이다(제목·본문에 각각 높이를
            박지 않는다). 안쪽은 위에서부터 자연스럽게 쌓이고, 줄 수가 모자라 남는 높이는
            블록 아래쪽(= 사진 바로 위)으로 떨어진다 — 글자 사이에 구멍이 생기지 않고,
            사진의 시작 위치와 크기가 기사와 무관하게 일정해진다.
            높이 = 칩행 30 + (18 + 제목 2줄 68) + (30 + 본문 2~3줄) + 여유. */}
        <div className="relative lg:h-[224px] lg:shrink-0">
          <div className="flex items-center gap-[14px]">
            <span className="bg-yonsei-navy px-3 py-[5px] text-[13px] font-bold text-white">
              {kindLabel}
            </span>
            <span className="text-[15px] font-bold tabular-nums text-yonsei-navy">
              {dotDate(item.date)}
            </span>
          </div>

        {/* ⚠️ line-clamp 를 거는 요소는 여백을 맡는 바깥 div 와 분리해 둔다 — 안쪽 h3/p 가
            line-clamp 를 맡는 두 겹 구조(말줄임 보존). 제목은 최대 2줄에서 …로 잘린다. */}
          <div className="mt-4 lg:mt-[18px]">
            <h3
              style={TITLE_FONT}
              className="line-clamp-2 text-xl font-semibold leading-[1.4] tracking-[-0.02em] text-content lg:text-2xl lg:leading-[34px]"
            >
              {item.title}
            </h3>
          </div>

        {/* 본문은 화면 크기와 무관하게 **항상 딱 3줄**, 넘치면 …로 자른다(사용자 지시).
            예전에는 짧은 화면에서 2줄로 줄였는데, 그러면 같은 기사가 화면마다 다르게 보였다.
            바깥 블록 높이(224)도 3줄 기준 하나로 고정 —
            30(칩행) + 18 + 68(제목 2줄×34) + 30 + 78(본문 3줄×26) = 224.
            짧은 노트북에서 자리가 모자라면 아래 사진 칸이 줄어든다(contain 이라 잘리지 않고
            작아지기만 한다). lg 이상의 mt-[30px] 이 사용자가 지정한 제목→본문 고정 간격이다.
            ⚠️ item.summary 가 비어도 이 요소는 '항상' 렌더한다 — 조건부로 지우면 아래
            사진이 위로 올라붙어 기사마다 위치가 달라진다. */}
          <div className="mt-3 lg:mt-[30px]">
            <p className="line-clamp-3 text-[15px] leading-[1.8] text-content lg:leading-[26px]">
              {item.summary ?? ''}
            </p>
          </div>
        </div>

        {/* 사진 — object-contain. **어떤 비율이 올라와도 한 픽셀도 자르지 않는다.**
            ⚠️ cover 를 쓰면 안 된다: 프로덕션 업로드 비율을 실측하니 1.20 ~ 2.63 으로
            두 배 넘게 벌어져(연구실 로고·인물·논문 그림이 한 장에 조합된 형태) 어떤 고정
            비율을 잡아도 6건 중 5건이 39~56% 잘려 나갔다. 잘리면 정보가 실제로 사라진다.
            프레임 배경은 카드와 같은 bg-surface-soft — 남는 자리가 눈에 띄지 않아 '사진이
            조금 작게 놓인' 것처럼 보인다(다크 모드도 토큰이 따라온다).
            비율 8/3 은 카드가 허용하는 최대 높이(카드 안쪽 - 텍스트 블록 - 여백)에서 왔다.
            세로로 더 키우면 정사각에 가까운 사진이 커지지만 그만큼 카드와 섹션이 길어진다
            (섹션은 자연 높이라 넘칠 곳은 없지만 홈의 세로 리듬이 무너진다).
            contain 이라 프레임보다 작은 사진도 잘리지 않고 여백 안에 놓인다. */}
        <div className="relative mt-5 aspect-[8/3] w-full min-h-0 overflow-hidden bg-surface-soft lg:mt-4">
          {item.image ? (
            <Image
              src={item.image}
              alt=""
              fill
              draggable={false}
              sizes="(min-width:1024px) 800px, 100vw"
              className="object-contain"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/eagle_empty.png"
                alt=""
                aria-hidden="true"
                draggable={false}
                className="h-14 w-auto opacity-60"
              />
            </div>
          )}
        </div>

        {/* 자세히보기 — lg 이상에서는 흐름에서 빼내 **카드 밑변 기준 50px 위**에 못박는다.
            흐름에 두면 제목이 1줄인 기사에서 그만큼 위로 올라붙어 기사마다 위치가 달라진다
            (사용자 지시로 고정). absolute 의 bottom 은 카드의 패딩 박스 = 테두리 안쪽 기준이라
            카드 아래 패딩값과 무관하게 정확히 50px 이 된다. 좌측은 카드 패딩(lg 32 / xl 40)에
            맞춰 눈금을 유지한다. lg 미만에서는 카드 높이가 자유라 그대로 흐름에 둔다. */}
        {/* 위치: 카드 밑변에서 30px 위, 좌측 패딩 + 10px (사용자 지시로 오른쪽 10 · 아래 20
            이동). absolute 의 bottom/left 는 카드 패딩 박스 기준이라 패딩값과 무관하게
            정확한 거리다. lg 미만에서는 카드 높이가 자유라 그대로 흐름에 둔다. */}
        {/* lg:flex — 인라인 배치로 두면 baseline 아래 descender 여백 2px 이 붙어 실제
            거리가 30 이 아니라 32 로 잰다. flex 로 감싸면 안쪽 span 밑변 = 이 박스 밑변. */}
        <div className="mt-5 lg:absolute lg:bottom-[30px] lg:left-[42px] lg:mt-0 lg:flex xl:left-[50px]">
          {/* VIEW MORE › — 공지 섹션(NoticeSection)의 더보기 링크와 **완전히 같은 문법**.
              예전에는 이 카드만 text-[15px] + tracking-[0.06em] 이라 자간이 겉돌았다. */}
          <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-content transition-colors group-hover:text-yonsei-blue">
            {t('newsEvents.more')}
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
              ›
            </span>
          </span>
        </div>
      </article>
    </Link>
  );
}

/** 캐러셀 이동 버튼 — 원형 보더 + 셰브런. 학과 일정 위젯(HomeCalendarPanel)의
 *  버튼 문법을 그대로 승격한 공용판(뉴스&행사·연구실·진로 분야). 이전의 긴 화살표
 *  아이콘(ArrowIcon)은 이 버튼으로 대체되어 삭제했다. */
export function CircleArrowButton({
  dir,
  onClick,
  disabled,
  label,
}: {
  dir: 'left' | 'right';
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={CIRCLE_BTN_CLASS}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden="true"
      >
        {dir === 'left' ? (
          <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
