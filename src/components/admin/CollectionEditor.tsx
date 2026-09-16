'use client';

// 스키마 기반 컬렉션 편집기 — resources.ts 의 ResourceDef 를 읽어 목록·검색·
// 순서 변경·폼 편집을 자동 구성한다. 저장은 /api/admin/content(Supabase
// content_files + revalidateTag)로 하며 재배포 없이 수 초 내 사이트에 반영된다.
// (Stage C 이전에는 브라우저가 GitHub Contents API 로 직접 커밋했다.)
//
// 디프 최소화 원칙: 저장 시 전체를 재직렬화하지 않고, 원본 배열(raw)에서
// 수정=해당 인덱스만 교체 / 추가=push / 삭제=splice 만 적용해 나머지 항목의
// 바이트를 그대로 유지한다. (record 포맷은 커밋 직전 arrayToRecord 로 변환.)
//
// 미저장 변경(카드 인라인 편집·순서 변경)의 표시와 되돌리기는 화면 하단의 변경
// 트레이가 맡는다(useRegisterTray). 커밋 자체는 여기 있는 기존 전략을 그대로 쓰고,
// 트레이는 그 위에 얹는 표시 계층일 뿐이다.
// (한국어 UI 문자열은 내부 운영 도구라 컴포넌트에 직접 둔다.)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  commitJson,
  commitText,
  loadJson,
  loadJsonOptional,
  loadTextOptional,
  savedBanner,
  type RepoConfig,
} from '@/lib/admin/content-api';
import { uploadAttachment, type UploadProgressHandler } from '@/lib/admin/storage';
import {
  PopupHiddenBadgeInline,
  popupListCell,
  popupNowKst,
} from './popup-list-cells';
import {
  arrayToRecord,
  cellText,
  defaultFromForm,
  defaultToForm,
  fileNameOf,
  recordToArray,
  type FormRecord,
  type LinkedSummary,
  type ResourceDef,
} from '@/lib/admin/resources';
import {
  applyInlinePatch,
  applyInlineToForm,
  displayInline,
  findInlineField,
  inlineFieldLabel,
  isInlineUnchanged,
  readInline,
  type InlinePatch,
  type InlineValue,
} from '@/lib/admin/inline';
import { invalidInlinePaths, invalidReason } from '@/lib/admin/validate-inline';
import { RecordForm } from './RecordForm';
import { ClubRowsEditor } from './ClubRowsEditor';
import { ExpandRowsEditor } from './ExpandRowsEditor';
import { FacultyCardsEditor } from './FacultyCardsEditor';
import { HeroCardsEditor } from './HeroCardsEditor';
import { HistoryTimelineEditor } from './HistoryTimelineEditor';
import { InlineTable } from './InlineTable';
import { FacultyDetailEditor } from './FacultyDetailEditor';
import { LabDetailEditor } from './LabDetailEditor';
import { PopupDetailEditor } from './PopupDetailEditor';
import type { DetailEditorProps } from './DetailEditorTypes';
import { MoveButtons } from './InlineFields';
import { LabCardsEditor } from './LabCardsEditor';
import { CmsPanelHead } from './CmsPanelHead';
import { FacultyCrawlButton } from './FacultyCrawlButton';
import { FacultyCrawlDrawer } from './FacultyCrawlDrawer';
import { useFacultyCrawl } from './useFacultyCrawl';
import { CommitBanner } from './CommitBanner';
import { CmsModal } from './CmsModal';
import { CmsEmptyState } from './CmsEmptyState';
import { CmsSkeleton, type SkeletonShape } from './CmsSkeleton';
import { useAdminShell } from './AdminShellContext';
import { useRegisterTray, type PendingChange } from './ChangeTrayContext';

interface Props {
  config: RepoConfig;
  resource: ResourceDef;
  onDirtyChange?: (dirty: boolean) => void;
}

type RawItem = Record<string, unknown>;

// 편집 상태: index<0 이면 새 항목, 아니면 raw 배열의 원본 인덱스
interface EditState {
  index: number;
  form: FormRecord;
}

// 항목별 연결 마크다운 로드 상태
interface MdState {
  text: string;
  loaded: string; // 로드 시점 원본
  sha: string | undefined; // 기존 파일 sha (없으면 undefined = 신규)
  existed: boolean;
  loading: boolean;
}

/** 연결 요약 상태 — 공유 record 파일 전체와 그중 편집 중인 키 하나.
 *  md 와 마찬가지로 폼을 열 때만 존재하므로 별도 dirty 플래그가 필요 없다
 *  (dirty 는 editing 이 열려 있는 것만으로 이미 참이다). */
interface SummaryState {
  ko: string;
  en: string;
  loadedKo: string;
  loadedEn: string;
  /** 편집 시작 시점의 record 키(지도교수명) — 키가 바뀌면 옛 키를 지운다 */
  loadedKey: string;
  /** 파일 전체(다른 연구실 요약 포함) — 저장 시 병합 원본 */
  all: Record<string, { ko: string; en: string }>;
  sha?: string;
  existed: boolean;
  loading: boolean;
}

function withTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

