// 콘텐츠 파일 데이터 레이어 (서버 전용) — 백엔드 전환 Stage A.
//
// CMS 가 편집하는 content/*.json · content/pages/*.md 의 "읽기"를 이 모듈로 일원화한다.
// 소스는 둘 (lib/posts.ts 의 게시판 전환과 같은 구조):
//  - db  : Supabase content_files(path, body). unstable_cache + 'content' 태그로 캐시되고,
//          CMS 쓰기가 revalidateTag('content') 를 호출하면 재배포 없이 갱신된다.
//  - git : 기존 정적 파일(content.ts / faculty.ts / pages.ts) — 롤백·오프라인 폴백.
//
// 기본값(Stage B): 프로덕션 + Supabase 구성 시 db, dev 는 항상 git(로컬 작업 트리
// 워크플로 보존). CONTENT_SOURCE=git 이 긴급 롤백 스위치다 — contentSource() 참고.
//
// 폴백은 항상 호출측(각 getter)에서 처리한다: DB 조회 실패·JSON 파싱 실패는 조용히
// 삼키고 파일 스냅샷으로 떨어진다. 콘텐츠 한 덩이가 깨져도 페이지는 뜬다.

import { unstable_cache } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  MANAGED_FILES,
  isManagedPath,
  isFacultyProfilePath,
} from '@/lib/admin/managed-content';
import {
  history as gitHistory,
  staff as gitStaff,
  type HistoryEvent,
  type StaffMember,
} from './content';
import {
  getFacultyDirectory as gitFacultyDirectory,
  getLabsDirectory as gitLabsDirectory,
  getLabSummaries as gitLabSummaries,
  getFacultySummaries as gitFacultySummaries,
  getClubs as gitClubs,
  getFacultyProfile as gitFacultyProfile,
  getFacultyPhotoMap,
  adaptFacultyRecords,
  adaptClubs,
  type FacultyProfile,
  type FacultyRecord,
  type LabDirectoryEntry,
  type ClubSummary,
} from './faculty';
import {
  adaptHistoryImages,
  getHistoryImages as gitHistoryImages,
} from './history-images';
import { getPageMarkdown } from './pages';
// 교과목 3종은 content.ts 를 거치지 않고 페이지가 직접 정적 import 하던 데이터다.
// 폴백 원본(= 빌드 시점 스냅샷)을 여기로 모아, 소비처는 getter 만 부르면 되게 한다.
import coursesUndergraduateJson from '@content/courses-undergraduate.json';
import courseDescriptionsJson from '@content/course-descriptions.json';
import coursesGraduateJson from '@content/courses-graduate.json';
// 교과목 체계도 관계·슬롯 — 2026-08 CMS 편집 대상이 되면서 CurriculumFlow 안의
// 정적 import 를 걷고 폴백 스냅샷으로 여기 모았다(위 교과목 3종과 같은 사정).
import courseFlowJson from '@content/course-flow.json';
import type { CurriculumMapData } from '@/lib/curriculum-map';
import type { PopupDesktopPosition, PopupMobilePosition } from '@/lib/popup-positions';
// 홈 히어로 배경 — 홈 페이지가 정적 import 하던 데이터(위 교과목 3종과 같은 사정).
import heroSlidesJson from '@content/hero-slides.json';
// 장학금 — 2026-08 마크다운 표에서 구조화 전환(폴백 스냅샷).
import scholarshipsJson from '@content/scholarships.json';
// 팝업 공지 — 평소에는 빈 배열이다(폴백 스냅샷).
import popupsJson from '@content/popups.json';

// ── 소스 판별 ──────────────────────────────────────────────────────────
export type ContentSource = 'db' | 'git';

/** 콘텐츠 읽기 소스. 미설정 기본값(Stage B): 프로덕션에서 Supabase 가 구성돼 있으면
 *  db, 아니면 git. dev 는 항상 git — dev 서버가 로컬 작업 트리를 그대로 서빙하는
 *  워크플로(파일 수정 → 즉시 반영)를 깨지 않기 위해서다.
 *  CONTENT_SOURCE=git 은 긴급 롤백 스위치(BOARDS_SOURCE 와 같은 관례). */
