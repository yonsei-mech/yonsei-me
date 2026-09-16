// BK21 스캔 문서 6종을 **문서당 PDF 한 벌**로 묶는다 (raw JPG → pdf/<key>.pdf).
//
// 왜: 새 사이트의 BK21 보고서 게시판(board='bk21Reports')은 글 1건 = 문서 1개이고,
// **첫 PDF 첨부가 곧 본문**이다. 화면의 좌/우 펼침 리더(pdf.js)가 HTTP Range 로
// 필요한 쪽만 받아 가므로, 1,733장을 낱장 이미지로 들고 있던 구조가 필요 없어진다.
// (낱장 WebP 세트는 R2 에 그대로 남아 있다 — 지우지 마라. 이 PDF 와 별개 자산이다.)
//
// 사용법
//   node tools/bk21/build-pdf.mjs [--doc=<key>] [--max-width=1240] [--quality=80] [--force]
//   node tools/bk21/build-pdf.mjs --verify            # 빌드 후 자체 검증까지
//   node tools/bk21/build-pdf.mjs --verify-only       # 이미 만든 PDF 만 다시 열어 검증
//
// 설계 (실측·의도)
//  1) **쪽 크기는 장마다 다르다.** plan 은 633장이 가로(1240×876), 306장이 세로다.
//     2024·2025 는 세로가 1427~3106 까지 제각각. 그래서 "A4 로 통일"하면 절반이
//     늘어나거나 잘린다 — 장마다 그 픽셀 비율 그대로의 쪽을 만든다.
//     환산은 **폭 1240px = 595pt(A4 폭)** 한 기준만 쓴다: pt = px × 595/1240.
//     세로도 같은 배율이라 비율이 보존되고, 가로 장은 자연히 가로 쪽이 된다.
//  2) **원본 JPG 를 그대로 넣지 않는다.** 원본은 2480px·총 825MB 라 PDF 가 그 이상이 된다.
//     장별로 폭 1240 으로 줄이고(업스케일 금지) JPEG 로 다시 인코딩해 embedJpg 한다 —
//     pdf-lib 은 JPEG 바이트를 DCTDecode 로 **재인코딩 없이** 품는다.
//  3) **임시 파일을 만들지 않는다.** sharp → Buffer → embedJpg 로 장마다 흘려보낸다.
//  4) **객체 순서: 이미지 전부 → 쪽 객체 전부**, 그리고 **useObjectStreams:true**.
//     pdf.js 는 문서를 열 때 첫 쪽과 **마지막 쪽**을 검사한다(checkLastPage). 마지막 쪽에
//     닿으려면 /Kids 의 쪽 사전을 앞에서부터 하나씩 읽어야 하는데, 쪽 사전이 각 쪽 이미지
//     옆에 흩어져 있으면(예전 구조) 그 검사가 **파일 전체를 훑는다** — 실측: 38MB 를 다
//     받은 뒤에야 첫 쪽이 떴고 Range 요청 34회·전송 70MB. 이미지를 먼저 전부 등록하고
//     쪽 사전·콘텐츠 스트림을 마지막에 만들면 전부 파일 끝 몇백 KB 에 모이고, 객체
//     스트림이 그것을 한 덩어리로 압축해 xref 옆에 둔다 — 같은 실측에서 Range 2회,
//     첫 쪽까지 0.2초. 파일명에 버전(-v2)을 붙이는 이유: R2 키가 immutable 캐시라
//     같은 키에 덮어쓰면 옛 바이트가 계속 서빙된다(docs.mjs PDF_VERSION).
//  5) 날짜 메타는 문서의 대표 연도로 **고정**한다 — 다시 돌려도 같은 결과가 나오게.
//
// 함정
//  - **CMYK JPEG 은 embedJpg 가 거부한다**("Unknown JPEG channel count"). 그래서
//    출력 색공간을 srgb 로 강제한다. 회색조 스캔도 3채널이 되지만 q80 에서 차이는 미미하다.
//  - EXIF 회전은 적용하지 않는다(mirror-scans 의 derive 와 동일) — 적용하면 manifest 의
//    derivedPages 크기와 어긋난다.
//  - plan(939장)은 embed 한 이미지를 전부 메모리에 들고 저장한다. 힙이 모자라면
//    `node --max-old-space-size=4096 tools/bk21/build-pdf.mjs --doc=plan`.
//  - **용량 상한 100MB** — CMS 업로드 상한과 맞춘다. 넘으면 `--quality=70` 으로 다시 만든다.
//
// 산출물: tools/bk21/pdf/<key>.pdf (gitignore) + manifest.json 의 문서별 `pdf` 항목(추적)

