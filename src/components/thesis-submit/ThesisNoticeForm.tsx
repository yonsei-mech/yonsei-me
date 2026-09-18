'use client';

/**
 * 학위논문심사 › 예비심사 공고 등록 › 공고 내용 입력 (본인 확인 다음 화면).
 *
 * 학생은 칸만 채운다 — 발표자·논문 제목·심사위원(직접 입력)·일시·장소. 오른쪽 미리보기는
 * 학과 양식 포스터를 입력마다 다시 그리고(poster-canvas.ts 의 renderPoster), 제출하면 같은
 * 렌더러가 만든 PNG(posterPngBlob, 2105×1488)가 게시물 본문이 된다. 파일 업로드·지도교수
 * 검색·과정 선택은 없다(학과 요청 2026-09-18 — 박사·통합과정 예비심사 전용).
 * 입력 계약·검사·문구의 단일 출처는 src/lib/thesis-submit/notice.ts 다.
 *
 * 시각 언어는 화면 B(ThesisVerifyFlow)의 입력·라벨·힌트·오류 박스·주 버튼을 그대로 쓴다.
 *
 * 배치: lg 이상 2열(폼 5fr · 미리보기 7fr, 미리보기는 sticky), lg 미만 1열(폼 → 미리보기 →
 * 제출 버튼). 한 그리드에 세 덩어리를 두고 lg 에서만 자리를 옮긴다 — DOM 순서가 곧 모바일
 * 순서이고, 데스크톱 초점 순서도 "입력 → 미리보기 확인 → 제출"로 의미가 이어진다.
 *
 * 검사: 첫 제출(또는 내려받기) 시도 전에는 조용하고, 그 뒤로는 입력마다 다시 검사한다.
 * 오류는 그 칸 바로 아래(aria-invalid + aria-describedby), 제출 시 첫 오류 칸으로 초점.
 * 심사위원 오류 키는 **화면 줄 번호** 기준(notice.ts NoticeField 주석) — 서버가 돌려준 키는
 * cleanNotice 뒤(빈 줄 제거) 기준이라 remapServerErrors 가 화면 줄로 되돌린다.
 *
 * 초안: 입력값을 sessionStorage(DRAFT_STORAGE_KEY)에 둔다 — 세션(60분)이 끝나 본인 확인을
 * 다시 해도 내용이 남는다. 제출에 성공하면 지운다.
 *
 * Enter 로 제출되지 않게 막는다 — 한 번 내면 학과로 가는 제출이라, 이름 칸에서 한글 조합을
 * 끝내려고 누른 Enter(사파리는 compositionend 뒤에 keydown 이 온다)가 제출이 되면 안 된다.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { ErrorBox } from '@/components/auth/ErrorBox';
import { sectionTabHref } from '@/lib/board-links';
import { cn } from '@/lib/utils';
import {
  DRAFT_STORAGE_KEY,
  NOTICE_SUBMIT_API,
  NOTICE_SUBMIT_HEADER,
  type NoticeSubmitResponse,
} from '@/lib/thesis-submit/config';
import {
  HONORIFICS,
  NOTICE_LIMITS,
  POSTER_REF,
  PROGRAMS,
  cleanNotice,
  emptyMember,
  emptyNotice,
  parseNotice,
  postTitle,
  posterAlt,
  posterFileName,
  squash,
  todayKst,
  validateNotice,
  type CommitteeMember,
  type Honorific,
  type NoticeError,
  type NoticeField,
  type Program,
  type ThesisNoticeInput,
} from '@/lib/thesis-submit/notice';
import { posterPngBlob, renderPoster } from '@/lib/thesis-submit/poster-canvas';
import { CheckIcon } from './ThesisSubmitGuide';

/** 화면 문구 — 서버 페이지가 messages(thesisSubmit.notice)에서 읽어 내려 준다.
 *  {n}·{row}·{field}·{max}·{path} 자리표시자가 있는 값은 원문 그대로 오고 여기서 채운다. */
