'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { AiSummaryPanel, AiSummaryToggle, useAiSummaryTyping } from '@/components/AiResearchSummary';
import { FieldBarTabs } from '@/components/FieldBarTabs';
import { RESEARCH_FIELDS, type ResearchField } from '@/lib/research-fields';
import type { LabDirectoryEntry } from '@/lib/faculty';

/** 분야 탭 표시 순서 (research.fieldFilter 메시지 키와 동일) */
const FIELDS: ResearchField[] = RESEARCH_FIELDS;

/** 연구실별 이미지가 없을 때 순환 사용하는 더미 배경 3장 (LabCarousel 과 동일 관례) */
const FALLBACK_IMAGES = [
  '/img/research/energy-conversion.jpg',
  '/img/research/intelligent-robotics.jpg',
  '/img/research/precision-manufacturing.jpg',
];

type Filter = 'all' | ResearchField;

/** 분야 인트로(research-gallery.json 로케일 해석본) — 특정 분야 선택 시 상단 소개 블록 */
export interface LabFieldIntro {
  field: ResearchField;
  title: string;
  description: string;
  image: string;
}

/**
 * 연구실 한 행 — [좌: 이름·메타·액션] [우: 이미지] + (열었을 때) 행 전폭 AI 요약 패널.
 *
 * 행마다 토글 상태가 따로 필요해 별도 컴포넌트로 뺐다(훅을 map 안에서 조건부로 부를 수
 * 없다). 패널은 좌측 컬럼 안이 아니라 li 그리드의 직접 자식이라 col-span-full 로 이미지
 * 칸까지 덮는다 — 자식 순서가 [좌, 이미지, 패널]이어야 이미지가 1행에 남는다(패널을
 * 가운데 끼우면 자동 배치가 이미지를 다음 행으로 밀어낸다).
 */
