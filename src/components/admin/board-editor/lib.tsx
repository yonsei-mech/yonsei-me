'use client';

// BoardEditor 공유 헬퍼·데이터 — 원본은 RichTextEditor.tsx(스왑 후 원본 삭제 예정).
//
// 구형(Froala 2.5.0, devcms2) 파리티 데이터는 2026-08-18 실측 리버스엔지니어링 값:
// 글꼴 12종 · 크기 10~50px · 색 27+해제(7열, 글자/배경 두 탭) · 표 기본 1px #DDD 격자.
// 구형에 없던 컨트롤(형식·줄간격·인용·첨자·찾기·브랜드 스와치)은 사용자 지시로 제거.

import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { cn } from '@/lib/utils';
import type { TableBorderColor } from '@/lib/admin/rte-schema';

export type SelectOption = { value: string; label: string };

/** 글꼴 — 구형(Froala) 12종 실측 파리티. 저장 정화(sanitize.ts)는 안전 문자클래스로 허용. */
export const FONT_FAMILIES: SelectOption[] = [
  { value: '', label: '기본 글꼴' },
  { value: "'Nanum Gothic', '나눔고딕', sans-serif", label: '나눔고딕' },
  { value: "'Nanum Square', '나눔스퀘어', sans-serif", label: '나눔스퀘어' },
  { value: "'Noto Sans KR', '노토산스KR', sans-serif", label: '노토산스KR' },
  { value: "'돋움', '돋움체', Dotum, sans-serif", label: '돋움' },
  { value: "'굴림', '굴림체', Gulim, sans-serif", label: '굴림' },
  { value: "'궁서', '궁서체', Gungsuh, serif", label: '궁서' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Impact, Charcoal, sans-serif', label: 'Impact' },
  { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
];

/** 글자 크기 — 구형 실측 목록(10~25 연속 + 30~50 5단위) */
export const FONT_SIZES: SelectOption[] = [
  { value: '', label: '기본 크기' },
  ...[10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 30, 35, 40, 45, 50].map(
    (n) => ({ value: `${n}px`, label: `${n}px` }),
  ),
];

/** 색 팔레트 — 구형 Froala colorsText/colorsBackground 실측(동일 27색, 7열 그리드).
 *  글자색·배경색 두 탭이 같은 팔레트를 쓰고, 마지막 셀은 해제(✕)다. */
export const FROALA_COLORS: string[] = [
  '#61BD6D', '#1ABC9C', '#54ACD2', '#2C82C9', '#9365B8', '#475577', '#CCCCCC',
  '#41A85F', '#00A885', '#3D8EB9', '#2969B0', '#553982', '#28324E', '#000000',
  '#F7DA64', '#FBA026', '#EB6B56', '#E25041', '#A38F84', '#EFEFEF', '#FFFFFF',
  '#FAC51C', '#F37934', '#D14841', '#B8312F', '#7C706B', '#D1D5D8',
];
export const COLORS_STEP = 7;

/** 표 셀 배경 — 표 보조 바(구판 기능 유지)용 옅은 면 */
export const CELL_BGS: { value: string | null; label: string }[] = [
  { value: null, label: '없음' },
  { value: '#EAF2FB', label: '연블루' },
  { value: '#F4F5F7', label: '연그레이' },
  { value: '#FBECEA', label: '연레드' },
];

/** 표 테두리 색 스와치 — 값은 토큰 이름, 실제 색은 globals.css.
 *  lightgray(#DDD)는 구형 기본 테두리색 파리티로 추가된 토큰. */
export const BORDER_COLOR_SWATCHES: Record<TableBorderColor, { label: string; css: string }> = {
  black: { label: '검정', css: '#232323' },
  navy: { label: '네이비', css: '#003377' },
  blue: { label: '블루', css: '#0057A8' },
  sky: { label: '스카이', css: '#2E86D6' },
  red: { label: '레드', css: '#C0392B' },
  gray: { label: '그레이', css: '#9CA3AF' },
  lightgray: { label: '연회색(구형 기본)', css: '#DDDDDD' },
};

/** 테두리 굵기 — px 토큰. '' 은 "미지정(null)" = 레거시 게시물의 이전 기본 */
export const BORDER_WIDTHS: SelectOption[] = [
  { value: '0', label: '0px (없음)' },
  { value: '1', label: '1px' },
  { value: '2', label: '2px' },
  { value: '3', label: '3px' },
  { value: '4', label: '4px' },
  { value: '', label: '이전 기본(줄무늬)' },
];

/** 표 스타일 팝오버의 굵기 타일용 짧은 라벨 — 위 라벨의 괄호 설명은 38px 타일에 안 들어간다 */
export const BORDER_WIDTH_TILE_LABELS: Record<string, string> = {
  '0': '0px',
  '1': '1px',
  '2': '2px',
  '3': '3px',
  '4': '4px',
  '': '이전 기본',
};

/** 굵기 타일 위의 미리보기 선 — 굵기를 글자가 아니라 선 자체로 보여준다.
 *  0px(없음)은 옅은 점선, '이전 기본'은 진한 점선으로 "실선 아님"을 표시한다. */
export function borderWidthPreviewStyle(value: string): React.CSSProperties {
  if (value === '0') return { borderTop: '1px dashed #C9CFD6' };
  if (value === '') return { borderTop: '2px dashed #232323' };
  return { borderTop: `${value}px solid #232323` };
}

/** 셀 여백 — 기본(보통)은 py-5 에디토리얼, 좁게/넓게는 globals.css 열거 */
export const CELLPAD_OPTIONS: SelectOption[] = [
  { value: '', label: '보통' },
  { value: 'narrow', label: '좁게' },
  { value: 'wide', label: '넓게' },
];

/** 표 삽입 격자 피커 크기 */
export const GRID_ROWS = 5;
export const GRID_COLS = 8;

/** 보조 바의 입력·확정 버튼 (이미지 대체텍스트) — 버튼은 hover 에서 파란 선으로만
 *  반응한다(면을 채우면 옆의 12px 라운드 아이콘 버튼들과 무게가 겹친다). */
export const PANEL_INPUT =
  'h-7 border border-surface-border bg-surface px-2 text-xs text-content outline-none focus:border-yonsei-blue';
export const PANEL_BTN =
  'h-7 shrink-0 border border-surface-border px-2 text-xs font-medium text-content-soft hover:border-yonsei-blue hover:text-yonsei-blue';

/** 스킴 없는 입력을 https 로 보정 */
export function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return '';
  if (/^(https?:|mailto:|#|\/)/i.test(url)) return url;
  return `https://${url}`;
}

/**
 * 외부 붙여넣기 정화 — 구조(표·목록·링크)만 남기고 표현(class/style/font)은 지운다.
 * 내부 복붙(data-pm-slice)은 통과. 동작 근거 주석은 원본(RichTextEditor.tsx) 참조.
 */
export function cleanPastedHtml(html: string): string {
  if (html.includes('data-pm-slice')) return html;
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  const comments: ChildNode[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode as ChildNode);
  comments.forEach((c) => c.remove());
  doc.body.querySelectorAll('style, script, meta, link, xml').forEach((el) => el.remove());
  const KEEP_ALIGN = /^(left|right|center|justify)$/;
  doc.body.querySelectorAll('*').forEach((el) => {
    const align =
      ((el as HTMLElement).style?.textAlign || el.getAttribute('align') || '').toLowerCase();
    el.removeAttribute('class');
    el.removeAttribute('lang');
    el.removeAttribute('style');
    if (KEEP_ALIGN.test(align)) {
      if (el.matches('td, th')) el.setAttribute('data-keep-align', align);
      else if (el.matches('p, h1, h2, h3, h4, h5')) (el as HTMLElement).style.textAlign = align;
    }
  });
  doc.body.querySelectorAll('td[data-keep-align], th[data-keep-align]').forEach((cell) => {
    const align = cell.getAttribute('data-keep-align')!;
    cell.removeAttribute('data-keep-align');
    const p = doc.createElement('p');
    p.style.textAlign = align;
    while (cell.firstChild) p.appendChild(cell.firstChild);
    cell.appendChild(p);
  });
  doc.body.querySelectorAll('table:not([data-border])').forEach((t) => {
    t.setAttribute('data-border', '1');
  });
  doc.body.querySelectorAll('font').forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
  return doc.body.innerHTML;
}

/**
 * 부분 선택에 블록 명령 적용 — 선택 구간만 잘라(split) 명령을 건다.
 * (정렬을 문장 일부에 걸 때 문단 전체가 변하는 것을 막는 워드 관례)
 */
export function runOnSelection(
  editor: Editor,
  apply: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>,
) {
  const { selection, doc } = editor.state;
  const { from, to, empty } = selection;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const partial =
    !empty &&
    $from.sameParent($to) &&
    $from.parent.isTextblock &&
    !($from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size);

  let chain = editor.chain().focus();
  if (partial) {
    chain = chain.command(({ tr }) => {
      const selFrom = tr.selection.from;
      const selTo = tr.selection.to;
      // 뒤를 먼저 자른다 — 앞을 먼저 자르면 뒤 위치가 밀린다
      const $t = tr.doc.resolve(selTo);
      if ($t.parentOffset < $t.parent.content.size) tr.split(selTo);
      const $f = tr.doc.resolve(selFrom);
      let f = selFrom;
      let t = selTo;
      if ($f.parentOffset > 0) {
        tr.split(selFrom);
        f += 2;
        t += 2;
      }
      tr.setSelection(TextSelection.create(tr.doc, f, t));
      return true;
    });
  }
  apply(chain).run();
}

/* ── 보조 바(표/이미지 컨텍스트)용 소형 프레젠테이션 ──
   2026-08 시안 1a/1d: 보조 바는 툴바와 같은 면(#F5F5F5)에 붙는 인라인 바다.
   버튼 라운드가 12px 인 것은 오타가 아니다 — 이 에디터만 Tiptap UI Components
   스톡 룩(button.scss 의 --tt-radius-lg)을 쓴다. 사이트 본체의 "각진 엣지 ≤2px"
   규칙은 여기 적용되지 않으니 되돌리지 마라. */

/** 그룹 캡션("행"·"열"·"셀"·"정렬"…) — 무엇에 대한 버튼 묶음인지 알려주는 회색 글씨.
 *  span 과 label(대체텍스트 입력) 양쪽에 붙일 수 있게 클래스 문자열로 둔다. */
export const CTX_CAPTION =
  'whitespace-nowrap pl-0.5 pr-[5px] text-[11px] font-bold text-content-faint';

/**
 * 보조 바 버튼 — 아이콘(+선택적 라벨) 한 벌.
 * label 을 주면 아이콘+글자, 안 주면 30×30 정사각 아이콘 버튼이다.
 * hover 배경은 툴바 버튼과 같은 --tt-button-hover-bg-color 를 쓴다 —
 * 팔레트를 갈아도 툴바와 함께 따라오게 하려는 것이니 하드코딩으로 되돌리지 마라.
 */
export function CtxBtn({
  onClick,
  icon,
  label,
  title,
  active,
  disabled = false,
  tone = 'default',
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label?: string;
  title: string;
  /** 토글 버튼만 넘긴다 — 안 넘기면 aria-pressed 가 아예 안 붙는다(일반 실행 버튼) */
  active?: boolean;
  disabled?: boolean;
  /** danger 는 파괴적 명령(표 삭제) — hover 에서만 붉게 든다 */
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault() /* 에디터 선택 유지 — 없으면 명령이 엉뚱한 데 걸린다 */}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        'flex h-[30px] shrink-0 items-center whitespace-nowrap rounded-[12px] border-0 bg-transparent text-[11.5px] font-semibold leading-none transition-colors',
        label ? 'gap-[5px] px-2' : 'w-[30px] justify-center px-0',
        disabled && 'cursor-not-allowed text-[rgba(40,44,51,0.42)]',
        !disabled && active && 'cursor-pointer bg-yonsei-navy text-white',
        !disabled &&
          !active &&
          (tone === 'danger'
            ? 'cursor-pointer text-content hover:bg-[#FBECEA] hover:text-[#B42318]'
            : 'cursor-pointer text-content hover:bg-[var(--tt-button-hover-bg-color)]'),
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** 보조 바 구분자 — wide 는 파괴적 명령(표 삭제) 앞에만. 실수 클릭을 거리로 막는다 */
export function CtxDivider({ wide = false }: { wide?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('h-5 w-px shrink-0 self-center bg-surface-border', wide ? 'mx-[9px]' : 'mx-[5px]')}
    />
  );
}

/* ── 인라인 아이콘 — Froala 아이콘 형태를 따른 선 아이콘 ── */

/** 표준 정렬 아이콘 — 이미지 보조 바에서 사용(1차 툴바는 tiptap-icons).
 *  17px 은 보조 바 아이콘 공통 크기(CtxIcon)와 맞춘 값이다. */
export function AlignIcon({ variant }: { variant: 'left' | 'center' | 'right' }) {
  const rows: Record<'left' | 'center' | 'right', [number, number][]> = {
    left: [
      [3, 21],
      [3, 13],
      [3, 21],
      [3, 13],
    ],
    center: [
      [3, 21],
      [7, 17],
      [3, 21],
      [7, 17],
    ],
    right: [
      [3, 21],
      [11, 21],
      [3, 21],
      [11, 21],
    ],
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[17px] w-[17px] shrink-0" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {rows[variant].map(([x1, x2], i) => (
        <line key={i} x1={x1} x2={x2} y1={5 + i * 4.6} y2={5 + i * 4.6} />
      ))}
    </svg>
  );
}

