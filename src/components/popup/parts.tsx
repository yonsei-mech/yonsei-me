'use client';

// 두 고정 카드(PopupDesktop·PopupMobile)가 나눠 쓰는 공통 부품 + 바깥 배치 컨테이너.
//
// 시각은 사이트 규칙을 따른다 — 각진 엣지(≤2px), 그림자 없음, 딤 없음, 금색 없음,
// 토큰 색만 사용. 캐러셀 점만 예외적으로 원(8px)이다.

import { useState } from 'react';
import {
  POPUP_DESKTOP_DOTS_H,
  POPUP_DESKTOP_IMAGE_MAX,
  popupDesktopVerticalInset,
  popupDesktopWidth,
  popupDesktopWidthCss,
  popupPosition,
  type PopupDesktopPosition,
  type PopupDevice,
  type PopupPositionKey,
} from '@/lib/popup-positions';
import { popupImageDelivery } from '@/lib/popup-image';
import type { PopupCardProps } from './types';

/** 헤더(z-50)보다 위 */
export const POPUP_Z = 60;

/** 위치 키 → 바깥 컨테이너의 배치 클래스. 좌우 여백은 24px(inset-x-6),
 *  상단 배치는 헤더에 겹치지 않게 96px 아래에서 시작한다(top-24).
 *  ⚠️ 이 숫자는 popup-positions.ts 의 POPUP_DESKTOP_INSETS 와 같은 값이다 —
 *  세로 예산 계산이 그 상수를 읽으므로 두 곳을 함께 고친다.
 *  좌우를 inset-x 로 **양쪽 모두** 잡는 이유: 컨테이너가 "좌우 24 를 뺀 전폭" 을
 *  가져야 카드의 max-width:100% 가 곧 가로 한계가 되기 때문이다(가운데 배치도
 *  p-4 대신 px-6 으로 통일 — 세로 여백은 두지 않는다). */
const DESKTOP_BOX: Record<string, string> = {
  center: 'inset-0 flex items-center justify-center px-6',
  topLeft: 'inset-x-6 top-24 flex justify-start',
  topRight: 'inset-x-6 top-24 flex justify-end',
  bottomLeft: 'inset-x-6 bottom-6 flex justify-start',
  bottomRight: 'inset-x-6 bottom-6 flex justify-end',
};

const MOBILE_BOX: Record<string, string> = {
  bottom: 'inset-x-0 bottom-0',
  top: 'inset-x-0 top-0',
  center: 'inset-0 flex items-center justify-center',
};

/**
 * 같은 위치를 쓰는 팝업들의 바깥 컨테이너.
 *
 * 카드는 자기 모양만 그리고 위치는 몰라야 한다 — 그래야 여러 개가 동시에 뜰 때의
 * 규칙(같은 자리면 캐러셀)이 카드 밖 한 곳에 모인다.
 * contained 면 fixed 대신 absolute 를 써서 관리자 미리보기 프레임을 벗어나지 않는다.
 */
export function PopupGroup({
  device,
  position,
  contained = false,
  children,
}: {
  device: PopupDevice;
  position: PopupPositionKey;
  contained?: boolean;
  children: React.ReactNode;
}) {
  const key = popupPosition(device, position).key;
  const box = (device === 'mobile' ? MOBILE_BOX : DESKTOP_BOX)[key];
  // PC 카드는 "이 화면에 사진 비율을 지키며 들어가는 폭"까지만 커진다. 그 **세로
  // 예산**을 배치별로 재서 CSS 변수로 내려 준다 — 카드는 자기 위치를 모르기 때문이다.
  // contained(관리자 미리보기)는 뷰포트 단위를 쓸 수 없어 프레임 높이를 기준으로 한다.
  const style = {
    zIndex: contained ? undefined : POPUP_Z,
    ...(device === 'desktop'
      ? {
          '--popup-vbudget': `calc(${
            contained ? 'var(--popup-frame-h, 520px)' : '100vh'
          } - ${popupDesktopVerticalInset(key as PopupDesktopPosition)}px)`,
        }
      : null),
  } as React.CSSProperties;
  return (
    <div className={`pointer-events-none ${contained ? 'absolute' : 'fixed'} ${box}`} style={style}>
      {children}
    </div>
  );
}

/** 카드 폭 — PC 는 관리자가 정한 px(기본 360)이되 사진 비율을 알면 세로 예산에
 *  맞춰 **카드째** 줄어든다(popupDesktopWidthCss). 모바일은 전폭 시트(가운데 배치만
 *  좌우 16px 여백)라 width·aspect 를 받아도 무시한다. */
export function popupCardWidth(
  device: PopupDevice,
  position: PopupPositionKey,
  width?: number,
  aspect?: number,
): string {
  if (device === 'desktop') return popupDesktopWidthCss(popupDesktopWidth(width), aspect);
  return position === 'center' ? 'calc(100% - 32px)' : '100%';
}

