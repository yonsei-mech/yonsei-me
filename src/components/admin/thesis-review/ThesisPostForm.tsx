'use client';

// 교직원용 **예비심사 공고 양식** — 학생 공고 입력과 같은 칸 + 포스터 실시간 미리보기로
// 학위논문심사 글을 쓰고 고친다. "학생이 보는 화면 그대로 보면서 고친다"(CMS 리디자인 원칙).
//
// 디자인 원본: Claude Design "학위논문심사 CMS 편집 폼"(https://claude.ai/artifact/63qE58b3ovnMeq9yoFaGc6).
// 디자인에서 바꾼 점: 지도교수 검색·공고문 파일 업로드·언어 탭·임시저장·목록 고정 칸이 없다 —
// 칸은 학생 양식과 같고(과정·발표자·논문 제목·환영 문구·심사위원·일시·장소), 공고문은 입력으로
// 그린 포스터다. 금색 없음, 모서리·버튼은 콘솔 cms-* 관례.
//
// 세 가지로 열린다(BoardEditor 가 고른다):
//   new        — 목록의 '글쓰기'. 바로 게시(또는 예약 게시). '양식 없이 직접 작성 →'은 일반 편집기.
//   edit       — 양식으로 만든 게시된 글(교직원 작성·승인된 학생 제출)의 '수정'.
//   submission — 검토 화면의 '수정 후 게시'. 학생 원본 대비 바뀐 칸을 칩으로 보여 주고,
//                게시하면 승인과 같은 기록·학생 안내 메일(서버 approveSubmissions).
// 입력 원본이 없는 구 사이트 이미지 글은 이 양식 대상이 아니다(일반 편집기 PostForm).
//
// 저장: posterPngBlob(cleanNotice(입력)) + JSON 을 multipart 로 POST /api/admin/thesis/post
// (계약 lib/thesis-submit/staff-post.ts). 끝나면 onDone — 목록이 배너로 결과를 말한다.
//
// 배치: 데스크톱은 집중 모드 전체 화면(좌 폼 · 우 미리보기 560 sticky) + 변경이 있으면 하단
// 고정 트레이(변경 칩·되돌리기·게시). 좁은 화면은 편집|미리보기 전환 + 하단 고정 게시 바.
// 미저장 이탈: 바뀐 칸이 있으면 '목록'·'양식 없이 직접 작성'을 한 번 붙잡는다(PostForm 과 같은 모달),
// 콘솔 다른 메뉴로의 이동은 BoardEditor 가 onDirtyChange 로 셸에 알려 막는다.
//
// 내부 운영 도구라 한국어 문자열을 직접 둔다.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { BoardMeta } from '@/lib/admin/boards';
import { NOTICE_LIMITS, cleanNotice, emptyMember, squash, type ThesisNoticeInput } from '@/lib/thesis-submit/notice';
import { posterPngBlob } from '@/lib/thesis-submit/poster-canvas';
import { isHm, type StaffPostData } from '@/lib/thesis-submit/staff-post';
import { cn } from '@/lib/utils';
import { useAdminShell } from '../AdminShellContext';
import type { ApiRecord } from '../BoardEditor';
import { IcoAlertCircle, IcoInbox } from '../cms-icons';
import { CmsModal } from '../CmsModal';
import { postStaffNotice, StaffPostError } from './api';
import { kstStamp } from './review-model';
import {
  autoTitle,
  clipValue,
  formChanges,
  formErrors,
  initialFormState,
  publishAtMs,
  remapServerErrors,
  shownTitle,
  type FieldChange,
  type FormError,
  type FormField,
  type ThesisFormMode,
  type ThesisFormState,
} from './thesis-post-model';
import {
  CommitteeSection,
  PresenterSection,
  PublishSection,
  TitleField,
  WhenSection,
  type FieldKit,
} from './ThesisPostFields';
import { ThesisPosterPreview } from './ThesisPosterPreview';

