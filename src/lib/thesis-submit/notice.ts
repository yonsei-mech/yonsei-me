/**
 * 박사·통합과정 학위논문 **예비심사** 공고 — 입력 계약·검사·포스터 문구(클라이언트·서버 공용).
 *
 * 학생은 칸만 채운다. 포스터(학과 양식 "박사학위예비심사 안내 포스터")는 이 입력으로 자동으로
 * 그려지고(poster-canvas.ts), 제출하면 그 이미지 한 장이 게시물 본문이 된다 — 기존 게시판
 * 관례(제목 `[YYMMDD] 성명`, 본문은 공고 이미지)와 같은 모양이다.
 *
 * 학과 요청(2026-09-18): 이 메뉴는 박사과정·통합과정 예비심사 전용이다(머리글 고정).
 * 심사위원은 검색해 불러오지 않고 학생이 직접 입력한다(외부 위원·호칭이 섞이므로).
 *
 * ⚠️ 클라이언트 컴포넌트도 import 한다 — node 전용 모듈을 들이지 마라.
 */

export const HONORIFICS = ['교수님', '박사님'] as const;
export type Honorific = (typeof HONORIFICS)[number];

/** 과정 — 학과 확인용(포스터 머리글은 두 과정 모두 '박사학위예비심사'라 포스터에는 안 들어간다) */
export const PROGRAMS = ['박사과정', '통합과정'] as const;
export type Program = (typeof PROGRAMS)[number];

export interface CommitteeMember {
  name: string;
  honorific: Honorific;
  /** 학외 위원만 — 비어 있으면 포스터에 소속을 적지 않는다 */
  affiliation: string;
}

export interface ThesisNoticeInput {
  /** 과정(필수) — 입력 전에는 빈 문자열 */
  program: Program | '';
  /** 포스터 머리글에 '(관심있는 연구자 누구나 환영)'을 붙이는가 — 양식 기본값 true */
  welcome: boolean;
  /** 발표자 성명 */
  presenter: string;
  /** 논문 제목 — 포스터에 입력한 그대로(국문·영문 무관) */
  title: string;
  /** 심사위원장 */
  chair: CommitteeMember;
  /** 심사위원(위원장 제외). 입력 중에는 빈 줄이 섞일 수 있다 — cleanNotice 가 뺀다 */
  members: CommitteeMember[];
  /** 심사일 YYYY-MM-DD */
  date: string;
  /** 시각 HH:MM (24시간) */
  time: string;
  place: string;
}

export const NOTICE_LIMITS = {
  presenter: 30,
  title: 250,
  memberName: 20,
  affiliation: 30,
  place: 60,
  minMembers: 1,
  maxMembers: 6,
} as const;

/** 입력 화면이 처음 보여 줄 심사위원 줄 수(위원장 제외) — 박사 심사위원회 5인 기준 */
export const DEFAULT_MEMBER_ROWS = 4;

/** 포스터 머리글 — 학과 양식 문구. 뒤쪽 환영 문구만 학생이 끄고 켤 수 있다(posterHeading) */
export const POSTER_HEADING_BASE = '박사학위예비심사 공지';
export const POSTER_WELCOME = '(관심있는 연구자 누구나 환영)';
/** 환영 문구까지 붙은 전체 머리글(글꼴 조각 미리 받기 등 "가장 긴 경우"용) */
export const POSTER_HEADING = `${POSTER_HEADING_BASE} ${POSTER_WELCOME}`;

/** 이 입력의 포스터 머리글 */
export function posterHeading(input: Pick<ThesisNoticeInput, 'welcome'>): string {
  return input.welcome === false ? POSTER_HEADING_BASE : POSTER_HEADING;
}
export const CHAIR_LABEL = '심사위원장 : ';
export const MEMBERS_LABEL = '심사위원 : ';
export const WHEN_LABEL = '일시 : ';
export const PLACE_LABEL = '장소 : ';

/**
 * 포스터 좌표계 — 학과 양식을 한글에서 내보낸 기존 게시 이미지(1403×992, A4 가로)와 같다.
 * 렌더러는 이 좌표로 그리고 배율만 바꾼다. 내보내기는 1.5배(2105×1488, 약 180dpi) —
 * 양식 속 로고 비트맵(엠블럼 197px·학부 로고 580px)이 거의 늘어나지 않는 상한이다.
 */
export const POSTER_REF = { width: 1403, height: 992 } as const;
export const POSTER_EXPORT_SCALE = 1.5;
export const POSTER_EXPORT_SIZE = {
  width: Math.round(POSTER_REF.width * POSTER_EXPORT_SCALE),
  height: Math.round(POSTER_REF.height * POSTER_EXPORT_SCALE),
} as const;

export function emptyMember(): CommitteeMember {
  return { name: '', honorific: '교수님', affiliation: '' };
}

