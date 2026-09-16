// 현행 학과 사이트(me.yonsei.ac.kr) 크롤 스냅샷 → Supabase 적재 스크립트.
//
// 실행: node scripts/import-boards.mjs [--board=<key>] [--limit=N] [--apply] [--report]
//   기본은 드라이런(아무것도 쓰지 않는다). 실제 적재는 --apply 를 붙였을 때만.
//   --input=<파일|디렉터리> 또는 BOARDS_RAW_DIR 로 입력 경로를 바꿀 수 있다(픽스처 검증용).
//   --no-db 는 DB 를 아예 건드리지 않고 정규화 결과만 본다(오프라인 눈검사용).
//   --skip-data-images 는 본문 내 base64 이미지 추출·업로드를 통째로 끈다.
//
// 입력: tools/boards-raw/<boardKey>.json — tools/crawl-boards.mjs 의 산출물.
//   { board, sourcePath, crawledAt, posts: [{ articleNo, sourceUrl, date, title,
//     author, pinned, bodyHtml, thumbnail, excerpt, attachments[], fetchedAt }] }
//   ⚠ 크롤러는 별도 스크립트다. 여기서는 그 "JSON 출력"만 읽는다(모듈 import 없음).
//
// 이 스크립트가 풀어야 하는 문제 셋:
//  1) 원문 HTML 이 지니웍스 CMS + Froala 산출물이라 돋움/13px/Malgun Gothic 같은
//     인라인 서체가 전부 박혀 있다. 그대로 넣으면 우리 타이포그래피를 매 글마다
//     덮어쓴다 → normalizeBody 가 서체·크기·기본 흑백을 걷어낸다.
//  2) 이미지·첨부 링크가 루트 상대(/_res/…) 또는 쿼리 전용(?mode=download&…)이다.
//     우리는 자산을 미러링하지 않으므로, 절대화를 한 번이라도 놓치면 영구히 깨진
//     이미지가 된다 → 원문 주소(sourceUrl)를 기준으로 URL 해석한다.
//  2-1) 일부 글은 이미지를 파일로 올리지 않고 base64 data: URI 로 본문에 박아 놨다
//     (담당자가 Froala 에 스크린샷을 그대로 붙여넣은 것). 이건 2)의 "미러링 안 함"
//     결정과 충돌하지 않는다 — 저 이미지들에는 애초에 가리킬 원본 URL 이 없고,
//     HTML 안의 base64 가 유일한 실체다. 그대로 두면 SANITIZE_OPTS.allowedSchemes
//     에 data: 가 없어 src 만 뜯긴 빈 <img> 가 남는다(= 이미지 영구 소실).
//     그렇다고 base64 를 그대로 저장하면 body_html_ko 가 부풀어 목록 쿼리 캐시를
//     통째로 먹는다. → 정규화 **전에** 뽑아 R2 로 올리고 src 를 공개 URL 로 바꾼다.
//     키가 내용 해시(uploads/imported/<board>/<sha16>.<ext>)라 재실행해도 같은
//     그림은 같은 키가 되고, HeadObject 로 이미 있으면 업로드를 건너뛴다.
//  3) 재크롤이 중복 적재가 되면 안 된다 → source_url 이 멱등 키다.
//     기존 행은 title_ko/body_html_ko/pinned/created_at 과 첨부만 갱신하고,
//     손으로 채운 영문·발췌·썸네일은 절대 null 로 덮지 않는다(손번역 7건 보호).
//
// 소유권 3상태 — "중복 적재 금지"와 "갱신 허용"은 다른 문제다. source_url 만으로는
// 둘을 구분할 수 없어서 import_managed 로 소유자를 표시한다:
//
//   import_managed | source_url | 뜻                        | 이 스크립트의 행동
//   ---------------+------------+---------------------------+--------------------------
//   true           | 있음       | 이 스크립트가 만든 글      | insert / update / 첨부 교체
//   false          | 있음       | 손으로 만든 글 + 원문 연결 | **전부 건너뜀** (한 칼럼도 안 씀)
//   false          | null       | 손으로 만든 무관한 글      | 매칭 자체가 안 됨
//
// 두 번째 줄이 핵심이다. 손으로 옮긴 53건 중 뉴스 7건은 본문이 원문 복사가 아니라
// 다듬어 다시 쓴 글이다. 원문(가공 전 Froala)으로 덮으면 그냥 품질 하락이다.
// 그 글들에 source_url 을 채운 목적(구 link-existing-posts.mjs — 완료 후 삭제, git
// 이력에 있음)은 "중복 적재를 막는 것"이지 "갱신 대상으로 삼는 것"이 아니다
// — 그래서 import_managed=false 인
// 행을 만나면 created_at 하나도 건드리지 않고 건너뛰고, 그 수를 건너뜀(수동)으로
// 따로 보고한다(손 작업이 살아남았다는 증거).
//
// 롤백: `delete from posts where import_managed;`
//   이 스크립트가 넣은 행에만 true 가 붙고(insert 시 명시), 손으로 만든 행은
//   칼럼 기본값 false 이며 여기서 true 로 바꾸는 경로가 없다. 따라서 저 한 줄이
//   수동 작성분을 건드리는 것은 구조적으로 불가능하다.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sanitizeHtml from 'sanitize-html';

// ── .env.local 로더 (scripts/migrate-content.mjs 와 동일 방식) ──
// cwd 가 yonsei-me 인 것이 정상이지만, 스크립트 위치 기준 경로도 한 번 더 본다.
{
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of ['.env.local', join(here, '..', '.env.local')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
    break;
  }
}

// ── CLI ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const APPLY = flag('apply');
const REPORT = flag('report');
const NO_DB = flag('no-db');
// 본문 내 base64 이미지를 R2 로 빼내지 않는다(그 이미지는 정화 단계에서 사라진다).
const SKIP_DATA_IMAGES = flag('skip-data-images');
const ONLY_BOARD = opt('board');
const LIMIT = opt('limit') ? Number(opt('limit')) : null;
const INPUT = opt('input') ?? process.env.BOARDS_RAW_DIR ?? 'tools/boards-raw';

if (LIMIT !== null && (!Number.isInteger(LIMIT) || LIMIT <= 0)) {
  console.error('--limit 은 양의 정수여야 합니다.');
  process.exit(1);
}

// 크롤 스냅샷 키 — tools/board-source.mjs 의 BOARDS 표와 같은 집합이다.
// ⚠ 대부분은 posts.board 값과 같지만 **전부 그런 것은 아니다**: bk21Files·bk21Results 는
//   구 사이트의 두 게시판이고 새 사이트에서는 한 게시판(bk21Resources)이다 —
//   저장 값 변환은 아래 BOARD_IMPORT_RULES 가 한다.
const BOARD_KEYS = [
  'noticesUndergrad', 'noticesGraduate', 'noticesExternal', 'noticesScholarship',
  'news', 'thesis', 'resources', 'career', 'events', 'seminars',
  'bk21Files', 'bk21Results',
];
// --board 는 쉼표로 여러 개를 줄 수 있다(크롤러 --board 와 같은 문법).
const ONLY_BOARDS = ONLY_BOARD ? ONLY_BOARD.split(',').map((s) => s.trim()).filter(Boolean) : [];
for (const b of ONLY_BOARDS) {
  if (BOARD_KEYS.includes(b)) continue;
  console.error(`--board 값이 올바르지 않습니다: ${b}\n  가능한 값: ${BOARD_KEYS.join(', ')}`);
  process.exit(1);
}

/**
 * 구 사이트 게시판 키 → 새 사이트 저장 규칙. 여기 없는 게시판은 key 가 곧 posts.board 이고
 * 분류는 기존 규칙(뉴스만 'general')을 따른다.
 *
 * ⚠ tools/board-source.mjs 의 BOARDS 표를 손으로 복제한 것이다 — 이 스크립트는 크롤러
 *   모듈을 import 하지 않는다(머리말 참조). 저쪽 표를 고치면 여기도 고쳐야 한다.
 */
const BOARD_IMPORT_RULES = {
  // BK21 자료실(files.do) — 규정·지침이 대부분, 서식 글 하나만 예외
  bk21Files: {
    dbBoard: 'bk21Resources',
    defaultCategory: 'rule',
    categoryByArticleNo: { '114095': 'form' },
  },
  // BK21 사업성과(progress.do) — 전부 '사업성과' 분류
  bk21Results: { dbBoard: 'bk21Resources', defaultCategory: 'result' },
};

const SITE_ORIGIN = 'https://me.yonsei.ac.kr';
// 제목에서 일정을 뽑는 게시판 — 그 외는 event_date/end_date/date_label 을 건드리지 않는다.
const SCHEDULE_BOARDS = new Set(['events', 'seminars']);

// ── 정화 정책 ──────────────────────────────────────────────────────────
/** ⚠ src/lib/admin/sanitize.ts 의 SANITIZE_OPTS 와 **내용상 동일**해야 한다
 *  (TS 타입 표기만 뺀 사본 — 여기는 .mjs 라 TS 모듈을 import 할 수 없다).
 *  한쪽을 고치면 반드시 양쪽. 사본이 뒤처지면 정본이 허용하는 표 속성
 *  (data-border 계열·colgroup)이 여기서만 떨어져 임포트한 표가 통째로 깨진다.
 *  이 허용목록에 없는 것 — font, class, id, img 아닌 태그의 자유 style 등 — 은
 *  전부 떨어진다. normalizeBody 는 "이걸 통과할 모양"으로 미리 다듬는 전처리기다. */

// ── 값 패턴 ────────────────────────────────────────────────────────────
// 구 사이트에 흔한 "아래아한글·워드에서 디자인해 붙여넣은 공지"(색 배경 제목 바,
// 번호 칩 표)를 살리려면 배경·테두리·여백까지 열어야 한다. 태그를 더 여는 대신
// **값 패턴이 보안 경계**다 — 아래 어떤 패턴도 url(·expression(·세미콜론·역슬래시를
// 통과시키지 않는다. sanitize-html 이 style 을 선언 단위로 파싱하므로(postcss)
// 속성별 정규식만 조여 두면 선언 사이로 새는 경로가 없다.

/** 순수 색상값만 — 이름색·rgba·함수 표기는 통과하지 않는다 */
const COLOR = [
  /^#[0-9a-fA-F]{3,8}$/,
  /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/,
];

