// 관리자 콘솔이 다루는 게시판 정의와 편집용 레코드 형태.
// content.ts의 실제 타입(Notice/Seminar/EventItem/NewsItem/Attachment/Localized)을
// 재사용해 사이트와 형태를 일치시킨다.

import type {
  Attachment,
  EventItem,
  NewsItem,
  Notice,
  Seminar,
} from '@/lib/content';
import type { ThesisNoticeInput } from '@/lib/thesis-submit/notice';
import type { ReviewStatus, ThesisReview } from '@/lib/thesis-submit/review';

/**
 * 학생 제출 공고의 제출·검토 기록(읽기 전용 — 저장 페이로드에 싣지 않는다).
 * posts-server 의 rowToEditRecord 가 posts.thesis_submission + published 로 만든다.
 * 계약: src/lib/thesis-submit/review.ts
 */
export interface EditSubmission {
  email: string;
  /** 접수 시각 ISO */
  submittedAt: string;
  /** '박사과정' | '통합과정' — 칸이 생기기 전 제출분은 빈 문자열 */
  program: string;
  /** statusOf(record, published) — status 없는 기존 제출분도 판정된다 */
  status: ReviewStatus;
  /** receiptNo(notice, id) — 'TH-2026-1021-3812' */
  receiptNo: string;
  /** 제출 입력 원본(검토 화면의 심사 정보 표). 깨진 기록이면 null */
  notice: ThesisNoticeInput | null;
  review: ThesisReview;
}

/** board.json 파일 전체 형태 (content.ts의 board와 동일) */
export interface BoardFile {
  seminars: Seminar[];
  events: EventItem[];
  noticesUndergrad: Notice[];
  noticesGraduate: Notice[];
  thesis: Notice[];
  career: Notice[];
  resources: Notice[];
  /** BK21 자료실 — 2026-09 신설. git 폴백 스냅샷에는 아직 키가 없다(content.ts 와 같은 이유) */
  bk21Resources?: Notice[];
  /** BK21 사업계획서·보고서 — 2026-09 신설(PDF 첨부가 본체). 위와 같은 사정 */
  bk21Reports?: Notice[];
  alumniEvents: Seminar[];
}

/** 어드민에서 선택 가능한 게시판 키 */
export type BoardKey =
  | 'calendar'
  | 'noticesUndergrad'
  | 'noticesGraduate'
  | 'noticesExternal'
  | 'noticesScholarship'
  | 'news'
  | 'seminars'
  | 'events'
  | 'thesis'
  | 'career'
  | 'resources'
  | 'bk21Resources'
  | 'bk21Reports'
  | 'alumniEvents';

