// 게시판 데이터 레이어 (서버 전용) — 백엔드 전환 Phase 2.
//
// 게시판 10종의 "읽기"를 이 모듈로 일원화한다. 소스는 둘:
//  - db  : Supabase(posts/attachments). unstable_cache + 'posts' 태그로 캐시되고,
//          CMS 쓰기가 revalidateTag('posts') 를 호출하면 재배포 없이 갱신된다.
//  - git : 기존 content/*.json (content.ts) — 롤백/오프라인 폴백.
//  기본값은 SUPABASE_URL 이 있으면 db. BOARDS_SOURCE=git env 로 강제 롤백 가능.
//
// 반환 타입은 기존 content.ts 의 것(NewsItem/Notice/Seminar/EventItem/BoardPost…)을
// 그대로 사용해 페이지 수정을 최소화한다. 단 body 의 의미가 소스에 따라 다르다:
//  - db  : body = 정화된 HTML (에디터 산출물, 마이그레이션 시 마크다운→HTML 변환)
//  - git : body = 마크다운 원문
// 상세 페이지는 postsBodyFormat() 을 PostArticle 의 bodyFormat 으로 넘겨 구분한다.

import { unstable_cache } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { kstDate } from '@/lib/utils';
import {
  news as gitNews,
  board as gitBoard,
  getAllBoardPosts as gitAllBoardPosts,
  getCalendarEntries as gitCalendarEntries,
  alumniEvents as gitAlumniEvents,
  normalizeNewsCategory,
  type NewsItem,
  type Notice,
  type Seminar,
  type EventItem,
  type AlumniEvent,
  type BoardPost,
  type CalendarEntry,
  type Attachment,
  type Localized,
} from './content';

// ── 소스 판별 ──────────────────────────────────────────────────────────
export type PostsSource = 'db' | 'git';

export function postsSource(): PostsSource {
  if (process.env.BOARDS_SOURCE === 'git') return 'git'; // 명시적 롤백 스위치
  return process.env.SUPABASE_URL ? 'db' : 'git';
}

/** 상세 페이지가 body 를 어떻게 렌더할지 — db=HTML(정화됨), git=마크다운 */
export function postsBodyFormat(): 'html' | 'markdown' {
  return postsSource() === 'db' ? 'html' : 'markdown';
}

// ── Supabase 클라이언트 (lazy, 서버 전용 service key) ───────────────────
let _sb: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

// ── DB 행 형태 (scripts/sql/schema.sql 과 1:1) ─────────────────────────
interface DbAttachment {
  id: number;
  label_ko: string | null;
  label_en: string | null;
  url: string;
  sort: number;
  /** 바이트 크기 — 구 행은 null(스키마 추가 이전). 자료실 목록의 크기 표기에 쓴다 */
  size_bytes: number | null;
}
interface DbPost {
  id: number;
  board: string;
  slug: string | null;
  title_ko: string;
  title_en: string | null;
  /** 본문 — **목록 조회에는 실려 오지 않는다**(LIST_COLUMNS 주석 참조). 선택 필드인 이유가
   *  그것이고, 어댑터들은 값이 없으면 빈 문자열을 낸다(loc 이 undefined→'' 로 접는다).
   *  본문이 필요한 자리는 상세 조회(fetchRowById/fetchRowBySlug)뿐이다. */
  body_html_ko?: string;
  body_html_en?: string | null;
  excerpt_ko: string | null;
  excerpt_en: string | null;
  category: string | null;
  host_ko: string | null;
  host_en: string | null;
  date_label_ko: string | null;
  date_label_en: string | null;
  is_event: boolean;
  event_date: string | null;
  end_date: string | null;
  link_url: string | null;
  /** 목록 최상단 고정 — 구 행은 null(스키마 추가 이전) */
  pinned: boolean | null;
  thumbnail_url: string | null;
  created_at: string;
  attachments: DbAttachment[] | null;
}

// ⚠️⚠️ 목록 조회의 컬럼을 **명시**하는 이유 — `select('*')` 로 되돌리지 말 것.
//
// 이 조회 결과는 unstable_cache 로 Vercel Data Cache 에 들어가는데, 그 캐시는 항목
// 하나가 **2MB** 를 넘으면 저장을 조용히 포기한다(오류도, 로그도 없다). 게시물을 대량
// 이전한 뒤 공개 글이 1,275건이 되면서 `*, attachments(*)` 응답이 약 3MB 가 됐고,
// 그래서 캐시는 한 번도 적중하지 못한 채 **매 요청이 전체 코퍼스를 다시 조회**하고
// 있었다(사이트가 눈에 띄게 느려진 원인). 측정해 보니 그중 body_html_* 만 1.57MB —
// 본문만 빼면 한도 아래로 넉넉히 내려온다.
//
// …였는데 전수 이전이 끝나 3,548건이 되자 **본문 없는 응답조차 2.5MB** 로 한도를
// 다시 넘겼다(2026-08 실측: 캐시 전멸 → 매 재생성이 전수 조회 → Supabase Free 의
// 월 5GB egress 초과, 하루 1~1.7GB). 그래서 캐시 항목을 **게시판 단위**로 쪼갰다
// (fetchBoardRows). 최대 게시판이 news 575kB 로 한도의 28% — 게시판당 ~2,800건쯤에
// 다시 닿는데, 그때는 게시판 안에서 연도 분할 같은 다음 단계가 필요하다.
//
// 그리고 목록은 본문을 **쓰지 않는다**. 본문이 필요한 곳은 상세 페이지 한 곳뿐이고
// (fetchRowById/fetchRowBySlug), 자료실 검색 인덱스만 예외라 7건짜리 전용 조회
// (fetchResourceBodies)로 따로 뗐다. 썸네일 폴백(firstBodyImage)도 thumbnail_url
// 백필 이후로는 본문 없이 동작한다.
//
// 새 컬럼을 어댑터에서 읽기 시작했다면 이 목록에도 더해야 한다 — 빠뜨리면 undefined 다.
const LIST_COLUMNS =
  'id, board, slug, title_ko, title_en, excerpt_ko, excerpt_en, category, ' +
  'host_ko, host_en, date_label_ko, date_label_en, is_event, event_date, end_date, ' +
  'link_url, pinned, thumbnail_url, created_at, attachments(*)';

