// 에디터 스키마 확장 — 표·이미지에 "디자인 토큰 열거형" 속성을 붙인다.
//
// 자유 CSS(style) 가 아니라 data 속성 열거형인 이유: 값 집합이 CSS 한 곳
// (globals.css 의 .prose-content)에 갇히므로 관리자가 사이트 톤을 벗어난 표를
// 만들 수 없고, 정화 화이트리스트도 넓힐 필요가 없다(값은 escape 될 뿐 실행 경로가 없다).
// 셀 배경과 이미지 폭만은 값이 연속적이라 인라인 style 로 두되, 정화 쪽에서
// 색은 hex/rgb, 폭은 백분율만 통과시킨다(lib/admin/sanitize.ts).
//
// TableKit 대신 개별 확장 4종을 쓰는 이유는 단순하다 — .extend() 로 속성을 더하려면
// 노드 하나하나를 직접 잡아야 한다. 구성은 TableKit 이 하던 것과 동일하다.

import { Extension } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow, TableView } from '@tiptap/extension-table';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    rteTable: {
      /** 커서가 들어 있는 표의 테두리 속성(border/borderColor)을 바꾼다 */
      setTableAttrs: (attrs: {
        border?: TableBorder | null;
        borderColor?: TableBorderColor | null;
        cellpad?: TableCellpad | null;
      }) => ReturnType;
      /** 커서가 들어 있는 표의 모든 열 폭(colwidth)을 지운다 — 자동 폭 복귀 */
      resetColumnWidths: () => ReturnType;
    };
    rteTableRow: {
      /** 커서가 들어 있는 표의 모든 행 높이를 "지금 가장 높은 행"에 맞춘다 */
      equalizeRowHeights: () => ReturnType;
      /** 커서가 들어 있는 표의 행 높이 지정을 모두 지운다 — 내용 높이 복귀 */
      resetRowHeights: () => ReturnType;
    };
  }
}

/** 행 최소 높이(px) — 이보다 낮추면 한 줄 글자가 셀 밖으로 밀린다.
 *  드래그 클램프(rte-row-resize.ts)와 커맨드가 같은 값을 쓴다. */
export const MIN_ROW_HEIGHT = 24;

/** 표 테두리 굵기(px 토큰) — null(미지정)은 구형 에디토리얼 톤(레거시 게시물용).
 *  값이 자유 px 가 아니라 토큰인 이유: CSS 열거로만 효과가 나 정화를 넓힐 필요가 없다. */
export const TABLE_BORDERS = ['0', '1', '2', '3', '4'] as const;
export type TableBorder = (typeof TABLE_BORDERS)[number];

/** 구 토큰(v1) → px 토큰. 이미 저장된 글을 다시 열면 여기서 승격되고, CSS 는
 *  재저장 전의 게시물을 위해 구 토큰 규칙도 함께 유지한다(globals.css). */
const LEGACY_BORDERS: Record<string, TableBorder> = { none: '0', thin: '1', thick: '2' };

/** 표 테두리 색 — 브랜드 토큰 이름(실제 색은 globals.css). black 이 기본 폴백과 동색.
 *  lightgray(#DDD)는 구형 CMS(Froala) 기본 테두리색 파리티 — 새 표의 초기값. */
export const TABLE_BORDER_COLORS = ['black', 'navy', 'blue', 'sky', 'red', 'gray', 'lightgray'] as const;
export type TableBorderColor = (typeof TABLE_BORDER_COLORS)[number];

/** 셀 여백 프리셋 — null(보통, 8px 10px)이 기본. 값은 globals.css 열거 */
export const TABLE_CELLPADS = ['narrow', 'wide'] as const;
export type TableCellpad = (typeof TABLE_CELLPADS)[number];

/**
 * 표 노드뷰 — prosemirror-tables 의 TableView 는 <table> DOM 을 처음부터 직접
 * 만들면서 renderHTML 산출 속성을 입히지 않는다(실측: 문서 상태에는 data-border 가
 * 있는데 편집 화면 DOM 에는 없음). 생성·갱신 양쪽에서 우리 표 속성을 손수 입힌다.
 * 저장 경로(getHTML)는 renderHTML 을 타므로 이 클래스와 무관하게 항상 옳다.
 */
export class RteTableView extends TableView {
  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    view?: EditorView,
    HTMLAttributes?: Record<string, unknown>,
  ) {
    super(node, cellMinWidth, view, HTMLAttributes);
    this.syncTableAttrs(node);
  }

  update(node: ProseMirrorNode): boolean {
    const handled = super.update(node);
    if (handled) this.syncTableAttrs(node);
    return handled;
  }

  private syncTableAttrs(node: ProseMirrorNode) {
    const sync = (attr: string, value: unknown) => {
      if (value) this.table.setAttribute(attr, String(value));
      else this.table.removeAttribute(attr);
    };
    sync('data-border', node.attrs.border);
    sync('data-border-color', node.attrs.borderColor);
    sync('data-cellpad', node.attrs.cellpad);
  }
}

