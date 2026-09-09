'use client';

// PC 팝업 — 형식은 하나로 고정이다(관리자가 고르는 것은 위치와 폭뿐).
//
// 흰 카드(폭은 props.width, 기본 360px), 각진 엣지, 1px 테두리, 그림자·딤 없음. 사진은 카드 전폭으로
// contain 되고, 우측 상단 X 는 사진 위에 겹친다. 아래는 44px 두 칸 바
// ('오늘 하루 보지 않기' | '닫기').
//
// 바깥 배치(fixed/absolute·z-index)는 PopupGroup 이 이미 처리했으므로 여기서
// 위치를 잡지 않는다.

import { PopupCloseX, PopupFooterBar, PopupImage, popupCardWidth } from './parts';
import type { PopupCardProps } from './types';

export function PopupDesktop(props: PopupCardProps) {
  const { alt, labels } = props;
  return (
    <div
      role="dialog"
      aria-label={`${alt} — ${labels.dialog}`}
      tabIndex={-1}
      className="pointer-events-auto relative overflow-hidden rounded-[2px] border border-surface-border bg-surface"
      style={{ width: popupCardWidth('desktop', 'center', props.width) }}
    >
      <PopupImage {...props} device="desktop" />
      <PopupCloseX {...props} />
      <PopupFooterBar {...props} split />
    </div>
  );
}
