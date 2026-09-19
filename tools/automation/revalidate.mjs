/**
 * 목록 캐시 무효화 — 배포된 호스트의 `POST /api/revalidate` 를 부른다.
 *
 *   node tools/automation/revalidate.mjs [--tags posts,content] [--urls https://a,https://b] [--dry-run]
 *
 * 왜 이게 있나
 *   게시판 목록·콘텐츠는 태그(`posts`·`content`)가 붙은 캐시로 하루를 산다. CMS 로 쓰면
 *   쓰기 라우트가 그 자리에서 태그를 털지만, **DB 에 직접 넣는 경로**(board-sync.mjs)는
 *   앱을 거치지 않아 털 길이 없었다 — 새 글이 상세에는 보이는데 목록에는 최대 24시간
 *   안 뜬다(2026-09-16 실측). 이 스크립트가 호스트마다 라우트를 한 번씩 두드려 준다.
 *
 *   `revalidateTag` 는 그 호스트의 캐시만 턴다. 그래서 **호스트 목록**을 받는다
 *   (정규 도메인 · Cafe24 호스트명 …). 하나가 실패해도 나머지는 계속 간다.
 *
 * 환경변수 (`.env.local` 또는 셸)
 *   REVALIDATE_SECRET   라우트가 헤더 `x-revalidate-secret` 과 비교하는 공유 비밀값
 *   REVALIDATE_URLS     무효화할 호스트 origin 쉼표 구분 목록 (`--urls` 가 우선)
 *
 * 종료 코드: 0 = 전부 성공(또는 --dry-run) · 1 = 하나 이상 실패 · 2 = 설정 부족·인자 오류
 *
 * ⚠️ 비밀값은 어떤 로그·오류 문구에도 찍지 않는다. 실패 사유는 상태 코드와 응답 앞부분만 남긴다.
 *
 * 의존성: 없음(Node 24 내장).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const DEFAULT_TAGS = ['posts'];
const ALLOWED_TAGS = new Set(['posts', 'content']);
const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 2_000; // 네트워크 오류·5xx 는 한 번만 더 시도한다(배포 중 순간 단절 대비)
const ERROR_BODY_CHARS = 200;

// ── .env.local 로더 (board-sync.mjs 와 동일 방식) ──
// 이미 process.env 에 있는 키는 덮지 않는다 — 셸에서 준 값이 항상 이긴다.
{
  for (const p of [join(REPO, '.env.local'), join(HERE, '..', '..', '.env.local')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
    break;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 응답 본문 꼬리표 — 한 줄로 줄이고 앞부분만. 비밀값은 요청에만 있으므로 여기 섞이지 않는다. */
function snippet(text) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > ERROR_BODY_CHARS ? `${s.slice(0, ERROR_BODY_CHARS)}…` : s;
}

/** 쉼표 구분 목록 → 공백 제거·빈 항목 제거한 배열 */
function splitList(raw) {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 호스트 한 번 두드리기. 던지지 않고 {ok, status, error, retryable} 를 돌려준다. */
async function attempt(origin, secret, tags, timeoutMs) {
  const endpoint = `${origin.replace(/\/+$/, '')}/api/revalidate`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-revalidate-secret': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let text = '';
    try {
      text = await res.text();
    } catch {
      // 본문을 못 읽어도 상태 코드로 판정한다
    }
    if (res.ok) {
      let ok = false;
      try {
        ok = JSON.parse(text)?.ok === true;
      } catch {
        ok = false;
      }
      // 2xx 인데 ok 가 아니면 우리 라우트가 아닌 무언가가 응답한 것이다(프록시 안내 페이지 등)
      if (ok) return { ok: true, status: res.status };
      return { ok: false, status: res.status, error: `HTTP ${res.status} 인데 ok 가 아니다: ${snippet(text)}`, retryable: false };
    }
    return {
      ok: false,
      status: res.status,
      error: `HTTP ${res.status}${text ? ` ${snippet(text)}` : ''}`,
      retryable: res.status >= 500,
    };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    return {
      ok: false,
      status: null,
      error: timedOut ? `시간 초과(${timeoutMs}ms)` : `요청 실패: ${String(e?.message || e)}`,
      retryable: true,
    };
  }
}

