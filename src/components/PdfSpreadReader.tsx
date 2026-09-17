'use client';

/**
 * 좌/우 펼침 PDF 리더 — BK21 사업계획서·보고서(게시판 `bk21Reports`)의 상세 화면.
 *
 * 왜 전용 뷰어인가: 이 문서들은 "받아 가는 파일"이 아니라 **읽는 문서**다(939쪽짜리도
 * 있다). 첨부 링크만 주면 방문자는 85MB 를 통째로 받아 외부 뷰어로 열어야 하고, 브라우저
 * 기본 PDF 뷰어(<iframe>)는 기기마다 모양이 달라 사이트의 각진 디자인과 따로 논다.
 *
 * 설계 요점
 *  · **필요한 쪽만 받는다** — disableAutoFetch + rangeChunkSize 로 pdf.js 가 Range 요청을
 *    쓰게 한다(R2 는 Range 를 지원). 첫 펼침이 뜨는 데 전체 다운로드를 기다리지 않는다.
 *  · **크기는 fit 이 기준** — 두 쪽이 들어가는 최대 폭과 화면 높이 예산 중 작은 쪽에 맞춘다.
 *    확대는 그 값의 배수(1/1.5/2)이고, 확대분은 리더 영역 안에서만 스크롤한다.
 *  · **라벨은 전부 props** — 서버 페이지가 bk21 네임스페이스에서 꺼내 넘긴다. 클라이언트
 *    번들에 새 메시지 네임스페이스를 싣지 않기 위해서다(`npm run check:i18n` 이 막는다).
 *  · **window·DPR·해시는 마운트 뒤에만** 읽는다 — 서버 렌더에는 툴바와 스켈레톤만 나온다.
 *
 * ⚠️ **내려받기 버튼을 다시 넣지 마라** — 사업계획서·보고서는 보안상 화면에서 읽기만
 *    허용한다(2026-09 학과 요청). 툴바와 오류 화면 양쪽에 있던 `<a download>` 를 뺐다.
 *
 * ⚠️ pdfjs-dist 는 반드시 **클라이언트에서 동적 import** 한다. 정적 import 하면 서버
 *    번들에도 들어가 Node 전용 캔버스 백엔드를 끌어온다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Link } from '@/i18n/navigation';

export interface PdfReaderLabels {
  back: string;
  prev: string;
  next: string;
  /** "{from}–{to} / {total}" */
  spread: string;
  /** "{n} / {total}" */
  single: string;
  jump: string;
  zoomIn: string;
  zoomOut: string;
  zoomFit: string;
  /** "{n}쪽" */
  pageAlt: string;
  loading: string;
  error: string;
}

/** 배율 3단 — 0번이 '맞춤'(fit)이고 나머지는 그 배수다 */
const ZOOMS = [1, 1.5, 2] as const;
/** 두 쪽 사이의 홈(px) */
const GUTTER = 12;
/** 리더 밖(헤더·탭 바·툴바)이 쓰는 세로 예산 — fit 계산의 상수 */
const CHROME_H = 200;
/** 첫 쪽 비율을 모를 때의 기본값(A4 세로) */
const DEFAULT_RATIO = 1.414;
/** 렌더 캐시 상한 — 현재 펼침 ±1 펼침(최대 6쪽) */
const CACHE_MAX = 6;
/** 두 쪽 펼침으로 갈 최소 뷰포트 폭 — tailwind 의 `tab`(700) 과 같은 값 */
const TWO_UP_MIN_W = 700;

/** `{key}` 자리표시자 치환 — 값이 계속 바뀌는 문자열이라 서버에서 포맷할 수 없다 */
function format(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** 렌더된 canvas 한 장을 담는 자리 — 캐시에서 온 요소를 그대로 붙인다(React 자식 없음) */
function Sheet({
  page,
  width,
  ratio,
  label,
  render,
}: {
  page: number;
  width: number;
  ratio: number;
  label: string;
  render: (n: number, cssWidth: number) => Promise<HTMLCanvasElement>;
}) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (width <= 0) return;
    let alive = true;
    render(page, width)
      .then((canvas) => {
        if (!alive || !holder.current) return;
        holder.current.replaceChildren(canvas);
      })
      .catch(() => {
        /* 한 쪽이 실패해도 스켈레톤이 남는다 — 문서 전체 실패는 상위가 따로 알린다 */
      });
    return () => {
      alive = false;
    };
  }, [page, width, render]);

  return (
    <div
      ref={holder}
      role="img"
      aria-label={label}
      className="shrink-0 border border-surface-border bg-white"
      style={{ width, height: Math.round(width * ratio) }}
    />
  );
}