export function CollectionEditor({ config, resource, onDirtyChange }: Props) {
  // 저장 결과를 화면 한 곳(상단 토스트·권한 배너)에서만 말하게 한다.
  // 트레이 저장은 ChangeTray 가 이미 토스트를 띄우므로, 여기서는 트레이를 거치지
  // 않는 경로(폼 저장·삭제)만 직접 알린다 — 아래 finishSave 의 notify 인자 참고.
  const { showToast, setWriteDenied } = useAdminShell();

  // 교수진 화면에만 붙는 학술활동 자동 수집. 상태를 여기서 한 벌 만들어 머리말 버튼 ·
  // 머리말 진행 바 · 진행 패널이 같은 값을 보게 한다(세 곳이 각자 들면 어긋난다).
  const showCrawl = resource.listView?.kind === 'cards' && resource.listView.variant === 'faculty';
  const crawl = useFacultyCrawl(showCrawl);

  const toForm = useCallback(
    (r: unknown): FormRecord =>
      resource.toForm ? resource.toForm(r) : defaultToForm(resource.fields, r),
    [resource],
  );
  const fromForm = useCallback(
    (f: FormRecord): unknown =>
      resource.fromForm ? resource.fromForm(f) : defaultFromForm(resource.fields, f),
    [resource],
  );

  /**
   * imageUpload 필드·교수 카드 사진이 호출: 이미지를 외부 스토리지(R2, dev 는
   * public/uploads/)에 올리고 **저장할 공개 URL 을 돌려준다.**
   *
   * ⚠️ 예전에는 저장소에 `public/img/faculty/<이름>.<확장자>` 로 커밋하고 그 경로를
   * 필드 값으로 조립했다. 콘텐츠 저장이 Git 커밋을 떠난 지금은 저장소에 바이너리를
   * 넣을 경로가 없으므로, 첨부와 같은 업로드 경로를 쓰고 결과 URL 을 그대로 값으로
   * 쓴다(파일명이 더 이상 이름과 묶이지 않는다 → 이름 매칭 규칙에 의존하지 않는다).
   */
  const uploadImage = useCallback(
    async (
      file: File,
      opts?: { maxDim?: number; folder?: string; onProgress?: UploadProgressHandler },
    ): Promise<string> => {
      // folder 는 필드 정의(imageUpload.folder)의 마지막 세그먼트 — 교수진 'faculty',
      // 메인 이미지 'hero' 처럼 리소스별로 저장 폴더가 갈린다(옛 하드코딩 'faculty' 폴백).
      // maxDim 은 히어로처럼 큰 화면을 채우는 사진의 압축 상한 상향용(storage 기본 1600).
      // onProgress 는 실시간 % 를 그리는 화면(연혁 연대 사진)만 넘긴다 — 넘기지 않는
      // 화면은 지금처럼 불확정 막대를 쓴다.
      const { url } = await uploadAttachment(config, opts?.folder ?? 'faculty', file, opts?.onProgress, undefined, {
        maxDim: opts?.maxDim,
      });
      return url;
    },
    [config],
  );

  /**
   * 영상 등 대용량 파일 업로드 통로(자세히 편집기 전용).
   * uploadImage 와 같은 uploadAttachment 를 쓰지만 압축 상한을 넘기지 않고
   * (영상은 compressImage 가 건너뛴다) 진행률·취소 신호를 그대로 전달한다 —
   * 200MB 영상은 몇 분씩 걸려 "지금 어디쯤인지"와 "중단" 없이는 쓸 수 없다.
   */
  const uploadFile = useCallback(
    async (
      file: File,
      opts: { folder: string; onProgress?: UploadProgressHandler; signal?: AbortSignal },
    ): Promise<string> => {
      const { url } = await uploadAttachment(config, opts.folder, file, opts.onProgress, opts.signal);
      return url;
    },
    [config],
  );

  // 원본 배열과 sha 를 그대로 보관 (표시용 FormRecord 는 파생)
  const [raw, setRaw] = useState<RawItem[]>([]);
  const [sha, setSha] = useState('');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<EditState | null>(null);
  /** 삭제 확인 모달의 대상 인덱스 (null = 닫힘) — window.confirm 대체 */
  const [deleting, setDeleting] = useState<number | null>(null);
  const [md, setMd] = useState<MdState | null>(null);
  const [summary, setSummary] = useState<SummaryState | null>(null);

  // 로컬 순서 변경 상태 (미저장). null 이면 순서 변경 없음.
  const [orderedRaw, setOrderedRaw] = useState<RawItem[] | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ message: string; url: string } | null>(null);

  /**
   * 저장 충돌(409/422) 안내 — null 이 아니면 모달을 띄운다. pending 은 이 선택으로
   * 잃게 될 대기 변경 건수다. 상태로 두는 이유는 "재로드할지"를 사용자가 정해야
   * 하기 때문이다 — 아래 handleSaveError 주석 참고.
   */
  const [conflict, setConflict] = useState<{ pending: number } | null>(null);

  /**
   * 목록에서 고친 값 (미저장) — index → { 편집 경로: 값 }. 원본과 다른 것만 담는다.
   * 경로는 'email' 또는 localized 의 한쪽 'role.ko' 다. 값의 타입(문자열/불리언)과
   * 저장 규칙은 lib/admin/inline.ts 가 FieldDef.kind 를 보고 정한다.
   */
  const [inlineEdits, setInlineEdits] = useState<Record<number, InlinePatch>>({});
  const cardDirty = Object.keys(inlineEdits).length > 0;

  /**
   * 곁 파일(resource.linkedImageMap — 연혁 연대 사진) 의 로드 시점 원본과 버전.
   * sha 가 없으면 파일이 아직 없다는 뜻이라 저장이 신규 생성 경로를 탄다
   * (연구실 AI 요약 loadSummary 와 같은 규약).
   */
  const [imageMap, setImageMap] = useState<{ loaded: Record<string, string>; sha?: string }>({
    loaded: {},
  });
  /** 대기 중인 사진 편집 — 키=맵의 키(연대), 값=새 URL('' 이면 삭제) */
  const [imageEdits, setImageEdits] = useState<Record<string, string>>({});
  const imagesDirty = Object.keys(imageEdits).length > 0;

  const orderDirty = orderedRaw !== null;
  const dirty = editing !== null || orderDirty || cardDirty || imagesDirty;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // 데이터 로드: record 포맷이면 배열화해 보관
  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      // emptyIfMissing 리소스(팝업 공지)는 파일이 아직 없는 게 정상이라 404 를
      // 빈 목록으로 받는다 — sha 가 빈 문자열이면 저장이 신규 생성 경로를 탄다.
      const file = resource.emptyIfMissing
        ? ((await loadJsonOptional<unknown>(config, resource.file)) ?? {
            data: resource.format === 'record' ? {} : [],
            sha: '',
          })
        : await loadJson<unknown>(config, resource.file);
      let arr: RawItem[];
      if (resource.format === 'record') {
        arr = recordToArray(file.data as Record<string, RawItem>, resource.idField!);
      } else {
        arr = (file.data as RawItem[]).slice();
      }
      setRaw(arr);
      setSha(file.sha);
    } catch (err) {
      setRaw([]);
      setListError(err instanceof Error ? err.message : '목록을 불러오지 못했습니다.');
    } finally {
      // 곁 파일(연대 사진 맵)은 본 목록과 성패를 묶지 않는다 — 아직 없을 수도 있고
      // (Optional 로드), 읽기에 실패해도 연혁 항목 편집까지 막을 이유가 없다.
      // 실패해 sha 를 못 받으면 저장이 '신규 생성' 으로 가는데, 행이 이미 있으면
      // 서버가 409 로 막으므로 남의 맵을 덮어쓰지는 않는다.
      if (resource.linkedImageMap) {
        try {
          const map = await loadJsonOptional<Record<string, string>>(
            config,
            resource.linkedImageMap.file,
          );
          setImageMap({ loaded: map?.data ?? {}, sha: map?.sha });
        } catch {
          setImageMap({ loaded: {} });
        }
      }
      setLoading(false);
    }
  }, [config, resource]);

  // 마운트 / resource 전환 시 로드 및 상태 초기화
  useEffect(() => {
    setEditing(null);
    setDeleting(null);
    setMd(null);
    setSummary(null);
    setOrderedRaw(null);
    setImageEdits({});
    setSearch('');
    setSuccess(null);
    setSaveError(null);
    void load();
  }, [load]);

  // 표시용 배열: 순서 변경 중이면 orderedRaw, 아니면 raw
  const displayRaw = orderedRaw ?? raw;

  /**
   * 표시용 폼 — 원본을 폼으로 편 뒤 대기 중인 인라인 편집을 얹는다.
   * ⚠️ 원본 raw 에 얹지 않는 이유: 편집 경로가 'role.ko' 처럼 중첩 키를 가리킬 수
   * 있어 얕은 병합으로는 표현되지 않고, raw 에 얹으면 빈 값 규칙(null/생략)이 화면
   * 표시에까지 새어 들어와 입력 중인 칸이 사라진 것처럼 보인다.
   */
  const formOf = useCallback(
    (index: number): FormRecord =>
      applyInlineToForm(resource.fields, toForm(displayRaw[index] ?? {}), inlineEdits[index]),
    [displayRaw, inlineEdits, resource.fields, toForm],
  );

  // 원본 인덱스를 유지한 채 폼으로 파생 + 검색 필터
  const rows = useMemo(() => {
    const all = displayRaw.map((_, index) => ({ index, form: formOf(index) }));
    const q = search.trim().toLowerCase();
    if (q === '') return all;
    return all.filter((row) =>
      resource.searchKeys.some((k) => cellText(row.form, k).toLowerCase().includes(q)),
    );
  }, [displayRaw, formOf, search, resource.searchKeys]);

  /** 좌측 파란 막대를 붙일 인덱스 */
  const dirtyIndices = useMemo(
    () => new Set(Object.keys(inlineEdits).map(Number)),
    [inlineEdits],
  );

  /** 대기 편집이 얹힌 사진 맵 — '' 는 삭제이므로 키 자체를 뺀다(저장 형태와 같다) */
  const imageValues = useMemo(() => {
    const out: Record<string, string> = { ...imageMap.loaded };
    for (const [key, url] of Object.entries(imageEdits)) {
      if (url === '') delete out[key];
      else out[key] = url;
    }
    return out;
  }, [imageMap.loaded, imageEdits]);

  /** '수정됨' 배지를 붙일 맵 키 */
  const imageDirtyKeys = useMemo(() => new Set(Object.keys(imageEdits)), [imageEdits]);

  // ---- 필수값 누락 ----
  //
  // 목록에서 필수 칸을 비우면 커밋 자체는 성공하고 사이트에 빈 카드가 뜬다. 저장
  // 이후에 발견되는 실패라 되돌리려면 다시 저장소를 건드려야 한다. 그래서 커밋
  // 직전에 던지지 않고, 대기 단계에서 트레이의 저장 버튼을 잠그고 이유를 말한다.
  const invalidPaths = useMemo(
    () => invalidInlinePaths(resource.fields, inlineEdits),
    [resource.fields, inlineEdits],
  );
  const invalidMsg = useMemo(
    () => invalidReason(resource.fields, invalidPaths),
    [resource.fields, invalidPaths],
  );

  /** 지금 저장하면 안 되는 이유 — 트레이가 이 값으로 저장 버튼을 잠근다 */
  const saveBlockReason = invalidMsg;

  // ---- 변경 트레이 연결 ----
  //
  // ⚠️ 카드 편집과 순서 변경은 "같이 대기"시키지 않는다. 둘 다 로드 시점 sha 로
  // 커밋하므로 한 번의 저장에서 두 커밋을 내면 두 번째가 409 로 반드시 실패하고,
  // 하나로 합치려 해도 inlineEdits 의 키가 인덱스라 순서가 바뀌는 순간 어느 항목의
  // 편집인지 특정할 수 없다(다른 사람 값을 덮어쓸 위험). 그래서 기존 locked 규칙을
  // 유지해 애초에 공존하지 못하게 막고(순서 변경 중 카드 편집 잠금 + 카드 편집 중
  // 순서 이동 잠금), 저장은 둘 중 대기 중인 쪽 하나만 실행한다.
  const ORDER_CHANGE_ID = `${resource.key}:__order__`;
  /** 사진 맵 변경의 트레이 id 접두 — 인덱스 기반 변경과 구분해 되돌리기·삭제 경고가
   *  각자 다르게 다룬다(사진은 키가 연대라 항목을 지워도 살아남는다) */
  const IMAGE_CHANGE_PREFIX = `${resource.key}:__image__:`;

  const trayChanges = useMemo<PendingChange[]>(() => {
    const list: PendingChange[] = [];
    if (orderedRaw) {
      // 순서는 필드 단위로 쪼갤 수 없어 한 건으로 묶는다
      const moved = orderedRaw.reduce((n, item, i) => (item === raw[i] ? n : n + 1), 0);
      list.push({
        id: ORDER_CHANGE_ID,
        scopeLabel: resource.label,
        itemLabel: '목록 순서',
        fieldLabel: '순서',
        before: '원래 순서',
        after: `${moved}개 이동`,
      });
    }
    for (const [key, patch] of Object.entries(inlineEdits)) {
      const index = Number(key);
      const original = displayRaw[index] as Record<string, unknown> | undefined;
      const itemLabel = resource.summarize(formOf(index)) || `#${index + 1}`;
      for (const [path, value] of Object.entries(patch)) {
        // 트레이 문구는 사람이 읽는 표시값으로 — select 는 옵션 라벨, checkbox 는 예/아니오,
        // localized 는 어느 쪽(한국어/English)을 고쳤는지까지 밝힌다.
        const field = findInlineField(resource.fields, path);
        list.push({
          id: `${resource.key}:${index}:${path}`,
          scopeLabel: resource.label,
          itemLabel,
          fieldLabel: inlineFieldLabel(field, path),
          before: displayInline(field, readInline(resource.fields, original, path)),
          after: displayInline(field, value),
        });
      }
    }
    // 곁 파일(연대 사진) — 항목이 아니라 연대에 붙는 변경이라 itemLabel 이 '1990년대' 다.
    // 값은 긴 업로드 URL 이므로 칩에는 파일명만 말한다(빈 값은 칩이 '없음' 으로 그린다).
    if (resource.linkedImageMap) {
      const link = resource.linkedImageMap;
      for (const [key, url] of Object.entries(imageEdits)) {
        list.push({
          id: `${IMAGE_CHANGE_PREFIX}${key}`,
          scopeLabel: resource.label,
          itemLabel: `${key}년대`,
          fieldLabel: link.label,
          before: fileNameOf(imageMap.loaded[key] ?? ''),
          after: fileNameOf(url),
        });
      }
    }
    return list;
  }, [
    ORDER_CHANGE_ID,
    IMAGE_CHANGE_PREFIX,
    inlineEdits,
    imageEdits,
    imageMap.loaded,
    orderedRaw,
    raw,
    displayRaw,
    formOf,
    resource,
  ]);

  /** 항목 삭제로 함께 잃게 되는 대기 변경 수 — 인덱스에 묶인 것만 센다.
   *  (연대 사진은 키가 연대라 항목이 밀려도 그대로 쓸 수 있어 살려 둔다) */
  const indexBoundChanges = trayChanges.filter(
    (c) => !c.id.startsWith(IMAGE_CHANGE_PREFIX),
  ).length;

  function revertTrayChange(id: string) {
    if (id === ORDER_CHANGE_ID) {
      resetOrder();
      return;
    }
    if (id.startsWith(IMAGE_CHANGE_PREFIX)) {
      const key = id.slice(IMAGE_CHANGE_PREFIX.length);
      setImageEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    // id = `${resource.key}:${index}:${path}` — 리소스 키·경로에는 ':' 이 없다
    const parts = id.split(':');
    const index = Number(parts[1]);
    const path = parts.slice(2).join(':');
    setInlineEdits((prev) => {
      const forIndex = prev[index];
      if (!forIndex) return prev;
      const nextForIndex = { ...forIndex };
      delete nextForIndex[path];
      const next = { ...prev };
      // patchInline 과 같은 규칙 — 남은 편집이 없으면 인덱스 자체를 뺀다
      if (Object.keys(nextForIndex).length === 0) delete next[index];
      else next[index] = nextForIndex;
      return next;
    });
  }

  function revertAllTray() {
    resetOrder();
    resetInlineEdits();
    setImageEdits({});
  }

  /** 트레이의 "저장 (커밋)" — 대기 중인 쪽 하나를 기존 커밋 경로로 그대로 넘긴다.
   *  연대 사진 맵은 **다른 파일**이라 본 파일과 버전을 다투지 않으므로, 값 편집과
   *  같은 저장에 이어 붙는다(saveInlineEdits 안쪽 참고). */
  async function saveTray() {
    if (orderDirty) {
      await saveOrder();
      return;
    }
    await saveInlineEdits();
  }

  // 상세 폼을 연 동안에는 트레이를 내린다 — 폼 저장은 로드 시점 raw 로 커밋하므로
  // 트레이의 대기 변경과 sha 를 다투게 되고, 화면에 저장 버튼이 둘이 되어 헷갈린다.
  useRegisterTray(
    editing
      ? null
      : {
          changes: trayChanges,
          revert: revertTrayChange,
          revertAll: revertAllTray,
          save: saveTray,
          blockReason: saveBlockReason,
        },
  );

  /**
   * 저장 후 재로드 (버전이 올라갔으므로 새 버전 확보 필수 — 안 받으면 다음 저장이 409).
   *
   * notice: 트레이를 거치지 않은 저장(폼 저장·삭제)만 문구를 넘긴다. 트레이 경로는
   * ChangeTray.handleSave 가 이미 토스트를 올리므로 여기서 또 올리면 같은 말이 두 번 뜬다.
   */
  function finishSave(notice?: string) {
    setEditing(null);
    setMd(null);
    setSummary(null);
    setOrderedRaw(null);
    setSuccess(savedBanner(config));
    // 쓰기가 통했으니 권한 배너를 내린다 — 권한은 나중에 부여될 수 있고,
    // 한 번 뜬 배너가 남아 있으면 이미 되는 일을 안 된다고 말하게 된다.
    setWriteDenied(false);
    // 콘텐츠 저장은 Supabase 행 갱신 + revalidateTag('content') 라 재배포를
    // 기다리지 않는다 — "배포 중" 안내가 필요 없다(BoardEditor 와 같은 이유).
    if (notice) showToast(notice);
    void load();
  }

  /**
   * silent: 트레이가 자기 자리에 오류를 띄우는 경우 — 같은 문구를 두 번 보여주지 않는다.
   *
   * ⚠️ 409/422(다른 사람이 먼저 저장)에서 **조용히 재로드하지 않는다.** 재로드는
   * 남의 최신본으로 내 화면을 덮는 파괴적 동작이다. 조용히 실행하면 사용자는 방금
   * 친 값이 왜 사라졌는지 알 수 없다. 그래서 여기서는 모달을 띄우기만 하고, 무엇을
   * 잃는지 밝힌 뒤 사용자가 고르게 한다. 자동 재시도도 하지 않는다 — 재시도는
   * 결국 남의 변경을 덮어쓰는 방향으로만 성공한다.
   */
  function handleSaveError(err: unknown, fallback: string, silent = false) {
    const msg = err instanceof Error ? err.message : fallback;
    if (!silent) setSaveError(msg);
    if (msg.includes('409') || msg.includes('422')) {
      // 폼 편집 중이면 잃는 것은 지금 폼 1건, 목록이면 트레이의 대기 변경 전부다
      setConflict({ pending: editing ? 1 : trayChanges.length });
    }
    // 권한 부족은 이 화면이 판정하지 않는다 — 서버(admin API)가 만든 문구를 신호로만
    // 올리고, 배너와 저장 잠금은 셸이 한 곳에서 그린다.
    if (msg.includes('403') || msg.includes('권한이 부족합니다') || msg.includes('권한이 없습니다')) {
      setWriteDenied(true);
    }
  }

  // ---- 편집 진입 ----

  /**
   * 공유 요약 파일 전체를 읽어 편집 상태로 만든다. 신규 항목은 키(지도교수명)가 아직
   * 없으므로 key='' 로 들어와 빈 값에서 시작하지만, **파일은 그래도 읽는다** — 저장
   * 시 다른 연구실 요약을 지우지 않으려면 병합 원본(all)과 버전(sha)이 필요하다.
   */
  async function loadSummary(link: LinkedSummary, key: string) {
    const empty = (loading: boolean): SummaryState => ({
      ko: '', en: '', loadedKo: '', loadedEn: '', loadedKey: key,
      all: {}, sha: undefined, existed: false, loading,
    });
    setSummary(empty(true));
    try {
      const file = await loadJsonOptional<Record<string, { ko: string; en: string }>>(
        config,
        link.file,
      );
      // 파일이 아직 없으면 빈 record 에서 시작한다(sha 없음 = 저장 시 신규 생성).
      const all = file?.data ?? {};
      const cur = key === '' ? undefined : all[key];
      setSummary({
        ko: cur?.ko ?? '',
        en: cur?.en ?? '',
        loadedKo: cur?.ko ?? '',
        loadedEn: cur?.en ?? '',
        loadedKey: key,
        all,
        sha: file?.sha,
        existed: cur !== undefined,
        loading: false,
      });
    } catch {
      // 로드 실패는 마크다운과 같은 규약 — 빈 값으로 내려 폼 자체를 막지 않는다.
      // ⚠️ all 이 비어 있으면 저장 시 다른 요약을 날린다. 그래서 existed=false 이고
      //    본인 요약도 비어 있는 상태가 되어, 아래 저장 로직이 PUT 자체를 건너뛴다.
      setSummary(empty(false));
    }
  }

  function startNew() {
    setSuccess(null);
    setSaveError(null);
    // 리소스의 toForm 을 태운다 — 빈 항목에도 리소스 기본값(팝업 공지의 노출·형태
    // 등)이 얹혀야 새 항목 폼이 편집 폼과 같은 규칙을 보인다.
    const form = toForm({});
    setEditing({ index: -1, form });
    // 새 항목은 로드 없이 빈 마크다운에서 시작
    if (resource.linkedMarkdown) {
      setMd({ text: '', loaded: '', sha: undefined, existed: false, loading: false });
    } else {
      setMd(null);
    }
    if (resource.linkedSummary) {
      void loadSummary(resource.linkedSummary, resource.linkedSummary.keyOf(form));
    } else {
      setSummary(null);
    }
  }

  async function startEdit(index: number) {
    setSuccess(null);
    setSaveError(null);
    // 대기 중인 인라인 편집이 얹힌 값으로 폼을 연다 — 목록에서 방금 고친 값이
    // 상세 화면에서 사라져 보이면 같은 값을 두 번 고치게 된다.
    const form = formOf(index);
    setEditing({ index, form });

    if (resource.linkedSummary) {
      void loadSummary(resource.linkedSummary, resource.linkedSummary.keyOf(form));
    } else {
      setSummary(null);
    }

    if (!resource.linkedMarkdown) {
      setMd(null);
      return;
    }
    // 기존 항목의 연결 마크다운 로드
    setMd({ text: '', loaded: '', sha: undefined, existed: false, loading: true });
    try {
      const path = resource.linkedMarkdown.pathOf(form);
      const file = await loadTextOptional(config, path);
      if (file) {
        setMd({ text: file.data, loaded: file.data, sha: file.sha, existed: true, loading: false });
      } else {
        setMd({ text: '', loaded: '', sha: undefined, existed: false, loading: false });
      }
    } catch {
      // 마크다운 로드 실패 시 신규처럼 빈 값으로 (본문 편집만 막지 않도록)
      setMd({ text: '', loaded: '', sha: undefined, existed: false, loading: false });
    }
  }

  // ---- 저장 (추가/수정) ----

  async function handleSubmit(form: FormRecord) {
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    setSuccess(null);

    const isNew = editing.index < 0;

    // record 포맷 신규: idField 중복 검사
    if (isNew && resource.format === 'record') {
      const idKey = resource.idField!;
      const newId = cellText(form, idKey).trim();
      const dup = raw.some((r) => String(r[idKey] ?? '') === newId);
      if (dup) {
        const idLabel =
          resource.fields.find((f) => f.key === idKey)?.label ?? idKey;
        setSaveError(`이미 존재하는 ${idLabel}입니다.`);
        setSaving(false);
        return;
      }
    }

    try {
      // 로드 시점 배열 + 버전(sha 자리)으로 저장한다. 그 사이 원본이 바뀌었으면
      // 버전 불일치(409)로 서버가 거부하므로, 어긋난 인덱스로 다른 항목을 덮어쓸 일이 없다.
      const record = fromForm(form) as RawItem;
      const next = raw.slice();
      let action: string;
      if (isNew) {
        next.push(record);
        action = '추가';
      } else {
        next[editing.index] = record;
        action = '수정';
      }

      const payload =
        resource.format === 'record' ? arrayToRecord(next, resource.idField!) : next;
      const message = `content: ${resource.label} ${action} — ${resource.summarize(form)}`;
      await commitJson(config, resource.file, payload, sha, message);

      // 연결 마크다운 저장 (본 파일 저장 성공 후)
      if (resource.linkedMarkdown && md) {
        const path = resource.linkedMarkdown.pathOf(form);
        const content = md.text.trim();
        if (md.existed) {
          // 기존 md 가 있고 내용이 바뀌었으면 저장
          if (md.text !== md.loaded) {
            await commitText(
              config,
              path,
              withTrailingNewline(md.text),
              md.sha,
              `content: ${resource.label} 소개 본문 수정 — ${resource.summarize(form)}`,
            );
          }
        } else if (content !== '') {
          // md 가 없었고 내용이 비어있지 않으면 생성 (sha=undefined)
          await commitText(
            config,
            path,
            withTrailingNewline(md.text),
            undefined,
            `content: ${resource.label} 소개 본문 추가 — ${resource.summarize(form)}`,
          );
        }
      }

      // 연결 요약 저장 (본 파일 저장 성공 후 — 마크다운과 같은 순서·같은 한계).
      // ⚠️ 두 파일을 한 트랜잭션으로 묶지 않는다(linkedMarkdown 의 선례를 그대로 따른다).
      //    본 파일이 저장된 뒤 여기서 실패하면 요약만 옛 값으로 남는다.
      if (resource.linkedSummary && summary) {
        const link = resource.linkedSummary;
        const newKey = link.keyOf(form);
        const ko = summary.ko.trim();
        const en = summary.en.trim();
        // 지도교수 이름을 고치면 요약의 키도 따라가야 한다 — 옛 키는 지운다.
        const keyChanged = summary.existed && newKey !== summary.loadedKey;
        const textChanged =
          ko !== summary.loadedKo.trim() || en !== summary.loadedEn.trim();
        if (newKey !== '' && (keyChanged || textChanged)) {
          // 기존 키 갱신은 스프레드 복사라 제자리를 지키고, 개명은 끝에 붙는다(허용).
          const next = { ...summary.all };
          let changed = false;
          if (keyChanged && summary.loadedKey in next) {
            delete next[summary.loadedKey];
            changed = true;
          }
          if (ko === '') {
            // 비우면 레코드를 지운다 = 사이트에서 이 연구실의 AI 요약 버튼이 사라진다
            if (summary.existed && newKey in next) {
              delete next[newKey];
              changed = true;
            }
          } else {
            // 영어를 비우면 한국어를 복사한다 — pick 의 en 폴백이 `??` 라 빈 문자열은
            // 폴백되지 않아 영문 패널이 통째로 비어 버린다(localizedValue 와 같은 규칙).
            next[newKey] = { ko, en: en === '' ? ko : en };
            changed = true;
          }
          // 파일이 없었으면 sha 가 없다 → 빈 문자열로 넘겨 신규 생성 경로를 탄다
          if (changed) {
            await commitJson(
              config,
              link.file,
              next,
              summary.sha ?? '',
              `content: ${link.label} — ${newKey}`,
            );
          }
        }
      }

      finishSave('저장했습니다 — 곧 사이트에 반영됩니다.');
    } catch (err) {
      handleSaveError(err, '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  // ---- 삭제 ----

  // ⚠️ 삭제는 트레이에 쌓지 않고 확인 즉시 저장한다. 삭제를 배칭하면 대기 중인
  // 다른 변경의 인덱스가 앞으로 밀려 엉뚱한 항목을 지우거나 덮어쓸 수 있다
  // (inlineEdits 의 키가 배열 인덱스다). 같은 이유로 삭제를 확정할 때는 대기 중인
  // 변경을 먼저 버린다 — 아래 모달이 그 사실을 미리 알린다.
  //
  // 연결 파일(동아리 소개 본문·연구실 AI 요약)은 항목을 지워도 **남긴다**. 사이트는
  // 항목이 없으면 그 문안을 읽지 않아 화면상 사라지고, 잘못 지운 항목을 되살릴 때
  // 본문까지 다시 쓰게 하는 편이 더 나쁘다.
  async function handleDelete(index: number) {
    const form = formOf(index);
    // ⚠️ 대기 중인 연대 사진(imageEdits)은 **지우지 않는다** — 키가 배열 인덱스가
    // 아니라 연대라 항목이 밀려도 가리키는 곳이 바뀌지 않는다. 아래 삭제 확인
    // 모달도 같은 이유로 사진 변경을 "함께 사라지는 건수" 에서 뺀다.
    setInlineEdits({});
    setOrderedRaw(null);
    setSaving(true);
    setSaveError(null);
    setSuccess(null);
    try {
      // 저장과 동일하게 로드 시점 배열 + 버전 사용 — 인덱스 어긋남은 버전 충돌로 방어
      const next = raw.slice();
      next.splice(index, 1);
      const payload =
        resource.format === 'record' ? arrayToRecord(next, resource.idField!) : next;
      await commitJson(
        config,
        resource.file,
        payload,
        sha,
        `content: ${resource.label} 삭제 — ${resource.summarize(form)}`,
      );
      finishSave('삭제했습니다 — 곧 사이트에 반영됩니다.');
    } catch (err) {
      handleSaveError(err, '삭제에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  // ---- 목록 인라인 편집 (미저장) ----
  //
  // 목록에서 고친 값은 곧바로 커밋하지 않고 여기 모았다가 "변경 저장"에서 한 번에 올린다.
  // 50명(또는 200과목)을 훑으며 여러 곳을 고치는 흐름이라, 필드마다 커밋하면 커밋이
  // 지저분해지고 느리다.

  /** path = 'email' 또는 localized 의 한쪽 'role.ko'. 값은 문자열 또는 불리언 */
  function patchInline(index: number, path: string, value: InlineValue) {
    setSuccess(null);
    setInlineEdits((prev) => {
      const original = displayRaw[index] as Record<string, unknown> | undefined;
      const nextForIndex: InlinePatch = { ...(prev[index] ?? {}), [path]: value };
      // 원본과 같아졌으면 그 경로는 뺀다 — 안 바뀐 값으로 더티 표시가 남지 않게.
      // 비교는 필드 종류를 아는 readInline 에 맡긴다(null 과 빈 문자열, 불리언의 부재).
      if (isInlineUnchanged(resource.fields, original, path, value)) {
        delete nextForIndex[path];
      }
      const next = { ...prev };
      if (Object.keys(nextForIndex).length === 0) delete next[index];
      else next[index] = nextForIndex;
      return next;
    });
  }

  function resetInlineEdits() {
    setInlineEdits({});
    setSuccess(null);
  }

  /** 곁 파일(연대 사진) 지정·삭제. url='' 이면 삭제다.
   *  값 편집과 같은 규약 — 원본과 같아진 키는 대기 목록에서 뺀다(안 바뀐 값으로
   *  트레이에 칩이 남지 않게). */
  function patchImage(key: string, url: string) {
    setSuccess(null);
    setImageEdits((prev) => {
      const next = { ...prev, [key]: url };
      if ((imageMap.loaded[key] ?? '') === url) delete next[key];
      return next;
    });
  }

  /** 목록에서 고친 값들 + 곁 파일(연대 사진 맵)을 한 번의 저장으로 커밋 */
  async function saveInlineEdits() {
    const indices = Object.keys(inlineEdits).map(Number);
    if (indices.length === 0 && !imagesDirty) return;
    setSaving(true);
    setSaveError(null);
    setSuccess(null);
    try {
      if (indices.length > 0) {
        // 저장 기준은 로드 시점 배열(raw) — 순서 변경과 겹치면 sha 충돌로 방어된다.
        // 직렬화는 전부 applyInlinePatch 가 맡는다(필드 종류별 빈 값 규칙·localized
        // en 폴백·checkbox 키 생략). 여기서 값 모양을 다시 판단하지 않는다.
        const next = raw.slice();
        for (const i of indices) {
          next[i] = applyInlinePatch(
            resource.fields,
            next[i] as Record<string, unknown>,
            inlineEdits[i],
          );
        }
        const payload =
          resource.format === 'record' ? arrayToRecord(next, resource.idField!) : next;
        const names = indices
          .map((i) => resource.summarize(toForm(next[i])) || `#${i + 1}`)
          .slice(0, 3)
          .join(', ');
        const more = indices.length > 3 ? ` 외 ${indices.length - 3}건` : '';
        await commitJson(
          config,
          resource.file,
          payload,
          sha,
          `content: ${resource.label} 수정 — ${names}${more}`,
        );
        setInlineEdits({});
      }

      // 곁 파일은 본 파일 저장 성공 뒤에 이어 붙인다(linkedMarkdown·linkedSummary 와
      // 같은 순서·같은 한계 — 두 파일을 한 트랜잭션으로 묶지 않으므로, 여기서
      // 실패하면 값만 저장되고 사진은 대기 상태로 남는다. 남은 대기는 지우지 않아
      // 사용자가 그대로 다시 저장할 수 있다).
      if (resource.linkedImageMap && imagesDirty) {
        const link = resource.linkedImageMap;
        const nextMap: Record<string, string> = { ...imageMap.loaded };
        for (const [key, url] of Object.entries(imageEdits)) {
          // 빈 값은 키를 지운다 — 사이트는 키가 없는 연대를 "사진 없음" 으로 읽는다
          if (url === '') delete nextMap[key];
          else nextMap[key] = url;
        }
        // 파일이 아직 없으면 sha 가 없다 → 빈 문자열로 넘겨 신규 생성 경로를 탄다
        // (키가 연대 숫자 문자열이라 JSON 직렬화 순서는 자동으로 오름차순이 된다)
        await commitJson(
          config,
          link.file,
          nextMap,
          imageMap.sha ?? '',
          `content: ${resource.label} ${link.label} — ${Object.keys(imageEdits).join(', ')}`,
        );
        setImageEdits({});
      }

      finishSave();
    } catch (err) {
      // 오류 문구는 트레이가 띄운다. 여기서는 409/422 재로드만 하고 다시 던져
      // 트레이가 "실패했으니 변경을 지우지 않는다"를 판단할 수 있게 한다.
      handleSaveError(err, '저장에 실패했습니다.', true);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  // ---- 순서 변경 (로컬) ----

  function move(index: number, dir: -1 | 1) {
    // 값 편집이 대기 중이면 순서를 바꾸지 않는다 — inlineEdits 의 키가 인덱스라
    // 순서가 바뀌면 어느 항목의 편집인지 특정할 수 없게 된다.
    if (cardDirty) return;
    const target = index + dir;
    const cur = orderedRaw ?? raw;
    if (target < 0 || target >= cur.length) return;
    const next = cur.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setSuccess(null);
    setOrderedRaw(next);
  }

  async function saveOrder() {
    if (!orderedRaw) return;
    setSaving(true);
    setSaveError(null);
    setSuccess(null);
    try {
      const payload =
        resource.format === 'record'
          ? arrayToRecord(orderedRaw, resource.idField!)
          : orderedRaw;
      await commitJson(
        config,
        resource.file,
        payload,
        sha,
        `content: ${resource.label} 순서 변경`,
      );
      finishSave();
    } catch (err) {
      handleSaveError(err, '순서 저장에 실패했습니다.', true);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  function resetOrder() {
    setOrderedRaw(null);
  }

  // ---- 렌더 ----

  /**
   * 저장 충돌 안내 — 목록과 폼 양쪽에서 같은 모양으로 뜬다.
   * 폼 저장(handleSubmit)에서도 409 가 나므로 목록 쪽에만 두면 폼에서는 아무 일도
   * 일어나지 않은 것처럼 보인다.
   */
  function renderConflict() {
    if (conflict === null) return null;
    return (
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
          // 대기 변경은 모두 배열 인덱스 기준이라, 최신본을 받으면 그 편집이 어느
          // 항목의 것인지 보장할 수 없다. 그래서 재로드와 함께 반드시 비운다.
          // ⚠️ 폼은 닫지 않는다 — 사용자가 방금 입력한 긴 본문을 잃으면 안 된다.
          //    갱신 대상은 목록 데이터뿐이다.
          setConflict(null);
          setInlineEdits({});
          setOrderedRaw(null);
          // 사진 대기 변경도 함께 비운다 — 재로드가 곁 파일 원본까지 새로 받으므로
          // 옛 원본 기준으로 쌓인 편집을 그 위에 얹으면 무엇이 바뀌는지 알 수 없다.
          setImageEdits({});
          void load();
        }}
        onCancel={() => setConflict(null)}
      />
    );
  }

  if (editing) {
    const isNew = editing.index < 0;
    // 전용 편집기와 기본 폼이 같은 입력을 받는다 — 분기는 "어느 컴포넌트를 그릴까"뿐이다.
    const detailProps: DetailEditorProps = {
      fields: resource.fields,
      initial: editing.form,
      isEdit: !isNew,
      busy: saving,
      onSubmit: handleSubmit,
      onUploadImage: uploadImage,
      onUploadFile: uploadFile,
      onDirty: () => onDirtyChange?.(true),
      onCancel: () => {
        setEditing(null);
        setMd(null);
        setSummary(null);
        setSaveError(null);
      },
      linkedSummary:
        resource.linkedSummary && summary
          ? {
              label: resource.linkedSummary.label,
              hint: resource.linkedSummary.hint,
              ko: summary.ko,
              en: summary.en,
              loading: summary.loading,
              onChangeKo: (v) => setSummary((prev) => (prev ? { ...prev, ko: v } : prev)),
              onChangeEn: (v) => setSummary((prev) => (prev ? { ...prev, en: v } : prev)),
            }
          : null,
    };
    const detailEditor =
      resource.detailView === 'facultyMirror' ? (
        <FacultyDetailEditor {...detailProps} />
      ) : resource.detailView === 'labMirror' ? (
        <LabDetailEditor {...detailProps} />
      ) : resource.detailView === 'popupForm' ? (
        <PopupDetailEditor {...detailProps} />
      ) : null;
    return (
      <div className="anim-panel">
        {/* 팝업 전용 편집기는 머리말(뒤로·제목·취소/저장)을 자기가 그린다 — 헤더의
            '저장'이 편집기 안의 폼 상태·검증을 눌러야 해서, 여기서 그리면 같은
            핸들러를 두 컴포넌트에 나눠 갖게 된다. */}
        {resource.detailView !== 'popupForm' && (
          <CmsPanelHead
            kind="collection"
            title={`${resource.label} · ${isNew ? '새 항목' : '수정'}`}
            description={resource.description}
            actions={
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setMd(null);
                  setSummary(null);
                  setSaveError(null);
                }}
                className="cms-btn cms-btn-sm"
              >
                ← 목록으로
              </button>
            }
          />
        )}
        {saveError && (
          <p role="alert" className="mb-4 border border-[#b42318]/30 bg-[#b42318]/[0.06] px-3.5 py-2.5 text-sm text-[#b42318]">
            {saveError}
          </p>
        )}
        {/* 리소스 전용 '자세히' 편집기 — 사이트에서 이 항목이 보이는 배치를 그대로
            그리고 값 위에서 고친다(목록의 listView 와 같은 취지). props 계약이
            RecordForm 과 같아 저장·업로드·요약 로딩 경로는 그대로 공유한다. */}
        {detailEditor ? (
          detailEditor
        ) : (
        <RecordForm
          fields={resource.fields}
          initial={editing.form}
          isEdit={!isNew}
          busy={saving}
          onSubmit={handleSubmit}
          onUploadImage={uploadImage}
          onCancel={() => {
            setEditing(null);
            setMd(null);
            setSummary(null);
            setSaveError(null);
          }}
          linkedMarkdown={
            resource.linkedMarkdown && md
              ? {
                  label: resource.linkedMarkdown.label,
                  hint: resource.linkedMarkdown.hint,
                  structured: resource.linkedMarkdown.structured,
                  value: md.text,
                  loading: md.loading,
                  onChange: (v) => setMd((prev) => (prev ? { ...prev, text: v } : prev)),
                }
              : null
          }
          linkedSummary={
            resource.linkedSummary && summary
              ? {
                  label: resource.linkedSummary.label,
                  hint: resource.linkedSummary.hint,
                  ko: summary.ko,
                  en: summary.en,
                  loading: summary.loading,
                  onChangeKo: (v) => setSummary((prev) => (prev ? { ...prev, ko: v } : prev)),
                  onChangeEn: (v) => setSummary((prev) => (prev ? { ...prev, en: v } : prev)),
                }
              : null
          }
        />
        )}
        {renderConflict()}
      </div>
    );
  }

  // 목록 화면 서술자와, 모든 인라인 화면이 공유하는 입력 묶음.
  // 화면 컴포넌트는 "무엇을 보여줄까"만 알고, 편집·저장 규칙은 전부 여기에 있다.
  const view = resource.listView;

  // 팝업 공지만 폴백 표를 특수하게 그린다(썸네일·기간 두 줄·상태 배지).
  const isPopups = resource.key === 'popups';
  // 상태 판정 기준 시각은 렌더 한 번에 하나 — 행마다 다시 만들면 같은 표 안에서
  // 경계 시각을 넘나드는 행이 생긴다.
  const nowKst = popupNowKst();

  // 뼈대는 도착할 화면과 같은 모양이어야 의미가 있다 — 표가 올 자리에 카드 뼈대를
  // 깔면 데이터가 들어오는 순간 레이아웃이 통째로 튀어 없느니만 못하다.
  // listView 가 없는 리소스는 폴백 표를 그리므로 'table'.
  const skeletonShape: SkeletonShape = view?.kind ?? 'table';

  const viewProps = {
    resource,
    rows,
    total: displayRaw.length,
    busy: saving,
    locked: orderDirty,
    orderLocked: cardDirty,
    invalidPaths,
    // 검색 중에는 순서를 옮기지 않는다 — 화면에 안 보이는 이웃과 자리를 바꾸면
    // 무엇이 어디로 갔는지 확인할 방법이 없다.
    orderable: resource.orderable && search.trim() === '',
    dirtyIndices,
    search,
    onSearch: setSearch,
    onEditDetail: (i: number) => void startEdit(i),
    onDelete: (i: number) => setDeleting(i),
    onMove: move,
    onPatch: patchInline,
  };

  return (
    <div className="anim-panel">
      <CmsPanelHead
        kind="collection"
        title={resource.label}
        description={resource.description}
        // 수집이 도는 동안 제목 아래 룰이 진행 바를 겸한다(패널을 닫아도 남는 표시)
        progress={showCrawl ? crawl.progress : null}
        actions={
          <>
            {/* 교수진에만 붙는 자동 수집 — 교원정보시스템에서 실적을 받아 프로필 파일에
                병합한다. 교수 카드가 다루는 faculty-directory 와는 **다른 파일**
                (faculty-profiles/<이름>.json)을 건드리므로 트레이(값 patch → 일괄 저장)와
                섞이지 않는다. 다만 이 화면이 저장 중일 때는 시작을 막아 둔다 — 담당자가
                두 저장을 동시에 지켜보지 않아도 되게. */}
            {showCrawl && <FacultyCrawlButton crawl={crawl} disabled={loading || saving} />}
            <button
              type="button"
              onClick={startNew}
              disabled={loading || saving || orderDirty}
              className="cms-btn cms-btn-primary cms-btn-sm"
            >
              + 새 항목
            </button>
          </>
        }
      />

      {showCrawl && <FacultyCrawlDrawer crawl={crawl} />}

      {success && <CommitBanner message={success.message} url={success.url} />}

      {listError && (
        <p role="alert" className="mb-3 border border-[#b42318]/30 bg-[#b42318]/[0.06] px-3.5 py-2.5 text-sm text-[#b42318]">
          {listError}
        </p>
      )}
      {saveError && !loading && (
        <p role="alert" className="mb-3 border border-[#b42318]/30 bg-[#b42318]/[0.06] px-3.5 py-2.5 text-sm text-[#b42318]">
          {saveError}
        </p>
      )}

      {/* 저장·되돌리기 버튼은 하단 변경 트레이가 맡는다. 여기 남는 것은 트레이가
          대신 말해 줄 수 없는 "제약 안내"뿐이다. */}
      {orderDirty && (
        <p className="mb-4 text-xs text-content-faint">
          순서 변경 중에는 항목 추가·수정·삭제가 잠깁니다. 아래 트레이에서 저장하거나 되돌리세요.
        </p>
      )}
      {cardDirty && (
        <p className="mb-4 text-xs text-content-faint">
          수정한 값은 아래 트레이에 모입니다. 저장 전까지 순서 변경은 잠깁니다.
        </p>
      )}
      {/* 왜 저장이 잠겼는지 — 트레이 버튼만 흐려지면 사용자는 이유를 찾지 못한다.
          잠금 판단과 같은 값(saveBlockReason)을 쓰므로 둘이 어긋날 수 없다. */}
      {saveBlockReason && (
        <p role="alert" className="mb-4 text-xs font-semibold text-[#b42318]">
          {saveBlockReason}
        </p>
      )}

      {/* 불러오는 동안에도 화면 제목(CmsPanelHead)은 그대로 둔다 — 어느 화면을 여는
          중인지는 사용자가 방금 눌러서 이미 알고 있다. 제목까지 뼈대로 바꾸면
          "무엇이 로딩 중인지"를 오히려 잃는다. 흔들리는 것은 목록뿐이어야 한다. */}
      {loading && <CmsSkeleton shape={skeletonShape} />}

      {!loading && !listError && displayRaw.length === 0 && (
        // 팝업은 "하나도 없는 상태"가 비정상이 아니라 평소다 — 만들라고 재촉하는 대신
        // 지우지 않아도 된다는 규칙을 알려 준다.
        <CmsEmptyState
          variant="empty"
          title={isPopups ? '등록된 팝업이 없습니다.' : '아직 항목이 없습니다'}
          body={
            isPopups
              ? '게재가 끝난 팝업은 자동으로 사라지므로 지우지 않아도 됩니다.'
              : `${resource.description} 첫 항목을 만들면 사이트에 바로 반영됩니다.`
          }
          actionLabel="+ 새 항목"
          onAction={startNew}
        />
      )}

      {/* 목록 화면 — 어떤 모양으로 보여줄지는 resource.listView 가 정한다.
          rows 가 0이어도(검색 결과 없음) 화면을 그린다 — 검색창까지 사라지면
          입력을 지울 방법이 없어진다. */}
      {!loading && !listError && displayRaw.length > 0 && (
        <>
          {view?.kind === 'cards' && view.variant === 'faculty' && (
            <FacultyCardsEditor
              {...viewProps}
              inlineKeys={view.inlineKeys}
              filterKey={view.filterKey}
              onUploadPhoto={uploadImage}
            />
          )}
          {view?.kind === 'cards' && view.variant === 'labs' && (
            <LabCardsEditor
              {...viewProps}
              inlineKeys={view.inlineKeys}
              filterKey={view.filterKey}
            />
          )}
          {view?.kind === 'cards' && view.variant === 'clubs' && (
            <ClubRowsEditor {...viewProps} />
          )}
          {/* 메인 이미지 — 가로·세로 두 벌을 나란히 보며 그 자리에서 교체한다.
              업로드 통로는 '자세히' 폼(RecordForm)과 같은 uploadImage 하나다. */}
          {view?.kind === 'cards' && view.variant === 'hero' && (
            <HeroCardsEditor {...viewProps} onUploadImage={uploadImage} />
          )}
          {view?.kind === 'table' && (
            <InlineTable
              {...viewProps}
              inlineKeys={view.inlineKeys}
              filterKeys={view.filterKeys}
              widths={view.widths}
            />
          )}
          {view?.kind === 'expandRows' && (
            <ExpandRowsEditor
              {...viewProps}
              summaryKeys={view.summaryKeys}
              expandKeys={view.expandKeys}
            />
          )}
          {/* 연혁 — 항목 타임라인 + 연대마다 사진 한 장(곁 파일). 사진 편집 묶음은
              linkedImageMap 이 선언돼 있을 때만 넘긴다(없으면 슬롯 없이 그린다). */}
          {view?.kind === 'timeline' && (
            <HistoryTimelineEditor
              {...viewProps}
              dateKey={view.dateKey}
              bodyKey={view.bodyKey}
              decadeImages={
                resource.linkedImageMap
                  ? {
                      spec: resource.linkedImageMap,
                      values: imageValues,
                      dirtyKeys: imageDirtyKeys,
                      onUpload: uploadImage,
                      onPatch: patchImage,
                    }
                  : null
              }
            />
          )}

          {/* 폴백 — listView 가 없는 리소스는 읽기 전용 표 + 수정/삭제 */}
          {!view && (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  aria-label="검색"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={isPopups ? '제목으로 검색' : '검색…'}
                  disabled={orderDirty}
                  className={cn('cms-input-sm w-full', isPopups ? 'sm:w-[320px]' : 'sm:w-[250px]')}
                />
                <span className="ml-auto text-xs tabular-nums text-content-faint">
                  {isPopups && rows.length === displayRaw.length
                    ? `총 ${displayRaw.length}개`
                    : `${rows.length}개 · 총 ${displayRaw.length}개`}
                </span>
              </div>
              {/* 가로 제스처만 Lenis 에서 뺀다 — 사정은 InlineTable 의 같은 래퍼 주석 참고 */}
              <div
                className="overflow-x-auto border-t-2 border-yonsei-navy"
                data-lenis-prevent-horizontal
              >
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      {resource.listColumns.map((c) => (
                        <th
                          key={c.key}
                          scope="col"
                          className="whitespace-nowrap border-b border-surface-border px-2 py-3 text-left text-xs font-bold text-content-faint"
                        >
                          {c.label}
                        </th>
                      ))}
                      <th
                        scope="col"
                        className="whitespace-nowrap border-b border-surface-border px-2 py-3 text-right text-xs font-bold text-content-faint"
                      >
                        {isPopups ? (
                          // 목록 순서에 뜻이 있다는 것은 표만 봐서는 알 수 없다 —
                          // 열 이름에 점선 밑줄을 그어 설명이 있음을 알린다.
                          <span
                            title="목록 순서가 사이트에서 팝업이 나란히 놓이는 순서입니다"
                            className="cursor-help underline decoration-dotted underline-offset-[3px]"
                          >
                            순서·작업
                          </span>
                        ) : (
                          <span className="sr-only">동작</span>
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ index, form }) => (
                      <tr key={index} className="align-top transition-colors hover:bg-surface-soft">
                        {resource.listColumns.map((c, col) => {
                          const val = cellText(form, c.key);
                          // 팝업은 값 하나로 읽히지 않는 칸(썸네일·기간·상태)이 있어
                          // 전용 셀이 먼저 답한다. 답이 없으면(null) 평범한 값 셀.
                          const special = isPopups ? popupListCell(c.key, form, nowKst) : null;
                          // 영상 등 URL 셀은 값 유무만 표시
                          const display =
                            special ??
                            (c.key === 'video' || c.key === 'url' ? (val ? '✓' : '') : val);
                          // 제목 열이 팝업에서는 두 번째 칸이다 — 굵게 하는 기준을
                          // "첫 칸"이 아니라 실제 제목 키로 잡는다.
                          const strong = isPopups ? c.key === 'title' : col === 0;
                          return (
                            <td
                              key={c.key}
                              className={cn(
                                'border-b border-[#f1f4f8] px-2 py-2.5',
                                // 썸네일·기간·상태는 잘리면 안 된다(줄바꿈·이미지)
                                special === null ? 'max-w-[16rem] truncate' : 'whitespace-nowrap',
                                strong ? 'font-semibold text-content' : 'text-content-soft',
                              )}
                            >
                              {display}
                            </td>
                          );
                        })}
                        <td className="whitespace-nowrap border-b border-[#f1f4f8] px-2 py-2 text-right">
                          {resource.orderable && (
                            <MoveButtons
                              index={index}
                              total={displayRaw.length}
                              disabled={saving || search.trim() !== ''}
                              onMove={move}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => startEdit(index)}
                            disabled={saving || orderDirty}
                            className="px-1.5 text-[11px] font-semibold text-yonsei-blue transition-colors hover:text-yonsei-navy disabled:opacity-40"
                          >
                            자세히
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleting(index)}
                            disabled={saving || orderDirty}
                            aria-label="삭제"
                            title="삭제"
                            className="px-1 text-xs font-bold text-[#b42318] transition-opacity hover:opacity-70 disabled:opacity-40"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isPopups && (
                <p className="mt-3 text-xs text-content-faint">
                  노출을 끈 항목은 상태가 <PopupHiddenBadgeInline /> 으로 표시됩니다.
                </p>
              )}
            </>
          )}
        </>
      )}

      {/* 삭제 확인 — window.confirm 대신 콘솔 공용 모달(문구를 두 줄 이상 다듬고
          파괴적 동작을 시각적으로 구분하기 위해) */}
      {deleting !== null && (
        <CmsModal
          title={`${resource.label} 항목을 삭제할까요?`}
          tone="danger"
          confirmLabel="삭제"
          cancelLabel="취소"
          body={
            <>
              <p className="font-semibold text-content">
                {resource.summarize(formOf(deleting))}
              </p>
              <p className="mt-2">삭제는 즉시 저장되어 사이트에 반영되며, 화면에서 되돌릴 수 없습니다.</p>
              {/* 사라지는 것은 **인덱스에 묶인** 대기 변경뿐이다 — 연대 사진은 키가
                  연대라 항목이 밀려도 그대로 남는다(handleDelete 주석 참고) */}
              {indexBoundChanges > 0 && (
                <p className="mt-2 text-[#b42318]">
                  저장 대기 중인 변경 {indexBoundChanges}건은 함께 사라집니다 — 삭제하면 항목
                  위치가 밀려 그 변경을 그대로 적용할 수 없기 때문입니다.
                </p>
              )}
            </>
          }
          onConfirm={() => {
            const index = deleting;
            setDeleting(null);
            void handleDelete(index);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}

      {renderConflict()}
    </div>
  );
}
