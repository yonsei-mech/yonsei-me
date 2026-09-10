'use client';

// 팝업 공지 — CMS '팝업 공지'(content/popups.json)가 만든 사진 팝업.
//
// 형식은 기기마다 하나로 고정이고, 관리자가 고르는 것은 **위치**다
// (positionDesktop / positionMobile). 이 파일은 "언제·어디서·어느 기기에 뜨는가" 만
// 판정하고, 실제 생김새는 components/popup 의 PopupDesktop·PopupMobile 이 그린다
// (계약: components/popup/types.ts).
//
// ⚠️ 게재 기간·기기·페이지 판정을 **전부 브라우저에서** 한다. 페이지가 정적으로
// 생성되므로 서버에서 걸러 내면 종료 시각이 지난 팝업이 다음 재생성까지 남는다.
// 그래서 서버는 '노출' 만 켜진 목록을 통째로 내려보내고, 여기서 지금·여기·이 기기에
// 맞는 것만 고른다.
//
// ⚠️ 그렇다고 **마운트를 기다리지는 않는다**. 예전에는 SSR 이 항상 null 이라 팝업 사진
// (첫 화면의 LCP 요소)이 하이드레이션이 끝나야 나타났다 — 실측 render delay 960ms.
// 지금은 이렇게 한다:
//   1) 서버가 후보를 **두 기기 × 모든 자리**로 다 그린다. 단, 전부 인라인
//      `display:none` 이고 <img> 에는 src 가 없다(반대 기기 사진을 받지 않게).
//   2) 마크업 바로 뒤의 **인라인 게이트 스크립트**가 파싱 도중 동기 실행돼, 뜰 한 장의
//      숨김을 걷고 data-src → src 로 옮긴다. 첫 페인트에 이미 팝업이 있다.
//   3) 하이드레이션 뒤 React 가 **같은 트리 모양 그대로** 상태로 이어받는다(카드가
//      다시 만들어지지 않으므로 사진을 다시 받지도, 깜빡이지도 않는다).
// 판정 규칙의 단일 출처는 lib/popup-visibility.ts 이고, 게이트가 실행하는 ES5 사본과
// 어긋나지 않는지는 `npm run check:popup` 이 지킨다.
//
// 딤(배경 어둡게)과 스크롤 잠금은 일부러 넣지 않는다 — Lenis(부드러운 스크롤)와
// 충돌해 페이지가 얼어붙는다.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { PopupRecord } from '@/lib/content-runtime';
import {
  POPUP_DESKTOP_DOTS_H,
  POPUP_POSITIONS,
  popupPosition,
  type PopupDevice,
  type PopupMobilePosition,
} from '@/lib/popup-positions';
import {
  POPUP_GATE_CSS,
  isPopupHidden,
  popupGateRecords,
  popupGateScript,
  rememberPopupHide,
  sectionOf,
  selectVisiblePopups,
} from '@/lib/popup-visibility';
import { nowKst } from '@/lib/utils';
import {
  POPUP_DOT_OFF,
  POPUP_DOT_ON,
  PopupDesktop,
  PopupGroup,
  PopupMobile,
  PopupStack,
} from './popup';

interface Labels {
  close: string;
  hideToday: string;
  dialog: string;
}

interface Props {
  popups: PopupRecord[];
  locale: string;
  labels: Labels;
}

function localized(v: { ko: string; en: string } | undefined, locale: string): string {
  if (!v) return '';
  return (locale === 'en' ? v.en : v.ko) || v.ko || '';
}

const DEVICES: readonly PopupDevice[] = ['desktop', 'mobile'];

/** 이 기기에 뜰 수 있는 항목인가 — 시각·숨김과 달리 **서버가 아는** 조건이라
 *  여기서 거른다(안 뜨는 기기의 마크업을 아예 만들지 않는다). */
function forDevice(p: PopupRecord, device: PopupDevice): boolean {
  const devices = p.devices?.length ? p.devices : ['desktop', 'mobile'];
  return devices.includes(device);
}

/** 이 기기에서 이 항목이 앉을 위치 키 (옛 값·오타는 기본 위치로) */
function positionOf(p: PopupRecord, device: PopupDevice): string {
  return popupPosition(device, device === 'mobile' ? p.positionMobile : p.positionDesktop).key;
}

