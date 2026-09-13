'use client';

// 전체 콘텐츠 관리 콘솔 셸 (단일 페이지 앱).
// 정적 사이트라 서버 DB가 없어 GitHub Contents API로 content/* 파일을 직접
// 커밋한다("Git이 곧 DB"). 이 셸은 사이드바 + 라우팅만 담당하고,
// 대시보드는 AdminDashboard, 실제 편집은 항목 종류별 에디터
// (BoardEditor / CollectionEditor / MarkdownEditor)에 위임한다.
//
// 콘솔은 사이트 헤더·히어로·푸터 없이 독립 전체 화면으로 선다(빌더형 레이아웃,
// 헤더·푸터는 레이아웃의 HeaderChrome·SiteChrome 이 이 경로에서 감춘다). 페이지가
// 통째로 스크롤되고, 사이드바는 화면 맨 위(top-0)부터 끝까지 sticky 로 선다.
//
// 데스크톱에는 콘솔 전용 상단 바가 없다 — 저장소·계정·배포 상태·로그아웃은 전부
// 사이드바 하단으로 내렸다. 가로로 긴 바 하나에 세로 공간을 또 내주는 대신 이미
// 자리를 차지한 사이드바에 담는 편이 편집 화면을 넓게 쓴다. 모바일(<lg)에서만
// 드로어를 여는 슬림 바(--cms-bar)를 남긴다 — 거기엔 사이드바가 상주하지 못한다.
//
// 그래서 콘솔의 sticky 기준선은 화면 맨 위다:
// 데스크톱 top-0, 모바일 top-0 + 슬림 바(--cms-bar).
//
// 콘텐츠/코드 분리 원칙은 "사이트 콘텐츠"(content/*)에 적용된다.
// 이 관리자 도구는 내부 운영용이라 한국어 UI 문자열을 컴포넌트에 직접 둔다.

import { signOut } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { type BoardKey } from '@/lib/admin/boards';
import { type RepoConfig } from '@/lib/admin/content-api';
import {
  getMarkdownPage,
  getResource,
  getScreen,
  MENU_GROUPS,
  type MenuEntry,
} from '@/lib/admin/resources';
import { AdminDashboard } from './AdminDashboard';
import {
  AdminShellProvider,
  AdminToast,
  type AdminShellValue,
} from './AdminShellContext';
import { BoardEditor } from './BoardEditor';
import { ChangeTray } from './ChangeTray';
import { ChangeTrayProvider, useChangeTray } from './ChangeTrayContext';
import {
  GROUP_ICONS,
  IcoChevronDown,
  IcoDashboard,
  IcoExternal,
  IcoKakaoMark,
  IcoLogout,
  IcoMenu,
  IcoSearch,
  IcoUsers,
} from './cms-icons';
import { KakaoLinkPopover } from './KakaoLinkPopover';
import { CmsBanner, type CmsBannerData } from './CmsBanner';
import { CmsModal } from './CmsModal';
import { CollectionEditor } from './CollectionEditor';
import { CurriculumMapEditor } from './CurriculumMapEditor';
import {
  ALL_ENTRIES,
  entryDescription,
  entryGroupLabel,
  entryId,
  entryLabel,
  findEntry,
  isEditable,
  pushRecent,
} from './entries';
import { MarkdownEditor } from './MarkdownEditor';
import { UsersEditor } from './UsersEditor';

interface Props {
  /** GitHub OAuth access token (세션에서 주입) — Contents API 커밋에 사용 */
  token: string;
  /** 로그인한 GitHub 계정명 */
  login: string;
  /** 이 계정의 권한 — 관리자만 사용자·권한 화면에 들어갈 수 있다 */
  role: 'admin' | 'editor';
}

/** 로그인한 계정 자신 — 사이드바 계정 블록이 이름·카카오 연결 상태를 여기서 읽는다 */
interface MeInfo {
  name?: string;
  email?: string | null;
  role?: 'admin' | 'editor';
  provider?: string;
  kakaoLinked?: boolean;
}

/** 카카오 연결 후 되돌아올 때 붙는 ?kakao= 값 → 토스트 문구 */
const KAKAO_RESULTS: Record<string, string> = {
  linked: '카카오 계정을 연결했습니다 — 다음부터 카카오로 로그인하세요.',
  conflict: '이미 다른 계정에 연결된 카카오 계정입니다.',
  norow: 'DB에 등록된 계정만 카카오를 연결할 수 있습니다.',
  denied: '카카오 연결이 취소되었거나 실패했습니다.',
  error: '카카오 연결이 취소되었거나 실패했습니다.',
};

// "사이트 보기" — 상대 경로라 콘솔을 연 도메인(실도메인·테스트 도메인·Vercel)의 홈으로 간다.
// 예전엔 Vercel 주소가 박혀 있어 컷오버 뒤 Vercel 을 지우면 죽은 사이트로 갔다.
const SITE_HOME = '/ko';

