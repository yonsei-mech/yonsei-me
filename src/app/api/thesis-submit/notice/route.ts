// 학위논문 예비심사 공고 제출 API (공고 입력 화면 "제출하기").
//
// 본인 확인(서명 쿠키 thesis_submit)을 마친 학생이 입력 내용(JSON)과 브라우저가 학과 양식대로
// 그린 포스터(PNG 2105×1488)를 보낸다. 포스터를 R2 에 올리고, 그 이미지 한 장을 본문으로 하는
// 학위논문심사 게시물을 **비공개(published=false)** 로 만든다 — 학과사무실이 관리자 콘솔에서
// 확인하고 '게시하기'를 눌러야 사이트에 나온다. 제출 기록(누가·언제·무엇을)은
// posts.thesis_submission(jsonb)에 남는다(공개 조회에서는 lib/posts.ts 가 떼어 낸다).
//
// 응답 계약은 src/lib/thesis-submit/config.ts 의 NoticeSubmitResponse 가 단일 출처다.
// 순서: 기능 플래그 → 세션 → 요청 형식(헤더·multipart) → parseNotice → cleanNotice →
//       validateNotice → 포스터 PNG 검사 → 이메일당 제출 제한(1시간 5회, 메모리) → 저장 →
//       메일 2종(학생 접수 확인 + 학과 담당자 알림, lib/mail/thesis-mails.ts — 최선 노력).
// 접수번호는 receiptNo(notice, 게시물 id) — 응답의 receiptNo 로 입력 화면 완료 패널에도 뜬다.
//
// ⚠️⚠️ dev 는 절대 프로덕션에 쓰지 않는다. `.env.local` 에 프로덕션 Supabase·R2 키가 들어
//    있어 그대로 두면 dev 에서 누른 "제출하기"가 실제 DB·버킷에 들어간다. 그래서
//    NODE_ENV !== 'production' 이고 THESIS_SUBMIT_DEV_WRITE !== '1' 이면 R2·DB·메일을
//    전부 건너뛰고 `os.tmpdir()/thesis-submit-dev/<시각>.png` + `.json`({meta,row,receiptNo}) +
//    `.receipt.html`(학생 접수 확인 메일) + `.mail.html`(학과 알림 메일) 미리보기만 쓴 뒤
//    { ok:true, dev:<png 경로>, receiptNo:'TH-…-DEV' } 를 돌려준다.
//    실제 저장 경로를 dev 에서 시험해야 할 때만 THESIS_SUBMIT_DEV_WRITE=1 로 켠다.
//
// 교차 출처 위조: 세션 쿠키가 sameSite=lax 라 다른 사이트의 POST 에는 실리지 않지만,
// 같은 사이트(*.yonsei.ac.kr)의 다른 출처는 lax 로 걸러지지 않는다. multipart 는 "단순 요청"
// 이라 content-type 검사로도 못 거르므로 사용자 정의 헤더(NOTICE_SUBMIT_HEADER)를 요구한다 —
// 다른 출처가 이 헤더를 붙이려면 CORS preflight 를 통과해야 하는데 이 라우트는 허용하지 않는다.
//
// Supabase 서비스 클라이언트는 otp-store 와 같은 10줄 패턴을 복제한다 — posts-server 의
// adminDb 를 끌어오면 Auth.js·marked 가 이 라우트 번들에 딸려 온다. 정화 정책은 의존성이
// sanitize-html 하나뿐인 lib/admin/sanitize 에서 직접 가져온다.

import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { r2PublicUrl, r2Put, withRandomSuffix } from '@/lib/admin/r2';
import { sanitizeEditorHtml } from '@/lib/admin/sanitize';
import { sendBrevoMail } from '@/lib/mail/brevo';
import { officeMail, receiptMail, type MailOut } from '@/lib/mail/thesis-mails';
import { SITE_URL } from '@/lib/site';
import {
  NOTICE_POSTER_MAX_BYTES,
  NOTICE_SUBMIT_HEADER,
  isThesisSubmitEnabled,
  type NoticeSubmitResponse,
} from '@/lib/thesis-submit/config';
import {
  POSTER_EXPORT_SIZE,
  cleanNotice,
  parseNotice,
  postTitle,
  posterAlt,
  todayKst,
  validateNotice,
  type ThesisNoticeInput,
  type ThesisSubmissionMeta,
} from '@/lib/thesis-submit/notice';
import { thesisContact, type ThesisContact } from '@/lib/thesis-submit/contact';
import { receiptNo } from '@/lib/thesis-submit/review';
import { supabaseReviewDb } from '@/lib/thesis-submit/review-db';
import { readThesisSession } from '@/lib/thesis-submit/session';
import { releaseSubmitSlot, takeSubmitSlot } from '@/lib/thesis-submit/submit-limit';

