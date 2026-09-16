'use client';

// 연구실 '자세히' — 사이트 "연구 > 연구실 목록"에서 **이 연구실 한 행이 보이는 모습
// 그대로**를 그리고, 값을 제자리에서 고친다. 목록은 카드 그리드가 아니라 행 리스트라
// (LabList: grid [minmax(0,1fr) 15rem]) 왼쪽 본문 + 오른쪽 15rem 이미지 배치를 따른다.
//
// 소개 영상은 같은 데이터가 **다른 페이지**(대학원 > 연구실 소개 영상 갤러리)에도
// 실리는 값이라, 행 미러 밖에 따로 두고 미리보기로 "채우면 갤러리에 실린다"를 보여 준다.
// 값은 두 갈래다 — YouTube·Drive **링크**를 붙여넣거나, 여기서 **영상 파일을 올려**
// 그 URL 을 같은 video 필드에 담는다(파일이면 포스터를 자동 캡처해 videoPoster 에).
// (한국어 UI 문자열은 내부 운영 도구라 컴포넌트에 직접 둔다.)

import { useRef, useState } from 'react';
import type { FormRecord } from '@/lib/admin/resources';
import { FIELD_OPTIONS, validateForm } from '@/lib/admin/resources';
import { UploadCancelledError, type UploadProgress } from '@/lib/admin/storage';
import { MAX_VIDEO_UPLOAD_BYTES } from '@/lib/admin/upload-validate';
import { isVideoFileUrl, VIDEO_FILE_EXTENSIONS } from '@/lib/video-url';
import { cn } from '@/lib/utils';
import type { DetailEditorProps } from './DetailEditorTypes';
import { TranslateButton } from './TranslateButton';
import {
  AiSummaryButton,
  MirrorActions,
  MirrorInput,
  MirrorPhoto,
  MirrorSectionHead,
  MirrorSelect,
  MirrorTextArea,
} from './DetailMirrorParts';

function str(form: FormRecord, key: string): string {
  const v = form[key];
  return v == null ? '' : String(v);
}

/** 유튜브 watch/youtu.be 링크에서 썸네일을 만든다. 그 외(구글 드라이브 등)는 null —
 *  미리보기를 못 만들 뿐 저장은 그대로 된다. */
function youtubeThumb(url: string): string | null {
  const s = url.trim();
  if (s === '') return null;
  const m =
    s.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ??
    s.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ??
    s.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/);
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null;
}

/** 영상 업로드 진행 상태 — storage 의 단계에 "포스터 만드는 중"(우리 쪽 작업)을 얹는다 */
type VideoUpload = UploadProgress & { posterizing?: boolean };

/** 진행 단계 → 사용자 표시 문구 (PostForm 의 그 규칙을 이 편집기에도 둔다) */
function uploadLabel(p: VideoUpload): string {
  if (p.posterizing) return '포스터 만드는 중…';
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

/** 확정 퍼센트가 없는 상태(준비·포스터·연결)인지 — 진행 바 펄스 표시용 */
function isIndeterminate(p: VideoUpload): boolean {
  return (
    Boolean(p.posterizing) ||
    p.phase === 'preparing' ||
    p.phase === 'requesting' ||
    (p.phase === 'uploading' && p.percent === undefined)
  );
}

/** 진행 바 채움 비율 — 확정 퍼센트가 없는 단계는 얇게 깔아 살아있음을 표시 */
function uploadBarWidth(p: VideoUpload): number {
  if (p.phase === 'done') return 100;
  if (!p.posterizing && p.phase === 'uploading' && p.percent !== undefined) {
    return Math.max(p.percent, 4);
  }
  return 6;
}

/** 고른 파일이 영상인지 — 브라우저가 .mov·.m4v 에 빈 타입을 주는 일이 잦아 확장자도 본다 */
function looksLikeVideo(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return (VIDEO_FILE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * 영상 파일에서 갤러리 카드에 깔 정지 화면(포스터)을 뽑는다.
 *
 * 첫 프레임은 검은 화면인 경우가 많아 2초(또는 길이의 10%) 지점을 쓴다.
 * ⚠️ 브라우저가 디코드하지 못하는 코덱(예: HEVC .mov)이면 포스터만 못 만들 뿐
 * **업로드는 그대로 진행**되고, 갤러리는 연구실 대표 이미지로 폴백한다.
 * 그래서 이 함수는 절대 throw 하지 않고 실패를 null 로 돌려준다.
 */
function capturePoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;

    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    // 디코드가 영영 안 끝나는 파일도 있다 — 전체 8초로 못을 박는다
    const timer = setTimeout(() => finish(null), 8_000);

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      const d = video.duration;
      video.currentTime = Number.isFinite(d) && d > 0 ? Math.min(2, d * 0.1) : 0.5;
    };
    video.onseeked = () => {
      try {
        const scale = Math.min(1, 1280 / (video.videoWidth || 1280));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round((video.videoWidth || 1280) * scale);
        canvas.height = Math.round((video.videoHeight || 720) * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob), 'image/webp', 0.82);
      } catch {
        finish(null); // 교차 출처·보호 콘텐츠 등으로 캔버스가 오염된 경우
      }
    };
    video.src = url;
  });
}

