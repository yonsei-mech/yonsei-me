// BK21 참여교수 플래그 DB 반영 — Supabase `content_files` 의
// `content/faculty-directory.json` 행에 `bk21: true` 를 심는다.
//
// 왜 필요한가
//   프로덕션은 콘텐츠의 **원본이 DB**다(Phase 3). 저장소의 content/*.json 은 빌드 시점
//   폴백 스냅샷이라, repo 만 고치고 배포해도 CMS 로 편집된 DB 본이 그대로 나가 참여교수
//   명단이 비어 보인다. 그래서 같은 변경을 DB 행에도 한 번 넣어 준다(1회성).
//
// 실행
//   node tools/bk21/flag-faculty.mjs            # 드라이런 — 바뀔 항목·미매칭만 출력
//   node tools/bk21/flag-faculty.mjs --apply    # 실제 반영 (version + 1)
//
// 설계 메모
//  - **더하기만 한다.** 명단에 없는데 이미 bk21 이 켜진 교수는 건드리지 않고 보고만
//    한다 — CMS 에서 사람이 켠 값을 스크립트가 조용히 끄면 안 된다.
//  - 키 순서는 repo 의 content/faculty-directory.json 과 같게 맞춘다(moreInfoUrl 앞).
//    CMS(resources.ts 의 FACULTY_BASE_FIELDS)가 쓰는 순서와 같아야 다음 저장 때
//    파일 전체가 뒤집히는 diff 가 나지 않는다.
//  - 직렬화는 2칸 들여쓰기 + 끝 개행(저장소·CMS 와 동일).
//  - ⚠️ 이 스크립트는 앱을 거치지 않아 `revalidateTag('content')` 를 못 쏜다.
//    --apply 뒤에는 호스트마다 POST /api/revalidate {"tags":["content"]} 를 한 번씩
//    불러야 사이트에 즉시 반영된다(안 부르면 최대 24시간 — 캐시 수명).
//    명령은 --apply 성공 후 화면에 그대로 출력된다.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// ── .env.local 로더 (scripts/mirror-legacy-assets.mjs 와 동일) ──
{
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of ['.env.local', join(here, '..', '..', '.env.local')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
    break;
  }
}

const PATH = 'content/faculty-directory.json';

/** BK21 FOUR 교육연구단 참여교수 29명 (구 사이트 /me/bk21/people.do 명단) */
const ROSTER = [
  '강건욱', '강신일', '김대은', '김석', '김영주', '김용준', '김우철', '김원정',
  '김종백', '김해진', '류원형', '민경민', '민병권', '박노철', '송순호', '신동준',
  '유정훈', '윤준영', '이남규', '이종수', '이준상', '이창훈', '이형석', '장용훈',
  '정효일', '주철민', '최종은', '현재상', '홍종섭',
];

const apply = process.argv.includes('--apply');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다 (.env.local).');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// ── 현재 행 읽기 ──
const { data, error } = await sb
  .from('content_files')
  .select('path, body, version')
  .eq('path', PATH)
  .maybeSingle();
if (error) {
  console.error(`content_files 조회 실패: ${error.message}`);
  process.exit(1);
}
if (!data) {
  console.error(`${PATH} 행이 DB 에 없습니다 — 먼저 scripts/migrate-content.mjs 로 시딩하세요.`);
  process.exit(1);
}

let list;
try {
  list = JSON.parse(data.body);
} catch (e) {
  console.error(`${PATH} JSON 파싱 실패: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(list)) {
  console.error(`${PATH} 최상위가 배열이 아닙니다 — 손대지 않고 중단합니다.`);
  process.exit(1);
}

// ── 계산 ──
const want = new Set(ROSTER);
const byName = new Map(list.map((r) => [r.name, r]));
const missing = ROSTER.filter((n) => !byName.has(n));
const willSet = ROSTER.filter((n) => byName.has(n) && byName.get(n).bk21 !== true);
const already = ROSTER.filter((n) => byName.get(n)?.bk21 === true);
// 명단 밖인데 켜져 있는 교수 — 끄지 않고 보고만 한다(사람이 CMS 에서 켠 값일 수 있다)
const extra = list.filter((r) => r.bk21 === true && !want.has(r.name)).map((r) => r.name);

/** bk21 키를 moreInfoUrl 앞에 끼워 넣는다(저장소 파일·CMS 직렬화와 같은 순서) */
function withBk21(record) {
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === 'moreInfoUrl' && !('bk21' in out)) out.bk21 = true;
    out[k] = v;
  }
  if (!('bk21' in out)) out.bk21 = true;
  return out;
}

const next = list.map((r) => (want.has(r.name) && r.bk21 !== true ? withBk21(r) : r));
const body = `${JSON.stringify(next, null, 2)}\n`;

console.log(`${PATH} · DB version ${data.version} · 레코드 ${list.length}개`);
console.log(`  새로 켤 교수 ${willSet.length}명: ${willSet.join(' ') || '(없음)'}`);
console.log(`  이미 켜져 있음 ${already.length}명`);
if (extra.length) console.log(`  ⚠ 명단 밖인데 켜져 있음(건드리지 않음): ${extra.join(' ')}`);
if (missing.length) console.log(`  ⚠ DB 에서 못 찾은 이름: ${missing.join(' ')}`);

if (!apply) {
  console.log('\n드라이런입니다 — 아무것도 쓰지 않았습니다. 반영하려면 --apply 를 붙이세요.');
  process.exit(0);
}
if (willSet.length === 0) {
  console.log('\n바꿀 것이 없습니다 — 쓰기를 생략합니다.');
  process.exit(0);
}

// ── 반영 ──
const { error: upErr } = await sb
  .from('content_files')
  .update({ body, version: data.version + 1 })
  .eq('path', PATH)
  .eq('version', data.version); // 낙관적 잠금 — 그사이 CMS 저장이 있었으면 0행이 갱신된다
if (upErr) {
  console.error(`업데이트 실패: ${upErr.message}`);
  process.exit(1);
}

// 갱신 결과 확인 (version 이 올라갔는지 — 동시 저장 충돌 감지)
const { data: after } = await sb
  .from('content_files')
  .select('version')
  .eq('path', PATH)
  .maybeSingle();
if (after?.version !== data.version + 1) {
  console.error(
    `⚠ version 이 ${data.version + 1} 이 아닙니다(현재 ${after?.version}) — 그사이 CMS 저장이 있었을 수 있습니다. 다시 실행해 확인하세요.`,
  );
  process.exit(1);
}

console.log(`\n✓ 반영 완료 — version ${data.version} → ${after.version}, ${willSet.length}명 설정`);
console.log('  캐시 무효화를 호스트마다 한 번씩 부르세요(안 부르면 최대 24시간 지연):');
console.log(
  "    curl -X POST -H \"x-revalidate-secret: $REVALIDATE_SECRET\" -H 'content-type: application/json' -d '{\"tags\":[\"content\"]}' https://<호스트>/api/revalidate",
);