export interface NoticeFormLabels {
  /** 범위 안내 — 굵은 글자가 섞인 리치 텍스트 */
  scope: ReactNode;
  verifiedAs: string;
  sectionPresenter: string;
  programLabel: string;
  /** 과정 선택지의 표시 문구 — 값은 언제나 한국어 PROGRAMS */
  programs: Record<Program, string>;
  presenterLabel: string;
  titleLabel: string;
  titleHint: string;
  /** 포스터 머리글의 '(관심있는 연구자 누구나 환영)' 표시 체크박스 */
  welcomeLabel: string;
  sectionCommittee: string;
  committeeHint: string;
  chairLabel: string;
  /** {n} */
  memberLabel: string;
  /** {row} {field} — 줄 입력칸의 접근 가능한 이름("심사위원 2 성명") */
  rowFieldAria: string;
  nameLabel: string;
  honorificLabel: string;
  affiliationLabel: string;
  namePlaceholder: string;
  affiliationPlaceholder: string;
  /** 호칭 선택지의 표시 문구 — 값(포스터에 들어가는 글)은 언제나 한국어 HONORIFICS */
  honorifics: Record<Honorific, string>;
  removeMember: string;
  /** {row} */
  removeMemberAria: string;
  addMember: string;
  sectionWhen: string;
  dateLabel: string;
  timeLabel: string;
  placeLabel: string;
  placePlaceholder: string;
  previewTitle: string;
  postTitleLabel: string;
  previewCaption: string;
  download: string;
  downloading: string;
  downloadFailed: string;
  submit: string;
  submitting: string;
  submitNote: string;
  errors: {
    programRequired: string;
    presenterRequired: string;
    titleRequired: string;
    chairRequired: string;
    memberNameRequired: string;
    membersTooFew: string;
    /** {max} */
    membersTooMany: string;
    /** {max} */
    tooLong: string;
    dateRequired: string;
    datePast: string;
    timeRequired: string;
    placeRequired: string;
    format: string;
  };
  sessionTitle: string;
  sessionDetail: string;
  sessionLink: string;
  rate: string;
  failedTitle: string;
  tryLater: string;
  networkDetail: string;
  doneTitle: string;
  doneDesc: string;
  doneList: string;
  /** {no} — 접수번호 한 줄 */
  doneReceipt: string;
  /** {path} */
  devSaved: string;
}

// ── 공용 클래스 (화면 B 와 같은 값) ─────────────────────────────────────────
const MAIN_BTN =
  'flex h-[52px] w-full items-center justify-center gap-2 rounded-[2px] bg-brand text-base font-semibold text-brand-fg transition-colors duration-200 ease-out-expo';
const OUTLINE_BTN =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[2px] border border-yonsei-blue bg-surface px-4 text-[15px] font-semibold text-yonsei-blue transition-colors duration-200 ease-out-expo hover:bg-yonsei-blue/[0.06] dark:border-brand dark:text-brand dark:hover:bg-brand/10';
const ACCENT_TEXT = 'text-yonsei-blue dark:text-brand';
const LABEL = 'text-sm font-semibold leading-5 text-content';
const HINT = 'text-[13px] leading-[1.6] text-content-faint';
const SUBHEAD = 'font-subhead text-lg font-semibold leading-[1.4] tracking-[-0.01em] text-content';
const FIELD_BASE =
  'w-full rounded-[2px] border bg-surface text-base text-content outline-none transition-colors placeholder:text-[#A8B0BA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue dark:placeholder:text-[#5E6C84] dark:focus-visible:outline-brand';
const INPUT = cn(FIELD_BASE, 'h-[50px] px-3.5');
/** 날짜·시각·선택 — 다크 모드에서 브라우저 기본 선택기도 어둡게 */
const NATIVE_DARK = 'dark:[color-scheme:dark]';

function borderOf(invalid: boolean): string {
  return invalid ? 'border-[#B42318] dark:border-[#F2837B]' : 'border-surface-border';
}

/** "{max}자" 같은 자리표시자 채우기 — ICU 가 필요 없는 단순 치환 */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

// ── sessionStorage 초안 (사파리 프라이빗 등에서 접근 자체가 throw 할 수 있다) ──
function readDraft(): ThesisNoticeInput | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    // 모양 검사는 서버와 같은 parseNotice — 깨진 값·구 형식은 없는 것으로 친다
    const d = parseNotice(JSON.parse(raw));
    if (!d || d.members.length > NOTICE_LIMITS.maxMembers) return null;
    return d.members.length > 0 ? d : { ...d, members: [emptyMember()] };
  } catch {
    return null;
  }
}
function writeDraft(input: ThesisNoticeInput) {
  try {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(input));
  } catch {
    /* 저장 불가 환경 — 복원만 포기한다 */
  }
}
function clearDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    /* 무시 */
  }
}

/** 칸 키 → DOM id 조각 ('members.2.name' → 'members-2-name') */
function slot(field: string): string {
  return field.replace(/\./g, '-');
}

/** 오류 칸의 길이 상한 — tooLong 문구의 {max} */
function limitOf(field: NoticeField): number {
  if (field === 'presenter') return NOTICE_LIMITS.presenter;
  if (field === 'title') return NOTICE_LIMITS.title;
  if (field === 'place') return NOTICE_LIMITS.place;
  if (field.endsWith('.affiliation')) return NOTICE_LIMITS.affiliation;
  return NOTICE_LIMITS.memberName;
}

/**
 * 서버 오류 키(cleanNotice 뒤 — 빈 줄을 뺀 위원 번호)를 화면 줄 번호로 되돌린다.
 * 빈 줄 판정은 cleanNotice 와 같다(성명·소속 둘 다 비면 빈 줄).
 */
