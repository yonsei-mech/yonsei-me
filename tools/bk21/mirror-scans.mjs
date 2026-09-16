// 구 사이트 BK21 스캔 문서 6종(JPG 1,733장) 확보·미러링 — 도메인 컷오버 전 1회성 작업.
//
// 왜: 구 me.yonsei.ac.kr 의 BK21 메뉴는 사업계획서·자체평가보고서를 **PDF 다운로드가 아니라
// `<img>` 시퀀스**로 박아 놓았다(각 `.do` 페이지에 페이지 수만큼 img 태그). 다운로드 링크가
// 아예 없으므로, 새 사이트로 옮기려면 이미지를 순서대로 긁어 R2 에 올리는 수밖에 없다.
// DNS 가 me.yonsei.ac.kr 을 우리 서버로 돌리는 순간 원본 주소는 사라진다 — 컷오버 전 필수.
//
// 사용법 (전부 재실행 안전 · 이미 있는 산출물은 건너뛴다)
//   node tools/bk21/mirror-scans.mjs fetch  [--doc=<key>] [--concurrency=3]
//   node tools/bk21/mirror-scans.mjs derive [--doc=<key>] [--max-width=1240]
//   node tools/bk21/mirror-scans.mjs upload [--doc=<key>] [--include-jpg] [--apply]  # 기본 드라이런
//   node tools/bk21/mirror-scans.mjs upload-pdf [--doc=<key>] [--apply]              # 기본 드라이런
//   node tools/bk21/mirror-scans.mjs seed
//
// ⚠️ 문서 정의(DOCS)는 **docs.mjs 가 단일 출처**다. build-pdf.mjs·seed-reports.mjs 가
//    같은 정의를 쓴다 — 키·제목·원문 주소를 여기에 다시 적지 마라.
//
// 함정 (실측으로 얻은 것들 — 지우지 말 것)
//  1) **이미지 직접 요청은 Referer 없이 403.** 구 서버가 핫링크를 막는다. 해당 `.do` 페이지를
//     Referer 로, 브라우저 UA 를 함께 붙여야 200 이 온다. 페이지 HTML 자체는 헤더 없이도 200.
//  2) **파일명 규칙이 문서마다 다르다.** plan/2021/2022 는 `0001.jpg` 4자리 0 패딩,
//     2023 은 `…_v2_1.jpg` 로 **0 패딩이 없고**(1,2,…,10 이라 사전순 정렬하면 순서가 깨진다),
//     2024/2025 는 `…_페이지_001.jpg` 3자리. 그래서 파일명 패턴을 **추측하지 않고**
//     페이지 HTML 의 `<img src>` **등장 순서**를 그대로 쓴다. 로컬 저장명은 전부
//     `NNNN.jpg`(4자리, 1부터)로 정규화한다.
//  3) 파일명에 한글이 들어간다 — 요청 URL 은 `new URL()` 로 퍼센트 인코딩해서 보낸다.
//  4) 2025 보고서는 원본이 **블라인드본**(`…최종_블라인드…`)이다. 심사용으로 일부 정보가
//     가려진 판본이라는 뜻이니, 공개 표기에 "최신 원본"인 양 쓰지 말 것.
//  5) 상대 서버 배려: 동시 3, 요청 간 150ms 를 넘기지 마라. 원본 총 825MB 다(실측).
//  6) **원본 세트 자체가 결락돼 있다** — plan 은 인쇄 쪽 307~324(18쪽), report-2023 은
//     184~511(328쪽)이 업로드에서 빠졌다. 링크 안 된 뒷번호 이미지는 서버에도 없다(404 확인).
//     우리 쪽 실패가 아니니 재시도하지 말고, 화면에 "총 957쪽" 같은 원본 쪽수를 쓰지 마라.
//     결락 사실은 seed 의 `printedTotal`·`gaps`·`note` 로 실어 보낸다. 근거는 README.md.
//  7) **표지로 쓸 장이 문서마다 다르다.** plan 의 1장은 요약문에 가까운 거의 백지라 표지는
//     2장이다(DOCS 의 `coverPage`). 나머지는 1장.
//  8) **파생본은 뷰어 표시용이라 폭 1240 으로 줄인다**(원본 2480 은 그대로 쓰면 장당 0.5MB).
//     원본이 1240 보다 좁으면 업스케일하지 않고 원 크기를 유지한다 — 2021(793)·2022/2023(1190)
//     은 사실상 그대로다. 그래서 **문서 안에서도 장 크기가 다를 수 있어** manifest 에 장별
//     `{n,w,h,bytes}` 를 남기고, seed 는 첫 장과 다른 장만 `pageSizes` 로 실어 준다.
//
// 산출물
//   tools/bk21/raw/<key>/NNNN.jpg        원본 JPG (gitignore)
//   tools/bk21/derived/<key>/NNNN.webp   뷰어용 WebP q80 (최대 폭 1240, 업스케일 없음) (gitignore)
//   tools/bk21/derived/<key>/cover.webp  표지 썸네일(너비 480, coverPage 장 기준)
//   tools/bk21/manifest.json             문서·장수·바이트·해상도·파생 장별 크기·원본 URL (추적)
//   tools/bk21/bk21-reports.seed.json    S3-UI 가 content/bk21-reports.json 로 가져갈 씨앗 (추적)
//
// ⚠️ 이 스크립트는 content/ 에 직접 쓰지 않는다. seed 파일을 만들 뿐이다.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
// 문서 정의(DOCS)·경로·manifest 헬퍼는 docs.mjs 가 **단일 출처**다 —
// build-pdf.mjs·seed-reports.mjs 와 공유한다. 여기에 다시 적지 마라.
import {
  DOCS,
  ORIGIN,
  R2_PREFIX,
  RAW_DIR,
  DERIVED_DIR,
  PDF_DIR,
  SEED_PATH,
  loadEnvLocal,
  loadManifest,
  pdfFileName,
  saveManifestEntry,
  selectDocs,
  pad4,
  mb,
} from './docs.mjs';

