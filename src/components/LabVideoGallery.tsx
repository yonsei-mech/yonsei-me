'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { FieldBarTabs } from '@/components/FieldBarTabs';
import { LabBrochureEntry, useLabBrochureViewer } from '@/components/LabBrochure';
import { cn } from '@/lib/utils';
import { RESEARCH_FIELDS, type ResearchField } from '@/lib/research-fields';
import { isVideoFileUrl } from '@/lib/video-url';
import type { LabDirectoryEntry } from '@/lib/faculty';
import type { LabBrochure } from '@/lib/lab-brochure';
import type { Locale } from '@/i18n/routing';

/**
 * 연구실 소개 영상 갤러리 — 대학원 "연구실 소개 자료 및 영상" 탭.
 * YouTube / Google Drive 링크와 **직접 올린 영상 파일**을 파사드(썸네일+재생 오버레이)
 * 카드로 보여주고, 재생 버튼 클릭 시 심플한 풀스크린 라이트박스에서 크게 재생한다
 * (링크는 iframe, 파일은 네이티브 <video>).
 * (라이트박스는 createPortal 로 body 직속 렌더 — 탭 패널의 anim-panel 이 남기는
 *  transform 이 fixed 의 기준을 가로채 오버레이가 그리드 안에 갇히는 문제 방지.)
 * 데이터는 content/labs-directory.json → getLabsDirectory() 를 통해 주입받는다.
 * 탭 이름의 "소개 자료" 쪽은 연구실 소개자료(구 사이트 PDF) 모아보기 띠 + 카드별
 * "소개자료" 링크가 맡는다(@/components/LabBrochure — /research/labs 와 같은 뷰어).
 */

/** 영상 제공처 구분 — 배지 라벨과 재생 방식(iframe/video)이 서로 다르다 */
type VideoSource = 'youtube' | 'drive' | 'file';

interface ParsedVideo {
  source: VideoSource;
  /** 파사드에 깔 정지 썸네일. 업로드 파일은 포스터가 없을 수 있다(대표 이미지로 폴백) */
  thumbnail?: string;
  /** 재생 시 삽입할 주소 — 링크는 iframe src(autoplay 포함), 파일은 video src */
  embed: string;
}

/**
 * 영상 URL을 썸네일/재생 주소로 파싱한다. 순수 함수 — 서버·클라이언트 어디서 불러도 동일.
 * 업로드 영상 파일 · YouTube watch 링크 · Google Drive file 링크 세 형태를 다루며,
 * 그 외/파싱 실패 시 null. poster 는 업로드 파일에서만 의미가 있다.
 */
function parseVideo(url: string | undefined, poster?: string): ParsedVideo | null {
  if (!url) return null;

  // 업로드한 영상 파일이 먼저다 — 파일명에 v= 같은 문자열이 섞여도 링크로 오인하지 않는다
  if (isVideoFileUrl(url)) {
    return { source: 'file', thumbnail: poster || undefined, embed: url };
  }

  // YouTube: watch?v=<ID> — 임베드는 autoplay/rel=0 로 관련영상 노출을 줄인다
  const yt = url.match(/[?&]v=([\w-]+)/);
  if (yt) {
    const id = yt[1];
    return {
      source: 'youtube',
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      embed: `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`,
    };
  }

  // Google Drive: /file/d/<ID>/view — 썸네일은 thumbnail 엔드포인트, 임베드는 preview
  const drive = url.match(/\/file\/d\/([\w-]+)/);
  if (drive) {
    const id = drive[1];
    return {
      source: 'drive',
      thumbnail: `https://drive.google.com/thumbnail?id=${id}&sz=w800`,
      embed: `https://drive.google.com/file/d/${id}/preview`,
    };
  }

  return null;
}

/** 라이트박스로 재생 중인 영상 — trigger 는 닫을 때 포커스 복귀 대상 */
interface ActiveVideo {
  lab: LabDirectoryEntry;
  parsed: ParsedVideo;
  trigger: HTMLElement;
}

/** 필터 상태 — 연구실 목록(/research/labs)과 같은 6분야 탭. 기본은 "전체" */
type Filter = 'all' | ResearchField;

const PAGE_SIZE = 9;

