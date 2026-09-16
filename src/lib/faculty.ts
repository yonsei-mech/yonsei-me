import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import labSummariesData from '@content/lab-summaries.json';
import facultySummariesData from '@content/faculty-summaries.json';

export interface FacultyLab {
  nameKo: string;
  nameEn: string;
  url: string;
}

export interface FacultyRecord {
  name: string;
  /** 영문 이름 — en 로케일 표기(예: "Keonwook Kang"). 없으면 한국어 이름으로 폴백 */
  nameEn?: string | null;
  title: string;
  role: string | null;
  /** 보직 영문 표기 — en 로케일에서 role 대신 사용. 없으면 role(한국어)로 폴백 */
  roleEn?: string | null;
  email: string | null;
  phone: string | null;
  room: string | null;
  specialty: string | null;
  /** 전공 분야 영문 표기 — en 로케일에서 specialty 대신 사용. 없으면 specialty 로 폴백 */
  specialtyEn?: string | null;
  yearRange: string | null;
  /** 명예·퇴임 교원 수동 표시 — 재직 기간(yearRange)을 모르는 경우를 위한 보완 스위치.
   *  기간이 적혀 있으면 그것만으로도 퇴임으로 분류되므로, 둘 중 하나만 있으면 된다.
   *  구 데이터엔 이 키가 없어 optional 이다(없으면 false 취급). */
  emeritus?: boolean;
  /** 교수 상세에 학술활동(논문·연구과제·지적재산권·수상·학술활동) 섹션을 **노출**한다.
   *  기본값은 비노출이다(키가 없으면 false). 실적 공개 여부는 교수 개인의 선택이라
   *  본 사이트는 기본적으로 교원정보시스템으로 넘기고, 공개를 원하는 교수만 CMS 에서
   *  이 체크를 켜 사이트에도 함께 싣는다(2026-08 학부 방침). AI 연구요약은 이 값과
   *  무관하게 항상 보인다. */
  showActivities?: boolean;
  /** BK21 FOUR 교육연구단 참여교수 — /bk21/people 의 참여교수 명단이 이 값으로 걸러진다.
   *  참여교수가 아니면 키 자체가 없다(없으면 false 취급 — showActivities 와 같은 규약). */
  bk21?: boolean;
  moreInfoUrl: string | null;
  photoAlt: string;
  lab: FacultyLab | null;
  photo: string | null;
}

export interface ClubSummary {
  slug: string;
  name: string;
  teaser: string;
  /** 카드 왼쪽 배경에 깔리는 동아리 로고 (public/img/clubs/) */
  logo?: string;
  /** 상세 페이지 카드뉴스 패널에서 좌우 교대로 쓰는 사진 (public/img/club-photos/) */
  images?: string[];
}

/** slug → 로고 파일 매핑 (public/img/clubs/) */
const CLUB_LOGOS: Record<string, string> = {
  yonseidrone: '/img/clubs/yonseidrone.jpeg',
  mecar: '/img/clubs/mecar.jpeg',
  roboin: '/img/clubs/roboin.jpg',
  spacey: '/img/clubs/spacey.jpeg',
};

/** 6개 연구 분야 taxonomy — 원본은 @/lib/research-fields (클라이언트 안전 모듈).
 *  이 파일은 node:fs 를 쓰는 서버 전용이라 값 상수를 여기 두면 안 된다. */
import type { ResearchField } from './research-fields';

export type { ResearchField };

export interface LabDirectoryEntry {
  nameKo: string;
  nameEn: string;
  professorKo: string;
  professorEn: string;
  location: string;
  phone: string;
  /** 연구실 외부 사이트 링크. 빈 문자열이면 링크 없는 카드로 처리한다. */
  url: string;
  /** 연구실 소개 문단(로케일별) — 목록의 특색 홍보용. 없으면 소개 없이 렌더되며,
   *  content/labs-directory.json 에 채우는 즉시 표시된다. */
  description?: { ko: string; en: string };
  /** 연구실별 실제 이미지 경로(public 기준). 없으면 더미 이미지 3장을 순환 사용. */
  image?: string;
  /** 연구실 소개 영상 URL — YouTube watch·Google Drive 링크 **또는 업로드한 영상
   *  파일 URL**(R2 uploads/labs/…). 없으면 영상 미제공 */
  video?: string;
  /** 파일 업로드 영상의 정지 화면(포스터) URL — 갤러리 카드 썸네일.
   *  video 가 링크(YouTube·Drive)면 무시된다 */
  videoPoster?: string;
  /** 6개 연구 분야 중 하나 (분야 필터용) */
  field: ResearchField;
  /** 학부 인턴 모집 여부 — 연구실 목록의 "학부 인턴 모집 중" 배지 + 상단 필터에 사용 */
  internRecruiting?: boolean;
  /** 학부 인턴 모집 인원 (모집 중일 때만 의미). 없으면 인원 미표기 */
  internCount?: number;
}

