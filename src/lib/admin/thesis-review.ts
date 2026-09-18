/**
 * 학생 제출 예비심사 공고의 **승인·반려 결정 로직 단일 출처** — 서버 전용.
 *
 * 쓰는 곳:
 *   - /api/admin/thesis/{approve,reject,review,summary}  (검토 화면·대시보드)
 *   - PUT /api/admin/posts/[id]  (PostForm '게시하기' — 입력 원본이 깨진 제출의 '수정 후 게시')
 *   - POST /api/admin/thesis/post (공고 양식의 '수정 후 게시' — thesis-staff-post.ts 가 approveSubmissions 를 부른다)
 * 두 경로 모두 같은 결과가 된다: posts.published=true · thesis_submission.status='approved' ·
 * review.decidedAt/decidedBy · 학생에게 게시 안내 메일 · review.mailSent.
 *
 * 저장 계약은 lib/thesis-submit/review.ts(상태·사유·검토 기록 모양), DB 접근은
 * lib/thesis-submit/review-db.ts(조건부 갱신) — 여기는 그 둘을 엮는 순서만 가진다.
 *
 * 설계 메모:
 * - jsonb(thesis_submission)는 **읽고-병합-쓰기**다. 통째로 교체되므로 다른 키(email·notice·
 *   review 의 memo·checks 등)를 반드시 보존한다(decided·patchReview).
 * - 이중 처리 방지는 조건부 갱신이다 — 승인·반려는 `published=false AND status≠rejected`,
 *   PostForm 게시 후처리는 `status≠approved`. 갱신 0행 = 다른 관리자가 먼저 처리한 것.
 * - 메일은 결정 **뒤** 최선 노력이다. 실패해도 결정은 유지되고 review.mailSent=false 로 남는다.
 * - 게시 안내 메일은 revalidateTag('posts') **뒤**에 보낸다 — 학생이 링크를 눌렀을 때 글이 떠야 한다.
 *
 * 시험: 모든 함수가 마지막 인자로 ReviewDeps 를 받는다(생략 = 서버 기본값). 기본값은
 * 동적 import 로만 만든다 — 시험 하네스가 이 파일을 불러도 Auth.js·next/cache·실제 DB 가
 * 딸려 오지 않고, 가짜 DB·가짜 메일을 넘겨 실제 쓰기·발송 없이 순서를 검증할 수 있다.
 */
import { boardPostHref } from '@/lib/board-links';
import { publishedMail, rejectedMail, type MailOut } from '@/lib/mail/thesis-mails';
import { SITE_URL } from '@/lib/site';
import { THESIS_SUBMIT_PATH } from '@/lib/thesis-submit/config';
import type { ThesisContact } from '@/lib/thesis-submit/contact';
import { parseNotice, postTitle, todayKst, type ThesisNoticeInput } from '@/lib/thesis-submit/notice';
import {
  REJECT_MESSAGE_MAX,
  REJECT_REASONS,
  REVIEW_MEMO_MAX,
  receiptNo,
  statusOf,
  type RejectReason,
  type ReviewStatus,
  type ThesisReview,
} from '@/lib/thesis-submit/review';
import { supabaseReviewDb, type ReviewRow, type ThesisReviewDb } from '@/lib/thesis-submit/review-db';

// ── 의존성 ───────────────────────────────────────────────────────────────

export interface ReviewDeps {
  db: ThesisReviewDb;
  /** 메일 한 통 — 성공 여부만(실패 상세는 구현이 로그로) */
  sendMail: (to: string, mail: MailOut) => Promise<boolean>;
  /** 문의처(대학원 담당 교직원) — 못 읽으면 null */
  contact: () => Promise<ThesisContact | null>;
  /** 사이트 게시판 캐시 무효화(revalidateTag('posts')) */
  revalidate: () => void;
  now: () => number;
}

