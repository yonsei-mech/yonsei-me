/**
 * 홈 '공지 & 일정' 공지 리스트가 한 탭에 보여 주는 행 수와, 서버가 미리 잘라 보낼
 * '최대 노출 집합'을 계산하는 순수 모듈.
 *
 * ⚠️ 이 파일에 'use client' 를 붙이면 안 된다 — 서버 컴포넌트([locale]/page.tsx)가
 * NOTICE_ROWS 를 읽는다. 클라이언트 모듈의 export 는 서버에서 실제 값이 아니라
 * 클라이언트 참조 프록시로 넘어와 프리렌더가 죽는다(calendar-kinds.ts 주석의 사고와 동일).
 *
 * 왜 서버에서 미리 자르나: 예전에는 공지 전량(수백 건)을 NoticeSection(클라이언트)에
 * props 로 넘기고 브라우저가 필터+slice 했다. 그 전량이 RSC 플라이트 페이로드로 HTML 에
 * 인라인돼 문서 크기를 크게 부풀렸는데, 화면에 나오는 것은 탭당 NOTICE_ROWS 건뿐이다.
 */

/** 목록에 노출할 공지 건수 — 1열로 펴면서 4건으로 줄였다(우열 일정 패널과 높이를 맞춘다). */
export const NOTICE_ROWS = 4;

/**
 * 클라이언트가 **어느 탭에서도** 그릴 수 있는 항목의 합집합만 남긴다.
 *
 * 클라이언트는 `(active==='all' ? items : items.filter(category===active)).slice(0, NOTICE_ROWS)`
 * 를 그린다. 그래서 남겨야 할 것은
 *   · 'all' 탭용: 선두 NOTICE_ROWS 건
 *   · 카테고리 탭용: 각 카테고리의 선두 NOTICE_ROWS 건
 * 뿐이고, 이 부분집합은 **원래 순서를 그대로 보존**하므로 어떤 탭이든 같은 필터+slice 를
 * 통과시키면 전량을 넘겼을 때와 글자 하나까지 같은 결과가 나온다(각 탭의 선두 N 건보다
 * 앞서는 같은 카테고리 항목은 정의상 존재하지 않는다).
 *
 * ⚠️ 탭 배지의 **건수**는 이 부분집합이 아니라 전량 기준이어야 화면이 그대로다.
 * 호출부가 `counts` 를 따로 계산해 NoticeSection 에 넘긴다.
 *
 * id 가 아니라 인덱스로 고르는 이유: 네 공지 게시판의 DB 연번이 서로 겹칠 수 있어
 * id 는 이 목록 안에서 유일하다는 보장이 없다.
 */
export function noticeDisplayUnion<T extends { category: string }>(
  items: readonly T[],
  categories: readonly string[],
): T[] {
  const keep = new Set<number>();
  for (let i = 0; i < items.length && i < NOTICE_ROWS; i++) keep.add(i);
  for (const category of categories) {
    let n = 0;
    for (let i = 0; i < items.length && n < NOTICE_ROWS; i++) {
      if (items[i].category !== category) continue;
      keep.add(i);
      n++;
    }
  }
  return items.filter((_, i) => keep.has(i));
}
