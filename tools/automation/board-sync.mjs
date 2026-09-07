/**
 * 구 게시판 신규 글 동기화 — 도메인 컷오버 전까지만 도는 **한시** 루틴 (automation-phase3.md P3-7)
 *
 *   node tools/automation/board-sync.mjs [--dry-run] [--skip-crawl] [--state-dir <경로>]
 *                                        [--since-days 45] [--max-pending 100]
 *
 * 왜 이게 있나
 *   컷오버 전까지 학과 담당자는 여전히 **구 사이트**(me.yonsei.ac.kr/me/community/*.do)에
 *   글을 올린다. 우리 사이트가 그 글을 못 보여 주면 "새 사이트는 공지가 늦다" 가 된다.
 *   그래서 매일 새벽 한 번 구 사이트를 훑어 **새로 올라온 글만** 우리 Supabase 로 옮긴다.
 *   컷오버(=DNS 가 me.yonsei.ac.kr 을 우리로 돌리는 날) 뒤에는 정본이 우리 CMS 이므로
 *   이 작업을 **반드시 해제**한다(해제 절차는 automation-phase3.md P3-7).
 *
 * 동기화하는 것 / 하지 않는 것
 *   ○ 새 글(구 사이트에만 있고 우리 DB 에 없는 source_url)
 *   × 기존 글의 수정·삭제·상단고정 변경 — 이미 우리 DB 에 있는 글은 **한 칼럼도 건드리지
 *     않는다.** 적재분은 이미 R2 미러링·링크 재작성을 거쳤는데, 원문으로 다시 덮으면
 *     그 가공이 통째로 되돌아간다(그래서 import-boards 에 신규 글만 담은 부분집합 JSON 을 준다).
 *
 * 흐름 (각 단계 로그 · 하나라도 걸리면 그 자리에서 멈춘다)
 *   ① 잠금 + 로그 tee     `<state-dir>/board-sync.lock` (12시간 지난 것은 유물로 치운다)
 *   ② 크롤               `crawl-boards.mjs --since=<오늘-since-days>` (--skip-crawl 이면 생략)
 *                        게시판 전부 "목록 0건" 이면 구 사이트가 죽은 것으로 보고 실패
 *   ③ 후보               `tools/boards-raw/*.json` 중 최근 60일 글 (날짜 없는 글은 제외·경고)
 *   ④ DB 확인            REST 로 source_url 존재 여부 조회(50건씩) + **센티널 3건 검증**
 *                        HTTP 402(egress 초과 제한)는 실패가 아니라 **보류** — exit 0
 *   ⑤ pending            DB 에 없는 글. 0건이면 끝. --max-pending 초과면 실패(뭔가 잘못됨)
 *   ⑥ 부분집합 JSON      `<state-dir>/board-sync/pending/<board>.json`
 *   ⑦ --dry-run          여기까지만 하고 표를 찍고 exit 0
 *   ⑧ 적재               import-boards → mirror-legacy-assets → rewrite-legacy-links →
 *                        backfill-attachment-sizes (앞이 비-0 이면 뒤는 돌리지 않는다)
 *   ⑨ 검증               pending 의 source_url 이 전부 DB 에 있어야 성공
 *   ⑩ 상태 파일          `<state-dir>/board-sync.json`
 *   ⑪ 실패 알림          `[자동] 구 게시판 동기화 실패 (<날짜>)` 이슈(402 보류는 이슈 없음)
 *
 * 종료 코드: 0 = 성공 / 보류 / 신규 없음 · 1 = 실패
 *
 * ⚠️ 함정
 *   - **센티널 가드**: 우리 DB 에는 이미 3,500건이 들어 있다. REST 가 빈 배열을 주면
 *     (권한 상실·URL 오타·프로젝트 정지) 전부 "신규" 로 보여 **전량 재적재**가 된다.
 *     그래서 가장 오래된 글 3건을 따로 물어보고, 하나라도 없으면 그 자리에서 멈춘다.
 *   - **사이트 반영은 즉시가 아니다**: 목록 캐시 수명이 하루라 적재 후 최대 24시간 뒤에
 *     보인다(fd3427d, Supabase egress 절감). 급하면 재배포하면 된다.
 *   - 여기서 하는 DB 접근은 **읽기뿐**이다. 쓰기는 전부 자식 스크립트가 한다.
 *   - 비밀값(SUPABASE_SERVICE_ROLE_KEY 등)은 로그·이슈 어디에도 찍지 않는다.
 *
 * 시험용 환경변수 (운영에서는 쓰지 않는다)
 *   BOARD_SYNC_REST_BASE            SUPABASE_URL 대신 쓸 REST 베이스(모의 서버)
 *   BOARD_SYNC_SCRIPT_CRAWL         자식 스크립트 경로 덮어쓰기 (REPO 기준 상대 또는 절대)
 *   BOARD_SYNC_SCRIPT_IMPORT
 *   BOARD_SYNC_SCRIPT_MIRROR
 *   BOARD_SYNC_SCRIPT_REWRITE
 *   BOARD_SYNC_SCRIPT_BACKFILL
 *
 * 의존성: 없음(Node 24 내장 + 같은 디렉터리의 issue.mjs, tools/board-source.mjs 의 BOARDS 표).
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BOARDS } from '../board-source.mjs';
import { createOrComment } from './issue.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const DEFAULT_STATE_DIR = join(HERE, '.state');
const RAW_DIR = join(REPO, 'tools', 'boards-raw');

/** 자식 스크립트 — REPO 기준 상대 경로. 환경변수로 덮어쓸 수 있다(시험 전용 스텁). */
const SCRIPTS = {
  CRAWL: join('tools', 'crawl-boards.mjs'),
  IMPORT: join('scripts', 'import-boards.mjs'),
  MIRROR: join('scripts', 'mirror-legacy-assets.mjs'),
  REWRITE: join('scripts', 'rewrite-legacy-links.mjs'),
  BACKFILL: join('tools', 'backfill-attachment-sizes.mjs'),
};