/** 상세 조회용 — 본문 포함 전체 행 */
const DETAIL_COLUMNS = '*, attachments(*)';

// ── 게시 예약 게이트 ───────────────────────────────────────────────────
//
// CMS 가 글에 "공개 시각"을 실을 수 있다(posts-server.ts 의 AdminPostPayload.time).
// 스키마를 늘리지 않고 created_at(timestamptz) 에 `YYYY-MM-DDTHH:MM+09:00` 로 저장하므로,
// **사이트 조회는 created_at 이 아직 오지 않은 글을 빼면** 그것이 곧 예약 게시다.
//
// ⚠️ event_date 가 있는 행은 면제한다. 그 행들 중 행사·일정·동문행사는
//    payloadToRow 가 created_at 에 **행사일**을 박는다 — 다음 달 행사를 지금 등록하면
//    created_at 도 다음 달이다. 면제하지 않으면 "앞으로 열릴 행사"가 사이트 목록과
//    홈 캘린더에서 통째로 사라진다(예약이 아니라 그 게시판의 날짜 의미가 그런 것뿐이다).
//    이관된 구 행들은 created_at 이 작성일이라 어차피 과거지만, CMS 로 새로 쓰거나
//    수정하는 순간 행사일로 덮인다 — 면제 조항이 실제로 일하는 지점은 거기다.
//    세미나는 2026-08-31 분리 이후 created_at 이 **게시일**로 남지만(payloadToRow 가
//    세미나 행에서 created_at 을 아예 빼서 보낸다), event_date 를 여전히 채우므로
//    면제 조건 자체는 그대로 성립한다.
//    바꿔 말해 예약 게시가 걸리는 곳은 event_date 를 쓰지 않는 게시판 —
//    공지 4종·뉴스·동문 뉴스·학위논문·자료실·취업·인턴·인스타그램·비행사 동문글이다.
//
// ⚠️ 의미 변화: 이 게이트가 붙기 전에는 "게시일을 미래 날짜로 적어 둔" 글도 즉시 보였다.
//    이제 그런 글은 그 날짜 00:00(KST)까지 숨는다. 예약 기능의 정의상 올바른 방향이라
//    그대로 두되, 놀라지 않도록 여기 적어 둔다.
//
// ⚠️ 판정은 **쿼리가 아니라 메모리에서**, 렌더 시점에 한다. 예전에는 PostgREST
//    `or=(event_date.not.is.null,created_at.lte.<now>)` 를 네 조회에 붙였는데, 그러면
//    now() 가 캐시된 응답 안에 굳어 버려 캐시 수명을 짧게(revalidate 600) 잡을 수밖에
//    없었다. 그 짧은 수명이 곧 Supabase egress 였다 — 2026-09-06 에 Free 한도 5GB 를
//    12.13GB 로 넘겨 프로젝트가 정지됐고(PostgREST 가 전부 402), 마지막 정상일의 로그를
//    보니 크롤러 트래픽이 목록 재조회를 하루 2,300회(≈100MB), 상세 재조회를 4,500회
//    만들고 있었다. 시간 기반 만료가 남아 있던 이유는 오직 이 게이트의 now() 재평가
//    뿐이었다(내용 갱신은 CMS 쓰기의 revalidateTag('posts') 가 이미 담당한다).
//    그래서 캐시에는 "공개된 글 전부"를 시각과 무관하게 담아 하루(86400) 두고,
//    시각 판정은 아래 isVisibleNow 로 매 렌더 걸러 낸다.
//
// ⚠️ 반영 지연: 게이트가 렌더 시점에 평가되므로 예약 시각이 지나면 페이지가 다음에
//    다시 그려질 때 바로 반영된다. 페이지는 ISR revalidate=300 이라 최대 5분쯤 —
//    캐시 600 과 페이지 300 이 겹쳐 10여 분까지 밀리던 예전보다 오히려 빨라졌다.
//
// ⚠️ 관리자 API(app/api/admin/**)에는 이 게이트를 넣지 않는다 — 관리자는 예약 글을
//    목록에서 보고 고칠 수 있어야 한다.
//
// ⚠️ `.filter(isVisibleNow)` 로 쓰지 말 것 — filter 가 두 번째 인자로 넘기는 **인덱스**가
//    now 자리에 꽂혀 사실상 전 행이 숨는다. 반드시 `(r) => isVisibleNow(r)` 로 감싼다.
function isVisibleNow(
  r: { event_date: string | null; created_at: string },
  now = Date.now(),
): boolean {
  // created_at 은 오프셋이 붙은 ISO 문자열(`…+09:00`/`…+00:00`)이라 Date.parse 가 그대로 읽는다.
  return r.event_date !== null || Date.parse(r.created_at) <= now;
}

