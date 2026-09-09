'use client';

// 팝업 공지 위치 선택기 — PC·모바일 한 쌍을 **한 위젯에서** 고른다.
//
// 형식(카드 생김새)은 기기마다 하나로 고정이라 관리자가 고르는 것은 "화면 어디에
// 뜨는가"(+ PC 는 폭) 뿐이다. 기기 토글로 지금 고칠 쪽을 정하고, 카드 하나를 누르면
// 그 기기의 위치만 바뀐다(다른 기기는 그대로). 아래 미리보기는 학생이 실제로 보는 그
// 컴포넌트를 (components/popup 의 PopupDesktop·PopupMobile) contained 모드로 그린
// 것이다 — 관리자가 "보는 대로 고친다"는 CMS 원칙을 지키기 위해 별도의 목업을 두지
// 않는다. PC 미리보기는 배경 캡처 위에서 모서리를 끌어 폭까지 고치는 크기 편집기
// (PopupSizeFrame)로 넘긴다.
//
// 관리자 콘솔이라 문자열은 한국어 하드코딩(리소스 스키마와 같은 관례).

import { useState } from 'react';
import {
  POPUP_POSITIONS,
  popupPosition,
  type PopupDesktopPosition,
  type PopupDevice,
  type PopupMobilePosition,
  type PopupPositionKey,
} from '@/lib/popup-positions';
import { PopupCarousel, PopupGroup, PopupMobile } from '@/components/popup';
import { cellText, type FormRecord } from '@/lib/admin/resources';
import { PopupSizeFrame, buildPreviewCard } from './PopupSizeFrame';

interface Props {
  form: FormRecord;
  keys: { desktop: string; mobile: string };
  setValue: (key: string, value: FormRecord[string]) => void;
  /** 배경 캡처 교체용 — PC 크기 편집기에만 쓰인다(모바일 미리보기는 배경이 없다) */
  onUploadImage?: (file: File, opts?: { maxDim?: number; folder?: string }) => Promise<string>;
  busy?: boolean;
}

/** 위치를 아주 작게 그린 그림 — 기기 프레임 안 **그 자리**에 놓인 카드.
 *  실제 컴포넌트를 축소하지 않고 손그림을 쓰는 이유: 카드가 여러 장 동시에 보여야 하고,
 *  카드에서는 "어디에" 만 알면 되기 때문이다(자세한 건 아래 미리보기가 맡는다). */
function PositionThumb({
  device,
  position,
  selected,
}: {
  device: PopupDevice;
  position: PopupPositionKey;
  selected: boolean;
}) {
  // 세로가 긴 폰 / 가로가 긴 모니터
  const frame = device === 'mobile' ? { w: 44, h: 76 } : { w: 108, h: 68 };
  const stroke = selected ? '#003377' : '#98A4B4';
  const fill = selected ? '#D6E2F2' : '#E7ECF3';

  // PC: 프레임 폭의 30% 짜리 카드가 다섯 자리 중 하나에 놓인다(여백 6).
  // 모바일: 하단·상단은 전폭 시트, 가운데는 좌우를 띄운 카드.
  let box: { x: number; y: number; w: number; h: number };
  if (device === 'desktop') {
    const w = Math.round(frame.w * 0.3);
    const h = 26;
    const m = 6;
    const left = position === 'topLeft' || position === 'bottomLeft';
    const right = position === 'topRight' || position === 'bottomRight';
    const top = position === 'topLeft' || position === 'topRight';
    const bottom = position === 'bottomLeft' || position === 'bottomRight';
    box = {
      x: left ? m : right ? frame.w - w - m : (frame.w - w) / 2,
      y: top ? m + 4 : bottom ? frame.h - h - m : (frame.h - h) / 2,
      w,
      h,
    };
  } else if (position === 'center') {
    const w = frame.w - 12;
    const h = 34;
    box = { x: 6, y: (frame.h - h) / 2, w, h };
  } else {
    const h = 30;
    box = { x: 0, y: position === 'top' ? 0 : frame.h - h, w: frame.w, h };
  }

  return (
    <svg
      viewBox={`0 0 ${frame.w} ${frame.h}`}
      width={frame.w}
      height={frame.h}
      role="presentation"
      aria-hidden="true"
    >
      {/* 기기 화면 */}
      <rect x="0.5" y="0.5" width={frame.w - 1} height={frame.h - 1} fill="#F4F7FB" stroke="#E0E6ED" />
      {/* 팝업 카드 */}
      <rect x={box.x + 0.5} y={box.y + 0.5} width={box.w - 1} height={box.h - 1} fill="#FFFFFF" stroke={stroke} />
      {/* 사진 */}
      <rect x={box.x + 2} y={box.y + 2} width={box.w - 4} height={box.h - 10} fill={fill} />
      {/* 하단 바 구분선 */}
      <line x1={box.x} y1={box.y + box.h - 6} x2={box.x + box.w} y2={box.y + box.h - 6} stroke="#E0E6ED" />
    </svg>
  );
}