export function PdfSpreadReader({
  url,
  note,
  backHref,
  labels,
}: {
  /** PDF 절대 URL(R2) */
  url: string;
  /** 툴바 아래 한 줄 메모(결락 안내 등) — 없으면 생략 */
  note?: string;
  /** '목록으로' 목적지 (로케일 없는 경로) */
  backHref: string;
  labels: PdfReaderLabels;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [total, setTotal] = useState(0);
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [progress, setProgress] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(0);
  const [twoUp, setTwoUp] = useState(false);
  const [frameW, setFrameW] = useState(0);
  const [budgetH, setBudgetH] = useState(0);
  const [dpr, setDpr] = useState(1);
  const [jump, setJump] = useState('');
  const [mounted, setMounted] = useState(false);

  const frame = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, HTMLCanvasElement>());
  const touchX = useRef<number | null>(null);

  // ── 마운트 뒤에만 읽는 값(하이드레이션 불일치 방지) ─────────────────
  useEffect(() => {
    setMounted(true);
    setDpr(Math.min(window.devicePixelRatio || 1, 2));
    const mq = window.matchMedia(`(min-width: ${TWO_UP_MIN_W}px)`);
    const applyMq = () => setTwoUp(mq.matches);
    applyMq();
    mq.addEventListener('change', applyMq);
    const onResize = () => setBudgetH(Math.max(320, window.innerHeight - CHROME_H));
    onResize();
    window.addEventListener('resize', onResize);
    // 진입 해시(#p-7)는 그 쪽이 든 펼침으로 연다 — 총 쪽수는 아직 모르므로 나중에 clamp 된다
    const m = /^#p-(\d+)$/.exec(window.location.hash);
    if (m) setPage(Math.max(1, Number(m[1])));
    return () => {
      mq.removeEventListener('change', applyMq);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // 리더 영역 폭 — 본문 폭 안에서만 산다(창 크기가 아니라 실제 컨테이너를 잰다)
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setFrameW(entry.contentRect.width));
    ro.observe(el);
    setFrameW(el.clientWidth);
    return () => ro.disconnect();
  }, [mounted]);

  // ── 문서 로드 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted) return;
    let alive = true;
    let doc: PDFDocumentProxy | null = null;
    // 정리 시점에 ref 가 가리키는 Map 이 바뀌어 있을 수 있어 지금 값을 잡아 둔다
    const rendered = cache.current;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        // ⚠️ 워커는 **저장소에 둔 사본**(public/pdf.worker.min.mjs)을 쓴다.
        //    `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` 로 webpack
        //    자산을 내보내는 방법이 정석이지만, Next 14 의 Terser 가 그 .mjs 자산을
        //    스크립트로 취급해 프로덕션 빌드가 깨진다(실측: "'import', and 'export'
        //    cannot be used outside of module code"). 사본의 출처는
        //    node_modules/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs 이고, package.json
        //    의 pdfjs-dist 는 --save-exact 로 고정돼 있다 —— **버전을 올리면 이 파일도
        //    같이 복사해 바꿔야 한다**(API/Worker 버전이 어긋나면 pdf.js 가 거부한다).
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const task = pdfjs.getDocument({
          url,
          // 필요한 쪽만 Range 로 받는다 — 96MB 문서의 첫 펼침이 1초 안에 떠야 한다.
          // disableStream 이 없으면 pdf.js 는 Range 지원을 확인하고도 최초의 전체 GET 스트림을
          // 끝까지 계속 받는다(실측: 36MB 보고서를 열면 44MB 수신). 스트림을 끄면 Range 지원이
          // 확인되는 즉시 전체 요청을 중단하고 1MB 조각만 받는다. ⚠️ Range 지원 판정은 R2 의
          // CORS 규칙이 Accept-Ranges·Content-Length 를 ExposeHeaders 로 내보내야 성립한다 —
          // 안 보이면 pdf.js 는 파일 전체를 받은 뒤에야 첫 쪽을 그린다(tools/r2/README.md).
          rangeChunkSize: 1 << 20,
          disableAutoFetch: true,
          disableStream: true,
        });
        task.onProgress = ({ loaded, total: t }: { loaded: number; total: number }) => {
          if (alive && t > 0) setProgress(Math.min(1, loaded / t));
        };
        doc = await task.promise;
        if (!alive) {
          void doc.destroy();
          return;
        }
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        setRatio(vp.height / vp.width || DEFAULT_RATIO);
        setTotal(doc.numPages);
        setPdf(doc);
        setStatus('ready');
      } catch {
        if (alive) setStatus('error');
      }
    })();
    return () => {
      alive = false;
      rendered.clear();
      void doc?.destroy();
    };
  }, [mounted, url]);

  // ── 크기 계산 (fit = 두 쪽이 들어가는 폭과 세로 예산 중 작은 쪽) ────
  const sheetW = useMemo(() => {
    if (frameW <= 0) return 0;
    const byWidth = twoUp ? (frameW - GUTTER) / 2 : frameW;
    const byHeight = budgetH > 0 ? budgetH / ratio : byWidth;
    return Math.max(80, Math.floor(Math.min(byWidth, byHeight) * ZOOMS[zoom]));
  }, [frameW, budgetH, ratio, twoUp, zoom]);

  // ── 쪽 렌더 + 캐시 ──────────────────────────────────────────────────
  const render = useCallback(
    async (n: number, cssWidth: number): Promise<HTMLCanvasElement> => {
      if (!pdf) throw new Error('document not ready');
      const key = `${n}@${cssWidth}`;
      const hit = cache.current.get(key);
      if (hit) return hit;
      const p = await pdf.getPage(n);
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: (cssWidth / base.width) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      await p.render({ canvasContext: ctx, viewport }).promise;
      // 폭이 바뀌면 키가 통째로 갈리므로, 오래된 것부터 버려 상한을 지킨다
      cache.current.set(key, canvas);
      while (cache.current.size > CACHE_MAX) {
        const oldest = cache.current.keys().next().value;
        if (oldest === undefined) break;
        cache.current.delete(oldest);
      }
      return canvas;
    },
    [pdf, dpr],
  );

  // ── 펼침 계산 ───────────────────────────────────────────────────────
  const step = twoUp ? 2 : 1;
  const maxPage = Math.max(1, total);
  // 두 쪽 펼침의 단위는 (1,2)·(3,4)… 라 선두 쪽은 늘 홀수다
  const lead = Math.min(twoUp ? (page % 2 === 0 ? page - 1 : page) : page, maxPage);
  const sheets = twoUp ? [lead, lead + 1 <= total ? lead + 1 : null] : [lead];
  const canPrev = lead > 1;
  const canNext = lead + step <= total;

  const go = useCallback(
    (n: number) => setPage(Math.min(Math.max(1, n), Math.max(1, total))),
    [total],
  );
  const goPrev = useCallback(() => go(lead - step), [go, lead, step]);
  const goNext = useCallback(() => go(lead + step), [go, lead, step]);

  // 해시 동기화 — 새 히스토리 항목을 만들지 않는다(뒤로가기가 쪽 넘김으로 채워지지 않게)
  useEffect(() => {
    if (!mounted || total === 0) return;
    const next = `#p-${lead}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [mounted, lead, total]);

  // 현재 펼침 ±1 펼침 미리 렌더 — 넘길 때 흰 화면이 잠깐 보이지 않게
  useEffect(() => {
    if (!pdf || sheetW <= 0) return;
    const around = [lead - step, lead - step + 1, lead + step, lead + step + 1];
    for (const n of around) {
      if (n >= 1 && n <= total) void render(n, sheetW).catch(() => {});
    }
  }, [pdf, sheetW, lead, step, total, render]);

  // 키보드 ←/→ — 입력칸에 포커스가 있으면 무시한다(쪽 이동 input 의 캐럿 이동을 뺏지 않게)
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      e.preventDefault();
      if (e.key === 'ArrowLeft') goPrev();
      else goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, goPrev, goNext]);

  const onSpreadClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientX - rect.left < rect.width / 2) goPrev();
    else goNext();
  };

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const from = touchX.current;
    touchX.current = null;
    if (from === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? from) - from;
    if (Math.abs(dx) < 40) return;
    if (dx > 0) goPrev();
    else goNext();
  };

  const onJump = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number.parseInt(jump, 10);
    if (Number.isFinite(n)) go(n);
    setJump('');
  };

  const counter =
    total === 0
      ? ''
      : twoUp && sheets[1]
        ? format(labels.spread, { from: lead, to: lead + 1, total })
        : format(labels.single, { n: lead, total });

  const btn =
    'inline-flex h-8 items-center justify-center border border-surface-border px-2.5 text-sm text-content transition-colors hover:border-yonsei-blue/60 hover:text-yonsei-blue disabled:cursor-default disabled:border-surface-border disabled:text-content-faint/60 disabled:hover:text-content-faint/60';

  return (
    <div>
      {/* 툴바 — 남색 내비 바 아래에 붙는다. 데스크톱 한 줄, 모바일은 두 줄로 접힌다.
          sticky 오프셋 = 헤더(top-16 / lg:top-20) + TabNavBar(h-12) — top-0 이면 스크롤 때
          헤더·내비 바 뒤로 들어가 겹친다(실측). z 는 내비 바(z-30) 아래. */}
      <div className="sticky top-28 z-10 -mx-1 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-surface-border bg-surface px-1 py-2.5 lg:top-32">
        <Link
          href={backHref}
          className="inline-flex h-8 items-center text-sm font-semibold text-yonsei-blue hover:underline"
        >
          ← {labels.back}
        </Link>

        <div className="flex items-center gap-2">
          <button type="button" className={btn} onClick={goPrev} disabled={!canPrev} aria-label={labels.prev}>
            ◀
          </button>
          <span className="min-w-[7.5rem] text-center text-sm tabular-nums text-content-soft">
            {counter}
          </span>
          <button type="button" className={btn} onClick={goNext} disabled={!canNext} aria-label={labels.next}>
            ▶
          </button>
        </div>

        <form onSubmit={onJump} className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="pdf-jump">
            {labels.jump}
          </label>
          <input
            id="pdf-jump"
            type="number"
            min={1}
            max={Math.max(1, total)}
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            placeholder={labels.jump}
            className="h-8 w-24 border border-surface-border bg-surface px-2 text-sm text-content placeholder:text-content-faint/80"
          />
        </form>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={btn}
            onClick={() => setZoom((z) => Math.max(0, z - 1))}
            disabled={zoom === 0}
            aria-label={labels.zoomOut}
          >
            −
          </button>
          <button type="button" className={btn} onClick={() => setZoom(0)} aria-label={labels.zoomFit}>
            {labels.zoomFit}
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
            disabled={zoom === ZOOMS.length - 1}
            aria-label={labels.zoomIn}
          >
            +
          </button>
        </div>
      </div>

      {note && <p className="pt-2 text-xs text-content-faint">{note}</p>}

      {/* 진행 막대 — 문서를 받는 동안에만 */}
      <div className="mt-2 h-0.5 bg-surface-soft" aria-hidden="true">
        {status === 'loading' && (
          <div className="h-full bg-yonsei-blue" style={{ width: `${Math.round(progress * 100)}%` }} />
        )}
      </div>

      {/* 쪽이 바뀌면 보조기술에 위치를 알린다 */}
      <p className="sr-only" aria-live="polite">
        {counter}
      </p>

      {status === 'error' ? (
        <div className="mt-4 border border-surface-border bg-surface-soft p-6">
          {/* 대체 경로로 내려받기를 제안하지 않는다 — 이 문서는 화면 읽기 전용이다 */}
          <p className="text-content-soft">{labels.error}</p>
        </div>
      ) : (
        <div
          ref={frame}
          className={`mt-4 bg-surface-soft p-3 ${zoom > 0 ? 'overflow-auto' : 'overflow-hidden'}`}
        >
          {/* 서버 렌더·로딩 중에는 비율만 잡은 스켈레톤 자리 */}
          {!mounted || !pdf || sheetW <= 0 ? (
            <div className="flex items-center justify-center py-16 text-sm text-content-faint">
              {labels.loading}
            </div>
          ) : (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- 좌/우 절반 클릭은 보조 조작이다(같은 동작의 버튼이 툴바에 있다)
            <div
              className="mx-auto flex w-fit items-start"
              style={{ gap: twoUp ? GUTTER : 0 }}
              onClick={onSpreadClick}
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              {sheets.map((n, i) =>
                n === null ? (
                  // 홀수 총 쪽수의 마지막 펼침 — 오른쪽 자리를 비운 채로 유지한다
                  <div
                    key="blank"
                    aria-hidden="true"
                    className="invisible shrink-0"
                    style={{ width: sheetW, height: Math.round(sheetW * ratio) }}
                  />
                ) : (
                  <Sheet
                    key={`${n}-${i}`}
                    page={n}
                    width={sheetW}
                    ratio={ratio}
                    label={format(labels.pageAlt, { n })}
                    render={render}
                  />
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