/** 열거형 밖의 값은 버린다 — 손으로 편집된 HTML 을 되읽어도 스키마가 오염되지 않게 */
function pickEnum(value: string | null, allowed: readonly string[]): string | null {
  return value && allowed.includes(value) ? value : null;
}

export const RteTable = Table.extend({
  // ⚠️ updateAttributes('table') 은 셀 안의 TextSelection 에서 조상 표 노드에
  // 닿지 않는다(3.27 실측 — 같은 선택에서 굵게 토글은 되는데 표 속성만 무반응).
  // 그래서 $from 의 조상 사슬을 직접 걸어 올라가 표를 찾는 커맨드를 둔다.
  addCommands() {
    return {
      ...this.parent?.(),
      setTableAttrs:
        (attrs) =>
        ({ tr, dispatch }) => {
          // state 가 아니라 tr 의 selection 을 읽는다 — 체인 중간(예: 삽입 직후)에도
          // 앞 커맨드가 만든 선택을 이어받아 한 트랜잭션(=undo 한 번)으로 묶인다.
          // 편집 화면 DOM 반영은 RteTableView(생성·update 양쪽)가 책임진다.
          const { $from } = tr.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth);
            if (node.type.name === this.name) {
              if (dispatch) {
                tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, ...attrs });
              }
              return true;
            }
          }
          return false;
        },
      resetColumnWidths:
        () =>
        ({ tr, dispatch }) => {
          const { $from } = tr.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            const table = $from.node(depth);
            if (table.type.name === this.name) {
              if (dispatch) {
                const tablePos = $from.before(depth);
                // colwidth 는 셀 속성이라 폭 제거도 셀 단위다. setNodeMarkup 은
                // 문서 크기를 바꾸지 않으므로 순회 중 위치가 밀리지 않는다.
                table.descendants((cell, rel) => {
                  if (
                    (cell.type.name === 'tableCell' || cell.type.name === 'tableHeader') &&
                    cell.attrs.colwidth
                  ) {
                    tr.setNodeMarkup(tablePos + 1 + rel, undefined, {
                      ...cell.attrs,
                      colwidth: null,
                    });
                  }
                  return true;
                });
              }
              return true;
            }
          }
          return false;
        },
    };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      border: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-border');
          if (!raw) return null;
          return pickEnum(LEGACY_BORDERS[raw] ?? raw, TABLE_BORDERS);
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.border ? { 'data-border': attributes.border } : {},
      },
      cellpad: {
        default: null,
        parseHTML: (element: HTMLElement) => pickEnum(element.getAttribute('data-cellpad'), TABLE_CELLPADS),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.cellpad ? { 'data-cellpad': attributes.cellpad } : {},
      },
      borderColor: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          pickEnum(element.getAttribute('data-border-color'), TABLE_BORDER_COLORS),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.borderColor ? { 'data-border-color': attributes.borderColor } : {},
      },
    };
  },
});

/** 커서가 든 표를 조상 사슬에서 찾아 [표 노드, 표 위치] 를 돌려준다(못 찾으면 null).
 *  표 속성 커맨드와 같은 이유로 updateAttributes 를 못 쓴다 — RteTable 상단 주석 참고. */
function findTable($from: ResolvedPos): [PMNode, number] | null {
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'table') return [node, $from.before(depth)];
  }
  return null;
}

/** 표의 각 행을 [행 노드, 행 위치] 로 훑는다. setNodeMarkup 은 문서 크기를 바꾸지
 *  않으므로 순회 중에 위치가 밀리지 않는다(열 폭 초기화와 같은 전제). */
function forEachRow(table: PMNode, tablePos: number, fn: (row: PMNode, rowPos: number) => void) {
  table.forEach((row, offset) => {
    if (row.type.name === 'tableRow') fn(row, tablePos + 1 + offset);
  });
}