/** 사진 최대 높이 — **비율을 모르는 옛 항목**과 모바일 시트의 경로다.
 *  미리보기 프레임 안(contained)에서는 뷰포트 단위를 쓸 수 없으므로 프레임
 *  높이(--popup-frame-h, 미리보기가 심어 준다)의 70% 를 쓴다 — PC 는 사이트와
 *  똑같이 640px 절대 상한도 함께 건다(큰 기준 화면에서 미리보기만 커지지 않게). */
export function popupImageMaxHeight(device: PopupDevice, contained: boolean): string {
  const { ratio, px } = POPUP_DESKTOP_IMAGE_MAX;
  if (contained) {
    const rel = `calc(var(--popup-frame-h, 520px) * ${ratio})`;
    return device === 'mobile' ? rel : `min(${rel}, ${px}px)`;
  }
  return device === 'mobile' ? '70svh' : `min(${ratio * 100}vh, ${px}px)`;
}

/** 사진 — 링크가 있으면 <a> 로 감싼다. 값이 없으면 회색 플레이스홀더(미리보기) */
export function PopupImage({
  image,
  alt,
  link,
  newTab,
  device,
  aspect,
  width,
  contained = false,
}: Pick<
  PopupCardProps,
  'image' | 'alt' | 'link' | 'newTab' | 'aspect' | 'width' | 'contained'
> & {
  device: PopupDevice;
}) {
  if (!image) {
    return (
      <div
        className="grid w-full place-items-center bg-surface-soft text-xs text-content-faint"
        style={{ height: contained ? 180 : 220 }}
      >
        사진 없음
      </div>
    );
  }
  // 비율을 아는 PC 카드는 사진에 높이 상한을 걸지 않는다 — 카드 폭 자체가 세로
  // 예산에 맞춰 줄기 때문에(popupDesktopWidthCss) 사진은 전폭으로 따라오면 된다.
  // 높이 상한을 함께 걸면 사진만 줄고 카드는 그대로라 좌우에 흰 띠가 생긴다.
  // aspect-ratio 는 로드 전에 자리를 잡아 카드가 튀지 않게 하는 용도다.
  // 모바일은 전폭 시트라 이 경로를 쓰지 않는다(비율 값이 들어와도 무시).
  const fixed = device === 'desktop' && aspect ? aspect : undefined;
  // 사진 전달 — Next 이미지 라우트(/_next/image)로 리사이즈·AVIF/WebP 를 받는다.
  // next/image **컴포넌트**는 치수를 모르는 CMS 사진이라 쓰지 않고, URL 만 손으로
  // 만든다(lib/popup-image.ts · lib/image-url.ts). 관리자 미리보기(contained)는
  // 예외로 원본 URL 그대로다 — 저장 전 blob: 미리보기가 즉시 보여야 하기 때문이다.
  // 최적화할 수 없는 소스(blob:·SVG·허용 밖 호스트)도 null 이 돌아와 원본을 쓴다.
  const opt = contained ? null : popupImageDelivery(image, device, width);
  const delivery = opt
    ? {
        src: opt.src,
        srcSet: opt.srcSet,
        sizes: opt.sizes,
        // 팝업 사진은 첫 화면의 LCP 요소다 — 홈이 심는 preload 와 짝을 이룬다.
        fetchPriority: 'high' as const,
        decoding: 'async' as const,
      }
    : { src: image };
  const img = fixed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...delivery} alt={alt} className="block h-auto w-full" style={{ aspectRatio: String(fixed) }} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...delivery}
      alt={alt}
      className="block w-full object-contain"
      style={{
        maxHeight: popupImageMaxHeight(device, contained),
        // 모바일 시트는 사진이 도착해야 높이가 정해져 시트가 통째로 튄다(CLS).
        // 비율을 알면 로드 전에 자리를 잡아 둔다 — width:100% + height:auto 라
        // aspect-ratio 가 계산하는 높이가 곧 실제 높이고, max-height 는 그대로
        // 걸리므로 **최종 배치는 달라지지 않는다**(로드 전 상태만 달라진다).
        ...(device === 'mobile' && aspect ? { aspectRatio: String(aspect) } : null),
      }}
    />
  );
  if (!link) return img;
  return (
    <a
      href={link}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener noreferrer' : undefined}
      className="block"
    >
      {img}
    </a>
  );
}

/** 우측 상단 X — 사진 위에 겹치는 얇은 회색 아이콘(배경 없음).
 *  closeControl 이 'none' 이면 그리지 않는다. */