function LabRow({
  lab,
  image,
  index,
  summary,
}: {
  lab: LabDirectoryEntry;
  /** 연구실 이미지(없으면 호출부가 더미를 골라 넘긴다) */
  image: string;
  /** 스태거 지연 계산용 목록 내 순번 */
  index: number;
  /** 로케일 해석이 끝난 AI 요약문. 없으면 버튼 자체를 그리지 않는다. */
  summary?: string;
}) {
  const t = useTranslations('research');
  const locale = useLocale();
  // 훅은 조건부로 부를 수 없으므로 요약문이 없어도 호출한다(빈 문자열 = 열 일이 없음)
  const ai = useAiSummaryTyping(summary ?? '');
  const desc = lab.description ? (locale === 'ko' ? lab.description.ko : lab.description.en) : null;

  return (
    <li
      className="anim-nav-item grid gap-5 border-b border-surface-border py-7 last:border-b-0 md:grid-cols-[minmax(0,1fr)_15rem] md:gap-10"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      {/* 좌: 이름·영문·(소개)·라벨 메타·액션 */}
      <div className="flex min-w-0 flex-col items-start">
        <h3 className="text-xl font-bold leading-snug tracking-tight text-content sm:text-2xl">
          {lab.url ? (
            <a
              href={lab.url}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-yonsei-blue"
            >
              {lab.nameKo}
            </a>
          ) : (
            lab.nameKo
          )}
        </h3>
        <p className="mt-1 text-xs font-medium tracking-wide text-content-faint">{lab.nameEn}</p>

        {lab.internRecruiting && (
          <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t('intern.badge')}
            {lab.internCount ? (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                · {t('intern.count', { n: lab.internCount })}
              </span>
            ) : null}
          </span>
        )}

        {/* 소개 문단 — labs-directory.json description 이 있을 때만 */}
        {desc && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-content-soft">{desc}</p>}

        {/* 라벨 메타 — 레퍼런스의 2열 라벨 그리드(지도교수/분야/위치/연락처) */}
        <dl className="mt-4 grid w-full max-w-xl grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-x-6">
          <dt className="font-bold text-content">{t('labMeta.professor')}</dt>
          <dd className="min-w-0 text-content-soft">
            {lab.professorKo}
            {lab.professorEn && (
              <span className="ml-1.5 text-xs text-content-faint">{lab.professorEn}</span>
            )}
          </dd>
          <dt className="font-bold text-content">{t('labMeta.field')}</dt>
          <dd className="min-w-0 text-content-soft">{t(`fieldFilter.${lab.field}`)}</dd>
          <dt className="font-bold text-content">{t('labMeta.location')}</dt>
          <dd className="min-w-0 text-content-soft">{lab.location}</dd>
          {lab.phone ? (
            <>
              <dt className="font-bold text-content">{t('labMeta.phone')}</dt>
              <dd className="min-w-0 text-content-soft">{lab.phone}</dd>
            </>
          ) : null}
        </dl>

        {/* 액션 — 시안 순서대로 'AI 연구요약'이 먼저, '바로가기 ↗' 보더 버튼이 다음.
            aria-label 로 연구실명을 붙여 목록의 버튼들을 스크린리더에서 구분한다. */}
        {(summary || lab.url) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {summary && (
              <AiSummaryToggle
                open={ai.open}
                onToggle={ai.toggle}
                panelId={ai.panelId}
                label={t('labAi.button')}
                ariaLabel={`${lab.nameKo} ${t('labAi.button')}`}
                size="sm"
              />
            )}
            {lab.url && (
              <a
                href={lab.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${lab.nameKo} ${t('labVisit')}`}
                className="inline-flex items-center gap-2 border border-surface-border px-4 py-2 text-xs font-bold text-content transition-colors hover:border-yonsei-blue hover:bg-yonsei-blue hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
              >
                {t('labVisit')}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  className="h-3 w-3"
                >
                  <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
          </div>
        )}
      </div>

      {/* 우: 연구실 이미지(없으면 더미 순환) — 레퍼런스 우측 박스, 높이 축소판.
          모바일은 16:10 전폭 이미지가 화면을 지배해 96px 슬림 배너로 캡(시안 1b). */}
      <div className="relative h-24 w-full overflow-hidden bg-surface-soft md:h-40 md:self-center">
        <Image src={image} alt="" fill sizes="(min-width: 768px) 240px, 100vw" className="object-cover" />
      </div>

      {/* AI 요약 패널 — 행 전폭(grid-column: 1 / -1). md:gap-10 이 세로에도 걸려 버튼과
          너무 떨어져 보이므로 모바일 간격(1.25rem)만큼만 남기고 끌어올린다. */}
      {summary && ai.open && (
        <AiSummaryPanel
          panelId={ai.panelId}
          text={summary.slice(0, ai.typed)}
          done={ai.done}
          panelLabel={t('labAi.panelLabel')}
          betaLabel={t('labAi.beta')}
          disclaimer={t('labAi.disclaimer')}
          className="col-span-full w-full md:-mt-5"
        />
      )}
    </li>
  );
}

/**
 * 연구실 목록 — 나열식 표를 버리고 연구실별 특색이 드러나는 에디토리얼 행으로 개편.
 *
 * 구성: [분야 필터 탭(활성 위·아래 바)] → [특정 분야 선택 시 분야 인트로: 제목 +
 * 설명 패널 + 대표 이미지 배너(fieldIntros, research-gallery.json 재사용)] →
 * [연구실 행: 좌 = 큰 이름·영문·(소개문단)·라벨 메타(지도교수/분야/위치/연락처)·
 * AI 연구요약·바로가기 버튼 / 우 = 연구실 이미지(없으면 더미 3장 순환) /
 * 요약을 열면 행 전폭 패널].
 * 소개문단은 labs-directory.json 의 description(옵션) — 채우는 즉시 표시된다.
 *
 * 기존 기능 유지: ?field= 딥링크 초기 필터, 검색(연구실·교수명), 학부 인턴 필터·배지,
 * 필터 전환 시 스태거 재생(key), 빈 상태.
 */
export function LabList({
  items,
  fieldIntros = [],
  summaries = {},
}: {
  items: LabDirectoryEntry[];
  fieldIntros?: LabFieldIntro[];
  /** AI 연구요약 — 지도교수 한글 이름 → 로케일 해석이 끝난 문장(서버에서 주입).
   *  한/영 양쪽을 클라이언트 번들에 싣지 않으려고 페이지가 한쪽만 골라 넘긴다. */
  summaries?: Record<string, string>;
}) {
  const t = useTranslations('research');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [internOnly, setInternOnly] = useState(false);

  // 홈 히어로 분야 목록(더블클릭·화살표)에서 /research/labs?field=<분야> 로 진입 시 해당 분야로 초기 필터.
  // (정적 페이지 유지를 위해 useSearchParams 대신 window 로 읽는다.)
  useEffect(() => {
    const field = new URLSearchParams(window.location.search).get('field');
    if (field && (FIELDS as string[]).includes(field)) {
      setFilter(field as ResearchField);
    }
  }, []);

  const counts = useMemo(() => {
    const map = { all: items.length } as Record<Filter, number>;
    for (const field of FIELDS) map[field] = 0;
    for (const lab of items) map[lab.field] += 1;
    return map;
  }, [items]);

  // 학부 인턴 모집 중인 연구실 수 (상단 필터 노출·배지 카운트용)
  const internTotal = useMemo(() => items.filter((lab) => lab.internRecruiting).length, [items]);

  // 분야 필터 + 인턴 모집 필터 + 검색어(연구실명·교수명 한/영, 대소문자 무시) AND 결합
  const visible = useMemo(() => {
    let list = filter === 'all' ? items : items.filter((lab) => lab.field === filter);
    if (internOnly) list = list.filter((lab) => lab.internRecruiting);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((lab) =>
      [lab.nameKo, lab.nameEn, lab.professorKo, lab.professorEn]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [items, filter, query, internOnly]);

  const intro = filter === 'all' ? null : fieldIntros.find((g) => g.field === filter) ?? null;

  return (
    <div>
      {/* 분야 필터 — 활성 항목 위·아래 굵은 바(레퍼런스 디자인) */}
      <div className="mb-8">
        <FieldBarTabs
          active={filter}
          onChange={(id) => setFilter(id as Filter)}
          ariaLabel="연구실 분야 필터"
          tabs={(['all', ...FIELDS] as Filter[]).map((id) => ({
            id,
            label: t(`fieldFilter.${id}`),
            count: counts[id],
          }))}
        />
      </div>

      {/* 분야 인트로 — 특정 분야 선택 시: 분야명 + 설명(텍스트만, 박스·이미지 없이 —
          사용자 지시). ⚠️ key 는 목록 ul(key=list-*)과 형제 레벨 — 접두사로 충돌을
          막는다(동일 키였을 때 React 가 intro 제거를 누락하는 버그가 실제 발생). */}
      {intro && (
        <div key={`intro-${intro.field}`} className="anim-panel mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-content-faint">
            {t('fieldIntroLabel')}
          </p>
          <h3 className="mt-2 text-2xl font-bold tracking-tight text-content sm:text-3xl">
            {intro.title}
          </h3>
          <p className="mt-4 max-w-3xl text-base leading-[1.8] text-content-soft">
            {intro.description}
          </p>
        </div>
      )}

      {/* 연구실 검색(좌) + 학부 인턴 모집 필터(우) — 모바일도 한 줄.
          전폭 검색창 아래 전폭 필터를 쌓으면 검색 바가 아니라 폼처럼 읽힌다. */}
      <div className="mb-2 flex items-center gap-2 sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1 sm:w-72 sm:flex-none">
          <label htmlFor="lab-search" className="sr-only">
            {t('search.labs')}
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-content-faint"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" strokeLinecap="round" />
              </svg>
            </span>
            <input
              id="lab-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search.labs')}
              className="w-full border border-surface-border bg-surface py-2 pl-9 pr-3 text-sm text-content transition-colors placeholder:text-content-faint focus:border-yonsei-blue focus:outline-none"
            />
          </div>
        </div>

        {/* 학부 인턴 모집 중인 연구실만 보기 — 모집 연구실이 있을 때만 노출 */}
        {internTotal > 0 && (
          <label
            className={cn(
              'inline-flex shrink-0 cursor-pointer select-none items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-emerald-500/40',
              internOnly
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'border-surface-border text-content-soft hover:border-emerald-500/60 hover:text-content',
            )}
          >
            <input
              type="checkbox"
              checked={internOnly}
              onChange={(e) => setInternOnly(e.target.checked)}
              className="h-4 w-4 accent-emerald-600"
            />
            {t('intern.filter')}
            <span
              className={cn(
                'text-xs font-medium tabular-nums',
                internOnly ? 'text-emerald-700 dark:text-emerald-300' : 'text-content-faint',
              )}
            >
              {internTotal}
            </span>
          </label>
        )}
      </div>

      {visible.length === 0 ? (
        /* 검색 결과 없음 — CourseCatalog 와 같은 독수리 빈 상태 */
        <div className="mt-6 flex flex-col items-center gap-5 rounded-card border border-surface-border bg-surface-soft px-6 py-20 text-center">
          <span aria-hidden="true" className="eagle-mask h-20 w-20 bg-yonsei-blue/35" />
          <p className="max-w-sm text-content-soft">{t('search.empty')}</p>
        </div>
      ) : (
        /* key 로 필터 전환 시 행들을 리마운트해 스태거 등장을 재트리거한다. */
        <ul key={`list-${filter}`}>
          {visible.map((lab, i) => (
            <LabRow
              key={lab.nameKo}
              lab={lab}
              image={lab.image ?? FALLBACK_IMAGES[i % FALLBACK_IMAGES.length]}
              index={i}
              summary={summaries[lab.professorKo]}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
