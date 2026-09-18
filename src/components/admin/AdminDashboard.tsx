'use client';

// 콘솔 대시보드 — "무엇을 수정할까요?"
//
// 구성 순서가 곧 사용 빈도 순서다:
//   인사말 → 최근 편집 → 전체 항목 → 안내(접이식)
// 반복 방문자는 최근 편집 카드에서 한 번에 목적지에 닿고, 처음 온 사람만
// 아래로 내려가 전체 항목과 안내를 읽는다.
//
// 검색은 사이드바로 옮겼다 — 어느 화면에서나 같은 자리에 있어야 하는 기능이라
// 대시보드에만 두면 편집 화면에서는 쓸 수 없다. 여기에는 검색 UI 가 없다.
//
// 첫 줄은 인사말 h1 하나다. 편집 흐름 설명은 하단 접이식 안내가 맡는다 —
// 매번 오는 사람에게 같은 문단을 매번 읽히지 않는다.
//
// 내부 운영 도구라 한국어 UI 문자열을 컴포넌트에 직접 둔다.

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { MENU_GROUPS, type MenuEntry } from '@/lib/admin/resources';
import { useAdminShell } from './AdminShellContext';
import { entryIcon, IcoArrowRight, IcoChevronRight } from './cms-icons';
import {
  ALL_ENTRIES,
  entryGroupLabel,
  entryId,
  entryKind,
  entryLabel,
  isEditable,
  readRecents,
} from './entries';
import { ThesisPendingCard } from './thesis-review/ThesisPendingCard';

interface Props {
  onOpen: (entry: MenuEntry) => void;
  /** 이 제목의 접이식 안내를 펼친 채로 연다 — 셸이 배너에서 여기로 보낼 때 쓴다.
   *  안내로 보내 놓고 사용자가 하단의 접힌 목록을 다시 찾게 두면 안내가 아니라 숙제다. */
  openGuide?: string;
}

export function AdminDashboard({ onOpen, openGuide }: Props) {
  // 로그인명은 셸이 이미 알고 있다 — 화면마다 다시 조회하지 않는다.
  const { login } = useAdminShell();

  return (
    // 좌우 여백은 셸이 준다. 여기서는 최대 폭과 섹션 사이 간격만 정한다.
    <div className="anim-panel mx-auto flex max-w-[1024px] flex-col gap-7">
      {/* 다른 화면의 머리말(CmsPanelHead)과 같은 계층이라 서체·굵기도 동일하게 */}
      <h1 className="font-subhead text-2xl font-semibold tracking-[-0.01em] text-content">
        안녕하세요, {login || '관리자'} 님
      </h1>
      {/* 학생이 제출하고 기다리는 공고 — 수정이 아니라 처리할 일이라 최근 편집보다 위.
          0건이면 카드째 사라진다(빈 자리를 설명하지 않는다 — 최근 편집과 같은 규칙) */}
      <ThesisPendingCard onOpen={onOpen} />
      <RecentSection onOpen={onOpen} />
      <AllEntriesSection onOpen={onOpen} />
      <GuideSection openGuide={openGuide} />
    </div>
  );
}

// ---- 1. 최근 편집 ----

/** 아이콘 타일 + 항목명 + 그룹 라벨의 카드 3장.
 *  기록이 없으면(첫 방문) 섹션째 사라진다 — 빈 자리를 설명하지 않는다. */
