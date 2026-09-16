'use client';

// 연구실 카드 편집 — 사이트의 연구실 목록 카드와 같은 16:9 구성으로 보면서 고친다.
//
// 이 리소스에서 자주 손대는 값은 "지도교수가 바뀌었다 / 방을 옮겼다 / 이번 학기
// 인턴을 뽑는다" 세 가지다. 그래서 그 셋을 카드 위에 올리고, 대표 이미지·영상 URL·
// 홈페이지처럼 가끔 바꾸는 값은 '자세히' 폼에 남긴다.
//
// "학부 인턴 모집 중"은 체크박스(불리언)다 — 문자열 필드와 저장 규칙이 달라
// (끄면 키 자체를 생략) 반드시 lib/admin/inline.ts 의 파이프라인을 타야 한다.

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { cellText, type FieldDef } from '@/lib/admin/resources';
import { formInlineValue } from '@/lib/admin/inline';
import { isVideoFileUrl } from '@/lib/video-url';
import {
  CardFootBar,
  DirtyBar,
  FieldBadge,
  FilterChip,
  InlineRow,
  InlineText,
  InlineToolbar,
  type InlineEditorProps,
} from './InlineFields';
import { CmsEmptyState } from './CmsEmptyState';

interface Props extends InlineEditorProps {
  inlineKeys: string[];
  filterKey?: string;
}