export function LabVideoGallery({
  items,
  locale,
  brochure,
}: {
  items: LabDirectoryEntry[];
  locale: Locale;
  /** 연구실 소개자료(서버에서 로케일 해석·조인 완료). 없으면 모아보기 띠·카드 링크를 그리지 않는다. */
  brochure?: LabBrochure;
}) {
  const ko = locale === 'ko';
  const t = useTranslations('research');
  // 모아보기 띠와 카드마다의 "소개자료" 링크가 같은 뷰어 하나를 연다(LabList 와 같은 구성)
  const brochureViewer = useLabBrochureViewer(brochure);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<ActiveVideo | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // 요약 줄 숫자 — 하드코딩하지 않고 items에서 계산 (데이터가 늘면 자동 반영)
  const totalLabs = items.length;
  const videoCount = useMemo(() => items.filter((l) => l.video).length, [items]);

  // 분야 탭에 붙는 개수 배지 — "전체"는 총 연구실 수, 나머지는 분야별 연구실 수
  const counts = useMemo(() => {
    const map = { all: items.length } as Record<Filter, number>;
    for (const field of RESEARCH_FIELDS) map[field] = 0;
    for (const lab of items) map[lab.field] += 1;
    return map;
  }, [items]);

  // 분야별 표시 목록. 영상 갤러리라 어느 분야에서든 영상 보유 연구실을 앞으로 모으되
  // (그 안에선 원본 순서 유지), 안정 정렬을 위해 원본 인덱스를 부여해 정렬한다.
  const visible = useMemo(() => {
    const list = filter === 'all' ? items : items.filter((l) => l.field === filter);
    return list
      .map((lab, idx) => ({ lab, idx }))
      .sort((a, b) => {
        const av = a.lab.video ? 0 : 1;
        const bv = b.lab.video ? 0 : 1;
        return av - bv || a.idx - b.idx;
      })
      .map((x) => x.lab);
  }, [items, filter]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pageCount); // 필터 변경 등으로 페이지가 범위를 벗어나면 보정
  const pageItems = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  /** reduced-motion 사용자에겐 부드러운 스크롤을 끈다 */
  function scrollToGrid() {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    gridRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  function changeFilter(next: Filter) {
    if (next === filter) return;
    setFilter(next);
    setPage(1); // 필터를 바꾸면 항상 1페이지로 리셋
  }

  function changePage(next: number) {
    const clamped = Math.min(Math.max(1, next), pageCount);
    setPage(clamped);
    scrollToGrid();
  }

  return (
    <div className="space-y-8">
      {/* 요약 줄 — 연구실 N곳 · 소개 영상 M편 */}
      <p className="text-sm text-content-soft">
        {ko ? (
          <>
            연구실 <span className="font-semibold text-content">{totalLabs}곳</span>
            <span className="mx-2 text-content-faint">·</span>
            소개 영상 <span className="font-semibold text-yonsei-blue">{videoCount}편</span>
          </>
        ) : (
          <>
            <span className="font-semibold text-content">{totalLabs} labs</span>
            <span className="mx-2 text-content-faint">·</span>
            <span className="font-semibold text-yonsei-blue">{videoCount} intro videos</span>
          </>
        )}
      </p>

      {/* 연구실 소개자료 모아보기 — 영상과 짝을 이루는 "소개 자료" 쪽 입구(탭 이름 그대로) */}
      {brochure && <LabBrochureEntry brochure={brochure} onOpen={brochureViewer.open} />}

      {/* 분야 필터 — 연구실 목록(/research/labs)과 같은 6분야 탭을 공유한다 */}
      <FieldBarTabs
        active={filter}
        onChange={(id) => changeFilter(id as Filter)}
        ariaLabel={ko ? '연구실 분야 필터' : 'Research field filter'}
        tabs={(['all', ...RESEARCH_FIELDS] as Filter[]).map((id) => ({
          id,
          label: t(`fieldFilter.${id}`),
          count: counts[id],
        }))}
      />

      {/* 카드 그리드 — key로 필터·페이지 전환 시 진입 애니메이션 재생 */}
      <div
        ref={gridRef}
        key={`${filter}-${current}`}
        className="anim-panel grid gap-6 sm:grid-cols-2 xl:grid-cols-3"
      >
        {pageItems.map((lab, i) => {
          const brochureIndex = brochureViewer.indexOf(lab.professorKo);
          return (
            <LabVideoCard
              key={lab.nameKo + lab.professorKo}
              lab={lab}
              locale={locale}
              index={i}
              onPlay={setActive}
              onOpenBrochure={
                brochureIndex === undefined
                  ? undefined
                  : (trigger) => brochureViewer.open(brochureIndex, trigger)
              }
            />
          );
        })}
      </div>

      {/* 페이지네이션 */}
      {pageCount > 1 && (
        <nav aria-label={ko ? '페이지 목록' : 'Pagination'} className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => changePage(current - 1)}
            disabled={current === 1}
            className="border border-surface-border px-3 py-1.5 text-sm text-content-soft transition-colors hover:text-yonsei-navy disabled:cursor-not-allowed disabled:opacity-40"
          >
            {ko ? '이전' : 'Prev'}
          </button>
          {Array.from({ length: pageCount }, (_, idx) => idx + 1).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => changePage(p)}
              aria-current={p === current ? 'page' : undefined}
              aria-label={ko ? `${p}페이지` : `Page ${p}`}
              className={cn(
                'min-w-[2.5rem] border px-3 py-1.5 text-sm font-semibold tabular-nums transition-colors',
                p === current
                  ? 'border-yonsei-navy bg-yonsei-navy text-white'
                  : 'border-surface-border text-content-soft hover:text-yonsei-navy',
              )}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            onClick={() => changePage(current + 1)}
            disabled={current === pageCount}
            className="border border-surface-border px-3 py-1.5 text-sm text-content-soft transition-colors hover:text-yonsei-navy disabled:cursor-not-allowed disabled:opacity-40"
          >
            {ko ? '다음' : 'Next'}
          </button>
        </nav>
      )}

      {/* 풀스크린 재생 라이트박스 — 열려 있는 동안만 마운트 */}
      {active && <VideoLightbox active={active} locale={locale} onClose={() => setActive(null)} />}

      {/* 소개자료 뷰어 — 열려 있을 때만 body 포털로 뜬다 */}
      {brochureViewer.viewer}
    </div>
  );
}