loadEnvLocal();

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// ── 인자 ─────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const CMD = ARGV.find((a) => !a.startsWith('--')) ?? '';
const APPLY = ARGV.includes('--apply');
const argVal = (name) => {
  const a = ARGV.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const DOC_FILTER = argVal('doc');
const CONCURRENCY = Math.max(1, Number(argVal('concurrency') ?? 3) || 3);
/** 뷰어용 파생본 최대 폭. 원본이 더 좁으면 업스케일하지 않는다 (함정 8). */
const MAX_WIDTH = Math.max(1, Number(argVal('max-width') ?? 1240) || 1240);
const COVER_WIDTH = 480;
/** 기본 업로드는 WebP + cover 만. 원본 JPG(825MB)는 이 옵션으로만 포함된다. */
const INCLUDE_JPG = ARGV.includes('--include-jpg');

const selectedDocs = selectDocs(DOC_FILTER);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── fetch ────────────────────────────────────────────────────────

/** `.do` 페이지 HTML 에서 그 문서의 이미지 src 를 **등장 순서대로** 뽑는다 (함정 2). */
async function listPageImages(doc) {
  const pageUrl = ORIGIN + doc.sourcePath;
  const res = await fetch(pageUrl, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`페이지 ${pageUrl} → HTTP ${res.status}`);
  const html = await res.text();
  const seen = new Set();
  const srcs = [];
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const src = m[1];
    // 그 디렉터리 바로 아래만 (하위 연도 디렉터리·공통 로고 제외)
    if (!src.startsWith(doc.imgDir)) continue;
    if (src.slice(doc.imgDir.length).includes('/')) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    srcs.push(src);
  }
  return { pageUrl, srcs };
}

