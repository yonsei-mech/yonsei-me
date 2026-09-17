'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NewBadge, TitleWithNewBadge } from '@/components/NewBadge';

// SSR 에서 useLayoutEffect 경고를 피하는 동형 훅 (LandingScope 와 동일 관례)
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * 게시판 목록의 제목 칸 — 'N'(새 글) 배지를 제목 텍스트 바로 뒤에 인라인으로 붙인다.
 *
 * 인라인만으로는 부족한 경우가 하나 있다: 제목이 line-clamp-2 로 **말줄임된** 행.
 * 그때는 배지가 잘려 나간 꼬리와 함께 사라지므로, 넘칠 때만 첫 줄 오른쪽에 폴백 배지를
 * 하나 더 세운다(예전 자리). 모바일(390·768)에서는 세미나 제목 10건 중 6건이 클램프돼
 * 폴백이 없으면 그 6건에서 배지가 통째로 사라진다.
 *
 * 인라인 배지는 넘치든 말든 **항상 DOM 에 둔다**:
 *  - 넘치면 어차피 클램프에 가려 화면엔 폴백 하나만 보인다,
 *  - h3 내용이 상태에 따라 바뀌지 않으니 측정 → 리렌더 → 재측정이 진동하지 않는다,
 *  - 스크린리더는 인라인 것 하나만 읽는다(폴백은 aria-hidden).
 */
export function BoardTitle({ title, newLabel }: { title: string; newLabel?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [overflow, setOverflow] = useState(false);

  useIsoLayoutEffect(() => {
    // 배지가 없으면 폴백도 없으므로 측정 자체가 필요 없다
    if (!newLabel) return;
    const el = ref.current;
    if (!el) return;

    const check = () => setOverflow(el.scrollHeight > el.clientHeight + 1);
    check();

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(check);
      observer.observe(el);
    }
    // 폰트 스왑으로 줄바꿈 위치가 바뀌면 클램프 여부도 뒤집힌다
    void document.fonts?.ready.then(check);

    return () => observer?.disconnect();
  }, [newLabel, title]);

  return (
    <div className="flex items-start gap-2 text-base leading-snug sm:text-lg">
      <h3
        ref={ref}
        className="line-clamp-2 min-w-0 font-bold tracking-tight text-content transition-colors group-hover:text-yonsei-blue"
      >
        <TitleWithNewBadge title={title} label={newLabel} />
      </h3>
      {newLabel && overflow && (
        // 폴백은 **마지막 줄** 끝에 세운다(self-end). 말줄임된 제목은 마지막 줄이 말줄임표까지
        // 꽉 차 있어 그 끝이 곧 보이는 제목의 끝이다. 첫 줄 끝에 두면 첫 줄이 어디서 접혔느냐에
        // 따라 최대 113px 까지 떨어져 보인다(390 폭 실측) — 이번에 고치려던 바로 그 증상.
        // 배지 칸 높이를 제목 한 줄 높이(1lh)에 맞춰 그 줄 가운데에 선다.
        // em 고정값(1.375em)을 쓰지 않는 이유: sm:text-lg 가 행간을 1.75rem 으로 덮어써
        // sm 이상에서는 한 줄이 1.375em 이 아니다(16px→22px, 18px→28px).
        <span aria-hidden="true" className="flex h-[1lh] shrink-0 items-center self-end">
          <NewBadge label={newLabel} />
        </span>
      )}
    </div>
  );
}
