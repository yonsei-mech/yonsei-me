'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useLandingAnimation } from '@/components/LandingScope';
import { useRouter } from '@/i18n/navigation';
import { sectionTabHref } from '@/lib/board-links';
import { MILEAGE_HANDOFF_KEY } from '@/components/MileagePlanner';
import { SegmentedControl } from '@/components/SegmentedControl';
import {
  evaluate,
  matchCourses,
  normalizeName,
  searchCatalog,
  type CatalogCourse,
  type CheckerData,
} from '@/lib/checker-match';
import type { Locale } from '@/i18n/routing';

/** /public/data/course-catalog.json 의 한 행 (전체 개설과목 — 타 학과·기타) */
interface RawCatalogEntry {
  name: string;
  credits: number;
  level: number;
  /** 개명 전 옛 이름들 (다학기 편람 통합 시 생성) — 옛 시간표 캡처 대응 */
  aliases?: string[];
}

interface UploadedFile {
  id: string;
  name: string;
  status: 'processing' | 'done' | 'error';
  progress: number;
  courseIds: string[];
  hasChapel: boolean;
}

/** 스텝 라벨 — 사이트 공통 네이비 박스 문법을 체커 맥락에 맞게 축소한 버전 */
function StepLabel({ num, title }: { num: string; title: string }) {
  return (
    // 랜딩에선 라벨 박스만 STEP 순서대로 채워진다 — 폼·업로드 UI 가 본체인 탭이라
    // 입력 요소는 일부러 건드리지 않는다(누르려는 순간 움직이면 미스클릭).
    <h3
      data-land="wipe"
      data-land-order={Number(num)}
      className="inline-block bg-yonsei-navy px-3.5 py-1.5 text-sm font-bold text-white"
    >
      STEP {num} <span className="mx-1 opacity-60">·</span> {title}
    </h3>
  );
}

/** 에브리타임 심벌 미니 로고 (시간표 바로가기 링크용).
 *  어두운 부분은 currentColor 라 링크 텍스트 색을 따라 다크모드에서도 보인다. */
function EverytimeLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
      <path
        d="M13 3.5c3.3 4.6 5 7.9 5 10a5 5 0 1 1-10 0c0-2.1 1.7-5.4 5-10Z"
        fill="#F0432E"
      />
      <circle cx="36" cy="10.5" r="5.5" fill="currentColor" />
      <path
        d="M8.5 26c0 9.5 7.5 14.5 15.5 14.5S39.5 35.5 39.5 26"
        fill="none"
        stroke="currentColor"
        strokeWidth="8.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const KIND_LABEL: Record<CatalogCourse['kind'], string> = {
  majorRequired: '전공필수',
  majorElective: '전공선택',
  engineering: '공학기초',
  liberal: '교양',
  other: '기타·타과',
};

/** 학점 합계 — 소수점 학점(0.5 등)이 섞여도 부동소수 오차 없이 표기되도록 반올림 */
function sumCredits(courses: CatalogCourse[]): number {
  const total = courses.reduce((s, c) => s + c.credits, 0);
  return Math.round(total * 10) / 10;
}

/** 흰 굵은 글씨(과목명) 배경색과 무관하게 배경색 채도가 있는 컬러 셀에서도 두드러지도록,
 * "밝고 채도 낮은(흰색에 가까운)" 픽셀만 검정 잉크로, 나머지는 흰 배경으로 바꾼 뒤 확대한다.
 * 임계값에 따라 잡히는 블록이 달라 두 임계값으로 각각 뽑아 합치는 편이 인식률이 더 높다. */
async function whiteTextMask(bitmap: ImageBitmap, threshold: number, scale = 2): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width * scale;
  canvas.height = bitmap.height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const minC = Math.min(d[i], d[i + 1], d[i + 2]);
    const v = minC > threshold ? 0 : 255;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const OCR_THRESHOLDS = [130, 165];

/** 캡처 테마 분류. 에브리타임 캡처는 세 갈래다:
 * - light: 흰 페이지 배경 (글자는 흰색·굵음 → 흰글자 마스크)
 * - darkWhiteText: 검정 배경 + 컬러 셀 위 "흰" 글자 → 흰글자 마스크가 그대로 통함
 * - darkDarkText: 검정 배경 + 컬러 셀 위 "어두운" 글자 → 글자와 빈 배경이 둘 다 검정이라
 *   셀 영역 기반 다크셀 마스크가 필요
 * 배경 밝기(어두운 픽셀 비율 0.4 경계)로 다크 여부를, 셀 영역 안 흰 잉크(min>165) 대
 * 어두운 잉크(max<80) 픽셀 수 비교로 글자 극성을 판별한다. 판별은 축소 캔버스에서 수행
 * (비율·다수결 추정에는 충분하고 훨씬 싸다). */
type CaptureTheme = 'light' | 'darkWhiteText' | 'darkDarkText';

function detectCaptureTheme(bitmap: ImageBitmap): CaptureTheme {
  const w = Math.min(512, bitmap.width);
  const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.max(d[i], d[i + 1], d[i + 2]) < 60) dark++;
  }
  if (dark / (w * h) <= 0.4) return 'light';
  // 컬러 셀 영역(closing으로 글자 구멍 메움) 안에서 잉크 극성 다수결
  let bg: Uint8Array = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    bg[p] = Math.max(d[i], d[i + 1], d[i + 2]) >= 70 ? 1 : 0;
  }
  const R = Math.max(3, Math.round((10 * w) / bitmap.width)); // 원본 기준 R=10을 축소 비율로 환산
  bg = morphBinary(morphBinary(bg, w, h, R, true), w, h, R, false);
  let whiteInk = 0;
  let darkInk = 0;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    if (!bg[p]) continue;
    if (Math.min(d[i], d[i + 1], d[i + 2]) > 165) whiteInk++;
    else if (Math.max(d[i], d[i + 1], d[i + 2]) < 80) darkInk++;
  }
  return whiteInk >= darkInk ? 'darkWhiteText' : 'darkDarkText';
}

