// 첨부 일괄 다운로드 — 게시물의 첨부들을 서버에서 모아 ZIP 하나로 내려준다.
//
// 왜 서버가 묶나: 첨부는 R2(자체 업로드)와 레거시 학과 사이트(me.yonsei.ac.kr)에
// 흩어져 있다. 브라우저에서 여러 출처의 파일을 받아 묶으려면 CORS 가 막고, 링크를
// 여러 개 순차로 열면 팝업 차단에 걸린다. 서버는 그 제약이 없다.
//
// 왜 postIds 만 받나(타협 불가): 클라이언트가 URL 을 보내는 계약이면 이 라우트는
// "아무 주소나 대신 받아오는" 오픈 프록시가 된다(내부망 SSRF·대역폭 남용). 그래서
// 게시물 id 만 받고, 내려받을 주소는 서버가 fetchBoardPost() 로 조회한 첨부 목록에서만
// 얻는다. 즉 DB 에 등록된 첨부 외에는 어떤 주소도 요청되지 않는다.
//
// 왜 무압축인가: 첨부는 pdf/hwp/docx/xlsx 라 이미 압축돼 있어 deflate 이득이 미미하다.
// src/lib/zip.ts 의 stored ZIP 라이터를 쓴다(의존성 0).
//
// 상한: 게시물 30개 / 파일당 25MB / 총합 80MB. 서버리스 함수의 메모리 안에 전체
// 바이트를 올려 묶는 구조라 상한이 곧 안전장치다. 초과·실패분은 조용히 건너뛰고
// 응답 헤더 X-Zip-Skipped 로 몇 개를 뺐는지 알린다(본문은 정상 ZIP).

import { pick, type Attachment } from '@/lib/content';
import { fetchBoardPost } from '@/lib/posts';
import { publicOrigin } from '@/lib/site';
import { buildZip, type ZipEntry } from '@/lib/zip';

export const runtime = 'nodejs'; // 바이트 버퍼 조작 — Edge 런타임 불가
export const dynamic = 'force-dynamic'; // 첨부 내용은 캐시 대상이 아니다

const MAX_POSTS = 30; // 한 번에 묶을 수 있는 게시물 수
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 파일 하나 상한
const MAX_TOTAL_BYTES = 80 * 1024 * 1024; // 전체 합계 상한
const FETCH_TIMEOUT_MS = 20_000; // 레거시 서버가 응답을 안 줄 때 무한정 매달리지 않게

/** 확장자 없는 라벨에 붙여 줄 MIME → 확장자 표 (자주 오는 것만) */
const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/haansofthwp': '.hwp',
  'application/x-hwp': '.hwp',
  'application/vnd.hancom.hwp': '.hwp',
  'application/vnd.hancom.hwpx': '.hwpx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/zip': '.zip',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'text/plain': '.txt',
  'text/csv': '.csv',
};

/** 이름에 확장자가 붙어 있는가 — ".hwp"처럼 짧은 영숫자 꼬리만 인정한다 */
function hasExtension(name: string): boolean {
  return /\.[A-Za-z0-9]{1,8}$/.test(name.trim());
}

/**
 * 응답 헤더에서 확장자를 유추한다. 레거시 게시판의 첨부 라벨은 "붙임1" 처럼
 * 확장자가 없는 경우가 있는데, 그대로 저장하면 Windows 가 열 프로그램을 못 찾는다.
 * content-disposition 의 파일명이 가장 정확하고, 없으면 content-type 표로 넘어간다.
 */
function guessExtension(res: Response): string {
  const disposition = res.headers.get('content-disposition') ?? '';
  // RFC 5987 형식(filename*=UTF-8''...)이 있으면 우선 — 한글 원본 파일명이 여기 온다
  const star = disposition.match(/filename\*=(?:UTF-8|utf-8)''([^;]+)/);
  const plain = disposition.match(/filename="?([^";]+)"?/);
  let candidate = '';
  if (star?.[1]) {
    try {
      candidate = decodeURIComponent(star[1]);
    } catch {
      candidate = star[1];
    }
  } else if (plain?.[1]) {
    candidate = plain[1];
  }
  const dot = candidate.lastIndexOf('.');
  if (dot > 0 && /^\.[A-Za-z0-9]{1,8}$/.test(candidate.slice(dot))) return candidate.slice(dot);

  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return EXT_BY_MIME[mime] ?? '';
}