function RecentSection({ onOpen }: { onOpen: (entry: MenuEntry) => void }) {
  // 최근 편집 — localStorage. SSR 불일치를 피하려 마운트 후 로드.
  const [recents, setRecents] = useState<MenuEntry[]>([]);
  useEffect(() => {
    setRecents(readRecents());
  }, []);

  if (recents.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2.5 text-[11px] font-bold tracking-[0.18em] text-yonsei-blue">최근 편집</h2>
      {/* 한 줄에 최대 3장. 그 이상은 "최근"이 아니라 목록이 된다. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {recents.slice(0, 3).map((entry) => {
          const group = entryGroupLabel(entry);
          const Icon = entryIcon(entry, group);
          return (
            <button
              key={entryId(entry)}
              type="button"
              onClick={() => onOpen(entry)}
              className="flex items-center gap-3 border border-surface-border bg-surface p-3.5 text-left transition-colors duration-200 ease-out-expo hover:border-yonsei-blue"
            >
              <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center bg-yonsei-navy text-white">
                <Icon size={18} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14.5px] font-semibold text-content">
                  {entryLabel(entry)}
                </span>
                <span className="mt-px block truncate text-[12.5px] text-content-faint">
                  {group}
                </span>
              </span>
              <IcoArrowRight size={16} className="ml-auto shrink-0 text-content-faint" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---- 2. 전체 항목 ----

/** 유형 점의 색 — 사이드바 배지와 같은 세 갈래(게시판·데이터·문서)를 점 하나로 줄였다.
 *  entryKind 가 라벨을 단일 출처로 들고 있으므로 여기서는 라벨로만 분기한다. */
const KIND_DOTS = [
  { label: '게시판', dot: 'bg-yonsei-navy' },
  { label: '데이터', dot: 'bg-[#2E86D6]' },
  { label: '문서', dot: 'bg-[#6E6E6E]' },
];

function kindDot(entry: MenuEntry): string {
  const label = entryKind(entry)?.label ?? '';
  // 준비 중(placeholder)은 유형이 없다 — 회색 테두리 색으로 눕혀 둔다.
  return KIND_DOTS.find((k) => k.label === label)?.dot ?? 'bg-surface-border';
}

function AllEntriesSection({ onOpen }: { onOpen: (entry: MenuEntry) => void }) {
  // '일정'은 사이드바 상단 평면 항목이 담당하므로 카드에서 뺀다 — 항목 1개짜리
  // 그룹이 카드 한 칸을 통째로 차지하면 그 아래가 통으로 빈다.
  const groups = MENU_GROUPS.filter((g) => g.label !== '일정');

  return (
    <section>
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 className="text-[11px] font-bold tracking-[0.18em] text-yonsei-blue">전체 항목</h2>
        <span className="text-[12.5px] tabular-nums text-content-faint">{ALL_ENTRIES.length}</span>
        <span className="ml-auto flex gap-3.5 text-[12.5px] text-content">
          {KIND_DOTS.map((k) => (
            <span key={k.label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cn('h-[7px] w-[7px]', k.dot)} />
              {k.label}
            </span>
          ))}
        </span>
      </div>

      {/* 항목이 11개인 '뉴스·공지'만 두 행을 쓰게 두면 나머지 카드가 옆으로 흘러
          짧은 카드 아래가 비지 않는다(그룹마다 길이가 크게 다르다). */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <div
            key={group.label}
            className={cn(
              'border border-surface-border border-t-2 border-t-yonsei-navy bg-surface p-2',
              group.label === '뉴스·공지' && 'md:row-span-2 xl:row-span-2',
            )}
          >
            <p className="px-2.5 pb-1 pt-2 text-xs font-semibold tracking-[0.02em] text-content-faint">
              {group.label}
            </p>
            {group.entries.map((entry) => (
              <button
                key={entryId(entry)}
                type="button"
                disabled={!isEditable(entry)}
                onClick={() => onOpen(entry)}
                className="flex w-full items-center gap-2.5 px-2.5 py-[7px] text-left text-[13.5px] text-content transition-colors duration-200 ease-out-expo hover:bg-surface-soft hover:text-yonsei-navy disabled:cursor-not-allowed disabled:text-content-faint"
              >
                <span aria-hidden="true" className={cn('h-[7px] w-[7px] shrink-0', kindDot(entry))} />
                {entryLabel(entry)}
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- 3. 접이식 안내 ----

const FIRST_TIME_STEPS = [
  { t: '콘텐츠 선택', b: '왼쪽 메뉴나 위 목록에서 편집할 항목(게시판·연혁·교수진·교과목 등)을 고릅니다.' },
  { t: '내용 편집', b: '한국어와 English를 입력합니다. “한→영 번역” 버튼으로 영문 초안을 채우고, 사진은 파일을 올리면 됩니다.' },
  { t: '저장', b: '“저장” 버튼을 누르면 변경 내용이 사이트 데이터베이스에 바로 기록됩니다.' },
  { t: '자동 반영', b: '재배포를 기다릴 필요 없이 수 초 내 실제 페이지에 나타납니다.' },
];

const NEW_ADMIN_STEPS = [
  {
    t: '사용자·권한 열기',
    b: '왼쪽 메뉴 위쪽의 “사용자·권한”을 엽니다. 이 화면은 관리자에게만 보입니다.',
  },
  {
    t: '사람 추가',
    b: '이름과 이메일을 넣고 역할(관리자 · 편집자)을 고른 뒤 “추가”를 누릅니다. GitHub 으로도 로그인하게 하려면 GitHub 아이디를 함께 넣습니다.',
  },
  {
    t: '로그인 안내',
    b: '추가한 즉시 로그인할 수 있습니다. 그 사람은 로그인 화면에서 이메일로 인증번호를 받아 들어옵니다.',
  },
];

/** 처음 한 번만 필요한 내용이라 접이식으로 하단에 — 반복 방문자의 동선을 가리지 않는다 */
function GuideSection({ openGuide }: { openGuide?: string }) {
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <GuideDetails
        title="처음이신가요?"
        note="사용 방법 4단계"
        defaultOpen={openGuide === '처음이신가요?'}
      >
        <ol className="grid gap-4">
          {FIRST_TIME_STEPS.map((step, i) => (
            <NumberedStep key={step.t} i={i} title={step.t} body={step.b} />
          ))}
        </ol>
      </GuideDetails>

      <GuideDetails
        title="새 관리자 등록"
        note="콘솔에서 직접 · 3단계"
        defaultOpen={openGuide === '새 관리자 등록'}
      >
        <p className="text-[13px] leading-[1.8] text-content-soft">
          새 담당자는 이 콘솔 안에서 바로 등록합니다. 여기 등록된 사람만 로그인할 수 있고,
          추가·삭제는 재배포 없이 즉시 적용됩니다.
        </p>
        <ol className="mt-4 grid gap-4">
          {NEW_ADMIN_STEPS.map((step, i) => (
            <NumberedStep key={step.t} i={i} title={step.t} body={step.b} />
          ))}
        </ol>
        <p className="mt-4 text-xs leading-relaxed text-content-faint">
          관리자는 사용자 등록·권한 변경까지, 편집자는 콘텐츠 편집만 할 수 있습니다. 내보낼
          때는 사용자·권한 목록에서 그 사람을 삭제하면 바로 막힙니다(마지막 관리자는 삭제·
          강등되지 않습니다). 카카오 로그인은 본인이 로그인한 뒤 왼쪽 아래 계정에서 직접
          연결합니다.
        </p>
      </GuideDetails>
    </section>
  );
}

function GuideDetails({
  title,
  note,
  defaultOpen,
  children,
}: {
  title: string;
  note: string;
  /** 처음 한 번 펼친 채로 연다(그 뒤 접고 펴는 건 온전히 사용자 몫) */
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  // <details open={...}> 로 제어하면 React 가 매 렌더 열림 상태를 되돌려 놓아
  // 사용자가 직접 접을 수 없게 된다. 그래서 비제어로 두고 DOM 속성만 한 번 켠다.
  // 이어서 화면 가운데로 스크롤 — 안내는 페이지 맨 아래라 펴 놓기만 하면
  // 사용자는 자기가 어디로 보내졌는지 알지 못한다.
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!defaultOpen || !ref.current) return;
    ref.current.open = true;
    ref.current.scrollIntoView({ block: 'center' });
  }, [defaultOpen]);

  return (
    // 두 카드가 나란한 그리드라 self-start 가 필요하다 — 없으면 한쪽만 펼쳐도
    // 접힌 카드가 같은 행 높이로 늘어나 빈 상자가 된다.
    <details ref={ref} className="group w-full self-start border border-surface-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-[18px] py-[15px] transition-colors duration-200 ease-out-expo hover:bg-surface-soft [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-content">{title}</span>
          <span className="mt-px block text-[13px] text-content-faint">{note}</span>
        </span>
        <IcoChevronRight
          size={16}
          className="ml-auto shrink-0 text-content-faint transition-transform duration-200 group-open:rotate-90"
        />
      </summary>
      <div className="border-t border-surface-border px-[18px] py-4">{children}</div>
    </details>
  );
}

/** 안내 한 단계 — 번호 타일 + 제목 + 설명. 카드가 좁아 한 열로 쌓는다. */
function NumberedStep({ i, title, body }: { i: number; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-[2px] flex h-[22px] w-[22px] shrink-0 items-center justify-center border border-surface-border text-[12px] font-bold tabular-nums text-yonsei-blue">
        {i + 1}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-content">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-[1.7] text-content-soft">{body}</span>
      </span>
    </li>
  );
}
