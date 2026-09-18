/**
 * 공고 제출의 이메일 단위 제한 — **메모리 전용**(ip-limit.ts 와 같은 globalThis 패턴).
 *
 * 창 1시간에 5회(SUBMIT_MAX_PER_EMAIL). 본인 확인을 마친 학생이 실수로 같은 공고를 여러 번
 * 내거나, 세션 쿠키 하나로 게시판 검토 대기열을 채우는 것을 막는다. 정상 사용(공고 한 건,
 * 고쳐서 한두 번 더)은 걸리지 않는 값이다.
 *
 * 한계(의도적으로 받아들임 — ip-limit.ts 와 같다): 재시작하면 초기화되고, pm2 cluster 처럼
 * 워커가 여럿이면 워커마다 따로 센다. DB 에 기록을 따로 두지 않는 이유는 제출 자체가
 * posts 행으로 남기 때문이다(학과가 보는 검토 대기 목록이 곧 기록이다).
 */
import { SUBMIT_MAX_PER_EMAIL, SUBMIT_WINDOW_MS } from './config';

const GLOBAL_KEY = '__thesisSubmitNoticeHits';
type GlobalWithHits = typeof globalThis & { [GLOBAL_KEY]?: Map<string, number[]> };

function hitsMap(): Map<string, number[]> {
  const g = globalThis as GlobalWithHits;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY];
}

/** 오래된 기록 청소 — 맵이 커질 때만 */
function sweep(map: Map<string, number[]>, now: number) {
  if (map.size < 1000) return;
  for (const [email, hits] of map) {
    const live = hits.filter((t) => now - t < SUBMIT_WINDOW_MS);
    if (live.length) map.set(email, live);
    else map.delete(email);
  }
}

/**
 * 제출 1회를 기록한다. 한도를 넘었으면 기록하지 않고 재시도까지 남은 초를 돌려준다.
 * @returns null = 통과(기록함) / number = 거절(retryAfter 초)
 */
export function takeSubmitSlot(email: string, now = Date.now()): number | null {
  const map = hitsMap();
  sweep(map, now);
  const hits = (map.get(email) ?? []).filter((t) => now - t < SUBMIT_WINDOW_MS);
  if (hits.length >= SUBMIT_MAX_PER_EMAIL) {
    map.set(email, hits);
    return Math.max(1, Math.ceil((hits[0] + SUBMIT_WINDOW_MS - now) / 1000));
  }
  hits.push(now);
  map.set(email, hits);
  return null;
}

/** 저장이 실패한 제출의 기록을 되돌린다 — 서버 탓으로 실패한 시도가 한도를 깎지 않게 */
export function releaseSubmitSlot(email: string, at: number): void {
  const map = hitsMap();
  const hits = map.get(email);
  if (!hits) return;
  const i = hits.lastIndexOf(at);
  if (i >= 0) hits.splice(i, 1);
  if (hits.length) map.set(email, hits);
  else map.delete(email);
}
