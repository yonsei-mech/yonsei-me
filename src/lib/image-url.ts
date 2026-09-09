/**
 * Next 이미지 라우트(/_next/image) URL 을 손으로 만드는 헬퍼.
 *
 * next/image 컴포넌트를 쓸 수 없는 자리에서 쓴다 — <picture> 아트디렉션(히어로),
 * background-image(연구실 카드), 치수를 모르는 CMS 사진(<img>, 팝업). 최적화(리사이즈·
 * AVIF/WebP·캐시 헤더)는 그대로 Next 이미지 라우트가 하고 URL 형식만 여기서 맞춘다.
 *
 * ⚠️ w 는 next.config 의 deviceSizes(기본 640·750·828·1080·1200·1920·2048·3840)나
 *    imageSizes 에 있는 값만 허용된다 — 그 외 값은 400 으로 떨어진다.
 * ⚠️ 원격 URL 은 next.config `images.remotePatterns` 에 열린 호스트만 통과한다.
 *    목록은 그 파일이 단일 출처이므로, 여기 canOptimizeImage 를 고칠 때 함께 맞춘다.
 */

export const IMAGE_OPT_WIDTHS = [640, 750, 828, 1080, 1200, 1920, 2048] as const;
export const IMAGE_OPT_QUALITY = 75;

/** remotePatterns 와 같은 호스트 규칙(와일드카드는 한 레이블만) */
const OPTIMIZABLE_HOSTS = [/(^|\.)r2\.dev$/, /\.public\.blob\.vercel-storage\.com$/, /\.yonsei\.ac\.kr$/];

/**
 * 이미지 라우트로 보낼 수 있는 소스인지. 로컬 public 경로('/img/…')와 허용 호스트의
 * https URL 만 참이다. blob:/data:(에디터 미리보기)·SVG(dangerouslyAllowSVG 미설정)·
 * 프로토콜 상대 URL 은 거짓 — 호출자는 이때 원본 URL 을 그대로 쓴다.
 */
export function canOptimizeImage(src: string | undefined | null): src is string {
  if (!src) return false;
  if (/\.svg(\?|#|$)/i.test(src)) return false;
  if (src.startsWith('/')) return !src.startsWith('//');
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return OPTIMIZABLE_HOSTS.some((re) => re.test(url.hostname));
}

/** /_next/image?url=…&w=…&q=… — width 는 IMAGE_OPT_WIDTHS 중 하나여야 한다 */
export function optimizedImageUrl(
  src: string,
  width: number,
  quality: number = IMAGE_OPT_QUALITY,
): string {
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
}

/** srcset 문자열 — 폭 후보마다 한 항목 */
export function optimizedSrcSet(
  src: string,
  widths: readonly number[] = IMAGE_OPT_WIDTHS,
  quality: number = IMAGE_OPT_QUALITY,
): string {
  return widths.map((w) => `${optimizedImageUrl(src, w, quality)} ${w}w`).join(', ');
}
