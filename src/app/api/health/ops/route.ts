// 서버 백그라운드 작업 상태 — GET /api/health/ops (자체 호스팅 전용).
//
// 서버 cron(자체 점검 10분·DB 백업 매일·R2 미러 매주)이 OPS_STATUS_DIR 에 남긴 JSON 상태
// 파일을 읽어 판정 하나로 모은다. 외부 감시(UptimeRobot)가 이 URL 을 폴링해 200 이면 정상,
// 503 이면 경보다. 판정 규칙(기준 시간·필드 계약)은 lib/ops-status.ts 가 단일 출처다 —
// 여기는 파일을 읽는 일만 한다.
//
// OPS_STATUS_DIR 이 없는 환경(Vercel·로컬 dev)은 404 — 그쪽엔 cron 이 없고 아무도 감시하지
// 않는다. 503 을 내면 병행 운영 중 누가 잘못 걸어 둔 감시가 헛경보를 울린다.
//
// 공개 엔드포인트다 — 응답에 파일 경로·오류 문구를 싣지 않는다(판정 코드와 나이만).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { OPS_STATUS_FILES, evaluateOpsStatus, parseStatusFile } from '@/lib/ops-status';

// 감시 응답이 캐시되면 죽은 작업을 산 것으로 보고한다 — 매 요청 새로 읽는다
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

/** 없음·권한 없음·디렉터리 등 읽기 실패는 모두 null(= missing). 사유는 공개하지 않는다 */
async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  const dir = process.env.OPS_STATUS_DIR;
  if (!dir) {
    return NextResponse.json(
      { ok: false, reason: 'not-configured' },
      { status: 404, headers: NO_STORE },
    );
  }

  const [selfcheck, dbBackup, r2Mirror] = await Promise.all(
    [OPS_STATUS_FILES.selfcheck, OPS_STATUS_FILES.dbBackup, OPS_STATUS_FILES.r2Mirror].map(
      async (name) => parseStatusFile(await readText(join(dir, name))),
    ),
  );

  const now = new Date();
  const verdict = evaluateOpsStatus({ selfcheck, dbBackup, r2Mirror }, now);
  return NextResponse.json(
    { ...verdict, at: now.toISOString() },
    { status: verdict.ok ? 200 : 503, headers: NO_STORE },
  );
}