/**
 * 호스트 목록을 차례로 무효화한다. **절대 던지지 않는다** — 실패도 결과로 돌려준다.
 * @param {{urls: string[], secret: string, tags?: string[], timeoutMs?: number, log?: (line: string) => void}} o
 * @returns {Promise<Array<{url: string, ok: boolean, status: number|null, ms: number, error: string|null}>>}
 */
export async function revalidateHosts({ urls, secret, tags = DEFAULT_TAGS, timeoutMs = DEFAULT_TIMEOUT_MS, log = () => {} }) {
  const results = [];
  for (const url of urls) {
    const started = Date.now();
    let r = await attempt(url, secret, tags, timeoutMs);
    if (!r.ok && r.retryable) {
      log(`  ${url} — ${r.error} · 2초 뒤 한 번만 더 시도한다.`);
      await sleep(RETRY_DELAY_MS);
      r = await attempt(url, secret, tags, timeoutMs);
    }
    results.push({ url, ok: r.ok, status: r.status ?? null, ms: Date.now() - started, error: r.ok ? null : r.error });
  }
  return results;
}

// ── CLI ───────────────────────────────────────────────────────
const USAGE = [
  '사용법: node tools/automation/revalidate.mjs [옵션]',
  '  --tags posts,content   무효화할 태그 (기본 posts, 허용: posts·content)',
  '  --urls https://a,https://b   대상 호스트 origin (기본 환경변수 REVALIDATE_URLS)',
  '  --dry-run              부를 주소와 태그만 찍고 멈춘다',
  '',
  '환경변수: REVALIDATE_SECRET(필수) · REVALIDATE_URLS(--urls 없을 때)',
].join('\n');

function parseArgs(argv) {
  const out = { tags: null, urls: null, dryRun: false };
  const need = (name, raw) => {
    if (raw === undefined) throw new Error(`${name} 에 값이 필요하다.`);
    return raw;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--tags') out.tags = splitList(need('--tags', argv[++i]));
    else if (a === '--urls') out.urls = splitList(need('--urls', argv[++i]));
    else if (a.startsWith('--tags=')) out.tags = splitList(a.slice('--tags='.length));
    else if (a.startsWith('--urls=')) out.urls = splitList(a.slice('--urls='.length));
    else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else throw new Error(`알 수 없는 인자: ${a}`);
  }
  return out;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${String(e.message || e)}\n${USAGE}`);
    return 2;
  }

  const tags = opts.tags?.length ? opts.tags : DEFAULT_TAGS;
  const bad = tags.filter((t) => !ALLOWED_TAGS.has(t));
  if (bad.length) {
    console.error(`허용하지 않는 태그: ${bad.join(', ')} (허용: ${[...ALLOWED_TAGS].join('·')})\n${USAGE}`);
    return 2;
  }

  const urls = opts.urls?.length ? opts.urls : splitList(process.env.REVALIDATE_URLS);
  if (!urls.length) {
    console.error(`대상 호스트가 없다 — --urls 를 주거나 REVALIDATE_URLS 를 설정하라.\n${USAGE}`);
    return 2;
  }

  if (opts.dryRun) {
    console.log(`--dry-run — 태그 [${tags.join(', ')}] 로 아래를 부를 참이었다:`);
    for (const u of urls) console.log(`  POST ${u.replace(/\/+$/, '')}/api/revalidate`);
    return 0;
  }

  const secret = process.env.REVALIDATE_SECRET ?? '';
  if (!secret) {
    console.error(`REVALIDATE_SECRET 이 없다 — .env.local 또는 셸 환경변수에 넣어라.\n${USAGE}`);
    return 2;
  }

  console.log(`목록 캐시 무효화 — 태그 [${tags.join(', ')}] · 호스트 ${urls.length}개`);
  const results = await revalidateHosts({ urls, secret, tags, log: (l) => console.log(l) });
  for (const r of results) {
    const mark = r.ok ? '✔' : '✘';
    const detail = r.ok ? `HTTP ${r.status}` : r.error;
    console.log(`  ${mark} ${r.url}  ${String(r.ms).padStart(5)}ms  ${detail}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`실패 ${failed.length}/${results.length} — 그 호스트 목록은 캐시가 만료될 때까지(최대 24시간) 옛 상태다.`);
    return 1;
  }
  console.log(`성공 ${results.length}/${results.length} — 사이트 목록에 바로 보인다.`);
  return 0;
}

// 직접 실행됐을 때만 CLI 로 동작한다(revalidateHosts 만 import 할 수 있게).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main();
}