/** 테두리 축약형 — 굵기·선 스타일·색 토큰이 **임의 순서로** 1~3개.
 *  HWP 는 CSS 표준 순서가 아니라 `solid #203a7b 0.28pt` 로 낸다(실측). */
const BORDER = [
  /^(?=.{1,64}$)(?:(?:solid|dashed|dotted|double|none|hidden|[\d.]{1,6}(?:px|pt)|#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))\s*){1,3}$/,
];

/** 여백 축약형 — 1~4값. pt 는 HWP 원문의 종이 좌표계라 값이 크게 나올 수 있다 */
const PADDING = [
  /^(?:[\d.]{1,6}(?:px|pt|em|%)|0)(?:\s+(?:[\d.]{1,6}(?:px|pt|em|%)|0)){0,3}$/,
];

/** 길이 한 값 — 셀 폭·높이 */
const LENGTH = [/^[\d.]{1,6}(px|pt|%)$/];

/** 셀(th/td)에 허용하는 디자인 스타일 — 값은 전부 위 패턴으로 조인다 */
const CELL_STYLES = {
  border: BORDER,
  'border-top': BORDER,
  'border-right': BORDER,
  'border-bottom': BORDER,
  'border-left': BORDER,
  padding: PADDING,
  'vertical-align': [/^(top|middle|bottom)$/],
  width: LENGTH,
  height: LENGTH,
};

/** 문단·제목에 허용하는 디자인 스타일 — 색 배경 제목 바가 이 둘로 이뤄진다 */
const BLOCK_STYLES = { background: COLOR, padding: PADDING };

const SANITIZE_OPTS = {
  allowedTags: [
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'sup', 'sub',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
    'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col', 'span',
    // 유튜브 임베드 — Tiptap Youtube 확장이 div[data-youtube-video] > iframe 로 낸다
    'iframe', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    // style 은 아래 allowedStyles 의 img.width(백분율)만 통과 — 픽셀·자유 CSS 는 떨어진다
    img: ['src', 'alt', 'title', 'width', 'height', 'style', 'data-align'],
    // 행 높이 드래그 결과(px) — tr 의 height 는 브라우저가 "최소 높이"로 다룬다
    tr: ['style'],
    // data-colwidth: 열 드래그 결과(px) — 재편집 시 Tiptap 이 여기서 폭을 되읽는다.
    // valign: HWP/워드 산출물의 세로 정렬(열거값이라 style 없이도 안전하다)
    th: ['colspan', 'rowspan', 'align', 'valign', 'style', 'data-colwidth'],
    td: ['colspan', 'rowspan', 'align', 'valign', 'style', 'data-colwidth'],
    // 표 테두리는 style 이 아니라 data 속성 "열거형"이다 — 값 집합이 CSS 한 곳
    // (globals.css)에 갇혀 있어 정화 화이트리스트를 넓히지 않고도 안전하다.
    // style 은 아래 table 패턴(width/min-width px + border-collapse)만 — 앞의 둘은
    // 열 드래그 직렬화용, border-collapse 는 붙여넣은 구형 표의 무해한 잔재다.
    table: ['data-border', 'data-border-color', 'data-cellpad', 'style'],
    // colgroup/col: 게시 화면이 열 폭을 재현하는 통로 (col 은 width px 만)
    col: ['style'],
    // 형광펜(Highlight) — 배경색 인라인 + 무손실 왕복용 data-color
    mark: ['style', 'data-color'],
    // Tiptap 글자색(span style="color:…") + 정렬(p/h* style="text-align:…") 허용
    span: ['style'],
    p: ['style'],
    h1: ['style'], h2: ['style'], h3: ['style'], h4: ['style'], h5: ['style'],
    div: ['data-youtube-video'],
    iframe: ['src', 'width', 'height', 'allowfullscreen', 'allow', 'frameborder', 'start'],
  },
  // style 은 아래 속성·값 패턴만 통과 — 그 외 스타일은 제거된다.
  // (태그별 규칙은 '*' 와 합쳐진다 — img 는 '*' 것에 width 가 더해진 집합)
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(/],
      'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(/],
      // background 는 축약형이지만 **순수 색상값만** 통과한다 — HWP 는 셀 배경을
      // background-color 가 아니라 이 축약형으로 낸다(실측 `background:#466991;`).
      background: COLOR,
      'text-align': [/^(left|right|center|justify)$/],
    },
    // 이미지 폭은 백분율만 — px 를 허용하면 모바일에서 본문을 뚫고 나간다
    img: { width: [/^\d{1,3}%$/] },
    // 에디터의 글꼴·크기·줄 간격(Tiptap textStyle) — 전부 span 인라인 style 로 나온다.
    // 글꼴·크기 범위는 구형 CMS(Froala) 파리티(2026-08-18 결정): 이름 폰트 12종을
    // 열어야 해서 자유 문자열이지만, 문자클래스를 조여 CSS 주입(세미콜론·괄호·
    // 역슬래시·url() 등)이 불가능하게 한다 — 값은 폰트명·따옴표·쉼표·공백만.
    span: {
      // pt 는 HWP 원문 파리티(구형 공지가 글자 크기를 pt 로 낸다) — px 는 구형 목록 범위
      'font-size': [/^([1-4][0-9]|50)px$/, /^[\d.]{1,5}pt$/],
      'font-family': [/^[A-Za-z0-9가-힣'" ,._-]{1,80}$/],
      'line-height': [/^(1(\.\d)?|2(\.0)?|2)$/],
    },
    // 셀 디자인(배경은 '*' 의 background/background-color 가 받는다)
    th: CELL_STYLES,
    td: CELL_STYLES,
    // 색 배경 제목 바 — 문단·제목 자체에 배경과 여백이 걸린 꼴
    p: BLOCK_STYLES,
    h1: BLOCK_STYLES, h2: BLOCK_STYLES, h3: BLOCK_STYLES, h4: BLOCK_STYLES, h5: BLOCK_STYLES,
    // 열 드래그 직렬화 — px 폭만. 표가 본문보다 넓어지는 건 게시 화면의
    // overflow-x-auto(가로 스크롤)가 받아낸다(모바일 트레이드오프 합의됨).
    col: { width: [/^\d+px$/], 'min-width': [/^\d+px$/] },
    // table-layout 은 열지 않는다 — fixed 가 우리 자동 레이아웃 결정과 충돌한다.
    table: { width: [/^\d+px$/], 'min-width': [/^\d+px$/], 'border-collapse': [/^(collapse|separate)$/] },
    // 행 드래그 직렬화 — px 높이만(최소 높이 시맨틱이라 내용이 길면 알아서 더 늘어난다)
    tr: { height: [/^\d+px$/] },
  },
  allowedSchemes: ['https', 'http', 'mailto'],
  // 임베드 허용 호스트 — 유튜브(+쿠키 없는 도메인)뿐
  allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com'],
  // 외부 링크는 새 탭 + noopener 로 강제(에디터 산출물 신뢰하지 않음)
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: /^https?:\/\//.test(attribs.href ?? '')
        ? { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
        : attribs,
    }),
  },
};

// 위 allowedAttributes 의 사본(태그별 허용 속성). normalizeBody 가 "정화 후에도
// 살아남을 속성"을 미리 알아야 <span> 을 벗길지 말지 정확히 판단할 수 있다.
const ALLOWED_ATTRS = SANITIZE_OPTS.allowedAttributes;

// ── src/lib/calendar.ts 이식분 ─────────────────────────────────────────
// 원본: src/lib/calendar.ts (daysFromCivil/civilFromDays/formatPeriodLabel).
// ⚠ 날짜 라벨을 손으로 만들지 않는다 — CMS 가 만드는 라벨과 한 글자도 다르면
//   같은 게시판 안에서 "7/20~7/24" 와 "7/20 ~ 7/24" 가 섞인다.
//   Date 객체·타임존을 일절 쓰지 않는 순수 정수 산술인 점도 그대로 옮겼다.
const pad2 = (n) => String(n).padStart(2, '0');
const toIso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function daysInMonth(y, m) {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 30;
}

function isValidYmd(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > daysInMonth(y, m)) return false;
  return true;
}

function daysFromCivil(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + (d - 1);
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z) {
  const zz = z + 719468;
  const era = Math.floor((zz >= 0 ? zz : zz - 146096) / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: m <= 2 ? y + 1 : y, m, d };
}

function isoToDays(iso) {
  const parts = String(iso ?? '').split('-');
  if (parts.length !== 3) return NaN;
  const [y, m, d] = parts.map(Number);
  if (!isValidYmd(y, m, d)) return NaN;
  return daysFromCivil(y, m, d);
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KO_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 원본: src/lib/calendar.ts formatPeriodLabel — 하루/기간 라벨 { ko, en } 생성 */
function formatPeriodLabel(start, end) {
  const startOrd = isoToDays(start);
  if (Number.isNaN(startOrd)) return { ko: '', en: '' };
  const s = civilFromDays(startOrd);

  const endOrd = end ? isoToDays(end) : NaN;
  const isRange = !Number.isNaN(endOrd) && endOrd > startOrd;

  if (!isRange) {
    const dow = (((startOrd + 4) % 7) + 7) % 7;
    return { ko: `${s.m}/${s.d}(${KO_WEEKDAYS[dow]})`, en: `${EN_MONTHS[s.m - 1]} ${s.d}` };
  }

  const e = civilFromDays(endOrd);
  const ko = `${s.m}/${s.d}~${e.m}/${e.d}`;
  const sameMonth = s.m === e.m && s.y === e.y;
  const en = sameMonth
    ? `${EN_MONTHS[s.m - 1]} ${s.d} – ${e.d}`
    : `${EN_MONTHS[s.m - 1]} ${s.d} – ${EN_MONTHS[e.m - 1]} ${e.d}`;
  return { ko, en };
}

// ── HTML 토크나이저 ────────────────────────────────────────────────────
// 정규식만으로 <span> 벗기기를 하면 짝이 되는 </span> 을 찾을 수 없다. 그래서
// 아주 작은 토크나이저 + 스택으로 처리한다(Froala 산출물 수준이면 충분하다).
// 안전성은 마지막 sanitizeHtml 이 책임지므로, 여기선 "모양 다듬기"만 하면 된다.
const TAG_RE =
  /<!--[\s\S]*?-->|<\/?[A-Za-z][^\s/>]*(?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/g;
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'area', 'base', 'embed', 'source', 'wbr']);
// div 가 "블록을 담는 껍데기"인지 판정할 때 쓰는 블록 태그 집합
const BLOCK_TAGS = new Set(['div', 'p', 'table', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'figure', 'hr', 'pre']);

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/** 속성값의 엔티티를 실제 문자로 되돌린다. URL 을 new URL() 로 해석하려면 필수 —
 *  `?mode=download&amp;attachNo=1` 을 그대로 넘기면 `&amp;` 가 쿼리 키가 돼 버린다. */