const CANDIDATE_DAYS = 60; // 후보로 볼 글의 나이 상한. 크롤 --since 보다 넉넉하게 잡는다.
const LOCK_STALE_HOURS = 12;
const REST_BATCH = 50; // 한 요청에 물어볼 source_url 수 (URL 길이 ~4KB)
const REST_TIMEOUT_MS = 20_000;
const SENTINEL_COUNT = 3; // 전량 미검출 사고를 막는 표본 수
const SENTINEL_BOARD = 'noticesUndergrad';
const IMPORTED_KEEP = 500; // 상태 파일에 남기는 누적 적재 이력 상한
const STDERR_TAIL_LINES = 40; // 이슈 본문에 붙일 표준오류 꼬리

const BOARD_ORDER = new Map(BOARDS.map((b, i) => [b.key, i]));
const BOARD_LABEL = new Map(BOARDS.map((b) => [b.key, b.label]));

// ── .env.local 로더 (scripts/import-boards.mjs 와 동일 방식) ──
// 자식 스크립트는 각자 읽지만, 이 파일도 REST 조회에 SUPABASE_URL/키가 필요하다.
{
  const here = HERE;
  for (const p of [join(REPO, '.env.local'), join(here, '..', '..', '.env.local')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
    break;
  }
}

// ── 인자 ──────────────────────────────────────────────────────
const USAGE = [
  '사용법: node tools/automation/board-sync.mjs [옵션]',
  '  --dry-run              후보·pending 만 계산해 표로 찍고 멈춘다(DB 쓰기 없음)',
  '  --skip-crawl           크롤을 생략하고 기존 tools/boards-raw/*.json 만 본다',
  '  --state-dir <경로>     상태·잠금·로그 위치 (기본 tools/automation/.state)',
  '  --since-days N         크롤 대상 기간, 기본 45일',
  '  --max-pending N        이 수를 넘는 신규 글이 나오면 실패로 멈춘다, 기본 100',
].join('\n');

function parseArgs(argv) {
  const out = { dryRun: false, skipCrawl: false, stateDir: null, sinceDays: 45, maxPending: 100 };
  const num = (name, raw) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} 은 양의 정수여야 한다: ${raw}`);
    return n;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-crawl') out.skipCrawl = true;
    else if (a === '--state-dir') out.stateDir = argv[++i];
    else if (a === '--since-days') out.sinceDays = num('--since-days', argv[++i]);
    else if (a === '--max-pending') out.maxPending = num('--max-pending', argv[++i]);
    else if (a.startsWith('--state-dir=')) out.stateDir = a.slice('--state-dir='.length);
    else if (a.startsWith('--since-days=')) out.sinceDays = num('--since-days', a.slice('--since-days='.length));
    else if (a.startsWith('--max-pending=')) out.maxPending = num('--max-pending', a.slice('--max-pending='.length));
    else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else throw new Error(`알 수 없는 인자: ${a}`);
  }
  return out;
}

// ── 날짜 (전부 KST) ───────────────────────────────────────────
/** 오늘(KST) → {y, m, d}. 러너가 UTC 든 아니든 게시판 날짜는 KST 다. */
function kstToday(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() };
}
const ymd = ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** n일 전(KST) 의 'YYYY-MM-DD'. */
function daysAgo(today, n) {
  const t = Date.UTC(today.y, today.m - 1, today.d) - n * 86_400_000;
  const d = new Date(t);
  return ymd({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
}

// ── 로그 tee ──────────────────────────────────────────────────
// 스케줄러에는 콘솔이 없다 — 로그 파일이 유일한 증거다. 자식 출력도 같은 파일로 흘린다.
let logStream = null;
function openLog(file) {
  logStream = createWriteStream(file, { flags: 'a' });
  logStream.write(`\n===== ${new Date().toISOString()} board-sync 시작 (cwd ${REPO}) =====\n`);
}
function log(line = '') {
  console.log(line);
  logStream?.write(`${line}\n`);
}
function warn(line) {
  console.warn(line);
  logStream?.write(`${line}\n`);
}
function errLog(line) {
  console.error(line);
  logStream?.write(`${line}\n`);
}
function closeLog(tail) {
  if (!logStream) return;
  logStream.end(`${tail}\n`);
  logStream = null;
}

// ── 잠금 ──────────────────────────────────────────────────────
/** 잠금을 잡는다. 이미 누가 돌고 있으면 false(= 오늘은 그냥 나간다). */
function acquireLock(lockFile) {
  if (existsSync(lockFile)) {
    const ageH = (Date.now() - statSync(lockFile).mtimeMs) / 3_600_000;
    if (ageH < LOCK_STALE_HOURS) {
      log(`이미 실행 중 — 건너뜀 (${lockFile} · ${ageH.toFixed(1)}시간 전 시작)`);
      return false;
    }
    warn(`경고: ${LOCK_STALE_HOURS}시간 넘은 잠금을 유물로 보고 치운다 (${ageH.toFixed(1)}시간 전).`);
    rmSync(lockFile, { force: true });
  }
  writeFileSync(lockFile, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`);
  return true;
}
function releaseLock(lockFile) {
  try {
    rmSync(lockFile, { force: true });
  } catch {
    /* 못 지워도 12시간 뒤 유물로 치워진다 */
  }
}

