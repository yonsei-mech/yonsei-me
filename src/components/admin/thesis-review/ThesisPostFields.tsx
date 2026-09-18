'use client';

// 교직원 공고 양식(ThesisPostForm)의 입력 칸 묶음 — 게시 제목 · 발표자와 논문 · 심사위원 ·
// 일시와 장소 · 게시 설정. 칸 구성·검사는 학생 공고 입력(ThesisNoticeForm)과 같고, 모양은
// 콘솔 관례(각진 1px 경계·네이비 주 동작, 금색 없음)와 디자인 "학위논문심사 CMS 편집 폼"을 따른다.
// 오류는 칸 바로 아래(aria-invalid + aria-describedby). 상태·검사는 부모가 가진다.

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  HONORIFICS,
  NOTICE_LIMITS,
  PROGRAMS,
  type CommitteeMember,
  type Honorific,
  type ThesisNoticeInput,
} from '@/lib/thesis-submit/notice';
import { IcoAlertCircle, IcoPlus } from '../cms-icons';
import type { FormError, ThesisFormMode, ThesisFormState } from './thesis-post-model';

// ── 공용 클래스 ─────────────────────────────────────────────────────────────
export const LABEL = 'text-[13px] font-semibold leading-5 text-content-faint';
export const HINT = 'text-[13px] leading-[1.6] text-content-faint';
const FIELD =
  'h-[50px] w-full min-w-0 border bg-surface px-3.5 text-[15px] text-content outline-none transition-colors placeholder:text-[#a8b0ba] focus:border-yonsei-blue disabled:cursor-not-allowed dark:[color-scheme:dark] dark:placeholder:text-[#5e6c84] dark:focus:border-brand';

function border(invalid: boolean): string {
  return invalid ? 'border-[#b42318] dark:border-[#fda29b]' : 'border-surface-border';
}

/** 칸 id·오류 id·오류 조회 — 부모가 만든다 */
export interface FieldKit {
  fid: (field: string) => string;
  eid: (field: string) => string;
  errOf: (field: string) => FormError | undefined;
}

type NoticeUpdate = (fn: (prev: ThesisNoticeInput) => ThesisNoticeInput) => void;

export function FieldError({ kit, field }: { kit: FieldKit; field: string }) {
  const e = kit.errOf(field);
  if (!e) return null;
  return (
    <p
      id={kit.eid(field)}
      className="flex items-start gap-1.5 text-[13px] font-semibold leading-[1.5] text-[#b42318] dark:text-[#fda29b]"
    >
      <IcoAlertCircle size={14} className="mt-[3px] shrink-0" />
      {e.message}
    </p>
  );
}

/** aria 속성 — 오류가 있으면 invalid + 오류 문장, 없으면 힌트(있으면) */
function described(kit: FieldKit, field: string, hintId?: string) {
  const e = kit.errOf(field);
  return {
    'aria-invalid': e ? (true as const) : undefined,
    'aria-describedby': [e && kit.eid(field), hintId].filter(Boolean).join(' ') || undefined,
  };
}

/** 섹션 머리 — 영문 eyebrow + Paperlogy 제목(디자인). 오른쪽 note 는 선택 */
export function SectionHead({ id, eyebrow, title, note }: { id: string; eyebrow: string; title: string; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5">
      <div className="flex flex-col gap-1.5">
        <span className="cms-eyebrow dark:text-brand">{eyebrow}</span>
        <h2 id={id} className="font-subhead text-xl font-bold leading-tight text-content">
          {title}
        </h2>
      </div>
      {note}
    </div>
  );
}

const SECTION = 'flex flex-col gap-5 border-t border-surface-border pt-7';

// ─────────────────────────────────────────────────────────────
// 게시 제목 — 자동 생성(잠김) ↔ 직접 수정
// ─────────────────────────────────────────────────────────────

