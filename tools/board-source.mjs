/**
 * 원본 게시판(me.yonsei.ac.kr/me/community/*.do) 파싱 모듈 (개발 전용)
 *
 * 크롤러(tools/crawl-boards.mjs)와 후속 정규화 스크립트가 같은 파싱 규칙을 보게 하려고
 * 파서만 따로 떼어냈다. 여기는 "원본 HTML → 원시 레코드"까지만 책임진다. 본문 정리·요약·
 * 이미지 재호스팅 같은 가공은 전부 다음 단계 몫이다 — 그래서 bodyHtml 은 손대지 않고
 * 원문 그대로 넘긴다.
 *
 * 의존성 없음: Node 24 내장 fetch 만 쓴다(cheerio/jsdom 등 설치 금지).
 *
 * 원본 마크업에서 반드시 알아야 할 세 가지(실측 · 여기서 시간 다 날린다)
 *   ① 표형 목록의 제목 <a> 는 **href 가 class 보다 먼저** 나온다.
 *      `<a href="?mode=view&amp;articleNo=475698…" class="c-board-title">`
 *      그래서 `<a[^>]*class="c-board-title"[^>]*href=` 로 쓰면 0건이 잡힌다.
 *      아래 파서는 <a> 태그를 먼저 통째로 잡고 속성은 따로 검사한다.
 *   ② 날짜는 <div class="c-board-info-m"> 안의 두 번째 <span>(`2026.07.29`, 네 자리 연도)을
 *      쓴다. 맨 뒤 <td> 에도 날짜가 있지만 `26.07.29` 두 자리라 세기 추정이 필요해진다.
 *   ③ 상세 페이지의 라벨 블록은 `board-write-box-v01` 이 제목과 첨부에 중복으로 쓰인다.
 *      클래스 번호가 아니라 <dt> 텍스트(제목/작성일/작성자/게시글 내용/첨부)로 분기해야 한다.
 *   ④ 본문 마크업이 **두 가지**다(실측). 에디터로 쓴 글은 `<div class="fr-view">…</div>`,
 *      평문으로 붙여넣은 글은 `<pre class="pre">…</pre>` 로 온다. fr-view 가 없다고 본문이
 *      없는 게 아니다 — 그래서 fr-view 를 찾는 대신 `게시글 내용` <dd> 를 통째로 잡는다.
 *
 * 뉴스(news.do)만 갤러리 마크업이라 목록 파서가 완전히 다르다(parseNewsList).
 * 상세 페이지 마크업은 열 개 게시판이 전부 같다(parseDetail).
 */

export const ORIGIN = 'https://me.yonsei.ac.kr';
export const BASE = `${ORIGIN}/me/community`;

export const DELAY_MS = 300;
export const TIMEOUT_MS = 15000;

/**
 * 게시판 표. key 는 다음 단계(DB 적재)가 그대로 쓰는 식별자라 바꾸면 안 된다.
 * label 은 진행 로그용 짧은 이름, origin 은 원본 사이트에 적힌 게시판 이름.
 * gallery=true 인 뉴스만 목록 마크업이 다르다.
 *
 * 선택 필드
 *   base        구 사이트에서 이 게시판이 사는 디렉터리. 기본값은 `${ORIGIN}/me/community`
 *               라 아래 열 개는 적지 않는다 — **적지 않은 게시판의 URL 은 한 글자도
 *               바뀌면 안 된다**(source_url 이 DB 멱등 키다).
 *   dbBoard     적재 시 posts.board 에 들어갈 값. 없으면 key 그대로. 구 사이트의 두
 *               게시판을 새 사이트 한 게시판으로 합칠 때만 쓴다(BK21 자료실+사업성과).
 *   defaultCategory / categoryByArticleNo
 *               합친 게시판을 다시 가르는 분류값. 글별 예외가 뒤 표에서 이긴다.
 */
