'use client';

// 학생 제출이 들어오는 게시판(학위논문심사)의 목록 조각 — 디자인 A1~A3.
//
//   · ReviewFilterTabs : 전체 / 승인 대기 N / 게시됨 / 반려
//   · ThesisRows       : 공지형 행 목록(BoardEditor 의 NoticeRows)과 같은 문법에
//                        제출 상태별 행(승인 대기·반려)을 더한 것
//   · ReviewEmptyState : 필터 결과가 0건일 때
//
// 게시된 글의 행은 NoticeRows 와 같은 모양·같은 동작(고정·수정·삭제)이다. 다른 게시판의
// 목록을 건드리지 않으려고 NoticeRows 를 분기하지 않고 여기 따로 둔다.
// 상태는 글자로도 전한다(배지 문구·"게시 전") — 색만으로 구분하지 않는다.

import { cn } from '@/lib/utils';
import type { ReviewStatus } from '@/lib/thesis-submit/review';
import type { ApiRecord } from '../BoardEditor';
import { IcoInbox } from '../cms-icons';
import {
  REVIEW_FILTERS,
  kstDay,
  kstShortStamp,
  reviewStatusOf,
  type ReviewFilter,
} from './review-model';

/** 상태 배지 — 금색 금지(블루 테두리가 '승인 대기'). 검토 화면 머리에서도 쓴다 */
export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  if (status === 'pending') {
    return (
      <span className="cms-badge border border-yonsei-blue bg-surface text-yonsei-blue dark:border-brand dark:text-brand">
        승인 대기
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="cms-badge bg-[#fdf3f2] text-[#b42318] dark:bg-[#f04438]/10 dark:text-[#fda29b]">
        반려
      </span>
    );
  }
  return <span className="cms-badge bg-yonsei-navy/10 text-yonsei-navy dark:bg-brand/15 dark:text-brand">게시됨</span>;
}

// ─────────────────────────────────────────────────────────────
// 필터 탭
// ─────────────────────────────────────────────────────────────