export function PopupNotice({ popups, locale, labels }: Props) {
  const pathname = usePathname();
  // 마운트 전(서버·하이드레이션 첫 렌더)은 null — **트리는 그대로 그리고** 전부 숨긴
  // 채로 둔다. 이 값이 채워지는 순간부터 표시를 React 가 쥔다.
  const [shown, setShown] = useState<{ device: PopupDevice; ids: string[] } | null>(null);
  // 자리(device:position)별 캐러셀 위치
  const [picked, setPicked] = useState<Record<string, number>>({});

  useEffect(() => {
    if (popups.length === 0) return;
    const device: PopupDevice = window.matchMedia('(max-width: 767px)').matches
      ? 'mobile'
      : 'desktop';
    // 인라인 게이트와 **같은 함수·같은 입력** — 다르면 첫 페인트에 뜬 팝업이 사라진다
    const ids = selectVisiblePopups(popups, {
      section: sectionOf(pathname),
      device,
      now: nowKst(),
      isHidden: isPopupHidden,
    }).map((p) => p.id);
    setShown({ device, ids });
    document.documentElement.setAttribute('data-popup-hydrated', '1');
  }, [popups, pathname]);

  const dismiss = useCallback((id: string, remember: boolean) => {
    if (remember) rememberPopupHide(id);
    setShown((cur) => (cur ? { ...cur, ids: cur.ids.filter((x) => x !== id) } : cur));
  }, []);

  // Esc 로 마지막에 열린 창을 닫는다(기억하지 않는 단순 닫기)
  const openCount = shown?.ids.length ?? 0;
  useEffect(() => {
    if (openCount === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setShown((cur) => (cur ? { ...cur, ids: cur.ids.slice(0, -1) } : cur));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openCount]);

  // 게이트가 판정에 쓰는 최소 데이터(id·페이지·기기·기간)만 스크립트로 내려보낸다
  const gate = useMemo(
    () =>
      popupGateScript(popupGateRecords(popups), {
        dotsH: POPUP_DESKTOP_DOTS_H,
        dotOn: POPUP_DOT_ON,
        dotOff: POPUP_DOT_OFF,
      }),
    [popups],
  );

  if (popups.length === 0) return null;

  const byId = new Map(popups.map((p) => [p.id, p]));

  return (
    <>
      {/* 기기 분기의 CSS 안전망 — 게이트가 못 돌아도 반대 기기 팝업은 켜지지 않는다 */}
      <style dangerouslySetInnerHTML={{ __html: POPUP_GATE_CSS }} />
      {DEVICES.map((device) =>
        POPUP_POSITIONS[device].map(({ key: position }) => {
          // 같은 자리에 여러 개면 한 장씩(캐러셀) — 겹쳐 쌓지 않는다
          const group = popups.filter(
            (p) => forDevice(p, device) && positionOf(p, device) === position,
          );
          if (group.length === 0) return null;
          const slot = `${device}:${position}`;
          const ids = group.map((p) => p.id);
          // 마운트 전에는 아무것도 뜨지 않는다(게이트가 DOM 을 직접 켠다)
          const open = shown?.device === device ? shown.ids.filter((id) => ids.includes(id)) : [];
          const index = open.length ? Math.min(picked[slot] ?? 0, open.length - 1) : -1;
          const activeId = index >= 0 ? open[index] : undefined;
          return (
            <div
              key={slot}
              data-popup-gate={slot}
              className="contents"
              style={open.length ? undefined : { display: 'none' }}
              suppressHydrationWarning
            >
              <PopupGroup device={device} position={position}>
                <PopupStack
                  device={device}
                  ids={ids}
                  visible={open}
                  index={index}
                  onSelect={(i) => setPicked((cur) => ({ ...cur, [slot]: i }))}
                  card={(id, dots) => {
                    const p = byId.get(id)!;
                    // 모바일 전용 사진으로 바꿔 그리는가 — 비율(imageAspect)은 **PC 사진**을
                    // 재서 저장한 값이라, 다른 파일을 그릴 때 그대로 쓰면 자리를 틀리게 잡는다.
                    const swapped = device === 'mobile' && !!p.imageMobile;
                    const card = {
                      image: swapped ? p.imageMobile! : p.image,
                      alt: localized(p.title, locale),
                      link: p.link || undefined,
                      newTab: p.newTab === true,
                      labels,
                      closeControl: p.closeControl ?? ('close' as const),
                      hideTodayButton: p.hideTodayButton !== false,
                      // PC 카드 폭 — 없으면(옛 항목) 카드가 기본 360px 로 보정한다.
                      // 모바일 카드는 이 값을 무시한다(전폭 시트).
                      width: p.widthDesktop,
                      // 사진 비율 — 화면에 안 들어가면 카드째 이 비율로 줄어든다.
                      // 모바일 전용 사진으로 바꿔 그릴 때는 비율을 모르는 것으로 둔다(위 주석).
                      aspect: swapped ? undefined : p.imageAspect,
                      // 지금 이 자리에서 실제로 보이는 한 장만 사진을 받는다
                      defer: id !== activeId,
                      onDismiss: (remember: boolean) => dismiss(id, remember),
                    };
                    return device === 'mobile' ? (
                      <PopupMobile position={position as PopupMobilePosition} {...card}>
                        {dots}
                      </PopupMobile>
                    ) : (
                      <PopupDesktop {...card} />
                    );
                  }}
                />
              </PopupGroup>
            </div>
          );
        }),
      )}
      {/* 마크업 **바로 뒤** — 팝업 노드는 이미 있고 첫 페인트는 아직인 그 사이에 실행된다.
          자체 생성 문자열이고 데이터의 '<' 는 이스케이프한다(popup-visibility.ts) */}
      <script dangerouslySetInnerHTML={{ __html: gate }} />
    </>
  );
}
