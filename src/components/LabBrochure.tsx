'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  BROCHURE_IMAGE_HEIGHT,
  BROCHURE_IMAGE_WIDTH,
  BROCHURE_THUMB_HEIGHT,
  BROCHURE_THUMB_WIDTH,
  brochureIndexByProfessor,
  type LabBrochure,
  type LabBrochureSlide,
} from '@/lib/lab-brochure';

/**
 * 연구실 소개자료 — 구 사이트 사이드바의 "연구실 소개자료"(35쪽 PDF) 버튼을 되살리되,
 * 떨어진 PDF 링크가 아니라 연구실 화면 안에 녹인다.
 *  - LabBrochureEntry  : 연구실 페이지 상단의 "모아보기" 띠(표지 썸네일 + 설명 + 버튼)
 *  - LabBrochureButton : 연구실 행마다 붙는 "소개자료" 버튼 — 그 연구실 쪽을 바로 연다
 *  - LabBrochureViewer : 둘이 함께 여는 전체 화면 뷰어(표지 + 연구실 33쪽, 필름스트립)
 *  - useLabBrochureViewer : 뷰어 열림 상태를 목록 컴포넌트가 들고 있게 하는 훅
 *
 * 이미지는 원본 PDF 를 쪽 단위로 미리 렌더한 WebP 다(서버에서 로케일 해석까지 끝낸
 * LabBrochure 를 prop 으로 받는다 — @/lib/lab-brochure). next/image 를 쓰지 않는 이유:
 * 이미 목표 크기로 인코딩된 정적 파일이라 서버 재인코딩(1 vCPU 에서 느림)이 이득이 없고,
 * 뷰어는 확대 시 원본 픽셀(1740px)을 그대로 보여 줘야 한다.
 */

/** 포스터 가로:세로 비 — 870×630pt(이미지 1740×1260) */
const RATIO = BROCHURE_IMAGE_WIDTH / BROCHURE_IMAGE_HEIGHT;
/** 확대 배율이 이보다 작으면 확대가 의미 없어 토글을 숨긴다(큰 화면에선 맞춤 크기가 이미 원본에 가깝다) */
const MIN_ZOOM_GAIN = 1.2;
/** 스와이프로 넘기는 최소 가로 이동(px) */
const SWIPE_PX = 40;

/** 겹친 두 장 — "여러 쪽짜리 문서"를 뜻하는 표식(모서리 각지게: 사이트 규칙) */
function PagesIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="miter"
      className={className}
    >
      <path d="M8 3h12v14" />
      <rect x="4" y="7" width="12" height="14" />
      <path d="M7.5 12h5M7.5 15.5h5" strokeLinecap="square" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 표지는 "표지", 연구실은 "연구실명 · 교수" — 썸네일 aria-label·안내 문구에 공통으로 쓴다 */
function slideLabel(slide: LabBrochureSlide, coverLabel: string): string {
  if (slide.kind === 'cover') return coverLabel;
  return [slide.labName, slide.professor].filter(Boolean).join(' · ');
}

/* ─────────────────────────── 모아보기 띠 ─────────────────────────── */

/**
 * 연구실 페이지 맨 위 "모아보기" 띠. 표지 썸네일(뒤에 한 장 어긋나게 비친 종이로 "묶음"을
 * 표현 — 그림자 대신 헤어라인만), 설명 3줄, 모아보기 버튼(+ PDF 원본 링크).
 * 썸네일과 버튼 모두 뷰어를 표지(0)에서 연다.
 */
