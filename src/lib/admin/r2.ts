// Cloudflare R2 클라이언트 — 서버 전용(라우트 핸들러에서만 import).
//
// 첨부 실체 저장소를 Vercel Blob 에서 R2 로 이전(2026-07 백엔드 전환 Phase 1).
// 이유: Blob Hobby 는 저장 1GB + 초과 시 "차단"이라 공개 사이트에 치명적,
// R2 는 무료 10GB + 전송(egress) 영구 무료. S3 호환 API 를 그대로 쓴다.
//
// 키는 전부 환경변수(Vercel env / .env.local)로만 공급되고, 클라이언트 번들에
// 절대 노출되지 않는다. S3Client 는 lazy 초기화 — env 가 없는 빌드 타임에도
// import 만으로는 터지지 않고, 실제 호출 시점에 명확한 에러를 낸다.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  return v;
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${requiredEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
  return _client;
}

function bucket(): string {
  return requiredEnv('R2_BUCKET');
}

/** 저장된 객체의 공개 URL (R2.dev 퍼블릭 도메인 또는 커스텀 도메인) */
export function r2PublicUrl(key: string): string {
  const base = requiredEnv('R2_PUBLIC_BASE_URL').replace(/\/+$/, '');
  return `${base}/${key}`;
}

/** 경로 충돌·추측 방지용 랜덤 접미사 — Blob 의 addRandomSuffix 를 대체한다.
 *  확장자 앞에 -xxxxxxxx 를 끼워 넣는다: uploads/news/a.pdf → uploads/news/a-1a2b3c4d.pdf */
export function withRandomSuffix(key: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  const m = key.match(/^(.*?)(\.[A-Za-z0-9]+)?$/);
  return `${m?.[1] ?? key}-${suffix}${m?.[2] ?? ''}`;
}

/** 업로드 객체의 캐시 헤더. r2.dev 는 저장할 때 넣은 CacheControl 을 그대로 응답에 싣는다.
 *
 *  왜 immutable 이 안전한가: 키는 항상 withRandomSuffix() 로 랜덤 접미사가 붙는다 —
 *  같은 파일을 다시 올려도 새 키가 생기므로 한 키의 내용이 바뀌는 일이 없다.
 *  이 헤더가 없으면 (1) 브라우저가 매번 재검증하고(PageSpeed "cache TTL None"),
 *  (2) next/image 가 원본 Cache-Control 을 못 읽어 minimumCacheTTL(기본 60초)마다
 *  같은 사진을 다시 최적화한다 — Vercel Hobby 에서 실제 비용이다. */
const UPLOAD_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** 서버 경유 업로드 — 본문 바이트를 R2 에 저장하고 공개 URL 을 돌려준다 */
export async function r2Put(key: string, body: Buffer, contentType: string): Promise<string> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: UPLOAD_CACHE_CONTROL,
    }),
  );
  return r2PublicUrl(key);
}

/** 대용량(서버리스 본문 한도 초과) 직접 업로드용 presigned PUT URL 발급.
 *  브라우저가 이 URL 로 PUT 하면 R2 에 바로 저장된다(버킷 CORS 필요).
 *
 *  ⚠️ 여기엔 일부러 CacheControl 을 넣지 않았다 — presigned PUT 은 서명에 들어간 헤더를
 *  브라우저가 **그대로 다시 보내야** 하므로, storage.ts 의 fetch PUT 에 Cache-Control 을
 *  추가하고 버킷 CORS 의 AllowedHeaders 에도 등록해야 한다. 이 경로는 4MB 초과 대용량
 *  첨부(이미지 아님)만 타므로 범위 밖으로 둔다. 기존 객체는
 *  tools/r2/backfill-cache-control.mjs 로 일괄 보정할 수 있다. */
export async function r2PresignPut(
  key: string,
  contentType: string,
  expiresInSeconds = 600,
): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    { expiresIn: expiresInSeconds },
  );
}
