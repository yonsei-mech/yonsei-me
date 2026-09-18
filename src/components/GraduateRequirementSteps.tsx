import { StepRailNav } from '@/components/StepRailNav';
import { LandingScope } from '@/components/LandingScope';
import type { GraduateRequirementStep } from '@/lib/graduate-requirements';

/**
 * 대학원 졸업요건 — "STEP 스크롤" 문법 (참조 시안 + 사이트 공통 문법).
 *  - 좌측: 01~09 번호 목차가 sticky 로 화면을 따라오고(StepRailNav), 클릭 시 해당
 *    STEP 으로 부드럽게 스크롤·스크롤 위치에 따라 활성 항목이 갱신된다(스크롤스파이).
 *  - 우측: 각 STEP = 네이비 박스 헤더(STEP NN · 제목 — 학부 '나의 졸업요건' StepLabel 과
 *    동일 디자인·폰트) + 리드 문장 + 본문(불릿/표/콜아웃). 헤더 블록은 모든 섹션이 왼쪽
 *    정렬 + 왼쪽 여백 인셋(사용자 지시), 섹션 사이 헤어라인 구분.
 *  - 데이터: 2026-09 부터 **CMS STEP 레코드가 원본**이다(content/graduate-requirements.json,
 *    lib/graduate-requirements.ts). 마크다운 한 덩이를 '####' 헤딩으로 쪼개던 파서는
 *    이관과 함께 걷어냈다 — STEP 하나 = 레코드 하나(title · lead · body)다.
 *    body 는 서버에서 정화된 HTML 이고(게시물 bodyFormat:'html' 과 같은 규약),
 *    그 안의 인용구가 '유의사항' 콜아웃이 된다(step-prose 스코프, globals.css).
 *  - 번호·앵커 id 는 저장하지 않고 배열 순서에서 계산한다 — 좌측 목차 링크와
 *    페이지 내 앵커가 여기 계산식 하나에 걸려 있으므로 형식을 바꾸지 마라.
 */

export function GraduateRequirementSteps({ steps }: { steps: GraduateRequirementStep[] }) {
  const sections = steps.map((s, i) => ({
    id: `grad-step-${i + 1}`,
    num: String(i + 1).padStart(2, '0'),
    title: s.title,
    lead: s.lead,
    html: s.body,
  }));

  return (
    // tab(700px)+: 좌측 레일 그리드 — 아이패드 미니·갤럭시 탭 세로에서도 PC 레이아웃(사용자 지시)
    // 탭 진입 랜딩 — 좌측 목차가 먼저 서고 → 장식 유선이 그려지고 → 첫 STEP 헤더가 채워진다.
    // (LandingScope 는 display:contents 라 아래 grid 배치에 영향이 없다)
    <LandingScope name="graduate-requirements">
    <div className="mt-2 border-t border-surface-border tab:grid tab:grid-cols-[12.5rem_minmax(0,1fr)] tab:gap-x-8 lg:gap-x-12">
      <StepRailNav items={sections.map(({ id, num, title }) => ({ id, num, title }))} />
      <div className="divide-y divide-surface-border">
        {sections.map((s, i) => (
          <section
            key={s.id}
            id={s.id}
            aria-labelledby={`${s.id}-h`}
            className="scroll-mt-40 py-12 tab:scroll-mt-36 tab:py-16"
          >
            {/* 헤더 블록 — 학부 '나의 졸업요건' StepLabel 과 동일한 네이비 박스(STEP NN · 제목).
                모든 섹션 왼쪽 정렬 + 왼쪽 여백 인셋(좌/우 교대는 폐기 — 사용자 지시). */}
            <div className="tab:pl-12">
              <h3
                id={`${s.id}-h`}
                data-land="wipe"
                data-land-order={10 + i}
                className="inline-block bg-yonsei-navy px-3.5 py-1.5 text-sm font-bold text-white"
              >
                STEP {s.num} <span className="mx-1 opacity-60">·</span> {s.title}
              </h3>
              {s.lead && (
                <p
                  data-land="rise"
                  data-land-order={10 + i}
                  className="mt-4 max-w-2xl text-base leading-relaxed text-content-soft sm:text-lg"
                >
                  {s.lead}
                </p>
              )}
            </div>
            <div
              className="prose-content prose-wide step-prose mt-8"
              dangerouslySetInnerHTML={{ __html: s.html }}
            />
          </section>
        ))}
      </div>
    </div>
    </LandingScope>
  );
}
