'use client';

// 선택 승인 확인(디자인 C3) — 여러 제출을 한 번에 게시한다.
//
// 일괄 승인은 검토 화면의 확인 항목을 거치지 않는다. 그 사실을 확인 버튼 바로 위에서
// 한 번 더 말해, 공고문을 열어 보지 않고 넘기는 일이 "몰라서"가 아니라 "알고서"가 되게 한다.

import { CmsModal } from '../CmsModal';
import { kstShortStamp } from './review-model';

export interface BulkApproveItem {
  id: string;
  title: string;
  /** 접수 시각 ISO — 없으면(제출 기록 없는 글) 표시하지 않는다 */
  submittedAt?: string;
}

/** 목록에 이름을 다 늘어놓는 한도 — 넘치면 '외 N건'으로 줄인다 */
const SHOWN = 6;

export function BulkApproveDialog({
  items,
  onConfirm,
  onCancel,
}: {
  items: BulkApproveItem[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const n = items.length;
  const shown = items.slice(0, SHOWN);
  return (
    <CmsModal
      title={`${n}건을 승인하고 게시할까요?`}
      confirmLabel={`${n}건 승인하고 게시`}
      onConfirm={onConfirm}
      onCancel={onCancel}
      body={
        <>
          <p>
            아래 제출이 즉시 사이트에 게시되고, 학생 {n}명에게 안내 메일이 갑니다.
          </p>
          <ul className="mt-3.5 border border-b-0 border-surface-border bg-surface-soft text-[13px]">
            {shown.map((it) => (
              <li
                key={it.id}
                className="flex items-baseline justify-between gap-3 border-b border-surface-border px-3.5 py-2.5"
              >
                <span className="min-w-0 truncate font-semibold text-content">{it.title}</span>
                {it.submittedAt && (
                  <span className="shrink-0 text-xs tabular-nums text-content-faint">
                    {kstShortStamp(it.submittedAt)} 접수
                  </span>
                )}
              </li>
            ))}
            {n > SHOWN && (
              <li className="border-b border-surface-border px-3.5 py-2.5 text-xs text-content-faint">
                외 {n - SHOWN}건
              </li>
            )}
          </ul>
          <p className="mt-3.5 text-xs text-content-faint">
            일괄 승인은 확인 항목을 거치지 않습니다. 공고문을 먼저 확인해 주세요.
          </p>
        </>
      }
    />
  );
}
