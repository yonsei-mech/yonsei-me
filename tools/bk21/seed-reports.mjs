// BK21 보고서 게시판(board='bk21Reports') 글 6건 적재 — 문서 1개 = 글 1건.
//
//   node tools/bk21/seed-reports.mjs           # 드라이런(기본) — 들어갈 행만 표로 출력
//   node tools/bk21/seed-reports.mjs --apply   # 실제 DB 쓰기
//   node tools/bk21/seed-reports.mjs --doc=plan
//
// ⚠️ **식별자는 고정이다 — 화면 리졸버가 하드코딩한다.**
//    `bk21rep-plan` · `bk21rep-2021` · `bk21rep-2022` · `bk21rep-2023` ·
//    `bk21rep-2024` · `bk21rep-2025` (docs.mjs 의 `postSlug`). 바꾸면 링크가 전부 깨진다.
//
// ⚠️ **그 고정 식별자는 `posts.id` 가 아니라 `posts.slug` 에 들어간다.**
//    scripts/sql/schema.sql 에서 `posts.id` 는 `bigint generated always as identity` 라
//    문자열을 넣을 수 없다. 텍스트 고정키를 받는 컬럼은 `slug text unique` 하나뿐이고,
//    그래서 이 스크립트의 멱등 키도 slug 다(`select … where slug = …` → update/insert).
//    같은 이유로 `attachments.id` 도 bigint identity 라 `bk21rep-<key>-pdf` 같은 고정
//    id 를 줄 수 없다 — 첨부는 글 단위로 **통째 교체**한다(delete by post_id → insert),
//    scripts/import-boards.mjs 의 재크롤 갱신과 같은 방식이다.
//
// 본문 설계: 글 본문(body_html)은 **비워 둔다**. 화면은 첫 PDF 첨부를 펼침 리더로 그리므로
// 본문 HTML 이 곧 문서가 아니다. 결락 안내만 excerpt 로 싣는다(plan·2023 두 건).
//
// 실행 순서 (이 스크립트는 마지막)
//   node tools/bk21/build-pdf.mjs
//   node tools/bk21/mirror-scans.mjs upload-pdf --apply
//   node tools/bk21/seed-reports.mjs --apply
//
// 함정
//  - `posts.source_url` 에는 **부분 유니크 인덱스**가 걸려 있다. 구 게시판 임포터가 같은
//    `.do` 주소를 이미 가져갔다면 insert 가 충돌한다 — 드라이런이 미리 조회해서 알려 준다.
//  - `attachments` 의 크기 컬럼 이름은 `size` 가 아니라 **`size_bytes`** 다.
//  - created_at 은 **발간 실일자가 아니라 연도 표기용 대푯값**이다(목록 정렬·연도 표기용).
//    사업계획서는 4단계 BK21 선정 연도에 맞춘 2020-09-01, 보고서는 `<연도>-12-31`.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { DOCS, ORIGIN, PDF_DIR, R2_PREFIX, loadEnvLocal, selectDocs, mb } from './docs.mjs';

loadEnvLocal();

