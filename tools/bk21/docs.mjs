// BK21 스캔 문서 6종의 **단일 정의**와 공용 헬퍼.
//
// 왜 따로 뺐나: 같은 6문서를 세 스크립트가 쓴다 —
//   mirror-scans.mjs (구 사이트에서 fetch/derive/upload/seed)
//   build-pdf.mjs    (raw JPG → 문서별 PDF 한 벌)
//   seed-reports.mjs (DB 게시판 bk21Reports 에 글 6건 적재)
// 키·제목·원문 주소가 세 군데로 흩어지면 반드시 어긋난다. 여기만 고친다.
//
// ⚠️ `key` 와 `postSlug` 는 **고정 식별자**다. 화면 리졸버가 슬러그를 하드코딩하고,
//    R2 키(`uploads/legacy/bk21/<key>/…`)도 key 로 굳어 있다. 바꾸면 링크가 전부 깨진다.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');

export const RAW_DIR = join(HERE, 'raw');
export const DERIVED_DIR = join(HERE, 'derived');
export const PDF_DIR = join(HERE, 'pdf');
export const MANIFEST_PATH = join(HERE, 'manifest.json');
export const SEED_PATH = join(HERE, 'bk21-reports.seed.json');

export const ORIGIN = 'https://me.yonsei.ac.kr';
export const R2_PREFIX = 'uploads/legacy/bk21';

