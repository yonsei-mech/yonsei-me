import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pick, type Attachment } from '@/lib/content';
import { fetchBoardData } from '@/lib/posts';
import { boardPostHref } from '@/lib/board-links';
import { formatBytes } from '@/lib/files';
import { SectionTabPage, sectionTabMetadata } from '../../_shared/section-tabs';
import type { Locale } from '@/i18n/routing';

// 게시판(DB posts)을 읽으므로 다른 게시판 목록과 같은 ISR — revalidateTag('posts')가 즉시 갱신
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return sectionTabMetadata(params.locale, 'bk21', 'reports');
}

/** 첫 번째 PDF 첨부 — 뷰어와 같은 판정(확장자 우선, 라벨 폴백)을 쓴다. */
function firstPdf(atts: Attachment[] | undefined, locale: Locale): Attachment | undefined {
  return atts?.find(
    (a) => /\.pdf(\?|#|$)/i.test(a.href) || /\.pdf$/i.test(pick(a.label, locale).trim()),
  );
}

/**
 * BK21 FOUR › 사업계획서·보고서 — 게시판 `bk21Reports` 의 목록.
 *
 * 자료실(ResourceLibrary, "받아 가는 파일")과 달리 여기서는 **읽는 문서**라 표지 카드
 * 그리드다. 카드를 누르면 파일을 내려받는 대신 좌/우 펼침 PDF 리더로 들어간다
 * (상세 주소는 boardPostHref 가 단일 출처 — 손으로 조립하지 않는다).
 * 분류 **값**은 CMS 표(BK21_REPORT_CATEGORIES)가 단일 출처이고 라벨은 messages 라서,
 * 서버 컴포넌트인 이 자리에서 둘을 잇는다(클라이언트에 bk21 네임스페이스를 더 싣지 않는다).
 */
export default async function Bk21ReportsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;

  const [board, t, tStub] = await Promise.all([
    fetchBoardData(),
    getTranslations({ locale: params.locale, namespace: 'bk21' }),
    getTranslations({ locale: params.locale, namespace: 'stub' }),
  ]);
  const posts = board.bk21Reports;

  const categoryLabel = (value: string | undefined): string | null => {
    if (value === 'plan') return t('reports.categories.plan');
    if (value === 'self') return t('reports.categories.self');
    if (value === 'performance') return t('reports.categories.performance');
    return null;
  };

  return (
    <SectionTabPage locale={params.locale} section="bk21" tab="reports">
      <p className="max-w-[65ch] text-content-soft">{t('reports.intro')}</p>

      {posts.length === 0 ? (
        <p className="mt-8 text-content-faint">{tStub('empty')}</p>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-5 tab:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => {
            const title = pick(post.title, locale);
            const cat = categoryLabel(post.category);
            const pdf = firstPdf(post.attachments, locale);
            const size = formatBytes(pdf?.size);
            const note = post.excerpt ? pick(post.excerpt, locale).trim() : '';
            // 날짜는 YYYY-MM-DD — 문서는 연도 단위로 읽히므로 앞 4자리만 쓴다
            const year = (post.date ?? '').slice(0, 4);
            return (
              <li key={post.id}>
                <Link
                  href={boardPostHref({ id: post.id, boardKey: 'bk21Reports' })}
                  className="group flex h-full flex-col border border-surface-border bg-surface transition-colors hover:border-yonsei-blue/50"
                >
                  <div className="flex h-[260px] items-center justify-center overflow-hidden bg-surface-soft p-4">
                    {post.image ? (
                      // 표지는 가로·세로 두 비율이 섞여 있어 object-contain 으로 통일한다
                      // (cover 를 쓰면 세로로 긴 표지의 제목 줄이 잘려 나간다).
                      /* eslint-disable-next-line @next/next/no-img-element -- 원본이 R2 절대 URL 이라 next/image 도메인 등록 없이 그대로 쓴다(다른 R2 자산과 동일 관례) */
                      <img
                        src={post.image}
                        alt={title}
                        loading="lazy"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      // 표지가 없는 글 — 문서 아이콘 + 확장자 글자로 자리를 채운다
                      <span className="flex flex-col items-center gap-2 text-content-faint">
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          className="h-12 w-12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.25"
                        >
                          <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Z" />
                          <path d="M14 3v5h5" />
                        </svg>
                        <span className="text-xs font-semibold tracking-wider">PDF</span>
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 border-t border-surface-border p-5">
                    {cat && (
                      <span className="w-fit border border-yonsei-navy/40 px-1.5 py-0.5 text-[11px] font-semibold text-yonsei-navy">
                        {cat}
                      </span>
                    )}
                    <h3
                      className="text-lg font-bold text-content"
                      style={{ fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif' }}
                    >
                      {title}
                    </h3>
                    <p className="text-sm text-content-faint">
                      {[year, size ? t('reports.size', { size }) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {note && <p className="text-xs text-content-faint">{note}</p>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionTabPage>
  );
}