export const RteTableRow = TableRow.extend({
  addCommands() {
    return {
      ...this.parent?.(),
      equalizeRowHeights:
        () =>
        ({ tr, dispatch, view }) => {
          const found = findTable(tr.selection.$from);
          if (!found) return false;
          if (dispatch) {
            const [table, tablePos] = found;
            // "지금 그려진" 높이를 잰다 — 내용이 가장 많은 행에 맞춰야 글자가
            // 잘리지 않는다(rowheight 는 최소 높이 시맨틱이라 더 늘어날 수는 있다).
            // ⚠️ rect 가 아니라 offsetHeight 다: 편집 캔버스(PostCanvas)의 CSS zoom 아래에서
            // rect 는 화면 px 라 zoom 0.8 이면 실제보다 20% 작은 값이 문서에 박힌다.
            // rowheight 는 레이아웃 값이므로 같은 단위인 offsetHeight 로 재야 한다.
            let max = 0;
            forEachRow(table, tablePos, (_row, rowPos) => {
              const dom = view.nodeDOM(rowPos);
              if (dom instanceof HTMLElement) max = Math.max(max, dom.offsetHeight);
            });
            const height = Math.max(MIN_ROW_HEIGHT, Math.ceil(max));
            forEachRow(table, tablePos, (row, rowPos) => {
              if (row.attrs.rowheight === height) return;
              tr.setNodeMarkup(rowPos, undefined, { ...row.attrs, rowheight: height });
            });
          }
          return true;
        },
      resetRowHeights:
        () =>
        ({ tr, dispatch }) => {
          const found = findTable(tr.selection.$from);
          if (!found) return false;
          if (dispatch) {
            const [table, tablePos] = found;
            forEachRow(table, tablePos, (row, rowPos) => {
              if (row.attrs.rowheight == null) return;
              tr.setNodeMarkup(rowPos, undefined, { ...row.attrs, rowheight: null });
            });
          }
          return true;
        },
    };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      // 행 높이는 <tr style="height:Npx"> 로 직렬화한다 — 브라우저가 tr 의 height 를
      // "최소 높이"로 다루므로 게시 화면(.prose-content)에 추가 CSS 가 필요 없다.
      // 값이 연속적이라(드래그 결과) data 열거형이 아니라 인라인 style 이고,
      // 정화(sanitize.ts)가 tr 의 height 를 px 패턴으로만 통과시킨다.
      rowheight: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const m = /^(\d+)px$/.exec(element.style.height || '');
          return m ? Number(m[1]) : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.rowheight ? { style: `height: ${attributes.rowheight}px` } : {},
      },
    };
  },
});

/** 셀 배경 — 속성명을 backgroundColor 로 두면 표 확장의 setCellAttribute 가 그대로 먹는다 */
const cellBackground = {
  backgroundColor: {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.backgroundColor ? { style: `background-color: ${attributes.backgroundColor}` } : {},
  },
};

export const RteTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackground };
  },
});

export const RteTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackground };
  },
});

/* ── 손으로 쓴 style 의 왕복 보존 ──────────────────────────────────────
   코드뷰(HTML 소스)로 붙여넣은 구형 디자인 공지의 style 은 Tiptap 스키마가 모르는
   속성이라, WYSIWYG 로 돌아오는 순간(setContent → DOM 파싱) 통째로 증발한다.
   그래서 원문 style 문자열을 그대로 실어 나르는 전역 속성을 둔다. 값 검사는 하지
   않는다 — 저장 경로의 단일 경계는 정화(lib/admin/sanitize.ts)의 값 패턴이고,
   여기서 또 거르면 두 곳이 어긋날 때 조용히 서식이 사라진다.

   ⚠️ 각 노드 확장이 **이미 관리하는 선언**은 떼고 실어야 한다. 그대로 두면 같은
   속성이 두 번 찍히고, 어느 쪽이 이기는지가 확장 등록 순서에 달리게 된다.
   ⚠️ table 은 일부러 뺐다 — Table 확장의 renderHTML 이 "style 이 있으면 계산한
   열 폭(width/min-width)을 통째로 그 값으로 대체"하는 구조라(3.30 실측), 전역
   style 을 붙이면 드래그한 열 폭이 조용히 사라진다. 표에 새로 허용한 유일한
   선언인 border-collapse 는 게시 화면 CSS 가 이미 collapse 로 고정하고 있다. */
const MANAGED_STYLES: Record<string, readonly string[]> = {
  paragraph: ['text-align'], // TextAlign 확장이 관리
  heading: ['text-align'],
  tableRow: ['height'], // RteTableRow.rowheight
  // 셀의 text-align 은 표 확장의 align 속성이, 배경은 위 cellBackground 가 관리한다
  // (background 축약형도 DOM 의 style.backgroundColor 로 읽히므로 그쪽이 받아 간다)
  tableCell: ['text-align', 'background', 'background-color'],
  tableHeader: ['text-align', 'background', 'background-color'],
};

/** style 문자열에서 managed 선언만 떼고 되돌린다(남는 게 없으면 null) */
function carryStyle(raw: string | null, managed: readonly string[]): string | null {
  if (!raw) return null;
  const kept = raw
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => {
      const i = decl.indexOf(':');
      return i > 0 && !managed.includes(decl.slice(0, i).trim().toLowerCase());
    });
  return kept.length > 0 ? kept.join('; ') : null;
}

