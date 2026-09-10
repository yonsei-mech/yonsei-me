// 팝업 카드 컴포넌트의 **props 계약**. 이 파일이 사이트(PopupNotice)·관리자
// 미리보기(PopupPositionPicker)와 두 고정 컴포넌트(PopupDesktop·PopupMobile) 사이의
// 유일한 접점이다.
//
// 형식은 기기마다 하나로 고정이라 '어느 기기인가' 는 props 가 아니라 **컴포넌트가**
// 말한다(PopupDesktop / PopupMobile). 카드는 자기 바깥의 배치(fixed 위치·z-index)를
// 손대지 않는다 — 배치는 parts.tsx 의 PopupGroup 이 맡는다.

export interface PopupCardLabels {
  /** 닫기 (aria-label·버튼 문구) */
  close: string;
  /** 오늘 하루 보지 않기 */
  hideToday: string;
  /** 스크린리더가 읽는 창 종류 ('공지 팝업') — 카드 루트의 aria-label 에 제목과
   *  함께 들어간다. role="dialog"·tabIndex=-1 은 카드 루트가 직접 단다. */
  dialog: string;
}

export interface PopupCardProps {
  /** 사진 URL. 빈 문자열이면 회색 플레이스홀더를 그린다(관리자 미리보기) */
  image: string;
  /** 사진 대체 텍스트 = 항목 제목(로케일 해석은 호출측이 끝낸 값) */
  alt: string;
  /** 사진을 눌렀을 때 갈 곳. 없으면 사진은 링크가 되지 않는다 */
  link?: string;
  newTab: boolean;
  labels: PopupCardLabels;
  /** 우측 상단 X 의 동작. 'none' 이면 X 를 그리지 않는다 */
  closeControl: 'close' | 'hideToday' | 'none';
  /** 하단 바의 "오늘 하루 보지 않기" 칸을 그리는가 (끄면 '닫기' 한 칸 전폭) */
  hideTodayButton: boolean;
  /** PC 카드 폭(px) — PopupDesktop 만 쓴다. 모바일은 전폭 시트라 무시한다.
   *  없거나 범위 밖이면 popupDesktopWidth 가 기본값(360)·한계로 보정한다. */
  width?: number;
  /** 사진 가로÷세로. 있으면 PC 카드가 비율 고정으로 화면에 맞춰(카드째) 줄어든다.
   *  없으면(옛 항목) 사진에 높이 상한을 거는 예전 방식으로 그린다. */
  aspect?: number;
  /** 닫기. remember=true 면 오늘 하루 숨김을 기억한다 */
  onDismiss: (remember: boolean) => void;
  /**
   * 관리자 미리보기처럼 **작은 프레임 안**에 그려지는가.
   * true 면 뷰포트 단위(100vw·70svh)를 쓰지 않고 프레임(부모) 기준 단위를 쓴다 —
   * 프레임 안에서 화면 전체 크기로 부풀지 않게 하기 위해서다.
   * 바깥 배치(fixed ↔ absolute)는 PopupGroup 이 같은 값으로 따로 처리한다.
   */
  contained?: boolean;
  /**
   * 사진의 src 를 **아직 달지 않는다**(data-src 로만 들고 있는다).
   *
   * 사이트는 서버에서 "뜰지 모르는" 후보를 기기별로 다 그려 둔다 — 그대로 src 를 달면
   * 반대 기기 사진까지 받는다(display:none 이어도 받는다). 첫 페인트 전에 도는 인라인
   * 게이트가 실제로 뜨는 카드 한 장에만 진짜 속성으로 옮기고, 하이드레이션 뒤에는
   * React 가 같은 값을 그대로 이어받는다. 관리자 미리보기는 쓰지 않는다.
   */
  defer?: boolean;
}
