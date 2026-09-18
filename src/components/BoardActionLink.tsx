import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * 게시판 목록의 선택 진입 버튼 — 지금은 학위논문심사 목록의 "예비심사 공고 등록"뿐이다
 * (디자인 원본: files/학위논문심사 공고 등록 디자인/spec.md §2 화면 A).
 * 문구는 서버 페이지가 자기 네임스페이스에서 읽어 넘긴다 — 클라이언트 메시지 화이트리스트에
 * 게시판별 네임스페이스를 넣으면 전 페이지 RSC 페이로드에 실린다.
 */
export interface BoardAction {
  /** 로케일 접두사 없는 경로(선행 슬래시 포함) — 로케일 인지 Link 가 접두사를 붙인다 */
  href: string;
  /** 버튼 이름 */
  label: string;
  /** 버튼 아래 보조 문구 — 툴바 버튼에 aria-describedby 로 묶인다 */
  note: string;
  /** 목록이 비었을 때의 안내(검색 결과 0건에는 쓰지 않는다 — 그건 검색이 빗나간 것) */
  emptyLabel: string;
}

/**
 * 테두리형 버튼 — 면 채움 금지(호버만 옅은 면). 목록보다 튀지 않게 한다.
 * 선·글자는 --brand(라이트 #003377 / 다크 #60A5FA), 포커스 링은 강조색 2px + offset 2px.
 */
const BASE =
  'items-center justify-center gap-1.5 whitespace-nowrap rounded-[2px] border border-brand font-bold leading-none tracking-[-0.01em] text-brand transition-colors hover:bg-surface-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue dark:focus-visible:outline-brand';

/**
 * - toolbar-mobile: lg 미만 — h1 아래 전체 폭, 높이 48, 15px.
 * - toolbar-desktop: lg 이상 — 검색 줄 오른쪽 끝, 높이는 부모 줄에 늘여 검색 입력과 같게, 13.5px.
 * - empty: 빈 목록 카드 안 — 내용 폭, 높이 48(모바일) / 44(lg), 15px / 14px.
 * 툴바의 두 버튼은 브레이크포인트마다 하나만 보인다(display:none 은 탭 순서·접근성 트리에서 빠진다).
 * 한 버튼을 CSS 로 옮기지 않고 둘로 나눈 이유: 모바일은 [버튼 → 검색], 데스크톱은 [검색 → 버튼]
 * 순서라 DOM 하나로는 한쪽의 포커스 순서가 시각 순서와 어긋난다.
 */
const VARIANT = {
  'toolbar-mobile': 'flex h-12 w-full px-4 text-[15px] lg:hidden',
  'toolbar-desktop': 'hidden px-4 text-[13.5px] lg:flex',
  empty: 'mt-1 inline-flex h-12 px-5 text-[15px] lg:h-11 lg:text-[14px]',
} as const;

const ICON = {
  'toolbar-mobile': 'h-4 w-4',
  'toolbar-desktop': 'h-3.5 w-3.5',
  empty: 'h-4 w-4 lg:h-[15px] lg:w-[15px]',
} as const;

export function BoardActionLink({
  action,
  variant,
  describedBy,
}: {
  action: BoardAction;
  variant: keyof typeof VARIANT;
  /** 보조 문구 요소의 id */
  describedBy?: string;
}) {
  return (
    <Link
      href={action.href}
      // 대상이 요청마다 렌더하는 동적 페이지(쿠키 확인)라 뷰포트 진입 prefetch 를 하지 않는다
      prefetch={false}
      aria-describedby={describedBy}
      className={cn(BASE, VARIANT[variant])}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        className={cn('shrink-0', ICON[variant])}
      >
        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
      </svg>
      <span>{action.label}</span>
    </Link>
  );
}
