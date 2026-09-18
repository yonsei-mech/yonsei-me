// 학부 '연구분야 소개' PDF(labs.pdf, 35쪽) → 연구실 소개자료 뷰어용 WebP · 원본 PDF R2 업로드.
//
// 왜: 구 사이트 대학원 › 연구실 페이지의 "연구실 소개자료" 버튼은 35쪽짜리 PDF(32MB) 한 벌을
// 통째로 내려받게 했다. 새 사이트는 이걸 **사이트 안 이미지 뷰어**로 되살린다. 한 쪽 보려고
// 32MB 를 받게 하지 않으려고 쪽마다 WebP 로 구워 public/ 에 두고, 원본 PDF 는 "원본 받기"용으로
// R2 에 한 벌만 올린다.
//
// 사용법 (render 는 재실행 안전 · 이미 있는 산출물은 건너뛴다)
//   node tools/labs/build-brochure.mjs render     --pdf <경로> [--force]
//   node tools/labs/build-brochure.mjs check      --pdf <경로>
//   node tools/labs/build-brochure.mjs upload-pdf --pdf <경로> [--apply]   # 기본 드라이런
//
// ⚠️ 어떤 쪽을 굽는지·쪽↔교수 대응은 **content/lab-brochure.json 이 단일 출처**다
//    (`cover` + `pages[].page`, 출력 경로는 `imageBase`). 여기에 쪽 번호를 다시 적지 마라.
//    35쪽('Thank you')은 목록에 없으니 굽지 않는다. 이 스크립트는 그 JSON 을 **읽기만** 한다.
//
// 함정 (실측으로 얻은 것들 — 지우지 말 것)
//  1) pdfjs-dist 는 **legacy 빌드**라야 Node 에서 돈다. 게다가 Windows 경로를 그대로 import()
//     하면 ERR_UNSUPPORTED_ESM_URL_SCHEME 이 나므로 require.resolve → pathToFileURL 로 넘긴다.
//  2) 캔버스는 **투명**으로 시작한다. 흰색을 먼저 칠하지 않으면 PDF 의 빈 영역이 알파 0 으로
//     남아, 어두운 배경 위 뷰어에서 까맣게 비친다.
//  3) **2쪽(강건욱)·14쪽(민경민)·26쪽(이형석)은 텍스트 레이어가 없는 이미지 쪽**이고 8쪽(김용준)도
//     일부만 있다. check 가 "텍스트 레이어 없음"을 내는 건 정상이다 — 렌더링에는 영향 없다.
//     (예전 README 는 강건욱이 PDF 에 없다고 적었는데, 텍스트 추출로만 봐서 생긴 오판이다.)
//  4) 썸네일은 360px 로 **따로 렌더링하지 않고** 1740px 렌더 결과를 sharp 로 줄인다. 작은
//     배율로 직접 그리면 가는 선·작은 글자가 깨져 나온다.
//  5) 원본 PDF 의 R2 키에 **판 번호(v1)** 가 들어간다. immutable 캐시라 같은 키에 덮어써도
//     브라우저·CDN 이 옛 바이트를 계속 준다 — 새 판이 오면 PDF_VERSION 을 올린다.
//
// 산출물
//   public/img/labs/brochure/pNN.webp        폭 1740, WebP q78 (870pt 원본의 2배 — 레티나 대응)
//   public/img/labs/brochure/thumb/pNN.webp  폭 360,  WebP q70 (썸네일 스트립)
//   R2 uploads/legacy/labs/labs-brochure-v1.pdf   원본 PDF (upload-pdf --apply 때만)
//   NN = 2자리 쪽 번호(01, 02, …). 화면은 imageBase + `/p${NN}.webp` 로 조립한다.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const require = createRequire(join(ROOT, 'package.json'));

const BROCHURE_JSON = join(ROOT, 'content', 'lab-brochure.json');
const FACULTY_JSON = join(ROOT, 'content', 'faculty-directory.json');

// 뷰어 본 이미지 · 썸네일 규격. 폭만 정하고 높이는 쪽 비율(870×630pt → 1740×1260)을 따른다.
const FULL = { width: 1740, quality: 78 };
const THUMB = { width: 360, quality: 70 };

// 원본 PDF 의 R2 키. 판이 바뀌면 PDF_VERSION 만 올린다(함정 5).
const PDF_VERSION = 'v1';
const R2_PDF_KEY = `uploads/legacy/labs/labs-brochure-${PDF_VERSION}.pdf`;
// src/lib/admin/r2.ts · tools/bk21/mirror-scans.mjs 와 같은 값 — 키가 판별로 고정이라 안전하다.
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

