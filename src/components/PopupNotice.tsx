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
// 마운트 뒤에야 표시를 결정한다(SSR·첫 렌더는 항상 null) — 시각·화면폭·localStorage
// 는 서버가 알 수 없어 그대로 그리면 하이드레이션이 어긋난다.
//
// 딤(배경 어둡게)과 스크롤 잠금은 일부러 넣지 않는다 — Lenis(부드러운 스크롤)와
// 충돌해 페이지가 얼어붙는다.

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { PopupRecord } from '@/lib/content-runtime';
import {
  POPUP_POSITIONS,
  popupPosition,
  type PopupMobilePosition,
} from '@/lib/popup-positions';
import { PopupCarousel, PopupDesktop, PopupGroup, PopupMobile } from './popup';

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

/** 지금(KST)을 'YYYY-MM-DDTHH:mm' 로 — CMS 가 저장한 문자열과 그대로 비교한다 */
function nowKst(): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  // sv-SE 는 'YYYY-MM-DD HH:mm' 을 준다 — 사이 공백만 T 로 바꾼다
  return parts.replace(' ', 'T');
}

/** 다음날 00:00 KST 의 epoch ms — "오늘 하루 보지 않기" 의 만료 시각 */
function tomorrowKstMs(): number {
  const today = nowKst().slice(0, 10);
  // KST = UTC+9 고정(서머타임 없음) — 오늘 00:00 KST 를 UTC 로 환산해 하루 더한다
  return Date.parse(`${today}T00:00:00+09:00`) + 24 * 60 * 60 * 1000;
}

function hideKey(id: string): string {
  return `popup-hide:${id}`;
}

function isHidden(id: string): boolean {
  try {
    const raw = window.localStorage.getItem(hideKey(id));
    return raw !== null && Number(raw) > Date.now();
  } catch {
    // 프라이빗 모드 등 저장소가 막힌 브라우저 — 숨김 기록이 없는 것으로 본다
    return false;
  }
}

function rememberHide(id: string): void {
  try {
    window.localStorage.setItem(hideKey(id), String(tomorrowKstMs()));
  } catch {
    /* 저장 실패는 무시 — 이번 방문 동안만 닫힌다 */
  }
}

/** 경로에서 로케일을 뺀 첫 세그먼트. 홈은 'home' */
function sectionOf(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  // 첫 세그먼트는 언제나 로케일이다(localePrefix: 'always')
  return segs[1] ?? 'home';
}

function localized(v: { ko: string; en: string } | undefined, locale: string): string {
  if (!v) return '';
  return (locale === 'en' ? v.en : v.ko) || v.ko || '';
}

export function PopupNotice({ popups, locale, labels }: Props) {
  const pathname = usePathname();
  const [visible, setVisible] = useState<PopupRecord[]>([]);
  // 기기는 마운트 뒤에 정해진다(서버는 화면 폭을 모른다). null = 아직 판정 전.
  const [device, setDevice] = useState<'desktop' | 'mobile' | null>(null);

  useEffect(() => {
    if (popups.length === 0) return;
    const section = sectionOf(pathname);
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const dev = mobile ? 'mobile' : 'desktop';
    const now = nowKst();
    setDevice(dev);

    setVisible(
      popups.filter((p) => {
        const pages = p.pages?.length ? p.pages : ['home'];
        if (!pages.includes(section)) return false;
        const devices = p.devices?.length ? p.devices : ['desktop', 'mobile'];
        if (!devices.includes(dev)) return false;
        if (p.start && now < p.start) return false;
        if (p.end && now > p.end) return false;
        return !isHidden(p.id);
      }),
    );
  }, [popups, pathname]);

  const dismiss = useCallback((p: PopupRecord, remember: boolean) => {
    if (remember) rememberHide(p.id);
    setVisible((cur) => cur.filter((x) => x.id !== p.id));
  }, []);

  // Esc 로 마지막에 열린 창을 닫는다(기억하지 않는 단순 닫기)
  useEffect(() => {
    if (visible.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setVisible((cur) => cur.slice(0, -1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible.length]);

  if (visible.length === 0 || device === null) return null;

  /** 이 기기에서 이 항목이 앉을 위치 키 (옛 값·오타는 기본 위치로) */
  const positionOf = (p: PopupRecord) =>
    popupPosition(device, device === 'mobile' ? p.positionMobile : p.positionDesktop).key;

  return (
    <>
      {POPUP_POSITIONS[device].map(({ key: position }) => {
        // 같은 자리에 여러 개면 한 장씩(캐러셀) — 겹쳐 쌓지 않는다
        const group = visible.filter((p) => positionOf(p) === position);
        if (group.length === 0) return null;
        return (
          <PopupGroup key={position} device={device} position={position}>
            <PopupCarousel device={device} count={group.length}>
              {(index, dots) => {
                const p = group[index];
                const card = {
                  image: (device === 'mobile' && p.imageMobile) || p.image,
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
                  aspect: p.imageAspect,
                  onDismiss: (remember: boolean) => dismiss(p, remember),
                };
                return device === 'mobile' ? (
                  <PopupMobile key={p.id} position={position as PopupMobilePosition} {...card}>
                    {dots}
                  </PopupMobile>
                ) : (
                  <PopupDesktop key={p.id} {...card} />
                );
              }}
            </PopupCarousel>
          </PopupGroup>
        );
      })}
    </>
  );
}
