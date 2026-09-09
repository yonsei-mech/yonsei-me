// 팝업 공지 **위치** 목록 — PC·모바일이 각각 고르는 값의 단일 출처.
//
// 사이트(PopupNotice·popup/*)와 관리자 콘솔(PopupPositionPicker·resources.ts)이 모두
// 여기서 읽는다. 순수 모듈이라 서버·클라이언트 어디서든 import 할 수 있다.
//
// 형식(카드 생김새)은 기기마다 **하나로 고정**이다 — 관리자가 고르는 것은 "화면 어디에
// 뜨는가" 뿐이다(예전에는 템플릿 4종을 골랐다). 아임웹처럼 "모바일용 팝업을 따로 하나 더
// 등록" 하지 않아도 되게, 한 항목이 positionDesktop / positionMobile 두 값을 갖고
// 기기 판정은 브라우저가 한다.

export type PopupDevice = 'desktop' | 'mobile';

/** PC 위치 — content/popups.json 의 positionDesktop 값 */
export type PopupDesktopPosition = 'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
/** 모바일 위치 — content/popups.json 의 positionMobile 값 */
export type PopupMobilePosition = 'bottom' | 'center' | 'top';

export type PopupPositionKey = PopupDesktopPosition | PopupMobilePosition;

export interface PopupPositionDef {
  key: PopupPositionKey;
  /** 관리자에게 보이는 이름 */
  label: string;
}

export const POPUP_POSITIONS: Record<PopupDevice, readonly PopupPositionDef[]> = {
  desktop: [
    { key: 'center', label: '가운데' },
    { key: 'topLeft', label: '좌측 상단' },
    { key: 'topRight', label: '우측 상단' },
    { key: 'bottomLeft', label: '좌측 하단' },
    { key: 'bottomRight', label: '우측 하단' },
  ],
  mobile: [
    { key: 'bottom', label: '하단' },
    { key: 'center', label: '가운데' },
    { key: 'top', label: '상단' },
  ],
};

/** 기기별 기본 위치 — PC 는 화면 정중앙, 모바일은 손가락이 닿는 하단 시트 */
export const DEFAULT_POSITION: { desktop: PopupDesktopPosition; mobile: PopupMobilePosition } = {
  desktop: 'center',
  mobile: 'bottom',
};

/** 그 기기에서 쓸 수 있는 위치 키인가 — 옛 데이터·오타 판정 */
export function isPopupPosition(device: PopupDevice, v: unknown): boolean {
  return POPUP_POSITIONS[device].some((p) => p.key === v);
}

/** 알 수 없는 값(옛 데이터·오타)은 기본 위치로 떨어뜨린다 — 팝업이 통째로 사라지는
 *  것보다 낫다. */
export function popupPosition(
  device: PopupDevice,
  key: string | undefined | null,
): PopupPositionDef {
  const list = POPUP_POSITIONS[device];
  return list.find((p) => p.key === key) ?? list.find((p) => p.key === DEFAULT_POSITION[device])!;
}

/** PC 카드 폭(px) 한계·기본값 — CMS 리사이즈와 사이트 렌더가 함께 읽는 단일 출처.
 *  모바일은 전폭 시트라 폭을 고르지 않는다(위치만 고른다).
 *  ⚠️ max 는 이제 **값 검증용 sanity 상한**일 뿐이다(옛 절대 상한 800 은 폐지).
 *  실제 한계는 하나뿐이다 — "이 화면에 사진 비율을 지키며 들어가는가"
 *  (popupDesktopMaxWidth / popupDesktopWidthCss). */
export const POPUP_DESKTOP_WIDTH = { min: 240, max: 4096, default: 360 } as const;

/** PC 사진 높이 상한 — 화면 높이의 70% 와 이 절대값 중 작은 쪽(`min(70vh, 640px)`).
 *  비율(imageAspect)을 모르는 **옛 항목의 폴백**과 모바일 시트만 쓴다. 비율을 아는
 *  항목은 카드째 비율 고정으로 줄어들므로 사진에 높이 상한을 걸지 않는다. */
export const POPUP_DESKTOP_IMAGE_MAX = { ratio: 0.7, px: 640 } as const;

/** PC 배치 여백(px) — parts.tsx DESKTOP_BOX 의 클래스(inset-x-6=24, top-24=96,
 *  bottom-6=24)와 같은 값. 두 곳을 함께 고친다. */
export const POPUP_DESKTOP_INSETS = { side: 24, top: 96, bottom: 24 } as const;