/** 유튜브(비디오) 아이콘 */
export function YoutubeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="tiptap-button-icon" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M10.5 9.2l4.6 2.8-4.6 2.8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 표 아이콘 */
export function TableIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="tiptap-button-icon" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3.5" y="4.5" width="17" height="15" />
      <line x1="3.5" y1="10" x2="20.5" y2="10" />
      <line x1="3.5" y1="15" x2="20.5" y2="15" />
      <line x1="12" y1="4.5" x2="12" y2="19.5" />
    </svg>
  );
}

/** 내어/들여쓰기 아이콘 */
export function IndentIcon({ direction }: { direction: 'in' | 'out' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="tiptap-button-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="5" x2="21" y2="5" />
      <line x1="11" y1="10" x2="21" y2="10" />
      <line x1="11" y1="14" x2="21" y2="14" />
      <line x1="3" y1="19" x2="21" y2="19" />
      {direction === 'in' ? <path d="M3 9.5l4 2.5-4 2.5z" fill="currentColor" stroke="none" /> : <path d="M7 9.5l-4 2.5 4 2.5z" fill="currentColor" stroke="none" />}
    </svg>
  );
}

/** 색 버튼 아이콘 — Froala 의 물방울(droplet) 형태 */
export function DropletIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="tiptap-button-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 3.5c3.2 4 6 7.2 6 10.3a6 6 0 0 1-12 0c0-3.1 2.8-6.3 6-10.3z" />
    </svg>
  );
}

