import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { sectionTabHref } from '@/lib/board-links';
import { LandingScope } from '@/components/LandingScope';
import { formatPhone } from '@/lib/utils';
import { MailIcon, PhoneIcon } from '@/components/icons';
import { AiResearchSummary } from '@/components/AiResearchSummary';
import {
  FacultyActivityTabs,
  type FacultyActivityRow,
  type FacultyActivityTab,
} from '@/components/FacultyActivityTabs';
import { facultyInfoSystemUrl, type FacultyProfile, type FacultyRecord } from '@/lib/faculty';

/** "목록으로"가 돌아가는 곳 — 교수진 목록의 정본은 학부소개 › 교수진 탭이다. 예전의
 *  별도 페이지(/faculty)는 상단 바가 섹션 드롭다운 없는 축소판이라 돌아온 사용자가
 *  소개 섹션의 다른 탭으로 갈 길을 잃었다(사용자 신고). 상세의 브레드크럼·상단 바도 같은 곳. */
const FACULTY_LIST_HREF = sectionTabHref('about', 'faculty');

/** 외부 링크 화살표 (장식) */
function ExternalIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      className={className}
    >
      <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "2025-12" → "2025.12", "2024-04-18" → "2024.04". 형식이 다르면 원문 한 줄. */
function monthStamp(raw: string | null): string[] {
  if (!raw) return [];
  const m = raw.match(/^(\d{4})[-.](\d{1,2})/);
  return m ? [`${m[1]}.${m[2].padStart(2, '0')}`] : [raw];
}

/** "2023.08.21~2023.08.25" · "2026-03-01~2027-02-28" → 시작·끝 연도.
 *  `~` 로 나눠 각 조각의 첫 4자리를 취하고, 같은 해면 한 줄로 접는다. */
function periodYears(raw: string | null): string[] {
  if (!raw) return [];
  const [head, tail] = raw.split('~');
  const start = head?.match(/\d{4}/)?.[0];
  if (!start) return [raw];
  const end = tail?.match(/\d{4}/)?.[0];
  return !end || end === start ? [start] : [start, end];
}

/** null·빈 문자열 조각을 걸러 " · " 로 잇는다. 남는 게 없으면 메타 줄 생략(null). */
function joinMeta(...parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter((p): p is string => Boolean(p && p.trim()));
  return kept.length > 0 ? kept.join(' · ') : null;
}

function buildRows(profile: FacultyProfile): Record<string, FacultyActivityRow[]> {
  return {
    articles: profile.articles.map<FacultyActivityRow>((r) => ({
      years: monthStamp(r.date),
      title: r.title,
      meta: joinMeta(r.journal),
    })),
    fundings: profile.fundings.map<FacultyActivityRow>((r) => ({
      years: periodYears(r.period),
      title: r.title,
      meta: joinMeta(r.org),
    })),
    patents: profile.patents.map<FacultyActivityRow>((r) => ({
      years: monthStamp(r.date),
      title: r.title,
      meta: joinMeta(r.type, r.applicant),
    })),
    awards: profile.awards.map<FacultyActivityRow>((r) => ({
      years: monthStamp(r.date),
      title: r.title,
      meta: joinMeta(r.contents),
    })),
    conferences: profile.conferences.map<FacultyActivityRow>((r) => ({
      years: periodYears(r.period),
      title: r.title,
      meta: joinMeta(r.conference),
    })),
  };
}

/** 탭 순서(사용자 지시): 논문 → 연구과제 → 지적재산권 → 수상 → 학술활동 */
const TAB_IDS = ['articles', 'fundings', 'patents', 'awards', 'conferences'] as const;

/**
 * 교수 개인 상세 본문 — 프로필 카드(사진 + 연락처·소속) + 학술활동 탭.
 *
 * 데이터가 두 소스로 나뉜다: 학술활동·오피스·홈페이지는 faculty-profiles 의
 * `profile`, 직위·보직·연구실·사진은 faculty-directory 의 `record`.
 * record 가 없어도(이름 불일치) 카드는 프로필만으로 렌더된다.
 */