export function PopupPositionPicker({ form, keys, setValue, onUploadImage, busy }: Props) {
  const [device, setDevice] = useState<PopupDevice>('desktop');
  const activeKey = device === 'mobile' ? keys.mobile : keys.desktop;
  const current = popupPosition(device, cellText(form, activeKey)).key;

  const desktopLabel = popupPosition('desktop', cellText(form, keys.desktop)).label;
  const mobileLabel = popupPosition('mobile', cellText(form, keys.mobile)).label;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="미리볼 기기"
          className="inline-flex rounded-[2px] border border-surface-border"
        >
          {(['mobile', 'desktop'] as PopupDevice[]).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
              className={
                device === d
                  ? 'bg-yonsei-navy px-3 py-1.5 text-xs font-semibold text-white'
                  : 'px-3 py-1.5 text-xs font-semibold text-content-faint hover:text-content'
              }
            >
              {d === 'mobile' ? 'Mobile' : 'PC'}
            </button>
          ))}
        </div>
        <p className="text-xs text-content-faint">
          PC: {desktopLabel} · Mobile: {mobileLabel}
        </p>
      </div>

      {/* 카드를 한 줄로 두고 미리보기는 그 아래 — 전용 편집기의 입력 열(~740px)에서
          카드와 640px 미리보기를 나란히 놓으면 카드가 40px 폭으로 눌린다 */}
      <div className="grid gap-4">
        <div
          className={`grid grid-cols-2 content-start gap-2 ${
            device === 'mobile' ? 'sm:grid-cols-3' : 'sm:grid-cols-5'
          }`}
        >
          {POPUP_POSITIONS[device].map((p) => {
            const selected = p.key === current;
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setValue(activeKey, p.key)}
                className={`flex flex-col items-center gap-2 rounded-[2px] border-2 bg-surface p-3 text-center transition-colors ${
                  selected ? 'border-yonsei-navy' : 'border-surface-border hover:border-yonsei-blue'
                }`}
              >
                <PositionThumb device={device} position={p.key} selected={selected} />
                <span className="text-xs font-semibold text-content">{p.label}</span>
              </button>
            );
          })}
        </div>

        {/* PC 는 폭까지 함께 고치는 크기 편집기(배경 캡처 + 모서리 핸들)로 넘긴다.
            모바일은 전폭 시트라 고칠 폭이 없어 지금의 단순 미리보기를 그대로 쓴다. */}
        {device === 'desktop' ? (
          <PopupSizeFrame
            form={form}
            // 이 가지에서는 device 가 'desktop' 이라 current 도 PC 위치 키다
            // (popupPosition 이 그 목록에서만 고른다) — 크기 편집기는 세로 예산
            // 계산에 PC 위치만 받는다.
            position={current as PopupDesktopPosition}
            setValue={setValue}
            onUploadImage={onUploadImage}
            busy={busy}
          />
        ) : (
          <MobilePreview form={form} position={current as PopupMobilePosition} />
        )}
      </div>
    </div>
  );
}

/** 모바일 카드를 폰 프레임(390×700) 안에 그린다(contained).
 *  프레임을 그대로 두면 폼을 밀어내므로 CSS zoom 으로 줄인다 — PostCanvas 와 같은
 *  관례(자식은 레이아웃 px 를 그대로 쓰고 화면만 축소된다). */
function MobilePreview({ form, position }: { form: FormRecord; position: PopupMobilePosition }) {
  const frame = { width: 390, height: 700 };
  const card = buildPreviewCard(form, 'mobile');

  return (
    // 왼쪽 맞춤 — 입력 열의 다른 컨트롤과 같은 세로선에서 시작해야 눈이 흔들리지 않는다
    <div className="justify-self-start">
      <p className="mb-2 text-xs font-semibold text-content-faint">
        {/* 프레임이 실제 화면 크기가 아니라는 것을 수치로 밝힌다(축소본) */}
        미리보기 (모바일 · 390×700, 60% 축소)
      </p>
      <div
        className="relative overflow-hidden rounded-[2px] border border-surface-border bg-surface-soft"
        // --popup-frame-h: contained 모드의 사진 상한(프레임 높이의 70%)이 읽는 값.
        // 뷰포트 단위(70svh)를 그대로 두면 미리보기 안에서 화면 크기로 부푼다.
        style={
          {
            ...frame,
            zoom: 0.6,
            '--popup-frame-h': `${frame.height}px`,
          } as React.CSSProperties
        }
      >
        <PopupGroup device="mobile" position={position} contained>
          {/* 미리보기는 언제나 한 장 — 캐러셀을 거쳐 실제와 같은 구조로 그린다 */}
          <PopupCarousel device="mobile" count={1}>
            {() => <PopupMobile position={position} {...card} />}
          </PopupCarousel>
        </PopupGroup>
      </div>
    </div>
  );
}