/** content/faculty-profiles/<한글이름>.json — 교수 개인 상세(학술활동) 크롤 데이터.
 *  직위·보직·연구실·사진은 여기 없다. 같은 이름의 faculty-directory 레코드와 합쳐 쓴다. */
export interface FacultyProfileArticleRow {
  /** "2025-12" (연-월) */
  date: string | null;
  title: string;
  journal: string | null;
}

export interface FacultyProfileAwardRow {
  title: string;
  contents: string | null;
  /** "2024-04-18" (연-월-일) */
  date: string | null;
}

export interface FacultyProfileConferenceRow {
  title: string;
  conference: string | null;
  /** "2023.08.21~2023.08.25" (시작~끝) */
  period: string | null;
}

export interface FacultyProfileFundingRow {
  title: string;
  org: string | null;
  /** "2026-03-01~2027-02-28" (시작~끝) */
  period: string | null;
}

export interface FacultyProfilePatentRow {
  title: string;
  /** 특허 / 상표 등 */
  type: string | null;
  applicant: string | null;
  /** "2026-01-27" (연-월-일) */
  date: string | null;
}

export interface FacultyProfile {
  name: string;
  nameEn: string | null;
  email: string | null;
  phone: string | null;
  office: string | null;
  homepage: string | null;
  sourceUrl: string | null;
  crawledAt: string | null;
  /** AI 연구요약 — 학술활동 데이터를 바탕으로 미리 생성해 둔 문단(실시간 생성 아님).
   *  없으면 상세 페이지에서 요약 버튼 자체를 그리지 않는다. */
  aiSummary?: string | null;
  /** 배열 5종은 항상 존재한다(빈 배열일 수는 있다) */
  articles: FacultyProfileArticleRow[];
  awards: FacultyProfileAwardRow[];
  conferences: FacultyProfileConferenceRow[];
  fundings: FacultyProfileFundingRow[];
  patents: FacultyProfilePatentRow[];
}

/** 구 학부 CMS 의 공개 별칭 호스트 — 도메인 컷오버 뒤 이 사이트가 가져갈 주소다. */
const LEGACY_PUBLIC_HOST = 'me.yonsei.ac.kr';
/** 같은 페이지를 그대로 서빙하는 원본 CMS 호스트(2026-08 실측: 상세·리포트 모두 200) */
const FACULTY_INFO_HOST = 'devcms.yonsei.ac.kr';

/**
 * 교원정보시스템의 교수 개인 페이지 URL — 상세 페이지의 "교원정보시스템" 버튼이 연다.
 *
 * ⚠️ 크롤 원본의 `sourceUrl` 은 me.yonsei.ac.kr 을 가리키는데, 도메인 컷오버 뒤 그
 * 주소는 **이 사이트**가 된다. 그대로 링크하면 자기 자신으로 돌아 구 URL 리졸버에
 * 걸린다. 원본 CMS 호스트가 같은 페이지를 서빙하므로 호스트만 바꿔 쓴다.
 *
 * CMS 의 '상세 정보 URL'(moreInfoUrl)이 채워져 있으면 그쪽이 우선이다 — 학교가 주소
 * 체계를 옮겨도 코드 수정 없이 교수별로 대응하기 위한 수동 오버라이드다.
 */
export function facultyInfoSystemUrl(
  record: Pick<FacultyRecord, 'moreInfoUrl'> | null,
  sourceUrl: string | null,
): string | null {
  const manual = record?.moreInfoUrl?.trim();
  if (manual) return manual;
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    if (url.hostname === LEGACY_PUBLIC_HOST) url.hostname = FACULTY_INFO_HOST;
    return url.toString();
  } catch {
    // 크롤 원본이 상대경로·빈 문자열인 경우 — 링크를 만들지 않는다.
    return null;
  }
}

const FACULTY_PROFILE_DIR = 'faculty-profiles';

function readJson<T>(name: string): T {
  const path = join(process.cwd(), 'content', name);
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/** public/img/faculty 에 있는 "{교수 이름}.{ext}" 프로필 사진을 이름 기준으로 매핑.
 *  readdir 실패는 빈 Map — ISR 전환으로 이 함수가 요청 시점에 실행되므로, public/ 이
 *  서버리스 번들에 없는 배포(파일 추적 누락 등)에서도 페이지가 죽지 않게 한다.
 *  사진이 비면 JSON 의 명시적 photo 만 쓰이고, 나머지는 이름 매칭 없이 null 이 된다. */
export function getFacultyPhotoMap(): Map<string, string> {
  const dir = join(process.cwd(), 'public', 'img', 'faculty');
  const map = new Map<string, string>();
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return map;
  }
  for (const file of files) {
    const dot = file.lastIndexOf('.');
    if (dot <= 0) continue;
    map.set(file.slice(0, dot), `/img/faculty/${file}`);
  }
  return map;
}

