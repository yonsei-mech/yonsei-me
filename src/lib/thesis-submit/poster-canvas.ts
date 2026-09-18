/**
 * 박사학위 예비심사 공고 포스터 렌더러 — **클라이언트 전용**(canvas·document.fonts·Image).
 *
 * 학과가 한글(HWP) 양식 "박사학위예비심사 안내 포스터"로 만들어 이미지로 게시하던 것을, 학생이
 * 입력한 값(notice.ts 의 ThesisNoticeInput)으로 같은 모양을 캔버스에 그린다. 입력 화면의 미리보기
 * (renderPoster)와 게시용 PNG(posterPngBlob)가 같은 코드를 쓴다.
 *
 * 좌표는 기존 게시 이미지(1403×992, POSTER_REF)를 픽셀 실측한 값이다. 서체는 원본의 한컴/맑은
 * 고딕 대신 사이트 서체 Pretendard 700 — 글자 크기는 줄마다 **잉크 높이**가 원본과 같아지도록
 * measureText 의 actualBoundingBox 로 보정했고(Pretendard 한글 잉크 = 0.8125em 위 + 0.094em 아래),
 * 세로 위치는 기준 글자('가', 제목은 'lg')의 잉크 가운데를 원본 줄의 잉크 가운데에 맞춘다
 * (내용과 무관하게 줄이 흔들리지 않도록 기준선은 줄마다 고정). 가로 폭은 서체 차이로 원본과 다르다.
 *
 * ⚠️ node 전용 모듈을 들이지 마라. 서버에서 import 해도 되지만 호출은 브라우저에서만.
 */

import {
  CHAIR_LABEL,
  MEMBERS_LABEL,
  PLACE_LABEL,
  POSTER_EXPORT_SCALE,
  POSTER_EXPORT_SIZE,
  POSTER_HEADING,
  POSTER_REF,
  WHEN_LABEL,
  cleanNotice,
  committeeEntry,
  emptyMember,
  formatWhen,
  memberEntries,
  posterHeading,
  spacedName,
  type CommitteeMember,
  type ThesisNoticeInput,
} from './notice';

export interface RenderOptions {
  /** 빈 칸을 회색 자리표시 글로 채운다(미리보기용). 내보내기는 false */
  placeholders?: boolean;
}

// ── 색·서체 ──────────────────────────────────────────────────────────────

/** 글자색 — 원본 실측 (1,0,128) */
const INK = '#000080';
/** 빈 칸 자리표시(미리보기 전용) */
const PLACEHOLDER = '#A8B0BA';
/** 이중 테두리선 — 원본 실측 ≈ (103,103,146) */
const RULE = '#67678F';

const FAMILY = '"Pretendard Variable", Pretendard, sans-serif';
const LOAD_FONT = '700 40px "Pretendard Variable"';
/**
 * 낱말 사이 공백 폭(em). 한글(HWP)은 한글 글꼴의 공백을 반각으로 잡아 원본의 낱말 간격이 넓다
 * (실측 잉크 틈 ≈ 0.5em). Pretendard 의 공백(0.23em)을 그대로 쓰면 빽빽해 보여서 낱말을 하나씩
 * 그리고 공백은 이 폭으로 띄운다(ctx.wordSpacing 은 브라우저 지원이 고르지 않다). Pretendard 한글은
 * 곁여백이 원본 서체보다 커서 0.5em 이면 틈이 원본보다 ~20% 넓었다 — 0.4em 에서 줄별 틈이 맞는다.
 */
const SPACE_EM = 0.4;

const FONT_TIMEOUT_MS = 8000;
const REST_CSS_TIMEOUT_MS = 4000;

const font = (size: number) => `700 ${size}px ${FAMILY}`;

// ── 배치(기준 좌표 1403×992, 원본 live 이미지 실측) ─────────────────────────
// cy = 기준 글자 잉크의 세로 가운데(연속 좌표 — 잉크 행 top..bottom 이면 (top+bottom+1)/2).
// size = 원본 잉크 높이 ÷ Pretendard 잉크 높이/em.