const ARGV = process.argv.slice(2);
const APPLY = ARGV.includes('--apply');
const argVal = (name) => {
  const a = ARGV.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const selectedDocs = selectDocs(argVal('doc'));

const BOARD = 'bk21Reports';
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');

for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[name]) {
    console.error(`${name} 환경변수가 없습니다 (.env.local).`);
    process.exit(1);
  }
}
if (!PUBLIC_BASE) {
  console.error('R2_PUBLIC_BASE_URL 이 비어 있습니다 — 첨부 URL 을 만들 수 없습니다 (.env.local).');
  process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** 한 문서 → posts 행 + attachments 행 하나. */
function buildRow(doc) {
  const pdfPath = join(PDF_DIR, `${doc.key}.pdf`);
  const hasPdf = existsSync(pdfPath) && statSync(pdfPath).size > 0;
  const post = {
    board: BOARD,
    slug: doc.postSlug, // ← 고정 식별자 (리졸버 하드코딩)
    title_ko: doc.title.ko,
    title_en: doc.title.en,
    // 본문은 첨부 PDF 가 대신한다 — body_html_ko 는 not null 이라 빈 문자열,
    // body_html_en 은 nullable 이라 null(영문 본문이 "있다"고 주장하지 않기 위해).
    body_html_ko: '',
    body_html_en: null,
    excerpt_ko: doc.note?.ko ?? null,
    excerpt_en: doc.note?.en ?? null,
    category: doc.category,
    thumbnail_url: `${PUBLIC_BASE}/${R2_PREFIX}/${doc.key}/cover.webp`,
    source_url: ORIGIN + doc.sourcePath, // 원본 대소문자 그대로 (BK21_plan.do …)
    created_at: `${doc.createdAt}T00:00:00+09:00`,
    pinned: false,
    is_event: false,
    published: true,
    import_managed: false, // 임포터가 만든 행이 아니다 — 재크롤 갱신 대상에서 제외
  };
  const attachment = {
    url: `${PUBLIC_BASE}/${R2_PREFIX}/${doc.key}.pdf`,
    label_ko: doc.pdfLabel.ko,
    label_en: doc.pdfLabel.en,
    sort: 0,
    size_bytes: hasPdf ? statSync(pdfPath).size : null,
  };
  return { doc, post, attachment, hasPdf, pdfPath };
}

const rows = selectedDocs.map(buildRow);

// ── 기존 행 조회 (드라이런도 여기까지는 읽는다) ──────────────────
const slugs = rows.map((r) => r.post.slug);
const sourceUrls = rows.map((r) => r.post.source_url);

const bySlug = await sb.from('posts').select('id, slug, board, title_ko, created_at').in('slug', slugs);
if (bySlug.error) {
  console.error(`posts 조회 실패: ${bySlug.error.message}`);
  process.exit(1);
}
const bySource = await sb.from('posts').select('id, slug, board, source_url').in('source_url', sourceUrls);
if (bySource.error) {
  console.error(`posts(source_url) 조회 실패: ${bySource.error.message}`);
  process.exit(1);
}
const slugHit = new Map((bySlug.data ?? []).map((r) => [r.slug, r]));
const sourceHit = new Map((bySource.data ?? []).map((r) => [r.source_url, r]));

// ── 출력 ─────────────────────────────────────────────────────────
console.log(`── board='${BOARD}' 적재 대상 ${rows.length}건 ${APPLY ? '(실제 쓰기)' : '(드라이런)'} ──`);
console.log('  slug             분류        제목                     날짜        첨부(PDF)          상태');
const problems = [];
for (const r of rows) {
  const hit = slugHit.get(r.post.slug);
  const src = sourceHit.get(r.post.source_url);
  // slug 가 아닌 다른 행이 같은 source_url 을 쥐고 있으면 insert 가 유니크 제약에 걸린다.
  if (src && (!hit || src.id !== hit.id)) {
    problems.push(`${r.post.slug}: source_url 을 이미 다른 글(id=${src.id}, board=${src.board})이 쓰고 있다 — 충돌`);
  }
  if (hit && hit.board !== BOARD) {
    problems.push(`${r.post.slug}: 같은 slug 를 다른 게시판(${hit.board}, id=${hit.id})이 쓰고 있다 — 충돌`);
  }
  if (!r.hasPdf) problems.push(`${r.post.slug}: 로컬 PDF 없음 (${r.pdfPath}) — build-pdf.mjs 먼저`);

  const state = hit ? `갱신 (id=${hit.id})` : '신규';
  console.log(
    `  ${r.post.slug.padEnd(16)} ${r.post.category.padEnd(11)} ${r.post.title_ko.padEnd(22)} ` +
      `${r.post.created_at.slice(0, 10)}  ${(r.attachment.size_bytes ? mb(r.attachment.size_bytes) : '없음').padStart(8)}  ${state}`,
  );
}
console.log('\n  첨부 URL · 썸네일');
for (const r of rows) {
  console.log(`  ${r.post.slug}`);
  console.log(`     pdf   ${r.attachment.url}`);
  console.log(`     cover ${r.post.thumbnail_url}`);
  if (r.post.excerpt_ko) console.log(`     안내  ${r.post.excerpt_ko}`);
}

if (problems.length > 0) {
  console.log('\n  ⚠ 확인 필요');
  for (const p of problems) console.log(`     ✗ ${p}`);
}

if (!APPLY) {
  console.log('\n  ※ 드라이런 — DB 를 읽기만 했습니다. 실제 쓰기는 --apply.');
  process.exit(problems.length > 0 ? 1 : 0);
}
if (problems.length > 0) {
  console.error('\n  위 문제를 먼저 해결하라 — 아무것도 쓰지 않았다.');
  process.exit(1);
}

// ── 쓰기 ─────────────────────────────────────────────────────────
for (const r of rows) {
  const hit = slugHit.get(r.post.slug);
  let postId;
  if (hit) {
    // 갱신: slug·board 는 그대로 두고 나머지를 원본 정의대로 되돌린다.
    const { slug, ...patch } = r.post;
    const up = await sb.from('posts').update(patch).eq('id', hit.id);
    if (up.error) {
      console.error(`update 실패 ${slug}: ${up.error.message}`);
      process.exit(1);
    }
    postId = hit.id;
  } else {
    const ins = await sb.from('posts').insert(r.post).select('id').single();
    if (ins.error) {
      console.error(`insert 실패 ${r.post.slug}: ${ins.error.message}`);
      process.exit(1);
    }
    postId = ins.data.id;
  }

  // 첨부는 통째 교체 — 고정 id 를 줄 수 없으므로(위 경고) 이게 유일한 멱등 경로다.
  const del = await sb.from('attachments').delete().eq('post_id', postId);
  if (del.error) {
    console.error(`첨부 삭제 실패 ${r.post.slug}: ${del.error.message}`);
    process.exit(1);
  }
  const att = await sb.from('attachments').insert({ ...r.attachment, post_id: postId });
  if (att.error) {
    console.error(`첨부 insert 실패 ${r.post.slug}: ${att.error.message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${r.post.slug} (posts.id=${postId}) · 첨부 1건`);
}
console.log(`\n  완료 — ${rows.length}건. 화면 반영은 게시판 캐시 태그 무효화 이후.`);
