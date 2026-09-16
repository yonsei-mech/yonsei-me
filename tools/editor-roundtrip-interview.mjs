// 동문 인터뷰 에디터 도구 — 저장 왕복 하네스.
//
// 확인하는 것은 둘이다.
//   1) 정화(sanitizeEditorHtml)가 인터뷰 서식 세 가지를 **보존**하는가
//      — img[data-caption] · p[data-role="q|a"] · blockquote
//      그리고 열거형 밖의 값(data-role="x")과 과도하게 긴 캡션은 **떨어지는가**.
//   2) 렌더 후처리(wrapCaptionedImages)가 figure/figcaption 을 만들고,
//      캡션의 `<`·`"` 를 이스케이프하는가.
//
// 실행: node tools/editor-roundtrip-interview.mjs
//
// 검사 대상은 **원본 TS 파일 그 자체**다(정책을 여기 옮겨 적으면 두 곳이 갈린다).
// tsx 는 설치돼 있지 않아 devDependency 인 typescript 의 transpileModule 로 한 번
// 벗겨 ESM 으로 떨군 뒤 import 한다. 떨구는 자리가 node_modules/.cache 인 이유:
// 결과 모듈이 sanitize-html·htmlparser2 를 import 하므로 저장소의 node_modules 를
// 찾을 수 있는 경로여야 하고, 동시에 작업 트리를 더럽히지 않아야 하기 때문이다.

import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join, basename } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cacheDir = join(root, 'node_modules', '.cache', 'rt-interview');

let failures = 0;
function assert(ok, label, detail) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}

/** TS 원본을 ESM 으로 트랜스파일해 import 한다(타입만 벗기는 1:1 변환) */
async function loadTsModule(relPath) {
  const src = await readFile(resolve(root, relPath), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      verbatimModuleSyntax: false,
    },
    fileName: relPath,
  });
  const file = join(cacheDir, `${basename(relPath, '.ts')}.mjs`);
  await writeFile(file, outputText, 'utf8');
  return import(`${pathToFileURL(file).href}?t=${Date.now()}`);
}

await rm(cacheDir, { recursive: true, force: true });
await mkdir(cacheDir, { recursive: true });

const { sanitizeEditorHtml } = await loadTsModule('src/lib/admin/sanitize.ts');
const { wrapCaptionedImages } = await loadTsModule('src/lib/post-body-figures.ts');

/* ════════════════════════════════════════════════════════════════════
   1) 정화 왕복
   ════════════════════════════════════════════════════════════════════ */

const LONG_CAPTION = '가'.repeat(400);

const INPUT =
  '<h3>소제목을 입력하세요</h3>' +
  '<p>도입 문단…</p>' +
  '<p data-role="q">질문 1</p>' +
  '<p data-role="a">답변 1</p>' +
  '<p data-role="q">질문 2</p>' +
  '<p data-role="a">답변 2</p>' +
  '<p data-role="q">질문 3</p>' +
  '<p data-role="a">답변 3</p>' +
  '<blockquote><p>본문에서 뽑은 한 문장(풀쿼트)</p></blockquote>' +
  '<h3>마무리 소제목</h3>' +
  '<p>마무리 문단…</p>' +
  '<img src="/img/x.jpg" data-caption="캡션 텍스트" data-align="center" style="width: 60%">' +
  // 아래 셋은 떨어져야 하는 것들
  '<p data-role="x">잘못된 역할</p>' +
  '<p data-role="  Q  ">공백·대문자는 정규화</p>' +
  `<img src="/img/y.jpg" data-caption="${LONG_CAPTION}">` +
  '<img src="/img/z.jpg" data-caption="   ">' +
  '<p data-role="q" onclick="alert(1)">핸들러는 떨어진다</p>';

console.log('\n[1] sanitizeEditorHtml — 인터뷰 서식 보존/차단');
const clean = sanitizeEditorHtml(INPUT);

assert(/<img[^>]*data-caption="캡션 텍스트"/.test(clean), 'img[data-caption] 보존');
assert(/<img[^>]*data-align="center"/.test(clean), 'img[data-align] 보존(기존 기능 무손상)');
assert(/<img[^>]*style="width:\s*60%"/.test(clean), 'img 폭(style width %) 보존(기존 기능 무손상)');
// 뼈대의 q 3개 + 정규화로 살아난 2개(공백·대문자, 핸들러 붙은 것) = 5
assert((clean.match(/<p data-role="q">/g) || []).length === 5, 'p[data-role="q"] 보존(뼈대 3 + 정규화 2)');
assert((clean.match(/<p data-role="a">/g) || []).length === 3, 'p[data-role="a"] 3개 보존');
assert(/<p data-role="q">질문 1<\/p><p data-role="a">답변 1<\/p>/.test(clean), 'Q·A 문단이 순서대로 붙어 있다');
assert(/<blockquote><p>본문에서 뽑은 한 문장\(풀쿼트\)<\/p><\/blockquote>/.test(clean), 'blockquote 보존');
assert(!/data-role="x"/.test(clean), 'data-role="x"(열거형 밖) 제거');
assert(/<p data-role="q">공백·대문자는 정규화<\/p>/.test(clean), 'data-role="  Q  " → "q" 정규화');
assert(!/onclick/i.test(clean), 'onclick 핸들러 제거(기존 경계 유지)');

