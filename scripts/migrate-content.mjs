// 콘텐츠 파일(JSON·마크다운) → Supabase content_files 이전 스크립트 (백엔드 전환 Stage A).
//
// 실행:
//   node scripts/migrate-content.mjs                    # 적재 — 단 DB 와 다른 파일은 건너뛴다
//   node scripts/migrate-content.mjs --force            # DB 와 달라도 소스로 덮어쓴다
//   node scripts/migrate-content.mjs --verify           # 쓰기 없이 DB↔git 바이트 비교만
//   node scripts/migrate-content.mjs --source=worktree  # 로컬 작업 트리 파일을 소스로
//   node scripts/migrate-content.mjs --enrich-photos    # 교수 사진 경로 채워서 적재
//
// ⚠️ 기본 소스는 `git show origin/main:<path>` 다. 로컬 작업 트리에는 다른 세션의
// 커밋 금지 WIP(content/labs-directory.json, content/board.json 등)가 상시 섞여 있어
// 그대로 적재하면 배포된 사이트에 없는 내용이 DB 에 들어간다. --source=worktree 는
// 그 사실을 아는 사람이 명시적으로 켤 때만 쓴다.
//
// ⚠️ 덮어쓰기 가드 — 이 스크립트는 초기 시딩용이지만 실수로 재실행되기 쉽다. 이제 CMS 가
// DB 를 직접 편집하므로, 기존 행의 body 가 소스와 다르면 "DB 쪽이 더 최신(CMS 편집분)"일
// 가능성이 있다. 그래서 기본 동작은 **다르면 건너뛰기**이고, 덮어쓰려면 --force 가 필요하다.
// 차이의 실물이 궁금하면 `node scripts/export-content.mjs`(드라이런)로 확인한다.
//
// 적재 규칙: 행이 없으면 insert(v1). 있고 내용이 같으면 아무것도 하지 않는다(불필요한
// version 증가 금지). 있고 내용이 다르면 건너뛰거나(기본) --force 시 update + version+1
// (supabase upsert 로는 version+1 같은 산술을 표현할 수 없어 존재 확인 후 분기).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

// ── .env.local 로더 (dotenv 없이 최소 구현 — check-backend.mjs 와 동일) ──
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── 관리 대상 목록 ──
// src/lib/admin/managed-content.ts 가 단일 소스 — 변경 시 함께 갱신.
// (노드 스크립트라 TS 모듈을 직접 import 할 수 없어 여기 중복 선언한다.)
const MANAGED_JSON = [
  'content/history.json',
  'content/faculty-directory.json',
  'content/staff.json',
  'content/hero-slides.json',
  'content/courses-undergraduate.json',
  'content/course-descriptions.json',
  // ⚠️ 교과목 체계도(관계·슬롯). 사이트는 행이 없으면 빌드 스냅샷으로 폴백하지만
  //    CMS 편집 화면은 GET 404 를 그대로 오류로 띄운다 — 배포 전 반드시 시딩할 것.
  'content/course-flow.json',
  'content/courses-graduate.json',
  'content/clubs.json',
  'content/labs-directory.json',
  'content/lab-summaries.json',
  // ⚠️ 교수 AI 연구요약. 공유 record 파일이라 DB 행이 없으면 CMS 가 빈 객체에서
  //    시작해, 교수 한 명을 저장하는 순간 나머지 30명 문안이 사라진 파일이 올라간다
  //    (프로덕션 GET 은 행이 없으면 404 — git 폴백이 없다). 배포 전 반드시 시딩할 것.
  'content/faculty-summaries.json',
  // 장학금 — 2026-08 md(content/pages/undergraduate-scholarship.md)에서 구조화 전환.
  // 구 md 의 DB 행은 남아 있지만 allowlist 에서 빠져 더는 읽히지도 쓰이지도 않는다.
  'content/scholarships.json',
  // 대학원 졸업요건 STEP — 2026-09 md(content/pages/graduate-requirements.md)에서 구조화
  // 전환. 사이트는 행이 없으면 빌드 스냅샷으로 폴백하지만 CMS 편집 화면은 GET 404 를
  // 오류로 띄운다(체계도와 같은 사정) — 배포 전 반드시 시딩할 것.
  'content/graduate-requirements.json',
  // 팝업 공지 — 행이 없어도 CMS 가 빈 목록에서 시작한다(resources 의 emptyIfMissing).
  'content/popups.json',
  // BK21 FOUR 참여인력 표 2종 — 2026-09 섹션 신설. 사이트는 행이 없으면 빌드 스냅샷으로
  // 폴백하지만 CMS 편집 화면은 GET 404 를 오류로 띄운다 — 배포 전 시딩할 것.
  'content/bk21-early-career.json',
  'content/bk21-students.json',
  // BK21 FOUR › 사업계획서·보고서는 콘텐츠 파일이 아니라 게시판(posts)이다 — 여기 없다.
];
// 고정 경로 마크다운(동아리 본문처럼 slug 에서 파생되지 않는 것).
// managed-content.ts 의 MANAGED_MARKDOWN_PAGES 와 같은 목록 — 함께 갱신한다.
// ⚠️ 구 경로 content/pages/graduate-bk21.md 의 DB 행은 남아 있지만 allowlist 에서
//    빠져 더는 읽히지도 쓰이지도 않는다(구 장학금 md 와 같은 사정).
const MANAGED_MD = ['content/pages/bk21-vision.md'];
const CLUBS_JSON = 'content/clubs.json';
const FACULTY_JSON = 'content/faculty-directory.json';

