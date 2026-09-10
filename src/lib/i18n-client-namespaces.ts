/**
 * NextIntlClientProvider 로 브라우저에 내려보낼 **메시지 네임스페이스 화이트리스트**.
 *
 * 왜 있나: 예전에는 layout 이 `getMessages()` 결과를 통째로 provider 에 넘겼다. 그러면
 * messages/{ko,en}.json 전량이 모든 문서의 RSC 페이로드로 인라인된다(ko 15KB · en 23KB).
 * 실제로 브라우저가 쓰는 것은 `useTranslations(...)` 를 부르는 컴포넌트의 네임스페이스뿐이고,
 * `seo`·`about`·`pages` 처럼 서버에서만 쓰는 큰 덩어리는 한 글자도 쓰이지 않는다.
 * next-intl 문서가 권하는 방식대로 최상위 키만 골라 넘긴다.
 *
 * ⚠️ 없는 네임스페이스를 부르면 화면에 키 경로(예: "nav.skipToContent")가 그대로 찍힌다.
 * 그래서 목록은 손으로 관리하지 말고, 새 `useTranslations('X')` 를 추가했으면 여기에도
 * 'X' 의 **최상위 키**를 넣어라(`useTranslations('home.goals')` → 'home').
 * 안전망: `npm run check:i18n` (tools/i18n/check-client-namespaces.mjs) 이 src/ 를 훑어
 * 이 목록에 빠진 네임스페이스를 찾아내고 exit 1 한다. 서버 전용(`getTranslations`)은
 * 제외 대상이 아니라 **그냥 넣어 둔다** — 판별 실수보다 몇 바이트가 싸다.
 *
 * 목록에서 의도적으로 빠진 것(2026-09 기준, 전부 서버 전용):
 *   seo · about · pages · alumni · popup · requirements · toc
 */
export const CLIENT_MESSAGE_NAMESPACES = [
  'admission',
  'board',
  'breadcrumb',
  'contact',
  'faculty',
  'footer',
  'home',
  'langToggle',
  'menu',
  'meta',
  'nav',
  'news',
  'notFound',
  'research',
  'stub',
] as const;

/**
 * 최상위 키만 골라낸 얕은 복사. next-intl 문서의 `pick` 예제와 같은 일을 한다
 * (lodash 를 들이지 않으려고 직접 쓴다). 없는 키는 조용히 건너뛴다 — 한 로케일에만
 * 있는 네임스페이스가 생겨도 빌드가 죽지 않게.
 *
 * 반환 타입이 `Partial<T>` 가 아니라 `T` 인 이유: 담는 값은 전부 원본에 실제로 있던
 * 것이라 `undefined` 가 섞일 수 없는데, `Partial` 로 두면 next-intl 의
 * `AbstractIntlMessages`(인덱스 시그니처에 undefined 불가)에 대입할 수 없다.
 */
export function pickMessageNamespaces<T extends Record<string, unknown>>(
  messages: T,
  namespaces: readonly string[] = CLIENT_MESSAGE_NAMESPACES,
): T {
  const out: Record<string, unknown> = {};
  for (const ns of namespaces) if (ns in messages) out[ns] = messages[ns];
  return out as T;
}
