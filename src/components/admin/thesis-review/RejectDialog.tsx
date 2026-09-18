'use client';

// 반려 대화상자(디자인 C1) — 사유 + 학생에게 보낼 메시지. 확인하면 학생에게 메일이 간다.
//
// 콘솔 공용 모달(CmsModal)을 그대로 쓴다: 포커스 가두기·Esc·배경 클릭은 거기서 오고,
// 좁은 화면에서는 하단 시트(sheet)로 뜬다. 요청 중에는 두 버튼이 잠기고 닫히지 않는다 —
// 반려와 메일은 서버에서 한 번에 처리되므로, 결과를 모른 채 닫으면 "보냈는지"를 알 수 없다.
//
// 메시지는 사유가 '기타'일 때만 필수다(서버 rejectSubmission 과 같은 규칙) — 다른 사유는
// 사유 자체가 "무엇을 고쳐 다시 내면 되는가"를 말하고, 메시지는 그 보충이다.

import { useEffect, useId, useRef, useState } from 'react';
import { REJECT_MESSAGE_MAX, REJECT_REASONS, type RejectReason } from '@/lib/thesis-submit/review';
import { CmsModal } from '../CmsModal';
import { IcoMail } from '../cms-icons';

interface Props {
  /** '[260422] 홍길동' */
  postTitle: string;
  receiptNo: string;
  /** 학생 연락 이메일 — 비어 있으면(깨진 기록) 메일을 보낼 곳이 없다고 말한다 */
  email: string;
  onCancel: () => void;
  /** 반려 요청. 실패하면 던진다 — 대화상자가 문구를 띄우고 다시 시도할 수 있게 남는다 */
  onSubmit: (reason: RejectReason, message: string) => Promise<void>;
}

export function RejectDialog({ postTitle, receiptNo, email, onCancel, onSubmit }: Props) {
  const reasonId = useId();
  const messageId = useId();
  const hintId = useId();
  const errorId = useId();
  const [reason, setReason] = useState<RejectReason>(REJECT_REASONS[0]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // CmsModal 은 확인 버튼에 포커스를 준다 — 여기는 입력이 먼저라 사유 칸으로 옮긴다.
  // (자식 효과가 먼저 돌고 이 효과가 뒤에 돌아서 덮어쓴다.)
  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  async function submit() {
    if (busy) return;
    const text = message.trim();
    if (reason === '기타' && text === '') {
      setError('사유가 ‘기타’이면 학생에게 보낼 메시지를 꼭 적어 주세요 — 무엇을 고쳐 다시 제출하면 되는지.');
      messageRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason, text);
      // 성공하면 부모가 이 대화상자를 닫는다(언마운트) — 여기서 상태를 되돌리지 않는다
    } catch (err) {
      setError(err instanceof Error ? err.message : '반려하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setBusy(false);
    }
  }

  return (
    <CmsModal
      title="반려할까요?"
      sheet
      tone="danger-fill"
      busy={busy}
      confirmLabel={busy ? '보내는 중…' : '반려하고 알림 보내기'}
      onConfirm={() => void submit()}
      onCancel={onCancel}
      body={
        <div className="flex flex-col gap-5">
          <p className="-mt-1 text-[13px] text-content-faint">
            {postTitle} · <span className="tabular-nums">{receiptNo}</span>
          </p>

          <div>
            <label htmlFor={reasonId} className="mb-2 block text-[13px] font-bold text-content">
              반려 사유
            </label>
            <select
              ref={reasonRef}
              id={reasonId}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value as RejectReason);
                if (error) setError(null);
              }}
              disabled={busy}
              className="cms-input"
            >
              {REJECT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <label htmlFor={messageId} className="text-[13px] font-bold text-content">
                학생에게 보낼 메시지
                <span className="ml-1.5 text-xs font-normal text-content-faint">
                  {reason === '기타' ? '(필수)' : '(선택)'}
                </span>
              </label>
              <span className="text-[11px] tabular-nums text-content-faint">
                {message.length} / {REJECT_MESSAGE_MAX}
              </span>
            </div>
            <textarea
              ref={messageRef}
              id={messageId}
              rows={5}
              value={message}
              maxLength={REJECT_MESSAGE_MAX}
              onChange={(e) => {
                setMessage(e.target.value);
                if (error) setError(null);
              }}
              disabled={busy}
              placeholder="수정해서 다시 제출해 주세요…"
              aria-describedby={error ? `${hintId} ${errorId}` : hintId}
              aria-required={reason === '기타'}
              aria-invalid={error !== null && reason === '기타' && message.trim() === '' ? true : undefined}
              className="cms-input min-h-[116px] resize-y leading-relaxed"
            />
          </div>

          <p id={hintId} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-content-faint">
            <IcoMail size={16} className="mt-0.5 shrink-0" />
            {email ? (
              <span>
                이 내용이 <strong className="font-bold text-content">{email}</strong> 로 발송됩니다.
              </span>
            ) : (
              <span>제출 기록에 학생 이메일이 없어 알림 메일을 보낼 수 없습니다. 반려만 기록됩니다.</span>
            )}
          </p>

          {error && (
            <p
              id={errorId}
              role="alert"
              className="border border-[#b42318]/30 bg-[#fdf3f2] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#b42318] dark:border-[#fda29b]/40 dark:bg-[#f04438]/10 dark:text-[#fda29b]"
            >
              {error}
            </p>
          )}
        </div>
      }
    />
  );
}