/** 서버 기본 의존성 — 동적 import(파일 머리 주석). 요청마다 만든다(모듈은 캐시된다) */
export async function reviewDeps(): Promise<ReviewDeps> {
  const [{ adminDb }, { sendBrevoMail }, { thesisContact }, { revalidateTag }] = await Promise.all([
    import('@/lib/admin/posts-server'),
    import('@/lib/mail/brevo'),
    import('@/lib/thesis-submit/contact'),
    import('next/cache'),
  ]);
  return {
    db: supabaseReviewDb(adminDb()),
    sendMail: async (to, mail) =>
      (await sendBrevoMail({ to, subject: mail.subject, html: mail.html, logTag: '[thesis-review]' })).ok,
    contact: () =>
      thesisContact('ko').catch((err) => {
        console.error('[thesis-review] 문의처 읽기 실패', err);
        return null;
      }),
    revalidate: () => revalidateTag('posts'),
    now: () => Date.now(),
  };
}

/** 처리한 관리자 — 프로덕션은 Auth.js 세션 이메일(없으면 GitHub login), dev 는 'dev' */
export async function reviewActor(): Promise<string> {
  if (process.env.NODE_ENV !== 'production') return 'dev';
  const { auth } = await import('@/auth');
  const session = await auth().catch(() => null);
  return session?.user?.email || session?.user?.login || session?.user?.name || 'unknown';
}

// ── 공용 조각 ────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 승인 한 번에 받는 최대 건수(API 계약 1~50) */
export const APPROVE_MAX_IDS = 50;
/** 메일 동시 발송 수 — 일괄 승인 50건에서도 Brevo 에 몰아치지 않게 */
const MAIL_CONCURRENCY = 5;

function parseId(raw: unknown): number | null {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,15}$/.test(s)) return null;
  const id = Number(s);
  return id > 0 ? id : null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function reviewOf(rec: Record<string, unknown>): ThesisReview {
  return (isObj(rec.review) ? rec.review : {}) as ThesisReview;
}

/** 결정 기록을 병합한 **전체** 제출 기록. 이전 결정의 mailSent 는 지운다(이번 발송 결과로 다시 쓴다) */
function decided(
  rec: Record<string, unknown>,
  status: ReviewStatus,
  actor: string,
  now: number,
  extra: Partial<ThesisReview> = {},
): Record<string, unknown> {
  const { mailSent: _stale, ...review } = reviewOf(rec);
  return {
    ...rec,
    status,
    review: { ...review, decidedAt: new Date(now).toISOString(), decidedBy: actor, ...extra },
  };
}

/** 게시일 — 게시한 날(KST 자정). 이미 미래 날짜(게시 예약)면 그대로 둔다(PostForm commit 과 같은 규칙) */
function publishCreatedAt(current: string, now: number): string {
  const today = todayKst(now);
  const t = Date.parse(current);
  const currentDay = Number.isFinite(t) ? todayKst(t) : '';
  return currentDay > today ? current : `${today}T00:00:00+09:00`;
}

/** 학생 제출 공고인가 — 학위논문심사 게시판 + 제출 기록 */
function isSubmission(row: ReviewRow | null): row is ReviewRow & { thesis_submission: Record<string, unknown> } {
  return Boolean(row && row.board === 'thesis' && row.thesis_submission);
}

/** 메일 수신자·입력 — 기록이 깨졌으면 null(메일을 보내지 않는다) */
function mailTarget(rec: Record<string, unknown>): { email: string; notice: ThesisNoticeInput } | null {
  const email = typeof rec.email === 'string' ? rec.email.trim() : '';
  const notice = parseNotice(rec.notice);
  return EMAIL_RE.test(email) && notice ? { email, notice } : null;
}

/** 절대 URL — 게시물 상세(경로는 board-links 가 단일 출처) */
function thesisPostUrl(id: number): string {
  return `${SITE_URL}/ko${boardPostHref({ id: String(id), boardKey: 'thesis' })}`;
}

/** review.mailSent 기록 — 최신 행을 다시 읽어 병합한다(그 사이 메모 저장 등을 덮지 않게) */
async function recordMailSent(d: ReviewDeps, id: number, sent: boolean): Promise<void> {
  try {
    const row = await d.db.get(id);
    if (!isSubmission(row)) return;
    const rec = row.thesis_submission;
    await d.db.update(id, { thesis_submission: { ...rec, review: { ...reviewOf(rec), mailSent: sent } } });
  } catch (err) {
    console.error('[thesis-review] mailSent 기록 실패', id, err);
  }
}

