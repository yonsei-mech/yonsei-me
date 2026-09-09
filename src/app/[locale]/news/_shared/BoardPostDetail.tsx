/**
 * 게시판 글 상세 공용 빌더 — 구 `/news/post/[id]` 한 라우트가 하던 일을
 * 게시판별 라우트 6개(notices·seminars·events·career·resources·thesis)가
 * 얇게 감싸 쓴다. 화면·메타 로직은 전부 여기 한 곳이다.
 *
 * 왜 라우트를 쪼갰나
 *   URL 에 소속 게시판이 드러나야(`/news/seminars/123`) 검색엔진과 사람이 글의 맥락을
 *   읽을 수 있고, 목록↔상세가 같은 경로 트리에 놓인다. 학위논문심사만 대학원 메뉴
 *   소속이라 `/graduate/thesis/<id>` 로 간다(board-links.boardPostHref 가 단일 출처).
 *
 * 게시판이 어느 메뉴에 사느냐는 sectionContextOf() 한 곳이 정한다 — 예전엔 "인턴 모집이냐
 * 아니냐"는 boolean 이 셸·크럼·히어로·목록 링크 네 군데에 흩어져 있었고, 게시판이 다른
 * 섹션으로 옮겨 갈 때마다 그 넷을 함께 고쳐야 했다.
 *
 * ⚠️ canonical 가드: 라우트가 기대한 게시판과 글의 실제 boardKey 가 다르면 308 로
 *    제 주소에 보낸다. 안 그러면 같은 글이 게시판 수만큼의 URL 로 열려 전부 중복이 된다.
 */
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Hero } from '@/components/Hero';
import { PostArticle } from '@/components/PostArticle';
import { PostBoardContext } from '@/components/PostBoardContext';
import { BoardShell } from '@/components/BoardShell';
import { pick, type BoardPost } from '@/lib/content';
import { fetchBoardPost, postsBodyFormat } from '@/lib/posts';
import { locateInBoard } from '@/lib/board-paging';
import { pageMetadata } from '@/lib/page-metadata';
import { htmlToDescription } from '@/lib/excerpt';
import {
  DEFAULT_NEWS_TAB,
  boardPostHref,
  newsTabHref,
  sectionDefaultHref,
  sectionTabHref,
} from '@/lib/board-links';
import { getNewsTabs } from './tabs';
import { sectionTabs } from '../../_shared/section-tabs';
import { buildBoardContext } from './list-data';
import type { Locale } from '@/i18n/routing';

/** 라우트가 기대하는 게시판 (= URL 세그먼트) */
export type BoardKey = BoardPost['boardKey'];

export interface BoardPostRouteParams {
  locale: string;
  id: string;
  /** 이 라우트가 맡은 게시판 — 글의 boardKey 와 다르면 제 주소로 308 */
  board: BoardKey;
}

/**
 * 게시판 라벨 — 학위논문심사만 대학원 메뉴 소속이라 다른 키를 쓴다.
 * 메타(제목 꼬리)와 화면(크럼·본문)이 같은 문자열을 써야 검색결과와 페이지가 일치한다.
 */
async function boardNameOf(locale: Locale, boardKey: BoardKey): Promise<string> {
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  return boardKey === 'thesis'
    ? tMenu('graduate.items.thesis')
    : tMenu(`news.items.${boardKey}`);
}

/** 상세 화면이 어느 메뉴 안에 있는가 — 히어로·크럼·탭 줄·목록 링크가 이 한 벌을 쓴다 */
interface SectionContext {
  /** 크럼 첫 항목과 탭 줄 제목에 쓰는 섹션명 */
  sectionLabel: string;
  /** 섹션 크럼의 링크 — 기본 탭으로 건다(섹션 루트로 걸면 308 을 한 번 더 탄다) */
  sectionHref: string;
  heroTitle: string;
  heroSubtitle: string;
  tabs: { key: string; label: string; href: string }[];
  /** '목록으로' 가 돌아갈 그 게시판의 목록 경로 */
  backHref: string;
}