// 게시판 하나의 공개 글 조회(본문 제외, 첨부 포함) — 캐시 항목을 **게시판 단위**로 나눈다.
// 전신은 전체 코퍼스를 한 항목에 담는 fetchListRows 였는데, 3,548건에서 2MB 한도를
// 다시 넘겨 캐시가 전멸했다(위 LIST_COLUMNS 주석 참조). unstable_cache 는 인자를
// 캐시 키에 포함하므로 board 별로 항목이 따로 잡히고, 무효화는 전과 같이 'posts'
// 태그 하나 — CMS 쓰기(revalidateTag)가 전 게시판을 함께 턴다.
const fetchBoardRows = unstable_cache(
  async (board: string): Promise<DbPost[]> => {
    // ⚠️ PostgREST 는 응답 행 수에 상한(Supabase 기본 1,000)이 걸려 있고, 넘치면
    //    오류가 아니라 조용히 잘라서 준다. career 게시판이 936건으로 이미 턱밑이라
    //    게시판 단위가 된 뒤에도 range 페이지 루프는 유지한다.
    //    이 루프가 없으면 오래된 글이 소리 없이 사라진다.
    const PAGE = 1000;
    const rows: DbPost[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb()
        .from('posts')
        .select(LIST_COLUMNS)
        .eq('published', true)
        .eq('board', board)
        .order('created_at', { ascending: false })
        // 같은 날짜가 여럿이면 정렬이 요청마다 흔들려 페이지 경계에서 행이
        // 중복·누락될 수 있다 — id 로 순서를 확정한다.
        .order('id', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`게시글 조회 실패(board=${board}): ${error.message}`);
      const page = (data ?? []) as unknown as DbPost[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows;
  },
  ['posts-list-board'],
  // 수명 하루 — 실제 무효화는 CMS 쓰기의 revalidateTag('posts') 이고 이 타이머는 안전망일
  // 뿐이다. 600 이던 시절엔 크롤러가 목록을 하루 2,300번 다시 끌어와(≈100MB) Supabase
  // 무료 egress 를 태웠다(위 예약 게이트 주석). 게이트를 메모리로 옮겨 짧을 이유가 없어졌다.
  { tags: ['posts'], revalidate: 86400 },
);

// ── 상세 조회 (본문 포함, 1행) ─────────────────────────────────────────
// 목록에서 본문을 뺐으므로 상세는 자기 행을 직접 읽는다. 전체를 훑어 find 하던
// 예전 방식과 달리 캐시 항목이 글 하나 크기라 2MB 한도와 무관하고, 재방문은
// 같은 키로 바로 맞는다. 무효화는 목록과 같은 'posts' 태그 하나로 함께 걸린다.

const fetchRowById = unstable_cache(
  async (id: number): Promise<DbPost | null> => {
    const { data, error } = await sb()
      .from('posts')
      .select(DETAIL_COLUMNS)
      .eq('published', true)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`게시글 조회 실패(id=${id}): ${error.message}`);
    return (data as unknown as DbPost | null) ?? null;
  },
  ['post-by-id'],
  { tags: ['posts'], revalidate: 86400 },
);

const fetchRowBySlugOnly = unstable_cache(
  async (board: string, slug: string): Promise<DbPost | null> => {
    const { data, error } = await sb()
      .from('posts')
      .select(DETAIL_COLUMNS)
      .eq('published', true)
      .eq('board', board)
      .eq('slug', slug)
      // 목록 정렬과 같은 규칙 — slug 가 중복된 행이 생겨도 고르는 글이 흔들리지 않는다
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1);
    if (error) throw new Error(`게시글 조회 실패(slug=${slug}): ${error.message}`);
    return ((data ?? [])[0] as unknown as DbPost | undefined) ?? null;
  },
  ['post-by-slug'],
  { tags: ['posts'], revalidate: 86400 },
);

// ── 상세 조회의 예약 게이트 ────────────────────────────────────────────
// 캐시에는 공개 시각과 무관하게 행이 들어 있으므로, 아직 열릴 때가 아닌 글은 여기서
// null 로 접는다 — 목록에서 뺀 글이 주소를 직접 쳐서 열리면 게이트가 무의미하다.
// **상세를 읽는 모든 경로는 이 두 함수만 부른다**(fetchRowById/fetchRowBySlugOnly 직접
// 호출 금지). 아직 안 보일 글은 없는 글과 똑같이 굴어야 한다(호출부가 404 로 만든다).