export const BOARDS = [
  { key: 'noticesUndergrad', path: 'notice.do', label: '학부공지', origin: '학부 공지사항' },
  { key: 'noticesGraduate', path: 'notice2.do', label: '대학원공지', origin: '대학원 공지사항' },
  { key: 'noticesExternal', path: 'notice3.do', label: '외부기관공지', origin: '외부기관 공지사항' },
  { key: 'noticesScholarship', path: 'notice4.do', label: '장학공고', origin: '장학생 선발공고' },
  { key: 'news', path: 'news.do', label: '뉴스', origin: '뉴스', gallery: true },
  { key: 'thesis', path: 'degree_thesis_review.do', label: '학위논문심사', origin: '학위논문심사' },
  { key: 'resources', path: 'information.do', label: '자료실', origin: '자료실' },
  { key: 'career', path: 'job.do', label: '취업정보', origin: '취업 정보' },
  { key: 'events', path: 'seminar_graduate1.do', label: '행사', origin: '행사' },
  { key: 'seminars', path: 'seminar.do', label: '세미나', origin: '세미나' },
  // BK21 자료실·사업성과 — 구 사이트에서는 /me/bk21/ 아래에 있고 새 사이트에서는 한
  // 게시판(bk21Resources)의 분류 두 개다. files.do 는 규정·지침이 대부분이라 기본값을
  // 'rule' 로 두고, 서식 글(114095 학생 신청 서식) 하나만 표로 예외 처리한다.
  {
    key: 'bk21Files',
    base: `${ORIGIN}/me/bk21`,
    path: 'files.do',
    label: 'BK21 자료실',
    origin: 'BK21 자료실',
    dbBoard: 'bk21Resources',
    defaultCategory: 'rule',
    categoryByArticleNo: { '114095': 'form' },
  },
  {
    key: 'bk21Results',
    base: `${ORIGIN}/me/bk21`,
    path: 'progress.do',
    label: 'BK21 사업성과',
    origin: 'BK21 사업성과',
    dbBoard: 'bk21Resources',
    defaultCategory: 'result',
  },
];

/** 이 게시판이 사는 디렉터리 — 표에 base 가 없으면 구 커뮤니티 게시판이다. */
export function baseOf(board) {
  return (typeof board === 'object' && board?.base) || BASE;
}

export const BOARD_BY_KEY = new Map(BOARDS.map((b) => [b.key, b]));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── URL ────────────────────────────────────────────────────────
/**
 * 목록 URL. articleLimit 을 크게 주면 게시판 전체가 한 응답에 실려 온다(실측: 최대 936행이
 * 잘리지 않고 온다). 그래서 페이지네이션 루프가 아예 필요 없다.
 */
export function listUrl(board, limit = 2000) {
  const path = typeof board === 'string' ? board : board.path;
  return `${baseOf(board)}/${path}?mode=list&articleLimit=${limit}&article.offset=0`;
}

/**
 * 상세 URL. **article.offset/articleLimit 을 붙이지 않은 이 짧은 형태가 정본**이다 —
 * 다음 단계에서 DB 유니크 키로 쓰이므로 문자 하나까지 안정적이어야 한다.
 *
 * 인자는 게시판 표의 항목(권장) 또는 path 문자열이다. 문자열이면 base 를 알 수 없으니
 * 구 커뮤니티 디렉터리로 본다 — 기존 호출부 호환용.
 */
export function viewUrl(board, articleNo) {
  const path = typeof board === 'string' ? board : board.path;
  return `${baseOf(board)}/${path}?mode=view&articleNo=${articleNo}`;
}

/** 상대 링크를 절대 URL 로. `?mode=download…` 같은 쿼리-only 링크도 base 기준으로 붙는다. */
export function absolutize(href, base) {
  if (href == null) return null;
  const h = decodeEntities(String(href)).trim();
  if (!h) return null;
  try {
    return new URL(h, base).toString();
  } catch {
    return h;
  }
}