/** 인쇄 아이콘 */
export function PrinterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="tiptap-button-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 8V3.5h10V8" />
      <rect x="3.5" y="8" width="17" height="9" rx="1.5" />
      <path d="M7 13.5h10V21H7z" />
    </svg>
  );
}

/** 서식 지우기(지우개) 아이콘 */
export function EraserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="tiptap-button-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 16.5l9.5-9.5a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 19.5H8L4 16.5z" />
      <line x1="8" y1="19.5" x2="20.5" y2="19.5" />
    </svg>
  );
}

/** 코드뷰(</>) 아이콘 */
export function CodeViewIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="tiptap-button-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8.5 7 3.5 12 8.5 17" />
      <polyline points="15.5 7 20.5 12 15.5 17" />
    </svg>
  );
}

/** 전체 선택 아이콘 — 점선 사각형 */
export function SelectAllIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="tiptap-button-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2.5">
      <rect x="4.5" y="4.5" width="15" height="15" />
    </svg>
  );
}

/* ── 보조 바 아이콘 — 20 격자에 17px. 표 아이콘은 "표 그림 + 작용 지점 강조면"이
      한 문법이다: 18% 불투명 면이 이 명령이 표의 어디에 작용하는지(추가될 자리,
      지워질 줄)를 말한다. 새 표 아이콘을 더할 때도 이 문법을 지켜라. ── */

