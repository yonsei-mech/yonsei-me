import { Link } from '@/i18n/navigation';
import { POST_BODY_WIDTH } from '@/lib/post-layout';
import { wrapCaptionedImages } from '@/lib/post-body-figures';
import type { InterviewCard } from '@/lib/alumni-interview';
import { InterviewPhoto } from './InterviewBits';
import styles from './InterviewArticle.module.css';

/** 이전/다음 인터뷰 한 칸 — 제목·바이라인만 있는 가벼운 카드 */
export interface InterviewNeighbor {
  href: string;
  title: string;
  byline: string;
}

export interface InterviewArticleLabels {
  /** 킥커 앞머리 — '동문 인터뷰' */
  kicker: string;
  /** 마무리 상자 라벨 — '한 줄로' */
  closing: string;
  prev: string;
  next: string;
  /** 다음(더 최신) 글이 없을 때의 회색 안내 */
  latestNote: string;
  related: string;
  /** 첨부 묶음 제목 — 첨부가 있을 때만 쓰인다 */
  attachments: string;
  backToList: string;
}

/**
 * 동문 인터뷰 상세 — 와이어프레임 확정본(동문 인터뷰 와이어프레임/detail.html) 그대로.
 *
 * 구성: 헤더(글 5fr / 사진 7fr) → 본문 열 1046px → '한 줄로' 상자 →
 * 이전·다음 인터뷰 → 다른 동문 인터뷰 3편 → 목록으로.
 * 모바일은 헤더가 사진 위·글 아래로 쌓이고, 관련 인터뷰는 1열이 된다.
 *
 * 인터뷰 정보가 없는 구 동문 소식은 이 컴포넌트로 오지 않는다 — 호출부(상세 페이지)가
 * 기존 PostArticle 경로로 떨어뜨린다.
 */