async function rowById(id: number): Promise<DbPost | null> {
  const row = await fetchRowById(id);
  return row && isVisibleNow(row) ? row : null;
}

async function rowBySlugOnly(board: string, slug: string): Promise<DbPost | null> {
  const row = await fetchRowBySlugOnly(board, slug);
  return row && isVisibleNow(row) ? row : null;
}

/** 뉴스형 상세 1건 — slug 로 찾되, slug 가 비어 있는 글은 목록이 id 를 slug 로 쓰므로
 *  (toNews 의 `r.slug ?? String(r.id)`) 숫자 주소도 같은 규칙으로 받아 준다. */
async function fetchRowBySlug(board: string, slug: string): Promise<DbPost | null> {
  const hit = await rowBySlugOnly(board, slug);
  if (hit) return hit;
  if (!/^\d+$/.test(slug)) return null;
  const row = await rowById(Number(slug));
  // 목록이 만들어 냈을 주소와 정확히 같을 때만 인정한다 — slug 를 가진 글이
  // id 주소로도 열리면 같은 글에 URL 이 둘 생긴다.
  if (!row || row.board !== board) return null;
  return (row.slug ?? String(row.id)) === slug ? row : null;
}

// ── DB 행 → 기존 타입 어댑터 ───────────────────────────────────────────
function loc(ko: string | null | undefined, en: string | null | undefined): Localized {
  const k = ko ?? '';
  return { ko: k, en: en && en.trim() !== '' ? en : k };
}


/** 표시용 날짜 — 행사(또는 isEvent)는 행사일, 그 외는 작성일(게시일).
 *  ⚠️ 2026-08-31 분리: 세미나는 여기서 빠졌다. 세미나 목록·상세의 날짜는 **게시일**이고,
 *  캘린더 배치는 toSeminar 가 따로 싣는 Seminar.eventDate 가 담당한다. 예전에는 캘린더가
 *  세미나를 게시일 칸에 올려 어긋났기에 표시일까지 행사일로 밀었지만, 이제 캘린더 쪽이
 *  eventDate 를 보므로 양쪽 요구가 같이 만족된다. event_date 없는 구 글은 작성일 폴백. */
function dateOf(r: DbPost): string {
  // event_date 는 date 칼럼이라 시간대가 없다 — 그대로 쓴다.
  if ((r.board === 'events' || r.is_event) && r.event_date) return r.event_date;
  return kstDate(r.created_at);
}

function attsOf(r: DbPost): Attachment[] | undefined {
  const list = (r.attachments ?? []).slice().sort((a, b) => a.sort - b.sort);
  if (list.length === 0) return undefined;
  return list.map((a) => ({
    label: loc(a.label_ko, a.label_en),
    href: a.url,
    ...(a.size_bytes && a.size_bytes > 0 ? { size: a.size_bytes } : {}),
  }));
}

/** 본문 HTML(정화 저장분)에서 첫 <img> 의 src 추출 — 썸네일 미지정 시 폴백.
 *  `<img` 바로 뒤 공백을 요구해 img 로 시작하는 다른 태그명 오탐을 차단한다.
 *  ⚠️ 목록 행에는 본문이 없어(LIST_COLUMNS) 이 폴백이 돌지 않는다. 대신 thumbnail_url 을
 *  일괄 백필해 두었다(본문 사진이 있는데 썸네일이 없는 글은 4건뿐, 모두 이모지·추적
 *  픽셀이라 의도적으로 제외한 것들이다). 상세 행에서는 그대로 동작한다. */
const FIRST_IMG_RE = /<img\s[^>]*?src=["']([^"']+)["']/i;
function firstBodyImage(r: DbPost): string | undefined {
  const m = (r.body_html_ko ?? '').match(FIRST_IMG_RE) ?? (r.body_html_en ?? '').match(FIRST_IMG_RE);
  return m?.[1];
}

/** 표시용 썸네일 — 지정 썸네일 우선, 없으면 본문 첫 사진(붙여넣기·드래그 포함) */
function thumbOf(r: DbPost): string | undefined {
  return r.thumbnail_url ?? firstBodyImage(r);
}

function toNews(r: DbPost): NewsItem {
  return {
    slug: r.slug ?? String(r.id),
    // 분류는 일반/성과 2종 — DB 에 남은 구 값(notice/seminar)은 '일반'으로 눕힌다
    category: normalizeNewsCategory(r.category),
    date: dateOf(r),
    title: loc(r.title_ko, r.title_en),
    excerpt: loc(r.excerpt_ko, r.excerpt_en),
    body: loc(r.body_html_ko, r.body_html_en),
    image: thumbOf(r) ?? '',
    ...(attsOf(r) ? { attachments: attsOf(r) } : {}),
    // 고정은 켜졌을 때만 실어 보낸다 — 값이 있을 때만 넣는 다른 선택 필드와 같은 관례
    ...(r.pinned ? { pinned: true } : {}),
  };
}

