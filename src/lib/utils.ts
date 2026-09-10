/**
 * 조건부 className 병합 (경량 clsx 대체).
 * 문자열/불린/객체를 받아 truthy 클래스만 공백으로 join.
 */
type ClassValue = string | number | null | false | undefined | Record<string, boolean>;

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === 'string' || typeof input === 'number') {
      out.push(String(input));
    } else if (typeof input === 'object') {
      for (const [key, value] of Object.entries(input)) {
        if (value) out.push(key);
      }
    }
  }
  return out.join(' ');
}

/** 학부 대표 국번 — 내선만 적힌 값을 완전한 번호로 되살릴 때 붙인다.
 *  교수진 디렉터리의 번호가 모두 이 국번이라 근거가 있다(내선 5건을 대조해 확인). */
const DEPT_PREFIX = '02)2123-';

/** 번호 한 개를 `02)2123-4567` 꼴로 맞춘다. 판단이 안 서면 원문 그대로 둔다. */
function normalizeOnePhone(raw: string): string {
  const v = raw.replace(/\s+/g, '');
  if (!v) return raw.trim();
  // +82-2-2123-4567 → 국내 표기로
  const intl = /^\+82-?0?(\d{1,2})-?(\d{3,4})-?(\d{4})$/.exec(v);
  if (intl) return `0${intl[1]})${intl[2]}-${intl[3]}`;
  // 이미 `02)2123-4567` · `032)749-3122` 꼴이면 그대로
  if (/^\d{2,3}\)\d{3,4}-\d{4}$/.test(v)) return v;
  // 02-2123-4567 → 02)2123-4567
  const dashed = /^(\d{2,3})-(\d{3,4})-(\d{4})$/.exec(v);
  if (dashed) return `${dashed[1]})${dashed[2]}-${dashed[3]}`;
  // 지역번호 없는 2123-4567 → 대표 지역번호 보강
  const local = /^(\d{3,4})-(\d{4})$/.exec(v);
  if (local) return `02)${local[1]}-${local[2]}`;
  // 내선 4자리만 (2819 등) → 대표 국번 + 내선
  if (/^\d{4}$/.test(v)) return `${DEPT_PREFIX}${v}`;
  return raw.trim();
}

/**
 * 전화번호 표기 통일 — 교수진 목록(`02)2123-4567`)과 같은 꼴로 맞춘다.
 *
 * 교원정보 시스템에서 긁어온 값은 표기가 제각각이다: 내선만(`2819`), 국제 표기
 * (`+82-2-2123-2825`), 하이픈(`02-2123-2820`), 지역번호 누락(`2123-5822`),
 * 복수 번호(`02)2123-2846, 6131`, `02)2123-2828/6548`). 그대로 두면 상세 페이지에
 * "2819" 처럼 번호로 보이지 않는 값이 노출된다.
 *
 * 복수 번호는 버리지 않고 각각 정규화해 `, ` 로 잇는다 — 둘째가 다른 기관 번호인
 * 경우(예: 032 국번)가 있어 임의로 떨어뜨리면 정보가 사라진다.
 */
export function formatPhone(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  return s
    .split(/\s*[/,]\s*/)
    .filter(Boolean)
    .map(normalizeOnePhone)
    .join(', ');
}

/** 로케일에 맞춰 날짜 포맷 (예: 2026. 6. 20. / Jun 20, 2026) */
export function formatDate(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: locale === 'ko' ? 'numeric' : 'short',
    day: 'numeric',
  }).format(date);
}

/** timestamptz → KST 달력 날짜(YYYY-MM-DD).
 *
 *  게시글 created_at 은 저장 시 항상 KST 자정(`…T00:00:00+09:00`)으로 못박는데
 *  (posts-server.ts 의 payloadToRow, scripts/import-boards.mjs 동일) Supabase 는
 *  이 값을 UTC(`…T15:00:00+00:00`)로 돌려준다. 그대로 slice(0,10) 하면 **하루
 *  전날**이 나온다 — 게시판에서 날짜는 곧 내용이라 그 하루가 그대로 오답이 된다.
 *  반드시 KST 로 옮긴 뒤 잘라야 한다. (posts.ts 와 posts-server.ts 가 공유) */
export function kstDate(ts: string): string {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return ts.slice(0, 10); // 파싱 실패 시 기존 동작 유지
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 지금(KST)을 'YYYY-MM-DDTHH:mm' 로 — CMS 가 저장한 게재 기간 문자열과 그대로
 *  문자열 비교한다(팝업 공지의 start/end). 서버·클라이언트 어디서 불러도 같은 값이라,
 *  홈의 preload 판정(서버)과 실제 노출 판정(PopupNotice, 브라우저)이 어긋나지 않는다. */
export function nowKst(): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  // sv-SE 는 'YYYY-MM-DD HH:mm' 을 준다 — 사이 공백만 T 로 바꾼다
  return parts.replace(' ', 'T');
}

/** 사용자가 OS 에서 동작 줄이기를 켰는지 — SSR 에서는 false (클라이언트 전용 판별) */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