/** 편집 폼이 다루는 통합 레코드. 게시판에 따라 일부 필드만 사용된다. */
export interface EditRecord {
  id: string; // board.json 항목의 id, 뉴스는 slug를 여기에 담는다
  date: string;
  titleKo: string;
  titleEn: string;
  bodyKo: string;
  bodyEn: string;
  // 원문 모드 — 켜면 본문을 화이트리스트 정화 대신 "스크립트류만 제거"로 저장한다.
  // HTML 소스 모드(코드뷰) 안의 체크박스가 켜고, 서버 처리는 sanitize.ts 의 scrubRawHtml.
  bodyRaw?: boolean;
  // 세미나 전용
  hostKo?: string;
  hostEn?: string;
  // 행사 전용 — 레거시 수동 기간 라벨(폼·페이로드에서는 폐지, 내부 변환 함수들이 참조해 필드는 유지)
  dateLabelKo?: string;
  dateLabelEn?: string;
  // 기간 게시판(행사·세미나·동문행사) 전용 — 종료일(YYYY-MM-DD). 빈 문자열이면 하루 일정
  endDate?: string;
  // 캘린더 전용 — 선택 링크(일정 항목이 가리킬 URL)
  linkUrl?: string;
  // 동문 소식·네트워크 전용 — 특정 날짜가 정해진 행사인지(체크 시 캘린더 '동문'에 표시)
  isEvent?: boolean;
  // 목록 최상단 고정 — 글 목록이 아닌 게시판(noBody: 일정)은 대상이 아니다
  pinned?: boolean;
  // 뉴스 전용 + 일정(캘린더) 전용.
  // ⚠️ 타입을 string 으로 넓힌 이유: 뉴스는 general|achievement 를, 캘린더는
  // academic|event|recruit|exam 을 쓰는데 저장처가 posts.category 한 칼럼으로 같다.
  // 두 집합은 board 값으로 스코프가 갈리므로 한 칼럼을 공유해도 충돌하지 않는다.
  // 여기서 유니온으로 좁히면 게시판이 늘 때마다 이 자리를 고쳐야 하고, 실제 판정은
  // BoardMeta.categories 가 하므로 편집 레코드는 자유 문자열로 둔다.
  category?: string;
  excerptKo?: string;
  excerptEn?: string;
  image?: string;
  /** 동문 인터뷰 전용(BoardMeta.interview) — 헤더 6값 중 CMS 입력분.
   *  폼이 다루기 쉽도록 Localized 쌍을 납작하게 편 형태이고, 저장 직전
   *  posts-server 의 payloadToRow 가 jsonb({name:{ko,en},…}) 로 접는다. */
  interview?: EditInterview;
  /** 공개 여부 — admin API(rowToEditRecord)가 언제나 boolean 으로 내려준다. false = 사이트에
   *  안 보이는 글(학생 제출 공고의 '검토 대기'). 새 글(blankRecord)에는 키가 없다 = DB 기본값 true. */
  published?: boolean;
  /** 학생 제출 공고의 제출 기록(읽기 전용 정보 — 저장 페이로드에 싣지 않는다). null = 일반 글 */
  submission?: EditSubmission | null;
  attachments: EditAttachment[];
}

/** 인터뷰 입력칸 9개 — 빈 문자열이 기본값이다(키를 미리 둬야 폼의 dirty 판정이 흔들리지 않는다) */
export interface EditInterview {
  nameKo: string;
  nameEn: string;
  roleKo: string;
  roleEn: string;
  /** 입학년도 — 폼은 2자리('05')도 받고, 저장 시 4자리로 정규화된다(normalizeCohort) */
  cohort: string;
  closingQKo: string;
  closingQEn: string;
  closingAKo: string;
  closingAEn: string;
}

/** 빈 인터뷰 레코드 */
export function emptyInterview(): EditInterview {
  return {
    nameKo: '',
    nameEn: '',
    roleKo: '',
    roleEn: '',
    cohort: '',
    closingQKo: '',
    closingQEn: '',
    closingAKo: '',
    closingAEn: '',
  };
}

export interface EditAttachment {
  labelKo: string;
  labelEn: string;
  href: string;
  /** 바이트 크기 — 업로드 시 File.size 로 자동 기입(직접 URL 을 붙여넣으면 비어 있다) */
  size?: number;
}

