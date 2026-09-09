// 팝업 크기 편집기의 **배경 캡처 설정** — 관리자 전용 전역 설정 한 벌.
//
// 팝업 항목마다 배경을 올리게 하면 항목을 만들 때마다 같은 캡처를 다시 올려야 하므로
// CMS 전역 파일(content/popup-preview.json) 하나로 둔다. 이 값은 사이트에 나가지
// 않는다 — 관리자가 "학생이 보는 화면 그대로" 폭을 가늠하게 하는 배경일 뿐이다.
//
// width·height 는 그 캡처가 나타내는 **실제 뷰포트(CSS px)** 다. 캡처의 픽셀 크기
// (Retina 2배 등)와 무관하게 프레임의 논리 크기를 뷰포트로 잡아야 팝업 px 가 실제
// 화면의 px 와 같은 뜻이 된다.
//
// (한국어 문자열은 내부 운영 도구의 UI 문구라 모듈에 직접 둔다.)

import { MANAGED_FILES } from './managed-content';
import { commitJson, loadJsonOptional, type RepoConfig } from './content-api';

export interface PopupPreviewDesktop {
  /** 배경 캡처 URL (업로드 결과 또는 저장소의 기본 캡처) */
  image: string;
  /** 캡처가 나타내는 뷰포트 폭(CSS px) */
  width: number;
  /** 캡처가 나타내는 뷰포트 높이(CSS px) */
  height: number;
}

export interface PopupPreviewSettings {
  desktop: PopupPreviewDesktop;
}

export const POPUP_PREVIEW_PATH: string = MANAGED_FILES.popupPreview;

/** 저장소에 함께 들어 있는 기본 캡처(public/img/admin/) — 설정 파일이 없거나
 *  망가졌을 때, 그리고 '기본 배경으로' 를 눌렀을 때의 값이다. */
export const DEFAULT_POPUP_PREVIEW: PopupPreviewSettings = {
  desktop: { image: '/img/admin/popup-preview-desktop.jpg', width: 1440, height: 900 },
};

/** 고를 수 있는 기준 화면 — 가장 좁은 노트북 · 기본 · 큰 모니터 세 벌.
 *  더 늘리지 않는 이유: 폭 판단에 필요한 것은 "좁은 화면에서도 넘치지 않는가" 라서
 *  경계값 몇 개면 충분하고, 목록이 길어지면 고르는 데 시간이 든다. */
export const POPUP_PREVIEW_VIEWPORTS: readonly { width: number; height: number }[] = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/** 뷰포트 값의 허용 범위 — 오타·손편집으로 0 이나 10만 이 들어와도 프레임이
 *  깨지지 않게 자른다(팝업 위치·폭 값과 같은 방어 규칙). */
const VIEWPORT_LIMIT = { min: 320, max: 4096 } as const;

function clampViewport(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(Math.min(VIEWPORT_LIMIT.max, Math.max(VIEWPORT_LIMIT.min, n)));
}

/** 알 수 없는 모양(옛 파일·손편집)은 기본값으로 떨어뜨린다 — 관리자 화면이
 *  통째로 비는 것보다 기본 캡처가 낫다. */
export function normalizePopupPreview(raw: unknown): PopupPreviewSettings {
  const d = (raw as PopupPreviewSettings | null)?.desktop;
  const fallback = DEFAULT_POPUP_PREVIEW.desktop;
  const image = typeof d?.image === 'string' && d.image.trim() !== '' ? d.image.trim() : fallback.image;
  return {
    desktop: {
      image,
      width: clampViewport(d?.width, fallback.width),
      height: clampViewport(d?.height, fallback.height),
    },
  };
}

// content-api 의 cfg 인자는 구 GitHub 커밋 경로의 잔재라 쓰이지 않는다(인증은 서버
// 세션이 한다). 이 위젯은 CollectionEditor 의 config 를 넘겨받을 이유가 없으므로
// 빈 값을 준다 — 시그니처 호환용 자리다.
const NO_CFG: RepoConfig = { token: '', owner: '', repo: '', branch: '' };

const SAVE_MESSAGE = 'chore(cms): 팝업 미리보기 배경 설정';

export interface LoadedPopupPreview {
  settings: PopupPreviewSettings;
  /** 저장에 쓸 행 버전 문자열. 빈 문자열이면 아직 파일이 없다(신규 생성) */
  sha: string;
}

/** 설정을 읽는다. 파일이 없으면(404) 기본값 + 빈 sha — 첫 저장이 신규 생성이 된다. */
export async function loadPopupPreview(): Promise<LoadedPopupPreview> {
  const file = await loadJsonOptional<unknown>(NO_CFG, POPUP_PREVIEW_PATH);
  if (!file) return { settings: DEFAULT_POPUP_PREVIEW, sha: '' };
  return { settings: normalizePopupPreview(file.data), sha: file.sha };
}

/**
 * 설정을 저장하고 새 sha 를 돌려준다.
 *
 * 409(다른 세션이 먼저 저장)면 최신 버전을 다시 읽어 **한 번만** 재시도한다 —
 * 이 파일은 필드를 합칠 것이 없는 전역 설정 한 벌이라, 최신 버전 위에 그대로
 * 덮어쓰는 것이 옳다(항목 편집과 달리 남의 글을 지울 위험이 없다).
 */
export async function savePopupPreview(
  settings: PopupPreviewSettings,
  sha: string,
): Promise<string> {
  try {
    const res = await commitJson(NO_CFG, POPUP_PREVIEW_PATH, settings, sha, SAVE_MESSAGE);
    return res.sha;
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('409')) throw err;
    const fresh = await loadPopupPreview();
    const res = await commitJson(NO_CFG, POPUP_PREVIEW_PATH, settings, fresh.sha, SAVE_MESSAGE);
    return res.sha;
  }
}
