'use client';

// 일정(캘린더) 편집 화면 — 월 그리드 + 편집 패널. BoardEditor 의 네 번째 목록 모양이다.
//
// 다른 게시판은 "목록을 훑으며 고른다"가 기본 동작이라 행·카드·타일이 맞지만, 일정은
// "이 달에 무엇이 있나"를 먼저 보고 빈 날짜에 만든다. 그래서 목록을 아예 달력으로
// 바꾸고, 날짜 칸의 `+ 일정` 이 곧 새 글 쓰기가 되게 했다.
//
// 화면에는 세 종류의 일정이 함께 뜨지만, 셋 다 같은 Supabase posts 테이블에서 온다.
// 구분은 오직 **board 값**으로 한다 —
//  - items (board='calendar'): 여기서 만들고 고치고 지운다.
//  - 행사·동문 행사 게시판 글: **읽기 전용**. 관리자가 한 화면에서 "이 달에 뭐가 있나"를
//    보려면 함께 보여야 하지만, 저 글들의 진실은 각자의 게시판이다. 여기서 고치면
//    같은 글을 두 화면에서 고치게 되므로 기울임 회색 칩으로 구분하고 누르면 해당
//    게시판으로 보낸다.
//
// 기간 일정은 **시작일 칩에 ▸ 를 붙이고 기간 내 모든 칸에 반복** 노출한다(가로 스팬
// 아님). 스팬은 주 경계에서 조각내야 하고, 겹치는 일정마다 행 슬롯을 배정해야 해서
// 칸마다 `+ 일정` 버튼의 위치가 흔들린다. 반복 칩은 각 칸이 독립적이라 어느 날짜를
// 눌러도 같은 동작이 나오고, 구현도 DOM 도 단순하다.
//
// 저장은 **즉시** 나간다 — 변경 트레이에 쌓이지 않는다. 예전에는 content/calendar.json
// 을 커밋하는 경로라 트레이에 모아 한 번에 올렸지만, 지금은 다른 게시판 글과 똑같이
// POST/PUT/DELETE 한 건씩이고 서버가 revalidateTag('posts') 로 사이트를 갱신한다.
// (한국어 UI 문자열은 내부 운영 도구라 컴포넌트에 직접 둔다.)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { civilFromDays, daysInMonth, isoToDays, toIso } from '@/lib/calendar';
import { getBoard, type BoardKey, type BoardMeta, type EditRecord } from '@/lib/admin/boards';
import { useAdminShell } from './AdminShellContext';
import type { ApiRecord } from './BoardEditor';
import { CmsModal } from './CmsModal';

/**
 * 분류 색.
 * ⚠️ 시안은 '모집·신청'에 금색(#8A6D2F)을 쓰지만 이 프로젝트는 금색이 금지되어
 * sky(#2E86D6)로 대체했다 — 네이비·블루·스카이가 한 계열로 이어지고 시험(붉은색)만
 * 대비로 튀어 위계도 오히려 또렷하다.
 */