function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    const hit = NAMED_ENTITIES[body.toLowerCase()];
    return hit === undefined ? whole : hit;
  });
}

const escapeAttr = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseTag(raw) {
  const closing = raw[1] === '/';
  const nameM = raw.match(/^<\/?([A-Za-z][^\s/>]*)/);
  const name = nameM ? nameM[1].toLowerCase() : '';
  const attrs = {};
  if (!closing && nameM) {
    const body = raw.slice(nameM[0].length).replace(/\/?>$/, '');
    const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = ATTR_RE.exec(body)) !== null) {
      attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    }
  }
  // raw 를 함께 들고 다닌다 — 표 재생성(wrapLoose)은 토큰을 그대로 되찍어야 해서
  // 속성을 재직렬화하지 않고 원문 조각을 쓴다.
  return { type: 'tag', name, closing, attrs, selfClosed: /\/>$/.test(raw), raw };
}

function tokenize(html) {
  const out = [];
  let last = 0;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(html)) !== null) {
    if (m.index > last) out.push({ type: 'text', raw: html.slice(last, m.index) });
    if (!m[0].startsWith('<!--')) out.push(parseTag(m[0])); // 주석은 버린다
    last = m.index + m[0].length;
  }
  if (last < html.length) out.push({ type: 'text', raw: html.slice(last) });
  return out;
}

// ── style 필터 ────────────────────────────────────────────────────────
const NAMED_COLORS = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], blue: [0, 0, 255],
  green: [0, 128, 0], navy: [0, 0, 128], gray: [128, 128, 128], grey: [128, 128, 128],
};

/** 색 문자열 → {r,g,b}. 못 읽으면 null(= 버린다). transparent 도 null.
 *  결과를 다시 `rgb(r, g, b)` 로 찍어 내보내는 이유: SANITIZE_OPTS 가 통과시키는
 *  값 패턴이 `#hex` 와 `rgb(` 뿐이라, 이름색·rgba 는 어차피 정화에서 떨어진다. */
function parseColor(value) {
  const s = String(value).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16) };
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  m = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([0-9.]+))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined && Number(m[4]) < 0.1) return null; // 사실상 투명
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (r > 255 || g > 255 || b > 255) return null;
    return { r, g, b };
  }
  const named = NAMED_COLORS[s];
  return named ? { r: named[0], g: named[1], b: named[2] } : null;
}

// 원문 사이트의 기본 글자색(#333·검정)·기본 배경(흰색)은 버린다 — 지정 색이 아니라
// 그냥 "그 사이트의 기본값"이고, 남겨 두면 다크 모드에서 검정 글씨/흰 배경이 박힌다.
// 반면 유채색(예: 강조용 rgb(209,72,65))은 작성자의 의도이므로 살린다.
const isDefaultText = (c) => c.r === c.g && c.g === c.b && c.r <= 51;
const isDefaultBg = (c) => c.r === c.g && c.g === c.b && c.r >= 238;

// 정화가 태그별로만 통과시키는 디자인 스타일 — 여기서도 같은 태그에서만 살린다.
// (정화가 어차피 떨어뜨릴 선언을 남기면 "살아남은 속성이 없는 span 은 벗긴다"는
//  normalizeBody 의 판단만 흐려져 빈 <span> 껍데기가 늘어난다)
const CELL_TAGS = new Set(['td', 'th']);
const PADDING_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'td', 'th']);
const BORDER_PROPS = new Set(['border', 'border-top', 'border-right', 'border-bottom', 'border-left']);
/** pt 는 원문의 종이 좌표계다 — 폭·여백을 그대로 옮기면 표가 화면을 뚫는다.
 *  테두리 굵기(0.28pt 같은 헤어라인)만은 pt 여도 그대로 의미가 통해 예외다. */
const hasPt = (s) => /\d\s*pt\b/i.test(s);

/** style 속성값 → 허용 목록만 남긴 문자열(전부 떨어지면 빈 문자열).
 *  font-family/font-size 를 여기서 죽이는 것이 이 스크립트의 핵심 중 하나다:
 *  원문의 돋움·13px·Malgun Gothic 이 살아남으면 사이트 서체를 매 글마다 덮어쓴다.
 *  반대로 배경·테두리·세로 정렬은 구형 디자인 공지(색 배경 제목 바·번호 칩 표)의
 *  실체라 살린다 — 값 패턴은 SANITIZE_OPTS 와 같은 것을 쓴다.
 *  같은 속성이 두 번 오면 뒤엣것이 이긴다(CSS 캐스케이드와 같게 Map 으로 모은다). */
function filterStyle(value, tag = '') {
  const t = String(tag).toLowerCase();
  const kept = new Map();
  for (const decl of String(value).split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const raw = decl.slice(i + 1).trim();
    if (prop === 'text-align') {
      // text-align: start/end 는 정화 통과 패턴이 아니고, 어차피 기본값이라 버린다
      if (/^(left|right|center|justify)$/i.test(raw)) kept.set(prop, `text-align: ${raw.toLowerCase()}`);
      continue;
    }
    // background 는 축약형이지만 색 하나짜리만 받는다(그림·그러데이션은 parseColor 가
    // 거른다) → 통과분은 background-color 로 정규화해 한 가지 표기로 모은다.
    if (prop === 'color' || prop === 'background-color' || prop === 'background') {
      const c = parseColor(raw);
      if (!c) continue;
      const out = prop === 'color' ? 'color' : 'background-color';
      if (out === 'color' && isDefaultText(c)) continue;
      if (out === 'background-color' && isDefaultBg(c)) continue;
      kept.set(out, `${out}: rgb(${c.r}, ${c.g}, ${c.b})`);
      continue;
    }
    if (BORDER_PROPS.has(prop) && CELL_TAGS.has(t)) {
      if (BORDER[0].test(raw)) kept.set(prop, `${prop}: ${raw}`);
      continue;
    }
    if (prop === 'vertical-align' && CELL_TAGS.has(t)) {
      if (/^(top|middle|bottom)$/i.test(raw)) kept.set(prop, `vertical-align: ${raw.toLowerCase()}`);
      continue;
    }
    if (prop === 'padding' && PADDING_TAGS.has(t)) {
      if (!hasPt(raw) && PADDING[0].test(raw)) kept.set(prop, `padding: ${raw}`);
      continue;
    }
    if ((prop === 'width' || prop === 'height') && CELL_TAGS.has(t)) {
      if (!hasPt(raw) && LENGTH[0].test(raw)) kept.set(prop, `${prop}: ${raw}`);
      continue;
    }
    // font-family / font-size / line-height / margin … 나머지는 전부 폐기
  }
  return [...kept.values()].join('; ');
}

// ── URL 절대화 ────────────────────────────────────────────────────────
/** 상대 주소를 원문 게시물 주소 기준으로 절대화한다.
 *  new URL() 을 쓰는 이유: 루트 상대(/_res/…), 쿼리 전용(?mode=download&…),
 *  일반 상대(view.do?…) 세 가지가 전부 섞여 오는데 표준 해석기가 셋 다 정확하다.
 *  특히 쿼리 전용은 "그 게시판 경로"에 붙어야 해서 base 가 반드시 필요하다. */
function absolutize(url, base) {
  const raw = String(url ?? '').trim();
  if (!raw) return raw;
  if (raw.startsWith('#')) return raw; // 문서 내 앵커
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return raw; // 이미 스킴 있음(http, mailto, data…)
  if (raw.startsWith('//')) return `https:${raw}`;
  try {
    return new URL(raw, base).href;
  } catch {
    return raw;
  }
}

/** 게시물 하나의 URL 해석 기준 — 원문 주소가 최선(쿼리 전용 링크가 같은 게시판을
 *  가리키게 된다). 없으면 게시판 경로(sourcePath)로, 그것도 없으면 사이트 루트로. */