const capped = /data-caption="(가+)"/.exec(clean);
assert(capped !== null && capped[1].length === 300, '캡션 300자 초과분 잘림', capped ? `길이=${capped[1].length}` : '매치 없음');
assert(/<img src="\/img\/z.jpg"(?:\s*\/?)>/.test(clean), '공백뿐인 캡션은 속성째 제거');

// 재정화가 결과를 더 바꾸지 않아야 한다(왕복 안정성)
assert(sanitizeEditorHtml(clean) === clean, '정화 멱등(두 번 돌려도 같다)');

/* ════════════════════════════════════════════════════════════════════
   2) 렌더 후처리 — figure/figcaption + 이스케이프
   ════════════════════════════════════════════════════════════════════ */

console.log('\n[2] wrapCaptionedImages — figure/figcaption');
const wrapped = wrapCaptionedImages(clean);

assert(
  /<figure class="post-figure"><img src="\/img\/x.jpg"[^>]*><figcaption>캡션 텍스트<\/figcaption><\/figure>/.test(
    wrapped,
  ),
  'figure > img + figcaption 생성',
  wrapped.slice(wrapped.indexOf('<figure'), wrapped.indexOf('<figure') + 200),
);
assert(!/<figure[^>]*>\s*<img src="\/img\/z.jpg"/.test(wrapped), '캡션 없는 이미지는 감싸지 않는다');
assert(
  (wrapped.match(/<figure class="post-figure">/g) || []).length ===
    (wrapped.match(/<\/figure>/g) || []).length,
  'figure 여닫이 짝이 맞는다',
);

// 이스케이프 — 캡션에 `<`·`"`·`&` 가 들어간 경우
const XSS = sanitizeEditorHtml('<img src="/img/a.jpg" data-caption=\'<b>굵게</b> &amp; "따옴표"\'>');
const xssWrapped = wrapCaptionedImages(XSS);
// `&amp;` 는 속성에서 한 번 디코드돼 `&` 로 오고, figcaption 에 넣을 때 다시 `&amp;`
// 로 한 번만 인코드돼야 한다(`&amp;amp;` 가 되면 화면에 "&amp;" 가 그대로 보인다).
assert(
  /<figcaption>&lt;b&gt;굵게&lt;\/b&gt; &amp; &quot;따옴표&quot;<\/figcaption>/.test(xssWrapped),
  'figcaption 텍스트 이스케이프(<, ", &) — 이중 인코딩 없음',
  xssWrapped,
);
assert(!/<figcaption>[^<]*<b>/.test(xssWrapped), 'figcaption 안에 살아 있는 태그가 없다');

// 인라인 문맥(p 안)의 이미지는 건드리지 않는다 — figure 를 넣으면 p 가 깨진다
const INLINE = '<p>앞 <img src="/img/b.jpg" data-caption="캡션"> 뒤</p>';
assert(
  wrapCaptionedImages(INLINE) === INLINE,
  'p 안의 이미지는 감싸지 않는다(원문 그대로)',
  wrapCaptionedImages(INLINE),
);

// 속성값 안의 '>' — 정규식 구현이 틀리는 자리
const TRICKY = '<img src="/img/c.jpg" alt="a > b" data-caption="캡션">';
assert(
  /<figure class="post-figure"><img src="\/img\/c.jpg" alt="a > b" data-caption="캡션"><figcaption>캡션<\/figcaption><\/figure>/.test(
    wrapCaptionedImages(TRICKY),
  ),
  'alt 안의 ">" 를 태그 끝으로 오해하지 않는다',
  wrapCaptionedImages(TRICKY),
);

// 캡션 없는 문서는 바이트가 그대로여야 한다
const PLAIN = '<p>그냥 글</p><img src="/img/d.jpg">';
assert(wrapCaptionedImages(PLAIN) === PLAIN, '캡션 없는 문서는 손대지 않는다');
assert(wrapCaptionedImages('') === '', '빈 입력은 빈 문자열');

console.log(`\n${failures === 0 ? 'OK — 모든 검사 통과' : `실패 ${failures}건`}`);
process.exit(failures === 0 ? 0 : 1);
