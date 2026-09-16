/**
 * 원본 게시판 전량 수집기 (개발 전용 · 게시판 DB 이전용 1회성 + 이후 증분 갱신)
 *
 *   node tools/crawl-boards.mjs [--board=<key>] [--since=YYYY-MM-DD] [--all] [--force] [--limit=N]
 *
 * 하는 일
 *   ① 게시판마다 목록을 **한 번의 요청**으로 통째로 받는다(articleLimit=2000).
 *      원본이 936행까지 잘림 없이 내려주는 걸 확인해서 페이지네이션 루프를 두지 않았다.
 *   ② --since 이후 글만 골라 상세 페이지를 순차로 받아 본문·첨부를 뽑는다.
 *   ③ tools/boards-raw/<boardKey>.json 한 개씩 쓴다. 이 파일 형식은 다음 단계(DB 적재)가
 *      그대로 읽으므로 필드를 임의로 바꾸면 안 된다.
 *
 * 왜 이렇게 만들었나
 *   - **이어받기**: 기본 실행이 1,200요청이 넘어서 한 번에 끝난다는 보장이 없다. 시작할 때
 *     기존 JSON 을 읽어 이미 있는 articleNo 는 건너뛴다. 처음부터 다시 받으려면 --force.
 *   - **중간 저장**: 25건마다 파일을 다시 쓴다. Ctrl-C 나 네트워크 끊김에 여태 받은 게
 *     날아가지 않게. SIGINT 도 잡아서 마지막 상태를 저장하고 나간다.
 *   - **날짜는 목록 것을 쓴다**: 상세의 작성일과 어긋나는 경우가 있는데, 목록 쪽이 정렬
 *     기준과 일치해서 일관적이다. 어긋난 건수는 세어서 끝에 보고만 한다.
 *   - 개별 요청 실패는 그 글만 건너뛰고 계속 간다. 마지막에 실패 목록을 찍는다.
 *
 * 상대 서버 배려: 순차 처리 + 요청 사이 300ms 지연(board-source.mjs 의 DELAY_MS).
 * 의존성 없음: Node 24 내장 fetch 만 쓴다(cheerio 등 설치 금지).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BOARDS,
  BOARD_BY_KEY,
  DELAY_MS,
  MissingPostError,
  get,
  listUrl,
  parseDetail,
  parseList,
  sleep,
  viewUrl,
} from './board-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'tools', 'boards-raw');

/**
 * 뉴스와 자료실은 --since 를 무시하고 **항상 전량** 받는다.
 * 뉴스(283건)는 학과 홍보 자료라 오래된 것도 그대로 쓸 계획이고, 자료실(7건)은 전체가
 * 상시 유효한 서식 모음이라 날짜로 자르면 안 된다. 의도된 하드코딩이다.
 */
const ALWAYS_FULL = new Set(['news', 'resources']);

const DEFAULT_SINCE = '2023-01-01';
const SAVE_EVERY = 25;

// ── 인자 ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { boards: [], since: DEFAULT_SINCE, all: false, force: false, limit: Infinity };
  for (const raw of argv) {
    const [flag, value] = raw.includes('=') ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)] : [raw, ''];
    switch (flag) {
      case '--board':
        opts.boards.push(...value.split(',').map((v) => v.trim()).filter(Boolean));
        break;
      case '--since':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`--since 는 YYYY-MM-DD 형식이어야 한다: ${value}`);
        opts.since = value;
        break;
      case '--all':
        opts.all = true;
        break;
      case '--force':
        opts.force = true;
        break;
      case '--limit': {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) fail(`--limit 은 양의 정수여야 한다: ${value}`);
        opts.limit = n;
        break;
      }
      default:
        fail(`모르는 인자: ${raw}`);
    }
  }
  return opts;
}

function fail(msg) {
  console.error(`오류: ${msg}`);
  console.error(`\n사용법: node tools/crawl-boards.mjs [--board=<key>] [--since=YYYY-MM-DD] [--all] [--force] [--limit=N]`);
  console.error(`게시판 key: ${BOARDS.map((b) => b.key).join(', ')}`);
  process.exit(1);
}

const opts = parseArgs(process.argv.slice(2));
for (const key of opts.boards) if (!BOARD_BY_KEY.has(key)) fail(`모르는 게시판 key: ${key}`);
const targetBoards = opts.boards.length ? opts.boards.map((k) => BOARD_BY_KEY.get(k)) : BOARDS;

