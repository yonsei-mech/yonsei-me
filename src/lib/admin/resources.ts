// 관리자 콘솔 리소스 스키마 — 게시판 외 "수정 가능한 모든 콘텐츠"의 선언적 정의.
// CollectionEditor/RecordForm 이 이 스키마를 읽어 목록·폼·직렬화를 자동 구성한다.
// 새 콘텐츠를 콘솔에 추가하려면 이 파일에 ResourceDef 하나를 더하면 된다.
// (한국어 UI 문자열은 내부 운영 도구라 모듈에 직접 둔다.)

import type { BoardKey } from '@/lib/admin/boards';
// 파일 경로는 여기 적지 않는다 — 저장소·DB 양쪽의 "관리 대상" 판정과 같은 목록을 쓴다.
import { MANAGED_FILES } from '@/lib/admin/managed-content';
import {
  DEFAULT_POSITION,
  POPUP_DESKTOP_WIDTH,
  isPopupPosition,
  popupDesktopWidth,
  popupImageAspect,
} from '@/lib/popup-positions';

// ---- 폼 값 모델 ----
// RecordForm 이 다루는 평면 값: 필드 kind 에 따라 문자열 / 한·영 쌍 / 문자열 배열.

export type LocalizedPair = { ko: string; en: string };
export type FormValue = string | boolean | LocalizedPair | string[];
export type FormRecord = Record<string, FormValue>;

export interface SelectOption {
  value: string;
  label: string;
}

// ---- 필드 정의 ----

interface FieldBase {
  key: string;
  label: string;
  /** 입력 아래 보조 설명 */
  hint?: string;
  placeholder?: string;
  /** 저장 시 필수 검증 (localized 는 한국어 값 기준) */
  required?: boolean;
  /** 폼 그리드 폭 (기본 full) */
  width?: 'full' | 'half' | 'third';
  /**
   * 빈 값 저장 방식 (문자열 계열 전용).
   * 'null' → null 로 저장 (원본 JSON 이 null 을 쓰는 필드),
   * 'omit' → 키 자체를 생략 (옵셔널 필드), 기본 → 빈 문자열 유지.
   */
  emptyAs?: 'null' | 'omit';
}

export type FieldDef =
  | (FieldBase & { kind: 'text'; readOnlyOnEdit?: boolean })
  | (FieldBase & { kind: 'textarea'; rows?: number })
  | (FieldBase & { kind: 'localized'; multiline?: boolean; rows?: number })
  | (FieldBase & { kind: 'select'; options: SelectOption[]; emptyOptionLabel?: string })
  | (FieldBase & { kind: 'month' })
  // 날짜+시각 한 칸 ('YYYY-MM-DDTHH:mm' 문자열 — 시간대는 사이트 기준 KST 로 읽는다)
  | (FieldBase & { kind: 'datetime' })
  // 숫자 입력. 값은 폼 안에서 문자열로 다루고(FormValue 를 늘리지 않는다),
  // 숫자로의 변환·클램프는 리소스의 fromForm 이 한다.
  | (FieldBase & { kind: 'number'; min?: number; max?: number })
  | (FieldBase & { kind: 'checkbox' }) // 불리언 체크박스 (true/false 저장)
  // 여러 개를 고르는 체크박스 묶음 — 값은 문자열 배열(imageList 와 같은 취급)
  | (FieldBase & { kind: 'checkboxGroup'; options: SelectOption[] })
  // 하나만 고르는 라디오 묶음 — 값은 문자열(select 와 같은 취급)
  | (FieldBase & { kind: 'radio'; options: SelectOption[] })
  // 팝업 공지 전용 — PC·모바일 위치를 **한 위젯에서 함께** 고른다(PopupPositionPicker).
  // 폼 값에는 keys.desktop / keys.mobile 두 문자열 키가 따로 존재하고, 이 필드의
  // key 자체는 값을 갖지 않는다(React key·라벨 용도).
  | (FieldBase & { kind: 'popupPosition'; keys: { desktop: string; mobile: string } })
  | (FieldBase & { kind: 'image' }) // 경로 문자열 + 미리보기
  | (FieldBase & { kind: 'imageList' }) // 경로 문자열 배열
  // 파일 업로드 → 저장소 커밋 후 공개 URL 을 값으로 저장.
  // folder: 커밋 대상 폴더(저장소 루트 기준 — 마지막 세그먼트가 스토리지 uploads/<키>),
  // fileNameFrom: 파일명으로 쓸 폼 필드 key,
  // maxDim/maxSizeMB: 압축 상한(긴 변 px)·원본 용량 게이트 — 히어로처럼 화면을 채우는
  // 사진만 기본값(1600px/5MB)보다 높인다.
  | (FieldBase & {
      kind: 'imageUpload';
      folder: string;
      fileNameFrom: string;
      maxDim?: number;
      maxSizeMB?: number;
    });

// ---- 리소스 정의 ----

export interface ListColumn {
  key: string;
  label: string;
}

/**
 * 목록을 어떤 모양으로 보여줄지 — **표시 전용** 서술자.
 *
 * 데이터 스키마(fields·키·toForm/fromForm)와는 완전히 분리된 계층이다. 여기 적는
 * 것은 "이 리소스를 관리자에게 어떤 화면으로 내밀까"뿐이고, 어떤 값이 어떻게
 * 저장되는지는 전부 FieldDef.kind 가 결정한다(lib/admin/inline.ts).
 *
 * inlineKeys/summaryKeys 등에 적는 key 는 fields 의 key 다. localized 필드는 화면이
 * 알아서 한·영 두 줄로 펼친다(경로는 'role.ko' / 'role.en').
 */
export type ListView =
  /** 표 셀을 그 자리에서 고친다 — 학부/대학원 교과목, 교직원, 장학금.
   *  widths: 이 리소스만의 열 폭(px). InlineTable 의 전역 COLUMN_WIDTH 는 key 로
   *  찾아서 리소스끼리 키가 겹치면(장학금 name ↔ 교과목 name) 서로 폭을 망가뜨린다
   *  — 리소스 고유 키가 아닌 폭은 여기에 적는다. */
  | { kind: 'table'; inlineKeys: string[]; filterKeys?: string[]; widths?: Record<string, number> }
  /** 카드 그리드 — 교수진(4:3 사진), 연구실(16:9), 동아리(가로 카드),
   *  메인 이미지(분야마다 가로 3:2 · 세로 9:16 두 벌을 나란히) */
  | {
      kind: 'cards';
      variant: 'faculty' | 'labs' | 'clubs' | 'hero';
      inlineKeys: string[];
      filterKey?: string;
    }
  /** 행을 펼쳐 긴 텍스트를 고친다 — 교과목 설명 */
  | { kind: 'expandRows'; summaryKeys: string[]; expandKeys: string[] }
  /** 연월 타임라인 — 연혁 */
  | { kind: 'timeline'; dateKey: string; bodyKey: string };

export interface LinkedMarkdown {
  label: string;
  hint?: string;
  /** 항목별 연결 마크다운 파일 경로 (저장소 루트 기준) */
  pathOf: (form: FormRecord) => string;
  /** 지정 시 원문 textarea 대신 전용 구조 편집기를 함께 제공한다.
   *  'clubFeed' 는 동아리 소개 피드 — 마크다운 카드와 폼의 images 필드(사진 짝)를
   *  한 화면에서 함께 편집한다(RecordForm 이 ClubFeedEditor 로 연결). */
  structured?: 'clubFeed';
}

/** 항목 폼에서 함께 편집하는 "공유 record 파일 속 레코드 하나" — 연구실 AI 요약.
 *  linkedMarkdown(항목↔파일 1:1)과 달리 여러 항목이 한 파일을 나눠 쓴다. */
export interface LinkedSummary {
  label: string;
  hint?: string;
  /** 공유 record 파일 경로 */
  file: string;
  /** 폼 값 → record 키 (연구실은 지도교수 한글 이름) */
  keyOf: (form: FormRecord) => string;
}