export function LabDetailEditor({
  fields,
  initial,
  isEdit,
  busy,
  onSubmit,
  onCancel,
  linkedSummary,
  onDirty,
  onUploadImage,
  onUploadFile,
}: DetailEditorProps) {
  const [form, setForm] = useState<FormRecord>(initial);
  const [error, setError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [showInvalid, setShowInvalid] = useState(false);
  const [thumbErr, setThumbErr] = useState(false);
  // ── 영상 파일 업로드 상태 ──
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  // 진행 중 업로드의 취소 컨트롤러 (취소 버튼이 abort)
  const videoAbortRef = useRef<AbortController | null>(null);
  const [videoUp, setVideoUp] = useState<VideoUpload | null>(null);
  const [videoErr, setVideoErr] = useState<string | null>(null);
  // 취소는 실패가 아니라 정상 종료 — 빨간 경고 대신 옅은 안내 한 줄로 구분한다
  const [videoCancelled, setVideoCancelled] = useState(false);
  const [videoDragOver, setVideoDragOver] = useState(false);

  function set(key: string, value: FormRecord[string]) {
    onDirty?.();
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  const text = (key: string) => str(form, key);
  const setText = (key: string) => (v: string) => set(key, v);

  const isInvalid = (key: string) => {
    if (!showInvalid) return false;
    const f = fields.find((x) => x.key === key);
    return Boolean(f?.required) && text(key).trim() === '';
  };

  function handleSubmit() {
    const msg = validateForm(fields, form);
    if (msg) {
      setShowInvalid(true);
      setError(msg);
      return;
    }
    setError(null);
    onSubmit(form);
  }

  const recruiting = form.internRecruiting === true;
  const video = text('video');
  const videoPoster = text('videoPoster');
  const thumb = youtubeThumb(video);
  const isFileVideo = isVideoFileUrl(video);
  const videoBusy = videoUp !== null;

  /** 진행 중 영상 업로드 취소 */
  function cancelVideoUpload() {
    videoAbortRef.current?.abort();
  }

  /**
   * 고른 영상 파일을 올려 video(+videoPoster) 를 채운다.
   *
   * 포스터는 **업로드 전에** 로컬에서 캡처한다 — R2 에 올라간 뒤 다시 받아 그리면
   * 같은 바이트를 두 번 실어 나르게 된다. 포스터 실패는 치명적이지 않아 영상만 저장한다.
   */
  async function handleVideoFile(file: File) {
    setVideoErr(null);
    setVideoCancelled(false);

    if (!looksLikeVideo(file)) {
      setVideoErr('영상 파일(MP4·WebM·MOV)만 올릴 수 있습니다.');
      return;
    }
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setVideoErr('200MB 이하 영상만 올릴 수 있습니다. 해상도를 1080p 이하로 줄여 다시 올려 주세요.');
      return;
    }
    if (!onUploadFile) {
      setVideoErr('업로드를 사용할 수 없습니다.');
      return;
    }

    const controller = new AbortController();
    videoAbortRef.current = controller;
    setVideoUp({ phase: 'preparing' });
    try {
      setVideoUp({ phase: 'preparing', posterizing: true });
      const poster = await capturePoster(file);
      if (controller.signal.aborted) throw new UploadCancelledError();

      const videoUrl = await onUploadFile(file, {
        folder: 'labs',
        onProgress: (p) => setVideoUp(p),
        signal: controller.signal,
      });

      let posterUrl = '';
      if (poster && onUploadImage) {
        setVideoUp({ phase: 'preparing', posterizing: true });
        const stem = file.name.replace(/\.[^.]+$/, '') || 'video';
        posterUrl = await onUploadImage(
          new File([poster], `${stem}-poster.webp`, { type: 'image/webp' }),
          { folder: 'labs' },
        ).catch(() => ''); // 포스터 실패는 영상 저장을 막지 않는다
      }

      set('video', videoUrl);
      set('videoPoster', posterUrl);
      setThumbErr(false);
      setVideoUp({ phase: 'done', percent: 100 });
      setTimeout(() => setVideoUp(null), 1_500);
    } catch (err) {
      setVideoUp(null);
      if (err instanceof UploadCancelledError) setVideoCancelled(true);
      else setVideoErr(err instanceof Error ? err.message : '업로드에 실패했습니다.');
    } finally {
      videoAbortRef.current = null;
    }
  }

  return (
    <div className="anim-panel">
      {/* ── 연구실 목록 행 미러 ── */}
      <MirrorSectionHead
        eyebrow="연구 > 연구실 목록 (행)"
        note="목록에서 이 연구실 한 행이 보이는 모습 그대로입니다."
      />

      <div className="border border-surface-border px-7 py-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10">
          <div className="flex min-w-0 flex-col items-start">
            <MirrorInput
              value={text('nameKo')}
              onChange={setText('nameKo')}
              ariaLabel="연구실명 (한국어)"
              placeholder="연구실명 (한국어)"
              disabled={busy}
              invalid={isInvalid('nameKo')}
              className="-ml-[7px] w-full max-w-[520px] text-[23px] font-bold leading-tight tracking-[-0.01em]"
            />
            <MirrorInput
              value={text('nameEn')}
              onChange={setText('nameEn')}
              ariaLabel="연구실명 (English)"
              placeholder="영문명 없음 — 영문 페이지에 한국어가 노출됩니다"
              disabled={busy}
              className="-ml-[7px] w-full max-w-[520px] text-xs font-medium tracking-wide text-content-faint"
            />

            {/* 인턴 배지 — 사이트의 그 배지 모습 그대로, 인원은 배지 안에서 고친다 */}
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              {recruiting && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ecfdf5] px-3 py-1.5 text-xs font-semibold text-[#047857]">
                  <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-[#10b981]" />
                  학부 인턴 모집 중
                  <span className="inline-flex items-center gap-0.5 text-[#059669]">
                    ·
                    <MirrorInput
                      value={text('internCount')}
                      onChange={setText('internCount')}
                      ariaLabel="모집 인원"
                      placeholder="0"
                      disabled={busy}
                      className="w-[34px] !px-1 !py-px text-right text-xs font-semibold tabular-nums text-[#047857]"
                    />
                    명
                  </span>
                </span>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] font-semibold text-content">
                <input
                  type="checkbox"
                  checked={recruiting}
                  onChange={(e) => set('internRecruiting', e.target.checked)}
                  disabled={busy}
                  className="h-3.5 w-3.5 accent-yonsei-blue"
                />
                배지 표시
              </label>
              <span className="text-[11px] text-content-faint">
                끄면 배지가 사라지고 모집 인원도 저장되지 않습니다
              </span>
            </div>

            {/* 정의 목록 — 사이트의 분야/위치/연락처 dl */}
            <dl className="mt-4 grid w-full max-w-[580px] grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1 text-[13.5px] sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
              <dt className="pt-1.5 font-bold text-content">지도교수</dt>
              <dd className="m-0 min-w-0">
                <MirrorInput
                  value={text('professorKo')}
                  onChange={setText('professorKo')}
                  ariaLabel="지도교수 (한국어)"
                  placeholder="지도교수 (한국어)"
                  disabled={busy}
                  invalid={isInvalid('professorKo')}
                  className="w-full text-[13.5px]"
                />
                <MirrorInput
                  value={text('professorEn')}
                  onChange={setText('professorEn')}
                  ariaLabel="지도교수 (English)"
                  placeholder="Professor (English)"
                  disabled={busy}
                  className="w-full text-[11.5px] text-content-faint"
                />
              </dd>
              <dt className="pt-1.5 font-bold text-content">분야</dt>
              <dd className="m-0 min-w-0">
                <MirrorSelect
                  value={text('field')}
                  onChange={setText('field')}
                  options={FIELD_OPTIONS}
                  emptyLabel="선택…"
                  ariaLabel="연구 분야"
                  disabled={busy}
                  invalid={isInvalid('field')}
                  className="w-full text-[13.5px]"
                />
                <p className="m-0 pl-[7px] text-[11px] text-content-faint">
                  목록 상단 분야 필터가 이 값으로 갈립니다
                </p>
              </dd>
              <dt className="pt-1.5 font-bold text-content">위치</dt>
              <dd className="m-0 min-w-0">
                <MirrorInput
                  value={text('location')}
                  onChange={setText('location')}
                  ariaLabel="위치"
                  placeholder="공학관 N204"
                  disabled={busy}
                  className="w-full text-[13.5px]"
                />
              </dd>
              <dt className="pt-1.5 font-bold text-content">연락처</dt>
              <dd className="m-0 min-w-0">
                <MirrorInput
                  value={text('phone')}
                  onChange={setText('phone')}
                  ariaLabel="전화"
                  placeholder="없음"
                  disabled={busy}
                  className="w-full text-[13.5px] tabular-nums"
                />
              </dd>
            </dl>

            {/* 사이트의 버튼 줄 — AI 요약 토글 + 바로가기(주소를 비우면 사라진다) */}
            <div className="mt-4 flex w-full flex-wrap items-center gap-2">
              <AiSummaryButton
                onClick={() => setAiOpen(!aiOpen)}
                open={aiOpen}
                size="sm"
                disabled={busy}
              />
              {text('url').trim() !== '' && (
                <span className="inline-flex items-center gap-2 border border-surface-border px-3.5 py-2 text-xs font-bold text-content">
                  바로가기
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-3 w-3">
                    <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
              <MirrorInput
                value={text('url')}
                onChange={setText('url')}
                ariaLabel="연구실 홈페이지 URL"
                placeholder="연구실 홈페이지 URL — 비우면 이 버튼이 사라집니다"
                disabled={busy}
                className="min-w-[300px] flex-1 text-[11.5px] text-yonsei-blue"
              />
            </div>
          </div>

          <div className="w-full lg:w-60">
            <MirrorPhoto
              src={text('image')}
              onChange={(url) => set('image', url)}
              onUploadImage={onUploadImage}
              folder="labs"
              disabled={busy}
              ariaLabel="대표 이미지 교체"
              replaceLabel={text('image').trim() === '' ? '이미지 추가' : '이미지 교체'}
              emptyTitle="대표 이미지 없음"
              emptyHint="비우면 기본 이미지 3장을 순환 사용합니다"
              frameClassName="h-40"
              note="목록 오른쪽에 이 크기(15rem)로 잘려 들어갑니다."
            />
          </div>
        </div>

        {/* AI 요약 — 사이트에서 행 아래 전폭으로 펼쳐지는 그 패널 자리 */}
        {aiOpen && linkedSummary && (
          <div className="anim-panel mt-5 border border-l-2 border-surface-border border-l-yonsei-blue bg-surface-soft px-6 py-5">
            <p className="m-0 mb-3.5 flex flex-wrap items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-yonsei-blue">
              AI Research Summary
              <span className="bg-yonsei-blue/10 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider">
                BETA
              </span>
              <span className="ml-1 text-[10px] font-bold normal-case tracking-normal text-content-faint">
                행 아래 전폭으로 펼쳐지는 패널의 문안
              </span>
            </p>
            {linkedSummary.loading ? (
              <p className="text-sm text-content-soft">불러오는 중…</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="m-0 mb-1.5 text-[11.5px] font-bold text-content">
                    요약 (한국어) · 권장 180~230자
                  </p>
                  <MirrorTextArea
                    value={linkedSummary.ko}
                    onChange={(v) => {
                      onDirty?.();
                      linkedSummary.onChangeKo(v);
                    }}
                    ariaLabel="AI 연구요약 (한국어)"
                    disabled={busy}
                    className="w-full border-surface-border text-[13.5px]"
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="m-0 text-[11.5px] font-bold text-content">
                      요약 (English) · 권장 320~420자
                    </p>
                    <TranslateButton
                      source={linkedSummary.ko}
                      onTranslated={(en) => {
                        onDirty?.();
                        linkedSummary.onChangeEn(en);
                      }}
                      disabled={busy}
                    />
                  </div>
                  <MirrorTextArea
                    value={linkedSummary.en}
                    onChange={(v) => {
                      onDirty?.();
                      linkedSummary.onChangeEn(v);
                    }}
                    ariaLabel="AI 연구요약 (English)"
                    disabled={busy}
                    className="w-full border-surface-border text-[13.5px]"
                  />
                </div>
              </div>
            )}
            <p className="mb-0 mt-3 text-[11.5px] text-content-faint">
              비워 두면 이 연구실에는 요약 버튼이 뜨지 않습니다.
            </p>
          </div>
        )}
      </div>

      {/* ── 소개 영상 — 같은 데이터가 다른 페이지(영상 갤러리)에도 실린다 ── */}
      <div className="mt-8">
        <MirrorSectionHead
          eyebrow="대학원 > 연구실 소개 영상"
          note="영상 링크를 넣거나 영상 파일을 올리면 이 연구실이 영상 갤러리에도 함께 실립니다."
        />
        <div className="flex flex-wrap items-start gap-5 border border-surface-border px-5 py-4">
          <div className="min-w-[280px] flex-1">
            <p className="m-0 mb-1 text-xs font-bold text-content">소개 영상 URL</p>
            <MirrorInput
              value={video}
              onChange={(v) => {
                setThumbErr(false);
                set('video', v);
                // 포스터는 업로드한 파일에 딸린 값이다 — 손으로 주소를 바꾸면 함께 버린다
                if (videoPoster.trim() !== '') set('videoPoster', '');
              }}
              ariaLabel="소개 영상 URL"
              placeholder="https://www.youtube.com/watch?v=… 또는 Google Drive 파일 링크"
              disabled={busy || videoBusy}
              className="w-full border-surface-border text-[12.5px]"
            />
            <p className="m-0 mt-1.5 text-[11px] text-content-faint">
              {video.trim() === ''
                ? '비워 두면 이 연구실은 영상 갤러리에 실리지 않습니다.'
                : isFileVideo
                  ? '업로드한 영상 파일입니다 — 갤러리 카드에서 바로 재생됩니다.'
                  : thumb
                    ? '영상 갤러리에 실립니다.'
                    : '갤러리에는 실리지만 썸네일 미리보기는 YouTube 링크만 지원합니다.'}
            </p>

            {/* 링크 대신 파일로 올리는 길 — 올린 URL 은 같은 video 필드에 들어간다 */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                disabled={busy || videoBusy || !onUploadFile}
                className="border border-surface-border bg-surface px-3 py-2 text-xs font-bold text-content transition-colors hover:border-yonsei-blue hover:text-yonsei-blue disabled:opacity-50"
              >
                영상 파일 올리기
              </button>
              {isFileVideo && (
                <button
                  type="button"
                  onClick={() => {
                    setThumbErr(false);
                    setVideoErr(null);
                    setVideoCancelled(false);
                    set('video', '');
                    set('videoPoster', '');
                  }}
                  disabled={busy || videoBusy}
                  className="border border-surface-border bg-surface px-3 py-2 text-xs font-bold text-content-soft transition-colors hover:border-[#b42318] hover:text-[#b42318] disabled:opacity-50"
                >
                  영상 지우기
                </button>
              )}
            </div>
            <p className="m-0 mt-1.5 text-[11px] leading-relaxed text-content-faint">
              MP4(H.264/AAC) 권장 · 200MB 이하 · 1080p 이하. 4MB 를 넘는 파일은 브라우저가
              스토리지로 직접 전송합니다.
            </p>

            {/* 진행 줄 — 무엇을 하는 중인지 + 얼마나 남았는지 + 언제든 중단 */}
            {videoUp && (
              <div className="mt-2.5 flex items-center gap-3">
                <span className="w-[92px] flex-none text-[11px] font-bold tabular-nums text-yonsei-navy">
                  {uploadLabel(videoUp)}
                </span>
                <span className="block h-1 flex-1 bg-surface-border">
                  <span
                    className={cn('block h-full bg-yonsei-blue', isIndeterminate(videoUp) && 'animate-pulse')}
                    style={{ width: `${uploadBarWidth(videoUp)}%` }}
                  />
                </span>
                <button
                  type="button"
                  onClick={cancelVideoUpload}
                  className="flex-none border border-surface-border px-2.5 py-1 text-[11px] font-bold text-content-soft transition-colors hover:border-[#b42318] hover:text-[#b42318]"
                >
                  취소
                </button>
              </div>
            )}
            {videoCancelled && !videoUp && (
              <p className="m-0 mt-1.5 text-[11px] text-content-faint">업로드를 취소했습니다.</p>
            )}
            {videoErr && (
              <p role="alert" className="m-0 mt-1.5 text-[11px] font-semibold text-[#b42318]">
                {videoErr}
              </p>
            )}

            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.webm,.mov,.m4v"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleVideoFile(f);
                // 같은 파일을 다시 고를 수 있도록 값을 비운다
                e.target.value = '';
              }}
            />
          </div>

          <div className="w-[200px] flex-none">
            <div
              className={cn(
                'relative aspect-video w-full overflow-hidden border bg-[#eef1f5] transition-colors',
                videoDragOver ? 'border-yonsei-blue' : 'border-transparent',
              )}
              onDragOver={(e) => {
                if (busy || videoBusy) return;
                e.preventDefault();
                setVideoDragOver(true);
              }}
              onDragLeave={() => setVideoDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setVideoDragOver(false);
                if (busy || videoBusy) return;
                const f = e.dataTransfer.files?.[0];
                if (f) void handleVideoFile(f);
              }}
            >
              {isFileVideo ? (
                // 올린 파일은 여기서 바로 재생해 본다 — 저장 전에 "재생되는지"를
                // 확인할 수 있어야 코덱 문제(HEVC 등)를 사이트가 아니라 여기서 잡는다.
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  src={video}
                  poster={videoPoster || undefined}
                  controls
                  preload="metadata"
                  playsInline
                  className="absolute inset-0 h-full w-full bg-black"
                />
              ) : thumb && !thumbErr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb}
                  alt=""
                  onError={() => setThumbErr(true)}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center border border-dashed border-[#9fb3c8] p-2.5 text-center font-mono text-[10px] leading-relaxed text-[#a8b0ba]">
                  {video.trim() === ''
                    ? 'URL을 넣거나 영상 파일을 끌어다 놓으세요'
                    : '미리보기 없음'}
                </span>
              )}

              {videoUp && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/90 px-4">
                  <span className="text-xs font-bold text-yonsei-navy">{uploadLabel(videoUp)}</span>
                  <span className="block h-1 w-full max-w-[140px] bg-surface-border">
                    <span
                      className={cn(
                        'block h-full bg-yonsei-blue',
                        isIndeterminate(videoUp) && 'animate-pulse',
                      )}
                      style={{ width: `${uploadBarWidth(videoUp)}%` }}
                    />
                  </span>
                </div>
              )}
            </div>
            <p className="m-0 mt-1.5 text-[11px] leading-relaxed text-content-faint">
              {isFileVideo ? '갤러리 카드 미리보기 · 여기서 재생을 확인하세요' : '갤러리 썸네일 미리보기'}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm font-semibold text-[#b42318]">
          {error}
        </p>
      )}
      <MirrorActions busy={busy} onCancel={onCancel} onSubmit={handleSubmit} />
      {!isEdit && (
        <p className="mt-2 text-xs text-content-faint">
          새 연구실을 등록하는 중입니다 — 저장하면 연구실 목록 맨 뒤에 추가됩니다.
        </p>
      )}
    </div>
  );
}
