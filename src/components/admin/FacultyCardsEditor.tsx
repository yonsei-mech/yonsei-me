'use client';

// 교수진 "카드 편집" — 실제 사이트의 교수 카드와 같은 모양으로 보면서 그 자리에서 고친다.
//
// 설계(사용자 지시):
//   · 카드 위에서 바로 고치는 것 : 이름 · 이메일 · 전화 · 호실 · 사진   (자주 고치는 값)
//   · 카드 위 필터                : 직급
//   · 그 외 11개 필드 전부        : 카드의 "자세히"로 폼을 열어 편집
// 표 + 화면 전환 왕복 대신, 목록을 보면서 즉시 수정하는 흐름을 만든다.
//
// 값 편집은 트레이에 모였다가 한 번에 저장된다. 사진 업로드만은 즉시 스토리지에
// 올라간다(이미지 바이너리는 JSON 저장과 별개 경로라 배칭할 수 없다) — 다만 그
// 결과 URL 은 photo 값 변경으로 트레이에 쌓여 다른 값들과 함께 저장된다.
// (한국어 UI 문자열은 내부 운영 도구라 컴포넌트에 직접 둔다.)

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { cellText, type FormRecord, type ResourceDef } from '@/lib/admin/resources';
import { formInlineValue } from '@/lib/admin/inline';
import {
  CardFootBar,
  DirtyBar,
  FilterChip,
  InlineRow,
  InlineText,
  InlineToolbar,
  MoveButtons,
  type InlineEditorProps,
} from './InlineFields';
import { CmsEmptyState } from './CmsEmptyState';
import { FacultyActivitiesDialog } from './FacultyActivitiesDialog';

/** 사진이 없을 때 쓰는 이름 첫 글자 아바타 색 — 이름 해시로 고정(사이트 카드와 같은 방식) */
function accentFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return ['#003377', '#0057A8', '#2E86D6', '#00285E'][hash % 4];
}

export interface FacultyCardsEditorProps extends InlineEditorProps {
  inlineKeys: string[];
  filterKey?: string;
  /** 사진 업로드 — 즉시 올리고 저장할 공개 URL 을 돌려준다 */
  onUploadPhoto: (file: File) => Promise<string>;
}

/** 카드에서 바로 고치는 연락 필드 (라벨은 resources.ts 정의를 따른다) */
const CONTACT_KEYS = ['email', 'phone', 'room'] as const;