/**
 * 목록 화면이 본 파일과 **함께** 편집하는 "키 → 사진 URL" 맵 — 연혁 연대 사진.
 *
 * linkedSummary 가 항목 폼 곁에 붙는 공유 파일이라면, 이쪽은 목록 화면 곁에 붙는다.
 * 키가 항목(배열 인덱스)이 아니라 연대라, 항목을 지우거나 순서가 바뀌어도 어긋나지
 * 않는다 — 그래서 인덱스 기반 대기 편집(inlineEdits)과 달리 삭제에도 살아남는다.
 * 저장은 트레이의 같은 "저장 (커밋)" 한 번에 본 파일 뒤로 이어 붙는다.
 */
export interface LinkedImageMap {
  /** 트레이 칩의 필드 이름 — '사진' */
  label: string;
  /** 맵 파일 경로 (저장소 루트 기준) */
  file: string;
  /** 업로드 저장 폴더 키 (스토리지의 uploads/<키>/) */
  folder: string;
  /** 원본 용량 게이트(MB) — 압축은 업로드 경로가 한다 */
  maxSizeMB: number;
  /** 압축 상한(긴 변 px). 생략하면 스토리지 기본(1600) */
  maxDim?: number;
}

export interface ResourceDef {
  key: ResourceKey;
  /** 사이드바·제목 라벨 */
  label: string;
  /** 어느 페이지에 반영되는지 관리자에게 보여줄 안내 */
  description: string;
  /** 저장소 루트 기준 파일 경로 */
  file: string;
  /** array: JSON 배열 / record: idField 값을 키로 하는 객체 (course-descriptions) */
  format: 'array' | 'record';
  /** format==='record' 일 때 직렬화 키가 되는 필드 */
  idField?: string;
  listColumns: ListColumn[];
  /** 목록 검색 대상 필드 키 */
  searchKeys: string[];
  fields: FieldDef[];
  /** 배열 순서가 사이트 노출 순서일 때 ▲▼ 이동·순서 저장 노출 */
  orderable: boolean;
  /**
   * 목록 화면 모양. 없으면 읽기 전용 기본 표(수정/삭제 버튼)로 폴백한다.
   * "보면서 그 자리에서 고친다"를 리소스 성격에 맞는 모양으로 바꿔 주는 자리다.
   */
  listView?: ListView;
  /**
   * '자세히' 화면 모양. 없으면 기본 폼(RecordForm 의 6칸 필드 그리드)이다.
   * 지정하면 그 자리에 리소스 전용 편집기가 들어가, 사이트에서 이 항목이 보이는
   * 배치를 그대로 그리고 값 위에서 바로 고치게 한다(listView 와 같은 취지).
   * 편집기는 RecordForm 과 같은 props 계약(DetailEditorProps)을 받는다.
   */
  detailView?: 'facultyMirror' | 'labMirror' | 'popupForm';
  /** 항목별 연결 마크다운 (동아리 소개 본문) */
  linkedMarkdown?: LinkedMarkdown;
  /** 공유 record 파일 속 이 항목의 레코드 (연구실 AI 요약) */
  linkedSummary?: LinkedSummary;
  /** 목록 화면이 함께 편집하는 "키 → 사진 URL" 맵 파일 (연혁 연대 사진) */
  linkedImageMap?: LinkedImageMap;
  /**
   * 파일이 아직 없어도(GET 404) 목록을 빈 배열로 시작한다 — 팝업 공지처럼
   * "평소에는 비어 있는 게 정상"인 리소스용. 저장은 신규 생성 경로를 탄다.
   * 다른 리소스는 404 를 오류로 띄우는 편이 맞다(시딩 누락을 조용히 덮지 않는다).
   */
  emptyIfMissing?: boolean;
  /** 도메인 레코드 → 폼 값 (기본: defaultToForm) */
  toForm?: (raw: unknown) => FormRecord;
  /** 폼 값 → 도메인 레코드 (기본: defaultFromForm) */
  fromForm?: (form: FormRecord) => unknown;
  /** 커밋 메시지에 넣을 항목 한 줄 요약 */
  summarize: (form: FormRecord) => string;
}

export type ResourceKey =
  | 'history'
  | 'facultyDirectory'
  | 'staff'
  | 'heroSlides'
  | 'coursesUndergraduate'
  | 'courseDescriptions'
  | 'coursesGraduate'
  | 'scholarships'
  | 'clubs'
  | 'labs'
  | 'popups';

// ---- 변환 헬퍼 ----

/** en 이 비면 ko 를 복사한다 (pick 의 en 폴백이 `??` 라 빈 문자열은 폴백 안 됨) */
export function localizedValue(ko: string, en: string): LocalizedPair {
  const k = ko.trim();
  const e = en.trim();
  return { ko: k, en: e === '' ? k : e };
}

/** 도메인 레코드를 필드 정의 기준의 평면 폼 값으로 */
export function defaultToForm(fields: FieldDef[], raw: unknown): FormRecord {
  const r = (raw ?? {}) as Record<string, unknown>;
  const form: FormRecord = {};
  for (const f of fields) {
    if (f.kind === 'localized') {
      const v = (r[f.key] ?? {}) as Partial<LocalizedPair>;
      form[f.key] = { ko: v.ko ?? '', en: v.en ?? '' };
    } else if (f.kind === 'imageList' || f.kind === 'checkboxGroup') {
      const v = r[f.key];
      form[f.key] = Array.isArray(v) ? v.map(String) : [];
    } else if (f.kind === 'checkbox') {
      form[f.key] = r[f.key] === true;
    } else if (f.kind === 'popupPosition') {
      // 이 필드는 자기 key 에 값을 두지 않는다 — keys.desktop / keys.mobile 두 칸이 값이다.
      for (const k of [f.keys.desktop, f.keys.mobile]) {
        const v = r[k];
        form[k] = v == null ? '' : String(v);
      }
    } else {
      const v = r[f.key];
      form[f.key] = v == null ? '' : String(v);
    }
  }
  return form;
}

/** 폼 값을 도메인 레코드로 (키 순서 = 필드 정의 순서 → JSON diff 최소화) */
export function defaultFromForm(fields: FieldDef[], form: FormRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.kind === 'localized') {
      const v = (form[f.key] ?? { ko: '', en: '' }) as LocalizedPair;
      out[f.key] = localizedValue(v.ko, v.en);
    } else if (f.kind === 'imageList' || f.kind === 'checkboxGroup') {
      const arr = ((form[f.key] ?? []) as string[]).map((s) => s.trim()).filter(Boolean);
      if (arr.length > 0 || f.emptyAs !== 'omit') out[f.key] = arr;
    } else if (f.kind === 'checkbox') {
      out[f.key] = form[f.key] === true;
    } else if (f.kind === 'popupPosition') {
      out[f.keys.desktop] = String(form[f.keys.desktop] ?? '').trim();
      out[f.keys.mobile] = String(form[f.keys.mobile] ?? '').trim();
    } else {
      const s = String(form[f.key] ?? '').trim();
      if (s === '') {
        if (f.emptyAs === 'null') out[f.key] = null;
        else if (f.emptyAs !== 'omit') out[f.key] = '';
      } else {
        out[f.key] = s;
      }
    }
  }
  return out;
}

/** 필수 필드 검증. 통과하면 null, 실패하면 한국어 오류 메시지 */
export function validateForm(fields: FieldDef[], form: FormRecord): string | null {
  for (const f of fields) {
    if (!f.required) continue;
    const v = form[f.key];
    if (f.kind === 'localized') {
      if (!((v as LocalizedPair | undefined)?.ko ?? '').trim()) {
        return `${f.label}(한국어)를 입력하세요.`;
      }
    } else if (typeof v === 'string' && v.trim() === '') {
      return `${f.label}을(를) 입력하세요.`;
    }
  }
  return null;
}

/** URL 에서 파일명만 — 트레이 칩·사진 슬롯이 긴 업로드 URL 대신 사람이 알아보는
 *  이름을 말한다. 값이 비었으면 빈 문자열(칩은 그걸 '없음' 으로 그린다). */
