'use client';

// 팝업 공지 '자세히' — 아임웹 "팝업·배너 > 편집 및 추가" 처럼 **왼쪽 라벨 · 오른쪽 입력**의
// 세로 행 폼이다. 범용 RecordForm 의 6칸 그리드는 팝업처럼 "설정을 위에서 아래로 읽으며
// 정하는" 화면과 맞지 않아(기간·기기·페이지·닫기 규칙이 서로 떨어져 놓인다) 리소스 전용
// 편집기로 갈아 끼웠다.
//
// 행 순서는 "사진 → 위치·크기 → 버튼·닫기 → 링크" 처럼 **미리보기에 보이는 것**을 먼저 두고,
// 노출 조건(기간·기기·페이지·노출)은 뒤로 보낸다 — 크기는 사진 비율에서 나오므로 사진이
// 먼저 있어야 위치·크기 미리보기가 열린다(PopupSizeFrame 의 게이트).
//
// 입력 외형은 프로젝트의 기존 폼(PostForm·RecordForm 의 fieldClass)을 그대로 쓴다 —
// 아임웹의 밑줄 입력은 흉내 내지 않는다(각진 엣지·그림자 없음·금색 금지).
//
// 머리말(뒤로 · 배지 · 제목 · 취소/저장)도 여기서 그린다. 헤더의 '저장'이 이 컴포넌트의
// 폼 상태와 검증을 눌러야 하므로, CollectionEditor 가 대신 그리면 같은 핸들러를 두
// 컴포넌트가 나눠 갖게 된다(CollectionEditor 는 popupForm 일 때 제 헤더를 접는다).
//
// 값 직렬화는 여기서 하지 않는다. 폼 값을 모아 onSubmit 으로 올리면 resources.ts 의
// fromForm 한 곳이 책임진다(DetailEditorProps 계약).
//
// (한국어 UI 문자열은 내부 운영 도구라 컴포넌트에 직접 둔다.)

import { useEffect, useRef, useState } from 'react';
import type { FieldDef, FormRecord, LocalizedPair } from '@/lib/admin/resources';
import { validateForm } from '@/lib/admin/resources';
import { popupImageAspect } from '@/lib/popup-positions';
import type { DetailEditorProps } from './DetailEditorTypes';
import { CmsPanelHead } from './CmsPanelHead';
import { PopupPositionPicker } from './PopupPositionPicker';
import { TranslateButton } from './TranslateButton';

// 40px 한 줄 입력 — 라벨 열(140px)과 같은 리듬으로 읽히게 높이를 고정한다.
const fieldClass =
  'h-10 w-full rounded-[2px] border border-surface-border bg-surface px-3 text-sm text-content outline-none transition-colors focus:border-yonsei-blue disabled:opacity-60';

/** 필수인데 비어 있는 칸의 테두리 — 배너만으로는 "어디가" 를 못 말한다 */
const ERROR_BORDER = 'border-[#b42318] focus:border-[#b42318]';

const REQUIRED_MSG = '필수 항목입니다';

function str(form: FormRecord, key: string): string {
  const v = form[key];
  return v == null ? '' : String(v);
}

function pair(form: FormRecord, key: string): LocalizedPair {
  return (form[key] ?? { ko: '', en: '' }) as LocalizedPair;
}

/** 비어 있는 필수 필드 키 — validateForm 과 **같은 규칙**을 필드 단위로 편 것이다
 *  (validateForm 은 첫 하나의 문장만 돌려주므로 칸마다 표시할 수 없다). */
function missingRequired(fields: FieldDef[], form: FormRecord): Set<string> {
  const out = new Set<string>();
  for (const f of fields) {
    if (!f.required) continue;
    const v = form[f.key];
    if (f.kind === 'localized') {
      if (!((v as LocalizedPair | undefined)?.ko ?? '').trim()) out.add(f.key);
    } else if (typeof v !== 'string' || v.trim() === '') {
      out.add(f.key);
    }
  }
  return out;
}