export interface BoardMeta {
  key: BoardKey;
  /** 한국어 UI 라벨 (내부 도구라 직접 표기) */
  label: string;
  /** 이 게시판이 사는 파일 */
  file: 'board.json' | 'news.json';
  /** 새 글 id 접두어 (실제 컨벤션 기반) */
  idPrefix: string;
  hasHost: boolean;
  hasDateLabel: boolean;
  /** true면 종료일(end_date) 피커를 노출한다(비우면 하루). 기간 라벨은 저장 시 서버가 자동 생성 */
  hasDateRange?: boolean;
  /** true면 본문·첨부·이미지 풀 섹션을 숨긴다 — 일정(캘린더)은 제목·날짜·선택 링크만 */
  noBody?: boolean;
  isNews: boolean;
  /** true면 '날짜' 필드를 "행사 일정"으로 안내한다(그 날짜로 금주 캘린더에 표시됨) */
  dateIsEvent?: boolean;
  /** true면 "특정 날짜 행사" 체크박스를 노출한다(체크 시 캘린더 '동문'에 표시) */
  hasEventFlag?: boolean;
  /**
   * 분류 선택지 — 값은 posts.category 칼럼에 저장한다. 뉴스의 general|achievement
   * 와는 board 로 스코프가 갈리므로 같은 칼럼을 써도 충돌하지 않는다. 화면은 이
   * 목록만 보고 버튼을 그린다(상수를 직접 참조하지 않는다).
   */
  categories?: { value: string; label: string }[];
  /** true 면 목록을 표·카드가 아니라 월 그리드(달력)로 그린다 — 일정. */
  calendarGrid?: boolean;
  /** true 면 뉴스형이 아니어도 '요약' 필드를 노출한다 — 자료실 목록은 제목 아래
   *  한 줄 설명을 쓰므로 관리자가 직접 써야 한다(뉴스는 isNews 로 이미 켜져 있다). */
  hasExcerpt?: boolean;
  /**
   * 동문 인터뷰 게시판(2026-09 개편, 현재 alumniEvents 하나).
   * 켜면 세 가지가 함께 붙는다 —
   *  ① 폼의 '인터뷰 정보' 섹션(이름·소속/직함·학번 + 마무리 한 줄 2칸),
   *  ② 본문 에디터의 인터뷰 프리셋(PostBodyEditor preset="interview"),
   *  ③ 저장 시 posts.interview(jsonb) 기록.
   * 목록·상세 화면도 이 값이 있는 글만 에디토리얼 레이아웃으로 그린다.
   */
  interview?: boolean;
}

/** 자료실 분류 — posts.category 에 저장. 목록 상단 탭(전체·행정 서식·규정·내규)의 근거이며,
 *  값은 프런트(ResourceLibrary)와 공유하므로 바꾸면 기존 글의 분류가 풀린다. */
export const RESOURCE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'form', label: '행정 서식' },
  { value: 'rule', label: '규정·내규' },
];

/** BK21 자료실 분류 — posts.category 에 저장. 목록 상단 탭(전체·사업성과·규정·지침·서식·자료)의
 *  근거이며, 값은 프런트(/bk21/resources 페이지가 넘기는 categories)와 공유하므로 바꾸면
 *  기존 글의 분류가 풀린다. 소식 자료실(form/rule)과 같은 칼럼을 쓰지만 board 로 스코프가
 *  갈리므로 충돌하지 않는다 — 'rule'·'form' 은 값이 겹쳐도 라벨만 게시판별로 다르다. */
export const BK21_RESOURCE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'result', label: '사업성과' },
  { value: 'rule', label: '규정·지침' },
  { value: 'form', label: '서식·자료' },
];

/** BK21 사업계획서·보고서 분류 — posts.category 에 저장. 목록 카드의 배지이자
 *  구 사이트의 문서 3종(사업계획서 / 자체평가보고서 / 성과평가보고서) 구분이다.
 *  값은 프런트(/bk21/reports 페이지가 라벨을 잇는다)와 공유하므로 바꾸면 기존 글의
 *  분류가 풀린다 — 자료실과 같은 칼럼이지만 board 로 스코프가 갈린다. */
export const BK21_REPORT_CATEGORIES: { value: string; label: string }[] = [
  { value: 'plan', label: '사업계획서' },
  { value: 'self', label: '자체평가보고서' },
  { value: 'performance', label: '성과평가보고서' },
];

/** 뉴스 분류 — posts.category 에 저장. 뉴스 목록 상단 탭(전체·일반·성과)을 가르는 값이며,
 *  값은 프런트(content.ts NewsCategory)와 공유하므로 바꾸면 기존 글의 분류가 풀린다.
 *  content.ts 에서 값을 import 하지 않는 이유는 RESOURCE_CATEGORIES 와 같다 — 이 파일은
 *  클라이언트 번들에 들어가는데 content.ts 는 content/*.json 을 통째로 import 한다. */
export const NEWS_CATEGORIES: { value: string; label: string }[] = [
  { value: 'general', label: '일반' },
  { value: 'achievement', label: '성과' },
];