/** 머리글 — 왼쪽 정렬, 한글 잉크 y 104~142(39px) → 43px, 잉크 x 133 */
const HEADING = { inkX: 133, cy: 123.5, size: 43 } as const;

/**
 * 논문 제목 — 가운데 정렬(701.5), 두 줄일 때 잉크 257~294 / 315~352(간격 58). 원본 글상자 폭은
 * 잉크 기준 1175(x 115~1289, 여러 장이 여기에 붙는다).
 * 원본 제목의 라틴 글자 잉크(38px)에 맞추면 39px 이지만, Pretendard 라틴 글자가 원본 서체보다
 * 약 15% 넓어 같은 제목이 3줄로 넘어간다. 원본과 같은 줄바꿈이 되도록 34.5px 로 둔다
 * (대문자 높이 −6%, 잉크 위아래 각 ≈2px 차이). 3줄을 넘으면 줄인다.
 *
 * maxWidth 는 기존 게시 포스터 124장의 실제 줄바꿈으로 정했다(2026-09 실측, 전부 영문 제목 —
 * 한글 제목 2장은 모두 한 줄이라 한글 끊김 표본은 없다). 제목 2줄 이상 108장(테두리 밖으로 넘치거나
 * 양쪽 정렬인 비표준 5장 제외)의 줄바꿈 124곳을 원본 잉크로 가르면(윗줄 잉크 폭 + 낱말 틈 + 다음 줄
 * 첫 낱말 잉크 폭이 1175 를 넘으면 자동) 자동 86곳·수동(엔터) 38곳, 줄바꿈이 전부 자동인 포스터는
 * 74장이다. 34.5px Pretendard(wrapWords 와 같은 낱말 폭 + 0.4em 공백)로 잰 자동 줄바꿈 제약
 * (윗줄 ≤ W < 윗줄+다음 첫 낱말)의 교집합은 비어 있고(하한 최대 1183.6 > 상한 최소 1099.1 —
 * 원본 HWP 가 꽉 찬 줄의 낱말 틈을 줄여 한 낱말을 더 넣은 줄과 다른 서체로 만든 포스터가 서로
 * 어긋난다), 74장 전체 줄 나눔이 원본과 같아지는 수는 W ∈ [1145.2, 1146.6) ∪ [1148.7, 1150.4)
 * 에서 최대 68장이다(이전 값 1160 은 64장). 넓은 구간의 가운데인 1149.5 로 둔다 — 한 줄짜리 원본
 * 11장 중 10장이 그대로 한 줄(나머지 1장은 가는 서체, 1150.1 필요), 가장 긴 줄 잉크 1147.6 으로
 * 테두리 안쪽선(108~1295) 침범 없음. 글자 크기(33~39px)를 바꿔도 W 가 크기에 비례해 옮겨갈 뿐
 * 일치 수는 68장 그대로라 크기는 34.5 를 유지한다.
 */
const TITLE = {
  cx: POSTER_REF.width / 2,
  cy: 305,
  size: 34.5,
  pitch: 58,
  maxWidth: 1149.5,
  maxLines: 3,
  /** 3줄 안에 넣을 때 여기까지 줄인다 */
  minSize: 20,
  /** 그래도 넘치면(아주 긴 한글 제목) 이 칸 안에 들 때까지 더 줄인다 — 머리글·이름 침범 금지 */
  floorSize: 10,
  top: 160,
  bottom: 426,
} as const;

/** 발표자 — 가운데 정렬, 잉크 438~492(55px) → 60.7px */
const NAME = { cx: POSTER_REF.width / 2, cy: 465.5, size: 60.7, maxWidth: 1160, minSize: 24 } as const;