export async function FacultyProfileArticle({
  profile,
  record,
  locale,
  aiSummary,
  titleTag = 'h2',
}: {
  profile: FacultyProfile;
  record: FacultyRecord | null;
  locale: string;
  /** 교수 이름 제목의 요소. 기본 'h2'(히어로 '교수진' 이 h1 인 기존 구조). 상세 페이지는
   *  히어로를 p 로 낮추고 'h1' 을 넘겨 이름을 문서의 대표 제목으로 삼는다 — 한 문서에
   *  큰 제목이 둘이면 구글이 검색결과 제목을 임의로 고른다. 클래스는 같아 시각 변화 없음. */
  titleTag?: 'h1' | 'h2';
  /** CMS 가 관리하는 AI 연구요약(content/faculty-summaries.json, 로케일 해석 완료).
   *  이쪽이 원본이고, 넘어오지 않으면 크롤 파일에 남은 옛 aiSummary 로 폴백한다. */
  aiSummary?: string | null;
}) {
  const t = await getTranslations({ locale, namespace: 'faculty' });
  const NameTag = titleTag;
  const rows = buildRows(profile);
  const tabs: FacultyActivityTab[] = TAB_IDS.map((id) => ({
    id,
    label: t(`profile.tabs.${id}`),
    rows: rows[id],
  }));

  // 전화번호는 교수진 목록과 같은 값을 우선한다 — 디렉터리 쪽이 사람이 정리한 표기라
  // 목록과 상세가 어긋나지 않는다. 없으면(디렉터리에 비어 있는 5명) 크롤 값을 같은
  // 꼴로 정규화한다. 크롤 원문은 내선만("2819") 오는 경우가 있어 그대로 쓰면 깨져 보인다.
  const phone = formatPhone(record?.phone ?? profile.phone);

  // 요약 원본은 CMS 파일 → 없으면 크롤 파일의 옛 값. 둘 다 비면 버튼 자체를 그리지 않는다.
  const summary = (aiSummary ?? profile.aiSummary ?? '').trim();

  // 학술활동은 **기본 비노출**이다 — 실적 공개 여부가 교수 개인의 선택이라, 본 사이트는
  // 교원정보시스템으로 넘기고 공개를 원하는 교수만 CMS 에서 켠다(2026-08 학부 방침).
  const showActivities = record?.showActivities === true;
  const infoSystemUrl = facultyInfoSystemUrl(record, profile.sourceUrl);

  // 라벨 칸 폭 — 한국어 라벨('소속' 등)은 64px 로 충분하지만 영어 "Department"(≈90px)는
  // 칸을 넘어 전역 overflow-wrap:break-word 에 걸려 단어가 꺾인다. en 로케일만 넓힌다.
  const dtClass = `${locale === 'en' ? 'w-24' : 'w-16'} shrink-0 font-bold text-content`;

  // 보직 배지 — en 로케일은 영문 표기(roleEn)를 우선하고 없으면 한국어로 폴백
  const roleLabel = record ? (locale === 'en' && record.roleEn) || record.role : null;

  const lab = record?.lab;
  const labName = lab?.nameKo
    ? lab.nameEn
      ? `${lab.nameKo} (${lab.nameEn})`
      : lab.nameKo
    : null;

  return (
    <LandingScope name="faculty-profile">
      {/* 상단 목록 버튼 — 하단의 것과 같은 버튼을 본문 맨 앞에도 둔다. 이력이 수백 행이라
          하단 버튼만으로는 돌아가려고 끝까지 스크롤해야 한다. 탈출구는 즉시 보여야 하므로
          data-land 를 붙이지 않는다(랜딩 애니메이션 동안 숨지 않게). */}
      <div className="mb-[30px]">
        <Link
          href={FACULTY_LIST_HREF}
          className="inline-flex items-center gap-2 border border-surface-border px-6 py-3 text-sm font-semibold text-content transition-colors hover:border-yonsei-blue hover:text-yonsei-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
        >
          <span aria-hidden="true">←</span>
          {t('profile.backToList')}
        </Link>
      </div>

      {/* ── 프로필 카드 ── 사진(좌) + 정보(우). 좁은 화면에서는 줄바꿈으로 세로 적층 */}
      <div
        data-land="rise"
        data-land-order="0"
        className="flex flex-wrap gap-6 border border-surface-border bg-surface p-6 sm:gap-10 sm:p-8 lg:p-10"
      >
        {record?.photo ? (
          <div className="relative aspect-[3/4] w-[150px] shrink-0 overflow-hidden bg-surface-soft sm:w-[clamp(180px,22vw,240px)]">
            <Image
              src={record.photo}
              alt={record.photoAlt || profile.name}
              fill
              sizes="(min-width: 640px) 240px, 150px"
              className="object-cover"
              priority
            />
          </div>
        ) : (
          // 사진 폴백 — 단색 네이비 + 이름 첫 글자(그라디언트 배제, 사용자 정책)
          <div
            role="img"
            aria-label={profile.name}
            className="flex aspect-[3/4] w-[150px] shrink-0 items-center justify-center bg-yonsei-navy sm:w-[clamp(180px,22vw,240px)]"
          >
            <span aria-hidden="true" className="text-5xl font-bold text-white/25">
              {profile.name.charAt(0)}
            </span>
          </div>
        )}

        <div className="flex min-w-0 flex-1 basis-[320px] flex-col">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <NameTag className="text-2xl font-bold text-content sm:text-[2rem]">{profile.name}</NameTag>
            {profile.nameEn && <p className="text-base text-content-faint">{profile.nameEn}</p>}
            {roleLabel && (
              <span className="bg-yonsei-blue/10 px-2 py-0.5 text-xs font-semibold text-yonsei-blue">
                {roleLabel}
              </span>
            )}
          </div>
          {record?.title && <p className="mt-1 text-[17px] text-content-soft">{record.title}</p>}

          {/* 연락처 행 — 전화·이메일 픽토그램(교수진 목록 카드와 같은 문법) */}
          {(phone || profile.email) && (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-surface-border pt-4 text-sm">
              {phone && (
                <span className="inline-flex items-center gap-1.5 text-content-soft">
                  <PhoneIcon />
                  <span className="sr-only">{t('phoneLabel')}: </span>
                  {phone}
                </span>
              )}
              {profile.email && (
                <a
                  href={`mailto:${profile.email}`}
                  className="inline-flex min-w-0 items-center gap-1.5 text-yonsei-blue hover:underline"
                >
                  <MailIcon />
                  <span className="sr-only">{t('emailLabel')}: </span>
                  <span className="truncate">{profile.email}</span>
                </a>
              )}
            </div>
          )}

          <dl className="mt-5 flex flex-col gap-[9px] text-[15px]">
            <div className="flex items-start gap-3">
              <dt className={dtClass}>{t('profile.campusLabel')}</dt>
              <dd className="min-w-0 text-content-soft">{t('profile.campusValue')}</dd>
            </div>
            <div className="flex items-start gap-3">
              <dt className={dtClass}>{t('profile.deptLabel')}</dt>
              <dd className="min-w-0 text-content-soft">{t('profile.deptValue')}</dd>
            </div>
            {profile.office && (
              <div className="flex items-start gap-3">
                <dt className={dtClass}>{t('profile.officeLabel')}</dt>
                <dd className="min-w-0 text-content-soft">{profile.office}</dd>
              </div>
            )}
            {labName && (
              <div className="flex items-start gap-3">
                <dt className={dtClass}>{t('profile.labLabel')}</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-2 text-content-soft">
                  <span>{labName}</span>
                  {lab?.url && (
                    <a
                      href={lab.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('labLink', { lab: lab.nameKo })}
                      title={t('labLink', { lab: lab.nameKo })}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center border border-surface-border text-yonsei-blue transition-colors hover:border-yonsei-blue hover:bg-yonsei-blue hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
                    >
                      <ExternalIcon className="h-3 w-3" />
                    </a>
                  )}
                </dd>
              </div>
            )}
          </dl>

          {/* 바깥 링크 두 개 — 개인 홈페이지, 그리고 실적을 보러 가는 교원정보시스템.
              실적은 이 사이트에 싣지 않는 것이 기본이라(공개 여부는 교수 개인의 선택),
              여기가 논문·연구과제로 가는 정규 경로다. */}
          {(profile.homepage || infoSystemUrl) && (
            <div className="mt-auto flex flex-wrap gap-3 pt-6">
              {profile.homepage && (
                <a
                  href={profile.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-surface-border px-6 py-2.5 text-sm font-semibold text-content transition-colors hover:border-yonsei-blue hover:text-yonsei-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
                >
                  {t('profile.homepage')}
                  <ExternalIcon className="h-3.5 w-3.5" />
                </a>
              )}
              {infoSystemUrl && (
                <a
                  href={infoSystemUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t('profile.infoSystemHint')}
                  className="inline-flex items-center gap-2 border border-yonsei-blue bg-yonsei-blue px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-yonsei-navy hover:border-yonsei-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
                >
                  {t('profile.infoSystem')}
                  <ExternalIcon className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── AI 연구요약 ── 학술활동 노출 여부와 무관하게 항상 보인다. 실적 표를 내리더라도
          "이 교수가 무엇을 연구하는가"는 남아야 하고, 요약은 학부가 관리하는 문장이다. */}
      {summary && (
        <div className="mt-12 sm:mt-16">
          <p data-land="rise" data-land-order="1" className="eyebrow">
            {t('profile.researchEyebrow')}
          </p>
          {/* 버튼과 패널은 형제다 — 패널이 basis-full 이라 flex-wrap 이 다음 줄로 내려
              제목 행 아래 전폭으로 펼쳐진다 */}
          <div className="mt-3 flex flex-wrap items-center gap-5">
            <h2
              data-land="rise"
              data-land-order="1"
              className="text-2xl font-bold text-content sm:text-[2rem]"
            >
              {t('profile.researchTitle')}
            </h2>
            <AiResearchSummary
              summary={summary}
              buttonLabel={t('profile.aiButton')}
              panelLabel={t('profile.aiPanelLabel')}
              betaLabel={t('profile.aiBeta')}
              disclaimer={t('profile.aiDisclaimer')}
            />
          </div>
        </div>
      )}

      {/* ── 학술활동 ── 기본 비노출. CMS 의 "학술활동 사이트에 공개"를 켠 교수만 표가 뜨고,
          나머지는 교원정보시스템으로 안내하는 한 줄만 남는다. */}
      {showActivities ? (
        <div className="mt-12 sm:mt-16">
          <p data-land="rise" data-land-order="1" className="eyebrow">
            {t('profile.activitiesEyebrow')}
          </p>
          <h2
            data-land="rise"
            data-land-order="1"
            className="mt-3 text-2xl font-bold text-content sm:text-[2rem]"
          >
            {t('profile.activitiesTitle')}
          </h2>
          <div className="mt-6">
            <FacultyActivityTabs
              tabs={tabs}
              emptyLabel={t('profile.emptySection')}
              ariaLabel={t('profile.activitiesNav')}
            />
          </div>
        </div>
      ) : (
        infoSystemUrl && (
          <div
            data-land="rise"
            data-land-order="1"
            className="mt-12 border border-surface-border bg-surface-soft p-6 sm:mt-16 sm:p-8"
          >
            <h2 className="text-lg font-bold text-content">{t('profile.activitiesTitle')}</h2>
            <p className="mt-2 max-w-[64ch] text-[15px] leading-relaxed text-content-soft">
              {t('profile.activitiesOffNotice')}
            </p>
            <a
              href={infoSystemUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 border border-yonsei-blue px-6 py-2.5 text-sm font-semibold text-yonsei-blue transition-colors hover:bg-yonsei-blue hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
            >
              {t('profile.infoSystem')}
              <ExternalIcon className="h-3.5 w-3.5" />
            </a>
          </div>
        )
      )}

      <div className="mt-10">
        <Link
          href={FACULTY_LIST_HREF}
          className="inline-flex items-center gap-2 border border-surface-border px-6 py-3 text-sm font-semibold text-content transition-colors hover:border-yonsei-blue hover:text-yonsei-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yonsei-blue"
        >
          <span aria-hidden="true">←</span>
          {t('profile.backToList')}
        </Link>
      </div>
    </LandingScope>
  );
}