export const runtime = 'nodejs';
// 요청마다 다른 응답(세션·제한·저장) — 캐시 금지
export const dynamic = 'force-dynamic';

function reply(body: NoticeSubmitResponse, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

const invalid = () => reply({ ok: false, reason: 'invalid' }, 400);

// ── 포스터 PNG 검사 ───────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG 시그니처 + 첫 청크가 IHDR 이고 폭·높이가 내보내기 규격(2105×1488)과 정확히 같은가.
 *  브라우저 렌더러(poster-canvas.ts 의 posterPngBlob)가 만든 파일만 받으려는 것 —
 *  임의 이미지를 게시판 본문으로 밀어 넣는 통로가 되지 않게 한다. */
function isPosterPng(b: Buffer): boolean {
  if (b.length < 33) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (b[i] !== PNG_SIGNATURE[i]) return false;
  if (b.readUInt32BE(8) !== 13 || b.toString('latin1', 12, 16) !== 'IHDR') return false;
  return b.readUInt32BE(16) === POSTER_EXPORT_SIZE.width && b.readUInt32BE(20) === POSTER_EXPORT_SIZE.height;
}

// ── 저장 ─────────────────────────────────────────────────────────────────

let _sb: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** R2 키 — 기존 업로드 관례(uploads/<게시판>/<시각>-<이름>) + 랜덤 접미사.
 *  학생 이름은 키에 넣지 않는다(공개 URL 에 개인정보를 싣지 않는다). */
function posterKey(notice: ThesisNoticeInput, now: number): string {
  const ymd = notice.date.replace(/-/g, '').slice(2);
  return withRandomSuffix(`uploads/thesis/${now}-preliminary-${ymd}.png`);
}

/** posts 행 — 본문은 공고 이미지 한 장(기존 게시판 관례).
 *  created_at 은 제출일 KST 자정 — 정확한 시각을 넣으면 CMS 폼이 그 시각을 '게시 예약'으로
 *  읽어 예약 칸이 켜진 채 열린다. 정확한 제출 시각은 thesis_submission.submittedAt 에 있다.
 *  게시일은 '게시하기'가 게시한 날로 올린다(PostForm commit). */
function postRow(notice: ThesisNoticeInput, meta: ThesisSubmissionMeta, posterUrl: string) {
  const body = sanitizeEditorHtml(
    `<p><img src="${escAttr(posterUrl)}" alt="${escAttr(posterAlt(notice))}"></p>`,
  );
  return {
    board: 'thesis',
    title_ko: postTitle(notice),
    body_html_ko: body,
    // 학과 확인 대기 — 공개 조회(lib/posts.ts)와 RLS 가 published 만 보여 준다
    published: false,
    created_at: `${todayKst(Date.parse(meta.submittedAt))}T00:00:00+09:00`,
    thesis_submission: meta,
  };
}

const THESIS_SUBMISSION_SQL = 'alter table posts add column if not exists thesis_submission jsonb;';

/** PostgREST/Postgres 오류가 "thesis_submission 컬럼 없음"인가 */
function isMissingSubmissionColumn(error: { code?: string; message?: string }): boolean {
  const msg = error.message ?? '';
  if (!msg.includes('thesis_submission')) return false;
  return error.code === 'PGRST204' || error.code === '42703' || /column/i.test(msg);
}

function notifyRecipients(): string[] {
  return (process.env.THESIS_SUBMIT_NOTIFY_TO ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(s));
}

/** 문의처 — 메일에 싣는 대학원 담당 연락처(화면 B 와 같은 출처). 못 읽어도 메일은 나간다 */
async function contactOrNull(): Promise<ThesisContact | null> {
  try {
    return await thesisContact('ko');
  } catch (err) {
    console.error('[thesis-submit] 문의처 읽기 실패', err);
    return null;
  }
}

/** 접수 직후 메일 두 종 — 1 학생 접수 확인 · 2 학과 담당자 알림(lib/mail/thesis-mails.ts) */
async function submitMails(p: {
  notice: ThesisNoticeInput;
  meta: ThesisSubmissionMeta;
  posterUrl: string;
  receiptNo: string;
  pendingTotal: number;
  /** 방금 만든 게시물 id — 담당자 '검토하기'가 그 검토 화면을 바로 연다(dev 폴백은 null) */
  postId: number | string | null;
}): Promise<{ receipt: MailOut; office: MailOut }> {
  // 콘솔 딥링크 — ?screen=board:thesis 가 학위논문심사 목록을 열고, 한 건이면 &review=<id> 가
  // 그 검토 화면을, 여러 건이면 &status=pending 이 대기 필터를 연다(thesis-review/review-model.ts).
  // 요청 Host 가 아니라 빌드에 박힌 SITE_URL 을 쓴다(메일 본문이 헤더로 조작되지 않게).
  const consoleBase = `${SITE_URL}/ko/contentmanagement?screen=board:thesis`;
  const consoleUrl =
    p.pendingTotal <= 1 && p.postId != null
      ? `${consoleBase}&review=${encodeURIComponent(String(p.postId))}`
      : `${consoleBase}&status=pending`;
  return {
    receipt: receiptMail({ notice: p.notice, receiptNo: p.receiptNo, contact: await contactOrNull() }),
    office: officeMail({
      latest: {
        notice: p.notice,
        email: p.meta.email,
        submittedAt: p.meta.submittedAt,
        receiptNo: p.receiptNo,
        posterUrl: p.posterUrl,
      },
      pendingTotal: p.pendingTotal,
      consoleUrl,
    }),
  };
}

/** 한 통 발송 — 최선 노력. 실패해도 제출은 성공이다(서버 로그만 남긴다) */
async function sendBestEffort(to: string, mail: MailOut, what: string): Promise<void> {
  try {
    const r = await sendBrevoMail({ to, subject: mail.subject, html: mail.html, logTag: '[thesis-submit]' });
    if (!r.ok) console.error(`[thesis-submit] ${what} 메일 실패`, to, r.reason);
  } catch (err) {
    console.error(`[thesis-submit] ${what} 메일 오류`, to, err);
  }
}

// ── 라우트 ───────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  if (!isThesisSubmitEnabled()) return reply({ ok: false, reason: 'disabled' }, 404);

  const session = await readThesisSession();
  if (!session) return reply({ ok: false, reason: 'session' }, 401);

  if (request.headers.get(NOTICE_SUBMIT_HEADER) !== '1') return invalid();
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
    return invalid();
  }
  // 본문을 읽기 전에 크기부터 — 포스터 상한 + JSON·경계 문자열 여유
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > NOTICE_POSTER_MAX_BYTES + 256 * 1024) return invalid();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return invalid();
  }
  const data = form.get('data');
  const poster = form.get('poster');
  if (typeof data !== 'string' || data.length > 64 * 1024 || !(poster instanceof Blob)) return invalid();

  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return invalid();
  }
  const parsed = parseNotice(raw);
  if (!parsed) return invalid();
  const notice = cleanNotice(parsed);
  const errors = validateNotice(notice, todayKst());
  if (errors.length > 0) return reply({ ok: false, reason: 'invalid', errors }, 400);

  if (poster.size === 0 || poster.size > NOTICE_POSTER_MAX_BYTES) return invalid();
  const bytes = Buffer.from(await poster.arrayBuffer());
  if (!isPosterPng(bytes)) return invalid();

  const now = Date.now();
  const retryAfter = takeSubmitSlot(session.email, now);
  if (retryAfter !== null) return reply({ ok: false, reason: 'rate', retryAfter }, 429);

  const meta: ThesisSubmissionMeta = {
    email: session.email,
    submittedAt: new Date(now).toISOString(),
    notice,
  };
  const key = posterKey(notice, now);

  // ── dev 폴백: 프로덕션 저장소에 쓰지 않는다(파일 머리 주석) ──
  if (process.env.NODE_ENV !== 'production' && process.env.THESIS_SUBMIT_DEV_WRITE !== '1') {
    let url: string;
    try {
      url = r2PublicUrl(key); // 문자열 조립만 — 업로드하지 않는다
    } catch {
      url = `https://r2.invalid/${key}`;
    }
    const row = postRow(notice, meta, url);
    const dir = join(tmpdir(), 'thesis-submit-dev');
    const stamp = meta.submittedAt.replace(/[:.]/g, '-');
    const png = join(dir, `${stamp}.png`);
    // 게시물 id 가 없으니 접수번호 끝자리는 'DEV'. 대기 건수는 DB 를 읽지 않고 1건으로 둔다.
    const no = receiptNo(notice, null);
    try {
      const mails = await submitMails({ notice, meta, posterUrl: url, receiptNo: no, pendingTotal: 1, postId: null });
      await mkdir(dir, { recursive: true });
      await writeFile(png, bytes);
      await writeFile(join(dir, `${stamp}.json`), JSON.stringify({ meta, row, receiptNo: no }, null, 2), 'utf8');
      // 메일은 보내지 않고 미리보기 파일로만 — .receipt.html(학생 접수 확인) · .mail.html(학과 알림)
      await writeFile(join(dir, `${stamp}.receipt.html`), mails.receipt.html, 'utf8');
      await writeFile(join(dir, `${stamp}.mail.html`), mails.office.html, 'utf8');
    } catch (err) {
      releaseSubmitSlot(session.email, now);
      console.error('[thesis-submit] dev 저장 실패', err);
      return reply({ ok: false, reason: 'server', message: 'dev-write' }, 500);
    }
    return reply({ ok: true, dev: png, receiptNo: no });
  }

  // ── 프로덕션: R2 업로드 → posts 행(비공개) → 학과 알림 ──
  let url: string;
  try {
    url = await r2Put(key, bytes, 'image/png');
  } catch (err) {
    releaseSubmitSlot(session.email, now);
    console.error('[thesis-submit] 포스터 R2 저장 실패', err);
    return reply({ ok: false, reason: 'server', message: 'storage' }, 500);
  }

  const row = postRow(notice, meta, url);
  // 정화가 이미지를 떨어뜨렸다면(허용 스킴 밖 URL 등) 빈 게시물이 생긴다 — 저장하지 않는다
  if (!row.body_html_ko.includes(url)) {
    releaseSubmitSlot(session.email, now);
    console.error('[thesis-submit] 본문 정화 뒤 포스터 이미지가 사라짐', url);
    return reply({ ok: false, reason: 'server', message: 'sanitize' }, 500);
  }

  let insert;
  try {
    insert = await db().from('posts').insert(row).select('id').single();
  } catch (err) {
    releaseSubmitSlot(session.email, now);
    console.error('[thesis-submit] posts 저장 실패', err);
    return reply({ ok: false, reason: 'server', message: 'db' }, 500);
  }
  if (insert.error) {
    releaseSubmitSlot(session.email, now);
    if (isMissingSubmissionColumn(insert.error)) {
      console.error(
        `[thesis-submit] posts.thesis_submission 컬럼이 없습니다. Supabase SQL Editor 에서 ` +
          `scripts/sql/2026-09-thesis-submit-otp.sql 을 실행하세요 (${THESIS_SUBMISSION_SQL})`,
      );
      return reply({ ok: false, reason: 'server', message: 'schema' }, 503);
    }
    console.error('[thesis-submit] posts 저장 실패', insert.error.message);
    return reply({ ok: false, reason: 'server', message: 'db' }, 500);
  }

  // 비공개 글이라 사이트 캐시('posts' 태그)를 털 이유가 없다 — 게시하기(CMS 저장)가 턴다.
  // 여기부터는 전부 최선 노력이다 — 저장은 끝났으므로 무엇이 실패해도 제출 성공으로 답한다.
  const postId = (insert.data as { id?: number | string } | null)?.id ?? null;
  const no = receiptNo(notice, postId);
  const to = notifyRecipients();
  let pendingTotal = 1;
  if (to.length > 0) {
    try {
      // 방금 넣은 건을 포함한 검토 대기 건수(담당자 알림의 '여러 건' 변형)
      pendingTotal = await supabaseReviewDb(db()).countPending();
    } catch (err) {
      console.error('[thesis-submit] 대기 건수 조회 실패', err);
    }
  }
  try {
    const mails = await submitMails({ notice, meta, posterUrl: url, receiptNo: no, pendingTotal, postId });
    await Promise.all([
      sendBestEffort(meta.email, mails.receipt, '학생 접수 확인'),
      ...to.map((addr) => sendBestEffort(addr, mails.office, '학과 알림')),
    ]);
  } catch (err) {
    console.error('[thesis-submit] 접수 메일 준비 실패', err);
  }
  return reply({ ok: true, receiptNo: no });
}