export function contentSource(): ContentSource {
  const v = process.env.CONTENT_SOURCE;
  if (v === 'db' || v === 'git') return v;
  return process.env.NODE_ENV === 'production' && process.env.SUPABASE_URL ? 'db' : 'git';
}

// ── Supabase 클라이언트 (lazy, 서버 전용 service key) ───────────────────
// lib/posts.ts 와 같은 패턴을 각자 보유한다 — 두 레이어가 서로를 import 하지 않게 둔다.
let _sb: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

// ── DB 행 형태 (scripts/sql/schema-content.sql 과 1:1) ──────────────────
interface DbContentFile {
  path: string;
  body: string;
  version: number;
}

// 관리 대상 파일은 십여 개·합쳐 수백 KB 라 전 행을 1회 조회해 메모리에서 고른다.
// 'content' 태그 하나로 단순·확실하게 캐시한다(게시판의 'posts' 와 같은 관례).
// drafts/ 는 CMS 임시저장 초안(/api/admin/drafts)이 같은 테이블에 얹혀 산다 —
// 사이트 콘텐츠가 아니고, 쌓이면 이 전량 조회가 캐시 2MB 상한을 위협하므로 뺀다.
// 교수 학술활동 프로필(faculty-profiles/)도 뺀다 — 31개 합계 ~2.5MB 라 전량 캐시에
// 실으면 상한을 넘긴다. 프로필은 아래 getFacultyProfileRuntime 이 한 명씩 따로 캐시한다.
const fetchAllContentFiles = unstable_cache(
  async (): Promise<DbContentFile[]> => {
    const { data, error } = await sb()
      .from('content_files')
      .select('path, body, version')
      .not('path', 'like', 'drafts/%')
      .not('path', 'like', 'content/faculty-profiles/%');
    if (error) throw new Error(`콘텐츠 파일 조회 실패: ${error.message}`);
    return (data ?? []) as DbContentFile[];
  },
  ['content-files-all'],
  // 수명 하루 — 갱신의 방아쇠는 CMS 저장의 revalidateTag('content') 이고 이 타이머는
  // 안전망일 뿐이다(태그 무효화가 어떤 이유로 불발했을 때만 일한다). 3600 이던 시절엔
  // 크롤러 트래픽이 이 전량 조회를 하루 수십 번 되풀이해 Supabase 무료 egress 를 태웠다.
  { tags: ['content'], revalidate: 86400 },
);

/** 관리 대상 파일의 DB 원문. git 모드거나 행이 없거나 조회가 실패하면 null(→ 호출측 폴백) */
async function getManagedText(path: string): Promise<string | null> {
  if (contentSource() === 'git') return null;
  try {
    const rows = await fetchAllContentFiles();
    return rows.find((r) => r.path === path)?.body ?? null;
  } catch (err) {
    console.error(`[content-runtime] ${path} 조회 실패 — 파일 폴백:`, err);
    return null;
  }
}

/** DB 원문을 JSON 으로 파싱. 실패하면 null — 깨진 한 덩이가 페이지를 죽이지 않는다 */
async function getManagedJson<T>(path: string): Promise<T | null> {
  const text = await getManagedText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    console.error(`[content-runtime] ${path} JSON 파싱 실패 — 파일 폴백:`, err);
    return null;
  }
}

// ── 도메인 getter (반환 타입은 기존 소비처 그대로) ──────────────────────

