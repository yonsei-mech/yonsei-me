'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BoardActionLink, type BoardAction } from '@/components/BoardActionLink';

/** 검색 범위 — 제목 / 내용(발췌) / 제목+내용 */
export type SearchScope = 'both' | 'title' | 'content';

export interface BoardFilterState {
  scope: SearchScope;
  query: string;
}

export const emptyFilter: BoardFilterState = { scope: 'both', query: '' };

/** 검색어 정규화: 소문자화 + 공백 접기 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 필터가 활성인지(검색어가 있는지) */
export function isFilterActive(f: BoardFilterState): boolean {
  return normalize(f.query) !== '';
}

/**
 * 한 행이 검색 조건을 만족하는지 판정.
 * scope 에 따라 제목/내용(subtitle=발췌)/둘 다에서 공백 정규화·소문자 부분일치.
 * '내용' 검색은 목록에 실려 있는 발췌(subtitle) 기준 — 전문 본문은 목록 페이로드에 없다.
 */
export function matchesFilter(
  row: { title: string; subtitle?: string | null },
  f: BoardFilterState,
): boolean {
  const q = normalize(f.query);
  if (!q) return true;
  const inTitle = () => normalize(row.title).includes(q);
  const inContent = () => normalize(row.subtitle ?? '').includes(q);
  if (f.scope === 'title') return inTitle();
  if (f.scope === 'content') return inContent();
  return inTitle() || inContent();
}

// 글자는 13px — 게시판 영역 전체를 기본 타이포의 90%로 낮춘 눈금에 맞춘다.
// 패딩(py-2)은 그대로 둔다: 더 줄이면 터치 목표가 32px 밑으로 떨어진다.
const inputClass =
  'border border-surface-border bg-surface px-3 py-2 text-[13px] text-content transition-colors placeholder:text-content-faint focus:border-yonsei-blue focus:outline-none';

/**
 * 단일 게시판용 검색 바 — 실제 학부 사이트 게시판 UI 이식(사용자 캡처 기준).
 * 목록 위 우측 정렬: [검색 범위 셀렉트(제목+내용/제목/내용)] [검색어 입력] [검색 버튼].
 * 입력은 내부 초안(draft)으로 들고 있다가 폼 제출(버튼/Enter) 시에만 적용한다.
 * 초기화 버튼과 결과 건수는 적용된 필터가 활성일 때만 노출.
 */