function remapServerErrors(errs: NoticeError[], input: ThesisNoticeInput): NoticeError[] {
  const rows = input.members
    .map((m, i) => (squash(m.name) || squash(m.affiliation) ? i : -1))
    .filter((i) => i >= 0);
  return errs.map((e) => {
    const m = /^members\.(\d+)\.(name|affiliation)$/.exec(e.field);
    if (!m) return e;
    const row = rows[Number(m[1])];
    return row === undefined ? e : { ...e, field: `members.${row}.${m[2]}` as NoticeField };
  });
}

/** Blob 을 파일로 저장 — 임시 링크 클릭 */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 버튼 아래(입력과 무관한) 오류 */
type ActionError = { kind: 'rate' } | { kind: 'failed'; network: boolean };

export function ThesisNoticeForm({
  labels: L,
  verifyHref,
}: {
  labels: NoticeFormLabels;
  /** 본인 확인 화면(로케일 포함 경로) — 세션 만료 안내의 링크 */
  verifyHref: string;
}) {
  const [input, setInput] = useState<ThesisNoticeInput>(emptyNotice);
  /** 첫 제출·내려받기 시도 뒤로는 입력마다 다시 검사한다 */
  const [attempted, setAttempted] = useState(false);
  /** 서버가 돌려준 검사 오류(화면 줄로 되돌린 것) — 입력을 고치면 클라이언트 검사로 넘어간다 */
  const [serverErrors, setServerErrors] = useState<NoticeError[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  /** 제출 완료 — 제출한 입력(내려받기용)·접수번호·dev 저장 경로 */
  const [done, setDone] = useState<{ notice: ThesisNoticeInput; receiptNo?: string; dev?: string } | null>(null);
  /** 오늘(KST) — 날짜 선택기의 min. 서버·클라이언트 렌더가 자정 경계에서 갈리지 않게 마운트 뒤 채운다 */
  const [minDate, setMinDate] = useState<string | undefined>(undefined);
  /** 미리보기 배율 = 캔버스 CSS 폭 × devicePixelRatio / 1403 */
  const [scale, setScale] = useState(0);
  /** 초점 이펙트를 다시 돌리기 위한 렌더 신호(값 자체는 쓰지 않는다) */
  const [, setFocusTick] = useState(0);
  /** 세션 만료 안내로 초점을 다시 옮길 신호 — 이미 떠 있는 안내에 같은 오류가 또 와도 옮긴다 */
  const [sessionTick, setSessionTick] = useState(0);

  const uid = useId();
  const fid = (field: string) => `${uid}-${slot(field)}`;
  const eid = (field: string) => `${uid}-${slot(field)}-err`;
  const titleHintId = `${uid}-title-hint`;
  const committeeHintId = `${uid}-committee-hint`;
  const previewTitleId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionBoxRef = useRef<HTMLDivElement>(null);
  const doneTitleRef = useRef<HTMLHeadingElement>(null);
  /** 다음 렌더 뒤 초점을 옮길 칸 id (줄 추가·삭제 뒤에야 대상 요소가 생긴다) */
  const pendingFocus = useRef<string | null>(null);
  /** 초안 복원이 끝났는가 — 끝나기 전의 빈 입력으로 초안을 덮어쓰지 않는다 */
  const restored = useRef(false);

  // 초안 복원 + 오늘 날짜
  useEffect(() => {
    const d = readDraft();
    if (d) setInput(d);
    restored.current = true;
    setMinDate(todayKst());
  }, []);

  // 초안 저장 — 짧게 모아서
  useEffect(() => {
    if (!restored.current || done) return;
    const h = window.setTimeout(() => writeDraft(input), 400);
    return () => window.clearTimeout(h);
  }, [input, done]);

  // 초점 이동 — 매 렌더 뒤 대기 중인 대상이 있으면 옮긴다(화면 가운데로 — 고정 헤더에 가리지 않게)
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center' });
  });

  // 미리보기 배율 — 캔버스 폭이 바뀔 때마다(창 크기·2열↔1열 전환)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const update = () => {
      const w = c.getBoundingClientRect().width;
      if (w <= 0) return;
      const s = Math.round(((w * (window.devicePixelRatio || 1)) / POSTER_REF.width) * 1000) / 1000;
      setScale((prev) => (prev === s ? prev : s));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(c);
    return () => ro.disconnect();
  }, [done]);

  // 미리보기 그리기 — 입력마다 짧은 디바운스(렌더러가 마지막 호출만 그린다)
  const firstPaint = useRef(true);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || scale <= 0) return;
    const delay = firstPaint.current ? 0 : 150;
    firstPaint.current = false;
    const h = window.setTimeout(() => {
      renderPoster(c, input, scale, { placeholders: true }).catch((err) =>
        console.error('[thesis-submit] 미리보기 렌더 실패', err),
      );
    }, delay);
    return () => window.clearTimeout(h);
  }, [input, scale]);

  // 세션 만료 안내가 뜨면(또 뜨면) 그 박스로 초점 — 폼 위에 있어 제출 버튼에서 멀다
  useEffect(() => {
    if (!sessionExpired) return;
    sessionBoxRef.current?.focus({ preventScroll: true });
    sessionBoxRef.current?.scrollIntoView({ block: 'center' });
  }, [sessionExpired, sessionTick]);

  // 완료 화면으로 바뀌면 그 제목으로 초점
  useEffect(() => {
    if (!done) return;
    doneTitleRef.current?.focus({ preventScroll: true });
    doneTitleRef.current?.scrollIntoView({ block: 'center' });
  }, [done]);

  const clientErrors = useMemo(
    () => (attempted ? validateNotice(input, todayKst()) : []),
    [attempted, input],
  );
  const errors = serverErrors ?? clientErrors;
  const errOf = useMemo(() => {
    const map = new Map<string, NoticeError>();
    for (const e of errors) if (!map.has(e.field)) map.set(e.field, e);
    return (field: string) => map.get(field);
  }, [errors]);

  const E = L.errors;
  function messageOf(e: NoticeError): string {
    switch (e.code) {
      case 'required':
        if (e.field === 'program') return E.programRequired;
        if (e.field === 'presenter') return E.presenterRequired;
        if (e.field === 'title') return E.titleRequired;
        if (e.field === 'chair.name') return E.chairRequired;
        if (e.field === 'date') return E.dateRequired;
        if (e.field === 'time') return E.timeRequired;
        if (e.field === 'place') return E.placeRequired;
        return E.memberNameRequired;
      case 'tooLong':
        return fill(E.tooLong, { max: limitOf(e.field) });
      case 'past':
        return E.datePast;
      case 'tooFew':
        return E.membersTooFew;
      case 'tooMany':
        return fill(E.membersTooMany, { max: NOTICE_LIMITS.maxMembers });
      default:
        return E.format;
    }
  }

  /** 오류 칸의 초점 대상 — 위원 수 오류는 첫 위원 줄 성명 칸 */
  function focusTargetOf(field: NoticeField): string {
    return field === 'members' ? fid('members.0.name') : fid(field);
  }

  const update = useCallback((fn: (prev: ThesisNoticeInput) => ThesisNoticeInput) => {
    setInput(fn);
    setServerErrors(null);
  }, []);

  const setField = (key: 'presenter' | 'title' | 'date' | 'time' | 'place', value: string) =>
    update((p) => ({ ...p, [key]: value }));
  const setChair = (patch: Partial<CommitteeMember>) =>
    update((p) => ({ ...p, chair: { ...p.chair, ...patch } }));
  const setMember = (i: number, patch: Partial<CommitteeMember>) =>
    update((p) => ({ ...p, members: p.members.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));

  function addMember() {
    if (input.members.length >= NOTICE_LIMITS.maxMembers) return;
    const next = input.members.length;
    update((p) => ({ ...p, members: [...p.members, emptyMember()] }));
    pendingFocus.current = fid(`members.${next}.name`);
  }

  function removeMember(i: number) {
    if (input.members.length <= 1) return;
    update((p) => ({ ...p, members: p.members.filter((_, j) => j !== i) }));
    // 지운 자리에 올라온 줄(없으면 바로 윗줄)의 성명 칸으로 — 초점이 문서 처음으로 튕기지 않게
    pendingFocus.current = fid(`members.${Math.min(i, input.members.length - 2)}.name`);
  }

  /** 제출·내려받기 전 검사 — 오류가 있으면 첫 칸으로 초점을 옮기고 false */
  function checkOrFocus(): boolean {
    setAttempted(true);
    setServerErrors(null);
    const errs = validateNotice(input, todayKst());
    if (errs.length === 0) return true;
    pendingFocus.current = focusTargetOf(errs[0].field);
    // 오류 목록이 그대로여도(같은 오류로 다시 누름) 초점 이펙트가 돌도록 렌더를 한 번 일으킨다
    setFocusTick((t) => t + 1);
    return false;
  }

  async function onDownload(source: ThesisNoticeInput | null) {
    if (downloading) return;
    setDownloadError(false);
    if (!source && !checkOrFocus()) return;
    const notice = source ?? cleanNotice(input);
    setDownloading(true);
    try {
      saveBlob(await posterPngBlob(notice), posterFileName(notice));
    } catch (err) {
      console.error('[thesis-submit] 포스터 내보내기 실패', err);
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }

  async function onSubmit() {
    if (submitting) return;
    setActionError(null);
    setSessionExpired(false);
    if (!checkOrFocus()) return;

    setSubmitting(true);
    const notice = cleanNotice(input);
    let data: NoticeSubmitResponse | null = null;
    let status = 0;
    try {
      const poster = await posterPngBlob(notice);
      const body = new FormData();
      body.append('data', JSON.stringify(notice));
      body.append('poster', poster, 'poster.png');
      const res = await fetch(NOTICE_SUBMIT_API, {
        method: 'POST',
        headers: { [NOTICE_SUBMIT_HEADER]: '1' },
        body,
      });
      status = res.status;
      data = (await res.json().catch(() => null)) as NoticeSubmitResponse | null;
    } catch (err) {
      console.error('[thesis-submit] 제출 실패', err);
      setSubmitting(false);
      // 포스터를 못 만든 경우(status 0, fetch 전)도 네트워크와 같은 "다시 시도" 안내다
      setActionError({ kind: 'failed', network: status === 0 && navigator.onLine === false });
      return;
    }
    setSubmitting(false);

    if (data?.ok) {
      clearDraft();
      setDone({ notice, receiptNo: data.receiptNo, dev: data.dev });
      return;
    }
    if (data && !data.ok) {
      if (data.reason === 'session') {
        // 초안은 이미 sessionStorage 에 있다 — 다시 확인하고 돌아오면 그대로 복원된다
        writeDraft(input);
        pendingFocus.current = null;
        setSessionExpired(true);
        setSessionTick((t) => t + 1);
        return;
      }
      if (data.reason === 'rate') {
        setActionError({ kind: 'rate' });
        return;
      }
      if (data.reason === 'invalid' && data.errors && data.errors.length > 0) {
        const mapped = remapServerErrors(data.errors, input);
        setServerErrors(mapped);
        pendingFocus.current = focusTargetOf(mapped[0].field);
        return;
      }
    }
    setActionError({ kind: 'failed', network: false });
  }

  // ── 완료 ────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="rounded-card border border-surface-border bg-surface-soft px-6 py-12 text-center lg:px-10 lg:py-16">
        <span
          aria-hidden="true"
          className={cn(
            'mx-auto grid h-12 w-12 place-items-center rounded-[2px] border border-yonsei-blue bg-surface dark:border-brand',
            ACCENT_TEXT,
          )}
        >
          <CheckIcon className="h-6 w-6" />
        </span>
        <h2
          ref={doneTitleRef}
          tabIndex={-1}
          className="mt-5 font-subhead text-2xl font-bold leading-[1.3] tracking-[-0.01em] text-content outline-none lg:text-[28px]"
        >
          {L.doneTitle}
        </h2>
        <p className="mx-auto mt-3 max-w-[560px] text-base leading-[1.7] text-content-faint">{L.doneDesc}</p>
        {done.receiptNo && (
          <p className="mt-3 text-[15px] font-semibold tracking-[0.02em] text-content">
            {fill(L.doneReceipt, { no: done.receiptNo })}
          </p>
        )}
        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void onDownload(done.notice)}
            aria-disabled={downloading || undefined}
            aria-busy={downloading || undefined}
            className={cn(OUTLINE_BTN, 'h-[52px] px-6', downloading && 'cursor-not-allowed opacity-60')}
          >
            <DownloadIcon />
            {downloading ? L.downloading : L.download}
          </button>
          <Link
            href={sectionTabHref('graduate', 'thesis')}
            className="inline-flex h-[52px] items-center justify-center rounded-[2px] bg-brand px-6 text-base font-semibold text-brand-fg transition-colors duration-200 ease-out-expo hover:bg-brand-muted"
          >
            {L.doneList}
          </Link>
        </div>
        {downloadError && (
          <div className="mx-auto mt-4 max-w-[480px] text-left">
            <ErrorBox>{L.downloadFailed}</ErrorBox>
          </div>
        )}
        {done.dev && (
          <p className="mt-6 break-all text-[12px] font-semibold text-content-faint">
            {fill(L.devSaved, { path: done.dev })}
          </p>
        )}
      </div>
    );
  }

  // ── 입력 ────────────────────────────────────────────────────────────────
  const showPostTitle = Boolean(input.date && squash(input.presenter));
  const membersErr = errOf('members');

  /** 한 줄 입력칸 + 라벨 + (힌트|오류) */
  function textField(
    field: 'presenter' | 'place',
    label: string,
    opts: { placeholder?: string; autoComplete?: string } = {},
  ) {
    const err = errOf(field);
    return (
      <div className="flex flex-col gap-2.5">
        <label htmlFor={fid(field)} className={LABEL}>
          {label}
        </label>
        <input
          id={fid(field)}
          type="text"
          value={input[field]}
          placeholder={opts.placeholder}
          autoComplete={opts.autoComplete ?? 'off'}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? eid(field) : undefined}
          onChange={(e) => setField(field, e.target.value)}
          className={cn(INPUT, borderOf(!!err))}
        />
        {err && <ErrorBox id={eid(field)}>{messageOf(err)}</ErrorBox>}
      </div>
    );
  }

  /** 심사위원 한 줄 — 위원장(i = -1)과 위원(i ≥ 0) */
  function committeeRow(i: number) {
    const isChair = i < 0;
    const m = isChair ? input.chair : input.members[i];
    const base = isChair ? 'chair' : `members.${i}`;
    const rowLabel = isChair ? L.chairLabel : fill(L.memberLabel, { n: i + 1 });
    const rowLabelId = `${fid(base)}-label`;
    const nameErr = errOf(`${base}.name`);
    const affErr = errOf(`${base}.affiliation`);
    const patch = (p: Partial<CommitteeMember>) => (isChair ? setChair(p) : setMember(i, p));
    const aria = (field: string) => fill(L.rowFieldAria, { row: rowLabel, field });
    // 위원 수 오류(한 명도 없음·초과)는 첫 위원 줄 성명 칸이 함께 가리킨다
    const nameDescribedBy = [nameErr && eid(`${base}.name`), i === 0 && membersErr && eid('members')]
      .filter(Boolean)
      .join(' ');

    return (
      <div key={base} role="group" aria-labelledby={rowLabelId} className="flex flex-col gap-2">
        <div className="flex min-h-5 items-center justify-between gap-3">
          <span id={rowLabelId} className={LABEL}>
            {rowLabel}
          </span>
          {!isChair && input.members.length > 1 && (
            <button
              type="button"
              onClick={() => removeMember(i)}
              aria-label={fill(L.removeMemberAria, { row: rowLabel })}
              className="-my-3 -mr-1.5 inline-flex min-h-[44px] items-center gap-1 px-1.5 text-[13px] font-semibold text-content-faint transition-colors hover:text-[#B42318] dark:hover:text-[#F2837B] lg:-my-1.5 lg:min-h-8"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0"
              >
                <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
              </svg>
              {L.removeMember}
            </button>
          )}
        </div>
        {/* 호칭 칸은 가장 긴 선택지만큼(auto, 최소 7.5rem) — en 표기 '교수님 (Prof.)'가 잘리지 않게.
            좁은 칸(모바일·lg 2열의 폼 열)에서는 [성명][호칭] 한 줄 + [소속] 다음 줄 */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.15fr)] lg:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.15fr)]">
          <input
            id={fid(`${base}.name`)}
            type="text"
            value={m.name}
            placeholder={L.namePlaceholder}
            autoComplete="off"
            aria-label={aria(L.nameLabel)}
            aria-invalid={nameErr ? true : undefined}
            aria-describedby={nameDescribedBy || undefined}
            onChange={(e) => patch({ name: e.target.value })}
            className={cn(INPUT, borderOf(!!nameErr))}
          />
          <div className="relative">
            <select
              id={fid(`${base}.honorific`)}
              value={m.honorific}
              aria-label={aria(L.honorificLabel)}
              onChange={(e) => patch({ honorific: e.target.value as Honorific })}
              className={cn(INPUT, NATIVE_DARK, 'min-w-[7.5rem] appearance-none pr-9', borderOf(false))}
            >
              {HONORIFICS.map((h) => (
                <option key={h} value={h}>
                  {L.honorifics[h]}
                </option>
              ))}
            </select>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint"
            >
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <input
            id={fid(`${base}.affiliation`)}
            type="text"
            value={m.affiliation}
            placeholder={L.affiliationPlaceholder}
            autoComplete="off"
            aria-label={aria(L.affiliationLabel)}
            aria-invalid={affErr ? true : undefined}
            aria-describedby={[affErr && eid(`${base}.affiliation`), committeeHintId].filter(Boolean).join(' ')}
            onChange={(e) => patch({ affiliation: e.target.value })}
            className={cn(
              INPUT,
              borderOf(!!affErr),
              'col-span-2 sm:col-span-1 lg:col-span-2 xl:col-span-1',
            )}
          />
        </div>
        {nameErr && <ErrorBox id={eid(`${base}.name`)}>{messageOf(nameErr)}</ErrorBox>}
        {affErr && <ErrorBox id={eid(`${base}.affiliation`)}>{messageOf(affErr)}</ErrorBox>}
      </div>
    );
  }

  const programErr = errOf('program');
  const titleErr = errOf('title');
  const dateErr = errOf('date');
  const timeErr = errOf('time');

  let actionBox: ReactNode = null;
  if (actionError?.kind === 'rate') actionBox = <ErrorBox>{L.rate}</ErrorBox>;
  else if (actionError?.kind === 'failed') {
    actionBox = (
      <ErrorBox detail={actionError.network ? L.networkDetail : L.tryLater}>{L.failedTitle}</ErrorBox>
    );
  }

  return (
    <div>
      {/* 범위 안내 — 이 메뉴는 박사·통합과정 예비심사 전용(학과 요청) */}
      <div className="flex gap-3 rounded-card border border-surface-border bg-surface-soft px-5 py-4">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className={cn('mt-[3px] h-[18px] w-[18px] shrink-0', ACCENT_TEXT)}
        >
          <circle cx="12" cy="12" r="9.25" />
          <path d="M12 11v5.5M12 7.6v.2" strokeLinecap="round" />
        </svg>
        <p className="text-[15px] leading-[1.7] text-content">{L.scope}</p>
      </div>
      <p className="mt-3 text-[13px] leading-[1.6] text-content-faint">{L.verifiedAs}</p>

      {/* 세션 만료(401) — 폼 위. 초안이 남아 있다는 사실을 함께 말한다 */}
      {sessionExpired && (
        <div ref={sessionBoxRef} tabIndex={-1} className="mt-6 outline-none">
          <ErrorBox
            detail={
              <>
                {L.sessionDetail}{' '}
                <a
                  href={verifyHref}
                  className="whitespace-nowrap font-semibold underline decoration-1 underline-offset-[3px]"
                >
                  {L.sessionLink}
                </a>
              </>
            }
          >
            {L.sessionTitle}
          </ErrorBox>
        </div>
      )}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        onKeyDown={(e) => {
          // 입력칸의 Enter 로는 제출하지 않는다(머리 주석). 한글 조합 중인 Enter 는 건드리지 않는다.
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !e.nativeEvent.isComposing) {
            e.preventDefault();
          }
        }}
        className="mt-10 grid lg:mt-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr] lg:gap-x-16"
      >
        {/* ── 입력 ── */}
        <div className="flex flex-col lg:col-start-1 lg:row-start-1">
          <section aria-labelledby={`${uid}-s1`} className="flex flex-col gap-6">
            <h2 id={`${uid}-s1`} className={SUBHEAD}>
              {L.sectionPresenter}
            </h2>
            {/* 과정 — 학과 확인용(포스터 머리글은 두 과정 모두 '박사학위예비심사'). 오류는 선택지 바로 아래 */}
            <fieldset
              aria-describedby={programErr ? eid('program') : undefined}
              className="m-0 min-w-0 border-0 p-0"
            >
              <legend className={cn(LABEL, 'mb-2.5 p-0')}>{L.programLabel}</legend>
              <div className="grid grid-cols-2 gap-2">
                {PROGRAMS.map((p, idx) => {
                  const on = input.program === p;
                  return (
                    <label
                      key={p}
                      className={cn(
                        'flex h-[50px] cursor-pointer items-center gap-2.5 rounded-[2px] border bg-surface px-3.5 text-[15px] transition-colors',
                        on
                          ? 'border-yonsei-blue font-semibold text-yonsei-blue dark:border-brand dark:text-brand'
                          : cn(borderOf(!!programErr), 'text-content hover:bg-surface-soft'),
                      )}
                    >
                      <input
                        id={idx === 0 ? fid('program') : undefined}
                        type="radio"
                        name={`${uid}-program`}
                        value={p}
                        checked={on}
                        onChange={() => update((prev) => ({ ...prev, program: p }))}
                        className="h-4 w-4 shrink-0 accent-yonsei-blue dark:accent-brand"
                      />
                      {L.programs[p]}
                    </label>
                  );
                })}
              </div>
              {programErr && (
                <div className="mt-2.5">
                  <ErrorBox id={eid('program')}>{messageOf(programErr)}</ErrorBox>
                </div>
              )}
            </fieldset>
            {textField('presenter', L.presenterLabel, { autoComplete: 'name' })}
            <div className="flex flex-col gap-2.5">
              <label htmlFor={fid('title')} className={LABEL}>
                {L.titleLabel}
              </label>
              <textarea
                id={fid('title')}
                rows={3}
                value={input.title}
                aria-invalid={titleErr ? true : undefined}
                aria-describedby={titleErr ? eid('title') : titleHintId}
                onChange={(e) => setField('title', e.target.value)}
                // 긴 제목(국·영 병기)이 좁은 화면에서 잘리지 않게 내용만큼 자란다(field-sizing
                // 미지원 브라우저는 rows=3 + 손잡이로 늘린다)
                className={cn(
                  FIELD_BASE,
                  'min-h-[104px] resize-y px-3.5 py-3 leading-[1.6] [field-sizing:content]',
                  borderOf(!!titleErr),
                )}
              />
              {titleErr ? (
                <ErrorBox id={eid('title')}>{messageOf(titleErr)}</ErrorBox>
              ) : (
                <p id={titleHintId} className={HINT}>
                  {L.titleHint}
                </p>
              )}
            </div>
            {/* 머리글 환영 문구 — 양식 기본값은 켬. 끄면 '박사학위예비심사 공지'만 남는다 */}
            <label className="flex cursor-pointer items-start gap-2.5 text-[15px] leading-6 text-content">
              <input
                id={fid('welcome')}
                type="checkbox"
                checked={input.welcome}
                onChange={(e) => {
                  const welcome = e.target.checked;
                  update((prev) => ({ ...prev, welcome }));
                }}
                className="mt-1 h-4 w-4 shrink-0 accent-yonsei-blue dark:accent-brand"
              />
              <span>{L.welcomeLabel}</span>
            </label>
          </section>

          <section
            aria-labelledby={`${uid}-s2`}
            className="mt-10 flex flex-col gap-5 border-t border-surface-border pt-10"
          >
            <div>
              <h2 id={`${uid}-s2`} className={SUBHEAD}>
                {L.sectionCommittee}
              </h2>
              <p id={committeeHintId} className={cn(HINT, 'mt-1.5')}>
                {L.committeeHint}
              </p>
            </div>
            {committeeRow(-1)}
            {input.members.map((_, i) => committeeRow(i))}
            {membersErr && <ErrorBox id={eid('members')}>{messageOf(membersErr)}</ErrorBox>}
            {input.members.length < NOTICE_LIMITS.maxMembers && (
              <button
                type="button"
                onClick={addMember}
                className={cn(
                  'inline-flex min-h-11 items-center gap-1.5 self-start rounded-[2px] border border-dashed border-content-faint/40 px-4 text-[15px] font-semibold transition-colors hover:border-yonsei-blue dark:hover:border-brand',
                  ACCENT_TEXT,
                )}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0"
                >
                  <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                </svg>
                {L.addMember}
              </button>
            )}
          </section>

          <section
            aria-labelledby={`${uid}-s3`}
            className="mt-10 flex flex-col gap-6 border-t border-surface-border pt-10"
          >
            <h2 id={`${uid}-s3`} className={SUBHEAD}>
              {L.sectionWhen}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-2.5">
                <label htmlFor={fid('date')} className={LABEL}>
                  {L.dateLabel}
                </label>
                <input
                  id={fid('date')}
                  type="date"
                  value={input.date}
                  min={minDate}
                  aria-invalid={dateErr ? true : undefined}
                  aria-describedby={dateErr ? eid('date') : undefined}
                  onChange={(e) => setField('date', e.target.value)}
                  className={cn(INPUT, NATIVE_DARK, 'min-w-0', borderOf(!!dateErr))}
                />
                {dateErr && <ErrorBox id={eid('date')}>{messageOf(dateErr)}</ErrorBox>}
              </div>
              <div className="flex min-w-0 flex-col gap-2.5">
                <label htmlFor={fid('time')} className={LABEL}>
                  {L.timeLabel}
                </label>
                <input
                  id={fid('time')}
                  type="time"
                  step={300}
                  value={input.time}
                  aria-invalid={timeErr ? true : undefined}
                  aria-describedby={timeErr ? eid('time') : undefined}
                  onChange={(e) => setField('time', e.target.value)}
                  className={cn(INPUT, NATIVE_DARK, 'min-w-0', borderOf(!!timeErr))}
                />
                {timeErr && <ErrorBox id={eid('time')}>{messageOf(timeErr)}</ErrorBox>}
              </div>
            </div>
            {textField('place', L.placeLabel, { placeholder: L.placePlaceholder })}
          </section>
        </div>

        {/* ── 미리보기 — lg 에서 오른쪽 열, 고정 헤더(80) + 탭 바(49) 아래에 붙는다 ── */}
        <section
          aria-labelledby={previewTitleId}
          className="mt-12 border-t border-surface-border pt-10 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:self-start lg:border-t-0 lg:pt-0 lg:sticky lg:top-[153px]"
        >
          <h2 id={previewTitleId} className={SUBHEAD}>
            {L.previewTitle}
          </h2>
          <div className="mt-4 border border-surface-border bg-white">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={posterAlt(input)}
              className="block aspect-[1403/992] w-full"
            />
          </div>
          {showPostTitle && (
            <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm leading-[1.6]">
              <span className="font-semibold text-content-faint">{L.postTitleLabel}</span>
              <span className="font-semibold text-content">{postTitle(input)}</span>
            </p>
          )}
          <p className={cn(HINT, showPostTitle ? 'mt-1' : 'mt-4')}>{L.previewCaption}</p>
          <button
            type="button"
            onClick={() => void onDownload(null)}
            aria-disabled={downloading || undefined}
            aria-busy={downloading || undefined}
            className={cn(OUTLINE_BTN, 'mt-4', downloading && 'cursor-not-allowed opacity-60')}
          >
            {downloading ? <Spinner /> : <DownloadIcon />}
            {downloading ? L.downloading : L.download}
          </button>
          {downloadError && (
            <div className="mt-2">
              <ErrorBox>{L.downloadFailed}</ErrorBox>
            </div>
          )}
        </section>

        {/* ── 제출 — lg 에서 입력 열 맨 아래 ── */}
        <div className="mt-10 flex flex-col gap-2.5 border-t border-surface-border pt-10 lg:col-start-1 lg:row-start-2 lg:self-start">
          <button
            type="submit"
            aria-disabled={submitting || undefined}
            aria-busy={submitting || undefined}
            className={cn(MAIN_BTN, submitting ? 'cursor-not-allowed opacity-60' : 'hover:bg-brand-muted')}
          >
            {submitting ? (
              <>
                <Spinner />
                {L.submitting}
              </>
            ) : (
              L.submit
            )}
          </button>
          <p className={cn(HINT, 'text-center')}>{L.submitNote}</p>
          {actionBox}
        </div>
      </form>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
    >
      <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "제출 중…" 스피너 링 — 장식(버튼 글자가 그대로 읽힌다) */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="thesis-submit-spin h-4 w-4 shrink-0 rounded-full border-2 border-current border-r-transparent"
    />
  );
}
