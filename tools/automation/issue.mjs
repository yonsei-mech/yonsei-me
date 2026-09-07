/**
 * GitHub 이슈 생성·중복 방지 헬퍼 — 자동화의 알림 채널을 이슈 하나로 통일한다.
 *
 *   node tools/automation/issue.mjs --title "<제목>" --body-file <경로> [--label automation] [--dry-run]
 *
 *   # 모듈로도 쓴다 (remind.mjs 가 이렇게 부른다)
 *   import { createOrComment } from './issue.mjs';
 *   await createOrComment({ title, body, label: 'automation', dryRun: true });
 *
 * 하는 일
 *   ① 제목에서 끝의 ` (YYYY-MM-DD)` 를 뗀 **접두**를 만든다.
 *   ② `gh issue list --state open --search 'in:title "<접두>"'` 로 같은 접두의 열린 이슈를
 *      찾는다. GitHub 검색은 퍼지라 결과를 클라이언트에서 `title.startsWith(접두)` 로
 *      다시 거른다.
 *   ③ 있으면 그 이슈에 **댓글**, 없으면 라벨을 보장한 뒤 **새 이슈**. 반복 실패의 이력이
 *      한 이슈에 쌓이고 알림이 흩어지지 않는다(automation-plan.md 2절 5).
 *   ④ `--dry-run` 은 아무것도 쓰지 않고 제목·본문·판정만 찍는다. `GITHUB_STEP_SUMMARY`
 *      가 있으면 그 파일에도 덧붙여 Actions 요약 화면에서 그대로 읽을 수 있게 한다.
 *
 * 종료 코드: 0 성공 · 1 인자 오류 / gh 실패 / (dry-run 이 아닌데 토큰 없음)
 *
 * ⚠️ 함정
 *   - `gh` 실행에 `shell` 옵션을 쓰지 않는다. 제목에 `[]`·`()`·따옴표가 들어가는데 셸을
 *     거치면 이스케이프가 깨진다. spawnSync 의 argv 전달이면 그런 문제가 없다.
 *   - 본문은 항상 파일로 넘긴다(`--body-file`). 개행이 많고 로그 인용이 길어서 argv 길이
 *     한계(Windows ~32KB)에 걸릴 수 있다. 모듈 호출로 받은 문자열도 임시 파일에 쓴다.
 *   - 이 저장소는 **Public** 이다. 이슈 본문에 비밀값·개인정보를 넣지 말 것(spec 0-2).
 *
 * 의존성: 없음(Node 24 내장 + 러너에 설치된 gh CLI).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_LABEL = 'automation';
const LABEL_COLOR = '0057A8'; // 디자인 토큰 blue
const LABEL_DESCRIPTION = '자동화 워크플로가 만든 이슈';
const RULE = '─'.repeat(72);

/** 제목 접두 = 끝의 ` (YYYY-MM-DD)` 를 뗀 문자열. 날짜만 다른 같은 사건을 한 이슈로 모은다. */
export function titlePrefix(title) {
  return title.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '').trim();
}

function hasToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return true;
  // 작업 스케줄러·로컬 실행에는 토큰 환경변수가 없고 gh 로그인만 있는 게 보통이다(Actions 는
  // GH_TOKEN 을 준다). gh 에게 토큰을 물어 채워 둔다 — 값은 어디에도 찍지 않는다. 실패하면 없는 것.
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  const token = r.status === 0 ? String(r.stdout ?? '').trim() : '';
  if (!token) return false;
  process.env.GH_TOKEN = token;
  return true;
}

/** gh 를 셸 없이 실행한다. { ok, stdout, stderr } */
function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.error) return { ok: false, stdout: '', stderr: String(r.error.message || r.error) };
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * 같은 접두의 열린 이슈 번호. 없으면 null. 조회 자체가 실패하면 throw.
 *
 * `--search 'in:title …'` 를 쓰지 않는다 — 제목에 `[자동]`·`(2026-21)` 같은 대괄호·괄호가
 * 들어가는데 GitHub 검색 구문이 이를 어떻게 해석할지 보장이 없다. 열린 이슈 전체(자동화
 * 이슈는 많아야 수십 개)를 받아 클라이언트에서 접두 일치를 본다.
 */
function findOpenIssue(prefix) {
  const r = gh(['issue', 'list', '--state', 'open', '--json', 'number,title', '--limit', '200']);
  if (!r.ok) throw new Error(`gh issue list 실패: ${r.stderr.trim() || '(stderr 없음)'}`);
  let rows;
  try {
    rows = JSON.parse(r.stdout || '[]');
  } catch {
    throw new Error(`gh issue list 출력을 JSON 으로 읽지 못했다: ${r.stdout.slice(0, 200)}`);
  }
  const hit = rows.find((row) => typeof row.title === 'string' && row.title.startsWith(prefix));
  return hit ? hit.number : null;
}

/** 본문을 임시 파일에 담아 fn(경로) 를 부르고, 끝나면 지운다. */
function withBodyFile(body, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'yme-issue-'));
  const file = join(dir, 'body.md');
  writeFileSync(file, body, 'utf8');
  try {
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function printDryRun({ title, body, label, verdict }) {
  const block = [
    RULE,
    '[dry-run] 이슈를 만들지 않는다 — 내용과 판정만 출력한다.',
    `제목 : ${title}`,
    `라벨 : ${label}`,
    `판정 : ${verdict}`,
    RULE,
    body,
    RULE,
  ].join('\n');
  console.log(block);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const md = [
      `### [dry-run] ${title}`,
      '',
      `- 라벨: \`${label}\``,
      `- 판정: ${verdict}`,
      '',
      body,
      '',
    ].join('\n');
    appendFileSync(summary, `${md}\n`, 'utf8');
  }
}

