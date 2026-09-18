/**
 * 교직원 **예비심사 공고 양식**(관리자 콘솔) 저장 로직 — 서버 전용.
 *
 * 계약(요청·응답·헤더)은 lib/thesis-submit/staff-post.ts, 라우트는
 * app/api/admin/thesis/post/route.ts. 여기는 검사 → 포스터 업로드 → 행 쓰기 순서만 가진다.
 *
 *   새 글(id 없음)   : R2 새 키 → posts insert(published=true, 입력 원본은 thesis_submission 에
 *                      `source:'staff'` 로) → revalidateTag('posts'). 승인·메일 없음.
 *   수정(id 있음)    : 양식으로 만든 글(thesis_submission.notice 가 있는 학위논문심사 글)만.
 *                      반려된 제출은 409. R2 **새 키**(immutable 캐시라 덮어쓰지 않는다) →
 *                      제목·본문·notice(다른 키 보존)·게시일 갱신.
 *     └ 학생 제출 승인 대기(published=false)면 이어서 approveSubmissions 로 게시한다 —
 *       검토 화면의 '승인하고 게시'와 같은 기록(status·decidedAt/By)·게시일 규칙·학생 안내 메일.
 *       (= 디자인의 '수정 후 게시'. 메일은 방금 고친 제목·입력으로 나간다 — 갱신 뒤에 읽으므로)
 *     └ 이미 게시된 글(교직원 작성·승인된 학생 글)은 내용만 갱신 → revalidateTag.
 *
 * 관리자는 지난 심사일도 적을 수 있다(구 공고 옮겨 적기) — validateNotice 의 과거 날짜 검사를
 * 끈다(today='0000-00-00'). 나머지 칸 검사는 학생 제출과 같다.
 *
 * 시험: saveStaffPost 가 마지막 인자로 StaffPostDeps 를 받는다(생략 = 서버 기본값, 동적 import).
 * thesis-review.ts 의 ReviewDeps 를 그대로 확장하므로 가짜 DB·가짜 R2·가짜 메일을 넘겨
 * 실제 쓰기·업로드·발송 없이 순서를 검증할 수 있다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { NOTICE_POSTER_MAX_BYTES } from '@/lib/thesis-submit/config';
import {
  cleanNotice,
  parseNotice,
  postTitle,
  squash,
  todayKst,
  validateNotice,
  type NoticeError,
} from '@/lib/thesis-submit/notice';
import { isPosterPng, posterBodyHtml, posterKey } from '@/lib/thesis-submit/poster-post';
import type { ReviewGuard } from '@/lib/thesis-submit/review-db';
import { statusOf, type ThesisSubmissionRecord } from '@/lib/thesis-submit/review';
import {
  STAFF_TITLE_MAX,
  isHm,
  isIsoDate,
  publishCreatedAt,
  type StaffPostResponse,
} from '@/lib/thesis-submit/staff-post';
import { approveSubmissions, reviewDeps, type ReviewDeps } from './thesis-review';

// ── 의존성 ───────────────────────────────────────────────────────────────

/** 새 글 행 — 나머지 열(pinned·body_raw 등)은 DB 기본값 */
export interface StaffInsertRow {
  board: 'thesis';
  title_ko: string;
  body_html_ko: string;
  published: true;
  created_at: string;
  thesis_submission: Record<string, unknown>;
}

/** 내용 갱신 — 준 열만 바꾼다. thesis_submission 은 읽고-병합한 **전체** 기록(jsonb 통째 교체) */
export interface StaffContentPatch {
  title_ko?: string;
  body_html_ko?: string;
  created_at?: string;
  thesis_submission?: Record<string, unknown>;
}

export interface StaffPostDb {
  /** 새 글 — 만든 posts.id */
  insert(row: StaffInsertRow): Promise<number>;
  /** 조건부 갱신(review-db 의 ReviewGuard 와 같은 의미) — 갱신된 행 수(0 = 조건 불일치·없음) */
  update(id: number, patch: StaffContentPatch, guard?: ReviewGuard): Promise<number>;
}

export interface StaffPostDeps extends ReviewDeps {
  posts: StaffPostDb;
  /** 포스터 PNG 업로드 — 공개 URL */
  putPoster: (key: string, png: Buffer) => Promise<string>;
}

/** 진짜 구현 — 서비스 키 클라이언트(adminDb())를 받는다 */
export function supabaseStaffPostDb(sb: SupabaseClient): StaffPostDb {
  return {
    async insert(row) {
      const { data, error } = await sb.from('posts').insert(row).select('id').single();
      if (error || !data) throw new Error(`posts 저장 실패: ${error?.message ?? '응답 없음'}`);
      return Number((data as { id: unknown }).id);
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
  };
}

/** 서버 기본 의존성 — 동적 import(thesis-review.ts 머리 주석과 같은 이유). 요청마다 만든다 */
export async function staffPostDeps(): Promise<StaffPostDeps> {
  const [base, { adminDb }, { r2Put }] = await Promise.all([
    reviewDeps(),
    import('@/lib/admin/posts-server'),
    import('@/lib/admin/r2'),
  ]);
  return {
    ...base,
    posts: supabaseStaffPostDb(adminDb()),
    putPoster: (key, png) => r2Put(key, png, 'image/png'),
  };
}

// ── 조각 ─────────────────────────────────────────────────────────────────

export interface StaffPostOutcome {
  status: number;
  body: StaffPostResponse;
}

/** validateNotice 의 과거 날짜 검사를 끄는 '오늘' — 어떤 날짜도 이보다 작지 않다 */
const NO_PAST_CHECK = '0000-00-00';

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function parseId(raw: unknown): number | null {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,15}$/.test(s)) return null;
  const id = Number(s);
  return id > 0 ? id : null;
}

