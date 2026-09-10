// 팝업 공지 컴포넌트 묶음 — 사이트(PopupNotice)와 관리자 미리보기
// (PopupPositionPicker)가 **같은 컴포넌트**를 쓴다. 미리보기가 "학생이 보는 그것"
// 그대로여야 CMS 원칙(보는 대로 고친다)이 지켜진다.

export { PopupDesktop } from './PopupDesktop';
export { PopupMobile } from './PopupMobile';
export {
  POPUP_DOT_OFF,
  POPUP_DOT_ON,
  PopupCarousel,
  PopupDots,
  PopupGroup,
  PopupStack,
} from './parts';
export type { PopupCardLabels, PopupCardProps } from './types';