// ── 자식 실행 (출력은 콘솔 + 로그 파일) ────────────────────────
/** REPO 기준 상대 경로 또는 절대 경로 → 절대 경로. */
function scriptPath(name) {
  const override = process.env[`BOARD_SYNC_SCRIPT_${name}`];
  const rel = override || SCRIPTS[name];
  return isAbsolute(rel) ? rel : join(REPO, rel);
}

/**
 * node 자식 하나. 셸을 거치지 않는다(경로에 한글·공백이 있다 — 셸이면 이스케이프가 깨진다).
 * 출력은 Buffer 그대로 흘린다(청크 경계에서 한글이 깨지지 않게 디코딩하지 않는다).
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function runNode(name, args) {
  const script = scriptPath(name);
  return new Promise((done) => {
    const head = `\n----- ${new Date().toISOString()} node ${script} ${args.join(' ')} -----`;
    log(head);
    const outChunks = [];
    const errChunks = [];
    const child = spawn(process.execPath, [script, ...args], {
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      const stdout = Buffer.concat(outChunks).toString('utf8');
      const stderr = Buffer.concat(errChunks).toString('utf8');
      log(`----- ${name} exit ${code} -----`);
      done({ code, stdout, stderr });
    };
    child.stdout.on('data', (b) => {
      outChunks.push(b);
      process.stdout.write(b);
      logStream?.write(b);
    });
    child.stderr.on('data', (b) => {
      errChunks.push(b);
      process.stderr.write(b);
      logStream?.write(b);
    });
    child.on('error', (e) => {
      const msg = `자식을 띄우지 못했다 (${script}): ${String(e.message || e)}`;
      errChunks.push(Buffer.from(`${msg}\n`, 'utf8'));
      errLog(msg);
      finish(1);
    });
    child.on('close', (code, signal) => finish(code ?? (signal ? 1 : 0)));
  });
}

/** 표준오류 마지막 N줄(이슈 본문용). 비었으면 표준출력 꼬리로 대신한다. */
function tail(text, lines = STDERR_TAIL_LINES) {
  const rows = String(text ?? '').replace(/\s+$/, '').split(/\r?\n/);
  return rows.slice(-lines).join('\n');
}

