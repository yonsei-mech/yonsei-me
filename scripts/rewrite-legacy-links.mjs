// 구 서버(me.yonsei.ac.kr / devcms.yonsei.ac.kr) **링크** 재작성 — 도메인 컷오버 전 1회성 작업.
//
// 왜: scripts/mirror-legacy-assets.mjs 가 이미지·첨부 같은 **자산**은 R2 로 미러링했다.
// 남은 것은 자산이 아니라 링크다 — DNS 가 me.yonsei.ac.kr 을 Vercel 로 돌리는 순간
// 본문에 절대경로로 박힌 구 사이트 링크는 전부 우리 404 로 떨어진다.
//
// 실행: node scripts/rewrite-legacy-links.mjs [--apply]
//   기본은 드라이런 — DB 를 읽어 분류·치환안만 출력하고 아무것도 쓰지 않는다.
//   --apply: ① 영향 행 스냅숏 저장 ② DB 치환 ③ repo 파일 갱신 ④ 재스캔 검증.
//
// 재작성 대상 3종
//   A. 게시물 간 상호 링크 — `/me/community/<파일>.do?mode=view&articleNo=<N>` 형태.
//      우리 posts 는 구 사이트에서 임포트됐고 각 행의 source_url 이 구 URL 이라,
//      **전 posts 의 source_url 에서 articleNo 를 파싱해 만든 Map** 으로 대상 글을 찾는다.
//      (제목 매칭 같은 휴리스틱은 쓰지 않는다 — articleNo 는 구 사이트의 기본키다.)
//   B. 깨진 상대링크 — 구 에디터에서 프로토콜 없이 쓴 외부 링크가 `/me/community/` 를
//      기준으로 절대화된 것들. 꼬리가 **명백히 호스트로 시작할 때만** 화이트리스트로 복원한다.
//   C. content/faculty-directory.json 의 죽은 moreInfoUrl → null (DB + repo 파일 양쪽).
//
// 설계 메모
//  - source_url 은 치환하지 않는다 — 게시물의 멱등 키이자 "원문" 표기다(A 의 조회 키이기도 하다).
//  - body_html 안의 URL 은 sanitize-html 직렬화 때문에 &amp; 로 인코딩돼 있다.
//    매치 문자열(M)과 논리 URL(M 의 &amp;→&)을 분리해서 다루고, **치환은 M 그대로** 한다.
//    B 의 새 URL 도 꼬리를 매치된 표기 그대로 이어 붙여 &amp; 를 보존한다.
//  - 분류되지 않은 잔여 URL 은 절대 손대지 않고 "미분류" 버킷으로 전량 출력한다 —
//    쓰레기 링크(`.../routes.The`)를 그럴듯한 주소로 지어내는 것이 최악이다.
//  - 로케일: 링크가 들어 있던 컬럼이 *_ko 면 /ko, *_en 이면 /en 을 붙인다.
//    로케일이 없는 컬럼(thumbnail_url)은 /ko 로 둔다(실측상 해당 없음).
//  - 롤백: tools/legacy-links-snapshot-<날짜>.json 에 영향 행의 이전 값을 통째로 남긴다
//    (커밋 금지 — 로컬 보관용, mirror 스크립트와 같은 철학).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// ── .env.local 로더 (scripts/mirror-legacy-assets.mjs 와 동일) ──
{
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of ['.env.local', join(here, '..', '.env.local')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
    break;
  }
}

const APPLY = process.argv.includes('--apply');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FACULTY_PATH = 'content/faculty-directory.json';

// 치환 대상 텍스트 컬럼 (source_url 제외 — 위 설계 메모)
const POST_COLS = [
  'body_html_ko', 'body_html_en', 'body_md_ko', 'body_md_en',
  'excerpt_ko', 'excerpt_en', 'thumbnail_url',
];

// 레거시 CMS 두 호스트를 모두 훑는다 — devcms 는 구 사이트의 스테이징 도메인이라
// 컷오버와 무관하게 이미 죽어 있거나 곧 죽는다.
const LEGACY_RE = /https?:\/\/(?:me|devcms)\.yonsei\.ac\.kr\/[^\s"'<>]*/g;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── 전량 조회 (1,000행 페이지) ──────────────────────────────────
async function fetchAll(table, columns, orderCol = 'id') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).order(orderCol).range(from, from + 999);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

