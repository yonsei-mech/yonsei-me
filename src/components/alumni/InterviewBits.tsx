import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * 동문 인터뷰 화면의 작은 공용 조각 — 목록(클라이언트)과 상세(서버)가 같이 쓴다.
 * 서버 컴포넌트로 두어 양쪽에서 import 할 수 있게 한다(상태·이벤트가 없다).
 */

/**
 * 'more' 링크 — 남색 헤어라인 + Newsreader Italic 500.
 * 세리프 이탤릭 한 단어가 카드의 유일한 서체 대비이고, 그래서 이 서체만 따로
 * 자체 호스팅한다(globals.css 의 @font-face · LICENSES.md §1).
 * ⚠️ 링크가 아니라 span 이다 — 카드 전체가 이미 <Link> 라 중첩 앵커를 만들 수 없다.
 */
export function MoreLink({ label, size = 'sm' }: { label: string; size?: 'sm' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <span
      aria-hidden="true"
      style={{
        fontFamily: "'Newsreader', Georgia, 'Times New Roman', serif",
        fontStyle: 'italic',
      }}
      className={cn(
        'inline-flex items-center font-medium tracking-[0.02em] text-yonsei-navy',
        lg ? 'gap-3 text-[17px] md:text-[19px]' : 'gap-2.5 text-[16px]',
      )}
    >
      <span className={cn('block h-px bg-yonsei-navy', lg ? 'w-7 md:w-9' : 'w-7')} />
      {label}
    </span>
  );
}

/**
 * 카드 사진 — 없으면 옅은 파란 면 + 인물 실루엣(디자인 확정본의 플레이스홀더).
 * 사진이 비는 인터뷰가 실제로 있고(옮겨 온 구 글), 흰 공백보다 면이 목록을 정돈한다.
 */
export function InterviewPhoto({
  src,
  className,
  sizes,
  iconSize = 40,
  priority,
}: {
  src?: string;
  /** 바깥에서 비율·크기를 정한다(position: relative 를 포함할 것) */
  className?: string;
  sizes: string;
  iconSize?: number;
  priority?: boolean;
}) {
  return (
    <div className={cn('relative overflow-hidden bg-[#DEE5EE]', className)}>
      {src ? (
        <Image src={src} alt="" fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center">
          <svg
            aria-hidden="true"
            width={iconSize}
            height={iconSize}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#A9B8CB"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
          </svg>
        </span>
      )}
    </div>
  );
}
