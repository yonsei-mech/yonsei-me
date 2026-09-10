// 팝업 공지 **노출 판정**의 단일 출처.
//
// 판정을 두 곳이 쓴다. (1) React(PopupNotice)가 마운트 뒤에, (2) 하이드레이션보다
// 훨씬 먼저 도는 **인라인 게이트 스크립트**가 첫 페인트 전에. 둘이 다른 답을 내면
// "첫 화면에 떴다가 1초 뒤 사라지는" 최악의 증상이 나오므로, 규칙은 여기 한 곳에만 둔다.
//
// ⚠️ 그래도 규칙은 물리적으로 두 벌이다 — TS 원본 `selectVisiblePopups` 와, 게이트가
//    `<script>` 안에서 실행할 **ES5 문자열 사본** `POPUP_GATE_SELECT_SOURCE`.
//    한쪽만 고치면 안 된다. 고친 뒤에는 반드시 `npm run check:popup`
//    (tools/popup/check-gate-parity.mjs — 두 벌을 30+ 케이스로 대조)을 돌려라.
//
// 이 파일에는 **런타임 import 가 하나도 없다**(타입만 import). 검증 하네스가 Node 로
// 그대로 불러 쓰기 때문이다 — 값 import 를 추가하면 하네스가 깨진다.

import type { PopupDevice } from './popup-positions';

/** 게이트가 판정에 쓰는 최소 필드 — 이 이상은 `<script>` 로 내려보내지 않는다 */
export interface PopupGateRecord {
  id: string;
  /** 노출 페이지(경로 첫 세그먼트, 홈은 'home'). 없으면 홈만 */
  pages?: string[];
  /** 노출 기기. 없으면 둘 다 */
  devices?: string[];
  /** 'YYYY-MM-DDTHH:mm' (KST) */
  start?: string;
  end?: string;
}

export interface PopupVisibilityContext {
  /** 경로 첫 세그먼트(로케일 제외). 홈은 'home' */
  section: string;
  device: PopupDevice;
  /** 지금(KST) 'YYYY-MM-DDTHH:mm' — utils.nowKst() 와 같은 형식 */
  now: string;
  /** '오늘 하루 보지 않기' 로 숨겨 둔 항목인가 */
  isHidden: (id: string) => boolean;
}

/** 경로에서 로케일을 뺀 첫 세그먼트. 홈은 'home'
 *  (첫 세그먼트는 언제나 로케일이다 — routing 의 localePrefix: 'always') */
export function sectionOf(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  return segs[1] ?? 'home';
}

/** localStorage 키 접두사 — 게이트 스크립트의 문자열과 같은 값이어야 한다 */
export const POPUP_HIDE_PREFIX = 'popup-hide:';

export function popupHideKey(id: string): string {
  return `${POPUP_HIDE_PREFIX}${id}`;
}

/** '오늘 하루 보지 않기' 의 만료 시각(epoch ms) = 다음날 00:00 KST.
 *  KST 는 UTC+9 고정(서머타임 없음)이라 UTC 로 9시간 밀어 날짜만 뽑는다. */
export function popupHideUntil(nowMs: number = Date.now()): number {
  const kstDay = new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return Date.parse(`${kstDay}T00:00:00+09:00`) + 24 * 60 * 60 * 1000;
}

/** 브라우저 전용 — 저장소가 막힌 브라우저(프라이빗 모드)는 '숨김 기록 없음' 으로 본다 */
export function isPopupHidden(id: string): boolean {
  try {
    const raw = window.localStorage.getItem(popupHideKey(id));
    return raw !== null && Number(raw) > Date.now();
  } catch {
    return false;
  }
}

/** 브라우저 전용 — 저장 실패는 무시한다(이번 방문 동안만 닫힌다) */
export function rememberPopupHide(id: string): void {
  try {
    window.localStorage.setItem(popupHideKey(id), String(popupHideUntil()));
  } catch {
    /* noop */
  }
}

