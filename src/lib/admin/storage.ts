// 첨부파일 외부 스토리지(Cloudflare R2) 업로드 — 관리자 콘솔 전용(클라이언트).
//
// 텍스트 콘텐츠와 달리 바이너리(공지 첨부 등)는 R2 에 올리고 공개 URL 만 기록한다.
// (2026-07 백엔드 전환 Phase 1: Vercel Blob → R2. Blob Hobby 는 저장 1GB + 초과 시
//  차단이라 탈락, R2 는 무료 10GB + 전송 영구 무료.)
//
// 경로 선택:
//  - dev(NODE_ENV≠production): /api/dev-content 로 public/uploads/ 에 기록 —
//    실제 스토리지 없이 동일한 흐름을 검증한다(.gitignore, 커밋되지 않음).
//    본문은 **원시 바이너리 PUT**이다: 예전의 base64+JSON 은 200MB 영상에서
//    btoa 로 메모리를 3배 쓰고 진행률도 못 보여 줬다.
//  - 작은 파일(≤4MB, 대부분의 이미지·문서): 같은 출처 /api/upload-file 서버 경유 —
//    프록시·백신의 HTTPS 검사가 교차 출처 직접 업로드를 막는 환경(과거 Blob 74% 스톨)
//    에서도 통과한다. XHR upload.onprogress 로 실시간 %.
//  - 큰 파일(>4MB, 서버리스 본문 한도 초과): /api/upload-url 에서 presigned PUT 을
//    받아 R2 로 직접 업로드. ⚠ 교차 출처라 일부 사내망에서 막힐 수 있다(에러에 안내).

import type { RepoConfig } from './content-api';
import { MAX_UPLOAD_BYTES, maxUploadBytesFor, SERVER_RELAY_MAX } from './upload-validate';

export { MAX_UPLOAD_BYTES };

/** dev 로컬 백엔드(/api/dev-content → public/uploads/)를 써야 하는지.
 *  ⚠ 토큰 유무로 판별하면 안 된다 — 카카오·이메일 로그인 세션은 GitHub 토큰이 없어
 *  프로덕션에서도 dev 경로로 빠지고, /api/dev-content 는 프로덕션에서 404('Not found')다.
 *  서버 라우트들의 devBypass 와 같은 기준(NODE_ENV, 빌드 시점 인라인)을 쓴다. */
function isLocalBackend(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/** 업로드 진행 단계 — 폼이 사용자에게 "지금 무엇을 하는 중인지" 표시하는 데 쓴다. */
export type UploadPhase = 'preparing' | 'requesting' | 'uploading' | 'done';
export interface UploadProgress {
  phase: UploadPhase;
  /** 'uploading' 단계의 0~100. undefined 면 불확정 */
  percent?: number;
}
export type UploadProgressHandler = (p: UploadProgress) => void;

/** 사용자가 취소 버튼으로 중단한 경우 — 폼이 실패와 구분해 표시한다 */
export class UploadCancelledError extends Error {
  constructor() {
    super('업로드를 취소했습니다.');
    this.name = 'UploadCancelledError';
  }
}

/** 전송 정체 감시 시간 — **총 제한 시간이 아니다.**
 *  이 시간 동안 진행률 이벤트가 한 번도 없으면 끊는다. 예전의 절대 60초 타임아웃은
 *  200MB 영상처럼 정상적으로 오래 걸리는 업로드를 한창 진행 중에 잘라 버렸다. */
const UPLOAD_STALL_MS = 60_000;

/** 압축 대상 이미지 타입 (gif 는 애니메이션 보존을 위해 제외) */
const COMPRESSIBLE = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_DIMENSION = 1600; // 긴 변 기준 px
const WEBP_QUALITY = 0.82;
const COMPRESS_THRESHOLD = 300 * 1024; // 이보다 작으면 압축 생략

/** 파일명에서 경로 구분자·특수문자를 제거 (한글은 유지) */
function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|#%\s]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
}

/**
 * 이미지를 긴 변 MAX_DIMENSION 이하로 리사이즈하고 WebP 로 변환한다.
 * 압축 결과가 원본보다 크거나 변환에 실패하면 원본을 그대로 반환한다(무손실 폴백).
 */