export function fileNameOf(url: string): string {
  const clean = url.split(/[?#]/)[0];
  const last = clean.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    // 퍼센트 인코딩이 깨진 URL — 원문을 그대로 보여 주는 편이 빈칸보다 낫다
    return last;
  }
}

/** 목록 셀·검색용 표시 문자열 */
export function cellText(form: FormRecord, key: string): string {
  const v = form[key];
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? '예' : '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.length > 0 ? `${v.length}개` : '';
  return v.ko || v.en || '';
}

// ---- record(키-객체) 직렬화 (course-descriptions.json) ----

/** { code: {...} } 객체를 idField 를 포함한 레코드 배열로 */
export function recordToArray(
  data: Record<string, Record<string, unknown>>,
  idField: string,
): Record<string, unknown>[] {
  return Object.entries(data).map(([k, v]) => ({ [idField]: k, ...v }));
}

/** 레코드 배열을 idField 값을 키로 하는 객체로 (삽입 순서 유지) */
export function arrayToRecord(
  arr: Record<string, unknown>[],
  idField: string,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const item of arr) {
    const { [idField]: key, ...rest } = item;
    out[String(key)] = rest;
  }
  return out;
}

// ---- 공통 옵션 ----

/** 6개 연구 분야 라벨 — messages/ko.json research.fieldFilter 와 동일 표기 */
export const FIELD_OPTIONS: SelectOption[] = [
  { value: 'mechanicsMaterials', label: '역학 · 소재' },
  { value: 'energyThermofluid', label: '에너지 · 열유체' },
  { value: 'roboticsControl', label: '로보틱스 · 제어' },
  { value: 'designManufacturing', label: '설계 · 제조' },
  { value: 'microNano', label: '마이크로 · 나노' },
  { value: 'bioPhotonics', label: '바이오 · 포토닉스' },
];

// ---- 리소스 정의 목록 ----

// 교수진: lab 중첩 객체를 labNameKo/labNameEn/labUrl 로 평면화해 편집한다.
const FACULTY_BASE_FIELDS: FieldDef[] = [
  { kind: 'text', key: 'name', label: '이름', required: true, width: 'third' },
  { kind: 'text', key: 'nameEn', label: '이름 (English)', width: 'third', emptyAs: 'null', placeholder: 'Keonwook Kang', hint: '영문 페이지 표기. 비우면 한국어 이름으로 표시됩니다' },
  { kind: 'text', key: 'title', label: '직급', required: true, width: 'third', placeholder: 'Professor', hint: 'Professor / Associate Professor / Assistant Professor' },
  { kind: 'text', key: 'role', label: '보직', width: 'half', emptyAs: 'null', hint: '학부장 등. 없으면 비움' },
  { kind: 'text', key: 'roleEn', label: '보직 (English)', width: 'half', emptyAs: 'null', placeholder: 'Department Chair', hint: '비우면 영문 페이지에도 한국어 보직이 표시됩니다' },
  { kind: 'text', key: 'email', label: '이메일', width: 'half', emptyAs: 'null' },
  { kind: 'text', key: 'phone', label: '전화', width: 'half', emptyAs: 'null', placeholder: '02)2123-0000' },
  { kind: 'text', key: 'room', label: '연구실 위치', width: 'half', emptyAs: 'null', placeholder: 'Engineering Building #1, Room 589' },
  { kind: 'text', key: 'specialty', label: '전공 분야', width: 'half', emptyAs: 'null', hint: '주로 전임(퇴임) 교원에 사용' },
  { kind: 'text', key: 'specialtyEn', label: '전공 분야 (English)', width: 'half', emptyAs: 'null', hint: '비우면 영문 페이지에도 전공 분야 값이 그대로 표시됩니다' },
  { kind: 'text', key: 'yearRange', label: '재직 기간', width: 'half', emptyAs: 'null', placeholder: '1963~2002', hint: '퇴임 교원만. 재직 중이면 비움 — 적어 두면 아래 체크 없이도 명예·퇴임으로 분류됩니다' },
  // 재직 기간을 모르는 퇴임 교원을 위한 수동 스위치. 기간이 적혀 있으면 그것만으로
  // 분류되므로(사이트의 isEmeritus 가 둘을 OR 로 본다) 이 체크는 "기간 미상" 보완용이다.
  { kind: 'checkbox', key: 'emeritus', label: '명예·퇴임 교원', width: 'half', hint: '재직 기간을 모를 때 직접 체크하세요. 기간을 적었다면 체크하지 않아도 됩니다.' },
  { kind: 'checkbox', key: 'showActivities', label: '학술활동 사이트에 공개', width: 'half', hint: '기본은 비공개입니다 — 상세 페이지에는 교원정보시스템 링크만 표시됩니다. 체크하면 논문·연구과제·지적재산권·수상·학술활동 표가 이 사이트에도 함께 실립니다.' },
  { kind: 'text', key: 'moreInfoUrl', label: '교원정보시스템 URL', width: 'half', emptyAs: 'null', hint: '비우면 수집된 교원정보 페이지 주소를 자동으로 씁니다. 학교가 주소를 옮겼을 때만 직접 넣으세요.' },
  { kind: 'text', key: 'photoAlt', label: '사진 대체 텍스트', width: 'half', hint: '비우면 이름을 사용' },
  {
    kind: 'imageUpload', key: 'photo', label: '프로필 사진', folder: 'public/img/faculty',
    fileNameFrom: 'name', emptyAs: 'omit',
    hint: '이미지를 올리면 이 교수의 프로필 사진으로 저장됩니다(교수진 목록·상세에 반영). 비워두면 public/img/faculty 의 "이름.확장자" 파일이 있으면 그것을 자동 사용합니다.',
  },
];

const FACULTY_LAB_FIELDS: FieldDef[] = [
  { kind: 'text', key: 'labNameKo', label: '연구실명 (한국어)', width: 'half' },
  { kind: 'text', key: 'labNameEn', label: '연구실명 (English)', width: 'half' },
  { kind: 'text', key: 'labUrl', label: '연구실 홈페이지 URL' },
];

const facultyDirectory: ResourceDef = {
  key: 'facultyDirectory',
  label: '교수진',
  description:
    '교수진 페이지와 학부 소개 > 교수진 탭 카드에 반영됩니다. 프로필 사진은 public/img/faculty/ 폴더에 "<이름>.jpg" 형식으로 넣으면 이름 기준으로 자동 연결됩니다.',
  file: MANAGED_FILES.facultyDirectory,
  format: 'array',
  listColumns: [
    { key: 'name', label: '이름' },
    { key: 'title', label: '직급' },
    { key: 'email', label: '이메일' },
    { key: 'yearRange', label: '재직 기간' },
  ],
  searchKeys: ['name', 'nameEn', 'title', 'email', 'specialty'],
  fields: [...FACULTY_BASE_FIELDS, ...FACULTY_LAB_FIELDS],
  orderable: true,
  // 카드에서 바로 고치는 값 = 자주 손대는 것들. 직급은 필터로만 쓴다(사용자 지시).
  listView: {
    kind: 'cards',
    variant: 'faculty',
    inlineKeys: ['name', 'email', 'phone', 'room', 'photo'],
    filterKey: 'title',
  },
  // '자세히'는 교수 개인 상세 페이지의 프로필 카드 배치를 그대로 미러링한다.
  detailView: 'facultyMirror',
  // AI 연구요약은 연구실과 같은 구조 — 교수 한글 이름을 키로 한 공유 record 파일
  // 하나를 나눠 쓰고, 저장 시 그 레코드 한 칸만 갈아 끼운다.
  // ⚠️ 크롤 산출물인 faculty-profiles/<이름>.json 에 쓰지 않는다(재크롤에 지워진다).
  //    자세한 사정은 lib/faculty.ts 의 getFacultySummaries 주석.
  linkedSummary: {
    label: 'AI 연구요약',
    hint: '교수 상세 페이지의 "AI 연구요약" 패널 문안입니다. 문단은 빈 줄로 나눕니다. 비워 두면 이 교수에게는 요약 버튼이 뜨지 않습니다. 상세 페이지가 있는 교수(학술활동 데이터가 있는 교수)에게만 표시됩니다.',
    file: MANAGED_FILES.facultySummaries,
    keyOf: (form) => String(form.name ?? '').trim(),
  },
  toForm: (raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const lab = (r.lab ?? null) as { nameKo?: string; nameEn?: string; url?: string } | null;
    const form = defaultToForm(FACULTY_BASE_FIELDS, r);
    form.labNameKo = lab?.nameKo ?? '';
    form.labNameEn = lab?.nameEn ?? '';
    form.labUrl = lab?.url ?? '';
    return form;
  },
  fromForm: (form) => {
    const out = defaultFromForm(FACULTY_BASE_FIELDS, form);
    if (!String(form.photoAlt ?? '').trim()) {
      out.photoAlt = String(form.name ?? '').trim();
    }
    const nameKo = String(form.labNameKo ?? '').trim();
    const nameEn = String(form.labNameEn ?? '').trim();
    const url = String(form.labUrl ?? '').trim();
    out.lab = nameKo || nameEn || url ? { nameKo, nameEn, url } : null;
    // 공개하지 않으면 키 자체를 생략(JSON 최소화 — 기본값 false = 비공개)
    if (out.showActivities !== true) delete out.showActivities;
    // 구 키 정리 — 반대 의미(숨기기)라 남겨 두면 다음 편집자가 오해한다.
    delete out.hideActivities;
    return out;
  },
  summarize: (f) => cellText(f, 'name'),
};