export function TitleField({
  kit,
  state,
  title,
  onManual,
  onTitle,
}: {
  kit: FieldKit;
  state: ThesisFormState;
  /** 지금 보이는 제목(자동이면 postTitle, 직접이면 입력값) */
  title: string;
  onManual: (on: boolean) => void;
  onTitle: (v: string) => void;
}) {
  const hintId = `${kit.fid('postTitle')}-hint`;
  const hint = state.manual
    ? '직접 수정 중입니다. 심사일·성명을 바꿔도 제목은 그대로입니다.'
    : title
      ? '심사일이나 성명을 고치면 제목도 함께 바뀝니다.'
      : '심사일과 성명을 채우면 ‘[YYMMDD] 성명’ 형식으로 채워집니다.';
  const err = kit.errOf('postTitle');
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <label htmlFor={kit.fid('postTitle')} className={LABEL}>
          게시 제목
        </label>
        {!state.manual && (
          <span className="inline-flex items-center gap-1 border border-yonsei-navy px-1.5 py-0.5 text-[11px] font-bold text-yonsei-navy dark:border-brand dark:text-brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="h-[11px] w-[11px]">
              <rect x="5" y="11" width="14" height="10" rx="1" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
            </svg>
            자동 생성
          </span>
        )}
        <label className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-content">
          <input
            type="checkbox"
            checked={state.manual}
            onChange={(e) => onManual(e.target.checked)}
            className="h-[18px] w-[18px] accent-yonsei-blue dark:accent-brand"
          />
          직접 수정
        </label>
      </div>
      <input
        id={kit.fid('postTitle')}
        type="text"
        value={title}
        readOnly={!state.manual}
        placeholder={state.manual ? '제목을 입력하세요' : '[YYMMDD] 성명'}
        autoComplete="off"
        onChange={(e) => onTitle(e.target.value)}
        {...described(kit, 'postTitle', err ? undefined : hintId)}
        className={cn(
          'h-14 w-full min-w-0 border px-4 text-[20px] font-bold tabular-nums tracking-[-0.01em] outline-none transition-colors placeholder:font-normal placeholder:text-[#a8b0ba] lg:h-16 lg:px-[18px] lg:text-[26px] dark:placeholder:text-[#5e6c84]',
          state.manual
            ? 'bg-surface text-content focus:border-yonsei-blue dark:focus:border-brand'
            : 'cursor-default bg-surface-soft text-yonsei-navy dark:text-brand',
          border(!!err),
        )}
      />
      {err ? (
        <FieldError kit={kit} field="postTitle" />
      ) : (
        <p id={hintId} className={HINT}>
          {hint}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 발표자와 논문
// ─────────────────────────────────────────────────────────────

export function PresenterSection({ kit, notice, update }: { kit: FieldKit; notice: ThesisNoticeInput; update: NoticeUpdate }) {
  const programErr = kit.errOf('program');
  const titleHint = `${kit.fid('title')}-hint`;
  return (
    <section aria-labelledby={kit.fid('s-presenter')} className={SECTION}>
      <SectionHead
        id={kit.fid('s-presenter')}
        eyebrow="Presenter"
        title="발표자와 논문"
        note={<p className="text-xs text-content-faint">모든 칸이 포스터에 그대로 들어갑니다</p>}
      />
      <div className="grid gap-5 sm:grid-cols-2 sm:gap-x-6">
        <fieldset aria-describedby={programErr ? kit.eid('program') : undefined} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className={cn(LABEL, 'mb-2 p-0')}>과정</legend>
          <div className="grid grid-cols-2">
            {PROGRAMS.map((p, i) => {
              const on = notice.program === p;
              return (
                <label
                  key={p}
                  className={cn(
                    'relative flex h-[50px] cursor-pointer items-center justify-center gap-2 border text-[15px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-yonsei-blue',
                    i > 0 && '-ml-px',
                    on
                      ? 'z-[1] border-yonsei-navy bg-yonsei-navy font-bold text-white dark:border-brand dark:bg-brand dark:text-brand-fg'
                      : cn(border(!!programErr), 'bg-surface font-medium text-content hover:bg-surface-soft'),
                  )}
                >
                  <input
                    id={i === 0 ? kit.fid('program') : undefined}
                    type="radio"
                    name={kit.fid('program')}
                    value={p}
                    checked={on}
                    onChange={() => update((prev) => ({ ...prev, program: p }))}
                    className="sr-only"
                  />
                  {p}
                </label>
              );
            })}
          </div>
          <FieldError kit={kit} field="program" />
        </fieldset>
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={kit.fid('presenter')} className={LABEL}>
            발표자 성명
          </label>
          <input
            id={kit.fid('presenter')}
            type="text"
            value={notice.presenter}
            autoComplete="off"
            placeholder="심사 대상 학생 이름"
            onChange={(e) => {
              const v = e.target.value;
              update((prev) => ({ ...prev, presenter: v }));
            }}
            {...described(kit, 'presenter')}
            className={cn(FIELD, border(!!kit.errOf('presenter')))}
          />
          <FieldError kit={kit} field="presenter" />
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
          <label htmlFor={kit.fid('title')} className={LABEL}>
            논문 제목
          </label>
          <textarea
            id={kit.fid('title')}
            rows={2}
            value={notice.title}
            onChange={(e) => {
              const v = e.target.value;
              update((prev) => ({ ...prev, title: v }));
            }}
            {...described(kit, 'title', kit.errOf('title') ? undefined : titleHint)}
            className={cn(
              FIELD,
              'h-auto min-h-[84px] resize-y py-3 leading-[1.6] [field-sizing:content]',
              border(!!kit.errOf('title')),
            )}
          />
          {kit.errOf('title') ? (
            <FieldError kit={kit} field="title" />
          ) : (
            <p id={titleHint} className={HINT}>
              포스터에 입력한 그대로 들어갑니다(국문·영문 무관).
            </p>
          )}
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 text-[15px] leading-6 text-content sm:col-span-2">
          <input
            id={kit.fid('welcome')}
            type="checkbox"
            checked={notice.welcome}
            onChange={(e) => {
              const welcome = e.target.checked;
              update((prev) => ({ ...prev, welcome }));
            }}
            className="mt-[3px] h-[18px] w-[18px] shrink-0 accent-yonsei-blue dark:accent-brand"
          />
          <span>포스터 머리글에 ‘(관심있는 연구자 누구나 환영)’ 넣기</span>
        </label>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 심사위원 — 위원장 + 위원 줄(성명·호칭·소속), 추가·삭제
// ─────────────────────────────────────────────────────────────

export function CommitteeSection({
  kit,
  notice,
  update,
  onAdd,
  onRemove,
}: {
  kit: FieldKit;
  notice: ThesisNoticeInput;
  update: NoticeUpdate;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  const hintId = kit.fid('committee-hint');
  const membersErr = kit.errOf('members');

  function row(i: number) {
    const isChair = i < 0;
    const m = isChair ? notice.chair : notice.members[i];
    const base = isChair ? 'chair' : `members.${i}`;
    const rowLabel = isChair ? '심사위원장' : `심사위원 ${i + 1}`;
    const rowLabelId = `${kit.fid(base)}-label`;
    const patch = (p: Partial<CommitteeMember>) =>
      update((prev) =>
        isChair
          ? { ...prev, chair: { ...prev.chair, ...p } }
          : { ...prev, members: prev.members.map((x, j) => (j === i ? { ...x, ...p } : x)) },
      );
    const nameErr = kit.errOf(`${base}.name`);
    const affErr = kit.errOf(`${base}.affiliation`);
    // 위원 수 오류(한 명도 없음·초과)는 첫 위원 줄 성명 칸이 함께 가리킨다
    const nameDescribedBy = [nameErr && kit.eid(`${base}.name`), i === 0 && membersErr && kit.eid('members')]
      .filter(Boolean)
      .join(' ');
    return (
      <div key={base} role="group" aria-labelledby={rowLabelId} className="flex flex-col gap-2">
        <div className="flex min-h-5 items-center justify-between gap-3">
          <span id={rowLabelId} className={cn(LABEL, isChair && 'text-content')}>
            {rowLabel}
          </span>
          {!isChair && notice.members.length > 1 && (
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`${rowLabel} 삭제`}
              className="-my-3 -mr-1.5 inline-flex min-h-11 items-center gap-1 px-1.5 text-[13px] font-semibold text-content-faint transition-colors hover:text-[#b42318] dark:hover:text-[#fda29b] lg:-my-1.5 lg:min-h-8"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
                <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
              </svg>
              삭제
            </button>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.15fr)]">
          <input
            id={kit.fid(`${base}.name`)}
            type="text"
            value={m.name}
            placeholder="성명"
            autoComplete="off"
            aria-label={`${rowLabel} 성명`}
            aria-invalid={nameErr ? true : undefined}
            aria-describedby={nameDescribedBy || undefined}
            onChange={(e) => patch({ name: e.target.value })}
            className={cn(FIELD, border(!!nameErr))}
          />
          <select
            id={kit.fid(`${base}.honorific`)}
            value={m.honorific}
            aria-label={`${rowLabel} 호칭`}
            onChange={(e) => patch({ honorific: e.target.value as Honorific })}
            className={cn(FIELD, 'cms-select min-w-[7.5rem]', border(false))}
          >
            {HONORIFICS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <input
            id={kit.fid(`${base}.affiliation`)}
            type="text"
            value={m.affiliation}
            placeholder="학외 위원만 (예: 서강대)"
            autoComplete="off"
            aria-label={`${rowLabel} 소속`}
            aria-invalid={affErr ? true : undefined}
            aria-describedby={[affErr && kit.eid(`${base}.affiliation`), hintId].filter(Boolean).join(' ')}
            onChange={(e) => patch({ affiliation: e.target.value })}
            className={cn(FIELD, border(!!affErr), 'col-span-2 sm:col-span-1')}
          />
        </div>
        <FieldError kit={kit} field={`${base}.name`} />
        <FieldError kit={kit} field={`${base}.affiliation`} />
      </div>
    );
  }

  return (
    <section aria-labelledby={kit.fid('s-committee')} className={SECTION}>
      <div>
        <SectionHead id={kit.fid('s-committee')} eyebrow="Committee" title="심사위원" />
        <p id={hintId} className={cn(HINT, 'mt-2')}>
          포스터에 표시될 그대로 입력합니다. 학외 위원은 소속을 적으면 ‘(서강대)’처럼 붙습니다.
        </p>
      </div>
      {row(-1)}
      {notice.members.map((_, i) => row(i))}
      <FieldError kit={kit} field="members" />
      {notice.members.length < NOTICE_LIMITS.maxMembers && (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex min-h-11 items-center gap-1.5 self-start border border-dashed border-content-faint/40 px-4 text-sm font-semibold text-yonsei-blue transition-colors hover:border-yonsei-blue dark:text-brand dark:hover:border-brand"
        >
          <IcoPlus size={16} className="shrink-0" />
          심사위원 추가
        </button>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 일시와 장소
// ─────────────────────────────────────────────────────────────

export function WhenSection({ kit, notice, update }: { kit: FieldKit; notice: ThesisNoticeInput; update: NoticeUpdate }) {
  const set = (key: 'date' | 'time' | 'place', v: string) => update((prev) => ({ ...prev, [key]: v }));
  return (
    <section aria-labelledby={kit.fid('s-when')} className={SECTION}>
      <SectionHead id={kit.fid('s-when')} eyebrow="Examination" title="일시와 장소" />
      <div className="grid gap-5 sm:grid-cols-2 sm:gap-x-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor={kit.fid('date')} className={LABEL}>
              심사일
            </label>
            <input
              id={kit.fid('date')}
              type="date"
              value={notice.date}
              onChange={(e) => set('date', e.target.value)}
              {...described(kit, 'date')}
              className={cn(FIELD, 'px-3', border(!!kit.errOf('date')))}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor={kit.fid('time')} className={LABEL}>
              시각
            </label>
            <input
              id={kit.fid('time')}
              type="time"
              step={300}
              value={notice.time}
              onChange={(e) => set('time', e.target.value)}
              {...described(kit, 'time')}
              className={cn(FIELD, 'px-3', border(!!kit.errOf('time')))}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5 empty:hidden">
            <FieldError kit={kit} field="date" />
            <FieldError kit={kit} field="time" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={kit.fid('place')} className={LABEL}>
            장소
          </label>
          <input
            id={kit.fid('place')}
            type="text"
            value={notice.place}
            placeholder="예: 제4공학관 6층 609호 세미나실"
            autoComplete="off"
            onChange={(e) => set('place', e.target.value)}
            {...described(kit, 'place')}
            className={cn(FIELD, border(!!kit.errOf('place')))}
          />
          <FieldError kit={kit} field="place" />
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 게시 설정 — 게시일 + 예약 공개
// ─────────────────────────────────────────────────────────────

export function PublishSection({
  kit,
  mode,
  state,
  onChange,
}: {
  kit: FieldKit;
  mode: ThesisFormMode;
  state: ThesisFormState;
  onChange: (patch: Partial<ThesisFormState>) => void;
}) {
  const dateHint = `${kit.fid('pubDate')}-hint`;
  const schedHint = `${kit.fid('pubTime')}-hint`;
  return (
    <section aria-labelledby={kit.fid('s-publish')} className={SECTION}>
      <SectionHead id={kit.fid('s-publish')} eyebrow="Publishing" title="게시 설정" />
      <div className="grid gap-5 sm:grid-cols-2 sm:gap-x-6">
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={kit.fid('pubDate')} className={LABEL}>
            게시일
          </label>
          <input
            id={kit.fid('pubDate')}
            type="date"
            value={state.pubDate}
            onChange={(e) => onChange({ pubDate: e.target.value })}
            {...described(kit, 'pubDate', kit.errOf('pubDate') ? undefined : dateHint)}
            className={cn(FIELD, 'px-3', border(!!kit.errOf('pubDate')))}
          />
          {kit.errOf('pubDate') ? (
            <FieldError kit={kit} field="pubDate" />
          ) : (
            <p id={dateHint} className={HINT}>
              {mode === 'submission'
                ? '지난 날짜는 게시하는 날(오늘)로 올라갑니다.'
                : '목록과 글 머리에 보이는 날짜입니다.'}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <span className={LABEL}>게시 예약</span>
          <div className="flex min-h-[50px] items-center gap-3">
            <label className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-[15px] text-content">
              <input
                type="checkbox"
                checked={state.schedule}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? { schedule: true, pubTime: state.pubTime || '09:00' }
                      : { schedule: false, pubTime: '' },
                  )
                }
                aria-describedby={schedHint}
                className="h-[18px] w-[18px] accent-yonsei-blue dark:accent-brand"
              />
              예약 공개
            </label>
            {state.schedule && (
              <input
                id={kit.fid('pubTime')}
                type="time"
                step={300}
                aria-label="공개 시각"
                value={state.pubTime}
                onChange={(e) => onChange({ pubTime: e.target.value })}
                {...described(kit, 'pubTime')}
                className={cn(FIELD, 'flex-1 px-3', border(!!kit.errOf('pubTime')))}
              />
            )}
          </div>
          <FieldError kit={kit} field="pubTime" />
          <p id={schedHint} className="text-xs leading-[1.6] text-content-faint">
            체크하지 않으면 게시일 0시에 공개됩니다(오늘이면 바로). 공개 시각이 아직 오지 않았으면 버튼이 ‘예약 게시’로 바뀝니다.
          </p>
        </div>
      </div>
    </section>
  );
}