import { readdirSync, existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { PDF_DIR, PDF_VERSION, RAW_DIR, loadManifest, pdfFileName, saveManifestEntry, selectDocs, mb } from './docs.mjs';

// ── 인자 ─────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const argVal = (name) => {
  const a = ARGV.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const DOC_FILTER = argVal('doc');
const MAX_WIDTH = Math.max(1, Number(argVal('max-width') ?? 1240) || 1240);
const QUALITY = Math.min(100, Math.max(1, Number(argVal('quality') ?? 80) || 80));
const FORCE = ARGV.includes('--force');
const VERIFY_ONLY = ARGV.includes('--verify-only');
const VERIFY = VERIFY_ONLY || ARGV.includes('--verify');

const selectedDocs = selectDocs(DOC_FILTER);

/** 폭 1240px 을 A4 폭 595pt 로 본다. 세로도 같은 배율 → 비율 보존 (설계 1). */
const PT_PER_PX = 595 / 1240;
const toPt = (px) => Math.round(px * PT_PER_PX * 100) / 100;
/** CMS 업로드 상한과 같은 경고선. */
const SIZE_LIMIT = 100 * 1024 * 1024;

const rawPages = (key) => {
  const dir = join(RAW_DIR, key);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}\.jpg$/.test(f))
    .sort()
    .map((f) => join(dir, f));
};

