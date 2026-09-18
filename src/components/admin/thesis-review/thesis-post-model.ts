// 교직원 공고 양식(ThesisPostForm)의 순수 도우미 — 상태 모양·첫 값·검사·원본 대비 변경 칩.
//
// 입력 계약·검사·포스터 문구는 lib/thesis-submit/notice.ts, 저장 계약은
// lib/thesis-submit/staff-post.ts 가 단일 출처다. 여기는 그 둘을 콘솔 화면에 어떻게 올리고
// 무엇을 '바뀐 칸'으로 볼지만 다룬다. 내부 운영 도구라 한국어 문자열을 직접 둔다.

import type { EditSubmission } from '@/lib/admin/boards';
import {
  NOTICE_LIMITS,
  cleanNotice,
  committeeEntry,
  emptyMember,
  emptyNotice,
  memberEntries,
  postTitle,
  squash,
  validateNotice,
  type NoticeError,
  type NoticeField,
  type ThesisNoticeInput,
} from '@/lib/thesis-submit/notice';
import { STAFF_TITLE_MAX, isHm, isIsoDate } from '@/lib/thesis-submit/staff-post';
import { todayKstDate } from './review-model';

/** new = 글쓰기 · edit = 양식으로 만든 게시된 글 고치기 · submission = 학생 제출(승인 대기) '수정 후 게시' */
export type ThesisFormMode = 'new' | 'edit' | 'submission';

export interface ThesisFormState {
  notice: ThesisNoticeInput;
  /** 게시일 YYYY-MM-DD */
  pubDate: string;
  /** 예약 공개 체크 */
  schedule: boolean;
  /** 예약 공개 시각 HH:MM — schedule 일 때만 보낸다 */
  pubTime: string;
  /** 제목 '직접 수정' */
  manual: boolean;
  manualTitle: string;
}

/** 양식이 읽는 레코드 모양(ApiRecord 의 부분집합) */
export interface ThesisFormRecord {
  id: string;
  date: string;
  time?: string;
  titleKo: string;
  submission?: EditSubmission | null;
}

/** 자동 제목 — 심사일과 성명이 둘 다 있어야 만든다('[] ' 같은 반쪽 제목을 보이지 않게) */
export function autoTitle(n: ThesisNoticeInput): string {
  return n.date && squash(n.presenter) ? postTitle(n) : '';
}

export function shownTitle(s: ThesisFormState): string {
  return s.manual ? s.manualTitle : autoTitle(s.notice);
}

/** 첫 값 — 새 글은 빈 양식·오늘, 고치기는 저장된 입력 원본·게시일 */
export function initialFormState(mode: ThesisFormMode, rec?: ThesisFormRecord | null): ThesisFormState {
  const today = todayKstDate();
  const n = rec?.submission?.notice;
  if (mode === 'new' || !rec || !n) {
    return { notice: emptyNotice(), pubDate: today, schedule: false, pubTime: '', manual: false, manualTitle: '' };
  }
  const notice: ThesisNoticeInput = {
    ...n,
    chair: { ...n.chair },
    members: n.members.length > 0 ? n.members.map((m) => ({ ...m })) : [emptyMember()],
  };
  // 학생 제출의 게시일은 제출일(KST 0시)이라 지났기 마련 — 승인하면 오늘로 올라가므로 오늘로 보여 준다
  const pubDate = mode === 'submission' && (!rec.date || rec.date < today) ? today : rec.date || today;
  // 학생 제출 행의 created_at 시각은 제출 기록일 뿐 공개 예약이 아니다 — 예약은 꺼진 채로 연다
  const pubTime = mode === 'submission' ? '' : (rec.time ?? '');
  const saved = squash(rec.titleKo);
  const manual = saved !== '' && saved !== autoTitle(notice);
  return { notice, pubDate, schedule: pubTime !== '', pubTime, manual, manualTitle: manual ? rec.titleKo : '' };
}

/** 게시(공개) 시각 ms — 예약을 켜지 않았으면 게시일 0시 */
export function publishAtMs(s: ThesisFormState): number {
  if (!isIsoDate(s.pubDate)) return NaN;
  const t = s.schedule && isHm(s.pubTime) ? s.pubTime : '00:00';
  return Date.parse(`${s.pubDate}T${t}:00+09:00`);
}

// ── 검사 ─────────────────────────────────────────────────────────────────

/** 양식 칸 키 — notice 의 칸(NoticeField) + 게시 설정 칸 */
export type FormField = NoticeField | 'postTitle' | 'pubDate' | 'pubTime';

export interface FormError {
  field: FormField;
  /** 오류 요약의 칸 이름 */
  label: string;
  message: string;
}

/** 관리자는 지난 심사일도 적는다(구 공고 옮겨 적기) — 서버와 같은 '과거 검사 끔' */
const NO_PAST_CHECK = '0000-00-00';

function limitOf(field: NoticeField): number {
  if (field === 'presenter') return NOTICE_LIMITS.presenter;
  if (field === 'title') return NOTICE_LIMITS.title;
  if (field === 'place') return NOTICE_LIMITS.place;
  if (field.endsWith('.affiliation')) return NOTICE_LIMITS.affiliation;
  return NOTICE_LIMITS.memberName;
}

