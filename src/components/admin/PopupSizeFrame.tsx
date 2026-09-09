'use client';

// PC 팝업 **크기 편집기** — 실제 홈 화면 캡처 위에 진짜 팝업 카드를 얹고, 모서리를
// 끌어 폭을 정한다. "관리자가 학생이 보는 화면 그대로 보면서 고친다"는 CMS 원칙을
// 폭에까지 밀어붙인 것이다(숫자 입력만으로는 360px 이 화면에서 얼마인지 알 수 없다).
//
// 프레임의 논리 크기는 **기준 화면의 뷰포트 CSS px**(예: 1440×900)이고, 화면에는
// CSS zoom 으로 줄여 그린다 — PostCanvas·기존 위치 미리보기와 같은 관례다(자식은
// 레이아웃 px 를 그대로 쓰고 화면만 축소된다). 그래서 카드에 넘기는 폭은 보정 없이
// 학생 화면과 같은 px 이고, 핸들·배지처럼 **화면에서 크기가 일정해야 하는 것**만
// 1/zoom 로 되돌린다.
//
// 크기 모델(2026-09 개편): 절대 상한은 없다. 카드와 사진이 **비율로 묶여** 있어
// 한계는 "이 화면에 사진 비율을 지키며 들어가는가" 하나뿐이다 — 세로 예산은 배치별로
// 다르고(가운데는 상하 여백 0·헤더 덮음, 상단 96, 하단 24), 가로는 좌우 24 씩이다.
// 그래서 핸들은 **대각선 비율 고정**으로 끌고, 저장값이 이 기준 화면보다 크면 카드가
// 줄어든 모습(effective)으로 보인다. 계산식은 popup-positions.ts 한 곳에 있다.
//
// 사진이 없으면 크기를 정할 근거가 없으므로 프레임을 잠근다(점선 자리 + 안내 한 줄).
//
// 배경 캡처와 기준 화면은 항목이 아니라 CMS 전역 설정(content/popup-preview.json)이라
// 항목 저장과 무관하게 즉시 저장한다 — 항목을 저장하지 않고 나가도 배경은 남아야 한다.
//
// (한국어 UI 문자열은 내부 운영 도구라 컴포넌트에 직접 둔다.)

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  POPUP_DESKTOP_WIDTH,
  popupDesktopMaxWidth,
  popupDesktopWidth,
  popupImageAspect,
  type PopupDesktopPosition,
  type PopupDevice,
} from '@/lib/popup-positions';
import { PopupCarousel, PopupDesktop, PopupGroup } from '@/components/popup';
import type { PopupCardProps } from '@/components/popup/types';
import { cellText, type FormRecord, type LocalizedPair } from '@/lib/admin/resources';
import {
  DEFAULT_POPUP_PREVIEW,
  POPUP_PREVIEW_VIEWPORTS,
  loadPopupPreview,
  savePopupPreview,
  type PopupPreviewSettings,
} from '@/lib/admin/popup-preview';

/** 미리보기 카드의 버튼 문구 — 미리보기는 언제나 한국어 화면을 흉내 낸다 */
export const PREVIEW_LABELS = {
  close: '닫기',
  hideToday: '오늘 하루 보지 않기',
  dialog: '공지 팝업',
};

/** 폼 값 → 실제 카드 컴포넌트의 props.
 *  PC 크기 편집기와 모바일 미리보기가 **같은 조립**을 써야 두 화면이 어긋나지 않는다.
 *  (이 모듈에 두는 이유: PopupPositionPicker 가 이 파일을 import 하므로 반대 방향이면
 *   순환 import 가 된다.) */
