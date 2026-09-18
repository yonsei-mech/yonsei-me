'use client';

// 콘솔 공용 확인 모달.
//
// window.confirm 을 대체한다. 브라우저 기본 대화상자는 (1) 사이트 시각 언어와
// 완전히 동떨어지고 (2) 문구를 두 줄 이상 다듬을 수 없으며 (3) "삭제" 같은 파괴적
// 동작을 시각적으로 구분해 줄 수 없다. 2~5단계의 삭제 확인·충돌 안내·미저장
// 이탈이 모두 이 컴포넌트를 재사용하므로 범용으로 둔다(제목/본문/버튼 라벨 주입).

import { useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface CmsModalProps {
  title: string;
  /** 문자열뿐 아니라 목록·강조가 섞인 본문도 받는다
   *  (예: 저장 충돌 안내에서 충돌한 파일 목록을 그대로 보여줘야 한다) */
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 'danger-fill' — 되돌릴 수 없고 바깥(학생)에 알림까지 나가는 동작(반려하고 알림 보내기).
   *  평소의 삭제 확인(danger)은 조용한 붉은 테두리, 이쪽은 붉은 면으로 무게를 구분한다. */
  tone?: 'default' | 'danger' | 'danger-fill';
  /** 처리 중 — 두 버튼을 잠그고 Esc·배경 클릭으로도 닫히지 않는다(요청 결과를 기다린다) */
  busy?: boolean;
  /** 좁은 화면(<sm)에서 가운데 상자 대신 하단 시트로 띄운다 — 입력 칸이 있는 대화상자용 */
  sheet?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CmsModal({
  title,
  body,
  confirmLabel,
  cancelLabel = '취소',
  tone = 'default',
  busy,
  sheet,
  onConfirm,
  onCancel,
}: CmsModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // 열릴 때 확인 버튼에 포커스 — 키보드만으로 바로 결정할 수 있게.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // Esc = 취소, Tab = 패널 안에서만 순환(포커스 트랩).
  // 요소가 두세 개뿐이라 라이브러리 없이 첫/마지막만 이어 붙여도 충분하다.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>('button, [href], input, textarea, select');
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, busy]);

  return (
    <div
      className={
        sheet
          ? 'fixed inset-0 z-[70] flex items-end justify-center bg-[#0f172a]/40 sm:items-center sm:p-6'
          : 'fixed inset-0 z-[70] flex items-center justify-center bg-[#0f172a]/40 p-6'
      }
      // 배경 클릭 = 취소. 패널 내부 클릭이 올라와 닫히지 않도록 target 을 확인한다.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          sheet
            ? 'anim-panel max-h-[92dvh] w-full overflow-y-auto border-t border-surface-border bg-surface px-4 pb-5 pt-6 shadow-[0_30px_60px_-30px_rgba(0,40,94,.6)] sm:w-[min(520px,100%)] sm:border-t-0 sm:p-7'
            : 'anim-panel w-[min(480px,100%)] bg-surface p-7 shadow-[0_30px_60px_-30px_rgba(0,40,94,.6)]'
        }
      >
        <h2 id={titleId} className="text-lg font-bold text-content">
          {title}
        </h2>
        <div className="mt-3 text-[13px] leading-[1.8] text-content-soft">{body}</div>
        {/* 하단 시트는 엄지가 닿는 쪽에 확인이 먼저 온다(보이는 순서만 — 탭 순서는 그대로) */}
        <div className={sheet ? 'mt-7 flex flex-row-reverse gap-2 sm:flex-row sm:justify-end' : 'mt-7 flex justify-end gap-2'}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={sheet ? 'cms-btn flex-1 sm:flex-none' : 'cms-btn'}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            className={cn(
              tone === 'danger'
                ? 'cms-btn-danger'
                : tone === 'danger-fill'
                  ? 'cms-btn-primary bg-[#b42318] hover:bg-[#8f1c13] dark:bg-[#f97066] dark:text-[#1a0604] dark:hover:bg-[#fda29b]'
                  : 'cms-btn-primary',
              sheet && 'flex-1 sm:flex-none',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
