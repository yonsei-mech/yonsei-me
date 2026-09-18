/**
 * 학위논문심사 공고 등록 — 학생 본인 확인 인증번호 저장소.
 *
 * 인터페이스 하나 + 구현 둘:
 *  - 프로덕션: Supabase `thesis_submit_otps`(스키마 원본 scripts/sql/2026-09-thesis-submit-otp.sql).
 *  - dev: 모듈 레벨 in-memory Map. DB·메일 없이 화면 B 의 전 상태(B1~B8)를 재현하려는 것 —
 *    코드는 항상 000000 이지만 오입력 횟수·재발송 쿨다운·만료는 메모리에서 **실제로** 동작한다.
 *    Next dev 는 HMR 때 모듈을 다시 평가하므로 Map 을 globalThis 에 붙여 상태를 유지한다.
 *
 * ⚠️ cms_users·cms-users.ts 와 **아무것도 공유하지 않는다**(학생 인증 ↔ CMS 인증 분리).
 *    Supabase 서비스 클라이언트는 cms-users.ts 와 같은 10줄 패턴을 복제한다 — posts-server 의
 *    adminDb 를 끌어오면 그쪽 의존성(캐시·태그)이 API 라우트 번들에 딸려 온다.
 *
 * 저장 규칙: 인증번호 원문은 저장하지 않는다(sha256 16진 해시만). 확인에 성공하면 행을
 * 통째로 지운다 — 이메일 보관 기간을 인증 과정으로만 한정하려는 것(개인정보 최소 보관).
 * 폐기(오입력 한도 소진)는 해시만 지우고 시도 횟수를 남겨, 다음 확인 요청이 "만료"가 아니라
 * "잠김"으로 답하게 한다.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** 이메일 한 개의 발급 상태. 시각은 전부 epoch ms */
export interface OtpRecord {
  email: string;
  otpHash: string | null;
  otpExpiresAt: number | null;
  otpAttempts: number;
  otpSentAt: number | null;
}

export interface ThesisOtpStore {
  /** 발급 상태 조회 — 기록이 없으면 null */
  get(email: string): Promise<OtpRecord | null>;
  /** 새 코드 발급 — 해시·만료·발송 시각을 새로 쓰고 시도 횟수를 0 으로 되돌린다(upsert) */
  issue(email: string, hash: string, expiresAt: number, sentAt: number): Promise<void>;
  /**
   * 확인 시도 1회를 **비교 전에** 선점한다. 현재 횟수가 `prev` 일 때만 prev+1 로 올리고
   * 새 값을 돌려준다. 다른 요청이 먼저 올렸으면(동시 요청) null — 호출부는 그 요청의 코드를
   * 비교하지 않는다. 이렇게 해야 병렬 요청으로도 비교 횟수가 한도를 넘지 못한다.
   */
  claimAttempt(email: string, prev: number): Promise<number | null>;
  /** 오입력 한도 소진 — 해시·만료만 지우고 시도 횟수는 남긴다(다음 요청이 locked 로 답하게) */
  discard(email: string): Promise<void>;
  /** 확인 성공 — 행 삭제(남은 해시는 재사용 위험, 이메일은 더 보관할 이유가 없다) */
  consume(email: string): Promise<void>;
}

/** DB 오류 — 라우트가 500 으로 바꾼다 */
export class ThesisOtpStoreError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ThesisOtpStoreError';
    this.code = code;
  }
}

// ── dev: in-memory ──────────────────────────────────────────────────────

const GLOBAL_KEY = '__thesisSubmitOtpStore';
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: Map<string, OtpRecord> };

function memoryMap(): Map<string, OtpRecord> {
  const g = globalThis as GlobalWithStore;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY];
}