export function buildPreviewCard(form: FormRecord, device: PopupDevice): PopupCardProps {
  const image = (device === 'mobile' && cellText(form, 'imageMobile')) || cellText(form, 'image');
  const link = cellText(form, 'link').trim();
  const closeControl = cellText(form, 'closeControl');
  return {
    image,
    alt: ((form.title ?? { ko: '', en: '' }) as LocalizedPair).ko || '팝업 사진',
    link: link || undefined,
    newTab: form.newTab === true,
    labels: PREVIEW_LABELS,
    closeControl: (closeControl === 'hideToday' || closeControl === 'none'
      ? closeControl
      : 'close') as 'close' | 'hideToday' | 'none',
    hideTodayButton: form.hideTodayButton === true,
    // 미리보기도 학생 화면과 같은 폭 값을 써야 "보는 대로 고친다"가 성립한다
    // (모바일 카드는 전폭 시트라 이 값을 무시한다).
    width: popupDesktopWidth(form.widthDesktop),
    // 사진 비율 — 카드가 프레임에 맞춰 줄어드는 규칙이 사이트와 같아진다
    // (모바일 카드는 이 값도 무시한다).
    aspect: popupImageAspect(form.imageAspect),
    contained: true,
    onDismiss: () => {
      /* 미리보기에서는 닫히지 않는다 */
    },
  };
}

/** 폼에서 폭을 담는 키 — 리소스 정의(resources.ts)의 number 필드와 같은 이름이다.
 *  위치처럼 키를 props 로 받지 않는 이유: 폭은 PC 하나뿐이라 짝이 없다. */
const WIDTH_KEY = 'widthDesktop';

/** 화면(축소본)에서 핸들이 갖는 크기(px) — 실제 배치에는 1/zoom 을 곱한다 */
const HANDLE_SCREEN_PX = 10;

/** 배경 캡처 용량 한계 — 관리자 전용 자산이라 넉넉히 두되, 실수로 원본 PNG 를
 *  올려 업로드가 몇 분씩 걸리는 것은 막는다. */
const BG_MAX_MB = 10;

type SaveState = { kind: 'idle' | 'busy' | 'done' | 'error'; text: string };

const IDLE: SaveState = { kind: 'idle', text: '' };

/** 네 모서리. 가로는 오른쪽 핸들이 끌수록 넓어지고(+1) 왼쪽은 반대(−1),
 *  세로는 아래 핸들이 +1·위 핸들이 −1 이다 — 카드가 비율 고정이라 세로로 끄는 것도
 *  폭이 된다(가로·세로 중 더 많이 끈 쪽을 따른다). */