const history: ResourceDef = {
  key: 'history',
  label: '연혁',
  description:
    '학부 소개 > 연혁 탭 타임라인에 반영됩니다. 사이트에서 연월 내림차순(최근→과거)으로 자동 정렬되므로 입력 순서는 무관합니다.',
  file: MANAGED_FILES.history,
  format: 'array',
  listColumns: [
    { key: 'date', label: '연월' },
    { key: 'title', label: '내용' },
  ],
  searchKeys: ['date', 'title'],
  fields: [
    { kind: 'month', key: 'date', label: '연월', required: true, width: 'third', hint: '예: 1958-12' },
    { kind: 'localized', key: 'title', label: '내용', required: true, multiline: true, rows: 2 },
  ],
  orderable: false,
  // 사이트가 연월 내림차순으로 자동 정렬하므로 순서 이동을 두지 않는다(orderable:false).
  listView: { kind: 'timeline', dateKey: 'date', bodyKey: 'title' },
  // 연대 사진 — 사진은 항목이 아니라 **연대**에 붙으므로 별도 맵 파일이다.
  // 좌우 배치는 사이트가 정한다(사진 있는 연대끼리 자동 교대) — 고를 값이 없어
  // 필드로 두지 않는다. 자세한 사정은 managed-content.ts 의 historyImages 주석.
  linkedImageMap: {
    label: '사진',
    file: MANAGED_FILES.historyImages,
    folder: 'history',
    maxSizeMB: 10,
  },
  summarize: (f) => `${cellText(f, 'date')} ${cellText(f, 'title')}`,
};

const staff: ResourceDef = {
  key: 'staff',
  label: '교직원',
  description: '학부 소개 > 교직원 탭 표에 반영됩니다. 표에는 입력한 순서대로 표시됩니다.',
  file: MANAGED_FILES.staff,
  format: 'array',
  listColumns: [
    { key: 'role', label: '담당' },
    { key: 'name', label: '이름' },
    { key: 'phone', label: '전화' },
    { key: 'email', label: '이메일' },
  ],
  searchKeys: ['role', 'name', 'email'],
  fields: [
    { kind: 'localized', key: 'role', label: '담당 업무', required: true, width: 'half' },
    { kind: 'localized', key: 'name', label: '이름', required: true, width: 'half' },
    { kind: 'text', key: 'phone', label: '전화', required: true, width: 'half', placeholder: '(02) 2123-2810' },
    { kind: 'text', key: 'email', label: '이메일', required: true, width: 'half' },
    { kind: 'localized', key: 'location', label: '위치', required: true },
  ],
  orderable: true,
  // 한·영 쌍이 많아 표 한 셀에 위아래로 겹쳐 보여준다(화면이 InlineTable 에서 처리).
  listView: { kind: 'table', inlineKeys: ['role', 'name', 'phone', 'email', 'location'] },
  summarize: (f) => cellText(f, 'name'),
};

// 홈 히어로 배경 — 분야 여섯 갈래가 돌아가는 첫 화면 슬라이드쇼.
// 사진은 한 분야마다 두 벌이다: 가로 원본(데스크톱)과 세로 9:16 크롭본(휴대폰).
// HeroSlideshow 가 <picture> 아트디렉션으로 화면비에 따라 하나만 내려받는다.
const HERO_SLIDES_FIELDS: FieldDef[] = [
  {
    kind: 'select', key: 'field', label: '연구 분야', required: true, width: 'half',
    options: FIELD_OPTIONS,
    hint: '이 슬라이드의 분야 바로가기(화살표)가 여는 연구 분야입니다. 여섯 분야가 한 번씩만 쓰이도록 유지하세요.',
  },
  {
    kind: 'localized', key: 'title', label: '분야명', required: true, width: 'half',
    placeholder: '역학 · 소재',
    hint: '히어로 오른쪽 분야 목록에 표시되는 이름입니다.',
  },
  {
    kind: 'imageUpload', key: 'image', label: '가로 사진 (데스크톱·태블릿)', required: true,
    folder: 'public/img/hero', fileNameFrom: 'field',
    // 히어로는 최대 2048w 로 서빙된다 — 기본 압축 상한(1600px)이면 눈에 띄게 물러져
    // 이 필드만 상한을 올린다(용량 게이트도 카메라 원본을 받게 15MB).
    maxDim: 2560, maxSizeMB: 15,
    hint: '가로로 넓은 화면의 배경입니다. 폭 2048px 이상의 가로 사진을 올리세요(현재 사진 3504×2336 ~ 6720×4480). 화면을 꽉 채우도록 잘리므로 핵심 피사체는 가운데에 두세요.',
  },
  {
    kind: 'imageUpload', key: 'imageMobile', label: '세로 사진 (휴대폰)', emptyAs: 'omit',
    folder: 'public/img/hero-mobile', fileNameFrom: 'field',
    maxDim: 2880, maxSizeMB: 15,
    hint: '세로로 긴 화면에서만 쓰는 9:16 크롭본입니다. 1620×2880 권장. 비워 두면 위의 가로 사진을 확대해 쓰므로 좌우가 크게 잘립니다.',
  },
];

const heroSlides: ResourceDef = {
  key: 'heroSlides',
  label: '메인 이미지',
  description:
    '홈(메인) 첫 화면 슬라이드쇼의 배경 사진입니다. 연구 분야 여섯 갈래가 차례로 돌아가고, 오른쪽 분야 목록의 이름도 여기서 옵니다. 한 분야마다 가로(데스크톱)·세로(휴대폰) 두 벌을 쓰며 — 가로는 폭 2048px 이상(현재 3504×2336 ~ 6720×4480), 세로는 1620×2880(9:16) 권장, 한 장당 5MB 이하 — 세로를 비우면 가로 사진으로 대체됩니다. ⚠️ 분야 6개는 고정입니다. 항목을 새로 추가하거나 지우지 말고 사진만 교체하세요.',
  file: MANAGED_FILES.heroSlides,
  format: 'array',
  listColumns: [
    { key: 'title', label: '분야' },
    { key: 'image', label: '사진' },
  ],
  searchKeys: ['title', 'field'],
  fields: HERO_SLIDES_FIELDS,
  // 배열 순서 = 슬라이드 순서. 6장뿐이라 ▲▼ 로 충분하다.
  orderable: true,
  // 이 리소스에서 실제로 고치는 값은 사진 두 벌뿐이다. 그래서 표(파일 경로 문자열)가
  // 아니라 분야마다 가로·세로 미리보기를 나란히 띄우고 그 아래 '수정'으로 바로 교체한다
  // (HeroCardsEditor). inlineKeys 는 cards 서술자의 형식을 맞추기 위한 값이고, 두 칸의
  // 배치·비율은 화면이 직접 안다 — 가로와 세로는 프레임 모양도 빈 값 규칙도 다르다.
  // ⚠️ 이 화면에는 '자세히' 폼 진입도 삭제 버튼도 없다(사용자 지정) — 분야 6개는 고정이라
  //    분야명을 고칠 일이 없고, 항목이 늘거나 줄면 슬라이드쇼가 깨진다.
  listView: { kind: 'cards', variant: 'hero', inlineKeys: ['image', 'imageMobile'] },
  summarize: (f) => cellText(f, 'title'),
};

