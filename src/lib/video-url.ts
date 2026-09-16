// 영상 URL 판별 — 서버·클라이언트 양쪽에서 부르므로 node 모듈을 import 하지 않는다.
//
// 연구실 소개 영상은 링크(YouTube·Google Drive)와 업로드 파일(R2 uploads/labs/…)이
// **같은 `video` 필드**에 섞여 들어온다. 어느 쪽인지에 따라 갤러리가 iframe 을 쓸지
// <video> 를 쓸지 갈리므로, 판별 규칙을 한 곳에 두고 CMS·사이트가 함께 쓴다.

/** 브라우저가 <video> 로 바로 재생할 수 있는 확장자 (업로드 허용 목록과 같아야 한다) */
export const VIDEO_FILE_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v'] as const;

/** URL/경로가 직접 재생하는 영상 파일인지 — 쿼리·해시를 뗀 경로의 확장자로 판정 */
export function isVideoFileUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  // R2 공개 URL 은 ?v=… 같은 캐시 버스터가, dev 경로는 해시가 붙을 수 있다.
  const path = url.trim().split('#')[0].split('?')[0];
  return /\.(mp4|webm|mov|m4v)$/i.test(path);
}
