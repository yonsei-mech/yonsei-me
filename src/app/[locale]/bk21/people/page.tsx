import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pick } from '@/lib/content';
import {
  getBk21EarlyCareerRuntime,
  getBk21StudentsRuntime,
  getFacultyDirectoryRuntime,
  type Bk21StudentRecord,
} from '@/lib/content-runtime';
import { getFacultyProfileNames } from '@/lib/faculty';
import { cn } from '@/lib/utils';
import { SectionTabPage, sectionTabMetadata } from '../../_shared/section-tabs';
import type { Locale } from '@/i18n/routing';

// 콘텐츠 소스 전환(Stage A): 세 블록 전부 데이터 레이어를 읽는다 — ISR 안전망
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  return sectionTabMetadata(params.locale, 'bk21', 'people');
}

/** 블록 제목 — .prose-content h2 와 같은 크기·여백(첫 블록만 위 여백 없음). 서체는 탭 제목
 *  (TabPageShell)과 같은 Paperlogy(--font-subhead)로 통일한다(사용자 지시). */
const H2 = 'max-w-3xl text-3xl font-bold leading-tight tracking-tight text-content sm:text-4xl';
const H2_STYLE = { fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif' } as const;
/** 표 머리 셀 — 교직원 표와 같은 문법(배경 없는 작은 헤더) */
const TH = 'whitespace-nowrap px-3 py-3.5 text-xs font-bold text-content-faint';
/** 표 본문 셀 */
const TD = 'whitespace-nowrap border-b border-surface-border px-3 py-4 text-content-soft';
/** 세로 구분선 — 참여대학원생 표의 사업연도·연도·학기 열 오른쪽(사용자 지시) */
const VR = 'border-r border-surface-border';

/**
 * 연속한 같은 값의 묶음 길이 — rowSpan 값. 묶음의 첫 행에만 숫자가 들어가고
 * 나머지 행은 null(셀 자체를 그리지 않는다)이라, 구 사이트 표와 같은 모양이 된다.
 */
function rowSpans(values: (string | number)[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i > 0 && values[i] === values[i - 1]) {
      out.push(null);
      continue;
    }
    let n = 1;
    while (i + n < values.length && values[i + n] === values[i]) n += 1;
    out.push(n);
  }
  return out;
}

/** 합계는 저장하지 않고 여기서 더한다 — 저장한 합계는 언젠가 반드시 어긋난다 */
const participating = (r: Bk21StudentRecord) => r.pMs + r.pPhd + r.pInt;
const supported = (r: Bk21StudentRecord) => r.sMs + r.sPhd + r.sInt;

/**
 * BK21 FOUR › 참여인력 — 참여교수 · 신진연구인력 · 참여대학원생 세 블록.
 *
 * 참여교수 명단은 교수진 인명록(content/faculty-directory.json)의 `bk21` 플래그로
 * 걸러 **명단 표**로 그린다(사용자 지시 — 구 사이트의 연번·교수명 표와 같은 성격의
 * 명단이지 교수진 카드 화면의 반복이 아니다). 데이터를 따로 두지 않는 이유는 같다 —
 * 교수 한 명의 정보가 두 파일로 갈리면 이름·전공이 서로 어긋난다. 이름은 상세
 * 페이지(/faculty/<이름>)가 있는 교수만 링크한다.
 */