/** 메일 한 통 + mailSent 기록. 발송 성공 여부를 돌려준다 */
async function mailAndRecord(d: ReviewDeps, id: number, to: string | null, mail: MailOut | null): Promise<boolean> {
  let sent = false;
  if (to && mail) {
    try {
      sent = await d.sendMail(to, mail);
    } catch (err) {
      console.error('[thesis-review] 메일 발송 오류', id, err);
    }
  }
  await recordMailSent(d, id, sent);
  return sent;
}

/** 게시 안내 메일(3) 한 통 — 행은 갱신 **직전**에 읽은 값(제목·제출 기록) */
async function sendPublished(
  d: ReviewDeps,
  row: ReviewRow & { thesis_submission: Record<string, unknown> },
  contact: ThesisContact | null,
): Promise<boolean> {
  const target = mailTarget(row.thesis_submission);
  const mail = target
    ? publishedMail({
        notice: target.notice,
        receiptNo: receiptNo(target.notice, row.id),
        postTitle: row.title_ko?.trim() || postTitle(target.notice),
        postUrl: thesisPostUrl(row.id),
        contact,
      })
    : null;
  return mailAndRecord(d, row.id, target?.email ?? null, mail);
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

// ── 승인 ────────────────────────────────────────────────────────────────

export interface ApproveResult {
  id: string;
  ok: boolean;
  /** 이미 게시된 글(다른 관리자가 먼저 처리했거나 PostForm 으로 게시됨) — ok 는 true */
  already?: boolean;
  /** 게시 안내 메일 발송 성공 여부(이번에 게시한 건만) */
  mailSent?: boolean;
  error?: string;
}

/**
 * 일괄 승인 — 행마다 `published=false AND status≠rejected` 조건부로 게시한다.
 * 게시일은 게시한 날(KST 자정), status='approved', review.decidedAt/decidedBy.
 * 게시한 건이 하나라도 있으면 revalidateTag('posts') 뒤에 학생 메일을 보낸다.
 */
export async function approveSubmissions(
  ids: string[],
  actor: string,
  deps?: ReviewDeps,
): Promise<ApproveResult[]> {
  const d = deps ?? (await reviewDeps());
  const results: ApproveResult[] = [];
  const approved: { row: ReviewRow & { thesis_submission: Record<string, unknown> }; result: ApproveResult }[] = [];

  for (const raw of ids) {
    const id = parseId(raw);
    if (!id) {
      results.push({ id: String(raw), ok: false, error: '잘못된 글 번호입니다.' });
      continue;
    }
    const key = String(raw);
    try {
      const row = await d.db.get(id);
      if (!isSubmission(row)) {
        results.push({ id: key, ok: false, error: '학생이 제출한 공고를 찾을 수 없습니다.' });
        continue;
      }
      const state = (r: ReviewRow & { thesis_submission: Record<string, unknown> }): ApproveResult | null => {
        if (r.published) return { id: key, ok: true, already: true };
        if (statusOf(r.thesis_submission, false) === 'rejected') {
          return { id: key, ok: false, error: '반려된 공고입니다.' };
        }
        return null;
      };
      const early = state(row);
      if (early) {
        results.push(early);
        continue;
      }
      const now = d.now();
      const n = await d.db.update(
        id,
        {
          published: true,
          created_at: publishCreatedAt(row.created_at, now),
          thesis_submission: decided(row.thesis_submission, 'approved', actor, now),
        },
        { published: false, statusNot: 'rejected' },
      );
      if (n === 0) {
        // 읽은 뒤 누가 먼저 처리했다 — 지금 상태로 답한다
        const again = await d.db.get(id);
        results.push(
          (isSubmission(again) && state(again)) || { id: key, ok: false, error: '다른 관리자가 먼저 처리했습니다.' },
        );
        continue;
      }
      const result: ApproveResult = { id: key, ok: true };
      results.push(result);
      approved.push({ row, result });
    } catch (err) {
      console.error('[thesis-review] 승인 실패', id, err);
      results.push({ id: key, ok: false, error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  }

  if (approved.length > 0) {
    try {
      d.revalidate();
    } catch (err) {
      console.error('[thesis-review] revalidateTag 실패', err);
    }
    const contact = await d.contact();
    await inBatches(approved, MAIL_CONCURRENCY, async ({ row, result }) => {
      result.mailSent = await sendPublished(d, row, contact);
    });
  }
  return results;
}

// ── PostForm '게시하기' 후처리 (PUT /api/admin/posts/[id]) ─────────────────

/** 저장 **전**에 부른다 — 검토 대기 중인 학생 제출 공고인가(published=false + 제출 기록) */
export async function isUnpublishedSubmission(id: number, deps?: ReviewDeps): Promise<boolean> {
  const d = deps ?? (await reviewDeps());
  const row = await d.db.get(id);
  return isSubmission(row) && !row.published;
}

/**
 * PostForm 이 published false→true 로 저장한 **뒤**에 부른다 — 승인과 같은 기록·메일.
 * 게시일·본문은 PostForm 저장이 이미 정했으므로 thesis_submission 만 고친다.
 * `status≠approved` 조건부라 동시에 두 번 게시돼도 메일은 한 번이다(0행이면 null).
 * revalidateTag 는 PUT 이 이미 불렀다.
 */
export async function settleEditPublish(
  id: number,
  actor: string,
  deps?: ReviewDeps,
): Promise<{ mailSent: boolean } | null> {
  const d = deps ?? (await reviewDeps());
  const row = await d.db.get(id);
  if (!isSubmission(row) || !row.published) return null;
  const n = await d.db.update(
    id,
    { thesis_submission: decided(row.thesis_submission, 'approved', actor, d.now()) },
    { published: true, statusNot: 'approved' },
  );
  if (n === 0) return null;
  return { mailSent: await sendPublished(d, row, await d.contact()) };
}

// ── 반려 ────────────────────────────────────────────────────────────────

export type DecisionOutcome =
  | { ok: true; mailSent: boolean }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string };

/**
 * 반려 — 검토 대기(published=false, status≠rejected)만. status='rejected' + 사유·메시지·
 * decidedAt/decidedBy 를 남기고(published 는 false 유지) 학생에게 반려 안내 메일을 보낸다.
 * 메시지는 사유가 '기타'일 때만 필수다.
 */
export async function rejectSubmission(
  idRaw: string,
  reason: RejectReason,
  message: string,
  actor: string,
  deps?: ReviewDeps,
): Promise<DecisionOutcome> {
  const id = parseId(idRaw);
  if (!id) return { ok: false, status: 400, error: '잘못된 글 번호입니다.' };
  if (!REJECT_REASONS.includes(reason)) return { ok: false, status: 400, error: '반려 사유를 선택하세요.' };
  if (typeof message !== 'string') return { ok: false, status: 400, error: '메시지 형식이 올바르지 않습니다.' };
  const msg = message.replace(/\r\n?/g, '\n').trim();
  if (msg.length > REJECT_MESSAGE_MAX) {
    return { ok: false, status: 400, error: `메시지는 ${REJECT_MESSAGE_MAX}자를 넘을 수 없습니다.` };
  }
  if (reason === '기타' && !msg) return { ok: false, status: 400, error: '학생에게 보낼 메시지를 입력하세요.' };

  const d = deps ?? (await reviewDeps());
  let row: ReviewRow | null;
  try {
    row = await d.db.get(id);
  } catch (err) {
    console.error('[thesis-review] 반려 조회 실패', id, err);
    return { ok: false, status: 500, error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (!isSubmission(row)) return { ok: false, status: 404, error: '학생이 제출한 공고를 찾을 수 없습니다.' };
  if (row.published) return { ok: false, status: 409, error: '이미 게시된 공고입니다.' };
  if (statusOf(row.thesis_submission, false) === 'rejected') {
    return { ok: false, status: 409, error: '이미 반려된 공고입니다.' };
  }

  let n: number;
  try {
    n = await d.db.update(
      id,
      {
        thesis_submission: decided(row.thesis_submission, 'rejected', actor, d.now(), {
          rejectReason: reason,
          rejectMessage: msg,
        }),
      },
      { published: false, statusNot: 'rejected' },
    );
  } catch (err) {
    console.error('[thesis-review] 반려 저장 실패', id, err);
    return { ok: false, status: 500, error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (n === 0) return { ok: false, status: 409, error: '다른 관리자가 먼저 처리했습니다.' };

  const target = mailTarget(row.thesis_submission);
  const mail = target
    ? rejectedMail({
        notice: target.notice,
        receiptNo: receiptNo(target.notice, id),
        reason,
        message: msg,
        resubmitUrl: `${SITE_URL}/ko${THESIS_SUBMIT_PATH}`,
        contact: await d.contact(),
      })
    : null;
  return { ok: true, mailSent: await mailAndRecord(d, id, target?.email ?? null, mail) };
}

// ── 검토 기록(내부 메모) ──────────────────────────────────────────────────
// 디자인의 '확인 항목' 체크리스트는 사용자 요청으로 뺐다(2026-09-18) — 메모만 남는다.

export type SaveOutcome = { ok: true } | { ok: false; status: 400 | 404 | 500; error: string };

/** review.memo 만 병합 저장한다(상태·결정 기록은 건드리지 않는다) */
export async function saveReview(
  idRaw: string,
  patch: { memo?: unknown },
  deps?: ReviewDeps,
): Promise<SaveOutcome> {
  const id = parseId(idRaw);
  if (!id) return { ok: false, status: 400, error: '잘못된 글 번호입니다.' };
  const { memo } = patch;
  if (memo === undefined) {
    return { ok: false, status: 400, error: '저장할 내용이 없습니다.' };
  }
  if (typeof memo !== 'string') {
    return { ok: false, status: 400, error: '메모 형식이 올바르지 않습니다.' };
  }
  if (memo.length > REVIEW_MEMO_MAX) {
    return { ok: false, status: 400, error: `메모는 ${REVIEW_MEMO_MAX}자를 넘을 수 없습니다.` };
  }

  const d = deps ?? (await reviewDeps());
  try {
    const row = await d.db.get(id);
    if (!isSubmission(row)) return { ok: false, status: 404, error: '학생이 제출한 공고를 찾을 수 없습니다.' };
    const rec = row.thesis_submission;
    const review: ThesisReview = { ...reviewOf(rec), memo };
    const n = await d.db.update(id, { thesis_submission: { ...rec, review } });
    if (n === 0) return { ok: false, status: 404, error: '학생이 제출한 공고를 찾을 수 없습니다.' };
    return { ok: true };
  } catch (err) {
    console.error('[thesis-review] 검토 기록 저장 실패', id, err);
    return { ok: false, status: 500, error: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}

// ── 대기 요약(대시보드) ───────────────────────────────────────────────────

export interface PendingSummary {
  count: number;
  /** 심사일이 오늘(KST) 이후 중 가장 가까운 대기 건 — 없으면 null */
  nearest: { id: string; date: string; presenter: string } | null;
}

export async function pendingSummary(deps?: ReviewDeps): Promise<PendingSummary> {
  const d = deps ?? (await reviewDeps());
  const rows = (await d.db.listPending()).filter(
    (r) => isSubmission(r) && !r.published && statusOf(r.thesis_submission, false) === 'pending',
  );
  const today = todayKst(d.now());
  let nearest: { id: string; date: string; time: string; presenter: string } | null = null;
  for (const r of rows) {
    const notice = parseNotice(r.thesis_submission?.notice);
    if (!notice || !/^\d{4}-\d{2}-\d{2}$/.test(notice.date) || notice.date < today) continue;
    const cand = { id: String(r.id), date: notice.date, time: notice.time, presenter: notice.presenter.trim() };
    if (!nearest || cand.date < nearest.date || (cand.date === nearest.date && cand.time < nearest.time)) {
      nearest = cand;
    }
  }
  return {
    count: rows.length,
    nearest: nearest ? { id: nearest.id, date: nearest.date, presenter: nearest.presenter } : null,
  };
}