/**
 * 심사위원장·심사위원 — 왼쪽 x 163, 한글 잉크 585~615 / 639~669(31px → 34.2px), 줄 간격 54.
 * 오른쪽 1280 을 넘으면 라벨 뒤 위치로 내어쓰기. 줄이 많아 bottom(‘일시’ 잉크 top 782 에서 ≈32px 위)을
 * 넘으면 먼저 블록을 위로 올리고(이름 잉크 bottom 492 에서 ≈38px 아래 minTop 까지), 그래도 넘치면 줄인다.
 */
const COMMITTEE = {
  inkX: 163,
  top: 585,
  minTop: 530,
  size: 34.2,
  pitch: 54,
  right: 1280,
  bottom: 750,
  minSize: 12,
} as const;

/** 일시 — 왼쪽 x 346, 한글 잉크 782~820. 장소 — 846~882. 두 줄 같은 크기(42px), 간격 63 */
const WHEN = { inkX: 346, cy: 801.5, size: 42 } as const;
/** 장소가 길면 학부 로고(이 줄 높이에서 잉크 x ≥1028) 앞 12px 에서 멈추도록 줄인다 */
const PLACE = { inkX: 346, cy: 864.5, size: 42, right: 1016, minSize: 18 } as const;

/**
 * 로고 — 원본 비트맵(엠블럼 197², 학부 로고 580×221)의 잉크 상자를 게시 이미지의 잉크 상자에
 * 맞춘 배치(엠블럼 잉크 41~181 × 809~949, 학부 로고 잉크 1029~1373 × 835~962).
 */
const EMBLEM = { src: '/img/thesis-poster/yonsei-emblem.png', x: 28.26, y: 797.11, w: 167.33, h: 167.33 } as const;
const ME_LOGO = { src: '/img/thesis-poster/me-logo.png', x: 1027.7, y: 831.1, w: 347.1, h: 132.25 } as const;

/**
 * 이중 테두리 — 바깥 3px(x 102~104·1299~1301, y 97~99·892~894), 안쪽 1px(x 108·1295, y 103·888).
 * 원본은 테두리가 로고 **위**에 그려져 있다(선 사이 틈으로 로고가 비친다) — 로고 먼저, 테두리 나중.
 */
const FRAME_RECTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [102, 97, 1200, 3],
  [102, 892, 1200, 3],
  [102, 97, 3, 798],
  [1299, 97, 3, 798],
  [108, 103, 1188, 1],
  [108, 888, 1188, 1],
  [108, 103, 1, 786],
  [1295, 103, 1, 786],
];

// ── 자리표시 ──────────────────────────────────────────────────────────────

const PH = {
  title: '논문 제목',
  presenter: '성 명',
  member: '○○○',
  members: '○○○ 교수님, ○○○ 교수님',
  when: '○○월 ○○일(○요일) 오후 ○시 ○○분',
  place: '○○○',
} as const;

// ── 에셋(글꼴·로고) ───────────────────────────────────────────────────────

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function cachedImage(src: string): Promise<HTMLImageElement> {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`포스터 로고를 불러오지 못했습니다: ${src}`));
      img.src = src;
    });
    imageCache.set(src, p);
    // 실패는 캐시하지 않는다 — 다음 호출이 다시 시도한다
    p.catch(() => imageCache.delete(src));
  }
  return p;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

let restCssReady: Promise<void> | null = null;

/**
 * 희귀 음절 조각의 @font-face 는 레이아웃이 비차단으로 끼우는 별도 스타일시트(webfonts-rest)에
 * 있다. 그게 아직 안 왔으면 document.fonts.load 가 그 조각을 모른 채 끝나므로 먼저 기다린다.
 */