/**
 * 같은 접두의 열린 이슈가 있으면 댓글, 없으면 새 이슈.
 * @returns {Promise<{ mode: 'created'|'commented'|'dry-run', number: number|null }>}
 */
export async function createOrComment({ title, body, label = DEFAULT_LABEL, dryRun = false }) {
  if (typeof title !== 'string' || title.trim() === '') throw new Error('title 이 비었다.');
  if (typeof body !== 'string' || body.trim() === '') throw new Error('body 가 비었다.');
  const prefix = titlePrefix(title);

  if (!dryRun && !hasToken()) {
    throw new Error('GH_TOKEN(또는 GITHUB_TOKEN)도 gh 로그인도 없다 — 실제 이슈를 만들 수 없다. --dry-run 을 쓰거나 토큰을 넣을 것.');
  }

  if (dryRun) {
    // 쓰기는 절대 하지 않는다. 토큰이 있으면 목록 조회만 해서 신규/댓글을 미리 알려 준다.
    let verdict;
    if (!hasToken()) {
      verdict = '판정 불가(토큰 없음) — 신규로 가정';
    } else {
      try {
        const existing = findOpenIssue(prefix);
        verdict = existing ? `기존 이슈 #${existing} 에 댓글` : '신규 이슈';
      } catch (e) {
        verdict = `판정 불가(조회 실패: ${String(e.message || e)}) — 신규로 가정`;
      }
    }
    printDryRun({ title, body, label, verdict });
    return { mode: 'dry-run', number: null };
  }

  // 중복 조회가 실패해도 알림 자체를 잃지 않는다 — 경고만 남기고 새 이슈로 간다.
  let existing = null;
  try {
    existing = findOpenIssue(prefix);
  } catch (e) {
    console.warn(`::warning::열린 이슈 조회 실패(중복 방지 생략): ${String(e.message || e)}`);
  }
  if (existing) {
    const r = withBodyFile(body, (file) =>
      gh(['issue', 'comment', String(existing), '--body-file', file]),
    );
    if (!r.ok) throw new Error(`gh issue comment 실패: ${r.stderr.trim() || '(stderr 없음)'}`);
    console.log(`기존 이슈 #${existing} 에 댓글을 달았다. ${r.stdout.trim()}`);
    return { mode: 'commented', number: existing };
  }

  // 라벨이 없으면 만든다. --force 는 이미 있을 때 색·설명만 갱신하고 성공한다.
  const madeLabel = gh([
    'label',
    'create',
    label,
    '--color',
    LABEL_COLOR,
    '--description',
    LABEL_DESCRIPTION,
    '--force',
  ]);
  if (!madeLabel.ok) {
    // 라벨 실패로 알림 자체를 잃지 않는다 — 경고만 남기고 이슈는 만든다.
    console.warn(`::warning::라벨 '${label}' 보장 실패: ${madeLabel.stderr.trim()}`);
  }

  const r = withBodyFile(body, (file) =>
    gh(['issue', 'create', '--title', title, '--body-file', file, '--label', label]),
  );
  if (!r.ok) throw new Error(`gh issue create 실패: ${r.stderr.trim() || '(stderr 없음)'}`);
  const url = r.stdout.trim();
  console.log(`새 이슈를 만들었다. ${url}`);
  const number = Number(url.match(/\/(\d+)\s*$/)?.[1] ?? 0) || null;
  return { mode: 'created', number };
}

// ── CLI ────────────────────────────────────────────────────────
const USAGE =
  '사용법: node tools/automation/issue.mjs --title "<제목>" --body-file <경로> [--label automation] [--dry-run]';

function parseArgs(argv) {
  const out = { label: DEFAULT_LABEL, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--title') out.title = argv[++i];
    else if (a === '--body-file') out.bodyFile = argv[++i];
    else if (a === '--label') out.label = argv[++i];
    else if (a.startsWith('--title=')) out.title = a.slice('--title='.length);
    else if (a.startsWith('--body-file=')) out.bodyFile = a.slice('--body-file='.length);
    else if (a.startsWith('--label=')) out.label = a.slice('--label='.length);
    else throw new Error(`알 수 없는 인자: ${a}`);
  }
  if (!out.title) throw new Error('--title 이 없다.');
  if (!out.bodyFile) throw new Error('--body-file 이 없다.');
  return out;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${String(e.message || e)}\n${USAGE}`);
    process.exit(1);
  }
  let body;
  try {
    body = readFileSync(opts.bodyFile, 'utf8');
  } catch (e) {
    console.error(`본문 파일을 읽지 못했다 (${opts.bodyFile}): ${String(e.message || e)}`);
    process.exit(1);
  }
  try {
    await createOrComment({ title: opts.title, body, label: opts.label, dryRun: opts.dryRun });
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
}

// 직접 실행됐을 때만 CLI 로 동작한다(모듈 import 는 부작용 없음).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