// ── 빌드 ─────────────────────────────────────────────────────────
async function buildDoc(doc) {
  const out = join(PDF_DIR, pdfFileName(doc.key));
  if (existsSync(out) && statSync(out).size > 0 && !FORCE) {
    const prev = loadManifest().docs.find((d) => d.key === doc.key)?.pdf ?? {};
    console.log(`  = ${doc.key}: 이미 있음 ${mb(statSync(out).size)} (다시 만들려면 --force)`);
    return { key: doc.key, pages: prev.pages ?? null, bytes: statSync(out).size, quality: prev.quality ?? null, skipped: true };
  }

  const files = rawPages(doc.key);
  if (files.length === 0) {
    console.log(`  ⚠ ${doc.key}: raw JPG 가 없다 — mirror-scans.mjs fetch 먼저.`);
    return null;
  }
  if (files.length !== doc.expected) {
    console.log(`  ⚠ ${doc.key}: raw ${files.length}장 ≠ 기대 ${doc.expected}장 — 확인 필요.`);
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle(`BK21 FOUR ${doc.title.ko}`);
  pdf.setSubject(doc.title.en);
  pdf.setAuthor('연세대학교 기계공학부');
  pdf.setCreator('연세대학교 기계공학부 BK21 FOUR 교육연구단');
  pdf.setProducer('yonsei-me tools/bk21/build-pdf.mjs (pdf-lib)');
  // 고정 날짜 — 다시 돌려도 같은 파일이 나오게 (설계 5)
  const stamp = new Date(`${doc.createdAt}T00:00:00Z`);
  pdf.setCreationDate(stamp);
  pdf.setModificationDate(stamp);

  const sizes = [];
  let jpegBytes = 0;
  // 1차: 이미지만 전부 등록한다 — 객체 번호(=파일 위치)가 앞쪽에 몰린다 (설계 4)
  const embedded = [];
  for (let i = 0; i < files.length; i += 1) {
    const { data, info } = await sharp(files[i])
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .toColourspace('srgb') // CMYK 원본이 섞여 있어도 embedJpg 가 받도록 (함정)
      .jpeg({ quality: QUALITY, progressive: false })
      .toBuffer({ resolveWithObject: true });
    jpegBytes += data.length;
    embedded.push({ img: await pdf.embedJpg(data), px: [info.width, info.height] });
    if ((i + 1) % 100 === 0) console.log(`     ${doc.key} ${i + 1}/${files.length}장 인코딩 (JPEG 누적 ${mb(jpegBytes)})`);
  }
  // 2차: 쪽 사전·콘텐츠 스트림은 마지막에 — 전부 파일 끝에 연속으로 놓인다 (설계 4)
  embedded.forEach(({ img, px }, i) => {
    const w = toPt(px[0]);
    const h = toPt(px[1]);
    const page = pdf.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
    sizes.push({ n: i + 1, w, h, px });
  });

  mkdirSync(PDF_DIR, { recursive: true });
  const bytes = await pdf.save({ useObjectStreams: true }); // 설계 4
  writeFileSync(out, bytes);

  const first = sizes[0];
  const last = sizes[sizes.length - 1];
  console.log(
    `  ${doc.key}: ${sizes.length}쪽 · ${mb(bytes.length)} · q${QUALITY} · ` +
      `1쪽 ${first.px[0]}×${first.px[1]}px → ${first.w}×${first.h}pt · ` +
      `${last.n}쪽 ${last.px[0]}×${last.px[1]}px → ${last.w}×${last.h}pt`,
  );
  if (bytes.length > SIZE_LIMIT) {
    console.log(`     ⚠ ${mb(bytes.length)} — CMS 업로드 상한 100MB 초과. --quality=70 으로 다시 만들어라.`);
  }

  saveManifestEntry({
    key: doc.key,
    pdf: {
      version: PDF_VERSION,
      file: pdfFileName(doc.key),
      maxWidth: MAX_WIDTH,
      quality: QUALITY,
      pages: sizes.length,
      bytes: bytes.length,
      jpegBytes,
      firstPage: { w: first.w, h: first.h },
      lastPage: { w: last.w, h: last.h },
      builtAt: new Date().toISOString(),
    },
  });

  return { key: doc.key, pages: sizes.length, bytes: bytes.length, quality: QUALITY, skipped: false };
}

// ── 자체 검증 ────────────────────────────────────────────────────
// 만든 PDF 를 **다시 열어** ① 쪽수 = raw 장수 ② 첫·마지막 쪽 크기 = 그 장의 픽셀
// 비율(폭 1240 → 595pt 환산)인지 본다. 기대값은 manifest 가 아니라 raw 이미지를
// 직접 재서 만든다 — 빌드가 참조한 값을 그대로 믿으면 검증이 아니다.
async function verifyDoc(doc) {
  const out = join(PDF_DIR, pdfFileName(doc.key));
  if (!existsSync(out)) return { key: doc.key, ok: false, why: 'PDF 없음' };
  const files = rawPages(doc.key);

  const pdf = await PDFDocument.load(readFileSync(out), { updateMetadata: false });
  const pages = pdf.getPages();
  const problems = [];
  if (pages.length !== files.length) problems.push(`쪽수 ${pages.length} ≠ raw ${files.length}장`);

  for (const [label, idx] of [['첫', 0], ['마지막', files.length - 1]]) {
    const meta = await sharp(files[idx]).metadata();
    const w = Math.min(meta.width, MAX_WIDTH); // withoutEnlargement
    const h = w === meta.width ? meta.height : Math.round((meta.height * w) / meta.width);
    const want = { w: toPt(w), h: toPt(h) };
    const got = pages[idx].getSize();
    // sharp 의 리사이즈 반올림과 1px 차이는 허용(0.5pt 미만)
    if (Math.abs(got.width - want.w) > 0.5 || Math.abs(got.height - want.h) > 0.5) {
      problems.push(
        `${label}쪽 ${got.width.toFixed(1)}×${got.height.toFixed(1)}pt ≠ 기대 ${want.w}×${want.h}pt (원본 ${meta.width}×${meta.height}px)`,
      );
    }
  }
  const t = pdf.getTitle();
  if (!t || !t.includes(doc.title.ko)) problems.push(`Title 메타 "${t}" 에 제목이 없다`);

  const size = pages[0].getSize();
  const lastSize = pages[pages.length - 1].getSize();
  console.log(
    `  ${problems.length === 0 ? '✓' : '✗'} ${doc.key}: ${pages.length}쪽 · ` +
      `1쪽 ${size.width.toFixed(1)}×${size.height.toFixed(1)}pt · ` +
      `${pages.length}쪽 ${lastSize.width.toFixed(1)}×${lastSize.height.toFixed(1)}pt · Title "${t}"`,
  );
  for (const p of problems) console.log(`      ✗ ${p}`);
  return { key: doc.key, ok: problems.length === 0, why: problems.join(' / ') };
}

// ── 진입 ─────────────────────────────────────────────────────────
const built = [];
if (!VERIFY_ONLY) {
  console.log(`── PDF 생성 (폭 ≤ ${MAX_WIDTH}px · JPEG q${QUALITY} · ${MAX_WIDTH}px = ${toPt(MAX_WIDTH)}pt) ──`);
  for (const doc of selectedDocs) {
    const r = await buildDoc(doc);
    if (r) built.push(r);
  }
  console.log('\n  문서            쪽수      바이트   품질');
  for (const b of built) {
    console.log(
      `  ${b.key.padEnd(14)}${String(b.pages ?? '?').padStart(5)}${mb(b.bytes).padStart(11)}` +
        `${String(b.quality ?? '?').padStart(6)}${b.skipped ? '  (기존)' : ''}`,
    );
  }
  const total = built.reduce((s, b) => s + b.bytes, 0);
  console.log(`  ${'합계'.padEnd(13)}${String(built.reduce((s, b) => s + (b.pages ?? 0), 0)).padStart(5)}${mb(total).padStart(11)}`);
}

if (VERIFY) {
  console.log('\n── 자체 검증 (PDF 를 다시 열어 쪽수·쪽 크기·메타 확인) ──');
  let bad = 0;
  for (const doc of selectedDocs) {
    const r = await verifyDoc(doc);
    if (!r.ok) bad += 1;
  }
  console.log(bad === 0 ? '  전부 통과' : `  ⚠ ${bad}개 문서에서 문제`);
  if (bad > 0) process.exitCode = 1;
}
