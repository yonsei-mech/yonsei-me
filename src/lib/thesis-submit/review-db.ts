/**
 * 학생 제출 공고 검토의 **DB 접근 계약** — 서버 전용(서비스 키 클라이언트를 받는다).
 *
 * 검토 로직(lib/admin/thesis-review.ts)과 제출 API(대기 건수 세기)가 posts 테이블을
 * 이 작은 인터페이스로만 만진다. 이유 둘:
 *   1. 시험 — `.env.local` 에 프로덕션 키가 있어 dev 에서도 실제 DB 에 쓰게 된다. 로직은
 *      이 인터페이스의 가짜 구현으로 시험하고, 진짜 구현(supabaseReviewDb)은 얇게 둔다.
 *   2. 조건부 갱신 — 승인·반려는 "published=false 이고 반려되지 않은 행만" 같은 조건을 걸어
 *      두 관리자가 동시에 눌러도 한 번만 처리되게 한다(갱신된 행 수로 판정).
 *
 * 대기(pending) 판정은 review.ts 의 statusOf 와 같다: published=false 인 제출 행 중
 * 저장된 status 가 없거나(기존 제출분) 'pending' 인 것. DB 필터도 같은 조건으로 건다.
 *
 * ⚠️ supabase-js 는 타입만 가져온다 — 제출 API 번들에 Auth.js 등이 딸려 오지 않게
 *    posts-server 를 import 하지 않는다(클라이언트는 호출부가 넘긴다).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReviewStatus } from './review';

/** 검토에 필요한 posts 열만 */
export interface ReviewRow {
  id: number;
  board: string;
  published: boolean;
  /** timestamptz — 게시일(KST 자정 관례) */
  created_at: string;
  title_ko: string | null;
  /** 제출 기록(jsonb) — 학생 제출이 아닌 글은 null */
  thesis_submission: Record<string, unknown> | null;
}

export interface ReviewPatch {
  published?: boolean;
  created_at?: string;
  /** 읽고-병합한 **전체** 기록(jsonb 는 통째로 교체된다 — 다른 키를 보존해서 넘길 것) */
  thesis_submission: Record<string, unknown>;
}

/** 조건부 갱신 조건 — 모두 만족하는 행만 갱신한다 */
export interface ReviewGuard {
  /** 현재 published 가 이 값일 때만 */
  published?: boolean;
  /** 저장된 status 가 이 값이 **아닐** 때만(status 없는 기존 제출분은 통과) */
  statusNot?: ReviewStatus;
}

export interface ThesisReviewDb {
  /** 학위논문심사 게시판의 글 하나(없거나 다른 게시판이면 null) */
  get(id: number): Promise<ReviewRow | null>;
  /** 조건부 갱신 — 갱신된 행 수(0 = 조건 불일치·없음) */
  update(id: number, patch: ReviewPatch, guard?: ReviewGuard): Promise<number>;
  /** 검토 대기 행 전부 */
  listPending(): Promise<ReviewRow[]>;
  /** 검토 대기 건수 */
  countPending(): Promise<number>;
}

const COLS = 'id, board, published, created_at, title_ko, thesis_submission';
/** PostgREST 필터 — 저장된 status 가 없거나 'pending' (published=false 와 함께 = statusOf 의 pending) */
const PENDING_STATUS = 'thesis_submission->>status.is.null,thesis_submission->>status.eq.pending';

function normalize(r: Record<string, unknown>): ReviewRow {
  const ts = r.thesis_submission;
  return {
    id: Number(r.id),
    board: String(r.board ?? ''),
    // null·undefined 는 예전 행 = 공개(lib/posts.ts·posts-server 와 같은 규칙)
    published: r.published !== false,
    created_at: String(r.created_at ?? ''),
    title_ko: typeof r.title_ko === 'string' ? r.title_ko : null,
    thesis_submission: ts && typeof ts === 'object' ? (ts as Record<string, unknown>) : null,
  };
}

/** 진짜 구현 — 서비스 키 클라이언트(adminDb() 등)를 받는다 */
export function supabaseReviewDb(sb: SupabaseClient): ThesisReviewDb {
  return {
    async get(id) {
      const { data, error } = await sb
        .from('posts')
        .select(COLS)
        .eq('id', id)
        .eq('board', 'thesis')
        .maybeSingle();
      if (error) throw new Error(`posts 조회 실패: ${error.message}`);
      return data ? normalize(data as Record<string, unknown>) : null;
    },

    async update(id, patch, guard = {}) {
      let q = sb.from('posts').update(patch).eq('id', id).eq('board', 'thesis');
      if (guard.published !== undefined) q = q.eq('published', guard.published);
      if (guard.statusNot) {
        q = q.or(
          `thesis_submission->>status.is.null,thesis_submission->>status.neq.${guard.statusNot}`,
        );
      }
      const { data, error } = await q.select('id');
      if (error) throw new Error(`posts 갱신 실패: ${error.message}`);
      return (data ?? []).length;
    },

    async listPending() {
      const { data, error } = await sb
        .from('posts')
        .select(COLS)
        .eq('board', 'thesis')
        .eq('published', false)
        .not('thesis_submission', 'is', null)
        .or(PENDING_STATUS)
        .order('id', { ascending: false })
        .limit(500);
      if (error) throw new Error(`검토 대기 조회 실패: ${error.message}`);
      return ((data ?? []) as Record<string, unknown>[]).map(normalize);
    },

    async countPending() {
      const { count, error } = await sb
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('board', 'thesis')
        .eq('published', false)
        .not('thesis_submission', 'is', null)
        .or(PENDING_STATUS);
      if (error) throw new Error(`검토 대기 건수 조회 실패: ${error.message}`);
      return count ?? 0;
    },
  };
}