/** 파일명 헤더 — 한글은 Latin-1 전용인 헤더에 그대로 못 실어 filename* 로 보낸다 */
function contentDisposition(koreanName: string): string {
  const encoded = encodeURIComponent(koreanName);
  // ASCII 폴백은 filename* 를 모르는 옛 클라이언트용 — 이름을 잃더라도 저장은 되게
  return `attachment; filename="attachments.zip"; filename*=UTF-8''${encoded}`;
}

/** 오류 응답 한 줄짜리 헬퍼 */
function fail(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  // ── 입력 검증 ──
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('요청 형식이 올바르지 않습니다.', 400);
  }

  const rawIds = (body as { postIds?: unknown } | null)?.postIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return fail('내려받을 게시물을 선택해 주세요.', 400);
  }
  if (rawIds.length > MAX_POSTS) {
    return fail(`한 번에 ${MAX_POSTS}개까지만 내려받을 수 있습니다.`, 400);
  }
  if (!rawIds.every((id): id is string => typeof id === 'string' && id.trim() !== '')) {
    return fail('게시물 번호가 올바르지 않습니다.', 400);
  }
  // 같은 글을 두 번 담아 보내도 첨부를 두 번 받지 않도록 정리
  const postIds = Array.from(new Set(rawIds.map((id) => id.trim())));

  // ── 첨부 목록 수집 (URL 은 오직 여기서만 나온다) ──
  const origin = publicOrigin(request);
  const targets: { attachment: Attachment; url: URL }[] = [];
  let firstTitle = '';
  let skipped = 0;

  for (const id of postIds) {
    const post = await fetchBoardPost(id);
    if (!post) continue; // 없는 글은 조용히 무시 — 부분 성공을 허용한다
    if (!firstTitle) firstTitle = pick(post.title, 'ko');
    for (const attachment of post.attachments ?? []) {
      let url: URL;
      try {
        // 상대 경로(/uploads/…)는 사이트 자신의 파일 — 요청 출처 기준으로 절대화한다
        url = new URL(attachment.href, origin);
      } catch {
        skipped++;
        continue;
      }
      // http(s) 외의 스킴(data:, file: 등)은 받지 않는다
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        skipped++;
        continue;
      }
      targets.push({ attachment, url });
    }
  }

  if (targets.length === 0) {
    return fail('내려받을 첨부가 없습니다.', 404);
  }

  // ── 원본 파일 수집 — 반드시 순차로 ──
  // 동시에 받으면 최대 30×25MB 가 한꺼번에 메모리에 올라온다. 하나씩 받아
  // 총합을 확인하며 쌓는 편이 함수 메모리 한도 안에서 안전하다.
  const entries: ZipEntry[] = [];
  let totalBytes = 0;

  for (const { attachment, url } of targets) {
    if (totalBytes >= MAX_TOTAL_BYTES) {
      skipped++;
      continue;
    }
    try {
      const res = await fetch(url.toString(), {
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        skipped++;
        continue;
      }
      // 크기를 미리 알 수 있으면 내려받기 전에 거른다(대역폭·메모리 절약)
      const declared = Number(res.headers.get('content-length') ?? '');
      if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
        skipped++;
        continue;
      }
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_FILE_BYTES) {
        skipped++;
        continue;
      }
      if (totalBytes + buffer.byteLength > MAX_TOTAL_BYTES) {
        skipped++;
        continue;
      }

      // ZIP 안의 이름은 화면에 보이던 첨부 라벨 그대로 — 사용자가 알아보는 이름이다
      let name = pick(attachment.label, 'ko').trim() || '첨부파일';
      if (!hasExtension(name)) name += guessExtension(res);

      entries.push({ name, data: new Uint8Array(buffer) });
      totalBytes += buffer.byteLength;
    } catch {
      // 타임아웃·네트워크 오류 — 그 파일만 버리고 나머지는 계속 묶는다
      skipped++;
    }
  }

  if (entries.length === 0) {
    return fail('첨부를 내려받지 못했습니다.', 502);
  }

  // ── ZIP 생성 ──
  const zip = buildZip(entries);
  // 글이 하나면 제목을 파일명으로 — 여러 개면 출처가 뒤섞이므로 일반 이름을 쓴다
  const zipName =
    postIds.length === 1 && firstTitle ? `${firstTitle}.zip` : '자료실 첨부.zip';

  const headers = new Headers({
    'Content-Type': 'application/zip',
    'Content-Length': String(zip.byteLength),
    'Content-Disposition': contentDisposition(zipName),
    'Cache-Control': 'no-store',
  });
  if (skipped > 0) headers.set('X-Zip-Skipped', String(skipped));

  return new Response(zip, { status: 200, headers });
}
