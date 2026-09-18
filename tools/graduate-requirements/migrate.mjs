// 대학원 졸업요건 — 마크다운 한 덩이 → STEP 레코드 배열 이관 (2026-09).
//
//   content/pages/graduate-requirements.md  →  content/graduate-requirements.json
//
// 구조는 원래부터 STEP 9개였는데 원본이 마크다운이라 CMS 가 통째로밖에 못 고쳤다.
// '####' 헤딩·리드 단락 규칙을 **레코드 필드**로 승격시켜, 다음 단계의 전용 편집
// 화면이 STEP 하나씩 고칠 수 있게 한다. 본문(body)은 이 시점에 HTML 로 굳는다
// (게시물 bodyFormat:'html' 과 같은 규약 — 편집기가 마크다운을 다시 만들지 않는다).
//
// 사용법:
//   node tools/graduate-requirements/migrate.mjs            # 생성(멱등, 검증 통과시에만 쓴다)
//   node tools/graduate-requirements/migrate.mjs --verify    # 쓰지 않고 기존 JSON 만 대조
//
// 검증은 **옛 렌더 경로와의 1:1 대조**다. 아래 parseStepsLegacy 는 전환 직전
// src/components/GraduateRequirementSteps.tsx 의 parseSteps 를 글자 그대로 옮긴
// 사본이고, 스크립트는 JSON 왕복(직렬화→파싱)까지 거친 레코드가 그 산출과 완전히
// 같을 때만 파일을 쓴다. 하나라도 어긋나면 아무것도 쓰지 않고 비영점으로 끝낸다.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const SRC = path.join(ROOT, 'content/pages/graduate-requirements.md');
const OUT = path.join(ROOT, 'content/graduate-requirements.json');

// Prose·GraduateRequirementSteps 와 동일 설정 — 이 값이 다르면 표·줄바꿈이 달라진다
const marked = new Marked({ gfm: true, breaks: false });

// ── 옛 경로 사본(수정 금지) ────────────────────────────────────────────
/** 전환 직전 GraduateRequirementSteps.parseSteps 의 축자 사본. 검증의 기준선이므로
 *  "고쳐서 통과시키는" 대상이 아니다 — 여기 손대면 대조 자체가 무의미해진다. */
function parseStepsLegacy(md) {
  const lines = md.split(/\r?\n/);
  const cuts = [];
  lines.forEach((l, i) => {
    const m = l.match(/^####\s+(.+)$/);
    if (m) cuts.push({ i, text: m[1].trim() });
  });

  return cuts.map((c, k) => {
    const end = k + 1 < cuts.length ? cuts[k + 1].i : lines.length;
    const body = lines.slice(c.i + 1, end);

    let lead = null;
    let s = 0;
    while (s < body.length && body[s].trim() === '') s++;
    if (s < body.length && !/^[-|>#*]/.test(body[s].trim())) {
      const leadLines = [];
      let e = s;
      while (e < body.length && body[e].trim() !== '' && !/^[-|>#*]/.test(body[e].trim())) {
        leadLines.push(body[e].trim());
        e++;
      }
      lead = leadLines.join(' ');
      body.splice(0, e);
    }

    return {
      id: `grad-step-${k + 1}`,
      num: String(k + 1).padStart(2, '0'),
      title: c.text,
      lead,
      html: marked.parse(body.join('\n').trim()),
    };
  });
}

// ── 레코드 만들기 ──────────────────────────────────────────────────────
/** STEP 레코드 배열. lead 없는 STEP 은 **빈 문자열**로 통일한다 — 폼·렌더 양쪽이
 *  falsy 한 번만 보면 되도록(null 과 키 누락이 섞이면 편집기에서 갈린다). */
function toRecords(steps) {
  return steps.map((s) => ({ title: s.title, lead: s.lead ?? '', body: s.html }));
}

// ── 대조 ───────────────────────────────────────────────────────────────
/** 레코드 배열이 옛 산출과 완전히 같은지. 어긋난 자리를 전부 모아 돌려준다. */
function diffAgainstLegacy(records, legacy) {
  const problems = [];
  if (records.length !== legacy.length) {
    problems.push(`STEP 개수 불일치: JSON ${records.length} vs 마크다운 ${legacy.length}`);
  }
  const n = Math.max(records.length, legacy.length);
  for (let i = 0; i < n; i += 1) {
    const r = records[i];
    const l = legacy[i];
    const at = `STEP ${String(i + 1).padStart(2, '0')}`;
    if (!r || !l) {
      problems.push(`${at}: 한쪽에만 있다 (JSON ${r ? '있음' : '없음'} / 마크다운 ${l ? '있음' : '없음'})`);
      continue;
    }
    if (r.title !== l.title) problems.push(`${at} title 불일치\n  JSON: ${r.title}\n  기준: ${l.title}`);
    if (r.lead !== (l.lead ?? '')) problems.push(`${at} lead 불일치\n  JSON: ${r.lead}\n  기준: ${l.lead ?? ''}`);
    if (r.body !== l.html) problems.push(`${at} body 불일치 (길이 ${r.body.length} vs ${l.html.length})`);
  }
  return problems;
}

/** 한 줄 요약 — 제목·리드 유무·본문 길이 */
function summarize(records) {
  return records
    .map((r, i) => {
      const num = String(i + 1).padStart(2, '0');
      const lead = r.lead ? `리드 ${r.lead.length}자` : '리드 없음';
      return `  STEP ${num} · ${r.title} — ${lead} · body ${r.body.length}자`;
    })
    .join('\n');
}

// ── 실행 ───────────────────────────────────────────────────────────────
const verifyOnly = process.argv.includes('--verify');

const md = await readFile(SRC, 'utf8');
const legacy = parseStepsLegacy(md);
if (legacy.length === 0) {
  console.error(`✗ ${path.relative(ROOT, SRC)} 에서 '####' STEP 을 하나도 찾지 못했다.`);
  process.exit(1);
}

// 검증 대상은 "파일에 들어갈 그 문자열" 이어야 한다 — JSON 왕복까지 거친 값을 본다
const json = `${JSON.stringify(toRecords(legacy), null, 2)}\n`;
const records = verifyOnly ? JSON.parse(await readFile(OUT, 'utf8')) : JSON.parse(json);

const problems = diffAgainstLegacy(records, legacy);
if (problems.length > 0) {
  console.error(`✗ ${records.length}개 중 ${problems.length}건 불일치 — 파일을 쓰지 않는다.\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`${records.length}/${legacy.length} 일치 (title · lead · body 전부)`);
console.log(summarize(records));

if (verifyOnly) {
  console.log(`\n(--verify: ${path.relative(ROOT, OUT)} 을 마크다운 원본과 대조만 했다)`);
} else {
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, json, 'utf8');
  console.log(`\n→ ${path.relative(ROOT, OUT)} (${json.length}자)`);
}
