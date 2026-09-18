'use client';

// 새 글/수정 공용 편집 폼 — 4단계에서 "전체화면 단일 컬럼"으로 바뀌었다.
//
// 왜 전체화면인가: 글쓰기는 목록을 곁눈질하며 하는 일이 아니다. 좌측 내비와 콘솔
// 상단 바가 함께 떠 있으면 본문 폭이 좁아지고, 편집기 툴바와 사이드바가 시선을
// 나눠 가진다. 그래서 폼이 마운트되는 동안만 셸에 집중 모드를 켜 두고
// (AdminShellContext.setFocusMode), 화면 위쪽에는 폼 자신의 고정 바 하나만 남긴다.
// 사이트 헤더·히어로·푸터는 그대로 둔다 — 콘솔은 별도 앱이 아니라 관리자용
// 세부 페이지라는 원칙은 여기서도 유지된다.
//
// 게시판 종류에 따라 추가 필드(세미나 주최, 행사 기간,
// 뉴스 분류/요약/대표 이미지)를 조건부로 노출한다 — 판정은 전부 BoardMeta 플래그다.
// (한국어 UI 문자열은 내부 운영 도구라 컴포넌트에 직접 둔다.)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { cn, kstDate } from '@/lib/utils';
import { emptyInterview, type BoardMeta, type EditAttachment, type EditInterview } from '@/lib/admin/boards';
// 첨부 크기 표기는 사이트 목록("PDF · 1.2MB")과 같은 함수를 쓴다 — 관리자와 학생이
// 같은 문자열을 보게 해야 "왜 다르게 보이냐"는 문의가 생기지 않는다.
import { formatBytes } from '@/lib/files';
import {
  clearPostDraft,
  clearServerDraft,
  draftAgeLabel,
  newerDraft,
  postDraftKey,
  readPostDraft,
  readServerDraft,
  serverDraftKey,
  writePostDraft,
  writeServerDraft,
  type DraftOrigin,
  type PostDraft,
  type PostEditRecord,
} from '@/lib/admin/post-draft';
import { formatPeriodLabel } from '@/lib/calendar';
import { normalizeCohort } from '@/lib/alumni-interview';
import { UploadCancelledError, type UploadProgress, type UploadProgressHandler } from '@/lib/admin/storage';
// '한국어에서 번역해 채우기'(English 탭) — 제목·본문을 한 번에 초안으로 채운다
import { translate } from '@/lib/admin/translate';
import { useAdminShell } from './AdminShellContext';
import { CmsModal } from './CmsModal';
// PostBodyEditor(v2) — 구형(Froala) 툴바 파리티 + UI Components 스톡 룩.
// 프롭 계약은 구판 RichTextEditor 와 동일(드롭인 스왑, 2026-08-18).
// (목록 화면 BoardEditor.tsx 와 이름이 겹쳐 BoardEditor → PostBodyEditor 로 개명)
import { PostBodyEditor } from './board-editor/PostBodyEditor';
import { TranslateButton } from './TranslateButton';
import { PostPreviewPane } from './PostPreviewPane';

interface Props {
  meta: BoardMeta;
  /** 편집 대상 초기값 */
  initial: PostEditRecord;
  /** 수정 모드면 id 읽기 전용 */
  isEdit: boolean;
  busy: boolean;
  /** 서버가 돌려준 저장 실패 사유 — 상단 바 아래 경고 줄에 함께 표시한다 */
  submitError?: string | null;
  onCancel: () => void;
  onSubmit: (rec: PostEditRecord) => void;
  /** 첨부·이미지 파일을 외부 스토리지에 올리고 URL 을 반환 (config 를 가진 상위가 주입) */
  onUploadFile?: (
    file: File,
    onProgress?: UploadProgressHandler,
    signal?: AbortSignal,
  ) => Promise<string>;
}

// 사이트 공통 입력 문법(BoardFilterBar 와 동일): 각진 흰 필드 + 파랑 포커스 보더
const fieldClass =
  'w-full border border-surface-border bg-surface px-3 py-2 text-[13px] text-content outline-none transition-colors placeholder:text-[#a8b0ba] focus:border-yonsei-blue';

/** 메타 영역의 라벨–입력 한 줄. full 이면 2열 그리드에서 한 줄을 다 쓴다 */
function MetaField({
  label,
  htmlFor,
  full,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  full?: boolean;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('border-b border-[#f1f4f8] py-3', full && 'md:col-span-2')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label
          htmlFor={htmlFor}
          className="w-[74px] shrink-0 text-[12px] font-semibold text-content-faint"
        >
          {label}
        </label>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {hint && <p className="mt-1.5 pl-[86px] text-[11px] leading-relaxed text-yonsei-blue">{hint}</p>}
    </div>
  );
}

/** ISO → 'YYYY-MM-DD HH:MM' (KST) — 학생 제출 공고의 제출 시각 표기 */
function kstStamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** 첨부·이미지 묶음 안의 소제목 */
function DropTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] font-bold text-content">{children}</p>;
}

/** 파일 업로드 대상 — 첨부 트레이(다중) 하나로 통일(2026-08-18, DC식 트레이 개편) */
type UploadTarget = 'pool';

/** 이미지 풀 항목 — 업로드된 사진 (본문 삽입·썸네일 지정의 재료) */
interface PoolItem {
  url: string;
  name: string;
}

/** 첨부 트레이 파생 항목 — 세 출처(기존 썸네일·이미지 풀·첨부파일)를 한 판(체크박스
 *  그리드)으로 합쳐 보여주기 위한 뷰 모델. 데이터 원본은 rec.image/pool/rec.attachments
 *  그대로다(기존 게시물 무손실). key 는 출처+인덱스라 삭제로 인덱스가 밀리면
 *  체크 전체 해제로 정합성을 지킨다. */
interface TrayEntry {
  key: string;
  kind: 'image' | 'file';
  url: string;
  name: string;
  size?: number;
  poolIdx?: number;
  attIdx?: number;
  isThumb: boolean;
}

/** 진행 단계 → 사용자 표시 문구 (uploading 은 실제 퍼센트, 미정이면 호환 모드 전송) */
function uploadLabel(p: UploadProgress): string {
  switch (p.phase) {
    case 'preparing':
      return '준비 중…';
    case 'requesting':
      return '연결 중…';
    case 'uploading':
      return p.percent === undefined ? '전송 중…' : `업로드 ${p.percent}%`;
    case 'done':
      return '완료';
  }
}

/** 확정 퍼센트가 없는 상태(준비·연결·호환 모드 전송)인지 — 진행 바 펄스 표시용 */
function isIndeterminate(p: UploadProgress): boolean {
  return p.phase === 'preparing' || p.phase === 'requesting' || (p.phase === 'uploading' && p.percent === undefined);
}

/** 진행 바 채움 비율 — 확정 퍼센트가 없는 단계는 얇게 깔아 살아있음을 표시 */
function uploadBarWidth(p: UploadProgress): number {
  if (p.phase === 'done') return 100;
  if (p.phase === 'uploading' && p.percent !== undefined) return Math.max(p.percent, 4);
  return 6;
}