function toNotice(r: DbPost): Notice {
  const thumb = thumbOf(r);
  return {
    id: String(r.id),
    date: dateOf(r),
    title: loc(r.title_ko, r.title_en),
    body: loc(r.body_html_ko, r.body_html_en),
    // 에디토리얼 목록용 썸네일·발췌 — 값이 있을 때만 (모든 게시판 공통, toSeminar 등에 전파)
    ...(thumb ? { image: thumb } : {}),
    ...(r.excerpt_ko || r.excerpt_en ? { excerpt: loc(r.excerpt_ko, r.excerpt_en) } : {}),
    ...(attsOf(r) ? { attachments: attsOf(r) } : {}),
    // 게시판 자체 분류(자료실의 서식/규정 등) — 값이 있을 때만 실어 보낸다
    ...(r.category ? { category: r.category } : {}),
    // 고정(toSeminar·toEvent·toAlumniEvent 가 스프레드로 상속받는다)
    ...(r.pinned ? { pinned: true } : {}),
  };
}

function toSeminar(r: DbPost): Seminar {
  // end_date(종료일) — 세미나·동문행사(toAlumniEvent 가 스프레드로 상속)도 기간을 가질 수 있다
  return {
    ...toNotice(r),
    host: loc(r.host_ko, r.host_en),
    ...(r.end_date ? { endDate: r.end_date } : {}),
    // 행사일 — 세미나의 date 는 게시일이므로 캘린더가 쓸 실제 날짜를 따로 싣는다
    ...(r.event_date ? { eventDate: r.event_date } : {}),
  };
}

function toEvent(r: DbPost): EventItem {
  return {
    ...toNotice(r),
    dateLabel: loc(r.date_label_ko, r.date_label_en),
    ...(r.end_date ? { endDate: r.end_date } : {}),
  };
}

function toAlumniEvent(r: DbPost): AlumniEvent {
  return { ...toSeminar(r), ...(r.is_event ? { isEvent: true } : {}) };
}

// ── 통합 게시판 글(BoardPost) 라벨 — 단일 출처 ─────────────────────────
// 목록(fetchAllBoardPosts)과 상세(fetchBoardPost)가 서로 다른 경로로 같은 글을 만들므로
// boardKey·meta 표를 양쪽에 복사해 두면 언젠가 어긋난다. 여기 한 곳만 본다.
// 표에 없는 게시판(news/alumniEvents/instagram/calendar)은 통합 목록의
// 대상이 아니다 — 자기 전용 라우트를 쓴다.
const BOARD_POST_META: Record<string, { boardKey: BoardPost['boardKey']; meta?: Localized }> = {
  noticesUndergrad: { boardKey: 'notices', meta: { ko: '학부 공지', en: 'Undergraduate' } },
  noticesGraduate: { boardKey: 'notices', meta: { ko: '대학원 공지', en: 'Graduate' } },
  noticesExternal: { boardKey: 'notices', meta: { ko: '외부기관 공지', en: 'External' } },
  noticesScholarship: { boardKey: 'notices', meta: { ko: '장학생 선발공고', en: 'Scholarship' } },
  // 아래 넷은 meta 가 게시판 고정 라벨이 아니라 행마다 다른 값이라 표에 두지 않는다:
  // 세미나는 연사(host), 행사는 기간(dateLabel), 나머지는 meta 없음.
  seminars: { boardKey: 'seminars' },
  events: { boardKey: 'events' },
  thesis: { boardKey: 'thesis' },
  career: { boardKey: 'career' },
  resources: { boardKey: 'resources' },
};

/**
 * 저장 계층 board 값 → 통합 게시판 boardKey (표에 없으면 undefined).
 *
 * 구 사이트 URL 리졸버(app/me)가 쓴다. 매핑 스냅숏(legacy-redirects.gen.json)에는
 * DB 의 board 값(noticesUndergrad 등)이 그대로 들어 있는데 그건 **주소 세그먼트가
 * 아니다** — /news/noticesUndergrad/… 같은 라우트는 없다. 위 표를 복사해 가지 말고
 * 이 함수를 거쳐라(공지 4종이 한 게시판으로 합쳐지는 규칙이 여기 한 곳에만 있다).
 */
export function boardKeyOf(board: string): BoardPost['boardKey'] | undefined {
  return BOARD_POST_META[board]?.boardKey;
}

// ⚠️ 세 어댑터는 excerpt·image 를 반드시 실어 보내야 한다 — 상세 페이지의
//    description 이 요약을 먼저 쓰고(없으면 본문에서 생성), og:image 가 썸네일을 쓴다.
//    예전엔 세미나·행사 어댑터가 필드를 손으로 나열하며 이 둘을 떨어뜨려, 같은 글이
//    목록에서는 요약·썸네일을 갖고 상세에서만 없었다.
function noticeToBoardPost(n: Notice, board: string): BoardPost {
  const m = BOARD_POST_META[board];
  // 스프레드라 excerpt·image 는 toNotice 가 넣어 준 그대로 따라온다
  return { ...n, boardKey: m.boardKey, ...(m.meta ? { meta: m.meta } : {}) };
}

