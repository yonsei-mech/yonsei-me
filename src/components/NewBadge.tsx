import type { ReactNode } from 'react';
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

/**
 * 제목 + 'N' 배지 — 배지를 제목 텍스트 **바로 뒤**에 인라인으로 붙인다.
 * 제목과 배지를 flex 형제로 두면 제목이 두 줄로 접힐 때 제목이 가용 폭을 다 먹어
 * 배지가 행 오른쪽 끝까지(실측 244px) 밀려 제목과 한참 떨어져 보이기 때문.
 * label 이 없으면(= 새 글이 아니면) 제목 문자열을 그대로 돌려준다 — 감싸개도 만들지 않는다.
 *
 * 접착 규칙: 마지막 어절이 짧으면(1~12자) 그 어절과 배지를 whitespace-nowrap 으로 묶어
 * 배지 혼자 다음 줄에 떨어지는 꼴을 막는다. 어절이 그보다 길면(긴 영문 단어·URL) 묶지
 * 않는다 — 묶으면 그 긴 덩어리가 통째로 다음 줄로 내려가 앞 줄이 크게 비어 버린다.
 * 길이는 Array.from 으로 코드 포인트를 세어 한글·이모지가 섞여도 눈에 보이는 길이에 맞춘다.
 */
export function TitleWithNewBadge({
  title,
  label,
}: {
  title: string;
  label?: string;
}): ReactNode {
  if (!label) return title;

  const badge = <NewBadge label={label} className="ml-2 align-middle" />;
  const cut = title.lastIndexOf(' ');
  const tail = cut === -1 ? '' : title.slice(cut + 1);

  if (tail && Array.from(tail).length <= 12) {
    return (
      <>
        {/* 마지막 공백까지 앞쪽에 남겨 원문 공백을 그대로 보존한다 */}
        {title.slice(0, cut + 1)}
        <span className="whitespace-nowrap">
          {tail}
          {badge}
        </span>
      </>
    );
  }

  return (
    <>
      {title}
      {badge}
    </>
  );
}
