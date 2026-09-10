// 팝업 공지 **사진 전달**의 단일 출처 — 카드가 그리는 <img> 와 홈이 심는
// <link rel="preload"> 가 **같은 URL·같은 후보군·같은 sizes** 를 쓰게 하는 모듈이다.
//
// 두 곳이 어긋나면 preload 가 통째로 낭비된다(브라우저가 다른 후보를 고르면 사진을
// 두 번 받는다). 그래서 폭 후보·기본 폭·sizes 계산을 여기 한 곳에 둔다.
//
// 최적화는 Next 이미지 라우트(/_next/image)가 한다 — 리사이즈·AVIF/WebP·캐시 헤더.
// next/image 컴포넌트를 쓰지 않는 이유는 lib/image-url.ts 주석 참조(치수를 모르는
// CMS 사진). 통과하지 못하는 소스(blob:/data: 미리보기·SVG·허용 밖 호스트)는
// null 을 돌려주고, 호출측은 **원본 URL 을 그대로** 쓴다.
//
// ⚠️ 폭 후보는 next.config 의 deviceSizes 에 있는 값이어야 한다(그 외는 400 으로
//    떨어진다). 640·750·828·1080 은 팝업 카드가 실제로 갖는 크기 범위다 —
//    PC 카드는 기본 360px(DPR2 = 720), 모바일은 전폭(390~430, DPR3 = 1170+).

import { canOptimizeImage, optimizedImageUrl, optimizedSrcSet } from '@/lib/image-url';
import { popupDesktopWidth, type PopupDevice } from '@/lib/popup-positions';

/** srcset 후보 폭 — 팝업 카드가 실제로 갖는 CSS 폭 × DPR 범위를 덮는다 */
export const POPUP_IMAGE_WIDTHS = [640, 750, 828, 1080] as const;

/** srcset 을 못 읽는 곳(preload 의 href, src 폴백)이 쓸 기본 폭 */
export const POPUP_IMAGE_WIDTH = 828;

/** sizes — PC 는 카드 폭 그대로, 모바일은 전폭 시트라 100vw.
 *  ⚠️ PC 카드는 세로 예산에 따라 이보다 **작아질 수 있다**(popupDesktopWidthCss).
 *  그래도 여기서는 저장 폭을 쓴다 — preload 와 <img> 가 같은 문자열을 써서 같은
 *  후보를 고르는 것이 (몇 KB 덜 받는 것보다) 중요하기 때문이다. */
export function popupImageSizes(device: PopupDevice, width?: number): string {
  return device === 'mobile' ? '100vw' : `${popupDesktopWidth(width)}px`;
}

/** <img> 에 얹을 최적화 속성 묶음. 최적화할 수 없는 소스면 null */
export interface PopupImageDelivery {
  src: string;
  srcSet: string;
  sizes: string;
}

export function popupImageDelivery(
  image: string | undefined | null,
  device: PopupDevice,
  width?: number,
): PopupImageDelivery | null {
  if (!canOptimizeImage(image)) return null;
  return {
    src: optimizedImageUrl(image, POPUP_IMAGE_WIDTH),
    srcSet: optimizedSrcSet(image, POPUP_IMAGE_WIDTHS),
    sizes: popupImageSizes(device, width),
  };
}

/** <link rel="preload" as="image"> 한 줄에 필요한 값 */
export interface PopupImagePreload {
  key: string;
  href: string;
  /** 최적화 못 하는 소스면 없다(원본 href 만 심는다) */
  imageSrcSet?: string;
  imageSizes?: string;
  /** 기기 분기 — PopupNotice 의 matchMedia('(max-width: 767px)') 와 같은 경계 */
  media: string;
}

/** 팝업 하나가 필요로 하는 preload 목록(기기별 0~2줄).
 *  ⚠️ 기기 판정은 브라우저가 미디어 쿼리로 한다 — 서버는 화면 폭을 모르므로
 *  두 줄을 다 심고 맞는 쪽만 받게 한다(안 맞는 쪽은 요청되지 않는다). */
export function popupImagePreloads(p: {
  id: string;
  image: string;
  imageMobile?: string;
  widthDesktop?: number;
  devices?: string[];
}): PopupImagePreload[] {
  const devices = p.devices?.length ? p.devices : ['desktop', 'mobile'];
  const out: PopupImagePreload[] = [];
  const add = (key: string, image: string, device: PopupDevice, media: string) => {
    if (!image) return;
    const opt = popupImageDelivery(image, device, p.widthDesktop);
    out.push(
      opt
        ? { key, href: opt.src, imageSrcSet: opt.srcSet, imageSizes: opt.sizes, media }
        : { key, href: image, media },
    );
  };
  if (devices.includes('desktop')) add(`${p.id}-desktop`, p.image, 'desktop', '(min-width: 768px)');
  if (devices.includes('mobile')) {
    add(`${p.id}-mobile`, p.imageMobile || p.image, 'mobile', '(max-width: 767px)');
  }
  return out;
}