export const RteStyleCarry = Extension.create({
  name: 'rteStyleCarry',
  addGlobalAttributes() {
    return Object.entries(MANAGED_STYLES).map(([type, managed]) => ({
      types: [type],
      attributes: {
        style: {
          default: null,
          parseHTML: (element: HTMLElement) => carryStyle(element.getAttribute('style'), managed),
          renderHTML: (attributes: Record<string, unknown>) =>
            attributes.style ? { style: String(attributes.style) } : {},
        },
      },
    }));
  },
});

/** 이미지 정렬 — 좌/중/우. margin 규칙은 globals.css 가 갖는다 */
export const IMAGE_ALIGNS = ['left', 'center', 'right'] as const;
export type ImageAlign = (typeof IMAGE_ALIGNS)[number];

/** 사진 캡션 최대 길이 — 사진 아래 한두 줄용이다.
 *  ⚠️ 정화(lib/admin/sanitize.ts)에도 같은 값이 **따로** 있다 — 그 파일은 의존성이
 *  sanitize-html 하나뿐이어야 한다는 계약(그 파일 상단 주석)이라 import 로 묶지 못한다.
 *  둘 중 하나를 고치면 반드시 나머지도 고칠 것. */
export const IMAGE_CAPTION_MAX = 300;

export const RteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // 캡션 — **img 의 속성 하나**로 저장한다(figure 노드가 아니라).
      // 이유: 정렬(data-align)·폭(widthPct)·표 안 배치 같은 기존 이미지 기능이
      // 전부 img 노드에 붙어 있어서, figure 로 감싸는 순간 재편집 왕복(HTML →
      // Tiptap → HTML)에서 그 속성들이 새어 나간다. 공개 화면의 figure/figcaption
      // 은 서버 렌더 직전에 wrapCaptionedImages(lib/post-body-figures.ts)가 만든다.
      'data-caption': {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = (element.getAttribute('data-caption') ?? '').trim();
          return raw ? raw.slice(0, IMAGE_CAPTION_MAX) : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const raw = typeof attributes['data-caption'] === 'string' ? attributes['data-caption'].trim() : '';
          return raw ? { 'data-caption': raw.slice(0, IMAGE_CAPTION_MAX) } : {};
        },
      },
      'data-align': {
        default: null,
        parseHTML: (element: HTMLElement) => pickEnum(element.getAttribute('data-align'), IMAGE_ALIGNS),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes['data-align'] ? { 'data-align': attributes['data-align'] } : {},
      },
      // 폭은 백분율만 — px 로 두면 모바일에서 본문을 뚫고 나간다(정화도 백분율만 통과)
      widthPct: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const m = /^(\d{1,3})%$/.exec(element.style.width || '');
          return m ? Number(m[1]) : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.widthPct ? { style: `width: ${attributes.widthPct}%` } : {},
      },
    };
  },
});

/* ── Q&A 문단 (동문 인터뷰 도구) ──────────────────────────────────────
   질문·답변을 별도 노드로 만들지 않고 **문단의 속성**으로 둔다: 노드를 새로
   만들면 기존 게시물(전부 paragraph)과 스키마가 갈리고, 정렬·글꼴·목록 같은
   문단 기능을 전부 다시 구현해야 한다. 속성이면 문단 하나에 라벨만 붙는 꼴이라
   toggle 이 자연스럽고, 라벨을 떼면 평범한 문단으로 돌아간다.
   저장 형식은 `<p data-role="q|a">` — 정화(sanitize.ts)가 q|a 만 통과시킨다. */

/** 문단 역할 — 질문/답변. 그 외 값은 파싱 단계에서 버린다 */
export const PARAGRAPH_ROLES = ['q', 'a'] as const;
export type ParagraphRole = (typeof PARAGRAPH_ROLES)[number];

export const RteParagraphRole = Extension.create({
  name: 'rteParagraphRole',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          role: {
            default: null,
            // ⚠️ keepOnSplit:false — Enter 로 나뉜 다음 문단은 **라벨 없는** 평범한
            // 문단이다. 기본값(true)이면 답변 끝에서 Enter 를 친 마무리 문단까지
            // 조용히 'A' 마커를 달고 공개 화면에 나간다. 라벨은 명시적으로 켜는 것.
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) =>
              pickEnum((element.getAttribute('data-role') ?? '').toLowerCase(), PARAGRAPH_ROLES),
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.role ? { 'data-role': String(attributes.role) } : {},
          },
        },
      },
    ];
  },
});