// ── 플래그 ──
const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify');
const enrichPhotos = args.includes('--enrich-photos');
const force = args.includes('--force');
const sourceArg = args.find((a) => a.startsWith('--source='))?.slice('--source='.length) ?? 'origin';
if (sourceArg !== 'origin' && sourceArg !== 'worktree') {
  console.error(`알 수 없는 --source 값: ${sourceArg} (origin | worktree)`);
  process.exit(1);
}
const fromWorktree = sourceArg === 'worktree';

// ── 소스 읽기 ──
/** origin/main 의 파일 원문(바이트 보존). 없는 파일이면 null */
function readFromGit(path) {
  const r = spawnSync('git', ['show', `origin/main:${path}`], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return null;
  return r.stdout.toString('utf8');
}

function readSource(path) {
  if (fromWorktree) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }
  return readFromGit(path);
}

// ── 교수 사진 보강 (--enrich-photos) ──
// photo 가 비어 있는 레코드에 public/img/faculty/<이름>.<ext> 실존 파일을 찾아 채운다.
// 사이트는 지금도 이름 매칭으로 같은 결과를 만들지만(lib/faculty.ts 의 photoMap),
// DB 소스로 넘어가면 public/ 을 읽지 못하는 환경도 있어 값 자체를 심어 둘 수 있게 한다.
function enrichFacultyPhotos(text) {
  const records = JSON.parse(text);
  let files = [];
  try {
    files = readdirSync(join('public', 'img', 'faculty'));
  } catch {
    console.warn('  ⚠ public/img/faculty 를 읽을 수 없어 사진 보강을 건너뜁니다.');
    return { text, filled: 0 };
  }
  const byName = new Map();
  for (const f of files) {
    const dot = f.lastIndexOf('.');
    if (dot <= 0) continue;
    byName.set(f.slice(0, dot), `/img/faculty/${f}`);
  }
  let filled = 0;
  for (const r of records) {
    const has = typeof r.photo === 'string' && r.photo.trim() !== '';
    if (has) continue;
    const found = byName.get(r.name);
    if (!found) continue;
    r.photo = found;
    filled += 1;
  }
  // 2칸 들여쓰기 + 끝 개행 — 저장소의 다른 content/*.json 과 같은 직렬화 형식
  return { text: `${JSON.stringify(records, null, 2)}\n`, filled };
}

