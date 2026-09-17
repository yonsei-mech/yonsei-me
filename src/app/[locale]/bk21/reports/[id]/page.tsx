import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, permanentRedirect } from 'next/navigation';
import { marked } from 'marked';
import { pick, type Attachment } from '@/lib/content';
import { fetchBoardPost, postsBodyFormat } from '@/lib/posts';
import { boardPostHref, sectionTabHref } from '@/lib/board-links';
import { fileFormat, formatBytes } from '@/lib/files';
import { PdfSpreadReader } from '@/components/PdfSpreadReader';
import { boardPostMetadata } from '../../../news/_shared/BoardPostDetail';
import { SectionTabPage } from '../../../_shared/section-tabs';
import type { Locale } from '@/i18n/routing';

// 게시판(DB posts)을 읽으므로 다른 게시판 상세와 같은 ISR — revalidateTag('posts')가 즉시 갱신
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string; id: string };
}): Promise<Metadata> {
  // 공용 빌더를 그대로 쓴다 — 제목·요약·hreflang 판정 기준이 사이트맵·다른 게시판과 같아야 한다
  return boardPostMetadata({ locale: params.locale, id: params.id, board: 'bk21Reports' });
}

/** PDF 첨부 판정 — URL 확장자가 먼저, 없으면 라벨(레거시 첨부는 경로에 확장자가 없다) */
function isPdf(a: Attachment, locale: Locale): boolean {
  return /\.pdf(\?|#|$)/i.test(a.href) || /\.pdf$/i.test(pick(a.label, locale).trim());
}

/**
 * BK21 FOUR › 사업계획서·보고서 글 상세 — **글이 아니라 문서 뷰어**다.
 *
 * 같은 게시판이지만 공용 상세(BoardPostDetail)를 쓰지 않는다: 본문이 첨부 PDF 자체라
 * 본문·첨부 목록·이전/다음 글을 세로로 쌓는 문법이 맞지 않는다. 대신 규약은 그대로
 * 따른다 — 없는 글은 404, 다른 게시판의 글이 이 주소로 오면 제 주소로 308(같은 글이
 * 여러 URL 로 열리는 중복 차단), 메타는 boardPostMetadata 한 출처.
 *
 * 껍데기는 SectionTabPage 를 쓰되 title/crumbLeaf 로 h1·크럼 리프를 탭 라벨 대신 글
 * 제목으로 바꾼다. 리더 라벨은 여기서 bk21 네임스페이스를 읽어 props 로 내린다 —
 * 클라이언트 번들에 새 메시지 네임스페이스를 싣지 않기 위해서다(check:i18n).
 */
export default async function Bk21ReportViewerPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  const post = await fetchBoardPost(params.id);
  if (!post) notFound();
  if (post.boardKey !== 'bk21Reports') {
    permanentRedirect(`/${params.locale}${boardPostHref(post)}`);
  }

  const [t, tNews] = await Promise.all([
    getTranslations({ locale, namespace: 'bk21' }),
    getTranslations({ locale, namespace: 'news' }),
  ]);

  const title = pick(post.title, locale);
  const atts = post.attachments ?? [];
  const pdf = atts.find((a) => isPdf(a, locale));
  // ⚠️ 첫 PDF 만 빼는 게 아니라 **PDF 는 전부** 뺀다 — 이 게시판의 문서는 보안상 화면에서
  // 읽기만 허용하므로(2026-09 학과 요청) 내려받기 링크가 남을 자리를 만들지 않는다.
  // 서식·한글 파일 같은 비(非)PDF 첨부는 그대로 내려받을 수 있다.
  const rest = atts.filter((a) => !isPdf(a, locale));
  const note = post.excerpt ? pick(post.excerpt, locale).trim() : '';
  const body = pick(post.body, locale);
  const backHref = sectionTabHref('bk21', 'reports');

  return (
    <SectionTabPage
      locale={params.locale}
      section="bk21"
      tab="reports"
      title={title}
      crumbLeaf={title}
    >
      {pdf ? (
        <PdfSpreadReader
          url={pdf.href}
          note={note || undefined}
          backHref={backHref}
          labels={{
            back: t('reports.reader.back'),
            prev: t('reports.reader.prev'),
            next: t('reports.reader.next'),
            // spread/single/pageAlt 는 쪽을 넘길 때마다 값이 바뀌므로 자리표시자를 그대로
            // 넘겨 클라이언트가 채운다 — t() 로 부르면 인자 없는 ICU 자리표시자를 포맷
            // 오류로 보고 키 경로 문자열을 돌려준다. t.raw() 로 우회한다.
            spread: t.raw('reports.reader.spread'),
            single: t.raw('reports.reader.single'),
            pageAlt: t.raw('reports.reader.pageAlt'),
            jump: t('reports.reader.jump'),
            zoomIn: t('reports.reader.zoomIn'),
            zoomOut: t('reports.reader.zoomOut'),
            zoomFit: t('reports.reader.zoomFit'),
            loading: t('reports.reader.loading'),
            error: t('reports.reader.error'),
          }}
        />
      ) : (
        <>
          <p className="text-content-soft">{t('reports.reader.noPdf')}</p>
          {body.trim() !== '' && (
            <div
              className="prose-content prose-wide mt-6"
              // DB 소스의 본문은 저장 시 정화된 HTML(sanitize.ts), git 폴백은 마크다운 —
              // PostArticle 의 bodyFormat 분기와 같은 규칙을 그대로 쓴다.
              dangerouslySetInnerHTML={{
                __html:
                  postsBodyFormat() === 'html' ? body : (marked.parse(body) as string),
              }}
            />
          )}
        </>
      )}

      {rest.length > 0 && (
        <section className="mt-8 border-t border-surface-border pt-6">
          <h2
            className="text-sm font-bold text-content"
            style={{ fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif' }}
          >
            {tNews('detail.attachmentsLabel')}
          </h2>
          <ul className="mt-3 space-y-2">
            {rest.map((a) => {
              const label = pick(a.label, locale);
              const meta = [fileFormat(label, a.href), formatBytes(a.size)]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={a.href}>
                  <a
                    href={a.href}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-yonsei-blue hover:underline"
                  >
                    {label}
                  </a>
                  {meta && <span className="ml-2 text-xs text-content-faint">{meta}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </SectionTabPage>
  );
}