export function LabCardsEditor({
  resource,
  rows,
  total,
  busy,
  locked,
  dirtyIndices,
  invalidPaths,
  search,
  onSearch,
  onEditDetail,
  onDelete,
  onPatch,
  filterKey,
}: Props) {
  const [fieldFilter, setFieldFilter] = useState('');
  const [internOnly, setInternOnly] = useState(false);

  /** 0건 안내의 "초기화" — 검색어와 이 화면의 칩 둘(분야·인턴 모집)을 함께 비운다 */
  function resetQuery() {
    onSearch('');
    setFieldFilter('');
    setInternOnly(false);
  }

  const filterField = filterKey
    ? resource.fields.find((f) => f.key === filterKey)
    : undefined;
  const options =
    filterField && filterField.kind === 'select' ? filterField.options : [];

  const visible = rows.filter((r) => {
    if (fieldFilter && cellText(r.form, filterKey ?? '').trim() !== fieldFilter) return false;
    if (internOnly && r.form.internRecruiting !== true) return false;
    return true;
  });

  const disabled = busy || locked;

  return (
    <div>
      <InlineToolbar
        search={search}
        onSearch={onSearch}
        placeholder="연구실명 · 지도교수 검색"
        shown={visible.length}
        total={total}
        unit="개"
      >
        {options.length > 0 && (
          <>
            <FilterChip active={fieldFilter === ''} onClick={() => setFieldFilter('')}>
              전체
            </FilterChip>
            {options.map((o) => {
              const n = rows.filter((r) => cellText(r.form, filterKey ?? '') === o.value).length;
              if (n === 0) return null;
              return (
                <FilterChip
                  key={o.value}
                  active={fieldFilter === o.value}
                  count={n}
                  onClick={() => setFieldFilter((p) => (p === o.value ? '' : o.value))}
                >
                  {o.label}
                </FilterChip>
              );
            })}
          </>
        )}
        <FilterChip active={internOnly} onClick={() => setInternOnly((v) => !v)}>
          인턴 모집 중만
        </FilterChip>
      </InlineToolbar>

      {visible.length === 0 ? (
        <CmsEmptyState
          variant="search"
          compact
          title={
            search.trim() !== ''
              ? `‘${search.trim()}’ 에 해당하는 연구실이 없습니다`
              : '선택한 조건에 해당하는 연구실이 없습니다'
          }
          body="검색어를 지우거나 다른 조건을 골라 보세요."
          actionLabel="검색 초기화"
          onAction={resetQuery}
        />
      ) : (
        // auto-fill — 넓은 화면에서는 열이 더 늘어난다(33개를 훑는 화면이라 밀도가 중요)
        <ul className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(288px,1fr))]">
          {visible.map(({ index, form }) => {
            const dirty = dirtyIndices.has(index);
            const image = cellText(form, 'image');
            const video = cellText(form, 'video').trim();
            const fieldValue = cellText(form, 'field');
            const fieldLabel = options.find((o) => o.value === fieldValue)?.label ?? '';
            const recruiting = form.internRecruiting === true;
            const name = cellText(form, 'nameKo') || `#${index + 1}`;
            return (
              <li
                key={index}
                className={cn(
                  'relative flex flex-col border border-surface-border bg-surface transition-colors duration-200 ease-out-expo hover:border-yonsei-blue',
                  dirty && 'bg-yonsei-blue/[0.04]',
                )}
              >
                {dirty && <DirtyBar />}

                {/* 16:9 대표 이미지 — 사이트가 비면 기본 이미지를 순환 사용한다 */}
                <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-[#eef1f5]">
                  {image ? (
                    // 관리자 화면이라 최적화보다 즉시 반영이 중요 — next/image 대신 일반 img
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="px-3 text-center text-xs text-[#a8b0ba]">
                      대표 이미지 없음 · 기본 이미지 순환
                    </span>
                  )}
                  {video && (
                    <span className="absolute right-2 top-2 bg-yonsei-navy px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                      {/* 링크(YouTube·Drive)인지 직접 올린 파일인지 카드에서 구분된다 */}
                      {isVideoFileUrl(video) ? '소개 영상 · 파일' : '소개 영상 · 링크'}
                    </span>
                  )}
                </div>

                <div className="px-3.5 pb-2 pt-3.5">
                  <FieldBadge value={fieldValue} label={fieldLabel} />
                  <InlineText
                    value={String(formInlineValue(resource.fields, form, 'nameKo'))}
                    onChange={(v) => onPatch(index, 'nameKo', v)}
                    disabled={disabled}
                    ariaLabel="연구실명 (한국어)"
                    invalid={invalidPaths.has(`${index}:nameKo`)}
                    className="mt-2 py-1 text-[15px] font-bold tracking-tight"
                  />
                  <InlineText
                    value={String(formInlineValue(resource.fields, form, 'nameEn'))}
                    onChange={(v) => onPatch(index, 'nameEn', v)}
                    disabled={disabled}
                    placeholder="영문명 없음 — 영문 페이지에 한국어가 노출됩니다"
                    ariaLabel="연구실명 (English)"
                    invalid={invalidPaths.has(`${index}:nameEn`)}
                    className="py-1 text-xs text-content-faint"
                  />
                </div>

                <dl className="flex flex-col gap-0.5 px-2 pb-3">
                  {(['professorKo', 'location', 'phone'] as const).map((key) => {
                    const def = resource.fields.find((f) => f.key === key) as FieldDef | undefined;
                    // 카드에는 한국어 값만 두므로 라벨의 " (한국어)" 꼬리를 뗀다 —
                    // 그대로 두면 62px 라벨 칸에서 두 줄로 접힌다.
                    const label = (def?.label ?? key).replace(/\s*\(한국어\)$/, '');
                    return (
                      <InlineRow key={key} label={label} labelWidth="58px">
                        <InlineText
                          value={String(formInlineValue(resource.fields, form, key))}
                          onChange={(v) => onPatch(index, key, v)}
                          disabled={disabled}
                          placeholder="없음"
                          ariaLabel={`${name} ${def?.label ?? key}`.trim()}
                          numeric={key === 'phone'}
                          invalid={invalidPaths.has(`${index}:${key}`)}
                          className="py-1.5 text-xs"
                        />
                      </InlineRow>
                    );
                  })}
                </dl>

                <CardFootBar
                  dirty={dirty}
                  disabled={disabled}
                  onDetail={() => onEditDetail(index)}
                  onDelete={() => onDelete(index)}
                  left={
                    <label className="flex items-center gap-2 text-[11px] font-semibold text-content">
                      <input
                        type="checkbox"
                        checked={recruiting}
                        disabled={disabled}
                        onChange={(e) => onPatch(index, 'internRecruiting', e.target.checked)}
                        className="h-3.5 w-3.5 accent-[#0057A8]"
                      />
                      <span className={cn(recruiting ? 'text-[#166534]' : 'text-content-faint')}>
                        학부 인턴 모집 중
                      </span>
                      {dirty && (
                        <span className="ml-1 text-[11px] font-bold text-yonsei-blue">수정됨</span>
                      )}
                    </label>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