function baseUrlOf(post, sourcePath) {
  const su = String(post?.sourceUrl ?? '').trim();
  if (/^https?:\/\//.test(su)) return su;
  const p = String(sourcePath ?? '').trim();
  if (p) return `${SITE_ORIGIN}/me/community/${p.replace(/^\/+/, '')}`;
  return `${SITE_ORIGIN}/`;
}

// ── 본문 내 base64 이미지 → R2 ────────────────────────────────────────
// 클라이언트 설정은 src/lib/admin/r2.ts 와 동일하게 맞춘다(엔드포인트·자격증명·버킷).
// ⚠ 이 스크립트는 API 라우트를 거치지 않고 S3 로 직접 가므로 upload-validate.ts 의
//   검증을 타지 않는다. 그래도 키 접두사(uploads/)와 허용 이미지 타입은 그 규칙에
//   맞춰 둔다 — 저장소 안에서 경로 관례가 갈라지면 나중에 정리할 수가 없다.
const R2_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'];
const R2_MISSING = R2_ENV.filter((k) => !process.env[k]);
const R2_READY = R2_MISSING.length === 0;
// 추출을 시도할지 — 끄면(또는 env 가 없으면) data: 이미지는 정화 단계에서 사라진다.
const EXTRACT_IMAGES = !SKIP_DATA_IMAGES && R2_READY;

let _s3 = null;
function s3() {
  if (_s3) return _s3;
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _s3;
}

const r2PublicUrl = (key) => `${String(process.env.R2_PUBLIC_BASE_URL).replace(/\/+$/, '')}/${key}`;

// upload-validate.ts 가 허용하는 이미지 타입만 받는다(svg 는 그쪽에서도 차단 대상).
const IMAGE_EXT = { jpeg: 'jpg', jpg: 'jpg', png: 'png', gif: 'gif', webp: 'webp' };

// src="data:image/…;base64,…" — 작은따옴표 표기도 함께 잡는다.
const DATA_IMG_RE = /\bsrc\s*=\s*(["'])(data:image\/([a-zA-Z0-9.+-]+);base64,([^"']*))\1/gi;

/** 드라이런에서 쓰는 가짜 주소. .invalid 는 예약 TLD 라 절대 해석되지 않는다 —
 *  실수로 이 값이 DB 에 들어가도 "진짜처럼 보이는 깨진 URL"이 되지 않는다. */
const DRY_RUN_HOST = 'https://DRY-RUN-PLACEHOLDER.invalid';

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

/**
 * 본문에서 base64 이미지를 뽑아내고 src 를 R2 공개 URL(드라이런이면 placeholder)로
 * 바꾼 HTML 을 돌려준다. 업로드는 여기서 하지 않는다 — 키가 내용 해시라 업로드
 * 전에 이미 최종 URL 을 알 수 있으므로, 이 함수는 동기로 두고 실제 전송은
 * --apply 경로에서만 한다.
 * @returns {{ html: string, images: object[], found: number, unsupported: number }}
 */
function extractDataImages(html, board) {
  const src = String(html ?? '');
  const images = [];
  let found = 0;
  let unsupported = 0;
  if (!src.includes('data:image/')) return { html: src, images, found, unsupported };

  const out = src.replace(DATA_IMG_RE, (whole, quote, _uri, subtype, payload) => {
    found += 1;
    const ext = IMAGE_EXT[subtype.toLowerCase()];
    if (!ext) {
      // 지원하지 않는 형식(svg 등) — 손대지 않는다. 정화가 걷어내고, 아래의
      // 이미지 수 검사가 유실로 잡아 준다.
      unsupported += 1;
      return whole;
    }
    // base64 안에 들어간 줄바꿈·공백을 털어낸다(에디터가 줄을 접어 두기도 한다)
    const buffer = Buffer.from(payload.replace(/\s+/g, ''), 'base64');
    if (buffer.length === 0) {
      unsupported += 1;
      return whole;
    }
    const sha16 = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const key = `uploads/imported/${board}/${sha16}.${ext}`;
    const url = APPLY ? r2PublicUrl(key) : `${DRY_RUN_HOST}/${key}`;
    images.push({
      key,
      url,
      mime: `image/${subtype.toLowerCase()}`,
      ext,
      bytes: buffer.length,
      // 드라이런에선 바이트를 들고 있을 이유가 없다(1,267건 × 수 MB 는 부담)
      buffer: APPLY ? buffer : null,
    });
    return `src=${quote}${url}${quote}`;
  });

  return { html: out, images, found, unsupported };
}

// 이번 실행에서 이미 처리한 키 — 같은 그림이 여러 글에 붙어 있어도 한 번만 올린다.
const uploadedKeys = new Set();

async function objectExists(key) {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    return true;
  } catch (e) {
    // 404/NotFound 는 "없음". 그 밖의 오류(권한·네트워크)는 그대로 올린다.
    const status = e?.$metadata?.httpStatusCode;
    if (status === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchKey') return false;
    throw e;
  }
}

/** 실제 업로드(--apply 전용). 반환: 'uploaded' | 'exists' | 'dup' */
async function uploadImage(img) {
  if (uploadedKeys.has(img.key)) return 'dup';
  uploadedKeys.add(img.key);
  if (await objectExists(img.key)) return 'exists';
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: img.key,
      Body: img.buffer,
      ContentType: img.mime,
    }),
  );
  return 'uploaded';
}

// ── 본문 정규화 ───────────────────────────────────────────────────────
const NBSP_RUN = /(?:&nbsp;|&#160;|&#xa0;| )+/gi;

/**
 * 원문 HTML → 우리 게시판에 넣을 HTML.
 * 순서: ① URL 절대화 → ② div→p·font 제거 → ③ style 3종만 남기기 →
 *       ④ 빈 span 벗기기·빈 문단 제거 → ⑤ &nbsp; 축약 → ⑥ sanitizeHtml.
 */
function normalizeBody(html, { sourceUrl, sourcePath } = {}) {
  const src = String(html ?? '');
  if (!src.trim()) return '';
  const base = baseUrlOf({ sourceUrl }, sourcePath);

  const tokens = tokenize(src);
  const out = [];
  const stack = []; // { src: 원래 태그명, out: 출력 태그명 | null(=벗김) }

  /** div 가 블록을 담는 껍데기인지 — 바로 다음 알맹이가 블록 여는 태그면 껍데기로 본다.
   *  껍데기 div 를 p 로 바꾸면 <p><p>…</p></p> 같은 불법 중첩이 되므로 벗기는 편이 낫다. */
  const nextIsBlockOpen = (i) => {
    for (let j = i + 1; j < tokens.length; j += 1) {
      const t = tokens[j];
      if (t.type === 'text') {
        if (t.raw.replace(NBSP_RUN, ' ').trim() === '') continue;
        return false;
      }
      if (t.closing) return false;
      return BLOCK_TAGS.has(t.name);
    }
    return false;
  };

  tokens.forEach((t, i) => {
    if (t.type === 'text') {
      // ⑤ &nbsp; 연속 → 보통 공백 하나 (원문은 줄 간격 대신 &nbsp; 를 남발한다)
      out.push(t.raw.replace(NBSP_RUN, ' '));
      return;
    }

    if (t.closing) {
      let k = stack.length - 1;
      while (k >= 0 && stack[k].src !== t.name) k -= 1;
      if (k < 0) return; // 짝 없는 닫는 태그 — 버린다
      // 스택에서 그 위에 남은 태그들도 함께 닫아 준다(안쪽부터)
      const closed = stack.splice(k).reverse();
      for (const f of closed) if (f.out) out.push(`</${f.out}>`);
      return;
    }

    let name = t.name;
    let unwrap = false;

    // ② div → p, font 는 태그만 제거(텍스트는 유지)
    if (name === 'font') {
      unwrap = true;
    } else if (name === 'div') {
      if (nextIsBlockOpen(i) || stack.some((f) => f.out === 'p')) unwrap = true;
      else name = 'p';
    }

    // 정화 후 살아남을 속성만 남긴다(class/id/align/width 등은 여기서 소멸)
    const allowed = ALLOWED_ATTRS[name] ?? [];
    const attrs = {};
    for (const [k, v] of Object.entries(t.attrs)) {
      if (!allowed.includes(k)) continue;
      // ① URL 절대화 — 놓치면 영구히 깨진 이미지/링크가 된다
      if ((name === 'img' && k === 'src') || (name === 'a' && k === 'href')) {
        attrs[k] = absolutize(v, base);
        continue;
      }
      if (k === 'style') {
        const s = filterStyle(v, name); // ③
        if (s) attrs[k] = s; // 남는 게 없으면 속성 자체를 넣지 않는다
        continue;
      }
      attrs[k] = v;
    }

    // ④ 살아남은 속성이 없는 span 은 의미가 없다 — 벗긴다(원문 span 중첩의 태반)
    if (name === 'span' && Object.keys(attrs).length === 0) unwrap = true;

    const isVoid = VOID_TAGS.has(name);
    if (!isVoid) stack.push({ src: t.name, out: unwrap ? null : name });
    if (unwrap) return;

    const attrStr = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
    out.push(isVoid ? `<${name}${attrStr} />` : `<${name}${attrStr}>`);
  });

  // 닫히지 않은 채 끝난 태그 마무리
  for (const f of stack.reverse()) if (f.out) out.push(`</${f.out}>`);

  let result = out.join('');

  // ④ 빈 여백 문단 제거 — <p><span><br></span></p>, <p>&nbsp;</p>, <p></p>.
  // 중첩 때문에 한 번으로 안 끝날 수 있어 변화가 없을 때까지 돌린다.
  // ⚠ 셀 바로 안의 빈 문단(<td><p></p></td>)은 남긴다 — 에디터(Tiptap)도 게시
  //   화면도 "빈 셀 = <p> 하나"를 전제하므로, 여기서 지우면 표 재생성이 만든
  //   빈 칸이 <td></td> 가 돼 편집 시 셀이 무너진다. 뒤보기(lookbehind)로 셀
  //   여는 태그 직후만 예외 처리한다.
  const EMPTY_P = /(?<!<t[dh]>|<t[dh]\s[^>]*>)<p(?:\s[^>]*)?>(?:\s|&nbsp;|&#160;|<br\s*\/?>|<span(?:\s[^>]*)?>|<\/span>|<strong>|<\/strong>|<em>|<\/em>|<b>|<\/b>|<u>|<\/u>)*<\/p>/gi;
  for (let i = 0; i < 5; i += 1) {
    const next = result.replace(EMPTY_P, '');
    if (next === result) break;
    result = next;
  }

  // ⑥ 최종 정화 — 여기를 통과한 것만 DB 에 들어간다
  return sanitizeHtml(result, SANITIZE_OPTS);
}

// ── 표 재생성 ─────────────────────────────────────────────────────────
// 원문 표는 대부분 MS 워드에서 붙여 넣은 산출물이라 셀 안이 <span> 껍데기 안에
// <p> 가 든 불법 중첩(<td><span><span><p>…</p></span></span></td>)이다. 정화는
// 태그 화이트리스트만 볼 뿐 중첩 규칙을 고치지 않으므로 그대로 통과하고, 브라우저가
// 렌더 시점에 구조를 제멋대로 재조립한다. 게다가 원문 표에는 data-border 계열
// 속성이 없어 게시 화면 CSS(.prose-content table[data-border=…])가 선을 안 그린다.
// → 표만 따로 뜯어 "에디터(Tiptap)가 만들었을 모양"으로 다시 찍는다.
//
// ⚠ tools/board-source.mjs 에 같은 모양의 짝 세기 도우미가 있지만 import 하지
//   않는다 — 크롤러와 적재기는 의도적으로 분리돼 있다(파일 상단 주석 참조).

/** 에디터가 새 표에 붙이는 기본값 — PostBodyEditor.tsx 의 insertTable 체인과 동일. */
const TABLE_ATTRS = 'data-border="1" data-border-color="lightgray" data-cellpad="narrow"';

// 중첩 표 자리표시자 — 원문에 나올 수 없는 제어문자를 골랐다. HTML 특수문자가
// 아니라 정화·엔티티 처리를 그대로 통과한다(재생성이 끝나면 하나도 남지 않는다).
const NESTED_MARK = String.fromCharCode(1); // U+0001 (SOH)
const NESTED_MARK_RE = new RegExp(`${NESTED_MARK}(\\d+)${NESTED_MARK}`, 'g');

/** startIdx 의 여는 태그에 짝이 맞는 닫는 태그까지 잘라 낸다(중첩 감안).
 *  닫는 태그가 모자란 깨진 마크업이면 null. */
function balancedBlock(html, startIdx, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = startIdx;
  let depth = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) {
      depth -= 1;
      if (depth <= 0) return html.slice(startIdx, m.index + m[0].length);
    } else {
      depth += 1;
    }
  }
  return null;
}

