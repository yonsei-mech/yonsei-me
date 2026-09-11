import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { NewBadge } from '@/components/NewBadge';
import { isNewPost } from '@/lib/new-post';
import { cn, formatDate } from '@/lib/utils';
import type { Locale } from '@/i18n/routing';

export interface BoardRow {
  id: string;
  /** 없으면 날짜 칸을 생략 (자료실 등 바로가기형 행) */
  date?: string;
  title: string;
  /** 제목 아래 한 줄 — 발췌(미리보기) 또는 세미나 연사 같은 메타 */
  subtitle?: string;
  /** 화면에 그리지 않는 검색 색인 — 미리보기를 끈 게시판(공지사항)이 '내용' 검색을
   *  유지하려고 발췌를 여기에 싣는다. subtitle 이 있으면 그쪽이 검색 대상이다. */
  searchText?: string;
  tag?: string;
  href?: string;
  /** 우측 썸네일 — 없으면 우측 칸을 그리지 않는다(행 높이 = 좌측 내용 높이) */
  image?: string;
  /** 카테고리 필터용 식별자 (FilterableBoardList 의 categories 와 매칭). 표시엔 안 씀 */
  category?: string;
  /** 목록 최상단 고정 글 — 핀 배지를 붙인다(정렬은 상류가 이미 마쳤다) */
  pinned?: boolean;
}

/**
 * 게시판 목록 — 에디토리얼 행 스타일 (홍익 조형대 뉴스 레퍼런스).
 * 좌: 네이비 배지(tag) + 큰 볼드 제목 + 부제 1줄(subtitle) + 날짜,
 * 우: 16:10 썸네일(없으면 칸 자체를 생략 — 행 높이는 내용만큼). 행 사이는 헤어라인.
 * 고정 글(pinned)은 행 전체를 옅은 바탕 + 좌측 네이비 룰로 구분한다.
 * 최근 글은 제목 첫 줄 끝에 'N' 배지(홈 공지 섹션과 같은 규칙·같은 배지 — lib/new-post).
 * 공지/뉴스/세미나/행사/학위논문/자료실/취업 등 모든 게시판 탭 공용.
 */