async function fetchImage(absUrl, referer, attempt = 1) {
  try {
    const res = await fetch(absUrl, {
      headers: { 'User-Agent': UA, Referer: referer, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ctype = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    // HTML 이 오면 이미지가 아니라 오류/차단 페이지다 — 저장하면 안 된다(함정 1).
    if (ctype === 'text/html') throw new Error('HTML 응답(이미지 아님)');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error('빈 응답');
    return buf;
  } catch (e) {
    if (attempt >= 3) throw e;
    await sleep(500 * attempt);
    return fetchImage(absUrl, referer, attempt + 1);
  }
}

async function cmdFetch() {
  for (const doc of selectedDocs) {
    const { pageUrl, srcs } = await listPageImages(doc);
    if (srcs.length !== doc.expected) {
      console.log(`  ⚠ ${doc.key}: 장수 ${srcs.length} ≠ 기대 ${doc.expected} — 원본이 바뀌었다. 확인 필요.`);
    }
    const outDir = join(RAW_DIR, doc.key);
    mkdirSync(outDir, { recursive: true });

    const files = new Array(srcs.length);
    const failures = [];
    let done = 0;
    let downloaded = 0;
    let skipped = 0;
    let cursor = 0;

    async function worker() {
      while (cursor < srcs.length) {
        const idx = cursor;
        cursor += 1;
        const src = srcs[idx];
        const n = idx + 1;
        const absUrl = new URL(src, ORIGIN).href; // 한글 파일명 퍼센트 인코딩 (함정 3)
        const dest = join(outDir, `${pad4(n)}.jpg`);
        try {
          let bytes;
          if (existsSync(dest) && statSync(dest).size > 0) {
            bytes = statSync(dest).size;
            skipped += 1;
          } else {
            await sleep(150);
            const buf = await fetchImage(absUrl, pageUrl);
            writeFileSync(dest, buf);
            bytes = buf.length;
            downloaded += 1;
          }
          files[idx] = { n, src: absUrl, bytes };
        } catch (e) {
          failures.push({ n, src: absUrl, reason: e.message });
        }
        done += 1;
        if (done % 100 === 0) {
          console.log(`     ${doc.key} ${done}/${srcs.length} · 받음 ${downloaded} · 기존 ${skipped} · 실패 ${failures.length}`);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const ok = files.filter(Boolean);
    const bytesTotal = ok.reduce((s, f) => s + f.bytes, 0);
    let width = null;
    let height = null;
    const first = join(outDir, '0001.jpg');
    if (existsSync(first)) {
      const meta = await sharp(first).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    }

    saveManifestEntry({
      key: doc.key,
      title: doc.title,
      year: doc.year,
      sourcePath: doc.sourcePath,
      pages: ok.length,
      width,
      height,
      bytes: bytesTotal,
      files: ok,
    });

    console.log(
      `  ${doc.key}: ${ok.length}장 (새로 ${downloaded} · 기존 ${skipped} · 실패 ${failures.length}) · ${mb(bytesTotal)} · ${width}×${height}`,
    );
    for (const f of failures.slice(0, 10)) console.log(`     ✗ ${pad4(f.n)} ${f.reason}  ${f.src}`);
    if (failures.length > 10) console.log(`     … 외 ${failures.length - 10}건 실패`);
  }
}

// ── derive ───────────────────────────────────────────────────────
// 뷰어가 쓸 WebP 를 만든다. **폭이 MAX_WIDTH 보다 크면 줄이고, 작으면 그대로 둔다**(업스케일 금지).
// manifest 에 기록된 파생 폭이 지금 값과 다르면(= 1차 원해상도 파생본) 전부 다시 만든다.
async function cmdDerive() {
  for (const doc of selectedDocs) {
    const inDir = join(RAW_DIR, doc.key);
    if (!existsSync(inDir)) {
      console.log(`  ${doc.key}: raw 없음 — fetch 먼저`);
      continue;
    }
    const jpgs = readdirSync(inDir).filter((f) => /^\d{4}\.jpg$/.test(f)).sort();
    const outDir = join(DERIVED_DIR, doc.key);
    mkdirSync(outDir, { recursive: true });

    // 같은 폭으로 이미 만든 장만 재사용한다(폭이 다르거나 기록이 없으면 재생성).
    const prev = loadManifest().docs.find((d) => d.key === doc.key) ?? {};
    const sameWidth = prev.derive?.maxWidth === MAX_WIDTH;
    const prevPages = new Map(
      (sameWidth && Array.isArray(prev.derivedPages) ? prev.derivedPages : []).map((p) => [p.n, p]),
    );

    const pages = [];
    let made = 0;
    let skipped = 0;
    let webpBytes = 0;
    let done = 0;
    for (const f of jpgs) {
      const n = Number(f.slice(0, 4));
      const dest = join(outDir, `${pad4(n)}.webp`);
      const cached = prevPages.get(n);
      let page;
      if (cached?.w && cached?.h && existsSync(dest) && statSync(dest).size > 0) {
        page = { n, w: cached.w, h: cached.h, bytes: statSync(dest).size };
        skipped += 1;
      } else {
        const info = await sharp(join(inDir, f))
          .resize({ width: MAX_WIDTH, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(dest);
        page = { n, w: info.width, h: info.height, bytes: info.size };
        made += 1;
      }
      pages.push(page);
      webpBytes += page.bytes;
      done += 1;
      if (done % 100 === 0) console.log(`     ${doc.key} ${done}/${jpgs.length} webp`);
    }

    const coverPage = doc.coverPage ?? 1;
    const coverSrc = join(inDir, `${pad4(coverPage)}.jpg`);
    const coverDest = join(outDir, 'cover.webp');
    let coverBytes = 0;
    let coverW = null;
    let coverH = null;
    if (existsSync(coverSrc)) {
      const stale =
        !(existsSync(coverDest) && statSync(coverDest).size > 0) ||
        prev.derive?.coverPage !== coverPage ||
        prev.derive?.coverWidth !== COVER_WIDTH;
      if (stale) {
        const info = await sharp(coverSrc)
          .resize({ width: COVER_WIDTH, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(coverDest);
        coverW = info.width;
        coverH = info.height;
      } else {
        const meta = await sharp(coverDest).metadata();
        coverW = meta.width ?? null;
        coverH = meta.height ?? null;
      }
      coverBytes = statSync(coverDest).size;
    } else {
      console.log(`  ⚠ ${doc.key}: 표지 원본 ${pad4(coverPage)}.jpg 가 없다 — cover 생략`);
    }

    // 문서 대표 크기는 **가장 많은 장의 크기**(최빈값)다. "첫 장" 이 아니다 —
    // report-2021 은 1장만 793×1121 이고 나머지 183장이 1240×1752 여서, 첫 장을 기준으로
    // 삼으면 문서 전체가 예외 취급된다(실측). 대표와 다른 장만 seed 가 pageSizes 로 싣는다.
    const counts = new Map();
    for (const p of pages) counts.set(`${p.w}x${p.h}`, (counts.get(`${p.w}x${p.h}`) ?? 0) + 1);
    let modeKey = null;
    let modeN = -1;
    for (const [k, n] of counts) if (n > modeN) [modeKey, modeN] = [k, n]; // 동률이면 앞 장이 이긴다
    const [modeW, modeH] = modeKey ? modeKey.split('x').map(Number) : [null, null];
    const odd = pages.length - Math.max(modeN, 0);

    saveManifestEntry({
      key: doc.key,
      derive: { maxWidth: MAX_WIDTH, coverWidth: COVER_WIDTH, coverPage },
      derivedWidth: modeW,
      derivedHeight: modeH,
      derivedPages: pages,
      webpBytes,
      coverBytes,
      coverWidth: coverW,
      coverHeight: coverH,
    });
    console.log(
      `  ${doc.key}: webp ${pages.length}장 (새로 ${made} · 기존 ${skipped}) · ${mb(webpBytes)} · ` +
        `${modeW}×${modeH}${odd ? ` (다른 크기 ${odd}장)` : ''} · ` +
        `cover ${coverW}×${coverH} ${(coverBytes / 1024).toFixed(0)}KB (${pad4(coverPage)}장)`,
    );
  }
}

// ── upload ───────────────────────────────────────────────────────
/**
 * 올릴 객체 목록을 로컬 산출물에서 만든다 (드라이런은 네트워크·자격증명 불필요).
 * 기본은 **WebP + cover 만** — 화면이 원본 JPG 를 쓰지 않으므로 825MB 를 올릴 이유가 없다.
 * 원본은 로컬 raw/ 에 남으니 나중에 `--include-jpg` 로 언제든 추가 업로드할 수 있다.
 */
function uploadPlan(doc) {
  const items = [];
  const derDir = join(DERIVED_DIR, doc.key);
  if (existsSync(derDir)) {
    for (const f of readdirSync(derDir).filter((x) => x.endsWith('.webp')).sort()) {
      items.push({ key: `${R2_PREFIX}/${doc.key}/${f}`, path: join(derDir, f), type: 'image/webp' });
    }
  }
  if (INCLUDE_JPG) {
    const rawDir = join(RAW_DIR, doc.key);
    if (existsSync(rawDir)) {
      for (const f of readdirSync(rawDir).filter((x) => x.endsWith('.jpg')).sort()) {
        items.push({ key: `${R2_PREFIX}/${doc.key}/${f}`, path: join(rawDir, f), type: 'image/jpeg' });
      }
    }
  }
  return items.map((it) => ({ ...it, bytes: statSync(it.path).size }));
}

/**
 * R2 클라이언트 + 헬퍼. `--apply` 때만 부른다 — 드라이런은 자격증명 없이도 돌아야 한다.
 * 키가 내용별로 고정(문서+장 번호, 또는 문서.pdf)이라 immutable 캐시가 안전하다
 * — src/lib/admin/r2.ts 와 같은 값.
 */
async function openR2() {
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
  const BUCKET = process.env.R2_BUCKET;
  const CACHE_CONTROL = 'public, max-age=31536000, immutable';

  const headExists = async (key) => {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  };
  const put = (key, body, type) =>
    s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: type,
        CacheControl: CACHE_CONTROL,
      }),
    );
  return { headExists, put };
}

async function cmdUpload() {
  const plans = selectedDocs.map((d) => ({ doc: d, items: uploadPlan(d) }));
  const objects = plans.reduce((s, p) => s + p.items.length, 0);
  const bytes = plans.reduce((s, p) => s + p.items.reduce((t, i) => t + i.bytes, 0), 0);

  console.log(
    `── 업로드 대상 (R2 키 접두사 ${R2_PREFIX}/) · ${INCLUDE_JPG ? 'WebP + cover + 원본 JPG' : 'WebP + cover 만 (--include-jpg 로 원본 포함)'} ──`,
  );
  for (const { doc, items } of plans) {
    const b = items.reduce((t, i) => t + i.bytes, 0);
    const jpg = items.filter((i) => i.type === 'image/jpeg');
    const webp = items.filter((i) => i.type === 'image/webp' && !i.key.endsWith('/cover.webp'));
    const cover = items.filter((i) => i.key.endsWith('/cover.webp'));
    const part = [`webp ${webp.length} · ${mb(webp.reduce((t, i) => t + i.bytes, 0))}`];
    if (cover.length) part.push(`cover ${(cover[0].bytes / 1024).toFixed(0)}KB`);
    if (jpg.length) part.push(`jpg ${jpg.length} · ${mb(jpg.reduce((t, i) => t + i.bytes, 0))}`);
    console.log(`  ${doc.key}: ${items.length}개 · ${mb(b)}   (${part.join(' / ')})`);
  }
  console.log(`  합계: ${objects}개 · ${mb(bytes)}`);

  if (!APPLY) {
    console.log('\n  ※ 드라이런 — 아무것도 올리지 않았습니다. 실제 업로드는 --apply.');
    return;
  }

  const { headExists, put: putObject } = await openR2();

  for (const { doc, items } of plans) {
    let put = 0;
    let skip = 0;
    const failures = [];
    let cursor = 0;
    let done = 0;
    async function worker() {
      while (cursor < items.length) {
        const it = items[cursor];
        cursor += 1;
        try {
          if (await headExists(it.key)) {
            skip += 1;
          } else {
            await putObject(it.key, readFileSync(it.path), it.type);
            put += 1;
          }
        } catch (e) {
          failures.push({ key: it.key, reason: e.message });
        }
        done += 1;
        if (done % 100 === 0) console.log(`     ${doc.key} ${done}/${items.length} · 올림 ${put} · 기존 ${skip} · 실패 ${failures.length}`);
      }
    }
    await Promise.all(Array.from({ length: 4 }, () => worker()));
    console.log(`  ${doc.key}: 올림 ${put} · 이미 있어 생략 ${skip} · 실패 ${failures.length}`);
    for (const f of failures.slice(0, 10)) console.log(`     ✗ ${f.key} ${f.reason}`);
  }
}

// ── upload-pdf ───────────────────────────────────────────────────
// build-pdf.mjs 가 만든 문서별 PDF 한 벌을 올린다. 키는 장 이미지들과 **같은 접두사 아래
// 형제**로 둔다 — `uploads/legacy/bk21/<key>.pdf` (장 이미지는 `…/<key>/NNNN.webp`).
// 새 게시판(bk21Reports)의 글 본문이 이 PDF 첨부이고, 뷰어(pdf.js)가 Range 요청으로
// 필요한 쪽만 받아 간다. 그래서 R2 가 Range 를 받아 주는 것이 중요하다(기본 지원).
async function cmdUploadPdf() {
  const items = [];
  for (const doc of selectedDocs) {
    const path = join(PDF_DIR, pdfFileName(doc.key));
    if (!existsSync(path) || statSync(path).size === 0) {
      console.log(`  ⚠ ${doc.key}: ${path} 없음 — build-pdf.mjs 먼저 돌려라.`);
      continue;
    }
    items.push({
      doc,
      // 버전이 키에 들어간다(docs.mjs PDF_VERSION) — immutable 캐시라 같은 키 덮어쓰기 금지
      key: `${R2_PREFIX}/${pdfFileName(doc.key)}`,
      path,
      bytes: statSync(path).size,
      type: 'application/pdf',
    });
  }

  console.log(`── PDF 업로드 대상 (R2 키 접두사 ${R2_PREFIX}/) ──`);
  for (const it of items) console.log(`  ${it.doc.key}: ${it.key} · ${mb(it.bytes)}`);
  console.log(`  합계: ${items.length}개 · ${mb(items.reduce((s, i) => s + i.bytes, 0))}`);

  if (!APPLY) {
    console.log('\n  ※ 드라이런 — 아무것도 올리지 않았습니다. 실제 업로드는 --apply.');
    return;
  }
  if (items.length === 0) return;

  const { headExists, put: putObject } = await openR2();
  for (const it of items) {
    try {
      if (await headExists(it.key)) {
        // 같은 키에 다시 쓰지 않는다 — 내용을 바꿔 올리려면 R2 에서 지우고 다시 돌려라
        // (immutable 캐시라 덮어써도 기존 뷰어·CDN 이 옛 파일을 계속 볼 수 있다).
        console.log(`  = ${it.key} 이미 있음 (생략)`);
        continue;
      }
      await putObject(it.key, readFileSync(it.path), it.type);
      console.log(`  ↑ ${it.key} ${mb(it.bytes)}`);
    } catch (e) {
      console.log(`  ✗ ${it.key} ${e.message}`);
    }
  }
}

// ── seed ─────────────────────────────────────────────────────────
// 뷰어는 파일 URL 을 `${baseUrl}/${String(n).padStart(4,'0')}.webp` 로 조립한다.
// width/height 는 **파생본**의 대표 크기(최빈값)다. 그와 다른 장만 pageSizes 에 담고,
// 전 장이 같으면 null — 뷰어가 문서 하나의 비율로 전 장을 그려도 되는지 이 값으로 판단한다.
function cmdSeed() {
  const base = (process.env.R2_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  if (!base) console.log('  ⚠ R2_PUBLIC_BASE_URL 이 비어 있다 — baseUrl 이 상대 경로로 나간다.');
  const m = loadManifest();
  const byKey = new Map(m.docs.map((d) => [d.key, d]));

  const out = DOCS.map((doc) => {
    const e = byKey.get(doc.key);
    if (!e) return null;
    const derived = Array.isArray(e.derivedPages) ? e.derivedPages : [];
    if (derived.length === 0) console.log(`  ⚠ ${doc.key}: 파생 기록이 없다 — derive 먼저 돌려라.`);
    const width = e.derivedWidth ?? null;
    const height = e.derivedHeight ?? null;
    const odd = derived
      .filter((p) => p.w !== width || p.h !== height)
      .map((p) => ({ n: p.n, w: p.w, h: p.h }));
    const pages = derived.length || e.pages || 0;
    const baseUrl = `${base}/${R2_PREFIX}/${doc.key}`;
    return {
      key: doc.key,
      title: doc.title,
      year: doc.year,
      pages,
      width,
      height,
      pageSizes: odd.length ? odd : null,
      baseUrl,
      coverUrl: `${baseUrl}/cover.webp`,
      legacyPath: `bk21/${doc.sourcePath.split('/').pop().toLowerCase()}`,
      printedTotal: doc.printedTotal ?? pages,
      gaps: doc.gaps ?? [],
      note: doc.note ?? null,
    };
  }).filter(Boolean);

  writeFileSync(SEED_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`  ${SEED_PATH} 작성 — ${out.length}개 문서 · ${out.reduce((s, d) => s + d.pages, 0)}장`);
  for (const d of out) {
    const gap = d.gaps.length ? ` · 결락 ${d.gaps.map((g) => `${g.from}~${g.to}`).join(',')} (원본 ${d.printedTotal}쪽)` : '';
    const sizes = d.pageSizes ? ` · 다른 크기 ${d.pageSizes.length}장` : '';
    console.log(`    ${d.key} ${d.pages}장 ${d.width}×${d.height}${sizes}${gap}`);
  }
}

// ── 진입 ─────────────────────────────────────────────────────────
switch (CMD) {
  case 'fetch':
    await cmdFetch();
    break;
  case 'derive':
    await cmdDerive();
    break;
  case 'upload':
    await cmdUpload();
    break;
  case 'upload-pdf':
    await cmdUploadPdf();
    break;
  case 'seed':
    cmdSeed();
    break;
  default:
    console.log(
      '사용: node tools/bk21/mirror-scans.mjs <fetch|derive|upload|upload-pdf|seed>' +
        ' [--doc=<key>] [--max-width=1240] [--include-jpg] [--apply]',
    );
    process.exit(1);
}
