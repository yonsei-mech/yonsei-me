// 앱 + 데이터베이스 생존 확인 — GET /api/health.
//
// 외부 감시(UptimeRobot)가 키워드 `"ok":true` 로 폴링한다. 200 이면 Next 프로세스가 요청을
// 받고 있고 Supabase 까지 닿는다는 뜻, 503 이면 경보다. 페이지 대부분이 정적이라 DB 가 죽어도
// 홈은 멀쩡히 뜬다 — 그래서 페이지가 아니라 이 엔드포인트로 DB 까지 본다.
//
// DB 점검은 PostgREST 에 HEAD 요청 한 번이다. 본문 없이 헤더만 오가 1회 수백 바이트로 끝난다 —
// 무료 플랜 egress 한도를 한 번 넘겨 사이트가 막힌 적이 있어(2026-09) 감시가 그 한도를 갉아먹으면
// 안 된다. 테이블은 작은 content_files 를 쓴다.
//
// 공개 엔드포인트다 — Supabase 오류 문구·URL·키는 응답에 싣지 않고 분류 코드만 낸다.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

// 감시 응답이 캐시되면 죽은 DB 를 산 것으로 보고한다 — 매 요청 새로 확인한다
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/** 감시 주기(분 단위)보다 한참 짧게 — 느린 DB 는 죽은 DB 와 같은 경보로 다룬다 */
const DB_TIMEOUT_MS = 3000;

type DbState = 'ok' | 'fail' | 'timeout' | 'unconfigured';

// ── 배포 식별자(어느 커밋이 떠 있나) ─────────────────────────────────────
// Cafe24 는 릴리스 디렉터리(= process.cwd()) 루트에 .release-sha 를 남기고, Vercel 은
// VERCEL_GIT_COMMIT_SHA 를 준다. 릴리스 중엔 바뀌지 않으니 한 번만 읽는다.
let releaseCache: string | null | undefined;

function release(): string | null {
  if (releaseCache !== undefined) return releaseCache;
  let sha: string | null = null;
  try {
    const v = readFileSync(join(process.cwd(), '.release-sha'), 'utf8').trim();
    // 공개 응답에 파일 내용을 그대로 싣지 않도록 SHA 모양일 때만 쓴다
    if (/^[0-9a-f]{7,40}$/i.test(v)) sha = v;
  } catch {
    // 파일 없음 = Cafe24 릴리스가 아니다(Vercel·로컬)
  }
  releaseCache = sha ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  return releaseCache;
}

async function checkDb(): Promise<{ db: DbState; dbMs: number | null }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { db: 'unconfigured', dbMs: null };

  const started = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/content_files?select=path&limit=1`, {
      method: 'HEAD',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      // Next 14 는 라우트 핸들러의 fetch 도 Data Cache 에 넣는다 — 캐시된 200 은 감시를 속인다
      cache: 'no-store',
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    return { db: res.ok ? 'ok' : 'fail', dbMs: Date.now() - started };
  } catch (err) {
    // 중단 신호는 위 타임아웃 하나뿐이라 AbortError 도 시간 초과로 본다
    const name = err instanceof Error ? err.name : '';
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    return { db: timedOut ? 'timeout' : 'fail', dbMs: Date.now() - started };
  }
}

export async function GET(): Promise<Response> {
  const { db, dbMs } = await checkDb();
  const ok = db === 'ok';
  return NextResponse.json(
    { ok, db, dbMs, release: release(), at: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
