'use client';

// 학생 제출 공고 검토 화면(디자인 B1~B3) — "학생이 볼 화면 그대로 보면서 결정한다".
//
// 왼쪽: 게시되면 사이트에 보일 모습(공개 상세와 같은 PostArticle 을 PostCanvas 로 같은 폭에
//       그린다) + 학생이 입력한 심사 정보 원본(포스터와 대조용).
// 오른쪽(360, sticky): 제출 정보 / 확인 항목 / 내부 메모 / 승인·수정·반려.
// 좁은 화면(<lg): 한 단으로 쌓고, 세 동작은 하단 고정 바로 내린다.
//
// 글쓰기 화면(PostForm)처럼 전체 화면(집중 모드)이다 — 검토는 목록을 곁눈질하며 하는
// 일이 아니고, 포스터를 크게 볼 자리가 필요하다.
//
// 확인 항목·메모는 참고용이라 승인을 막지 않고, 고치는 즉시(디바운스) 저장된다 —
// 그래서 이 화면에는 "저장 안 된 편집" 개념이 없다(떠날 때 남은 저장은 keepalive 로 보낸다).
//
// 내부 운영 도구라 한국어 문자열을 직접 둔다.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PostArticle } from '@/components/PostArticle';
import type { BoardMeta } from '@/lib/admin/boards';
import {
  committeeEntry,
  formatWhen,
  memberEntries,
  posterAlt,
  type ThesisNoticeInput,
} from '@/lib/thesis-submit/notice';
import {
  REVIEW_CHECKS,
  REVIEW_MEMO_MAX,
  type RejectReason,
  type ReviewStatus,
  type ThesisReview,
} from '@/lib/thesis-submit/review';
import { cn } from '@/lib/utils';
import { useAdminShell } from '../AdminShellContext';
import type { ApiRecord } from '../BoardEditor';
import { IcoAlertCircle, IcoZoomIn } from '../cms-icons';
import { PostCanvas } from '../PostCanvas';
import { approvePosts, rejectPost, ReviewApiError, saveReview, type ReviewPatch } from './api';
import { PosterLightbox } from './PosterLightbox';
import { RejectDialog } from './RejectDialog';
import { kstShortStamp, kstStamp, posterOf, reviewStatusOf, todayKstDate } from './review-model';
import { ReviewStatusBadge } from './ThesisList';

interface Props {
  meta: BoardMeta;
  rec: ApiRecord;
  onBack: () => void;
  /** 수정 후 게시 — 글 편집 화면(PostForm)으로 옮겨 연다 */
  onEdit: () => void;
  onApproved: (r: { mailSent?: boolean; already?: boolean }) => void;
  onRejected: (r: { mailSent: boolean }) => void;
  /** 자동 저장이 통한 뒤 — 목록이 들고 있는 레코드에도 반영해 다시 열 때 옛 값이 뜨지 않게 */
  onReviewSaved: (patch: ReviewPatch) => void;
}

/** 공개 상세(BoardPostDetail)의 한국어 라벨과 같은 값 — 미리보기 전용 */
const ARTICLE_LABELS = {
  title: '제목',
  date: '작성일',
  metaRow: '작성자',
  attachments: '첨부파일',
  backToList: '목록으로',
  share: '공유',
  copyUrl: 'URL 복사',
  copied: '복사됨',
  copyFailed: '복사 실패',
};

/** 자동 저장 대기 시간 — 타이핑 중에는 모았다가 멈추면 한 번 보낸다 */
const AUTOSAVE_MS = 800;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * 확인 항목·메모 자동 저장. 바뀐 칸만 모아(patch) 디바운스로 보낸다.
 * 화면을 떠날 때 남은 것은 keepalive 요청으로 마저 보낸다(탭을 닫아도 전송된다).
 */
