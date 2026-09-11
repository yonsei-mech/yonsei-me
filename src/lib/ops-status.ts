// 서버 백그라운드 작업(자체 호스팅 cron) 상태 판정 — /api/health/ops 가 쓰는 순수 로직.
//
// 서버의 cron 작업 셋이 OPS_STATUS_DIR(서버: /opt/yonsei_me/shared/status)에 JSON 상태 파일을
// 남긴다. 작업이 "실패했다" 는 사실은 파일의 ok 가 말해 주지만, "아예 돌지 않는다"(cron 정지·
// 재부팅 뒤 미등록·디스크 가득)는 파일이 **오래됐다**는 것으로만 드러난다. 그래서 나이를 함께
// 본다 — 외부 감시(UptimeRobot)는 이 판정 하나(200/503)만 폴링하면 된다.
//
// 파일 시스템을 만지지 않는 이유: 판정 규칙을 fs 없이 스크립트로 시험하려고. 파일 읽기는
// 라우트(app/api/health/ops/route.ts)가 하고, 여기는 읽은 결과와 현재 시각만 받는다.
// Node 의 타입 제거 실행으로 바로 돌릴 수 있게 enum·경로 별칭 import 를 쓰지 않는다.
//
// 공개 엔드포인트로 나가는 값이다 — 파일 경로·오류 문구·problems 의 detail 은 싣지 않는다
// (코드만). 원인은 서버에서 상태 파일을 직접 열어 본다.
//
// ⚠️ 쓰는 쪽 계약: 상태 파일은 임시 파일에 쓴 뒤 rename 으로 바꿔 끼워야 한다. 제자리에 덮어쓰면
//    쓰는 도중에 읽힌 반쪽 JSON 이 'fail' 로 판정돼 감시가 헛경보를 낸다.

// ── 기준 시간 ─────────────────────────────────────────────────────────
/** selfcheck 는 10분 주기 — 한 번 빠진 건 넘기고, 두 번 연속 누락(+실행 여유 5분)부터 경보 */
export const SELFCHECK_STALE_MIN = 25;
/** db-backup 은 매일 1회 — 24시간 + 실행 시각 흔들림·긴 덤프 여유 6시간 */
export const DB_BACKUP_STALE_H = 30;
/** 오프사이트 사본은 주 단위 갱신까지 허용 — 7일 + 하루 여유 */
export const OFFSITE_STALE_D = 8;
/** r2-mirror 는 주 1회 — 7일 + 하루 여유(한 주 늦게 돈 정도로는 경보하지 않는다) */
export const R2_MIRROR_STALE_D = 8;
/** 같은 서버 시계로 쓰고 읽으니 미래 시각은 쓰기 오류다 — 그대로 두면 영영 stale 이 안 되므로 fail */
export const FUTURE_SKEW_MIN = 5;

/** 상태 파일 이름(쓰는 쪽 cron 과의 계약) */
export const OPS_STATUS_FILES = {
  selfcheck: 'selfcheck.json',
  dbBackup: 'db-backup.json',
  r2Mirror: 'r2-mirror.json',
} as const;

// ── 타입 ──────────────────────────────────────────────────────────────
export type CheckState = 'ok' | 'missing' | 'stale' | 'fail';

/** 상태 파일 하나를 읽은 결과 — parseStatusFile 이 만든다 */
export type StatusFile =
  | { kind: 'missing' } // 파일 없음·읽기 실패
  | { kind: 'unparsable' } // JSON 이 아님
  | { kind: 'parsed'; data: unknown };

export interface OpsStatusFiles {
  selfcheck: StatusFile;
  dbBackup: StatusFile;
  r2Mirror: StatusFile;
}

export interface SelfcheckResult {
  ok: boolean;
  state: CheckState;
  ageMin: number | null;
  /** problems[].code 만 — detail 은 서버 내부 사정을 담을 수 있어 공개하지 않는다 */
  problems: string[];
}

export interface DbBackupResult {
  /** 로컬 백업과 오프사이트 사본이 **둘 다** ok 일 때만 true */
  ok: boolean;
  /** 로컬 백업(파일의 at·ok) 상태 */
  state: CheckState;
  ageH: number | null;
  offsite: { state: CheckState; ageD: number | null };
}

export interface R2MirrorResult {
  ok: boolean;
  state: CheckState;
  ageD: number | null;
}

export interface OpsVerdict {
  ok: boolean;
  checks: {
    selfcheck: SelfcheckResult;
    dbBackup: DbBackupResult;
    r2Mirror: R2MirrorResult;
  };
}

// ── 판정 ──────────────────────────────────────────────────────────────
const MIN_PER_H = 60;
const MIN_PER_D = 1440;