const seminarToBoardPost = (s: Seminar): BoardPost => ({
  id: s.id, date: s.date, title: s.title, body: s.body,
  boardKey: 'seminars', meta: s.host, attachments: s.attachments,
  // 값이 있을 때만 — toNotice 와 같은 관례(빈 키를 만들지 않는다)
  ...(s.excerpt ? { excerpt: s.excerpt } : {}),
  ...(s.image ? { image: s.image } : {}),
});

const eventToBoardPost = (e: EventItem): BoardPost => ({
  id: e.id, date: e.date, title: e.title, body: e.body,
  boardKey: 'events', meta: e.dateLabel, attachments: e.attachments,
  ...(e.excerpt ? { excerpt: e.excerpt } : {}),
  ...(e.image ? { image: e.image } : {}),
});

/** DB 행 → BoardPost. 통합 게시판 소속이 아니면 undefined(상세 페이지의 404 경로). */
function rowToBoardPost(r: DbPost): BoardPost | undefined {
  if (!BOARD_POST_META[r.board]) return undefined;
  if (r.board === 'seminars') return seminarToBoardPost(toSeminar(r));
  if (r.board === 'events') return eventToBoardPost(toEvent(r));
  return noticeToBoardPost(toNotice(r), r.board);
}

const byDateDesc = <T extends { date: string }>(arr: T[]) =>
  arr.slice().sort((a, b) => (a.date < b.date ? 1 : -1));

/** 고정 글 먼저, 그 안에서(그리고 나머지도) 최신순 — 게시판 목록 공통 정렬 */
const byPinnedDate = <T extends { date: string; pinned?: boolean }>(arr: T[]) =>
  arr.slice().sort(
    (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.date < b.date ? 1 : -1),
  );

/** git 폴백용 — 날짜 재정렬 없이 고정만 앞으로(파일 순서 보존, 안정 분할) */
const pinnedFirst = <T extends { pinned?: boolean }>(arr: T[]) => [
  ...arr.filter((p) => p.pinned),
  ...arr.filter((p) => !p.pinned),
];

/** 게시판 하나의 "지금 보여도 되는" 행 — 목록을 읽는 모든 경로가 여기 한 곳을 지난다.
 *  캐시(fetchBoardRows)에는 공개 시각과 무관하게 담겨 있고 예약 게이트는 여기서 걸린다.
 *  ⚠️ fetchBoardRows 를 직접 부르지 말 것 — 게이트를 건너뛴 목록이 생긴다. */
async function rowsOf(board: string): Promise<DbPost[]> {
  return (await fetchBoardRows(board)).filter((r) => isVisibleNow(r));
}

// ── 공개 API (기존 content.ts 이름과 대응) ─────────────────────────────

export async function fetchNews(): Promise<NewsItem[]> {
  if (postsSource() === 'git') return pinnedFirst(gitNews);
  return byPinnedDate((await rowsOf('news')).map(toNews));
}

/** 뉴스 상세 1건 — 목록에는 본문이 없으므로(LIST_COLUMNS) 자기 행을 직접 읽는다 */
export async function fetchNewsBySlug(slug: string): Promise<NewsItem | undefined> {
  if (postsSource() === 'git') return gitNews.find((n) => n.slug === slug);
  const r = await fetchRowBySlug('news', slug);
  return r ? toNews(r) : undefined;
}

/**
 * 뉴스 기사의 주소 slug 를 DB id 로 되찾는다 — 구 사이트 URL 리졸버(app/me) 전용.
 *
 * 게시판 10종 중 뉴스만 상세 주소가 id 가 아니라 slug 라(/news/press/<slug>),
 * 매핑 스냅숏이 들고 있는 id 만으로는 새 주소를 만들 수 없다. 스냅숏에 slug 를
 * 박아 두지 않고 여기서 읽는 이유: CMS 에서 slug 를 고치면 박아 둔 값은 그대로
 * 죽지만 이 조회는 따라간다. 비용은 fetchRowById 의 캐시(태그 'posts') 1건이다.
 *
 * slug 계산 규칙은 toNews 와 같아야 한다(slug 가 비면 목록도 id 를 주소로 쓴다).
 * git 소스에는 DB id 가 없어 항상 undefined — 호출부가 목록으로 폴백한다.
 */
export async function fetchNewsSlugById(id: string): Promise<string | undefined> {
  if (postsSource() === 'git') return undefined;
  if (!/^\d+$/.test(id)) return undefined;
  const r = await rowById(Number(id));
  if (!r || r.board !== 'news') return undefined;
  return r.slug ?? String(r.id);
}

/** 홈 인스타그램 그리드용 게시물 — CMS '인스타그램' 게시판(DB 전용, git 폴백은 빈 목록).
 *  제목 = 캡션, thumbnail = 타일 사진, link_url = 실제 게시물(새 창). URL 없는 행은 제외. */
export interface InstagramPost {
  id: string;
  date: string;
  caption: Localized;
  image?: string;
  url: string;
}