function useReviewAutosave(id: string, onSaved: (patch: ReviewPatch) => void) {
  const pending = useRef<ReviewPatch>({});
  const timer = useRef<number | undefined>(undefined);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const [state, setState] = useState<SaveState>('idle');

  const send = useCallback(async () => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    setState('saving');
    try {
      await saveReview(id, patch);
      setState('saved');
      onSavedRef.current(patch);
    } catch {
      // 실패한 값은 다시 대기열로 — 그 사이 더 고친 값이 있으면 그쪽이 이긴다
      pending.current = { ...patch, ...pending.current };
      setState('error');
    }
  }, [id]);

  const queue = useCallback(
    (patch: ReviewPatch) => {
      pending.current = { ...pending.current, ...patch };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void send(), AUTOSAVE_MS);
    },
    [send],
  );

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      const patch = pending.current;
      if (Object.keys(patch).length === 0) return;
      pending.current = {};
      void saveReview(id, patch, true)
        .then(() => onSavedRef.current(patch))
        .catch(() => {});
    },
    [id],
  );

  return { state, queue, flush: send };
}

/** 전역 부드러운 스크롤(Lenis)이 있으면 그쪽 위치도 함께 맨 위로 — 없으면 네이티브만 */
function scrollTopNow() {
  const lenis = (window as unknown as { lenis?: { scrollTo: (y: number, o?: object) => void } }).lenis;
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  window.scrollTo(0, 0);
}

