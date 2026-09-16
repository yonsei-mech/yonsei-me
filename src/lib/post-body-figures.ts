// 게시물 본문 후처리 — 사진 캡션을 figure/figcaption 으로 감싼다.
//
// 저장 형식과 표시 형식을 일부러 갈라 둔 자리다. **저장은 `<img data-caption="…">`**
// 한 속성뿐이고(에디터 스키마 rte-schema.ts 의 RteImage), figure 는 서버 렌더 직전에
// 여기서 만들어진다. figure 를 문서에 저장하지 않는 이유:
//   - 정렬(data-align)·폭(widthPct)은 img 노드의 속성이다. figure 로 감싸면 Tiptap
//     이 문서를 되읽을 때(재편집) 감싼 구조를 보존할 노드가 없어 속성이 새어 나간다.
//   - 이미 3,600여 건 있는 게시물이 전부 맨 img 라, 저장 형식을 바꾸면 두 형식을
//     동시에 다루게 된다.
// 그래서 왕복(편집 ↔ 저장)은 img 한 형식만 알고, 공개 화면만 figure 를 본다.
//
// 구현이 정규식이 아니라 파서(htmlparser2)인 이유: `<img alt="a > b">` 처럼 속성값
// 안의 '>' 를 정규식은 태그 끝으로 읽는다. 대신 **파서로 위치만 얻고 원문은 손대지
// 않는다** — figure 여는/닫는 조각만 끼워 넣고 나머지 바이트는 그대로 흘린다
// (재직렬화하면 따옴표·엔티티 표기가 미묘하게 달라진다. lib/admin/sanitize.ts 의
// scrubRawHtml 이 같은 이유로 같은 방식을 쓴다).
//
// ⚠️ htmlparser2 는 sanitize-html 의 의존성으로 이미 설치돼 있다(node_modules 루트에
// 호이스팅). 새 패키지를 받지 않으려고 그대로 쓴다 — sanitize-html 을 걷어낼 일이
// 생기면 이 import 도 함께 봐야 한다.

import { Parser } from 'htmlparser2';

/** figure 를 안에 둘 수 없는 부모 — 인라인 문맥이거나 이미 감싼 경우.
 *  `<p>` 안에 figure 를 넣으면 브라우저가 p 를 강제로 닫아 DOM 이 마크업과 달라진다.
 *  이런 자리의 이미지는 캡션 없이 원문 그대로 지나간다(data-caption 은 남는다). */
const INLINE_PARENTS = new Set([
  'p', 'a', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark',
  'sup', 'sub', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'figure', 'figcaption', 'label', 'button',
]);

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Splice {
  /** 원문에서의 삽입 위치(이 인덱스 **앞**에 끼워 넣는다) */
  at: number;
  text: string;
}

/**
 * `img[data-caption]` 을 `<figure class="post-figure">…<figcaption>` 으로 감싼다.
 * 캡션이 없거나 인라인 문맥(p 안 등)에 있는 이미지는 건드리지 않는다.
 * 입력이 비어 있으면 빈 문자열을 돌려준다. **정화된 HTML 에만 쓸 것** —
 * 이 함수는 안전성을 더해 주지 않는다(캡션 텍스트만 이스케이프한다).
 */
export function wrapCaptionedImages(html: string | null | undefined): string {
  const src = html ?? '';
  if (!src || !src.includes('data-caption')) return src;

  const splices: Splice[] = [];
  const stack: string[] = [];

  // 콜백 안에서 parser 를 되짚는다(startIndex/endIndex) — 콜백이 실제로 도는 건
  // 아래 write() 안이라 초기화가 끝난 뒤다(TDZ 아님).
  const parser: Parser = new Parser(
    {
      onopentag(name, attribs) {
        if (name === 'img') {
          const caption = (attribs['data-caption'] ?? '').trim();
          const parent = stack[stack.length - 1];
          if (caption && !(parent && INLINE_PARENTS.has(parent))) {
            // startIndex/endIndex 는 이 콜백이 도는 동안의 태그 경계다(endIndex 는 포함)
            splices.push({ at: parser.startIndex, text: '<figure class="post-figure">' });
            splices.push({
              at: parser.endIndex + 1,
              text: `<figcaption>${escapeText(caption)}</figcaption></figure>`,
            });
          }
        }
        stack.push(name);
      },
      onclosetag() {
        stack.pop();
      },
    },
    // 기본값 그대로(태그·속성명 소문자화, 엔티티 해석) — 속성값을 디코드해서 받아야
    // 캡션을 다시 이스케이프할 때 이중 인코딩(&amp;amp;)이 생기지 않는다.
    { decodeEntities: true },
  );
  parser.write(src);
  parser.end();

  if (splices.length === 0) return src;

  // 위치는 이미 문서 순서다(파서가 앞에서 뒤로 훑는다) — 순서대로 잘라 붙인다
  let out = '';
  let cursor = 0;
  for (const splice of splices) {
    out += src.slice(cursor, splice.at) + splice.text;
    cursor = splice.at;
  }
  return out + src.slice(cursor);
}