const CATEGORY_COLOR: Record<string, string> = {
  academic: '#003377',
  event: '#0057A8',
  recruit: '#2E86D6',
  exam: '#b42318',
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** 요일 색 — 일요일 붉은색, 토요일 블루, 평일 회색(사이트 학사일정 표기 관례) */
const WEEKDAY_COLOR = ['#b42318', '#6e6e6e', '#6e6e6e', '#6e6e6e', '#6e6e6e', '#6e6e6e', '#0057A8'];

/** 캘린더에 함께 그리는 게시판 글 — 읽기 전용. 사이트 일정 탭(행사+세미나+캘린더 전용)과
 *  같은 그림이 되도록 세미나를 포함한다(빠져 있어 "연동이 안 된다"는 오해를 낳았다). */
const BOARD_SOURCES: BoardKey[] = ['events', 'seminars', 'alumniEvents'];

interface BoardEvent {
  key: string;
  boardKey: BoardKey;
  title: string;
  start: string;
  end: string;
}

/** /api/admin/posts 응답 중 읽기 전용 칩이 쓰는 필드만 */
interface ApiPost {
  id: string;
  date?: string;
  endDate?: string;
  titleKo?: string;
  isEvent?: boolean;
}

/** 편집 패널이 들고 있는 한 건. dbId 가 없으면 아직 DB 에 없는 새 일정이다. */
interface Draft {
  rec: EditRecord;
  dbId?: string;
}

interface Props {
  meta: BoardMeta;
  /** BoardEditor 가 GET 으로 받아 둔 이 게시판(board='calendar')의 글 목록 */
  items: ApiRecord[];
  busy: boolean;
  /** 즉시 저장 — 새 일정이면 dbId 없음(POST), 기존이면 dbId(PUT). 실패하면 던진다 */
  onSave: (rec: EditRecord, dbId?: string) => Promise<void>;
  /** 즉시 삭제 — BoardEditor 의 확인 모달을 거쳐 DELETE 로 나간다 */
  onDelete: (dbId: string) => void;
}

/** 시작·종료(ISO). 종료가 없거나 시작보다 앞서면 하루로 축약 */
function rangeOf(rec: { date: string; endDate?: string }): { start: string; end: string } {
  const start = (rec.date ?? '').trim();
  const end = (rec.endDate ?? '').trim();
  return { start, end: end && end > start ? end : start };
}

function titleOf(rec: { titleKo: string }): string {
  return (rec.titleKo ?? '').trim();
}

/** 새 일정 한 건 — 그 날짜로 시작하는 하루짜리 일정에서 출발한다(관리자가 가장 자주
 *  만드는 모양이고, 아니면 패널에서 바로 바꾼다). 분류 기본값은 게시판 스키마가 준다. */
function newRecord(meta: BoardMeta, startIso: string): EditRecord {
  return {
    id: '',
    date: startIso,
    titleKo: '',
    titleEn: '',
    bodyKo: '',
    bodyEn: '',
    endDate: '',
    linkUrl: '',
    category: meta.categories?.[0]?.value ?? 'academic',
    attachments: [],
  };
}

export function CalendarEditor({ meta, items, busy, onSave, onDelete }: Props) {
  const { openEntry } = useAdminShell();

  // '오늘'은 KST 기준 — 서버 시간대와 무관하게 한국 날짜 경계를 쓴다(홈 캘린더와 동일).
  const today = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()),
    [],
  );
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split('-').map(Number);
    return { y, m };
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [boardNotice, setBoardNotice] = useState<BoardEvent | null>(null);
  const [boardEvents, setBoardEvents] = useState<BoardEvent[]>([]);

  const titleRef = useRef<HTMLInputElement>(null);
  // `+ 일정` 으로 만든 항목만 제목에 포커스를 준다(기존 칩을 눌러 연 경우는 제외 —
  // 읽으려고 연 패널에서 커서가 잡히면 화면이 스크롤되어 달력이 시야에서 밀린다).
  const focusNewRef = useRef(false);

  const categories = meta.categories ?? [];

  // 게시판 연동 일정 조회 — BoardEditor 가 쓰는 목록 조회 경로를 그대로 재사용한다.
  // ⚠️ 실패해도 조용히 비운다. 행사 게시판 조회가 막혔다고 해서 일정 편집까지 막히면
  //    안 된다(읽기 전용 칩은 참고 정보일 뿐이다).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: BoardEvent[] = [];
      for (const boardKey of BOARD_SOURCES) {
        try {
          const res = await fetch(`/api/admin/posts?board=${boardKey}`);
          if (!res.ok) continue;
          const data = (await res.json()) as { items?: ApiPost[] };
          for (const p of data.items ?? []) {
            // 동문 게시판은 '행사로 표시'한 글만 캘린더에 오른다(page.tsx 와 같은 규칙)
            if (boardKey === 'alumniEvents' && p.isEvent !== true) continue;
            const start = (p.date ?? '').trim();
            if (!start) continue;
            const end = (p.endDate ?? '').trim();
            out.push({
              key: `${boardKey}:${p.id}`,
              boardKey,
              title: (p.titleKo ?? '').trim() || '(제목 없음)',
              start,
              end: end && end > start ? end : start,
            });
          }
        } catch {
          /* 조회 실패는 무시 — 캘린더 전용 일정 편집은 그대로 동작해야 한다 */
        }
      }
      if (alive) setBoardEvents(out);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 새로 만든 일정의 제목에 포커스 (패널이 그려진 뒤)
  useEffect(() => {
    if (draft && focusNewRef.current) {
      titleRef.current?.focus();
      focusNewRef.current = false;
    }
  }, [draft]);

  // 삭제가 끝나 목록에서 사라진 일정의 패널은 닫는다 — 삭제 확인 모달이 상위(BoardEditor)에
  // 있어 여기서는 "지웠다"는 사실을 목록 갱신으로만 알 수 있다.
  useEffect(() => {
    if (draft?.dbId && !items.some((i) => i.id === draft.dbId)) setDraft(null);
  }, [items, draft]);

  // ---- 월 그리드 계산 (Date 객체를 거치지 않는 순수 정수 연산 — lib/calendar) ----

  const grid = useMemo(() => {
    const firstOrd = isoToDays(toIso(cursor.y, cursor.m, 1));
    // 일련번호 0 = 1970-01-01 = 목요일 기준 산술 요일(0=일 … 6=토)
    const lead = (((firstOrd + 4) % 7) + 7) % 7;
    const total = daysInMonth(cursor.y, cursor.m);
    const cells = Math.ceil((lead + total) / 7) * 7;
    return Array.from({ length: cells }, (_, i) => {
      const c = civilFromDays(firstOrd - lead + i);
      return {
        iso: toIso(c.y, c.m, c.d),
        day: c.d,
        dow: i % 7,
        inMonth: c.y === cursor.y && c.m === cursor.m,
      };
    });
  }, [cursor]);

  const monthStart = toIso(cursor.y, cursor.m, 1);
  const monthEnd = toIso(cursor.y, cursor.m, daysInMonth(cursor.y, cursor.m));
  /** 기간이 이 달과 겹치는가 — 8월에 시작해 9월에 끝나는 일정은 두 달 모두에서 센다 */
  const overlapsMonth = (r: { start: string; end: string }) =>
    r.start <= monthEnd && r.end >= monthStart;

  const monthItems = items.filter((r) => overlapsMonth(rangeOf(r)));
  const monthBoard = boardEvents.filter(overlapsMonth);

  const legend = categories.map((o) => ({
    ...o,
    count: monthItems.filter((r) => (r.category ?? '') === o.value).length,
  }));

  // ---- 편집 동작 (전부 로컬 draft — 저장 버튼을 눌러야 서버로 나간다) ----

  const addAt = useCallback(
    (iso: string) => {
      focusNewRef.current = true;
      setPanelError(null);
      setDraft({ rec: newRecord(meta, iso) });
    },
    [meta],
  );

  const openExisting = useCallback((rec: ApiRecord) => {
    setPanelError(null);
    setDraft({ rec: { ...rec }, dbId: rec.id });
  }, []);

  const patch = useCallback((key: keyof EditRecord, value: string) => {
    setDraft((prev) => (prev ? { ...prev, rec: { ...prev.rec, [key]: value } } : prev));
    // 시작일을 다른 달로 옮기면 그 달로 따라간다 — 방금 고친 일정이 화면에서
    // 사라지면 어디로 갔는지 확인할 방법이 없다.
    if (key === 'date' && !Number.isNaN(isoToDays(value))) {
      const [y, m] = value.split('-').map(Number);
      setCursor({ y, m });
    }
  }, []);

  const moveMonth = (delta: number) => {
    setCursor((c) => {
      const total = c.y * 12 + (c.m - 1) + delta;
      return { y: Math.floor(total / 12), m: (total % 12) + 1 };
    });
  };

  /**
   * 저장 — 검증을 통과하면 그대로 서버로 나간다. 실패하면 패널을 닫지 않고 이유를
   * 그 자리에 남긴다(값을 다시 치게 하지 않기 위해).
   */
  async function submit() {
    if (!draft) return;
    const { rec } = draft;
    const start = (rec.date ?? '').trim();
    const end = (rec.endDate ?? '').trim();
    if (titleOf(rec) === '') {
      setPanelError('일정명(한국어)을 입력하세요.');
      return;
    }
    if (start === '') {
      setPanelError('시작일을 입력하세요.');
      return;
    }
    if (end !== '' && end < start) {
      setPanelError('종료일은 시작일보다 빠를 수 없습니다.');
      return;
    }
    setPanelError(null);
    try {
      await onSave(rec, draft.dbId);
      setDraft(null);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    }
  }

  const draftId = draft?.dbId ?? null;

  return (
    <div>
      {/* ---- 월 이동 · 건수 · 범례 ---- */}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => moveMonth(-1)}
            aria-label="이전 달"
            className="cms-btn cms-btn-sm px-3.5 font-bold"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => moveMonth(1)}
            aria-label="다음 달"
            className="cms-btn cms-btn-sm px-3.5 font-bold"
          >
            ›
          </button>
        </span>
        <strong className="text-[20px] font-bold tracking-tight tabular-nums text-content">
          {cursor.y}년 {cursor.m}월
        </strong>
        <button
          type="button"
          onClick={() => {
            const [y, m] = today.split('-').map(Number);
            setCursor({ y, m });
          }}
          className="cms-btn cms-btn-sm"
        >
          오늘
        </button>
        <span className="text-xs tabular-nums text-content-faint">
          이 달 {monthItems.length + monthBoard.length}건 · 캘린더 전용 {monthItems.length}건 ·
          게시판 연동 {monthBoard.length}건
        </span>
        <span className="flex flex-wrap items-center gap-3.5 sm:ml-auto">
          {legend.map((l) => (
            <span key={l.value} className="flex items-center gap-1.5 text-xs text-content">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0"
                style={{ backgroundColor: CATEGORY_COLOR[l.value] }}
              />
              {l.label}
              <span className="tabular-nums text-content-faint">{l.count}</span>
            </span>
          ))}
        </span>
      </div>

      {/* ---- 월 그리드 ---- */}
      <div className="mt-4 overflow-x-auto border-l border-t-2 border-l-[#f1f4f8] border-t-yonsei-navy">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-7 bg-[#fcfdfe]">
            {WEEKDAYS.map((w, i) => (
              <span
                key={w}
                className="border-b border-r border-b-surface-border border-r-[#f1f4f8] px-2 py-2.5 text-[11px] font-bold"
                style={{ color: WEEKDAY_COLOR[i] }}
              >
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.map((cell) => {
              // ⚠️ 아직 저장하지 않은 새 일정은 여기 그리지 않는다 — DB 에 없는 것을
              //    달력에 올리면 "이미 등록됐다"고 읽힌다. 그 일정의 자리는 편집 패널이다.
              const dayItems = items.filter((r) => {
                const range = rangeOf(r);
                return range.start <= cell.iso && cell.iso <= range.end;
              });
              const dayBoard = boardEvents.filter(
                (e) => e.start <= cell.iso && cell.iso <= e.end,
              );
              const isToday = cell.iso === today;
              return (
                <div
                  key={cell.iso}
                  className={cn(
                    'min-h-[116px] border-b border-r border-[#f1f4f8] p-1.5',
                    // 이번 달이 아닌 칸은 흐리게 — 눈이 이번 달 영역을 먼저 잡도록
                    !cell.inMonth && 'bg-[#fcfdfe] opacity-50',
                  )}
                >
                  <span className="mb-1.5 block">
                    <span
                      className={cn(
                        'inline-flex h-[18px] min-w-[18px] items-center justify-center px-1 text-[11px] font-bold tabular-nums',
                        isToday && 'bg-yonsei-navy text-white',
                      )}
                      style={isToday ? undefined : { color: WEEKDAY_COLOR[cell.dow] }}
                    >
                      {cell.day}
                    </span>
                  </span>

                  {dayItems.map((rec) => {
                    const range = rangeOf(rec);
                    const isStart = range.start === cell.iso;
                    const isRange = range.end > range.start;
                    return (
                      <button
                        key={rec.id}
                        type="button"
                        onClick={() => openExisting(rec)}
                        title={titleOf(rec) || '(제목 없음)'}
                        style={{ borderLeftColor: CATEGORY_COLOR[rec.category ?? ''] ?? '#003377' }}
                        className={cn(
                          'mb-1 block w-full truncate border-l-[3px] bg-surface-soft px-1.5 py-1 text-left text-[11px] font-semibold text-content transition-colors hover:bg-yonsei-blue/10',
                          // 기간 중간 날짜는 옅게 — 어디서 시작했는지가 한눈에 보이도록
                          !isStart && 'opacity-60',
                          draftId === rec.id && 'outline outline-1 -outline-offset-1 outline-yonsei-blue',
                        )}
                      >
                        {isStart && isRange ? '▸ ' : ''}
                        {titleOf(rec) || '(제목 없음)'}
                      </button>
                    );
                  })}

                  {dayBoard.map((e) => (
                    <button
                      key={e.key}
                      type="button"
                      onClick={() => setBoardNotice(e)}
                      title={`${e.title} — ${getBoard(e.boardKey).label} 게시판`}
                      className="mb-1 block w-full truncate border-l-[3px] border-l-[#c9d2dd] bg-[#fcfdfe] px-1.5 py-1 text-left text-[11px] italic text-content-faint transition-colors hover:text-yonsei-blue"
                    >
                      {e.title}
                    </button>
                  ))}

                  {cell.inMonth && (
                    <button
                      type="button"
                      onClick={() => addAt(cell.iso)}
                      disabled={busy}
                      className="block w-full border border-dashed border-surface-border px-1.5 py-1 text-[10px] font-semibold text-content-faint transition-colors duration-200 ease-out-expo hover:border-yonsei-blue hover:text-yonsei-blue disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      + 일정
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---- 편집 패널 ---- */}
      {draft && (
        <div className="anim-panel mt-5 border border-yonsei-navy bg-surface">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-surface-border bg-[#fcfdfe] px-4 py-2.5">
            <strong className="text-[13px] font-bold text-content">
              {draft.dbId ? '일정 편집' : '새 일정'}
            </strong>
            <span className="text-[11px] text-content-faint">
              {draft.dbId
                ? '게시글 없이 캘린더에만 노출됩니다'
                : '게시글 없이 캘린더에만 노출됩니다 — 저장해야 달력에 올라갑니다'}
            </span>
            <span className="ml-auto flex items-center gap-2.5">
              {draft.dbId ? (
                <button
                  type="button"
                  onClick={() => onDelete(draft.dbId as string)}
                  disabled={busy}
                  className="border-0 bg-transparent text-xs font-semibold text-[#b42318] transition-opacity hover:opacity-70 disabled:opacity-40"
                >
                  삭제
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setPanelError(null);
                }}
                className="cms-btn cms-btn-sm"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="cms-btn cms-btn-primary cms-btn-sm"
              >
                저장
              </button>
            </span>
          </div>

          <div className="px-5 pb-6 pt-4">
            {panelError && (
              <p role="alert" className="mb-3.5 text-xs font-semibold text-[#b42318]">
                {panelError}
              </p>
            )}

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold text-content-faint">
                일정명 (한국어) <span className="text-[#b42318]">*</span>
              </span>
              <input
                ref={titleRef}
                type="text"
                value={draft.rec.titleKo}
                onChange={(e) => patch('titleKo', e.target.value)}
                placeholder="예: 수강신청 확인 및 변경"
                className="cms-input font-semibold"
              />
            </label>
            <label className="mt-3.5 block">
              <span className="mb-1.5 block text-[11px] font-bold text-content-faint">
                일정명 (English)
              </span>
              <input
                type="text"
                value={draft.rec.titleEn}
                onChange={(e) => patch('titleEn', e.target.value)}
                placeholder="비우면 영문 페이지에 한국어가 노출됩니다"
                className="cms-input-sm"
              />
            </label>

            <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-surface-border pt-4">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold text-content-faint">
                  시작일 <span className="text-[#b42318]">*</span>
                </span>
                <input
                  type="date"
                  value={draft.rec.date}
                  onChange={(e) => patch('date', e.target.value)}
                  className="cms-input-sm w-auto"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold text-content-faint">
                  종료일 (하루 일정이면 비움)
                </span>
                <input
                  type="date"
                  value={draft.rec.endDate ?? ''}
                  onChange={(e) => patch('endDate', e.target.value)}
                  className="cms-input-sm w-auto"
                />
              </label>
              <span className="block">
                <span className="mb-1.5 block text-[11px] font-bold text-content-faint">분류</span>
                <span className="flex flex-wrap gap-1.5">
                  {categories.map((o) => {
                    const on = (draft.rec.category ?? '') === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => patch('category', o.value)}
                        style={
                          on
                            ? { backgroundColor: CATEGORY_COLOR[o.value], borderColor: CATEGORY_COLOR[o.value] }
                            : undefined
                        }
                        className={cn(
                          'inline-flex items-center gap-1.5 border px-2.5 py-2 text-xs font-semibold transition-colors duration-200 ease-out-expo',
                          on
                            ? 'text-white'
                            : 'border-surface-border bg-surface text-content hover:border-yonsei-blue hover:text-yonsei-blue',
                        )}
                      >
                        {!on && (
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 shrink-0"
                            style={{ backgroundColor: CATEGORY_COLOR[o.value] }}
                          />
                        )}
                        {o.label}
                      </button>
                    );
                  })}
                </span>
              </span>
            </div>

            {/* 링크는 **선택**이다 — "반드시 가야 할 목적지"가 아니라
                더 볼 것이 있을 때만 붙이는 보조 정보다. 그래서 필수 검증을 두지 않는다. */}
            <label className="mt-4 block border-t border-surface-border pt-4">
              <span className="mb-1.5 block text-[11px] font-bold text-content-faint">
                연결 링크 (선택)
              </span>
              <input
                type="text"
                value={draft.rec.linkUrl ?? ''}
                onChange={(e) => patch('linkUrl', e.target.value)}
                placeholder="https://…"
                className="cms-input-sm"
              />
              <span className="mt-1.5 block text-[11px] text-content-faint">
                비우면 링크 없는 카드로 표시됩니다 — 관련 안내 페이지나 게시글 주소를 넣을 수
                있습니다.
              </span>
            </label>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs leading-[1.8] text-content-faint">
        빈 날짜의 <strong className="text-content">+ 일정</strong> 을 누르면 그 날짜로 편집 패널이
        열립니다. <strong className="text-content">저장해야 달력에 올라갑니다</strong> — 저장하면
        사이트에 수 초 내 반영됩니다. 기울임체 칩은{' '}
        <strong className="text-content">행사·세미나·동문 행사 게시판에서 자동으로 올라온 일정</strong>
        이라 여기서 고칠 수 없고, 해당 게시판에서 수정합니다.
      </p>

      {boardNotice && (
        <CmsModal
          title="이 일정은 게시판 글에서 옵니다"
          confirmLabel="게시판으로 이동"
          cancelLabel="닫기"
          body={
            <>
              <p className="font-semibold text-content">{boardNotice.title}</p>
              <p className="mt-2">
                이 일정은 〈{getBoard(boardNotice.boardKey).label}〉 게시판의 글에서 옵니다. 거기서
                수정하세요.
              </p>
            </>
          }
          onConfirm={() => {
            const target = boardNotice.boardKey;
            setBoardNotice(null);
            openEntry({ type: 'board', boardKey: target });
          }}
          onCancel={() => setBoardNotice(null)}
        />
      )}
    </div>
  );
}