export type { ThesisFormMode } from './thesis-post-model';

/** 저장이 끝난 뒤 목록이 배너로 말할 것 */
export interface ThesisPostDone {
  id: string;
  mode: ThesisFormMode;
  title: string;
  /** 공개 시각이 아직 안 왔으면 'YYYY-MM-DD HH:MM'(KST) */
  scheduledAt: string | null;
  /** 학생 제출(submission)만 — 게시 안내 메일 결과 */
  mailSent?: boolean;
  /** 고치는 사이 다른 관리자가 먼저 게시했다 */
  already?: boolean;
  /** 학생 제출이면 학생 이메일(메일 실패 안내용) */
  email?: string;
}

interface Props {
  meta: BoardMeta;
  mode: ThesisFormMode;
  /** edit·submission — 고칠 글(입력 원본 submission.notice 가 있어야 한다) */
  rec?: ApiRecord | null;
  onCancel: () => void;
  onDone: (r: ThesisPostDone) => void;
  /** 새 글만 — '양식 없이 직접 작성'(석사·본심사 등 다른 공고용 일반 편집기) */
  onPlainPost?: () => void;
}

const MODE_LABEL: Record<ThesisFormMode, string> = { new: '새 글', edit: '수정', submission: '학생 제출' };

/** 전역 부드러운 스크롤(Lenis)이 있으면 그쪽 위치도 함께 맨 위로 — 없으면 네이티브만 */
function scrollTopNow() {
  const lenis = (window as unknown as { lenis?: { scrollTo: (y: number, o?: object) => void } }).lenis;
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  window.scrollTo(0, 0);
}

