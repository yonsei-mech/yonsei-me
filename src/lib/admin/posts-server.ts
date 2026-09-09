// 게시판 쓰기 서버 헬퍼 (admin API 라우트 전용) — 백엔드 전환 Phase 3.
//
// 계약: DB 의 body_html_* 는 "정화된 HTML"만 저장한다. 현재 에디터(마크다운)든
// 이후의 WYSIWYG 든, 저장 직전에 반드시 renderAndSanitize 를 거친다.
// 마크다운 원문은 body_md_* 에 함께 보관 — 텍스트 에디터의 수정 왕복용
// (HTML→마크다운 역변환은 손실이 있어 원문 보관이 정공법).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { auth } from '@/auth';
import { SANITIZE_OPTS, sanitizeEditorHtml, scrubRawHtml } from '@/lib/admin/sanitize';
import { formatPeriodLabel, isoToDays, parseDateLabelRange } from '@/lib/calendar';
import { kstDate } from '@/lib/utils';

// 사이트 렌더와 동일 설정(breaks: 단일 개행도 줄바꿈 — 게시판 본문 관례)
const marked = new Marked({ gfm: true, breaks: true });

// 정화 정책(SANITIZE_OPTS)은 lib/admin/sanitize.ts 가 단일 출처다 — 앱 의존성이 없어야
// 노드 스크립트로 정책만 따로 검증할 수 있어 여기서 분리했다.
export { sanitizeEditorHtml };

/** 마크다운 → 정화된 HTML (빈 입력은 빈 문자열) */
export function renderAndSanitize(markdown: string | null | undefined): string {
  const md = (markdown ?? '').trim();
  if (!md) return '';
  return sanitizeHtml(marked.parse(md) as string, SANITIZE_OPTS);
}

/** admin API 라우트 공용 인증 가드 — 프로덕션은 Auth.js 세션(=GitHub allowlist) 필수,
 *  dev 는 CMS 개방 모드로 우회. 거부면 401 Response, 통과면 null (4개 라우트 공유). */
export async function requireAdmin(): Promise<Response | null> {
  if (process.env.NODE_ENV !== 'production') return null; // dev 개방 모드
  const session = await auth();
  if (!session?.user) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  return null;
}

/** 사용자 관리 전용 가드 — cms_users.role='admin' 만 통과(편집자는 콘텐츠만 고친다).
 *  requireAdmin 과 같이 dev 는 우회. 거부면 401/403 Response, 통과면 null. */
export async function requireOwner(): Promise<Response | null> {
  if (process.env.NODE_ENV !== 'production') return null; // dev 개방 모드
  const session = await auth();
  if (!session?.user) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (session.user.role !== 'admin') {
    return Response.json({ error: '사용자 관리는 관리자만 할 수 있습니다.' }, { status: 403 });
  }
  return null;
}

