#!/usr/bin/env node
/**
 * R2 기존 객체에 Cache-Control 을 소급 적용한다.
 *
 * 배경: src/lib/admin/r2.ts 의 r2Put 이 오랫동안 CacheControl 없이 저장해 왔다.
 * r2.dev 응답에 Cache-Control 이 없으면 (1) 브라우저가 매번 재검증하고
 * (2) next/image 가 minimumCacheTTL(기본 60초)마다 같은 사진을 다시 최적화한다.
 * r2Put 은 이제 헤더를 붙이지만, 이미 올라간 객체는 이 스크립트로 한 번 보정해야 한다.
 *
 * 안전성: 키에 랜덤 접미사(withRandomSuffix)가 붙어 한 키의 내용이 바뀌지 않으므로
 * immutable 이 안전하다. 보정은 같은 자리 CopyObject(MetadataDirective=REPLACE)라
 * 본문 바이트는 그대로 두고 메타데이터만 다시 쓴다 — ContentType/ContentDisposition/
 * 사용자 Metadata 는 HeadObject 로 읽어 그대로 옮긴다(REPLACE 는 안 옮기면 지워진다).
 *
 * 기본은 **드라이런**. 실제 쓰기는 --apply 를 줘야 한다.
 *
 *   node tools/r2/backfill-cache-control.mjs                    # 미리보기
 *   node tools/r2/backfill-cache-control.mjs --prefix uploads/  # 범위 한정
 *   node tools/r2/backfill-cache-control.mjs --apply            # 실제 적용
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';

const TARGET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const CONCURRENCY = 8;

// ── 인자 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const prefixIdx = argv.indexOf('--prefix');
const PREFIX = prefixIdx >= 0 ? argv[prefixIdx + 1] ?? '' : '';

// ── .env.local 로드 (이미 환경에 있으면 건드리지 않는다) ────────────────────
// dotenv 의존을 늘리지 않으려고 KEY=VALUE 만 직접 판다. 이 파일은 .gitignore 로
// 추적 제외되어 있어야 한다(git ls-files .env.local 이 비어야 정상).
function loadEnvLocal() {
  const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const file = path.join(root, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key]) continue; // 실제 환경이 우선
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} 환경변수가 없습니다 (.env.local 또는 셸 환경에 넣어 주세요).`);
    process.exit(1);
  }
  return v;
}

loadEnvLocal();

const BUCKET = requiredEnv('R2_BUCKET');
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${requiredEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
  },
});

/** CopySource 는 SDK 가 인코딩해 주지 않는다 — 세그먼트별로 인코딩하고 '/' 는 남긴다. */
function copySource(bucket, key) {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** 간단한 동시 실행 풀 */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function listAll(prefix) {
  const keys = [];
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix || undefined,
        ContinuationToken: token,
      }),
    );
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function main() {
  console.log(`bucket=${BUCKET} prefix=${PREFIX || '(all)'} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const keys = await listAll(PREFIX);
  console.log(`listed ${keys.length} objects — HEAD 조회 중…`);

  const heads = await mapPool(keys, CONCURRENCY, async (key) => {
    try {
      const h = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return { key, head: h, error: null };
    } catch (e) {
      return { key, head: null, error: e };
    }
  });

  const failedHead = heads.filter((h) => h.error);
  const ok = heads.filter((h) => h.head);
  const already = ok.filter((h) => h.head.CacheControl === TARGET_CACHE_CONTROL);
  const todo = ok.filter((h) => h.head.CacheControl !== TARGET_CACHE_CONTROL);

  console.log('');
  console.log(`total       : ${keys.length}`);
  console.log(`already set : ${already.length}`);
  console.log(`to update   : ${todo.length}`);
  if (failedHead.length) console.log(`head failed : ${failedHead.length}`);
  console.log('');
  console.log(`first ${Math.min(20, todo.length)} keys to update:`);
  for (const t of todo.slice(0, 20)) {
    console.log(`  ${t.key}   (current Cache-Control: ${t.head.CacheControl ?? 'none'})`);
  }

  if (!APPLY) {
    console.log('');
    console.log('DRY-RUN — 아무것도 쓰지 않았습니다. 실제 적용하려면 --apply 를 붙이세요.');
    return;
  }

  console.log('');
  console.log(`applying '${TARGET_CACHE_CONTROL}' to ${todo.length} objects…`);
  let done = 0;
  const failures = [];
  await mapPool(todo, CONCURRENCY, async (t) => {
    try {
      await client.send(
        new CopyObjectCommand({
          Bucket: BUCKET,
          Key: t.key,
          CopySource: copySource(BUCKET, t.key),
          MetadataDirective: 'REPLACE',
          CacheControl: TARGET_CACHE_CONTROL,
          // REPLACE 는 원본 메타데이터를 버리므로 HEAD 로 읽은 값을 되돌려 준다.
          ...(t.head.ContentType ? { ContentType: t.head.ContentType } : {}),
          ...(t.head.ContentDisposition ? { ContentDisposition: t.head.ContentDisposition } : {}),
          ...(t.head.Metadata && Object.keys(t.head.Metadata).length
            ? { Metadata: t.head.Metadata }
            : {}),
        }),
      );
      done++;
      if (done % 100 === 0) console.log(`  … ${done}/${todo.length}`);
    } catch (e) {
      failures.push({ key: t.key, message: e?.message ?? String(e) });
    }
  });

  console.log('');
  console.log(`updated: ${done} / ${todo.length}`);
  if (failures.length) {
    console.log(`failed : ${failures.length}`);
    for (const f of failures.slice(0, 20)) console.log(`  ${f.key}: ${f.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
