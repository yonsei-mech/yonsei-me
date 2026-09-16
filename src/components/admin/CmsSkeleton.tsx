'use client';

// 불러오는 동안 그리는 뼈대 화면.
//
// 지금까지 로딩은 "불러오는 중…" 한 줄이었다. 그 한 줄은 (1) 무엇이 나타날지
// 알려주지 못하고 (2) 실제 목록이 도착하는 순간 화면 높이가 통째로 튀어 사용자의
// 시선이 다시 처음부터 훑어야 한다. 뼈대는 도착할 화면과 같은 자리·같은 높이를
// 미리 차지해서, 데이터가 들어와도 레이아웃이 흔들리지 않게 한다.
//
// 접근성: 회색 블록은 아무 의미가 없으므로 전부 aria-hidden 으로 감춘다.
// 스크린리더는 그 옆의 role="status" 한 줄만 읽고 "불러오는 중"만 듣는다 —
// 뼈대 조각 수십 개가 읽히면 오히려 화면보다 시끄러워진다.
//
// (모션 최소화 선호에서는 animate-pulse 가 globals.css 에서 멈춘다. Tailwind 의
//  animate-pulse 자체는 reduced-motion 을 존중하지 않아 명시적으로 꺼 두었다.)
//
// 내부 운영 도구라 한국어 UI 문자열을 컴포넌트에 직접 둔다.

import { cn } from '@/lib/utils';

export type SkeletonShape =
  | 'table'      // 표 — 툴바 + 네이비 2px 헤더 룰 + 행 8줄
  | 'cards'      // 카드 그리드 — 카드 6장
  | 'timeline'   // 연월 타임라인 — 항목 5개
  | 'calendar'   // 월 그리드 — 요일 머리 7칸 + 날짜 칸 35개
  | 'expandRows' // 행 펼침 — 요약 행 8줄
  | 'rows';      // 게시판 행 목록 — 8줄

/** 회색 블록 한 조각. 폭·높이·지연은 쓰는 쪽에서 준다. */
function Bar({ className }: { className?: string }) {
  return <span className={cn('block animate-pulse bg-[#eef1f5]', className)} />;
}

// 행마다 폭을 조금씩 다르게 준다 — 모두 같은 폭이면 표가 아니라 회색 벽으로 보인다.
const TITLE_W = ['w-[62%]', 'w-[48%]', 'w-[70%]', 'w-[40%]', 'w-[58%]', 'w-[66%]', 'w-[44%]', 'w-[54%]'];
const SUB_W = ['w-[34%]', 'w-[46%]', 'w-[28%]', 'w-[40%]', 'w-[32%]', 'w-[24%]', 'w-[38%]', 'w-[30%]'];
// 몇 줄만 펄스를 늦춰 물결처럼 보이게 한다(전부 같은 박자면 화면이 한꺼번에 껌뻑인다)
const DELAY = ['', '[animation-delay:.1s]', '[animation-delay:.2s]', '[animation-delay:.15s]'];

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export function CmsSkeleton({ shape }: { shape: SkeletonShape }): React.ReactElement {
  return (
    <div className="anim-panel">
      <div aria-hidden="true">{renderShape(shape)}</div>
      <p role="status" className="sr-only">
        불러오는 중…
      </p>
    </div>
  );
}

function renderShape(shape: SkeletonShape): React.ReactElement {
  switch (shape) {
    case 'table':
      return <TableSkeleton />;
    case 'cards':
      return <CardsSkeleton />;
    case 'timeline':
      return <TimelineSkeleton />;
    case 'calendar':
      return <CalendarSkeleton />;
    case 'expandRows':
      return <ExpandRowsSkeleton />;
    case 'rows':
      return <RowsSkeleton />;
  }
}