export function FacultyCardsEditor({
  resource,
  rows,
  total,
  busy,
  locked,
  orderLocked,
  orderable,
  dirtyIndices,
  invalidPaths,
  search,
  onSearch,
  onEditDetail,
  onDelete,
  onMove,
  onPatch,
  filterKey,
  onUploadPhoto,
}: FacultyCardsEditorProps) {
  // 직급 필터 — 값은 데이터에서 뽑는다(직급 표기가 바뀌어도 따라간다)
  const key = filterKey ?? 'title';
  const titles = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const t = cellText(r.form, key).trim();
      if (t) set.add(t);
    }
    return [...set].sort();
  }, [rows, key]);
  const [titleFilter, setTitleFilter] = useState('');
  // BK21 참여교수만 보기 — 직급 칩과 **함께** 걸린다(직급은 한 값 고르기, 이쪽은 on/off).
  // 명단 확인이 "29명이 맞나"를 세는 일이라 칩 하나로 모아 보는 값이 크다.
  const [bk21Only, setBk21Only] = useState(false);
  const bk21Count = useMemo(() => rows.filter((r) => r.form.bk21 === true).length, [rows]);
  // 학술활동은 교수마다 별도 파일(content/faculty-profiles/<이름>.json)이라 카드 트레이가
  // 아니라 자기 파일을 직접 읽고 쓰는 다이얼로그가 맡는다
  const [activitiesFor, setActivitiesFor] = useState<string | null>(null);

  /** 0건 안내의 "초기화" — 검색어와 칩을 함께 비운다. 하나만 지우면 여전히 0건이다 */
  function resetQuery() {
    onSearch('');
    setTitleFilter('');
    setBk21Only(false);
  }

  const visible = rows.filter(
    (r) =>
      (!titleFilter || cellText(r.form, key).trim() === titleFilter) &&
      (!bk21Only || r.form.bk21 === true),
  );

  return (
    <div>
      <InlineToolbar
        search={search}
        onSearch={onSearch}
        placeholder="이름 · 이메일 · 전공 검색"
        shown={visible.length}
        total={total}
        unit="명"
      >
        {titles.length > 1 && (
          <>
            <FilterChip active={titleFilter === ''} onClick={() => setTitleFilter('')}>
              전체
            </FilterChip>
            {titles.map((t) => (
              <FilterChip
                key={t}
                active={titleFilter === t}
                count={rows.filter((r) => cellText(r.form, key).trim() === t).length}
                onClick={() => setTitleFilter((p) => (p === t ? '' : t))}
              >
                {t}
              </FilterChip>
            ))}
          </>
        )}
        {bk21Count > 0 && (
          <FilterChip
            active={bk21Only}
            count={bk21Count}
            onClick={() => setBk21Only((p) => !p)}
          >
            BK21
          </FilterChip>
        )}
      </InlineToolbar>

      {visible.length === 0 ? (
        <CmsEmptyState
          variant="search"
          compact
          title={
            search.trim() !== ''
              ? `‘${search.trim()}’ 에 해당하는 교수가 없습니다`
              : '선택한 조건에 해당하는 교수가 없습니다'
          }
          body="검색어를 지우거나 다른 직급을 골라 보세요."
          actionLabel="검색 초기화"
          onAction={resetQuery}
        />
      ) : (
        // 사이트 교수진 목록(FacultyDirectoryGrid)과 같은 2열 가로 카드.
        // 열을 더 늘리면 카드 폭이 좁아져 사진 왼쪽 / 설명 오른쪽 배치가 무너진다.
        <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map(({ index, form }) => (
            <FacultyCard
              key={index}
              resource={resource}
              index={index}
              form={form}
              total={total}
              busy={busy}
              locked={locked}
              orderLocked={orderLocked}
              orderable={orderable}
              dirty={dirtyIndices.has(index)}
              invalidPaths={invalidPaths}
              onEditDetail={onEditDetail}
              onDelete={onDelete}
              onMove={onMove}
              onPatch={onPatch}
              onUploadPhoto={onUploadPhoto}
              onOpenActivities={setActivitiesFor}
            />
          ))}
        </ul>
      )}

      {activitiesFor && (
        <FacultyActivitiesDialog name={activitiesFor} onClose={() => setActivitiesFor(null)} />
      )}
    </div>
  );
}