const coursesUndergraduate: ResourceDef = {
  key: 'coursesUndergraduate',
  label: '학부 교과목',
  description:
    '학부 > 개설 교과목 표와 교과목 체계도(로드맵)가 모두 이 데이터로 그려집니다. 체계도에서 과목 클릭 시 나오는 설명은 "교과목 설명"에서 편집하세요.',
  file: MANAGED_FILES.coursesUndergraduate,
  format: 'array',
  listColumns: [
    { key: 'year', label: '학년' },
    { key: 'semester', label: '학기' },
    { key: 'kind', label: '종별' },
    { key: 'code', label: '학정번호' },
    { key: 'name', label: '교과목명' },
  ],
  searchKeys: ['code', 'name'],
  fields: [
    { kind: 'text', key: 'year', label: '학년', required: true, width: 'third', placeholder: '1', hint: '복수 학년은 "3 & 4" 형태' },
    { kind: 'text', key: 'semester', label: '학기', required: true, width: 'third', placeholder: '1' },
    {
      kind: 'select', key: 'kind', label: '종별', required: true, width: 'third',
      options: [
        { value: '대교', label: '대교 (대학교양)' },
        { value: '전필', label: '전필 (전공필수)' },
        { value: '전선', label: '전선 (전공선택)' },
      ],
    },
    { kind: 'text', key: 'code', label: '학정번호', required: true, width: 'third', placeholder: 'MEU3005' },
    { kind: 'text', key: 'name', label: '교과목명', required: true, width: 'third' },
    { kind: 'text', key: 'credits', label: '학점', width: 'third', placeholder: '3' },
    { kind: 'text', key: 'hours', label: '강의(실습) 시간', width: 'third', placeholder: '3(1)' },
    {
      kind: 'select', key: 'field', label: '연구 분야 (체계도 레인)', width: 'third',
      options: FIELD_OPTIONS, emptyAs: 'null', emptyOptionLabel: '기초·공통 (분야 없음)',
    },
  ],
  orderable: true,
  listView: {
    kind: 'table',
    inlineKeys: ['year', 'semester', 'kind', 'code', 'name', 'credits', 'hours', 'field'],
    filterKeys: ['kind', 'year'],
  },
  summarize: (f) => `${cellText(f, 'code')} ${cellText(f, 'name')}`,
};

const courseDescriptions: ResourceDef = {
  key: 'courseDescriptions',
  label: '교과목 설명',
  description:
    '교과목 체계도에서 과목을 클릭하면 나오는 상세 설명입니다. 학정번호가 학부 교과목의 학정번호와 일치해야 체계도에 연결됩니다.',
  file: MANAGED_FILES.courseDescriptions,
  format: 'record',
  idField: 'code',
  listColumns: [
    { key: 'code', label: '학정번호' },
    { key: 'nameEn', label: '영문 과목명' },
  ],
  searchKeys: ['code', 'nameEn', 'desc'],
  fields: [
    { kind: 'text', key: 'code', label: '학정번호', required: true, width: 'third', readOnlyOnEdit: true, placeholder: 'MEU3005' },
    { kind: 'text', key: 'nameEn', label: '영문 과목명', placeholder: 'Mechanical Engineering Laboratory II' },
    { kind: 'textarea', key: 'desc', label: '과목 설명', rows: 6, required: true },
  ],
  orderable: false,
  // 설명이 길어 표 셀에 담기지 않는다 — 요약 행을 눌러 펼친 뒤 고친다.
  listView: { kind: 'expandRows', summaryKeys: ['code', 'nameEn'], expandKeys: ['nameEn', 'desc'] },
  summarize: (f) => cellText(f, 'code'),
};

const coursesGraduate: ResourceDef = {
  key: 'coursesGraduate',
  label: '대학원 교과목',
  description: '대학원 > 교과목 소개 표에 반영됩니다.',
  file: MANAGED_FILES.coursesGraduate,
  format: 'array',
  listColumns: [
    { key: 'code', label: '학정번호' },
    { key: 'name', label: '과목명' },
    { key: 'credits', label: '학점' },
  ],
  searchKeys: ['code', 'name'],
  fields: [
    { kind: 'text', key: 'code', label: '학정번호', required: true, width: 'third', placeholder: 'MEU5001' },
    { kind: 'text', key: 'name', label: '과목명', required: true, hint: '"국문명 (English Title)" 병기 형식' },
    { kind: 'text', key: 'credits', label: '학점', width: 'third', placeholder: '3' },
    {
      kind: 'select', key: 'field', label: '연구 분야', width: 'third',
      options: FIELD_OPTIONS, emptyAs: 'null', emptyOptionLabel: '공통 (분야 없음)',
    },
  ],
  orderable: true,
  listView: { kind: 'table', inlineKeys: ['code', 'name', 'credits', 'field'], filterKeys: ['field'] },
  summarize: (f) => `${cellText(f, 'code')} ${cellText(f, 'name')}`,
};

// 장학금 — 2026-08 마크다운 표에서 전환(교직원과 같은 인라인 표 방식, 사용자 지시).
// 사이트의 5열 표가 그대로 편집 표가 된다. 여러 줄 셀(추천기준·장학금액)은 textarea 로,
// 셀 안 줄바꿈이 사이트에서도 줄바꿈으로 표시된다(구 md 의 <br> 에 대응).
const scholarships: ResourceDef = {
  key: 'scholarships',
  label: '장학금',
  description:
    '학부 > 장학금 탭의 표에 반영됩니다. "묶음"이 같은 행끼리 한 표가 되고(예: 교외 장학금), 행 순서가 표의 순서입니다.',
  file: MANAGED_FILES.scholarships,
  format: 'array',
  listColumns: [
    { key: 'section', label: '묶음' },
    { key: 'name', label: '장학금명' },
    { key: 'timing', label: '선발시기' },
  ],
  searchKeys: ['section', 'name', 'criteria'],
  // 전 열이 textarea — 표 셀에서 줄바꿈으로 감겨 좁은 열에서도 전문이 보인다
  // (input 은 넘친 글자가 잘려 보인다). 셀 안 줄바꿈은 사이트에서도 줄바꿈이 된다.
  fields: [
    {
      kind: 'textarea', key: 'section', label: '묶음', rows: 2, required: true, width: 'third',
      placeholder: '교외 장학금', hint: '같은 묶음끼리 한 표로 표시됩니다. 오타가 나면 표가 갈라지니 기존 표기를 그대로 쓰세요',
    },
    { kind: 'textarea', key: 'name', label: '장학금명', rows: 2, required: true },
    { kind: 'textarea', key: 'criteria', label: '추천기준', rows: 5, required: true },
    { kind: 'textarea', key: 'count', label: '선발인원', rows: 2, width: 'third' },
    { kind: 'textarea', key: 'amount', label: '장학금액', rows: 3 },
    { kind: 'textarea', key: 'timing', label: '선발시기', rows: 2, width: 'third' },
  ],
  orderable: true,
  // 사이트 표와 같은 5열을 그 자리에서 고친다(교직원 방식). 묶음은 칩 필터로 오간다.
  // 폭 합 838 + 동작열 110 = 948px — 사이드바 240 기준 1280 화면(본문 960px)에
  // 가로 스크롤 없이 들어가는 상한이다. 추천기준만 폭을 비워 남는 폭을 다 가져간다.
  listView: {
    kind: 'table',
    inlineKeys: ['section', 'name', 'criteria', 'count', 'amount', 'timing'],
    filterKeys: ['section'],
    widths: { section: 112, name: 160, count: 104, amount: 168, timing: 104 },
  },
  summarize: (f) => cellText(f, 'name'),
};