/** 강조면 — 명령이 작용하는 행/열 */
const CTX_ICON_FILL = { fill: 'currentColor', fillOpacity: 0.18, stroke: 'none' } as const;

function CtxIcon({
  children,
  strokeWidth = 1.7,
  round = false,
}: {
  children: React.ReactNode;
  strokeWidth?: number;
  round?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      width="17"
      height="17"
      className="shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      {...(round ? { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const } : {})}
    >
      {children}
    </svg>
  );
}

/** 행 추가 — 강조면이 새 행이 들어갈 자리(위/아래)다 */
export function TableRowAddIcon({ where }: { where: 'before' | 'after' }) {
  return (
    <CtxIcon>
      <rect x="2.6" y={where === 'before' ? '3.6' : '12.13'} width="14.8" height="4.27" {...CTX_ICON_FILL} />
      <rect x="2.6" y="3.6" width="14.8" height="12.8" />
      <line x1="2.6" y1="7.87" x2="17.4" y2="7.87" />
      <line x1="2.6" y1="12.13" x2="17.4" y2="12.13" />
    </CtxIcon>
  );
}

/** 행 삭제 — 가운데 행을 강조하고 대각선으로 그어 지운다 */
export function TableRowDeleteIcon() {
  return (
    <CtxIcon>
      <rect x="2.6" y="7.87" width="14.8" height="4.26" {...CTX_ICON_FILL} />
      <rect x="2.6" y="3.6" width="14.8" height="12.8" />
      <line x1="2.6" y1="7.87" x2="17.4" y2="7.87" />
      <line x1="2.6" y1="12.13" x2="17.4" y2="12.13" />
      <line x1="4.2" y1="12.6" x2="15.8" y2="7.4" />
    </CtxIcon>
  );
}