function FacultyCard({
  resource,
  index,
  form,
  total,
  busy,
  locked,
  orderLocked,
  orderable,
  dirty,
  invalidPaths,
  onEditDetail,
  onDelete,
  onMove,
  onPatch,
  onUploadPhoto,
  onOpenActivities,
}: {
  resource: ResourceDef;
  index: number;
  form: FormRecord;
  total: number;
  busy: boolean;
  locked: boolean;
  orderLocked: boolean;
  orderable: boolean;
  dirty: boolean;
  /** 'index:path' — 이 카드에서 비운 필수 칸 */
  invalidPaths: Set<string>;
  onEditDetail: (i: number) => void;
  onDelete: (i: number) => void;
  onMove: (i: number, d: -1 | 1) => void;
  onPatch: (i: number, path: string, value: string) => void;
  onUploadPhoto: (file: File) => Promise<string>;
  onOpenActivities: (name: string) => void;
}) {
  const name = cellText(form, 'name');
  const title = cellText(form, 'title');
  const role = cellText(form, 'role');
  const photo = cellText(form, 'photo');
  const labLine = [cellText(form, 'labNameKo'), cellText(form, 'labNameEn')]
    .filter(Boolean)
    .join(' · ');

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPath, setUploadPath] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  // 업로드 직후 같은 경로 이미지를 새로 받기 위한 캐시버스터
  const [bust, setBust] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  // 이름 기반 추정 경로가 404 면 아바타로 되돌린다
  const [photoBroken, setPhotoBroken] = useState(false);

  /**
   * 표시할 사진 경로.
   * 사이트(lib/faculty.ts)는 JSON 의 photo 를 우선하고, 없으면 public/img/faculty 의
   * "<이름>.<확장자>" 파일을 이름으로 자동 연결한다. 관리자 카드도 같은 규칙을 따라야
   * 실제 화면과 어긋나지 않는다 — 현재 데이터 50명 전원이 photo 필드가 비어 있고
   * 파일명 규칙으로만 사진이 붙는다.
   */
  const guessed = name.trim() ? `/img/faculty/${name.trim()}.jpg` : '';
  const photoSrc = photo || (photoBroken ? '' : guessed);

  // 이름이 바뀌면 추정 경로도 달라지므로 실패 상태를 초기화한다
  useEffect(() => {
    setPhotoBroken(false);
  }, [name]);

  // 업로드가 돌려준 공개 URL 을 photo 값으로 그대로 쓴다.
  // ⚠️ 예전에는 `public/img/faculty/<이름>.<확장자>` 를 조립해 저장소에 커밋하고 그
  // 경로를 값으로 넣었다(그래서 이름을 먼저 입력해야 했다). 저장이 Git 커밋을 떠난
  // 뒤로는 저장 위치를 스토리지가 정하므로 여기서 경로를 만들지 않는다.
  async function upload(file: File) {
    setUploading(true);
    setUploadPath(file.name);
    setUploadError(null);
    try {
      const url = await onUploadPhoto(file);
      onPatch(index, 'photo', url);
      setBust((b) => b + 1);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  }

  const disabled = busy || locked;
  const labelOf = (k: string) => resource.fields.find((f) => f.key === k)?.label ?? k;

  return (
    <li
      className={cn(
        // 사이트 교수 카드와 같은 골격: 가로 배치, 사진 왼쪽 / 설명 오른쪽.
        // 관리 화면이 실제 카드와 다른 모양이면 "보이는 그대로 고친다"가 깨진다.
        'relative flex gap-4 border bg-surface p-4 transition-colors duration-200 ease-out-expo sm:gap-5',
        dragOver ? 'border-yonsei-blue' : 'border-surface-border hover:border-yonsei-blue',
        dirty && 'bg-yonsei-blue/[0.04]',
      )}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        const f = e.dataTransfer.files?.[0];
        if (f && f.type.startsWith('image/')) void upload(f);
      }}
    >
      {dirty && <DirtyBar />}

      {/* 사진 — 사이트 카드와 같은 3:4 세로 비율로 왼쪽에 세운다.
          클릭하거나 카드에 이미지를 끌어다 놓으면 교체된다. */}
      <div className="relative aspect-[3/4] w-28 flex-none self-start bg-[#eef1f5] sm:w-32">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading}
          title="클릭하거나 이미지를 카드에 끌어다 놓아 사진을 교체합니다"
          className="group block h-full w-full overflow-hidden disabled:cursor-not-allowed"
        >
          {photoSrc ? (
            // 관리자 화면이라 최적화보다 즉시 반영이 중요 — next/image 대신 일반 img
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${photoSrc}${bust ? `?v=${bust}` : ''}`}
              onError={() => setPhotoBroken(true)}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span
              className="flex h-full w-full items-center justify-center text-4xl font-bold text-white/30"
              style={{ background: accentFor(name || '?') }}
            >
              {(name || '?').charAt(0)}
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-center text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
            사진 교체
          </span>
        </button>

        {/* 업로드 중 오버레이 — 진행률을 알 수 없는 API 라 불확정 막대를 쓴다 */}
        {uploading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-white/90 px-5">
            <span className="text-xs font-bold text-yonsei-navy">사진 업로드 중…</span>
            <span className="block h-1 w-full bg-surface-border">
              <span className="block h-full w-1/3 animate-pulse bg-yonsei-blue" />
            </span>
            <span className="truncate text-[10px] text-content-faint">{uploadPath}</span>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
      </div>

      {/* 오른쪽 — 이름·직급부터 액션까지. 사이트 카드의 세로 리듬을 그대로 따른다 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-1.5">
          <InlineText
            value={String(formInlineValue(resource.fields, form, 'name'))}
            onChange={(v) => onPatch(index, 'name', v)}
            disabled={disabled}
            placeholder="이름"
            ariaLabel="이름"
            invalid={invalidPaths.has(`${index}:name`)}
            className="-ml-2 w-auto min-w-[88px] max-w-[132px] py-0.5 text-lg font-bold tracking-tight"
          />
          {/* 보직 배지 — 사이트 카드와 같은 블루 톤(시안의 금색은 이 프로젝트에서 금지) */}
          {role && (
            <span className="bg-yonsei-blue/10 px-2 py-0.5 text-xs font-semibold text-yonsei-blue">
              {role}
            </span>
          )}
          {orderable && (
            <span className="ml-auto flex items-center">
              <MoveButtons
                index={index}
                total={total}
                disabled={busy || orderLocked}
                onMove={onMove}
              />
            </span>
          )}
        </div>
        {/* 직급·연구실은 읽기 전용 — 카드에서 고치는 값이 아니라 '자세히' 폼 소관이다 */}
        <p className="mt-0.5 text-sm text-content-soft">{title || '직급 없음'}</p>
        <p className="mt-0.5 truncate text-xs text-content-faint" title={labLine}>
          {labLine || '연구실 정보 없음'}
        </p>

        <dl className="mt-3 flex flex-col gap-0.5 border-t border-surface-border pt-2.5">
          {CONTACT_KEYS.map((k) => (
            <InlineRow key={k} label={k === 'room' ? '연구실' : labelOf(k)} labelWidth="52px">
              <InlineText
                value={String(formInlineValue(resource.fields, form, k))}
                onChange={(v) => onPatch(index, k, v)}
                disabled={disabled}
                placeholder="없음"
                ariaLabel={`${name} ${labelOf(k)}`}
                numeric={k === 'phone'}
                invalid={invalidPaths.has(`${index}:${k}`)}
                className="py-1 text-[13px]"
              />
            </InlineRow>
          ))}
        </dl>

        {uploadError && (
          <p role="alert" className="mt-1.5 text-[11px] text-[#b42318]">
            {uploadError}
          </p>
        )}

        <CardFootBar
          dirty={dirty}
          disabled={disabled}
          left={
            // left 를 넘기면 CardFootBar 기본 "수정됨" 배지가 사라지므로 같은 마크업을
            // 여기서 재현하고 그 옆에 학술활동 버튼을 나란히 둔다.
            <span className="flex items-center gap-2">
              <span
                className={cn('text-[11px] font-bold', dirty ? 'text-yonsei-blue' : 'text-transparent')}
              >
                {dirty ? '수정됨' : '·'}
              </span>
              {/* 조회는 잠금과 무관하게 열린다 — 실적 파일은 카드 트레이와 별개로 저장된다 */}
              <button
                type="button"
                onClick={() => {
                  const n = name.trim();
                  if (n) onOpenActivities(n);
                }}
                disabled={busy}
                className="text-[11px] font-bold text-yonsei-blue hover:underline disabled:opacity-40"
              >
                학술활동
              </button>
            </span>
          }
          onDetail={() => onEditDetail(index)}
          onDelete={() => onDelete(index)}
          className="mt-3 border-surface-border bg-transparent px-0 pb-0 pt-2.5"
        />
      </div>
    </li>
  );
}