// ── Supabase 서비스 클라이언트 (RLS 우회 — 라우트에서 인증 확인 후에만 사용) ──
let _sb: SupabaseClient | null = null;
export function adminDb(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

// ── CMS 페이로드 ↔ DB 행 ──────────────────────────────────────────────

/** CMS 가 보내는 글 페이로드 (boards.ts 의 EditRecord 와 동일 필드 + 마크다운 본문) */
export interface AdminPostPayload {
  board: string;
  slug?: string | null;
  date: string; // YYYY-MM-DD (표시일 — created_at 으로 저장. 단 세미나는 행사일이라 저장 안 함)
  /** 공개 시각 HH:MM (KST, 선택) — 게시 예약. 비면 00:00(그 날 자정 = 사실상 즉시).
   *  created_at 이 timestamptz 라 날짜와 함께 한 칼럼에 실린다(스키마 변경 없음).
   *  ⚠️ 행사·일정·동문행사는 created_at 이 "행사일"로 쓰이므로(payloadToRow 의
   *  isEvent/hasSchedule) 이 값이 예약으로 해석되지 않는다 — lib/posts.ts 의 게이트 주석 참조.
   *  ⚠️ 세미나(2026-08-31 분리)는 폼 날짜가 행사일이라 created_at 을 아예 저장하지 않는다 —
   *  게시일이 보존되므로 이 시각도 세미나에서는 아무 효력이 없다. */
  time?: string;
  titleKo: string;
  titleEn?: string;
  bodyKo?: string; // 마크다운
  bodyEn?: string;
  excerptKo?: string;
  excerptEn?: string;
  category?: string;
  hostKo?: string;
  hostEn?: string;
  /** 종료일(YYYY-MM-DD) — 행사·세미나·동문행사 전용. 없으면 하루(기간 라벨은 서버가 자동 생성) */
  endDate?: string | null;
  /** 게시물 링크(URL) — 인스타그램 전용(타일 클릭 목적지) */
  linkUrl?: string;
  isEvent?: boolean;
  /** 목록 최상단 고정 — 글 목록이 아닌 게시판(noBody)은 보내지 않는다 */
  pinned?: boolean;
  image?: string;
  /** 원문 모드 — true 면 본문을 화이트리스트 정화 대신 scrubRawHtml 로 처리한다.
   *  (부재·false 면 예전과 완전히 같은 경로) 배경은 sanitize.ts 의 원문 모드 주석. */
  bodyRaw?: boolean;
  attachments?: { labelKo?: string; labelEn?: string; href: string; size?: number }[];
}

const BOARDS = new Set([
  'calendar',
  'noticesUndergrad', 'noticesGraduate', 'noticesExternal', 'noticesScholarship',
  'news', 'seminars', 'events',
  'thesis', 'resources', 'career', 'alumniEvents',
  'instagram',
]);

export function isValidBoard(board: string): boolean {
  return BOARDS.has(board);
}

const nn = (s: string | undefined | null) => {
  const v = (s ?? '').trim();
  return v === '' ? null : v;
};

/** HH:MM(24시) 검증 — <input type="time"> 이 주는 형태. 그 외(빈 값·구 페이로드·손으로
 *  만든 요청)는 전부 자정으로 눕힌다. 예약이 없는 글은 예전과 완전히 같은 값(T00:00)을
 *  쓰게 되므로, 이 기능이 붙기 전에 저장된 글과 새 글의 created_at 이 어긋나지 않는다. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function publishTime(raw: string | undefined | null): string {
  const v = (raw ?? '').trim();
  return TIME_RE.test(v) ? v : '00:00';
}

/** created_at(timestamptz) → KST 시각 'HH:MM'. kstDate 와 같은 +9h 시프트 방식이라
 *  둘을 함께 쓰면 항상 같은 KST 순간의 날짜·시각 쌍이 나온다. */
function kstTime(ts: string): string {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return '';
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

/** 종료일 페이로드 검증 — 오류 메시지 반환(정상이면 null). 라우트 400 응답용(POST/PUT 공용) */
export function endDateError(p: AdminPostPayload): string | null {
  const e = (p.endDate ?? '').trim();
  if (!e) return null;
  if (Number.isNaN(isoToDays(e))) return '종료일 형식이 올바르지 않습니다.';
  if (p.date && e < p.date) return '종료일은 시작일보다 빠를 수 없습니다.';
  return null;
}

/** 페이로드 → posts 행 (본문은 md 보관 + 정화 HTML 동시 저장) */
export function payloadToRow(p: AdminPostPayload) {
  const isNews = p.board === 'news';
  // 캘린더 전용 일정·세미나는 "그 날짜에 일어나는 일"이 본체라 행사와 똑같이 event_date 에
  // 시작일을 박는다. created_at 은 timestamptz 라 표시일로 쓰면 시간대에 휘둘린다.
  // (세미나도 폼 날짜가 행사일이라 여기 들어간다. 다만 2026-08-31 분리 이후 세미나는
  //  created_at 을 건드리지 않는다 — 게시일과 행사일이 다른 칼럼으로 갈렸다.
  //  lib/posts.ts 의 dateOf·toSeminar 와 한 몸이다.)
  const isEvent =
    p.board === 'alumniEvents'
      ? p.isEvent === true
      : p.board === 'events' || p.board === 'seminars' || p.board === 'calendar';
  // 종료일·자동 라벨 대상: 행사 + 세미나 + 일정 + 동문(행사 체크 시). 그 외 게시판은 항상 null.
  // 일정을 여기 넣는 이유는 홈 캘린더의 날짜 pill 표기다 — 행사 글과 같은
  // formatPeriodLabel 을 타야 "7/20~7/24" 같은 기간 표기가 한 문법으로 나온다.
  const hasSchedule =
    p.board === 'events' || p.board === 'seminars' || p.board === 'calendar' ||
    (p.board === 'alumniEvents' && p.isEvent === true);
  // end==start(하루)는 null 로 정규화 — "end_date null = 하루" 단일 의미를 DB 레벨에서 유지
  const e = nn(p.endDate);
  const endDate = hasSchedule && e && e > p.date ? e : null;
  // 기간 라벨은 시작/종료일에서 ko/en 자동 생성(수동 입력 폐지) — 홈 pill 등 기존 라벨
  // 소비자는 무변경으로 동작하고, 그간 전부 공백이던 EN 라벨 문제도 함께 해결된다.
  const label = hasSchedule && p.date ? formatPeriodLabel(p.date, endDate) : null;
  // 분류 — 뉴스와 캘린더가 같은 category 칼럼을 쓰되 값 집합이 다르다. board 로
  // 스코프가 갈리므로 섞이지 않고, 기본값만 각자의 것으로 준다(뉴스 '일반',
  // 일정 '학사일정'). 분류가 없는 게시판은 예전처럼 null 이다.
  let category: string | null = null;
  // 뉴스 분류는 일반/성과 2종 — 구 값(notice/seminar)이 들어와도 '일반'으로 눕힌다
  if (isNews) category = nn(p.category) === 'achievement' ? 'achievement' : 'general';
  else if (p.board === 'calendar') category = nn(p.category) ?? 'academic';
  // 자료실은 미분류를 허용한다 — 분류 없는 글은 목록의 '전체' 탭에만 잡힌다
  else if (p.board === 'resources') category = nn(p.category);
  // 본문 처리기 — 원문 모드만 갈린다. 정책 자체는 sanitize.ts 한 곳에 있다.
  const bodyRaw = p.bodyRaw === true;
  const toHtml = bodyRaw ? scrubRawHtml : sanitizeEditorHtml;
  return {
    board: p.board,
    slug: isNews ? nn(p.slug) : null,
    title_ko: (p.titleKo ?? '').trim(),
    title_en: nn(p.titleEn),
    // Tiptap 전환(Phase 3b): 에디터 산출물이 HTML — 정화만 거쳐 저장한다.
    // body_md_* 는 마크다운 시대의 원문 보관용이었고 이제 동결(신규 글은 null).
    body_md_ko: null,
    body_md_en: null,
    body_html_ko: toHtml(p.bodyKo),
    body_html_en: nn(p.bodyEn) ? toHtml(p.bodyEn) : null,
    // 저장 시점에 이미 처리했으므로 렌더 경로는 이 값을 보지 않는다 — 편집 화면이
    // 다시 열릴 때 "이 글은 원문 모드"임을 알기 위한 기억이다.
    body_raw: bodyRaw,
    excerpt_ko: nn(p.excerptKo),
    excerpt_en: nn(p.excerptEn),
    category,
    host_ko: nn(p.hostKo),
    host_en: nn(p.hostEn),
    date_label_ko: label ? nn(label.ko) : null,
    date_label_en: label ? nn(label.en) : null,
    is_event: p.board === 'alumniEvents' ? p.isEvent === true : false,
    event_date: isEvent && p.date ? p.date : null,
    end_date: endDate,
    // 링크 — 같은 칼럼이지만 성격이 다르다. 인스타그램은 타일이 반드시 가야 할
    // 필수 목적지고, 캘린더는 있으면 좋은 선택 링크(비면 홈에서 링크 없는 카드).
    link_url: p.board === 'instagram' || p.board === 'calendar' ? nn(p.linkUrl) : null,
    // 고정 — 페이로드에 없으면(고정 대상이 아닌 게시판) 항상 false 로 눕힌다
    pinned: p.pinned === true,
    thumbnail_url: nn(p.image),
    // 게시일 + 공개 시각(KST). 시각을 비운 글은 이전과 같은 T00:00 이라 값이 안 바뀐다.
    // 오프셋을 문자열에 박는 이유는 예전과 같다 — 서버 TZ 가 무엇이든 KST 자정이 되어야 한다.
    // ⚠️ 세미나만 이 키를 통째로 뺀다(2026-08-31 분리). 세미나 폼의 날짜는 행사일이므로
    //    여기 박으면 저장 한 번에 게시일이 행사일로 덮인다. 키가 없으면 PUT 은 기존
    //    created_at 을 그대로 두고, POST 는 DB 기본값 now() 가 게시일이 된다.
    ...(p.board === 'seminars'
      ? {}
      : { created_at: `${p.date}T${publishTime(p.time)}:00+09:00` }),
  };
}

// ── body_raw 컬럼 방어 (마이그레이션 전 안전망) ───────────────────────
// 컬럼 추가 SQL 은 사람이 Supabase 에서 직접 돌린다. 그 사이에 CMS 전체가 죽으면
// 안 되므로, 원문 모드를 **쓰지 않는** 저장은 컬럼 없이 한 번 더 시도해 통과시킨다.
// (원문 모드를 켠 저장만 안내 메시지로 막는다 — 조용히 정화해 버리면 관리자가
//  디자인이 깎인 걸 나중에야 발견하게 된다.)

export const BODY_RAW_MIGRATION_HINT =
  '원문 모드를 쓰려면 DB 컬럼이 필요합니다. Supabase SQL Editor 에서 ' +
  'scripts/sql/2026-08-post-body-raw.sql 을 실행한 뒤 다시 저장해 주세요.';

/** PostgREST/Postgres 오류가 "body_raw 컬럼 없음"인가 */
export function isMissingBodyRawColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? '';
  if (!msg.includes('body_raw')) return false;
  // PGRST204: 스키마 캐시에 컬럼 없음 · 42703: undefined_column
  return error.code === 'PGRST204' || error.code === '42703' || /column/i.test(msg);
}

/** 저장 행에서 body_raw 만 뺀 사본 — 컬럼 없는 DB 재시도용 */
export function withoutBodyRaw<T extends { body_raw?: unknown }>(row: T): Omit<T, 'body_raw'> {
  const { body_raw: _omit, ...rest } = row;
  return rest;
}

/** posts 행(+attachments 관계) — select('*, attachments(*)') 결과의 필요한 필드만 */
export interface DbPostRow {
  id: number | string;
  board: string;
  slug: string | null;
  created_at: string;
  event_date: string | null;
  end_date: string | null;
  link_url: string | null;
  is_event: boolean | null;
  /** 목록 최상단 고정 — 구 행은 null(스키마 추가 이전) */
  pinned: boolean | null;
  title_ko: string | null;
  title_en: string | null;
  body_html_ko: string | null;
  body_html_en: string | null;
  /** 원문 모드로 저장된 글 — 마이그레이션(2026-08-post-body-raw.sql) 전 DB 는 undefined */
  body_raw?: boolean | null;
  excerpt_ko: string | null;
  excerpt_en: string | null;
  category: string | null;
  host_ko: string | null;
  host_en: string | null;
  date_label_ko: string | null;
  date_label_en: string | null;
  thumbnail_url: string | null;
  attachments?: {
    label_ko: string | null;
    label_en: string | null;
    url: string;
    sort: number;
    size_bytes?: number | null;
  }[];
}


/** DB 행 → CMS 편집 레코드(마크다운 우선, 없으면 빈 문자열 — 구 데이터 호환) */
export function rowToEditRecord(r: DbPostRow) {
  // 캘린더를 여기 넣는 이유: created_at 은 timestamptz(+09:00) 라 UTC 로 돌아오면
  // slice(0,10) 이 하루 앞당겨진다. 일정은 날짜가 곧 내용이므로 그 하루가
  // 그대로 오답이 된다 — 시작일의 진실은 언제나 event_date 다.
  // 나머지 게시판도 사정은 같다: 예전에는 여기서 UTC 로 잘라 폼에 하루 이른 날짜가
  // 뜨고, 그 상태로 저장하면 진짜 하루가 밀렸다(왕복할수록 누적). kstDate 로 바로잡는다.
  const date = (r.event_date &&
  (r.board === 'events' || r.board === 'seminars' || r.board === 'calendar' || r.is_event)
    ? r.event_date
    : kstDate(String(r.created_at))) as string;
  // 공개 시각 — 날짜와 달리 언제나 created_at 에서 뽑는다(예약이 실린 칼럼이 거기 하나다).
  // 자정은 "시각 지정 없음"과 구분할 수 없고 구분할 필요도 없으므로 빈 값으로 내린다 —
  // 그래야 폼의 선택 입력이 비어 뜨고, 열자마자 dirty 로 잡히지도 않는다.
  const rawTime = kstTime(String(r.created_at));
  const time = rawTime === '00:00' ? '' : rawTime;
  // 종료일: end_date 우선. 없으면(구 데이터) 수동 기간 라벨을 파싱해 폼에 프리필한다 —
  // 라벨이 저장 시 자동 재생성되므로, 프리필 없이는 구 행사 글을 수정·저장하는 순간
  // "7/20~7/24" 같은 기간 정보가 하루짜리 라벨로 덮어써져 소실된다(프리필 → end_date 승격).
  let endDate = r.end_date ?? '';
  if (!endDate && r.date_label_ko) {
    const parsedEnd = parseDateLabelRange(date, r.date_label_ko).end;
    if (parsedEnd > date) endDate = parsedEnd;
  }
  return {
    id: String(r.id),
    board: r.board as string,
    slug: r.slug ?? null,
    date,
    time,
    endDate,
    titleKo: r.title_ko ?? '',
    titleEn: r.title_en ?? '',
    // Tiptap 은 HTML 왕복 — 기존 글(마이그레이션분 포함)도 body_html 이 원본이다
    bodyKo: r.body_html_ko ?? '',
    bodyEn: r.body_html_en ?? '',
    // 컬럼이 없는 DB(마이그레이션 전)에서도 언제나 boolean 이다 — 폼의 dirty 판정이
    // undefined ↔ false 차이만으로 흔들리지 않아야 한다.
    bodyRaw: r.body_raw === true,
    excerptKo: r.excerpt_ko ?? '',
    excerptEn: r.excerpt_en ?? '',
    category: r.category ?? undefined,
    hostKo: r.host_ko ?? '',
    hostEn: r.host_en ?? '',
    dateLabelKo: r.date_label_ko ?? '',
    dateLabelEn: r.date_label_en ?? '',
    linkUrl: r.link_url ?? '',
    isEvent: r.is_event === true,
    pinned: r.pinned === true,
    image: r.thumbnail_url ?? '',
    attachments: (r.attachments ?? [])
      .slice()
      .sort((a, b) => a.sort - b.sort)
      .map((a) => ({
        labelKo: a.label_ko ?? '',
        labelEn: a.label_en ?? '',
        href: a.url,
        ...(a.size_bytes ? { size: a.size_bytes } : {}),
      })),
  };
}