/** 여는/닫는 태그 한 겹을 벗겨 안쪽만 남긴다. */
function stripOuterTag(block, tag) {
  return block
    .replace(new RegExp(`^<${tag}\\b[^>]*>`, 'i'), '')
    .replace(new RegExp(`</${tag}\\s*>\\s*$`, 'i'), '');
}

/** 같은 층위의 <tag> 블록 목록 → [{ start, end, block, inner }].
 *  게으른 매칭이면 표 안의 표에서 첫 </table> 에 끊기므로 짝을 센다. */
function findBlocks(html, tag) {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const lazyRe = new RegExp(`^<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i');
  const out = [];
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const start = m.index;
    const block = balancedBlock(html, start, tag);
    if (block) {
      out.push({ start, end: start + block.length, block, inner: stripOuterTag(block, tag) });
      openRe.lastIndex = start + block.length;
      continue;
    }
    // 닫는 태그가 모자란 깨진 마크업 — 게으른 방식으로, 그것도 없으면 끝까지.
    const lazy = html.slice(start).match(lazyRe);
    if (lazy) {
      out.push({ start, end: start + lazy[0].length, block: lazy[0], inner: lazy[1] });
      openRe.lastIndex = start + lazy[0].length;
      continue;
    }
    out.push({ start, end: html.length, block: html.slice(start), inner: html.slice(start + m[0].length) });
    break;
  }
  return out;
}

/** <tr>…</tr> 또는 <td>/<th> 를 순서대로 자른다.
 *  중첩 표를 미리 자리표시자로 빼낸 뒤에만 부르므로 같은 이름이 겹칠 일이 없다
 *  → 닫는 태그가 빠진 워드 산출물에서도 "다음 여는 태그"가 곧 경계다. */
function splitByTag(inner, pattern) {
  const out = [];
  const re = new RegExp(`<(/?)(${pattern})\\b([^>]*)>`, 'gi');
  let cur = null;
  let m;
  const close = (endIdx) => {
    if (!cur) return;
    cur.inner = inner.slice(cur.start, endIdx);
    out.push(cur);
    cur = null;
  };
  while ((m = re.exec(inner)) !== null) {
    close(m.index);
    if (!m[1]) cur = { tag: m[2].toLowerCase(), attrs: m[3], start: re.lastIndex };
  }
  close(inner.length);
  return out;
}

/** 원문 셀에서 "디자인"만 건져 온다 — 배경색과 세로 정렬 둘뿐이다.
 *  이 둘이 구형 디자인 공지(색 배경 제목 바·번호 칩 표)의 실체이고, 나머지
 *  pt 단위 폭·여백은 원문의 종이 좌표계라 웹 폭에서 재현하면 표가 화면을 뚫는다.
 *  배경 표기는 filterStyle 과 같게 rgb() 로 정규화한다(정화 통과 패턴). */
function cellDesign(attrs) {
  const raw = String(attrs ?? '');
  const styleM = raw.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  let bg = null;
  let valign = null;
  for (const decl of (styleM ? (styleM[1] ?? styleM[2]) : '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const v = decl.slice(i + 1).trim();
    // HWP 는 셀 배경을 background-color 가 아니라 background 축약형으로 낸다
    if (prop === 'background' || prop === 'background-color') {
      const c = parseColor(v);
      if (c && !isDefaultBg(c)) bg = `rgb(${c.r}, ${c.g}, ${c.b})`;
    } else if (prop === 'vertical-align' && /^(top|middle|bottom)$/i.test(v)) {
      valign = v.toLowerCase();
    }
  }
  // style 이 없으면 구식 valign 속성 — 워드 산출물은 이쪽이 더 흔하다
  if (!valign) {
    const m = raw.match(/\bvalign\s*=\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z]+))/i);
    const v = String(m ? (m[1] ?? m[2] ?? m[3]) : '').toLowerCase();
    if (/^(top|middle|bottom)$/.test(v)) valign = v;
  }
  return { bg, valign };
}

/** colspan/rowspan — 양의 정수만, 1(또는 못 읽음)이면 1. */
function spanAttr(attrs, name) {
  const m = String(attrs ?? '').match(new RegExp(`\\b${name}\\s*=\\s*(?:"(\\d+)"|'(\\d+)'|(\\d+))`, 'i'));
  if (!m) return 1;
  const n = Number(m[1] ?? m[2] ?? m[3]);
  return Number.isInteger(n) && n > 1 && n < 100 ? n : 1;
}

// 셀 안에서 "문단 하나"로 감싸면 안 되는 블록들(그 자체가 이미 블록이다)
const CELL_BLOCK_TAGS = new Set([
  'p', 'div', 'table', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'figure', 'hr',
]);

/** 최상위에 흩어진 인라인 조각(맨 텍스트·<b>·<img>…)을 <p> 단위로 묶는다.
 *  워드 셀은 "<p> 한 개 + 맨 텍스트" 처럼 섞여 오는데, 셀 안에 맨 텍스트가 남으면
 *  게시 화면의 표 셀 여백 규칙(td p { margin:0 })이 걸리지 않아 행 높이가 튄다. */
function wrapLoose(html) {
  const tokens = tokenize(String(html ?? ''));
  const out = [];
  let run = [];
  let inline = []; // 최상위에서 열려 있는 인라인 태그 스택
  let block = null; // { name, depth, parts } — 통째로 그대로 내보낼 블록
  const flushRun = () => {
    const s = run.join('');
    run = [];
    // 글자도 그림도 없는 여백 조각은 버린다(빈 <p> 를 양산하지 않는다)
    const bare = s.replace(/<[^>]*>/g, '').replace(NBSP_RUN, ' ').trim();
    if (bare === '' && !/<img\b/i.test(s)) return;
    out.push(`<p>${s}</p>`);
  };

  for (const t of tokens) {
    if (block) {
      block.parts.push(t.raw);
      if (t.type === 'tag' && t.name === block.name && !t.selfClosed && !VOID_TAGS.has(t.name)) {
        block.depth += t.closing ? -1 : 1;
        if (block.depth <= 0) {
          out.push(block.parts.join(''));
          block = null;
        }
      }
      continue;
    }
    if (t.type === 'text') {
      run.push(t.raw);
      continue;
    }
    if (t.closing) {
      const k = inline.lastIndexOf(t.name);
      if (k < 0) continue; // 짝 없는 닫는 태그 — 버린다
      inline.splice(k);
      run.push(t.raw);
      continue;
    }
    // 인라인 태그가 열려 있는 동안의 블록 태그는 최상위가 아니다 — 그냥 이어 붙인다
    if (inline.length === 0 && CELL_BLOCK_TAGS.has(t.name)) {
      flushRun();
      if (t.selfClosed || VOID_TAGS.has(t.name)) out.push(t.raw);
      else block = { name: t.name, depth: 1, parts: [t.raw] };
      continue;
    }
    run.push(t.raw);
    if (!t.selfClosed && !VOID_TAGS.has(t.name)) inline.push(t.name);
  }
  flushRun();
  if (block) out.push(block.parts.join('')); // 닫히지 않은 채 끝난 블록
  return out.join('');
}

/** 셀 하나의 내용 재생성 — 껍데기 span/div 를 걷고 <p> 단위로 다시 세운다.
 *  normalizeBody 는 순수 함수라 셀 조각에 그대로 재귀 적용할 수 있다.
 *  중첩 표는 자리표시자로 빠져 있다가 여기서 되돌아온다(안쪽은 이미 재생성 완료). */
function rebuildCell(inner, ctx, nested) {
  let html = normalizeBody(inner, ctx);
  html = html.replace(NESTED_MARK_RE, (_, i) => nested[Number(i)] ?? '');
  html = wrapLoose(html);
  // 빈 셀도 <p> 하나는 있어야 한다(에디터·게시 화면 양쪽의 전제)
  return html.trim() === '' ? '<p></p>' : html;
}

/** <table>…</table> 한 덩어리 → 에디터 문법으로 다시 찍은 표.
 *  0행이면 빈 문자열, 1×1 이면 표를 벗기고 내용만. */
function rebuildTableBlock(block, ctx, stats) {
  const inner = stripOuterTag(block, 'table');

  // ① 중첩 표를 자리표시자로 빼낸다 — 안쪽부터 재생성해 두어야 하고, 그래야
  //    바깥 표의 tr/td 자르기가 안쪽 tr/td 에 오염되지 않는다.
  const nested = [];
  let work = '';
  let last = 0;
  for (const b of findBlocks(inner, 'table')) {
    stats.nested += 1;
    work += `${inner.slice(last, b.start)}${NESTED_MARK}${nested.length}${NESTED_MARK}`;
    nested.push(rebuildTableBlock(b.block, ctx, stats));
    last = b.end;
  }
  work += inner.slice(last);

  // ② <caption> 은 행 밖에 있어 아래 tr 훑기에 안 잡힌다. 정화 화이트리스트에도
  //    없어서 구 파이프라인에서도 태그만 떨어지고 글자는 표 앞에 남았다
  //    (실측 3건이 이걸로만 5~7% 유실로 잡혔다) → 표 위 문단으로 승격시킨다.
  let caption = '';
  work = work.replace(/<caption\b[^>]*>([\s\S]*?)<\/caption\s*>/gi, (_, capInner) => {
    caption += rebuildCell(capInner, ctx, nested);
    return '';
  });

  // ③ 행 → 셀. thead/tbody/tfoot 껍데기는 무시하고 전부 한 tbody 로 눕힌다
  //    (에디터도 withHeaderRow:false — th 는 원문이 쓴 셀만 유지한다).
  const rows = [];
  for (const r of splitByTag(work, 'tr')) {
    const cells = splitByTag(r.inner, 't[dh]').map((c) => ({
      tag: c.tag === 'th' ? 'th' : 'td',
      colspan: spanAttr(c.attrs, 'colspan'),
      rowspan: spanAttr(c.attrs, 'rowspan'),
      ...cellDesign(c.attrs),
      html: rebuildCell(c.inner, ctx, nested),
    }));
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) {
    stats.dropped += 1;
    return caption;
  }
  // 셀 배경이 하나라도 있으면 이 표는 배치용 껍데기가 아니라 "디자인 표"다
  const designed = rows.some((cells) => cells.some((c) => c.bg));
  // ④ 셀이 하나뿐인 표 = 워드의 레이아웃 껍데기지 표가 아니다 — 벗긴다.
  //    ⚠ 단, 그 한 셀에 배경색이 있으면 벗기면 안 된다 — 구형 공지의 색 배경
  //    제목 바가 정확히 1×1 표라, 벗기는 순간 흰 글자만 남아 안 보이게 된다.
  if (rows.length === 1 && rows[0].length === 1 && !designed) {
    stats.unwrapped += 1;
    return caption + rows[0][0].html;
  }

  stats.tables += 1;
  if (designed) stats.designed += 1;
  const body = rows
    .map((cells) => {
      const tds = cells
        .map((c) => {
          // 게시 화면 CSS 가 격자 표 셀을 middle 로 고정하므로, 인라인으로 되살릴
          // 세로 정렬은 middle 이 아닌 값뿐이다(valign 속성은 왕복 보존용).
          const style = [
            c.bg ? `background-color: ${c.bg}` : '',
            c.valign && c.valign !== 'middle' ? `vertical-align: ${c.valign}` : '',
          ]
            .filter(Boolean)
            .join('; ');
          const a =
            (c.colspan > 1 ? ` colspan="${c.colspan}"` : '') +
            (c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : '') +
            (c.valign ? ` valign="${c.valign}"` : '') +
            (style ? ` style="${style}"` : '');
          return `<${c.tag}${a}>${c.html}</${c.tag}>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  // colgroup/col 은 만들지 않는다 — 워드가 남긴 폭 값은 신뢰할 수 없어서,
  // 자동 레이아웃 + 게시 화면의 overflow-x-auto(가로 스크롤)에 맡긴다.
  // 디자인 표에도 TABLE_ATTRS(기본 격자)는 그대로 붙인다 — 선이 있어야 읽힌다.
  return `${caption}<table ${TABLE_ATTRS}><tbody>${body}</tbody></table>`;
}

/** 본문 안의 모든 <table> 을 재생성한다(normalizeBody 직전 전처리).
 *  base64 이미지 추출이 끝난 뒤에 불러야 셀 안의 img src 교체분이 살아남는다. */
function rebuildTables(html, ctx, stats) {
  const src = String(html ?? '');
  if (!/<table\b/i.test(src)) return src;
  const blocks = findBlocks(src, 'table');
  if (blocks.length === 0) return src;
  let out = '';
  let last = 0;
  for (const b of blocks) {
    out += src.slice(last, b.start) + rebuildTableBlock(b.block, ctx, stats);
    last = b.end;
  }
  return out + src.slice(last);
}

// 재생성 집계(보고용) — toRow 에서 본문 하나당 한 번씩 누적된다.
const tableStats = { posts: 0, tables: 0, nested: 0, unwrapped: 0, dropped: 0, designed: 0 };

// ── 본문 유실 감시 ────────────────────────────────────────────────────
/** 태그를 지우고 엔티티를 풀고 **공백을 전부 뺀** "보이는 글자". 태그를 빈 문자열로
 *  지우는 이유: span 벗기기·div→p 로 태그 수가 변해도 길이가 흔들리지 않아야
 *  "실제 텍스트가 사라졌는가"만 순수하게 측정된다.
 *  공백까지 빼는 이유도 같다 — 원문 표는 `</td>` 와 `<td>` 사이에 줄바꿈·들여쓰기가
 *  잔뜩 들어 있는데(워드가 뱉은 정렬 공백), 렌더에는 한 글자도 안 보이는 것들이다.
 *  표 재생성이 이걸 걷어내면 "글자가 10~19% 줄었다"는 거짓 경보가 뜬다(실측 63건).
 *  길이 비교 전용이라 사람이 읽을 문자열일 필요는 없다. */
function visibleText(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]*>/g, ''),
  )
    // decodeEntities 가 모르는 명명 엔티티(&middot; &ldquo; &hellip; …)는 한 글자로
    // 친다. sanitize-html 은 이들을 전부 실제 문자로 바꿔 내보내므로, 그냥 두면
    // 원본 "&middot;"(8자) → 결과 "·"(1자) 가 글자 유실로 오검출된다. 실제로 실크롤
    // noticesUndergrad 121건 중 7건이 오직 이 이유로 6~8% 감소로 잡혔다(내용은 동일).
    // 측정용이라 어떤 글자로 세는지는 상관없고, 양쪽을 같은 기준으로 세는 것만 중요하다.
    .replace(/&[a-zA-Z][a-zA-Z0-9]{1,31};/g, '�')
    .replace(/[\s ]+/g, '')
    .trim();
}