async function compressImage(file: File, maxDim: number = MAX_DIMENSION): Promise<File> {
  if (!COMPRESSIBLE.includes(file.type) || file.size < COMPRESS_THRESHOLD) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // 투명 배경 PNG 를 그대로 WebP 로 옮기면 투명이 보존된다 — 교수 카드처럼 사진 아래에
    // 로딩 스피너를 깔아 두는 자리에서는 투명 영역으로 스피너가 계속 비쳐 "로딩이 안
    // 끝나는" 것처럼 보인다(2026-09 김영주 교수 사진 사고). 흰 바탕을 먼저 깔아 합성한다.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;
    const stem = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${stem}.webp`, { type: 'image/webp' });
  } catch {
    return file; // 압축 실패는 치명적이지 않다 — 원본 업로드
  }
}

/**
 * XHR 전송 공통기 — fetch 로는 업로드 진행률을 얻을 수 없어 XHR 을 쓴다.
 * 본문을 통째로(Content-Length) 보내는 버퍼 전송이라 프록시·HTTP/1.1 도 통과한다.
 * 취소(signal)·정체(스톨)·HTTP 오류를 각각 구분해 거부한다.
 *
 * 시간 제한은 **진행 이벤트 기준의 감시견**이다(xhr.timeout=0 으로 절대 제한은 끈다):
 * 진행률이 올라오는 동안은 얼마가 걸려도 두고, UPLOAD_STALL_MS 동안 한 톨도 못
 * 나아가면 그때 끊는다. 200MB 영상을 60초 절대 제한으로 자르지 않기 위한 것이다.
 */
function xhrSend(opts: {
  method: 'POST' | 'PUT';
  url: string;
  file: Blob;
  headers: Record<string, string>;
  onProgress?: UploadProgressHandler;
  signal?: AbortSignal;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // 감시견이 끊은 abort 와 사용자가 누른 취소를 구분하는 표식
    let stalled = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStall = () => {
      if (stallTimer !== null) clearTimeout(stallTimer);
      stallTimer = null;
    };
    const armStall = () => {
      clearStall();
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, UPLOAD_STALL_MS);
    };
    const onExternalAbort = () => xhr.abort();
    const cleanup = () => {
      clearStall();
      opts.signal?.removeEventListener('abort', onExternalAbort);
    };

    if (opts.signal?.aborted) {
      reject(new UploadCancelledError());
      return;
    }

    xhr.open(opts.method, opts.url, true);
    xhr.timeout = 0; // 절대 제한 없음 — 위 감시견이 대신한다
    for (const [k, v] of Object.entries(opts.headers)) xhr.setRequestHeader(k, v);

    xhr.upload.onprogress = (e) => {
      armStall(); // 조금이라도 나아갔으면 감시견을 처음부터 다시 센다
      if (e.lengthComputable) {
        opts.onProgress?.({
          phase: 'uploading',
          percent: Math.round((e.loaded / e.total) * 100),
        });
      }
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else {
        let msg = `서버 오류 (HTTP ${xhr.status}).`;
        try {
          const parsed = JSON.parse(xhr.responseText) as { error?: string };
          if (parsed.error) msg = parsed.error;
        } catch {
          /* 응답이 JSON 이 아님(R2 XML 등) — 기본 메시지 유지 */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('네트워크 오류로 업로드에 실패했습니다.'));
    };
    xhr.onabort = () => {
      const byWatchdog = stalled;
      cleanup();
      if (byWatchdog) {
        reject(
          new Error(
            `${Math.round(UPLOAD_STALL_MS / 1000)}초 동안 전송 진행이 없어 업로드를 중단했습니다.`,
          ),
        );
        return;
      }
      reject(opts.signal?.aborted ? new UploadCancelledError() : new Error('업로드가 중단되었습니다.'));
    };

    opts.signal?.addEventListener('abort', onExternalAbort, { once: true });
    armStall(); // 첫 바이트가 나가기 전에 굳는 경우도 감시 대상
    xhr.send(opts.file);
  });
}

/**
 * 첨부파일을 스토리지에 업로드하고 게시물에 기록할 공개 URL 을 반환한다.
 * boardKey 는 경로 구분용 (uploads/<게시판>/<파일명>).
 * onProgress 로 단계·퍼센트를 알려 폼이 실시간 상태를 표시하고,
 * signal(취소 버튼)로 어느 단계에서든 중단할 수 있다.
 */
export async function uploadAttachment(
  _cfg: RepoConfig,
  boardKey: string,
  file: File,
  onProgress?: UploadProgressHandler,
  signal?: AbortSignal,
  // maxDim: 압축 상한(긴 변 px) 상향 — 홈 히어로처럼 화면을 통째로 채우는 사진은
  // 기본 1600 으로 눌리면 서빙 상한(2048w)보다 작아져 눈에 띄게 물러진다.
  opts?: { maxDim?: number },
): Promise<{ url: string }> {
  // 상한은 종류별로 갈린다(영상 200MB · 그 외 20MB) — 서버(upload-url)와 같은 규칙
  const limit = maxUploadBytesFor(file.type, file.name);
  if (file.size > limit) {
    throw new Error(`${Math.round(limit / 1048576)}MB 이하 파일만 올릴 수 있습니다.`);
  }

  onProgress?.({ phase: 'preparing' });
  const prepared = await compressImage(file, opts?.maxDim);
  if (signal?.aborted) throw new UploadCancelledError();
  const name = `${Date.now()}-${sanitizeName(prepared.name)}`;
  const pathname = `uploads/${boardKey}/${name}`;
  const contentType = prepared.type || 'application/octet-stream';

  // dev 로컬 백엔드: 스토리지 키 없이 public/uploads/ 에 기록 → dev 서버가 즉시 서빙.
  // 본문은 원시 바이너리 PUT — base64+JSON 이면 200MB 영상이 문자열로 1.33배 부풀고
  // btoa 동안 탭이 멎으며 진행률도 못 준다. 프로덕션 경로와 같은 xhrSend 를 써서
  // dev 에서도 실제 퍼센트·취소가 그대로 동작한다.
  if (isLocalBackend()) {
    onProgress?.({ phase: 'uploading', percent: 0 });
    try {
      await xhrSend({
        method: 'PUT',
        url: '/api/dev-content',
        file: prepared,
        headers: {
          'content-type': 'application/octet-stream',
          // HTTP 헤더는 Latin-1 만 허용 — 한글 파일명이 섞이므로 퍼센트 인코딩
          'x-upload-pathname': encodeURIComponent(`public/${pathname}`),
        },
        onProgress,
        signal,
      });
    } catch (err) {
      if (err instanceof UploadCancelledError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`로컬 업로드에 실패했습니다 — ${reason}`);
    }
    onProgress?.({ phase: 'done', percent: 100 });
    return { url: `/${pathname}` };
  }

  const startedAt = Date.now();

  // ── 1순위: 작은 파일(≤4MB)은 같은 출처 서버 경유(/api/upload-file → R2) ──
  // 교차 출처 직접 업로드를 막는 프록시·백신망에서도 통과한다.
  if (prepared.size <= SERVER_RELAY_MAX) {
    console.info('[업로드] 시작(서버 경유→R2):', {
      pathname,
      sizeKB: Math.round(prepared.size / 1024),
      type: contentType,
    });
    onProgress?.({ phase: 'requesting' });
    try {
      const text = await xhrSend({
        method: 'POST',
        url: '/api/upload-file',
        file: prepared,
        headers: {
          // HTTP 헤더 값은 Latin-1 만 허용 — 한글 pathname 은 퍼센트 인코딩해 보낸다
          'x-upload-pathname': encodeURIComponent(pathname),
          'content-type': contentType,
        },
        onProgress,
        signal,
      });
      const parsed = JSON.parse(text) as { url?: string };
      if (!parsed.url) throw new Error('서버가 URL 을 반환하지 않았습니다.');
      console.info('[업로드] 완료(서버 경유):', { pathname, elapsedMs: Date.now() - startedAt });
      onProgress?.({ phase: 'done', percent: 100 });
      return { url: parsed.url };
    } catch (err) {
      if (err instanceof UploadCancelledError) throw err;
      console.error('[업로드] 서버 경유 실패:', err);
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`업로드에 실패했습니다 — ${reason} 잠시 후 다시 시도해 주세요.`);
    }
  }

  // ── 2순위: 큰 파일(>4MB)은 presigned PUT 으로 R2 직접 업로드 ──
  // 서버리스 본문 한도(4.5MB) 때문에 서버 경유가 불가능한 크기.
  console.info('[업로드] 시작(직접 presigned→R2):', {
    pathname,
    sizeKB: Math.round(prepared.size / 1024),
    type: contentType,
  });
  onProgress?.({ phase: 'requesting' });

  let presign: { putUrl: string; publicUrl: string; contentType: string };
  try {
    const res = await fetch('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pathname, contentType, size: prepared.size }),
      signal,
    });
    const data = (await res.json().catch(() => null)) as
      | { putUrl?: string; publicUrl?: string; contentType?: string; error?: string }
      | null;
    if (!res.ok || !data?.putUrl || !data.publicUrl) {
      throw new Error(data?.error ?? `업로드 URL 발급에 실패했습니다 (HTTP ${res.status}).`);
    }
    presign = { putUrl: data.putUrl, publicUrl: data.publicUrl, contentType: data.contentType ?? contentType };
  } catch (err) {
    if (signal?.aborted) throw new UploadCancelledError();
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`업로드에 실패했습니다 — ${reason}`);
  }

  try {
    await xhrSend({
      method: 'PUT',
      url: presign.putUrl,
      file: prepared,
      // presign 서명에 포함된 Content-Type 과 정확히 일치해야 한다
      headers: { 'content-type': presign.contentType },
      onProgress,
      signal,
    });
    console.info('[업로드] 완료(직접):', { pathname, elapsedMs: Date.now() - startedAt });
    onProgress?.({ phase: 'done', percent: 100 });
    return { url: presign.publicUrl };
  } catch (err) {
    if (err instanceof UploadCancelledError) throw err;
    console.error('[업로드] 직접 업로드 실패:', { pathname, error: err });
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `업로드에 실패했습니다 — ${reason} 4MB 초과 파일의 직접 업로드는 프록시·백신(SSL 검사)망이나 버킷 CORS 미설정 시 차단될 수 있습니다.`,
    );
  }
}