// ── 파일 입출력 ────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const outPath = (board) => join(OUT_DIR, `${board.key}.json`);

/** 기존 산출물을 { articleNo → post } 로 읽는다. 없거나 깨졌으면 빈 맵. */
function loadExisting(board) {
  const p = outPath(board);
  if (!existsSync(p)) return new Map();
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return new Map((data.posts || []).map((post) => [String(post.articleNo), post]));
  } catch (e) {
    console.warn(`  (기존 ${board.key}.json 을 읽지 못해 처음부터 받는다: ${e.message})`);
    return new Map();
  }
}

/** 날짜 내림차순, 같은 날짜면 articleNo 내림차순(원본 목록 순서와 같아진다). */
function byDateDesc(a, b) {
  const d = String(b.date || '').localeCompare(String(a.date || ''));
  return d !== 0 ? d : Number(b.articleNo) - Number(a.articleNo);
}

function writeBoard(board, postsByNo) {
  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    board: board.key,
    sourcePath: board.path,
    crawledAt: today,
    posts: [...postsByNo.values()].sort(byDateDesc),
  };
  writeFileSync(outPath(board), JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

// Ctrl-C 로 끊겨도 여태 받은 건 남기고 나간다.
let flushOnExit = null;
process.on('SIGINT', () => {
  if (flushOnExit) {
    flushOnExit();
    console.log('\n중단됨 — 여기까지 받은 내용은 저장했다. 같은 명령을 다시 돌리면 이어받는다.');
  }
  process.exit(130);
});

// ── 진행 표시 ──────────────────────────────────────────────────
function tick(done, total) {
  const line = `  ${done}/${total} 상세 수집`;
  if (process.stdout.isTTY) process.stdout.write(`\r${line}    `);
  else if (done % SAVE_EVERY === 0 || done === total) console.log(line);
}
function tickEnd() {
  if (process.stdout.isTTY) process.stdout.write('\n');
}

// ── 실행 ───────────────────────────────────────────────────────
const failures = []; // { board, articleNo, reason }
const stats = []; // 게시판별 요약
let totalDateMismatch = 0;
const mismatchSamples = [];
// 목록에 클립 아이콘이 있는데 상세에서 첨부를 못 뽑았다면 상세 파서가 뭔가 놓친 것이다.
let totalIconWithoutAttachment = 0;
const iconSamples = [];

console.log(
  `게시판 ${targetBoards.length}개 · ${opts.all ? '전체 기간' : `${opts.since} 이후`}` +
    `${opts.force ? ' · 강제 재수집' : ' · 이어받기'}` +
    `${opts.limit === Infinity ? '' : ` · 게시판당 최대 ${opts.limit}건`}` +
    ` · 요청 간 ${DELAY_MS}ms 지연\n`,
);

for (const board of targetBoards) {
  let listHtml;
  try {
    // 게시판 항목을 통째로 넘긴다 — 디렉터리(base)가 게시판마다 다를 수 있다(BK21).
    listHtml = await get(listUrl(board));
  } catch (e) {
    console.log(`${board.label} … 목록 요청 실패 — 건너뜀`);
    failures.push({ board: board.key, articleNo: '(목록)', reason: String(e.message || e) });
    stats.push({ board, list: 0, target: 0, fetched: 0, kept: 0, attachments: 0 });
    continue;
  }
  await sleep(DELAY_MS);

  const items = parseList(board, listHtml);

  // 뉴스·자료실은 전량. 그 외에는 --all 이 아니면 --since 로 자른다(날짜 없는 글은 남긴다).
  const full = opts.all || ALWAYS_FULL.has(board.key);
  const targets = full ? items : items.filter((it) => !it.date || it.date >= opts.since);

  // --force 는 "이번 대상만" 다시 받는 것이다. 대상 밖 글(지난번 --all 로 받아 둔 옛날 글
  // 같은 것)까지 버리면 되레 손해라 그대로 남긴다.
  const postsByNo = loadExisting(board);
  if (opts.force) for (const t of targets) postsByNo.delete(t.articleNo);

  let pending = targets.filter((it) => !postsByNo.has(it.articleNo));
  if (pending.length > opts.limit) pending = pending.slice(0, opts.limit);

  console.log(
    `${board.label} … 목록 ${items.length}건 → 대상 ${targets.length}건 → 신규 ${pending.length}건` +
      (full && !opts.all ? ' (전량 고정)' : ''),
  );

  flushOnExit = () => writeBoard(board, postsByNo);

  let done = 0;
  let sinceSave = 0;
  for (const item of pending) {
    const url = viewUrl(board, item.articleNo);
    try {
      const html = await get(url);
      const detail = parseDetail(html, { articleNo: item.articleNo, pageUrl: url });

      // 날짜는 목록 것이 정본. 상세와 어긋나면 세어 두고 보고만 한다.
      if (detail.date && item.date && detail.date !== item.date) {
        totalDateMismatch += 1;
        if (mismatchSamples.length < 10) {
          mismatchSamples.push(`${board.key}/${item.articleNo} 목록 ${item.date} ≠ 상세 ${detail.date}`);
        }
      }

      if (item.hasFile && detail.attachments.length === 0) {
        totalIconWithoutAttachment += 1;
        if (iconSamples.length < 10) iconSamples.push(`${board.key}/${item.articleNo}`);
      }

      postsByNo.set(item.articleNo, {
        articleNo: item.articleNo,
        sourceUrl: url,
        date: item.date,
        // 상세 제목이 정본이지만, 혹시 남아 있을 [공지] 접두사는 떼어낸다.
        title: (detail.title || item.title || '').replace(/^\[공지\]\s*/, '') || null,
        author: detail.author || item.author || null,
        pinned: Boolean(item.pinned),
        bodyHtml: detail.bodyHtml, // 원문 그대로 — 정규화는 다음 단계 몫
        thumbnail: item.thumbnail ?? null, // 뉴스에서만 채워진다
        excerpt: item.excerpt ?? null,
        attachments: detail.attachments,
        fetchedAt: today,
      });
    } catch (e) {
      const reason = e instanceof MissingPostError ? e.message : String(e.message || e);
      failures.push({ board: board.key, articleNo: item.articleNo, reason });
    }

    done += 1;
    sinceSave += 1;
    tick(done, pending.length);
    if (sinceSave >= SAVE_EVERY) {
      writeBoard(board, postsByNo);
      sinceSave = 0;
    }
    await sleep(DELAY_MS);
  }
  if (pending.length) tickEnd();

  writeBoard(board, postsByNo);
  flushOnExit = null;

  const attachments = [...postsByNo.values()].reduce((n, p) => n + (p.attachments?.length || 0), 0);
  stats.push({
    board,
    list: items.length,
    target: targets.length,
    fetched: pending.length,
    kept: postsByNo.size,
    attachments,
  });
}

// ── 요약 ───────────────────────────────────────────────────────
console.log('\n─ 요약 ────────────────────────────────');
const pad = (s, n) => String(s).padEnd(n, ' ');
for (const s of stats) {
  console.log(
    `  ${pad(s.board.label, 14)} 목록 ${pad(s.list, 5)} 대상 ${pad(s.target, 5)} ` +
      `신규 ${pad(s.fetched, 5)} 저장 ${pad(s.kept, 5)} 첨부 ${s.attachments}`,
  );
}
const totalPosts = stats.reduce((n, s) => n + s.kept, 0);
const totalAttachments = stats.reduce((n, s) => n + s.attachments, 0);
const totalNew = stats.reduce((n, s) => n + s.fetched, 0);
console.log(`\n  총 ${totalPosts}건 저장(이번 실행 신규 ${totalNew}건) · 첨부 ${totalAttachments}건 → tools/boards-raw/`);

if (totalDateMismatch) {
  console.log(`\n목록/상세 작성일 불일치 ${totalDateMismatch}건 (목록 날짜를 채택함):`);
  for (const s of mismatchSamples) console.log(`  - ${s}`);
  if (totalDateMismatch > mismatchSamples.length) {
    console.log(`  … 외 ${totalDateMismatch - mismatchSamples.length}건`);
  }
} else {
  console.log('  목록/상세 작성일 불일치 없음.');
}

if (totalIconWithoutAttachment) {
  console.log(
    `\n⚠️ 목록에 첨부 아이콘이 있는데 상세에서 첨부를 못 찾은 글 ${totalIconWithoutAttachment}건 — 상세 파서 점검 필요:`,
  );
  console.log(`  ${iconSamples.join(', ')}${totalIconWithoutAttachment > iconSamples.length ? ' …' : ''}`);
}

if (failures.length) {
  console.log(`\n실패한 요청 ${failures.length}건:`);
  for (const f of failures) console.log(`  - ${f.board} / articleNo=${f.articleNo} : ${f.reason}`);
} else {
  console.log('  실패한 요청 없음.');
}
