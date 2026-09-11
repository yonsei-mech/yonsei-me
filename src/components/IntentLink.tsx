'use client';

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Link, useRouter } from '@/i18n/navigation';

/**
 * 뷰포트 진입 prefetch 는 끄고, 사용자가 의도를 보일 때(호버·키보드 포커스·터치)만
 * prefetch 하는 Link. 숨겨 둔 채 항상 DOM 에 있는 메뉴 링크 전용이다.
 *
 * 왜: 헤더 메가메뉴는 `invisible opacity-0` 으로만 숨긴 fixed 패널이라 기하상 늘 뷰포트
 * 안에 있다. IntersectionObserver 는 visibility·opacity 를 보지 않으므로 Next 의 <Link> 가
 * 패널 속 링크 전부를 "보인다"고 판정해, 페이지뷰 1회마다 약 42개 라우트를 prefetch 했다
 * (프로덕션 실측, `?_rsc=` 요청 전부가 메뉴발). 1 vCPU 자체 호스팅에선 순수한 낭비다.
 * 그렇다고 prefetch={false} 만 주면 Next 14.2 App Router 에선 호버 prefetch 까지 꺼져
 * (link.js 의 onMouseEnter 가 !prefetchEnabled 면 조기 반환) 메뉴 클릭이 매번 콜드 로드가
 * 된다. 그래서 prefetch 는 끄고 의도 신호가 올 때마다 router.prefetch 를 직접 부른다.
 *
 * - 의도 신호마다 불러도 된다(1회로 막지 않는다). 라우터 캐시에 유효한 항목이 있으면 Next 가
 *   그 항목을 그대로 돌려주고 네트워크 요청을 내지 않는다(prefetch-cache-utils.js 의
 *   getOrCreatePrefetchCacheEntry). 만료돼 정리된 뒤에만 다시 받아 오므로, Next 자체 호버
 *   prefetch 와 같은 동작이다. 1회로 막으면 헤더가 레이아웃에 상주해 오래 머문 세션에서
 *   캐시 만료(기본 5분) 뒤 클릭이 도로 콜드 로드가 된다.
 * - dev 에선 router.prefetch 자체가 no-op 이다(Next 가 컴파일 부담 때문에 막음) — 효과 확인은 프로덕션 빌드로.
 * - locale 을 지정한 링크는 건너뛴다: next-intl 의 router.prefetch 에 locale 을 넘기면 로케일
 *   쿠키를 써 버리고, next-intl Link 도 로케일 전환 링크는 prefetch 를 끈다.
 * - href 가 UrlObject 면 router.prefetch 타입과 맞지 않아 건너뛴다(메뉴 href 는 전부 문자열).
 */
export const IntentLink = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<typeof Link>>(
  function IntentLink({ href, onMouseEnter, onFocus, onTouchStart, ...rest }, ref) {
    const router = useRouter();

    function prefetch() {
      if (typeof href !== 'string' || rest.locale != null) return;
      router.prefetch(href);
    }

    return (
      <Link
        ref={ref}
        href={href}
        {...rest}
        prefetch={false}
        onMouseEnter={(e) => {
          onMouseEnter?.(e);
          prefetch();
        }}
        onFocus={(e) => {
          onFocus?.(e);
          prefetch();
        }}
        onTouchStart={(e) => {
          onTouchStart?.(e);
          prefetch();
        }}
      />
    );
  },
);