// 동아리: 사진 짝 보존 fromForm 이 images 필드를 다시 만지므로 필드를 상수로 분리한다.
const CLUBS_FIELDS: FieldDef[] = [
  {
    kind: 'text', key: 'slug', label: 'slug', required: true, width: 'third', readOnlyOnEdit: true,
    placeholder: 'yonseidrone', hint: '영문 소문자 식별자. 상세 페이지 주소와 소개 본문 파일명에 사용됩니다',
  },
  { kind: 'text', key: 'name', label: '이름', required: true, hint: '예: 메카 (MECar)' },
  { kind: 'textarea', key: 'teaser', label: '카드 소개 문구', rows: 3, required: true },
  // 상세 페이지 사진 — 폼 그리드에는 나오지 않는다(RecordForm 이 clubFeed 리소스의
  // 'images' 를 숨긴다). 값 편집은 소개 피드(ClubFeedEditor)가 카드와 짝지어 대신한다.
  {
    kind: 'imageList', key: 'images', label: '상세 페이지 사진', emptyAs: 'omit',
    hint: '소개 피드의 카드마다 한 장씩 짝지어 표시됩니다',
  },
];

const clubs: ResourceDef = {
  key: 'clubs',
  label: '동아리 소개',
  description:
    '학부 > 동아리 소개 카드와 동아리 상세 페이지에 반영됩니다. 카드 로고는 코드의 slug 매핑을 사용하므로 새 동아리 로고는 개발자에게 요청하세요.',
  file: MANAGED_FILES.clubs,
  format: 'array',
  listColumns: [
    { key: 'slug', label: 'slug' },
    { key: 'name', label: '이름' },
    { key: 'images', label: '사진' },
  ],
  searchKeys: ['slug', 'name', 'teaser'],
  fields: CLUBS_FIELDS,
  orderable: true,
  // 이름·카드 문구만 목록에서 고친다. 상세 카드뉴스(마크다운)는 별도 파일이라
  // 커밋 묶음이 달라 '자세히' 폼의 기존 경로(linkedMarkdown)를 그대로 쓴다.
  listView: { kind: 'cards', variant: 'clubs', inlineKeys: ['name', 'teaser'] },
  linkedMarkdown: {
    label: '소개 피드',
    hint: '사진 한 장 + 설명 한 문단이 피드 카드 하나입니다. 실제 페이지와 같은 배치로 보면서 그 자리에서 고치세요.',
    pathOf: (form) => `content/pages/club-${String(form.slug ?? '').trim()}.md`,
    structured: 'clubFeed',
  },
  /**
   * 사진·문단 짝(인덱스) 보존 — 사이트는 i번째 카드에 images[i] 를 붙인다.
   * 기본 fromForm 은 imageList 의 빈 값을 전부 걸러내는데, 그러면 "가운데 카드만
   * 사진 없음"(빈 문자열 자리표시자)이 사라져 뒤 카드 사진이 한 칸씩 밀린다.
   * 그래서 가운데 빈 자리는 남기고 꼬리의 빈 값만 자른다. 사이트 렌더러는 falsy 값에
   * 데코 블록을 그리므로 빈 문자열이 그대로 "사진 없는 카드"로 표시된다.
   */
  fromForm: (form) => {
    const out = defaultFromForm(CLUBS_FIELDS, form) as Record<string, unknown>;
    const images = (Array.isArray(form.images) ? (form.images as string[]) : []).map((s) =>
      String(s).trim(),
    );
    while (images.length > 0 && images[images.length - 1] === '') images.pop();
    if (images.length > 0) out.images = images;
    else delete out.images; // 기본 규칙(emptyAs: 'omit')과 동일하게 키를 생략
    return out;
  },
  summarize: (f) => cellText(f, 'name'),
};

// 연구실: 인턴 모집 체크박스·인원은 fromForm 에서 후처리하므로 필드를 상수로 분리한다.
const LABS_FIELDS: FieldDef[] = [
  { kind: 'text', key: 'nameKo', label: '연구실명 (한국어)', required: true, width: 'half' },
  { kind: 'text', key: 'nameEn', label: '연구실명 (English)', width: 'half' },
  { kind: 'text', key: 'professorKo', label: '지도교수 (한국어)', required: true, width: 'half' },
  { kind: 'text', key: 'professorEn', label: '지도교수 (English)', width: 'half' },
  { kind: 'text', key: 'location', label: '위치', width: 'half', placeholder: '공학관 N204' },
  { kind: 'text', key: 'phone', label: '전화', width: 'half', placeholder: '02-2123-0000' },
  { kind: 'text', key: 'url', label: '연구실 홈페이지 URL', hint: '비우면 링크 없는 카드로 표시됩니다' },
  { kind: 'image', key: 'image', label: '대표 이미지 경로', emptyAs: 'omit', placeholder: '/img/labs/lab-name.jpg', hint: '비우면 기본 이미지를 순환 사용합니다' },
  {
    kind: 'text', key: 'video', label: '소개 영상 URL', emptyAs: 'omit',
    hint: 'YouTube watch 또는 Google Drive file 링크. 대학원 > 연구실 소개 영상 갤러리에 노출됩니다',
  },
  { kind: 'select', key: 'field', label: '연구 분야', required: true, width: 'third', options: FIELD_OPTIONS },
  {
    kind: 'checkbox', key: 'internRecruiting', label: '학부 인턴 모집 중', width: 'half',
    hint: '체크하면 연구실 목록에 "학부 인턴 모집 중" 배지가 붙고, 목록 상단 필터로 모아볼 수 있습니다',
  },
  {
    kind: 'text', key: 'internCount', label: '모집 인원', width: 'half', emptyAs: 'omit', placeholder: '2',
    hint: '모집 인원 수(숫자만). "학부 인턴 모집 중"일 때만 저장되며, 비우면 인원 없이 배지만 표시됩니다',
  },
];

const labs: ResourceDef = {
  key: 'labs',
  label: '연구실 · 소개 영상',
  description:
    '연구 메뉴의 연구실 목록과 대학원 > 연구실 탭의 소개 영상 갤러리에 반영됩니다. 소개 영상 URL을 채우면 영상 갤러리에 노출됩니다. "학부 인턴 모집 중"을 체크하면 연구실 목록에 배지가 표시됩니다. 연구실 목록의 "AI 연구요약" 패널 문안도 각 연구실의 "자세히" 폼 아래쪽에서 함께 편집합니다.',
  file: MANAGED_FILES.labs,
  format: 'array',
  listColumns: [
    { key: 'nameKo', label: '연구실명' },
    { key: 'professorKo', label: '지도교수' },
    { key: 'field', label: '분야' },
    { key: 'internRecruiting', label: '인턴 모집' },
  ],
  searchKeys: ['nameKo', 'nameEn', 'professorKo', 'professorEn'],
  fields: LABS_FIELDS,
  orderable: true,
  listView: {
    kind: 'cards',
    variant: 'labs',
    inlineKeys: [
      'nameKo',
      'nameEn',
      'professorKo',
      'location',
      'phone',
      'internRecruiting',
    ],
    filterKey: 'field',
  },
  // '자세히'는 연구실 목록의 한 행이 보이는 모습을 그대로 미러링한다.
  detailView: 'labMirror',
  // AI 요약은 연구실마다 파일이 따로 있는 게 아니라 지도교수 이름을 키로 한 공유
  // record 파일 하나를 나눠 쓴다 — 저장 시 그 레코드 한 칸만 갈아 끼운다.
  linkedSummary: {
    label: 'AI 연구요약',
    hint: '연구 > 연구실 목록의 AI 연구요약 패널 문안입니다. 한 문단으로 쓰세요(줄바꿈은 빈 줄로 노출). 분량 기준: 한국어 180~230자, 영어 320~420자. 비워 두면 이 연구실에는 버튼이 뜨지 않습니다.',
    file: MANAGED_FILES.labSummaries,
    keyOf: (form) => String(form.professorKo ?? '').trim(),
  },
  fromForm: (form) => {
    const out = defaultFromForm(LABS_FIELDS, form);
    // 모집 인원: 숫자로 저장. "모집 중"이 아니거나 값이 없으면 생략한다.
    const n = parseInt(String(form.internCount ?? '').trim(), 10);
    if (out.internRecruiting === true && Number.isFinite(n) && n > 0) out.internCount = n;
    else delete out.internCount;
    // 모집 중이 아니면 플래그 자체를 생략(JSON 최소화 — 기본값 false)
    if (out.internRecruiting !== true) delete out.internRecruiting;
    return out;
  },
  summarize: (f) => cellText(f, 'nameKo'),
};

