'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { BoardFilterBar, emptyFilter, isFilterActive, matchesFilter } from '@/components/BoardFilterBar';
import { BoardCategoryTabs } from '@/components/BoardCategoryTabs';
import { NewBadge } from '@/components/NewBadge';
import { isNewPost } from '@/lib/new-post';
import { cn, formatDate } from '@/lib/utils';
import { filenameFromDisposition, formatBytes } from '@/lib/files';
import type { Locale } from '@/i18n/routing';

/**
 * 자료실 전용 목록 — 다른 게시판(BoardList)과 달리 "읽는 글"이 아니라 "받아 가는 파일"이라
 * 행의 무게중심을 썸네일이 아닌 다운로드 버튼과 파일 메타(형식·용량)에 둔다.
 *
 * 구성(디자인 시안 "자료실 - 최종" — 이후 사용자 지시로 '여러 개 선택'(일괄 다운로드)은 삭제):
 *  - 헤더는 다른 게시판과 같은 문법이다: 위 줄에 공용 분류 탭(BoardCategoryTabs —
 *    전체·행정 서식·규정·내규, 옆에 건수), 아래 줄에 공용 검색 바(BoardFilterBar).
 *    분류가 지정된 글이 하나도 없으면 0건 탭만 두 개 뜨므로 탭 그룹 자체를 렌더하지 않는다.
 *  - 검색은 제출형(범위 select + 검색 버튼)이고 매칭도 공용 matchesFilter 를 그대로 쓴다.
 *    다만 '내용' 범위에 서버가 만들어 준 contentText(발췌+본문 평문+첨부 파일명)를 물려서
 *    다른 게시판이 발췌만 훑는 자리에서 자료실은 "파일명으로 찾기"까지 그대로 동작한다.
 *  - 첨부가 2개 이상인 행의 전체 다운로드는 POST /api/download-zip 을 쓴다
 *    (본문은 zip 바이트, 실패 시 JSON {error}). 진행 중에는 해당 버튼만 잠근다.
 *
 * 주의: 제목은 버튼이 아니라 Link 다 — 상세는 별도 라우트(/news/post/{id})이고 접근성상
 * 새 탭·복사가 되어야 한다. 'N' 배지는 Date.now() 의존이라 SSR/CSR 이 갈리므로
 * 마운트 후에만 켠다(하이드레이션 불일치 방지).
 */

/** 서버(news/page.tsx)에서 내려오는 자료 한 건 — 직렬화 가능한 평문 객체만 담는다 */
export interface ResourceItem {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  /** 발췌 — 없으면 생략 */
  desc?: string;
  /** 게시판 분류. 'form'(행정 서식) | 'rule'(규정·내규) | 미분류(undefined) */
  category?: 'form' | 'rule';
  /** 상세 경로 (`/news/post/{id}`) */
  href: string;
  /** 목록 최상단 고정 글 — 핀 배지를 붙인다(정렬은 상류 fetchBoardData 가 이미 마쳤다) */
  pinned?: boolean;
  attachments: ResourceAttachment[];
  /** 소문자 검색 인덱스 — 발췌·본문 평문·첨부 라벨을 이어 붙인 것.
   *  제목은 title 필드로 따로 내려가므로(검색 범위를 가르기 위해) 여기에 넣지 않는다. */
  contentText: string;
}

export interface ResourceAttachment {
  label: string;
  href: string;
  /** 바이트 — 모르면 undefined(표기 생략) */
  size?: number;
  /** "PDF" | "HWP" … 판별 불가면 null */
  format: string | null;
}