export function BoardList({
  items,
  locale,
  emptyLabel,
  compactDate = false,
  now,
}: {
  items: BoardRow[];
  locale: Locale;
  emptyLabel: string;
  /** 발췌 없는 행의 제목–날짜 간격을 30px → 20px 로 (공지사항 전용) */
  compactDate?: boolean;
  /** 'N' 배지 기준 시각(ms) — 부모가 마운트 후에 채워 넘긴다. null/undefined 면 배지를
   *  달지 않으므로 서버 HTML 과 클라이언트 첫 렌더가 일치한다(하이드레이션 불일치 방지). */
  now?: number | null;
}) {
  const t = useTranslations('board');

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-5 rounded-card border border-surface-border bg-surface-soft px-6 py-20 text-center">
        {/* 빈 상태 마스코트 — eagle_empty 이미지 (뉴스 카드 미등록 상태와 동일 자산) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/eagle_empty.png" alt="" aria-hidden="true" className="h-20 w-auto opacity-70" />
        <p className="max-w-sm text-content-soft">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-surface-border border-y border-surface-border">
      {items.map((item) => {
        const isNew = now != null && isNewPost(item.date, now);
        const row = (
          <div
            className={cn(
              'grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_13.5rem] sm:gap-9 sm:py-7',
              // 고정 글의 바탕색이 글자에 바로 붙지 않도록 좌우 여백을 준다
              item.pinned && 'px-3.5 sm:px-[1.125rem]',
            )}
          >
            {/* 좌: 배지 · 제목 · 발췌 · 날짜(하단 고정) */}
            <div className="flex flex-col items-start">
              {/* 배지 줄 — 고정 핀이 먼저, 그 뒤에 게시판 태그. 둘 다 없으면 줄 자체를 내지 않는다.
                  외곽선 배지의 패딩을 0.0625rem 씩 줄인 이유는 1px 테두리 때문 — 칠한 배지와
                  나란히 설 때 높이가 어긋나면 안 된다(자료실 목록과 같은 보정). */}
              {(item.pinned || item.tag) && (
                <span className="mb-2.5 flex flex-wrap items-center gap-2">
                  {item.pinned && (
                    <span className="inline-flex items-center gap-1.5 border border-yonsei-navy bg-surface px-2 py-[0.125rem] text-[11px] font-bold text-yonsei-navy">
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3 fill-current">
                        <path d="M16 3v2l-1 1v5l3 3v2h-5v5l-1 1-1-1v-5H6v-2l3-3V6L8 5V3h8Z" />
                      </svg>
                      {t('pinned')}
                    </span>
                  )}
                  {item.tag && (
                    <span className="inline-block bg-yonsei-navy px-2 py-[0.1875rem] text-[11px] font-bold text-white">
                      {item.tag}
                    </span>
                  )}
                </span>
              )}
              {/* 제목 + N 배지. 글자 크기·행간을 h3 에서 감싸개로 올린 이유: 배지 칸이 제목과 같은
                  행간을 물려받아 1lh 가 곧 제목 한 줄 높이가 되게 하려는 것 — h3 도 그대로 물려받아
                  제목 모양은 예전과 같다. 배지를 h3 밖에 두어 line-clamp-2 의 말줄임이 배지를 먹지 않는다. */}
              <div className="flex items-start gap-2 text-base leading-snug sm:text-lg">
                <h3 className="line-clamp-2 min-w-0 font-bold tracking-tight text-content transition-colors group-hover:text-yonsei-blue">
                  {item.title}
                </h3>
                {isNew && (
                  // 배지 칸 높이를 제목 한 줄 높이(1lh)에 맞춰 첫 줄 가운데에 선다.
                  // em 고정값(1.375em)을 쓰지 않는 이유: sm:text-lg 가 행간을 1.75rem 으로 덮어써
                  // sm 이상에서는 한 줄이 1.375em 이 아니다(16px→22px, 18px→28px).
                  <span className="flex h-[1lh] shrink-0 items-center">
                    <NewBadge label={t('newBadge')} />
                  </span>
                )}
              </div>
              {item.subtitle && (
                <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-content-soft">
                  {item.subtitle}
                </p>
              )}
              {/* 날짜 — 썸네일이 있는 행만 바닥 정렬(이미지 높이에 맞춘 균형).
                  발췌·썸네일이 없는 행은 제목 바로 아래 30px(공지사항은 compactDate 로 20px). */}
              {item.date && (
                <time
                  dateTime={item.date}
                  className={cn(
                    'block text-[13px] tabular-nums text-content-faint',
                    item.image && 'mt-auto',
                    item.subtitle ? 'pt-3.5' : compactDate ? 'pt-5' : 'pt-[1.875rem]',
                  )}
                >
                  {formatDate(item.date, locale)}
                </time>
              )}
            </div>

            {/* 우: 썸네일 — 없으면 칸 자체를 내지 않는다. 예전엔 흰 공백으로 자리를 지켰지만
                그 높이(15rem 의 16:10)가 공지 행까지 늘려 제목·날짜 사이를 벌렸다.
                좌측 칸 너비는 grid-template 이 잡으므로 빈 칸 없이도 행 간 정렬은 유지된다. */}
            {item.image && (
              <div className="aspect-[16/10] w-full overflow-hidden bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element -- R2/외부 썸네일 */}
                <img
                  src={item.image}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
              </div>
            )}
          </div>
        );

        return (
          // 고정 글은 옅은 블루그레이 바탕 + 좌측 네이비 룰 — 목록에서 먼저 잡히게 한다
          // (본문 콜아웃과 같은 조합. 핀 배지는 흰 바탕이라 이 위에서 오히려 더 또렷하다)
          <li
            key={item.id}
            className={cn(item.pinned && 'border-l-2 border-yonsei-navy bg-surface-soft')}
          >
            {item.href ? (
              <Link href={item.href} className="group block">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}