export default async function Bk21PeoplePage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const locale = params.locale as Locale;
  const isEn = locale === 'en';
  const [t, faculty, earlyCareer, students] = await Promise.all([
    getTranslations({ locale: params.locale, namespace: 'bk21' }),
    getFacultyDirectoryRuntime(),
    getBk21EarlyCareerRuntime(),
    getBk21StudentsRuntime(),
  ]);

  // 구 사이트 명단과 같은 가나다순(한국어 이름 기준 — 영문 화면도 같은 순서를 유지한다)
  const bk21Faculty = faculty
    .filter((f) => f.bk21)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const profileSet = new Set(getFacultyProfileNames());

  const phaseSpans = rowSpans(students.map((r) => r.phase));
  const yearSpans = rowSpans(students.map((r) => r.year));

  return (
    <SectionTabPage locale={params.locale} section="bk21" tab="people">
      <h2 className={cn(H2, 'mt-0')} style={H2_STYLE}>
        {t('people.faculty')}
      </h2>
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-[15px]">
          <caption className="sr-only">{t('people.facultyTable.caption')}</caption>
          <thead className="border-b border-t-2 border-surface-border border-t-yonsei-navy">
            <tr>
              <th scope="col" className={cn(TH, 'w-12 text-right')}>
                {t('people.facultyTable.no')}
              </th>
              <th scope="col" className={cn(TH, 'text-left')}>
                {t('people.facultyTable.name')}
              </th>
              <th scope="col" className={cn(TH, 'text-left')}>
                {t('people.facultyTable.title')}
              </th>
              <th scope="col" className={cn(TH, 'text-left')}>
                {t('people.facultyTable.lab')}
              </th>
            </tr>
          </thead>
          <tbody>
            {bk21Faculty.map((f, i) => {
              const name = isEn && f.nameEn ? f.nameEn : f.name;
              // 전공(specialty)은 인명록에 거의 비어 있어 연구실명을 쓴다(29명 전원 보유)
              const labName = f.lab ? (isEn && f.lab.nameEn) || f.lab.nameKo : null;
              return (
                <tr key={f.name}>
                  <td className={cn(TD, 'text-right tabular-nums')}>{i + 1}</td>
                  <th scope="row" className={cn(TD, 'text-left font-semibold text-content')}>
                    {profileSet.has(f.name) ? (
                      <Link
                        href={`/faculty/${encodeURIComponent(f.name)}`}
                        className="underline-offset-2 hover:text-yonsei-blue hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </th>
                  <td className={TD}>{f.title}</td>
                  <td className={cn(TD, 'whitespace-normal')}>
                    {labName && f.lab?.url ? (
                      <a
                        href={f.lab.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-2 hover:text-yonsei-blue hover:underline"
                      >
                        {labName}
                      </a>
                    ) : (
                      labName ?? ''
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className={cn(H2, 'mt-16')} style={H2_STYLE}>
        {t('people.earlyCareer')}
      </h2>
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[320px] max-w-xl text-left text-[15px]">
          <caption className="sr-only">{t('people.earlyCareerTable.caption')}</caption>
          <thead className="border-b border-t-2 border-surface-border border-t-yonsei-navy">
            <tr>
              <th scope="col" className={cn(TH, 'text-left')}>
                {t('people.earlyCareerTable.kind')}
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                {t('people.earlyCareerTable.count')}
              </th>
            </tr>
          </thead>
          <tbody>
            {earlyCareer.map((row) => (
              <tr key={row.kind.ko}>
                <th scope="row" className={cn(TD, 'text-left font-semibold text-content')}>
                  {pick(row.kind, locale)}
                </th>
                <td className={cn(TD, 'text-right tabular-nums')}>
                  {row.count}
                  {t('people.earlyCareerTable.unit')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className={cn(H2, 'mt-16')} style={H2_STYLE}>
        {t('people.students')}
      </h2>
      {/* 열이 11개라 좁은 화면에서는 표만 가로로 스크롤된다(페이지 본문은 넘치지 않는다).
          모든 셀 가운데 정렬 + 사업연도·연도·학기 열 오른쪽 세로 구분선(사용자 지시). */}
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[760px] text-center text-[15px]">
          <caption className="sr-only">{t('people.studentTable.caption')}</caption>
          <thead className="border-b border-t-2 border-surface-border border-t-yonsei-navy">
            <tr>
              <th scope="col" rowSpan={2} className={cn(TH, VR, 'text-center align-bottom')}>
                {t('people.studentTable.phase')}
              </th>
              <th scope="col" rowSpan={2} className={cn(TH, VR, 'text-center align-bottom')}>
                {t('people.studentTable.year')}
              </th>
              <th scope="col" rowSpan={2} className={cn(TH, VR, 'text-center align-bottom')}>
                {t('people.studentTable.term')}
              </th>
              <th
                scope="colgroup"
                colSpan={4}
                className={cn(TH, 'border-b border-surface-border text-center')}
              >
                {t('people.studentTable.participating')}
              </th>
              <th
                scope="colgroup"
                colSpan={4}
                className={cn(TH, 'border-b border-l border-surface-border text-center')}
              >
                {t('people.studentTable.supported')}
              </th>
            </tr>
            <tr>
              {(['ms', 'phd', 'integrated', 'total'] as const).map((k) => (
                <th key={`p-${k}`} scope="col" className={cn(TH, 'text-center')}>
                  {t(`people.studentTable.${k}`)}
                </th>
              ))}
              {(['ms', 'phd', 'integrated', 'total'] as const).map((k, i) => (
                <th
                  key={`s-${k}`}
                  scope="col"
                  className={cn(TH, 'text-center', i === 0 && 'border-l border-surface-border')}
                >
                  {t(`people.studentTable.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((r, i) => (
              <tr key={`${r.year}-${r.term}`}>
                {phaseSpans[i] !== null && (
                  <th
                    scope="rowgroup"
                    rowSpan={phaseSpans[i] ?? 1}
                    className={cn(TD, VR, 'text-center align-middle font-semibold text-content')}
                  >
                    {t('people.studentTable.phaseValue', { n: r.phase })}
                  </th>
                )}
                {yearSpans[i] !== null && (
                  <td
                    rowSpan={yearSpans[i] ?? 1}
                    className={cn(TD, VR, 'text-center align-middle tabular-nums')}
                  >
                    {r.year}
                  </td>
                )}
                <td className={cn(TD, VR, 'text-center tabular-nums')}>
                  {t('people.studentTable.termValue', { n: r.term })}
                </td>
                <td className={cn(TD, 'text-center tabular-nums')}>{r.pMs}</td>
                <td className={cn(TD, 'text-center tabular-nums')}>{r.pPhd}</td>
                <td className={cn(TD, 'text-center tabular-nums')}>{r.pInt}</td>
                <td className={cn(TD, 'text-center font-semibold tabular-nums text-content')}>
                  {participating(r)}
                </td>
                <td className={cn(TD, 'border-l border-surface-border text-center tabular-nums')}>
                  {r.sMs}
                </td>
                <td className={cn(TD, 'text-center tabular-nums')}>{r.sPhd}</td>
                <td className={cn(TD, 'text-center tabular-nums')}>{r.sInt}</td>
                <td className={cn(TD, 'text-center font-semibold tabular-nums text-content')}>
                  {supported(r)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionTabPage>
  );
}