// 5% 넘게 줄면 사람이 봐야 한다 — 본문을 조용히 먹는 것이 이 스크립트 최악의 실패다.
const LOSS_THRESHOLD = 0.05;

/** src 를 가진 <img> 의 수 — 실제로 화면에 뜨는 사진의 수. 정화는 허용되지 않은
 *  스킴(data:)의 src 만 떼고 태그는 남기므로, 태그 수가 아니라 이걸 세야 한다. */
function countImagesWithSrc(html) {
  const tags = String(html ?? '').match(/<img\b[^>]*>/gi) ?? [];
  return tags.filter((t) => /\bsrc\s*=\s*["'][^"']+["']/i.test(t)).length;
}

// ── 제목에서 일정 뽑기 (행사·세미나) ──────────────────────────────────
// 대략 6개월. 게시일보다 이만큼 과거면 연도 이월로 본다(12/28 글의 "1/5" → 이듬해).
const SIX_MONTHS_DAYS = 183;
const BRACKET_RE = /^\s*\[([^\]]{1,40})\]/;
// 기간: 7/20~7/24, 7.20 - 7.24 (물결·대시류 관용)
const RANGE_RE = /(\d{1,2})[./](\d{1,2})\s*[~～–—−-]\s*(\d{1,2})[./](\d{1,2})/;
// 하루(대괄호 안): 7/20
const SINGLE_RE = /(\d{1,2})[./](\d{1,2})/;
// 하루(본문 제목 안): 7/21(화) — 요일 괄호를 요구해 "2차"·버전 숫자 오탐을 막는다
const SINGLE_DOW_RE = /(\d{1,2})[./](\d{1,2})\s*\(\s*[월화수목금토일]\s*\)/;

/** 게시일 기준으로 연도를 정한다. 게시일보다 6개월 이상 과거면 이듬해로 넘긴다
 *  (2025-12-28 글의 "1/5" 는 2026-01-05 다). 미래 방향으로는 굴리지 않는다. */
function resolveYear(m, d, baseDate) {
  const baseYear = Number(String(baseDate).slice(0, 4));
  if (!Number.isInteger(baseYear)) return null;
  const baseDays = isoToDays(baseDate);
  if (!isValidYmd(baseYear, m, d)) return null;
  if (Number.isFinite(baseDays) && daysFromCivil(baseYear, m, d) < baseDays - SIX_MONTHS_DAYS) {
    return isValidYmd(baseYear + 1, m, d) ? baseYear + 1 : baseYear;
  }
  return baseYear;
}

/**
 * 제목에서 실제 일정을 뽑는다. 못 뽑으면 null — **추측하지 않는다.**
 * (null 이면 event_date/end_date/date_label 을 전부 비우고, 읽기 층의 dateOf 가
 *  created_at 으로 폴백한다. 그게 안전하고 정확한 기본값이다.)
 * @returns {{start:string, end:string|null}|null}
 */
function parseScheduleFromTitle(title, baseDate) {
  const t = String(title ?? '');
  if (!t.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(baseDate ?? ''))) return null;

  const bracket = t.match(BRACKET_RE);
  const candidates = [];
  if (bracket) candidates.push({ text: bracket[1], strict: false });
  // 대괄호 라벨([BK세미나] 등)을 떼어 낸 나머지 제목
  candidates.push({ text: bracket ? t.slice(bracket[0].length) : t, strict: true });

  for (const { text, strict } of candidates) {
    const range = text.match(RANGE_RE);
    if (range) {
      const [sm, sd, em, ed] = range.slice(1, 5).map(Number);
      const sy = resolveYear(sm, sd, baseDate);
      if (sy === null) continue;
      let ey = sy;
      if (em < sm || (em === sm && ed < sd)) ey += 1; // 연말 걸침
      if (!isValidYmd(ey, em, ed)) continue;
      const start = toIso(sy, sm, sd);
      const end = toIso(ey, em, ed);
      return { start, end: end > start ? end : null };
    }
    // 대괄호 밖에서는 요일 괄호가 붙은 형태만 신뢰한다(오탐 방지)
    const single = strict ? text.match(SINGLE_DOW_RE) : text.match(SINGLE_RE);
    if (single) {
      const [sm, sd] = single.slice(1, 3).map(Number);
      const sy = resolveYear(sm, sd, baseDate);
      if (sy === null) continue;
      return { start: toIso(sy, sm, sd), end: null };
    }
  }
  return null;
}

// ── 입력 로드 ─────────────────────────────────────────────────────────
function loadSnapshots() {
  const path = resolve(INPUT);
  if (!existsSync(path)) {
    console.error(`입력 경로가 없습니다: ${path}\n  (크롤 스냅샷은 tools/boards-raw/<board>.json — BOARDS_RAW_DIR 또는 --input= 로 바꿀 수 있습니다.)`);
    process.exit(1);
  }
  const files = [];
  if (readdirSyncSafe(path) === null) files.push(path); // 파일 하나를 직접 지정
  else {
    for (const f of readdirSync(path)) {
      if (!f.endsWith('.json')) continue;
      files.push(join(path, f));
    }
  }

  const snapshots = [];
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.warn(`⚠ JSON 파싱 실패로 건너뜀: ${file} — ${e.message}`);
      continue;
    }
    const board = data?.board ?? basename(file, '.json');
    if (!BOARD_KEYS.includes(board)) {
      console.warn(`⚠ 알 수 없는 게시판 키라 건너뜀: ${board} (${file})`);
      continue;
    }
    if (ONLY_BOARDS.length > 0 && !ONLY_BOARDS.includes(board)) continue;
    snapshots.push({
      board,
      sourcePath: data?.sourcePath ?? '',
      crawledAt: data?.crawledAt ?? '',
      posts: Array.isArray(data?.posts) ? data.posts : [],
      file,
    });
  }
  // 게시판 키 순서 고정 — 출력이 매 실행 같도록
  snapshots.sort((a, b) => BOARD_KEYS.indexOf(a.board) - BOARD_KEYS.indexOf(b.board));
  return snapshots;
}