/** 연혁 — content.ts 와 같은 최근→과거 내림차순으로 반환한다(정렬 규칙 동일 유지) */
export async function getHistoryRuntime(): Promise<typeof gitHistory> {
  const raw = await getManagedJson<HistoryEvent[]>(MANAGED_FILES.history);
  if (!raw) return gitHistory;
  return raw.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** 연혁 연대 사진 — 연대 → 사진 URL. 원본은 문자열 키라 어댑터로 숫자 키를 만든다
 *  (소스와 무관하게 같은 어댑터를 태운다 — 교수진 사진 매칭과 같은 구조). */
export async function getHistoryImagesRuntime(): Promise<Record<number, string>> {
  const raw = await getManagedJson<Record<string, string>>(MANAGED_FILES.historyImages);
  if (!raw) return gitHistoryImages();
  return adaptHistoryImages(raw);
}

/** 행정 교직원 — 파일 순서가 표 순서다(정렬 없음, content.ts 와 동일) */
export async function getStaffRuntime(): Promise<typeof gitStaff> {
  const raw = await getManagedJson<StaffMember[]>(MANAGED_FILES.staff);
  return raw ?? gitStaff;
}

/** 교수진 인명록 — 사진 매칭(public/img/faculty)은 소스와 무관하게 같은 어댑터로 적용 */
export async function getFacultyDirectoryRuntime(): Promise<FacultyRecord[]> {
  const raw = await getManagedJson<
    (Omit<FacultyRecord, 'photo'> & { photo?: string | null })[]
  >(MANAGED_FILES.facultyDirectory);
  if (!raw) return gitFacultyDirectory();
  return adaptFacultyRecords(raw, getFacultyPhotoMap());
}

/** 연구실 목록 — 어댑터 없이 원본 그대로 쓰는 데이터 */
export async function getLabsDirectoryRuntime(): Promise<LabDirectoryEntry[]> {
  const raw = await getManagedJson<LabDirectoryEntry[]>(MANAGED_FILES.labs);
  return raw ?? gitLabsDirectory();
}

/** 연구실 AI 연구요약 — 지도교수 한글 이름을 키로 하는 객체(로케일 해석은 소비처가) */
export async function getLabSummariesRuntime(): Promise<
  Record<string, { ko: string; en: string }>
> {
  const raw = await getManagedJson<Record<string, { ko: string; en: string }>>(
    MANAGED_FILES.labSummaries,
  );
  return raw ?? gitLabSummaries();
}

/** 교수 AI 연구요약 — 교수 한글 이름을 키로 하는 객체(로케일 해석은 소비처가).
 *  교수 상세 페이지가 읽는다. 연구실 요약과 같은 모양이라 같은 경로를 탄다. */
export async function getFacultySummariesRuntime(): Promise<
  Record<string, { ko: string; en: string }>
> {
  const raw = await getManagedJson<Record<string, { ko: string; en: string }>>(
    MANAGED_FILES.facultySummaries,
  );
  return raw ?? gitFacultySummaries();
}

/** 동아리 인덱스 — 로고(slug 매핑)는 소스와 무관하게 같은 어댑터로 적용 */
export async function getClubsRuntime(): Promise<ClubSummary[]> {
  const raw = await getManagedJson<ClubSummary[]>(MANAGED_FILES.clubs);
  if (!raw) return gitClubs();
  return adaptClubs(raw);
}

/** 학부 교과목 — 편람 표와 교과목 체계도가 함께 읽는 데이터 */
export async function getCoursesUndergraduateRuntime(): Promise<typeof coursesUndergraduateJson> {
  const raw = await getManagedJson<typeof coursesUndergraduateJson>(
    MANAGED_FILES.coursesUndergraduate,
  );
  return raw ?? coursesUndergraduateJson;
}

/** 교과목 설명 — 학정번호를 키로 하는 객체(체계도 상세 패널) */
export async function getCourseDescriptionsRuntime(): Promise<typeof courseDescriptionsJson> {
  const raw = await getManagedJson<typeof courseDescriptionsJson>(
    MANAGED_FILES.courseDescriptions,
  );
  return raw ?? courseDescriptionsJson;
}

/** 교과목 체계도 — 선수·연계 관계(edges)와 칸 안 세로 슬롯(nodes[].row).
 *  관리자 콘솔의 '교과목 체계도' 화면이 이 파일을 통째로 쓴다. 형태가 깨진 저장이
 *  들어와도 화면이 통째로 죽지 않도록 배열 여부를 확인하고 아니면 스냅샷으로 돌린다. */
export async function getCurriculumMapRuntime(): Promise<CurriculumMapData> {
  const raw = await getManagedJson<CurriculumMapData>(MANAGED_FILES.curriculumMap);
  if (!raw || !Array.isArray(raw.edges) || !Array.isArray(raw.nodes)) {
    return courseFlowJson as unknown as CurriculumMapData;
  }
  return raw;
}

/** 대학원 교과목 */
export async function getCoursesGraduateRuntime(): Promise<typeof coursesGraduateJson> {
  const raw = await getManagedJson<typeof coursesGraduateJson>(MANAGED_FILES.coursesGraduate);
  return raw ?? coursesGraduateJson;
}

/** content/hero-slides.json 한 줄 — 홈 첫 화면 슬라이드쇼의 분야별 배경 사진.
 *  CMS '메인 이미지' 탭(resources.ts 의 heroSlides)이 편집하는 스키마와 1:1 이다. */
export interface HeroSlideRecord {
  /** 연구 분야 키(FIELD_OPTIONS 와 동일 집합) — 분야 바로가기 링크의 목적지 */
  field: string;
  /** 히어로 분야 목록에 표시되는 이름(로케일 해석은 소비처가) */
  title: { ko: string; en: string };
  /** 가로 원본 — 사이트 내부 경로(/img/hero/…)이거나 업로드 결과 절대 URL */
  image: string;
  /** 세로(9:16) 크롭본. 없으면 소비처가 가로 원본으로 폴백한다 */
  imageMobile?: string;
}

/** 홈 히어로 슬라이드 — 배열 순서가 슬라이드 순서다(정렬 없음) */
export async function getHeroSlidesRuntime(): Promise<HeroSlideRecord[]> {
  const raw = await getManagedJson<HeroSlideRecord[]>(MANAGED_FILES.heroSlides);
  return raw ?? heroSlidesJson;
}

/** content/scholarships.json 한 줄 — 학부 > 장학금 표의 레코드.
 *  CMS '장학금' 표(resources.ts 의 scholarships)가 편집하는 스키마와 1:1 이다.
 *  여러 줄 셀은 \n 으로 담는다(구 md 의 <br> 에 대응 — 소비처가 줄로 나눠 그린다). */
export interface ScholarshipRecord {
  /** 표 묶음 제목(예: "교외 장학금") — 등장 순서대로 섹션이 된다 */
  section: string;
  name: string;
  criteria: string;
  count: string;
  amount: string;
  timing: string;
}

/** 장학금 — 배열 순서가 표의 행 순서다(정렬 없음) */
export async function getScholarshipsRuntime(): Promise<ScholarshipRecord[]> {
  const raw = await getManagedJson<ScholarshipRecord[]>(MANAGED_FILES.scholarships);
  return raw ?? scholarshipsJson;
}

/** content/popups.json 한 줄 — 게재 기간 안에만 뜨는 사진 팝업.
 *  형식은 기기마다 하나로 고정이고, PC·모바일이 각각 **위치**를 갖는다
 *  (positionDesktop / positionMobile).
 *  CMS '팝업 공지' 탭(resources.ts 의 popups)이 편집하는 스키마와 1:1 이다.
 *  ⚠️ 게재 기간·기기·페이지 판정은 **하지 않는다** — 페이지가 정적으로 생성되므로
 *  종료 시각이 지나도 다시 그려지지 않아, 서버에서 걸러 내면 끝난 팝업이 남는다.
 *  판정은 전부 클라이언트(PopupNotice)가 한다. */
export interface PopupRecord {
  id: string;
  title: { ko: string; en: string };
  /** 'YYYY-MM-DDTHH:mm' (KST) */
  start: string;
  /** 'YYYY-MM-DDTHH:mm' (KST) */
  end: string;
  devices: ('desktop' | 'mobile')[];
  /** 노출 페이지 — 경로 첫 세그먼트(홈은 'home') */
  pages: string[];
  /** PC 화면에서 앉을 자리 (lib/popup-positions.ts 의 키) */
  positionDesktop: PopupDesktopPosition;
  /** 모바일에서 앉을 자리 — PC 와 **따로** 고른다(팝업을 두 개 만들지 않아도 되게) */
  positionMobile: PopupMobilePosition;
  /** PC 카드 폭(px). 없으면 360 — 옛 항목은 이 키가 아예 없다.
   *  한계·기본값은 lib/popup-positions.ts 의 POPUP_DESKTOP_WIDTH 가 단일 출처다.
   *  모바일은 전폭 시트라 이 값을 쓰지 않는다. */
  widthDesktop?: number;
  /** 사진 가로÷세로(소수 4자리). CMS 가 사진을 올릴 때 잰다.
   *  이 값이 있으면 PC 카드가 화면에 안 들어갈 때 비율을 지키며 카드째 줄어든다.
   *  없으면(옛 항목) 사진 높이 상한을 거는 예전 방식으로 폴백한다. */
  imageAspect?: number;
  /** 하단 "오늘 하루 보지 않기" 버튼 표시 */
  hideTodayButton: boolean;
  /** 우측 상단 X 의 동작 */
  closeControl: 'close' | 'hideToday' | 'none';
  image: string;
  /** 모바일 전용 사진. 없으면 image 를 쓴다 */
  imageMobile?: string;
  link?: string;
  newTab: boolean;
  enabled: boolean;
}

/** 팝업 공지 전체 — 배열 순서가 화면에 놓이는 순서다 */
export async function getPopupsRuntime(): Promise<PopupRecord[]> {
  const raw = await getManagedJson<PopupRecord[]>(MANAGED_FILES.popups);
  const list = raw ?? (popupsJson as unknown as PopupRecord[]);
  return Array.isArray(list) ? list : [];
}

/** '노출' 이 켜진 팝업만 (순서 유지). 기간·기기·페이지는 클라이언트가 판정한다 */
export async function getEnabledPopupsRuntime(): Promise<PopupRecord[]> {
  return (await getPopupsRuntime()).filter((p) => p.enabled !== false && p.image);
}

/** 교수 학술활동 프로필 한 명 — content/faculty-profiles/<이름>.json.
 *  전량 조회(fetchAllContentFiles)에서 일부러 뺀 데이터라 한 명씩 개별 캐시한다
 *  (합계 ~2.5MB 는 캐시 2MB 상한을 넘지만 한 명 15~140KB 는 문제없다).
 *  같은 'content' 태그를 달아 CMS 저장(revalidateTag)이 즉시 무효화한다.
 *  이름은 URL slug 에서 오므로 경로 조립 전에 allowlist 정규식으로 거른다. */
export async function getFacultyProfileRuntime(name: string): Promise<FacultyProfile | null> {
  const path = `content/faculty-profiles/${name}.json`;
  if (contentSource() !== 'git' && isFacultyProfilePath(path)) {
    try {
      const text = await unstable_cache(
        async (): Promise<string | null> => {
          const { data, error } = await sb()
            .from('content_files')
            .select('body')
            .eq('path', path)
            .maybeSingle();
          if (error) throw new Error(`콘텐츠 파일 조회 실패: ${error.message}`);
          return data ? String(data.body) : null;
        },
        ['content-file-one', path],
        // 전량 조회와 같은 규칙 — CMS 저장의 revalidateTag('content') 가 갱신을 맡고
        // 하루짜리 타이머는 안전망이다(egress 절감, 위 fetchAllContentFiles 주석 참조).
        { tags: ['content'], revalidate: 86400 },
      )();
      if (text !== null) return JSON.parse(text) as FacultyProfile;
    } catch (err) {
      console.error(`[content-runtime] ${path} 조회 실패 — 파일 폴백:`, err);
    }
  }
  return gitFacultyProfile(name);
}

/** content/pages/<slug>.md 원문. 관리 대상(동아리 본문)만 DB 를 보고,
 *  나머지 임포트 문서는 기존처럼 파일에서 읽는다. */
export async function getPageMarkdownRuntime(slug: string): Promise<string | null> {
  const path = `content/pages/${slug}.md`;
  if (isManagedPath(path)) {
    const text = await getManagedText(path);
    if (text !== null) return text;
  }
  return getPageMarkdown(slug);
}