function waitRestFontCss(): Promise<void> {
  if (restCssReady) return restCssReady;
  const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="/webfonts/webfonts-rest"]');
  if (!link || link.sheet) return (restCssReady = Promise.resolve());
  restCssReady = withTimeout(
    new Promise<void>((resolve) => {
      link.addEventListener('load', () => resolve(), { once: true });
      link.addEventListener('error', () => resolve(), { once: true });
    }),
    REST_CSS_TIMEOUT_MS,
  ).then(() => undefined);
  return restCssReady;
}

/** 그릴 글자 전부에 해당하는 Pretendard 조각(unicode-range)을 받아 둔다. 실패·시간 초과는 폴백으로 그린다 */
async function ensureFonts(text: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await waitRestFontCss();
  const chars = Array.from(new Set(Array.from(text))).join('');
  try {
    await withTimeout(document.fonts.load(LOAD_FONT, chars), FONT_TIMEOUT_MS);
  } catch {
    /* 조각 하나가 실패해도 나머지로 그린다 */
  }
}

interface Logos {
  emblem: HTMLImageElement | null;
  me: HTMLImageElement | null;
}

async function loadLogos(strict: boolean): Promise<Logos> {
  const [emblem, me] = await Promise.allSettled([cachedImage(EMBLEM.src), cachedImage(ME_LOGO.src)]);
  if (strict) {
    if (emblem.status === 'rejected') throw emblem.reason;
    if (me.status === 'rejected') throw me.reason;
  }
  return {
    emblem: emblem.status === 'fulfilled' ? emblem.value : null,
    me: me.status === 'fulfilled' ? me.value : null,
  };
}

// ── 그릴 내용(입력 → 글 조각) ─────────────────────────────────────────────

interface Piece {
  text: string;
  color: string;
}

interface PosterContent {
  /** 머리글 — 환영 문구 체크 여부에 따라 달라진다(posterHeading) */
  heading: string;
  title: Piece | null;
  name: Piece | null;
  chair: Piece[];
  members: Piece[];
  when: Piece | null;
  place: Piece | null;
}

/** 입력 중인 값(빈 칸·빈 위원 줄·필드 누락)도 받아들이도록 모양부터 채운다 */
function safeInput(input: Partial<ThesisNoticeInput> | null | undefined): ThesisNoticeInput {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const member = (m: Partial<CommitteeMember> | null | undefined): CommitteeMember => ({
    ...emptyMember(),
    name: str(m?.name),
    affiliation: str(m?.affiliation),
    ...(m?.honorific ? { honorific: m.honorific } : {}),
  });
  const members = input?.members;
  return {
    program: str(input?.program) as ThesisNoticeInput['program'],
    welcome: input?.welcome !== false,
    presenter: str(input?.presenter),
    title: str(input?.title),
    chair: member(input?.chair),
    members: Array.isArray(members) ? members.map(member) : [],
    date: str(input?.date),
    time: str(input?.time),
    place: str(input?.place),
  };
}

function buildContent(input: ThesisNoticeInput, placeholders: boolean): PosterContent {
  const c = cleanNotice(safeInput(input));
  const val = (text: string, ph: string): Piece | null =>
    text ? { text, color: INK } : placeholders ? { text: ph, color: PLACEHOLDER } : null;

  const chair: Piece[] = c.chair.name
    ? [{ text: committeeEntry(c.chair), color: INK }]
    : placeholders
      ? [{ text: committeeEntry({ ...c.chair, name: PH.member }), color: PLACEHOLDER }]
      : [];
  const entries = memberEntries(c);
  const members: Piece[] = entries.length
    ? entries.map((text) => ({ text, color: INK }))
    : placeholders
      ? [{ text: PH.members, color: PLACEHOLDER }]
      : [];

  return {
    heading: posterHeading(c),
    title: val(c.title, PH.title),
    name: val(spacedName(c.presenter), PH.presenter),
    chair,
    members,
    when: val(formatWhen(c.date, c.time), PH.when),
    place: val(c.place, PH.place),
  };
}

