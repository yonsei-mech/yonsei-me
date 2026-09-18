import brochureData from '@content/lab-brochure.json';
import type { LabDirectoryEntry } from '@/lib/faculty';
import type { Locale } from '@/i18n/routing';

/**
 * 연구실 소개자료(구 사이트 사이드바의 "연구실 소개자료" PDF) — 표지 1장 + 연구실별
 * 가로 포스터(870×630pt) 한 장씩. 원본 PDF 를 쪽 단위로 미리 렌더한 이미지를 쓴다.
 *
 * 데이터 계약은 content/lab-brochure.json(쪽 번호 ↔ 지도교수 한글 이름)이고, 연구실
 * 쪽 정보(이름·영문명·홈페이지)는 연구실 디렉터리에서 **professorKo 로 조인**한다
 * (lab-summaries.json 과 같은 키). 조인을 서버에서 끝내 로케일 한쪽만 직렬화해 내려보낸다
 * — 클라이언트 번들에 한/영 양쪽을 싣지 않는 LabList AI 요약과 같은 관례.
 *
 * 이 파일은 서버·클라이언트 어디서 불러도 안전하다('use client' 없음, node:fs 없음).
 * faculty.ts 는 서버 전용이지만 여기선 **타입만** 가져오므로 번들에 섞이지 않는다.
 */

/** 원본 PDF 한 쪽을 렌더한 이미지 치수(px) — 870×630pt 의 2배. 뷰어의 width/height 속성·확대 상한 */
export const BROCHURE_IMAGE_WIDTH = 1740;
export const BROCHURE_IMAGE_HEIGHT = 1260;
/** 필름스트립·모아보기 썸네일 치수(px) */
export const BROCHURE_THUMB_WIDTH = 360;
export const BROCHURE_THUMB_HEIGHT = 261;

interface LabBrochureSource {
  title: { ko: string; en: string };
  publisher: { ko: string; en: string };
  pdf: { url: string; bytes: number; pageCount: number };
  imageBase: string;
  cover: number;
  pages: { page: number; professorKo: string }[];
}

/** 뷰어 한 장 — 표지이거나 연구실 한 곳. 표시 문자열은 이미 로케일이 해석돼 있다. */
export interface LabBrochureSlide {
  /** 원본 PDF 쪽 번호(1부터) */
  page: number;
  kind: 'cover' | 'lab';
  /** 원본 크기 이미지(1740×1260) */
  image: string;
  /** 썸네일(360×261) */
  thumb: string;
  /** 조인 키 — 연구실 쪽에만 있다 */
  professorKo?: string;
  /** 연구실 이름. 디렉터리에 없는 교수면 비어 있다(쪽 자체는 문서의 일부라 남긴다) */
  labName?: string;
  /** "홍길동 교수" / "Gildong Hong" */
  professor?: string;
  /** 연구실 홈페이지 */
  url?: string;
}

export interface LabBrochure {
  title: string;
  publisher: string;
  /** 원본 PDF 주소. R2 업로드 전(빈 문자열)이면 null — 화면의 PDF 링크를 전부 숨긴다 */
  pdfUrl: string | null;
  /** "30.7MB" — 링크 옆 용량 표기(모바일 데이터 사용자에게 미리 알린다) */
  pdfSize: string;
  /** 원본 PDF 전체 쪽수(뒤표지 등 이미지로 옮기지 않은 쪽까지 포함한 문서 쪽수) */
  pageCount: number;
  /** 연구실 쪽 수 — 카운터 "n / labCount" 의 분모 */
  labCount: number;
  /** [표지, ...연구실(JSON 순서)] */
  slides: LabBrochureSlide[];
}

const source = brochureData as LabBrochureSource;

/** 쪽 번호 → 파일명의 두 자리 번호(p01, p02 …) */
function pageFile(page: number): string {
  return `p${String(page).padStart(2, '0')}.webp`;
}

function slideImages(page: number): Pick<LabBrochureSlide, 'image' | 'thumb'> {
  return {
    image: `${source.imageBase}/${pageFile(page)}`,
    thumb: `${source.imageBase}/thumb/${pageFile(page)}`,
  };
}

/** 바이트 → "30.7MB"(1024 기준, 소수 한 자리) */
function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 연구실 디렉터리와 조인해 로케일이 해석된 소개자료를 만든다(서버 컴포넌트에서 호출).
 * 반환값은 순수 JSON 이라 클라이언트 컴포넌트 prop 으로 그대로 넘길 수 있다.
 */
export function buildLabBrochure(labs: LabDirectoryEntry[], locale: Locale): LabBrochure {
  const ko = locale === 'ko';
  const byProfessor = new Map(labs.map((lab) => [lab.professorKo, lab]));

  const cover: LabBrochureSlide = { page: source.cover, kind: 'cover', ...slideImages(source.cover) };

  const labSlides = source.pages.map(({ page, professorKo }): LabBrochureSlide => {
    const lab = byProfessor.get(professorKo);
    const slide: LabBrochureSlide = { page, kind: 'lab', professorKo, ...slideImages(page) };
    // 디렉터리에서 빠진 교수(퇴임 등)라도 쪽은 문서의 일부라 남기고, 이름만 원본 키로 표기한다.
    // undefined 값을 담지 않도록 있는 필드만 채운다(RSC 직렬화 결과를 깔끔하게).
    if (!lab) {
      slide.professor = ko ? `${professorKo} 교수` : professorKo;
      return slide;
    }
    slide.labName = ko ? lab.nameKo : lab.nameEn || lab.nameKo;
    slide.professor = ko ? `${lab.professorKo} 교수` : lab.professorEn || lab.professorKo;
    if (lab.url) slide.url = lab.url;
    return slide;
  });

  return {
    title: ko ? source.title.ko : source.title.en,
    publisher: ko ? source.publisher.ko : source.publisher.en,
    pdfUrl: source.pdf.url ? source.pdf.url : null,
    pdfSize: formatMegabytes(source.pdf.bytes),
    pageCount: source.pdf.pageCount,
    labCount: labSlides.length,
    slides: [cover, ...labSlides],
  };
}

/**
 * 지도교수 한글 이름 → 뷰어 슬라이드 인덱스(표지가 0 이라 연구실은 1부터).
 * 목록 행의 "소개자료" 버튼이 자기 쪽을 여는 데 쓴다. 쪽이 없는 연구실은 키가 없다.
 */
export function brochureIndexByProfessor(brochure: LabBrochure): Map<string, number> {
  const map = new Map<string, number>();
  brochure.slides.forEach((slide, i) => {
    if (slide.professorKo) map.set(slide.professorKo, i);
  });
  return map;
}