// 원본 출처 (구 사이트 대학원 › 연구실의 "연구실 소개자료" 버튼)
const SOURCE_URL = 'https://devcms.yonsei.ac.kr/cms/resFileDownload.do?siteId=me&type=etc&fileName=labs.pdf';

// ── 인자 ─────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const CMD = ARGV[0] && !ARGV[0].startsWith('--') ? ARGV[0] : '';
const FORCE = ARGV.includes('--force');
const APPLY = ARGV.includes('--apply');

/** `--name value` 와 `--name=value` 둘 다 받는다. */
function argValue(name) {
  const eq = ARGV.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = ARGV.indexOf(`--${name}`);
  if (i >= 0 && ARGV[i + 1] && !ARGV[i + 1].startsWith('--')) return ARGV[i + 1];
  return null;
}

// ── 공용 헬퍼 ────────────────────────────────────────────────────

/** .env.local 로더 (tools/bk21/docs.mjs · scripts/mirror-legacy-assets.mjs 와 같은 규약). */
function loadEnvLocal() {
  for (const p of ['.env.local', join(ROOT, '.env.local')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
    return;
  }
}

const pad2 = (n) => String(n).padStart(2, '0');
const kb = (b) => `${(b / 1024).toFixed(0)}KB`;
const mb = (b) => `${(b / 1024 / 1024).toFixed(2)}MB`;

/** content/lab-brochure.json — 굽는 쪽 목록·출력 경로의 단일 출처. */
function loadBrochure() {
  const b = JSON.parse(readFileSync(BROCHURE_JSON, 'utf8'));
  if (!Number.isInteger(b.cover) || !Array.isArray(b.pages) || typeof b.imageBase !== 'string') {
    console.error('content/lab-brochure.json 형식이 예상과 다릅니다 (cover · pages · imageBase 필요).');
    process.exit(1);
  }
  return b;
}

/** 굽는 쪽: 표지 + pages[] 의 쪽 (중복 제거, 오름차순). */
function targetPages(b) {
  const labels = new Map([[b.cover, '표지']]);
  for (const p of b.pages) labels.set(p.page, p.professorKo);
  return [...labels.entries()].sort((x, y) => x[0] - y[0]).map(([page, label]) => ({ page, label }));
}

/** `--pdf` 필수. 없거나 비어 있으면 사용법을 찍고 끝낸다. JSON 의 원본 크기와 다르면 경고. */
function requirePdf(b) {
  const pdfPath = argValue('pdf');
  if (!pdfPath) {
    console.error('--pdf <경로> 가 필요합니다. 원본: ' + SOURCE_URL);
    process.exit(1);
  }
  if (!existsSync(pdfPath) || statSync(pdfPath).size === 0) {
    console.error(`PDF 가 없거나 비어 있습니다: ${pdfPath}`);
    process.exit(1);
  }
  const bytes = statSync(pdfPath).size;
  if (b.pdf?.bytes && b.pdf.bytes !== bytes) {
    console.log(
      `  ⚠ PDF 크기 ${bytes.toLocaleString()}B 가 lab-brochure.json 의 pdf.bytes ` +
        `${b.pdf.bytes.toLocaleString()}B 와 다릅니다 — 새 판일 수 있습니다(README '새 판이 오면' 참조).`,
    );
  }
  return { pdfPath, bytes };
}

/** pdfjs 문서 열기. cMap·표준 폰트 경로를 넘겨야 내장 안 된 CJK 폰트도 그려진다. */
async function openPdf(pdfPath, b) {
  const pdfjsEntry = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await import(pathToFileURL(pdfjsEntry).href);
  // Node 팩토리는 이 값을 fs.readFile 에 그대로 넘긴다 → URL 이 아니라 파일 경로 + 끝 슬래시.
  const pkgDir = join(dirname(pdfjsEntry), '..', '..').replace(/\\/g, '/');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(pdfPath)),
    isEvalSupported: false,
    cMapUrl: `${pkgDir}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${pkgDir}/standard_fonts/`,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  }).promise;
  if (b.pdf?.pageCount && b.pdf.pageCount !== doc.numPages) {
    console.log(`  ⚠ PDF 쪽수 ${doc.numPages} 가 lab-brochure.json 의 pdf.pageCount ${b.pdf.pageCount} 와 다릅니다.`);
  }
  return doc;
}

