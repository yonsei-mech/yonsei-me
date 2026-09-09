import { cn } from '@/lib/utils';

/**
 * 브랜드 로딩 인디케이터 — 회전하는 원형 링 가운데에 독수리 마스코트
 * (eagle.webp를 CSS 마스크로 파란 계열 색조 변경). 페이지 로딩(loading.tsx)과
 * 이미지 로딩 플레이스홀더 공용.
 * - decorative: 이미지 뒤에 깔리는 장식용이면 true (스크린리더 노출 안 함)
 * - prefers-reduced-motion: 링 회전 정지(정적 아크로 표시)
 */
export function EagleLoader({
  size = 96,
  decorative = false,
  className,
}: {
  size?: number;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <div
      {...(decorative ? { 'aria-hidden': true } : { role: 'status', 'aria-label': 'Loading' })}
      className={cn('relative inline-grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      {/* 회전 링 */}
      <span
        aria-hidden="true"
        className="absolute inset-0 animate-spin rounded-full border-[3px] border-yonsei-blue/20 border-t-yonsei-blue motion-reduce:animate-none"
      />
      {/* 독수리 실루엣 (파란 색조) */}
      <span
        aria-hidden="true"
        className="eagle-mask bg-yonsei-blue/80"
        style={{ width: size * 0.56, height: size * 0.56 }}
      />
    </div>
  );
}