export function PopupCloseX({
  closeControl,
  labels,
  onDismiss,
}: Pick<PopupCardProps, 'closeControl' | 'labels' | 'onDismiss'>) {
  if (closeControl === 'none') return null;
  const remember = closeControl === 'hideToday';
  const label = remember ? labels.hideToday : labels.close;
  return (
    <button
      type="button"
      onClick={() => onDismiss(remember)}
      aria-label={label}
      className="absolute right-1 top-1 grid h-7 w-7 place-items-center text-[#6E6E6E] transition-colors hover:text-[#232323]"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M1.75 1.75 12.25 12.25" />
        <path d="M12.25 1.75 1.75 12.25" />
      </svg>
    </button>
  );
}

const FOOT_BASE =
  'h-full text-[13px] leading-none transition-colors disabled:opacity-60';

/**
 * 하단 바(44px, 위 헤어라인).
 * - split(PC): 좌우 반반 두 칸 + 가운데 세로 헤어라인. 왼쪽 칸이 없으면 '닫기' 전폭.
 * - 모바일: 좌우 정렬(좌우 여백 16px). 왼쪽 칸이 없으면 그 자리를 비운다.
 *
 * hideTodayButton 이 꺼져 있어도 '닫기' 는 남긴다 — X 를 '표시안함' 으로 둔 경우
 * 닫을 방법이 아예 없어지면 안 된다.
 */
export function PopupFooterBar({
  split,
  hideTodayButton,
  labels,
  onDismiss,
}: Pick<PopupCardProps, 'hideTodayButton' | 'labels' | 'onDismiss'> & { split: boolean }) {
  const hideBtn = (
    <button
      type="button"
      onClick={() => onDismiss(true)}
      className={`${FOOT_BASE} ${split ? 'flex-1' : ''} text-content-faint hover:text-content`}
    >
      {labels.hideToday}
    </button>
  );
  const closeBtn = (
    <button
      type="button"
      onClick={() => onDismiss(false)}
      className={`${FOOT_BASE} ${
        split ? `flex-1 ${hideTodayButton ? 'border-l border-surface-border' : ''}` : ''
      } font-semibold text-content hover:text-yonsei-blue`}
    >
      {labels.close}
    </button>
  );

  if (split) {
    return (
      <div className="flex h-11 border-t border-surface-border">
        {hideTodayButton && hideBtn}
        {closeBtn}
      </div>
    );
  }
  return (
    <div className="flex h-11 items-center justify-between border-t border-surface-border px-4">
      {hideTodayButton ? hideBtn : <span />}
      {closeBtn}
    </div>
  );
}

/** 캐러셀 점 — 현재 남색, 나머지 연회색. 누르면 그 팝업으로 옮긴다 */
export function PopupDots({
  count,
  index,
  onSelect,
}: {
  count: number;
  index: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="pointer-events-auto flex items-center justify-center gap-2">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={String(i + 1)}
          aria-current={i === index ? 'true' : undefined}
          onClick={() => onSelect(i)}
          className="block h-2 w-2 rounded-full transition-colors"
          style={{ backgroundColor: i === index ? '#003377' : '#C8D0DB' }}
        />
      ))}
    </div>
  );
}

/**
 * 같은 자리에 여러 개가 뜰 때 — 한 자리에 하나씩 보여 주고 점으로 옮긴다.
 *
 * 닫기는 여기서 처리하지 않는다. 목록(count)이 줄면 활성 index 를 끝으로 당겨
 * "닫으면 다음 팝업이 같은 자리에 보인다" 가 저절로 성립한다.
 *
 * 점의 자리는 기기마다 다르다 — PC 는 카드 **아래**, 모바일은 시트 **안쪽**
 * (하단 바 아래). 그래서 모바일은 점을 카드에 넘겨 준다.
 */
export function PopupCarousel({
  device,
  count,
  children,
}: {
  device: PopupDevice;
  count: number;
  /** (활성 index, 점 묶음) → 카드 하나 */
  children: (index: number, dots: React.ReactNode) => React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const active = count > 0 ? Math.min(index, count - 1) : 0;
  const dots = count > 1 ? <PopupDots count={count} index={active} onSelect={setIndex} /> : null;

  if (device === 'mobile') return <>{children(active, dots)}</>;
  return (
    // min-w-0: flex item 의 기본 min-width:auto 는 카드의 저장 폭을 그대로 붙들어,
    // 컨테이너(좌우 24 를 뺀 전폭)보다 넓어도 줄지 않게 만든다.
    // --popup-dots-h: 점이 붙으면 카드의 세로 예산에서 그만큼을 뺀다(점 8 + gap 8).
    <div
      className="flex min-w-0 max-w-full flex-col items-center gap-2"
      style={{ '--popup-dots-h': `${dots ? POPUP_DESKTOP_DOTS_H : 0}px` } as React.CSSProperties}
    >
      {children(active, null)}
      {dots}
    </div>
  );
}