/** 분리형 사각 구조요소 팽창/침식 (이진 0/1) — 다크모드 셀 영역 계산용 */
function morphBinary(mask: Uint8Array, w: number, h: number, radius: number, dilate: boolean): Uint8Array {
  const pick = dilate ? Math.max : Math.min;
  const stop = dilate ? 1 : 0;
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    for (let x = 0; x < w; x++) {
      let v = mask[base + x];
      for (let dx = 1; dx <= radius && v !== stop; dx++) {
        if (x - dx >= 0) v = pick(v, mask[base + x - dx]);
        if (x + dx < w) v = pick(v, mask[base + x + dx]);
      }
      tmp[base + x] = v;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = tmp[y * w + x];
      for (let dy = 1; dy <= radius && v !== stop; dy++) {
        if (y - dy >= 0) v = pick(v, tmp[(y - dy) * w + x]);
        if (y + dy < h) v = pick(v, tmp[(y + dy) * w + x]);
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** 다크모드용 마스크: 어두운 글자가 컬러 셀 위에 얹혀 있고 빈 배경도 검정이라, 픽셀 색만으로는
 * "글자"와 "빈 배경"이 구분되지 않는다(둘 다 검정). 그래서 ① 1배 해상도에서 컬러 셀 영역을
 * 구하고(밝기 max>=70) closing(팽창→침식)으로 셀 안 글자 구멍을 메운 뒤, ② 부드럽게 2배
 * 확대한 이미지에서 "셀 영역 안의 어두운 픽셀(max<80)"만 검정 잉크로 남긴다.
 * (이진화 후 확대가 아니라 확대 후 이진화 — 윤곽이 각지면 인식률이 뚜렷이 떨어진다)
 * darkThreshold는 라이트모드의 OCR_THRESHOLDS처럼 두 값으로 각각 뽑아 합친다 — 80은
 * 획이 얇고 깨끗, 105는 안티앨리어싱 가장자리까지 획이 굵어져 작은 셀 글자에 유리. */
function darkCellMask(bitmap: ImageBitmap, darkThreshold: number, scale = 2): HTMLCanvasElement {
  const w = bitmap.width;
  const h = bitmap.height;
  // ① 셀 영역 (1배 — morph 비용 절감)
  const base = document.createElement('canvas');
  base.width = w;
  base.height = h;
  const bctx = base.getContext('2d')!;
  bctx.drawImage(bitmap, 0, 0);
  const bd = bctx.getImageData(0, 0, w, h).data;
  let bg: Uint8Array = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    bg[p] = Math.max(bd[i], bd[i + 1], bd[i + 2]) >= 70 ? 1 : 0;
  }
  const R = 10; // 굵은 글자 획 뭉치를 덮을 만큼 (셀 내부 구멍 메움), 셀 경계는 원위치
  bg = morphBinary(morphBinary(bg, w, h, R, true), w, h, R, false);
  // ② 확대 후 분류
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let p = 0, i = 0; p < canvas.width * canvas.height; p++, i += 4) {
    const x = p % canvas.width;
    const y = (p / canvas.width) | 0;
    const cell = bg[((y / scale) | 0) * w + ((x / scale) | 0)];
    const dark = Math.max(d[i], d[i + 1], d[i + 2]) < darkThreshold;
    const v = cell && dark ? 0 : 255;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * 졸업요건 체크 — 에브리타임 시간표 캡처를 업로드하면 브라우저에서 OCR로
 * 과목을 인식해 학번별 졸업요건과 대조하고, 남은 요건을 보여준다.
 * (인식 결과는 칩으로 수정 가능, 과목 직접 추가도 지원)
 */
export function GraduationChecker({ data, locale }: { data: CheckerData; locale: Locale }) {
  const ko = locale === 'ko';
  // 탭 진입 랜딩 — 리드 문단 → STEP 01~04 라벨이 차례로 채워진다(아래 스텝은 스크롤 시)
  const landingRef = useLandingAnimation<HTMLDivElement>('graduation-checker');
  // 마일리지 전략 페이지로 넘길 때 쓰는 로케일 인지 라우터(`/ko/undergraduate/mileage`)
  const router = useRouter();
  const [cohortId, setCohortId] = useState(data.cohorts[0].id);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [chapelCount, setChapelCount] = useState(0);
  // 채플 직접 입력의 범위(0~4) 초과 오류 — 유효값 입력·버튼 조작 시 자동 해제
  const [chapelError, setChapelError] = useState<string | null>(null);
  // RC자기주도활동(1)/(2) 각각 이수 여부 (독립 체크박스)
  const [selfDirected, setSelfDirected] = useState<Record<1 | 2, boolean>>({ 1: false, 2: false });
  const [query, setQuery] = useState('');
  const [chartView, setChartView] = useState<'bar' | 'donut'>('bar');

  const selfDirectedCount = (selfDirected[1] ? 1 : 0) + (selfDirected[2] ? 1 : 0);
  const [dragOver, setDragOver] = useState(false);
  // 전체 개설과목(타 학과·기타) — 체커 사용 시에만 지연 로드 (curated 카탈로그보다 크므로)
  const [otherCatalog, setOtherCatalog] = useState<CatalogCourse[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/data/course-catalog.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: RawCatalogEntry[]) => {
        if (cancelled) return;
        setOtherCatalog(
          rows.map((r) => ({
            id: normalizeName(r.name),
            name: r.name,
            credits: r.credits,
            kind: 'other' as const,
            level: r.level || undefined,
            fuzzy: false, // 대용량 카탈로그는 정확 매치만 (오탐·성능 방지)
            aliases: r.aliases ?? [],
          })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const cohort = data.cohorts.find((c) => c.id === cohortId) ?? data.cohorts[0];

  // curated(전공·교양) 우선 + 타 학과 카탈로그 병합 (id 충돌 시 curated 유지)
  const fullCatalog = useMemo(() => {
    const ids = new Set(data.catalog.map((c) => c.id));
    return [...data.catalog, ...otherCatalog.filter((c) => !ids.has(c.id))];
  }, [data.catalog, otherCatalog]);

  const dataFull = useMemo(() => ({ ...data, catalog: fullCatalog }), [data, fullCatalog]);
  const byId = useMemo(() => new Map(fullCatalog.map((c) => [c.id, c])), [fullCatalog]);

  const takenIds = useMemo(() => {
    const ids = new Set<string>(manualIds);
    for (const f of files) for (const id of f.courseIds) ids.add(id);
    for (const r of removedIds) ids.delete(r);
    return ids;
  }, [files, manualIds, removedIds]);

  const result = useMemo(
    () => evaluate(dataFull, cohort, takenIds, chapelCount, { selfDirectedCount }),
    [dataFull, cohort, takenIds, chapelCount, selfDirectedCount],
  );

  const suggestions = useMemo(
    () => searchCatalog(query, fullCatalog).filter((c) => !takenIds.has(c.id)),
    [query, fullCatalog, takenIds],
  );

  async function processFiles(list: FileList | File[]) {
    const images = [...list].filter((f) => f.type.startsWith('image/'));
    for (const file of images) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setFiles((prev) => [
        ...prev,
        { id, name: file.name, status: 'processing', progress: 0, courseIds: [], hasChapel: false },
      ]);
      // 워커 동시 실행을 피하기 위해 순차 처리
      while (busyRef.current) await new Promise((r) => setTimeout(r, 150));
      busyRef.current = true;
      try {
        const { createWorker, PSM } = await import('tesseract.js');
        const bitmap = await createImageBitmap(file);
        // 다크+어두운글자 캡처만 다크셀 마스크 경로 (+ 하단 채플 등 검정 배경 위 밝은 글자용
        // 흰글자 마스크 1회). 라이트·다크+흰글자 캡처는 기존 두 임계값 흰글자 마스크 그대로.
        const masks: (() => Promise<HTMLCanvasElement>)[] =
          detectCaptureTheme(bitmap) === 'darkDarkText'
            ? [
                async () => darkCellMask(bitmap, 80),
                async () => darkCellMask(bitmap, 105),
                () => whiteTextMask(bitmap, OCR_THRESHOLDS[0]),
              ]
            : OCR_THRESHOLDS.map((t) => () => whiteTextMask(bitmap, t));
        let passIndex = 0; // 진행률 계산용 — 현재 몇 번째 마스크 패스인지
        const worker = await createWorker('kor+eng', 1, {
          logger: (m: { status: string; progress: number }) => {
            if (m.status === 'recognizing text') {
              const combined = (passIndex + m.progress) / masks.length;
              setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, progress: combined } : f)));
            }
          },
        });
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });

        // 마스크를 달리해 여러 번 인식한 텍스트를 합쳐 매칭 (배경·테마에 따라 잡히는 블록이 다름)
        const texts: string[] = [];
        for (const makeMask of masks) {
          const canvas = await makeMask();
          const { data: ocr } = await worker.recognize(canvas);
          texts.push(ocr.text);
          passIndex += 1;
          setFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, progress: passIndex / masks.length } : f)),
          );
        }
        await worker.terminate();
        bitmap.close();

        const courseIds = matchCourses(texts, fullCatalog);
        const hasChapel = texts.some((t) => normalizeName(t).includes('채플'));
        if (hasChapel) setChapelCount((n) => Math.min(4, n + 1));
        setFiles((prev) =>
          prev.map((f) =>
            f.id === id ? { ...f, status: 'done', progress: 1, courseIds, hasChapel } : f,
          ),
        );
        // 새로 인식된 과목은 제거 목록에서 해제하지 않음 (사용자 결정 유지)
      } catch {
        setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: 'error' } : f)));
      } finally {
        busyRef.current = false;
      }
    }
  }

  function removeFile(id: string) {
    const target = files.find((f) => f.id === id);
    if (target?.hasChapel) setChapelCount((n) => Math.max(0, n - 1));
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function addCourse(id: string) {
    setRemovedIds((prev) => prev.filter((r) => r !== id));
    setManualIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setQuery('');
  }

  function removeCourse(id: string) {
    setRemovedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  const takenCourses = [...takenIds]
    .map((id) => byId.get(id))
    .filter(Boolean) as CatalogCourse[];
  const grouped = (
    ['majorRequired', 'majorElective', 'engineering', 'liberal', 'other'] as const
  ).map((kind) => {
    const courses = takenCourses.filter((c) => c.kind === kind);
    return { kind, courses, credits: sumCredits(courses) };
  });
  // 칩으로 표시되는 과목의 총 학점 (채플·RC자기주도는 칩이 아니므로 제외 — 기존 동작 유지)
  const chipTotalCredits = sumCredits(takenCourses);

  const pct = Math.min(100, Math.round((result.totalEarned / result.totalRequired) * 100));

  // 마일리지 플래너로 넘길 "남은 과목" — 섹션별 미이수 항목을 중복 없이 모은다.
  const remainingForMileage = (() => {
    const seen = new Set<string>();
    const out: { name: string; credits?: number; required?: boolean }[] = [];
    for (const sec of result.sections) {
      for (const it of sec.items ?? []) {
        if (it.done || seen.has(it.name)) continue;
        seen.add(it.name);
        out.push({ name: it.name, credits: it.credits, required: true });
      }
    }
    return out.slice(0, 12);
  })();

  return (
    <div ref={landingRef} className="space-y-16">
      <div className="space-y-6">
        {/* 면책 — 상시 노출(수강신청 도우미와 같은 형태). 참고용 도구이며 공식 졸업사정이
            아니라는 점을 결과를 보기 전에 먼저 알린다. */}
        <div
          role="note"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-l-2 border-yonsei-navy bg-surface-soft px-4 py-3"
        >
          <span className="bg-yonsei-navy px-2 py-0.5 text-[11px] font-bold text-white">BETA</span>
          <span className="text-[13px] font-semibold text-content">
            {ko ? '참고용이며 공식 졸업사정이 아닙니다' : 'For reference only — not an official audit'}
          </span>
          <span className="text-[12px] text-content-faint">
            {ko
              ? '학생 제작 · 최종 확인은 연세포털·학과사무실에서'
              : 'Student-built · verify on the Yonsei portal or with the department office'}
          </span>
        </div>

        <p data-land="rise" data-land-order="0" className="max-w-2xl text-base leading-[1.8] text-content-soft">
          {ko
            ? '에브리타임 시간표 캡처를 학기별로 업로드하면, 과목을 자동 인식해 학번별 졸업요건과 대조합니다. 인식 결과는 아래에서 직접 수정할 수 있습니다.'
            : 'Upload your Everytime timetable screenshots (one per semester). Courses are recognized on-device and checked against your cohort’s graduation requirements. You can edit the results below.'}
        </p>
      </div>

      {/* STEP 01→04 세로 단일 흐름 — 2단 병렬 배치를 해체해 스텝이 위→아래로
          순서대로 이어진다(사용자 지시). */}
      {/* STEP 01 — 학번 선택 */}
      <section>
        <StepLabel num="01" title={ko ? '학번 선택' : 'Cohort'} />
        <div className="mt-4">
          <SegmentedControl
            value={cohortId}
            onChange={setCohortId}
            options={data.cohorts.map((c) => ({ id: c.id, label: c.label }))}
            ariaLabel={ko ? '학번 선택' : 'Cohort'}
          />
        </div>
      </section>

      {/* STEP 02 — 시간표 업로드 */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StepLabel num="02" title={ko ? '시간표 업로드' : 'Upload timetables'} />
          {/* 캡처할 시간표를 새 탭에서 바로 열 수 있는 에브리타임 바로가기 */}
          <a
            href="https://everytime.kr/timetable"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-content-soft transition-colors hover:text-yonsei-blue"
          >
            <EverytimeLogo />
            {ko ? '에브리타임 시간표 열기' : 'Open Everytime timetable'}
            <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            processFiles(e.dataTransfer.files);
          }}
          className={cn(
            'mt-4 flex cursor-pointer flex-col items-center gap-3 border-2 border-dashed px-6 py-12 text-center transition-colors',
            dragOver
              ? 'border-yonsei-blue bg-yonsei-navy/5'
              : 'border-surface-border hover:border-yonsei-blue/60',
          )}
        >
          <span
            aria-hidden="true"
            className="grid h-12 w-12 place-items-center rounded-full bg-yonsei-navy/10 text-yonsei-navy"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="font-semibold text-content">
            {ko ? '이미지를 끌어다 놓거나 클릭해서 선택' : 'Drag & drop images, or click to browse'}
          </p>
          <p className="text-sm text-content-faint">
            {ko
              ? '학기별 에브리타임 캡처 (여러 장 가능) — 브라우저 안에서만 처리되고 서버로 전송되지 않습니다'
              : 'Everytime captures per semester — processed entirely in your browser'}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) processFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className="mt-4 divide-y divide-surface-border border-y border-surface-border">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-content">
                  {f.name}
                </span>
                {f.status === 'processing' && (
                  <span className="flex items-center gap-2 text-xs text-content-faint">
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-soft">
                      <span
                        className="block h-full rounded-full bg-gradient-to-r from-yonsei-navy to-yonsei-blue transition-all"
                        style={{ width: `${Math.round(f.progress * 100)}%` }}
                      />
                    </span>
                    {ko ? '인식 중' : 'Reading'} {Math.round(f.progress * 100)}%
                  </span>
                )}
                {f.status === 'done' && (
                  <span className="text-xs font-semibold text-yonsei-blue">
                    {ko ? `과목 ${f.courseIds.length}개 인식` : `${f.courseIds.length} courses`}
                    {f.hasChapel && (ko ? ' · 채플' : ' · chapel')}
                  </span>
                )}
                {f.status === 'error' && (
                  <span className="text-xs font-semibold text-red-600">
                    {ko ? '인식 실패' : 'Failed'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  aria-label={ko ? '파일 제거' : 'Remove file'}
                  className="text-content-faint transition-colors hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* STEP 03 — 수강 과목 확인 */}
      <section className="min-w-0">
        <StepLabel num="03" title={ko ? '수강 과목 확인' : 'Review courses'} />
        <p className="mt-4 text-sm text-content-faint">
          {ko
            ? '잘못 인식된 과목은 ✕로 지우고, 빠진 과목은 검색해서 추가하세요.'
            : 'Remove misread courses with ✕ and add missing ones via search.'}
        </p>

        {/* 검색 추가 */}
        <div className="relative mt-4 max-w-md">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-content-faint"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" strokeLinecap="round" />
            </svg>
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={ko ? '과목명 검색 후 추가 (예: 열역학)' : 'Search a course to add'}
            className="w-full border border-surface-border bg-surface py-2.5 pl-10 pr-4 text-sm text-content outline-none transition-colors focus:border-yonsei-blue"
          />
          {suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden border border-surface-border bg-surface shadow-card">
              {suggestions.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => addCourse(c.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm text-content-soft transition-colors hover:bg-surface-soft hover:text-yonsei-navy"
                  >
                    <span className="truncate">
                      {c.name}
                      <span className="ml-2 text-xs font-semibold text-yonsei-blue">
                        {ko ? `${c.credits}학점` : `${c.credits} cr`}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-content-faint">
                      {KIND_LABEL[c.kind]}
                      {c.area ? ` · ${c.area}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 채플 카운터 — 1학기 이상 이수 시 연한 파랑으로 강조.
            가운데는 "0 / 4" 분수 표기 대신 숫자만 있는 직접 입력(0~4) — 좁은 화면에서
            분수 텍스트가 줄바꿈돼 세로로 쌓이던 문제 해결(사용자 지시). 4 초과 입력은
            즉시 4로 클램프하고 아래에 오류 메시지를 띄운다. flex-wrap 으로 모바일에선
            안내 문구가 자연스럽게 다음 줄로 내려간다. */}
        <div className="mt-6 border-t border-surface-border pt-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label htmlFor="chapel-count" className="text-sm font-semibold text-content">
              {ko ? '채플 이수 학기' : 'Chapel semesters'}
              <span className="ml-1 font-normal text-content-faint">(0~4)</span>
            </label>
            <div
              className={cn(
                'inline-flex items-center overflow-hidden rounded-lg border transition-colors',
                chapelCount >= 1 ? 'border-yonsei-blue bg-yonsei-blue/5' : 'border-surface-border',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setChapelCount((n) => Math.max(0, n - 1));
                  setChapelError(null);
                }}
                className="px-3 py-1.5 text-content-soft transition-colors hover:text-yonsei-navy"
                aria-label="-"
              >
                −
              </button>
              <input
                id="chapel-count"
                type="number"
                inputMode="numeric"
                min={0}
                max={4}
                step={1}
                value={chapelCount}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) {
                    setChapelCount(0);
                    setChapelError(null);
                    return;
                  }
                  if (n > 4) {
                    setChapelCount(4);
                    setChapelError(
                      ko ? '채플은 최대 4학기까지만 인정됩니다.' : 'Chapel is capped at 4 semesters.',
                    );
                    return;
                  }
                  setChapelCount(Math.max(0, Math.floor(n)));
                  setChapelError(null);
                }}
                className={cn(
                  // 네이티브 스핀 버튼 숨김 — 양옆 커스텀 −/+ 버튼과 중복되지 않게
                  'w-12 border-x bg-transparent py-1.5 text-center text-sm font-bold tabular-nums outline-none transition-colors [appearance:textfield] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-yonsei-blue [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                  chapelCount >= 1 ? 'border-yonsei-blue/30 text-yonsei-blue' : 'border-surface-border text-content',
                )}
              />
              <button
                type="button"
                onClick={() => {
                  setChapelCount((n) => Math.min(4, n + 1));
                  setChapelError(null);
                }}
                className="px-3 py-1.5 text-content-soft transition-colors hover:text-yonsei-navy"
                aria-label="+"
              >
                +
              </button>
            </div>
            <span className="text-xs text-content-faint">
              {ko ? '캡처에서 채플이 인식되면 자동 +1' : 'Auto +1 when chapel is detected'}
            </span>
          </div>
          {chapelError && (
            <p role="alert" className="mt-2 text-xs font-semibold text-red-600">
              {chapelError}
            </p>
          )}
        </div>

        {/* RC자기주도활동 — P/NP·각 0.5학점, 시간표에 안 잡히므로 직접 체크 */}
        <div className="mt-6 border-t border-surface-border pt-6">
          <p className="text-sm font-semibold text-content">
            {ko ? 'RC자기주도활동 (P/NP, 각 0.5학점)' : 'RC Self-Directed Activity (P/NP, 0.5 cr. each)'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {([1, 2] as const).map((n) => {
              const checked = selfDirected[n];
              return (
                <button
                  key={n}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => setSelfDirected((s) => ({ ...s, [n]: !s[n] }))}
                  className={cn(
                    'inline-flex items-center gap-2 border px-3 py-1.5 text-sm transition-colors',
                    checked
                      ? 'border-yonsei-navy bg-yonsei-navy/5 font-semibold text-yonsei-navy'
                      : 'border-surface-border text-content-soft hover:border-yonsei-blue',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid h-4 w-4 shrink-0 place-items-center border',
                      checked ? 'border-yonsei-navy bg-yonsei-navy' : 'border-content-faint',
                    )}
                  >
                    {checked && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" className="h-2.5 w-2.5 text-white">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  RC자기주도활동({n})
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-content-faint">
            {ko
              ? 'RC공통·하우스 프로그램에 각 1개 이상 참여하며 한 학기 12 RC시간 이상 이수 시 학기당 0.5학점(연 1학점)이 인정됩니다. 이수한 학기를 선택하세요 (일반선택 학점에 반영).'
              : 'Awarded 0.5 credit per semester (1/year) when RC requirements are met. Select completed semesters (counts toward general electives).'}
          </p>
        </div>

        {/* 인식/추가된 과목 */}
        <div className="mt-6 border-t border-surface-border pt-6">
          <p className="text-sm font-semibold text-content">
            {ko ? '인식된 과목' : 'Recognized courses'}
            {takenCourses.length > 0 && (
              <span className="ml-2 text-xs font-normal text-content-faint">
                {ko
                  ? `${takenCourses.length}과목 · ${chipTotalCredits}학점`
                  : `${takenCourses.length} courses · ${chipTotalCredits} cr.`}
              </span>
            )}
          </p>
          {takenCourses.length > 0 ? (
          <div className="mt-4 space-y-4">
            {grouped
              .filter((g) => g.courses.length > 0)
              .map((g) => (
                <div key={g.kind}>
                  <p className="text-xs font-bold uppercase tracking-wide text-content-faint">
                    {KIND_LABEL[g.kind]}{' '}
                    {ko
                      ? `(${g.courses.length}과목 · ${g.credits}학점)`
                      : `(${g.courses.length} courses · ${g.credits} cr.)`}
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {g.courses.map((c) => (
                      <li
                        key={c.id}
                        className="inline-flex items-center gap-2 border border-surface-border bg-surface-soft px-3 py-1.5 text-sm text-content"
                      >
                        {c.name}
                        <span className="text-xs font-semibold text-yonsei-blue">
                          {ko ? `${c.credits}학점` : `${c.credits} cr`}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeCourse(c.id)}
                          aria-label={`${c.name} ${ko ? '제거' : 'remove'}`}
                          className="text-content-faint transition-colors hover:text-red-600"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
          ) : (
          <p className="mt-2 text-sm text-content-faint">
            {ko ? '아직 인식되거나 추가된 과목이 없습니다.' : 'No courses recognized or added yet.'}
          </p>
          )}
        </div>
      </section>

      {/* STEP 04 — 결과 */}
      <section>
        <StepLabel num="04" title={ko ? '남은 졸업요건' : 'Remaining requirements'} />

        {/* 결과 직전 경고 — 숫자를 보기 전에 "참고만, 의존 금지, 본인 책임" 을 못 박는다.
            수강신청 도우미의 상시 면책보다 강한 어조인 이유는, 여기서의 오판이 졸업 지연으로
            직결되기 때문이다. */}
        <div
          role="alert"
          className="mt-4 border-l-2 border-[#b42318] bg-surface-soft px-5 py-4 text-[13px] leading-relaxed text-content"
        >
          <p className="font-bold text-[#b42318]">
            {ko
              ? '⚠ 아래 결과는 참고용 추정치입니다. 절대 이 결과에만 의존하지 마세요.'
              : '⚠ The results below are estimates for reference only. Never rely on them alone.'}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-content-soft">
            <li>
              {ko
                ? '학생이 만든 비공식 도구이며, 학과·대학이 검증하거나 보증하지 않습니다.'
                : 'This is an unofficial, student-built tool. It is not verified or endorsed by the department or the university.'}
            </li>
            <li>
              {ko
                ? '시간표 인식 오류, 과목명 변경, 요건 개정으로 결과가 실제와 다를 수 있습니다.'
                : 'OCR mistakes, renamed courses, and requirement revisions can make the result differ from reality.'}
            </li>
            <li>
              {ko
                ? '공식 졸업사정은 연세포털 「졸업사정 조회」와 학과사무실 확인만이 유효합니다.'
                : 'Only the Yonsei portal graduation audit and the department office are authoritative.'}
            </li>
            <li>
              {ko
                ? '이 결과를 근거로 한 수강 계획·졸업 판단의 책임은 전적으로 본인에게 있습니다.'
                : 'Any course plan or graduation decision based on this result is entirely your own responsibility.'}
            </li>
          </ul>
        </div>

        {/* 뷰 전환 — 막대형 / 도넛형 (슬라이드 토글) */}
        <div className="mt-4">
          <SegmentedControl
            value={chartView}
            onChange={(id) => setChartView(id as 'bar' | 'donut')}
            options={[
              { id: 'bar', label: ko ? '막대형' : 'Bars' },
              { id: 'donut', label: ko ? '도넛형' : 'Donuts' },
            ]}
            ariaLabel={ko ? '결과 표시 방식' : 'Result view'}
          />
        </div>

        {/* 총괄 */}
        <div className="mt-6 border-t-2 border-content pt-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <p className="text-4xl font-bold tracking-tight text-content sm:text-5xl">
              {pct}
              <span className="text-2xl">%</span>
              <span className="ml-3 text-base font-medium text-content-soft">
                {result.totalEarned} / {result.totalRequired}
                {ko ? '학점' : ' cr.'}
              </span>
            </p>
            <p className="text-sm text-content-soft">
              {ko
                ? `남은 학점(추정) ${Math.max(0, Math.round((result.totalRequired - result.totalEarned) * 10) / 10)}학점 · 남은 필수과목 ${result.remainingRequired.length}개`
                : `~${Math.max(0, result.totalRequired - result.totalEarned)} credits and ${result.remainingRequired.length} required courses remaining`}
            </p>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-soft">
            <div
              className="h-full rounded-full bg-gradient-to-r from-yonsei-navy via-yonsei-blue to-yonsei-gold transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* 섹션별 — 막대형 */}
        {chartView === 'bar' && (
        <ul className="mt-8">
          {result.sections.map((sec, i) => {
            const secPct = Math.min(100, Math.round((sec.earned / sec.required) * 100));
            const remaining = sec.items?.filter((it) => !it.done) ?? [];
            const done = sec.items?.filter((it) => it.done) ?? [];
            return (
              <li key={sec.id} className="border-b border-surface-border py-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:gap-10">
                  <span className="shrink-0 text-sm font-bold tabular-nums text-yonsei-blue">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="text-lg font-bold tracking-tight text-content sm:text-xl">
                        {sec.title}
                      </h4>
                      <span
                        className={cn(
                          'text-sm font-bold tabular-nums',
                          secPct >= 100 ? 'text-yonsei-blue' : 'text-content-soft',
                        )}
                      >
                        {sec.earned} / {sec.required}
                        {ko ? '학점' : ' cr.'}
                        {secPct >= 100 && ' ✓'}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-soft">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          secPct >= 100
                            ? 'bg-gradient-to-r from-yonsei-blue to-yonsei-gold'
                            : 'bg-gradient-to-r from-yonsei-navy to-yonsei-blue',
                        )}
                        style={{ width: `${secPct}%` }}
                      />
                    </div>

                    {sec.areas && (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {sec.areas.map((a) => (
                          <li
                            key={a.name}
                            className={cn(
                              'border px-2.5 py-1 text-xs font-medium',
                              a.done
                                ? 'border-yonsei-blue/40 bg-yonsei-navy/5 text-yonsei-navy'
                                : 'border-surface-border text-content-faint',
                            )}
                          >
                            {a.done ? '✓ ' : ''}
                            {a.name}
                          </li>
                        ))}
                      </ul>
                    )}

                    {remaining.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-content-faint">
                          {ko ? '남은 과목' : 'Remaining'}
                        </p>
                        <ul className="mt-1.5 flex flex-wrap gap-2">
                          {remaining.map((it) => (
                            <li
                              key={it.name}
                              className="border border-yonsei-navy/30 bg-surface px-2.5 py-1 text-xs font-semibold text-yonsei-navy"
                            >
                              {/* 과목명에 이미 "(1)" 같은 편수 괄호가 있어, 학점까지 괄호로 붙이면
                                  "공학수학(3) (3)" 처럼 같은 숫자가 두 번 나온 오류로 보인다.
                                  괄호를 걷어내고 학점을 단위와 함께 흐리게 표기해 구분한다. */}
                              {it.name}
                              <span className="ml-1.5 font-medium text-yonsei-navy/55">
                                {it.credits}
                                {ko ? '학점' : ' cr.'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {done.length > 0 && (
                      <p className="mt-2 text-xs text-content-faint">
                        ✓ {done.map((d) => d.name).join(' · ')}
                      </p>
                    )}
                    {sec.note && <p className="mt-2 text-xs text-content-faint">{sec.note}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        )}

        {/* 섹션별 — 도넛형 */}
        {chartView === 'donut' && (
          /* 2열(sm+)일 때 열 사이 세로 구분선: 왼쪽 열 항목의 border-r 로 그려
             행 높이만큼만 이어지고 행 간 gap 에서 끊긴다. 짝 없는 마지막 항목은 제외.
             gap-x 대신 좌우 px-4 로 간격을 만들어 선이 정확히 가운데 오게 한다. */
          <ul className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-x-0">
            {result.sections.map((sec) => {
              const secPct = Math.min(100, Math.round((sec.earned / sec.required) * 100));
              const remaining = sec.items?.filter((it) => !it.done) ?? [];
              const done = sec.items?.filter((it) => it.done) ?? [];
              const C = 2 * Math.PI * 52;
              return (
                <li
                  key={sec.id}
                  className="flex flex-col items-center text-center sm:px-4 sm:[&:nth-child(odd):not(:last-child)]:border-r"
                >
                  <svg
                    viewBox="0 0 120 120"
                    role="img"
                    aria-label={
                      ko
                        ? `${sec.title} ${secPct}% (${sec.earned}/${sec.required}학점)`
                        : `${sec.title} ${secPct}% (${sec.earned}/${sec.required} cr.)`
                    }
                    className="h-32 w-32"
                  >
                    <circle
                      cx="60"
                      cy="60"
                      r="52"
                      fill="none"
                      strokeWidth="10"
                      stroke="currentColor"
                      className="text-surface-border"
                    />
                    <circle
                      cx="60"
                      cy="60"
                      r="52"
                      fill="none"
                      strokeWidth="10"
                      strokeLinecap="round"
                      stroke="currentColor"
                      transform="rotate(-90 60 60)"
                      style={{ strokeDasharray: C, strokeDashoffset: C * (1 - secPct / 100) }}
                      className={cn(
                        'transition-all duration-500',
                        secPct >= 100 ? 'text-yonsei-gold' : 'text-yonsei-blue',
                      )}
                    />
                    <text
                      x="60"
                      y="58"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="currentColor"
                      className="text-content"
                      style={{ fontSize: 26, fontWeight: 700 }}
                    >
                      {secPct}%
                    </text>
                    <text
                      x="60"
                      y="80"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="currentColor"
                      className="text-content-soft"
                      style={{ fontSize: 11 }}
                    >
                      {sec.earned}/{sec.required}
                      {ko ? '학점' : ' cr.'}
                    </text>
                  </svg>

                  <div className="mt-4 w-full text-left">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="text-lg font-bold tracking-tight text-content sm:text-xl">
                        {sec.title}
                      </h4>
                      <span
                        className={cn(
                          'text-sm font-bold tabular-nums',
                          secPct >= 100 ? 'text-yonsei-blue' : 'text-content-soft',
                        )}
                      >
                        {sec.earned} / {sec.required}
                        {ko ? '학점' : ' cr.'}
                        {secPct >= 100 && ' ✓'}
                      </span>
                    </div>

                    {sec.areas && (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {sec.areas.map((a) => (
                          <li
                            key={a.name}
                            className={cn(
                              'border px-2.5 py-1 text-xs font-medium',
                              a.done
                                ? 'border-yonsei-blue/40 bg-yonsei-navy/5 text-yonsei-navy'
                                : 'border-surface-border text-content-faint',
                            )}
                          >
                            {a.done ? '✓ ' : ''}
                            {a.name}
                          </li>
                        ))}
                      </ul>
                    )}

                    {remaining.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-content-faint">
                          {ko ? '남은 과목' : 'Remaining'}
                        </p>
                        <ul className="mt-1.5 flex flex-wrap gap-2">
                          {remaining.map((it) => (
                            <li
                              key={it.name}
                              className="border border-yonsei-navy/30 bg-surface px-2.5 py-1 text-xs font-semibold text-yonsei-navy"
                            >
                              {/* 과목명에 이미 "(1)" 같은 편수 괄호가 있어, 학점까지 괄호로 붙이면
                                  "공학수학(3) (3)" 처럼 같은 숫자가 두 번 나온 오류로 보인다.
                                  괄호를 걷어내고 학점을 단위와 함께 흐리게 표기해 구분한다. */}
                              {it.name}
                              <span className="ml-1.5 font-medium text-yonsei-navy/55">
                                {it.credits}
                                {ko ? '학점' : ' cr.'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {done.length > 0 && (
                      <p className="mt-2 text-xs text-content-faint">
                        ✓ {done.map((d) => d.name).join(' · ')}
                      </p>
                    )}
                    {sec.note && <p className="mt-2 text-xs text-content-faint">{sec.note}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* 마일리지 전략으로 이어가기 — 남은 과목을 그대로 넘겨 재입력을 없앤다(사용자 지시 4).
            sessionStorage 로 건네고 마일리지 페이지로 이동하면, 플래너가 마운트되며
            그 값을 읽어 담는다(탭이 경로가 되기 전에는 해시로 탭을 갈아 끼웠다). */}
        {remainingForMileage.length > 0 && (
          <div className="mt-8 border border-yonsei-navy/25 bg-surface-soft px-5 py-4">
            <p className="text-sm font-bold text-content">
              {ko ? '이 결과로 마일리지 전략 세우기' : 'Plan your mileage with this result'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-content-soft">
              {ko
                ? `남은 과목 ${remainingForMileage.length}개를 수강신청 도우미로 그대로 가져갑니다. 다시 입력할 필요 없어요.`
                : `Carries your ${remainingForMileage.length} remaining course(s) over — no re-entry needed.`}
            </p>
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.setItem(
                    MILEAGE_HANDOFF_KEY,
                    JSON.stringify({ courses: remainingForMileage }),
                  );
                } catch {
                  /* 저장이 막혀 있어도 이동은 시킨다(빈 상태로 시작) */
                }
                router.push(sectionTabHref('undergraduate', 'mileage'));
              }}
              className="group mt-3 inline-flex min-h-[44px] items-center gap-2 bg-yonsei-navy px-5 text-sm font-bold text-white transition-colors hover:bg-yonsei-blue"
            >
              {ko ? '수강신청 도우미로' : 'Go to Course Registration Helper'}
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                →
              </span>
            </button>
          </div>
        )}

        {/* 한계·유의사항 — 결과 아래에서 "무엇이 반영되지 않는가" 를 항목으로 나열한다.
            위의 경고 박스가 태도(의존 금지)를 말한다면, 여기는 구체적 누락 범위를 말한다. */}
        <div className="mt-8 max-w-2xl border-t border-surface-border pt-5 text-xs leading-relaxed text-content-faint">
          <p className="font-bold text-content-soft">{ko ? '유의사항 및 한계' : 'Limitations'}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              {ko
                ? '학점은 표준 학점 기준 추정치입니다. 재수강·계절학기·편입·교환학생·학점인정 과목은 반영되지 않을 수 있습니다.'
                : 'Credits are estimates from standard values; retakes, summer sessions, transfers, exchange programs, and credit recognition may not be reflected.'}
            </li>
            <li>
              {ko
                ? '성적(F·미이수)과 수강 철회는 시간표에서 알 수 없어 모두 이수한 것으로 계산됩니다.'
                : 'Grades (F, incomplete) and withdrawals cannot be read from a timetable, so every course is counted as completed.'}
            </li>
            <li>
              {ko
                ? '졸업요건은 학번·전공 트랙·복수전공·부전공 여부에 따라 달라지며, 이 도구는 일부 경우만 다룹니다.'
                : 'Requirements vary by cohort, track, and double/minor majors; this tool covers only some cases.'}
            </li>
            <li>
              {ko
                ? '채플 횟수는 입력값을 그대로 믿으며, 영어 인증·졸업논문·졸업시험 등 학점 외 요건은 직접 확인해야 합니다.'
                : 'Chapel count is taken as entered; non-credit requirements (English certification, thesis, exams) must be checked separately.'}
            </li>
            <li>
              {ko
                ? '요건과 과목 데이터는 수동으로 갱신되므로 최신 학사 규정과 다를 수 있습니다.'
                : 'Requirement and course data are updated by hand and may lag behind current regulations.'}
            </li>
            <li>
              {ko
                ? '업로드한 이미지는 브라우저 안에서만 처리되며 서버로 전송되지 않습니다.'
                : 'Uploaded images are processed in your browser only and are never sent to a server.'}
            </li>
          </ul>
          <p className="mt-3 font-semibold text-content-soft">
            {ko
              ? '※ 최종 졸업 가능 여부는 반드시 연세포털 졸업사정 조회와 학과사무실에서 확인하세요. 이 도구의 오류로 인한 불이익에 대해 제작자는 책임지지 않습니다.'
              : '※ Always confirm your graduation status on the Yonsei portal and with the department office. The authors accept no liability for consequences arising from errors in this tool.'}
          </p>
        </div>
      </section>
    </div>
  );
}