/** 열 추가 — 강조면이 새 열이 들어갈 자리(왼쪽/오른쪽)다 */
export function TableColAddIcon({ where }: { where: 'before' | 'after' }) {
  return (
    <CtxIcon>
      <rect x={where === 'before' ? '2.6' : '12.47'} y="3.6" width="4.93" height="12.8" {...CTX_ICON_FILL} />
      <rect x="2.6" y="3.6" width="14.8" height="12.8" />
      <line x1="7.53" y1="3.6" x2="7.53" y2="16.4" />
      <line x1="12.47" y1="3.6" x2="12.47" y2="16.4" />
    </CtxIcon>
  );
}

/** 열 삭제 — 가운데 열을 강조하고 대각선으로 그어 지운다 */
export function TableColDeleteIcon() {
  return (
    <CtxIcon>
      <rect x="7.53" y="3.6" width="4.94" height="12.8" {...CTX_ICON_FILL} />
      <rect x="2.6" y="3.6" width="14.8" height="12.8" />
      <line x1="7.53" y1="3.6" x2="7.53" y2="16.4" />
      <line x1="12.47" y1="3.6" x2="12.47" y2="16.4" />
      <line x1="12.9" y1="5.2" x2="7.1" y2="14.8" />
    </CtxIcon>
  );
}

/** 셀 병합 — 사라질 경계라 점선 */
export function TableMergeIcon() {
  return (
    <CtxIcon>
      <rect x="2.6" y="4.6" width="14.8" height="10.8" />
      <line x1="10" y1="4.6" x2="10" y2="15.4" strokeDasharray="2 2" />
    </CtxIcon>
  );
}

/** 셀 분할 — 생겨날 경계라 실선 */
export function TableSplitIcon() {
  return (
    <CtxIcon>
      <rect x="2.6" y="4.6" width="14.8" height="10.8" />
      <line x1="10" y1="4.6" x2="10" y2="15.4" />
    </CtxIcon>
  );
}

/** 머리행 — 첫 줄만 짙게 찬 표(강조면 18% 가 아니라 70%: 머리행은 실제로 진하다) */
export function TableHeaderRowIcon() {
  return (
    <CtxIcon>
      <rect x="2.6" y="3.6" width="14.8" height="4.4" fill="currentColor" fillOpacity="0.7" stroke="none" />
      <rect x="2.6" y="3.6" width="14.8" height="12.8" />
      <line x1="2.6" y1="8" x2="17.4" y2="8" />
    </CtxIcon>
  );
}

/** 표 스타일 — 격자 없는 굵은 테두리 하나(이 팝오버가 다루는 게 "테두리·면"이라서) */
export function TableStyleIcon() {
  return (
    <CtxIcon strokeWidth={2.6}>
      <rect x="3.4" y="4.4" width="13.2" height="11.2" />
    </CtxIcon>
  );
}