const CORNERS = [
  { key: 'tl', dirX: -1 as const, dirY: -1 as const, cls: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
  { key: 'tr', dirX: 1 as const, dirY: -1 as const, cls: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
  { key: 'bl', dirX: -1 as const, dirY: 1 as const, cls: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
  { key: 'br', dirX: 1 as const, dirY: 1 as const, cls: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' },
];

/** 안내 문구에 적는 참고 화면 — 좁은 노트북과 큰 모니터의 경계값 두 벌 */
const HINT_VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

interface Props {
  form: FormRecord;
  /** 지금 고른 PC 위치 — 가운데면 좌우로 함께 늘어난다(끄는 양의 두 배) */
  position: PopupDesktopPosition;
  setValue: (key: string, value: FormRecord[string]) => void;
  onUploadImage?: (file: File, opts?: { maxDim?: number; folder?: string }) => Promise<string>;
  busy?: boolean;
}

export function PopupSizeFrame({ form, position, setValue, onUploadImage, busy }: Props) {
  const [settings, setSettings] = useState<PopupPreviewSettings>(DEFAULT_POPUP_PREVIEW);
  const [sha, setSha] = useState('');
  const [save, setSave] = useState<SaveState>(IDLE);
  const [bgBroken, setBgBroken] = useState(false);
  const [hostWidth, setHostWidth] = useState(0);
  const [cardHeight, setCardHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 드래그 시작 지점 — 렌더마다 새로 만들지 않으려 ref 에 둔다 */
  const dragRef = useRef<{
    x: number;
    y: number;
    w: number;
    dirX: 1 | -1;
    dirY: 1 | -1;
  } | null>(null);
  /** 비율이 **바뀐** 순간을 가려내는 플래그 — 마운트 첫 실행은 건드리지 않는다 */
  const aspectRef = useRef<{ seen: boolean; value: number | undefined }>({
    seen: false,
    value: undefined,
  });

  const viewport = settings.desktop;
  const image = cellText(form, 'image');
  const width = popupDesktopWidth(form[WIDTH_KEY]);
  // 비율은 여기서 재지 않는다 — 사진을 올릴 때 PopupDetailEditor 가 재서 폼에 심는다
  // (모바일 탭을 보고 있어도 재야 하고, 저장에 실려 가야 하는 값이다).
  const aspect = popupImageAspect(form.imageAspect);

  // 설정은 마운트 시 한 번만 읽는다. 실패하면(네트워크·404) 기본값으로 그대로 그린다 —
  // 배경이 없다고 폭 편집을 막을 이유가 없다.
  useEffect(() => {
    let alive = true;
    void loadPopupPreview()
      .then((r) => {
        if (!alive) return;
        setSettings(r.settings);
        setSha(r.sha);
      })
      .catch(() => {
        /* 기본값 유지 */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => setBgBroken(false), [viewport.image]);

  // 입력 열의 실제 폭 — 프레임을 몇 배로 줄일지가 여기서 정해진다.
  // 첫 페인트 전에 재야 프레임이 커졌다 줄어드는 깜빡임이 없다.
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    setHostWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setHostWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 카드 높이는 사진 비율이 정하므로 DOM 에서 읽는다(계산으로는 알 수 없다).
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    setCardHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setCardHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [image]);

  const zoom = hostWidth > 0 ? Math.min(1, hostWidth / viewport.width) : 0.5;

  /**
   * 이 기준 화면에서 비율을 지키며 들어가는 최대 폭. 절대 상한은 없다 —
   * 가로는 좌우 여백(24×2)을 뺀 폭, 세로는 배치별 예산(가운데 0 · 상단 96 · 하단 24)
   * 에서 카드 크롬(46)을 뺀 높이에 비율을 곱한 폭이다. 계산은 사이트와 같은
   * 단일 출처(popupDesktopMaxWidth)를 쓴다. 미리보기는 언제나 한 장이라 점(dots)은 없다.
   */
  const maxWidth = popupDesktopMaxWidth({
    aspect,
    position,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  });

  const clampWidth = useCallback(
    (px: number): number =>
      Math.round(Math.min(maxWidth, Math.max(POPUP_DESKTOP_WIDTH.min, px))),
    [maxWidth],
  );

  /** 이 기준 화면에서 **실제로 그려지는** 폭 — 저장값이 화면보다 크면 카드가 줄어든다
   *  (사이트의 CSS min() 이 하는 일을 미리보기에서 숫자로 미리 해 둔 것). */
  const effective = Math.min(width, maxWidth);

  function commitWidth(px: number) {
    const next = clampWidth(px);
    if (next !== width) setValue(WIDTH_KEY, String(next));
  }

  // 비율이 **바뀌면**(세로 사진 → 가로 사진 등) 옛 폭이 이 화면에 안 들어갈 수 있다.
  // 그때만 값을 정리한다 — 마운트 시(열기만 했을 때)에는 손대지 않는다.
  useEffect(() => {
    const prev = aspectRef.current;
    aspectRef.current = { seen: true, value: aspect };
    if (!prev.seen || prev.value === aspect) return;
    if (width > maxWidth) setValue(WIDTH_KEY, String(maxWidth));
  }, [aspect, maxWidth, width, setValue]);

  function onHandleDown(e: React.PointerEvent<HTMLDivElement>, dirX: 1 | -1, dirY: 1 | -1) {
    if (busy) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // 기준이 width 가 아니라 effective 다 — 저장값이 이 화면보다 컸어도 첫 드래그에서
    // 보이는 크기부터 이어지고, 그 결과가 화면 한계 이하로 정리된다.
    dragRef.current = { x: e.clientX, y: e.clientY, w: effective, dirX, dirY };
    setDragging(true);
  }

  function onHandleMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    // clientX·clientY 는 화면 px 이므로 zoom 으로 나눠 레이아웃(=실제 뷰포트) px 로
    // 되돌린다. 가운데 정렬은 좌우(위아래)가 함께 벌어지므로 끈 거리의 두 배가 된다.
    // 카드가 비율 고정이라 세로로 끈 거리도 폭으로 환산되고(× 비율), 둘 중 **더 많이
    // 끈 쪽**을 따라 대각선으로 커진다.
    const k = position === 'center' ? 2 : 1;
    const growX = ((e.clientX - d.x) / zoom) * d.dirX * k;
    const growY = ((e.clientY - d.y) / zoom) * d.dirY * (aspect ?? 0) * k;
    const grow = Math.abs(growX) >= Math.abs(growY) ? growX : growY;
    commitWidth(d.w + grow);
  }

  function onHandleUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  /** 전역 설정 저장 — 항목 저장과 무관하게 즉시 쓴다(낙관적 반영 후 문구로 결과 표시) */
  async function persist(next: PopupPreviewSettings, label: string) {
    setSettings(next);
    setSave({ kind: 'busy', text: '저장 중…' });
    try {
      setSha(await savePopupPreview(next, sha));
      setSave({ kind: 'done', text: `${label} 저장됨` });
    } catch (err) {
      setSave({
        kind: 'error',
        text: err instanceof Error ? err.message : '설정을 저장하지 못했습니다.',
      });
    }
  }

  // 성공 문구는 잠깐만 — 남겨 두면 다음 조작의 결과인지 헷갈린다
  useEffect(() => {
    if (save.kind !== 'done') return;
    const t = setTimeout(() => setSave(IDLE), 2500);
    return () => clearTimeout(t);
  }, [save]);

  async function replaceBackground(file: File) {
    if (!onUploadImage) {
      setSave({ kind: 'error', text: '업로드를 사용할 수 없습니다.' });
      return;
    }
    if (!file.type.startsWith('image/')) {
      setSave({ kind: 'error', text: '이미지 파일만 올릴 수 있습니다.' });
      return;
    }
    if (file.size > BG_MAX_MB * 1024 * 1024) {
      setSave({ kind: 'error', text: `${BG_MAX_MB}MB 이하 이미지만 올릴 수 있습니다.` });
      return;
    }
    setSave({ kind: 'busy', text: '업로드 중…' });
    try {
      // maxDim 기본값(1600)은 1920 캡처를 줄여 배경이 물러진다 — 캡처는 원본에 가깝게.
      const url = await onUploadImage(file, { folder: 'popup-preview', maxDim: 2560 });
      // 지금 고른 기준 화면을 함께 저장한다 — 캡처와 뷰포트가 어긋나면 프레임의 px 가
      // 거짓말이 된다(1920 캡처를 1440 이라고 하면 카드가 실제보다 커 보인다).
      await persist({ desktop: { ...viewport, image: url } }, '배경');
    } catch (err) {
      setSave({
        kind: 'error',
        text: err instanceof Error ? err.message : '업로드에 실패했습니다.',
      });
    }
  }

  const card = { ...buildPreviewCard(form, 'desktop'), width: effective };
  const handleSize = HANDLE_SCREEN_PX / zoom;
  const showBadge = dragging || hover;
  // 하단 배치는 카드 아래에 배지를 놓을 자리가 없다(프레임이 잘라 낸다)
  const badgeAbove = position === 'bottomLeft' || position === 'bottomRight';

  // 설정의 뷰포트가 목록에 없으면(손편집·옛 값) 그 값도 고를 수 있게 앞에 붙인다
  const viewportOptions = POPUP_PREVIEW_VIEWPORTS.some(
    (v) => v.width === viewport.width && v.height === viewport.height,
  )
    ? POPUP_PREVIEW_VIEWPORTS
    : [{ width: viewport.width, height: viewport.height }, ...POPUP_PREVIEW_VIEWPORTS];

  return (
    // 입력 열을 가득 채운다(justify-self-start 로 두면 폭이 자기 내용에 맞춰져
    // zoom 계산이 그 폭을 다시 읽는 순환이 생긴다 — 1280 기준이 열의 절반에서 멈춘다)
    <div className="min-w-0 w-full">
      <p className="mb-2 text-xs font-semibold text-content-faint">
        미리보기 (PC · {viewport.width}×{viewport.height} 기준, {Math.round(zoom * 100)}% 축소)
      </p>

      {/* 툴바 — 왼쪽은 배경(전역 설정), 오른쪽 끝은 이 항목의 폭 */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-content-faint">
          기준 화면
          <select
            aria-label="기준 화면"
            value={`${viewport.width}x${viewport.height}`}
            disabled={busy || save.kind === 'busy'}
            onChange={(e) => {
              const [w, h] = e.target.value.split('x').map(Number);
              void persist({ desktop: { ...viewport, width: w, height: h } }, '기준 화면');
            }}
            className="h-8 rounded-[2px] border border-surface-border bg-surface px-2 text-xs text-content outline-none transition-colors focus:border-yonsei-blue disabled:opacity-60"
          >
            {viewportOptions.map((v) => (
              <option key={`${v.width}x${v.height}`} value={`${v.width}x${v.height}`}>
                {v.width}×{v.height}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy || save.kind === 'busy' || !onUploadImage}
          className="h-8 rounded-[2px] border border-surface-border bg-surface px-2.5 text-xs font-semibold text-content transition-colors hover:border-yonsei-blue hover:text-yonsei-blue disabled:opacity-60"
        >
          배경 캡처 교체
        </button>
        <button
          type="button"
          onClick={() => void persist(DEFAULT_POPUP_PREVIEW, '기본 배경')}
          disabled={busy || save.kind === 'busy'}
          className="h-8 rounded-[2px] border border-surface-border bg-surface px-2.5 text-xs font-semibold text-content-faint transition-colors hover:border-yonsei-blue hover:text-yonsei-blue disabled:opacity-60"
        >
          기본 배경으로
        </button>

        {save.kind !== 'idle' && (
          <p
            role={save.kind === 'error' ? 'alert' : undefined}
            className={`text-xs ${save.kind === 'error' ? 'text-[#b42318]' : 'text-content-faint'}`}
          >
            {save.text}
          </p>
        )}

        <label className="ml-auto flex items-center gap-1.5 text-xs text-content-faint">
          폭
          <input
            type="number"
            aria-label="PC 카드 폭"
            min={POPUP_DESKTOP_WIDTH.min}
            // 상한은 이 기준 화면에 들어가는 폭이다(고정 상한은 없다)
            max={maxWidth}
            step={1}
            disabled={busy || !image}
            value={cellText(form, WIDTH_KEY)}
            onChange={(e) => setValue(WIDTH_KEY, e.target.value)}
            onBlur={(e) => setValue(WIDTH_KEY, String(clampWidth(popupDesktopWidth(e.target.value))))}
            className="h-8 w-[86px] rounded-[2px] border border-surface-border bg-surface px-2 text-xs tabular-nums text-content outline-none transition-colors focus:border-yonsei-blue disabled:opacity-60"
          />
          px
        </label>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void replaceBackground(f);
            e.target.value = '';
          }}
        />
      </div>

      <div ref={hostRef} className="w-full">
        <div
          className="relative overflow-hidden rounded-[2px] border border-surface-border bg-surface-soft"
          // --popup-frame-h: contained 모드의 사진 상한(프레임 높이의 70%)이 읽는 값.
          // 뷰포트 단위(70vh)를 그대로 두면 미리보기 안에서 화면 크기로 부푼다.
          style={
            {
              width: viewport.width,
              height: viewport.height,
              zoom,
              '--popup-frame-h': `${viewport.height}px`,
            } as React.CSSProperties
          }
        >
          {/* 배경 캡처 — 관리자 눈금자일 뿐이라 alt 는 비운다(스크린리더는 건너뛴다).
              관리자 화면이라 최적화보다 즉시 반영이 중요 — next/image 대신 일반 img. */}
          {!bgBroken && viewport.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={viewport.image}
              alt=""
              aria-hidden="true"
              onError={() => setBgBroken(true)}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover object-top"
            />
          )}

          <PopupGroup device="desktop" position={position} contained>
            {/* 미리보기는 언제나 한 장 — 캐러셀을 거쳐 실제와 같은 구조로 그린다 */}
            <PopupCarousel device="desktop" count={1}>
              {() =>
                !image ? (
                  // 사진이 없으면 크기를 정할 수 없다(높이가 비율에서 나온다) — 자리만
                  // 점선으로 보여 주고 잠근다. 글자·여백은 zoom 안이라 1/zoom 로 되돌린다.
                  <div
                    className="pointer-events-none flex items-center justify-center rounded-[2px] border border-dashed border-[#98A4B4] bg-white/80 text-center text-content-faint"
                    style={{
                      width: 360,
                      minHeight: 220,
                      fontSize: 13 / zoom,
                      padding: 16 / zoom,
                      lineHeight: 1.5,
                    }}
                  >
                    {/* 두 줄로 고정 — 한 줄에 두면 360px 안에서 대시 뒤가 어중간하게 접힌다 */}
                    <span>
                      <span className="block">PC 사진을 먼저 올려 주세요</span>
                      <span className="block">크기는 사진 비율을 따릅니다</span>
                    </span>
                  </div>
                ) : (
                  <div
                    ref={cardRef}
                    className="pointer-events-auto relative"
                    style={{ width: effective }}
                    onPointerEnter={() => setHover(true)}
                    onPointerLeave={() => setHover(false)}
                  >
                    <PopupDesktop {...card} />

                    {/* 리사이즈 핸들 — 키보드 대안은 툴바의 숫자 입력이라 보조기술에는 감춘다.
                        비율을 아직 못 잰 동안에는 감춘다(끌면 비율이 무시된다) */}
                    {aspect !== undefined &&
                      CORNERS.map((c) => (
                        <div
                          key={c.key}
                          aria-hidden="true"
                          onPointerDown={(e) => onHandleDown(e, c.dirX, c.dirY)}
                          onPointerMove={onHandleMove}
                          onPointerUp={onHandleUp}
                          onPointerCancel={onHandleUp}
                          className={`absolute border-[#0057A8] bg-white ${c.cls}`}
                          style={{
                            width: handleSize,
                            height: handleSize,
                            borderWidth: 1.5 / zoom,
                            cursor: busy ? 'default' : c.cursor,
                            touchAction: 'none',
                          }}
                        />
                      ))}

                    {/* 수치 배지 — 화면에서 11px 로 읽히게 폰트·여백도 1/zoom 로 되돌린다.
                        하단 배치에서는 카드 아래가 프레임 밖이라(overflow-hidden) 위로 올린다. */}
                    {showBadge && (
                      <div
                        className={`pointer-events-none absolute left-1/2 whitespace-nowrap rounded-[2px] bg-yonsei-navy text-white tabular-nums ${
                          badgeAbove ? 'bottom-full' : 'top-full'
                        }`}
                        style={{
                          transform: 'translateX(-50%)',
                          [badgeAbove ? 'marginBottom' : 'marginTop']: 6 / zoom,
                          padding: `${3 / zoom}px ${6 / zoom}px`,
                          fontSize: 11 / zoom,
                          lineHeight: 1.2,
                        }}
                      >
                        {effective} × {cardHeight} px
                        {width > effective && (
                          // 저장값이 이 기준 화면에 안 들어간다 — 실제 화면에서도 같은
                          // 규칙으로 줄어든다는 것을 숫자로 밝힌다
                          <span className="block">
                            저장값 {width} → 이 화면 {effective} (자동 축소)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              }
            </PopupCarousel>
          </PopupGroup>
        </div>
      </div>

      <p className="mt-2 text-xs text-content-faint">
        {image ? (
          <>
            높이는 사진 비율을 따르고, 화면에 안 들어가면 비율을 지키며 자동으로
            줄어듭니다 —{' '}
            {HINT_VIEWPORTS.map((v, i) => (
              <span key={`${v.width}x${v.height}`}>
                {i > 0 && ' · '}
                {v.width}×{v.height} 화면{' '}
                {Math.min(
                  width,
                  popupDesktopMaxWidth({
                    aspect,
                    position,
                    viewportWidth: v.width,
                    viewportHeight: v.height,
                  }),
                )}{' '}
                px
              </span>
            ))}
          </>
        ) : (
          '배경 캡처는 관리자 미리보기 전용입니다.'
        )}
      </p>
    </div>
  );
}
