import { cn } from '@/lib/utils';

/**
 * 'N'(새 글) 배지 — 홈 공지 섹션·게시판 목록·자료실 공용. 판정 규칙은 lib/new-post.ts.
 * 18px 정사각의 옅은 네이비 면 + 진한 N. 화면에는 글자 하나지만 스크린리더에는 label
 * (예: "새 글")을 읽힌다. 훅이 없어 서버·클라이언트 어느 트리에 놓여도 된다.
 */
export function NewBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-grid h-[18px] w-[18px] shrink-0 place-items-center bg-yonsei-navy/[0.12] text-[11px] font-bold leading-none text-yonsei-navy',
        className,
      )}
    >
      N<span className="sr-only">{label}</span>
    </span>
  );
}
