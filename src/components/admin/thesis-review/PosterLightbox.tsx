'use client';

// 공고문(자동 생성 포스터) 원본 크게 보기.
//
// 미리보기의 포스터는 사이트 본문 폭으로 줄어 있어 작은 글자(심사위원 소속·장소 호수)를
// 대조하기 어렵다. 원본을 화면 가득 띄우고, 더 키워야 하면 새 탭으로 연다.
// CmsModal 은 확인 대화상자(제목·본문·두 버튼) 전용이라 쓰지 않고, 같은 규칙
// (Esc 로 닫기·배경 클릭 닫기·포커스 가두기·닫으면 원래 자리로 포커스 복귀)만 따른다.

import { useEffect, useId, useRef } from 'react';
import { IcoClose, IcoExternal } from '../cms-icons';

export function PosterLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = panelRef.current?.querySelectorAll<HTMLElement>('button, [href]');
      if (!f || f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
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
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-lenis-prevent
      className="fixed inset-0 z-[70] flex flex-col bg-[#0a1424]/90"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex shrink-0 items-center gap-2 px-4 py-3 text-white">
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold">
          공고문 원본
        </h2>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-1.5 border border-white/30 px-3 text-xs font-semibold text-white transition-colors hover:border-white"
        >
          <IcoExternal size={14} />
          새 탭에서 열기
        </a>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="inline-flex h-9 items-center gap-1.5 border border-white/30 px-3 text-xs font-semibold text-white transition-colors hover:border-white"
        >
          <IcoClose size={14} />
          닫기
        </button>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 pb-6"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 업로드된 원본(R2) 그대로 */}
        <img src={src} alt={alt} className="max-h-full max-w-full bg-white object-contain" />
      </div>
    </div>
  );
}