export async function fetchInstagramPosts(): Promise<InstagramPost[]> {
  if (postsSource() === 'git') return [];
  return byDateDesc(
    (await rowsOf('instagram'))
      .filter((r) => (r.link_url ?? '').trim() !== '')
      .map((r) => ({
        id: String(r.id),
        date: dateOf(r),
        caption: loc(r.title_ko, r.title_en),
        ...(thumbOf(r) ? { image: thumbOf(r) } : {}),
        url: (r.link_url as string).trim(),
      })),
  );
}

/** 홈 캘린더용 '캘린더 전용 일정' — CMS '일정 (캘린더)' 게시판(DB 전용, git 폴백은 빈 목록).
 *  게시글 본문이 없는 학사일정이라 event_date(시작)·end_date(종료)·category 만 쓴다.
 *  link_url 은 선택 — 없으면 홈에서 링크 없는 정적 카드가 된다. */
export interface CalendarPost {
  id: string;
  /** 시작일 YYYY-MM-DD */
  start: string;
  /** 종료일. 없으면 하루 일정 */
  end?: string;
  title: Localized;
  category: string;
  /** 선택 링크 — 비면 홈 카드가 <div> 로 렌더된다 */
  href?: string;
}

export async function fetchCalendarPosts(): Promise<CalendarPost[]> {
  if (postsSource() === 'git') return [];
  return (await rowsOf('calendar'))
    // 시작일이 없는 행은 달력에 놓을 자리가 없다 — 조용히 뺀다.
    .filter((r) => (r.event_date ?? '').trim() !== '')
    .map((r) => ({
      id: String(r.id),
      start: r.event_date as string,
      ...(r.end_date ? { end: r.end_date } : {}),
      title: loc(r.title_ko, r.title_en),
      category: r.category ?? 'academic',
      ...((r.link_url ?? '').trim() !== '' ? { href: (r.link_url as string).trim() } : {}),
    }))
    // 시작일 오름차순 — 소비하는 쪽이 다시 정렬하지만, 순서가 매번 흔들리면
    // 같은 날짜끼리의 배열이 요청마다 달라져 정적 렌더 결과가 불안정해진다.
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** board.json 대응 — 게시판별 배열 묶음 */
export async function fetchBoardData(): Promise<typeof gitBoard> {
  if (postsSource() === 'git') {
    // 폴백에서도 고정은 지킨다 — 같은 모양을 그대로 돌려주되 각 배열만 앞당긴다
    return {
      seminars: pinnedFirst(gitBoard.seminars),
      events: pinnedFirst(gitBoard.events),
      noticesUndergrad: pinnedFirst(gitBoard.noticesUndergrad),
      noticesGraduate: pinnedFirst(gitBoard.noticesGraduate),
      noticesExternal: pinnedFirst(gitBoard.noticesExternal),
      noticesScholarship: pinnedFirst(gitBoard.noticesScholarship),
      thesis: pinnedFirst(gitBoard.thesis),
      career: pinnedFirst(gitBoard.career),
      resources: pinnedFirst(gitBoard.resources),
      alumniEvents: pinnedFirst(gitBoard.alumniEvents),
    };
  }
  // 게시판별 캐시 항목을 병렬로 읽는다 — 캐시가 실제로 저장되므로(항목당 ≤575kB)
  // 대부분 히트고, 미스도 그 게시판 하나만 다시 조회한다.
  const [
    seminars, events, noticesUndergrad, noticesGraduate, noticesExternal,
    noticesScholarship, thesis, career, resources, alumniEvents,
  ] = await Promise.all([
    rowsOf('seminars'), rowsOf('events'),
    rowsOf('noticesUndergrad'), rowsOf('noticesGraduate'),
    rowsOf('noticesExternal'), rowsOf('noticesScholarship'),
    rowsOf('thesis'), rowsOf('career'),
    rowsOf('resources'),
    rowsOf('alumniEvents'),
  ]);
  return {
    seminars: byPinnedDate(seminars.map(toSeminar)),
    events: byPinnedDate(events.map(toEvent)),
    noticesUndergrad: byPinnedDate(noticesUndergrad.map(toNotice)),
    noticesGraduate: byPinnedDate(noticesGraduate.map(toNotice)),
    noticesExternal: byPinnedDate(noticesExternal.map(toNotice)),
    noticesScholarship: byPinnedDate(noticesScholarship.map(toNotice)),
    thesis: byPinnedDate(thesis.map(toNotice)),
    career: byPinnedDate(career.map(toNotice)),
    resources: byPinnedDate(resources.map(toNotice)),
    alumniEvents: byPinnedDate(alumniEvents.map(toAlumniEvent)),
  };
}

/** getAllBoardPosts 대응 — 사이트맵·검색용 통합 목록 (meta 라벨 규칙 동일).
 *  ⚠️ 여기서 나오는 글들의 body 는 빈 문자열이다(목록 조회에 본문이 없다).
 *  본문이 필요하면 fetchBoardPost(id) 를 쓸 것. */
export async function fetchAllBoardPosts(): Promise<BoardPost[]> {
  if (postsSource() === 'git') return gitAllBoardPosts();
  const b = await fetchBoardData();
  return [
    ...b.noticesUndergrad.map((n) => noticeToBoardPost(n, 'noticesUndergrad')),
    ...b.noticesGraduate.map((n) => noticeToBoardPost(n, 'noticesGraduate')),
    ...b.noticesExternal.map((n) => noticeToBoardPost(n, 'noticesExternal')),
    ...b.noticesScholarship.map((n) => noticeToBoardPost(n, 'noticesScholarship')),
    ...b.seminars.map(seminarToBoardPost),
    ...b.events.map(eventToBoardPost),
    ...b.thesis.map((t) => noticeToBoardPost(t, 'thesis')),
    ...b.career.map((c) => noticeToBoardPost(c, 'career')),
    ...b.resources.map((r) => noticeToBoardPost(r, 'resources')),
  ];
}

/** 게시판 글 상세 1건 — 본문 포함. 통합 목록을 훑지 않고 그 행만 읽는다. */
export async function fetchBoardPost(id: string): Promise<BoardPost | undefined> {
  if (postsSource() === 'git') return gitAllBoardPosts().find((p) => p.id === id);
  if (!/^\d+$/.test(id)) return undefined; // DB id 는 연번 — 그 외 주소는 조회할 것도 없다
  const r = await rowById(Number(id));
  return r ? rowToBoardPost(r) : undefined;
}

/** 동문 소식·네트워크 (동문 전용 라우트) */
export async function fetchAlumniEvents(): Promise<AlumniEvent[]> {
  if (postsSource() === 'git') return pinnedFirst(gitAlumniEvents);
  return byPinnedDate((await rowsOf('alumniEvents')).map(toAlumniEvent));
}

/** 동문 행사 상세 1건 — 본문 포함 단건 조회 */
export async function fetchAlumniEventById(id: string): Promise<AlumniEvent | undefined> {
  if (postsSource() === 'git') return gitAlumniEvents.find((e) => e.id === id);
  if (!/^\d+$/.test(id)) return undefined;
  const r = await rowById(Number(id));
  return r && r.board === 'alumniEvents' ? toAlumniEvent(r) : undefined;
}

/** 금주 캘린더 — 행사 전체 + 동문(isEvent) */
export async function fetchCalendarEntries(): Promise<CalendarEntry[]> {
  if (postsSource() === 'git') return gitCalendarEntries();
  const b = await fetchBoardData();
  const events: CalendarEntry[] = b.events.map((e) => ({
    id: e.id, date: e.date, title: e.title, category: 'event',
  }));
  const alumni: CalendarEntry[] = b.alumniEvents
    .filter((a) => a.isEvent && a.date)
    .map((a) => ({ id: a.id, date: a.date, title: a.title, category: 'alumni' }));
  return [...events, ...alumni];
}

// ── 자료실 검색 인덱스용 본문 ──────────────────────────────────────────
// 목록에서 본문을 뺀 뒤 유일하게 남은 "목록인데 본문이 필요한" 자리. 자료실은 받아 가는
// 파일 목록이라 제목·첨부만으로는 원하는 서식을 못 찾는 일이 있어 본문까지 훑는다.
// 다행히 자료실은 7건뿐이라 전용 조회가 부담이 없다 — 전체 1,275건에 본문을 다시
// 실어 2MB 한도를 넘기는 것과는 비교가 안 된다.
// ⚠️ created_at·event_date 를 함께 읽는 이유는 예약 게이트다. 게이트가 쿼리에서
//    메모리로 옮겨 갔으므로(isVisibleNow) 판정에 쓸 두 값이 행에 실려 와야 한다.
interface ResourceBodyRow {
  id: number;
  body_html_ko: string | null;
  body_html_en: string | null;
  created_at: string;
  event_date: string | null;
}

const fetchResourceBodiesDb = unstable_cache(
  async (): Promise<ResourceBodyRow[]> => {
    const { data, error } = await sb()
      .from('posts')
      .select('id, body_html_ko, body_html_en, created_at, event_date')
      .eq('published', true)
      .eq('board', 'resources');
    if (error) throw new Error(`자료실 본문 조회 실패: ${error.message}`);
    return (data ?? []) as unknown as ResourceBodyRow[];
  },
  ['posts-resource-bodies'],
  { tags: ['posts'], revalidate: 86400 },
);

/** 자료실 글 id → 본문. 목록(fetchBoardData().resources)의 body 가 비어 있으므로
 *  검색 인덱스를 만드는 쪽이 이걸 따로 받아 간다(서버에서만 쓰고 클라이언트로는
 *  태그를 지운 검색 문자열만 나간다). */
export async function fetchResourceBodies(): Promise<Record<string, Localized>> {
  if (postsSource() === 'git') {
    return Object.fromEntries(gitBoard.resources.map((r) => [r.id, r.body]));
  }
  // 예약 게이트 — 목록(fetchBoardData().resources = rowsOf('resources'))과 같은 집합이어야
  // 검색 인덱스에 유령 항목이 생기지 않는다(자료실은 event_date 를 쓰지 않아 실제로 걸린다).
  const rows = (await fetchResourceBodiesDb()).filter((r) => isVisibleNow(r));
  return Object.fromEntries(rows.map((r) => [String(r.id), loc(r.body_html_ko, r.body_html_en)]));
}