// ── HTML 유틸 (crawl-faculty-profiles.mjs 와 같은 손맛) ──────────
/** 엔티티 최소 6종 + 숫자 참조를 되돌린다. 사이트가 그 이상은 쓰지 않는다(실측). */
export function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** 태그를 걷어내고 공백을 접는다. 제목·작성자·요약처럼 "텍스트만" 필요한 곳에만 쓴다. */
export function text(html) {
  if (html == null) return '';
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** `2026.07.29` / `2026-07-29` / `2026/07/29` → `2026-07-29`. 못 읽으면 null. */
export function normDate(s) {
  const m = String(s ?? '').match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/**
 * startIdx 의 여는 태그부터 짝이 맞는 닫는 태그까지를 통째로 잘라 준다.
 * 게으른 `[\s\S]*?</div>` 로는 중첩 <div> 에서 본문이 잘려 나가기 때문에 필요하다
 * (본문 fr-view 안에 <div> 가 겹겹이 들어있는 글이 흔하다).
 */
export function balancedBlock(html, startIdx, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = startIdx;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) {
      depth -= 1;
      if (depth <= 0) return html.slice(startIdx, m.index + m[0].length);
    } else {
      depth += 1;
    }
  }
  return null; // 닫는 태그가 모자란 깨진 마크업
}

/** 여는/닫는 태그 한 겹을 벗겨 안쪽만 남긴다. */
function stripOuterTag(block, tag) {
  return block
    .replace(new RegExp(`^<${tag}\\b[^>]*>`, 'i'), '')
    .replace(new RegExp(`</${tag}\\s*>\\s*$`, 'i'), '');
}

/**
 * 같은 층위의 <tag> 블록을 차례로 내놓는다 → { attrs, inner }.
 * 게으른 `<li>…</li>` 로 자르면 뉴스 항목처럼 **안에 <ul><li> 가 또 든 경우** 첫 번째
 * 안쪽 </li> 에서 끊겨 버린다(파일 아이콘을 놓친다). 그래서 짝을 세어 자르고,
 * 닫는 태그가 모자란 깨진 마크업에서만 게으른 방식으로 물러선다.
 */