/**
 * 지금·여기·이 기기에 뜰 팝업만 (입력 순서 유지).
 *
 * ⚠️ 규칙과 **순서**를 바꾸면 아래 POPUP_GATE_SELECT_SOURCE 도 같이 바꿔야 한다.
 */
export function selectVisiblePopups<T extends PopupGateRecord>(
  popups: readonly T[],
  ctx: PopupVisibilityContext,
): T[] {
  return popups.filter((p) => {
    const pages = p.pages?.length ? p.pages : ['home'];
    if (!pages.includes(ctx.section)) return false;
    const devices = p.devices?.length ? p.devices : ['desktop', 'mobile'];
    if (!devices.includes(ctx.device)) return false;
    if (p.start && ctx.now < p.start) return false;
    if (p.end && ctx.now > p.end) return false;
    return !ctx.isHidden(p.id);
  });
}

/** `<script>` 로 내려보낼 판정용 최소 데이터 — 사진·제목·위치는 이미 DOM 에 있다 */
export function popupGateRecords(popups: readonly PopupGateRecord[]): PopupGateRecord[] {
  return popups.map((p) => ({
    id: p.id,
    pages: p.pages,
    devices: p.devices,
    start: p.start,
    end: p.end,
  }));
}

/**
 * selectVisiblePopups 의 **ES5 사본**(게이트가 실행할 함수 소스).
 * `(records, ctx) => id[]` — 반환이 레코드가 아니라 id 배열인 것만 다르다.
 *
 * ⚠️ 위 selectVisiblePopups 와 한 글자도 다른 판정을 하면 안 된다.
 *    `npm run check:popup` 이 이 문자열을 그대로 평가해 대조한다.
 */
export const POPUP_GATE_SELECT_SOURCE =
  'function(records,ctx){' +
  'var out=[];' +
  'for(var i=0;i<records.length;i++){' +
  'var p=records[i];' +
  "var pages=(p.pages&&p.pages.length)?p.pages:['home'];" +
  'if(pages.indexOf(ctx.section)<0)continue;' +
  "var devices=(p.devices&&p.devices.length)?p.devices:['desktop','mobile'];" +
  'if(devices.indexOf(ctx.device)<0)continue;' +
  'if(p.start&&ctx.now<p.start)continue;' +
  'if(p.end&&ctx.now>p.end)continue;' +
  'if(ctx.isHidden(p.id))continue;' +
  'out.push(p.id);' +
  '}' +
  'return out;' +
  '}';

/** 게이트가 색·치수를 하드코딩하지 않게 렌더 쪽에서 받아 오는 값들 */
export interface PopupGateTheme {
  /** 카드 아래 점이 차지하는 높이(px) — POPUP_DESKTOP_DOTS_H */
  dotsH: number;
  /** 활성 점 색 */
  dotOn: string;
  /** 비활성 점 색 */
  dotOff: string;
}

/**
 * 기기 분기의 **CSS 안전망**. 게이트가 어떤 이유로든 못 돌아도 반대 기기의 팝업이
 * 켜지는 일은 없어야 한다 — `!important` 라 인라인 style 도 이긴다.
 * 경계(767/768)는 PopupNotice·popup-image 의 matchMedia 와 같은 값이다.
 */
export const POPUP_GATE_CSS =
  '@media (max-width:767px){[data-popup-gate^="desktop:"]{display:none!important}}' +
  '@media (min-width:768px){[data-popup-gate^="mobile:"]{display:none!important}}';