export function BoardFilterBar({
  value,
  onChange,
  resultCount = null,
  action,
}: {
  value: BoardFilterState;
  onChange: (v: BoardFilterState) => void;
  resultCount?: number | null;
  /** 선택 진입 버튼(학위논문심사의 공고 등록). 넘기지 않으면 마크업이 종전과 완전히 같다. */
  action?: BoardAction;
}) {
  const t = useTranslations('news');
  const active = isFilterActive(value);

  // 초안 상태 — 제출 전까지 목록에 반영하지 않는다(레퍼런스 게시판과 동일한 조작감).
  const [draft, setDraft] = useState(value);
  // 부모가 값을 바꾸면(초기화 등) 초안도 동기화.
  useEffect(() => setDraft(value), [value]);

  // 모바일도 한 줄 — 전폭 블록 3층(범위/입력/버튼) 세로 스택은 게시판 검색이 아니라
  // 가입 폼처럼 읽힌다. 좁은 화면에선 셀렉트·버튼을 내용 폭으로 줄이고 입력이
  // 남는 폭을 전부 가져간다. 초기화만 자리가 모자라면 flex-wrap 으로 다음 줄.
  const form = (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(draft);
      }}
      className="flex flex-wrap items-center gap-2 sm:justify-end"
    >
      {/* 검색 범위 — 내용 폭 고정(줄어들면 라벨이 잘려 의미를 잃는다) */}
      <div className="shrink-0">
        <label htmlFor="board-filter-scope" className="sr-only">
          {t('search.scopeLabel')}
        </label>
        <select
          id="board-filter-scope"
          value={draft.scope}
          onChange={(e) => setDraft({ ...draft, scope: e.target.value as SearchScope })}
          className={`${inputClass} w-auto sm:w-36`}
        >
          <option value="both">{t('search.scopeBoth')}</option>
          <option value="title">{t('search.scopeTitle')}</option>
          <option value="content">{t('search.scopeContent')}</option>
        </select>
      </div>

      {/* 검색어 — 남는 폭 전부 */}
      <div className="min-w-0 flex-1 sm:w-[22rem] sm:flex-none lg:w-[26rem]">
        <label htmlFor="board-filter-query" className="sr-only">
          {t('search.placeholder')}
        </label>
        <input
          id="board-filter-query"
          type="search"
          value={draft.query}
          onChange={(e) => setDraft({ ...draft, query: e.target.value })}
          placeholder={t('search.placeholder')}
          className={`${inputClass} w-full`}
        />
      </div>

      {/* 검색 실행 — 입력 오른쪽에 붙인다(일반적인 검색 바 문법) */}
      <button
        type="submit"
        className="shrink-0 bg-yonsei-navy px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-yonsei-blue sm:px-6"
      >
        {t('search.submit')}
      </button>

      {/* 초기화 (적용된 조건이 있을 때) */}
      {active && (
        <button
          type="button"
          onClick={() => {
            setDraft(emptyFilter);
            onChange(emptyFilter);
          }}
          className="shrink-0 border border-surface-border px-4 py-2 text-[13px] font-medium text-content-soft transition-colors hover:border-yonsei-blue hover:text-yonsei-blue"
        >
          {t('search.clear')}
        </button>
      )}
    </form>
  );

  // 결과 건수 (조건 활성 + 건수 전달 시) — 우측 정렬로 검색 바와 나란히
  const count = active && resultCount !== null && (
    <p className="mt-2 text-right text-[13px] text-content-soft" aria-live="polite">
      {t('search.results', { count: resultCount })}
    </p>
  );

  if (!action) {
    return (
      <div className="mb-6">
        {form}
        {count}
      </div>
    );
  }

  // 진입 버튼이 있는 툴바(spec §2 화면 A).
  // lg 미만: [버튼(전체 폭 48)] → 8px → [보조 문구] → 20px → [검색 줄].
  //   h1 의 mb-10(40px)을 -mt-4 로 당겨 h1–버튼 간격 24px 을 맞춘다.
  // lg 이상: [검색 줄] ─16─ 헤어라인 24 ─16─ [버튼] 한 줄, 그 바로 아래 보조 문구를 버튼 오른쪽 끝에 맞춰 우측 정렬.
  //   버튼은 줄 높이에 늘여(items-stretch) 검색 입력과 높이가 같다.
  return (
    <div className="mb-6">
      <div className="-mt-4 mb-5 lg:hidden">
        <BoardActionLink action={action} variant="toolbar-mobile" describedBy={ACTION_NOTE_ID_MOBILE} />
        <p id={ACTION_NOTE_ID_MOBILE} className="mt-2 text-[13px] leading-[1.6] text-content-faint">
          {action.note}
        </p>
      </div>
      <div className="lg:flex lg:items-stretch lg:justify-end">
        {form}
        <span aria-hidden="true" className="mx-4 hidden h-6 w-px self-center bg-surface-border lg:block" />
        <BoardActionLink action={action} variant="toolbar-desktop" describedBy={ACTION_NOTE_ID_DESKTOP} />
      </div>
      <p
        id={ACTION_NOTE_ID_DESKTOP}
        className="mt-2 hidden text-right text-[12.5px] leading-[1.6] text-content-faint lg:block"
      >
        {action.note}
      </p>
      {count}
    </div>
  );
}

/** 보조 문구 id — 브레이크포인트별 버튼이 각자 보이는 쪽 문구를 가리킨다.
 *  (검색 필드 id 처럼 한 페이지에 검색 바가 하나라는 전제의 고정값이다) */
const ACTION_NOTE_ID_MOBILE = 'board-action-note-m';
const ACTION_NOTE_ID_DESKTOP = 'board-action-note-d';