function* blocksOf(html, tag) {
  const openRe = new RegExp(`<${tag}\\b([^>]*)>`, 'gi');
  const lazyRe = new RegExp(`^<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i');
  let m;
  while ((m = openRe.exec(html))) {
    const start = m.index;
    const block = balancedBlock(html, start, tag);
    if (block) {
      yield { attrs: m[1], inner: stripOuterTag(block, tag) };
      openRe.lastIndex = start + block.length;
      continue;
    }
    const lazy = html.slice(start).match(lazyRe);
    if (!lazy) continue;
    yield { attrs: m[1], inner: lazy[1] };
    openRe.lastIndex = start + lazy[0].length;
  }
}

/** 태그 원문에서 속성 하나를 꺼낸다(쌍따옴표·홑따옴표 모두). */
function attr(tagAttrs, name) {
  const m =
    tagAttrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')) ||
    tagAttrs.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? m[1] : null;
}

/** class 속성이 특정 토큰을 정확히 가지고 있는지(부분 문자열 오검출 방지). */
function hasClass(tagAttrs, token) {
  const cls = attr(tagAttrs, 'class');
  return cls ? cls.trim().split(/\s+/).includes(token) : false;
}

// ── 네트워크 ───────────────────────────────────────────────────
/**
 * 학교 서버를 몰아붙이지 않도록 호출부에서 순차 처리 + 요청 사이 DELAY_MS 지연을 지킨다.
 * ⚠️ HEAD 는 WAF 가 403 으로 막는다 — 존재 확인도 GET 으로 해야 한다.
 */
export async function get(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; yonsei-me-site-builder/1.0; +https://me.yonsei.ac.kr/me/community/)',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── 표형 목록 파서 (뉴스를 제외한 9개 게시판) ───────────────────
/**
 * <tbody> 의 <tr> 하나 = 글 하나.
 * 반환: { articleNo, title, author, date, pinned, hasFile }[]
 * hasFile 은 상세 파싱 결과와 교차 검증하는 용도(목록에 클립 아이콘이 있는데 첨부가 0건이면
 * 상세 파서가 뭔가 놓친 것이다).
 */
export function parseTableList(html) {
  const tbody = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
  const scope = tbody ? tbody[1] : html;

  const out = [];
  for (const { attrs: rowAttrs, inner: rowHtml } of blocksOf(scope, 'tr')) {
    if (/<th\b/i.test(rowHtml)) continue; // 헤더행
    if (/colspan/i.test(rowHtml) && !/articleNo=/.test(rowHtml)) continue; // "게시물이 없습니다"

    // ⚠️ href 가 class 보다 먼저 오므로 <a> 를 먼저 잡고 속성을 따로 본다.
    let anchor = null;
    const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let a;
    while ((a = aRe.exec(rowHtml))) {
      if (hasClass(a[1], 'c-board-title') && /articleNo=\d+/.test(a[1])) {
        anchor = a;
        break;
      }
    }
    if (!anchor) continue;

    const articleNo = (anchor[1].match(/articleNo=(\d+)/) || [])[1];
    if (!articleNo) continue;

    // 상단고정 글은 제목 앞에 <span class="c-board-top-num-m">[공지]</span> 를 달고 나온다.
    const title =
      text(anchor[2].replace(/<span\b[^>]*c-board-top-num-m[^>]*>[\s\S]*?<\/span>/gi, '')).replace(
        /^\[공지\]\s*/,
        '',
      ) || null;

    // 작성자/날짜는 모바일용 정보줄에서. 여기 날짜만 네 자리 연도다.
    const info = rowHtml.match(/<div\b[^>]*c-board-info-m[^>]*>([\s\S]*?)<\/div>/i);
    let author = null;
    let date = null;
    if (info) {
      const spans = [...info[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map((s) => text(s[1]));
      author = spans[0] || null;
      date = normDate(spans[1]);
      if (!date) date = normDate(info[1]); // 스팬 순서가 흔들려도 네 자리 날짜는 건진다
    }

    out.push({
      articleNo,
      title,
      author,
      date,
      pinned: /c-board-top-wrap/.test(rowAttrs),
      hasFile: /c-board-file-icon/.test(rowHtml),
    });
  }
  return out;
}

// ── 뉴스 갤러리 목록 파서 (news.do 전용) ────────────────────────
/**
 * <ul class="board-list-wrap"> 의 <li> 하나 = 글 하나. 썸네일과 본문 앞부분이 목록에만
 * 있어서(상세에는 없다) 여기서 뽑아 두어야 한다.
 * 반환: { articleNo, title, author, date, pinned, hasFile, thumbnail, excerpt }[]
 *
 * ⚠️ 날짜는 반드시 <span class="board-list-content-date"> 에서 읽는다. 뉴스 제목은
 * `… 개최 (2026.07.15)` 처럼 **행사 날짜**를 괄호로 달고 다녀서, "<li> 안의 첫 날짜"로
 * 잡으면 게시일(2026.07.22) 대신 행사일이 들어온다. 실제로 그렇게 틀렸었다.
 */
export function parseNewsList(html, base = `${BASE}/news.do`) {
  const ulIdx = html.search(/<ul\b[^>]*class="[^"]*\bboard-list-wrap\b[^"]*"[^>]*>/i);
  const scope = ulIdx >= 0 ? balancedBlock(html, ulIdx, 'ul') || html.slice(ulIdx) : html;

  const out = [];
  for (const { attrs: liAttrs, inner: liHtml } of blocksOf(scope, 'li')) {
    if (!/articleNo=\d+/.test(liHtml)) continue; // 안쪽 아이콘용 <li> 는 여기서 걸러진다

    const titleDt = liHtml.match(
      /<dt\b[^>]*class="[^"]*\bboard-list-content-title\b[^"]*"[^>]*>([\s\S]*?)<\/dt>/i,
    );
    const titleHtml = titleDt ? titleDt[1] : liHtml;

    const articleNo = (titleHtml.match(/articleNo=(\d+)/) || liHtml.match(/articleNo=(\d+)/) || [])[1];
    if (!articleNo) continue;

    // 썸네일: board-list-thumb 앵커 안의 <img>. 못 찾으면 li 안 첫 이미지로 대체.
    let thumbSrc = null;
    const thumbA = liHtml.match(
      /<a\b[^>]*\bboard-list-thumb\b[^>]*>[\s\S]*?<img\b[^>]*src="([^"]+)"/i,
    );
    if (thumbA) thumbSrc = thumbA[1];
    else {
      const anyImg = liHtml.match(/<img\b[^>]*src="([^"]+)"/i);
      if (anyImg) thumbSrc = anyImg[1];
    }

    // 요약: <dd class="board-list-content">. 바로 아래 정보줄이 board-list-content-info 라
    // 접두사가 겹치므로 클래스 토큰 완전일치로 고른다.
    let excerpt = null;
    for (const { attrs, inner } of blocksOf(liHtml, 'dd')) {
      if (hasClass(attrs, 'board-list-content')) {
        excerpt = text(inner) || null;
        break;
      }
    }

    const dateSpan = liHtml.match(
      /<span\b[^>]*class="[^"]*\bboard-list-content-date\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const nameSpan = liHtml.match(
      /<span\b[^>]*class="[^"]*\bboard-list-content-name\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );

    out.push({
      articleNo,
      title: text(titleHtml) || null,
      author: nameSpan ? text(nameSpan[1]) || null : null,
      date: dateSpan ? normDate(text(dateSpan[1])) : null,
      pinned: /c-board-top-wrap/.test(liAttrs),
      hasFile: /c-board-file-icon/.test(liHtml),
      thumbnail: absolutize(thumbSrc, base),
      excerpt,
    });
  }
  return out;
}

/** 게시판 하나의 목록 HTML → 항목 배열. 갤러리/표 분기는 여기서만 한다. */
export function parseList(board, html) {
  return board.gallery
    ? parseNewsList(html, `${baseOf(board)}/${board.path}`)
    : parseTableList(html);
}

// ── 상세 파서 (열 개 게시판 공통) ───────────────────────────────
/** 삭제·없는 articleNo 는 짧은 에러 페이지가 온다. 크래시 대신 이 에러로 알린다. */
export class MissingPostError extends Error {
  constructor(articleNo) {
    super(`글 없음(삭제되었거나 잘못된 articleNo=${articleNo})`);
    this.name = 'MissingPostError';
  }
}

/**
 * 첨부 <dd> → [{ label, ext, url }]. 첨부가 없는 글은 첨부 <dt> 블록 자체가 없다(정상).
 * 링크 텍스트가 원본 파일명, class 의 두 번째 토큰이 확장자다.
 */
export function parseAttachments(ddHtml, base) {
  const out = [];
  if (!ddHtml) return out;
  const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let a;
  while ((a = aRe.exec(ddHtml))) {
    const attrs = a[1];
    if (!hasClass(attrs, 'file-down-btn')) continue;
    const href = attr(attrs, 'href');
    if (!href) continue;
    // class="file-down-btn hwpx" — 표식 토큰을 뺀 나머지 첫 토큰이 확장자.
    const tokens = (attr(attrs, 'class') || '').trim().split(/\s+/);
    const ext = tokens.find((t) => t && t !== 'file-down-btn') || null;
    out.push({ label: text(a[2]) || null, ext, url: absolutize(href, base) });
  }
  return out;
}

/** `게시글 내용` <dt> 뒤에 오는 <dd> 의 [시작, 끝) 위치. 본문 마크업 종류와 무관하게 잡힌다. */
function findBodyRegion(html) {
  const dtRe = /<dt\b[^>]*>([\s\S]*?)<\/dt>/gi;
  let m;
  while ((m = dtRe.exec(html))) {
    if (text(m[1]) !== '게시글 내용') continue;
    const rest = html.slice(m.index + m[0].length);
    const off = rest.search(/<dd\b/i);
    if (off < 0) return null;
    const start = m.index + m[0].length + off;
    // 본문에 <dd> 가 들어있어도 안 잘리게 짝을 세어 닫는다.
    const block = balancedBlock(html, start, 'dd');
    if (block) return { start, end: start + block.length };
    const dl = html.indexOf('</dl>', start); // 닫는 </dd> 가 없는 깨진 마크업
    return { start, end: dl >= 0 ? dl : html.length };
  }
  return null;
}

/**
 * 본문 <dd> 원문 → bodyHtml.
 * fr-view 로 감싼 글은 **그 안쪽만** 꺼낸다(감싸개는 원본 사이트 껍데기라 의미가 없다).
 * 평문 글은 `<pre class="pre">` 태그를 살린 채 넘긴다 — 줄바꿈이 유일한 서식이라
 * 벗겨 버리면 다음 단계에서 문단을 복원할 방법이 없어진다.
 */
function extractBody(ddBlock) {
  const inner = stripOuterTag(ddBlock, 'dd');
  const frIdx = inner.search(/<div\b[^>]*class="[^"]*\bfr-view\b[^"]*"[^>]*>/i);
  if (frIdx < 0) return inner.trim() || null;

  const block = balancedBlock(inner, frIdx, 'div');
  if (block) return stripOuterTag(block, 'div').trim() || null;
  // 닫는 </div> 가 모자란 깨진 본문 — 꼬리 </div> 하나만 떼낸다.
  return (
    inner
      .slice(frIdx)
      .replace(/^<div\b[^>]*>/i, '')
      .replace(/\s*<\/div>\s*$/i, '')
      .trim() || null
  );
}

/**
 * 상세 HTML → { title, date, author, bodyHtml, attachments }
 *
 * 순서가 중요하다: **본문을 먼저 통째로 떼어낸 뒤** 남은 골격에서 <dt> 라벨을 읽는다.
 * 본문에 <dt>/<dl> 이 들어있는 글이 있어서, 그러지 않으면 라벨 파싱이 오염된다.
 * (특히 본문 속 `<dt>첨부</dt>` 가 진짜 첨부 블록을 밀어내는 사고가 난다.)
 *
 * bodyHtml 은 **원문 그대로**다. 정리·정규화는 다음 단계 스크립트 몫이라 여기서 손대면 안 된다.
 */
export function parseDetail(html, { articleNo, pageUrl } = {}) {
  if (/요청하신 페이지가 존재하지 않습니다/.test(html)) throw new MissingPostError(articleNo);

  let bodyHtml = null;
  let chrome = html;
  const region = findBodyRegion(html);
  if (region) {
    bodyHtml = extractBody(html.slice(region.start, region.end));
    chrome = html.slice(0, region.start) + html.slice(region.end);
  }

  // ⚠️ board-write-box-v01 은 제목과 첨부에 중복으로 붙는다. 분기 기준은 <dt> 텍스트뿐이다.
  const fields = new Map();
  const blockRe = /<dt\b[^>]*>([\s\S]*?)<\/dt>([\s\S]*?)(?=<dt\b|$)/gi;
  let b;
  while ((b = blockRe.exec(chrome))) {
    const label = text(b[1]);
    if (!label || fields.has(label)) continue;
    const dd = b[2].match(/<dd\b[^>]*>([\s\S]*?)<\/dd>/i);
    fields.set(label, dd ? dd[1] : b[2]);
  }

  const title = fields.has('제목') ? text(fields.get('제목')) || null : null;
  if (title === null && bodyHtml === null) throw new MissingPostError(articleNo);

  return {
    title,
    date: normDate(text(fields.get('작성일') ?? '')),
    author: (fields.has('작성자') ? text(fields.get('작성자')) : '') || null,
    bodyHtml,
    attachments: parseAttachments(fields.get('첨부'), pageUrl || BASE),
  };
}