/**
 * 개별 연구실 카드. 영상이 있으면 파사드(썸네일+재생 버튼) → 클릭 시 풀스크린
 * 라이트박스에서 크게 재생, 없으면 대표 이미지 + "영상 준비 중" 배지.
 * index는 진입 애니메이션 지연(anim-nav-item) 계산에 쓴다.
 */
function LabVideoCard({
  lab,
  locale,
  index,
  onPlay,
  onOpenBrochure,
}: {
  lab: LabDirectoryEntry;
  locale: Locale;
  index: number;
  onPlay: (a: ActiveVideo) => void;
  /** 소개자료에서 이 연구실 쪽을 여는 콜백. 쪽이 없는 연구실이면 링크를 그리지 않는다. */
  onOpenBrochure?: (trigger: HTMLElement) => void;
}) {
  const ko = locale === 'ko';
  const t = useTranslations('research');
  const parsed = parseVideo(lab.video, lab.videoPoster);
  // 썸네일 로드 실패 시 lab.image로, 그것도 없으면 그라디언트 배경으로 폴백
  const [thumbFailed, setThumbFailed] = useState(false);

  // 이름은 현재 로케일 우선, 비어 있으면 반대 언어로 폴백
  const name = ko ? lab.nameKo || lab.nameEn : lab.nameEn || lab.nameKo;
  const professor = ko ? `${lab.professorKo} 교수` : lab.professorEn;

  const sourceLabel =
    parsed?.source === 'youtube'
      ? 'YouTube'
      : parsed?.source === 'file'
        ? ko
          ? '영상'
          : 'Video'
        : 'Drive';
  // 업로드 영상은 포스터가 없을 수 있다 — 그땐 대표 이미지가 파사드를 맡는다
  const thumbSrc = parsed?.thumbnail && !thumbFailed ? parsed.thumbnail : lab.image;

  return (
    // 진입 애니메이션(fill: forwards)이 transform을 점유해 hover 리프트를 막지 않도록
    // 애니메이션은 바깥 래퍼, hover transform은 안쪽 article로 분리한다.
    <div className="anim-nav-item" style={{ animationDelay: `${(index % PAGE_SIZE) * 60}ms` }}>
    <article
      className="overflow-hidden rounded-card border border-surface-border bg-surface shadow-card transition hover:-translate-y-1 hover:shadow-lg"
    >
      {/* 미디어 영역 16:9 */}
      <div className="relative aspect-video w-full overflow-hidden bg-surface-soft">
        {parsed ? (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={(e) =>
              onPlay({ lab, parsed, trigger: e.currentTarget })
            }
            aria-label={ko ? `${name} 소개 영상 크게 재생` : `Play ${name} intro video`}
            className="group relative block h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-yonsei-blue"
          >
            {thumbSrc ? (
              <img
                src={thumbSrc}
                alt={name}
                loading="lazy"
                onError={() => setThumbFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              // 썸네일도 대표 이미지도 없을 때 최종 폴백
              <span aria-hidden="true" className="anim-gradient absolute inset-0 block" />
            )}

            {/* 중앙 재생 버튼 오버레이 */}
            <span
              aria-hidden="true"
              className="absolute inset-0 grid place-items-center"
            >
              <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-yonsei-navy to-yonsei-blue shadow-lg transition-transform group-hover:scale-110">
                <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-6 w-6 text-white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>

            {/* 우상단 출처 배지 */}
            <span className="absolute right-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">
              {sourceLabel}
            </span>
          </button>
        ) : (
          // 영상 미보유 카드 — 대표 이미지 + "영상 준비 중" 배지
          <>
            {lab.image ? (
              <img
                src={lab.image}
                alt={name}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <span aria-hidden="true" className="anim-gradient absolute inset-0 block" />
            )}
            <span className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-1.5 text-center text-xs font-medium text-white">
              {ko ? '영상 준비 중' : 'Video coming soon'}
            </span>
          </>
        )}
      </div>

      {/* 본문 */}
      <div className="space-y-1.5 p-5">
        <h3 className="text-base font-bold leading-snug text-content">{name}</h3>
        <p className="text-sm text-content-soft">{professor}</p>
        <p className="text-xs text-content-faint">{lab.location}</p>
        {/* 카드 하단 링크 줄 — [소개자료] · [홈페이지 ↗]. 소개자료는 페이지 이동이 아니라
            뷰어를 여는 버튼이지만, 줄 안에서 한 묶음으로 읽히도록 링크와 같은 모양으로 둔다. */}
        {(onOpenBrochure || lab.url) && (
          <div className="flex flex-wrap items-center pt-1 text-sm">
            {onOpenBrochure && (
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={t('brochure.labButtonAria', { lab: name })}
                onClick={(e) => onOpenBrochure(e.currentTarget)}
                className="font-medium text-yonsei-blue underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
              >
                {t('brochure.labButton')}
              </button>
            )}
            {onOpenBrochure && lab.url && (
              <span aria-hidden="true" className="mx-2 text-content-faint">
                ·
              </span>
            )}
            {lab.url && (
              <a
                href={lab.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-yonsei-blue underline-offset-2 hover:underline"
              >
                {ko ? '홈페이지 ↗' : 'Website ↗'}
              </a>
            )}
          </div>
        )}
      </div>
    </article>
    </div>
  );
}

/**
 * 심플 풀스크린 라이트박스 — 어두운 배경 위에 큰 16:9 영상 하나.
 * 닫기: 우상단 ✕ / 배경 아무 데나 클릭 / ESC. 애니메이션 없음.
 * body 직속 포털이라 조상 transform(anim-panel 등)의 영향을 받지 않는다.
 */
function VideoLightbox({
  active,
  locale,
  onClose,
}: {
  active: ActiveVideo;
  locale: Locale;
  onClose: () => void;
}) {
  const ko = locale === 'ko';
  const { lab, parsed } = active;
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const name = ko ? lab.nameKo || lab.nameEn : lab.nameEn || lab.nameKo;
  const professor = ko ? `${lab.professorKo} 교수` : lab.professorEn;

  // 열려 있는 동안: 배경 스크롤 잠금 + ESC 닫기 + 닫기 버튼 포커스,
  // 닫힐 때 포커스를 원래 재생 버튼으로 복귀
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus({ preventScroll: true });

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      active.trigger.focus({ preventScroll: true });
    };
    // active/onClose 는 마운트 단위로 고정(닫히면 언마운트)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    // 배경 아무 데나 클릭해도 닫힌다 — 영상·캡션 영역만 전파 차단
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a1c3d]/95 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={ko ? `${name} 소개 영상` : `${name} intro video`}
      onClick={onClose}
    >
      {/* 우상단 ✕ — 크고 확실한 닫기 버튼 */}
      <button
        ref={closeBtnRef}
        type="button"
        onClick={onClose}
        aria-label={ko ? '영상 닫기' : 'Close video'}
        className="absolute right-4 top-4 z-10 grid h-12 w-12 place-items-center border border-white/40 bg-white/10 text-white transition-colors hover:border-white hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:right-6 sm:top-6"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>

      {/* 영상 + 캡션 — 폭은 화면과 세로 여백 안에서 최대한 크게 */}
      <div
        className="w-full max-w-[min(76rem,calc((100svh_-_9rem)*16/9))]"
        onClick={(e) => e.stopPropagation()}
      >
        {parsed.source === 'file' ? (
          // 업로드 파일은 임베드가 아니라 브라우저 기본 플레이어로 바로 재생한다.
          // preload="metadata" 라 라이트박스를 열기 전까지는 본문을 내려받지 않는다.
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={parsed.embed}
            poster={parsed.thumbnail}
            controls
            autoPlay
            playsInline
            preload="metadata"
            aria-label={name}
            className="aspect-video w-full bg-black shadow-2xl"
          />
        ) : (
          <iframe
            title={name}
            src={parsed.embed}
            allow="autoplay; fullscreen"
            allowFullScreen
            className="aspect-video w-full bg-black shadow-2xl"
          />
        )}
        {/* 한 줄 캡션 — 연구실명 · 교수, 우측에 홈페이지 링크 */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <p className="text-sm text-white/85 sm:text-base">
            <span className="font-bold text-white">{name}</span>
            <span className="mx-2 text-white/40">·</span>
            {professor}
          </p>
          {lab.url && (
            <a
              href={lab.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-white/85 underline-offset-4 hover:text-white hover:underline"
            >
              {ko ? '연구실 홈페이지 ↗' : 'Lab website ↗'}
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