/** 매치 문자열 끝의 명백한 부스러기(닫는 따옴표 엔티티·문장부호)만 떼어낸다. */
function trimMatch(m) {
  return m.replace(/(&quot;|&#39;|&amp;)+$/, '').replace(/[.,;:)]+$/, '');
}
const decodeAmp = (s) => s.replaceAll('&amp;', '&');

function extractMatches(text) {
  if (!text) return [];
  return [...String(text).matchAll(LEGACY_RE)].map((m) => trimMatch(m[0])).filter(Boolean);
}

// ── 게시판 경로 — src/lib/board-links.ts 의 복제본 ──────────────────────────
// ⚠️ 단일 출처는 src/lib/board-links.ts 다. 여기는 .mjs 라 TS 를 import 할 수 없어
//    아래 두 표를 손으로 복제했다. board-links.ts / src/lib/posts.ts 가 바뀌면 여기도 고칠 것.
//
// (1) DB posts.board → BoardPost.boardKey  — 출처: src/lib/posts.ts 의 BOARD_POST_META
//     (통합 게시판 6종. news/alumniEvents/calendar/instagram 은 이 표에 없고
//      자기 전용 라우트를 쓴다 — 아래 (2) 에서 따로 처리한다.)
const BOARD_KEY_BY_DB_BOARD = {
  noticesUndergrad: 'notices',
  noticesGraduate: 'notices',
  noticesExternal: 'notices',
  noticesScholarship: 'notices',
  seminars: 'seminars',
  events: 'events',
  thesis: 'thesis',
  career: 'career',
  resources: 'resources',
};

// (2) 상세 경로 — 출처: src/lib/board-links.ts 의 boardPostHref / newsArticleHref /
//     alumniEventHref. 로케일 접두사는 호출부에서 붙인다.
//     · thesis 만 /graduate 아래 (대학원 메뉴 소속 — 2026-09 이관)
//     · 뉴스 기사 탭은 URL 세그먼트가 'press' (/news/news/ 중첩 회피)
//     · 뉴스형 상세의 주소는 `slug ?? String(id)` — posts.ts 의 toNews 와 같은 규칙
function postHrefNoLocale(row) {
  const key = BOARD_KEY_BY_DB_BOARD[row.board];
  if (key === 'thesis') return `/graduate/thesis/${row.id}`;
  if (key) return `/news/${key}/${row.id}`;
  if (row.board === 'news') return `/news/press/${row.slug ?? String(row.id)}`;
  if (row.board === 'alumniEvents') return `/alumni/network/${row.id}`;
  return null; // calendar·instagram 등 상세 라우트가 없는 게시판
}

/** 링크가 있던 컬럼명 → 로케일 접두사 */
const localeOf = (col) => (col.endsWith('_en') ? '/en' : '/ko');

// ── 분류기 ──────────────────────────────────────────────────────
// 구 CMS 의 게시판 상세/목록 주소: /me/community/<파일>.do?…
// 꼬리 첫 세그먼트가 정확히 `<이름>.do` 이고 바로 물음표가 오는 경우만 인정한다.
// (`/me/community/doi.org/10.1016/…` 같은 깨진 상대링크가 여기 걸리면 안 된다.)
const BOARD_LINK_RE = /^\/me\/community\/([A-Za-z0-9_]+\.do)\?(.*)$/;

// 깨진 상대링크(B) 화이트리스트 — 꼬리가 "명백히 호스트로 시작"할 때만 복원한다.
const HOST_TLD_RE = /^[a-z0-9][a-z0-9.-]*\.(ac\.kr|or\.kr|go\.kr|com|org|net)$/;
function looksLikeHost(tail) {
  if (tail.startsWith('www.')) return true;
  if (tail.startsWith('doi.org/')) return true;
  if (tail.startsWith('portal.yonsei.ac.kr')) return true;
  // 첫 세그먼트(=/ ? # 이전)가 통째로 도메인처럼 생겼을 때만
  const head = tail.split(/[/?#]/, 1)[0];
  return HOST_TLD_RE.test(head.toLowerCase());
}

/**
 * 매치 문자열 하나를 분류한다.
 * 반환: { kind: 'A'|'A-list'|'B'|'?', … }
 *   A       게시물 상호 링크 (articleNo 있음) — legacyFile·articleNo 를 함께 준다
 *   A-list  게시판 목록 링크 (articleNo 없음) — 보고만, 치환 안 함
 *   B       깨진 상대링크 — newUrl 확정
 *   ?       미분류 — 손대지 않는다
 */
function classify(matchStr) {
  const logical = decodeAmp(matchStr); // 판정은 논리 URL 로, 치환은 matchStr 로
  let u;
  try {
    u = new URL(logical);
  } catch {
    return { kind: '?', why: 'URL 파싱 실패' };
  }
  const rest = u.pathname + u.search;

  const board = rest.match(BOARD_LINK_RE);
  if (board) {
    const legacyFile = board[1];
    const art = logical.match(/[?&]articleNo=(\d+)/);
    if (art && /[?&]mode=view\b/.test(logical)) {
      return { kind: 'A', legacyFile, articleNo: art[1] };
    }
    return { kind: 'A-list', legacyFile, why: 'mode=view + articleNo 가 아닌 목록 링크' };
  }

  // /me/community/<꼬리> 형태의 깨진 상대링크
  const rel = rest.match(/^\/me\/community\/(.+)$/);
  if (rel) {
    // 원본 표기(&amp; 보존)에서 같은 자리를 잘라 낸다 — 치환문을 원문 표기로 만들기 위함
    const idx = matchStr.indexOf('/me/community/');
    const tailAsWritten = matchStr.slice(idx + '/me/community/'.length);
    if (looksLikeHost(rel[1])) {
      return { kind: 'B', newUrl: `https://${tailAsWritten}` };
    }
    return { kind: '?', why: '꼬리가 호스트로 보이지 않음(화이트리스트 미통과)' };
  }

  return { kind: '?', why: `자산/기타 경로 (${u.host}${u.pathname.slice(0, 40)})` };
}

// ── 스캔 ────────────────────────────────────────────────────────
const posts = await fetchAll('posts', ['id', 'board', 'slug', 'source_url', ...POST_COLS].join(','));
const contentFiles = await fetchAll('content_files', 'path,body,version', 'path');

// articleNo → posts 행들 (구 사이트 기본키 기준 역인덱스)
const byArticleNo = new Map();
for (const p of posts) {
  const m = String(p.source_url ?? '').match(/[?&]articleNo=(\d+)/);
  if (!m) continue;
  if (!byArticleNo.has(m[1])) byArticleNo.set(m[1], []);
  byArticleNo.get(m[1]).push(p);
}
/** source_url 의 레거시 파일명(notice.do 등) — 같은 articleNo 가 겹칠 때의 판별자 */
const legacyFileOf = (row) =>
  String(row.source_url ?? '').match(/\/me\/community\/([A-Za-z0-9_]+\.do)/)?.[1] ?? null;

// 매치 문자열 → 발생 위치들
/** @type {Map<string, {where:{id:number,col:string}[]}>} */
const hits = new Map();
for (const p of posts) {
  for (const col of POST_COLS) {
    for (const m of extractMatches(p[col])) {
      if (!hits.has(m)) hits.set(m, { where: [] });
      hits.get(m).where.push({ id: p.id, col });
    }
  }
}

// ── 분류 결과 버킷 ──────────────────────────────────────────────
const bucketA = [];      // { match, occurrences, target, newPaths:Map<locale,path> }
const bucketAMiss = [];  // DB 에 대상 글이 없는 상호 링크
const bucketAAmbig = []; // articleNo 가 여러 행에 걸려 판별 실패
const bucketAList = [];  // 목록 링크(보고만)
const bucketB = [];      // { match, occurrences, newUrl }
const bucketUnknown = [];// { match, occurrences, why }

for (const [match, info] of [...hits.entries()].sort()) {
  const c = classify(match);
  const occurrences = info.where;

  if (c.kind === 'A-list') {
    bucketAList.push({ match, occurrences, why: c.why });
    continue;
  }
  if (c.kind === 'B') {
    bucketB.push({ match, occurrences, newUrl: c.newUrl });
    continue;
  }
  if (c.kind === '?') {
    bucketUnknown.push({ match, occurrences, why: c.why });
    continue;
  }

  // kind === 'A'
  const candidates = byArticleNo.get(c.articleNo) ?? [];
  let target = null;
  if (candidates.length === 1) {
    target = candidates[0];
  } else if (candidates.length > 1) {
    // 같은 articleNo 가 여러 행이면 레거시 게시판 파일명까지 같아야 매치로 인정한다
    const narrowed = candidates.filter((r) => legacyFileOf(r) === c.legacyFile);
    if (narrowed.length === 1) target = narrowed[0];
  }
  if (!target) {
    (candidates.length ? bucketAAmbig : bucketAMiss).push({
      match, occurrences, articleNo: c.articleNo, legacyFile: c.legacyFile,
      candidates: candidates.map((r) => ({ id: r.id, board: r.board, source_url: r.source_url })),
    });
    continue;
  }
  const href = postHrefNoLocale(target);
  if (!href) {
    bucketAMiss.push({
      match, occurrences, articleNo: c.articleNo, legacyFile: c.legacyFile,
      candidates: [{ id: target.id, board: target.board, note: '상세 라우트가 없는 게시판' }],
    });
    continue;
  }
  bucketA.push({ match, occurrences, target, href });
}

// ── C. faculty-directory.json 의 죽은 moreInfoUrl ───────────────
// 값이 문자열 한 줄이라 **행 단위 정규식 치환**으로 처리한다 — JSON 을 파싱했다가
// 다시 직렬화하면 CMS 가 저장한 원본 포매팅(키 순서·들여쓰기)이 흔들릴 수 있고,
// repo 파일 diff 도 moreInfoUrl 줄만 나와야 한다.
const MORE_INFO_RE = /("moreInfoUrl"\s*:\s*)"[^"]*me\.yonsei\.ac\.kr[^"]*"/g;
const nullifyMoreInfo = (text) => String(text).replace(MORE_INFO_RE, '$1null');
const countMoreInfo = (text) => [...String(text ?? '').matchAll(MORE_INFO_RE)].length;

const facultyRow = contentFiles.find((f) => f.path === FACULTY_PATH) ?? null;
const facultyDbCount = facultyRow ? countMoreInfo(facultyRow.body) : 0;

const facultyFileAbs = join(ROOT, FACULTY_PATH);
const facultyFileText = existsSync(facultyFileAbs) ? readFileSync(facultyFileAbs, 'utf8') : null;
const facultyFileCount = facultyFileText === null ? 0 : countMoreInfo(facultyFileText);

/** 어떤 교수들이 대상인지 — 보고용 이름 목록 */
function affectedNames(text) {
  if (!text) return [];
  try {
    return JSON.parse(text)
      .filter((x) => String(x?.moreInfoUrl ?? '').includes('me.yonsei.ac.kr'))
      .map((x) => x.name);
  } catch {
    return [];
  }
}

// content_files 의 다른 파일에 레거시 URL 이 있는지도 훑는다(보고만)
const otherContentHits = contentFiles
  .filter((f) => f.path !== FACULTY_PATH)
  .map((f) => ({ path: f.path, n: extractMatches(f.body).length }))
  .filter((x) => x.n > 0);

// ── 보고 ────────────────────────────────────────────────────────
const nOcc = (list) => list.reduce((a, x) => a + x.occurrences.length, 0);
const short = (s, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);
const whereStr = (occ) => occ.map((w) => `${w.id}/${w.col}`).join(' ');

console.log('── 스캔 ──────────────────────────────────────────────');
console.log(`  posts ${posts.length}행 · content_files ${contentFiles.length}행 검사`);
console.log(`  레거시 URL(me·devcms) 유니크 ${hits.size}개 · 발생 ${nOcc([...hits.values()].map((v) => ({ occurrences: v.where })))}곳`);
console.log(`  source_url→articleNo 역인덱스: ${byArticleNo.size}개 글`);

console.log(`\n── A. 게시물 상호 링크 — 치환 ${bucketA.length}개 / ${nOcc(bucketA)}곳 ─────`);
for (const a of bucketA) {
  const locales = [...new Set(a.occurrences.map((w) => localeOf(w.col)))].sort();
  console.log(`  ${short(a.match)}`);
  console.log(`    → ${locales.map((l) => l + a.href).join('  |  ')}   (${a.target.board} #${a.target.id})`);
  console.log(`    위치(${a.occurrences.length}): ${whereStr(a.occurrences)}`);
}
if (bucketAMiss.length) {
  console.log(`\n  ⚠ A-미매치 ${bucketAMiss.length}개 (대상 글이 DB 에 없음 — 치환 안 함):`);
  for (const a of bucketAMiss) {
    console.log(`    articleNo=${a.articleNo} (${a.legacyFile}) ${short(a.match, 90)}`);
    console.log(`      위치(${a.occurrences.length}): ${whereStr(a.occurrences)}`);
  }
}
if (bucketAAmbig.length) {
  console.log(`\n  ⚠ A-모호 ${bucketAAmbig.length}개 (articleNo 가 여러 행 — 치환 안 함):`);
  for (const a of bucketAAmbig) {
    console.log(`    articleNo=${a.articleNo} (${a.legacyFile}) 후보: ${a.candidates.map((c) => `#${c.id}/${c.board}`).join(', ')}`);
  }
}
if (bucketAList.length) {
  console.log(`\n  ℹ A-목록 링크 ${bucketAList.length}개 (articleNo 없음 — 치환 안 함, 별도 판단 필요):`);
  for (const a of bucketAList) console.log(`    ${short(a.match)}  위치: ${whereStr(a.occurrences)}`);
}

console.log(`\n── B. 깨진 상대링크 복원 — ${bucketB.length}개 / ${nOcc(bucketB)}곳 ─────`);
for (const b of bucketB) {
  console.log(`  ${short(b.match)}`);
  console.log(`    → ${short(b.newUrl)}   위치(${b.occurrences.length}): ${whereStr(b.occurrences)}`);
}

console.log('\n── C. faculty-directory.json moreInfoUrl → null ──────');
console.log(`  DB content_files(${FACULTY_PATH}): ${facultyRow ? `${facultyDbCount}건 (version ${facultyRow.version})` : '행 없음'}`);
console.log(`  repo 파일 ${FACULTY_PATH}: ${facultyFileText === null ? '파일 없음' : `${facultyFileCount}건`}`);
{
  const names = affectedNames(facultyRow ? facultyRow.body : facultyFileText);
  if (names.length) console.log(`  대상: ${names.join(', ')}`);
}
if (otherContentHits.length) {
  console.log('  ℹ 다른 content_files 에도 레거시 URL:');
  for (const c of otherContentHits) console.log(`    ${c.path} (${c.n})`);
}

console.log(`\n── 미분류 — ${bucketUnknown.length}개 / ${nOcc(bucketUnknown)}곳 (손대지 않음) ─────`);
for (const u of bucketUnknown) {
  console.log(`  ${short(u.match)}`);
  console.log(`    사유: ${u.why}   위치(${u.occurrences.length}): ${whereStr(u.occurrences)}`);
}

if (!APPLY) {
  console.log('\n  ※ 드라이런 — 아무것도 쓰지 않았습니다. 적용은 --apply.');
  process.exit(0);
}

// ── 치환 계획 ───────────────────────────────────────────────────
// 컬럼마다 로케일이 다르므로(A) 치환표는 "컬럼별"로 만든다.
// B 는 로케일과 무관하므로 두 표에 같은 값이 들어간다.
function replacementsFor(col) {
  const map = new Map(); // matchStr → 새 문자열
  for (const a of bucketA) map.set(a.match, `${localeOf(col)}${a.href}`);
  for (const b of bucketB) map.set(b.match, b.newUrl);
  return map;
}

// 긴 매치부터 치환해야 짧은 매치가 긴 매치의 앞부분을 갉아먹지 않는다.
function rewrite(text, map) {
  let out = String(text);
  let changed = false;
  for (const m of [...map.keys()].sort((x, y) => y.length - x.length)) {
    if (!out.includes(m)) continue;
    out = out.split(m).join(map.get(m));
    changed = true;
  }
  return changed ? out : null;
}

const postPatches = [];
for (const p of posts) {
  const patch = {};
  let hit = false;
  for (const col of POST_COLS) {
    if (!p[col]) continue;
    const nv = rewrite(p[col], replacementsFor(col));
    if (nv !== null) { patch[col] = nv; hit = true; }
  }
  if (hit) postPatches.push({ id: p.id, patch });
}

// ── 스냅숏 (롤백용 — 커밋 금지, 로컬 보관) ─────────────────────
const changedIds = new Set(postPatches.map((x) => x.id));
const snapPath = join(ROOT, 'tools', `legacy-links-snapshot-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(snapPath, JSON.stringify({
  createdAt: new Date().toISOString(),
  script: 'rewrite-legacy-links.mjs',
  posts: posts.filter((p) => changedIds.has(p.id)),
  contentFiles: facultyRow ? [facultyRow] : [],
  facultyRepoFile: facultyFileText === null ? null : { path: FACULTY_PATH, body: facultyFileText },
}, null, 1), 'utf8');
console.log(`\n스냅숏 저장: ${snapPath} (posts ${postPatches.length}행)`);

// ── DB 치환 ─────────────────────────────────────────────────────
const failures = [];
let postOk = 0;
for (const { id, patch } of postPatches) {
  const { error } = await sb.from('posts').update(patch).eq('id', id);
  if (error) { failures.push(`posts#${id}: ${error.message}`); continue; }
  postOk += 1;
}

// C-1. content_files — CMS 저장(/api/admin/content PUT)과 같은 의미론:
//      읽은 version 이 그대로일 때만 갱신하고 version 을 +1 한다(낙관적 동시성).
let facultyDbOk = false;
if (facultyRow && facultyDbCount > 0) {
  const nextBody = nullifyMoreInfo(facultyRow.body);
  JSON.parse(nextBody); // 깨진 JSON 을 넣으면 사이트가 조용히 옛 스냅샷으로 폴백한다
  const { data, error } = await sb.from('content_files')
    .update({ body: nextBody, version: Number(facultyRow.version) + 1 })
    .eq('path', FACULTY_PATH)
    .eq('version', facultyRow.version)
    .select('version');
  if (error) failures.push(`content_files(${FACULTY_PATH}): ${error.message}`);
  else if (!data || data.length === 0) failures.push(`content_files(${FACULTY_PATH}): 버전 충돌(409) — 다시 실행하세요`);
  else facultyDbOk = true;
}

// C-2. repo 파일 — 행 단위 치환이라 diff 는 moreInfoUrl 줄만 나온다.
let facultyFileOk = false;
if (facultyFileText !== null && facultyFileCount > 0) {
  const nextText = nullifyMoreInfo(facultyFileText);
  JSON.parse(nextText);
  writeFileSync(facultyFileAbs, nextText, 'utf8');
  facultyFileOk = true;
}

// ── 재스캔 검증 ────────────────────────────────────────────────
const postsAfter = await fetchAll('posts', ['id', ...POST_COLS].join(','));
const cfAfter = await fetchAll('content_files', 'path,body,version', 'path');
let remain = 0;
for (const p of postsAfter) for (const col of POST_COLS) remain += extractMatches(p[col]).length;
const facultyAfter = cfAfter.find((f) => f.path === FACULTY_PATH);

console.log('\n── 적용 완료 ─────────────────────────────────────────');
console.log(`  posts 치환: ${postOk}/${postPatches.length}행 (A ${nOcc(bucketA)}곳 + B ${nOcc(bucketB)}곳)`);
console.log(`  content_files ${FACULTY_PATH}: ${facultyDbOk ? `갱신 (version ${facultyRow.version} → ${Number(facultyRow.version) + 1})` : '변경 없음'}`);
console.log(`  repo 파일 ${FACULTY_PATH}: ${facultyFileOk ? '갱신' : '변경 없음'}`);
console.log(`  재스캔 잔여 레거시 URL: posts ${remain}곳 (미분류 ${nOcc(bucketUnknown)} + 목록 ${nOcc(bucketAList)} + 미매치 ${nOcc(bucketAMiss)} + 모호 ${nOcc(bucketAAmbig)} 와 대조)`);
console.log(`  잔여 moreInfoUrl: DB ${countMoreInfo(facultyAfter?.body)}건 · repo ${countMoreInfo(existsSync(facultyFileAbs) ? readFileSync(facultyFileAbs, 'utf8') : '')}건`);
if (failures.length) {
  console.log('\n  실패:');
  for (const f of failures) console.log(`   ${f}`);
}
console.log("\n  ※ 사이트 반영은 ISR 만료(최대 10분) 또는 revalidateTag('posts'|'content') 로.");
console.log('  ※ repo 파일 변경분은 별도로 커밋해야 한다(스냅숏 tools/*.json 은 커밋 금지).');