export function LabBrochureEntry({
  brochure,
  onOpen,
  className,
}: {
  brochure: LabBrochure;
  onOpen: (index: number, trigger: HTMLElement) => void;
  className?: string;
}) {
  const t = useTranslations('research');
  const cover = brochure.slides[0];

  return (
    <section
      aria-label={t('brochure.eyebrow')}
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-3 border border-surface-border bg-surface-soft p-3 sm:flex-nowrap sm:gap-x-6 sm:p-4',
        className,
      )}
    >
      {/* 표지 썸네일 — 뒤 종이가 4px 어긋나 비치므로 그만큼 오른쪽·아래 여백을 둔다 */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${t('brochure.open')} — ${t('brochure.coverAlt', { title: brochure.title })}`}
        onClick={(e) => onOpen(0, e.currentTarget)}
        className="group relative mb-1 mr-1 w-24 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-yonsei-blue sm:w-32"
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 translate-x-1 translate-y-1 border border-surface-border bg-surface"
        />
        <span className="relative block aspect-[870/630] overflow-hidden border border-surface-border bg-surface transition-colors group-hover:border-yonsei-blue">
          {/* eslint-disable-next-line @next/next/no-img-element -- 미리 렌더한 정적 썸네일(상단 주석) */}
          <img
            src={cover.thumb}
            alt=""
            width={BROCHURE_THUMB_WIDTH}
            height={BROCHURE_THUMB_HEIGHT}
            decoding="async"
            className="block h-full w-full object-cover"
          />
        </span>
      </button>

      {/* 눈썹·제목은 Paperlogy(--font-subhead) — 사이트 소제목 서체. 메타 줄은 본문 sans 그대로 */}
      <div className="min-w-0 flex-1">
        <p className="font-subhead text-xs font-bold tracking-[0.18em] text-yonsei-blue">{t('brochure.eyebrow')}</p>
        <p className="mt-1 font-subhead text-base font-bold leading-snug text-content sm:text-lg">
          {t('brochure.title', { count: brochure.labCount })}
        </p>
        {/* 가운뎃점 앞을 줄바꿈 금지 공백으로 — 좁은 화면에서 줄이 "· 35쪽" 처럼 점으로 시작하지 않게 */}
        <p className="mt-1 text-xs text-content-faint">
          {t('brochure.meta', {
            title: brochure.title,
            publisher: brochure.publisher,
            pages: brochure.pageCount,
          }).replace(/ · /g, ' · ')}
        </p>
      </div>

      {/* 액션 — sm 이상은 띠 오른쪽 끝, 모바일은 아래 전폭 줄로 내려간다(flex-wrap) */}
      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 sm:w-auto sm:shrink-0 sm:flex-nowrap">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={(e) => onOpen(0, e.currentTarget)}
          className="inline-flex items-center gap-2 bg-yonsei-navy px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-yonsei-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
        >
          <PagesIcon className="h-4 w-4" />
          {t('brochure.open')}
        </button>
        {brochure.pdfUrl && (
          <a
            href={brochure.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-content-soft underline-offset-2 transition-colors hover:text-yonsei-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
          >
            {t('brochure.pdf', { size: brochure.pdfSize })}
            <DownloadIcon className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </section>
  );
}

/* ─────────────────────────── 연구실별 버튼 ─────────────────────────── */

/**
 * 연구실 행의 "소개자료" 버튼 — LabRow 의 보더 버튼("바로가기")과 같은 모양.
 * 목록에 같은 라벨 버튼이 수십 개라 aria-label 에 연구실명을 붙여 구분한다.
 */
export function LabBrochureButton({
  labName,
  onOpen,
}: {
  labName: string;
  onOpen: (trigger: HTMLElement) => void;
}) {
  const t = useTranslations('research');
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={t('brochure.labButtonAria', { lab: labName })}
      onClick={(e) => onOpen(e.currentTarget)}
      className="inline-flex items-center gap-2 border border-surface-border px-4 py-2 text-xs font-bold text-content transition-colors hover:border-yonsei-blue hover:bg-yonsei-blue hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
    >
      <PagesIcon className="h-3.5 w-3.5" />
      {t('brochure.labButton')}
    </button>
  );
}

/* ─────────────────────────── 열림 상태 훅 ─────────────────────────── */

/**
 * 뷰어 열림 상태({index, trigger} | null)를 목록 컴포넌트(LabList·LabVideoGallery)가 들게 한다.
 * 연구실 행 버튼과 모아보기 띠가 같은 뷰어 하나를 공유해야 해서 상태를 목록 쪽으로 올렸다.
 * brochure 가 없으면(prop 미전달) 모든 값이 비어 있어 호출부가 조건 없이 써도 된다.
 */
export function useLabBrochureViewer(brochure: LabBrochure | undefined): {
  /** 지도교수 한글 이름 → 슬라이드 인덱스. 쪽이 없는 연구실은 undefined */
  indexOf: (professorKo: string) => number | undefined;
  open: (index: number, trigger: HTMLElement | null) => void;
  /** 열려 있을 때만 뷰어 노드, 아니면 null — 목록 JSX 어디든 한 번 렌더하면 된다(포털) */
  viewer: ReactNode;
} {
  const [state, setState] = useState<{ index: number; trigger: HTMLElement | null } | null>(null);
  const indexMap = useMemo(() => (brochure ? brochureIndexByProfessor(brochure) : null), [brochure]);

  const indexOf = useCallback((professorKo: string) => indexMap?.get(professorKo), [indexMap]);
  const open = useCallback((index: number, trigger: HTMLElement | null) => setState({ index, trigger }), []);
  const onIndexChange = useCallback((index: number) => setState((s) => (s ? { ...s, index } : s)), []);
  const onClose = useCallback(() => setState(null), []);

  const viewer =
    brochure && state ? (
      <LabBrochureViewer
        brochure={brochure}
        index={state.index}
        onIndexChange={onIndexChange}
        onClose={onClose}
        trigger={state.trigger}
      />
    ) : null;

  return { indexOf, open, viewer };
}

/* ─────────────────────────── 전체 화면 뷰어 ─────────────────────────── */

/** 포커스 트랩 대상. 로빙 tabindex(-1) 로 빠진 썸네일은 아래에서 다시 거른다 */
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 확대 시 "클릭한 지점을 커서 아래 그대로" 두기 위한 기준 — f* 는 이미지 안 비율, c* 는 무대 안 좌표 */
interface ZoomAnchor {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/**
 * 전체 화면 소개자료 뷰어 — 구조는 [상단 바] [무대(이미지 + 이전/다음)] [캡션] [필름스트립].
 * 스타일은 LabVideoGallery 의 VideoLightbox 를 따른다(짙은 남색 95% 배경, 보더 ✕ 버튼).
 *
 * 크기 계산을 CSS(max-w/max-h + object-contain)에 맡기지 않고 무대를 재서 직접 정한다:
 * object-contain 은 **요소 상자**가 무대 전체라 여백을 눌러도 확대되고, 클릭 지점 → 원본
 * 좌표 환산이 틀어진다. 잰 크기로 상자 = 보이는 이미지가 되게 해 스켈레톤·확대 기준을 맞춘다.
 *
 * body 직속 포털(조상 transform 이 fixed 기준을 가로채는 문제 — VideoLightbox 와 같은 이유).
 * 루트의 data-lenis-prevent: 전역 Lenis 는 body overflow:hidden 과 무관하게 휠을 가로채
 * window 를 프로그램으로 스크롤한다 — 뷰어 위 휠이 뒤 페이지를 움직이고, 확대 영역의
 * 네이티브 스크롤과도 싸운다. 뷰어 안의 휠·터치는 전부 브라우저 기본 동작에 맡긴다.
 */
export function LabBrochureViewer({
  brochure,
  index: rawIndex,
  onIndexChange,
  onClose,
  trigger,
}: {
  brochure: LabBrochure;
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** 닫을 때 포커스를 돌려줄 요소(연 버튼) */
  trigger: HTMLElement | null;
}) {
  const t = useTranslations('research');
  const slides = brochure.slides;
  const last = slides.length - 1;
  const index = Math.min(Math.max(rawIndex, 0), last);
  const slide = slides[index];
  const isCover = slide.kind === 'cover';

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const prevBtnRef = useRef<HTMLButtonElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLUListElement>(null);
  const anchorRef = useRef<ZoomAnchor | null>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const stripScrolledRef = useRef(false);
  // 포커스 복귀 대상은 연 순간의 트리거로 고정(열려 있는 동안 prop 이 바뀌어도 무시)
  const triggerRef = useRef(trigger);

  /** 이미지를 놓을 수 있는 영역(이전/다음 버튼 거터를 뺀 무대) — ResizeObserver 로 추적 */
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  /** 한 번 받은 이미지는 다시 와도 스켈레톤을 띄우지 않는다 */
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  /** 확대 중인 슬라이드 — 인덱스로 들고 있어 쪽을 넘기면 저절로 "맞춤"으로 돌아간다 */
  const [zoomAt, setZoomAt] = useState<number | null>(null);

  // 맞춤 크기: 무대 안에서 비율을 지키는 최대 크기(원본보다 키우지 않는다)
  const fitW = box ? Math.max(0, Math.floor(Math.min(box.w, box.h * RATIO, BROCHURE_IMAGE_WIDTH))) : 0;
  const fitH = Math.round(fitW / RATIO);
  // 확대 크기: 맞춤의 2배, 단 원본 픽셀까지만(그 이상은 흐려질 뿐)
  const zoomW = Math.min(BROCHURE_IMAGE_WIDTH, fitW * 2);
  const zoomH = Math.round(zoomW / RATIO);
  const canZoom = fitW > 0 && zoomW >= fitW * MIN_ZOOM_GAIN;
  const zoomed = zoomAt === index && canZoom;
  const frameW = zoomed ? zoomW : fitW;
  const frameH = zoomed ? zoomH : fitH;

  const isLoaded = !!loaded[slide.image];
  const isFailed = !!failed[slide.image];

  const counter = isCover ? t('brochure.cover') : t('brochure.counter', { n: index, total: brochure.labCount });
  const coverLabel = t('brochure.cover');
  const alt = (
    isCover
      ? t('brochure.coverAlt', { title: brochure.title })
      : t('brochure.alt', { professor: slide.professor ?? '', lab: slide.labName ?? '' })
  )
    .replace(/\s+/g, ' ')
    .replace(/\(\s*\)/g, '')
    .trim();

  const go = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), last);
      if (clamped !== index) onIndexChange(clamped);
    },
    [index, last, onIndexChange],
  );

  // 무대 크기 측정 — 첫 페인트 전에 한 번 재서 이미지가 0 크기로 깜빡이지 않게 한다
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 열려 있는 동안: 배경 스크롤 잠금 + 닫기 버튼 포커스, 닫히면 연 버튼으로 포커스 복귀.
  // ⚠️ 잠금은 body 가 아니라 <html> 에 건다. globals.css 가 html 에 overflow-x:clip 을 주고
  // 있어 body 의 overflow 가 뷰포트로 전파되지 않는다(전파는 html 이 visible 일 때만) —
  // body 만 hidden 으로 두면 뒤 페이지가 그대로 휠에 스크롤된다(CDP 실측 1007→1407px).
  useEffect(() => {
    const root = document.documentElement;
    const prevRoot = root.style.overflow;
    const prevBody = document.body.style.overflow;
    root.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus({ preventScroll: true });
    const returnTo = triggerRef.current;
    return () => {
      root.style.overflow = prevRoot;
      document.body.style.overflow = prevBody;
      returnTo?.focus({ preventScroll: true });
    };
  }, []);

  // 키보드: Esc 닫기, ←/→ 넘기기, Home/End 처음·끝, Tab 은 대화상자 안에서 순환
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
        );
        if (nodes.length === 0) return;
        const first = nodes[0];
        const lastNode = nodes[nodes.length - 1];
        const active = document.activeElement;
        const outside = !dialog.contains(active);
        if (e.shiftKey && (active === first || outside)) {
          e.preventDefault();
          lastNode.focus();
        } else if (!e.shiftKey && (active === lastNode || outside)) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      // 확대 중 스크롤 영역에 포커스가 있으면 화살표·Home/End 는 그 영역의 스크롤에 양보한다
      if (zoomed && target && scrollerRef.current?.contains(target)) return;
      if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === 'ArrowRight') go(index + 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(last);
      else return;
      e.preventDefault();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go, index, last, onClose, zoomed]);

  // 이웃 쪽 원본을 미리 받아 넘길 때 스켈레톤이 보이지 않게 한다
  useEffect(() => {
    for (const i of [index - 1, index + 1]) {
      if (i < 0 || i > last) continue;
      const img = new Image();
      img.decoding = 'async';
      img.src = slides[i].image;
    }
  }, [index, last, slides]);

  // 필름스트립: 활성 썸네일이 보이도록 가로 스크롤(가장 가까운 쪽으로만 — inline:nearest).
  // scrollIntoView 대신 직접 계산한다 — 조상(문서)까지 스크롤을 건드리지 않게.
  // 스트립 안에 포커스가 있었다면(←/→ 로 넘긴 경우) 새 활성 썸네일로 따라간다(로빙 tabindex).
  useEffect(() => {
    const strip = stripRef.current;
    const item = strip?.children[index] as HTMLElement | undefined;
    if (!strip || !item) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 처음 열 때는 애니메이션 없이 바로 그 자리에서 시작한다
    const behavior: ScrollBehavior = !stripScrolledRef.current || reduce ? 'auto' : 'smooth';
    stripScrolledRef.current = true;
    const pad = 16;
    const left = item.offsetLeft;
    const right = left + item.offsetWidth;
    if (left - pad < strip.scrollLeft) strip.scrollTo({ left: left - pad, behavior });
    else if (right + pad > strip.scrollLeft + strip.clientWidth)
      strip.scrollTo({ left: right + pad - strip.clientWidth, behavior });
    if (strip.contains(document.activeElement)) item.querySelector('button')?.focus({ preventScroll: true });
  }, [index]);

  // 확대/맞춤 전환 직후(페인트 전) 스크롤 위치를 맞춘다 — 클릭한 지점이 커서 아래 그대로 남게.
  // 버튼으로 확대하면 기준은 가운데. 쪽 넘김·창 크기 변화에는 반응하지 않도록 zoomed 만 본다.
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    const frame = frameRef.current;
    if (!sc) return;
    if (!zoomed || !frame) {
      sc.scrollLeft = 0;
      sc.scrollTop = 0;
      return;
    }
    const a = anchorRef.current ?? { fx: 0.5, fy: 0.5, cx: sc.clientWidth / 2, cy: sc.clientHeight / 2 };
    sc.scrollLeft = frame.offsetLeft + a.fx * frame.offsetWidth - a.cx;
    sc.scrollTop = frame.offsetTop + a.fy * frame.offsetHeight - a.cy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomed]);

  function toggleZoomFromButton() {
    anchorRef.current = null; // 가운데 기준
    setZoomAt(zoomed ? null : index);
  }

  function onImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!canZoom) return;
    if (zoomed) {
      setZoomAt(null);
      return;
    }
    const sc = scrollerRef.current;
    if (!sc) return;
    const r = e.currentTarget.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    anchorRef.current = {
      fx: (e.clientX - r.left) / r.width,
      fy: (e.clientY - r.top) / r.height,
      cx: e.clientX - s.left,
      cy: e.clientY - s.top,
    };
    setZoomAt(index);
  }

  // 이전/다음 버튼이 끝에서 비활성화되면 포커스가 body 로 떨어진다 — 반대쪽 버튼으로 넘겨 준다
  function step(delta: -1 | 1) {
    const next = index + delta;
    go(next);
    if (next <= 0) nextBtnRef.current?.focus({ preventScroll: true });
    else if (next >= last) prevBtnRef.current?.focus({ preventScroll: true });
  }

  // 터치 스와이프(맞춤 상태에서만 — 확대 중 가로 드래그는 이미지 이동이다)
  function onTouchStart(e: React.TouchEvent) {
    if (zoomed || e.touches.length !== 1) {
      touchRef.current = null;
      return;
    }
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start || zoomed) return;
    const end = e.changedTouches[0];
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? index + 1 : index - 1);
  }

  // 세로 휠을 필름스트립 가로 스크롤로 옮긴다(마우스 휠만 있는 사용자). 뒤 페이지는 잠겨 있어
  // 기본 동작을 막을 필요가 없다.
  function onStripWheel(e: React.WheelEvent<HTMLUListElement>) {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
  }

  const barBtn =
    'grid place-items-center border border-white/40 bg-white/10 text-white transition-colors hover:border-white hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
  // 이전/다음: sm 이상 맞춤 상태에선 이미지 옆 거터에 있어 닫기 버튼과 같은 흰 10% 바탕.
  // 모바일과 확대 상태에선 (대개 흰 바탕인) 포스터 위에 겹치므로 짙은 바탕으로 보이게 한다.
  const navBtn = cn(
    'absolute top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center border border-white/40 bg-[#0a1c3d]/70 text-white transition-colors hover:border-white hover:bg-[#0a1c3d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-30 sm:h-12 sm:w-12',
    !zoomed && 'sm:bg-white/10 sm:hover:bg-white/25',
  );
  // 어두운 바탕 위 스크롤바 — Windows 클래식 회색 막대가 뷰어를 가로지르지 않게 얇고 옅게
  const darkScrollbar = '[scrollbar-color:rgb(255_255_255/0.35)_transparent] [scrollbar-width:thin]';

  return createPortal(
    // tabIndex=-1: 이미지처럼 포커스를 못 받는 곳을 눌러도 포커스가 body 로 빠지지 않고
    // 대화상자에 남는다(키보드 조작·포커스 트랩 유지).
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('brochure.dialog')}
      tabIndex={-1}
      data-lenis-prevent
      className="fixed inset-0 z-[100] bg-[#0a1c3d]/95 text-white outline-none"
    >
      {/* 100svh 기둥 — 모바일 주소창이 보이는 가장 작은 뷰포트에서도 필름스트립이 잘리지 않게 */}
      <div className="flex h-[100svh] max-h-full flex-col">
        {/* 상단 바 — 좌: 제목·쪽 표시 / 우: 확대 토글 · PDF · 닫기 */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 pl-4 pr-2 sm:pl-6 sm:pr-4">
          <p className="min-w-0 truncate text-sm">
            <span className="font-subhead font-bold">{t('brochure.dialog')}</span>
            <span className="ml-3 tabular-nums text-white/70">{counter}</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {canZoom && (
              <button
                type="button"
                onClick={toggleZoomFromButton}
                className={cn(barBtn, 'h-10 grid-flow-col gap-1.5 px-3 text-xs font-bold')}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="m15.5 15.5 5 5M7.5 10.5h6" strokeLinecap="round" />
                  {!zoomed && <path d="M10.5 7.5v6" strokeLinecap="round" />}
                </svg>
                {zoomed ? t('brochure.zoomFit') : t('brochure.zoomIn')}
              </button>
            )}
            {brochure.pdfUrl && (
              <a
                href={brochure.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('brochure.pdf', { size: brochure.pdfSize })}
                className={cn(barBtn, 'h-10 w-10 grid-flow-col gap-1.5 text-xs font-bold sm:w-auto sm:px-3')}
              >
                <DownloadIcon className="h-4 w-4" />
                <span aria-hidden="true" className="hidden sm:inline">
                  {t('brochure.pdf', { size: brochure.pdfSize })}
                </span>
              </a>
            )}
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label={t('brochure.close')}
              className={cn(barBtn, 'h-12 w-12')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* 무대 — 이미지 + 좌우 이전/다음 */}
        <div className="relative min-h-0 flex-1">
          {/* 측정 전용 상자: sm 이상은 좌우 80px 을 이전/다음 버튼 거터로 비운다(이미지와 안 겹침).
              모바일은 폭이 귀해 이미지를 거의 전폭으로 두고 버튼을 가장자리에 겹친다. */}
          <div
            ref={measureRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute inset-x-2 inset-y-2 sm:inset-x-20 sm:inset-y-3"
          />
          <div
            ref={scrollerRef}
            tabIndex={zoomed ? 0 : undefined}
            role={zoomed ? 'region' : undefined}
            aria-label={zoomed ? alt : undefined}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            className={cn(
              'absolute inset-0 touch-manipulation focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white',
              zoomed ? cn('overflow-auto overscroll-contain', darkScrollbar) : 'overflow-hidden',
            )}
          >
            {/* 맞춤: 무대 한가운데 / 확대: 내용이 넘치면 스크롤, 모자라는 축만 가운데(m-auto 는
                넘칠 때 음수가 되지 않아 place-items:center 처럼 시작 부분이 잘리지 않는다) */}
            <div className={cn('flex min-h-full min-w-full', zoomed ? 'w-max' : 'h-full w-full')}>
              {box && (
                <div ref={frameRef} className="relative m-auto shrink-0" style={{ width: frameW, height: frameH }}>
                  {!isLoaded && (
                    <div className="absolute inset-0 grid place-items-center bg-white/5 px-4 text-center text-xs text-white/50">
                      {isFailed ? alt : t('brochure.loading')}
                    </div>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element -- 미리 렌더한 원본(상단 주석) */}
                  <img
                    key={slide.image}
                    src={slide.image}
                    alt={alt}
                    width={BROCHURE_IMAGE_WIDTH}
                    height={BROCHURE_IMAGE_HEIGHT}
                    decoding="async"
                    draggable={false}
                    onLoad={() => setLoaded((m) => (m[slide.image] ? m : { ...m, [slide.image]: true }))}
                    onError={() => setFailed((m) => ({ ...m, [slide.image]: true }))}
                    onClick={onImageClick}
                    className={cn(
                      'relative block h-full w-full select-none bg-white',
                      isLoaded ? 'opacity-100' : 'opacity-0',
                      canZoom && (zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'),
                    )}
                  />
                </div>
              )}
            </div>
          </div>

          <button
            ref={prevBtnRef}
            type="button"
            onClick={() => step(-1)}
            disabled={index === 0}
            aria-label={t('brochure.prev')}
            className={cn(navBtn, 'left-2 sm:left-4')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            ref={nextBtnRef}
            type="button"
            onClick={() => step(1)}
            disabled={index === last}
            aria-label={t('brochure.next')}
            className={cn(navBtn, 'right-2 sm:right-4')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true">
              <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* 캡션 — 연구실명 · 교수 + 홈페이지 / 표지는 문서 제목 — 발행처 */}
        <div className="flex min-h-[3rem] shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-2 text-sm sm:px-6">
          {isCover ? (
            <p className="min-w-0 text-white/85">
              <span className="font-subhead font-bold text-white">{brochure.title}</span>
              <span className="mx-2 text-white/40">—</span>
              {brochure.publisher}
            </p>
          ) : (
            <>
              <p className="min-w-0 text-white/85">
                {slide.labName && (
                  <>
                    <span className="font-subhead font-bold text-white">{slide.labName}</span>
                    <span className="mx-2 text-white/40">·</span>
                  </>
                )}
                {slide.professor}
              </p>
              {slide.url && (
                <a
                  href={slide.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 font-medium text-white/85 underline-offset-4 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {t('brochure.website')} ↗
                </a>
              )}
            </>
          )}
        </div>

        {/* 필름스트립 — 로빙 tabindex(활성 썸네일만 Tab 정지점, 나머지는 ←/→·클릭).
            가로 폭이 낮은 화면(가로 모드 폰 등)에선 무대를 살리려고 숨긴다. */}
        <nav
          aria-label={t('brochure.thumbs')}
          className="shrink-0 border-t border-white/10 [@media(max-height:500px)]:hidden"
        >
          <ul
            ref={stripRef}
            onWheel={onStripWheel}
            className={cn('relative flex gap-2 overflow-x-auto px-4 py-3 sm:px-6', darkScrollbar)}
          >
            {slides.map((s, i) => {
              const active = i === index;
              return (
                <li key={s.page} className="shrink-0">
                  <button
                    type="button"
                    tabIndex={active ? 0 : -1}
                    aria-current={active ? 'true' : undefined}
                    aria-label={t('brochure.thumbAria', { label: slideLabel(s, coverLabel) })}
                    onClick={() => go(i)}
                    className={cn(
                      'block w-20 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-24',
                      active ? 'opacity-100 outline outline-2 outline-white' : 'opacity-60 hover:opacity-100',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- 미리 렌더한 정적 썸네일 */}
                    <img
                      src={s.thumb}
                      alt=""
                      width={BROCHURE_THUMB_WIDTH}
                      height={BROCHURE_THUMB_HEIGHT}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      className="block aspect-[870/630] w-full bg-white/10 object-cover"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* 쪽이 바뀔 때 스크린리더에 "3 / 33 · 연구실명 · 교수" 를 알린다 */}
        <p className="sr-only" aria-live="polite">
          {isCover ? `${counter} · ${brochure.title}` : `${counter} · ${slideLabel(slide, coverLabel)}`}
        </p>
      </div>
    </div>,
    document.body,
  );
}