/** 입력 아래 빨간 한 줄 */
function FieldError({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="mt-1.5 text-xs text-[#b42318]">{REQUIRED_MSG}</p>;
}

/** 한 줄 = 왼쪽 라벨(고정 폭) + 오른쪽 입력. 좁은 화면에서는 위아래로 접힌다.
 *  라벨의 윗 여백은 오른쪽에 오는 컨트롤 종류에 따라 다르다 — 40px 입력의 글줄,
 *  16px 체크박스, 스타일 위젯의 토글이 각각 다른 높이에서 시작하기 때문이다. */
function Row({
  label,
  hint,
  htmlFor,
  align = 'input',
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  align?: 'input' | 'control' | 'style';
  children: React.ReactNode;
}) {
  const labelPad =
    align === 'input' ? 'sm:pt-[11px]' : align === 'style' ? 'sm:pt-1.5' : 'sm:pt-0.5';
  return (
    <div className="grid grid-cols-1 items-start gap-x-6 gap-y-2 py-3 sm:grid-cols-[140px_minmax(0,1fr)]">
      <div className={`${labelPad} sm:text-right`}>
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[13px] text-content-faint">
            {label}
          </label>
        ) : (
          // 라디오·체크박스 묶음은 개별 라벨이 따로 있으므로 그룹 이름만 둔다
          <span className="text-[13px] text-content-faint">{label}</span>
        )}
      </div>
      <div className="min-w-0 sm:max-w-[760px]">
        {children}
        {hint && <p className="mt-1.5 text-xs text-content-faint">{hint}</p>}
      </div>
    </div>
  );
}