// ── render ───────────────────────────────────────────────────────
// 쪽마다 1740px 로 한 번만 그리고, 같은 픽셀에서 본 이미지·썸네일 두 벌을 뽑는다(함정 4).
async function cmdRender() {
  const b = loadBrochure();
  const { pdfPath } = requirePdf(b);
  const outDir = join(ROOT, 'public', ...b.imageBase.split('/').filter(Boolean));
  const thumbDir = join(outDir, 'thumb');
  mkdirSync(thumbDir, { recursive: true });

  const doc = await openPdf(pdfPath, b);
  const { createCanvas } = require('@napi-rs/canvas');
  const pages = targetPages(b);

  console.log(`── render: ${pages.length}쪽 → ${b.imageBase}/pNN.webp (+ thumb/) ${FORCE ? '· --force' : ''}`);
  let fullTotal = 0;
  let thumbTotal = 0;
  let wrote = 0;
  let skipped = 0;
  for (const { page, label } of pages) {
    if (page < 1 || page > doc.numPages) {
      console.log(`  ✗ p${pad2(page)} ${label}: PDF 는 ${doc.numPages}쪽까지다 — 건너뜀`);
      continue;
    }
    const fullPath = join(outDir, `p${pad2(page)}.webp`);
    const thumbPath = join(thumbDir, `p${pad2(page)}.webp`);
    const needFull = FORCE || !existsSync(fullPath);
    const needThumb = FORCE || !existsSync(thumbPath);

    let dims = '';
    if (needFull || needThumb) {
      const p = await doc.getPage(page);
      const base = p.getViewport({ scale: 1 });
      const vp = p.getViewport({ scale: FULL.width / base.width });
      const w = Math.round(vp.width);
      const h = Math.round(vp.height);
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; // 함정 2 — 투명 캔버스
      ctx.fillRect(0, 0, w, h);
      await p.render({ canvasContext: ctx, viewport: vp }).promise;
      p.cleanup();

      // PNG 인코딩을 거치지 않고 RGBA 원시 픽셀을 그대로 sharp 에 넘긴다.
      const px = ctx.getImageData(0, 0, w, h).data;
      const rgba = Buffer.from(px.buffer, px.byteOffset, px.byteLength);
      const raw = { raw: { width: w, height: h, channels: 4 } };
      if (needFull) {
        await sharp(rgba, raw).flatten({ background: '#ffffff' }).webp({ quality: FULL.quality, effort: 6 }).toFile(fullPath);
      }
      if (needThumb) {
        await sharp(rgba, raw)
          .flatten({ background: '#ffffff' })
          .resize({ width: THUMB.width, kernel: 'lanczos3' })
          .webp({ quality: THUMB.quality, effort: 6 })
          .toFile(thumbPath);
      }
      dims = `${w}×${h}`;
      wrote += 1;
    } else {
      skipped += 1;
    }

    const fb = statSync(fullPath).size;
    const tb = statSync(thumbPath).size;
    fullTotal += fb;
    thumbTotal += tb;
    const mark = needFull || needThumb ? '↓' : '=';
    console.log(
      `  ${mark} p${pad2(page)} ${label.padEnd(4, '　')}  ${kb(fb).padStart(6)}  thumb ${kb(tb).padStart(5)}  ${dims}`,
    );
  }
  await doc.destroy();
  console.log(
    `  합계: 본 이미지 ${mb(fullTotal)} · 썸네일 ${mb(thumbTotal)} · 전체 ${mb(fullTotal + thumbTotal)}` +
      `  (새로 구움 ${wrote} · 이미 있어 생략 ${skipped}${skipped && !FORCE ? ' — 다시 구우려면 --force' : ''})`,
  );
}

// ── check ────────────────────────────────────────────────────────
// 사람용 보조 도구: lab-brochure.json 의 쪽↔교수 대응이 맞는지 텍스트 레이어로 대조한다.
// 쪽마다 ① 교수 이름이 본문에 있는지 ② 첫 이메일이 faculty-directory.json 의 이메일과 같은지.
// 판정만 찍고 항상 exit 0 — 이미지 쪽(함정 3)은 어차피 눈으로 봐야 한다.
//
// 이메일 추출 함정: 텍스트 조각이 이메일 **도메인 쪽에서** 잘린다(실측).
//   7쪽 `yjkim40@yonsei.ac.⏎kr` · 12쪽 `hjk@ yo nsei.ac.kr` · 32쪽 `jongeunchoi@yonsei .⏎ac.kr`
// 그래서 '@' 뒤는 공백을 걷어 내고 알려진 끝(ac.kr 등)까지만 붙인다. '@' 앞은 공백을 경계로
// 둔다 — 앞까지 걷어 내면 "…Lab.dj.shin" 처럼 앞 단어가 딸려 온다.
const LOCAL_TAIL = /[A-Za-z0-9._%+-]+$/;
const DOMAIN_HEAD = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*?\.(?:ac\.kr|co\.kr|re\.kr|or\.kr|go\.kr|com|net|org|edu)/i;
const EMAIL_ONLY = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