/** 일정 분류 4종 — posts.category 에 저장되는 값 집합 */
export const CALENDAR_CATEGORIES: { value: string; label: string }[] = [
  { value: 'academic', label: '학사일정' },
  { value: 'event', label: '행사' },
  { value: 'recruit', label: '모집·신청' },
  { value: 'exam', label: '시험' },
];

/** content/*.json 실제 id·slug 컨벤션에 맞춘 게시판 목록 */
export const BOARDS: BoardMeta[] = [
  // 일정(캘린더)은 사이드바 최상단 그룹이라 여기서도 맨 앞에 둔다 — 목록 어순이
  // 화면 어순과 어긋나면 "이동할 게시판" 셀렉트 같은 곳에서 순서가 따로 논다.
  //
  // 링크는 선택이며 전용 편집 패널이 EditRecord.linkUrl 을 직접 채운다.
  { key: 'calendar', label: '일정 (캘린더)', file: 'board.json', idPrefix: 'cal-', hasHost: false, hasDateLabel: false, hasDateRange: true, noBody: true, isNews: false, dateIsEvent: true, calendarGrid: true, categories: CALENDAR_CATEGORIES },
  { key: 'noticesUndergrad', label: '학부 공지', file: 'board.json', idPrefix: 'nu-', hasHost: false, hasDateLabel: false, isNews: false },
  { key: 'noticesGraduate', label: '대학원 공지', file: 'board.json', idPrefix: 'ng-', hasHost: false, hasDateLabel: false, isNews: false },
  { key: 'noticesExternal', label: '외부기관 공지', file: 'board.json', idPrefix: 'nx-', hasHost: false, hasDateLabel: false, isNews: false },
  { key: 'noticesScholarship', label: '장학생 선발공고', file: 'board.json', idPrefix: 'nsch-', hasHost: false, hasDateLabel: false, isNews: false },
  { key: 'news', label: '뉴스', file: 'news.json', idPrefix: '', hasHost: false, hasDateLabel: false, isNews: true, categories: NEWS_CATEGORIES },
  { key: 'seminars', label: '세미나', file: 'board.json', idPrefix: 'sem-', hasHost: true, hasDateLabel: false, hasDateRange: true, isNews: false },
  // events: 기간 라벨 수동 입력(hasDateLabel)을 폐지하고 시작–종료일 피커(hasDateRange)로 전환 —
  // 라벨은 저장 시 서버(formatPeriodLabel)가 자동 생성한다.
  { key: 'events', label: '행사', file: 'board.json', idPrefix: 'evt-', hasHost: false, hasDateLabel: false, hasDateRange: true, isNews: false, dateIsEvent: true },
  { key: 'thesis', label: '학위논문심사', file: 'board.json', idPrefix: 'th-', hasHost: false, hasDateLabel: false, isNews: false },
  { key: 'resources', label: '자료실', file: 'board.json', idPrefix: 'res-', hasHost: false, hasDateLabel: false, isNews: false, categories: RESOURCE_CATEGORIES, hasExcerpt: true },
  { key: 'career', label: '취업 정보', file: 'board.json', idPrefix: 'cr-', hasHost: false, hasDateLabel: false, isNews: false },
  // BK21 자료실 — 소식 자료실과 같은 형태(첨부가 본체 + 요약 한 줄)지만 분류 집합과
  // 노출 위치(/bk21/resources)가 다르다. 사이드바에서도 'BK21 FOUR' 묶음에 산다.
  { key: 'bk21Resources', label: 'BK21 자료실', file: 'board.json', idPrefix: 'bk21res-', hasHost: false, hasDateLabel: false, isNews: false, categories: BK21_RESOURCE_CATEGORIES, hasExcerpt: true },
  // BK21 사업계획서·보고서 — 첨부 PDF 한 건이 본체다. 본문은 선택이고, 상세 화면은
  // 글이 아니라 좌/우 펼침 PDF 리더(/bk21/reports/<id>)다. 요약은 결락 안내 한 줄로 쓴다.
  { key: 'bk21Reports', label: 'BK21 사업계획서·보고서', file: 'board.json', idPrefix: 'bk21rep-', hasHost: false, hasDateLabel: false, isNews: false, categories: BK21_REPORT_CATEGORIES, hasExcerpt: true },
  // 동문 소식·네트워크 = 동문 인터뷰(2026-09 개편). 주최·기간·행사 체크는 인터뷰에
  // 쓸 자리가 없어 껐다 — 플래그만 끈 것이고 host/is_event 저장 경로는 다른 게시판이
  // 그대로 쓰므로 코드는 남는다(이 게시판 값은 저장 시 null 로 눕는다).
  { key: 'alumniEvents', label: '동문 소식·네트워크 (개발중)', file: 'board.json', idPrefix: 'ae-', hasHost: false, hasDateLabel: false, hasDateRange: false, isNews: false, hasEventFlag: false, hasExcerpt: true, interview: true },
];