export function emptyNotice(): ThesisNoticeInput {
  return {
    program: '',
    welcome: true,
    presenter: '',
    title: '',
    chair: emptyMember(),
    members: Array.from({ length: DEFAULT_MEMBER_ROWS }, emptyMember),
    date: '',
    time: '',
    place: '',
  };
}

// ── 정규화 ────────────────────────────────────────────────────────────────

/** 앞뒤 공백 제거 + 연속 공백·개행을 공백 하나로 */
export function squash(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function isBlankMember(m: CommitteeMember): boolean {
  return !squash(m.name) && !squash(m.affiliation);
}

function cleanMember(m: CommitteeMember): CommitteeMember {
  return {
    name: squash(m.name),
    honorific: HONORIFICS.includes(m.honorific) ? m.honorific : '교수님',
    affiliation: squash(m.affiliation),
  };
}

/** 제출·내보내기 직전 형태 — 공백 정리 + 빈 심사위원 줄 제거 */
export function cleanNotice(input: ThesisNoticeInput): ThesisNoticeInput {
  return {
    program: PROGRAMS.includes(input.program as Program) ? input.program : '',
    welcome: input.welcome !== false,
    presenter: squash(input.presenter),
    title: squash(input.title),
    chair: cleanMember(input.chair),
    members: input.members.filter((m) => !isBlankMember(m)).map(cleanMember),
    date: input.date.trim(),
    time: input.time.trim(),
    place: squash(input.place),
  };
}

/** 서버 — 요청 본문(JSON)을 형태만 확인해 입력으로 바꾼다. 형태가 틀리면 null */
export function parseNotice(raw: unknown): ThesisNoticeInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const member = (v: unknown): CommitteeMember | null => {
    if (!v || typeof v !== 'object') return null;
    const m = v as Record<string, unknown>;
    const name = str(m.name);
    const affiliation = str(m.affiliation) ?? '';
    const honorific = str(m.honorific);
    if (name === null || !HONORIFICS.includes(honorific as Honorific)) return null;
    return { name, affiliation, honorific: honorific as Honorific };
  };
  const chair = member(r.chair);
  if (!chair || !Array.isArray(r.members) || r.members.length > 20) return null;
  const members = r.members.map(member);
  if (members.some((m) => m === null)) return null;
  const fields = ['presenter', 'title', 'date', 'time', 'place'] as const;
  const vals = fields.map((k) => str(r[k]));
  if (vals.some((v) => v === null)) return null;
  const [presenter, title, date, time, place] = vals as string[];
  // 과정·환영 문구 칸이 생기기 전의 초안(sessionStorage)도 읽히도록 없으면 기본값
  const program = r.program === undefined ? '' : str(r.program);
  if (program === null || (program !== '' && !PROGRAMS.includes(program as Program))) return null;
  if (r.welcome !== undefined && typeof r.welcome !== 'boolean') return null;
  const welcome = r.welcome !== false;
  return {
    program: program as Program | '',
    welcome,
    presenter,
    title,
    chair,
    members: members as CommitteeMember[],
    date,
    time,
    place,
  };
}

// ── 검사 ─────────────────────────────────────────────────────────────────

/**
 * 오류가 난 칸의 키. 심사위원 줄은 **화면의 줄 번호**(빈 줄 포함) 기준이다 —
 * 클라이언트는 cleanNotice 전의 입력으로 검사해 오류를 해당 줄 바로 아래에 붙인다.
 * 서버는 cleanNotice 뒤의 입력으로 한 번 더 검사한다(안전망 — 화면에 쓰지 않는다).
 */
export type NoticeField =
  | 'program'
  | 'presenter'
  | 'title'
  | 'chair.name'
  | 'chair.affiliation'
  | 'members'
  | `members.${number}.name`
  | `members.${number}.affiliation`
  | 'date'
  | 'time'
  | 'place';

export type NoticeErrorCode = 'required' | 'tooLong' | 'format' | 'past' | 'tooFew' | 'tooMany';