function emailsIn(text) {
  const out = [];
  for (let i = text.indexOf('@'); i >= 0; i = text.indexOf('@', i + 1)) {
    const local = text.slice(Math.max(0, i - 64), i).replace(/\s+$/, '').match(LOCAL_TAIL)?.[0];
    const domain = text.slice(i + 1, i + 60).replace(/\s+/g, '').match(DOMAIN_HEAD)?.[0];
    if (local && domain) out.push(`${local}@${domain}`.toLowerCase());
  }
  return [...new Set(out)];
}

/** 글꼴에 유니코드 매핑이 없어 조각은 있는데 글자가 깨진 쪽(14쪽 실측)을 가려낸다. */
function looksGarbled(text) {
  const chars = [...text.replace(/\s+/g, '')];
  if (chars.length < 20) return false;
  const readable = chars.filter((c) => /[\x21-\x7Eㄱ-ㆎ가-힣•–—‘-”❑]/.test(c));
  return readable.length / chars.length < 0.6;
}

/** faculty-directory.json → 이름별 이메일. 파일이 없거나 형식이 다르면 빈 Map. */
function loadFacultyEmails() {
  const byName = new Map();
  if (!existsSync(FACULTY_JSON)) return byName;
  const data = JSON.parse(readFileSync(FACULTY_JSON, 'utf8'));
  const list = Array.isArray(data) ? data : [];
  for (const f of list) {
    if (!f?.name || !f.email) continue;
    const raw = String(f.email).trim();
    const first = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+?(?=@|$|\s|[,;])/)?.[0];
    // 같은 이름이 둘이면(명예교수 등) 먼저 나온 현직 쪽을 둔다
    if (!byName.has(f.name)) byName.set(f.name, { raw, email: first?.toLowerCase() ?? null, malformed: !EMAIL_ONLY.test(raw) });
  }
  return byName;
}

async function cmdCheck() {
  const b = loadBrochure();
  const { pdfPath } = requirePdf(b);
  const doc = await openPdf(pdfPath, b);
  const faculty = loadFacultyEmails();

  console.log(`── check: lab-brochure.json 쪽↔교수 대응을 PDF 텍스트 레이어로 대조 (${b.pages.length}쪽) ──`);
  console.log('  쪽   교수     이름  PDF 첫 이메일                 faculty-directory 대조');
  const tally = { ok: 0, mismatch: 0, noText: 0, noEmail: 0, garbled: 0 };
  const notes = [];
  for (const { page, professorKo } of [...b.pages].sort((x, y) => x.page - y.page)) {
    const row = `  p${pad2(page)}  ${professorKo.padEnd(4, '　')}`;
    if (page < 1 || page > doc.numPages) {
      console.log(`${row}  ✗ PDF 는 ${doc.numPages}쪽까지다`);
      continue;
    }
    const p = await doc.getPage(page);
    const tc = await p.getTextContent();
    p.cleanup();
    const items = tc.items.filter((i) => typeof i.str === 'string');
    const text = items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('');
    const tight = text.replace(/\s+/g, '');
    const fac = faculty.get(professorKo);
    const facCol = fac ? `faculty: ${fac.email ?? fac.raw}` : 'faculty-directory 에 이메일 없음';
    if (fac?.malformed) notes.push(`${professorKo}: faculty-directory.json email 값이 이메일 형식이 아니다 — "${fac.raw}"`);

    if (!tight) {
      tally.noText += 1;
      console.log(`${row}  –    (텍스트 레이어 없음 — 이미지 쪽, 눈으로 확인)  ${facCol}`);
      continue;
    }
    if (looksGarbled(text)) {
      tally.garbled += 1;
      console.log(`${row}  –    (텍스트 레이어 판독 불가 — 글꼴 매핑 깨짐, 눈으로 확인)  ${facCol}`);
      continue;
    }
    const nameHit = tight.includes(professorKo) ? '✓' : '–';
    const emails = emailsIn(text);
    const first = emails[0] ?? null;
    let verdict;
    if (!first) {
      tally.noEmail += 1;
      verdict = `(이메일 없음, 텍스트 ${tight.length}자)  ${facCol}`;
    } else if (!fac?.email) {
      verdict = `${first.padEnd(30)}${facCol}`;
    } else if (first === fac.email) {
      tally.ok += 1;
      verdict = `${first.padEnd(30)}✓ 일치`;
    } else if (emails.includes(fac.email)) {
      tally.ok += 1;
      verdict = `${first.padEnd(30)}✓ 일치 (이 쪽 ${emails.indexOf(fac.email) + 1}번째 이메일)`;
    } else {
      tally.mismatch += 1;
      verdict = `${first.padEnd(30)}⚠ 불일치 — ${facCol}`;
    }
    console.log(`${row}  ${nameHit}    ${verdict}`);
  }
  await doc.destroy();

  console.log(
    `  요약: 이메일 일치 ${tally.ok} · 불일치 ${tally.mismatch} · 이메일 없음 ${tally.noEmail}` +
      ` · 텍스트 레이어 없음 ${tally.noText} · 판독 불가 ${tally.garbled}`,
  );
  console.log('  ※ "이름" 열은 교수 이름이 쪽 텍스트에 (공백 무시) 들어 있는지다. – 는 틀렸다는 뜻이 아니다 — 영문만 적힌 쪽도 있다.');
  for (const n of notes) console.log(`  ⚠ ${n}`);
}