/** 선택 문자열 칸 — 없으면 '', 문자열이 아니면 null(형식 오류) */
function optStr(v: unknown): string | null {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v.trim() : null;
}

function fail(status: number, error: string, extra?: { errors?: NoticeError[] }): StaffPostOutcome {
  return { status, body: { ok: false, error, ...(extra ?? {}) } };
}

const RETRY = '잠시 후 다시 시도해 주세요.';

function revalidateSafe(d: StaffPostDeps) {
  try {
    d.revalidate();
  } catch (err) {
    console.error('[thesis-staff-post] revalidateTag 실패', err);
  }
}

// ── 저장 ─────────────────────────────────────────────────────────────────

/**
 * 교직원 공고 양식 저장. raw = 요청의 data(JSON 파싱 결과), poster = PNG 바이트.
 * 검사 순서: 형식 → parseNotice → cleanNotice → validateNotice(과거 날짜 허용) → 게시일·시각·제목
 *          → 포스터 PNG 규격. 그 뒤에야 DB 를 읽고 업로드한다(거절할 요청으로 R2 를 채우지 않는다).
 */
export async function saveStaffPost(
  raw: unknown,
  poster: Buffer | null,
  actor: string,
  deps?: StaffPostDeps,
): Promise<StaffPostOutcome> {
  if (!isObj(raw)) return fail(400, '요청 형식이 올바르지 않습니다.');

  let id: number | null = null;
  if (raw.id !== undefined && raw.id !== null && raw.id !== '') {
    id = parseId(raw.id);
    if (!id) return fail(400, '잘못된 글 번호입니다.');
  }

  const parsed = parseNotice(raw.notice);
  if (!parsed) return fail(400, '입력 형식이 올바르지 않습니다.');
  const notice = cleanNotice(parsed);
  const errors = validateNotice(notice, NO_PAST_CHECK);
  if (errors.length > 0) return fail(400, '입력한 내용을 확인해 주세요.', { errors });

  const date = optStr(raw.date);
  const time = optStr(raw.time);
  const titleRaw = optStr(raw.title);
  if (date === null || time === null || titleRaw === null) return fail(400, '요청 형식이 올바르지 않습니다.');
  if (date && !isIsoDate(date)) return fail(400, '게시일 형식이 올바르지 않습니다.');
  if (time && !isHm(time)) return fail(400, '공개 시각 형식이 올바르지 않습니다.');
  if (time && !date) return fail(400, '공개 시각은 게시일과 함께 보내야 합니다.');
  const customTitle = squash(titleRaw);
  if (customTitle.length > STAFF_TITLE_MAX) {
    return fail(400, `제목은 ${STAFF_TITLE_MAX}자를 넘을 수 없습니다.`);
  }
  const title = customTitle || postTitle(notice);

  if (!poster || poster.length === 0 || poster.length > NOTICE_POSTER_MAX_BYTES || !isPosterPng(poster)) {
    return fail(400, '포스터 이미지가 올바르지 않습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.');
  }

  const d = deps ?? (await staffPostDeps());
  const input = { notice, date, time, title, poster };
  return id === null ? createPost(d, input, actor) : updatePost(d, id, input, actor);
}

interface CleanInput {
  notice: ReturnType<typeof cleanNotice>;
  /** '' = 보내지 않음 */
  date: string;
  time: string;
  title: string;
  poster: Buffer;
}

/** 포스터 업로드 + 본문 조립. 실패면 오류 결과 */
async function uploadBody(
  d: StaffPostDeps,
  input: CleanInput,
  now: number,
): Promise<{ body: string } | StaffPostOutcome> {
  let url: string;
  try {
    url = await d.putPoster(posterKey(input.notice, now), input.poster);
  } catch (err) {
    console.error('[thesis-staff-post] 포스터 R2 저장 실패', err);
    return fail(500, `포스터 이미지를 저장하지 못했습니다. ${RETRY}`);
  }
  const body = posterBodyHtml(input.notice, url);
  // 정화가 이미지를 떨어뜨렸다면(허용 스킴 밖 URL 등) 빈 게시물이 된다 — 저장하지 않는다
  if (!body.includes(url)) {
    console.error('[thesis-staff-post] 본문 정화 뒤 포스터 이미지가 사라짐', url);
    return fail(500, `포스터 이미지를 본문에 넣지 못했습니다. ${RETRY}`);
  }
  return { body };
}

