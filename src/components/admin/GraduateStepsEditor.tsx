'use client';

// 대학원 졸업요건 편집 화면 — "학생이 보는 STEP 칸 그대로 보면서 고친다".
//
// content/graduate-requirements.json 은 형식만 보면 배열이라 CollectionEditor 로도
// 뜬다. 그런데 값의 8할이 본문 HTML 이라 표 한 칸에 담기지 않고, 목록↔폼을 왕복하는
// 동안 "STEP 아홉 칸이 이어진 한 페이지"라는 실제 모양이 화면에서 사라진다. 그래서
// 사이트와 같은 세로 카드 목록을 그려 놓고 제목·리드·본문을 그 자리에서 고친다.
//
// 저장은 파일 하나라 카드별 저장 없이 상단 바에서 한 번에 커밋한다. 하단 변경
// 트레이를 쓰지 않는 이유: 트레이는 "필드 하나의 이전 → 이후"를 줄줄이 늘어놓는
// 문법이라 본문 HTML 한 덩이에는 맞지 않는다(무엇이 바뀌었는지 되레 가려진다).
//
// ⚠️ 번호(STEP 01…)와 앵커 id 는 저장하지 않는다 — 사이트와 똑같이 **배열 순서에서**
//    계산한다(GraduateRequirementSteps 참고). 그래서 순서를 바꾸면 번호도 따라 바뀐다.
// ⚠️ 본문 HTML 의 정화는 저장 시점에 서버가 한다(api/admin/content 의 PUT). 그래서
//    저장 뒤에는 화면 상태를 믿지 않고 **서버에서 다시 읽는다** — 정화 결과와 화면이
//    어긋난 채로 다음 편집을 시작하면 그 차이가 조용히 되돌려진다.
// (내부 운영 도구라 한국어 UI 문자열을 컴포넌트에 직접 둔다.)

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { commitJson, loadJson, type RepoConfig } from '@/lib/admin/content-api';
import type { ScreenDef } from '@/lib/admin/resources';
import type { GraduateRequirementStep } from '@/lib/graduate-requirements';
import { useAdminShell } from './AdminShellContext';
import { PostBodyEditor } from './board-editor/PostBodyEditor';
import { CmsModal } from './CmsModal';
import { CmsPanelHead } from './CmsPanelHead';
// ▲▼ 는 InlineFields 의 MoveButtons 를 쓰지 않는다 — 그쪽은 읽어 주는 이름이
// '위로'/'아래로' 로 고정이라 카드가 여럿이면 스크린리더에서 구별되지 않는다.
import { DirtyBar } from './InlineFields';

/**
 * 이 화면의 말과 자리.
 *
 * 학부 졸업요건(학번 섹션 = {label, body} 두 필드)도 거의 같은 화면을 쓰게 되므로,
 * 단위 명사·필드 라벨·안내 문구를 컴포넌트 곳곳에 흩뿌리지 않고 여기 한 곳에 모은다.
 * 재사용할 때 갈아 끼울 것은 이 객체와 레코드 타입뿐이다.
 */
const SCREEN = {
  /** 단위 명사 — 배지·저장 바·삭제 확인이 모두 이 말을 쓴다 */
  unit: 'STEP',
  /** 번호 배지 — 사이트(GraduateRequirementSteps)와 **같은 계산식**이어야 한다 */
  numberOf: (index: number) => String(index + 1).padStart(2, '0'),
  titleLabel: '제목',
  titlePlaceholder: '제목을 입력하세요',
  leadLabel: '리드 문단',
  leadPlaceholder: '헤더 아래 안내 한 문단 (비워 두면 표시되지 않습니다)',
  bodyLabel: '본문',
  bodyPlaceholder: '불릿·표·유의사항 콜아웃으로 본문을 씁니다',
  addLabel: 'STEP 추가',
  siteUrl: '/ko/graduate/requirements',
  commitMessage: '대학원 졸업요건 수정',
  /** 새 항목의 빈 레코드 — 저장 형식(빈 문자열, null·키 누락 없음)을 그대로 따른다 */
  blank: (): GraduateRequirementStep => ({ title: '', lead: '', body: '' }),
} as const;

function badgeOf(index: number): string {
  return `${SCREEN.unit} ${SCREEN.numberOf(index)}`;
}

