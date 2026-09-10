#!/usr/bin/env node
/**
 * `npm run check:i18n` — NextIntlClientProvider 에 넘기는 네임스페이스 화이트리스트가
 * 실제 `useTranslations(...)` 호출을 전부 덮는지 검사한다.
 *
 * 배경: layout 이 messages 전량이 아니라 CLIENT_MESSAGE_NAMESPACES 만 provider 로 넘긴다
 * (src/lib/i18n-client-namespaces.ts). 목록에 없는 네임스페이스를 클라이언트에서 부르면
 * 예외가 아니라 **화면에 키 경로가 그대로 찍힌다**("nav.skipToContent"). 조용히 망가지는
 * 종류의 사고라 CI 성격의 검사로 막는다.
 *
 * 검사 내용
 *  1) src/** 의 모든 `useTranslations('X')` 의 최상위 키가 화이트리스트에 있는가
 *  2) 화이트리스트의 모든 키가 messages/*.json 에 실제로 있는가(오타 방지)
 *  3) 정적으로 판별 불가능한 호출(변수·템플릿 리터럴·인자 없음)이 없는가
 * 하나라도 걸리면 exit 1.
 *
 * 서버 전용(`getTranslations`)은 provider 와 무관하지만 굳이 구분하지 않는다 —
 * 판별을 틀리는 위험보다 몇 바이트가 싸다. 그래서 (1)은 서버/클라 가리지 않고 본다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');
const MESSAGES = path.join(ROOT, 'messages');
const LIST_FILE = path.join(SRC, 'lib', 'i18n-client-namespaces.ts');

/** src/** 의 .ts/.tsx 전부 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// 화이트리스트는 TS 파일이라 정규식으로 읽는다(빌드 없이 돌려야 하므로 import 하지 않는다).
const listSrc = fs.readFileSync(LIST_FILE, 'utf8');
const listBody = listSrc.match(
  /export const CLIENT_MESSAGE_NAMESPACES\s*=\s*\[([\s\S]*?)\]\s*as const;/,
);
if (!listBody) {
  console.error(`✗ ${path.relative(ROOT, LIST_FILE)} 에서 CLIENT_MESSAGE_NAMESPACES 배열을 못 찾았다.`);
  process.exit(1);
}
const allowed = new Set([...listBody[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

/**
 * 주석 제거 — 이 검사기 자신을 설명하는 주석(위 화이트리스트 파일 등)이 호출로 잡히면
 * 안 된다. 문자열 안의 `//`(URL 등)을 먹지 않도록, 줄 주석은 **줄이 주석으로 시작할 때만**
 * 지운다. 블록 주석은 통째로 지운다.
 */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? '' : line))
    .join('\n');
}

// 1) 모든 useTranslations 호출 수집
const CALL = /useTranslations\s*\(([^)]*)\)/g;
const used = new Map(); // ns -> [파일…]
const dynamic = [];
for (const file of walk(SRC)) {
  if (file === LIST_FILE) continue; // 화이트리스트 자신은 검사 대상이 아니다
  const code = stripComments(fs.readFileSync(file, 'utf8'));
  if (!code.includes('useTranslations')) continue;
  for (const m of code.matchAll(CALL)) {
    const arg = m[1].trim();
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const lit = arg.match(/^(['"])([^'"]*)\1$/);
    if (!lit) {
      // 인자 없음 = 루트 네임스페이스(전량 필요) / 변수·템플릿 = 정적 판별 불가
      dynamic.push(`${rel}: useTranslations(${arg || ''})`);
      continue;
    }
    const ns = lit[2].split('.')[0];
    if (!used.has(ns)) used.set(ns, []);
    used.get(ns).push(rel);
  }
}

const problems = [];

if (dynamic.length) {
  problems.push(
    '정적으로 판별할 수 없는 useTranslations 호출(네임스페이스가 리터럴이 아니다):\n  ' +
      dynamic.join('\n  ') +
      '\n  → 리터럴로 바꾸거나, 화이트리스트 방식 자체를 재검토해야 한다.',
  );
}

const missing = [...used.keys()].filter((ns) => !allowed.has(ns)).sort();
if (missing.length) {
  problems.push(
    'CLIENT_MESSAGE_NAMESPACES 에 빠진 네임스페이스:\n' +
      missing.map((ns) => `  - '${ns}'  (${[...new Set(used.get(ns))].join(', ')})`).join('\n') +
      `\n  → src/lib/i18n-client-namespaces.ts 의 배열에 추가하라.`,
  );
}

// 2) 화이트리스트 오타 검사 — 각 로케일 메시지에 실제로 있는 최상위 키인가
for (const f of fs.readdirSync(MESSAGES).filter((n) => n.endsWith('.json'))) {
  const msgs = JSON.parse(fs.readFileSync(path.join(MESSAGES, f), 'utf8'));
  const unknown = [...allowed].filter((ns) => !(ns in msgs));
  if (unknown.length) {
    problems.push(`messages/${f} 에 없는 네임스페이스가 화이트리스트에 있다: ${unknown.join(', ')}`);
  }
}

if (problems.length) {
  console.error('✗ check:i18n 실패\n\n' + problems.join('\n\n'));
  process.exit(1);
}

const unusedButShipped = [...allowed].filter((ns) => !used.has(ns)).sort();
console.log(
  `✓ check:i18n — useTranslations 네임스페이스 ${used.size}개가 모두 화이트리스트(${allowed.size}개)에 있다.` +
    (unusedButShipped.length
      ? `\n  (참고: 호출처가 없는데 내려보내는 항목 — ${unusedButShipped.join(', ')})`
      : ''),
);