function contentText(pc: PosterContent): string {
  return [
    POSTER_HEADING,
    CHAIR_LABEL,
    MEMBERS_LABEL,
    WHEN_LABEL,
    PLACE_LABEL,
    '가lg,',
    pc.title?.text,
    pc.name?.text,
    ...pc.chair.map((p) => p.text),
    ...pc.members.map((p) => p.text),
    pc.when?.text,
    pc.place?.text,
  ]
    .filter(Boolean)
    .join('');
}

// ── 글자 그리기 도구 ─────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;

/** 공백을 SPACE_EM 폭으로 친 글 한 토막의 전진 폭 */
function runWidth(ctx: Ctx, text: string, size: number): number {
  const parts = text.split(' ');
  let w = (parts.length - 1) * SPACE_EM * size;
  for (const p of parts) if (p) w += ctx.measureText(p).width;
  return w;
}

/** 낱말 단위로 그리고 끝난 x 를 돌려준다 */
function drawRun(ctx: Ctx, text: string, x: number, y: number, size: number): number {
  let cx = x;
  text.split(' ').forEach((p, i) => {
    if (i > 0) cx += SPACE_EM * size;
    if (p) {
      ctx.fillText(p, cx, y);
      cx += ctx.measureText(p).width;
    }
  });
  return cx;
}

/** 기준 글자 잉크의 세로 가운데를 cy 에 두는 기준선 — ctx.font 를 먼저 맞춰 둘 것 */
function baselineFor(ctx: Ctx, cy: number, ref = '가'): number {
  const m = ctx.measureText(ref);
  return cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
}

function inkHeight(ctx: Ctx, ref = '가'): number {
  const m = ctx.measureText(ref);
  return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
}

/** 첫 낱말의 잉크 왼끝이 inkX 에 오도록 하는 글자 원점 x */
function originForInk(ctx: Ctx, text: string, inkX: number): number {
  const first = text.split(' ').find(Boolean) ?? text;
  return inkX + ctx.measureText(first).actualBoundingBoxLeft;
}

/** 너무 넓으면 가로로만 눌러 그린다(글자 크기 하한에 닿은 극단적인 입력용) */
function drawSqueezed(ctx: Ctx, draw: () => void, originX: number, factor: number): void {
  if (factor >= 1) {
    draw();
    return;
  }
  ctx.save();
  ctx.translate(originX, 0);
  ctx.scale(factor, 1);
  ctx.translate(-originX, 0);
  draw();
  ctx.restore();
}

/** 공백 기준 탐욕 줄바꿈. 한 낱말이 폭을 넘으면 글자 단위로 끊는다 */
function wrapWords(ctx: Ctx, text: string, maxWidth: number, size: number): string[] {
  const sp = SPACE_EM * size;
  const lines: string[] = [];
  let cur = '';
  let curW = 0;
  const push = () => {
    if (cur) lines.push(cur);
    cur = '';
    curW = 0;
  };
  for (const word of text.split(' ').filter(Boolean)) {
    const w = ctx.measureText(word).width;
    if (cur && curW + sp + w <= maxWidth) {
      cur += ` ${word}`;
      curW += sp + w;
      continue;
    }
    if (w <= maxWidth) {
      push();
      cur = word;
      curW = w;
      continue;
    }
    // 폭보다 긴 낱말 — 글자 단위로 끊는다(남은 조각은 다음 낱말과 이어질 수 있다)
    push();
    for (const ch of Array.from(word)) {
      const cand = cur + ch;
      const cw = ctx.measureText(cand).width;
      if (cw <= maxWidth || !cur) {
        cur = cand;
        curW = cw;
      } else {
        push();
        cur = ch;
        curW = ctx.measureText(ch).width;
      }
    }
  }
  push();
  return lines;
}

interface Seg {
  x: number;
  text: string;
  color: string;
}

