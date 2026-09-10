'use client';

// 모바일 팝업 — 형식은 하나로 고정이다(관리자가 고르는 것은 위치뿐).
//
// 뷰포트 전폭 시트, 흰 배경, 각진 엣지. 사진은 전폭으로 contain 되고, 우측 상단 X 는
// 사진 위에 겹친다. 아래는 44px 바('오늘 하루 보지 않기' … '닫기').
//
// 테두리는 붙는 방향에 따라 다르다 — 하단이면 위 헤어라인, 상단이면 아래 헤어라인,
// 가운데면 좌우 16px 을 띄우고 네 면에 테두리를 두른다.
//
// children 은 캐러셀 점이다 — 모바일은 점이 시트 **안쪽**(하단 바 아래)에 놓인다.
// 여백(p-2)까지 **넘겨주는 쪽**이 그린다: 점이 숨겨질 때 패딩만 남아 시트가 길어지는 것을
// 막으려면 여닫는 상자가 여백을 포함해야 한다(components/popup/parts.tsx 의 PopupStack).

import { PopupCloseX, PopupFooterBar, PopupImage, popupCardWidth } from './parts';
import type { PopupMobilePosition } from '@/lib/popup-positions';
import type { PopupCardProps } from './types';

export function PopupMobile({
  position = 'bottom',
  children,
  ...props
}: PopupCardProps & { position?: PopupMobilePosition; children?: React.ReactNode }) {
  const { alt, labels } = props;
  const border =
    position === 'center'
      ? 'border border-surface-border'
      : position === 'top'
        ? 'border-b border-surface-border'
        : 'border-t border-surface-border';
  return (
    <div
      role="dialog"
      aria-label={`${alt} — ${labels.dialog}`}
      tabIndex={-1}
      className={`pointer-events-auto relative overflow-hidden rounded-[2px] bg-surface ${border}`}
      style={{ width: popupCardWidth('mobile', position) }}
    >
      <PopupImage {...props} device="mobile" />
      <PopupCloseX {...props} />
      <PopupFooterBar {...props} split={false} />
      {children}
    </div>
  );
}