export function getBoard(key: BoardKey): BoardMeta {
  const found = BOARDS.find((b) => b.key === key);
  if (!found) throw new Error(`알 수 없는 게시판: ${key}`);
  return found;
}

/** 빈 attachment 한 줄 */
export function emptyAttachment(): EditAttachment {
  return { labelKo: '', labelEn: '', href: '' };
}

/** 오늘 날짜 YYYY-MM-DD (로컬 기준) */
export function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * 게시판 접두어 컨벤션(nu-1, ng-2, sem-3 ...)에 맞춰 다음 id를 제안한다.
 * 뉴스는 slug 컨벤션이 자유형이라 날짜 기반 임시 slug를 제안한다.
 */
export function suggestId(meta: BoardMeta, existingIds: string[]): string {
  if (meta.isNews) {
    // 뉴스 slug: 날짜 기반. 같은 날 중복이면 -2, -3… 카운터를 붙여 고유화.
    const base = `${today()}-post`;
    if (!existingIds.includes(base)) return base;
    let i = 2;
    while (existingIds.includes(`${base}-${i}`)) i += 1;
    return `${base}-${i}`;
  }
  const prefix = meta.idPrefix;
  let max = 0;
  for (const id of existingIds) {
    if (id.startsWith(prefix)) {
      const n = Number.parseInt(id.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefix}${max + 1}`;
}

// ---- 도메인 레코드 ↔ 편집 레코드 변환 ----

function attsToEdit(atts?: Attachment[]): EditAttachment[] {
  return (atts ?? []).map((a) => ({
    labelKo: a.label.ko,
    labelEn: a.label.en,
    href: a.href,
    ...(a.size ? { size: a.size } : {}),
  }));
}

/** board.json 내 임의 레코드를 편집 폼 형태로 */
export function toEditRecord(meta: BoardMeta, raw: unknown): EditRecord {
  const r = raw as Record<string, unknown>;
  const loc = (v: unknown): { ko: string; en: string } => {
    const o = (v as { ko?: string; en?: string } | undefined) ?? {};
    return { ko: o.ko ?? '', en: o.en ?? '' };
  };
  const title = loc(r.title);
  const body = loc(r.body);
  const base: EditRecord = {
    id: String(r.id ?? r.slug ?? ''),
    date: String(r.date ?? ''),
    titleKo: title.ko ?? '',
    titleEn: title.en ?? '',
    bodyKo: body.ko ?? '',
    bodyEn: body.en ?? '',
    attachments: attsToEdit(r.attachments as Attachment[] | undefined),
  };
  if (meta.hasHost) {
    const host = loc(r.host);
    base.hostKo = host.ko ?? '';
    base.hostEn = host.en ?? '';
  }
  if (meta.hasDateLabel) {
    const dl = loc(r.dateLabel);
    base.dateLabelKo = dl.ko ?? '';
    base.dateLabelEn = dl.en ?? '';
  }
  if (meta.hasDateRange) {
    // 종료일 — git JSON 구 데이터엔 없어 항상 ''(하루)로 시작한다
    base.endDate = String(r.endDate ?? '');
  }
  if (meta.calendarGrid) {
    base.linkUrl = String(r.linkUrl ?? '');
  }
  if (meta.hasEventFlag) {
    base.isEvent = r.isEvent === true;
  }
  if (!meta.noBody) {
    // 글 목록이 있는 게시판만 고정을 다룬다(일정은 목록 개념 자체가 다르다)
    base.pinned = r.pinned === true;
  }
  if (meta.isNews) {
    // 구 분류(notice/seminar)로 저장된 글도 '일반'으로 열린다 — 매칭되는 option 이
    // 없으면 select 가 빈칸으로 뜨고, 그대로 저장하면 옛 값이 되살아난다.
    base.category = r.category === 'achievement' ? 'achievement' : 'general';
  } else if (meta.categories) {
    // 뉴스 외 분류 게시판(자료실 등) — 미분류('')를 허용하므로 기본값을 넣지 않는다
    base.category = String(r.category ?? '');
  }
  if (meta.isNews || meta.hasExcerpt) {
    const excerpt = loc(r.excerpt);
    base.excerptKo = excerpt.ko ?? '';
    base.excerptEn = excerpt.en ?? '';
  }
  if (meta.interview) {
    // 인터뷰 정보 — git JSON(폴백 스냅샷)과 DB(jsonb) 가 같은 키를 쓴다.
    // 값이 없으면(개편 이전 글) 빈 칸으로 열려 관리자가 채워 넣을 수 있다.
    const iv = (r.interview as Record<string, unknown> | undefined) ?? {};
    const name = loc(iv.name);
    const role = loc(iv.role);
    const cq = loc(iv.closingQ);
    const ca = loc(iv.closingA);
    base.interview = {
      nameKo: name.ko,
      nameEn: name.en,
      roleKo: role.ko,
      roleEn: role.en,
      cohort: String(iv.cohort ?? ''),
      closingQKo: cq.ko,
      closingQEn: cq.en,
      closingAKo: ca.ko,
      closingAEn: ca.en,
    };
  }
  // 대표 이미지(썸네일)는 모든 게시판 공통 — 에디토리얼 목록의 우측 썸네일
  base.image = String(r.image ?? '');
  return base;
}

/** en이 비면 ko로 채운다 (pick의 en 폴백이 `?? `라 빈 문자열은 폴백 안 됨) */
function localized(ko: string, en: string): { ko: string; en: string } {
  const k = ko.trim();
  const e = en.trim();
  return { ko: k, en: e === '' ? k : e };
}

function editToAtts(atts: EditAttachment[]): Attachment[] | undefined {
  const filled = atts.filter((a) => a.href.trim() !== '' || a.labelKo.trim() !== '');
  if (filled.length === 0) return undefined;
  return filled.map((a) => ({
    label: localized(a.labelKo, a.labelEn),
    href: a.href.trim(),
    ...(a.size ? { size: a.size } : {}),
  }));
}

/** 편집 레코드를 board.json에 넣을 Notice/Seminar/EventItem으로 */
export function toBoardEntry(meta: BoardMeta, rec: EditRecord): Notice | Seminar | EventItem {
  const attachments = editToAtts(rec.attachments);
  const common = {
    id: rec.id.trim(),
    date: rec.date,
    title: localized(rec.titleKo, rec.titleEn),
    body: localized(rec.bodyKo, rec.bodyEn),
    ...(attachments ? { attachments } : {}),
    // 고정은 켜졌을 때만 키를 남긴다 — 미체크 글에 pinned:false 를 흩뿌리지 않는다
    ...(rec.pinned ? { pinned: true } : {}),
  };
  if (meta.hasHost) {
    return {
      ...common,
      host: localized(rec.hostKo ?? '', rec.hostEn ?? ''),
      // 동문 소식·네트워크: 체크 시에만 isEvent:true 저장(캘린더 '동문' 표시). 미체크는 키 생략.
      ...(meta.hasEventFlag && rec.isEvent ? { isEvent: true } : {}),
    } as Seminar;
  }
  if (meta.hasDateLabel) {
    return { ...common, dateLabel: localized(rec.dateLabelKo ?? '', rec.dateLabelEn ?? '') } as EventItem;
  }
  return common as Notice;
}

/** 편집 레코드를 news.json에 넣을 NewsItem으로 */
export function toNewsEntry(rec: EditRecord): NewsItem {
  const attachments = editToAtts(rec.attachments);
  return {
    slug: rec.id.trim(),
    // 편집 레코드의 category 는 자유 문자열(캘린더 분류와 칼럼을 공유)이라, 뉴스
    // 파일로 내보낼 때만 뉴스 분류 유니온(general|achievement)으로 되돌린다.
    category: (rec.category as NewsItem['category']) ?? 'general',
    date: rec.date,
    title: localized(rec.titleKo, rec.titleEn),
    excerpt: localized(rec.excerptKo ?? '', rec.excerptEn ?? ''),
    body: localized(rec.bodyKo, rec.bodyEn),
    image: (rec.image ?? '').trim(),
    ...(attachments ? { attachments } : {}),
    ...(rec.pinned ? { pinned: true } : {}),
  };
}

/**
 * 게시판 이동용: 원본 레코드를 대상 게시판이 요구하는 형태로 변환한다.
 * 공통 필드(날짜·제목·본문·첨부)는 유지하고, 대상 게시판에만 있는 필드는
 * 원본에 해당 값이 있으면 승계하고 없으면 기본값으로 채운다. 대상에 없는
 * 필드는 아예 넣지 않아 이동 시 자연스럽게 탈락한다(주최·분류·요약 등).
 * id는 대상 게시판 규칙으로 새로 부여해야 하므로 여기선 원본 값을 그대로 둔다.
 */
export function convertRecordForBoard(
  source: BoardMeta,
  target: BoardMeta,
  raw: unknown,
): EditRecord {
  // 원본을 먼저 편집 레코드로 읽어 공통 필드를 확보한다.
  const src = toEditRecord(source, raw);
  const rec: EditRecord = {
    id: src.id,
    date: src.date,
    titleKo: src.titleKo,
    titleEn: src.titleEn,
    bodyKo: src.bodyKo,
    bodyEn: src.bodyEn,
    attachments: src.attachments,
  };
  if (target.hasHost) {
    // 원본에 주최가 있으면 승계, 없으면 빈 값.
    rec.hostKo = src.hostKo ?? '';
    rec.hostEn = src.hostEn ?? '';
  }
  if (target.hasDateLabel) {
    rec.dateLabelKo = src.dateLabelKo ?? '';
    rec.dateLabelEn = src.dateLabelEn ?? '';
  }
  if (target.hasEventFlag) {
    rec.isEvent = src.isEvent === true;
  }
  if (target.interview) {
    // 인터뷰 게시판으로 옮겨 오면 빈 인터뷰 칸이 생긴다(관리자가 채운다).
    // 반대로 인터뷰 게시판에서 나가면 이 필드가 아예 붙지 않아 자연스럽게 탈락한다.
    rec.interview = src.interview ?? emptyInterview();
  }
  if (!target.noBody) {
    // 고정 상태는 게시판을 옮겨도 따라간다 — 대상이 고정 대상 게시판일 때만
    rec.pinned = src.pinned === true;
  }
  if (target.isNews) {
    // 원본도 뉴스면 분류를 승계, 아니면 기본 '일반'. 자료실처럼 다른 값 집합을
    // 쓰는 게시판(form/rule)에서 옮겨 오면 뉴스 분류가 아니므로 함께 눕힌다.
    rec.category = src.category === 'achievement' ? 'achievement' : 'general';
    rec.excerptKo = src.excerptKo ?? '';
    rec.excerptEn = src.excerptEn ?? '';
  }
  // 대표 이미지는 모든 게시판 공통 — 이동해도 항상 승계
  rec.image = src.image ?? '';
  return rec;
}