async function createPost(d: StaffPostDeps, input: CleanInput, actor: string): Promise<StaffPostOutcome> {
  const now = d.now();
  const up = await uploadBody(d, input, now);
  if ('status' in up) return up;

  const at = new Date(now).toISOString();
  const record: ThesisSubmissionRecord = {
    source: 'staff',
    email: actor,
    submittedAt: at,
    notice: input.notice,
    status: 'approved',
    review: { decidedAt: at, decidedBy: actor },
  };
  let newId: number;
  try {
    newId = await d.posts.insert({
      board: 'thesis',
      title_ko: input.title,
      body_html_ko: up.body,
      published: true,
      created_at: publishCreatedAt(input.date || todayKst(now), input.time),
      thesis_submission: record as unknown as Record<string, unknown>,
    });
  } catch (err) {
    console.error('[thesis-staff-post] 새 글 저장 실패', err);
    return fail(500, `저장하지 못했습니다. ${RETRY}`);
  }
  revalidateSafe(d);
  return { status: 200, body: { ok: true, id: String(newId) } };
}

async function updatePost(
  d: StaffPostDeps,
  id: number,
  input: CleanInput,
  actor: string,
): Promise<StaffPostOutcome> {
  let row;
  try {
    row = await d.db.get(id);
  } catch (err) {
    console.error('[thesis-staff-post] 글 조회 실패', id, err);
    return fail(500, `글을 읽지 못했습니다. ${RETRY}`);
  }
  if (!row) return fail(404, '글을 찾을 수 없습니다. 이미 삭제되었거나 다른 게시판으로 옮겨졌을 수 있습니다.');
  const rec = row.thesis_submission;
  if (!rec || !parseNotice(rec.notice)) {
    return fail(409, '공고 양식으로 만든 글이 아닙니다. 일반 편집기로 고쳐 주세요.');
  }
  if (statusOf(rec, row.published) === 'rejected') {
    return fail(409, '반려된 공고는 고칠 수 없습니다. 학생이 고쳐 다시 제출해야 합니다.');
  }
  // 학생 제출 승인 대기 — 고친 뒤 승인과 같은 게시로 이어진다
  const pending = !row.published;

  const now = d.now();
  const up = await uploadBody(d, input, now);
  if ('status' in up) return up;

  const desired = input.date ? publishCreatedAt(input.date, input.time) : null;
  const patch: StaffContentPatch = {
    title_ko: input.title,
    body_html_ko: up.body,
    // 입력 원본만 바꾼다 — source·email·submittedAt·status·review(메모 등)는 그대로
    thesis_submission: { ...rec, notice: input.notice },
    ...(desired ? { created_at: desired } : {}),
  };
  // 읽은 뒤 다른 관리자가 먼저 게시·반려했으면 0행 — 덮어쓰지 않는다
  const guard: ReviewGuard = pending ? { published: false, statusNot: 'rejected' } : { published: true };
  let n: number;
  try {
    n = await d.posts.update(id, patch, guard);
  } catch (err) {
    console.error('[thesis-staff-post] 글 갱신 실패', id, err);
    return fail(500, `저장하지 못했습니다. ${RETRY}`);
  }
  if (n === 0) {
    return fail(409, '다른 관리자가 먼저 처리했습니다. 목록을 새로 고친 뒤 다시 열어 주세요.');
  }

  if (!pending) {
    revalidateSafe(d);
    return { status: 200, body: { ok: true, id: String(id) } };
  }

  // ── 학생 제출: 승인과 같은 게시(status·결정 기록·게시일 규칙·학생 게시 안내 메일) ──
  const [result] = await approveSubmissions([String(id)], actor, d);
  if (!result?.ok) {
    return fail(409, `고친 내용은 저장했지만 게시하지 못했습니다 — ${result?.error ?? '알 수 없는 오류'}`);
  }
  if (result.already) {
    // 그 사이 다른 관리자가 게시했다 — 내용은 이번 것으로 바뀌었으니 캐시만 턴다(메일은 그쪽이 보냈다)
    revalidateSafe(d);
    return { status: 200, body: { ok: true, id: String(id), already: true } };
  }
  // 게시일 규칙(approveSubmissions)은 '미래 날짜만 그대로, 아니면 오늘 0시'라 **오늘 늦은 시각**
  // 예약을 0시로 당긴다. 양식에서 그렇게 예약했다면 되돌려 놓는다(지난 날짜는 규칙대로 오늘).
  if (desired) {
    const at = Date.parse(desired);
    if (Number.isFinite(at) && at > now && todayKst(at) === todayKst(now)) {
      try {
        await d.posts.update(id, { created_at: desired }, { published: true });
        revalidateSafe(d);
      } catch (err) {
        console.error('[thesis-staff-post] 예약 시각 복원 실패', id, err);
      }
    }
  }
  return { status: 200, body: { ok: true, id: String(id), mailSent: result.mailSent === true } };
}