/**
 * 외부 값 → 편집 레코드.
 * ⚠️ lib 의 adaptGraduateRequirements 를 쓰지 않는다 — 그쪽은 제목이 빈 항목을 **버리는**
 * 사이트용 가드라, CMS 가 그걸 쓰면 고쳐야 할 깨진 한 줄이 편집 화면에서도 사라진다.
 * 여기서는 형만 맞추고 내용은 있는 그대로 싣는다.
 */
function normalizeStep(raw: unknown): GraduateRequirementStep {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    title: typeof r.title === 'string' ? r.title : '',
    lead: typeof r.lead === 'string' ? r.lead : '',
    body: typeof r.body === 'string' ? r.body : '',
  };
}

function sameStep(a: GraduateRequirementStep, b: GraduateRequirementStep): boolean {
  return a.title === b.title && a.lead === b.lead && a.body === b.body;
}

interface Props {
  config: RepoConfig;
  screen: ScreenDef;
  onDirtyChange?: (dirty: boolean) => void;
}

export function GraduateStepsEditor({ config, screen, onDirtyChange }: Props) {
  const { showToast } = useAdminShell();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 현재 값 */
  const [steps, setSteps] = useState<GraduateRequirementStep[]>([]);
  /** 로드 시점 원본 — 되돌리기·차이 계산의 기준 */
  const [base, setBase] = useState<GraduateRequirementStep[]>([]);
  const [sha, setSha] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  /** 저장 충돌(409) 안내 — pending 은 이 선택으로 잃게 될 대기 변경 건수다 */
  const [conflict, setConflict] = useState<{ pending: number } | null>(null);

  // ── 로드 ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const file = await loadJson<GraduateRequirementStep[]>(config, screen.file);
      const arr = Array.isArray(file.data) ? file.data.map(normalizeStep) : [];
      setSteps(arr);
      setBase(arr);
      setSha(file.sha);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [config, screen.file]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── 차이 ────────────────────────────────────────────────────────────
  // 값이 달라진 자리는 원본과 **같은 인덱스끼리** 비교해 센다. 순서를 바꾸면 두 자리
  // 모두 "달라진 자리"가 되는데, 그게 사실이다(그 칸에 놓인 내용이 실제로 바뀌었다).
  const changedIndices = useMemo(() => {
    const set = new Set<number>();
    steps.forEach((s, i) => {
      const b = base[i];
      if (b && !sameStep(b, s)) set.add(i);
    });
    return set;
  }, [steps, base]);

  const added = Math.max(0, steps.length - base.length);
  const removed = Math.max(0, base.length - steps.length);
  const dirty = changedIndices.size > 0 || added > 0 || removed > 0;
  /** 충돌 안내가 "무엇을 잃는지" 셀 때 쓰는 수 */
  const pendingCount = changedIndices.size + added + removed;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const dirtySummary = useMemo(() => {
    const parts: string[] = [];
    if (changedIndices.size > 0) parts.push(`${changedIndices.size}개 ${SCREEN.unit} 수정됨`);
    if (added > 0) parts.push(`${added}개 추가됨`);
    if (removed > 0) parts.push(`${removed}개 삭제됨`);
    return parts.join(' · ');
  }, [changedIndices.size, added, removed]);

  /** 제목이 빈 자리 — 저장을 막는 유일한 조건(어댑터가 버리므로 조용히 사라진다) */
  const emptyTitleIndices = useMemo(
    () => steps.map((s, i) => (s.title.trim() === '' ? i : -1)).filter((i) => i >= 0),
    [steps],
  );

  // ── 조작 ────────────────────────────────────────────────────────────
  // 콜백은 전부 안정적이어야 한다 — 카드가 memo 라 하나를 타이핑할 때 나머지 여덟
  // 카드(각각 Tiptap 인스턴스 하나)가 함께 다시 그려지지 않게 하는 조건이다.
  const patch = useCallback(
    (index: number, field: keyof GraduateRequirementStep, value: string) => {
      setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
    },
    [],
  );

  const move = useCallback((index: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const to = index + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }, []);

  const requestDelete = useCallback((index: number) => setDeleting(index), []);

  function addStep() {
    setSteps((prev) => [...prev, SCREEN.blank()]);
    setSaveError(null);
  }

  function revertAll() {
    setSteps(base);
    setSaveError(null);
  }

  // ── 저장 ────────────────────────────────────────────────────────────
  async function save() {
    if (emptyTitleIndices.length > 0) {
      const which = emptyTitleIndices.map(badgeOf).join(' · ');
      // 라벨 뒤에 '칸' 을 붙여 문장을 만든다 — 조사(이/가)가 라벨 끝 글자를 타므로
      // 재사용할 화면에서 라벨만 갈아 끼워도 문장이 어그러지지 않게 하는 장치다.
      setSaveError(
        `${which} 의 ${SCREEN.titleLabel} 칸이 비어 있습니다. ${SCREEN.titleLabel} 칸이 빈 ` +
          `${SCREEN.unit} 은 사이트에서 통째로 사라지므로 저장할 수 없습니다 — ` +
          `채우거나 그 ${SCREEN.unit} 을 삭제하세요.`,
      );
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // 제목·리드만 다듬는다(본문은 에디터 산출물 그대로 — 정화는 서버가 한다).
      const next = steps.map((s) => ({
        title: s.title.trim(),
        lead: s.lead.trim(),
        body: s.body,
      }));
      await commitJson(config, screen.file, next, sha, SCREEN.commitMessage);
      // 저장본이 곧 화면이 되게 다시 읽는다(위 파일 머리말의 정화 주석 참고).
      await load();
      showToast('저장했습니다 — 사이트에 곧(수 초 내) 반영됩니다.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '저장에 실패했습니다.';
      setSaveError(msg);
      // 충돌 문구는 서버 것을 그대로 쓴다 — 감지는 문구 안의 '409' 로 한다(계약).
      if (msg.includes('409') || msg.includes('422')) setConflict({ pending: pendingCount });
    } finally {
      setSaving(false);
    }
  }

  // ── 렌더 ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div>
        <CmsPanelHead kind="collection" title={screen.label} description={screen.description} />
        <p className="text-sm text-content-faint">불러오는 중…</p>
      </div>
    );
  }
  if (loadError) {
    return (
      <div>
        <CmsPanelHead kind="collection" title={screen.label} description={screen.description} />
        <p role="alert" className="border border-[#b42318] bg-[#fdf3f2] p-4 text-sm text-[#b42318]">
          {loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="anim-panel">
      <CmsPanelHead
        kind="collection"
        title={screen.label}
        description={screen.description}
        siteUrl={SCREEN.siteUrl}
      />

      {/* 저장 바 — 대기 변경이 있을 때만 화면 맨 위에 붙어 따라온다.
          기준선은 콘솔의 sticky 관례를 따른다(모바일은 슬림 바 아래, 데스크톱은 맨 위).
          z-20 은 운영 배너(z-31)·사이드바(z-30/40) 아래, 카드 위. */}
      {dirty && (
        <div className="sticky top-[var(--cms-bar)] z-20 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border border-yonsei-blue/40 bg-[#eef4fb] px-4 py-2.5 lg:top-0">
          <strong className="text-[13px] font-bold text-yonsei-blue">{dirtySummary}</strong>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={revertAll}
              disabled={saving}
              className="cms-btn cms-btn-sm"
            >
              되돌리기
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="cms-btn-primary cms-btn-sm"
            >
              {saving ? '저장 중…' : '변경 저장'}
            </button>
          </span>
        </div>
      )}

      {saveError && (
        <p
          role="alert"
          className="mb-4 border border-[#b42318]/30 bg-[#b42318]/[0.06] px-3.5 py-2.5 text-sm text-[#b42318]"
        >
          {saveError}
        </p>
      )}

      <ul className="flex flex-col gap-5">
        {steps.map((step, index) => (
          <StepCard
            // 인덱스를 key 로 쓴다 — 레코드에 식별자가 없고, 순서 이동은 내용을
            // 맞바꾸는 방식이라 같은 자리의 카드는 계속 같은 카드다(에디터 인스턴스
            // 재생성을 피한다).
            key={index}
            index={index}
            total={steps.length}
            step={step}
            dirty={changedIndices.has(index) || index >= base.length}
            invalid={step.title.trim() === ''}
            busy={saving}
            onPatch={patch}
            onMove={move}
            onDelete={requestDelete}
          />
        ))}
      </ul>

      <div className="mt-5">
        <button type="button" onClick={addStep} disabled={saving} className="cms-btn cms-btn-sm">
          + {SCREEN.addLabel}
        </button>
      </div>

      {deleting !== null && (
        <CmsModal
          title={`${badgeOf(deleting)} 을 삭제할까요?`}
          tone="danger"
          confirmLabel="삭제"
          body={
            <>
              <p className="font-semibold text-content">
                {steps[deleting]?.title.trim() || `(${SCREEN.titleLabel} 없음)`}
              </p>
              <p className="mt-2">
                {/* 라벨을 괄호 안에 묶어 조사(이/가)가 라벨 끝 글자를 타지 않게 한다 */}이{' '}
                {SCREEN.unit} 의 내용({SCREEN.titleLabel} · {SCREEN.leadLabel} ·{' '}
                {SCREEN.bodyLabel})이 모두 사라지고, 뒤 {SCREEN.unit} 의 번호가 하나씩 당겨집니다.
              </p>
              <p className="mt-2">
                사이트에는 위의 <strong className="text-content">변경 저장</strong>을 눌러야
                반영됩니다 — 그 전에는 <strong className="text-content">되돌리기</strong>로
                되살릴 수 있습니다.
              </p>
            </>
          }
          onConfirm={() => {
            const index = deleting;
            setDeleting(null);
            setSteps((prev) => prev.filter((_, i) => i !== index));
            setSaveError(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}

      {conflict !== null && (
        <CmsModal
          title="다른 사람이 먼저 저장했습니다"
          tone="danger"
          confirmLabel="최신본 불러오기"
          cancelLabel="그대로 두기"
          body={
            <>
              <p>
                지금 화면의 내용은 최신본이 아닙니다. 최신본을 다시 불러오면 저장 대기 중이던
                변경 {conflict.pending}건은 사라집니다.
              </p>
              <p className="mt-2">
                값을 잃고 싶지 않다면 <strong className="text-content">그대로 두기</strong>를 고르고,
                고친 내용을 어딘가에 옮겨 적은 뒤 최신본을 불러와 다시 입력하세요.
              </p>
            </>
          }
          onConfirm={() => {
            setConflict(null);
            setSaveError(null);
            void load();
          }}
          onCancel={() => setConflict(null)}
        />
      )}
    </div>
  );
}

// ── STEP 카드 한 장 ──────────────────────────────────────────────────────
//
// memo 인 이유: 카드마다 Tiptap 인스턴스가 하나씩 산다. 한 카드에 글자를 칠 때마다
// 나머지 여덟 장이 함께 다시 그려지면 타이핑이 눈에 띄게 늦는다. 그래서 위쪽 콜백은
// 전부 useCallback 으로 고정했고, 여기 props 는 전부 원시값·고정 함수다.

interface StepCardProps {
  index: number;
  total: number;
  step: GraduateRequirementStep;
  /** 저장 대기 중인 변경이 있는 자리 — 좌측 파란 막대 */
  dirty: boolean;
  /** 제목이 비었다 — 저장을 막는 유일한 조건 */
  invalid: boolean;
  busy: boolean;
  onPatch: (index: number, field: keyof GraduateRequirementStep, value: string) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onDelete: (index: number) => void;
}

const StepCard = memo(function StepCard({
  index,
  total,
  step,
  dirty,
  invalid,
  busy,
  onPatch,
  onMove,
  onDelete,
}: StepCardProps) {
  const num = SCREEN.numberOf(index);
  /** 스크린리더가 카드를 구별할 이름 — 제목이 비었으면 번호로 말한다 */
  const label = step.title.trim() || badgeOf(index);

  return (
    <li
      className={cn(
        'relative border border-surface-border bg-surface p-5 transition-colors duration-200 ease-out-expo sm:p-6',
        dirty && 'bg-yonsei-blue/[0.04]',
      )}
    >
      {dirty && <DirtyBar />}

      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {/* 네이비 박스 — 사이트 STEP 헤더 그대로(bg-yonsei-navy · text-sm · font-bold).
            번호는 배열 순서에서 계산한 값이라 고칠 수 없고, 그 옆 제목만 그 자리에서
            고친다. 오른쪽 패딩만 조금 줄인 것은 입력 칸의 좌우 여백이 더해지기 때문이다. */}
        <h3 className="inline-flex max-w-full items-center bg-yonsei-navy py-1.5 pl-3.5 pr-2 text-sm font-bold text-white">
          <span className="shrink-0 tabular-nums">
            {SCREEN.unit} {num}
          </span>
          <span aria-hidden="true" className="mx-1 shrink-0 opacity-60">
            ·
          </span>
          {/* 폭은 글자 수에 맞춰 늘어난다. 단위가 ch(숫자 0 의 폭)가 아니라 em 인 것은
              한글 한 글자가 대략 1em 이기 때문이다 — ch 로 재면 절반쯤으로 좁아진다. */}
          <input
            type="text"
            value={step.title}
            onChange={(e) => onPatch(index, 'title', e.target.value)}
            disabled={busy}
            placeholder={SCREEN.titlePlaceholder}
            aria-label={`${badgeOf(index)} ${SCREEN.titleLabel}`}
            aria-invalid={invalid ? 'true' : undefined}
            style={{ width: `${Math.min(28, Math.max(9, step.title.length + 2))}em` }}
            className={cn(
              // 네이비 면 위라 .cms-mirror(흰 배경 포커스)를 그대로 쓸 수 없다 —
              // 같은 문법(평소 투명 → 호버 점선 → 포커스 실선)을 흰색으로 옮겼다.
              'min-w-0 border border-transparent bg-transparent px-1.5 py-0 text-sm font-bold text-white outline-none transition-colors placeholder:font-normal placeholder:text-white/60 hover:border-dashed hover:border-white/70 focus:border-solid focus:border-white focus:bg-white/15 disabled:cursor-not-allowed',
            )}
          />
        </h3>

        <span className="ml-auto flex shrink-0 items-center gap-3">
          {/* 순서 이동 — 9칸 규모라 끌기 대신 ▲▼ 다(키보드·스크린리더에도 그대로 열린다).
              읽어 주는 이름에 제목을 넣어야 카드가 아홉 장이어도 어느 것인지 구별된다. */}
          <span className="flex items-center">
            <button
              type="button"
              aria-label={`${label} 위로 이동`}
              title="위로 이동"
              onClick={() => onMove(index, -1)}
              disabled={busy || index === 0}
              className="px-1 py-0.5 text-[11px] text-content-faint transition-colors hover:text-yonsei-blue disabled:opacity-30"
            >
              ▲
            </button>
            <button
              type="button"
              aria-label={`${label} 아래로 이동`}
              title="아래로 이동"
              onClick={() => onMove(index, 1)}
              disabled={busy || index === total - 1}
              className="px-1 py-0.5 text-[11px] text-content-faint transition-colors hover:text-yonsei-blue disabled:opacity-30"
            >
              ▼
            </button>
          </span>
          <button
            type="button"
            onClick={() => onDelete(index)}
            disabled={busy}
            className="text-xs font-semibold text-[#b42318] transition-colors hover:underline disabled:opacity-40"
          >
            삭제
          </button>
        </span>
      </div>

      {invalid && (
        <p className="mt-2 text-[11px] font-semibold text-[#b42318]">
          {SCREEN.titleLabel} 칸이 비어 있어 저장할 수 없습니다.
        </p>
      )}

      {/* 리드 문단 — 사이트와 같은 타이포·같은 폭(max-w-2xl)으로 접힌다.
          Enter 를 막는 이유: 이 값은 문단 하나(<p>)로 렌더되므로 줄바꿈을 넣어도
          사이트에서는 한 줄로 이어 붙는다 — 화면과 다른 것을 쓰게 두지 않는다. */}
      <LeadField
        value={step.lead}
        onChange={(v) => onPatch(index, 'lead', v)}
        disabled={busy}
        ariaLabel={`${badgeOf(index)} ${SCREEN.leadLabel}`}
      />

      {/* 본문 — 사이트와 같은 prose(step-prose)로 보이는 리치 에디터.
          이미지 업로드는 넘기지 않는다: 지금 아홉 칸 어디에도 이미지가 없고,
          onUploadImage 가 없으면 에디터가 이미지 도구를 알아서 접는다. */}
      <div className="mt-6">
        <PostBodyEditor
          value={step.body}
          onChange={(html) => onPatch(index, 'body', html)}
          preset="requirements"
          placeholder={SCREEN.bodyPlaceholder}
          ariaLabel={`${badgeOf(index)} ${SCREEN.bodyLabel}`}
        />
      </div>
    </li>
  );
});

/** 리드 입력 — 사이트 문단처럼 접히게 하려고 textarea 를 쓰되, 높이는 내용에 맞춰
 *  실측으로 늘린다(스크롤바가 생기면 "보이는 그대로"가 깨진다). */
function LeadField({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // auto 로 줄였다가 실측 — 줄이지 않으면 내용을 지워도 높이가 남는다
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.preventDefault();
      }}
      disabled={disabled}
      placeholder={SCREEN.leadPlaceholder}
      aria-label={ariaLabel}
      className="cms-mirror mt-4 -ml-[7px] block w-full max-w-2xl resize-none overflow-hidden text-base leading-relaxed text-content-soft sm:text-lg"
    />
  );
}
