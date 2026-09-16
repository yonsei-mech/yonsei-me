// 게시판 본문 정화 정책 — 단일 출처.
//
// posts-server.ts 에서 떼어낸 이유: 앱 의존성(next-auth·supabase·@/lib/*)이 하나도
// 없어야 정책만 따로 노드 스크립트로 돌려 "무엇이 통과하고 무엇이 떨어지는지"를
// 검증할 수 있다. import 는 sanitize-html 하나뿐 — 이 조건을 깨지 말 것.
// (마크다운 렌더 등 서버 로직은 posts-server.ts 에 그대로 남는다.)
//
// 2026-08: 구형 디자인 공지(아래아한글·워드로 꾸며 붙여넣은 색 배경 제목 바·번호 칩
// 표)를 살리려고 배경·테두리·여백·세로 정렬을 열었다. 태그를 더 여는 게 아니라
// **값 패턴이 경계**다 — 아래 패턴 어느 것도 url(·expression(·세미콜론·역슬래시를
// 통과시키지 않으므로 스크립트 주입 경로는 그대로 닫혀 있다.
//
// 이 파일에는 정책이 **둘** 있다. 기본은 아래 화이트리스트(sanitizeEditorHtml)고,
// 게시물 단위 "원문 모드"(posts.body_raw)만 파일 아래쪽의 블랙리스트-라이트
// (scrubRawHtml)를 탄다 — 두 정책의 경계와 근거는 그 함수 주석에 적어 두었다.

import sanitizeHtml from 'sanitize-html';

// ── 값 패턴 ────────────────────────────────────────────────────────────
// 구 사이트에 흔한 "아래아한글·워드에서 디자인해 붙여넣은 공지"(색 배경 제목 바,
// 번호 칩 표)를 살리려면 배경·테두리·여백까지 열어야 한다. 태그를 더 여는 대신
// **값 패턴이 보안 경계**다 — 아래 어떤 패턴도 url(·expression(·세미콜론·역슬래시를
// 통과시키지 않는다. sanitize-html 이 style 을 선언 단위로 파싱하므로(postcss)
// 속성별 정규식만 조여 두면 선언 사이로 새는 경로가 없다.

/** 순수 색상값만 — 이름색·rgba·함수 표기는 통과하지 않는다 */
const COLOR: RegExp[] = [
  /^#[0-9a-fA-F]{3,8}$/,
  /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/,
];

/** 테두리 축약형 — 굵기·선 스타일·색 토큰이 **임의 순서로** 1~3개.
 *  HWP 는 CSS 표준 순서가 아니라 `solid #203a7b 0.28pt` 로 낸다(실측). */