/**
 * boardKey → 소속 섹션 컨텍스트.
 * 학위논문심사만 대학원 메뉴 소속이고(2026-09 이관), 나머지 게시판은 소식 섹션에 있다.
 * 대학원 쪽 문구·탭은 콘텐츠 탭 페이지(SectionTabPage)와 같은 출처를 쓴다 — 같은 섹션인데
 * 게시판 상세만 다른 제목·다른 탭 줄을 그리면 같은 자리로 읽히지 않는다.
 */
async function sectionContextOf(locale: Locale, boardKey: BoardKey): Promise<SectionContext> {
  const tMenu = await getTranslations({ locale, namespace: 'menu' });
  if (boardKey === 'thesis') {
    const tPages = await getTranslations({ locale, namespace: 'pages' });
    const label = tMenu('graduate.label');
    return {
      sectionLabel: label,
      sectionHref: sectionDefaultHref('graduate'),
      heroTitle: label,
      heroSubtitle: tPages('graduate.subtitle'),
      tabs: await sectionTabs(locale, 'graduate'),
      backHref: sectionTabHref('graduate', 'thesis'),
    };
  }
  const tNews = await getTranslations({ locale, namespace: 'news' });
  return {
    sectionLabel: tMenu('news.label'),
    sectionHref: newsTabHref(DEFAULT_NEWS_TAB),
    heroTitle: tNews('hero.title'),
    heroSubtitle: tNews('hero.subtitle'),
    tabs: await getNewsTabs(locale),
    // 위에서 thesis 를 먼저 걸러 냈으므로 남은 boardKey 는 전부 뉴스 탭 세그먼트다
    // (boolean 플래그를 거치면 타입이 좁혀지지 않아 newsTabHref 가 컴파일되지 않는다).
    backHref: newsTabHref(boardKey),
  };
}

export async function boardPostMetadata({
  locale,
  id,
  board,
}: BoardPostRouteParams): Promise<Metadata> {
  const post = await fetchBoardPost(id);
  // 없는 글은 notFound() 로 떨어져 not-found 페이지가 자기 메타를 갖는다 → 여기선 빈 객체.
  if (!post) return {};
  // 게시판이 어긋난 주소는 페이지가 308 로 보낸다 — 메타를 낼 자리가 아니다.
  if (post.boardKey !== board) return {};
  const l = locale as Locale;
  // description 이 비면 레이아웃의 사이트 기본 설명이 수천 문서에 똑같이 붙는다
  // (GSC 중복 신호). 편집자가 쓴 요약을 먼저 쓰고, 없으면 본문에서 만든다.
  const description =
    (post.excerpt ? pick(post.excerpt, l).trim() : '') || htmlToDescription(pick(post.body, l));
  return pageMetadata({
    locale: l,
    // 글의 정본 주소(선행 슬래시 제거) — hreflang 과 og:url 이 제 URL 을 가리키게 한다
    path: boardPostHref(post).slice(1),
    // 제목 뒤에 게시판을 붙인다 — "공지사항" 같은 맥락이 없으면 검색결과 제목이
    // 글 제목 한 줄로만 서서 어느 사이트의 무엇인지 읽히지 않는다.
    title: `${pick(post.title, l)} | ${await boardNameOf(l, post.boardKey)}`,
    ...(description ? { description } : {}),
    type: 'article',
    image: post.image ?? null,
    publishedTime: post.date,
    // ⚠️ 번역 판정 필드는 사이트맵(목록 조회)과 같아야 한다 — **제목만** 넘긴다.
    //    (요약이 BoardPost 에 실리게 됐어도 판정 필드는 늘리지 않는다: 사이트맵이
    //     제목만 보므로 여기서 늘리면 두 곳 결론이 갈려 hreflang 상호 참조가 깨진다.)
    fields: [post.title],
  });
}