// ── 크롤 출력 판독 ────────────────────────────────────────────
/**
 * 크롤러 진행 로그의 `… 목록 N건 → 대상 …` 에서 게시판별 목록 건수를 읽는다.
 * 전부 0 이면 원본 사이트가 목록을 안 준다는 뜻 — 컷오버 후이거나 사이트가 죽었다.
 * @returns {{counts:number[], allZero:boolean}}
 */
export function parseListCounts(stdout) {
  const counts = [...String(stdout ?? '').matchAll(/목록\s+(\d+)\s*건/g)].map((m) => Number(m[1]));
  return { counts, allZero: counts.length > 0 && counts.every((n) => n === 0) };
}

// ── 후보 수집 ─────────────────────────────────────────────────
/**
 * tools/boards-raw/*.json → 최근 CANDIDATE_DAYS 일 글.
 * 날짜가 없는 글은 "언제 것인지 모르니 건드리지 않는다" 로 제외하고 세기만 한다
 * (실측상 0건이지만, 파서가 날짜를 놓치기 시작하면 여기서 드러난다).
 * @returns {{boards: Array, total:number, skippedNoDate:number, skippedNoUrl:number, files:number}}
 */
function collectCandidates(cutoff) {
  if (!existsSync(RAW_DIR)) throw new Error(`크롤 스냅샷 디렉터리가 없다: ${RAW_DIR}`);
  const boards = [];
  let total = 0;
  let skippedNoDate = 0;
  let skippedNoUrl = 0;
  let files = 0;
  for (const f of readdirSync(RAW_DIR)) {
    if (!f.endsWith('.json')) continue;
    files += 1;
    const file = join(RAW_DIR, f);
    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`크롤 스냅샷을 읽지 못했다 (${file}): ${String(e.message || e)}`);
    }
    const key = data?.board ?? f.replace(/\.json$/, '');
    if (!BOARD_ORDER.has(key)) {
      warn(`경고: 알 수 없는 게시판 키라 건너뛴다 — ${key} (${file})`);
      continue;
    }
    const posts = [];
    for (const p of Array.isArray(data?.posts) ? data.posts : []) {
      if (!p?.date) {
        skippedNoDate += 1;
        continue;
      }
      if (p.date < cutoff) continue;
      if (!p?.sourceUrl) {
        skippedNoUrl += 1;
        continue;
      }
      posts.push(p);
    }
    total += posts.length;
    if (posts.length) {
      boards.push({ board: key, sourcePath: data?.sourcePath ?? '', crawledAt: data?.crawledAt ?? '', posts });
    }
  }
  boards.sort((a, b) => BOARD_ORDER.get(a.board) - BOARD_ORDER.get(b.board));
  return { boards, total, skippedNoDate, skippedNoUrl, files };
}

/** 센티널 — 가장 오래된 글 N건의 source_url. "DB 가 통째로 안 보인다" 를 잡는 표본. */
function sentinelUrls() {
  const file = join(RAW_DIR, `${SENTINEL_BOARD}.json`);
  if (!existsSync(file)) throw new Error(`센티널 스냅샷이 없다: ${file}`);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const posts = (Array.isArray(data?.posts) ? data.posts : [])
    .filter((p) => p?.sourceUrl && p?.articleNo)
    .sort((a, b) => Number(a.articleNo) - Number(b.articleNo))
    .slice(0, SENTINEL_COUNT);
  if (posts.length < SENTINEL_COUNT) {
    throw new Error(`센티널을 ${SENTINEL_COUNT}건 뽑지 못했다 (${file} 에 ${posts.length}건) — 스냅샷이 비었다.`);
  }
  return posts.map((p) => p.sourceUrl);
}

// ── DB 조회 (읽기 전용 · supabase-js 없이 REST 직접) ───────────
/** egress 초과 등으로 프로젝트가 제한된 상태. 실패가 아니라 **보류** 로 다룬다. */
class RestRestrictedError extends Error {
  constructor(body) {
    super('Supabase 프로젝트가 제한 상태다(HTTP 402).');
    this.name = 'RestRestrictedError';
    this.body = body;
  }
}

function restConfig() {
  const base = (process.env.BOARD_SYNC_REST_BASE || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base) throw new Error('SUPABASE_URL(또는 BOARD_SYNC_REST_BASE)이 없다 — .env.local 을 확인하라.');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 가 없다 — .env.local 을 확인하라.');
  return { base, key };
}

/**
 * source_url 목록 중 **DB 에 이미 있는 것**의 집합.
 * PostgREST `in.("a","b")` — 값에 ?·&·= 가 들어가므로 큰따옴표로 감싸고 전체를 퍼센트 인코딩한다.
 * (감싸지 않으면 쿼리스트링 구분자와 뒤섞여 조건이 통째로 날아간다.)
 */