export interface NoticeError {
  field: NoticeField;
  code: NoticeErrorCode;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 오늘(KST) YYYY-MM-DD — 서버·클라이언트가 같은 값을 낸다 */
export function todayKst(now = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isRealDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
}

export function validateNotice(input: ThesisNoticeInput, today = todayKst()): NoticeError[] {
  const errs: NoticeError[] = [];
  const need = (field: NoticeField, value: string, max: number) => {
    const v = squash(value);
    if (!v) errs.push({ field, code: 'required' });
    else if (v.length > max) errs.push({ field, code: 'tooLong' });
  };
  const optional = (field: NoticeField, value: string, max: number) => {
    if (squash(value).length > max) errs.push({ field, code: 'tooLong' });
  };

  if (!PROGRAMS.includes(input.program as Program)) errs.push({ field: 'program', code: 'required' });
  need('presenter', input.presenter, NOTICE_LIMITS.presenter);
  need('title', input.title, NOTICE_LIMITS.title);
  need('chair.name', input.chair.name, NOTICE_LIMITS.memberName);
  optional('chair.affiliation', input.chair.affiliation, NOTICE_LIMITS.affiliation);

  let filled = 0;
  input.members.forEach((m, i) => {
    if (isBlankMember(m)) return;
    filled += 1;
    need(`members.${i}.name`, m.name, NOTICE_LIMITS.memberName);
    optional(`members.${i}.affiliation`, m.affiliation, NOTICE_LIMITS.affiliation);
  });
  if (filled < NOTICE_LIMITS.minMembers) errs.push({ field: 'members', code: 'tooFew' });
  else if (filled > NOTICE_LIMITS.maxMembers) errs.push({ field: 'members', code: 'tooMany' });

  const date = input.date.trim();
  if (!date) errs.push({ field: 'date', code: 'required' });
  else if (!isRealDate(date)) errs.push({ field: 'date', code: 'format' });
  else if (date < today) errs.push({ field: 'date', code: 'past' });

  const time = input.time.trim();
  if (!time) errs.push({ field: 'time', code: 'required' });
  else if (!TIME_RE.test(time)) errs.push({ field: 'time', code: 'format' });

  need('place', input.place, NOTICE_LIMITS.place);
  return errs;
}

// ── 포스터·게시물 문구 ──────────────────────────────────────────────────────

const HANGUL_ONLY_RE = /^[가-힣]+$/;

/** 포스터의 이름 표기 — 공백 없는 한글 이름만 글자 사이를 띄운다('서보경' → '서 보 경') */
export function spacedName(name: string): string {
  const n = squash(name);
  return HANGUL_ONLY_RE.test(n) ? n.split('').join(' ') : n;
}

/** '박정열 교수님 (서강대)' — 소속은 학외 위원만 */
export function committeeEntry(m: CommitteeMember): string {
  const base = `${squash(m.name)} ${m.honorific}`;
  const aff = squash(m.affiliation);
  return aff ? `${base} (${aff})` : base;
}

/** 위원장 제외 위원 목록 — 빈 줄은 건너뛴다 */
export function memberEntries(input: ThesisNoticeInput): string[] {
  return input.members.filter((m) => squash(m.name)).map(committeeEntry);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 학과 양식의 일시 표기 — '04월 24일(금요일) 오후 1시 00분'.
 * 요일은 날짜 문자열에서 UTC 로 계산한다(브라우저 시간대와 무관).
 */
export function formatWhen(date: string, time: string): string {
  if (!isRealDate(date)) return '';
  const [y, m, d] = date.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  let out = `${pad2(m)}월 ${pad2(d)}일(${wd}요일)`;
  if (TIME_RE.test(time)) {
    const [h, min] = time.split(':').map(Number);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    out += ` ${h < 12 ? '오전' : '오후'} ${h12}시 ${pad2(min)}분`;
  }
  return out;
}

/** 게시물 제목 — 게시판 관례 `[YYMMDD] 성명` */
export function postTitle(input: ThesisNoticeInput): string {
  const ymd = input.date.replace(/-/g, '').slice(2);
  return `[${ymd}] ${squash(input.presenter)}`;
}

/** 포스터 이미지의 대체 텍스트 — 이미지에 든 글을 빠짐없이 옮긴다(WCAG 1.1.1) */
export function posterAlt(input: ThesisNoticeInput): string {
  const c = cleanNotice(input);
  return [
    posterHeading(c),
    `논문: ${c.title}`,
    `발표: ${c.presenter}`,
    `${CHAIR_LABEL}${committeeEntry(c.chair)}`,
    `${MEMBERS_LABEL}${memberEntries(c).join(', ')}`,
    `${WHEN_LABEL}${formatWhen(c.date, c.time)}`,
    `${PLACE_LABEL}${c.place}`,
  ].join(' / ');
}

/** 내려받기 파일 이름 — '예비심사공고_260424_서보경.png' */
export function posterFileName(input: ThesisNoticeInput): string {
  const ymd = input.date.replace(/-/g, '').slice(2) || '000000';
  const who = squash(input.presenter).replace(/[\\/:*?"<>|\s]+/g, '') || 'poster';
  return `예비심사공고_${ymd}_${who}.png`;
}

/**
 * posts.thesis_submission(jsonb) 에 남기는 제출 기록 — 누가·언제·무엇을.
 * 게시 여부는 posts.published 가 단일 출처다(false = 학과 확인 대기).
 */
export interface ThesisSubmissionMeta {
  email: string;
  submittedAt: string; // ISO
  notice: ThesisNoticeInput;
}
