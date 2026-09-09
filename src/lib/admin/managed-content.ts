// CMS 가 편집하는 콘텐츠 파일 경로 목록 — 저장소(Git)와 DB(content_files) 양쪽에서
// "관리 대상"을 판정하는 단일 소스. 의존성 없는 순수 상수 모듈이라 클라이언트
// 컴포넌트·서버 런타임·노드 스크립트가 모두 같은 목록을 본다.
//
// 새 리소스를 콘솔에 추가할 때는 여기에 경로를 먼저 더한 뒤 resources.ts 가 이 상수를
// 참조하게 한다(쓰기 API 의 경로 allowlist 가 이 목록이 될 예정 — Stage C).

/** 리소스 키(resources.ts 의 ResourceKey) → 저장소 루트 기준 JSON 경로.
 *  ResourceKey 를 import 하지 않는다 — resources.ts 가 이 모듈을 참조하므로 순환이 된다. */
export const MANAGED_FILES = {
  history: 'content/history.json',
  // 연혁 연대 사진 — 연대(10년) → 사진 URL 맵. 연혁 항목 배열과 **다른 파일**이다:
  // 사진은 항목이 아니라 연대에 붙고, 항목을 지워도 어긋나면 안 되기 때문이다.
  // (2026-08 전까지는 public/img/history/<연도>.jpg 폴더 스캔이었다 — CMS 에서
  //  손댈 수 없어 맵 파일로 옮겼다. src/lib/history-images.ts 주석 참고)
  historyImages: 'content/history-images.json',
  facultyDirectory: 'content/faculty-directory.json',
  staff: 'content/staff.json',
  heroSlides: 'content/hero-slides.json',
  coursesUndergraduate: 'content/courses-undergraduate.json',
  courseDescriptions: 'content/course-descriptions.json',
  // 교과목 체계도 — 선수·연계 관계(edges)와 칸 안 세로 슬롯(nodes[].row).
  // 다른 리소스와 달리 배열도 키-객체도 아닌 {nodes, edges} 한 덩어리라
  // CollectionEditor 가 아니라 전용 편집 화면(CurriculumMapEditor)이 다룬다.
  curriculumMap: 'content/course-flow.json',
  coursesGraduate: 'content/courses-graduate.json',
  clubs: 'content/clubs.json',
  labs: 'content/labs-directory.json',
  labSummaries: 'content/lab-summaries.json',
  facultySummaries: 'content/faculty-summaries.json',
  // 장학금 — 2026-08 마크다운 표(content/pages/undergraduate-scholarship.md)에서 전환.
  // 섹션·5열(장학금명/추천기준/선발인원/장학금액/선발시기)이 그대로 레코드가 됐다.
  scholarships: 'content/scholarships.json',
  // 팝업 공지 — 게재 기간 안에만 사이트에 뜨는 사진 팝업(레이어)·상단 배너.
  // 기간·기기·페이지 판정은 클라이언트가 한다(정적 페이지는 종료일에 다시 그려지지
  // 않으므로 서버에서 걸러 내면 끝난 팝업이 남는다 — PopupNotice 주석 참고).
  popups: 'content/popups.json',
  // 팝업 크기 편집기의 **배경 캡처 설정**(관리자 전용, 사이트에는 나가지 않는다).
  // 팝업 항목마다 올리게 하면 매번 다시 올려야 하므로 CMS 전역 설정으로 한 파일에 둔다.
  // { desktop: { image, width, height } } — width·height 는 그 캡처가 나타내는 실제
  // 뷰포트(CSS px)다. 캡처의 픽셀 크기(Retina 2배 등)와 무관하게 팝업 px 를 실제 px 로 유지한다.
  popupPreview: 'content/popup-preview.json',
} as const;

/** 동아리 소개 카드뉴스 본문 — clubs.json 의 slug 마다 한 파일(content/pages/club-<slug>.md).
 *  slug 는 소문자·숫자·하이픈만 허용(resources.ts 의 slug 필드 안내와 동일 규약). */
const CLUB_MD_RE = /^content\/pages\/club-[a-z0-9-]+\.md$/;

export function isClubMarkdownPath(path: string): boolean {
  return CLUB_MD_RE.test(path);
}

/** 교수 학술활동 프로필 — 교수마다 한 파일(content/faculty-profiles/<한글이름>.json).
 *  파일명이 곧 교수 한글 이름이자 상세 페이지 slug 라 한글만 허용한다(경로 탈출 차단 겸). */
const FACULTY_PROFILE_RE = /^content\/faculty-profiles\/[가-힣]{2,10}\.json$/;

export function isFacultyProfilePath(path: string): boolean {
  return FACULTY_PROFILE_RE.test(path);
}

/** CMS 가 쓸 수 있는 경로인지 — 관리 JSON + 동아리 본문 + 교수 프로필 전부의 합집합.
 *  구 장학금 md(content/pages/undergraduate-scholarship.md)는 scholarships.json 전환으로
 *  빠졌다 — DB 에 남은 옛 행은 이 allowlist 가 거부해 더는 수정되지 않는다. */
export function isManagedPath(path: string): boolean {
  return (
    (Object.values(MANAGED_FILES) as readonly string[]).includes(path) ||
    isClubMarkdownPath(path) ||
    isFacultyProfilePath(path)
  );
}