export function InterviewArticle({
  month,
  title,
  byline,
  excerpt,
  image,
  body,
  closingQ,
  closingA,
  prev,
  next,
  related,
  attachments,
  backHref,
  labels,
}: {
  /** 킥커의 연월 ('2026. 09') */
  month: string;
  title: string;
  byline: string;
  excerpt: string;
  image?: string;
  /** 정화 저장된 본문 HTML(에디터 산출물) */
  body: string;
  closingQ?: string;
  closingA?: string;
  /** 더 오래된 글(‹ 이전 인터뷰). 없으면 자리를 비운다 */
  prev?: InterviewNeighbor | null;
  /** 더 최신 글(다음 인터뷰 ›). 없으면 '가장 최신 인터뷰입니다' */
  next?: InterviewNeighbor | null;
  related: InterviewCard[];
  /** 첨부 — 라벨은 호출부가 로케일을 해석해 넘긴다 */
  attachments?: { label: string; href: string }[];
  backHref: string;
  labels: InterviewArticleLabels;
}) {
  // 캡션 사진(img[data-caption])을 figure/figcaption 으로 감싼다 — 저장 형식은 img
  // 한 형식이고 figure 는 공개 화면에서만 만든다(lib/post-body-figures.ts 주석).
  const bodyHtml = wrapCaptionedImages(body);
  const hasClosing = !!closingQ?.trim() && !!closingA?.trim();
  // 본문 열과 하단 묶음은 같은 폭(게시물 공통 1046) — 값의 출처는 lib/post-layout 하나다
  const columnStyle = { maxWidth: POST_BODY_WIDTH } as const;

  return (
    <article className="anim-panel">
      {/* ── 인터뷰 헤더 — 글 5 / 사진 7. 모바일은 사진이 위로 올라간다 ── */}
      <div className="grid items-stretch gap-8 md:grid-cols-[5fr_7fr] md:gap-14">
        <div className="order-2 flex flex-col justify-center md:order-none md:py-6">
          <p className="m-0 text-[12px] font-bold uppercase tracking-[0.12em] text-yonsei-blue">
            {labels.kicker}
            {month && <span className="mx-1.5">·</span>}
            {month}
          </p>
          {/* 이 문서의 대표 제목 — 히어로 제목(섹션명)은 p 로 낮춰 두었다 */}
          <h1 className="mt-4 text-pretty text-[26px] font-bold leading-[1.35] tracking-[-0.02em] text-content md:mt-[18px] md:text-[38px]">
            {title}
          </h1>
          {byline && (
            <p className="mt-4 text-[15px] font-semibold text-yonsei-navy md:mt-5 md:text-[17px]">
              {byline}
            </p>
          )}
          {excerpt && (
            <p className="mt-4 text-[15px] leading-[1.8] text-[#4A4A4A] md:mt-[22px] md:text-[17px] md:leading-[1.85]">
              {excerpt}
            </p>
          )}
          <span aria-hidden="true" className="mt-6 block h-[2px] w-10 bg-yonsei-navy md:mt-8" />
        </div>
        <InterviewPhoto
          src={image}
          priority
          iconSize={72}
          sizes="(min-width: 768px) 58vw, 100vw"
          className="order-1 h-[260px] w-full md:order-none md:h-auto md:min-h-[560px]"
        />
      </div>

      {/* ── 본문 열 1046 ── */}
      <div
        style={columnStyle}
        className={`prose-content prose-wide prose-interview ${styles.body} mx-auto mt-12 w-full md:mt-[72px]`}
        // 관리자 작성 + 서버 정화 산출물 — PostArticle 과 동일한 신뢰 전제
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />

      {/* ── 한 줄로 — 질문·답이 둘 다 있을 때만 ── */}
      {hasClosing && (
        <div
          style={columnStyle}
          className="mx-auto mt-12 w-full bg-surface-soft px-6 py-8 md:mt-16 md:px-10 md:py-9"
        >
          <p className="m-0 text-[13px] font-bold tracking-[0.14em] text-yonsei-blue">
            {labels.closing}
          </p>
          <p className="mt-2.5 text-[18px] font-semibold text-content md:text-[20px]">{closingQ}</p>
          <p className="mt-3 text-[16px] leading-[1.8] text-content md:text-[18px]">{closingA}</p>
        </div>
      )}

      {/* 첨부 — 인터뷰에 첨부를 다는 일은 드물지만, 관리자가 올린 파일이 화면에서
          조용히 사라지면 안 된다(공유·ZIP 버튼은 이 디자인에 없다: 와이어프레임 확정본). */}
      {attachments && attachments.length > 0 && (
        <div
          style={columnStyle}
          className="mx-auto mt-12 w-full border border-surface-border bg-surface-soft p-5"
        >
          <p className="text-xs font-bold uppercase tracking-wide text-content-faint">
            {labels.attachments}
          </p>
          <ul className="mt-3 space-y-2">
            {attachments.map((att, i) => {
              // 외부 스토리지(R2)·외부 링크는 새 탭에서 — 글 읽기 흐름 유지
              const external = /^https?:\/\//.test(att.href);
              return (
                <li key={`${att.href}-${i}`}>
                  <a
                    href={att.href}
                    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="inline-flex items-center gap-2.5 py-0.5 text-[15px] font-medium text-yonsei-blue hover:underline"
                  >
                    {att.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── 하단 — 이전/다음 · 다른 인터뷰 · 목록으로 ── */}
      <div style={columnStyle} className="mx-auto mt-12 w-full md:mt-[72px]">
        <div className="grid grid-cols-1 border-b border-t border-surface-border sm:grid-cols-2">
          <div className="py-5 md:py-6">
            {prev ? (
              <Link href={prev.href} className="group block">
                <span className="text-[12px] font-bold tracking-[0.14em] text-content-faint">
                  ‹ {labels.prev}
                </span>
                <span className="mt-2 block text-[17px] font-semibold text-content transition-colors group-hover:text-yonsei-navy">
                  {prev.title}
                </span>
                {prev.byline && (
                  <span className="mt-1.5 block text-[13px] font-semibold text-yonsei-navy">
                    {prev.byline}
                  </span>
                )}
              </Link>
            ) : (
              /* 가장 오래된 글 — 반대편은 비워 둔다(안내를 넣으면 양쪽이 다 말을 건다) */
              <span aria-hidden="true" />
            )}
          </div>
          <div className="border-t border-surface-border py-5 sm:border-l sm:border-t-0 sm:pl-8 sm:text-right md:py-6">
            <span className="text-[12px] font-bold tracking-[0.14em] text-content-faint">
              {labels.next} ›
            </span>
            {next ? (
              <Link href={next.href} className="group block">
                <span className="mt-2 block text-[17px] font-semibold text-content transition-colors group-hover:text-yonsei-navy">
                  {next.title}
                </span>
                {next.byline && (
                  <span className="mt-1.5 block text-[13px] font-semibold text-yonsei-navy">
                    {next.byline}
                  </span>
                )}
              </Link>
            ) : (
              <span className="mt-2 block text-[17px] font-semibold text-content-faint">
                {labels.latestNote}
              </span>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <div className="mt-12 md:mt-14">
            <h2
              style={{ fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif' }}
              className="m-0 border-b-2 border-yonsei-navy pb-3 text-[18px] font-semibold text-content md:text-[20px]"
            >
              {labels.related}
            </h2>
            <div className="mt-[18px] grid grid-cols-1 gap-7 sm:grid-cols-3">
              {related.map((card) => (
                <Link key={card.id} href={card.href} className="group block text-content">
                  <InterviewPhoto
                    src={card.image}
                    iconSize={32}
                    sizes="(min-width: 768px) 320px, 100vw"
                    className="aspect-square w-full"
                  />
                  <span className="mt-3 block text-[16px] font-semibold leading-[1.45] transition-colors group-hover:text-yonsei-navy">
                    {card.title}
                  </span>
                  {card.byline && (
                    <span className="mt-1.5 block text-[12px] font-semibold text-yonsei-navy">
                      {card.byline}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-10 flex justify-center md:mt-12">
          <Link
            href={backHref}
            className="inline-flex items-center border border-yonsei-navy px-7 py-3 text-[14px] font-semibold text-yonsei-navy transition-colors hover:bg-yonsei-navy hover:text-white"
          >
            {labels.backToList}
          </Link>
        </div>
      </div>
    </article>
  );
}