/** .env.local 로더 (scripts/mirror-legacy-assets.mjs 와 동일한 규약). */
export function loadEnvLocal() {
  for (const p of ['.env.local', join(ROOT, '.env.local')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
    return;
  }
}

/**
 * 문서 정의.
 *
 * imgDir       그 디렉터리 **바로 아래**만 본다(plan 의 `/BK21/` 이 연도 하위를 삼키지 않게).
 * coverPage    표지로 쓸 장 번호(1부터). plan 의 1장은 거의 백지라 2장을 쓴다 (함정 7).
 * printedTotal 원본 인쇄본의 총 쪽수(마지막 장 푸터 실측). 결락이 없으면 받은 장수와 같다.
 * gaps         빠진 인쇄 쪽 구간 [{from,to}] — 없으면 [].
 * note         결락을 화면에 알릴 문구. 없으면 null.
 *
 * 아래 세 필드는 새 사이트 게시판(board='bk21Reports') 적재용이다 —
 * category     분류 탭. plan | self | performance
 * createdAt    글의 대표 날짜. **발간 실일자가 아니라 연도 표기용 대푯값**이다
 *              (목록이 created_at 으로 정렬·연도 표기를 하므로 연도만 맞으면 된다).
 * pdfLabel     첨부 파일 표시 이름(한/영). 실제 R2 키는 `<key>.pdf` 로 따로 간다.
 * postSlug     posts.slug 에 들어갈 **고정 식별자**. 리졸버가 이 값을 하드코딩한다.
 */
export const DOCS = [
  {
    key: 'plan',
    sourcePath: '/me/bk21/BK21_plan.do',
    imgDir: '/_res/me/img/BK21/',
    expected: 939,
    year: 2020,
    title: { ko: '사업계획서', en: 'Project Plan' },
    coverPage: 2,
    printedTotal: 957,
    gaps: [{ from: 307, to: 324 }],
    note: {
      ko: '구 홈페이지 원본에서 307~324쪽이 누락되어 있습니다.',
      en: 'Pages 307–324 are missing from the original upload.',
    },
    category: 'plan',
    createdAt: '2020-09-01',
    pdfLabel: { ko: 'BK21_사업계획서.pdf', en: 'BK21_Project_Plan.pdf' },
    postSlug: 'bk21rep-plan',
  },
  {
    key: 'report-2021',
    sourcePath: '/me/bk21/BK21_plan_2021.do',
    imgDir: '/_res/me/img/BK21/2021/',
    expected: 184,
    year: 2021,
    title: { ko: '2021 자체평가보고서', en: '2021 Self-Evaluation Report' },
    coverPage: 1,
    printedTotal: null, // = 받은 장수
    gaps: [],
    note: null,
    category: 'self',
    createdAt: '2021-12-31',
    pdfLabel: { ko: 'BK21_2021_자체평가보고서.pdf', en: 'BK21_2021_Self-Evaluation_Report.pdf' },
    postSlug: 'bk21rep-2021',
  },
  {
    key: 'report-2022',
    sourcePath: '/me/bk21/BK21_plan_2022.do',
    imgDir: '/_res/me/img/BK21/2022/',
    expected: 179,
    year: 2022,
    title: { ko: '2022 자체평가보고서', en: '2022 Self-Evaluation Report' },
    coverPage: 1,
    printedTotal: null,
    gaps: [],
    note: null,
    category: 'self',
    createdAt: '2022-12-31',
    pdfLabel: { ko: 'BK21_2022_자체평가보고서.pdf', en: 'BK21_2022_Self-Evaluation_Report.pdf' },
    postSlug: 'bk21rep-2022',
  },
  {
    key: 'report-2023',
    sourcePath: '/me/bk21/BK21_plan_2023.do',
    imgDir: '/_res/me/img/BK21/2023/',
    expected: 182,
    year: 2023,
    title: { ko: '2023 성과평가보고서', en: '2023 Performance Evaluation Report' },
    coverPage: 1,
    printedTotal: 511,
    gaps: [{ from: 184, to: 511 }],
    note: {
      ko: '구 홈페이지 원본이 183쪽까지만 업로드되어 있습니다.',
      en: 'Only the first 183 of 511 pages were uploaded to the original site.',
    },
    category: 'performance',
    createdAt: '2023-12-31',
    pdfLabel: { ko: 'BK21_2023_성과평가보고서.pdf', en: 'BK21_2023_Performance_Evaluation_Report.pdf' },
    postSlug: 'bk21rep-2023',
  },
  {
    key: 'report-2024',
    sourcePath: '/me/bk21/BK21_plan_2024.do',
    imgDir: '/_res/me/img/BK21/2024/',
    expected: 120,
    year: 2024,
    title: { ko: '2024 자체평가보고서', en: '2024 Self-Evaluation Report' },
    coverPage: 1,
    printedTotal: null,
    gaps: [],
    note: null,
    category: 'self',
    createdAt: '2024-12-31',
    pdfLabel: { ko: 'BK21_2024_자체평가보고서.pdf', en: 'BK21_2024_Self-Evaluation_Report.pdf' },
    postSlug: 'bk21rep-2024',
  },
  {
    key: 'report-2025',
    sourcePath: '/me/bk21/BK21_plan_2025.do',
    imgDir: '/_res/me/img/BK21/2025/',
    expected: 129,
    year: 2025,
    // 원본 파일명이 "블라인드" 판본이다 — mirror-scans.mjs 함정 4 참고.
    title: { ko: '2025 자체평가보고서', en: '2025 Self-Evaluation Report' },
    coverPage: 1,
    printedTotal: null,
    gaps: [],
    note: null,
    category: 'self',
    createdAt: '2025-12-31',
    pdfLabel: { ko: 'BK21_2025_자체평가보고서.pdf', en: 'BK21_2025_Self-Evaluation_Report.pdf' },
    postSlug: 'bk21rep-2025',
  },
];

/** `--doc=<key>` 필터. 알 수 없는 키면 즉시 죽는다(조용히 0건 처리하지 않기 위해). */
export function selectDocs(filter) {
  if (!filter) return DOCS;
  const hit = DOCS.filter((d) => d.key === filter);
  if (hit.length === 0) {
    console.error(`알 수 없는 --doc=${filter} (가능: ${DOCS.map((d) => d.key).join(', ')})`);
    process.exit(1);
  }
  return hit;
}

// ── manifest.json ────────────────────────────────────────────────
export function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) return { updatedAt: null, docs: [] };
  try {
    const j = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    return { updatedAt: j.updatedAt ?? null, docs: Array.isArray(j.docs) ? j.docs : [] };
  } catch {
    return { updatedAt: null, docs: [] };
  }
}

/** DOCS 선언 순서를 유지하며 한 문서 항목만 갈아끼운다 */
export function saveManifestEntry(entry) {
  const m = loadManifest();
  const byKey = new Map(m.docs.map((d) => [d.key, d]));
  byKey.set(entry.key, { ...(byKey.get(entry.key) ?? {}), ...entry });
  const ordered = DOCS.map((d) => byKey.get(d.key)).filter(Boolean);
  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), docs: ordered }, null, 2)}\n`,
    'utf8',
  );
}

// ── 표시 헬퍼 ────────────────────────────────────────────────────
export const pad4 = (n) => String(n).padStart(4, '0');
export const mb = (b) => `${(b / 1048576).toFixed(1)}MB`;