// 트레이 컨텍스트를 셸 자신도 읽어야 해서(이동 가드가 대기 변경을 봐야 한다)
// Provider 와 본문을 한 겹 나눈다 — Provider 를 렌더하는 컴포넌트는 그 컨텍스트를
// 구독할 수 없기 때문이다.
export function AdminConsole(props: Props) {
  return (
    <ChangeTrayProvider>
      <AdminConsoleBody {...props} />
    </ChangeTrayProvider>
  );
}

function AdminConsoleBody({ token, login, role }: Props) {
  // 저장소 설정은 세션 토큰으로 자동 구성한다(PAT 수동 입력 제거).
  const config = useMemo<RepoConfig>(
    () => ({ token, owner: 'yonsei-mech', repo: 'yonsei-me', branch: 'main' }),
    [token],
  );

  // active: null이면 대시보드, 아니면 선택된 편집 항목
  const [active, setActive] = useState<MenuEntry | null>(null);
  // 사용자·권한 화면은 콘텐츠 항목(MenuEntry)이 아니라 콘솔 자체의 설정이라
  // active 와 섞지 않고 별도 boolean 으로 둔다. 켜져 있으면 본문을 대신 차지한다.
  const [usersOpen, setUsersOpen] = useState(false);
  // dirty: 현재 에디터에 저장되지 않은 편집이 있는지
  const [dirty, setDirty] = useState(false);
  // 미저장 상태에서 이동을 시도한 목적지. 확인 모달의 대상이 된다.
  // (목적지가 null=대시보드일 수 있어 "값 없음"과 구분하려 한 겹 감쌌다)
  const [pending, setPending] = useState<{ next: MenuEntry | null; users: boolean } | null>(null);
  // lg 미만에서 사이드바를 드로어로 연다
  const [navOpen, setNavOpen] = useState(false);

  // 셸 컨텍스트 — 토스트. 값을 바꾸는 쪽은 변경 트레이·각 에디터다.
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => setToast(msg), []);
  const dismissToast = useCallback(() => setToast(null), []);

  // 집중 모드 — 글쓰기 화면(PostForm)이 마운트되는 동안만 참. 켜지면 사이드바와
  // 모바일 슬림 바를 내려 본문을 단일 컬럼으로 비운다. 값을 올리고 내리는
  // 쪽은 폼 자신이라 여기서는 상태만 들고 있는다.
  const [focusMode, setFocusMode] = useState(false);

  // ---- 운영 상태: 오프라인 / 쓰기 권한 없음 / 임시 배너 ----
  // 셋 다 "지금 보고 있는 화면과 무관하게 참인 조건"이라 셸이 들고 상단 한 자리에서
  // 말한다. 에디터마다 따로 감지하면 화면을 옮길 때마다 상태가 초기화된다.

  // ⚠️ navigator.onLine 은 서버에 없다. 초기값을 그걸로 두면 SSR 이 터지거나
  // 하이드레이션이 어긋나므로 항상 true 로 시작하고 마운트 뒤에 실제 값을 읽는다.
  const [online, setOnline] = useState(true);
  // 저장소 쓰기 권한 없음(403) — 커밋을 실제로 시도한 에디터가 실패 응답을 보고 켠다.
  const [writeDenied, setWriteDenied] = useState(false);
  // 화면 쪽이 올려보내는 임시 배너 (오프라인·권한 배너는 아래에서 셸이 직접 만든다)
  const [banner, setBanner] = useState<CmsBannerData | null>(null);
  // 대시보드에서 자동으로 펼쳐 둘 안내 제목 — 권한 배너의 "권한 안내 보기"가 쓴다.
  // 안내로 보내 놓고 사용자가 그 긴 목록에서 항목을 다시 찾게 두면 안내가 무의미하다.
  const [openGuide, setOpenGuide] = useState<string | undefined>(undefined);

  // 로그인한 계정 정보 — 사이드바가 데스크톱·드로어로 두 번 마운트되므로
  // 조회는 셸에서 한 번만 하고 값을 내려 준다(같은 요청이 두 벌 나가지 않게).
  const [me, setMe] = useState<MeInfo | null>(null);
  // 로그아웃 확인 팝업 — /api/auth/signout 의 Auth.js 기본 확인 페이지(무장식 영문
  // 화면)를 콘솔 시각 언어의 CmsModal 로 대체한다(Claude Design 목업 '로그아웃 팝업').
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/admin/users/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MeInfo | null) => {
        if (alive && data) setMe(data);
      })
      // 실패해도 화면은 그대로 쓴다 — 계정 표시는 편집 기능의 전제가 아니다
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 카카오 연결 결과 안내 — 연결 라우트가 ?kakao= 를 달고 콘솔로 돌려보낸다.
  // useSearchParams 는 이 프로젝트에서 정적 생성과 충돌해 쓰지 않는다.
  // 읽은 뒤 쿼리를 지운다: 남아 있으면 새로고침마다 지난 결과를 다시 말한다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('kakao');
    if (!result) return;
    const msg = KAKAO_RESULTS[result];
    if (msg) showToast(msg);
    params.delete('kakao');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [showToast]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // 연결 복구 알림 — 끊긴 동안 저장을 포기하고 기다리던 사용자에게 "이제 된다"를
  // 말해 준다. 첫 마운트에서는 뜨면 안 되므로 "이전에 끊겼던 적이 있는지"를 ref 로
  // 기억한다. (오프라인으로 마운트한 경우에도 online 초기값이 true 라 첫 패스에는
  // 토스트가 뜨지 않고, 실제 값이 반영된 다음 패스에서 비로소 ref 가 선다.)
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    showToast('인터넷 연결이 돌아왔습니다 — 이제 저장할 수 있습니다.');
  }, [online, showToast]);

  // 저장 잠금 사유 — 트레이가 이 문자열을 그대로 사용자에게 보여준다.
  // 우선순위는 배너와 같다(연결이 없으면 권한 여부는 확인조차 할 수 없다).
  const saveBlock = !online
    ? '인터넷 연결이 끊겨 저장할 수 없습니다.'
    : writeDenied
      ? '이 계정은 저장소에 쓸 권한이 없습니다.'
      : null;

  // 트레이의 대기 변경도 "저장 안 된 편집"이다 — 에디터가 onDirtyChange 를 주지
  // 않더라도 트레이에 쌓인 게 있으면 그냥 넘어가면 안 된다.
  const { source: traySource, saving: traySaving, clearTray } = useChangeTray();
  const pendingCount = traySource?.changes.length ?? 0;

  const go = useCallback(
    (next: MenuEntry | null, openUsers = false) => {
      setDirty(false);
      clearTray();
      setActive(next);
      // 다른 메뉴를 고르면 사용자·권한 화면은 닫힌다 — 본문은 언제나 한 화면이다
      setUsersOpen(openUsers);
      setNavOpen(false);
      // 대시보드를 떠나면 "자동으로 펼쳐 둘 안내"는 소임을 다한 것이라 지운다.
      // 목적지가 대시보드(null)일 때는 지우지 않는다 — 그 이동이 바로 안내를
      // 펼치러 가는 길이기 때문이다.
      if (next !== null) setOpenGuide(undefined);
      if (next && isEditable(next)) pushRecent(entryId(next));

      // 현재 화면을 ?screen= 에 반영 — 새로고침해도 이 화면으로 복원되고(아래
      // 마운트 효과), 특정 편집 화면의 딥링크 공유가 가능해진다. pushState 가
      // 아니라 replaceState 인 이유: 뒤로가기가 화면 전환이 되면 미저장 이동
      // 가드(navigate)를 우회하는 경로가 생긴다 — 히스토리는 쌓지 않는다.
      const params = new URLSearchParams(window.location.search);
      const screen = openUsers ? 'users' : next ? entryId(next) : null;
      if (screen) params.set('screen', screen);
      else params.delete('screen');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    },
    [clearTray],
  );

  // 새로고침 복원 — 마운트 때 ?screen= 을 한 번 읽어 그 화면으로 들어간다.
  // useSearchParams 는 이 프로젝트에서 정적 생성과 충돌해 쓰지 않는다(카카오
  // 결과 처리와 같은 이유·같은 패턴). 모르는 ID·placeholder 는 대시보드 유지.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('screen');
    if (!id) return;
    if (id === 'users') {
      if (role === 'admin') go(null, true);
      return;
    }
    const entry = findEntry(id);
    if (entry && isEditable(entry)) go(entry);
    // 마운트 한 번만 — go 는 clearTray 에만 의존해 안정적이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 이동 가드: 편집 중이거나 트레이에 대기 변경이 있으면 모달로 확인한 뒤 전환한다.
  const navigate = useCallback(
    // openUsers=true 는 "사용자·권한 화면으로" — 그 이동도 같은 가드를 타야
    // 편집 중이던 내용이 조용히 사라지지 않는다.
    (next: MenuEntry | null, openUsers = false) => {
      // 커밋 도중 에디터가 언마운트되면 결과를 알 수 없다 — 저장 중에는 붙잡는다.
      if (traySaving) {
        showToast('저장 중입니다. 잠시 후 이동해 주세요.');
        return;
      }
      if (dirty || pendingCount > 0) {
        setPending({ next, users: openUsers });
        return;
      }
      go(next, openUsers);
    },
    [dirty, pendingCount, traySaving, showToast, go],
  );

  // 지금 띄울 배너 하나 — 오프라인 > 권한 없음 > 화면이 올려보낸 배너 순.
  // 여러 개를 쌓지 않는 이유: 배너가 두 줄 세 줄로 늘면 본문을 그만큼 밀어내
  // "잠깐 뜬 알림"이 아니라 레이아웃 변화가 되고, 정작 가장 급한 조건이 묻힌다.
  const activeBanner = useMemo<CmsBannerData | null>(() => {
    if (!online) {
      return {
        id: 'offline',
        tone: 'danger',
        title: '인터넷 연결이 끊겼습니다',
        body: '저장은 연결이 돌아온 뒤에 됩니다.',
        // 연결 상태는 스스로 사라지는 조건이라 닫기를 주지 않는다. 닫아 놓고
        // 저장이 왜 안 되는지 모르게 되는 편이 더 나쁘다.
        dismissible: false,
      };
    }
    if (writeDenied) {
      return {
        id: 'forbidden',
        tone: 'danger',
        title: '이 계정은 저장소에 쓸 권한이 없습니다',
        body: '관리자에게 Write 권한을 요청하세요.',
        dismissible: true,
        action: {
          label: '권한 안내 보기',
          onClick: () => {
            // 안내 항목을 먼저 지정하고 대시보드로 보낸다. 순서가 반대면 이동
            // 가드가 확인 모달을 띄우는 경우 지정이 뒤늦게 씻겨 나간다.
            setOpenGuide('새 관리자 등록');
            navigate(null);
          },
        },
      };
    }
    return banner;
  }, [online, writeDenied, banner, navigate]);

  // 닫기 — 배너를 지우는 게 아니라 그 배너를 띄운 상태를 끈다(오프라인은 닫을 수 없다)
  const dismissBanner = useCallback(() => {
    if (writeDenied) {
      setWriteDenied(false);
      return;
    }
    setBanner(null);
  }, [writeDenied]);

  // 셸 컨텍스트 — 토스트·집중 모드, 화면 안 이동(openEntry),
  // 그리고 운영 상태(온라인·권한·배너·저장 잠금).
  // navigate 를 참조하므로 그 선언 뒤에 둔다(이동 가드를 그대로 물려받기 위함).
  const shell = useMemo<AdminShellValue>(
    () => ({
      config, login, toast, showToast, dismissToast,
      focusMode, setFocusMode, openEntry: navigate,
      online, writeDenied, setWriteDenied, banner, setBanner, saveBlock,
    }),
    [
      config, login, toast, showToast, dismissToast, focusMode, navigate,
      online, writeDenied, banner, saveBlock,
    ],
  );

  // 드로어는 Esc 로도 닫는다(모달과 같은 규칙 — 열린 오버레이는 Esc 로 나간다)
  useEffect(() => {
    if (!navOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setNavOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  const activeId = active ? entryId(active) : null;

  return (
    <AdminShellProvider value={shell}>
      <div className="bg-surface text-content">
        {/* 모바일 슬림 바 — 드로어 손잡이. lg 이상에서는 사이드바가 항상 보이므로
            아예 렌더하지 않는다. 사이트 헤더가 없는 독립 화면이라 화면 맨 위에 선다.
            집중 모드(글쓰기)에서는 폼 자신의 고정 바가 그 자리를 대신한다. */}
        {!focusMode && (
          <div className="sticky top-0 z-30 flex h-[var(--cms-bar)] items-center gap-3 border-b border-surface-border bg-surface px-4 lg:hidden">
            <button
              type="button"
              onClick={() => setNavOpen((v) => !v)}
              aria-expanded={navOpen}
              aria-label="콘텐츠 메뉴 열기"
              className="cms-btn cms-btn-sm shrink-0 px-2"
            >
              <IcoMenu size={16} />
            </button>
            <span className="text-[15px] font-extrabold text-yonsei-navy">기계공학부 CMS</span>
          </div>
        )}

        {/* 운영 상태 배너 — 화면 맨 위(모바일은 슬림 바 아래) 한 자리에 sticky.
            집중 모드(글쓰기)에서도 렌더한다: 긴 글을 쓰는 동안 연결이 끊긴 걸
            모르고 있다가 저장에서 처음 알게 되는 상황이 가장 나쁘다. 다만 그때는
            모바일 슬림 바가 없으므로 그만큼 기준선을 올린다.
            z-[31] 은 사이드바(sticky)보다 위, 드로어 오버레이(z-30/40)와 겹치지 않는 값. */}
        {activeBanner && (
          <div
            className={cn(
              'sticky z-[31]',
              focusMode ? 'top-0' : 'top-[var(--cms-bar)] lg:top-0',
            )}
          >
            <CmsBanner banner={activeBanner} onDismiss={dismissBanner} />
          </div>
        )}

        {/* 사이드바 296→240 (2026-08): 장학금처럼 열 많은 인라인 표가 1280 급 화면에서
            오른쪽이 잘렸다. 메뉴 라벨은 최장 7자(장학생 선발공고)라 240 으로 충분하고,
            본문이 56px 을 돌려받는다. */}
        <div className={cn(!focusMode && 'grid lg:grid-cols-[240px_minmax(0,1fr)]')}>
          {/* 데스크톱 사이드바 — 화면 맨 위부터 끝까지 통째로 채운다(빌더형).
              스크롤은 내비 목록 영역만 지고(로고·검색·하단 유틸리티는 고정),
              data-lenis-prevent 가 없으면 전역 Lenis 부드러운 스크롤이 휠 이벤트를
              가로채 사이드바 안쪽이 스크롤되지 않는다(항목이 화면보다 길다). */}
          {!focusMode && (
            <nav
              aria-label="콘텐츠 선택"
              data-lenis-prevent
              className="sticky top-0 hidden h-[100dvh] flex-col border-r border-surface-border bg-surface lg:flex"
            >
              <SidebarBody
                activeId={activeId}
                isDashboard={active === null && !usersOpen}
                usersOpen={usersOpen}
                showUsers={role === 'admin'}
                onNavigate={navigate}
                login={login}
                me={me}
                onSignOut={() => setConfirmSignOut(true)}
              />
            </nav>
          )}

          {/* 모바일 드로어 — 같은 사이드바를 슬림 바 아래에서 덮어 띄운다 */}
          {navOpen && !focusMode && (
            <>
              <button
                type="button"
                aria-label="메뉴 닫기"
                onClick={() => setNavOpen(false)}
                className="fixed inset-0 z-30 bg-black/30 lg:hidden"
              />
              <nav
                aria-label="콘텐츠 선택"
                data-lenis-prevent
                className="fixed bottom-0 left-0 top-[var(--cms-bar)] z-40 flex w-[300px] flex-col border-r border-surface-border bg-surface lg:hidden"
              >
                <SidebarBody
                  activeId={activeId}
                  isDashboard={active === null && !usersOpen}
                  usersOpen={usersOpen}
                  showUsers={role === 'admin'}
                  onNavigate={navigate}
                  login={login}
                  me={me}
                  onSignOut={() => setConfirmSignOut(true)}
                />
              </nav>
            </>
          )}

          {/* 레이아웃이 이미 <main id="main"> 을 두고 있어 여기서는 div 로 둔다
              (main 중첩은 스크린리더의 랜드마크 탐색을 망가뜨린다).
              아래 pb-36 은 하단 고정 변경 트레이가 덮는 자리다 — 이걸 줄이면
              대기 변경이 있을 때 목록 마지막 항목이 트레이에 가린다.
              집중 모드에서는 트레이가 뜨지 않고 폼이 자기 여백을 직접 잡으므로
              래퍼의 여백을 모두 걷어 전체화면 단일 컬럼으로 둔다. */}
          <div className={cn('min-w-0', !focusMode && 'px-6 py-8 pb-36 lg:px-10')}>
            {usersOpen ? (
              <UsersEditor />
            ) : active === null ? (
              <AdminDashboard onOpen={navigate} openGuide={openGuide} />
            ) : active.type === 'board' ? (
              <BoardEditor
                key={activeId ?? undefined}
                config={config}
                boardKey={active.boardKey as BoardKey}
                onDirtyChange={setDirty}
              />
            ) : active.type === 'collection' ? (
              <CollectionEditor
                key={activeId ?? undefined}
                config={config}
                resource={getResource(active.resourceKey)}
                onDirtyChange={setDirty}
              />
            ) : active.type === 'markdown' ? (
              <MarkdownEditor
                key={activeId ?? undefined}
                config={config}
                page={getMarkdownPage(active.pageKey)}
                onDirtyChange={setDirty}
              />
            ) : active.type === 'screen' ? (
              <CurriculumMapEditor
                key={activeId ?? undefined}
                config={config}
                screen={getScreen(active.screenKey)}
                onDirtyChange={setDirty}
              />
            ) : null}
          </div>
        </div>

        <AdminToast />
        <ChangeTray />

        {/* 카카오 연결 유도 — Claude Design 목업 '시안 B'(우하단 고정 팝오버).
            미연결 계정에만, 계정 기준으로 닫음을 기억한다. 글쓰기 집중 모드에서는
            띄우지 않는다 — 긴 글을 쓰는 화면에 로그인 안내가 떠 있을 이유가 없다. */}
        {!focusMode && me && (
          <KakaoLinkPopover
            account={me.email || login || 'unknown'}
            eligible={me.provider !== 'kakao' && !me.kakaoLinked}
          />
        )}

        {pending && (
          <CmsModal
            title="편집 중인 내용이 저장되지 않았습니다"
            body={
              pendingCount > 0
                ? `지금 이동하면 저장하지 않은 변경 ${pendingCount}건이 사라집니다. 그래도 이동할까요?`
                : '지금 이동하면 저장하지 않은 변경은 사라집니다. 그래도 이동할까요?'
            }
            confirmLabel="이동"
            cancelLabel="여기 머무르기"
            tone="danger"
            onConfirm={() => {
              const { next, users } = pending;
              setPending(null);
              go(next, users);
            }}
            onCancel={() => setPending(null)}
          />
        )}

        {confirmSignOut && (
          <CmsModal
            title="로그아웃할까요?"
            body={
              <>
                콘텐츠 관리 콘솔에서 나갑니다. 저장하지 않은 변경 사항은 사라집니다.
                {(me?.name || me?.email || login) && (
                  <div className="mt-2.5 flex items-baseline gap-2 border border-surface-border bg-surface-soft px-3 py-2.5">
                    <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.18em] text-yonsei-blue">
                      계정
                    </span>
                    <span className="min-w-0 truncate text-[13px] font-semibold text-content">
                      {me?.name || login}
                      {me?.email ? ` · ${me.email}` : ''}
                    </span>
                  </div>
                )}
              </>
            }
            confirmLabel="로그아웃"
            onConfirm={() => {
              setConfirmSignOut(false);
              // 리다이렉트는 우리가 직접 — Auth.js 의 기본 목적지(사인인 페이지)가
              // 아니라 콘솔 전용 로그인 화면으로 보낸다.
              void signOut({ redirect: false }).finally(() => {
                window.location.href = '/ko/contentmanagement/login';
              });
            }}
            onCancel={() => setConfirmSignOut(false)}
          />
        )}
      </div>
    </AdminShellProvider>
  );
}

/** 내비 행 공통 문법 — 대시보드·평평한 그룹·아코디언 부모가 같은 높이로 정렬된다.
 *  행 높이 33px 에 맞춘 비율: 글자 13px · 아이콘 16px · 간격 8px
 *  (아이콘 16 + 좌우 여백 12 + 간격 8 = 라벨이 36px 에서 시작 → 하위 항목 pl-10)
 *
 *  ⚠️ shrink-0 은 필수다. 이 행들은 세로 flex 스크롤 영역의 직계 자식이라,
 *  그룹을 펼쳐 목록이 화면을 넘기는 순간 flex 가 h-[33px] 를 무시하고 글자
 *  높이까지 눌러 버린다(패딩으로 높이를 주던 때는 패딩이 안 줄어 안 보이던 문제). */
const ROW =
  'flex h-[33px] w-full shrink-0 cursor-pointer items-center gap-2 px-3 text-left text-[13px] transition-colors duration-200 ease-out-expo';

/**
 * 사이드바 본문 — 데스크톱 고정 열과 모바일 드로어가 같은 내용을 쓴다.
 *
 * 위에서부터 로고 / 검색 / 내비 목록(유일한 스크롤 영역) / 하단 유틸리티.
 * 검색·아코디언 상태는 여기서만 쓰는 표시 상태라 셸로 올리지 않는다 —
 * 드로어와 데스크톱이 각자 마운트되지만 둘이 동시에 보이는 일이 없어 무해하다.
 */
function SidebarBody({
  activeId,
  isDashboard,
  usersOpen,
  showUsers,
  onNavigate,
  login,
  me,
  onSignOut,
}: {
  activeId: string | null;
  isDashboard: boolean;
  usersOpen: boolean;
  /** 관리자에게만 사용자·권한 항목을 보인다 — 편집자에게는 존재하지 않는 화면이다 */
  showUsers: boolean;
  onNavigate: (entry: MenuEntry | null, openUsers?: boolean) => void;
  login: string;
  me: MeInfo | null;
  /** 로그아웃 아이콘 — 즉시 나가지 않고 셸의 확인 팝업을 연다 */
  onSignOut: () => void;
}) {
  // 카카오 상태 한 줄 — 있으면 이메일 대신 이 문구가 둘째 줄을 차지한다(목업 ②·③)
  const kakaoStatus =
    me?.provider === 'kakao' ? '카카오로 로그인 중' : me?.kakaoLinked ? '카카오 연결됨' : null;
  const [query, setQuery] = useState('');
  // 검색 결과 키보드 커서 (↑↓ 이동, Enter 선택)
  const [cursor, setCursor] = useState(0);
  // 한 번에 한 그룹만 연다 — 전부 펼치면 13개 게시판이 화면을 넘겨 스크롤 없이는
  // 어느 묶음에 있는지조차 보이지 않는다. 기본은 모두 닫힘 — 현재 항목이 속한
  // 그룹이 있을 때만 그 그룹을 펼치고 시작한다.
  const [openGroup, setOpenGroup] = useState<string>(() => groupOf(activeId) ?? '');

  // 사이드바를 거치지 않는 이동(대시보드 카드·배너 안내)으로 현재 항목이 바뀌면
  // 그 그룹을 펼친다. 접힌 그룹 안에 숨으면 "지금 어디에 있는지"가 사라진다.
  useEffect(() => {
    const g = groupOf(activeId);
    if (g) setOpenGroup(g);
  }, [activeId]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return ALL_ENTRIES.filter(
      (e) =>
        isEditable(e) &&
        (entryLabel(e).toLowerCase().includes(q) || entryDescription(e).toLowerCase().includes(q)),
    ).slice(0, 12);
  }, [q]);

  const choose = useCallback(
    (entry: MenuEntry) => {
      setQuery('');
      setCursor(0);
      onNavigate(entry);
    },
    [onNavigate],
  );

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setQuery('');
      setCursor(0);
      return;
    }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[cursor] ?? results[0];
      if (picked) choose(picked);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2.5 px-5 pb-3.5 pt-5">
        <img src="/logo.svg" alt="" className="h-9 w-9" />
        <span className="font-subhead text-xl font-bold tracking-[-0.01em] text-content">
          기계공학부 CMS
        </span>
      </div>

      {/* 검색 — 항목이 30개를 넘어 그룹을 짚어 가며 찾는 것보다 이름으로 부르는 쪽이 빠르다.
          입력의 outline 을 지우는 대신 테두리를 focus-within 으로 켠다(초점 표시 유지). */}
      <div className="mx-4 mb-3 flex items-center gap-2 border border-surface-border bg-surface-soft px-3 py-2 transition-colors duration-200 ease-out-expo focus-within:border-yonsei-blue">
        <IcoSearch size={16} className="shrink-0 text-content-faint" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onSearchKeyDown}
          placeholder="검색"
          aria-label="편집할 항목 검색"
          className="w-full border-none bg-transparent text-sm outline-none placeholder:text-content-faint"
        />
      </div>

      {/* 유일한 스크롤 영역. 검색 중에는 목록 대신 결과를 같은 자리에 그린다 —
          드롭다운으로 띄우면 overflow 를 가진 이 컨테이너가 잘라 버린다. */}
      <div
        data-lenis-prevent
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-4 pb-2"
      >
        {q ? (
          results.length === 0 ? (
            <p className="px-3 py-6 text-[13px] text-content-faint">검색 결과가 없습니다.</p>
          ) : (
            results.map((entry, i) => (
              <button
                key={entryId(entry)}
                type="button"
                onClick={() => choose(entry)}
                onMouseEnter={() => setCursor(i)}
                // ROW 를 쓰지 않는다 — cn 은 단순 join 이라 gap 을 덮어쓸 수 없다
                className={cn(
                  'flex h-[33px] w-full shrink-0 cursor-pointer items-center gap-2 px-3 text-left text-[13px] transition-colors duration-200 ease-out-expo',
                  i === cursor ? 'bg-surface-soft text-yonsei-navy' : 'text-content',
                )}
              >
                <span className="min-w-0 truncate font-semibold">{entryLabel(entry)}</span>
                <span className="ml-auto shrink-0 text-[11px] text-content-faint">
                  {entryGroupLabel(entry)}
                </span>
              </button>
            ))
          )
        ) : (
          <>
            {/* 대시보드 — 카테고리 밖 독립 항목 */}
            <button
              type="button"
              onClick={() => onNavigate(null)}
              aria-current={isDashboard ? 'page' : undefined}
              className={cn(
                ROW,
                isDashboard
                  ? 'bg-yonsei-navy font-semibold text-white'
                  : 'font-medium text-content hover:bg-surface-soft',
              )}
            >
              <IcoDashboard size={16} className={cn('shrink-0', !isDashboard && 'text-content-faint')} />
              대시보드
            </button>

            {/* 사용자·권한 — 콘텐츠가 아니라 콘솔 자체의 설정이라 MENU_GROUPS
                (콘텐츠 파일 목록)에 넣지 않고 대시보드와 같은 계층의 독립 항목으로 둔다 */}
            {showUsers && (
              <button
                type="button"
                onClick={() => onNavigate(null, true)}
                aria-current={usersOpen ? 'page' : undefined}
                className={cn(
                  ROW,
                  usersOpen
                    ? 'bg-yonsei-navy font-semibold text-white'
                    : 'font-medium text-content hover:bg-surface-soft',
                )}
              >
                <IcoUsers size={16} className={cn('shrink-0', !usersOpen && 'text-content-faint')} />
                사용자·권한
              </button>
            )}

            {MENU_GROUPS.map((group) => {
              const GroupIcon = GROUP_ICONS[group.label];
              // 항목이 하나뿐인 그룹(일정)은 펼칠 것이 없다 — 아코디언 대신 평평한 행으로
              // 낸다. 클릭 한 번을 아끼는 것보다, 열어 봐야 한 줄인 그룹이 목록에 섞여
              // 있으면 "여긴 뭐가 더 있나" 하는 오해를 만드는 쪽이 문제다.
              const only = group.entries.length === 1 ? group.entries[0] : undefined;
              if (only) {
                const selected = entryId(only) === activeId;
                const editable = isEditable(only);
                return (
                  <button
                    key={group.label}
                    type="button"
                    onClick={() => editable && onNavigate(only)}
                    disabled={!editable}
                    aria-current={selected ? 'page' : undefined}
                    className={cn(
                      ROW,
                      selected
                        ? 'bg-yonsei-navy font-semibold text-white'
                        : editable
                          ? 'font-medium text-content hover:bg-surface-soft'
                          : 'cursor-not-allowed font-medium text-content-faint',
                    )}
                  >
                    {GroupIcon && (
                      <GroupIcon size={16} className={cn('shrink-0', !selected && 'text-content-faint')} />
                    )}
                    <span className="min-w-0 truncate">{entryLabel(only)}</span>
                  </button>
                );
              }

              const open = openGroup === group.label;
              return (
                // shrink-0 — 아코디언 묶음도 스크롤 영역의 직계 자식이라 ROW 와 같은 이유로 눌린다
                <div key={group.label} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpenGroup((cur) => (cur === group.label ? '' : group.label))}
                    aria-expanded={open}
                    className={cn(ROW, 'font-medium text-content hover:bg-surface-soft')}
                  >
                    {GroupIcon && <GroupIcon size={16} className="shrink-0 text-content-faint" />}
                    <span className="min-w-0 truncate">{group.label}</span>
                    <IcoChevronDown
                      size={14}
                      className={cn(
                        'ml-auto shrink-0 text-content-faint transition-transform duration-200 ease-out-expo',
                        open && 'rotate-180',
                      )}
                    />
                  </button>

                  {open && (
                    <ul className="flex flex-col gap-px py-0.5">
                      {group.entries.map((entry) => {
                        const id = entryId(entry);
                        const selected = id === activeId;
                        const editable = isEditable(entry);
                        return (
                          <li key={id}>
                            <button
                              type="button"
                              onClick={() => editable && onNavigate(entry)}
                              disabled={!editable}
                              aria-current={selected ? 'page' : undefined}
                              title={entry.type === 'placeholder' ? entry.note : undefined}
                              className={cn(
                                'flex h-[33px] w-full cursor-pointer items-center pl-10 pr-3 text-left text-[12.5px] transition-colors duration-200 ease-out-expo',
                                // 선택은 얇은 막대 대신 네이비 면으로 — 목록 옆 세로선은
                                // 스크롤 중에 놓치기 쉽다. 각진 채움은 콘솔의 필터 칩
                                // (FilterChip) 활성 상태와 같은 문법이다.
                                selected
                                  ? 'bg-yonsei-navy font-semibold text-white'
                                  : editable
                                    ? 'text-content hover:bg-surface-soft hover:text-yonsei-navy'
                                    : 'cursor-not-allowed text-content-faint',
                              )}
                            >
                              <span className="min-w-0 truncate">{entryLabel(entry)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* 하단 유틸리티 — 목록이 아무리 길어도 스크롤 밖에 남는다.
          계정·저장소는 "지금 어디에 무엇으로 쓰고 있는지"라 항상 보여야 한다. */}
      <div className="flex flex-col gap-0.5 border-t border-surface-border px-4 pb-4 pt-3">
        <a
          href={SITE_HOME}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 px-3 py-2 text-[13.5px] font-medium text-content transition-colors duration-200 ease-out-expo hover:bg-surface-soft hover:text-yonsei-navy"
        >
          <IcoExternal size={16} className="shrink-0 text-content-faint" />
          사이트 열기
        </a>

        {/* 계정 블록 — Claude Design 목업 '시안 A' 공통형: 원형 아바타 + 이름·이메일.
            저장소 경로는 관리자에게 무의미해 지웠고, 카카오 상태는 아바타의 15px
            배지와 둘째 줄이 조용히 말한다. 연결 유도는 여기가 아니라 우하단
            팝오버(KakaoLinkPopover, 시안 B)가 맡는다 — 본인만 연결할 수 있어
            사용자 관리 화면이 아니라 자기 계정 자리에서 다루는 원칙은 그대로다. */}
        <div className="mt-2.5 flex items-center gap-2.5 border border-surface-border p-2.5">
          <span
            aria-hidden="true"
            className="relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-yonsei-navy text-sm font-bold text-white"
          >
            {(me?.name || login || 'G').charAt(0).toUpperCase()}
            {kakaoStatus && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[#FEE500] ring-2 ring-surface">
                <IcoKakaoMark size={9} />
              </span>
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold">
              {me?.name || login || '게스트'}
            </div>
            {(kakaoStatus ?? me?.email) && (
              <div className="truncate text-xs text-content-faint">{kakaoStatus ?? me?.email}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="로그아웃"
            title="로그아웃"
            className="ml-auto shrink-0 p-1.5 text-content-faint transition-colors duration-200 ease-out-expo hover:bg-surface-soft hover:text-yonsei-navy"
          >
            <IcoLogout size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

/** 항목이 속한 그룹 라벨 — 아코디언 대상(항목 2개 이상)만 돌려준다.
 *  평평한 그룹(일정)은 열고 닫을 것이 없어 "열 그룹"이 될 수 없다. */
function groupOf(activeId: string | null): string | null {
  if (!activeId) return null;
  const found = MENU_GROUPS.find(
    (g) => g.entries.length > 1 && g.entries.some((e) => entryId(e) === activeId),
  );
  return found?.label ?? null;
}