export function ResourceLibrary({
  items,
  locale,
}: {
  items: ResourceItem[];
  locale: Locale;
}) {
  const t = useTranslations('news');

  const [cat, setCat] = useState<'all' | 'form' | 'rule'>('all');
  const [filter, setFilter] = useState(emptyFilter);
  /** 진행 중인 ZIP 요청의 행 id (행별 전체 다운로드) */
  const [zipBusy, setZipBusy] = useState<string | null>(null);
  /** 실패 메시지를 붙일 행 id */
  const [zipError, setZipError] = useState<string | null>(null);

  // 'N' 배지 판정은 클라이언트에서만 (서버 렌더 결과와 어긋나면 하이드레이션 경고).
  // 기준은 다른 게시판·홈 공지와 같은 lib/new-post(KST 달력 기준 오늘 포함 7일) — 예전엔
  // 자료실만 30일이라 같은 사이트 안에서 '새 글'의 뜻이 갈렸다.
  const [today, setToday] = useState<number | null>(null);
  useEffect(() => setToday(Date.now()), []);

  // 분류가 하나라도 붙어 있을 때만 탭을 노출한다 (전부 미분류면 0건 탭 두 개가 뜬다)
  const hasCategories = useMemo(() => items.some((it) => it.category), [items]);

  // 매칭은 공용 matchesFilter 에 위임한다 — 범위(제목/내용/제목+내용)의 의미가 다른
  // 게시판과 100% 같아야 하기 때문. subtitle 자리에 발췌가 아니라 contentText 를 넣는 건
  // 자료실의 '내용' 범위가 발췌뿐 아니라 본문·첨부 파일명까지 덮게 하려는 의도적 선택이다.
  // (matchesFilter 가 양쪽을 소문자화+공백접기 하는데 contentText 는 이미 그 형태라 멱등)
  const searchActive = isFilterActive(filter);
  const searched = useMemo(
    () => (searchActive
      ? items.filter((it) => matchesFilter({ title: it.title, subtitle: it.contentText }, filter))
      : items),
    [items, searchActive, filter],
  );

  // 탭 건수는 검색과 무관하게 전체(items) 기준 — FilterableBoardList 와 같은 규칙이다.
  // 검색할 때마다 탭 숫자가 흔들리면 분류의 규모를 가늠하는 지표로 쓸 수 없다.
  const counts = useMemo(
    () => ({
      form: items.filter((it) => it.category === 'form').length,
      rule: items.filter((it) => it.category === 'rule').length,
    }),
    [items],
  );

  const visible = useMemo(
    () => (hasCategories && cat !== 'all' ? searched.filter((it) => it.category === cat) : searched),
    [searched, cat, hasCategories],
  );

  const runZip = async (id: string) => {
    setZipBusy(id);
    setZipError(null);
    try {
      const res = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postIds: [id] }),
      });
      if (!res.ok) throw new Error('zip failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // blob URL 은 서버의 Content-Disposition 을 쓰지 않는다 — a.download 가 곧 파일명이다.
      // 그래서 헤더에서 이름을 직접 꺼내 오고, 못 읽으면 로케일 기본 이름으로 떨어뜨린다.
      a.download = filenameFromDisposition(res.headers.get('content-disposition'))
        ?? t('library.zipFileName');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setZipError(id);
    } finally {
      setZipBusy(null);
    }
  };

  return (
    <div>
      {/* 1) 분류 탭 — 분류가 전혀 없으면 줄 자체를 렌더하지 않는다(0건 탭 두 개 방지) */}
      {hasCategories && (
        <BoardCategoryTabs
          active={cat}
          onChange={(id) => setCat(id as 'all' | 'form' | 'rule')}
          ariaLabel={t('library.categoryLabel')}
          categories={[
            { id: 'form', label: t('library.catForm'), count: counts.form },
            { id: 'rule', label: t('library.catRule'), count: counts.rule },
          ]}
        />
      )}

      {/* 2) 검색 바 — 결과 건수도 이 안에서 그린다(다른 게시판과 같은 자리·같은 문구) */}
      <BoardFilterBar
        value={filter}
        onChange={setFilter}
        resultCount={searchActive ? visible.length : null}
      />

      {/* 3) 목록 / 4) 빈 상태 */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-5 border border-surface-border bg-surface-soft px-6 py-20 text-center">
          {/* 빈 상태 마스코트 — BoardList 와 동일 자산 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/eagle_empty.png" alt="" aria-hidden="true" className="h-20 w-auto opacity-70" />
          <p className="max-w-sm text-content-soft">
            {searchActive ? t('search.empty') : t('library.empty')}
          </p>
        </div>
      ) : (
        <ul className="border-y border-surface-border">
          {visible.map((item) => (
            <ResourceRow
              key={item.id}
              item={item}
              locale={locale}
              isNew={today !== null && isNewPost(item.date, today)}
              busy={zipBusy === item.id}
              failed={zipError === item.id}
              onZip={() => runZip(item.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** 목록 한 행 — 배지/제목/발췌/메타 · 다운로드 */
function ResourceRow({
  item,
  locale,
  isNew,
  busy,
  failed,
  onZip,
}: {
  item: ResourceItem;
  locale: Locale;
  isNew: boolean;
  busy: boolean;
  failed: boolean;
  onZip: () => void;
}) {
  const t = useTranslations('news');
  // 고정 라벨은 게시판 공통 문구라 board 네임스페이스에서 가져온다(BoardList 와 같은 키)
  const tBoard = useTranslations('board');
  const files = item.attachments;
  const meta = buildMeta(item, locale, t);

  return (
    <li className="border-b border-surface-border last:border-b-0">
      <div className="grid grid-cols-1 items-start gap-x-8 gap-y-4 py-6 tab:grid-cols-[minmax(0,1fr)_13.75rem] tab:items-center tab:py-[1.625rem]">
        <div className="flex min-w-0 flex-col items-start">
          {/* 배지 줄 — 고정 핀이 먼저, 그 뒤에 분류(서식/규정). BoardList 와 같은 문법이되
              자료실 행은 메타가 촘촘해 한 치수 작게 쓴다. */}
          {(item.pinned || item.category) && (
            <span className="flex flex-wrap items-center gap-2">
              {item.pinned && (
                <span className="inline-flex items-center gap-1 border border-yonsei-navy bg-surface px-2 py-[0.125rem] text-[0.6875rem] font-bold text-yonsei-navy">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3 fill-current">
                    <path d="M16 3v2l-1 1v5l3 3v2h-5v5l-1 1-1-1v-5H6v-2l3-3V6L8 5V3h8Z" />
                  </svg>
                  {tBoard('pinned')}
                </span>
              )}
              {item.category && (
                <span
                  className={cn(
                    'inline-block text-xs font-bold',
                    item.category === 'form'
                      ? 'bg-yonsei-navy px-2.5 py-1 text-white'
                      : 'border border-yonsei-navy px-[0.5625rem] py-[0.1875rem] text-yonsei-navy',
                  )}
                >
                  {t(item.category === 'form' ? 'library.catForm' : 'library.catRule')}
                </span>
              )}
            </span>
          )}
          <h3
            className={cn(
              'flex flex-wrap items-center gap-2 text-lg font-bold leading-snug text-content tab:text-[1.1875rem]',
              (item.pinned || item.category) && 'mt-2.5',
            )}
          >
            <Link href={item.href} className="transition-colors hover:text-yonsei-blue">
              {item.title}
            </Link>
            {isNew && <NewBadge label={tBoard('newBadge')} />}
          </h3>
          {item.desc && (
            <p className="mt-2 text-sm leading-relaxed text-content-faint">{item.desc}</p>
          )}
          <p className="mt-2.5 text-[0.8125rem] tabular-nums text-content-faint">{meta}</p>
        </div>

        {/* 우: 다운로드 — 첨부 1개는 직접 링크, 2개 이상은 ZIP API, 0개면 비운다.
            폭은 w-40 고정 — '다운로드'와 '전체 다운로드'가 같은 위계라 행마다 버튼
            크기가 달라 보이면 안 된다(실측 최대 라벨 en 'Download all' 154px < 160px,
            busy 라벨 포함 전 로케일 줄바꿈 없음). 짧은 라벨은 justify-center 로 중앙 정렬 */}
        <div className="flex flex-col items-start gap-1.5 tab:items-end">
          {files.length === 1 && (
            <a
              href={files[0].href}
              download
              {...(isExternal(files[0].href)
                ? { target: '_blank', rel: 'noopener noreferrer' }
                : {})}
              className="inline-flex w-40 items-center justify-center gap-2 border border-yonsei-navy bg-surface py-3 text-sm font-bold text-yonsei-navy transition-colors hover:bg-yonsei-navy hover:text-white"
            >
              <DownloadIcon />
              {t('library.download')}
            </a>
          )}
          {files.length > 1 && (
            <>
              <button
                type="button"
                onClick={onZip}
                disabled={busy}
                className="inline-flex w-40 items-center justify-center gap-2 border border-yonsei-navy bg-surface py-3 text-sm font-bold text-yonsei-navy transition-colors hover:bg-yonsei-navy hover:text-white disabled:opacity-60 disabled:hover:bg-surface disabled:hover:text-yonsei-navy"
              >
                <DownloadIcon />
                {busy ? t('library.zipPreparing') : t('library.downloadAll')}
              </button>
              {failed && (
                <span role="alert" className="text-[0.8125rem] text-content-faint tab:text-right">
                  {t('library.zipFailed')}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/** 메타 줄 — 첨부 수에 따라 "날짜 · 형식 · 크기" / "날짜 · 첨부 n개 · PDF 외" / "날짜" */
function buildMeta(
  item: ResourceItem,
  locale: Locale,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const parts: string[] = [formatDate(item.date, locale)];
  const files = item.attachments;
  if (files.length === 1) {
    const [only] = files;
    if (only.format) parts.push(only.format);
    const size = formatBytes(only.size);
    if (size) parts.push(size);
  } else if (files.length > 1) {
    parts.push(t('library.attachCount', { count: files.length }));
    if (files[0].format) parts.push(t('library.formatEtc', { format: files[0].format }));
  }
  return parts.join(' · ');
}

/** 외부 호스트 첨부인지 — 맞으면 새 탭으로 연다(레거시 사이트 다운로드 URL 등) */
function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  );
}