export function ThesisPostForm({ meta, mode, rec, onCancel, onDone, onPlainPost }: Props) {
  const { setFocusMode, setWriteDenied } = useAdminShell();
  /** 원본 — 새 글은 빈 양식, 고치기는 저장된 입력(학생 제출이면 학생이 낸 그대로). 칩·되돌리기의 기준 */
  const [base] = useState<ThesisFormState>(() => initialFormState(mode, rec));
  const [state, setState] = useState<ThesisFormState>(base);
  /** 첫 게시 시도 뒤로는 입력마다 다시 검사한다 */
  const [attempted, setAttempted] = useState(false);
  /** 서버가 돌려준 칸 오류(화면 줄로 되돌린 것) — 입력을 고치면 클라이언트 검사로 넘어간다 */
  const [serverErrors, setServerErrors] = useState<FormError[] | null>(null);
  /** 오류 요약 — 게시를 누른 순간의 목록. 고친 칸은 빠진다 */
  const [summary, setSummary] = useState<FormError[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** 미저장 이탈 확인 — 확인하면 실행할 이동 */
  const [leaveTo, setLeaveTo] = useState<null | (() => void)>(null);
  /** 좁은 화면의 편집|미리보기 */
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [, setFocusTick] = useState(0);
  const pendingFocus = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const uid = useId();
  const previewHeadingId = useId();

  // 글쓰기 화면과 같은 집중 모드 — 언마운트 정리를 빠뜨리면 목록으로 돌아와도 사이드바가 사라진다
  useEffect(() => {
    setFocusMode(true);
    return () => setFocusMode(false);
  }, [setFocusMode]);

  // 어디서 열었든 맨 위에서 시작하고, 키보드 초점도 이 화면 제목으로
  useEffect(() => {
    scrollTopNow();
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  // 초점 이동 — 매 렌더 뒤 대기 중인 대상이 있으면 옮긴다(고정 바에 가리지 않게 화면 가운데로)
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center' });
  });

  const fid = useCallback((field: string) => `${uid}-${field.replace(/\./g, '-')}`, [uid]);
  const errors = useMemo(
    () => serverErrors ?? (attempted ? formErrors(state) : []),
    [serverErrors, attempted, state],
  );
  const kit: FieldKit = useMemo(() => {
    const map = new Map<string, FormError>();
    for (const e of errors) if (!map.has(e.field)) map.set(e.field, e);
    return { fid, eid: (f) => `${fid(f)}-err`, errOf: (f) => map.get(f) };
  }, [errors, fid]);
  const openSummary = (summary ?? []).filter((e) => kit.errOf(e.field));

  const changes = useMemo(() => formChanges(base, state), [base, state]);
  const title = shownTitle(state);
  const pubAt = publishAtMs(state);
  const scheduled = Number.isFinite(pubAt) && pubAt > Date.now();
  const pubTime = state.schedule && isHm(state.pubTime) ? state.pubTime : '00:00';
  const sub = rec?.submission ?? null;

  const idleLabel =
    mode === 'submission'
      ? scheduled
        ? '수정 후 예약 게시'
        : '수정 후 게시'
      : mode === 'edit'
        ? scheduled
          ? '예약 게시'
          : '수정 저장'
        : scheduled
          ? '예약 게시'
          : '바로 게시';
  const busyLabel = scheduled ? '예약하는 중…' : mode === 'edit' ? '저장하는 중…' : '게시하는 중…';

  // ── 입력 ──
  const update = useCallback((fn: (prev: ThesisNoticeInput) => ThesisNoticeInput) => {
    setState((s) => ({ ...s, notice: fn(s.notice) }));
    setServerErrors(null);
  }, []);
  const patchState = useCallback((patch: Partial<ThesisFormState>) => {
    setState((s) => ({ ...s, ...patch }));
    setServerErrors(null);
  }, []);

  function addMember() {
    if (state.notice.members.length >= NOTICE_LIMITS.maxMembers) return;
    const next = state.notice.members.length;
    update((p) => ({ ...p, members: [...p.members, emptyMember()] }));
    pendingFocus.current = fid(`members.${next}.name`);
  }

  function removeMember(i: number) {
    if (state.notice.members.length <= 1) return;
    update((p) => ({ ...p, members: p.members.filter((_, j) => j !== i) }));
    // 지운 자리에 올라온 줄(없으면 바로 윗줄)의 성명 칸으로 — 초점이 문서 처음으로 튕기지 않게
    pendingFocus.current = fid(`members.${Math.min(i, state.notice.members.length - 2)}.name`);
  }

  function focusTargetOf(field: FormField): string {
    return field === 'members' ? fid('members.0.name') : fid(field);
  }

  function focusField(field: FormField) {
    setView('edit');
    pendingFocus.current = focusTargetOf(field);
    setFocusTick((t) => t + 1);
  }

  function revert() {
    setState(base);
    setAttempted(false);
    setServerErrors(null);
    setSummary(null);
    setSaveError(null);
  }

  /** 목록·일반 편집기로 — 바뀐 칸이 있으면 한 번 붙잡는다 */
  function requestLeave(go: () => void) {
    if (busy) return;
    if (changes.length > 0) setLeaveTo(() => go);
    else go();
  }

  // ── 게시 ──
  async function submit() {
    if (busy) return;
    setSaveError(null);
    setServerErrors(null);
    setAttempted(true);
    const errs = formErrors(state);
    if (errs.length > 0) {
      setSummary(errs);
      focusField(errs[0].field);
      return;
    }
    setSummary(null);
    setBusy(true);
    const notice = cleanNotice(state.notice);
    const data: StaffPostData = {
      ...(mode !== 'new' && rec ? { id: rec.id } : {}),
      notice,
      date: state.pubDate,
      ...(state.schedule && isHm(state.pubTime) ? { time: state.pubTime } : {}),
      ...(state.manual ? { title: squash(state.manualTitle) } : {}),
    };
    let poster: Blob;
    try {
      poster = await posterPngBlob(notice);
    } catch (err) {
      console.error('[thesis-post] 포스터 만들기 실패', err);
      setBusy(false);
      setSaveError('포스터 이미지를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    try {
      const res = await postStaffNotice(data, poster);
      onDone({
        id: res.id,
        mode,
        title: squash(title) || autoTitle(notice),
        scheduledAt: scheduled ? `${state.pubDate} ${pubTime}` : null,
        mailSent: res.mailSent,
        already: res.already,
        email: sub?.email,
      });
    } catch (err) {
      setBusy(false);
      if (err instanceof StaffPostError && err.status === 403) setWriteDenied(true);
      if (err instanceof StaffPostError && err.errors) {
        const mapped = remapServerErrors(err.errors, state.notice);
        setServerErrors(mapped);
        setSummary(mapped);
        focusField(mapped[0].field);
        return;
      }
      setSaveError(err instanceof Error ? err.message : '저장하지 못했습니다.');
    }
  }

  // ── 조각 ──
  const spinner = (
    <span
      aria-hidden="true"
      className="h-[18px] w-[18px] shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
    />
  );
  const primaryContent = busy ? (
    <>
      {spinner}
      {busyLabel}
    </>
  ) : (
    idleLabel
  );
  const PRIMARY = 'cms-btn-primary font-bold disabled:opacity-60 dark:bg-brand dark:text-brand-fg';

  const saveAlert = saveError && (
    <div
      role="alert"
      className="flex gap-2.5 border border-[#b42318]/45 bg-[#fdf3f2] px-4 py-3 text-[13px] leading-relaxed text-[#b42318] dark:border-[#fda29b]/50 dark:bg-[#f04438]/10 dark:text-[#fda29b]"
    >
      <IcoAlertCircle size={18} className="mt-px shrink-0" />
      <div className="min-w-0">
        <strong className="block font-bold">{mode === 'edit' ? '저장하지 못했습니다' : '게시하지 못했습니다'}</strong>
        <span>
          {saveError}
          {mode === 'submission' && ' 학생에게 메일은 보내지 않았습니다.'}
        </span>
      </div>
    </div>
  );

  const backArrow = (size: number) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );

  return (
    <div className="anim-panel min-h-[70vh] bg-surface">
      {/* ── 상단 고정 바 — 집중 모드에서 사이드바를 대신한다 ── */}
      <div className="sticky top-0 z-30 border-b border-surface-border bg-surface">
        <div className="flex h-14 items-center gap-2 pl-1 pr-3 lg:h-[72px] lg:gap-4 lg:px-8">
          <button
            type="button"
            onClick={() => requestLeave(onCancel)}
            disabled={busy}
            aria-label="목록으로"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-content disabled:opacity-40 lg:hidden"
          >
            {backArrow(20)}
          </button>
          <button
            type="button"
            onClick={() => requestLeave(onCancel)}
            disabled={busy}
            className="cms-btn hidden h-11 shrink-0 lg:inline-flex"
          >
            {backArrow(16)}
            목록
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="hidden shrink-0 text-xs font-semibold text-content-faint lg:inline">{meta.label}</span>
            <span aria-hidden="true" className="hidden h-3.5 w-px shrink-0 bg-surface-border lg:inline-block" />
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="min-w-0 truncate text-base font-bold text-content outline-none lg:text-[17px]"
            >
              예비심사 공고 양식
            </h1>
            <span className="shrink-0 border border-surface-border px-1.5 py-0.5 text-[11px] font-bold text-content-faint">
              {MODE_LABEL[mode]}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            aria-busy={busy || undefined}
            className={cn(PRIMARY, 'hidden h-12 min-w-[148px] shrink-0 px-7 text-[15px] lg:inline-flex')}
          >
            {primaryContent}
          </button>
        </div>
        {busy && (
          <div role="progressbar" aria-label={busyLabel} className="h-[3px] overflow-hidden bg-surface-soft">
            <div className="h-full w-2/3 animate-pulse bg-yonsei-blue dark:bg-brand" />
          </div>
        )}
      </div>

      {/* ── 좁은 화면: 편집 | 미리보기 ── */}
      <div
        role="group"
        aria-label="보기 전환"
        className="mx-4 mt-3 grid grid-cols-2 border border-surface-border sm:mx-6 lg:hidden"
      >
        {(['edit', 'preview'] as const).map((v, i) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn(
              'min-h-11 text-sm transition-colors',
              i > 0 && 'border-l border-surface-border',
              view === v
                ? 'bg-yonsei-navy font-bold text-white dark:bg-brand dark:text-brand-fg'
                : 'bg-surface font-medium text-content hover:bg-surface-soft',
            )}
          >
            {v === 'edit' ? '편집' : '미리보기'}
          </button>
        ))}
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_560px]">
        {/* ════ 폼 ════ */}
        <form
          noValidate
          aria-label="예비심사 공고 입력"
          aria-busy={busy || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          onKeyDown={(e) => {
            // 입력칸의 Enter 로는 게시하지 않는다. 한글 조합 중인 Enter 는 건드리지 않는다.
            if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !e.nativeEvent.isComposing) {
              e.preventDefault();
            }
          }}
          className={cn('min-w-0 px-4 pb-52 pt-5 sm:px-6 lg:px-14 lg:pb-40 lg:pt-9', view === 'preview' && 'max-lg:hidden')}
        >
          <fieldset
            disabled={busy}
            className={cn('m-0 flex min-w-0 flex-col gap-7 border-0 p-0 transition-opacity', busy && 'opacity-60')}
          >
            {mode === 'new' && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-surface-border pb-4">
                <p className="text-[13px] leading-relaxed text-content-faint">
                  박사·통합과정 <strong className="font-semibold text-content">예비심사</strong> 공고 전용입니다. 칸을
                  채우면 학과 양식 포스터가 만들어져 본문이 됩니다.
                </p>
                {onPlainPost && (
                  <button
                    type="button"
                    onClick={() => requestLeave(onPlainPost)}
                    title="석사·본심사 등 다른 공고는 일반 편집기로 씁니다"
                    className="shrink-0 text-[13px] font-semibold text-yonsei-blue transition-colors hover:text-yonsei-navy dark:text-brand"
                  >
                    양식 없이 직접 작성 →
                  </button>
                )}
              </div>
            )}

            {mode === 'submission' && sub && <SubmissionBanner sub={sub} changes={changes} />}

            {mode === 'edit' && sub && (
              <p className="border-b border-surface-border pb-4 text-[13px] leading-relaxed text-content-faint">
                {sub.source === 'staff' ? '공고 양식으로 쓴 글' : '학생 제출 공고'} · 게시됨
                {sub.source === 'student' && sub.receiptNo && (
                  <>
                    {' · 접수번호 '}
                    <span className="tabular-nums">{sub.receiptNo}</span>
                  </>
                )}
                {sub.email && ` · ${sub.source === 'staff' ? '작성' : '제출'} ${sub.email}`}
                <span className="mt-0.5 block text-content">
                  저장하면 사이트의 글이 바로 바뀝니다
                  {sub.source === 'student' ? ' — 학생에게 메일은 다시 가지 않습니다.' : '.'}
                </span>
              </p>
            )}

            {openSummary.length > 0 && (
              <div
                role="alert"
                className="flex items-start gap-3 border border-[#b42318] bg-[#fdf3f2] px-4 py-4 text-[#b42318] dark:border-[#fda29b]/60 dark:bg-[#f04438]/10 dark:text-[#fda29b] sm:px-[18px]"
              >
                <IcoAlertCircle size={20} className="mt-px shrink-0" />
                <div className="min-w-0">
                  <p className="text-[15px] font-bold">
                    게시하지 못했습니다. {openSummary.length}개 항목을 확인해 주세요.
                  </p>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-[18px] text-sm leading-relaxed">
                    {openSummary.map((e) => (
                      <li key={e.field}>
                        <button
                          type="button"
                          onClick={() => focusField(e.field)}
                          className="block text-left font-semibold underline decoration-1 underline-offset-[3px]"
                        >
                          {e.label} — {e.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <TitleField
              kit={kit}
              state={state}
              title={title}
              onManual={(on) =>
                setState((s) => ({
                  ...s,
                  manual: on,
                  manualTitle: on ? s.manualTitle || autoTitle(s.notice) : s.manualTitle,
                }))
              }
              onTitle={(v) => {
                if (state.manual) patchState({ manualTitle: v });
              }}
            />
            <PresenterSection kit={kit} notice={state.notice} update={update} />
            <CommitteeSection
              kit={kit}
              notice={state.notice}
              update={update}
              onAdd={addMember}
              onRemove={removeMember}
            />
            <WhenSection kit={kit} notice={state.notice} update={update} />
            <PublishSection kit={kit} mode={mode} state={state} onChange={patchState} />
          </fieldset>
        </form>

        {/* ════ 미리보기 ════ */}
        <aside
          aria-labelledby={previewHeadingId}
          className={cn(
            'min-w-0 bg-surface-soft px-4 pb-52 pt-5 sm:px-6 lg:border-l lg:border-surface-border lg:px-8 lg:pb-40 lg:pt-8',
            view === 'edit' && 'max-lg:hidden',
          )}
        >
          <div className="lg:sticky lg:top-[96px]">
            <ThesisPosterPreview
              notice={state.notice}
              boardLabel={meta.label}
              title={squash(title)}
              pubDate={state.pubDate}
              scheduleBadge={scheduled ? `예약 ${pubTime === '00:00' ? '0시' : pubTime}` : null}
              headingId={previewHeadingId}
            />
          </div>
        </aside>
      </div>

      {/* ── 데스크톱 하단 트레이 — 바뀐 칸이 있거나 저장이 실패했을 때 ── */}
      {(changes.length > 0 || saveAlert) && (
        <div
          role="region"
          aria-label="게시"
          className="fixed inset-x-0 bottom-0 z-30 hidden border-t-2 border-yonsei-navy bg-surface px-8 py-3.5 dark:border-brand lg:block"
        >
          {saveAlert && <div className="mb-3">{saveAlert}</div>}
          <div className="flex items-center gap-4">
            {changes.length > 0 && (
              <>
                <span className="flex shrink-0 items-center gap-2">
                  <span aria-hidden="true" className="h-[7px] w-[7px] bg-yonsei-blue dark:bg-brand" />
                  <strong className="text-sm font-bold text-content">변경 {changes.length}건</strong>
                </span>
                <ul className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  {changes.slice(0, 3).map((c) => (
                    <li key={c.key} className="shrink-0">
                      <ChangeChip c={c} />
                    </li>
                  ))}
                  {changes.length > 3 && (
                    <li className="shrink-0 text-xs font-semibold text-content-faint">외 {changes.length - 3}건</li>
                  )}
                </ul>
                <button type="button" onClick={revert} disabled={busy} className="cms-btn h-11 shrink-0">
                  되돌리기
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              aria-busy={busy || undefined}
              className={cn(PRIMARY, 'ml-auto h-12 min-w-[148px] shrink-0 px-7 text-[15px]')}
            >
              {primaryContent}
            </button>
          </div>
        </div>
      )}

      {/* ── 좁은 화면 하단 게시 바 ── */}
      <div
        role="region"
        aria-label="게시"
        className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2.5 border-t-2 border-yonsei-navy bg-surface px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 dark:border-brand lg:hidden"
      >
        {changes.length > 0 && !busy && (
          <div className="flex min-h-6 items-center gap-2">
            <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 bg-yonsei-blue dark:bg-brand" />
            <strong className="whitespace-nowrap text-sm font-bold text-content">변경 {changes.length}건</strong>
            <span className="min-w-0 truncate text-[13px] text-content-faint">
              {changes
                .slice(0, 2)
                .map((c) => c.label)
                .join(', ')}
              {changes.length > 2 ? ' 외' : ''}
            </span>
            <button
              type="button"
              onClick={revert}
              className="ml-auto inline-flex min-h-11 shrink-0 items-center px-1 text-[13px] font-bold text-yonsei-blue underline decoration-1 underline-offset-[3px] dark:text-brand"
            >
              되돌리기
            </button>
          </div>
        )}
        {saveAlert}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          aria-busy={busy || undefined}
          className={cn(PRIMARY, 'h-[52px] w-full text-base')}
        >
          {primaryContent}
        </button>
      </div>

      {leaveTo && (
        <CmsModal
          title="고친 내용을 버리고 나갈까요?"
          body="아직 게시하지 않았습니다. 지금 나가면 이 양식에 입력한 내용이 사라집니다."
          confirmLabel="나가기"
          tone="danger"
          onConfirm={() => {
            const go = leaveTo;
            setLeaveTo(null);
            go();
          }}
          onCancel={() => setLeaveTo(null)}
        />
      )}
    </div>
  );
}

/** 바뀐 칸 칩 — '장소 제1공학관 528 → 제1공학관 A528호' */
function ChangeChip({ c }: { c: FieldChange }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap border border-surface-border bg-surface-soft px-2.5 py-1.5 text-xs">
      <strong className="font-bold text-content">{c.label}</strong>
      <span className="text-content-faint">{clipValue(c.before)}</span>
      <span aria-hidden="true" className="text-content-faint">
        →
      </span>
      <span className="sr-only">에서</span>
      <span className="text-content">{clipValue(c.after)}</span>
    </span>
  );
}

/** 학생 제출에서 불러옴 — 누가·언제 + 원본 대비 바뀐 칸 전부 */
function SubmissionBanner({
  sub,
  changes,
}: {
  sub: NonNullable<ApiRecord['submission']>;
  changes: FieldChange[];
}) {
  return (
    <div className="border border-yonsei-blue/40 bg-yonsei-blue/[0.05] px-4 py-3.5 dark:border-brand/40 dark:bg-brand/10">
      <div className="flex items-start gap-3">
        <IcoInbox size={20} className="mt-0.5 shrink-0 text-yonsei-blue dark:text-brand" />
        <div className="min-w-0 text-sm leading-relaxed text-content">
          <p className="font-bold">학생 제출물에서 불러왔습니다</p>
          <p className="mt-0.5 text-[13px] text-content-faint">
            접수번호 <span className="tabular-nums">{sub.receiptNo}</span>
            {sub.email && (
              <>
                {' · '}
                <span className="[overflow-wrap:anywhere]">{sub.email}</span>
              </>
            )}
            {sub.submittedAt && (
              <>
                {' · '}
                <span className="tabular-nums">{kstStamp(sub.submittedAt)}</span> 접수
              </>
            )}
          </p>
          <p className="mt-1.5">고친 뒤 ‘수정 후 게시’를 누르면 바로 게시되고, 학생에게 게시 안내 메일이 갑니다.</p>
        </div>
      </div>
      <div className="mt-3 border-t border-yonsei-blue/20 pt-3 dark:border-brand/20">
        <p className="text-xs font-bold text-yonsei-blue dark:text-brand">
          원본 대비 바뀐 칸 <span className="tabular-nums">{changes.length}</span>
        </p>
        {changes.length === 0 ? (
          <p className="mt-1 text-[13px] text-content-faint">아직 고친 칸이 없습니다 — 학생이 낸 그대로입니다.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {changes.map((c) => (
              <li key={c.key} className="max-w-full">
                <ChangeChip c={c} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
