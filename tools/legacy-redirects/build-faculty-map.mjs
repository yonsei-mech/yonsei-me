// 구 교수 상세 URL(userId) → 새 교수 상세 slug 매핑 생성기 — 도메인 컷오버 준비물.
//
//   node tools/legacy-redirects/build-faculty-map.mjs
//
// 산출물: src/lib/legacy-faculty.gen.json (커밋 대상)
//   { "<디코딩한 userId>": "<교수 이름 = 파일명 = slug>" }
//
// 왜 정적 파일인가: 구 교수진 목록이 링크하던
// `/faculty/name_search.do?mode=view&userId=…` 를 리졸버(src/app/faculty/name_search.do/route.ts)가
// 한 홉 308 로 넘기려면 userId → 이름이 필요한데, 그 출처인
// content/faculty-profiles/*.json 은 합계 3.3MB 다(학술활동 전문 포함). 라우트가
// 그걸 import 하면 리다이렉트 하나에 수 MB 를 번들에 지고 들어가므로, 필요한
// 두 필드만 추려 수 KB 짜리 스냅숏으로 굳힌다. 교수 집합은 크롤 산출물이라
// 프로필이 바뀔 때 이 생성기를 다시 돌리면 된다.
//
// 데이터 소스는 하나다 — 각 프로필의 `sourceUrl`:
//   https://me.yonsei.ac.kr/faculty/name_search.do?mode=view&userId=<base64, URL 인코딩>&sosokcd=…
// 쿼리 중 의미 있는 것은 userId 뿐이고(mode·sosokcd 는 무시), 키는 **URL 디코딩한**
// 원본 base64 다(`H6IAceQ75BsxdEuXLJXMoA==`). 라우트가 searchParams 로 읽으면 이미
// 디코딩된 값이 오므로 그대로 조회된다.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'content', 'faculty-profiles');

// sourceUrl 에서 userId 를 뽑아 디코딩한다. 쿼리 값이 인코딩돼 있으므로(`%3D%3D`)
// 정규식으로 자른 뒤 decodeURIComponent 를 건다 — URL 파서를 쓰면 상대경로·빈
// 문자열 sourceUrl 에서 던진다.
function userIdOf(sourceUrl) {
  const raw = String(sourceUrl ?? '').match(/[?&]userId=([^&]*)/)?.[1];
  if (!raw) return null;
  try {
    const id = decodeURIComponent(raw);
    return id.length > 0 ? id : null;
  } catch {
    return null; // 깨진 퍼센트 인코딩 — 매핑하지 않는다(지어내지 않는다)
  }
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

const map = {}; // userId → 이름
const missing = []; // sourceUrl 에 userId 가 없는 파일
const dupes = []; // 같은 userId 를 쓰는 파일 둘 이상

for (const file of files) {
  const name = file.slice(0, -'.json'.length);
  const profile = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  const id = userIdOf(profile.sourceUrl);
  if (!id) {
    missing.push(name);
    continue;
  }
  if (map[id]) dupes.push({ id, kept: map[id], also: name });
  map[id] = name;
}

// 키 정렬 저장 — 프로필이 늘어도 diff 가 그 줄만 움직인다.
const sorted = {};
for (const id of Object.keys(map).sort()) sorted[id] = map[id];

const OUT = join(ROOT, 'src', 'lib', 'legacy-faculty.gen.json');
writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`);

console.log('── legacy-faculty 매핑 생성 ────────────────');
console.log(`  프로필 ${files.length}개 → 매핑 ${Object.keys(sorted).length}건`);
if (missing.length) console.log(`  ⚠️ sourceUrl 에 userId 없음 ${missing.length}건: ${missing.join(', ')}`);
for (const d of dupes) console.log(`  ⚠️ userId 중복 ${d.id}: ${d.kept} 를 ${d.also} 가 덮어씀`);
const kb = (JSON.stringify(sorted).length / 1024).toFixed(1);
console.log(`  → ${OUT} (${kb}KB)`);