// 팝업 공지 — 게재 기간 안에만 사이트 위에 뜨는 사진 팝업(레이어)·상단 배너.
// 항목 순서가 화면에 나란히 놓이는 순서다. 기간·기기·페이지 판정은 브라우저가
// 하므로(정적 페이지는 종료일에 다시 그려지지 않는다) 여기 값은 그대로 사이트로 간다.
const POPUP_PAGE_OPTIONS: SelectOption[] = [
  { value: 'home', label: '홈(메인)' },
  { value: 'about', label: '학부소개' },
  { value: 'undergraduate', label: '학부' },
  { value: 'graduate', label: '대학원' },
  { value: 'research', label: '연구' },
  { value: 'news', label: '뉴스·공지' },
  { value: 'faculty', label: '교수진' },
  { value: 'alumni', label: '동문' },
  { value: 'contact', label: '문의' },
];

const POPUPS_FIELDS: FieldDef[] = [
  {
    kind: 'text', key: 'id', label: '식별자', readOnlyOnEdit: true, width: 'third',
    hint: '자동 생성됩니다. 비워 두세요',
  },
  {
    kind: 'localized', key: 'title', label: '제목', required: true,
    hint: '관리용 제목입니다. 사진을 못 보는 방문자에게 읽어 주는 설명으로도 쓰입니다',
  },
  {
    kind: 'datetime', key: 'start', label: '게재 시작', required: true, width: 'half',
    hint: '한국 시간 기준입니다',
  },
  {
    kind: 'datetime', key: 'end', label: '게재 종료', required: true, width: 'half',
    hint: '한국 시간 기준입니다. 종료가 시작보다 빠르면 팝업이 뜨지 않습니다',
  },
  {
    kind: 'popupPosition', key: 'position', label: '위치',
    keys: { desktop: 'positionDesktop', mobile: 'positionMobile' },
    hint: 'PC 와 모바일의 위치를 각각 고를 수 있습니다 — 팝업을 두 개 만들 필요가 없습니다',
  },
  {
    // 전용 폼(PopupDetailEditor)에 제 행을 갖지 않는다 — 위치 위젯 안에서 함께 고친다.
    // 여기 선언은 값의 저장·복원(toForm/fromForm)과 한계 표시를 위한 것이다.
    kind: 'number', key: 'widthDesktop', label: 'PC 카드 폭', width: 'half',
    min: POPUP_DESKTOP_WIDTH.min, max: POPUP_DESKTOP_WIDTH.max,
    hint: `px. 기본 ${POPUP_DESKTOP_WIDTH.default} — 화면에 안 들어가면 사진 비율을 지키며 자동으로 줄어듭니다`,
  },
  {
    // 이것도 전용 폼에 제 행이 없다(widthDesktop 과 같은 관례) — 값은 사진을 올릴 때
    // 편집기가 재서 폼에 심고, 여기 선언은 저장·복원(toForm/fromForm)을 위한 것이다.
    kind: 'number', key: 'imageAspect', label: '사진 비율', emptyAs: 'omit',
    hint: '가로÷세로. 사진을 올리면 자동으로 잽니다',
  },
  {
    kind: 'checkboxGroup', key: 'devices', label: '대상 기기',
    options: [
      { value: 'desktop', label: '데스크톱' },
      { value: 'mobile', label: '모바일' },
    ],
    hint: '아무것도 고르지 않으면 두 기기 모두에 표시됩니다',
  },
  {
    kind: 'checkboxGroup', key: 'pages', label: '노출 페이지',
    options: POPUP_PAGE_OPTIONS,
    hint: '아무것도 고르지 않으면 홈(메인)에만 표시됩니다',
  },
  {
    kind: 'radio', key: 'closeControl', label: '우측 상단 닫기 설정', width: 'half',
    options: [
      { value: 'close', label: '닫기' },
      { value: 'hideToday', label: '오늘 하루 다시 보지 않기' },
      { value: 'none', label: '표시안함' },
    ],
  },
  {
    kind: 'checkbox', key: 'hideTodayButton',
    label: '배너 하단 "오늘 하루 보지 않기" 버튼 표시',
  },
  {
    kind: 'imageUpload', key: 'image', label: '사진', required: true,
    // maxDim 2400: 카드 폭 상한이 없어져 큰 화면에서는 사진이 1000px 넘게 그려진다 —
    // 1600 으로 줄이면 그때 물러 보인다.
    folder: 'public/img/popup', fileNameFrom: 'id', maxDim: 2400, maxSizeMB: 5,
    hint: '표시할 폭의 2배 이상 해상도를 권장합니다. 크기·위치는 위치 미리보기에서 정합니다',
  },
  {
    kind: 'imageUpload', key: 'imageMobile', label: '모바일 사진', emptyAs: 'omit',
    folder: 'public/img/popup', fileNameFrom: 'id', maxDim: 2400, maxSizeMB: 5,
    hint: '비우면 PC 사진을 씁니다',
  },
  {
    kind: 'text', key: 'link', label: '이미지 링크', emptyAs: 'omit', width: 'half',
    placeholder: 'https://',
    hint: '비워 두면 사진을 눌러도 아무 일도 일어나지 않습니다',
  },
  { kind: 'checkbox', key: 'newTab', label: '새 창에서 열기', width: 'half' },
  { kind: 'checkbox', key: 'enabled', label: '노출' },
];