export function ReviewFilterTabs({
  value,
  pendingCount,
  onChange,
}: {
  value: ReviewFilter;
  pendingCount: number;
  onChange: (f: ReviewFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="상태로 거르기"
      className="mb-4 grid w-full grid-cols-4 border border-surface-border sm:inline-grid sm:w-auto sm:auto-cols-max sm:grid-flow-col sm:grid-cols-none"
    >
      {REVIEW_FILTERS.map((f, i) => {
        const on = value === f.key;
        const count = f.key === 'pending' ? pendingCount : 0;
        return (
          <button
            key={f.key}
            type="button"
            aria-pressed={on}
            aria-label={count > 0 ? `${f.label} ${count}건` : undefined}
            onClick={() => onChange(f.key)}
            className={cn(
              'inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap px-1 text-[13px] transition-colors duration-200 ease-out-expo sm:px-[18px]',
              i > 0 && 'border-l border-surface-border',
              on
                ? 'bg-yonsei-navy font-bold text-white dark:bg-brand dark:text-brand-fg'
                : 'bg-surface font-medium text-content hover:bg-surface-soft',
            )}
          >
            {f.label}
            {count > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  'inline-flex h-5 min-w-[20px] items-center justify-center px-1.5 text-[11px] font-bold tabular-nums',
                  on
                    ? 'bg-white text-yonsei-navy dark:bg-brand-fg dark:text-brand'
                    : 'bg-yonsei-navy text-white dark:bg-brand dark:text-brand-fg',
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 빈 상태
// ─────────────────────────────────────────────────────────────

const EMPTY_COPY: Record<Exclude<ReviewFilter, 'all'>, { title: string; body: string }> = {
  pending: {
    title: '확인할 제출이 없습니다.',
    body: '학생이 공고를 제출하면 이곳에 ‘승인 대기’로 들어옵니다.',
  },
  approved: {
    title: '게시된 글이 없습니다.',
    body: '승인한 공고와 직접 쓴 글이 이곳에 모입니다.',
  },
  rejected: {
    title: '반려한 제출이 없습니다.',
    body: '반려한 제출은 사유와 함께 이곳에 남습니다.',
  },
};

export function ReviewEmptyState({
  filter,
  onShowAll,
}: {
  filter: Exclude<ReviewFilter, 'all'>;
  onShowAll: () => void;
}) {
  const copy = EMPTY_COPY[filter];
  return (
    <div className="anim-panel mt-4 border border-dashed border-surface-border bg-[#fcfdfe] px-6 py-16 text-center dark:bg-surface-soft">
      <IcoInbox size={28} className="mx-auto text-content-faint" />
      <p className="mt-3 text-base font-bold text-content">{copy.title}</p>
      <p className="mx-auto mt-2 max-w-[40ch] text-[13px] leading-[1.7] text-content-faint">{copy.body}</p>
      <button type="button" onClick={onShowAll} className="cms-btn cms-btn-sm mt-5">
        전체 글 보기
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 행 목록
// ─────────────────────────────────────────────────────────────

/** BoardEditor 의 ListItem 과 같은 모양(그쪽은 내보내지 않는 내부 타입이라 구조로 맞춘다) */
export interface ThesisListItem {
  id: string;
  date: string;
  titleKo: string;
  scheduled: boolean;
  rec: ApiRecord;
}

interface RowsProps {
  items: ThesisListItem[];
  selected: Set<string>;
  busy: boolean;
  saving: boolean;
  /** 방금 승인한 글 — '방금 게시' 표시와 옅은 강조 */
  justPublished: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string, pin: boolean) => void;
  onReview: (id: string) => void;
}

/** HTML 본문 → 한 줄 텍스트(행의 보조 설명) — BoardEditor 의 plainText 와 같은 규칙 */
function plainText(html: string, max = 90): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const LINK_BTN =
  'text-xs font-semibold text-yonsei-blue transition-colors hover:text-yonsei-navy disabled:opacity-40 dark:text-brand';
const DELETE_BTN =
  'text-xs font-semibold text-[#b42318] transition-colors hover:underline disabled:opacity-40 dark:text-[#fda29b]';

export function ThesisRows({
  items,
  selected,
  busy,
  saving,
  justPublished,
  onToggle,
  onEdit,
  onDelete,
  onTogglePin,
  onReview,
}: RowsProps) {
  return (
    <div className="anim-panel">
      {/* 헤더 위 네이비 2px 룰 — 사이트 본문 표와 같은 문법(NoticeRows 와 동일) */}
      <div className="flex items-center gap-4 border-t-2 border-yonsei-navy px-1.5 py-2.5 text-[11px] font-bold text-content-faint">
        <span className="w-4 shrink-0" aria-hidden="true" />
        <span className="w-[92px] shrink-0">게시일</span>
        <span className="min-w-0 flex-1">제목</span>
        <span className="hidden w-[120px] shrink-0 text-right sm:block">관리</span>
      </div>

      <ul>
        {items.map((item) => {
          const { rec } = item;
          const status = reviewStatusOf(rec);
          const sub = rec.submission;
          const isSel = selected.has(item.id);
          const fresh = justPublished.has(item.id);
          const rowCls = cn(
            'flex items-center gap-4 border-b border-surface-border px-1.5 py-3.5 transition-colors',
            isSel ? 'bg-yonsei-blue/[0.04]' : fresh ? 'bg-yonsei-sky/10' : 'hover:bg-surface-soft',
          );
          const checkbox = (
            <input
              type="checkbox"
              checked={isSel}
              onChange={() => onToggle(item.id)}
              disabled={busy}
              aria-label={`${item.titleKo} 선택`}
              className="h-4 w-4 shrink-0 accent-yonsei-navy"
            />
          );

          // ── 승인 대기 — 게시 전. 행을 누르면 검토 화면으로 ──
          if (status === 'pending') {
            const who = [sub?.notice?.presenter, sub?.email].filter(Boolean).join(' · ');
            const received = sub?.submittedAt ? kstShortStamp(sub.submittedAt) : '';
            return (
              <li key={item.id} className={rowCls}>
                {checkbox}
                <span className="w-[92px] shrink-0 text-[11px] text-content-faint">게시 전</span>
                <button
                  type="button"
                  onClick={() => onReview(item.id)}
                  disabled={saving}
                  className="min-w-0 flex-1 text-left disabled:opacity-50"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <ReviewStatusBadge status="pending" />
                    <span className="truncate text-sm font-semibold text-content">{item.titleKo}</span>
                  </span>
                  {(who || received) && (
                    <span className="mt-1 flex flex-col text-[12px] leading-snug text-content-faint sm:flex-row sm:gap-x-1">
                      {who && <span className="min-w-0 truncate">{who}</span>}
                      {received && (
                        <span className="shrink-0 tabular-nums">
                          {who && <span className="hidden sm:inline">· </span>}
                          {received} 접수
                        </span>
                      )}
                    </span>
                  )}
                </button>
                <span className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onReview(item.id)}
                    disabled={saving}
                    aria-label={`${item.titleKo} 검토`}
                    className="inline-flex h-8 items-center border border-yonsei-blue px-3.5 text-xs font-bold text-yonsei-blue transition-colors hover:bg-yonsei-blue hover:text-white disabled:opacity-40 dark:border-brand dark:text-brand dark:hover:bg-brand dark:hover:text-brand-fg"
                  >
                    검토
                  </button>
                </span>
              </li>
            );
          }

          // ── 반려 — 사이트에 없고, 학생이 고쳐 다시 제출한다 ──
          if (status === 'rejected') {
            const review = sub?.review ?? {};
            const why = [review.rejectReason, review.rejectMessage ? clip(review.rejectMessage, 40) : '']
              .filter(Boolean)
              .join(' — ');
            const when = review.decidedAt ? `${kstDay(review.decidedAt)} 반려` : '';
            const mailFailed = review.mailSent === false;
            return (
              <li key={item.id} className={rowCls}>
                {checkbox}
                <span className="w-[92px] shrink-0 text-[11px] text-content-faint">
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">게시 안 됨</span>
                </span>
                <button
                  type="button"
                  onClick={() => onReview(item.id)}
                  disabled={saving}
                  className="min-w-0 flex-1 text-left disabled:opacity-50"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <ReviewStatusBadge status="rejected" />
                    <span className="truncate text-sm font-semibold text-content">{item.titleKo}</span>
                  </span>
                  {(why || when) && (
                    <span className="mt-1 flex flex-col text-[12px] leading-snug text-content-faint sm:flex-row sm:gap-x-1">
                      {why && <span className="min-w-0 truncate">{why}</span>}
                      {when && (
                        <span className="shrink-0 tabular-nums">
                          {why && <span className="hidden sm:inline">· </span>}
                          {when}
                          {mailFailed && (
                            <span className="text-[#b42318] dark:text-[#fda29b]"> · 알림 메일 못 보냄</span>
                          )}
                        </span>
                      )}
                    </span>
                  )}
                </button>
                <span className="flex shrink-0 items-center gap-3">
                  <button type="button" onClick={() => onReview(item.id)} disabled={saving} className={LINK_BTN}>
                    보기
                  </button>
                  <button type="button" onClick={() => onDelete(item.id)} disabled={saving} className={DELETE_BTN}>
                    삭제
                  </button>
                </span>
              </li>
            );
          }

          // ── 게시됨 — NoticeRows 의 행과 같은 모양·같은 동작 ──
          const attCount = (rec.attachments ?? []).filter((a) => a.href.trim() !== '').length;
          const text = plainText(rec.bodyKo ?? '');
          return (
            <li key={item.id} className={rowCls}>
              {checkbox}
              <span className="w-[92px] shrink-0 text-[11px] tabular-nums text-content-faint">{item.date}</span>
              <button
                type="button"
                onClick={() => onEdit(item.id)}
                disabled={saving}
                className="min-w-0 flex-1 text-left disabled:opacity-50"
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {rec.pinned && (
                    <span className="cms-badge border border-yonsei-navy/40 bg-yonsei-navy/[0.06] text-yonsei-navy">
                      고정
                    </span>
                  )}
                  {item.scheduled && (
                    <span className="cms-badge bg-yonsei-navy text-white">
                      예약 {item.date}
                      {rec.time ? ` ${rec.time}` : ''}
                    </span>
                  )}
                  <span className="truncate text-sm font-semibold text-content">{item.titleKo}</span>
                  {attCount > 0 && (
                    <span className="cms-badge bg-surface-soft text-content-faint">첨부 {attCount}</span>
                  )}
                  {fresh && (
                    <span className="text-[11px] font-bold text-yonsei-blue dark:text-brand">방금 게시</span>
                  )}
                </span>
                {text !== '' && <span className="mt-1 block truncate text-[11px] text-content-faint">{text}</span>}
              </button>
              <span className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => onTogglePin(item.id, !rec.pinned)}
                  disabled={saving}
                  className={cn(
                    'text-xs font-semibold transition-colors disabled:opacity-40',
                    rec.pinned
                      ? 'text-content-faint hover:text-content'
                      : 'text-yonsei-blue hover:text-yonsei-navy',
                  )}
                >
                  {rec.pinned ? '해제' : '고정'}
                </button>
                <button type="button" onClick={() => onEdit(item.id)} disabled={saving} className={LINK_BTN}>
                  수정
                </button>
                <button type="button" onClick={() => onDelete(item.id)} disabled={saving} className={DELETE_BTN}>
                  삭제
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
