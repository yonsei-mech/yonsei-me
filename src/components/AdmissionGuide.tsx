import guide from '@content/admission-guide.json';
import { pick } from '@/lib/content';
import { LandingScope } from '@/components/LandingScope';
import { AdmissionCalendar } from '@/components/AdmissionCalendar';
import type { Locale } from '@/i18n/routing';

/** content/admission-guide.json 의 형태 */
export interface GuideSection {
  /** 섹션 순번. 단일 섹션(동문회 소개 등)에서는 생략 — 룰만 남고 번호는 찍히지 않는다 */
  num?: string;
  /** 좌측 그래픽 — 'logo'(연세 엠블럼 logo.svg) | 'eagle'(독수리 실루엣 eagle.webp 마스크) */
  graphic: 'logo' | 'eagle';
  title: { ko: string; en: string };
  body: { ko: string; en: string };
  notes: { ko: string; en: string }[];
  buttons: { label: { ko: string; en: string }; href: string }[];
}

const sections = (guide as { sections: GuideSection[] }).sections;

/**
 * 입학 안내 탭 — 홍익대 조형대학 '입학안내' 레퍼런스를 연세 톤으로 옮긴 구성.
 * 섹션마다: 번호 + 네이비 룰(전폭) → 2단(좌: 대형 제목 + 그래픽 / 우: 본문 + 회색
 * 보조 문단 + 각진 아웃라인 버튼들). 그래픽은 레퍼런스의 도형 대신 학부 정체성:
 * 학부 = 연세 엠블럼(logo.svg), 대학원 = 독수리 실루엣(eagle-mask, 네이비 틴트).
 * 문안·버튼은 content/admission-guide.json 에서 공급(콘텐츠/코드 분리) —
 * 버튼 href 는 추후 실제 입학처 링크로 교체 예정(현재 '#' 플레이스홀더).
 * 렌더러는 GuideSections 로 분리해 두었다 — 동문 탭(총동문회 안내) 등에서
 * 같은 형태의 JSON 을 다른 landingName 으로 재사용한다.
 */
export function GuideSections({
  sections,
  locale,
  landingName,
}: {
  sections: GuideSection[];
  locale: Locale;
  landingName: string;
}) {
  return (
    <LandingScope name={landingName}>
      <div className="space-y-24">
        {/* 랜딩 순서(data-land-order) — 섹션마다 10단위로 띄워 학부 → 대학원이 각각
            "룰이 그어지며 번호 노출 → 제목 → 엠블럼이 차오름 → 본문 → 버튼"으로 전개된다.
            둘째 섹션은 대개 화면 밖이라 훅이 알아서 ScrollTrigger 로 넘긴다. */}
        {sections.map((sec, si) => (
        <section key={si} aria-label={pick(sec.title, locale)}>
          {/* 번호 + 전폭 네이비 룰 (레퍼런스의 1/2 헤어라인).
              num 이 없으면 룰만 긋는다 — 섹션이 하나뿐인 곳에서 홀로 선 '1'은
              순번이 아니라 정체불명의 숫자로 읽힌다 */}
          <div
            data-land="wipe"
            data-land-order={si * 10}
            className={
              sec.num
                ? 'border-b-2 border-yonsei-navy pb-2 text-sm font-bold text-content'
                : 'border-b-2 border-yonsei-navy'
            }
          >
            {sec.num}
          </div>

          <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
            {/* 좌: 대형 제목 + 그래픽 */}
            <div>
              <h3
                data-land="rise"
                data-land-order={si * 10 + 1}
                className="text-3xl font-black tracking-tight text-content sm:text-4xl"
              >
                {pick(sec.title, locale)}
              </h3>
              {/* 학부 엠블럼 / 대학원 독수리 — 아래에서 위로 차오르며 등장 */}
              <div className="mt-10" data-land="wipe" data-land-from="bottom" data-land-order={si * 10 + 3}>
                {sec.graphic === 'logo' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/logo.svg" alt="" aria-hidden="true" className="h-24 w-auto sm:h-28" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="eagle-mask block h-24 w-28 bg-yonsei-navy sm:h-28 sm:w-32"
                  />
                )}
              </div>
            </div>

            {/* 우: 본문 + 보조 문단 + 버튼 */}
            <div>
              <p
                data-land="rise"
                data-land-order={si * 10 + 2}
                className="text-base leading-[1.9] text-content sm:text-lg"
              >
                {pick(sec.body, locale)}
              </p>
              <div className="mt-8 space-y-3">
                {sec.notes.map((note, i) => (
                  <p
                    key={i}
                    data-land="rise"
                    data-land-order={si * 10 + 3}
                    className="text-[15px] leading-relaxed text-content-faint"
                  >
                    {pick(note, locale)}
                  </p>
                ))}
              </div>

              {/* 바로가기 버튼들 — 각진 아웃라인 + ↗ (레퍼런스 버튼 문법) */}
              <div className="mt-10 flex flex-wrap gap-4">
                {sec.buttons.map((btn, i) => (
                  <a
                    key={i}
                    href={btn.href}
                    {...(btn.href.startsWith('http')
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                    // 클릭 대상이라 이동 없이 페이드만 — 누르려는 순간 움직이면 미스클릭이 난다
                    data-land="fade"
                    data-land-order={si * 10 + 4}
                    className="group inline-flex items-center gap-3 border border-content/70 px-7 py-4 text-sm font-bold text-content transition-colors hover:border-yonsei-navy hover:bg-yonsei-navy hover:text-white"
                  >
                    {pick(btn.label, locale)}
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    >
                      <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>
        ))}
      </div>
    </LandingScope>
  );
}

/**
 * 소개 › 입학 안내 탭 — admission-guide.json 을 위 렌더러에 그대로 흘려보내고,
 * 그 뒤에 3번 섹션(입학 캘린더)을 잇는다. 캘린더는 필터·스크롤이 있어 클라이언트
 * 컴포넌트라 GuideSections(서버 렌더) 안이 아니라 형제로 둔다 — 번호 '3'과 네이비 룰은
 * AdmissionCalendar 가 같은 문법으로 직접 그린다.
 */
export function AdmissionGuide({ locale }: { locale: Locale }) {
  return (
    <>
      <GuideSections sections={sections} locale={locale} landingName="admission-guide" />
      <div className="mt-24">
        <AdmissionCalendar locale={locale} />
      </div>
    </>
  );
}
