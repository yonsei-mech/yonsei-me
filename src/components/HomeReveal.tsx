import { routing } from '@/i18n/routing';

/**
 * 홈(로케일 루트)에서만 <html> 에 `home-reveal` 을 붙여, 콘텐츠 래퍼의 100svh 상단 여백을
 * `body::before` 가 대신 지게 한다(규칙은 globals.css 의 `.home-reveal`).
 *
 * 왜 필요한가(CLS): 홈은 "fixed background reveal" 이다 — 히어로(#sec-hero)가 fixed -z-10 이고
 * 사이트 헤더도 fixed 라, 흰 콘텐츠 래퍼(`mt-[100svh]`)가 <main> 의 첫 in-flow 자식이 된다.
 * 앞에 in-flow 형제가 하나도 없으니 래퍼의 100svh 마진이 main 과 body 를 **뚫고 접혀**
 * (margin collapse) body 박스 자체가 y=100svh 에서 시작한다. 문제는 HTML 이 아직 파싱 중일
 * 때다 — 래퍼가(심지어 <main> 조차) 도착하기 전에 Chrome 이 레이아웃을 한 번 돌리면 body 는
 * y=0 에 있다가, 래퍼가 도착하는 순간 한 뷰포트 높이만큼 아래로 뛴다(프레임 단위 CDP 추적으로
 * 두 경우 모두 관측). body 배경이 캔버스로 전파돼 눈에는 안 보이지만, 이동은 body 에 귀속돼
 * CLS 가 모바일 1.0 / 데스크톱 0.70 이 된다(PageSpeed 2026-09-11: 모바일 1.003, 데스크톱
 * 0.707) — PSI 점수와 실사용자 Core Web Vitals 를 통째로 망가뜨린다.
 *
 * 해법: body 를 여는 순간부터 존재하는 `::before` 가 같은 100svh 마진을 처음부터 진다.
 * 빈 0 높이 블록이라 그 마진도 body 를 뚫고 접혀 최종 레이아웃(body·래퍼 top, 문서 높이)이
 * 기존과 똑같고, 박스가 없으니 히트테스트 영역도 없어 히어로 버튼 클릭을 막지 않는다.
 * 실측(CSS 주입 시뮬레이션, 헤드리스 Chrome, slow-4G, 5회): 이동 0/5, 히어로 버튼 클릭 6/6.
 *
 * 기각한 대안:
 *  - body{display:flow-root} — body 박스가 -z-10 히어로를 덮어 히어로 버튼 6개가 전부 막힌다.
 *  - <main> 첫 자식 0 높이 스페이서 — 5회 중 2회 이동. <main> 파싱 전(헤더 파싱 중)에도 레이아웃이 돈다.
 *
 * ⚠️ body 최상단에서 **동기** 실행해야 한다 — 헤더 마크업이 파싱되기 전에 클래스가 붙어 있어야
 * 첫 레이아웃부터 body::before 가 마진을 진다(PerfLiteScript 와 같은 자리·같은 이유).
 * JS 가 꺼져 클래스가 없으면 래퍼의 mt-[100svh] 가 그대로 살아 있어 기존 동작을 정확히
 * 재현한다(CLS 만 예전 그대로). 이 스크립트는 첫 문서 로드에서만 돌므로, 클라이언트
 * 내비게이션(하위 페이지 ↔ 홈)은 HomeRevealFlag 가 맡는다.
 */

/** 이 클래스가 <html> 에 있을 때만 globals.css 의 body::before 여백 규칙이 켜진다 */
export const HOME_REVEAL_CLASS = 'home-reveal';

// 로케일 홈 경로(/ko, /ko/, /en, /en/ …) — 로케일 목록은 routing 이 단일 출처다.
// 하드코딩하면 로케일을 늘릴 때 새 홈에서만 CLS 가 되살아난다.
const HOME_PATHS = routing.locales.flatMap((locale) => [`/${locale}`, `/${locale}/`]);

const SCRIPT = `(function(){try{
if(${JSON.stringify(HOME_PATHS)}.indexOf(location.pathname)>-1){document.documentElement.classList.add(${JSON.stringify(HOME_REVEAL_CLASS)})}
}catch(e){}})();`;

export function HomeRevealScript() {
  // 자체 생성 정적 문자열(사용자 입력 미포함) — XSS 벡터 없음
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
