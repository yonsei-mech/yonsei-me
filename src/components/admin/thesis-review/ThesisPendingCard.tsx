'use client';

// 대시보드 "확인할 제출 N건" 카드(디자인 D1) — 0건이면 통째로 숨는다.
//
// 대시보드는 "무엇을 수정할까요?"의 첫 화면이다. 학생이 제출하고 기다리는 공고는
// 수정이 아니라 처리할 일이라 인사말 바로 아래, 최근 편집보다 위에 둔다.
// '검토하기'는 학위논문심사 목록을 '승인 대기' 필터로 연다(?status=pending 을 미리 심는다).

import { useId } from 'react';
import { getBoard } from '@/lib/admin/boards';
import type { MenuEntry } from '@/lib/admin/resources';
import { IcoArrowRight, IcoInbox } from '../cms-icons';
import { findEntry } from '../entries';
import { dayWithWeekday, REVIEW_BOARDS, REVIEW_ENTRY_ID, replaceReviewUrl } from './review-model';
import { useThesisSummary } from './summary-store';

export function ThesisPendingCard({ onOpen }: { onOpen: (entry: MenuEntry) => void }) {
  const titleId = useId();
  const summary = useThesisSummary({ refreshOnMount: true });
  const entry = findEntry(REVIEW_ENTRY_ID);
  if (!summary || summary.count === 0 || !entry) return null;

  const boardLabel = getBoard(REVIEW_BOARDS[0]).label;
  const { count, nearest } = summary;

  return (
    <section
      aria-labelledby={titleId}
      className="anim-panel flex flex-wrap items-center gap-x-4 gap-y-3 border border-surface-border bg-surface px-5 py-[18px] sm:flex-nowrap"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center bg-yonsei-navy text-white dark:bg-brand dark:text-brand-fg"
      >
        <IcoInbox size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-base font-bold text-content">
          확인할 제출 {count}건
          <span className="font-medium text-content-faint"> · {boardLabel}</span>
        </h2>
        {nearest && (
          <p className="mt-1 text-[13px] text-content-faint">
            가장 가까운 심사일 {dayWithWeekday(nearest.date)}
            {nearest.presenter && ` — ${nearest.presenter}`}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          // 목록을 '승인 대기'로 열도록 필터를 쿼리에 심고 이동한다(셸이 화면 쿼리를 이어 붙인다)
          replaceReviewUrl({ status: 'pending', review: null });
          onOpen(entry);
        }}
        className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-1.5 border border-yonsei-blue px-4 text-sm font-bold text-yonsei-blue transition-colors duration-200 ease-out-expo hover:bg-yonsei-blue hover:text-white dark:border-brand dark:text-brand dark:hover:bg-brand dark:hover:text-brand-fg sm:w-auto"
      >
        검토하기
        <IcoArrowRight size={16} />
      </button>
    </section>
  );
}