// ── upload-pdf ───────────────────────────────────────────────────
// 원본 PDF 한 벌을 R2 에 올린다("원본 PDF 받기" 링크용). 기본은 드라이런이고 자격증명 없이 돈다.
// 같은 키가 이미 있으면 다시 쓰지 않는다(함정 5) — 내용을 바꾸려면 PDF_VERSION 을 올려라.
async function cmdUploadPdf() {
  const b = loadBrochure();
  const { pdfPath, bytes } = requirePdf(b);
  const body = readFileSync(pdfPath);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const base = (process.env.R2_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  const publicUrl = base ? `${base}/${R2_PDF_KEY}` : null;

  console.log('── PDF 업로드 대상 ──');
  console.log(`  원본:   ${pdfPath}`);
  console.log(`  크기:   ${bytes.toLocaleString()}B (${mb(bytes)}) · sha256 ${sha256.slice(0, 16)}…`);
  console.log(`  R2 키:  ${R2_PDF_KEY}`);
  console.log(`  타입:   application/pdf · Cache-Control: ${CACHE_CONTROL}`);
  console.log(`  공개 URL: ${publicUrl ?? `(R2_PUBLIC_BASE_URL 이 비어 있다 — <공개 베이스>/${R2_PDF_KEY})`}`);

  if (!APPLY) {
    console.log('\n  ※ 드라이런 — 아무것도 올리지 않았습니다. 실제 업로드는 --apply.');
    return;
  }

  // `--apply` 때만 SDK·자격증명을 연다 — 드라이런은 자격증명 없이도 돌아야 한다.
  const { S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
  for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
    if (!process.env[name]) {
      console.error(`${name} 환경변수가 없습니다 (.env.local).`);
      process.exit(1);
    }
  }
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const Bucket = process.env.R2_BUCKET;

  let exists = false;
  try {
    await s3.send(new HeadObjectCommand({ Bucket, Key: R2_PDF_KEY }));
    exists = true;
  } catch {
    exists = false;
  }
  if (exists) {
    // 같은 키에 다시 쓰지 않는다 — immutable 캐시라 덮어써도 옛 바이트가 계속 서빙된다.
    console.log(`\n  = ${R2_PDF_KEY} 이미 있음 (생략). 다른 판이면 PDF_VERSION 을 올려 새 키로 올려라.`);
  } else {
    await s3.send(
      new PutObjectCommand({
        Bucket,
        Key: R2_PDF_KEY,
        Body: body,
        ContentType: 'application/pdf',
        CacheControl: CACHE_CONTROL,
      }),
    );
    console.log(`\n  ↑ ${R2_PDF_KEY} ${mb(bytes)} 올림`);
  }
  console.log(`  URL: ${publicUrl ?? `<R2_PUBLIC_BASE_URL>/${R2_PDF_KEY}`}`);
  console.log('  → 이 URL 을 content/lab-brochure.json 의 pdf.url 에 넣으십시오.');
}

// ── 진입점 ───────────────────────────────────────────────────────
const COMMANDS = { render: cmdRender, check: cmdCheck, 'upload-pdf': cmdUploadPdf };

loadEnvLocal();
if (!COMMANDS[CMD]) {
  console.log(
    '사용법: node tools/labs/build-brochure.mjs <render|check|upload-pdf> --pdf <경로> [--force] [--apply]\n' +
      `  원본 PDF: ${SOURCE_URL}`,
  );
  process.exit(CMD ? 1 : 0);
}
await COMMANDS[CMD]();
