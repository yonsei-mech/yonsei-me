import { kstDate } from '@/lib/utils';

/**
 * 게시물 'N'(새 글) 배지 규칙 — 홈 공지 섹션·게시판 목록·자료실이 공유하는 단일 출처.
 * React 를 들이지 않는 순수 모듈이라 서버·클라이언트 어디서든 불러도 된다.
 *
 * ⚠️ `now` 는 반드시 클라이언트에서 마운트 후에 잡아 넘긴다. 서버에서 계산하면 정적/ISR
 * HTML 에 생성 시각이 굳어 버리고, 첫 렌더에서 Date.now() 를 부르면 서버 HTML 과 달라져
 * 하이드레이션 불일치가 난다(호출부는 `useState<number|null>(null)` + 마운트 이펙트 패턴).
 */

/** 새 글로 보는 기간(일) — 오늘을 포함해 이 일수 안에 게시된 글. */
export const NEW_POST_DAYS = 7;

/**
 * 게시일(`YYYY-MM-DD…`)이 오늘(KST)로부터 NEW_POST_DAYS 일 이내인가 — 오늘 + 앞선 6일.
 *
 * 타임스탬프가 아니라 **KST 달력 날짜끼리** 비교한다. `Date.parse('YYYY-MM-DD')` 는 UTC 자정,
 * 곧 KST 오전 9시라서, 예전처럼 `now - Date.parse(date)` 로 재면 배지가 자정이 아니라
 * 아침 9시에 꺼졌다(같은 날짜의 글이 시각에 따라 새 글이었다 아니었다 한다).
 *
 * 미래 날짜는 일부러 제외한다. 행사 게시판(과 동문 행사글) 행은 게시일이 아니라 **행사일**을
 * date 로 싣는다(posts.ts 의 dateOf) — 두 달 뒤 행사를 오늘 등록하면 두 달 넘게 N 이 붙어
 * 있게 된다. 행사가 아닌 게시판은 예약 게시 게이트가 미래 글을 숨기므로 미래 날짜가 없다.
 * 날짜가 없거나 형식이 깨졌으면 false.
 */
export function isNewPost(date: string | undefined, now: number): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return false;
  const today = kstDate(new Date(now).toISOString());
  const diff = (Date.parse(today) - Date.parse(date.slice(0, 10))) / 86400000;
  return diff >= 0 && diff < NEW_POST_DAYS;
}
