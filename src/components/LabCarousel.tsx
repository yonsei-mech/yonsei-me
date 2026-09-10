'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { LabDirectoryEntry } from '@/lib/faculty';
import type { Locale } from '@/i18n/routing';
import { canOptimizeImage, optimizedImageUrl } from '@/lib/image-url';
import { cn } from '@/lib/utils';

/** 부모(LabsSection) 화살표 버튼이 쓰는 넘기기 핸들 */
export interface LabCarouselHandle {
  /** 카드 1장 폭만큼 좌(-1)/우(+1)로 부드럽게 이동(자동 흐름은 잠시 정지 후 재개) */
  nudge: (dir: -1 | 1) => void;
}

/** 연구실별 이미지가 없을 때 순환 사용하는 더미 배경 3장. */
const FALLBACK_IMAGES = [
  '/img/research/energy-conversion.jpg',
  '/img/research/intelligent-robotics.jpg',
  '/img/research/precision-manufacturing.jpg',
];

/** 로컬 정적 이미지 중 .webp 형제가 보장된 경로(tools/images/convert-webp.py 가 만든다) */
const LOCAL_WEBP_SIBLING = /^\/img\/(labs|research)\/[^?#]+\.(jpe?g|png)$/i;

/**
 * 카드 사진으로 실제 요청할 이미지 URL.
 *
 * 카드는 아트디렉션이 없어 next/image 를 쓸 수도 있지만, 무한 루프로 리스트를 2회
 * 렌더해 66장이 되므로 런타임 최적화기 대신 정적 파일을 그대로 가리킨다:
 *  1) 로컬 /img/labs·/img/research 의 jpg/png → 같은 이름의 .webp.
 *     ⚠️ 불변식: 그 두 디렉터리의 모든 원본은 .webp 형제를 가진다
 *     (`tools/images/convert-webp.py` 가 생성 — 새 JPEG 을 넣었으면 다시 돌려야 한다).
 *     존재 확인 없이 확장자만 바꾸므로 이 불변식이 깨지면 404 가 난다.
 *  2) 원격(CMS 업로드 R2·Blob·교내 도메인) → Next 이미지 라우트로 640px 리사이즈.
 *     카드는 최대 290px(sm) 이라 DPR2 에서도 640 이면 충분하다.
 *  3) 그 외(blob:/data: 미리보기, SVG 등) → 원본 그대로.
 */
export function cardImageUrl(src: string): string {
  if (LOCAL_WEBP_SIBLING.test(src)) return src.replace(/\.(jpe?g|png)$/i, '.webp');
  if (canOptimizeImage(src)) return optimizedImageUrl(src, 640);
  return src;
}

/** 자동 흐름 속도(px/frame). 값이 클수록 빠르게 오른쪽으로 흐른다. */
const FLOW_SPEED = 0.5;
/** 사용자가 손으로 민 뒤 자동 흐름을 재개하기까지의 대기(ms). */
const RESUME_DELAY = 1600;

/**
 * 즉시(eager) 받아 둘 카드 수 — 나머지는 loading="lazy".
 *
 * 리스트를 2회 렌더하므로 카드는 66장이고, 예전처럼 CSS background-image 로 그리면
 * 브라우저가 66장(중복 제외 33개 파일, 2.0MB)을 첫 로드에 전부 받았다(배경 이미지는
 * 지연 로드가 불가능). <img loading="lazy"> 로 바꿔 화면 근처만 받게 하고, 처음
 * 보이는 창만 eager 로 남긴다.
 *
 * 가장 넓은 첫 화면(≈1360px)에서 290px 카드가 5장 보이고, 자동 흐름이 왼쪽에서
 * 들어오므로 앞쪽 2장 + 뒤쪽 1장 여유 = 8장.
 */
const EAGER_COUNT = 8;
/** 하이드레이션 전(트랙 scrollLeft=0) 첫 화면에 보이는 카드 수 + 여유 2 — 위 eager 주석 참조 */
const EAGER_PREHYDRATION_COUNT = 7;
/**
 * eager 창의 시작 인덱스.
 * ⚠️ 마운트 시 scrollLeft 를 scrollWidth/4(= 한 벌의 절반)에 두므로 처음 보이는 카드는
 * 0번이 아니라 첫 벌의 중앙(≈N/2)이다. 0번부터 eager 로 잡으면 화면에 없는 카드를
 * 받고 정작 보이는 카드는 lazy 가 된다. 흐름이 들어오는 왼쪽으로 2장 앞당겨 잡는다.
 */
function eagerStartIndex(n: number): number {
  return Math.max(0, Math.floor(n / 2) - 2);
}

interface LabCardData extends LabDirectoryEntry {
  image: string;
}

/**
 * 연구실 카드 가로 캐러셀.
 * - 네이티브 overflow-x-auto 스크롤 컨테이너 → 터치/트랙패드 제스처가 자동으로 동작.
 * - requestAnimationFrame 으로 scrollLeft 를 조금씩 줄여 카드가 왼→오(오른쪽 방향)로 흐른다.
 * - 리스트를 2회 렌더하고 경계에서 scrollLeft 를 절반만큼 점프시켜 무한 루프.
 * - 호버·드래그·키보드 포커스·백그라운드 탭·prefers-reduced-motion 에서 일시정지.
 */
export const LabCarousel = forwardRef<
  LabCarouselHandle,
  {
    labs: LabDirectoryEntry[];
    locale: Locale;
  }
>(function LabCarousel({ labs, locale }, ref) {
  const t = useTranslations('home.people');
  const trackRef = useRef<HTMLDivElement | null>(null);

  // 흐름 정지 사유들. 하나라도 true 면 자동 흐름을 멈춘다.
  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  const hiddenRef = useRef(false);
  const draggingRef = useRef(false);
  const reduceRef = useRef(false);
  // 뷰포트 밖(다른 섹션 보는 중)에도 매 프레임 scrollLeft 를 만지면 섹션 페이징
  // 트윈의 프레임 예산을 갉아먹는다 — IntersectionObserver 로 화면 안에서만 흐른다.
  const inViewRef = useRef(true);
  // 사용자가 손으로 민 직후 잠깐 멈추는 타이머.
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedByUserRef = useRef(false);

  const cards: LabCardData[] = labs.map((lab, i) => ({
    ...lab,
    image: lab.image ?? FALLBACK_IMAGES[i % FALLBACK_IMAGES.length],
  }));
  const eagerStart = eagerStartIndex(cards.length);

  // 경계에서 scrollLeft 를 절반만큼 되돌려 무한 루프를 만든다.
  const wrap = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const half = el.scrollWidth / 2;
    if (el.scrollLeft <= 0) {
      el.scrollLeft += half;
    } else if (el.scrollLeft >= half) {
      el.scrollLeft -= half;
    }
  }, []);

  // 자동 흐름 루프.
  useEffect(() => {
    reduceRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = trackRef.current;
    if (!el) return;

    // 초기 위치를 절반 지점으로 두어 양방향 여유를 확보.
    el.scrollLeft = el.scrollWidth / 4;

    if (reduceRef.current) return; // 자동 흐름 없이 수동 스크롤만.

    let raf = 0;
    const step = () => {
      const node = trackRef.current;
      if (node) {
        const blocked =
          hoverRef.current ||
          focusRef.current ||
          hiddenRef.current ||
          draggingRef.current ||
          pausedByUserRef.current ||
          !inViewRef.current;
        if (!blocked) {
          node.scrollLeft -= FLOW_SPEED; // 감소 = 콘텐츠가 오른쪽으로 흐름.
          wrap();
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [wrap]);

  // 백그라운드 탭 감지.
  useEffect(() => {
    const onVis = () => {
      hiddenRef.current = document.visibilityState === 'hidden';
    };
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // 뷰포트 밖 감지 — 화면에 없으면 자동 흐름 정지(위 blocked 조건에 합류).
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      inViewRef.current = entry.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 사용자가 손으로 민 뒤 잠깐 멈췄다가 재개.
  const nudgeResume = useCallback(() => {
    pausedByUserRef.current = true;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      pausedByUserRef.current = false;
    }, RESUME_DELAY);
  }, []);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  // 부모 화살표 버튼용 넘기기 — 카드 1장 피치(카드 폭+간격)만큼 스무스 스크롤.
  // 자동 흐름은 nudgeResume 로 잠시 멈췄다 재개하고, 스크롤이 끝난 뒤 wrap 으로
  // 무한 루프 경계를 보정한다.
  useImperativeHandle(
    ref,
    () => ({
      nudge: (dir: -1 | 1) => {
        const el = trackRef.current;
        if (!el) return;
        const first = el.querySelector<HTMLElement>(':scope > *');
        const second = first?.nextElementSibling as HTMLElement | null;
        const pitch =
          first && second ? second.offsetLeft - first.offsetLeft : first?.offsetWidth ?? 300;
        nudgeResume();
        el.scrollBy({ left: dir * pitch, behavior: 'smooth' });
        window.setTimeout(wrap, 450);
      },
    }),
    [nudgeResume, wrap],
  );

  return (
    <div
      role="group"
      aria-label={t('region')}
      onPointerEnter={() => {
        hoverRef.current = true;
      }}
      onPointerLeave={() => {
        hoverRef.current = false;
        draggingRef.current = false;
      }}
      onPointerDown={() => {
        draggingRef.current = true;
      }}
      onPointerUp={() => {
        draggingRef.current = false;
        nudgeResume();
      }}
      onFocusCapture={() => {
        focusRef.current = true;
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          focusRef.current = false;
        }
      }}
    >
      <div
        ref={trackRef}
        className="no-scrollbar flex gap-3.5 overflow-x-auto overscroll-x-contain pb-2 sm:gap-5"
        onWheel={nudgeResume}
        onScroll={wrap}
      >
        {/* 리스트를 2회 렌더. 두 번째 세트는 접근성 트리에서 제외. */}
        {[false, true].map((isClone) =>
          cards.map((card, i) => (
            <LabCardView
              key={`${isClone ? 'clone' : 'orig'}-${i}`}
              card={card}
              locale={locale}
              professorLabel={t('professorLabel')}
              externalLabel={t('externalLabel')}
              ariaHidden={isClone}
              // 두 창을 eager 로: (1) 마운트 뒤 scrollLeft=scrollWidth/4 에서 보이는 창(eagerStart~),
              // (2) 하이드레이션 **전** 트랙이 scrollLeft=0 일 때 보이는 첫 카드들(0~6). 느린 기기에서
              // 사용자가 하이드레이션보다 먼저 이 섹션까지 내려오면 (2)가 화면에 있는데, 이것까지
              // lazy 면 빈 카드가 잠깐 보인다(2026-09-10 slow-4G 실측 44프레임). 5장 ≈ 200KB 의 대가.
              eager={
                !isClone &&
                (i < EAGER_PREHYDRATION_COUNT || (i >= eagerStart && i < eagerStart + EAGER_COUNT))
              }
            />
          )),
        )}
      </div>

    </div>
  );
});

function LabCardView({
  card,
  locale,
  professorLabel,
  externalLabel,
  ariaHidden,
  eager,
}: {
  card: LabCardData;
  locale: Locale;
  professorLabel: string;
  externalLabel: string;
  ariaHidden: boolean;
  /** 첫 화면에 보이는 카드만 true — 나머지는 loading="lazy"(EAGER_COUNT 주석 참조) */
  eager: boolean;
}) {
  const name = locale === 'ko' ? card.nameKo : card.nameEn || card.nameKo;
  const professor = locale === 'ko' ? card.professorKo : card.professorEn;
  const hasLink = card.url.trim().length > 0;

  const inner = (
    <>
      {/* 사진. background-image 가 아니라 <img> 인 이유는 오직 지연 로드 때문이다
          (CSS 배경은 loading="lazy" 가 없어 66장이 첫 로드에 전부 나갔다).
          object-cover + 기본 object-position:50% 50% 가 예전 bg-cover bg-center 와
          같은 픽셀을 그리고, 호버 확대 트랜스폼도 같은 클래스로 그대로 옮겼다. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- 66장(2벌) 카드라 런타임 최적화기 대신 정적 .webp 를 직접 가리킨다 */}
      <img
        src={cardImageUrl(card.image)}
        alt=""
        aria-hidden="true"
        draggable={false}
        decoding="async"
        loading={eager ? 'eager' : 'lazy'}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-yonsei-navy via-yonsei-navy/60 to-yonsei-navy/10"
      />
      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3.5 sm:p-5">
        <span className="line-clamp-2 text-sm font-bold leading-snug text-white sm:text-base">{name}</span>
        <span className="text-[11px] font-medium text-white/85 sm:text-xs">
          {professorLabel}: {professor}
        </span>
        <span className="text-[11px] text-white/70 sm:text-xs">{card.location}</span>
        {/* 호버 라벨 — 네이비 그라디언트 위라 금색 배제 후 흰색으로 가독성 확보 */}
        {hasLink && (
          <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
            {externalLabel} ↗
          </span>
        )}
      </span>
    </>
  );

  // 모바일에서는 카드가 화면을 압도하지 않도록 폭을 줄인다 (텍스트도 함께 축소)
  const shellClass =
    'group relative block aspect-[7/8] w-[185px] shrink-0 overflow-hidden border border-black/5 sm:w-[290px]';

  if (hasLink) {
    return (
      <a
        href={card.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-hidden={ariaHidden || undefined}
        tabIndex={ariaHidden ? -1 : undefined}
        className={cn(shellClass, 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue')}
      >
        {inner}
      </a>
    );
  }

  return (
    <div aria-hidden={ariaHidden || undefined} className={cn(shellClass, 'cursor-default')}>
      {inner}
    </div>
  );
}
