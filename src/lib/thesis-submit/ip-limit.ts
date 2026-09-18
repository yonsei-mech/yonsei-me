/**
 * 인증번호 발급의 IP 단위 제한 — **메모리 전용**.
 *
 * DB 에 IP 를 남기지 않는 이유: 개인정보 수집 항목을 늘리지 않기 위해서다(처리방침은
 * 방문자 기준으로 쓰여 있고, 이 기능이 IP 를 저장하면 항목을 새로 고지해야 한다).
 * 이메일 쿨다운(60초)이 같은 주소의 반복을 막고, 이 제한은 한 곳에서 여러 주소로
 * 퍼붓는 것을 막는다.
 *
 * 한계(의도적으로 받아들임):
 *  - 프로세스 메모리라 재시작하면 초기화되고, pm2 cluster 처럼 워커가 여럿이면 워커마다
 *    따로 센다(실효 한도 = 워커 수 × IP_MAX_REQUESTS).
 *  - IP 는 프록시 헤더(x-real-ip → x-forwarded-for 첫 값)를 믿는다. nginx 가 이 헤더를
 *    덮어써 줘야 위조를 막을 수 있다(Cafe24 cafe24-proxy.conf 확인 사항).
 *  - dev 에서 IP 헤더가 없으면 제한을 건너뛴다(로컬 브라우저 검증이 서로의 한도를 먹지
 *    않게). 프로덕션에서 헤더가 없으면 'unknown' 한 칸으로 묶어 센다.
 */
import { IP_MAX_REQUESTS, IP_WINDOW_MS } from './config';

const GLOBAL_KEY = '__thesisSubmitIpHits';
type GlobalWithHits = typeof globalThis & { [GLOBAL_KEY]?: Map<string, number[]> };

function hitsMap(): Map<string, number[]> {
  const g = globalThis as GlobalWithHits;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY];
}

/** 요청의 클라이언트 IP — 없으면 null */
export function clientIp(request: Request): string | null {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || null;
}

/** 오래된 기록 청소 — 맵이 커질 때만(요청마다 전수 순회하지 않게) */
function sweep(map: Map<string, number[]>, now: number) {
  if (map.size < 1000) return;
  for (const [ip, hits] of map) {
    const live = hits.filter((t) => now - t < IP_WINDOW_MS);
    if (live.length) map.set(ip, live);
    else map.delete(ip);
  }
}

/**
 * 발급 1회를 기록한다. 한도를 넘었으면 기록하지 않고 재시도까지 남은 초를 돌려준다.
 * @returns null = 통과(기록함) / number = 거절(retryAfter 초)
 */
export function takeIpSlot(request: Request, now = Date.now()): number | null {
  let ip = clientIp(request);
  // dev 의 로컬 브라우저 요청에도 Next 가 x-forwarded-for(::1)를 붙인다 — 루프백까지 세면
  // 화면 검증 몇 바퀴 만에 한도가 차 B4 에 갇힌다. 가짜 IP 헤더를 붙인 요청은 그대로 센다.
  if (process.env.NODE_ENV !== 'production' && (!ip || /^(::1|127\.|::ffff:127\.)/.test(ip))) {
    return null;
  }
  if (!ip) ip = 'unknown';
  const map = hitsMap();
  sweep(map, now);
  const hits = (map.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (hits.length >= IP_MAX_REQUESTS) {
    map.set(ip, hits);
    return Math.max(1, Math.ceil((hits[0] + IP_WINDOW_MS - now) / 1000));
  }
  hits.push(now);
  map.set(ip, hits);
  return null;
}