/** 라디오 한 벌 (가로 나열) */
function RadioRow({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm text-content">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
            className="h-4 w-4 accent-[#0057A8]"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** 사진 한 칸 — 연한 회색 박스 안에 미리보기(+ 우상단 ✕), 비어 있으면 가운데 "파일 선택".
 *  업로드 규칙은 RecordForm 의 handleUpload 와 같다(용량 게이트 → onUploadImage). */
function PhotoBox({
  field,
  value,
  onChange,
  onUploadImage,
  disabled,
  caption,
  captionNote,
  note,
  invalid,
}: {
  field: Extract<FieldDef, { kind: 'imageUpload' }> | undefined;
  value: string;
  onChange: (url: string) => void;
  onUploadImage?: (file: File, opts?: { maxDim?: number; folder?: string }) => Promise<string>;
  disabled?: boolean;
  caption: string;
  /** 제목 옆 괄호 — '(필수)' / '(비우면 PC 사진)' */
  captionNote?: string;
  note?: string;
  invalid?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bust, setBust] = useState(0);
  const has = value.trim() !== '';

  async function upload(file: File) {
    setError(null);
    if (!onUploadImage) {
      setError('업로드를 사용할 수 없습니다.');
      return;
    }
    const limitMB = field?.maxSizeMB ?? 5;
    if (file.size > limitMB * 1024 * 1024) {
      setError(`${limitMB}MB 이하 이미지만 올릴 수 있습니다.`);
      return;
    }
    setUploading(true);
    try {
      const url = await onUploadImage(file, {
        maxDim: field?.maxDim,
        // 저장 폴더 키 = 필드 folder 의 마지막 세그먼트(public/img/popup → uploads/popup/)
        folder: field?.folder.split('/').filter(Boolean).pop(),
      });
      onChange(url);
      setBust((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1.5 text-xs font-bold text-content">
        {caption}
        {captionNote && (
          <span className="ml-1 font-normal text-content-faint">{captionNote}</span>
        )}
      </p>
      <div
        className={`relative flex min-h-[280px] flex-col items-center justify-center gap-2 overflow-hidden rounded-[2px] border bg-surface-soft p-3 ${
          invalid ? 'border-[#b42318]' : 'border-surface-border'
        }`}
      >
        {has ? (
          <>
            {/* 관리자 화면이라 최적화보다 즉시 반영이 중요 — next/image 대신 일반 img. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${value}${bust ? `?v=${bust}` : ''}`}
              alt=""
              className="max-h-[320px] w-auto max-w-full object-contain"
            />
            <button
              type="button"
              onClick={() => onChange('')}
              disabled={disabled || uploading}
              aria-label={`${caption} 지우기`}
              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-[2px] border border-surface-border bg-surface text-sm font-bold text-content-faint transition-colors hover:border-yonsei-blue hover:text-yonsei-blue disabled:opacity-50"
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || uploading || !onUploadImage}
              className="rounded-[2px] border border-surface-border bg-surface px-4 py-2 text-sm font-semibold text-content transition-colors hover:border-yonsei-blue hover:text-yonsei-blue disabled:opacity-50"
            >
              파일 선택
            </button>
            {/* 규격을 고른 뒤가 아니라 고르기 전에 알려야 다시 만들지 않는다 */}
            <p className="text-[11px] leading-relaxed text-content-faint">
              권장: 표시 폭의 2배 이상 해상도, 5MB 이하 — 크기는 위치 미리보기에서 정합니다
            </p>
          </>
        )}

        {uploading && (
          <div className="absolute inset-0 grid place-items-center bg-white/90 text-xs font-bold text-yonsei-navy">
            업로드 중…
          </div>
        )}
      </div>

      {has && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading}
          className="mt-2 block w-full rounded-[2px] border border-surface-border bg-surface px-2 py-2 text-xs font-semibold text-content transition-colors hover:border-yonsei-blue hover:text-yonsei-blue disabled:opacity-50"
        >
          사진 교체
        </button>
      )}
      {invalid && <p className="mt-1.5 text-xs text-[#b42318]">{REQUIRED_MSG}</p>}
      {note && <p className="mt-1.5 text-[11px] leading-relaxed text-content-faint">{note}</p>}
      {error && (
        <p role="alert" className="mt-1.5 text-[11px] text-[#b42318]">
          {error}
        </p>
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
  );
}

export function PopupDetailEditor({
  fields,
  initial,
  isEdit,
  busy,
  onSubmit,
  onCancel,
  onDirty,
  onUploadImage,
}: DetailEditorProps) {
  const [form, setForm] = useState<FormRecord>({ ...initial });
  // 오류는 **저장을 한 번 눌렀는지**만 상태로 둔다. 어떤 칸이 비었는지는 매 렌더
  // 값에서 다시 세므로, 채우는 즉시 그 칸의 빨간 표시가 사라진다.
  const [submitted, setSubmitted] = useState(false);
  // 노출 페이지 모드는 **화면 상태**다 — pages 에서 매번 유도하면 '홈' 하나만 고른 채로
  // '사용자 정의'를 열 수 없다(값이 그대로라 곧장 '홈 화면'으로 되돌아간다).
  const [pageMode, setPageMode] = useState<'home' | 'custom'>(() => {
    const p = (initial.pages ?? []) as string[];
    return p.length === 1 && p[0] === 'home' ? 'home' : 'custom';
  });

  function set(key: string, value: FormRecord[string]) {
    onDirty?.();
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const imageUrl = str(form, 'image');

  // PC 사진의 원본 비율을 재서 폼 값(imageAspect)으로 남긴다 — 사이트의 PC 카드가
  // "이 화면에 들어가는 만큼" 줄어들 때 쓰는 값이라 저장까지 따라가야 한다.
  // 크기 편집기가 아니라 여기서 재는 이유: 모바일 탭을 보고 있어도 재야 하고,
  // 결과가 **폼 값**이어야 저장에 실려 가기 때문이다.
  // ⚠️ set() 이 아니라 setForm 을 직접 쓴다 — 측정은 관리자의 편집이 아니므로
  // onDirty 를 부르면 안 된다(옛 항목을 열기만 해도 '변경됨' 이 되어 버린다).
  useEffect(() => {
    let alive = true;
    const apply = (v: string) => {
      if (!alive) return;
      setForm((prev) => (str(prev, 'imageAspect') === v ? prev : { ...prev, imageAspect: v }));
    };
    const url = imageUrl.trim();
    if (!url) {
      apply('');
    } else {
      const probe = new window.Image();
      probe.onload = () => {
        const a =
          probe.naturalWidth > 0 && probe.naturalHeight > 0
            ? popupImageAspect(probe.naturalWidth / probe.naturalHeight)
            : undefined;
        apply(a ? String(a) : '');
      };
      // 읽지 못한 사진은 비율 없음으로 — 옛 항목과 같은 폴백 경로로 그려진다
      probe.onerror = () => apply('');
      probe.src = url;
    }
    // alive 플래그로 언마운트·URL 교체 중 늦게 도착한 결과를 버린다
    return () => {
      alive = false;
    };
  }, [imageUrl]);

  const field = (key: string) => fields.find((f) => f.key === key);
  const imageField = field('image');
  const imageMobileField = field('imageMobile');
  const positionField = field('position');
  const pageOptions =
    field('pages')?.kind === 'checkboxGroup'
      ? (field('pages') as Extract<FieldDef, { kind: 'checkboxGroup' }>).options
      : [];
  const deviceOptions =
    field('devices')?.kind === 'checkboxGroup'
      ? (field('devices') as Extract<FieldDef, { kind: 'checkboxGroup' }>).options
      : [];
  const closeOptions =
    field('closeControl')?.kind === 'radio'
      ? (field('closeControl') as Extract<FieldDef, { kind: 'radio' }>).options
      : [];

  const devices = (form.devices ?? []) as string[];
  const pages = (form.pages ?? []) as string[];

  const missing = submitted ? missingRequired(fields, form) : new Set<string>();
  const bad = (key: string) => missing.has(key);
  const showBanner = missing.size > 0;

  function toggleList(key: string, value: string, list: string[]) {
    set(key, list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function handleSubmit() {
    setSubmitted(true);
    // 게이트는 기존 검증 한 곳(validateForm)이 그대로 맡는다 — 위의 칸별 표시는
    // 같은 규칙을 화면에 편 것일 뿐, 저장 여부를 따로 정하지 않는다.
    if (validateForm(fields, form)) return;
    onSubmit(form);
  }

  const titlePair = pair(form, 'title');

  const saveButton = (
    <button
      type="button"
      onClick={handleSubmit}
      disabled={busy}
      className="cms-btn-primary disabled:opacity-60"
    >
      {busy ? '저장 중…' : '저장'}
    </button>
  );

  return (
    <div>
      <CmsPanelHead
        kind="collection"
        title={`팝업 공지 · ${isEdit ? '편집' : '새 항목'}`}
        description="저장하면 이 항목이 화면 하단 변경 트레이에 올라가고, 트레이에서 한 번에 저장합니다."
        back={
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-bold text-yonsei-blue transition-colors hover:text-yonsei-navy"
          >
            ← 목록으로
          </button>
        }
        actionsAlign="end"
        actions={
          <>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="cms-btn disabled:opacity-60"
            >
              취소
            </button>
            {saveButton}
          </>
        }
      />

      {showBanner && (
        <p
          role="alert"
          className="mb-5 border border-[#b42318]/30 bg-[#b42318]/[0.06] px-3.5 py-2.5 text-sm font-semibold text-[#b42318]"
        >
          필수 항목을 입력하세요
        </p>
      )}

      <div className="rounded-[2px] border border-surface-border bg-surface px-5 py-2">
        {isEdit && str(form, 'id') !== '' && (
          <p className="pt-3 text-xs text-content-faint">식별자: {str(form, 'id')}</p>
        )}

        {/* 1. 제목 (한/영) */}
        <Row label="제목" hint={field('title')?.hint}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <input
                id="popup-title-ko"
                type="text"
                value={titlePair.ko}
                disabled={busy}
                onChange={(e) => set('title', { ...titlePair, ko: e.target.value })}
                aria-label="제목 (한국어)"
                aria-invalid={bad('title') ? true : undefined}
                placeholder="한국어"
                className={`${fieldClass} ${bad('title') ? ERROR_BORDER : ''}`}
              />
              <FieldError show={bad('title')} />
            </div>
            <div className="flex items-start gap-2">
              <input
                id="popup-title-en"
                type="text"
                value={titlePair.en}
                disabled={busy}
                onChange={(e) => set('title', { ...titlePair, en: e.target.value })}
                aria-label="제목 (English)"
                placeholder="English"
                className={fieldClass}
              />
              <TranslateButton
                source={titlePair.ko}
                onTranslated={(en) => set('title', { ...titlePair, en })}
                disabled={busy}
                tall
              />
            </div>
          </div>
        </Row>

        {/* 2. 이미지 */}
        <Row label="이미지" align="control">
          <div className="flex flex-col gap-4 sm:flex-row">
            <PhotoBox
              field={imageField?.kind === 'imageUpload' ? imageField : undefined}
              value={str(form, 'image')}
              onChange={(url) => set('image', url)}
              onUploadImage={onUploadImage}
              disabled={busy}
              caption="PC 사진"
              captionNote="(필수)"
              note={imageField?.hint}
              invalid={bad('image')}
            />
            <PhotoBox
              field={imageMobileField?.kind === 'imageUpload' ? imageMobileField : undefined}
              value={str(form, 'imageMobile')}
              onChange={(url) => set('imageMobile', url)}
              onUploadImage={onUploadImage}
              disabled={busy}
              caption="모바일 사진"
              captionNote="(비우면 PC 사진)"
              note="비우면 PC 사진을 씁니다."
            />
          </div>
        </Row>

        {/* 3. 위치 */}
        {positionField?.kind === 'popupPosition' && (
          <Row label="위치" hint={positionField.hint} align="style">
            {/* 업로드 통로는 사진 칸(PhotoBox)과 같은 하나 — PC 크기 편집기의 배경
                캡처 교체가 쓴다. */}
            <PopupPositionPicker
              form={form}
              keys={positionField.keys}
              setValue={set}
              onUploadImage={onUploadImage}
              busy={busy}
            />
          </Row>
        )}

        {/* 4. 버튼 설정 */}
        <Row label="버튼 설정" align="control">
          <RadioRow
            name="popup-hide-today-button"
            value={form.hideTodayButton === true ? 'show' : 'hide'}
            disabled={busy}
            options={[
              { value: 'show', label: '배너 하단 버튼 표시' },
              { value: 'hide', label: '표시안함' },
            ]}
            onChange={(v) => set('hideTodayButton', v === 'show')}
          />
          <p className="mt-1.5 text-xs text-content-faint">
            하단 바의 &lsquo;오늘 하루 보지 않기&rsquo; 칸 (끄면 &lsquo;닫기&rsquo; 만 남습니다)
          </p>
        </Row>

        {/* 5. 우측 상단 닫기 설정 */}
        <Row label="우측 상단 닫기 설정" align="control">
          <RadioRow
            name="popup-close-control"
            value={str(form, 'closeControl') || 'close'}
            disabled={busy}
            options={closeOptions}
            onChange={(v) => set('closeControl', v)}
          />
        </Row>

        {/* 6. 이미지 링크 */}
        <Row label="이미지 링크" htmlFor="popup-link" hint={field('link')?.hint}>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="popup-link"
              type="text"
              value={str(form, 'link')}
              disabled={busy}
              onChange={(e) => set('link', e.target.value)}
              placeholder="https://"
              className={`${fieldClass} w-auto min-w-[260px] flex-1`}
            />
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm text-content">
              <input
                type="checkbox"
                checked={form.newTab === true}
                disabled={busy}
                onChange={(e) => set('newTab', e.target.checked)}
                className="h-4 w-4 accent-[#0057A8]"
              />
              새 창에서 열기
            </label>
          </div>
        </Row>

        {/* 7. 기간 */}
        <Row label="기간" hint="한국 시간 기준입니다.">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              value={str(form, 'start')}
              disabled={busy}
              onChange={(e) => set('start', e.target.value)}
              aria-label="게재 시작"
              aria-invalid={bad('start') ? true : undefined}
              className={`${fieldClass} w-auto min-w-[210px] flex-1 ${bad('start') ? ERROR_BORDER : ''}`}
            />
            <span aria-hidden="true" className="text-sm text-content-faint">
              ~
            </span>
            <input
              type="datetime-local"
              value={str(form, 'end')}
              disabled={busy}
              onChange={(e) => set('end', e.target.value)}
              aria-label="게재 종료"
              aria-invalid={bad('end') ? true : undefined}
              className={`${fieldClass} w-auto min-w-[210px] flex-1 ${bad('end') ? ERROR_BORDER : ''}`}
            />
          </div>
          {/* 시작·종료가 한 줄이라 문구도 한 번만 — 칸마다 붙이면 같은 말이 두 번 */}
          <FieldError show={bad('start') || bad('end')} />
        </Row>

        {/* 8. 대상 기기 */}
        <Row label="대상 기기" hint={field('devices')?.hint} align="control">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {deviceOptions.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2 text-sm text-content"
              >
                <input
                  type="checkbox"
                  checked={devices.includes(o.value)}
                  disabled={busy}
                  onChange={() => toggleList('devices', o.value, devices)}
                  className="h-4 w-4 accent-[#0057A8]"
                />
                {o.label}
              </label>
            ))}
          </div>
        </Row>

        {/* 9. 노출 페이지 */}
        <Row label="노출 페이지" align="control">
          <RadioRow
            name="popup-page-mode"
            value={pageMode}
            disabled={busy}
            options={[
              { value: 'home', label: '홈 화면' },
              { value: 'custom', label: '사용자 정의' },
            ]}
            onChange={(v) => {
              setPageMode(v === 'home' ? 'home' : 'custom');
              // '홈 화면'은 값도 홈 하나로 되돌린다. '사용자 정의'로 옮길 때는 지금 고른
              // 값을 그대로 두고 체크리스트만 펼친다(홈만 있으면 홈이 체크된 채로 시작).
              if (v === 'home') set('pages', ['home']);
            }}
          />
          {pageMode === 'custom' && (
            <div className="mt-3 border-l-4 border-yonsei-blue bg-surface-soft px-4 py-3">
              <ul className="m-0 list-none space-y-2 p-0">
                {pageOptions.map((o) => (
                  <li key={o.value}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-content">
                      <input
                        type="checkbox"
                        checked={pages.includes(o.value)}
                        disabled={busy}
                        onChange={() => toggleList('pages', o.value, pages)}
                        className="h-4 w-4 accent-[#0057A8]"
                      />
                      {o.label}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-content-faint">{field('pages')?.hint}</p>
            </div>
          )}
        </Row>

        {/* 10. 노출 */}
        <Row label="노출" align="control">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-content">
            <input
              type="checkbox"
              checked={form.enabled === true}
              disabled={busy}
              onChange={(e) => set('enabled', e.target.checked)}
              className="h-4 w-4 accent-[#0057A8]"
            />
            노출
          </label>
          <p className="mt-1.5 text-xs text-content-faint">끄면 기간 안이라도 뜨지 않습니다</p>
        </Row>

        <div className="flex justify-end border-t border-surface-border py-4">{saveButton}</div>
      </div>
    </div>
  );
}