function readdirSyncSafe(p) {
  try {
    return readdirSync(p);
  } catch {
    return null; // 디렉터리가 아님(= 파일)
  }
}

// ── 행 만들기 ─────────────────────────────────────────────────────────
const nn = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/** 크롤 게시물 하나 → posts 행 + 첨부 배열. 부적격이면 { skip: 사유 }. */
function toRow(post, snapshot, suspicious) {
  const { board, sourcePath } = snapshot;
  const sourceUrl = nn(post?.sourceUrl);
  if (!sourceUrl) return { skip: 'sourceUrl 없음' };
  const date = nn(post?.date);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(isoToDays(date))) {
    return { skip: `날짜 불량(${post?.date ?? '없음'})` };
  }

  const rawBody = String(post?.bodyHtml ?? '');
  const title = String(post?.title ?? '').trim();

  // base64 이미지 추출은 정규화보다 **먼저** — 정화가 data: src 를 떼어 내기 전에
  // 바이트를 확보하고 src 를 실제 URL 로 바꿔 놔야 한다.
  const hadDataImage = rawBody.includes('data:image/');
  let workingBody = rawBody;
  let images = [];
  let imagesFound = 0;
  let imagesUnsupported = 0;
  if (hadDataImage && EXTRACT_IMAGES) {
    const ex = extractDataImages(rawBody, board);
    workingBody = ex.html;
    images = ex.images;
    imagesFound = ex.found;
    imagesUnsupported = ex.unsupported;
  } else if (hadDataImage) {
    // 추출을 끈 상태 — 개수만 세어 두고 원본을 그대로 정화로 보낸다(이미지는 사라진다).
    imagesFound = (rawBody.match(DATA_IMG_RE) ?? []).length;
  }

  // 표 재생성은 base64 추출 **뒤**, 정규화 **앞** — 앞이면 셀 안 img 의 src 교체분이
  // 날아가고, 뒤면 이미 정화된 표를 다시 뜯게 된다.
  const ctx = { sourceUrl, sourcePath };
  const beforeTables = tableStats.tables + tableStats.unwrapped + tableStats.dropped;
  const tabled = rebuildTables(workingBody, ctx, tableStats);
  if (tableStats.tables + tableStats.unwrapped + tableStats.dropped > beforeTables) tableStats.posts += 1;

  const body = normalizeBody(tabled, ctx);

  // 본문 유실 감시 ① 글자 — 조용히 먹지 않고 사람이 볼 목록에 올린다
  const before = visibleText(rawBody);
  const after = visibleText(body);
  if (before.length > 0) {
    const loss = (before.length - after.length) / before.length;
    if (loss > LOSS_THRESHOLD) {
      suspicious.push({
        board, sourceUrl, title,
        reason: `본문 ${(loss * 100).toFixed(1)}% 감소 (${before.length}→${after.length}자)`,
      });
    }
  }

  // 본문 유실 감시 ② 이미지 — ①은 "보이는 글자" 길이만 보므로 사진이 통째로
  // 날아가도 잡지 못한다. 그런데 src 만 뜯긴 <img> 는 태그로는 그대로 남아서
  // (`<img alt="포스터" />`) 태그 수를 세는 것으로도 잡히지 않는다.
  // → src 가 살아 있는 <img> 의 수를 센다. 이게 실제로 보이는 사진의 수다.
  if (hadDataImage) {
    const imgBefore = countImagesWithSrc(rawBody);
    const imgAfter = countImagesWithSrc(body);
    if (imgAfter < imgBefore) {
      suspicious.push({
        board, sourceUrl, title,
        reason: `본문 이미지 유실 (${imgBefore}→${imgAfter}개)`,
      });
    }
  }

  const isNews = board === 'news';
  // 저장 값 변환 — 구 사이트의 두 BK21 게시판이 새 사이트에서는 한 게시판의 두 분류다.
  // 분류는 "기존 규칙(뉴스만 general) → 글별 예외표 → 게시판 기본값" 순으로 고른다.
  const rule = BOARD_IMPORT_RULES[board];
  const articleNo = String(post?.articleNo ?? '').trim();
  const row = {
    board: rule?.dbBoard ?? board,
    source_url: sourceUrl,
    slug: isNews ? `${date}-${String(post?.articleNo ?? '').trim()}` : null,
    title_ko: String(post?.title ?? '').trim(),
    title_en: null,
    body_html_ko: body,
    body_html_en: null,
    body_md_ko: null,
    body_md_en: null,
    // 발췌·썸네일은 뉴스만 — 다른 게시판은 읽기 층(thumbOf)이 본문 첫 <img> 로 폴백한다
    excerpt_ko: isNews ? nn(post?.excerpt) : null,
    excerpt_en: null,
    thumbnail_url: isNews ? nn(post?.thumbnail) : null,
    category:
      (isNews ? 'general' : null) ??
      rule?.categoryByArticleNo?.[articleNo] ??
      rule?.defaultCategory ??
      null,
    host_ko: null,
    host_en: null,
    date_label_ko: null,
    date_label_en: null,
    is_event: false,
    event_date: null,
    end_date: null,
    pinned: post?.pinned === true,
    published: true,
    // 소유권 표시 — 이 스크립트가 만든 행이라는 뜻. 재크롤 때 갱신해도 되는 유일한
    // 조건이자, 롤백(delete from posts where import_managed)의 안전선이다.
    import_managed: true,
    // KST 자정 — payloadToRow() 와 완전히 같은 표기. UTC 로 넣으면 게시일이
    // 통째로 하루씩 밀린다(게시일 충실성이 이번 이관의 핵심 요구사항).
    created_at: `${date}T00:00:00+09:00`,
  };

  // 행사·세미나는 제목에 실제 일정이 들어 있다. 뽑히면 event_date/end_date/라벨을
  // 채우고, 못 뽑으면 전부 null 로 둔다(추측 금지).
  // ⚠ 행사일을 created_at 에 쓰지 않는다 — 게시일과 행사일은 다른 사실이다.
  let schedule = null;
  if (SCHEDULE_BOARDS.has(board)) {
    schedule = parseScheduleFromTitle(row.title_ko, date);
    if (schedule) {
      const label = formatPeriodLabel(schedule.start, schedule.end);
      row.event_date = schedule.start;
      row.end_date = schedule.end;
      row.date_label_ko = nn(label.ko);
      row.date_label_en = nn(label.en);
    }
  }

  const attachments = (Array.isArray(post?.attachments) ? post.attachments : [])
    .map((a, i) => ({
      label_ko: nn(a?.label),
      label_en: null,
      url: absolutize(a?.url, baseUrlOf({ sourceUrl }, sourcePath)),
      sort: i,
      size_bytes: null,
    }))
    .filter((a) => a.url);

  return { row, attachments, schedule, images, imagesFound, imagesUnsupported, hadDataImage };
}

// ── Supabase ──────────────────────────────────────────────────────────
function makeClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** source_url 이 있는 기존 행 전부 → Map<source_url, { id, managed }>.
 *  managed 를 함께 읽어야 "갱신해도 되는 행"과 "손대면 안 되는 행"을 가른다.
 *  1000행 기본 제한이 있으므로 페이지를 넘겨 가며 모은다. */
async function fetchExisting(sb) {
  const map = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('posts')
      .select('id, source_url, import_managed')
      .not('source_url', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    // 구 행은 import_managed 가 null 일 수 있다 — true 가 아니면 전부 수동 취급.
    for (const r of data ?? []) map.set(r.source_url, { id: r.id, managed: r.import_managed === true });
    if (!data || data.length < PAGE) break;
  }
  return map;
}

// ── 실행 ──────────────────────────────────────────────────────────────
const snapshots = loadSnapshots();
if (snapshots.length === 0) {
  console.error('적재할 스냅샷이 없습니다.');
  process.exit(1);
}

const sb = NO_DB ? null : makeClient();
let existing = new Map();
let dbReady = false;
if (sb) {
  try {
    existing = await fetchExisting(sb);
    dbReady = true;
  } catch (e) {
    // 드라이런은 DB 없이도 돌아야 한다(정규화 눈검사·픽스처 검증). 적재는 못 한다.
    console.warn(`⚠ 기존 글 조회 실패 — 전부 '신규'로 간주해 드라이런만 합니다: ${e.message}`);
  }
} else if (!NO_DB) {
  console.warn('⚠ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다 — 드라이런만 가능합니다.');
}

// ── 안전장치 ──
// 기본값이 드라이런이고, --apply 는 DB 조회가 성공했을 때만 통한다.
// (프로덕션 DB 에는 손으로 만든 글이 들어 있다 — 조회 실패 상태로 쓰면
//  전부 '신규'로 판단해 중복 적재가 된다.)
if (APPLY && !dbReady) {
  console.error('--apply 는 DB 연결이 확인됐을 때만 사용할 수 있습니다. (조회 실패/자격증명 없음)');
  process.exit(1);
}

const suspicious = [];
const samples = [];
const perBoard = [];
let totalAtts = 0;

// ── base64 이미지 집계 ──
// occurrences = 본문에 박힌 총 개수(중복 포함), unique = 내용 해시 기준 고유 개수.
// 같은 포스터가 여러 글에 붙어 있는 경우가 있어 둘을 따로 센다.
const imageStats = {
  occurrences: 0,
  unique: new Map(), // key → { bytes, board }
  unsupported: 0,
  uploaded: 0,
  existed: 0,
  lostPosts: 0, // 추출이 꺼져 있어 이미지를 잃게 되는 글 수
};