export async function BoardPostDetail({ locale, id, board }: BoardPostRouteParams) {
  const l = locale as Locale;
  const post = await fetchBoardPost(id);
  const t = await getTranslations({ locale: l, namespace: 'news' });

  // 없는 글은 진짜 404 다(예전 인라인 "찾을 수 없음" 렌더는 HTTP 200 → GSC Soft 404).
  if (!post) notFound();
  // 같은 글이 여러 게시판 URL 로 열리는 중복 차단 — 정본 주소로 영구 이동.
  if (post.boardKey !== board) permanentRedirect(`/${locale}${boardPostHref(post)}`);

  // 소속 메뉴(소식/대학원)에 따라 히어로·크럼·탭 줄·목록 링크가 통째로 갈린다 — 한 곳에서 결정.
  const { sectionLabel, sectionHref, heroTitle, heroSubtitle, tabs, backHref } =
    await sectionContextOf(l, post.boardKey);
  const boardName = await boardNameOf(l, post.boardKey);
  const author = post.meta ? pick(post.meta, l) : t('detail.defaultAuthor');

  // 자료실만 '분류' 메타 행을 한 줄 더 세운다. 공지의 학부/대학원 구분은 이미 위
  // author(post.meta) 칸에 실려 있어 여기 또 쓰면 같은 말이 두 번 나온다.
  const libraryCategory =
    post.boardKey === 'resources' && (post.category === 'form' || post.category === 'rule')
      ? t(post.category === 'form' ? 'library.catForm' : 'library.catRule')
      : undefined;

  // 본문 아래 이전/다음 글 — 이 글이 실제로 속한 (하위)게시판 기준의 앞뒤 글.
  // 모르는 게시판이면 context 가 null 이라 아무것도 그리지 않는다.
  const context = await buildBoardContext(l, post.boardKey, post.id);
  const slice = context ? locateInBoard(context.rows, post.id) : null;

  return (
    <>
      {/* 히어로 제목은 섹션명('소식'·'대학원')이라 h1 은 본문의 글 제목이 갖는다 —
          한 문서에 큰 제목이 둘이면 구글이 제목 링크를 임의로 골라 쓴다. 시각 변화 없음.
          crumbLeaf: 글 제목을 BreadcrumbList JSON-LD 의 마지막 항목으로만 덧붙인다
          (화면 크럼은 게시판까지만 — 긴 제목이 크럼 줄을 무너뜨리므로). */}
      <Hero
        title={heroTitle}
        subtitle={heroSubtitle}
        // 게시판 크럼에도 목록 URL 을 채운다 — 화면에서는 마지막 항목이라 링크로 그려지지
        // 않지만(시각 변화 없음), JSON-LD 는 중간 항목에 item 이 없으면 그 뒤(crumbLeaf)를
        // 통째로 버린다(Hero 의 ③ 주석).
        breadcrumb={[
          { label: sectionLabel, href: sectionHref },
          { label: boardName, href: backHref },
        ]}
        crumbLeaf={pick(post.title, l)}
        titleTag="p"
      />
      <BoardShell tabs={tabs} activeKey={post.boardKey} navTitle={sectionLabel}>
        <PostArticle
          boardName={boardName}
          title={pick(post.title, l)}
          titleTag="h1"
          date={post.date}
          metaValue={author}
          categoryLabel={libraryCategory ? t('detail.categoryLabel') : undefined}
          categoryValue={libraryCategory}
          body={pick(post.body, l)}
          bodyFormat={postsBodyFormat()}
          attachments={post.attachments}
          attachmentLabels={post.attachments?.map((a) => pick(a.label, l))}
          postId={post.id}
          backHref={backHref}
          labels={{
            title: t('detail.titleLabel'),
            date: t('detail.dateLabel'),
            metaRow: t('detail.authorLabel'),
            attachments: t('detail.attachmentsLabel'),
            backToList: t('backToList'),
            // ZIP 문구는 게시판을 가리지 않고 넘긴다 — 첨부가 여럿인 글이면 자료실이든
            // 공지든 한 번에 받는 편이 낫고, /api/download-zip 도 게시판을 구분하지 않는다.
            attachmentsZip: t('library.attachmentsZip'),
            zipPreparing: t('library.zipPreparing'),
            zipFailed: t('library.zipFailed'),
            zipFileName: t('library.zipFileName'),
            share: t('detail.share'),
            copyUrl: t('detail.copyUrl'),
            copied: t('detail.copied'),
            copyFailed: t('detail.copyFailed'),
          }}
          locale={l}
        />
        {context && slice && (
          <PostBoardContext
            slice={slice}
            labels={{
              prev: t('context.prev'),
              next: t('context.next'),
              none: t('context.none'),
              navLabel: t('context.navLabel'),
            }}
          />
        )}
      </BoardShell>
    </>
  );
}