const popups: ResourceDef = {
  key: 'popups',
  label: '팝업 공지',
  description:
    '지정한 페이지의 첫 화면에 게재 기간 동안만 뜨는 사진 팝업입니다. PC와 모바일의 위치를 각각 골라 한 항목으로 두 화면을 모두 덮습니다.',
  file: MANAGED_FILES.popups,
  format: 'array',
  // 평소에는 팝업이 하나도 없는 게 정상이라 파일이 없어도 빈 목록에서 시작한다.
  emptyIfMissing: true,
  // 셀 내용은 값 그대로가 아니라 CollectionEditor 의 팝업 전용 셀(popup-list-cells)이
  // 그린다 — 썸네일·기간 두 줄·상태 배지는 한 값만으로 만들 수 없기 때문이다.
  // 'period'·'status' 는 폼에 없는 **가상 키**라 특수 셀에서만 의미가 있다.
  listColumns: [
    { key: 'image', label: '썸네일' },
    { key: 'title', label: '제목' },
    // 위치 두 칸은 키('topRight')가 아니라 라벨('우측 상단')로 보인다.
    { key: 'positionDesktop', label: 'PC 위치' },
    { key: 'positionMobile', label: '모바일 위치' },
    { key: 'period', label: '게재 기간' },
    { key: 'status', label: '상태' },
  ],
  searchKeys: ['title'],
  fields: POPUPS_FIELDS,
  // 설정을 위에서 아래로 읽으며 정하는 화면이라 범용 6칸 그리드 대신 전용 행 폼을 쓴다.
  detailView: 'popupForm',
  orderable: true,
  toForm: (raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const form = defaultToForm(POPUPS_FIELDS, r);
    // 기본값 보정 — 새 항목이든 옛 항목이든 폼에서는 항상 유효한 조합을 보여 준다.
    if ((form.devices as string[]).length === 0) form.devices = ['desktop', 'mobile'];
    if ((form.pages as string[]).length === 0) form.pages = ['home'];
    if (form.closeControl === '') form.closeControl = 'close';
    // 위치는 옛 항목(스타일 시절)에 아예 없으므로 기기별 기본값을 채운다.
    if (!isPopupPosition('desktop', form.positionDesktop)) {
      form.positionDesktop = DEFAULT_POSITION.desktop;
    }
    if (!isPopupPosition('mobile', form.positionMobile)) {
      form.positionMobile = DEFAULT_POSITION.mobile;
    }
    // PC 카드 폭도 옛 항목엔 없다 — 폼에서는 늘 실제 그려지는 값이 보여야 리사이즈
    // 위젯이 빈칸에서 시작하지 않는다. (number kind 의 폼 값은 문자열이다.)
    form.widthDesktop = String(popupDesktopWidth(form.widthDesktop));
    // 사진 비율은 반대로 **없으면 빈칸**이다 — 옛 항목은 아직 재지 않았다는 뜻이고,
    // 편집기가 사진을 읽어 다시 채운다(기본값을 지어내면 카드가 엉뚱하게 줄어든다).
    const aspect = popupImageAspect(r.imageAspect);
    form.imageAspect = aspect ? String(aspect) : '';
    // checkbox 는 defaultToForm 이 `=== true` 로 읽어 키가 없으면 false 가 된다.
    // 노출·"오늘 하루" 버튼은 없을 때 켜져 있는 편이 기대에 맞다.
    if (r.enabled === undefined) form.enabled = true;
    if (r.hideTodayButton === undefined) form.hideTodayButton = true;
    return form;
  },
  fromForm: (form) => {
    const out = defaultFromForm(POPUPS_FIELDS, form);
    if (!String(out.id ?? '').trim()) out.id = `popup-${Date.now().toString(36)}`;
    const devices = (out.devices as string[] | undefined) ?? [];
    out.devices = devices.length > 0 ? devices : ['desktop', 'mobile'];
    const pages = (out.pages as string[] | undefined) ?? [];
    out.pages = pages.length > 0 ? pages : ['home'];
    if (!out.closeControl) out.closeControl = 'close';
    // 알 수 없는 위치 값(옛 스타일 키 포함)은 기본값으로 — 사이트도 같은 규칙이다.
    if (!isPopupPosition('desktop', out.positionDesktop)) {
      out.positionDesktop = DEFAULT_POSITION.desktop;
    }
    if (!isPopupPosition('mobile', out.positionMobile)) {
      out.positionMobile = DEFAULT_POSITION.mobile;
    }
    // 폼은 문자열을 들고 있으므로 여기서 숫자로 바꿔 저장한다 — 사이트가 그대로
    // px 로 쓰는 값이라 빈칸·범위 밖은 같은 함수가 기본값·한계로 보정한다.
    out.widthDesktop = popupDesktopWidth(out.widthDesktop);
    // 사진 비율도 숫자로. 아직 재지 못했으면(사진 없음·로드 실패) 키를 아예 생략해
    // 옛 항목과 같은 폴백 경로로 그려지게 한다.
    const aspect = popupImageAspect(out.imageAspect);
    if (aspect) out.imageAspect = aspect;
    else delete out.imageAspect;
    return out;
  },
  summarize: (f) => cellText(f, 'title'),
};

export const RESOURCES: Record<ResourceKey, ResourceDef> = {
  history,
  facultyDirectory,
  staff,
  heroSlides,
  coursesUndergraduate,
  courseDescriptions,
  coursesGraduate,
  scholarships,
  clubs,
  labs,
  popups,
};

export function getResource(key: ResourceKey): ResourceDef {
  return RESOURCES[key];
}

// ---- 단일 마크다운 페이지 ----

export interface MarkdownPageDef {
  key: string;
  label: string;
  file: string;
  description: string;
}

// 장학금(scholarship)은 2026-08 구조화 전환으로 collection 리소스가 됐다 —
// 마크다운 단일 페이지가 다시 생기면(BK21 등) 여기에 등록한다.
export const MARKDOWN_PAGES: MarkdownPageDef[] = [];

export function getMarkdownPage(key: string): MarkdownPageDef {
  const found = MARKDOWN_PAGES.find((p) => p.key === key);
  if (!found) throw new Error(`알 수 없는 마크다운 페이지: ${key}`);
  return found;
}

// ---- 전용 편집 화면 ----
//
// 목록+폼(CollectionEditor)으로 표현할 수 없는 데이터를 위한 자리다. 체계도의
// course-flow.json 은 배열도 키-객체도 아닌 {nodes, edges} 한 덩어리이고, 무엇보다
// "어느 카드가 어디 있고 어떤 선으로 이어지는가"는 표로 봐서는 알 수 없다 — 그래서
// 학생이 보는 그림을 그대로 그려 놓고 그 위에서 고치는 전용 화면을 준다.

export type ScreenKey = 'curriculumMap';

export interface ScreenDef {
  key: ScreenKey;
  label: string;
  description: string;
  /** 저장소 루트 기준 파일 경로 */
  file: string;
}

export const SCREENS: Record<ScreenKey, ScreenDef> = {
  curriculumMap: {
    key: 'curriculumMap',
    label: '교과목 체계도',
    description:
      '학부 > 교과목 체계도에 반영됩니다. 화살표(선수·연계 관계)와 카드의 세로 자리를 학생이 보는 화면 그대로 고칩니다. 과목 추가·삭제와 학년·학기·분야(어느 칸에 놓일지)는 "학부 교과목"에서 합니다.',
    file: MANAGED_FILES.curriculumMap,
  },
};

export function getScreen(key: ScreenKey): ScreenDef {
  return SCREENS[key];
}

// ---- 콘솔 사이드바 구성 ----

export type MenuEntry =
  | { type: 'board'; boardKey: BoardKey }
  | { type: 'collection'; resourceKey: ResourceKey }
  | { type: 'markdown'; pageKey: string }
  | { type: 'screen'; screenKey: ScreenKey }
  | { type: 'placeholder'; label: string; note: string };

export interface MenuGroup {
  label: string;
  entries: MenuEntry[];
}

/** 사이드바 그룹 — 사이트 메뉴 구조와 같은 어순으로 배치한다 */
export const MENU_GROUPS: MenuGroup[] = [
  // 일정은 게시판·데이터 어느 묶음에도 속하지 않는 별도 축(달력)이라 독립 그룹으로
  // 맨 위에 둔다 — "이번 달에 무엇이 있나"는 콘솔에 들어와 가장 먼저 보는 화면이다.
  // 저장처는 다른 게시판과 같은 Supabase posts(board='calendar') 다.
  {
    label: '일정',
    entries: [{ type: 'board', boardKey: 'calendar' }],
  },
  {
    label: '뉴스·공지',
    entries: [
      // 팝업 공지는 "지금 사이트 위에 무엇이 떠 있나"라 이 묶음 맨 앞에 둔다.
      { type: 'collection', resourceKey: 'popups' },
      { type: 'board', boardKey: 'news' },
      { type: 'board', boardKey: 'noticesUndergrad' },
      { type: 'board', boardKey: 'noticesGraduate' },
      { type: 'board', boardKey: 'noticesExternal' },
      { type: 'board', boardKey: 'noticesScholarship' },
      { type: 'board', boardKey: 'seminars' },
      { type: 'board', boardKey: 'events' },
      { type: 'board', boardKey: 'thesis' },
      { type: 'board', boardKey: 'resources' },
      { type: 'board', boardKey: 'career' },
      { type: 'board', boardKey: 'instagram' },
    ],
  },
  {
    label: '학과 소개',
    entries: [
      { type: 'collection', resourceKey: 'history' },
      { type: 'collection', resourceKey: 'facultyDirectory' },
      { type: 'collection', resourceKey: 'staff' },
      { type: 'collection', resourceKey: 'heroSlides' },
    ],
  },
  {
    label: '학사·교과',
    entries: [
      { type: 'collection', resourceKey: 'coursesUndergraduate' },
      { type: 'collection', resourceKey: 'courseDescriptions' },
      { type: 'screen', screenKey: 'curriculumMap' },
      { type: 'collection', resourceKey: 'coursesGraduate' },
      { type: 'collection', resourceKey: 'scholarships' },
    ],
  },
  {
    label: '학생 활동·연구',
    entries: [
      { type: 'collection', resourceKey: 'clubs' },
      { type: 'collection', resourceKey: 'labs' },
    ],
  },
  {
    // 동문 뉴스 게시판은 2026-09 에 폐지했다 — 동문 소식은 이 하나로 모은다
    label: '동문',
    entries: [{ type: 'board', boardKey: 'alumniEvents' }],
  },
];