/**
 * '라벨 : 항목, 항목, …' 을 오른쪽 한계에서 감되, 둘째 줄부터는 라벨 뒤(내어쓰기)에서 시작한다.
 * 항목(', ' 경계)에서 끊는 걸 우선하고, 한 항목이 한 줄보다 길면 낱말, 낱말도 길면 글자에서 끊는다.
 */
function layoutHanging(ctx: Ctx, size: number, x0: number, label: string, items: Piece[], right: number): Seg[][] {
  const sp = SPACE_EM * size;
  const hang = x0 + runWidth(ctx, label, size);
  const lines: Seg[][] = [[{ x: x0, text: label, color: INK }]];
  let cursor = hang;
  let fresh = true;
  const avail = right - hang;

  const newline = () => {
    lines.push([]);
    cursor = hang;
    fresh = true;
  };
  const put = (text: string, color: string, w: number) => {
    const x = fresh ? cursor : cursor + sp;
    lines[lines.length - 1].push({ x, text, color });
    cursor = x + w;
    fresh = false;
  };
  const room = () => right - cursor - (fresh ? 0 : sp);
  /** 이 줄 또는 새 줄에 통째로 들어가면 놓고 true */
  const placeWhole = (text: string, color: string): boolean => {
    const w = runWidth(ctx, text, size);
    if (w <= room()) {
      put(text, color, w);
      return true;
    }
    if (!fresh && w <= avail) {
      newline();
      put(text, color, w);
      return true;
    }
    return false;
  };
  const placeChars = (word: string, color: string) => {
    let chunk = '';
    for (const ch of Array.from(word)) {
      const cand = chunk + ch;
      if (ctx.measureText(cand).width <= room() || (!chunk && fresh)) {
        chunk = cand;
        continue;
      }
      if (chunk) put(chunk, color, ctx.measureText(chunk).width);
      newline();
      chunk = ch;
    }
    if (chunk) put(chunk, color, ctx.measureText(chunk).width);
  };

  items.forEach((item, i) => {
    const text = i < items.length - 1 ? `${item.text},` : item.text;
    if (placeWhole(text, item.color)) return;
    for (const word of text.split(' ').filter(Boolean)) {
      if (!placeWhole(word, item.color)) placeChars(word, item.color);
    }
  });
  return lines;
}

// ── 그리기 ───────────────────────────────────────────────────────────────

function drawHeading(ctx: Ctx, heading: string): void {
  ctx.font = font(HEADING.size);
  ctx.fillStyle = INK;
  const y = baselineFor(ctx, HEADING.cy);
  drawRun(ctx, heading, originForInk(ctx, heading, HEADING.inkX), y, HEADING.size);
}

function drawTitle(ctx: Ctx, piece: Piece): void {
  const fits = (lines: string[], size: number) => {
    const pitch = (TITLE.pitch * size) / TITLE.size;
    ctx.font = font(size);
    const h = (lines.length - 1) * pitch + inkHeight(ctx, 'lg');
    return h <= TITLE.bottom - TITLE.top;
  };
  let size: number = TITLE.size;
  ctx.font = font(size);
  let lines = wrapWords(ctx, piece.text, TITLE.maxWidth, size);
  // 3줄 안에 들 때까지 줄이고, 하한에서도 넘치면 칸 안에 들 때까지 더 줄인다
  while (size > TITLE.floorSize && (size > TITLE.minSize ? lines.length > TITLE.maxLines : !fits(lines, size))) {
    size = Math.max(TITLE.floorSize, size - 0.5);
    ctx.font = font(size);
    lines = wrapWords(ctx, piece.text, TITLE.maxWidth, size);
  }
  ctx.font = font(size);
  ctx.fillStyle = piece.color;
  const pitch = (TITLE.pitch * size) / TITLE.size;
  lines.forEach((line, i) => {
    const cy = TITLE.cy + (i - (lines.length - 1) / 2) * pitch;
    const w = runWidth(ctx, line, size);
    drawRun(ctx, line, TITLE.cx - w / 2, baselineFor(ctx, cy, 'lg'), size);
  });
}