/** 표 — 검색창 + 건수 툴바, 네이비 2px 헤더 룰, 44px 행 8줄 */
function TableSkeleton() {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <Bar className="h-[34px] w-[250px] max-w-[60%]" />
        <Bar className="h-[13px] w-[74px] shrink-0" />
      </div>
      <div className="border-t-2 border-yonsei-navy">
        {/* 헤더 행 — 본문 행보다 짧고 진하지 않게 두어 머리와 몸을 구분한다 */}
        <div className="flex h-10 items-center gap-4 border-b border-[#f1f4f8] px-2">
          <Bar className="h-[11px] w-[18%]" />
          <Bar className="h-[11px] w-[26%]" />
          <Bar className="ml-auto h-[11px] w-[56px]" />
        </div>
        {range(8).map((i) => (
          <div key={i} className="flex h-11 items-center gap-4 border-b border-[#f1f4f8] px-2">
            <Bar className={cn('h-[13px]', TITLE_W[i], DELAY[i % DELAY.length])} />
            <Bar className={cn('h-[13px]', SUB_W[i])} />
            <Bar className="ml-auto h-[13px] w-[52px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 카드 그리드 — 교수진 카드 편집기와 같은 열 수·높이 */
function CardsSkeleton() {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <Bar className="h-[34px] w-[250px] max-w-[60%]" />
        <Bar className="h-[13px] w-[74px] shrink-0" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {range(6).map((i) => (
          <div
            key={i}
            className="flex h-[220px] gap-4 border border-surface-border bg-[#fcfdfe] p-4"
          >
            {/* 좌측 사진 자리 */}
            <Bar className={cn('h-[92px] w-[72px] shrink-0', DELAY[i % DELAY.length])} />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <Bar className="h-[15px] w-[56%]" />
              <Bar className="h-[11px] w-[38%]" />
              <Bar className="mt-2 h-[11px] w-full" />
              <Bar className="h-[11px] w-[82%]" />
              <Bar className="h-[11px] w-[64%]" />
              <Bar className="mt-auto h-[26px] w-[88px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 연월 타임라인 — 좌측 연월 칸 + 우측 본문 두 줄 */
function TimelineSkeleton() {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <Bar className="h-[34px] w-[250px] max-w-[60%]" />
        <Bar className="h-[13px] w-[74px] shrink-0" />
      </div>
      <div className="border-t-2 border-yonsei-navy">
        {range(5).map((i) => (
          <div key={i} className="flex gap-5 border-b border-[#f1f4f8] py-5">
            <Bar className={cn('h-[15px] w-[92px] shrink-0', DELAY[i % DELAY.length])} />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <Bar className={cn('h-[14px]', TITLE_W[i])} />
              <Bar className={cn('h-[11px]', SUB_W[i])} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const WEEKDAYS = range(7);

/** 월 그리드 — 요일 머리 7칸 + 날짜 칸 35개(5주). 격자는 헤어라인으로만 그린다. */
function CalendarSkeleton() {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <Bar className="h-[34px] w-[180px] max-w-[50%]" />
        <Bar className="h-[34px] w-[120px] shrink-0" />
      </div>
      <div className="grid grid-cols-7 border-l border-t border-[#f1f4f8]">
        {WEEKDAYS.map((i) => (
          <div
            key={`h${i}`}
            className="flex h-9 items-center justify-center border-b border-r border-[#f1f4f8] bg-surface-soft"
          >
            <Bar className="h-[10px] w-[18px]" />
          </div>
        ))}
        {range(35).map((i) => (
          <div key={i} className="h-24 border-b border-r border-[#f1f4f8] p-2">
            <Bar className="h-[11px] w-[16px]" />
            {/* 일정이 있는 칸만 띄엄띄엄 — 모든 칸을 채우면 실제 달력과 밀도가 다르다 */}
            {i % 4 === 1 && (
              <Bar className={cn('mt-2 h-[14px] w-[80%]', DELAY[i % DELAY.length])} />
            )}
            {i % 7 === 3 && <Bar className="mt-1.5 h-[14px] w-[62%]" />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 행 펼침 — 접힌 요약 행만 8줄. 좌측에 펼침 화살표 자리를 둔다. */
function ExpandRowsSkeleton() {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <Bar className="h-[34px] w-[250px] max-w-[60%]" />
        <Bar className="h-[13px] w-[74px] shrink-0" />
      </div>
      <div className="border-t-2 border-yonsei-navy">
        {range(8).map((i) => (
          <div key={i} className="flex h-[52px] items-center gap-4 border-b border-[#f1f4f8] px-2">
            <Bar className="h-[10px] w-[10px] shrink-0" />
            <Bar className={cn('h-[13px]', TITLE_W[i], DELAY[i % DELAY.length])} />
            <Bar className={cn('h-[11px]', SUB_W[i])} />
            <Bar className="ml-auto h-[11px] w-[44px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 게시판 행 목록 — 좌측 체크박스 + 제목 줄 + 날짜 */
function RowsSkeleton() {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <Bar className="h-[34px] w-[250px] max-w-[60%]" />
        <Bar className="h-[34px] w-[96px] shrink-0" />
      </div>
      <div className="border-t-2 border-yonsei-navy">
        {range(8).map((i) => (
          <div key={i} className="flex h-11 items-center gap-3.5 border-b border-[#f1f4f8] px-2">
            <Bar className="h-[14px] w-[14px] shrink-0" />
            <Bar className={cn('h-[13px]', TITLE_W[i], DELAY[i % DELAY.length])} />
            <Bar className="ml-auto h-[11px] w-[72px] shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
