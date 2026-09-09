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

/** board.json 파일 전체 형태 (content.ts의 board와 동일) */
export interface BoardFile {
  seminars: Seminar[];
  events: EventItem[];
  noticesUndergrad: Notice[];
  noticesGraduate: Notice[];
  thesis: Notice[];
  career: Notice[];
  resources: Notice[];
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
  | 'alumniEvents'
  | 'instagram';

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
  // 인스타그램 전용 — 실제 게시물 URL(타일 클릭 시 새 창 이동)
  linkUrl?: string;
  // 동문 소식·네트워크 전용 — 특정 날짜가 정해진 행사인지(체크 시 캘린더 '동문'에 표시)
  isEvent?: boolean;
  // 목록 최상단 고정 — 글 목록이 아닌 게시판(noBody: 일정·인스타그램)은 대상이 아니다
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
  attachments: EditAttachment[];
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
  /** true면 게시물 링크(URL) 필드를 노출한다 — 인스타그램(타일 클릭 목적지) */
  hasLink?: boolean;
  /** true면 본문·첨부·이미지 풀 섹션을 숨긴다 — 링크형 게시판(인스타그램)은 캡션·이미지·URL만 */
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
}

/** 자료실 분류 — posts.category 에 저장. 목록 상단 탭(전체·행정 서식·규정·내규)의 근거이며,
 *  값은 프런트(ResourceLibrary)와 공유하므로 바꾸면 기존 글의 분류가 풀린다. */
export const RESOURCE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'form', label: '행정 서식' },
  { value: 'rule', label: '규정·내규' },
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
  // ⚠️ hasLink 를 켜지 않는다. 인스타그램의 hasLink 는 PostForm.handleSubmit 에서
  // "URL 필수 + 대표 이미지 필수" 검증을 유발한다(그 게시판은 링크가 목적지 자체다).
  // 캘린더의 링크는 선택이고 전용 편집 패널에서 다루므로, 그 검증을 물려받으면
  // 링크 없는 학사일정을 저장할 수 없게 된다. 패널이 EditRecord.linkUrl 을 직접
  // 채우고 toPayload 가 그대로 보낸다.
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
  { key: 'alumniEvents', label: '동문 소식·네트워크', file: 'board.json', idPrefix: 'ae-', hasHost: true, hasDateLabel: false, hasDateRange: true, isNews: false, hasEventFlag: true },
  // 인스타그램 — 홈 하단 그리드에 노출. 캡션(제목)·대표 이미지·게시물 URL만 받는 링크형 게시판.
  { key: 'instagram', label: '인스타그램', file: 'board.json', idPrefix: 'ig-', hasHost: false, hasDateLabel: false, isNews: false, hasLink: true, noBody: true },
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
  if (meta.hasLink) {
    base.linkUrl = String(r.linkUrl ?? '');
  }
  if (meta.hasEventFlag) {
    base.isEvent = r.isEvent === true;
  }
  if (!meta.noBody) {
    // 글 목록이 있는 게시판만 고정을 다룬다(일정·인스타그램은 목록 개념 자체가 다르다)
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