/** 카드에서 사진이 아닌 높이(px) — 하단 바 44 + 위아래 테두리 2.
 *  X 버튼·하단 바는 카드가 줄어도 크기가 고정이라 상수다(비례하지 않는다). */
export const POPUP_DESKTOP_CHROME_H = 46;

/** 같은 자리에 여러 개일 때 카드 아래 캐러셀 점이 차지하는 높이(px) — gap 8 + 점 8 */
export const POPUP_DESKTOP_DOTS_H = 16;

/** 위치별 **세로 예산 차감**(px).
 *  가운데는 0 — 상하 여백을 두지 않고 헤더도 덮는다(팝업을 최대한 크게 띄우기 위한
 *  결정). 상단·하단 배치는 앵커(top-24 / bottom-6)만큼만 뺀다. */
export function popupDesktopVerticalInset(position: PopupDesktopPosition): number {
  if (position === 'topLeft' || position === 'topRight') return POPUP_DESKTOP_INSETS.top;
  if (position === 'bottomLeft' || position === 'bottomRight') return POPUP_DESKTOP_INSETS.bottom;
  return 0;
}

/** 저장·폼 값의 사진 비율(가로÷세로) 보정 — 유한한 양수면 소수 4자리로 반올림하고,
 *  아니면 undefined(= 비율을 모르는 옛 항목과 같은 취급). */
export function popupImageAspect(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 10000) / 10000;
}

/** 기준 화면에서 비율을 지키며 들어가는 **최대 카드 폭**(px, 정수).
 *  가로는 좌우 여백을 뺀 폭, 세로는 (화면 높이 − 배치 여백 − 카드 크롬 − 점) 에
 *  비율을 곱한 폭이다. 비율을 모르면 가로 한계만 건다.
 *  값의 최소(240)보다는 작아지지 않는다 — 그보다 좁은 화면은 카드가 넘치더라도
 *  최소 폭을 지키는 편이 낫다(폭 0 짜리 카드를 만들지 않는다). */
export function popupDesktopMaxWidth({
  aspect,
  position,
  viewportWidth,
  viewportHeight,
  dots = false,
}: {
  aspect?: number;
  position: PopupDesktopPosition;
  viewportWidth: number;
  viewportHeight: number;
  /** 같은 자리에 여러 개라 카드 아래 점이 붙는가 */
  dots?: boolean;
}): number {
  let max = viewportWidth - POPUP_DESKTOP_INSETS.side * 2;
  if (aspect) {
    const budget =
      viewportHeight -
      popupDesktopVerticalInset(position) -
      POPUP_DESKTOP_CHROME_H -
      (dots ? POPUP_DESKTOP_DOTS_H : 0);
    max = Math.min(max, budget * aspect);
  }
  return Math.max(POPUP_DESKTOP_WIDTH.min, Math.floor(max));
}

/** 카드 폭 CSS — 사이트와 관리자 미리보기가 **같은 문자열**을 쓴다.
 *  비율을 알면 "관리자가 정한 폭" 과 "세로 예산이 허락하는 폭" 중 작은 쪽이다.
 *  세로 예산(--popup-vbudget)은 PopupGroup 이 배치별로 심어 주고(사이트는 100vh,
 *  미리보기는 프레임 높이 기준), 점이 붙으면 --popup-dots-h 만큼 더 뺀다.
 *  ⚠️ 가로 한계는 여기 없다 — 카드의 max-width:100% 와 PopupGroup 의 inset-x-6
 *  컨테이너가 건다(100vw 는 스크롤바 폭까지 세어 카드를 화면 밖으로 밀어낸다). */
export function popupDesktopWidthCss(width: number, aspect?: number): string {
  if (!aspect) return `${width}px`;
  return `min(${width}px, calc((var(--popup-vbudget, 100vh) - var(--popup-dots-h, 0px) - ${POPUP_DESKTOP_CHROME_H}px) * ${aspect}))`;
}

/** 알 수 없는 값(옛 데이터·NaN)은 기본 폭으로, 범위 밖은 한계로 자른다 —
 *  위치와 같은 규칙이다(팝업이 통째로 깨지는 것보다 기본값이 낫다).
 *  CSS px 로 쓰이므로 정수로 반올림한다. */
export function popupDesktopWidth(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return POPUP_DESKTOP_WIDTH.default;
  return Math.round(Math.min(POPUP_DESKTOP_WIDTH.max, Math.max(POPUP_DESKTOP_WIDTH.min, n)));
}