for (const snap of snapshots) {
  const posts = LIMIT ? snap.posts.slice(0, LIMIT) : snap.posts;
  const stat = { board: snap.board, inserted: 0, updated: 0, manual: 0, skipped: 0, atts: 0, reasons: [], images: 0, imageBytes: 0 };
  const seen = new Set(); // 같은 파일 안의 중복 sourceUrl 방어

  for (const post of posts) {
    const built = toRow(post, snap, suspicious);
    if (built.skip) {
      stat.skipped += 1;
      if (stat.reasons.length < 5) stat.reasons.push(built.skip);
      continue;
    }
    const { row, attachments, schedule, images, imagesFound, imagesUnsupported, hadDataImage } = built;
    if (seen.has(row.source_url)) {
      stat.skipped += 1;
      if (stat.reasons.length < 5) stat.reasons.push('파일 내 중복 sourceUrl');
      continue;
    }
    seen.add(row.source_url);

    if (samples.length < 3) {
      samples.push({ board: snap.board, title: row.title_ko, sourceUrl: row.source_url, html: row.body_html_ko, row, schedule });
    }

    const hit = existing.get(row.source_url);

    // 손으로 만든 글에 원문만 연결해 둔 행(import_managed=false/null) — 여기서 끝.
    // 갱신도 하지 않는다. created_at 하나만 덮어도 손 작업을 훼손할 수 있다.
    if (hit && !hit.managed) {
      stat.manual += 1;
      continue;
    }

    // 이미지 집계는 건너뜀(수동) 판정 뒤에 — 쓰지 않을 글의 이미지를 올릴 이유가 없다.
    if (hadDataImage) {
      imageStats.occurrences += imagesFound;
      imageStats.unsupported += imagesUnsupported;
      if (!EXTRACT_IMAGES) imageStats.lostPosts += 1;
      for (const img of images) {
        if (!imageStats.unique.has(img.key)) imageStats.unique.set(img.key, { bytes: img.bytes, board: snap.board });
        stat.images += 1;
        stat.imageBytes += img.bytes;
      }
    }

    const id = hit?.id;
    const isUpdate = id !== undefined;

    if (!APPLY) {
      if (isUpdate) stat.updated += 1;
      else stat.inserted += 1;
      stat.atts += attachments.length;
      continue;
    }

    // 본문이 가리킬 대상을 먼저 만들어 둔다 — 업로드가 실패하면 글도 쓰지 않는다.
    for (const img of images) {
      let r;
      try {
        r = await uploadImage(img);
      } catch (e) {
        console.error(`R2 업로드 실패: ${img.key} (${row.source_url}) — ${e.message}`);
        process.exit(1);
      }
      if (r === 'uploaded') {
        imageStats.uploaded += 1;
        console.log(`  ↑ ${img.key} ${mb(img.bytes)}`);
      } else if (r === 'exists') {
        imageStats.existed += 1;
      }
    }

    if (isUpdate) {
      // 재크롤 갱신 — 여기 도달하는 행은 import_managed=true, 즉 이 스크립트가
      // 만든 행뿐이다(수동 행은 위에서 이미 걸러졌다).
      // 원문에서 다시 얻을 수 있는 값만 덮어쓴다. title_en / body_html_en /
      // excerpt_ko / thumbnail_url 은 손으로 채웠을 수 있어 아예 건드리지 않는다.
      const patch = {
        title_ko: row.title_ko,
        body_html_ko: row.body_html_ko,
        pinned: row.pinned,
        created_at: row.created_at,
      };
      const up = await sb.from('posts').update(patch).eq('id', id);
      if (up.error) { console.error(`update 실패: ${row.source_url} — ${up.error.message}`); process.exit(1); }
      // 첨부는 통째로 교체(원문 첨부 목록이 곧 진실)
      const del = await sb.from('attachments').delete().eq('post_id', id);
      if (del.error) { console.error(`첨부 삭제 실패: ${row.source_url} — ${del.error.message}`); process.exit(1); }
      if (attachments.length > 0) {
        const ins = await sb.from('attachments').insert(attachments.map((a) => ({ ...a, post_id: id })));
        if (ins.error) { console.error(`첨부 insert 실패: ${row.source_url} — ${ins.error.message}`); process.exit(1); }
      }
      stat.updated += 1;
      stat.atts += attachments.length;
    } else {
      const ins = await sb.from('posts').insert(row).select('id').single();
      if (ins.error) { console.error(`insert 실패: ${row.source_url} — ${ins.error.message}`); process.exit(1); }
      existing.set(row.source_url, { id: ins.data.id, managed: true });
      if (attachments.length > 0) {
        const a = await sb.from('attachments').insert(attachments.map((x) => ({ ...x, post_id: ins.data.id })));
        if (a.error) { console.error(`첨부 insert 실패: ${row.source_url} — ${a.error.message}`); process.exit(1); }
      }
      stat.inserted += 1;
      stat.atts += attachments.length;
    }
  }

  totalAtts += stat.atts;
  perBoard.push(stat);
}

// ── 보고 ──────────────────────────────────────────────────────────────
if (REPORT) {
  console.log('\n── 정규화 표본 (앞 3건) ──────────────────────────────');
  for (const s of samples) {
    console.log(`\n[${s.board}] ${s.title}`);
    console.log(`  ${s.sourceUrl}`);
    console.log(`  created_at=${s.row.created_at} pinned=${s.row.pinned} slug=${s.row.slug ?? 'null'}`);
    console.log(
      `  event_date=${s.row.event_date ?? 'null'} end_date=${s.row.end_date ?? 'null'}` +
        ` label_ko=${s.row.date_label_ko ?? 'null'} label_en=${s.row.date_label_en ?? 'null'}`,
    );
    console.log(s.html || '(빈 본문)');
  }
  if (!APPLY && imageStats.unique.size > 0) {
    console.log(
      `\n  ※ 위 <img src> 의 ${DRY_RUN_HOST} 주소는 드라이런 placeholder 입니다.` +
        `\n     --apply 시에는 ${process.env.R2_PUBLIC_BASE_URL ?? '(R2_PUBLIC_BASE_URL)'}/<키> 로 들어갑니다.`,
    );
  }
  console.log('\n── 의심 게시물 전체 (본문 유실 가능) ─────────────────');
  if (suspicious.length === 0) console.log('  없음');
  for (const s of suspicious) {
    console.log(`  [${s.board}] ${s.reason} — ${s.title}`);
    console.log(`    ${s.sourceUrl}`);
  }
}

console.log(`\n── ${APPLY ? '적재 완료' : '드라이런(쓰기 없음)'} ──────────────────────────`);
// 건너뜀(수동) = import_managed 가 아닌 기존 행 → 손 작업이 그대로 남았다는 증거.
// 제외(불량)  = sourceUrl/날짜가 없거나 파일 내 중복이라 행을 만들지 못한 입력.
const n4 = (n) => String(n).padStart(4);
let tIns = 0; let tUpd = 0; let tMan = 0; let tSkip = 0;
for (const s of perBoard) {
  tIns += s.inserted; tUpd += s.updated; tMan += s.manual; tSkip += s.skipped;
  const reasons = s.reasons.length > 0 ? `  (제외 사유: ${[...new Set(s.reasons)].join(', ')})` : '';
  console.log(
    `  ${s.board.padEnd(18)} 신규 ${n4(s.inserted)} · 갱신 ${n4(s.updated)}` +
      ` · 건너뜀(수동) ${n4(s.manual)} · 제외(불량) ${n4(s.skipped)}${reasons}`,
  );
}
console.log(
  `  ${'합계'.padEnd(17)} 신규 ${n4(tIns)} · 갱신 ${n4(tUpd)}` +
    ` · 건너뜀(수동) ${n4(tMan)} · 제외(불량) ${n4(tSkip)}`,
);
console.log(`  첨부 ${totalAtts}건`);

// ── 표 재생성 ──
// 표를 가진 글 수는 "행을 만들려고 정규화한" 전부가 기준이다(뒤에서 건너뛴 글 포함).
if (tableStats.posts > 0) {
  console.log(
    `  표 재생성 ${tableStats.tables}개 (글 ${tableStats.posts}건)` +
      ` · 중첩 표 ${tableStats.nested}개 · 1×1 껍데기 벗김 ${tableStats.unwrapped}개` +
      ` · 디자인 표(셀 배경 보존) ${tableStats.designed}개` +
      ` · 빈 표 제거 ${tableStats.dropped}개`,
  );
}

// ── 본문 내 base64 이미지 ──
if (imageStats.occurrences > 0) {
  const uniqueBytes = [...imageStats.unique.values()].reduce((a, v) => a + v.bytes, 0);
  const M = APPLY ? imageStats.uploaded : imageStats.unique.size;
  console.log(
    `  본문 내 base64 이미지 ${imageStats.occurrences}개 → R2 ${APPLY ? '업로드' : '업로드 예정'} ${M}개 (중복 제외)` +
      `, ${mb(uniqueBytes)}`,
  );
  for (const s of perBoard) {
    if (s.images === 0) continue;
    console.log(`    ${s.board.padEnd(18)} ${String(s.images).padStart(3)}개 · ${mb(s.imageBytes)}`);
  }
  if (APPLY && imageStats.existed > 0) {
    console.log(`    이미 R2 에 있어 건너뜀 ${imageStats.existed}개`);
  }
  if (imageStats.unsupported > 0) {
    console.log(`    ⚠ 지원하지 않는 형식이라 추출하지 못함 ${imageStats.unsupported}개 (정화 단계에서 사라집니다)`);
  }
  if (!EXTRACT_IMAGES) {
    const why = SKIP_DATA_IMAGES
      ? '--skip-data-images 지정'
      : `R2 환경변수 없음(${R2_MISSING.join(', ')})`;
    console.log('');
    console.log(`  ⚠⚠ 본문 이미지 추출이 꺼져 있습니다 — ${why}.`);
    console.log(`     글 ${imageStats.lostPosts}건의 base64 이미지 ${imageStats.occurrences}개가 정화 단계에서 사라집니다.`);
    console.log('     (본문 텍스트는 정상 적재됩니다. 이미지를 살리려면 R2 환경변수를 채우고 다시 실행하세요.)');
  }
}

console.log(`  의심 게시물 ${suspicious.length}건${suspicious.length > 0 && !REPORT ? ' — 목록은 --report 로 확인' : ''}`);
if (tMan > 0) {
  console.log(`  ↳ 건너뜀(수동) ${tMan}건은 손으로 만든 글이라 한 칼럼도 쓰지 않았습니다.`);
}

if (!APPLY) {
  console.log('\n  ※ 실제로 쓰려면 --apply 를 붙이세요.');
} else {
  // 읽기 층(src/lib/posts.ts)은 unstable_cache + 'posts' 태그로 최대 10분 캐시한다.
  // 이 스크립트는 Next 밖이라 revalidateTag 를 호출할 수 없다.
  console.log("\n  ※ 사이트 반영: revalidateTag('posts') 가 필요합니다.");
  console.log('     프로덕션 CMS 에서 아무 글이나 한 번 저장하거나, 재배포하세요.');
}