const BORDER: RegExp[] = [
  /^(?=.{1,64}$)(?:(?:solid|dashed|dotted|double|none|hidden|[\d.]{1,6}(?:px|pt)|#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))\s*){1,3}$/,
];

/** 여백 축약형 — 1~4값. pt 는 HWP 원문의 종이 좌표계라 값이 크게 나올 수 있다 */
const PADDING: RegExp[] = [
  /^(?:[\d.]{1,6}(?:px|pt|em|%)|0)(?:\s+(?:[\d.]{1,6}(?:px|pt|em|%)|0)){0,3}$/,
];

/** 길이 한 값 — 셀 폭·높이 */
const LENGTH: RegExp[] = [/^[\d.]{1,6}(px|pt|%)$/];

/** 셀(th/td)에 허용하는 디자인 스타일 — 값은 전부 위 패턴으로 조인다 */
const CELL_STYLES: Record<string, RegExp[]> = {
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
const BLOCK_STYLES: Record<string, RegExp[]> = { background: COLOR, padding: PADDING };

/** 사진 캡션(img[data-caption]) 최대 길이 — 넘치면 잘라낸다.
 *  ⚠️ 에디터 스키마(lib/admin/rte-schema.ts 의 IMAGE_CAPTION_MAX)에 같은 값이 있다.
 *  이 파일은 import 가 sanitize-html 하나뿐이어야 해서(상단 주석) 묶지 못했다 —
 *  한쪽을 고치면 반드시 나머지도 고칠 것. */
const IMAGE_CAPTION_MAX = 300;

/** Q&A 문단(p[data-role])이 가질 수 있는 값 — 그 외에는 속성째 떨어진다.
 *  allowedAttributes 는 "속성이 있어도 되는가"만 보고 값은 안 본다. 값 경계는
 *  아래 transformTags 가 잡는다(열거형이 CSS 한 곳에 갇혀 있어야 하기 때문). */
const PARAGRAPH_ROLES = new Set(['q', 'a']);

/** 정화 정책 — marked 산출물 + 에디터(Tiptap)가 만들 만한 안전한 리치 텍스트만 허용.
 *  script/style/이벤트 핸들러는 여기서 전부 떨어진다. iframe 은 유튜브 임베드
 *  하나 때문에 열되 호스트를 유튜브로 못 박아(allowedIframeHostnames) 임의 사이트
 *  삽입을 막는다 — 허용 밖 호스트는 src 가 통째로 제거돼 빈 프레임만 남는다. */
export const SANITIZE_OPTS: sanitizeHtml.IOptions = {
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
    // data-caption: 사진 캡션(길이는 transformTags 가 자른다). 공개 화면에서
    // figure/figcaption 으로 감싸는 건 렌더 직전의 wrapCaptionedImages 다.
    img: ['src', 'alt', 'title', 'width', 'height', 'style', 'data-align', 'data-caption'],
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
    // data-role: 인터뷰 Q&A 문단. 값(q|a)은 아래 transformTags 가 검사한다
    p: ['style', 'data-role'],
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
    // 사진 캡션 — 공백만 남는 값은 떨어뜨리고, 길면 자른다.
    // (allowedAttributes 는 값 길이를 못 본다 — 본문 한복판에 소설이 실리는 걸 막는다)
    img: (tagName, attribs) => {
      const caption = (attribs['data-caption'] ?? '').trim();
      const next = { ...attribs };
      if (caption) next['data-caption'] = caption.slice(0, IMAGE_CAPTION_MAX);
      else delete next['data-caption'];
      return { tagName, attribs: next };
    },
    // Q&A 문단 — 열거값(q|a) 밖은 속성째 버린다. 값 검사는 여기 한 곳뿐이다
    p: (tagName, attribs) => {
      const role = (attribs['data-role'] ?? '').trim().toLowerCase();
      const next = { ...attribs };
      if (PARAGRAPH_ROLES.has(role)) next['data-role'] = role;
      else delete next['data-role'];
      return { tagName, attribs: next };
    },
  },
};

/** HTML 입력을 정화만 (빈 입력은 빈 문자열) — 에디터 산출물 저장 경로 */
export function sanitizeEditorHtml(html: string | null | undefined): string {
  const h = (html ?? '').trim();
  if (!h) return '';
  return sanitizeHtml(h, SANITIZE_OPTS);
}

/* ════════════════════════════════════════════════════════════════════════
   원문 모드 — 게시물 단위(posts.body_raw)로만 타는 두 번째 정책.

   ⚠️ **사이트 소유자가 위험을 명시적으로 수용한 관리자 전용 경로**다(2026-08).
   구 사이트(Froala, 사실상 무정화)에서 쓰던 아래아한글·워드 산출물을 교수·관리자가
   "붙여넣은 그대로" 게시할 수 있어야 한다는 요구에서 나왔다. 수용된 위험:
   정화 우회 가능성 · 임의 CSS 의 레이아웃 충돌 · 게시물 내 접근성 비보장 ·
   다크모드 대비 미고려. 이 경로는 CMS 로그인(cms_users)을 통과한 사람만 쓴다.

   그래서 정책이 위와 반대다 — 화이트리스트가 아니라 **블랙리스트-라이트**:
   실행 코드(스크립트)만 골라 빼고 나머지 태그·속성·인라인 style·<style> 태그·
   임의 호스트 iframe·pt 단위·표 레이아웃은 전부 통과시킨다.

   구현이 sanitize-html 이 아니라 자체 토크나이저인 이유: **바이트 원형 보존**이
   목적이기 때문이다. sanitize-html 은 통과시킬 때도 문서를 다시 직렬화해
   따옴표·엔티티·자기닫음 표기·속성 순서를 바꾼다(HWP 산출물이 미묘하게 달라진다).
   여기서는 잘라낼 구간만 원문에서 도려내고 나머지는 손대지 않는다.
   ════════════════════════════════════════════════════════════════════════ */

/** 내용째 제거 — 실행 코드 하나뿐 */
const RAW_DROP_WITH_CONTENT = new Set(['script']);

/** 태그만 제거(내용은 남긴다) — 플러그인·문서 헤더·프레임.
 *  object/applet 의 자식은 대체 콘텐츠라 살려 두는 편이 원문에 가깝다.
 *  base 는 문서 전체의 상대 경로를, meta[http-equiv] 는 이동·CSP 를 바꾸고,
 *  link 는 임의 스타일시트를 끌어온다 — 셋 다 게시물 한 편의 권한을 넘는다. */
const RAW_DROP_TAG = new Set([
  'object', 'embed', 'applet', 'base', 'meta', 'link', 'frame', 'frameset',
]);

/** 자식이 태그가 아닌 요소 — 내용을 통째로 원문 그대로 지나간다 */
const RAW_TEXT_TAGS = new Set(['style', 'textarea', 'title']);

/** URL 을 값으로 갖는 속성 — 스킴 검사 대상(그 외 속성은 값을 보지 않는다) */
const RAW_URL_ATTRS = new Set([
  'href', 'src', 'action', 'background', 'poster', 'cite', 'longdesc',
  'data', 'xlink:href', 'formaction',
]);

/** 스킴 판정 전용 문자 참조 해석 — `javascript&colon;` `&#106;avascript:` 우회 차단.
 *  출력에는 쓰지 않는다(원문 보존). */
const NAMED_REFS: Record<string, string> = {
  colon: ':', tab: '\t', newline: '\n', amp: '&', sol: '/', lpar: '(', rpar: ')',
};
function decodeRefs(value: string): string {
  return value
    .replace(/&#[xX]([0-9a-fA-F]{1,6});?/g, (_m, hex: string) =>
      String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
    .replace(/&#(\d{1,7});?/g, (_m, dec: string) =>
      String.fromCodePoint(Math.min(parseInt(dec, 10), 0x10ffff)))
    .replace(/&([a-zA-Z]{2,8});?/g, (m, name: string) =>
      NAMED_REFS[name.toLowerCase()] ?? m);
}

/** URL 속성값을 통과시킬 것인가 — javascript:·vbscript: 는 차단,
 *  data: 는 img[src] 의 data:image/* 만(그림 붙여넣기 원문 보존용). */
function rawUrlAllowed(tag: string, attr: string, value: string): boolean {
  // 제어문자는 브라우저가 무시하므로 판정 전에 털어낸다(`java\tscript:` 우회)
  const v = decodeRefs(value).replace(/[\u0000-\u0020\u007f]/g, '');
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(v)?.[1].toLowerCase() ?? '';
  if (!scheme) return true; // 상대 경로·앵커·프로토콜 상대(//host)
  if (scheme === 'javascript' || scheme === 'vbscript') return false;
  if (scheme === 'data') return tag === 'img' && attr === 'src' && /^data:image\//i.test(v);
  return true; // http·https·mailto·tel·ftp… 전부 통과
}

interface RawAttr {
  /** 태그 문자열 안의 속성 시작·끝(끝은 배타적) */
  start: number;
  end: number;
  name: string;
  value: string;
}

/** 여는 태그 원문에서 속성 목록을 위치와 함께 뽑는다(HTML5 토크나이저 규칙 축약:
 *  따옴표 안의 `>` 는 태그를 끝내지 않고, 값 없는 속성도 허용된다). */
function parseRawAttrs(tag: string, from: number, end: number): RawAttr[] {
  const attrs: RawAttr[] = [];
  let i = from;
  while (i < end) {
    const ch = tag[i];
    if (/[\s/]/.test(ch)) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < end && !/[\s=/]/.test(tag[i])) i += 1;
    const name = tag.slice(start, i);
    if (name === '') {
      i += 1; // '=' 로 시작하는 쓰레기 — 한 글자 흘린다
      continue;
    }
    let attrEnd = i;
    let value = '';
    let j = i;
    while (j < end && /\s/.test(tag[j])) j += 1;
    if (tag[j] === '=') {
      j += 1;
      while (j < end && /\s/.test(tag[j])) j += 1;
      const quote = tag[j];
      if (quote === '"' || quote === "'") {
        const close = tag.indexOf(quote, j + 1);
        const valueEnd = close === -1 ? end : close;
        value = tag.slice(j + 1, valueEnd);
        attrEnd = close === -1 ? end : close + 1;
      } else {
        const valueStart = j;
        while (j < end && !/\s/.test(tag[j])) j += 1;
        value = tag.slice(valueStart, j);
        attrEnd = j;
      }
    }
    attrs.push({ start, end: attrEnd, name, value });
    i = attrEnd;
  }
  return attrs;
}

/** 여는 태그 하나를 걸러 낸다 — 떨어뜨릴 속성 구간만 도려내고 나머지는 원문 그대로.
 *  (통과할 태그는 문자열이 그대로 반환돼 바이트가 보존된다) */
function scrubRawTag(tag: string, name: string, nameEnd: number): string {
  const close = tag.endsWith('>') ? tag.length - 1 : tag.length; // '>' 위치(잘린 태그 대비)
  const attrs = parseRawAttrs(tag, nameEnd, close);
  const drop = attrs.filter((a) => {
    const lower = a.name.toLowerCase();
    if (lower.startsWith('on')) return true; // 이벤트 핸들러 전부(ONMouseOver 포함)
    if (lower === 'formaction') return true; // 버튼이 폼 목적지를 바꾼다
    if (lower === 'srcdoc') return true; // iframe 안에 문서를 통째로 심는다
    if (RAW_URL_ATTRS.has(lower)) return !rawUrlAllowed(name, lower, a.value);
    return false;
  });
  if (drop.length === 0) return tag;
  let out = '';
  let cursor = 0;
  for (const a of drop) {
    // 앞선 공백까지 함께 지운다 — 속성만 빼면 `<a  >` 처럼 공백이 남는다
    let start = a.start;
    while (start > nameEnd && /\s/.test(tag[start - 1])) start -= 1;
    out += tag.slice(cursor, start);
    cursor = a.end;
  }
  return out + tag.slice(cursor);
}

/**
 * 원문 모드 정화 — "위험한 것만 골라 빼고 나머지는 전부 통과"(위 블록 주석 참조).
 * 관리자가 body_raw 를 켠 게시물의 저장 경로에서만 호출한다.
 */
export function scrubRawHtml(html: string | null | undefined): string {
  const src = (html ?? '').trim();
  if (!src) return '';
  let out = '';
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, lt);
    const rest = src.slice(lt);

    // 주석·선언(DOCTYPE·CDATA) — 원문 그대로
    if (rest.startsWith('<!--')) {
      const end = src.indexOf('-->', lt + 4);
      const stop = end === -1 ? src.length : end + 3;
      out += src.slice(lt, stop);
      i = stop;
      continue;
    }
    if (rest.startsWith('<!') || rest.startsWith('<?')) {
      const end = src.indexOf('>', lt + 2);
      const stop = end === -1 ? src.length : end + 1;
      out += src.slice(lt, stop);
      i = stop;
      continue;
    }

    const isEnd = rest.startsWith('</');
    const nameMatch = /^<\/?([a-zA-Z][^\s/>]*)/.exec(rest);
    if (!nameMatch) {
      // 태그가 아닌 '<' — 본문 글자다
      out += '<';
      i = lt + 1;
      continue;
    }
    const name = nameMatch[1].toLowerCase();

    // 태그 끝 찾기 — 따옴표 안의 '>' 는 태그를 끝내지 않는다
    let k = lt + nameMatch[0].length;
    let quote = '';
    while (k < src.length) {
      const c = src[k];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      k += 1;
    }
    const tagEnd = k < src.length ? k + 1 : src.length;
    const tag = src.slice(lt, tagEnd);

    if (RAW_DROP_WITH_CONTENT.has(name)) {
      if (isEnd) {
        i = tagEnd; // 짝 없는 </script> — 조용히 버린다
        continue;
      }
      // 내용째 제거: 닫는 태그까지(없으면 끝까지) 통째로 버린다
      const closeAt = src.toLowerCase().indexOf(`</${name}`, tagEnd);
      if (closeAt === -1) {
        i = src.length;
        continue;
      }
      const closeGt = src.indexOf('>', closeAt);
      i = closeGt === -1 ? src.length : closeGt + 1;
      continue;
    }

    if (RAW_DROP_TAG.has(name)) {
      i = tagEnd; // 태그만 제거 — 자식(대체 콘텐츠)은 이어서 그대로 처리된다
      continue;
    }

    out += isEnd ? tag : scrubRawTag(tag, name, nameMatch[0].length);
    i = tagEnd;

    // style·textarea 등은 내용이 태그가 아니다 — 닫는 태그까지 원문 그대로 지난다
    if (!isEnd && RAW_TEXT_TAGS.has(name) && !tag.endsWith('/>')) {
      const closeAt = src.toLowerCase().indexOf(`</${name}`, i);
      if (closeAt === -1) {
        out += src.slice(i);
        i = src.length;
      } else {
        out += src.slice(i, closeAt);
        i = closeAt;
      }
    }
  }
  return out;
}