async function fetchExisting(urls) {
  const { base, key } = restConfig();
  const found = new Set();
  for (let i = 0; i < urls.length; i += REST_BATCH) {
    const chunk = urls.slice(i, i + REST_BATCH);
    const list = chunk.map((u) => `"${String(u).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
    const url = `${base}/rest/v1/posts?select=source_url&source_url=${encodeURIComponent(`in.(${list})`)}`;
    let res;
    try {
      res = await fetch(url, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(`DB 조회 요청 실패: ${String(e.message || e)}`);
    }
    const text = await res.text().catch(() => '');
    if (res.status === 402) throw new RestRestrictedError(text.slice(0, 300));
    if (!res.ok) throw new Error(`DB 조회 HTTP ${res.status}: ${text.slice(0, 300)}`);
    let rows;
    try {
      rows = JSON.parse(text);
    } catch {
      throw new Error(`DB 조회 응답을 JSON 으로 읽지 못했다: ${text.slice(0, 200)}`);
    }
    if (!Array.isArray(rows)) throw new Error(`DB 조회 응답이 배열이 아니다: ${text.slice(0, 200)}`);
    for (const r of rows) if (r?.source_url) found.add(r.source_url);
  }
  return found;
}

// ── 부분집합 JSON ─────────────────────────────────────────────
/**
 * import-boards 에 넘길 **신규 글만** 담은 스냅샷을 쓴다. 형식은 크롤러 산출물과 같다
 * (import-boards 는 JSON 의 `board` 필드로 게시판을 판단한다).
 * ⚠️ 전체 스냅샷을 그대로 주면 이미 적재·미러링된 글까지 원문으로 되돌아간다 — 그래서 부분집합이다.
 */
function writePendingSnapshots(pendingDir, groups) {
  rmSync(pendingDir, { recursive: true, force: true });
  mkdirSync(pendingDir, { recursive: true });
  const written = [];
  for (const g of groups) {
    const file = join(pendingDir, `${g.board}.json`);
    const payload = {
      board: g.board,
      sourcePath: g.sourcePath,
      crawledAt: g.crawledAt,
      posts: g.posts,
    };
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    written.push({ file, board: g.board, count: g.posts.length });
  }
  return written;
}

/** 본문에 base64 이미지가 박혀 있나(R2 업로드가 붙는 글인지 미리 알려 주는 표시). */
const hasDataImage = (post) => /src\s*=\s*["']?\s*data:image\//i.test(String(post?.bodyHtml ?? ''));

/** 콘솔 표 — 한글 폭까지 맞추진 않는다(로그용). */
function printPendingTable(groups) {
  const rows = [];
  for (const g of groups) {
    for (const p of g.posts) {
      rows.push([
        BOARD_LABEL.get(g.board) ?? g.board,
        String(p.articleNo ?? ''),
        String(p.date ?? ''),
        String(p.attachments?.length ?? 0),
        hasDataImage(p) ? 'Y' : '-',
        String(p.title ?? '').slice(0, 44),
      ]);
    }
  }
  const head = ['게시판', 'articleNo', '날짜', '첨부', 'b64', '제목'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => `  ${cells.map((c, i) => c.padEnd(widths[i])).join('  ')}`.replace(/\s+$/, '');
  log(line(head));
  log(`  ${widths.map((w) => '─'.repeat(w)).join('  ')}`);
  for (const r of rows) log(line(r));
}

// ── 상태 파일 ─────────────────────────────────────────────────
function readState(file) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) ?? {};
  } catch (e) {
    warn(`경고: 상태 파일을 읽지 못했다(${String(e.message || e)}) — 새로 쓴다.`);
    return {};
  }
}

/** 상태 파일 갱신. 누적 `imported` 는 최근 IMPORTED_KEEP 건만 남긴다. */
function writeState(file, patch, importedNow = []) {
  const prev = readState(file);
  const imported = [...(Array.isArray(prev.imported) ? prev.imported : []), ...importedNow].slice(-IMPORTED_KEEP);
  const next = { ...prev, ...patch, imported };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

// ── 실패 알림 ─────────────────────────────────────────────────
/** 단계와 표준오류 꼬리를 담은 실패. run() 은 이걸 던지고 main() 이 이슈로 옮긴다. */
class Fail extends Error {
  constructor(step, message, stderr = '') {
    super(message);
    this.name = 'Fail';
    this.step = step;
    this.stderr = stderr;
  }
}

/**
 * gh CLI 는 로그인돼 있는데 GH_TOKEN 환경변수는 없는 게 보통이다(작업 스케줄러 실행).
 * issue.mjs 는 토큰 환경변수를 요구하므로, 여기서 gh 에게 물어 채워 준다.
 * ⚠️ 값은 어디에도 찍지 않는다.
 */
function ensureGhToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return true;
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  const token = r.status === 0 ? String(r.stdout ?? '').trim() : '';
  if (!token) return false;
  process.env.GH_TOKEN = token;
  return true;
}

async function reportFailure({ fail, dryRun, logFile, stateDir, today }) {
  const body = [
    `구 게시판 신규 글 동기화(board-sync)가 **${fail.step}** 단계에서 멈췄습니다.`,
    '',
    `- 실패 단계: \`${fail.step}\``,
    `- 사유: ${fail.message}`,
    `- 로그: \`${logFile}\``,
    `- 상태: \`${join(stateDir, 'board-sync.json')}\``,
    '',
    '표준오류 꼬리:',
    '',
    '```',
    tail(fail.stderr) || '(표준오류 없음)',
    '```',
    '',
    '조치',
    '',
    '1. 위 로그를 열어 어느 자식 스크립트가 죽었는지 본다.',
    '2. 원본 사이트가 이미 컷오버돼 목록이 비었다면 이 작업을 **해제**한다',
    "   (`register-tasks.ps1 -Unregister -Only board-sync`) — automation-phase3.md P3-7.",
    '3. 그 외에는 손으로 `node tools/automation/board-sync.mjs --dry-run` 을 돌려 재현한다.',
  ].join('\n');
  const title = `[자동] 구 게시판 동기화 실패 (${ymd(today)})`;
  if (!dryRun && !ensureGhToken()) {
    warn('경고: GH_TOKEN 도 gh 로그인도 없어 실패 이슈를 만들지 못했다 — 로그만 남는다.');
    return;
  }
  await createOrComment({ title, body, label: 'automation', dryRun }).catch((e) =>
    errLog(`이슈 생성 실패: ${String(e.message || e)}`),
  );
}

// ── 본체 ──────────────────────────────────────────────────────
/**
 * @returns {Promise<{status:'deferred'|'none'|'dry-run'|'ok', candidates?:number, pending?:Array, verified?:boolean}>}
 * @throws {Fail}
 */
async function run(opts, ctx) {
  const { today, pendingDir } = ctx;

  // ② 크롤
  if (opts.skipCrawl) {
    log('② 크롤 — --skip-crawl 이라 생략한다(기존 tools/boards-raw 스냅샷만 본다).');
  } else {
    const since = daysAgo(today, opts.sinceDays);
    log(`② 크롤 — 최근 ${opts.sinceDays}일(--since=${since})`);
    const r = await runNode('CRAWL', [`--since=${since}`]);
    if (r.code !== 0) {
      throw new Fail('크롤', `crawl-boards.mjs 가 exit ${r.code} 로 끝났다.`, r.stderr || r.stdout);
    }
    // ⚠️ crawl-boards 는 목록 요청이 전부 실패해도 exit 0 이다(실패는 끝에 보고만 한다).
    // 그래서 "목록 N건" 이 한 줄도 없는 것과 전부 0건인 것을 **둘 다** 사이트 죽음으로 본다.
    const { counts, allZero } = parseListCounts(r.stdout);
    if (!counts.length || allZero) {
      const why = counts.length
        ? `게시판 ${counts.length}개가 전부 "목록 0건" 이다`
        : '크롤 출력에 "목록 N건" 이 한 줄도 없다(게시판 목록 요청이 전부 실패했다는 뜻)';
      throw new Fail('크롤', `${why} — 구 사이트가 응답하지 않는다(컷오버 후라면 이 작업을 해제하라).`, r.stdout);
    }
    log(`  목록 합계 ${counts.reduce((a, b) => a + b, 0)}건 (게시판 ${counts.length}개)`);
  }

  // ③ 후보
  const cutoff = daysAgo(today, CANDIDATE_DAYS);
  let cands;
  try {
    cands = collectCandidates(cutoff);
  } catch (e) {
    throw new Fail('후보 수집', String(e.message || e));
  }
  log(`③ 후보 — ${cutoff} 이후 ${cands.total}건 (스냅샷 ${cands.files}개 · 게시판 ${cands.boards.length}개)`);
  if (cands.skippedNoDate) warn(`  경고: 날짜 없는 글 ${cands.skippedNoDate}건은 후보에서 제외했다.`);
  if (cands.skippedNoUrl) warn(`  경고: sourceUrl 없는 글 ${cands.skippedNoUrl}건은 후보에서 제외했다.`);
  if (cands.total === 0) {
    log('후보 없음 — 할 일 없음.');
    return { status: 'none', candidates: 0 };
  }

  // ④ DB 확인 (읽기만) — 센티널 먼저, 그다음 후보
  log('④ DB 확인 — source_url 존재 여부 조회(읽기 전용)');
  let sentinels;
  try {
    sentinels = sentinelUrls();
  } catch (e) {
    throw new Fail('DB 확인', String(e.message || e));
  }
  let existing;
  try {
    const foundSentinels = await fetchExisting(sentinels);
    const missing = sentinels.filter((u) => !foundSentinels.has(u));
    if (missing.length) {
      throw new Fail(
        'DB 확인',
        `센티널 ${sentinels.length}건 중 ${missing.length}건이 DB 에 없다 — DB 상태 이상(전량 미검출)일 수 있어 멈춘다. ` +
          '이대로 진행하면 이미 적재된 글까지 신규로 보고 재적재한다.',
        missing.map((u) => `누락 센티널: ${u}`).join('\n'),
      );
    }
    log(`  센티널 ${sentinels.length}건 확인 — DB 조회가 살아 있다.`);
    const urls = cands.boards.flatMap((g) => g.posts.map((p) => p.sourceUrl));
    existing = await fetchExisting(urls);
    log(`  후보 ${urls.length}건 중 기존 ${existing.size}건`);
  } catch (e) {
    if (e instanceof RestRestrictedError) {
      log(`Supabase 제한 중 — 적재 보류(후보 ${cands.total}건). 제한이 풀리면 다음 실행에서 그대로 이어 간다.`);
      return { status: 'deferred', candidates: cands.total };
    }
    if (e instanceof Fail) throw e;
    throw new Fail('DB 확인', String(e.message || e));
  }

  // ⑤ pending
  const groups = cands.boards
    .map((g) => ({ ...g, posts: g.posts.filter((p) => !existing.has(p.sourceUrl)) }))
    .filter((g) => g.posts.length);
  const pending = groups.flatMap((g) => g.posts.map((p) => ({ board: g.board, ...p })));
  log(`⑤ 신규 — ${pending.length}건`);
  if (pending.length === 0) {
    log('신규 없음 — 할 일 없음.');
    return { status: 'none', candidates: cands.total };
  }
  if (pending.length > opts.maxPending) {
    throw new Fail(
      '신규 판정',
      `신규 ${pending.length}건이 상한(--max-pending ${opts.maxPending})을 넘는다 — 정상적인 하루치가 아니다. ` +
        '손으로 확인하기 전에는 적재하지 않는다.',
      groups.map((g) => `${g.board}: ${g.posts.length}건`).join('\n'),
    );
  }
  printPendingTable(groups);

  // ⑥ 부분집합 JSON
  const written = writePendingSnapshots(pendingDir, groups);
  log(`⑥ 부분집합 JSON ${written.length}개 → ${pendingDir}`);
  for (const w of written) log(`  ${w.board}: ${w.count}건`);

  // ⑦ dry-run
  if (opts.dryRun) {
    log('--dry-run — 여기서 멈춘다. 실제로는 아래를 차례로 실행한다:');
    log(`  node ${SCRIPTS.IMPORT} --input=${pendingDir} --apply`);
    log(`  node ${SCRIPTS.MIRROR} --apply`);
    log(`  node ${SCRIPTS.REWRITE} --apply`);
    log(`  node ${SCRIPTS.BACKFILL} --write`);
    return { status: 'dry-run', pending, candidates: cands.total };
  }

  // ⑧ 적재 — 앞이 실패하면 뒤는 돌리지 않는다(반쯤 적재된 상태로 미러링을 돌리지 않기 위해)
  const steps = [
    { step: '적재(import-boards)', name: 'IMPORT', args: [`--input=${pendingDir}`, '--apply'] },
    { step: '자산 미러링(mirror-legacy-assets)', name: 'MIRROR', args: ['--apply'] },
    { step: '링크 재작성(rewrite-legacy-links)', name: 'REWRITE', args: ['--apply'] },
    { step: '첨부 크기 백필(backfill-attachment-sizes)', name: 'BACKFILL', args: ['--write'] },
  ];
  log(`⑧ 적재 — ${steps.length}단계`);
  for (const s of steps) {
    const r = await runNode(s.name, s.args);
    if (r.code !== 0) throw new Fail(s.step, `exit ${r.code} 로 끝났다.`, r.stderr || r.stdout);
  }

  // ⑨ 검증
  log('⑨ 검증 — 방금 넣은 글이 DB 에 보이는지 확인');
  let verified = true;
  try {
    const after = await fetchExisting(pending.map((p) => p.sourceUrl));
    const missing = pending.filter((p) => !after.has(p.sourceUrl));
    if (missing.length) {
      throw new Fail(
        '검증',
        `적재는 성공했다는데 ${missing.length}/${pending.length}건이 DB 에서 보이지 않는다.`,
        missing.map((p) => `누락: ${p.sourceUrl}`).join('\n'),
      );
    }
    log(`  ${pending.length}건 전부 확인.`);
  } catch (e) {
    if (e instanceof RestRestrictedError) {
      verified = false;
      warn('경고: 검증 조회가 Supabase 제한(402)에 막혔다 — 적재 자체는 성공(exit 0)이므로 실패로 보지 않는다.');
    } else if (e instanceof Fail) throw e;
    else throw new Fail('검증', String(e.message || e));
  }

  return { status: 'ok', pending, candidates: cands.total, verified };
}

// ── CLI ───────────────────────────────────────────────────────
async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${String(e.message || e)}\n${USAGE}`);
    return 1;
  }

  const today = kstToday();
  const stateDir = resolve(opts.stateDir ?? DEFAULT_STATE_DIR);
  mkdirSync(stateDir, { recursive: true });
  const logFile = join(stateDir, `board-sync-${ymd(today)}.log`);
  const stateFile = join(stateDir, 'board-sync.json');
  const lockFile = join(stateDir, 'board-sync.lock');
  const pendingDir = join(stateDir, 'board-sync', 'pending');

  openLog(logFile);
  log(`[board-sync] 기준일 ${ymd(today)} (KST) · 상태 ${stateDir}${opts.dryRun ? ' · dry-run' : ''}`);
  log(`  로그: ${logFile}`);

  // ① 잠금
  if (!acquireLock(lockFile)) {
    closeLog('===== 잠금으로 건너뜀 =====');
    return 0;
  }
  const release = () => releaseLock(lockFile);
  process.on('SIGINT', () => {
    release();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    release();
    process.exit(143);
  });

  const now = () => new Date().toISOString();
  let exitCode = 0;
  try {
    const r = await run(opts, { today, stateDir, pendingDir, logFile });
    if (r.status === 'deferred') {
      writeState(stateFile, { lastRunAt: now(), deferred: true, lastDeferredAt: now(), lastCandidates: r.candidates });
      log('결과: 보류(Supabase 제한) — 실패가 아니다.');
    } else if (r.status === 'none') {
      writeState(stateFile, { lastRunAt: now(), lastSuccessAt: now(), deferred: false, lastImported: [] });
      log('결과: 신규 없음.');
    } else if (r.status === 'dry-run') {
      writeState(stateFile, { lastRunAt: now(), lastDryRunAt: now(), lastDryRunPending: r.pending.length });
      log(`결과: dry-run — 신규 ${r.pending.length}건(적재하지 않음).`);
    } else {
      const imported = r.pending.map((p) => ({
        board: p.board,
        articleNo: String(p.articleNo ?? ''),
        title: p.title ?? null,
        date: p.date ?? null,
        importedAt: now(),
      }));
      writeState(
        stateFile,
        {
          lastRunAt: now(),
          lastSuccessAt: now(),
          deferred: false,
          lastImported: imported.map(({ board, articleNo, title, date }) => ({ board, articleNo, title, date })),
          lastVerified: r.verified !== false,
        },
        imported,
      );
      log(`결과: 성공 — 신규 ${imported.length}건 적재.`);
      log('  사이트 반영은 목록 캐시가 만료된 뒤(최대 24시간) 보인다.');
    }
  } catch (e) {
    exitCode = 1;
    const fail = e instanceof Fail ? e : new Fail('알 수 없음', String(e?.message || e), String(e?.stack ?? ''));
    errLog(`실패 [${fail.step}] ${fail.message}`);
    writeState(stateFile, {
      lastRunAt: now(),
      lastFailedAt: now(),
      lastFailedStep: fail.step,
      lastError: fail.message,
    });
    await reportFailure({ fail, dryRun: opts.dryRun, logFile, stateDir, today });
  } finally {
    release();
  }

  closeLog(`===== exit ${exitCode} @ ${new Date().toISOString()} =====`);
  return exitCode;
}

// 직접 실행됐을 때만 CLI 로 동작한다(parseListCounts 만 import 할 수 있게).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main();
}