function drawName(ctx: Ctx, piece: Piece): void {
  let size: number = NAME.size;
  ctx.font = font(size);
  let w = runWidth(ctx, piece.text, size);
  if (w > NAME.maxWidth) {
    size = Math.max(NAME.minSize, (size * NAME.maxWidth) / w);
    ctx.font = font(size);
    w = runWidth(ctx, piece.text, size);
  }
  ctx.fillStyle = piece.color;
  const y = baselineFor(ctx, NAME.cy);
  const squeeze = Math.min(1, NAME.maxWidth / w);
  const x = NAME.cx - (w * squeeze) / 2;
  drawSqueezed(ctx, () => drawRun(ctx, piece.text, x, y, size), x, squeeze);
}

function drawSegLine(ctx: Ctx, segs: Seg[], y: number, size: number): void {
  for (const s of segs) {
    ctx.fillStyle = s.color;
    drawRun(ctx, s.text, s.x, y, size);
  }
}

function drawCommittee(ctx: Ctx, chair: Piece[], members: Piece[]): void {
  const layoutAt = (size: number) => {
    ctx.font = font(size);
    const x0 = originForInk(ctx, CHAIR_LABEL, COMMITTEE.inkX);
    const x1 = originForInk(ctx, MEMBERS_LABEL, COMMITTEE.inkX);
    return [
      ...layoutHanging(ctx, size, x0, CHAIR_LABEL, chair, COMMITTEE.right),
      ...layoutHanging(ctx, size, x1, MEMBERS_LABEL, members, COMMITTEE.right),
    ];
  };
  let size: number = COMMITTEE.size;
  let lines = layoutAt(size);
  /** 첫 줄 잉크 top ~ 끝 줄 잉크 bottom(한글 기준) */
  const heightAt = (n: number, s: number) => {
    ctx.font = font(s);
    return inkHeight(ctx) + (n - 1) * ((COMMITTEE.pitch * s) / COMMITTEE.size);
  };
  while (size > COMMITTEE.minSize && heightAt(lines.length, size) > COMMITTEE.bottom - COMMITTEE.minTop) {
    size = Math.max(COMMITTEE.minSize, size - 0.5);
    lines = layoutAt(size);
  }
  // 원래 자리(585)에서 넘치면 아래 끝을 bottom 에 맞춰 위로 올린다(minTop 까지)
  const top = Math.max(COMMITTEE.minTop, Math.min(COMMITTEE.top, COMMITTEE.bottom - heightAt(lines.length, size)));
  ctx.font = font(size);
  const pitch = (COMMITTEE.pitch * size) / COMMITTEE.size;
  const cy0 = top + inkHeight(ctx) / 2;
  lines.forEach((segs, i) => drawSegLine(ctx, segs, baselineFor(ctx, cy0 + i * pitch), size));
}

/** '일시 : …' / '장소 : …' 한 줄. right 가 있으면 넘지 않게 줄인다 */
function drawLabeled(
  ctx: Ctx,
  label: string,
  value: Piece | null,
  spec: { inkX: number; cy: number; size: number; right?: number; minSize?: number },
): void {
  let size = spec.size;
  ctx.font = font(size);
  const x = originForInk(ctx, label, spec.inkX);
  const full = () => runWidth(ctx, label, size) + (value ? runWidth(ctx, value.text, size) : 0);
  let squeeze = 1;
  if (spec.right !== undefined) {
    const maxW = spec.right - x;
    let w = full();
    if (w > maxW) {
      size = Math.max(spec.minSize ?? 1, (size * maxW) / w);
      ctx.font = font(size);
      w = full();
      squeeze = Math.min(1, maxW / w);
    }
  }
  const y = baselineFor(ctx, spec.cy);
  drawSqueezed(
    ctx,
    () => {
      ctx.fillStyle = INK;
      const end = drawRun(ctx, label, x, y, size);
      if (value) {
        ctx.fillStyle = value.color;
        drawRun(ctx, value.text, end, y, size);
      }
    },
    x,
    squeeze,
  );
}