export function ThesisReviewScreen({
  meta,
  rec,
  onBack,
  onEdit,
  onApproved,
  onRejected,
  onReviewSaved,
}: Props) {
  const { setFocusMode, setWriteDenied } = useAdminShell();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previewId = useId();
  const infoId = useId();
  const checksId = useId();
  const memoId = useId();
  const memoHintId = useId();

  // 글쓰기 화면과 같은 집중 모드 — 언마운트 정리를 빠뜨리면 목록으로 돌아와도 사이드바가 사라진다
  useEffect(() => {
    setFocusMode(true);
    return () => setFocusMode(false);
  }, [setFocusMode]);

  // 목록 어디쯤에서 눌렀든 검토 화면은 맨 위에서 시작하고, 키보드 초점도 이 화면으로 옮긴다
  useEffect(() => {
    scrollTopNow();
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const sub = rec.submission ?? null;
  const notice = sub?.notice ?? null;
  const status = reviewStatusOf(rec);
  const pending = status === 'pending';
  const receipt = sub?.receiptNo || `#${rec.id}`;
  const presenter = notice?.presenter || rec.titleKo.replace(/^\[\d{6}\]\s*/, '');
  const poster = posterOf(rec.bodyKo);
  const posterText = poster ? poster.alt || (notice ? posterAlt(notice) : '공고문') : '';
  // 게시일 — 승인하면 오늘(KST)로 올라간다(지난 날짜일 때). 미래로 잡아 둔 값은 그대로.
  const today = todayKstDate();
  const shownDate = pending && rec.date < today ? today : rec.date;

  // ── 확인 항목·메모(자동 저장) ──
  const [checks, setChecks] = useState<boolean[]>(() =>
    REVIEW_CHECKS.map((_, i) => sub?.review?.checks?.[i] === true),
  );
  const [memo, setMemo] = useState(sub?.review?.memo ?? '');
  const autosave = useReviewAutosave(rec.id, onReviewSaved);
  const doneCount = checks.filter(Boolean).length;

  // ── 승인·반려 ──
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const locked = approving;
  const actionsRef = useRef<HTMLDivElement>(null);

  // 게시 실패 문구는 버튼 바로 위에 뜬다 — 옆 칸이 스크롤돼 있어도 보이게 끌어온다
  useEffect(() => {
    if (error) actionsRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  async function approve() {
    if (locked) return;
    setApproving(true);
    setError(null);
    // 방금 체크한 항목·메모가 결정 기록과 함께 남도록 먼저 보낸다(실패해도 승인은 진행)
    await autosave.flush();
    try {
      const [result] = await approvePosts([rec.id]);
      if (!result.ok) {
        throw new ReviewApiError(result.error || '서버가 게시를 거절했습니다.', null);
      }
      onApproved({ mailSent: result.mailSent, already: result.already });
    } catch (err) {
      if (err instanceof ReviewApiError && err.status === 403) setWriteDenied(true);
      setError(err instanceof Error ? err.message : '게시하지 못했습니다.');
      setApproving(false);
    }
  }

  async function reject(reason: RejectReason, message: string) {
    await autosave.flush();
    try {
      const r = await rejectPost(rec.id, reason, message);
      setRejectOpen(false);
      onRejected(r);
    } catch (err) {
      if (err instanceof ReviewApiError && err.status === 403) setWriteDenied(true);
      throw err;
    }
  }

  const received = sub?.submittedAt ? kstShortStamp(sub.submittedAt) : '';

  const errorAlert = error && (
    <div
      role="alert"
      className="flex gap-2.5 border border-[#b42318]/45 bg-[#fdf3f2] px-4 py-3.5 text-[13px] leading-relaxed text-[#b42318] dark:border-[#fda29b]/50 dark:bg-[#f04438]/10 dark:text-[#fda29b]"
    >
      <IcoAlertCircle size={18} className="mt-px shrink-0" />
      <div className="min-w-0">
        <strong className="block font-bold">게시하지 못했습니다</strong>
        <span>
          {error} 학생에게 메일은 보내지 않았습니다.
        </span>
      </div>
    </div>
  );

  const approveLabel = approving ? (
    <>
      <span
        aria-hidden="true"
        className="h-[18px] w-[18px] shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
      />
      게시하는 중…
    </>
  ) : (
    '승인하고 게시'
  );

  return (
    <div className="anim-panel min-h-[70vh] bg-surface">
      {/* 좁은 화면 — 글쓰기 화면처럼 맨 위 고정 바 하나 */}
      <div className="sticky top-0 z-30 flex h-[52px] items-center gap-1 border-b border-surface-border bg-surface pl-1 pr-3 lg:hidden">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-11 shrink-0 items-center px-2 text-sm font-semibold text-yonsei-blue dark:text-brand"
        >
          ← 목록으로
        </button>
        <span className="min-w-0 truncate text-sm font-bold text-content">
          제출 검토 · <span className="tabular-nums">{receipt}</span>
        </span>
      </div>

      <div className={cn('mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10 lg:pb-16', pending ? 'pb-40' : 'pb-16')}>
        <header className="cms-rule pb-4 pt-4 lg:pb-[18px] lg:pt-6">
          <button
            type="button"
            onClick={onBack}
            className="hidden text-[13px] font-semibold text-yonsei-blue transition-colors hover:text-yonsei-navy dark:text-brand lg:inline-flex"
          >
            ← 목록으로
          </button>
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 lg:mt-3">
            <ReviewStatusBadge status={status} />
            <span className="text-xs text-content-faint">
              {meta.label} · 학생 제출
              {received && <span className="lg:hidden"> · {received}</span>}
            </span>
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            // 좁은 화면에서는 위 고정 바가 같은 제목을 이미 보여 준다 — 글자로만 남긴다(초점 대상)
            className="mt-2 font-subhead text-[32px] font-semibold leading-tight tracking-tight text-content outline-none max-lg:sr-only"
          >
            제출 검토 · <span className="tabular-nums">{receipt}</span>
          </h1>
        </header>

        <div className="mt-6 grid gap-8 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10">
          {/* ── 왼쪽: 미리보기 + 심사 정보 ── */}
          <div className="min-w-0">
            <section aria-labelledby={previewId}>
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <h2 id={previewId} className="text-xs font-bold text-yonsei-blue dark:text-brand">
                  미리보기
                </h2>
                <span className="text-xs text-content-faint">
                  {pending
                    ? '게시되면 사이트에서 이렇게 보입니다'
                    : status === 'rejected'
                      ? '반려되어 사이트에는 없는 글입니다'
                      : '사이트에서 보이는 모습입니다'}
                </span>
                {poster && (
                  <button
                    type="button"
                    onClick={() => setLightbox(true)}
                    className="cms-btn cms-btn-sm ml-auto"
                  >
                    <IcoZoomIn size={14} />
                    원본 크게 보기
                  </button>
                )}
              </div>
              {/* 미리보기 안의 링크(목록으로 등)는 누르면 이 화면을 떠나 버리므로 막고,
                  포스터 이미지를 누르면 원본을 크게 연다. */}
              <div
                className="border border-surface-border bg-surface [&_.prose-content_img]:cursor-zoom-in"
                onClickCapture={(e) => {
                  const target = e.target as HTMLElement;
                  if (poster && target.tagName === 'IMG' && target.closest('.prose-content')) {
                    e.preventDefault();
                    setLightbox(true);
                    return;
                  }
                  const anchor = target.closest('a');
                  if (anchor && anchor.getAttribute('target') !== '_blank') e.preventDefault();
                }}
              >
                <div className="px-4 py-8 sm:px-8 sm:py-10">
                  <PostCanvas>
                    <PostArticle
                      boardName={meta.label}
                      title={rec.titleKo}
                      date={shownDate}
                      metaValue="기계공학부"
                      body={rec.bodyKo}
                      bodyFormat="html"
                      attachments={rec.attachments
                        .filter((a) => a.href.trim() !== '')
                        .map((a) => ({
                          label: { ko: a.labelKo, en: a.labelEn || a.labelKo },
                          href: a.href,
                        }))}
                      attachmentLabels={rec.attachments.filter((a) => a.href.trim() !== '').map((a) => a.labelKo)}
                      backHref="/graduate/thesis"
                      labels={ARTICLE_LABELS}
                      locale="ko"
                      shareInert
                    />
                  </PostCanvas>
                </div>
              </div>
            </section>

            <section aria-labelledby={infoId} className="mt-10">
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id={infoId} className="text-xs font-bold text-yonsei-blue dark:text-brand">
                  심사 정보
                </h2>
                <span className="text-xs text-content-faint">
                  학생이 입력한 원본입니다 — 포스터와 같은지 대조하세요
                </span>
              </div>
              {notice ? (
                <NoticeTable notice={notice} program={sub?.program || notice.program} />
              ) : (
                <p className="border border-dashed border-surface-border px-4 py-6 text-[13px] text-content-faint">
                  제출 입력 원본을 읽지 못했습니다. 포스터 이미지로만 확인해 주세요.
                </p>
              )}
            </section>
          </div>

          {/* ── 오른쪽: 결정에 필요한 것 ── */}
          {/* 화면 높이를 넘지 않게 — 넘치면(작은 창·오류 문구) 이 칸만 스크롤된다. 스크롤해도
              결정 버튼이 늘 보이도록 sticky. */}
          <aside
            aria-label="검토 동작"
            className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start lg:overflow-y-auto lg:[scrollbar-width:thin]"
          >
            <Card>
              <h2 className="text-[15px] font-bold text-content">제출 정보</h2>
              <dl className="mt-3.5 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13.5px]">
                <Dt>성명</Dt>
                <Dd>{presenter || '—'}</Dd>
                <Dt>과정</Dt>
                <Dd>{sub?.program || notice?.program || '—'}</Dd>
                <Dt>연락 이메일</Dt>
                <Dd>
                  {sub?.email ? (
                    <a
                      href={`mailto:${sub.email}`}
                      className="break-all text-yonsei-blue hover:text-yonsei-navy dark:text-brand"
                    >
                      {sub.email}
                    </a>
                  ) : (
                    '—'
                  )}
                </Dd>
                <Dt>접수번호</Dt>
                <Dd>
                  <span className="tabular-nums">{receipt}</span>
                </Dd>
                <Dt>접수 시각</Dt>
                <Dd>
                  <span className="tabular-nums">{sub?.submittedAt ? kstStamp(sub.submittedAt) : '—'}</span>
                </Dd>
              </dl>
            </Card>

            {pending ? (
              <Card>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id={checksId} className="text-[15px] font-bold text-content">
                    확인 항목
                  </h2>
                  <span className="text-xs tabular-nums text-content-faint">
                    {doneCount} / {REVIEW_CHECKS.length}
                  </span>
                </div>
                <p className="mt-1 text-xs text-content-faint">참고용입니다 — 체크하지 않아도 승인할 수 있습니다.</p>
                <ul aria-labelledby={checksId} className="mt-2">
                  {REVIEW_CHECKS.map((label, i) => (
                    <li key={label} className={cn(i > 0 && 'border-t border-surface-border')}>
                      <label className="flex cursor-pointer items-start gap-3 py-2 text-sm leading-snug text-content">
                        <input
                          type="checkbox"
                          checked={checks[i]}
                          disabled={locked}
                          onChange={(e) => {
                            const next = checks.map((v, j) => (j === i ? e.target.checked : v));
                            setChecks(next);
                            autosave.queue({ checks: next });
                          }}
                          className="mt-px h-[18px] w-[18px] shrink-0 accent-yonsei-navy"
                        />
                        <span>{label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : (
              <DecisionRecord status={status} review={sub?.review} />
            )}

            <Card>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <label htmlFor={memoId} className="text-[15px] font-bold text-content">
                  내부 메모
                </label>
                <span id={memoHintId} className="text-xs text-content-faint">
                  학생에게 보이지 않습니다
                </span>
                <span role="status" aria-live="polite" className="ml-auto text-[11px] text-content-faint">
                  {autosave.state === 'saving' && '저장 중…'}
                  {autosave.state === 'saved' && '자동 저장됨'}
                  {autosave.state === 'error' && (
                    <button
                      type="button"
                      onClick={() => void autosave.flush()}
                      className="font-semibold text-[#b42318] underline dark:text-[#fda29b]"
                    >
                      저장하지 못했습니다 · 다시 시도
                    </button>
                  )}
                </span>
              </div>
              <textarea
                id={memoId}
                aria-describedby={memoHintId}
                rows={3}
                value={memo}
                maxLength={REVIEW_MEMO_MAX}
                onChange={(e) => {
                  setMemo(e.target.value);
                  autosave.queue({ memo: e.target.value });
                }}
                placeholder="다른 관리자에게 남길 메모"
                className="cms-input mt-3 min-h-[72px] resize-y leading-relaxed"
              />
            </Card>

            {pending && (
              <div ref={actionsRef} className="hidden flex-col gap-2 lg:flex">
                {errorAlert}
                <button
                  type="button"
                  onClick={() => void approve()}
                  disabled={locked}
                  aria-busy={approving || undefined}
                  className="cms-btn-primary h-12 w-full text-[15px] font-bold disabled:opacity-100 dark:bg-brand dark:text-brand-fg"
                >
                  {approveLabel}
                </button>
                <button
                  type="button"
                  onClick={onEdit}
                  disabled={locked}
                  className="cms-btn h-12 w-full text-[15px]"
                >
                  수정 후 게시
                </button>
                <button
                  type="button"
                  onClick={() => setRejectOpen(true)}
                  disabled={locked}
                  className={cn(REJECT_BTN, 'h-12')}
                >
                  반려
                </button>
                <p role="status" className="mt-1 text-xs leading-relaxed text-content-faint">
                  {approving
                    ? '게시하고 안내 메일을 보내는 중입니다. 잠시만 기다려 주세요.'
                    : '승인하면 즉시 사이트에 게시되고 학생에게 안내 메일이 갑니다. ‘수정 후 게시’는 이 내용을 글 편집 화면으로 옮겨 엽니다.'}
                </p>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* 좁은 화면의 동작 — 하단 고정 바 */}
      {pending && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-border bg-surface px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 lg:hidden">
          {errorAlert && <div className="mb-3">{errorAlert}</div>}
          {approving && (
            <p role="status" className="mb-2 text-xs text-content-faint">
              게시하고 안내 메일을 보내는 중입니다. 잠시만 기다려 주세요.
            </p>
          )}
          <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-2">
            <button type="button" onClick={() => setRejectOpen(true)} disabled={locked} className={cn(REJECT_BTN, 'px-4')}>
              반려
            </button>
            <button type="button" onClick={onEdit} disabled={locked} className="cms-btn h-[52px] px-3.5 text-[15px]">
              수정 후 게시
            </button>
            <button
              type="button"
              onClick={() => void approve()}
              disabled={locked}
              aria-busy={approving || undefined}
              className="cms-btn-primary h-[52px] w-full px-3 text-[15px] font-bold disabled:opacity-100 dark:bg-brand dark:text-brand-fg"
            >
              {approveLabel}
            </button>
          </div>
        </div>
      )}

      {rejectOpen && (
        <RejectDialog
          postTitle={rec.titleKo}
          receiptNo={receipt}
          email={sub?.email ?? ''}
          onCancel={() => setRejectOpen(false)}
          onSubmit={reject}
        />
      )}
      {lightbox && poster && (
        <PosterLightbox src={poster.src} alt={posterText} onClose={() => setLightbox(false)} />
      )}
    </div>
  );
}

const REJECT_BTN =
  'cms-btn h-[52px] w-full border-[#b42318] text-[15px] text-[#b42318] hover:border-[#8f1c13] hover:bg-[#fdf3f2] hover:text-[#8f1c13] dark:border-[#fda29b] dark:text-[#fda29b] dark:hover:bg-[#f04438]/10';

function Card({ children }: { children: React.ReactNode }) {
  return <section className="border border-surface-border bg-surface p-5">{children}</section>;
}

function Dt({ children }: { children: React.ReactNode }) {
  return <dt className="pt-px text-[12.5px] text-content-faint">{children}</dt>;
}

function Dd({ children }: { children: React.ReactNode }) {
  return <dd className="min-w-0 break-words text-content">{children}</dd>;
}

/** 학생이 입력한 심사 정보 — 포스터에 찍힌 문구와 같은 함수(committeeEntry·formatWhen)로 적는다 */
function NoticeTable({ notice, program }: { notice: ThesisNoticeInput; program: string }) {
  const members = memberEntries(notice);
  const year = /^\d{4}/.exec(notice.date)?.[0];
  const when = formatWhen(notice.date, notice.time);
  const rows: [string, React.ReactNode][] = [
    ['과정', program || '—'],
    ['논문 제목', notice.title || '—'],
    ['심사위원장', notice.chair.name ? committeeEntry(notice.chair) : '—'],
    [
      '심사위원',
      members.length > 0 ? (
        <ul>
          {members.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : (
        '—'
      ),
    ],
    ['심사 일시', when ? `${year ? `${year}년 ` : ''}${when}` : [notice.date, notice.time].filter(Boolean).join(' ') || '—'],
    ['장소', notice.place || '—'],
  ];
  return (
    <table className="w-full border-t-2 border-yonsei-navy text-sm sm:text-[15px]">
      <caption className="sr-only">심사 정보</caption>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th
              scope="row"
              className="w-24 border-b border-surface-border bg-surface-soft px-2.5 py-3 text-left align-top text-[13px] font-semibold text-content sm:w-[168px] sm:px-[18px] sm:py-3.5 sm:text-sm"
            >
              {label}
            </th>
            <td className="border-b border-surface-border px-3 py-3 align-top leading-relaxed text-content-soft sm:px-[18px] sm:py-3.5">
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 결정이 끝난 제출 — 반려 사유·보낸 메시지·메일 발송 여부를 그대로 보여 준다 */
function DecisionRecord({
  status,
  review,
}: {
  status: ReviewStatus;
  review?: ThesisReview;
}) {
  const r = review ?? {};
  const rejected = status === 'rejected';
  return (
    <Card>
      <h2 className="text-[15px] font-bold text-content">{rejected ? '반려 기록' : '처리 기록'}</h2>
      <dl className="mt-3.5 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13.5px]">
        {rejected && (
          <>
            <Dt>사유</Dt>
            <Dd>{r.rejectReason || '—'}</Dd>
            <Dt>보낸 메시지</Dt>
            <Dd>
              <span className="whitespace-pre-line">{r.rejectMessage || '—'}</span>
            </Dd>
          </>
        )}
        <Dt>{rejected ? '반려 시각' : '게시 시각'}</Dt>
        <Dd>
          <span className="tabular-nums">{r.decidedAt ? kstStamp(r.decidedAt) : '—'}</span>
        </Dd>
        <Dt>처리</Dt>
        <Dd>{r.decidedBy || '—'}</Dd>
        <Dt>{rejected ? '알림 메일' : '안내 메일'}</Dt>
        <Dd>
          {r.mailSent === true ? (
            '보냄'
          ) : r.mailSent === false ? (
            <span className="font-semibold text-[#b42318] dark:text-[#fda29b]">보내지 못함 — 학생에게 직접 알려 주세요</span>
          ) : (
            '—'
          )}
        </Dd>
      </dl>
    </Card>
  );
}