/**
 * 인라인 게이트 스크립트. 팝업 마크업 **바로 뒤**에 놓여 파싱 도중 동기 실행된다 —
 * 노드는 이미 있고 첫 페인트는 아직이다.
 *
 * 하는 일은 셋뿐이다.
 *  1) 지금 뜰 팝업 id 를 고른다(POPUP_GATE_SELECT_SOURCE).
 *  2) 그 기기·자리의 래퍼와 **첫 번째로 보이는 카드**의 인라인 display:none 을 걷어낸다
 *     (보이는 상태의 display 는 클래스가 정한다 — 래퍼/카드는 `contents`).
 *  3) 그 카드의 <img> 에만 data-src/-srcset/-sizes 를 진짜 속성으로 옮긴다.
 *     서버는 src 를 아예 달지 않는다 — 그래야 반대 기기 사진을 받지 않는다.
 *     (필요한 바이트는 <head> 의 preload 가 이미 받고 있다.)
 * 나머지(점 개수·색·세로 예산)는 하이드레이션 뒤 React 가 그대로 이어받는다.
 *
 * 시각은 Intl 없이 UTC+9 로 민다 — utils.nowKst() 와 같은 문자열이 나온다(KST 고정).
 */
export function popupGateScript(records: PopupGateRecord[], theme: PopupGateTheme): string {
  // </script> · <!-- 가 데이터에 섞여도 스크립트가 끊기지 않게 '<' 를 이스케이프한다
  const json = JSON.stringify(records).replace(/</g, '\\u003c');
  return (
    '(function(){try{' +
    `var R=${json},S=(${POPUP_GATE_SELECT_SOURCE}),i,g,c;` +
    "var raw=location.pathname.split('/'),segs=[];" +
    'for(i=0;i<raw.length;i++){if(raw[i])segs.push(raw[i]);}' +
    "var device=(window.matchMedia&&window.matchMedia('(max-width: 767px)').matches)?'mobile':'desktop';" +
    'var now=new Date(Date.now()+32400000).toISOString().slice(0,16);' +
    'var ids=S(R,{' +
    "section:segs[1]||'home',device:device,now:now," +
    'isHidden:function(id){try{' +
    `var v=window.localStorage.getItem('${POPUP_HIDE_PREFIX}'+id);` +
    'return v!==null&&Number(v)>Date.now();' +
    '}catch(e){return false;}}' +
    '});' +
    "var d=document.documentElement;d.setAttribute('data-popup-ready','1');" +
    'if(!ids.length)return;' +
    "d.setAttribute('data-popup-show',ids.join(' '));" +
    'var on={};for(i=0;i<ids.length;i++){on[ids[i]]=1;}' +
    "var groups=document.querySelectorAll('[data-popup-gate]');" +
    'for(g=0;g<groups.length;g++){' +
    'var box=groups[g];' +
    "if(box.getAttribute('data-popup-gate').split(':')[0]!==device)continue;" +
    "var cards=box.querySelectorAll('[data-popup-id]'),vis=[];" +
    "for(c=0;c<cards.length;c++){if(on[cards[c].getAttribute('data-popup-id')])vis.push(cards[c]);}" +
    'if(!vis.length)continue;' +
    "box.style.display='';vis[0].style.display='';" +
    "var img=vis[0].querySelector('img[data-src]');" +
    'if(img){' +
    "var sz=img.getAttribute('data-sizes'),ss=img.getAttribute('data-srcset');" +
    "if(sz)img.setAttribute('sizes',sz);" +
    "if(ss)img.setAttribute('srcset',ss);" +
    "img.setAttribute('src',img.getAttribute('data-src'));" +
    '}' +
    'if(vis.length>1){' +
    "var dots=device==='mobile'?vis[0].querySelector('[data-popup-dots]'):box.querySelector('[data-popup-dots]');" +
    'if(dots){' +
    "dots.style.display='';" +
    "if(device!=='mobile'&&dots.parentNode&&dots.parentNode.style)" +
    `dots.parentNode.style.setProperty('--popup-dots-h','${theme.dotsH}px');` +
    "var bs=dots.querySelectorAll('[data-popup-dot]');" +
    'for(i=0;i<bs.length&&i<vis.length;i++){' +
    "bs[i].style.display='';" +
    `bs[i].style.backgroundColor=i===0?'${theme.dotOn}':'${theme.dotOff}';` +
    '}' +
    "if(bs.length)bs[0].setAttribute('aria-current','true');" +
    '}}}' +
    '}catch(e){}})()'
  );
}