// ── 교수 학술활동 프로필 (content/faculty-profiles/<한글이름>.json — 교수마다 한 파일) ──
// 파일 집합이 교수 명단을 따라 변하므로 club-*.md 처럼 소스에서 동적으로 나열한다.
// (managed-content.ts 의 isFacultyProfilePath 정규식과 같은 대상 — 변경 시 함께 갱신.)
function listFacultyProfiles() {
  if (fromWorktree) {
    try {
      return readdirSync(join('content', 'faculty-profiles'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => `content/faculty-profiles/${f}`);
    } catch {
      return [];
    }
  }
  // core.quotepath=false — 한글 파일명이 8진수 이스케이프("\354…")로 나오지 않게
  const r = spawnSync(
    'git',
    ['-c', 'core.quotepath=false', 'ls-tree', '--name-only', 'origin/main', 'content/faculty-profiles/'],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).filter((p) => p.endsWith('.json'));
}

// ── 대상 경로 확정 (club-*.md 는 clubs.json 의 slug 에서 동적 생성) ──
const clubsText = readSource(CLUBS_JSON);
if (clubsText === null) {
  console.error(`${CLUBS_JSON} 를 읽을 수 없습니다 (source=${sourceArg}).`);
  process.exit(1);
}
const clubSlugs = JSON.parse(clubsText).map((c) => c.slug);
const facultyProfiles = listFacultyProfiles();
if (facultyProfiles.length === 0) {
  console.warn('  ⚠ content/faculty-profiles 대상이 0개입니다 — 소스에 파일이 없거나 나열 실패.');
}
const targets = [
  ...MANAGED_JSON,
  ...MANAGED_MD,
  ...clubSlugs.map((s) => `content/pages/club-${s}.md`),
  ...facultyProfiles,
];

console.log(`소스: ${fromWorktree ? '로컬 작업 트리' : 'origin/main'} · 대상 ${targets.length}개 파일`);
if (enrichPhotos) console.log(`사진 보강: ${FACULTY_JSON} 의 빈 photo 를 파일명 매칭으로 채웁니다.`);

// ── 원문 수집 ──
const bodies = new Map();
const missing = [];
let enrichedFilled = 0;
for (const path of targets) {
  let text = readSource(path);
  if (text === null) {
    missing.push(path);
    continue;
  }
  if (enrichPhotos && path === FACULTY_JSON) {
    const out = enrichFacultyPhotos(text);
    text = out.text;
    enrichedFilled = out.filled;
  }
  bodies.set(path, text);
}
for (const p of missing) console.warn(`  ⚠ 없음(건너뜀): ${p}`);

// ── --verify: 쓰기 없이 DB↔소스 바이트 비교 ──
if (verifyOnly) {
  const { data, error } = await sb.from('content_files').select('path, body, version');
  if (error) { console.error('content_files 조회 실패:', error.message); process.exit(1); }
  const rows = new Map((data ?? []).map((r) => [r.path, r]));
  let same = 0, diff = 0, absent = 0;
  for (const [path, text] of bodies) {
    const row = rows.get(path);
    if (!row) {
      console.log(`  · DB 없음   ${path}`);
      absent += 1;
      continue;
    }
    if (row.body === text) {
      console.log(`  ✓ 일치     ${path} (v${row.version})`);
      same += 1;
    } else {
      const note =
        enrichPhotos && path === FACULTY_JSON
          ? ' — 사진 보강(--enrich-photos)으로 원문과 달라진 것이 정상입니다'
          : '';
      console.log(
        `  ✗ 불일치   ${path} (v${row.version}, DB ${row.body.length}자 / 소스 ${text.length}자)${note}`,
      );
      diff += 1;
    }
  }
  const extra = [...rows.keys()].filter((p) => !bodies.has(p));
  for (const p of extra) console.log(`  ? DB 에만  ${p}`);
  console.log(`\n검증: 일치 ${same} · 불일치 ${diff} · DB 없음 ${absent} · DB 에만 ${extra.length}`);
  process.exit(diff > 0 || absent > 0 ? 1 : 0);
}

// ── 적재 (존재 확인 후 update/insert 분기 — version 산술 + 덮어쓰기 가드 때문) ──
const { data: existingRows, error: readErr } = await sb.from('content_files').select('path, body, version');
if (readErr) { console.error('content_files 조회 실패:', readErr.message); process.exit(1); }
const existing = new Map((existingRows ?? []).map((r) => [r.path, r]));

if (force) console.log('⚠ --force: DB 내용이 소스와 달라도 덮어씁니다(CMS 편집분이 있으면 소실됩니다).');

let inserted = 0, updated = 0, unchanged = 0, skippedDiff = 0;
for (const [path, body] of bodies) {
  const prev = existing.get(path);
  if (prev === undefined) {
    const { error } = await sb.from('content_files').insert({ path, body });
    if (error) { console.error(`insert 실패: ${path} —`, error.message); process.exit(1); }
    console.log(`  + 신규     ${path} (${body.length}자, v1)`);
    inserted += 1;
    continue;
  }
  if (prev.body === body) {
    // 내용이 같으면 아무것도 하지 않는다 — 의미 없는 version 증가를 만들지 않기 위해
    console.log(`  = 동일     ${path} (v${prev.version}, 변경 없음)`);
    unchanged += 1;
    continue;
  }
  if (!force) {
    console.log(
      `  · 건너뜀   ${path} (v${prev.version}, DB ${prev.body.length}자 / 소스 ${body.length}자)` +
        ' — DB 쪽이 더 최신일 수 있습니다(CMS 편집분). 덮어쓰려면 --force',
    );
    skippedDiff += 1;
    continue;
  }
  const { error } = await sb
    .from('content_files')
    .update({ body, version: prev.version + 1 })
    .eq('path', path);
  if (error) { console.error(`update 실패: ${path} —`, error.message); process.exit(1); }
  console.log(`  ↑ 갱신     ${path} (${body.length}자, v${prev.version} → v${prev.version + 1})`);
  updated += 1;
}

console.log(
  `\n완료: 신규 ${inserted} · 갱신 ${updated} · 변경 없음 ${unchanged}` +
    ` · 건너뜀(DB가 다름) ${skippedDiff} · 없음(소스) ${missing.length}`,
);
if (skippedDiff > 0) {
  console.log('차이를 보려면 `node scripts/export-content.mjs`(드라이런)로 확인하세요.');
}
if (enrichPhotos) console.log(`사진 보강: ${enrichedFilled}개 레코드의 photo 를 채웠습니다.`);
