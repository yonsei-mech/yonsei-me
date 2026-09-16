// 업로드 공통 검증 — 서버 경유(/api/upload-file)와 presigned(/api/upload-url)가
// 동일한 경로·용량·MIME 규칙을 공유한다(규칙이 갈라지면 우회 구멍이 생긴다).
//
// 용량 한도는 세 갈래다: 영상 200MB · PDF 100MB · 그 외 첨부 20MB
// (연구실 소개 영상을 링크 대신 파일로 올릴 수 있게 하면서 갈라졌고, BK21
//  사업계획서·보고서를 통 PDF 로 올리면서 PDF 가 또 갈라졌다 —
//  maxUploadBytesFor() 한 함수만 보면 되도록 판정을 여기 모아 둔다).
// ⚠️ 4MB 를 넘는 업로드는 이미 presigned PUT(브라우저 → R2 직행)이라 서버 본문
//    한도(SERVER_RELAY_MAX)와 무관하다 — 상한을 올려도 함수 본문을 키우지 않는다.

/** 첨부 허용 최대 크기 (이미지는 클라이언트에서 압축 후 도착) */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

/** 영상 파일 허용 최대 크기 — 1080p 수 분짜리 소개 영상을 담을 수 있는 선 */
export const MAX_VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB

/** PDF 허용 최대 크기 — 스캔 원본을 통으로 올리는 문서(BK21 보고서 900여 쪽)를 담는 선 */
export const MAX_PDF_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB

/** 서버 경유 최대 크기 — Vercel 함수 본문 한도(4.5MB) 안쪽 */
export const SERVER_RELAY_MAX = 4 * 1024 * 1024;

/** 허용 MIME — 이미지·문서류. 관리자 전용이라 과도하게 좁히지 않는다. */
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/haansofthwp',
  'application/x-hwp',
  'application/vnd.hancom.hwp',
  'application/vnd.hancom.hwpx',
  'application/octet-stream', // hwp 등 브라우저가 타입을 모르는 문서
  // 연구실 소개 영상(파일 업로드) — <video> 로 바로 재생한다
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
];

/** 브라우저가 실행·렌더할 수 있어 저장을 거부하는 타입 (스토리지 도메인 피싱·XSS 예방) */
const BLOCKED_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/xml',
  'text/xml',
  'application/javascript',
  'text/javascript',
]);

/** 확장자 기반 안전목록 — 브라우저 MIME 추정이 제각각인 문서·이미지·압축.
 *  (특히 hwp/hwpx 는 시스템마다 빈 값·x-hwp·vnd.hancom.hwp 등으로 다르다) */
const SAFE_EXTENSIONS = new Set([
  'hwp', 'hwpx', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'txt', 'csv', 'jpg', 'jpeg', 'png', 'webp', 'gif',
  'mp4', 'webm', 'mov', 'm4v',
]);

/** 확장자 → 영상 MIME. 저장 시 실제 타입을 확정하는 데 쓴다.
 *  (브라우저가 .mov·.m4v 에 빈 타입을 주는 일이 잦다 — 그때 이 표로 구제한다) */
const VIDEO_TYPE_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/** 영상 업로드인지 — 타입이 비어 있어도 확장자로 판정한다 */
export function isVideoUpload(
  contentType: string | null | undefined,
  pathname?: string,
): boolean {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type.startsWith('video/')) return true;
  const ext = (pathname?.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  return ext in VIDEO_TYPE_BY_EXT;
}

/** PDF 업로드인지 — 타입이 비어 있어도 확장자로 판정한다(영상 판정과 같은 관례) */
export function isPdfUpload(
  contentType: string | null | undefined,
  pathname?: string,
): boolean {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/pdf') return true;
  return /\.pdf$/i.test(pathname ?? '');
}

/** 이 업로드에 적용할 용량 상한 — 영상 200MB · PDF 100MB · 나머지 20MB */
export function maxUploadBytesFor(
  contentType: string | null | undefined,
  pathname?: string,
): number {
  if (isVideoUpload(contentType, pathname)) return MAX_VIDEO_UPLOAD_BYTES;
  if (isPdfUpload(contentType, pathname)) return MAX_PDF_UPLOAD_BYTES;
  return MAX_UPLOAD_BYTES;
}

export type UploadValidation =
  | { ok: true; contentType: string }
  | { ok: false; status: number; error: string };

/**
 * 경로·타입 공통 검증. 통과 시 실제 저장할 contentType 을 확정해 돌려준다
 * (명시 허용 타입은 그대로, 확장자로 구제된 타입은 octet-stream 으로 강등).
 */
export function validateUpload(pathname: string, rawContentType: string | null): UploadValidation {
  if (!pathname.startsWith('uploads/')) {
    return { ok: false, status: 400, error: '허용되지 않은 업로드 경로입니다.' };
  }
  const rawType = (rawContentType ?? '').split(';')[0].trim().toLowerCase();
  if (BLOCKED_TYPES.has(rawType)) {
    return { ok: false, status: 415, error: '허용되지 않은 파일 형식입니다.' };
  }
  const ext = (pathname.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  const typeAllowed = ALLOWED_TYPES.includes(rawType);
  if (!typeAllowed && !SAFE_EXTENSIONS.has(ext)) {
    return { ok: false, status: 415, error: '허용되지 않은 파일 형식입니다.' };
  }
  if (typeAllowed) return { ok: true, contentType: rawType };
  // 확장자로 구제된 영상은 octet-stream 으로 강등하면 안 된다 — R2 는 저장된
  // Content-Type 을 그대로 서빙하고, <video>·Safari 는 octet-stream 을 재생하지
  // 않는다(문서류와 달리 "내려받기"가 목적이 아니다). 확장자로 실제 타입을 채운다.
  const videoType = VIDEO_TYPE_BY_EXT[ext];
  if (videoType) return { ok: true, contentType: videoType };
  return { ok: true, contentType: 'application/octet-stream' };
}