/** 파일 원문(null = 없음·읽기 실패) → StatusFile */
export function parseStatusFile(text: string | null): StatusFile {
  if (text === null) return { kind: 'missing' };
  try {
    return { kind: 'parsed', data: JSON.parse(text) as unknown };
  } catch {
    return { kind: 'unparsable' };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** ISO 시각 문자열 → 지금까지 흐른 분. 시각이 아니거나 허용치보다 미래면 null(= 계약 위반) */
function ageMinutes(v: unknown, now: Date): number | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const min = (now.getTime() - t) / 60_000;
  if (min < -FUTURE_SKEW_MIN) return null;
  return Math.max(0, min);
}

/** 사람이 읽는 값이라 소수 첫째 자리까지 — 판정은 반올림 전 값으로 한다 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 실패를 오래됨보다 먼저 본다 — ok:false 는 무엇이 잘못됐는지까지 말해 주는 더 구체적인
 *  신호다. 특히 오프사이트는 offsite_at 이 마지막 '성공' 시각일 수 있어, 계속 실패하는 업로드가
 *  8일을 넘기면 'stale'(안 돈다)로 잘못 보일 수 있다. */
function judge(failed: boolean, tooOld: boolean): CheckState {
  if (failed) return 'fail';
  if (tooOld) return 'stale';
  return 'ok';
}

interface Base {
  state: CheckState;
  ageMin: number | null;
  /** 판정 필드가 온전할 때만 채운다 — null 이면 세부 필드도 믿지 않는다 */
  data: Record<string, unknown> | null;
}

/** 세 파일 공통: 판정에 쓰는 at·ok 만 필수로 본다. 없거나 형식이 틀리면 fail — 계약이
 *  깨졌다는 뜻이라 "괜찮음" 으로 넘기면 안 된다. 나머지 필드는 없으면 빈 것으로 본다. */
function judgeBase(file: StatusFile, staleMin: number, now: Date): Base {
  if (file.kind === 'missing') return { state: 'missing', ageMin: null, data: null };
  if (file.kind === 'unparsable' || !isRecord(file.data)) {
    return { state: 'fail', ageMin: null, data: null };
  }
  const d = file.data;
  const age = ageMinutes(d.at, now);
  if (age === null || typeof d.ok !== 'boolean') return { state: 'fail', ageMin: age, data: null };
  return { state: judge(d.ok === false, age > staleMin), ageMin: age, data: d };
}

function evalSelfcheck(file: StatusFile, now: Date): SelfcheckResult {
  const b = judgeBase(file, SELFCHECK_STALE_MIN, now);
  const raw = b.data?.problems;
  const problems = Array.isArray(raw)
    ? raw.flatMap((p: unknown) => (isRecord(p) && typeof p.code === 'string' ? [p.code] : []))
    : [];
  return {
    ok: b.state === 'ok',
    state: b.state,
    ageMin: b.ageMin === null ? null : round1(b.ageMin),
    problems,
  };
}

function evalOffsite(
  file: StatusFile,
  data: Record<string, unknown> | null,
  now: Date,
): { state: CheckState; ageD: number | null } {
  // 파일 자체를 못 믿으면 오프사이트도 같은 이유로 알 수 없다
  if (!data) return { state: file.kind === 'missing' ? 'missing' : 'fail', ageD: null };
  const okv = data.offsite_ok;
  if (okv !== undefined && okv !== null && typeof okv !== 'boolean') {
    return { state: 'fail', ageD: null };
  }
  const at = data.offsite_at;
  // 사본이 한 번도 안 올라갔다 = 오래된 것과 같다(단, 이번 시도가 실패했다면 그게 더 구체적)
  if (at === undefined || at === null) return { state: okv === false ? 'fail' : 'stale', ageD: null };
  const age = ageMinutes(at, now);
  if (age === null) return { state: 'fail', ageD: null };
  return {
    state: judge(okv === false, age > OFFSITE_STALE_D * MIN_PER_D),
    ageD: round1(age / MIN_PER_D),
  };
}

function evalDbBackup(file: StatusFile, now: Date): DbBackupResult {
  const b = judgeBase(file, DB_BACKUP_STALE_H * MIN_PER_H, now);
  const offsite = evalOffsite(file, b.data, now);
  return {
    ok: b.state === 'ok' && offsite.state === 'ok',
    state: b.state,
    ageH: b.ageMin === null ? null : round1(b.ageMin / MIN_PER_H),
    offsite,
  };
}

function evalR2Mirror(file: StatusFile, now: Date): R2MirrorResult {
  const b = judgeBase(file, R2_MIRROR_STALE_D * MIN_PER_D, now);
  return {
    ok: b.state === 'ok',
    state: b.state,
    ageD: b.ageMin === null ? null : round1(b.ageMin / MIN_PER_D),
  };
}

/** 세 상태 파일 → 한 판정. 셋 다 ok 여야 전체 ok */
export function evaluateOpsStatus(files: OpsStatusFiles, now: Date): OpsVerdict {
  const selfcheck = evalSelfcheck(files.selfcheck, now);
  const dbBackup = evalDbBackup(files.dbBackup, now);
  const r2Mirror = evalR2Mirror(files.r2Mirror, now);
  return {
    ok: selfcheck.ok && dbBackup.ok && r2Mirror.ok,
    checks: { selfcheck, dbBackup, r2Mirror },
  };
}