/** 교수진 원본 레코드 배열 → 사진이 채워진 FacultyRecord[] (파일 I/O 없는 순수 어댑터).
 *  사진은 JSON 의 명시적 photo(관리자 콘솔 업로드가 채움)를 우선하고, 없으면 기존
 *  컨벤션대로 photoMap 의 "<이름>" 매칭을 쓴다. 파일(git)·DB 어느 소스에서 읽었든
 *  같은 규칙을 적용하기 위해 데이터 주입형으로 분리했다(lib/content-runtime.ts 가 재사용). */
export function adaptFacultyRecords(
  records: (Omit<FacultyRecord, 'photo'> & { photo?: string | null })[],
  photoMap: Map<string, string>,
): FacultyRecord[] {
  return records.map(({ photo, ...rest }) => {
    const explicit = typeof photo === 'string' && photo.trim() !== '' ? photo.trim() : null;
    return { ...rest, photo: explicit ?? photoMap.get(rest.name) ?? null };
  });
}

/** 동아리 원본 배열 → 로고가 채워진 ClubSummary[] (파일 I/O 없는 순수 어댑터) */
export function adaptClubs(raw: ClubSummary[]): ClubSummary[] {
  return raw.map((c) => ({ ...c, logo: CLUB_LOGOS[c.slug] }));
}

/** content/faculty-directory.json — 교수진 게시판에서 구조화 추출한 실제 데이터 */
export function getFacultyDirectory(): FacultyRecord[] {
  const records = readJson<(Omit<FacultyRecord, 'photo'> & { photo?: string | null })[]>(
    'faculty-directory.json',
  );
  return adaptFacultyRecords(records, getFacultyPhotoMap());
}

/** content/clubs.json — 동아리 인덱스(슬러그/이름/티저) + 로고 매핑 */
export function getClubs(): ClubSummary[] {
  return adaptClubs(readJson<ClubSummary[]>('clubs.json'));
}

/** content/labs-directory.json — 연구실 목록(지도교수·위치·연락처·사이트 링크) */
export function getLabsDirectory(): LabDirectoryEntry[] {
  return readJson<LabDirectoryEntry[]>('labs-directory.json');
}

/** content/lab-summaries.json — 연구실 'AI 연구요약' 문안(지도교수 한글 이름 → 로케일별
 *  문장). 실시간 생성이 아니라 미리 써 둔 문장이며, 키는 labs-directory.json 의
 *  professorKo 와 조인한다. 파일 최상위가 곧 이 객체다(CMS record 포맷).
 *  정적 import 라 빌드 시 인라인된다(런타임 파일 I/O 없음) — DB 소스의 폴백 스냅샷이다. */
export function getLabSummaries(): Record<string, { ko: string; en: string }> {
  return labSummariesData;
}

/** content/faculty-summaries.json — 교수 상세의 'AI 연구요약' 문안(교수 한글 이름 →
 *  로케일별 문장). lab-summaries.json 과 같은 모양·같은 CMS 경로(linkedSummary)를 쓴다.
 *
 *  ⚠️ 이 문안을 faculty-profiles/<이름>.json 의 aiSummary 로 되돌리지 마라. 그 파일들은
 *  tools/crawl-faculty-profiles.mjs 가 통째로 다시 쓰는 크롤 산출물이라(크롤러는
 *  aiSummary 를 만들지 않는다) 재크롤 한 번에 사람이 쓴 문장이 사라진다. 합계 3.2MB 라
 *  content_files 전량 조회 캐시(2MB 우려)에 올리기도 어렵다. 그래서 사람이 고치는
 *  문장만 이 작은 파일로 떼어 CMS 가 관리한다. */
export function getFacultySummaries(): Record<string, { ko: string; en: string }> {
  return facultySummariesData;
}

/** content/faculty-profiles/*.json 파일명(확장자 제거) = 교수 상세 페이지 slug 목록.
 *  디렉터리가 아직 없는 체크아웃에서도 빌드가 깨지지 않도록 빈 배열로 떨어진다. */
export function getFacultyProfileNames(): string[] {
  const dir = join(process.cwd(), 'content', FACULTY_PROFILE_DIR);
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length));
  } catch {
    return [];
  }
}

/** 이름(한글)으로 교수 개인 상세를 읽는다. 목록에 없는 이름은 즉시 null —
 *  slug 가 URL 에서 오므로 파일명을 조립하기 전에 화이트리스트로 거른다. */
export function getFacultyProfile(name: string): FacultyProfile | null {
  if (!getFacultyProfileNames().includes(name)) return null;
  const path = join(process.cwd(), 'content', FACULTY_PROFILE_DIR, `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as FacultyProfile;
}