function drawPoster(canvas: HTMLCanvasElement, pc: PosterContent, logos: Logos, scale: number): void {
  const w = Math.round(POSTER_REF.width * scale);
  const h = Math.round(POSTER_REF.height * scale);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx || !w || !h) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(w / POSTER_REF.width, 0, 0, h / POSTER_REF.height, 0, 0);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'ltr';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 로고 → 테두리(원본처럼 선이 로고 위) → 글
  if (logos.emblem) ctx.drawImage(logos.emblem, EMBLEM.x, EMBLEM.y, EMBLEM.w, EMBLEM.h);
  if (logos.me) ctx.drawImage(logos.me, ME_LOGO.x, ME_LOGO.y, ME_LOGO.w, ME_LOGO.h);
  ctx.fillStyle = RULE;
  for (const [x, y, rw, rh] of FRAME_RECTS) ctx.fillRect(x, y, rw, rh);

  drawHeading(ctx, pc.heading);
  if (pc.title) drawTitle(ctx, pc.title);
  if (pc.name) drawName(ctx, pc.name);
  drawCommittee(ctx, pc.chair, pc.members);
  drawLabeled(ctx, WHEN_LABEL, pc.when, WHEN);
  drawLabeled(ctx, PLACE_LABEL, pc.place, PLACE);
}

// ── 공개 API ─────────────────────────────────────────────────────────────

/** 캔버스별 최신 호출 번호 — 늦게 끝난 이전 호출은 그리지 않는다 */
const renderTokens = new WeakMap<HTMLCanvasElement, number>();

async function render(
  canvas: HTMLCanvasElement,
  input: ThesisNoticeInput,
  scale: number,
  placeholders: boolean,
  strictAssets: boolean,
): Promise<void> {
  const token = (renderTokens.get(canvas) ?? 0) + 1;
  renderTokens.set(canvas, token);
  const s = Number.isFinite(scale) && scale > 0 ? scale : 0;
  const pc = buildContent(input, placeholders);
  const [logos] = await Promise.all([loadLogos(strictAssets), ensureFonts(contentText(pc))]);
  // ⚠️ 크기 조정(=캔버스 지움)도 토큰 확인 뒤에 — 이전 호출이 최신 그림을 지우면 안 된다
  if (renderTokens.get(canvas) !== token) return;
  drawPoster(canvas, pc, logos, s);
}

/** canvas.width/height 를 POSTER_REF×scale(반올림)로 맞추고, 필요한 글꼴·로고를 기다린 뒤 그린다.
 *  빠르게 연달아 불려도(입력마다 미리보기 갱신) 마지막 호출만 그려야 한다 — 캔버스별 토큰으로 늦게 끝난 이전 호출은 그리지 않는다. */
export async function renderPoster(
  canvas: HTMLCanvasElement,
  input: ThesisNoticeInput,
  scale: number,
  opts?: RenderOptions,
): Promise<void> {
  await render(canvas, input, scale, opts?.placeholders ?? false, false);
}

/** cleanNotice(input) → POSTER_EXPORT_SCALE 로 오프스크린 캔버스에 placeholders:false 로 그려 PNG Blob. 크기는 정확히 POSTER_EXPORT_SIZE */
export async function posterPngBlob(input: ThesisNoticeInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  await render(canvas, cleanNotice(safeInput(input)), POSTER_EXPORT_SCALE, false, true);
  if (canvas.width !== POSTER_EXPORT_SIZE.width || canvas.height !== POSTER_EXPORT_SIZE.height) {
    throw new Error(`포스터 크기가 어긋났습니다: ${canvas.width}×${canvas.height}`);
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('포스터 PNG 를 만들지 못했습니다'))), 'image/png');
  });
}