/** 표 삭제 — 쓰레기통. 표 아이콘 문법에서 벗어난 유일한 표 버튼이라 눈에 걸린다 */
export function TableDeleteIcon() {
  return (
    <CtxIcon round>
      <line x1="3.2" y1="5.8" x2="16.8" y2="5.8" />
      <path d="M7.6 5.8V4.4a.9.9 0 0 1 .9-.9h3a.9.9 0 0 1 .9.9v1.4" />
      <path d="M5.3 5.8l.8 9.9a.9.9 0 0 0 .9.8h6a.9.9 0 0 0 .9-.8l.8-9.9" />
      <line x1="8.5" y1="8.6" x2="8.7" y2="13.6" />
      <line x1="11.5" y1="8.6" x2="11.3" y2="13.6" />
    </CtxIcon>
  );
}

/** 이미지 원본 폭 — 좌우 화살표가 프레임을 가득 채운다 */
export function ImageWidthFullIcon() {
  return (
    <CtxIcon round>
      <rect x="2.6" y="4.6" width="14.8" height="10.8" />
      <line x1="5.6" y1="10" x2="14.4" y2="10" />
      <polyline points="7.2,8.4 5.6,10 7.2,11.6" />
      <polyline points="12.8,8.4 14.4,10 12.8,11.6" />
    </CtxIcon>
  );
}

/** 이미지 폭 50% — 점선이 원본 폭, 찬 면이 실제로 차지할 절반 */
export function ImageWidthHalfIcon() {
  return (
    <CtxIcon>
      <rect x="2.6" y="4.6" width="7.4" height="10.8" fill="currentColor" fillOpacity="0.18" />
      <rect x="2.6" y="4.6" width="14.8" height="10.8" strokeDasharray="2.4 2.4" />
    </CtxIcon>
  );
}

/* ════════════════════════════════════════════════════════════════════
   동문 인터뷰 도구 — preset="interview" 인 게시판(동문 소식)에서만 툴바에 뜬다.
   구형 파리티 대상이 아니라 새로 만든 묶음이라 여기 따로 모아 둔다.
   ════════════════════════════════════════════════════════════════════ */

/** 인용(풀쿼트) — 여는 큰따옴표 두 벌. 툴바 아이콘 규격(tiptap-button-icon)을 따른다 */
export function QuoteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="tiptap-button-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 6.5c-2.6 0-4.5 2-4.5 4.6 0 2 1.4 3.4 3.2 3.4 1.5 0 2.6-1 2.6-2.4 0-1.3-.9-2.3-2.2-2.3-.3 0-.6 0-.8.1.3-1 1.2-1.7 2.4-1.9z" />
      <path d="M19 6.5c-2.6 0-4.5 2-4.5 4.6 0 2 1.4 3.4 3.2 3.4 1.5 0 2.6-1 2.6-2.4 0-1.3-.9-2.3-2.2-2.3-.3 0-.6 0-.8.1.3-1 1.2-1.7 2.4-1.9z" />
    </svg>
  );
}

/** 인터뷰 틀 넣기 — 문서 위에 Q·A 줄이 번갈아 놓인 꼴 */
export function InterviewTemplateIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="tiptap-button-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
      <line x1="7" y1="8.5" x2="17" y2="8.5" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="7" y1="15.5" x2="13" y2="15.5" />
    </svg>
  );
}

/**
 * 인터뷰 뼈대 — "인터뷰 틀 넣기" 가 삽입하는 HTML.
 * 소제목 → 도입 → Q/A 세 벌 → 풀쿼트 → 마무리. 실제 문안은 전부 자리표시자이고,
 * 관리자가 지우고 쓰는 것이 전제다(빈 화면 앞에서 멈추지 않게 하는 것이 목적).
 */
export const INTERVIEW_TEMPLATE =
  '<h3>소제목을 입력하세요</h3>' +
  '<p>도입 문단…</p>' +
  '<p data-role="q">질문 1</p>' +
  '<p data-role="a">답변 1</p>' +
  '<p data-role="q">질문 2</p>' +
  '<p data-role="a">답변 2</p>' +
  '<p data-role="q">질문 3</p>' +
  '<p data-role="a">답변 3</p>' +
  '<blockquote><p>본문에서 뽑은 한 문장(풀쿼트)</p></blockquote>' +
  '<h3>마무리 소제목</h3>' +
  '<p>마무리 문단…</p>';