export function fieldLabel(field: FormField): string {
  const m = /^members\.(\d+)\.(name|affiliation)$/.exec(field);
  if (m) return `심사위원 ${Number(m[1]) + 1} ${m[2] === 'name' ? '성명' : '소속'}`;
  const labels: Record<string, string> = {
    postTitle: '게시 제목',
    program: '과정',
    presenter: '발표자 성명',
    title: '논문 제목',
    'chair.name': '심사위원장 성명',
    'chair.affiliation': '심사위원장 소속',
    members: '심사위원',
    date: '심사일',
    time: '시각',
    place: '장소',
    pubDate: '게시일',
    pubTime: '공개 시각',
  };
  return labels[field] ?? field;
}

export function noticeMessage(e: NoticeError): string {
  switch (e.code) {
    case 'required':
      if (e.field === 'program') return '과정을 선택해 주세요.';
      if (e.field === 'presenter') return '발표자 성명을 입력해 주세요.';
      if (e.field === 'title') return '논문 제목을 입력해 주세요.';
      if (e.field === 'chair.name') return '심사위원장 성함을 입력해 주세요.';
      if (e.field === 'date') return '심사일을 선택해 주세요. 제목의 [YYMMDD]가 이 날짜로 만들어집니다.';
      if (e.field === 'time') return '시각을 입력해 주세요.';
      if (e.field === 'place') return '장소를 입력해 주세요.';
      return '성함을 입력해 주세요.';
    case 'tooLong':
      return `${limitOf(e.field)}자 이내로 입력해 주세요.`;
    case 'tooFew':
      return '심사위원을 한 명 이상 입력해 주세요.';
    case 'tooMany':
      return `심사위원은 ${NOTICE_LIMITS.maxMembers}명까지 입력할 수 있습니다.`;
    default:
      return '형식이 올바르지 않습니다.';
  }
}

function toFormError(e: NoticeError): FormError {
  return { field: e.field, label: fieldLabel(e.field), message: noticeMessage(e) };
}

/** 화면 순서(제목 → 입력 칸 → 게시 설정)의 전체 오류. 심사위원 줄 번호는 화면 줄 기준 */
export function formErrors(s: ThesisFormState): FormError[] {
  const out: FormError[] = [];
  if (s.manual) {
    const t = squash(s.manualTitle);
    if (!t) out.push({ field: 'postTitle', label: fieldLabel('postTitle'), message: '제목을 입력해 주세요.' });
    else if (t.length > STAFF_TITLE_MAX) {
      out.push({ field: 'postTitle', label: fieldLabel('postTitle'), message: `${STAFF_TITLE_MAX}자 이내로 입력해 주세요.` });
    }
  }
  out.push(...validateNotice(s.notice, NO_PAST_CHECK).map(toFormError));
  if (!s.pubDate) out.push({ field: 'pubDate', label: fieldLabel('pubDate'), message: '게시일을 선택해 주세요.' });
  else if (!isIsoDate(s.pubDate)) {
    out.push({ field: 'pubDate', label: fieldLabel('pubDate'), message: '형식이 올바르지 않습니다.' });
  }
  if (s.schedule && !isHm(s.pubTime)) {
    out.push({
      field: 'pubTime',
      label: fieldLabel('pubTime'),
      message: s.pubTime ? '형식이 올바르지 않습니다.' : '공개 시각을 입력해 주세요.',
    });
  }
  return out;
}

/**
 * 서버 오류 키(cleanNotice 뒤 — 빈 줄을 뺀 위원 번호)를 화면 줄 번호로 되돌린다.
 * 빈 줄 판정은 cleanNotice 와 같다(성명·소속 둘 다 비면 빈 줄).
 */
export function remapServerErrors(errs: NoticeError[], input: ThesisNoticeInput): FormError[] {
  const rows = input.members
    .map((m, i) => (squash(m.name) || squash(m.affiliation) ? i : -1))
    .filter((i) => i >= 0);
  return errs.map((e) => {
    const m = /^members\.(\d+)\.(name|affiliation)$/.exec(e.field);
    const row = m ? rows[Number(m[1])] : undefined;
    const field = m && row !== undefined ? (`members.${row}.${m[2]}` as NoticeField) : e.field;
    return toFormError({ ...e, field });
  });
}

// ── 원본 대비 바뀐 칸 ────────────────────────────────────────────────────

export interface FieldChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

/** 비교·표시용 값 — 공백 정리·빈 위원 줄 제거 뒤의 값이라 스페이스 하나로는 '바뀜'이 아니다 */
function snapshot(s: ThesisFormState): [string, string, string][] {
  const n = cleanNotice(s.notice);
  const members = memberEntries(n);
  return [
    ['program', '과정', n.program],
    ['presenter', '발표자', n.presenter],
    ['title', '논문 제목', n.title],
    ['welcome', '환영 문구', n.welcome ? '넣음' : '뺌'],
    ['chair', '심사위원장', n.chair.name ? committeeEntry(n.chair) : ''],
    ['members', '심사위원', members.join(', ')],
    ['date', '심사일', n.date],
    ['time', '시각', n.time],
    ['place', '장소', n.place],
    ['pubDate', '게시일', s.pubDate],
    ['publish', '예약 공개', s.schedule ? s.pubTime || '켬' : '끔'],
    ['postTitle', '게시 제목', squash(shownTitle(s))],
  ];
}

/** 칩에 싣는 짧은 값 — 14자를 넘으면 자른다(디자인 규칙) */
export function clipValue(v: string, max = 14): string {
  if (!v) return '—';
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

export function formChanges(base: ThesisFormState, cur: ThesisFormState): FieldChange[] {
  const a = snapshot(base);
  const b = snapshot(cur);
  const out: FieldChange[] = [];
  a.forEach(([key, label, before], i) => {
    const after = b[i][2];
    if (before !== after) out.push({ key, label, before, after });
  });
  return out;
}