const memoryStore: ThesisOtpStore = {
  async get(email) {
    const r = memoryMap().get(email);
    return r ? { ...r } : null;
  },
  async issue(email, hash, expiresAt, sentAt) {
    memoryMap().set(email, {
      email,
      otpHash: hash,
      otpExpiresAt: expiresAt,
      otpAttempts: 0,
      otpSentAt: sentAt,
    });
  },
  async claimAttempt(email, prev) {
    const r = memoryMap().get(email);
    if (!r || r.otpAttempts !== prev) return null;
    r.otpAttempts = prev + 1;
    return r.otpAttempts;
  },
  async discard(email) {
    const r = memoryMap().get(email);
    if (!r) return;
    r.otpHash = null;
    r.otpExpiresAt = null;
  },
  async consume(email) {
    memoryMap().delete(email);
  },
};

// ── 프로덕션: Supabase ───────────────────────────────────────────────────

const TABLE = 'thesis_submit_otps';
const COLS = 'email, otp_hash, otp_expires_at, otp_attempts, otp_sent_at';

interface OtpRow {
  email: string;
  otp_hash: string | null;
  otp_expires_at: string | null;
  otp_attempts: number | null;
  otp_sent_at: string | null;
}

/** 오래된 행 정리 기준 — 쿨다운(60초)·유효 시간(10분)이 모두 지난 기록은 쓸모가 없다 */
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

let _sb: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ThesisOtpStoreError('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

function fail(error: { message: string; code?: string }): never {
  throw new ThesisOtpStoreError(error.message, error.code);
}

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

const supabaseStore: ThesisOtpStore = {
  async get(email) {
    const { data, error } = await db().from(TABLE).select(COLS).eq('email', email).maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    const r = data as OtpRow;
    return {
      email: r.email,
      otpHash: r.otp_hash ?? null,
      otpExpiresAt: ms(r.otp_expires_at),
      otpAttempts: r.otp_attempts ?? 0,
      otpSentAt: ms(r.otp_sent_at),
    };
  },
  async issue(email, hash, expiresAt, sentAt) {
    const { error } = await db()
      .from(TABLE)
      .upsert(
        {
          email,
          otp_hash: hash,
          otp_expires_at: new Date(expiresAt).toISOString(),
          otp_attempts: 0,
          otp_sent_at: new Date(sentAt).toISOString(),
        },
        { onConflict: 'email' },
      );
    if (error) fail(error);
    // 기회가 될 때 오래된 기록을 치운다(크론 없이 보관 기간을 하루로 묶는다).
    // 정리 실패는 발급과 무관하므로 로그만 남긴다.
    const cutoff = new Date(sentAt - PURGE_AFTER_MS).toISOString();
    const purge = await db().from(TABLE).delete().lt('otp_sent_at', cutoff);
    if (purge.error) console.error('[thesis-submit] 오래된 인증 기록 정리 실패', purge.error.message);
  },
  async claimAttempt(email, prev) {
    // supabase-js 에는 원자적 증가가 없다 — "현재 값이 prev 일 때만" 조건부 갱신으로 선점한다
    const { data, error } = await db()
      .from(TABLE)
      .update({ otp_attempts: prev + 1 })
      .eq('email', email)
      .eq('otp_attempts', prev)
      .select('otp_attempts');
    if (error) fail(error);
    return Array.isArray(data) && data.length === 1 ? prev + 1 : null;
  },
  async discard(email) {
    const { error } = await db()
      .from(TABLE)
      .update({ otp_hash: null, otp_expires_at: null })
      .eq('email', email);
    if (error) fail(error);
  },
  async consume(email) {
    const { error } = await db().from(TABLE).delete().eq('email', email);
    if (error) fail(error);
  },
};

/** 환경에 맞는 저장소 — dev 는 메모리, 프로덕션은 Supabase */
export function thesisOtpStore(): ThesisOtpStore {
  return process.env.NODE_ENV === 'production' ? supabaseStore : memoryStore;
}

/** dev 고정 코드 — dev 저장소에서만 쓴다(프로덕션은 randomInt 6자리) */
export const DEV_OTP_CODE = '000000';