export function PostForm({
  meta,
  initial,
  isEdit,
  busy,
  submitError,
  onCancel,
  onSubmit,
  onUploadFile,
}: Props) {
  const { setFocusMode, showToast } = useAdminShell();

  const [rec, setRec] = useState<PostEditRecord>(initial);
  // 게시 예약 체크 — 시각이 이미 있는 글(예약 저장분)을 열면 켜진 채로 시작한다
  const [schedule, setSchedule] = useState(!!initial.time);
  const [error, setError] = useState<string | null>(null);
  // 저장 전 미리보기 — 본문 자리를 그대로 바꿔 끼우는 토글(팝업 아님)
  const [preview, setPreview] = useState(false);
  // 미저장 이탈 확인 모달
  const [confirmLeave, setConfirmLeave] = useState(false);
  // 본문에 안 넣은 사진이 있을 때 저장 직전에 뜨는 확인 — 값은 그 장수(0 이면 안 뜸)
  const [confirmUnused, setConfirmUnused] = useState(0);
  // 파일 업로드 진행 상태(대상 + 단계 + 퍼센트 + 다중 업로드 순번 note)
  const [uploading, setUploading] = useState<
    (UploadProgress & { target: UploadTarget; note?: string }) | null
  >(null);
  const poolInputRef = useRef<HTMLInputElement | null>(null);
  // 문서(비이미지) 첨부용 입력 — 사진과 파일 버튼을 분리(사용자 지정). 분류 자체는
  // MIME 기준(handleTrayPicked)이라 어느 쪽으로 올려도 올바른 자리로 간다.
  const docInputRef = useRef<HTMLInputElement | null>(null);
  // 진행 중 업로드의 취소 컨트롤러 (취소 버튼이 abort)
  const abortRef = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  // 이번 제출이 '게시하기'(검토 대기 → 공개)인가 — handleSubmit 이 submitter 로 정한다
  const publishRef = useRef(false);

  // ── 이미지 풀 + 본문 에디터(Tiptap) 상태 ──
  const [pool, setPool] = useState<PoolItem[]>([]);
  // 트레이 체크 — 파생 목록(trayEntries)의 key 기준. 항목이 밀리는 삭제 뒤엔 전체 해제.
  const [trayChecked, setTrayChecked] = useState<ReadonlySet<string>>(new Set());
  // 위지윅 에디터 인스턴스(ko/en) — 이미지 풀 '본문 삽입'이 명령을 내릴 대상
  const editorsRef = useRef<{ ko: Editor | null; en: Editor | null }>({ ko: null, en: null });
  // 언어 탭 — 열려 있는 탭이 곧 트레이 '본문 삽입'의 대상 에디터다(디자인 개편 2026-08-19).
  // 예전의 lastBodyRef(마지막 포커스 추적)는 탭 구조에선 활성 탭과 항상 같아 제거했다.
  const [lang, setLang] = useState<'ko' | 'en'>('ko');
  // '한국어에서 번역해 채우기' 진행 상태 — 제목(text)·본문(html) 두 번역을 묶는다
  const [translating, setTranslating] = useState(false);

  // 폼이 살아 있는 동안만 집중 모드 — 언마운트 정리를 빠뜨리면 목록으로 돌아와도
  // 사이드바가 영영 사라진다.
  useEffect(() => {
    setFocusMode(true);
    return () => setFocusMode(false);
  }, [setFocusMode]);

  // ── 임시저장(초안) — 이 기기(localStorage) + 서버(/api/admin/drafts) ──
  // 어느 쪽도 게시가 아니다. posts 테이블은 '저장'을 눌렀을 때만 움직인다.
  const draftKey = useMemo(
    () => postDraftKey(meta.key, isEdit ? initial.id : 'new'),
    [meta.key, isEdit, initial.id],
  );
  const srvKey = useMemo(
    () => serverDraftKey(meta.key, isEdit ? initial.id : 'new'),
    [meta.key, isEdit, initial.id],
  );
  const initialJson = useMemo(() => JSON.stringify(initial), [initial]);
  const recJson = JSON.stringify(rec);
  const dirty = recJson !== initialJson;

  // 열 때 발견한 초안 — 이 기기와 서버 중 **더 최신**인 쪽을 제안한다.
  // 내용이 지금 값과 같으면 물을 이유가 없다(막 게시한 글을 다시 열었을 때 등).
  const [foundDraft, setFoundDraft] = useState<{ draft: PostDraft; origin: DraftOrigin } | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    const local = readPostDraft(draftKey);
    // 서버 조회는 실패해도 null 을 돌려주므로(post-draft.ts) 이 then 은 언제나 돈다 —
    // 네트워크가 끊긴 자리에서도 로컬 초안 제안은 그대로 뜬다.
    void readServerDraft(srvKey).then((server) => {
      if (!alive) return;
      const best = newerDraft(local, server);
      if (best && JSON.stringify(best.draft.rec) !== initialJson) setFoundDraft(best);
    });
    // 초안 확인은 폼을 열 때 한 번뿐이다 — 타이핑 중에 다시 물으면 방해가 된다.
    return () => {
      alive = false;
    };
  }, [draftKey, srvKey, initialJson]);

  // ── 자동저장 — 고친 게 있을 때만, 8초 디바운스 ──
  // 상태는 상단 바에 조용한 한 줄로만 알린다. 토스트로 띄우면 글 쓰는 내내 방해가 된다.
  const [savedLabel, setSavedLabel] = useState<string | null>(null);
  // 방금 올린 것과 같은 내용을 다시 올리지 않기 위한 표식(자동저장·수동 임시저장 공용)
  const lastSavedJsonRef = useRef<string | null>(null);

  /** 초안 한 벌을 두 곳에 남긴다. 서버가 실패하면 그 사실을 문구로 밝힌다 */
  const persistDraft = useCallback(
    async (value: PostEditRecord, json: string) => {
      lastSavedJsonRef.current = json;
      writePostDraft(draftKey, value);
      const ok = await writeServerDraft(srvKey, value);
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      setSavedLabel(ok ? `초안 저장됨 ${hh}:${mm}` : `초안 저장됨 ${hh}:${mm} · 이 기기만`);
      return ok;
    },
    [draftKey, srvKey],
  );

  useEffect(() => {
    if (!dirty || recJson === lastSavedJsonRef.current) return;
    const timer = window.setTimeout(() => void persistDraft(rec, recJson), 8000);
    return () => window.clearTimeout(timer);
  }, [rec, recJson, dirty, persistDraft]);

  // 오류가 뜨면 그 자리로 데려간다 — 저장 버튼이 상단 고정 바에 있어서
  // 아래쪽에서 눌렀을 때 "아무 일도 안 일어난 것"처럼 보이기 때문이다.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'center' });
  }, [error]);

  function set<K extends keyof PostEditRecord>(key: K, value: PostEditRecord[K]) {
    setRec((prev) => ({ ...prev, [key]: value }));
  }

  /** 인터뷰 9칸 중 한 칸 — 레코드 안의 중첩 객체라 통째로 새로 만든다.
   *  (blankRecord·rowToEditRecord 가 키를 미리 채워 두므로 ?? 는 방어선일 뿐이다) */
  function setInterview<K extends keyof EditInterview>(key: K, value: string) {
    setRec((prev) => ({
      ...prev,
      interview: { ...(prev.interview ?? emptyInterview()), [key]: value },
    }));
  }
  const iv = rec.interview ?? emptyInterview();

  /** 진행 중 업로드 취소 (취소 버튼) */
  function cancelUpload() {
    abortRef.current?.abort();
  }

  // ── 첨부 트레이(DC식): 파일 첨부 → 체크 → 전체 선택/해제·썸네일 지정·선택 삭제·본문 삽입 ──
  // 대표 이미지 입력란·href 입력란·라벨 편집은 제거(사용자 지정, 2026-08-18) — 전부 자동:
  // 썸네일은 '썸네일 지정'이 rec.image 에 넣고, 첨부 라벨·용량은 파일명·파일에서 온다.

  /** 트레이 파생 목록 — 기존 썸네일(풀에 없을 때만) + 이미지 풀 + 첨부파일 */
  function buildTrayEntries(): TrayEntry[] {
    const entries: TrayEntry[] = [];
    const thumbUrl = rec.image?.trim() ?? '';
    if (thumbUrl && !pool.some((p) => p.url === thumbUrl)) {
      entries.push({ key: 'thumb', kind: 'image', url: thumbUrl, name: '(기존 썸네일)', isThumb: true });
    }
    pool.forEach((p, i) => {
      entries.push({ key: `p${i}`, kind: 'image', url: p.url, name: p.name, poolIdx: i, isThumb: p.url === thumbUrl });
    });
    rec.attachments.forEach((a, i) => {
      if (!a.href?.trim()) return; // 구 UI 의 빈 수동 행은 표시하지 않는다(저장 시엔 유지)
      // 구형 이관 게시물은 사진도 첨부파일로 저장돼 있다 — 확장자가 이미지면
      // 이미지 카드로 취급해 미리보기·썸네일 지정·본문 삽입이 전부 살아난다.
      const isImage = /\.(jpe?g|png|gif|webp|avif|bmp)(\?|$)/i.test(a.href);
      entries.push({
        key: `a${i}`,
        kind: isImage ? 'image' : 'file',
        url: a.href,
        name: a.labelKo || a.href.split('/').pop() || '파일',
        size: a.size,
        attIdx: i,
        isThumb: isImage && a.href === thumbUrl,
      });
    });
    return entries;
  }

  /** 여러 파일을 순차 업로드 — 사진은 이미지 풀로, 문서는 첨부파일로 (중간 취소 시 완료분 유지) */
  async function handleTrayPicked(files: FileList | null) {
    if (!files || files.length === 0 || !onUploadFile) return;
    const list = Array.from(files);
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      for (let i = 0; i < list.length; i += 1) {
        const f = list[i];
        const note = list.length > 1 ? `${i + 1}/${list.length}` : undefined;
        setUploading({ target: 'pool', note, phase: 'preparing' });
        // eslint-disable-next-line no-await-in-loop -- 순차 업로드(진행 표시·취소 단순화)
        const url = await onUploadFile(f, (p) => setUploading({ target: 'pool', note, ...p }), ctrl.signal);
        if (f.type.startsWith('image/')) {
          setPool((prev) => [...prev, { url, name: f.name }]);
        } else {
          // 라벨은 파일명, 용량은 파일에서 — 목록의 "PDF · 1.2MB" 표기 재료
          const att: EditAttachment = { labelKo: f.name, labelEn: f.name, href: url, size: f.size };
          setRec((prev) => ({ ...prev, attachments: [...prev.attachments, att] }));
        }
      }
    } catch (err) {
      if (err instanceof UploadCancelledError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : '파일 업로드에 실패했습니다.');
      }
    } finally {
      abortRef.current = null;
      setUploading(null);
      if (poolInputRef.current) poolInputRef.current.value = '';
      if (docInputRef.current) docInputRef.current.value = '';
    }
  }

  /** 본문 툴바(·드래그·붙여넣기)로 넣는 사진 — 업로드 후 첨부 트레이에도 함께 등록한다.
   *  구판은 툴바 삽입과 하단 '사진 첨부'가 따로 놀아서, 본문에 넣은 사진이 첨부 목록에
   *  없어 썸네일로 지정할 수 없었다. 통합 후에는 넣는 순간 트레이에 카드로 남는다
   *  (본문에서 지워도 첨부로는 남는다 — 지우려면 트레이의 '선택 삭제').
   *  진행 표시는 에디터 자신의 "이미지 업로드 중…"이 맡는다 — 트레이의 uploading
   *  상태·취소 버튼은 건드리지 않는다(하단 '사진 첨부'·'파일 첨부' 전용). */
  async function uploadImageIntoBody(file: File): Promise<string> {
    if (!onUploadFile) throw new Error('업로드를 사용할 수 없습니다.');
    const url = await onUploadFile(file);
    setPool((prev) => (prev.some((p) => p.url === url) ? prev : [...prev, { url, name: file.name }]));
    return url;
  }

  function toggleTray(key: string) {
    setTrayChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** 체크 항목 삭제 — 출처별로 나눠 지운다. 썸네일이던 사진을 지우면 지정도 해제. */
  function removeCheckedTray() {
    const poolIdxs = new Set<number>();
    const attIdxs = new Set<number>();
    let clearThumb = false;
    for (const it of buildTrayEntries()) {
      if (!trayChecked.has(it.key)) continue;
      if (it.key === 'thumb' || it.isThumb) clearThumb = true;
      if (it.poolIdx !== undefined) poolIdxs.add(it.poolIdx);
      if (it.attIdx !== undefined) attIdxs.add(it.attIdx);
    }
    if (poolIdxs.size > 0) setPool((prev) => prev.filter((_, i) => !poolIdxs.has(i)));
    if (attIdxs.size > 0) {
      setRec((prev) => ({ ...prev, attachments: prev.attachments.filter((_, i) => !attIdxs.has(i)) }));
    }
    if (clearThumb) set('image', '');
    setTrayChecked(new Set()); // 인덱스가 밀리므로 전체 해제
  }

  /** 체크한 사진 1장을 대표 이미지(썸네일)로 지정 — rec.image 에 자동 기입 */
  function setThumbnailFromTray() {
    const checked = buildTrayEntries().filter((it) => trayChecked.has(it.key));
    if (checked.length !== 1 || checked[0].kind !== 'image') return;
    set('image', checked[0].url);
  }

  /** 체크한 사진들을 지금 열려 있는 언어 탭의 에디터 커서 위치에 삽입 */
  function insertCheckedIntoBody() {
    const urls = buildTrayEntries()
      .filter((it) => trayChecked.has(it.key) && it.kind === 'image')
      .map((it) => it.url);
    if (urls.length === 0) return;
    const ed = editorsRef.current[lang] ?? editorsRef.current.ko;
    if (!ed) return;
    const chain = ed.chain().focus();
    for (const url of urls) chain.setImage({ src: url });
    chain.run();
  }

  // ── 언어 탭 (디자인 개편 2026-08-19) ──

  function switchLang(next: 'ko' | 'en') {
    setLang(next);
  }

  /** English 탭의 초안 채우기 — 제목·본문을 함께 번역해 넣는다(검토·수정 전제) */
  async function fillEnglishFromKorean() {
    if (!rec.titleKo.trim() && !rec.bodyKo.trim()) {
      setError('먼저 한국어 탭에서 제목이나 본문을 입력하세요.');
      return;
    }
    if (
      (rec.titleEn.trim() || rec.bodyEn.trim()) &&
      !window.confirm('영문 제목·본문을 번역 결과로 덮어씁니다. 계속할까요?')
    ) {
      return;
    }
    setTranslating(true);
    setError(null);
    try {
      if (rec.titleKo.trim()) set('titleEn', await translate(rec.titleKo, 'EN', false));
      // 위지윅 본문은 HTML — 태그 보존 번역(tag_handling). 결과는 en 에디터의
      // value 동기화 효과가 받아 화면에 바로 나타난다.
      if (rec.bodyKo.trim()) set('bodyEn', await translate(rec.bodyKo, 'EN', true));
    } catch (err) {
      setError(err instanceof Error ? err.message : '번역에 실패했습니다.');
    } finally {
      setTranslating(false);
    }
  }

  /** 임시저장 — 게시가 아니다. 이 기기와 서버에 초안 한 벌씩만 남긴다 */
  async function saveDraft() {
    setFoundDraft(null);
    const ok = await persistDraft(rec, recJson);
    showToast(
      ok
        ? '임시저장했습니다 — 다른 기기에서도 이어 쓸 수 있습니다 (게시되지 않습니다)'
        : '임시저장했습니다 (서버 저장 실패 — 이 브라우저에만 보관됩니다)',
    );
  }

  /** ← 목록으로 / 취소 — 고친 게 있으면 한 번 붙잡는다 */
  function requestLeave() {
    if (dirty) setConfirmLeave(true);
    else onCancel();
  }

  /** 이번에 올려 놓고 어느 언어 본문에도 넣지 않은 사진 — 저장 직전 경고용.
   *  - 이미지 풀(이번 편집에서 올린 사진)만 본다. 구형 이관 게시물은 사진이 첨부파일로
   *    저장돼 있어 본문에 없는 게 정상이라, 전부 세면 열 때마다 경고가 뜬다.
   *  - 썸네일로 지정한 사진은 목록 타일이 제자리라 본문에 없어도 정상이므로 뺀다.
   *  - 본문이 없는 게시판(noBody)은 '삽입'이라는 개념 자체가 없어 항상 빈 배열. */
  function unusedImages(): TrayEntry[] {
    if (meta.noBody) return [];
    const html = `${rec.bodyKo}\n${rec.bodyEn}`;
    return buildTrayEntries().filter(
      (it) => it.kind === 'image' && it.poolIdx !== undefined && !it.isThumb && !html.includes(it.url),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // 어느 버튼으로 제출했나 — 검토 대기 패널의 '게시하기'(data-publish)만 공개로 올린다.
    // 입력 칸에서 Enter 로 제출하면 submitter 는 문서 순서상 첫 제출 버튼(상단 바 '저장')이라
    // 게시로 오인되지 않는다. 사진 확인 모달을 거쳐 commit 이 나중에 불려도 이 값을 쓴다.
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    publishRef.current = submitter?.dataset.publish === '1';
    // id/slug 는 자동 부여(작성자 미입력) → 검증 대상 아님
    if (rec.titleKo.trim() === '') {
      setLang('ko'); // 제목은 한국어 탭에 있다 — 에러가 가리키는 곳을 열어 준다
      setError('제목을 입력하세요. 저장하려면 반드시 필요합니다.');
      return;
    }
    if (rec.date.trim() === '') {
      setError('게시일을 입력하세요.');
      return;
    }
    if (showEndDate && rec.endDate && rec.date && rec.endDate < rec.date) {
      setError('종료일은 시작일보다 빠를 수 없습니다.');
      return;
    }
    // 동문 인터뷰 — 이름·소속·학번은 목록 카드의 바이라인을 만드는 값이라 필수다.
    // (서버도 같은 규칙으로 막지만, 여기서 먼저 잡아야 어느 칸이 비었는지 보인다.)
    if (meta.interview) {
      const ivRec = rec.interview;
      if (!ivRec || ivRec.nameKo.trim() === '') {
        setError('동문 이름을 입력하세요 — 목록 카드의 바이라인에 쓰입니다.');
        return;
      }
      if (ivRec.roleKo.trim() === '') {
        setError('소속·직함을 입력하세요 — 목록 카드의 바이라인에 쓰입니다.');
        return;
      }
      if (normalizeCohort(ivRec.cohort) === '') {
        setError('학번(입학년도)을 두 자리 또는 네 자리 숫자로 입력하세요. 예: 05 또는 2005');
        return;
      }
    }
    // 넣으려고 올려 놓고 잊은 사진은 저장 전에 한 번 되묻는다 — 막지는 않는다
    // (첨부로만 남기려는 경우도 있어서). 확인하면 confirmUnused 경유로 다시 들어온다.
    const unused = unusedImages();
    if (unused.length > 0) {
      setConfirmUnused(unused.length);
      return;
    }
    commit();
  }

  /** 검증을 통과한 뒤의 실제 제출 — 경고 모달의 '이대로 저장'도 같은 곳으로 들어온다.
   *  종료일 피커가 숨겨진 상태(동문 '행사' 체크 해제 등)의 잔존값은 비워서 제출한다. */
  function commit() {
    const base = showEndDate ? rec : { ...rec, endDate: '' };
    // '게시하기' = published:true 로 같은 저장 경로를 탄다(따로 API 를 두지 않는다).
    // 게시일은 제출일이 아니라 게시한 날이다 — 날짜가 지났으면 오늘(KST)로 올린다.
    // 관리자가 미래 날짜를 골랐다면 그대로 둔다(= 게시 예약).
    if (publishRef.current) {
      const today = kstDate(new Date().toISOString());
      onSubmit({ ...base, published: true, date: base.date < today ? today : base.date });
    } else {
      onSubmit(base);
    }
  }

  const idLabel = meta.isNews ? 'slug' : 'id';
  // 행사 게시판, 또는 동문에서 '행사'로 체크된 글 → '날짜'를 행사 일정으로 안내(캘린더 연동)
  const dateIsEvent = meta.dateIsEvent || (meta.hasEventFlag && !!rec.isEvent);
  // English 탭 배지 — 영문 제목·본문 중 하나라도 있으면 "작성됨(✓)"
  const enFilled = !!(rec.titleEn.trim() || rec.bodyEn.trim());
  // 종료일 피커 노출: 행사·세미나는 항상, 동문은 '행사' 체크 시에만.
  // 기간 라벨은 수동 입력 대신 시작/종료일로 서버가 자동 생성한다(아래 미리보기와 동일 함수).
  const showEndDate = !!meta.hasDateRange && (!meta.hasEventFlag || !!rec.isEvent);
  const labelPreview = showEndDate && rec.date ? formatPeriodLabel(rec.date, rec.endDate) : null;
  const shownError = error ?? submitError ?? null;

  // ── 게시 예약 ──
  // 공개 시각은 created_at 에 실린다. 그런데 위 showEndDate 가 켜지는 게시판
  // (행사·세미나·일정·동문 행사)은 payloadToRow 가 created_at 에 **행사일**을 넣으므로
  // 그 자리에 "공개 시각"이라는 의미를 겹쳐 놓을 수 없다 — 사이트 게이트도 그런 글은
  // 면제한다(lib/posts.ts 의 isVisibleNow). 그래서 조건이 정확히 showEndDate 의 반대다.
  const canSchedule = !showEndDate;
  const publishAtMs =
    canSchedule && rec.date ? Date.parse(`${rec.date}T${rec.time || '00:00'}:00+09:00`) : NaN;
  const isScheduled = Number.isFinite(publishAtMs) && publishAtMs > Date.now();

  return (
    <form onSubmit={handleSubmit} noValidate className="anim-panel min-h-[70vh] bg-surface">
      {/* ── 상단 고정 바 — 집중 모드에서 사이드바를 대신한다. 콘솔이 독립 전체
             화면이라 화면 맨 위(top-0)에 선다 ── */}
      <div className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-surface-border bg-surface px-6 py-3 lg:px-8">
        <button type="button" onClick={requestLeave} className="cms-btn cms-btn-sm">
          ← 목록으로
        </button>
        <span className="flex min-w-0 items-baseline gap-2.5">
          <strong className="truncate text-sm font-bold text-content">{meta.label}</strong>
          <span className="shrink-0 text-[11px] text-content-faint">{isEdit ? '수정' : '새 글'}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            aria-pressed={preview}
            className={cn('cms-btn cms-btn-sm', preview && 'border-yonsei-blue text-yonsei-blue')}
          >
            {preview ? '편집으로' : '미리보기'}
          </button>
          {/* 자동저장 상태 — 눌러야 알 수 있던 것을 조용히 알려 준다 */}
          {savedLabel && (
            <span className="whitespace-nowrap text-[11px] tabular-nums text-content-faint">
              {savedLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => void saveDraft()}
            title="게시되지 않습니다 — 이 기기와 서버에 초안으로만 보관되어 다른 기기에서 이어 쓸 수 있습니다"
            className="cms-btn cms-btn-sm"
          >
            임시저장
          </button>
          <button type="submit" disabled={busy} className="cms-btn-primary cms-btn-sm">
            {busy ? '저장 중…' : '저장'}
          </button>
        </span>
      </div>

      {/* ── 본문 단일 컬럼 ──
          1152 = 본문 설계 폭 1046(POST_BODY_WIDTH) + 편집 영역 좌우 패딩 40 + 테두리 2 + 폼 좌우 패딩 64(lg:px-8).
          데스크톱에서 편집 캔버스(PostCanvas)가 축소 없이(zoom 1) 공개 화면과 1:1 이 되는 최소 폭이다. */}
      <div className="mx-auto max-w-[1152px] px-6 py-9 pb-24 lg:px-8">
        {/* 검토 대기 — 학생이 직접 제출한 공고(published=false). 확인 뒤 '게시하기'가 곧
            published:true 저장이다(같은 저장 경로). 반려는 따로 두지 않고 삭제로 한다. */}
        {rec.published === false && (
          <div className="anim-panel mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 border border-yonsei-blue bg-yonsei-blue/[0.05] px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-yonsei-blue">
                학생이 제출한 공고입니다
                {rec.submission && (
                  <span className="font-normal text-content">
                    {rec.submission.program && ` · ${rec.submission.program}`}
                    {' · '}
                    {rec.submission.email}
                    {rec.submission.submittedAt && ` · ${kstStamp(rec.submission.submittedAt)} 제출`}
                  </span>
                )}
              </p>
              <p className="mt-1 text-[13px] leading-[1.7] text-content">
                포스터와 제목을 확인한 뒤 ‘게시하기’를 누르면 {meta.label} 게시판에 공개됩니다.
                반려하려면 이 글을 삭제하세요.
              </p>
            </div>
            <button
              type="submit"
              data-publish="1"
              disabled={busy}
              className="cms-btn-primary cms-btn-sm shrink-0"
            >
              {busy ? '게시 중…' : '게시하기'}
            </button>
          </div>
        )}

        {/* 초안 안내 — 쓰다 만 글이 남아 있을 때만 */}
        {foundDraft && (
          <div className="anim-panel mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border border-yonsei-blue/40 bg-yonsei-blue/[0.05] px-4 py-3">
            <p className="min-w-0 flex-1 text-[13px] text-content">
              임시저장된 초안이 있습니다
              <span className="ml-1.5 text-content-faint">
                ({foundDraft.origin === 'server' ? '서버 · 다른 기기 포함' : '이 기기'}
                {draftAgeLabel(foundDraft.draft.savedAt) &&
                  ` · ${draftAgeLabel(foundDraft.draft.savedAt)}`}
                )
              </span>
            </p>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => {
                  setRec(foundDraft.draft.rec);
                  setFoundDraft(null);
                }}
                className="cms-btn cms-btn-sm"
              >
                초안 불러오기
              </button>
              <button
                type="button"
                onClick={() => {
                  // 버리기는 양쪽 모두 — 한쪽만 지우면 다음에 열 때 나머지가 되살아난다
                  clearPostDraft(draftKey);
                  void clearServerDraft(srvKey);
                  setFoundDraft(null);
                }}
                className="cms-btn cms-btn-sm"
              >
                버리기
              </button>
            </span>
          </div>
        )}

        {/* ── 언어 탭 — 디자인 개편(2026-08-19, claude.ai/design 시안 '게시물 글쓰기
               (언어탭)'): ko/en 본문을 세로로 쌓지 않고 탭으로 전환한다. 두 에디터는
               항상 마운트(숨김만) — 인스턴스·undo 히스토리·editorsRef 계약이 유지되고,
               '본문 삽입'은 열려 있는 탭의 에디터로 들어간다. noBody(일정)는
               본문이 없어 탭도 없다 — 영문 제목은 아래 공통 메타에 남는다. */}
        {!meta.noBody && !preview && (
          <div role="tablist" aria-label="언어" className="inline-flex border border-surface-border bg-surface">
            <button
              type="button"
              role="tab"
              aria-selected={lang === 'ko'}
              onClick={() => switchLang('ko')}
              className={cn(
                'flex h-[38px] items-center gap-2 px-[18px] text-[13px] font-bold transition-colors',
                lang === 'ko' ? 'bg-yonsei-navy text-white' : 'bg-surface text-content-faint hover:text-content',
              )}
            >
              한국어
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={lang === 'en'}
              onClick={() => switchLang('en')}
              className={cn(
                'flex h-[38px] items-center gap-2 border-l border-surface-border px-3.5 text-[13px] font-bold transition-colors',
                lang === 'en' ? 'bg-yonsei-navy text-white' : 'bg-surface text-content-faint hover:text-content',
              )}
            >
              English (선택)
              {enFilled ? (
                <span
                  aria-label="영문판 작성됨"
                  className={cn(
                    'px-1.5 py-0.5 text-[11px] font-bold text-white',
                    lang === 'en' ? 'bg-yonsei-sky' : 'bg-yonsei-blue',
                  )}
                >
                  ✓
                </span>
              ) : (
                <span
                  className={cn(
                    'px-1.5 py-0.5 text-[11px] font-semibold',
                    lang === 'en'
                      ? 'bg-white/15 text-white'
                      : 'border border-surface-border bg-surface-soft text-content-faint',
                  )}
                >
                  미작성 (한국어판으로 게시됩니다)
                </span>
              )}
            </button>
          </div>
        )}

        {/* 검증 에러 — 탭과 무관한 공통 자리(영문 탭에서 저장해도 보인다) */}
        {shownError && (
          <p ref={errorRef} role="alert" className="mt-3 text-[12px] font-semibold text-[#b42318]">
            ⚠ {shownError}
          </p>
        )}

        {/* ── 본문 ↔ 미리보기 (같은 자리를 토글로 바꿔 낀다) ── */}
        {preview ? (
          <div className="mt-5">
            <PostPreviewPane meta={meta} rec={rec} />
          </div>
        ) : meta.noBody ? (
          /* 본문 없는 게시판 — 제목 한 줄만(영문 제목은 아래 공통 메타) */
          <input
            type="text"
            value={rec.titleKo}
            onChange={(e) => set('titleKo', e.target.value)}
            placeholder="제목을 입력하세요"
            aria-label="제목 (한국어)"
            aria-invalid={shownError !== null || undefined}
            className="mt-4 w-full border-0 border-b border-surface-border bg-transparent pb-3 text-[30px] font-bold leading-tight tracking-tight text-content outline-none transition-colors placeholder:text-[#a8b0ba] focus:border-yonsei-navy"
          />
        ) : (
          <>
            {/* ── 한국어 탭 — 제목 + 본문 ── */}
            <div className={lang === 'ko' ? 'mt-5' : 'hidden'}>
              <input
                type="text"
                value={rec.titleKo}
                onChange={(e) => set('titleKo', e.target.value)}
                placeholder="제목을 입력하세요"
                aria-label="제목 (한국어)"
                aria-invalid={shownError !== null || undefined}
                className="w-full border-0 border-b border-surface-border bg-transparent pb-3 text-[30px] font-bold leading-tight tracking-tight text-content outline-none transition-colors placeholder:text-[#a8b0ba] focus:border-yonsei-navy"
              />
              <div className="mt-5">
                <p className="mb-1.5 text-[12px] font-semibold text-content-faint">본문 (한국어)</p>
                <PostBodyEditor
                  value={rec.bodyKo}
                  onChange={(html) => set('bodyKo', html)}
                  onUploadImage={onUploadFile ? uploadImageIntoBody : undefined}
                  onEditorReady={(ed) => { editorsRef.current.ko = ed; }}
                  // 원문 모드는 글 단위 설정이라 한/영 에디터가 같은 값을 나눠 쓴다
                  bodyRaw={rec.bodyRaw === true}
                  onBodyRawChange={(v) => set('bodyRaw', v)}
                  placeholder="본문을 입력하세요 — 사진은 끌어다 놓거나 붙여넣어도 됩니다"
                  ariaLabel="본문 (한국어)"
                  // 인터뷰 게시판은 에디터가 인터뷰 프리셋으로 열린다(소제목·Q&A·풀쿼트·
                  // 사진 캡션). 판정은 BoardMeta.interview 하나다.
                  {...(meta.interview ? { preset: 'interview' as const } : {})}
                />
              </div>
            </div>

            {/* ── English 탭 — 안내 · 번역 채우기 · 원문 보기 · 영문 제목 + 본문 ── */}
            <div className={lang === 'en' ? 'mt-5' : 'hidden'}>
              <div className="border border-surface-border bg-surface-soft px-4 py-3.5 text-[13px] leading-[1.75] text-content">
                영어판을 비워두면 영어 페이지에 한국어 내용이 그대로 게시됩니다.
                <br />
                영문 제목을 입력하면 영어판이 검색(hreflang)에 별도로 잡힙니다.
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void fillEnglishFromKorean()}
                  disabled={translating}
                  className="cms-btn cms-btn-sm"
                >
                  {translating ? '번역 중…' : '한국어에서 번역해 채우기'}
                </button>
                <span className="text-[11px] text-content-faint">
                  제목과 본문을 초안으로 채웁니다. 저장 전에 한 번 검토해 주세요.
                </span>
              </div>

              <details className="mt-4 border border-surface-border bg-[#fcfdfe]">
                <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-content-faint">
                  한국어 원문 보기 (읽기 전용)
                </summary>
                <div className="border-t border-surface-border px-4 py-3.5 text-[13px] leading-relaxed text-content-soft">
                  <p className="mb-2 text-[15px] font-bold text-content">{rec.titleKo || '(제목 없음)'}</p>
                  {rec.bodyKo.trim() ? (
                    /* 관리자 본인이 에디터로 만든 HTML — 미리보기(PostPreviewPane)와 같은 취급 */
                    <div
                      className="prose-content prose-wide"
                      dangerouslySetInnerHTML={{ __html: rec.bodyKo }}
                    />
                  ) : (
                    <p className="m-0 text-content-faint">(본문 없음)</p>
                  )}
                </div>
              </details>

              <div className="mt-5">
                <p className="mb-1.5 text-[12px] font-semibold text-content-faint">영문 제목</p>
                <input
                  type="text"
                  value={rec.titleEn}
                  onChange={(e) => set('titleEn', e.target.value)}
                  placeholder="비우면 한국어 제목이 그대로 노출됩니다"
                  aria-label="영문 제목"
                  className="w-full border-0 border-b border-surface-border bg-transparent pb-3 text-[30px] font-bold leading-tight tracking-tight text-content outline-none transition-colors placeholder:text-[#a8b0ba] focus:border-yonsei-navy"
                />
              </div>

              <div className="mt-5">
                <p className="mb-1.5 text-[12px] font-semibold text-content-faint">본문 (English)</p>
                <PostBodyEditor
                  value={rec.bodyEn}
                  onChange={(html) => set('bodyEn', html)}
                  onUploadImage={onUploadFile ? uploadImageIntoBody : undefined}
                  onEditorReady={(ed) => { editorsRef.current.en = ed; }}
                  bodyRaw={rec.bodyRaw === true}
                  onBodyRawChange={(v) => set('bodyRaw', v)}
                  placeholder="English body — 비워두면 저장 시 한국어 값이 복사됩니다"
                  ariaLabel="본문 (English)"
                  {...(meta.interview ? { preset: 'interview' as const } : {})}
                />
              </div>
            </div>
          </>
        )}

        {/* ── 공통 · 언어와 무관 — 메타(게시일·예약·고정 + 게시판별 필드) ── */}
        <p className="mt-8 border-t border-surface-border pt-2.5 font-mono text-[11px] tracking-[.06em] text-content-faint">
          공통 · 언어와 무관
        </p>
        <div className="mt-1 grid gap-x-8 border-b border-surface-border md:grid-cols-2">
          <MetaField
            label={showEndDate ? (dateIsEvent ? '행사 시작일' : '시작일') : '게시일'}
            htmlFor="pf-date"
            hint={dateIsEvent ? '이 날짜로 금주 캘린더(일정)에 표시됩니다.' : undefined}
          >
            <input
              id="pf-date"
              type="date"
              value={rec.date}
              onChange={(e) => set('date', e.target.value)}
              className={fieldClass}
            />
          </MetaField>

          {/* 게시 예약 — 체크했을 때만 시각 입력이 열린다(사용자 지정: 평소엔 즉시
              게시가 기본이라 시각 칸이 상시 보이면 오히려 헷갈린다). 체크를 끄면
              time 을 비워 예전과 완전히 같은 저장 경로(그 날 00:00)로 돌아간다.
              행사류 게시판은 위 canSchedule 주석대로 이 칸 자체가 없다. */}
          {canSchedule && (
            <MetaField
              label="게시 예약"
              htmlFor="pf-schedule"
              hint={
                isScheduled
                  ? '이 시각 전에는 사이트에 보이지 않습니다 (반영까지 10분 남짓 걸릴 수 있습니다).'
                  : undefined
              }
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-content">
                  <input
                    id="pf-schedule"
                    type="checkbox"
                    checked={schedule}
                    onChange={(e) => {
                      setSchedule(e.target.checked);
                      if (!e.target.checked) set('time', '');
                    }}
                  />
                  예약 공개
                </label>
                {schedule && (
                  <input
                    id="pf-time"
                    type="time"
                    value={rec.time ?? ''}
                    onChange={(e) => set('time', e.target.value)}
                    className={cn(fieldClass, 'w-auto')}
                  />
                )}
                <p className="w-full text-[11px] text-content-faint">
                  {schedule
                    ? '위 게시일의 지정 시각에 공개됩니다 (시각을 비우면 그 날 0시).'
                    : '체크하지 않으면 저장 즉시 공개됩니다.'}
                </p>
              </div>
            </MetaField>
          )}

          {/* 영문 제목 — 본문 있는 게시판은 English 탭이 받는다(디자인 개편).
              noBody 는 탭이 없어 여기(공통 메타)가 유일한 입력처다. */}
          {meta.noBody && (
            <MetaField label="영문 제목" htmlFor="pf-title-en">
              <div className="flex items-center gap-2">
                <input
                  id="pf-title-en"
                  type="text"
                  value={rec.titleEn}
                  onChange={(e) => set('titleEn', e.target.value)}
                  placeholder="비우면 한국어 제목이 그대로 노출됩니다"
                  className={fieldClass}
                />
                <TranslateButton source={rec.titleKo} onTranslated={(v) => set('titleEn', v)} />
              </div>
            </MetaField>
          )}

          {/* 목록 고정 — 글 목록을 가진 게시판에만. 일정(noBody)은 목록이
              달력이라 "맨 위"라는 개념이 성립하지 않는다. */}
          {!meta.noBody && (
            <MetaField label="목록 고정" full>
              <label className="flex items-start gap-2.5 text-[13px] text-content">
                <input
                  type="checkbox"
                  checked={!!rec.pinned}
                  onChange={(e) => set('pinned', e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-yonsei-blue"
                />
                <span>
                  <span className="font-semibold">이 글을 목록 최상단에 고정합니다</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-content-faint">
                    고정된 글은 게시판 목록과 홈 등 이 게시판을 읽는 모든 영역에서 맨 위에 옵니다.
                    고정 글이 여럿이면 서로는 최신순입니다.
                  </span>
                </span>
              </label>
            </MetaField>
          )}

          {/* 동문 소식·네트워크: 특정 날짜가 정해진 행사인지 — 체크 시 캘린더 '동문'에 표시 */}
          {meta.hasEventFlag && (
            <MetaField label="행사 여부" full>
              <label className="flex items-start gap-2.5 text-[13px] text-content">
                <input
                  type="checkbox"
                  checked={!!rec.isEvent}
                  onChange={(e) => set('isEvent', e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-yonsei-blue"
                />
                <span>
                  <span className="font-semibold">특정 날짜가 정해진 행사입니다</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-content-faint">
                    체크하면 위 &lsquo;시작일&rsquo;이 행사일이 되어 금주 캘린더(일정)의 <b>동문</b>{' '}
                    카테고리에 표시됩니다. 체크하지 않으면 일반 게시물로 저장되고 캘린더에는 나오지 않습니다.
                  </span>
                </span>
              </label>
            </MetaField>
          )}

          {/* 종료일 — 며칠짜리 일정은 캘린더 피커로 종료일을 고른다(비우면 하루).
              기간 라벨("7/20~7/24")은 저장 시 서버가 ko/en 자동 생성 — 미리보기로 확인만. */}
          {showEndDate && (
            <MetaField
              label="종료일"
              htmlFor="pf-end-date"
              hint={
                labelPreview && labelPreview.ko
                  ? `표시 라벨(자동 생성): ${labelPreview.ko} · EN ${labelPreview.en}`
                  : undefined
              }
            >
              <input
                id="pf-end-date"
                type="date"
                min={rec.date || undefined}
                value={rec.endDate ?? ''}
                onChange={(e) => set('endDate', e.target.value)}
                className={fieldClass}
              />
              <p className="mt-1 text-[11px] text-content-faint">하루 일정이면 비워두세요.</p>
            </MetaField>
          )}

          {/* 주최 (세미나·동문 소식) */}
          {meta.hasHost && (
            <>
              <MetaField label="주최" htmlFor="pf-host-ko">
                <input
                  id="pf-host-ko"
                  type="text"
                  value={rec.hostKo ?? ''}
                  onChange={(e) => set('hostKo', e.target.value)}
                  className={fieldClass}
                />
              </MetaField>
              <MetaField label="주최 (EN)" htmlFor="pf-host-en">
                <div className="flex items-center gap-2">
                  <input
                    id="pf-host-en"
                    type="text"
                    value={rec.hostEn ?? ''}
                    onChange={(e) => set('hostEn', e.target.value)}
                    className={fieldClass}
                  />
                  <TranslateButton source={rec.hostKo ?? ''} onTranslated={(v) => set('hostEn', v)} />
                </div>
              </MetaField>
            </>
          )}

          {/* 뉴스형 — 분류. 선택지는 자료실과 마찬가지로 BoardMeta.categories 가 쥐고
              있고(NEWS_CATEGORIES), 여기서는 그 목록만 그린다. 미분류 옵션은 없다 —
              뉴스는 항상 둘 중 하나에 속하고 기본값은 '일반'이다. */}
          {meta.isNews && meta.categories && (
            <MetaField
              label="분류"
              htmlFor="pf-category"
              hint="뉴스 목록 상단 탭(전체 / 일반 / 성과)을 가르는 값입니다."
            >
              <select
                id="pf-category"
                value={rec.category ?? 'general'}
                onChange={(e) => set('category', e.target.value as PostEditRecord['category'])}
                className={cn(fieldClass, 'cms-select')}
              >
                {meta.categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </MetaField>
          )}

          {/* 뉴스형이 아닌 분류 게시판(자료실) — 선택지는 BoardMeta.categories 가 쥐고
              있으므로 화면은 그 목록만 그린다. 일정(calendarGrid)은 전용 편집기
              (CalendarEditor)가 분류를 따로 다루므로 제외한다 — 지금은 캘린더가
              PostForm 을 아예 쓰지 않지만, 쓰게 되더라도 분류 입력이 두 곳으로
              갈라지지 않게 막아 두는 방어 조건이다. */}
          {!meta.isNews && meta.categories && !meta.calendarGrid && (
            <MetaField
              label="분류"
              htmlFor="pf-category"
              hint="자료실 목록 상단 탭(행정 서식 / 규정·내규)을 가르는 값입니다. 비워 두면 ‘전체’ 탭에만 나옵니다."
            >
              <select
                id="pf-category"
                value={rec.category ?? ''}
                onChange={(e) => set('category', e.target.value)}
                className={cn(fieldClass, 'cms-select')}
              >
                {/* 미분류를 맨 앞에 — 자료실은 분류를 비워 둔 채로 저장할 수 있다 */}
                <option value="">미분류</option>
                {meta.categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </MetaField>
          )}

          {/* ── 인터뷰 정보 (동문 인터뷰) ──
              목록 카드의 바이라인과 상세 페이지 헤더가 **같은 값**을 쓴다 — 그래서
              한 번만 받는다. 이름·소속·학번은 필수(handleSubmit 에서 검증),
              마무리 한 줄은 선택이며 질문·답이 둘 다 있을 때만 화면에 그려진다. */}
          {meta.interview && (
            <>
              <div className="border-b border-[#f1f4f8] py-3 md:col-span-2">
                <p className="text-[12px] font-bold text-content">인터뷰 정보</p>
                <p className="mt-1 text-[11px] leading-relaxed text-content-faint">
                  목록 카드의 바이라인(“김연세 동문 · ○○자동차 책임연구원 · 기계공학과 05학번”)과
                  상세 페이지 헤더에 함께 쓰입니다.
                </p>
              </div>

              <MetaField label="이름" htmlFor="pf-iv-name-ko">
                <input
                  id="pf-iv-name-ko"
                  type="text"
                  value={iv.nameKo}
                  onChange={(e) => setInterview('nameKo', e.target.value)}
                  placeholder="김연세"
                  className={fieldClass}
                />
              </MetaField>
              <MetaField label="이름 (EN)" htmlFor="pf-iv-name-en">
                <div className="flex items-center gap-2">
                  <input
                    id="pf-iv-name-en"
                    type="text"
                    value={iv.nameEn}
                    onChange={(e) => setInterview('nameEn', e.target.value)}
                    placeholder="비우면 한국어 이름이 그대로 노출됩니다"
                    className={fieldClass}
                  />
                  <TranslateButton source={iv.nameKo} onTranslated={(v) => setInterview('nameEn', v)} />
                </div>
              </MetaField>

              <MetaField label="소속·직함" htmlFor="pf-iv-role-ko">
                <input
                  id="pf-iv-role-ko"
                  type="text"
                  value={iv.roleKo}
                  onChange={(e) => setInterview('roleKo', e.target.value)}
                  placeholder="○○자동차 로보틱스랩 책임연구원"
                  className={fieldClass}
                />
              </MetaField>
              <MetaField label="소속 (EN)" htmlFor="pf-iv-role-en">
                <div className="flex items-center gap-2">
                  <input
                    id="pf-iv-role-en"
                    type="text"
                    value={iv.roleEn}
                    onChange={(e) => setInterview('roleEn', e.target.value)}
                    className={fieldClass}
                  />
                  <TranslateButton source={iv.roleKo} onTranslated={(v) => setInterview('roleEn', v)} />
                </div>
              </MetaField>

              <MetaField
                label="학번"
                htmlFor="pf-iv-cohort"
                full
                hint="입학년도입니다. 두 자리로 적으면 저장할 때 네 자리로 고쳐 넣습니다(05 → 2005)."
              >
                <input
                  id="pf-iv-cohort"
                  type="text"
                  inputMode="numeric"
                  value={iv.cohort}
                  onChange={(e) => setInterview('cohort', e.target.value)}
                  placeholder="05 또는 2005"
                  className={cn(fieldClass, 'max-w-[180px]')}
                />
              </MetaField>

              <MetaField
                label="한 줄 질문"
                htmlFor="pf-iv-cq-ko"
                hint="본문 끝의 ‘한 줄로’ 상자입니다(선택). 질문과 답을 둘 다 채워야 그려집니다."
              >
                <input
                  id="pf-iv-cq-ko"
                  type="text"
                  value={iv.closingQKo}
                  onChange={(e) => setInterview('closingQKo', e.target.value)}
                  placeholder="김연세 동문에게 ‘설계’란"
                  className={fieldClass}
                />
              </MetaField>
              <MetaField label="질문 (EN)" htmlFor="pf-iv-cq-en">
                <div className="flex items-center gap-2">
                  <input
                    id="pf-iv-cq-en"
                    type="text"
                    value={iv.closingQEn}
                    onChange={(e) => setInterview('closingQEn', e.target.value)}
                    className={fieldClass}
                  />
                  <TranslateButton
                    source={iv.closingQKo}
                    onTranslated={(v) => setInterview('closingQEn', v)}
                  />
                </div>
              </MetaField>

              <MetaField label="한 줄 답" htmlFor="pf-iv-ca-ko">
                <textarea
                  id="pf-iv-ca-ko"
                  rows={2}
                  value={iv.closingAKo}
                  onChange={(e) => setInterview('closingAKo', e.target.value)}
                  placeholder="“돌아가지 않는 이유를 끝까지 적어 두는 일입니다.”"
                  className={cn(fieldClass, 'resize-y')}
                />
              </MetaField>
              <MetaField label="답 (EN)" htmlFor="pf-iv-ca-en">
                <div className="flex items-start gap-2">
                  <textarea
                    id="pf-iv-ca-en"
                    rows={2}
                    value={iv.closingAEn}
                    onChange={(e) => setInterview('closingAEn', e.target.value)}
                    className={cn(fieldClass, 'resize-y')}
                  />
                  <TranslateButton
                    source={iv.closingAKo}
                    onTranslated={(v) => setInterview('closingAEn', v)}
                  />
                </div>
              </MetaField>
            </>
          )}

          {/* 요약 — 뉴스형은 목록 카드에 2줄로, 자료실(hasExcerpt)은 목록의 제목 아래
              한 줄 설명으로 쓰인다. 본문에서 뽑아 쓸 수 없는 자리라 직접 받는다. */}
          {(meta.isNews || meta.hasExcerpt) && (
            <>
              <MetaField label="요약" htmlFor="pf-excerpt-ko">
                <textarea
                  id="pf-excerpt-ko"
                  rows={2}
                  value={rec.excerptKo ?? ''}
                  onChange={(e) => set('excerptKo', e.target.value)}
                  className={cn(fieldClass, 'resize-y')}
                />
              </MetaField>
              <MetaField label="요약 (EN)" htmlFor="pf-excerpt-en">
                <div className="flex items-start gap-2">
                  <textarea
                    id="pf-excerpt-en"
                    rows={2}
                    value={rec.excerptEn ?? ''}
                    onChange={(e) => set('excerptEn', e.target.value)}
                    className={cn(fieldClass, 'resize-y')}
                  />
                  <TranslateButton source={rec.excerptKo ?? ''} onTranslated={(v) => set('excerptEn', v)} />
                </div>
              </MetaField>
            </>
          )}
        </div>

        {/* ── 첨부 트레이 — 구형 게시판(DC식) 형식 + 디자인 개편(2026-08-19):
              사진은 카드 그리드, 파일(문서)은 리스트로 나눠 보여준다. 체크·버튼
              (전체 선택 | 전체 해제 | 썸네일 지정 | 선택 삭제 | 본문 삽입)은 두 묶음
              공용이고, '본문 삽입'은 지금 열려 있는 언어 탭의 에디터로 들어간다.
              대표 이미지 입력란·href 입력란·라벨 편집은 없다 — 전부 자동 기입
              (썸네일 지정→rec.image, 라벨→파일명). 데이터 원본(rec.image/이미지 풀/
              rec.attachments)은 그대로다. ── */}
        <div className="mt-6 border border-dashed border-surface-border bg-[#fcfdfe] px-5 py-4">
          {onUploadFile && (
            <>
              <input
                ref={poolInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => void handleTrayPicked(e.target.files)}
              />
              {!meta.noBody && (
                <input
                  ref={docInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx"
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(e) => void handleTrayPicked(e.target.files)}
                />
              )}
            </>
          )}
          {/* 트레이 본체 — 파생 목록·체크 통계를 한 번만 계산해 헤더·그리드·리스트에 나눠 쓴다 */}
          {(() => {
            const entries = buildTrayEntries();
            const images = entries.filter((it) => it.kind === 'image');
            const files = entries.filter((it) => it.kind === 'file');
            const checkedImages = images.filter((it) => trayChecked.has(it.key));
            const extOf = (it: TrayEntry) =>
              (it.name.includes('.') ? it.name.split('.').pop()! : it.url.split('.').pop() ?? '')
                .toUpperCase()
                .slice(0, 5) || 'FILE';
            /* 좌측 라벨 컬럼 — '사진'·'파일' 두 줄이 공유하는 기준선. 이 폭이 같아야
               두 첨부 버튼의 좌측 엣지가 세로로 물린다(시안 B 의 유일한 판정 기준). */
            const labelCol = 'flex h-9 w-14 shrink-0 items-baseline gap-1.5 pt-[9px] sm:w-20';
            /* 첨부 버튼 자리 — 버튼이 없는 게시판(안내문으로 대체)에서도 이 행의 높이가
               그대로여야 아래 그리드·리스트가 위아래로 흔들리지 않는다. */
            const slotRow = 'flex h-9 items-center gap-2.5';
            const emptyRow =
              'flex h-8 items-center border border-dashed border-surface-border bg-surface px-2.5 text-[11px] text-content-faint';
            return (
              <>
                {/* 상단 — 제목 · 전체 개수 · 공용 액션 바(두 묶음 공용) */}
                <div className="flex flex-wrap items-center gap-2">
                  <DropTitle>첨부</DropTitle>
                  <span className="text-[12px] tabular-nums text-content-faint">{entries.length}개</span>
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTrayChecked(new Set(entries.map((it) => it.key)))}
                      disabled={entries.length === 0}
                      className="cms-btn cms-btn-sm h-7"
                    >
                      전체 선택
                    </button>
                    <button
                      type="button"
                      onClick={() => setTrayChecked(new Set())}
                      disabled={trayChecked.size === 0}
                      className="cms-btn cms-btn-sm h-7"
                    >
                      전체 해제
                    </button>
                    <button
                      type="button"
                      onClick={setThumbnailFromTray}
                      disabled={!(trayChecked.size === 1 && checkedImages.length === 1)}
                      title="체크한 사진 1장을 목록 썸네일로 지정"
                      className="cms-btn cms-btn-sm h-7"
                    >
                      썸네일 지정
                    </button>
                    <button
                      type="button"
                      onClick={removeCheckedTray}
                      disabled={trayChecked.size === 0}
                      className="cms-btn cms-btn-sm h-7"
                    >
                      선택 삭제
                    </button>
                    {!meta.noBody && (
                      <button
                        type="button"
                        onClick={insertCheckedIntoBody}
                        disabled={checkedImages.length === 0}
                        title="체크한 사진을 본문 커서 위치에 삽입"
                        className="cms-btn-primary cms-btn-sm h-7"
                      >
                        본문 삽입
                      </button>
                    )}
                  </div>
                </div>
                {!meta.noBody && entries.length > 0 && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-content-faint">
                    ‘본문 삽입’은 지금 열려 있는 언어 탭({lang === 'ko' ? '한국어' : 'English'})의 에디터에
                    들어갑니다.
                  </p>
                )}
                <div className="my-3 h-px bg-surface-border" aria-hidden="true" />

                {/* ── 사진 ── */}
                <div className="flex items-start">
                  <div className={labelCol}>
                    <span className="text-[12px] font-bold text-content">사진</span>
                    <span className="text-[12px] tabular-nums text-content-faint">{images.length}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={slotRow}>
                      {/* '사진 첨부'는 모든 게시판에 둔다. 툴바 사진 버튼과 하는 일이 다르다 —
                          툴바는 업로드하고 커서 위치에 바로 넣고(uploadImageIntoBody), 이 버튼은
                          카드 그리드에만 담아 두었다가 '본문 삽입'으로 원하는 때에 넣는다.
                          noBody(일정)는 넣을 에디터가 없어 이 버튼이 유일한 통로다. */}
                      {onUploadFile && (
                        <button
                          type="button"
                          onClick={() => poolInputRef.current?.click()}
                          disabled={uploading !== null}
                          className="cms-btn cms-btn-sm h-7 min-w-[88px]"
                        >
                          사진 첨부
                        </button>
                      )}
                      {!meta.noBody && (
                        <span className="min-w-0 truncate text-[11px] text-content-faint">
                          툴바 사진 버튼은 커서 위치에 바로 넣고, ‘사진 첨부’는 여기 목록에만 담깁니다.
                        </span>
                      )}
                      {uploading && (
                        <span className="ml-auto flex shrink-0 items-center gap-2.5">
                          <span className="text-[11px] font-medium tabular-nums text-yonsei-blue">
                            {uploadLabel(uploading)}
                            {uploading.note ? ` (${uploading.note})` : ''}
                          </span>
                          <button type="button" onClick={cancelUpload} className="cms-btn-danger cms-btn-sm h-7">
                            취소
                          </button>
                        </span>
                      )}
                    </div>
                    {uploading && (
                      <div className="mb-2 h-[3px] w-full overflow-hidden bg-surface-soft" aria-hidden="true">
                        <div
                          className={cn(
                            'h-full bg-yonsei-blue transition-[width] duration-200',
                            isIndeterminate(uploading) && 'animate-pulse',
                          )}
                          style={{ width: `${uploadBarWidth(uploading)}%` }}
                        />
                      </div>
                    )}
                    {images.length === 0 ? (
                      <p className={emptyRow}>아직 담긴 사진이 없습니다.</p>
                    ) : (
                      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                        {images.map((it) => {
                          const checked = trayChecked.has(it.key);
                          return (
                            <li key={it.key}>
                              <label
                                className={cn(
                                  'relative block cursor-pointer border bg-surface transition-colors',
                                  checked
                                    ? 'border-yonsei-blue ring-2 ring-yonsei-blue/40'
                                    : 'border-surface-border hover:border-yonsei-blue/50',
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleTray(it.key)}
                                  className="absolute left-1.5 top-1.5 z-10 h-4 w-4 accent-yonsei-blue"
                                  aria-label={`${it.name} 선택`}
                                />
                                {it.isThumb && (
                                  <span className="absolute right-0 top-0 z-10 bg-yonsei-blue px-1.5 py-0.5 text-[10px] font-bold text-white">
                                    썸네일
                                  </span>
                                )}
                                {/* eslint-disable-next-line @next/next/no-img-element -- 관리자 트레이 미리보기 */}
                                <img src={it.url} alt="" className="h-[72px] w-full object-cover" />
                                <span className="block truncate border-t border-[#eef2f7] px-1.5 py-1 text-[11px] text-content-faint">
                                  {it.name}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                {/* ── 파일(문서) — noBody(일정)는 첨부 개념이 없어 사진만 받는다 ── */}
                {!meta.noBody && (
                  <>
                    <div className="my-3.5 h-px bg-surface-border" aria-hidden="true" />
                    <div className="flex items-start">
                      <div className={labelCol}>
                        <span className="text-[12px] font-bold text-content">파일</span>
                        <span className="text-[12px] tabular-nums text-content-faint">{files.length}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={slotRow}>
                          {onUploadFile && (
                            <button
                              type="button"
                              onClick={() => docInputRef.current?.click()}
                              disabled={uploading !== null}
                              className="cms-btn cms-btn-sm h-7 min-w-[88px]"
                            >
                              파일 첨부
                            </button>
                          )}
                        </div>
                        {files.length === 0 ? (
                          <p className={emptyRow}>첨부된 파일이 없습니다.</p>
                        ) : (
                          <ul className="border border-surface-border bg-surface">
                            {files.map((it) => {
                              const checked = trayChecked.has(it.key);
                              return (
                                <li key={it.key} className="border-b border-[#f1f4f8] last:border-b-0">
                                  <label
                                    className={cn(
                                      'flex cursor-pointer items-center gap-2.5 px-2.5 py-2 transition-colors',
                                      checked ? 'bg-yonsei-blue/[0.06]' : 'hover:bg-surface-soft/60',
                                    )}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleTray(it.key)}
                                      className="h-4 w-4 shrink-0 accent-yonsei-blue"
                                      aria-label={`${it.name} 선택`}
                                    />
                                    <span className="min-w-[36px] shrink-0 bg-[#edf3fa] px-1 py-0.5 text-center text-[10px] font-extrabold tracking-wide text-yonsei-navy">
                                      {extOf(it)}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-[13px] text-content">{it.name}</span>
                                    {it.size ? (
                                      <span className="shrink-0 text-[11px] tabular-nums text-content-faint">
                                        {formatBytes(it.size)}
                                      </span>
                                    ) : null}
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </>
            );
          })()}
        </div>

        {/* ── 하단 — 네이비 2px 룰 위에 취소/저장 반복 + id 캡션 ── */}
        <div className="mt-7 flex flex-wrap items-center gap-3 border-t-2 border-yonsei-navy pt-5">
          <button type="button" onClick={requestLeave} disabled={busy} className="cms-btn">
            취소
          </button>
          <button type="submit" disabled={busy} className="cms-btn-primary px-10">
            {busy ? '저장 중…' : '저장'}
          </button>
          <span className="ml-auto text-[11px] tabular-nums text-content-faint">
            {idLabel} {isEdit ? rec.id : '저장 시 자동 부여'}
          </span>
        </div>
      </div>

      {confirmLeave && (
        <CmsModal
          title="작성 중인 내용이 저장되지 않았습니다"
          body="지금 목록으로 돌아가면 고친 내용이 사라집니다. 남겨 두려면 ‘임시저장’을 먼저 누르세요(게시되지 않고 초안으로만 보관되며, 다른 기기에서 이어 쓸 수 있습니다)."
          confirmLabel="나가기"
          cancelLabel="계속 쓰기"
          tone="danger"
          onConfirm={() => {
            setConfirmLeave(false);
            onCancel();
          }}
          onCancel={() => setConfirmLeave(false)}
        />
      )}

      {confirmUnused > 0 && (
        <CmsModal
          title={`본문에 넣지 않은 사진이 ${confirmUnused}장 있습니다`}
          body="첨부 목록에는 담겼지만 본문 어디에도 들어가지 않은 사진입니다. 본문에 보이게 하려면 목록에서 체크한 뒤 ‘본문 삽입’을 누르세요. 첨부 파일로만 남길 생각이라면 이대로 저장해도 됩니다."
          confirmLabel="이대로 저장"
          cancelLabel="돌아가서 넣기"
          onConfirm={() => {
            setConfirmUnused(0);
            commit();
          }}
          onCancel={() => setConfirmUnused(0)}
        />
      )}
    </form>
  );
}
