// 대학원 졸업요건 STEP — 타입과 어댑터.
//
// 2026-09 원본을 content/pages/graduate-requirements.md 한 덩이에서
// content/graduate-requirements.json(STEP 레코드 배열)으로 옮겼다. 화면이 원래부터
// '####' 헤딩으로 STEP 을 나누고 있었는데, 그 규칙이 컴포넌트 안의 파서에만 있어서
// CMS 는 마크다운 전체를 통째로만 고칠 수 있었다. 이제 STEP 하나가 레코드 하나다.
//
// body 는 마크다운이 아니라 **정화된 HTML** 이다(게시물 bodyFormat:'html' 과 같은
// 규약). 렌더는 dangerouslySetInnerHTML 한 번뿐이고, 마크다운 → HTML 변환은
// 이관 시점(tools/graduate-requirements/migrate.mjs)에 끝났다.
//
// 이 파일에 React·서버 전용 import 를 넣지 마라 — CMS 클라이언트도 같은 타입을 쓴다.
// (폴백 스냅샷 정적 import 는 소비 쪽인 lib/content-runtime.ts 가 들고 있다)

/** content/graduate-requirements.json 한 줄 = 화면의 STEP 한 칸.
 *  번호(STEP 01…)와 앵커 id 는 저장하지 않는다 — 배열 순서에서 계산한다.
 *  중간에 STEP 을 넣고 빼도 번호가 저절로 맞기 때문이다. */
export interface GraduateRequirementStep {
  /** 네이비 박스 헤더에 'STEP NN · ' 뒤로 붙는 제목 */
  title: string;
  /** 헤더 아래 한 문단 안내. 없으면 빈 문자열(null·키 누락을 쓰지 않는다 —
   *  폼과 렌더가 falsy 한 번만 보면 되게 한 약속이다) */
  lead: string;
  /** 본문 HTML — 불릿·표·인용구(유의사항 콜아웃). 정화는 저장 시점에 한다 */
  body: string;
}

/**
 * 외부에서 온 값(DB content_files 행·손으로 고친 JSON) → 안전한 STEP 배열.
 * 배열이 아니면 빈 배열, 객체가 아닌 항목과 제목이 빈 항목은 버리고, 각 필드는
 * 문자열로 맞춘다 — 깨진 한 줄이 페이지를 통째로 죽이지 않게 하는 가드다.
 */
export function adaptGraduateRequirements(raw: unknown): GraduateRequirementStep[] {
  if (!Array.isArray(raw)) return [];
  const out: GraduateRequirementStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title : '';
    if (title.trim() === '') continue;
    out.push({
      title,
      lead: typeof r.lead === 'string' ? r.lead : '',
      body: typeof r.body === 'string' ? r.body : '',
    });
  }
  return out;
}
