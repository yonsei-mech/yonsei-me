'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { SegmentedControl } from '@/components/SegmentedControl';
import { allocate, efficientFrontier, type AllocEntry } from '@/lib/mileage/allocate';
import { distributionFor, histogramBars, probabilityAtLeast } from '@/lib/mileage/distribute';
import { adjustTieWin, admitProbability, mileageForProbability } from '@/lib/mileage/predict';
import {
  confidenceOf,
  confidenceReason,
  fetchBundle,
  fetchDetails,
  findConflicts,
  formatTerm,
  majorQuotaCount,
  parseTimeSlots,
  searchSections,
  siblingSections,
  type GradeSlice,
  type MileageData,
  type Section,
  type SectionDetail,
} from '@/lib/mileage/bundle';
import type { Locale } from '@/i18n/routing';

/** 졸업요건 체커 → 마일리지 플래너 인수인계 키(사용자 지시 4) */
export const MILEAGE_HANDOFF_KEY = 'me-mileage-handoff';

export interface MileageHandoff {
  /** 체커가 계산한 "남은 과목" — 과목명 기준으로 이번 학기 개설분을 찾는다 */
  courses: { name: string; credits?: number; required?: boolean }[];
}

/** 담은 과목 하나의 계획 상태 */
interface Planned {
  /** Section.id ("CODE-DIV") */
  id: string;
  mileage: number;
  /** 졸업 필수도 1=선택 2=권장 3=필수 */
  weight: number;
}

/** 이수율 입력 보존 키 — 학기 내내 같은 값을 다시 치게 하지 않는다 */
const CREDIT_RATIO_KEY = 'me-mileage-credit-ratio';

/** 졸업학점 기본값 — 기계공학부 단일전공 기준 */
const DEFAULT_REQUIRED_CREDITS = 130;

/**
 * 담은 과목 한 줄 — 원본 분반(section)과 **신청자 속성이 반영된 예측(pred)** 을 함께 들고 다닌다.
 *
 * 카드의 확률, 우측 리스크 분포, 자동 배분이 모두 `pred` 를 쓴다. 하나라도 `section` 을
 * 그대로 쓰면 "카드는 94%인데 목표 확률은 88% 기준으로 계산되는" 어긋남이 생긴다.
 */
interface PlanRow {
  plan: Planned;
  section: Section;
  /** section 에 보정된 동점 승률을 얹은 예측(보정할 것이 없으면 section 과 동일 객체) */
  pred: Section;
  /** 상세의 perGrade[사용자 학년] — 근거 학기(보통 작년) 이 분반에서 내 학년의 실적 */
  perGrade: { cut: number | null; applied: number; won: number } | null;
  /** 컷이 만점에 닿아 동점 규칙으로 갈렸던 분반 */
  satTie: boolean;
  /** 근거 학기 동점자 중 합격한 최저 이수율(승부선). null 이면 그 학기 동점자의
   *  이수율 기록이 전부 결측이라 계산 불가(0 은 나오지 않는다 — precompute 가 결측 0/ 을 제외) */
  winMin: number | null;
  /**
   * perGrade·winMin 이 나온 학기 "YYYY-SS". 보통은 최신 학기라 null 이고, 라인업 일치
   * 오버라이드가 걸린 분반만 값이 있다 — 그때는 화면이 "작년" 대신 이 학기를 말해야 한다.
   */
  tieBasis: string | null;
  /** 이수율 판정 — 'win' 우위 / 'lose' 열세 / null 판정 불가 */
  verdict: 'win' | 'lose' | null;
}

/**
 * 학점 입력 정규화 — 정수부 3자리 + 소수점 1자리까지 허용한다.
 *
 * ⚠️ 이수학점은 실제로 **0.5 단위**로 나온다(원장 값이 "26.5/126" 형태). 예전처럼 숫자만
 * 남기면 "94.5" 가 "945" 가 돼 이수율이 7배로 튄다. 소수점은 하나만 남기고, 소수 둘째
 * 자리부터는 버린다(학사 규정상 0.5 단위라 그 아래는 의미가 없다).
 */
const creditInput = (v: string) => {
  const cleaned = v.replace(/[^0-9.]/g, '');
  const [intPart, ...rest] = cleaned.split('.');
  const head = intPart.slice(0, 3);
  if (rest.length === 0) return head;
  return `${head}.${rest.join('').slice(0, 1)}`;
};

/**
 * 비율 → 백분율 문자열. 원장 비율이 소수 4자리(예: 0.2103)로 오므로 백분율은 소수
 * 둘째 자리까지 살리고, 뒤에 붙는 0 은 떨군다(50% / 67.9% / 21.03%).
 *
 * 정수로 반올림하면 안 된다 — 내 이수율과 승부선이 소수점에서 갈리는 일이 실제로 있어
 * 둘 다 "21%" 로 보이는데 판정만 갈리는 모순이 생긴다(판정 자체는 원값으로 한다).
 */
const pct = (r: number) => `${Number((r * 100).toFixed(2))}%`;

/** 빈 문자열·비정상 입력은 null(= 미입력) */
function numOrNull(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 학점 입력칸 — 졸업요건 체커와 같은 각진 인풋(네이티브 스핀 버튼은 숨긴다) */
const CREDIT_INPUT_CLASS =
  'mt-1 h-10 w-full min-w-0 border border-surface-border bg-surface px-2 text-[15px] font-bold tabular-nums text-content outline-none [appearance:textfield] focus:border-yonsei-blue [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

const WEIGHT_LABELS: Record<number, { ko: string; en: string }> = {
  3: { ko: '필수', en: 'Required' },
  2: { ko: '권장', en: 'Recommended' },
  1: { ko: '선택', en: 'Elective' },
};

/**
 * 합격 가능성 구간 — 색과 라벨.
 *
 * 25~50% 구간은 원래 '불안'이었는데, 수강신청에서 이 구간은 "피해야 할 상태"가 아니라
 * **알고 거는 선택**이다(입시의 소신지원과 같은 뜻). 겁을 주는 말 대신 판단의 이름을 준다.
 */
function levelOf(p: number, ko: boolean) {
  if (p >= 0.8) return { color: '#0F7B3E', label: ko ? '안정' : 'Safe' };
  if (p >= 0.5) return { color: '#0057A8', label: ko ? '적정' : 'Likely' };
  if (p >= 0.25) return { color: '#A16207', label: ko ? '소신' : 'Reach' };
  return { color: '#DC2626', label: ko ? '위험' : 'Unlikely' };
}

/** 데이터 부족 경고색 — 흰 배경 대비 4.82:1 로 11px 글씨에서도 WCAG AA 통과 */
const WARN_AMBER = '#A16207';
const WARN_RED = '#DC2626';
/** 좋은 소식(미달) 표시색 — levelOf '안정'과 같은 그린, 흰 배경 대비 5.3:1 */
const OK_GREEN = '#0F7B3E';

/**
 * "만점 동점전" 배지를 띄우는 기준 — 만점 포화 확률 π.
 *
 * π 는 이미 축소 추정된 값이라(predict.ts 의 PI_TAU) 날것의 비율보다 보수적이다.
 * 0.25 는 "직전 학기가 포화였고 그 이력이 하나뿐"인 분반이 대략 얻는 값(1/(1+2)=0.33)보다
 * 한 단계 아래로, 포화 이력이 실제로 있는 분반만 걸리게 하는 선이다.
 */
const SAT_TIE_THRESHOLD = 0.25;

/** 배지 보조문구 — 툴팁과 카드 본문에 같은 글을 쓴다 */
const SAT_TIE_NOTE = {
  ko: '작년 만점 지원자끼리 동점자 규칙으로 갈렸습니다 — 이수율이 승부처입니다.',
  en: 'Last year everyone bid the cap and tie-breakers decided it — your credit ratio is what counts.',
};
const UNDER_NOTE = {
  ko: '작년엔 1점만 넣어도 들어갔습니다.',
  en: 'Last year a single point was enough to get in.',
};

/**
 * 마일리지가 같을 때 적용되는 우선순위 기준(연세대 안내 기준).
 *
 * ⚠️ 흔한 오해 두 가지를 문구로 못박는다.
 *   · 학년은 "높을수록 유리"가 아니다 — 학년별 정원이 있는 과목에서 정원을 채우는 장치다.
 *   · 5·6번은 학점의 '양'이 아니라 '비율'이다.
 * 실제로 과거 기록에서도 컷 지점의 학년별 합격률이 2·3·4학년 73.5/72.5/72.1%로 평평해
 * 학년 효과가 식별되지 않았고, 그래서 예측 모델에 학년 보정을 넣지 않았다.
 */
const TIEBREAKERS_KO = [
  { title: '전공자 여부', body: '전공자 정원이 있는 과목에 한합니다. 전공자 자리와 비전공자 자리를 따로 채웁니다.' },
  { title: '신청 과목 수', body: '최대 6과목까지 인정. 4과목만 들을 예정이어도 6과목을 채우는 편이 유리합니다.' },
  { title: '졸업 신청 여부', body: '막학기에 졸업(수료)을 신청한 학생이 우선합니다.' },
  { title: '초수강 여부', body: '재수강생은 처음 듣는 학생에게 밀립니다.' },
  { title: '졸업학점 대비 이수학점', body: '양이 아니라 비율입니다. 졸업학점이 낮은 전공이 같은 이수학점에서 유리합니다.' },
  { title: '수강가능학점 대비 직전학기 이수학점', body: '초과 수강분은 인정되지 않아 최대 1까지만 반영됩니다.' },
  { title: '학년', body: '학년별 정원이 있는 과목에 한합니다. 학년이 높다고 유리한 것이 아니라, 학년별 정원을 채우기 위한 기준입니다.' },
];

const TIEBREAKERS_EN = [
  { title: 'Major status', body: 'Only where a major quota exists; major and non-major seats fill separately.' },
  { title: 'Number of applied courses', body: 'Up to 6 counted — filling all 6 helps even if you plan to take fewer.' },
  { title: 'Graduation application', body: 'Students applying to graduate take priority.' },
  { title: 'First attempt', body: 'Retakers rank below first-time takers.' },
  { title: 'Earned / required credits', body: 'A ratio, not a raw amount.' },
  { title: 'Last term credits / allowed', body: 'Capped at 1 — extra credits do not count.' },
  { title: 'Year', body: 'Only where per-year quotas exist. A higher year is NOT itself an advantage.' },
];

/**
 * 마일리지 전략 플래너.
 *
 * 진입 경로 두 가지(사용자 지시 4):
 *   ① 졸업요건 체커 결과에서 넘어오기 — sessionStorage 로 "남은 과목"을 받아 자동으로 담는다.
 *   ② 이 탭으로 바로 들어오기 — 빈 상태에서 직접 검색해 담는다.
 *
 * 계산은 전부 브라우저에서 돈다(정적 번들 + 자체 엔진). 서버 호출 없음.
 */
export function MileagePlanner({ locale }: { locale: Locale }) {
  const ko = locale === 'ko';
  const [data, setData] = useState<MileageData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [grade, setGrade] = useState(3);
  const [budget, setBudget] = useState(76);
  /** 이수율 입력 — 문자열로 들고 있어야 "미입력"과 "0"을 구분할 수 있다 */
  const [earnedInput, setEarnedInput] = useState('');
  const [requiredInput, setRequiredInput] = useState(String(DEFAULT_REQUIRED_CREDITS));
  /** localStorage 를 읽기 전에는 저장하지 않는다(빈 값으로 덮어쓰는 사고 방지) */
  const [ratioLoaded, setRatioLoaded] = useState(false);
  const [planned, setPlanned] = useState<Planned[]>([]);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState(9);
  const [fromChecker, setFromChecker] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** 상세 패널을 펼친 과목 id (한 번에 하나만) */
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  /** 분반 상세(지연 로딩) — 카드의 '작년컷' 칩이 이 자료를 쓴다 */
  const [details, setDetails] = useState<Record<string, SectionDetail> | null>(null);

  // 번들 로드
  useEffect(() => {
    let alive = true;
    fetchBundle()
      .then((d) => alive && setData(d))
      .catch((e: unknown) =>
        alive ? setLoadError(e instanceof Error ? e.message : String(e)) : undefined,
      );
    return () => {
      alive = false;
    };
  }, []);

  // 이수율 입력 복원 — SSR 불일치를 피하려 마운트 후에 읽는다
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CREDIT_RATIO_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { earned?: unknown; required?: unknown };
        if (typeof saved.earned === 'string') setEarnedInput(saved.earned.slice(0, 3));
        if (typeof saved.required === 'string' && saved.required) setRequiredInput(saved.required.slice(0, 3));
      }
    } catch {
      /* 사생활 보호 모드 등 localStorage 불가 → 기본값으로 시작 */
    }
    setRatioLoaded(true);
  }, []);

  useEffect(() => {
    if (!ratioLoaded) return;
    try {
      window.localStorage.setItem(
        CREDIT_RATIO_KEY,
        JSON.stringify({ earned: earnedInput, required: requiredInput }),
      );
    } catch {
      /* 저장 불가 환경은 조용히 무시 — 이번 세션에서는 그대로 동작한다 */
    }
  }, [earnedInput, requiredInput, ratioLoaded]);

  /**
   * 이수율 = 총이수학점 / 졸업학점.
   * 동점자 규정 5번은 학점의 '양'이 아니라 '비율'이라, 졸업학점이 다른 전공을 같은 자로 잰다.
   */
  const earnedCredits = numOrNull(earnedInput);
  const requiredCredits = numOrNull(requiredInput);
  const creditRatio =
    earnedCredits !== null && requiredCredits !== null && requiredCredits > 0
      ? earnedCredits / requiredCredits
      : null;

  // 진입 경로 ① — 졸업요건 체커에서 넘어온 과목 자동 담기
  useEffect(() => {
    if (!data) return;
    let payload: MileageHandoff | null = null;
    try {
      const raw = sessionStorage.getItem(MILEAGE_HANDOFF_KEY);
      if (raw) payload = JSON.parse(raw) as MileageHandoff;
    } catch {
      payload = null;
    }
    if (!payload?.courses?.length) return;

    const picked: Planned[] = [];
    for (const want of payload.courses) {
      const norm = want.name.replace(/\s+/g, '');
      // 이번 학기 개설분 중 이름이 일치하는 분반. 여러 교수면 예측 컷이 가장 낮은 분반을 기본 제시
      const matches = data.sections.filter((s) => s.name.replace(/\s+/g, '') === norm);
      if (matches.length === 0) continue;
      const best = matches.reduce((a, b) => (b.mu < a.mu ? b : a));
      if (picked.some((p) => p.id === best.id)) continue;
      picked.push({ id: best.id, mileage: 0, weight: want.required === false ? 2 : 3 });
    }
    if (picked.length) {
      setPlanned(picked.slice(0, 10));
      setFromChecker(true);
    }
    sessionStorage.removeItem(MILEAGE_HANDOFF_KEY);
  }, [data]);

  const gradeShift = data?.gradeShift?.[String(grade)] ?? 0;

  /**
   * 담은 과목의 Section + 계획 + **신청자 속성 보정**을 합친 뷰.
   *
   * 보정은 여기 한 곳에서만 한다 — 카드·분포·자동 배분이 전부 이 `pred` 를 쓰므로
   * 화면 어디를 봐도 같은 모형이 된다. 상세(details)가 아직 안 왔으면 보정 없이 원본 그대로다.
   */
  const rows = useMemo<PlanRow[]>(() => {
    if (!data) return [];
    return planned
      .map((p) => {
        const s = data.byId.get(p.id);
        if (!s) return null;
        const detail = details?.[p.id] ?? null;
        // ⚠️ perGrade·tieCredit 은 보통 **분반 번호 기준** 최근 학기 집계다(교수 이력과 달리
        //    분반을 따라간다). 교수가 바뀐 분반이면 "이 자리의 작년"으로 읽어야 한다.
        //    단 tieBasis 가 있으면 라인업이 같은 과거 학기 원장이므로 그 학기로 읽어야 한다.
        const perGrade = detail?.perGrade?.[String(grade)] ?? null;
        const winMin = detail?.tieCredit?.winMin ?? null;
        const tieBasis = detail?.tieBasis ?? null;
        const satTie = (s.piSat ?? 0) >= SAT_TIE_THRESHOLD;
        const adj = adjustTieWin({ tieWin: s.tieWin, perGrade, satTie, winMin, ratio: creditRatio });
        const pred = adj.tieWin === (s.tieWin ?? null) ? s : { ...s, tieWin: adj.tieWin };
        return { plan: p, section: s, pred, perGrade, satTie, winMin, tieBasis, verdict: adj.verdict };
      })
      .filter((x): x is PlanRow => x !== null);
  }, [planned, data, details, grade, creditRatio]);

  /**
   * 상세 자료는 원래 상세 패널을 펼칠 때만 받았다(원본 915KB). 카드의 '작년컷' 칩이 이 자료를
   * 쓰므로, **담은 과목이 생긴 뒤에** 한 번만 배경으로 받아 둔다 — 첫 화면에는 여전히 영향이
   * 없고, 전송량은 압축되어 75KB 남짓이다. 실패하면 칩만 빠지고 나머지는 그대로 돈다.
   */
  useEffect(() => {
    if (details || rows.length === 0) return;
    let alive = true;
    fetchDetails()
      .then((d) => {
        if (alive) setDetails(d);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [rows.length, details]);

  const conflicts = useMemo(() => findConflicts(rows.map((r) => r.section)), [rows]);
  const used = planned.reduce((a, p) => a + p.mileage, 0);
  const over = used > budget;

  const dist = useMemo(
    () =>
      distributionFor(
        rows.map((r) => ({ pred: r.pred, mileage: r.plan.mileage, credits: r.section.credits })),
        gradeShift,
      ),
    [rows, gradeShift],
  );
  const pTarget = probabilityAtLeast(dist, target);
  const bars = useMemo(() => histogramBars(dist, target), [dist, target]);

  const allocEntries: AllocEntry[] = useMemo(
    () => rows.map((r) => ({ pred: r.pred, credits: r.section.credits, weight: r.plan.weight })),
    [rows],
  );

  // step 2 — 표본을 촘촘히 떠야 보간이 실제 곡률을 따라간다(4는 계단이 눈에 띄었다).
  // 예산 76 기준 39회 배분 계산이라 수 ms 로 끝난다.
  const frontier = useMemo(
    () => (rows.length ? efficientFrontier(allocEntries, budget, gradeShift, 2) : []),
    [allocEntries, budget, gradeShift, rows.length],
  );

  const results = useMemo(() => searchSections(data ?? ({ sections: [] } as never), query), [data, query]);

  // ── 조작 ────────────────────────────────────────────────
  const add = useCallback((s: Section) => {
    setPlanned((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, { id: s.id, mileage: 0, weight: 2 }]));
    setQuery('');
  }, []);
  const remove = (id: string) => setPlanned((prev) => prev.filter((p) => p.id !== id));
  const setMileage = (id: string, v: number) =>
    setPlanned((prev) => prev.map((p) => (p.id === id ? { ...p, mileage: Math.max(0, v) } : p)));
  const setWeight = (id: string, w: number) =>
    setPlanned((prev) => prev.map((p) => (p.id === id ? { ...p, weight: w } : p)));
  /** 교수 변경 — 같은 과목의 다른 분반으로 교체(사용자 지시 2) */
  const switchSection = (oldId: string, newId: string) =>
    setPlanned((prev) => prev.map((p) => (p.id === oldId ? { ...p, id: newId } : p)));

  const autoAllocate = () => {
    const r = allocate(allocEntries, budget, gradeShift);
    setPlanned((prev) => {
      const next = [...prev];
      rows.forEach((row, i) => {
        const idx = next.findIndex((p) => p.id === row.section.id);
        if (idx >= 0) next[idx] = { ...next[idx], mileage: r.mileages[i] };
      });
      return next;
    });
  };
  const resetAll = () => setPlanned((prev) => prev.map((p) => ({ ...p, mileage: 0 })));

  if (loadError) {
    return (
      <p className="border border-surface-border bg-surface-soft px-5 py-8 text-sm text-content-soft">
        {ko ? '마일리지 데이터를 불러오지 못했습니다. 새로고침해 주세요.' : 'Failed to load data.'}
      </p>
    );
  }

  return (
    <div>
      {/* 면책 — 상시 노출 */}
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-l-2 border-yonsei-navy bg-surface-soft px-4 py-3">
        <span className="bg-yonsei-navy px-2 py-0.5 text-[11px] font-bold text-white">BETA</span>
        <span className="text-[13px] font-semibold text-content">
          {ko ? '예측이며 합격을 보장하지 않습니다' : 'Predictions only — not a guarantee'}
        </span>
        <span className="text-[12px] text-content-faint">
          {ko ? '학생 제작 · 과거 수강신청 기록 기반' : 'Student-built · based on past registration records'}
        </span>
      </div>

      {/* 진입 경로 ① 안내 */}
      {fromChecker && (
        <p className="mb-5 border border-yonsei-blue/30 bg-yonsei-blue/[0.06] px-4 py-3 text-[13px] text-content">
          {ko
            ? `졸업요건 결과에서 남은 과목 ${rows.length}개를 불러왔습니다. 필요 없으면 ✕ 로 빼세요.`
            : `Imported ${rows.length} remaining course(s) from your graduation audit.`}
        </p>
      )}

      {/* 결과 직전 경고 — 졸업요건 검사기와 같은 형태. 예측 컷·확률을 보기 전에
          "참고만, 의존 금지, 본인 책임" 을 못 박는다. 여기서의 오판은 과목을 놓치는 것으로
          직결되므로 상시 배너보다 강한 어조. */}
      <div
        role="alert"
        className="mb-6 border-l-2 border-[#b42318] bg-surface-soft px-5 py-4 text-[13px] leading-relaxed text-content"
      >
        <p className="font-bold text-[#b42318]">
          {ko
            ? '⚠ 아래 예측 컷과 확률은 참고용 추정치입니다. 절대 이 결과에만 의존하지 마세요.'
            : '⚠ The predicted cutoffs and probabilities below are estimates for reference only. Never rely on them alone.'}
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-content-soft">
          <li>
            {ko
              ? '학생이 만든 비공식 도구이며, 학과·대학이 검증하거나 보증하지 않습니다.'
              : 'This is an unofficial, student-built tool. It is not verified or endorsed by the department or the university.'}
          </li>
          <li>
            {ko
              ? '과거 기록의 통계일 뿐, 이번 학기 경쟁률·정원·교수·분반 변경은 알 수 없어 실제 컷은 크게 달라질 수 있습니다.'
              : 'It is a statistic of past records; this semester’s demand, capacity, instructor, and section changes are unknown, so real cutoffs can differ a lot.'}
          </li>
          <li>
            {ko
              ? '실제 배정은 연세포털 수강신청 규정(우선순위·동점 처리·예외 배정)에 따르며, 이 도구는 그 규정을 대신하지 않습니다.'
              : 'Actual placement follows the Yonsei portal registration rules (priorities, tie-breaks, exceptions); this tool does not replace them.'}
          </li>
          <li>
            {ko
              ? '이 결과를 근거로 한 마일리지 배분과 그 결과(미배정·졸업 지연 등)의 책임은 전적으로 본인에게 있습니다.'
              : 'Any mileage allocation based on this result, and its consequences (missed courses, delayed graduation), are entirely your own responsibility.'}
          </li>
        </ul>
      </div>

      {!data ? (
        <p className="px-1 py-10 text-sm text-content-faint">{ko ? '데이터 불러오는 중…' : 'Loading…'}</p>
      ) : (
        // 좌측(내 프로필) 폭을 줄여 그만큼 가운데 배분 열을 넓혔다(사용자 지시).
        // 합을 3.0 으로 유지해 우측 리스크 열 폭은 그대로 둔다 — 1440px 기준 좌 374→304px,
        // 가운데 520→590px.
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.73fr)_minmax(0,1.42fr)_minmax(0,0.85fr)] lg:gap-6">
          {/* ─────────── 좌: 계획 담기 ─────────── */}
          <section aria-label={ko ? '과목 담기' : 'Add courses'} className="min-w-0">
            <SectionLabel>{ko ? '내 프로필' : 'Profile'}</SectionLabel>
            {/* 졸업요건 체커의 '학번 선택'과 동일한 세그먼트 토글(사용자 지시) */}
            <div className="mt-3">
              <SegmentedControl
                value={String(grade)}
                onChange={(id) => setGrade(Number(id))}
                options={[1, 2, 3, 4].map((g) => ({
                  id: String(g),
                  label: ko ? `${g}학년` : `Y${g}`,
                }))}
                ariaLabel={ko ? '학년 선택' : 'Year'}
                className="w-full"
              />
            </div>
            {/* 이수율 — 아코디언(고급) 안이 아니라 프로필 본문에 둔다.
                만점 동점전 분반에서는 마일리지가 아니라 이 값이 당락을 가르므로,
                "고급 설정"으로 숨기면 정작 필요한 사람이 못 찾는다(사용자 지시). */}
            <div className="mt-4 border border-surface-border px-3 py-3">
              <p className="text-[11px] font-semibold text-content-faint">
                {ko ? '이수율' : 'Credit ratio'}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="mileage-earned"
                    className="block text-[10.5px] font-semibold text-content-faint"
                  >
                    {ko ? '총이수학점' : 'Earned'}
                  </label>
                  {/* type=number 가 아니라 text 다 — number 는 "94." 같은 입력 중간 상태에서
                      value 를 빈 문자열로 돌려줘 소수점을 찍는 순간 지워진다. 검증은
                      creditInput(정수 3자리+소수 1자리)과 numOrNull 이 대신한다. */}
                  <input
                    id="mileage-earned"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={earnedInput}
                    onChange={(e) => setEarnedInput(creditInput(e.target.value))}
                    placeholder={ko ? '예: 94.5' : 'e.g. 94.5'}
                    className={CREDIT_INPUT_CLASS}
                  />
                </div>
                <div>
                  <label
                    htmlFor="mileage-required"
                    className="block text-[10.5px] font-semibold text-content-faint"
                  >
                    {ko ? '졸업학점' : 'Required'}
                  </label>
                  <input
                    id="mileage-required"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={requiredInput}
                    onChange={(e) => setRequiredInput(creditInput(e.target.value))}
                    placeholder={String(DEFAULT_REQUIRED_CREDITS)}
                    className={CREDIT_INPUT_CLASS}
                  />
                </div>
              </div>
              <div className="mt-2.5 flex items-baseline gap-2 border-t border-surface-border pt-2.5">
                <span
                  style={{
                    fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif',
                    color: creditRatio === null ? '#6E6E6E' : '#003377',
                  }}
                  className="shrink-0 text-[30px] font-bold leading-none tabular-nums"
                >
                  {creditRatio === null ? '—' : pct(creditRatio)}
                </span>
                <span className="text-[10.5px] leading-tight text-content-faint">
                  {creditRatio === null
                    ? ko
                      ? '입력하면 만점 동점전 분반에서 우열을 판정합니다'
                      : 'Enter both to see how you place in cap tie-breaks'
                    : ko
                      ? '졸업학점 대비 이수학점 — 동점 시 순위를 가르는 비율입니다'
                      : 'Earned / required — the ratio that breaks ties'}
                </span>
              </div>
            </div>

            <p className="mb-1.5 mt-4 text-[11px] font-semibold text-content-faint">
              {ko ? '학기 예산' : 'Budget'}
            </p>
            <SegmentedControl
              value={String(budget)}
              onChange={(id) => setBudget(Number(id))}
              options={[72, 76].map((b) => ({ id: String(b), label: `${b}mp` }))}
              ariaLabel={ko ? '학기 예산 선택' : 'Budget'}
              className="w-full"
            />

            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              className="mt-4 flex min-h-[44px] w-full items-center justify-between border-t border-surface-border pt-3 text-left text-[12px] font-semibold text-content-faint"
            >
              {ko ? '고급 · 동점자 세부조건' : 'Advanced · tie-breakers'}
              <span aria-hidden="true">{advancedOpen ? '−' : '+'}</span>
            </button>
            {advancedOpen && (
              <div className="mt-2">
                <ol className="space-y-1.5 text-[11.5px] leading-relaxed text-content-faint">
                  {(ko ? TIEBREAKERS_KO : TIEBREAKERS_EN).map((t, i) => (
                    <li key={i}>
                      <span className="font-semibold text-content">
                        {i + 1}. {t.title}
                      </span>
                      <br />
                      {t.body}
                    </li>
                  ))}
                </ol>
                <p className="mt-3 border-t border-surface-border pt-2 text-[11px] leading-relaxed text-content-faint">
                  {ko
                    ? '※ 마일리지가 같을 때 위 순서로 우선순위가 정해지고, 마지막에 전공자·학년 정원에 맞춰 위에서부터 확정됩니다. 과거 기록에서도 컷 지점의 학년 효과가 나타나지 않아, 예측에 학년 보정을 넣지 않았습니다.'
                    : '※ Ties are broken in this order, then major/grade quotas are applied. No grade adjustment is used — consistent with the rule that a higher year is not itself an advantage.'}
                </p>
              </div>
            )}

            <div className="mt-7">
              <SectionLabel>{ko ? '과목 담기' : 'Add courses'}</SectionLabel>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={ko ? '과목명 · 학정번호 · 교수명' : 'Course, code, or professor'}
                aria-label={ko ? '과목 검색' : 'Search courses'}
                className="mt-3 h-11 w-full border border-surface-border bg-surface px-3 text-[14px] text-content outline-none focus:border-yonsei-blue"
              />
              <p className="mt-1.5 text-[11px] text-content-faint">
                {ko
                  ? `${data.sections.length.toLocaleString()}개 분반 · 교양·타전공 포함`
                  : `${data.sections.length.toLocaleString()} sections · all departments`}
              </p>

              {query.trim() && (
                <ul className="mt-2 max-h-[300px] divide-y divide-surface-border overflow-y-auto border border-surface-border">
                  {results.length === 0 && (
                    <li className="px-3 py-4 text-[12.5px] text-content-faint">
                      {ko ? '검색 결과가 없습니다.' : 'No results.'}
                    </li>
                  )}
                  {results.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => add(s)}
                        className="flex min-h-[44px] w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-surface-soft"
                      >
                        <span className="text-[13.5px] font-semibold text-content">
                          {s.name}
                          <span className="ml-1.5 font-medium text-content-faint">{s.credits}학점</span>
                        </span>
                        <span className="text-[11.5px] text-content-faint">
                          {s.code}-{s.division} · {s.professor || (ko ? '미배정' : 'TBA')} · {s.deptName}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 미니 시간표 — 담은 과목이 있을 때만 */}
            {rows.length > 0 && (
              <div className="mt-7">
                <SectionLabel>{ko ? '미니 시간표' : 'Timetable'}</SectionLabel>
                <MiniTimetable rows={rows} ko={ko} />
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-content-faint">
                  {ko ? '겹치는 칸은 ! 로 표시됩니다' : 'Overlaps are marked with !'}
                </p>
              </div>
            )}
          </section>

          {/* ─────────── 중: 배분 ─────────── */}
          <section aria-label={ko ? '마일리지 배분' : 'Allocation'} className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>{ko ? '마일리지 배분' : 'Allocation'}</SectionLabel>
              <button
                type="button"
                onClick={resetAll}
                className="min-h-[36px] px-2 text-[12px] font-semibold text-content-faint hover:text-yonsei-blue"
              >
                ↺ {ko ? '초기화' : 'Reset'}
              </button>
            </div>

            {/* 예산 바 — 모바일에서는 하단 고정 */}
            <div className="sticky bottom-0 z-10 mt-3 border border-surface-border bg-surface px-3 py-2.5 lg:static">
              <div className="flex items-baseline justify-between">
                <span className="text-[11.5px] font-semibold text-content-faint">
                  {ko ? '배분 합계 / 학기 예산' : 'Allocated / Budget'}
                </span>
                <span
                  className="text-[15px] font-bold tabular-nums"
                  style={{ color: over ? WARN_RED : '#232323' }}
                >
                  {used} / {budget}mp
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full bg-surface-border">
                <div
                  className="h-2"
                  style={{
                    width: `${Math.min(100, (used / budget) * 100)}%`,
                    background: over ? WARN_RED : '#003377',
                  }}
                />
              </div>
              {over && (
                <p className="mt-1.5 text-[11.5px] font-semibold" style={{ color: WARN_RED }}>
                  {ko ? `예산을 ${used - budget}mp 초과했습니다.` : `Over budget by ${used - budget}mp.`}
                </p>
              )}
            </div>

            {rows.length === 0 ? (
              <div className="mt-4 border border-dashed border-surface-border px-5 py-12 text-center">
                <p className="text-[13.5px] font-semibold text-content">
                  {ko ? '담은 과목이 없습니다' : 'No courses yet'}
                </p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-content-faint">
                  {ko
                    ? '왼쪽에서 과목을 검색해 담으면 여기에 배분 슬라이더와 실시간 확률이 나타납니다.'
                    : 'Search on the left to add courses.'}
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-3">
                {rows.map(({ plan, section, pred, perGrade, satTie, winMin, tieBasis, verdict }) => {
                  // 확률·기준 배점은 모두 보정된 pred 로 계산한다(원본 section 과 섞지 말 것)
                  const p = admitProbability(pred, plan.mileage, gradeShift);
                  const lv = levelOf(p, ko);
                  const conf = confidenceOf(section);
                  const reason = confidenceReason(section, ko);
                  const conflictWith = conflicts.get(section.id);
                  const siblings = siblingSections(data, section.code);
                  const gradeRate = perGrade && perGrade.applied > 0 ? perGrade.won / perGrade.applied : null;
                  // 동점 통계가 "작년"이 아닌 학기에서 왔으면 그 학기를 밝힌다(null 이면 기존 문구)
                  const basis = tieBasisText(tieBasis, ko);
                  /**
                   * 컷 안내 칩 — 슬라이더를 감으로 밀지 않게 기준점을 준다.
                   * 예측 두 개(적정 50% · 안전 90%)와 사실 하나(작년컷)를 같은 크기로 놓되,
                   * 안전이 적정과 같은 값이면 같은 숫자를 두 번 보이지 않는다.
                   */
                  const fitMp = mileageForProbability(pred, 0.5, gradeShift);
                  const safeMp = mileageForProbability(pred, 0.9, gradeShift);
                  const lastCut = details?.[section.id]?.professorHistory?.[0]?.[2];
                  const chips: { key: string; label: string; value: number }[] = [
                    { key: 'fit', label: ko ? '적정' : 'Likely', value: fitMp },
                  ];
                  if (safeMp !== fitMp) chips.push({ key: 'safe', label: ko ? '안전' : 'Safe', value: safeMp });
                  if (lastCut !== undefined) {
                    chips.push({
                      key: 'last',
                      label: ko ? '작년컷' : 'Last cut',
                      value: Math.min(lastCut, section.maxMileage),
                    });
                  }
                  return (
                    <li key={plan.id} className="border border-surface-border px-3.5 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[14px] font-bold text-content">
                            {section.name}
                            <span className="ml-1.5 text-[12px] font-medium text-content-faint">
                              {section.credits}학점
                            </span>
                            {/* 모형이 정규 CDF 를 벗어난 두 상태 — 숫자만으로는 안 보이므로 이름을 붙인다 */}
                            {satTie && (
                              <StateBadge color={WARN_AMBER} note={ko ? SAT_TIE_NOTE.ko : SAT_TIE_NOTE.en}>
                                {ko ? '만점 동점전' : 'Cap tie-break'}
                              </StateBadge>
                            )}
                            {section.underEnrolled && (
                              <StateBadge color={OK_GREEN} note={ko ? UNDER_NOTE.ko : UNDER_NOTE.en}>
                                {ko ? '작년 미달' : 'Under-enrolled'}
                              </StateBadge>
                            )}
                          </p>
                          <p className="mt-0.5 text-[11.5px] text-content-faint">
                            {section.code}-{section.division} · {section.deptName}
                          </p>

                          {/* 담당 교수 — 여러 분반이면 선택 가능(사용자 지시 2) */}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold text-content-faint">
                              {ko ? '담당 교수' : 'Professor'}
                            </span>
                            {siblings.length > 1 ? (
                              <select
                                value={section.id}
                                onChange={(e) => switchSection(section.id, e.target.value)}
                                aria-label={`${section.name} ${ko ? '분반 선택' : 'section'}`}
                                className="min-h-[36px] max-w-[220px] border border-surface-border bg-surface px-2 text-[12px] text-content"
                              >
                                {siblings.map((sb) => (
                                  <option key={sb.id} value={sb.id}>
                                    {sb.division} · {sb.professor || (ko ? '미배정' : 'TBA')}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-[12px] font-semibold text-content">
                                {section.professor || (ko ? '미배정' : 'TBA')}
                              </span>
                            )}
                            {siblings.length > 1 && (
                              <span className="text-[10.5px] text-content-faint">
                                {ko ? '교수별로 예측이 다릅니다' : 'Predictions differ by professor'}
                              </span>
                            )}
                          </div>

                          {/* 졸업 필수도 */}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-content-faint">
                              {ko ? '졸업 필수도' : 'Priority'}
                            </span>
                            {[3, 2, 1].map((w) => (
                              <button
                                key={w}
                                type="button"
                                onClick={() => setWeight(plan.id, w)}
                                aria-pressed={plan.weight === w}
                                className={cn(
                                  'min-h-[32px] border px-2 text-[11.5px] font-semibold',
                                  plan.weight === w
                                    ? 'border-yonsei-navy bg-yonsei-navy text-white'
                                    : 'border-surface-border bg-surface text-content-faint',
                                )}
                              >
                                {ko ? WEIGHT_LABELS[w].ko : WEIGHT_LABELS[w].en}
                              </button>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => remove(plan.id)}
                          aria-label={`${section.name} ${ko ? '제거' : 'remove'}`}
                          className="grid h-[30px] w-[30px] shrink-0 place-items-center border border-surface-border bg-surface text-[13px] text-content-faint hover:text-content"
                        >
                          ✕
                        </button>
                      </div>

                      {/* 경고 배지 — 같은 형태, 색만 다름 */}
                      {(conflictWith || conf !== 'high') && (
                        <div className="mt-2.5 flex flex-wrap gap-[7px]">
                          {conflictWith && (
                            <WarnBadge color={WARN_RED} icon="calendar">
                              {ko ? '시간 충돌' : 'Time conflict'} · {conflictWith.join(', ')}
                            </WarnBadge>
                          )}
                          {conf !== 'high' && reason && (
                            <WarnBadge color={WARN_AMBER} icon="alert">
                              {ko ? '데이터 부족' : 'Limited data'} · {reason}
                            </WarnBadge>
                          )}
                        </div>
                      )}

                      {/* 상태 배지 보조문구 — 배지 이름만으로는 무엇을 하라는 말인지 알 수 없다 */}
                      {(satTie || section.underEnrolled) && (
                        <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-content-soft">
                          {satTie && <p>{ko ? SAT_TIE_NOTE.ko : SAT_TIE_NOTE.en}</p>}
                          {/* 이수율을 아직 안 넣은 사람에게 어디에 넣는지 알려 준다 */}
                          {satTie && creditRatio === null && winMin !== null && winMin > 0 && (
                            <p className="text-content-faint">
                              {ko
                                ? '왼쪽 내 프로필에 이수율을 넣으면 이 분반의 동점전 우열을 판정합니다.'
                                : 'Enter your credit ratio in the profile panel to see where you place.'}
                            </p>
                          )}
                          {/* 승부선을 낼 자료가 없는 분반 — 동점 합격자의 이수율이 전부 결측인 경우다.
                              (예전에는 결측을 0 으로 읽어 "이수율 0%도 합격 → 승부선 미형성"이라는
                               사실과 다른 안내가 떴다. precompute 에서 0/ 을 제외해 바로잡았다) */}
                          {satTie && creditRatio !== null && winMin === null && (
                            <p className="text-content-faint">
                              {ko
                                ? `다만 ${basis ? basis.term : '작년'} 이 분반은 동점자 이수율 기록이 없어 승부선을 계산하지 못했습니다.`
                                : `Credit-ratio records are missing for the tied bids ${basis ? `in ${basis.term}` : 'last year'}, so no threshold could be computed.`}
                            </p>
                          )}
                          {section.underEnrolled && <p>{ko ? UNDER_NOTE.ko : UNDER_NOTE.en}</p>}
                        </div>
                      )}

                      {/* 내 학년의 실적 — 같은 분반이어도 학년마다 결과가 크게 다르다.
                          근거 학기는 보통 작년이지만, 라인업이 같은 과거 학기일 수도 있다. */}
                      {perGrade && gradeRate !== null && (
                        <p className="mt-2 text-[11.5px] leading-relaxed text-content-soft">
                          {ko
                            ? `내 학년(${grade}학년) ${basis ? `${basis.full} 기준` : '작년'}: `
                            : `Your year (Y${grade}) ${basis ? `in ${basis.full}` : 'last year'}: `}
                          <b className="font-bold text-content">
                            {ko
                              ? `${perGrade.applied}명 지원 · ${perGrade.won}명 합격`
                              : `${perGrade.applied} applied · ${perGrade.won} admitted`}
                          </b>{' '}
                          <b className="font-bold" style={{ color: levelOf(gradeRate, ko).color }}>
                            ({Math.round(gradeRate * 100)}%)
                          </b>
                          {/* 합격자 0명이면 컷이 없다 — 숫자 대신 그 사실을 말한다(경고색) */}
                          {perGrade.cut === null ? (
                            <span className="font-bold" style={{ color: WARN_RED }}>
                              {ko ? ' · 내 학년 합격자 없음' : ' · none admitted in my year'}
                            </span>
                          ) : (
                            perGrade.cut !== section.maxMileage && (
                              <span className="text-content-faint">
                                {/* 줄머리에서 이미 근거 학기를 밝혔으면 "작년"을 되풀이하지 않는다 */}
                                {ko
                                  ? ` · 내 학년 ${basis ? '' : '작년 '}컷 ${perGrade.cut}mp`
                                  : ` · Y${grade} cut ${perGrade.cut}mp`}
                              </span>
                            )
                          )}
                        </p>
                      )}

                      {/* 이수율 판정 — 만점 동점전에서 실제로 순위를 가르는 한 줄이라 배지보다 크게 */}
                      {verdict && creditRatio !== null && winMin !== null && (
                        <p
                          className="mt-2 border-l-2 bg-surface py-1.5 pl-2.5 text-[13px] font-bold leading-snug"
                          style={{
                            borderColor: verdict === 'win' ? OK_GREEN : WARN_RED,
                            color: verdict === 'win' ? OK_GREEN : WARN_RED,
                          }}
                        >
                          {/* 승부선은 근거 학기 원장에서 나온 수치다 — 작년이 아니면 그 학기를 밝힌다.
                              여기선 짧은 term 만 쓴다(full 은 괄호가 겹쳐 읽기 나쁘다). */}
                          {ko
                            ? `내 이수율 ${pct(creditRatio)} ${verdict === 'win' ? '≥' : '<'} 승부선${basis ? `(${basis.term} 기준)` : ''} ${pct(winMin)} — ${verdict === 'win' ? '동점전 우위' : '동점 시 밀립니다'}`
                            : `Your ratio ${pct(creditRatio)} ${verdict === 'win' ? '≥' : '<'} tie line${basis ? ` (${basis.term})` : ''} ${pct(winMin)} — ${verdict === 'win' ? 'you win ties' : 'you lose ties'}`}
                        </p>
                      )}

                      {/* 슬라이더 + 확률 */}
                      <div className="mt-3 flex items-center gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-baseline justify-between">
                            <span className="text-[11px] text-content-faint">{ko ? '마일리지' : 'Mileage'}</span>
                            <span className="text-[11px] text-content-faint">
                              {ko ? '예측 컷' : 'Est. cutoff'} ~{Math.round(section.mu)}mp
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={section.maxMileage}
                            value={plan.mileage}
                            onChange={(e) => setMileage(plan.id, Number(e.target.value))}
                            aria-label={`${section.name} ${ko ? '마일리지' : 'mileage'}`}
                            aria-valuetext={`${plan.mileage}mp, ${Math.round(p * 100)}%`}
                            className="h-11 w-full accent-yonsei-navy"
                          />
                        </div>
                        <div className="w-[62px] shrink-0 text-right">
                          <span
                            style={{ fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif' }}
                            className="text-[24px] font-bold text-content"
                          >
                            {plan.mileage}
                          </span>
                          <span className="text-[11px] text-content-faint"> mp</span>
                        </div>
                        <div className="w-[92px] shrink-0 text-right">
                          <div
                            style={{
                              color: lv.color,
                              fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif',
                            }}
                            className="text-[24px] font-bold leading-none"
                          >
                            {Math.round(p * 100)}%
                          </div>
                          <div className="mt-1 inline-flex items-center gap-1">
                            <span aria-hidden="true" className="inline-block h-[7px] w-[7px]" style={{ background: lv.color }} />
                            <span className="text-[11px] font-semibold" style={{ color: lv.color }}>
                              {lv.label}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 w-full bg-surface-border">
                        <div className="h-1.5" style={{ width: `${p * 100}%`, background: lv.color }} />
                      </div>

                      {/* 컷 안내 칩 — 누르면 그 값으로 배점된다 */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <span className="text-[11px] font-semibold text-content-faint">
                          {ko ? '기준 배점' : 'Reference'}
                        </span>
                        {chips.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => setMileage(plan.id, c.value)}
                            aria-pressed={plan.mileage === c.value}
                            aria-label={
                              ko
                                ? `${section.name} ${c.label} ${c.value}mp 로 배점`
                                : `Set ${c.value}mp (${c.label}) for ${section.name}`
                            }
                            className={cn(
                              'min-h-[30px] border px-2 text-[11px] font-semibold tabular-nums transition-colors',
                              plan.mileage === c.value
                                ? 'border-yonsei-navy bg-yonsei-navy text-white'
                                : 'border-surface-border bg-surface text-content-soft hover:border-yonsei-blue hover:text-yonsei-blue',
                            )}
                          >
                            {c.label} {c.value}mp
                          </button>
                        ))}
                      </div>

                      {/* 상세 — 기본 통계 / 정원·규정 / 과거 이력 (열 때만 1MB 상세 데이터를 받는다) */}
                      <button
                        type="button"
                        onClick={() => setOpenDetail((v) => (v === plan.id ? null : plan.id))}
                        aria-expanded={openDetail === plan.id}
                        className="mt-2.5 flex min-h-[36px] w-full items-center justify-between text-left text-[11.5px] font-semibold text-content-faint hover:text-yonsei-blue"
                      >
                        {ko ? '정원 · 규정 · 과거 이력 보기' : 'Quotas, rules & history'}
                        <span aria-hidden="true">{openDetail === plan.id ? '−' : '+'}</span>
                      </button>
                      {openDetail === plan.id && (
                        <SectionDetailPanel section={section} grade={grade} ko={ko} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {rows.length > 0 && (
              <>
                {/* 실전 조언 — 담은 과목이 6개 미만이면 알린다.
                    전공 과목은 상한(18·12)이 낮아 "모두가 상한을 걸어" 상한이 곧 컷이 되는 일이
                    잦은데, 그때 승부는 마일리지가 아니라 신청 과목 수에서 갈린다. */}
                {rows.length < 6 && (
                  <div
                    className="mt-4 border-l-2 bg-surface-soft px-3.5 py-3"
                    style={{ borderColor: WARN_AMBER }}
                  >
                    <p className="text-[12.5px] font-bold" style={{ color: WARN_AMBER }}>
                      {ko ? `신청 과목이 ${rows.length}개입니다 — 6개를 채우세요` : `Only ${rows.length} courses — fill all 6`}
                    </p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-content-soft">
                      {ko
                        ? '전공 과목은 상한(18·12mp)이 낮아 모두가 상한을 걸면 상한이 곧 컷이 됩니다. 이때는 마일리지가 아니라 신청 과목 수로 순위가 갈리므로, 실제로 4과목만 들을 계획이어도 6과목을 채워 두는 편이 유리합니다.'
                        : 'When everyone bids the cap, the tie is broken by how many courses you applied to — fill all 6 even if you plan to take fewer.'}
                    </p>
                  </div>
                )}
                <p className="mt-4 text-[12px] leading-relaxed text-content-faint">
                  {ko
                    ? '슬라이더를 움직이면 확률과 예산 바가 즉시 반응합니다 · 자동 배분 후에도 언제든 다시 조정할 수 있어요.'
                    : 'Move a slider and everything updates instantly.'}
                </p>
              </>
            )}
          </section>

          {/* ─────────── 우: 리스크 ─────────── */}
          <section aria-label={ko ? '리스크' : 'Risk'} className="min-w-0">
            <SectionLabel>{ko ? '리스크' : 'Risk'}</SectionLabel>

            <div className="mt-3 border border-surface-border px-3.5 py-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11.5px] font-semibold text-content-faint">
                  {ko ? `목표 ${target}학점 이상 확보 확률` : `P(≥ ${target} credits)`}
                </span>
              </div>
              <p
                style={{ fontFamily: 'var(--font-subhead), var(--font-sans), sans-serif' }}
                className="mt-1 text-[38px] font-bold leading-none text-yonsei-navy"
              >
                {Math.round(pTarget * 100)}%
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-content-faint">
                  {ko ? '목표 학점' : 'Target'}
                </span>
                {[6, 9, 12, 15].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTarget(t)}
                    aria-pressed={target === t}
                    className={cn(
                      'min-h-[32px] border px-2 text-[11.5px] font-semibold',
                      target === t
                        ? 'border-yonsei-navy bg-yonsei-navy text-white'
                        : 'border-surface-border bg-surface text-content-faint',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <p className="mt-2.5 text-[11px] text-content-faint">
                {ko
                  ? `기대 확보 ${dist.expected.toFixed(1)}학점 · 가장 그럴듯한 결과 ${dist.mode}학점`
                  : `Expected ${dist.expected.toFixed(1)} · most likely ${dist.mode}`}
              </p>
              {/* 목표가 담은 과목 총 학점을 넘으면 0%가 당연한데, 안내가 없으면 오해를 부른다 */}
              {rows.length > 0 && target > dist.totalCredits && (
                <p className="mt-1.5 text-[11px] font-semibold" style={{ color: WARN_AMBER }}>
                  {ko
                    ? `담은 과목이 총 ${dist.totalCredits}학점이라 목표 ${target}학점에는 도달할 수 없습니다. 과목을 더 담아 보세요.`
                    : `Only ${dist.totalCredits} credits added — the ${target}-credit target is unreachable.`}
                </p>
              )}
            </div>

            {/* 확보 학점 분포 */}
            {bars.length > 0 && (
              <div className="mt-4 border border-surface-border px-3.5 py-4">
                <p className="text-[11.5px] font-semibold text-content-faint">
                  {ko ? '확보 학점 분포' : 'Credit distribution'}
                </p>
                {/* li 에 h-full 을 주어야 자식 막대의 height:% 가 해소된다
                    (부모 높이가 확정되지 않으면 백분율 높이가 0으로 접힌다) */}
                <ul className="mt-3 flex h-[110px] gap-[3px]">
                  {bars.map((b) => {
                    const peak = Math.max(...bars.map((x) => x.p));
                    return (
                      <li
                        key={b.credits}
                        className="flex h-full min-w-0 flex-1 flex-col justify-end"
                        title={`${b.credits}${ko ? '학점' : ' cr'} ${Math.round(b.p * 100)}%`}
                      >
                        <div
                          style={{
                            height: `${Math.max(3, (b.p / (peak || 1)) * 88)}%`,
                            background: b.meetsTarget ? '#003377' : '#C9D4E2',
                          }}
                        />
                        <span className="mt-1 block truncate text-center text-[9.5px] text-content-faint">
                          {b.credits}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1.5 text-[10.5px] text-content-faint">
                  {ko ? '진한 막대 = 목표 이상' : 'Dark = meets target'}
                </p>
              </div>
            )}

            {/* 자동 배분 + 프론티어 */}
            <button
              type="button"
              onClick={autoAllocate}
              disabled={rows.length === 0}
              className="mt-4 min-h-[48px] w-full bg-yonsei-navy px-4 text-[14px] font-bold text-white transition-colors hover:bg-yonsei-blue disabled:bg-surface-border disabled:text-content-faint"
            >
              {ko ? '예산 자동 배분' : 'Auto-allocate budget'}
            </button>

            {frontier.length > 1 && (
              <div className="mt-4 border border-surface-border px-3.5 py-4">
                {/* "효율적 프론티어"는 경제학 용어라 학생에게 읽히지 않는다 — 평범한 질문으로 */}
                <p className="text-[12.5px] font-bold text-content">
                  {ko ? '마일리지를 더 걸면 이득일까?' : 'Is spending more worth it?'}
                </p>
                <BudgetCurve points={frontier} budget={budget} used={used} ko={ko} />
              </div>
            )}
          </section>
        </div>
      )}

      {/* 한계·유의사항 — 위의 경고 박스가 태도(의존 금지)를 말한다면, 여기는 모델이
          무엇을 모르는지 구체적으로 나열한다. */}
      <div className="mt-10 max-w-2xl border-t border-surface-border pt-5 text-xs leading-relaxed text-content-faint">
        <p className="font-bold text-content-soft">{ko ? '유의사항 및 한계' : 'Limitations'}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            {ko
              ? '예측 컷은 과거 학기 수강신청 기록을 통계적으로 축소 추정한 값이며, 최근 학기에 더 큰 가중치를 둡니다. 기록이 적은 분반일수록 오차가 큽니다.'
              : 'Predicted cutoffs are shrinkage estimates from past registration records, weighted toward recent semesters. Sections with little history have larger errors.'}
          </li>
          <li>
            {ko
              ? '우선·예외 배정(비고 * 표시)은 컷 계산에서 제외했습니다. 본인이 그 대상인지는 직접 확인해야 합니다.'
              : 'Priority and exceptional placements (marked * in remarks) are excluded from cutoffs. Check for yourself whether you qualify.'}
          </li>
          <li>
            {ko
              ? '신설·폐강·분반 통합·교수 교체가 있으면 과거 기록이 다른 분반으로 이어질 수 있어 예측이 어긋납니다.'
              : 'New, cancelled, or merged sections and instructor changes can attach history to the wrong section and break the prediction.'}
          </li>
          <li>
            {ko
              ? '확률은 각 과목의 합격을 독립 사건으로 가정해 계산합니다. 실제로는 같은 시간대·같은 학년의 수요가 함께 움직여 더 나쁠 수 있습니다.'
              : 'Probabilities assume each course’s admission is independent. In reality, demand in the same time slot or cohort moves together and outcomes can be worse.'}
          </li>
          <li>
            {ko
              ? '학기 예산·목표 학점·시간표 충돌은 입력값을 그대로 믿습니다. 마일리지 잔여량과 규정 상한은 연세포털에서 확인하세요.'
              : 'Budget, target credits, and time conflicts are taken as entered. Check your remaining mileage and the rule limits on the Yonsei portal.'}
          </li>
          <li>
            {ko
              ? '데이터는 학기마다 수동으로 갱신되므로 최신 개설 내역·학사 규정과 다를 수 있습니다.'
              : 'Data is updated by hand each semester and may lag behind current offerings and regulations.'}
          </li>
        </ul>
        <p className="mt-3 font-semibold text-content-soft">
          {ko
            ? '※ 수강신청 마일리지 규정과 배정 결과는 반드시 연세포털과 학과사무실에서 확인하세요. 이 도구의 오류로 인한 불이익에 대해 제작자는 책임지지 않습니다.'
            : '※ Always confirm mileage rules and placement results on the Yonsei portal and with the department office. The authors accept no liability for consequences arising from errors in this tool.'}
        </p>
      </div>
    </div>
  );
}

/** 섹션 라벨 — 사이트 공통 네이비 사각 라벨 + 헤어라인.
 *  Pretendard(--font-sans) + font-bold 로, GraduationChecker·EventCalendar 등의
 *  라벨과 같은 글자체다. --font-subhead(Paperlogy)를 덧씌우지 말 것 — 이 탭만
 *  글자체가 달라 보인다. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="inline-block shrink-0 bg-yonsei-navy px-3.5 py-1.5 text-sm font-bold text-white">
        {children}
      </h3>
      <span aria-hidden="true" className="h-px flex-1 bg-surface-border" />
    </div>
  );
}


/**
 * 상태 배지 — 과목명 옆에 붙는 소형 라벨(만점 동점전 · 작년 미달).
 *
 * 경고 배지(WarnBadge)와 달리 아이콘이 없다. 제목 줄에 끼어드는 요소라 조용해야 하고,
 * 이 둘은 "잘못됐다"가 아니라 "이 분반은 성격이 다르다"는 정보이기 때문이다.
 * 보조문구는 카드 본문에도 나오지만 `title` 로 한 번 더 달아 둔다.
 */
function StateBadge({
  color,
  note,
  children,
}: {
  color: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={note}
      className="ml-1.5 inline-block border bg-surface px-[5px] py-px align-middle text-[10px] font-bold"
      style={{ borderColor: color, color }}
    >
      {children}
    </span>
  );
}

/** 경고 배지 — 시간 충돌(빨강)과 데이터 부족(노랑)이 같은 형태를 공유한다 */
function WarnBadge({
  color,
  icon,
  children,
}: {
  color: string;
  icon: 'calendar' | 'alert';
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-[5px] border bg-surface px-[9px] py-1 text-[11px] font-semibold"
      style={{ borderColor: color, color }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        aria-hidden="true"
      >
        {icon === 'calendar' ? (
          <>
            <rect x="4" y="5" width="16" height="16" />
            <path d="M4 10h16M9 3v4M15 3v4" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M12 3 2 20h20L12 3z" strokeLinejoin="round" />
            <path d="M12 9v5M12 17.5v.5" strokeLinecap="round" />
          </>
        )}
      </svg>
      {children}
    </span>
  );
}

/**
 * 단조 3차 에르미트 보간(Fritsch–Carlson)으로 부드러운 SVG path 를 만든다.
 *
 * 왜 일반 스플라인(Catmull–Rom 등)을 쓰지 않는가: 예산-성과 곡선은 정의상 단조 증가다
 * (예산을 더 줘서 기대 학점이 줄 수는 없다). 일반 스플라인은 구간에 따라 오버슛이 생겨
 * 곡선이 잠깐 내려갔다 올라오는데, 그러면 "예산을 늘렸더니 손해"라는 없는 사실을 그리게 된다.
 * Fritsch–Carlson 은 접선 크기를 제한해 오버슛을 원천 차단하므로 부드러우면서도 거짓말하지 않는다.
 */
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  if (n === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;

  // 구간 기울기
  const dx: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1].x - pts[i].x;
    dx.push(h);
    delta.push(h === 0 ? 0 : (pts[i + 1].y - pts[i].y) / h);
  }

  // 초기 접선 = 인접 구간 기울기의 평균
  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (delta[i - 1] + delta[i]) / 2;

  // Fritsch–Carlson 제한 — 평평한 구간은 접선을 0으로 눕히고, 나머지는 반지름 3 안으로 축소
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * delta[i];
      m[i + 1] = t * b * delta[i];
    }
  }

  // 에르미트 접선을 3차 베지에 제어점으로 변환
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    const c1x = pts[i].x + h;
    const c1y = pts[i].y + m[i] * h;
    const c2x = pts[i + 1].x - h;
    const c2y = pts[i + 1].y - m[i + 1] * h;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

/**
 * 분반 상세 — 기본 통계 / 정원·규정 / 과거 이력 (사용자 지시 4).
 * 상세 데이터(1MB)는 이 패널을 처음 열 때만 받는다.
 *
 * `grade` 는 화면 상단에서 고른 내 학년이다. 학년 정원이 걸린 과목은 학년마다 자리를 따로
 * 채우므로 컷이 크게 다르다 — 과거 이력도 전 학년 평균이 아니라 **내 학년 기준**으로 읽는다.
 */
function SectionDetailPanel({
  section,
  grade,
  ko,
}: {
  section: Section;
  grade: number;
  ko: boolean;
}) {
  const [detail, setDetail] = useState<SectionDetail | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    let alive = true;
    setState('loading');
    fetchDetails()
      .then((all) => {
        if (!alive) return;
        setDetail(all[section.id] ?? null);
        setState('idle');
      })
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
    };
  }, [section.id]);

  if (state === 'loading') {
    return <p className="mt-2 text-[11.5px] text-content-faint">{ko ? '불러오는 중…' : 'Loading…'}</p>;
  }
  if (state === 'error') {
    return <p className="mt-2 text-[11.5px] text-content-faint">{ko ? '상세를 불러오지 못했습니다.' : 'Failed to load.'}</p>;
  }
  if (!detail) {
    return <p className="mt-2 text-[11.5px] text-content-faint">{ko ? '이 분반의 과거 자료가 없습니다.' : 'No records.'}</p>;
  }

  const { stats, rules, perGrade, tieCredit } = detail;
  // 학년별 컷·승부선은 ①기본 통계와 다른 학기에서 올 수 있다(라인업 일치 오버라이드)
  const basis = tieBasisText(detail.tieBasis ?? null, ko);
  const profHist = detail.professorHistory ?? [];
  /** 각 행을 내 학년 기준으로 한 번만 읽어 둔다 — 표와 각주가 같은 판정을 써야 한다 */
  const histRows = profHist.map((row) => [row, gradeRowView(row, grade)] as const);
  /** 한 학기라도 학년 기준으로 읽혔는가 — 각주가 "N학년 기준"이라 말해도 되는 조건 */
  const anyScoped = histRows.some(([, v]) => v.scoped);
  /**
   * 컷의 모집단 — 우리 사용자는 기계공학부 학생이라 MEU 과목에서는 전공자, 그 밖에서는
   * 비전공자다. 전공자석·비전공자석은 따로 채워지므로 모집단을 밝히지 않은 컷은 어느 쪽의
   * 컷도 아니다(precompute 의 청중 그룹 컷과 같은 기준).
   */
  const audience = section.code.startsWith('MEU')
    ? ko
      ? '전공자'
      : 'majors'
    : ko
      ? '비전공자(기계공학부 학생)'
      : 'non-majors (i.e. ME students)';
  const majorN = majorQuotaCount(rules.majorQuota);
  /** 학년별 정원에 다른 그룹의 자리가 섞여 있는가 — 전공자 정원 < 전체 정원이면 그렇다 */
  const mixedYearSeats =
    majorN !== null && stats?.capacity != null && majorN > 0 && majorN < stats.capacity;
  const rate =
    stats?.applicants && stats?.capacity ? (stats.applicants / stats.capacity).toFixed(2) : null;

  return (
    <div className="mt-3 space-y-3 border-t border-surface-border pt-3">
      {/* ① 기본 통계 */}
      <div>
        <DetailHead>{ko ? '기본 통계' : 'Statistics'}</DetailHead>
        {stats ? (
          <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] sm:grid-cols-4">
            <Stat label={ko ? '정원' : 'Cap.'} value={stats.capacity} />
            <Stat label={ko ? '신청' : 'Applied'} value={stats.applicants} />
            <Stat label={ko ? '경쟁률' : 'Ratio'} value={rate ? `${rate}:1` : null} />
            <Stat label={ko ? '평균 배점' : 'Avg'} value={stats.avg} />
            <Stat label={ko ? '최고 배점' : 'Max bid'} value={stats.max} />
            <Stat label={ko ? '기준 학기' : 'Term'} value={formatTerm(stats.semester, ko)} />
          </dl>
        ) : (
          <p className="mt-1 text-[11px] text-content-faint">{ko ? '자료 없음' : 'No data'}</p>
        )}
      </div>

      {/* ② 정원 & 규정 */}
      <div>
        <DetailHead>{ko ? '정원 & 규정' : 'Quotas & rules'}</DetailHead>
        <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] sm:grid-cols-4">
          <Stat label={ko ? '배점 상한' : 'Max mileage'} value={rules.maxAllowed ? `${rules.maxAllowed}mp` : null} />
          <Stat label={ko ? '전공자 정원' : 'Major seats'} value={majorN !== null ? (majorN > 0 ? `${majorN}석` : ko ? '없음' : 'none') : null} />
        </dl>
        {rules.yearQuotas ? (
          <div className="mt-2">
            <p className="text-[11px] font-semibold text-content-faint">
              {ko ? '학년별 정원' : 'Seats by year'}
            </p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {['1', '2', '3', '4'].map((g) => {
                const seats = rules.yearQuotas?.[g] ?? 0;
                const pg = perGrade?.[g];
                return (
                  <li
                    key={g}
                    className={cn(
                      'border px-2 py-1 text-[11px]',
                      seats > 0 ? 'border-surface-border bg-surface' : 'border-surface-border bg-surface-soft text-content-faint',
                    )}
                  >
                    <b className="font-bold">{g}{ko ? '학년' : 'Y'}</b>{' '}
                    {seats > 0 ? `${seats}${ko ? '석' : ''}` : ko ? '배정 없음' : '—'}
                    {pg &&
                      (pg.cut === null ? (
                        <span className="ml-1" style={{ color: WARN_RED }}>
                          · {ko ? '합격 0명' : 'none admitted'}
                        </span>
                      ) : (
                        <span className="ml-1 text-yonsei-blue">
                          · {ko ? '컷' : 'cut'} {pg.cut}mp
                        </span>
                      ))}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-content-faint">
              {ko
                ? '학년별로 정원을 따로 채우므로 같은 분반이어도 학년마다 컷이 다릅니다.'
                : 'Seats fill per year, so the cutoff differs by year.'}
              {/* 학년별 정원은 원장에 전공자·비전공자 구분 없이 한 수로만 나온다. 컷은
                  청중 그룹만 세므로, 두 수의 모집단이 다르다는 사실을 밝혀야 한다. */}
              {mixedYearSeats &&
                (ko
                  ? ` 학년별 정원은 전공자·비전공자를 합한 자리 수이고, 컷은 ${audience}만 센 수입니다.`
                  : ` Per-year seats include both majors and non-majors; the cut counts ${audience} only.`)}
              {/* 학년별 컷이 ①의 기준 학기와 다른 학기에서 왔으면 반드시 밝힌다 */}
              {basis && (ko ? ` 학년별 컷은 ${basis.full} 기준입니다.` : ` Per-year cuts are from ${basis.full}.`)}
            </p>
          </div>
        ) : (
          <p className="mt-1.5 text-[11px] text-content-faint">
            {ko ? '학년 제한 없음 — 전 학년이 같은 정원에서 경쟁합니다.' : 'No per-year quota.'}
          </p>
        )}
        {tieCredit && (
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-content-faint">
            {ko
              ? `동점(컷과 같은 배점)에서 갈린 총이수학점 비율: 합격 최저 ${(tieCredit.winMin * 100).toFixed(0)}%`
              : `Tie broken at earned-credit ratio ≥ ${(tieCredit.winMin * 100).toFixed(0)}%`}
            {tieCredit.loseMax !== null &&
              (ko
                ? ` · 탈락 최고 ${(tieCredit.loseMax * 100).toFixed(0)}%`
                : ` (lost up to ${(tieCredit.loseMax * 100).toFixed(0)}%)`)}
            {basis && (ko ? ` · ${basis.full} 기준` : ` · from ${basis.full}`)}
          </p>
        )}
      </div>

      {/* ③ 과거 이력 — 학생은 분반 번호가 아니라 담당 교수를 보고 고르므로,
             "이 교수의 이 과목 이력"이 주가 된다(예측 모델이 쓰는 자료와도 일치).
             수치는 ②와 같은 이유로 **내 학년 기준**이다(학년마다 자리를 따로 채운다). */}
      <div>
        <DetailHead>
          {ko
            ? `과거 이력 · ${section.professor || '담당 미정'} · ${grade}학년 기준`
            : `History · ${section.professor || 'TBA'} · Year ${grade}`}
        </DetailHead>
        {profHist.length > 0 ? (
          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full min-w-[300px] border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-t border-surface-border text-content-faint">
                  <th scope="col" className="py-1 text-left font-semibold">{ko ? '학기' : 'Term'}</th>
                  <th scope="col" className="py-1 text-left font-semibold">{ko ? '분반' : 'Sec.'}</th>
                  <th scope="col" className="py-1 text-right font-semibold">{ko ? '컷' : 'Cut'}</th>
                  <th scope="col" className="py-1 text-right font-semibold">{ko ? '신청' : 'Applied'}</th>
                  <th scope="col" className="py-1 text-right font-semibold">{ko ? '합격' : 'Admitted'}</th>
                </tr>
              </thead>
              <tbody>
                {histRows.map(([row, v], i) => {
                  const [term, div] = row;
                  return (
                    <tr key={`${term}-${div}`} className="border-b border-surface-border">
                      <td className="py-1">
                        {formatTerm(term, ko)}
                        {i === 0 && (
                          <span className="ml-1 bg-yonsei-navy px-1 py-px text-[9px] font-bold text-white">
                            {ko ? '최신' : 'latest'}
                          </span>
                        )}
                      </td>
                      <td className="py-1">
                        {div}
                        {ko ? '분반' : ''}
                        {div !== section.division && (
                          <span className="ml-1 text-[9.5px] text-content-faint">
                            {ko ? '(당시)' : '(then)'}
                          </span>
                        )}
                      </td>
                      {/* 컷 — 내 학년 자리가 따로 있던 학기는 그 학년 컷, 아니면 전체 컷('전체' 표시) */}
                      <td className="py-1 text-right tabular-nums">
                        {v.absent ? (
                          <span className="text-content-faint">{ko ? '배정 없음' : 'no seats'}</span>
                        ) : v.cut === null ? (
                          <b className="font-bold" style={{ color: WARN_RED }}>
                            {ko ? '없음' : 'none'}
                          </b>
                        ) : (
                          <>
                            <b className="font-bold text-content">{v.cut}mp</b>
                            {!v.scoped && (
                              <span className="ml-1 text-[9.5px] font-normal text-content-faint">
                                {ko ? '(전체)' : '(all)'}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      {/* 신청·합격은 컷과 같은 모집단(내 학년 · 전공자/비전공자)이다.
                          분반 전체 정원·신청자를 싣던 자리인데, 그 수에는 비전공자 자리가
                          섞여 있어 전공자 컷과 다른 모집단을 말하게 됐다(사용자 지시). */}
                      <td className="py-1 text-right tabular-nums text-content-faint">
                        {v.applied ?? '—'}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {v.won === null ? (
                          <span className="text-content-faint">—</span>
                        ) : v.won === 0 && (v.applied ?? 0) > 0 ? (
                          // 지원했는데 한 명도 못 붙은 학기 — 컷만 봐서는 놓치는 사실이다
                          <b className="font-bold" style={{ color: WARN_RED }}>
                            0
                          </b>
                        ) : (
                          <span className="text-content-faint">{v.won}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {profHist.some(([, d]) => d !== section.division) && (
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-content-faint">
                {ko
                  ? '분반을 옮긴 학기도 함께 봅니다 — 담당 교수가 같으면 경쟁 양상이 이어지는 편입니다.'
                  : 'Terms in other sections are included — the same professor tends to draw similar demand.'}
              </p>
            )}
            {/* 수치의 모집단을 밝힌다 — 학년석·전공자석·비전공자석은 각각 따로 채워지므로
                모집단을 말하지 않은 컷은 어느 쪽의 컷도 아니다. 기계공학부 학생 기준이라
                MEU 과목은 전공자, 그 밖은 비전공자 기준을 싣는다(비전공자 자리는 뺀다). */}
            <p className="mt-1 text-[10.5px] leading-relaxed text-content-faint">
              {ko
                ? `컷·신청·합격은 ${grade}학년 · ${audience}만 센 수입니다 — 학년과 전공 여부로 자리를 따로 채우므로 섞으면 어느 쪽의 컷도 아니게 됩니다.`
                : `Cut, applicants and admits count only year ${grade} · ${audience} — seats are filled separately per year and per major status, so mixing them yields neither group's cut.`}
              {/* 학년 기준으로 읽은 컷이 하나도 없으면 "학년별 컷"이라 말해선 안 된다 */}
              {histRows.some(([, v]) => !v.scoped && !v.absent) &&
                (anyScoped
                  ? ko
                    ? " '(전체)' 학기는 학년별 정원이 없어 전 학년이 같은 정원에서 겨뤘으므로 컷만 전 학년 공통입니다."
                    : " In terms marked '(all)' there was no per-year quota, so the cut is the one shared by every year."
                  : ko
                    ? ' 이 분반은 학년별 정원이 없어 전 학년이 같은 정원에서 겨뤘으므로 컷은 전 학년 공통입니다.'
                    : ' This section has no per-year quota, so the cut is shared by every year.')}
            </p>
          </div>
        ) : (
          <p className="mt-1.5 text-[11.5px] leading-relaxed" style={{ color: WARN_AMBER }}>
            {ko
              ? `${section.professor || '이 교수'}는 이 과목을 처음 맡습니다 — 과거 기록이 없어 같은 과목의 평균으로 추정했습니다.`
              : `First time teaching this course — estimated from the course average.`}
          </p>
        )}
      </div>

    </div>
  );
}

/** 과거 이력 한 행을 내 학년 기준으로 읽은 결과 */
interface GradeRowView {
  /** 표시할 컷. null = 합격자가 0명이라 컷이 정의되지 않는다 */
  cut: number | null;
  /** 내 학년 신청자(청중 그룹 한정). null = 그 학기 학년 자료가 없다 */
  applied: number | null;
  /** 내 학년 합격자(청중 그룹 한정). null = 그 학기 학년 자료가 없다 */
  won: number | null;
  /** 컷을 학년 기준으로 읽었는가 — false 면 컷만 전 학년 공통으로 되돌린 것이다 */
  scoped: boolean;
  /** 그 학기엔 내 학년에 자리도 지원자도 없었다 */
  absent: boolean;
}

/**
 * 과거 이력 한 행 → **내 학년 기준**.
 *
 * ⚠️ 학년별 정원이 있던 학기만 학년 컷이 뜻을 갖는다. 전 학년이 같은 정원에서 겨룬 학기에
 *    "내 학년 합격자 중 최저 배점"을 컷이라 부르면 실제 컷보다 높은 수를 컷으로 읽게 된다
 *    (그 학년에 낮은 배점으로 붙은 사람이 없었을 뿐이다). 그 학기의 **컷만** 전 학년 공통으로
 *    되돌린다 — 신청·합격은 그래도 내 학년 것이 맞다.
 */
function gradeRowView(
  row: NonNullable<SectionDetail['professorHistory']>[number],
  grade: number,
): GradeRowView {
  const byGrade = row[5];
  const whole: GradeRowView = {
    cut: row[2],
    applied: null,
    won: null,
    scoped: false,
    absent: false,
  };
  if (!byGrade) return whole; // 학년 자료가 없는 학기(구 번들 포함)
  const slice: GradeSlice | undefined = byGrade[String(grade)];
  // 한 학년이라도 제 몫의 자리가 있었으면 그 학기는 학년별로 정원을 채운 학기다
  const perYear = Object.values(byGrade).some((g) => g[1] !== null);
  if (!slice) return { ...whole, applied: 0, won: 0, absent: perYear };
  if (!perYear) return { ...whole, applied: slice[2], won: slice[3] };
  return { cut: slice[0], applied: slice[2], won: slice[3], scoped: true, absent: false };
}

function DetailHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11.5px] font-bold text-content">
      <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-[3px] translate-y-px bg-yonsei-navy" />
      {children}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <dt className="text-content-faint">{label}</dt>
      <dd className="font-semibold tabular-nums text-content">{value ?? '—'}</dd>
    </div>
  );
}

/**
 * 동점 통계(학년별 실적·승부선)의 근거 학기 문구 — 상세의 `tieBasis` 가 있을 때만.
 *
 * 보통 이 통계는 "작년"에서 나오지만, 대상 학기의 교수 구성이 직전 학기가 아니라 더 과거
 * 학기와 같으면 precompute 가 그 학기 원장으로 산출한다(RECENCY_ALIAS). 그때 화면이 계속
 * "작년"이라고 하면 거짓말이 되므로 실제 학기를 말하게 한다.
 *
 *   term  "2024년 2학기"            — 문장 중간에 짧게 끼워 넣을 때
 *   full  "2024년 2학기(동일 라인업)" — 왜 작년이 아닌지까지 밝혀야 할 때
 */
function tieBasisText(basis: string | null, ko: boolean): { term: string; full: string } | null {
  if (!basis) return null;
  const term = formatTerm(basis, ko);
  return { term, full: ko ? `${term}(동일 라인업)` : `${term} (same lineup)` };
}

/** 시간표 칸 색 — 브랜드 블루 계열만 쓴다(금색 금지). 담은 순서대로 순환. */
const SLOT_COLORS = [
  { bg: '#003377', fg: '#FFFFFF' },
  { bg: '#0057A8', fg: '#FFFFFF' },
  { bg: '#2E86D6', fg: '#FFFFFF' },
  { bg: '#5AA0DE', fg: '#FFFFFF' },
  { bg: '#9CC4E9', fg: '#003377' },
  { bg: '#C9DDF2', fg: '#003377' },
];

/**
 * 미니 주간 시간표.
 *
 * 담은 과목의 강의시간(원문 파싱 결과)을 요일×교시 격자에 얹어, 시간이 겹치는 칸을
 * 빨간 테두리로 드러낸다. 충돌 "판정"은 이미 카드의 경고 배지가 하지만, 어디가 어떻게
 * 겹치는지는 격자로 봐야 납득이 된다.
 *
 * 강의시간 표기가 제각각이라 파싱에 실패하는 과목이 있다 — 그런 과목은 조용히 빠뜨리지 않고
 * 아래에 따로 명시한다(빠뜨리면 "내 과목이 시간표에 없다"는 혼란이 생긴다).
 */
/** 시간표 칸 툴팁 — 과목명 · 교수 · 강의실을 한 줄로(없는 항목은 건너뛴다) */
function describeSlot(s: Section): string {
  return [s.name, s.professor, s.room].filter(Boolean).join(' · ');
}

/**
 * 칸(요일:교시) → 그 시간의 강의실.
 *
 * 강의실 원문은 시간대별 값을 슬래시로 이어 붙인 형태다(예: 시간 "화1,2/목8",
 * 강의실 "동영상(중복수강불가)/공B040"). 전체 문자열을 모든 칸에 그대로 쓰면 좁은
 * 칸이 넘칠뿐더러 **그 시간에 가지 않는 강의실까지 보여 주게 된다.**
 *
 * 시간 그룹 수와 강의실 수가 같을 때만 순서대로 짝지어 칸별 강의실을 잡는다.
 * 표기가 어긋나면(괄호형 등) 짝짓기를 포기하고, 강의실이 하나뿐일 때만 전 칸에
 * 같은 값을 쓴다. 어느 경우든 전체 원문은 툴팁(describeSlot)이 그대로 보여 준다.
 */
function roomByCell(s: Section): Map<string, string> {
  const map = new Map<string, string>();
  const room = (s.room ?? '').trim();
  if (!room) return map;
  const groups = s.timeText.split('/');
  const rooms = room.split('/').map((x) => x.trim());
  if (groups.length > 1 && groups.length === rooms.length) {
    groups.forEach((g, i) => {
      if (!rooms[i]) return;
      for (const sl of parseTimeSlots(g)) map.set(`${sl.day}:${sl.period}`, rooms[i]);
    });
    return map;
  }
  if (rooms.length === 1) for (const sl of s.slots) map.set(`${sl.day}:${sl.period}`, room);
  return map;
}

function MiniTimetable({
  rows,
  ko,
}: {
  rows: { plan: Planned; section: Section }[];
  ko: boolean;
}) {
  const DAY_LABELS = ko ? ['월', '화', '수', '목', '금'] : ['M', 'T', 'W', 'T', 'F'];
  const withSlots = rows.filter((r) => r.section.slots.length > 0);
  const noSlots = rows.filter((r) => r.section.slots.length === 0);

  if (rows.length === 0) return null;

  // 실제 쓰이는 교시 범위만 그린다(1~9 를 통째로 그리면 대부분 빈칸이라 읽기 나쁘다)
  const periods = withSlots.flatMap((r) => r.section.slots.map((s) => s.period));
  const minP = periods.length ? Math.min(...periods) : 1;
  const maxP = periods.length ? Math.max(...periods) : 6;

  /** 과목별 (칸 → 강의실) — 시간대마다 강의실이 다른 과목을 칸별로 정확히 표시한다 */
  const roomMaps = withSlots.map((r) => roomByCell(r.section));

  /** cell[day][period] = 그 칸을 점유한 과목 인덱스들 */
  const cell = new Map<string, number[]>();
  withSlots.forEach((r, i) => {
    for (const s of r.section.slots) {
      if (s.day > 4) continue; // 주말은 격자에서 생략(드물고 폭만 먹는다)
      const k = `${s.day}:${s.period}`;
      const cur = cell.get(k);
      if (cur) cur.push(i);
      else cell.set(k, [i]);
    }
  });

  return (
    <div className="mt-3">
      <div className="grid grid-cols-[18px_repeat(5,minmax(0,1fr))] gap-px border border-surface-border bg-surface-border">
        {/* 헤더 */}
        <div className="bg-surface" />
        {DAY_LABELS.map((d, i) => (
          <div key={i} className="bg-surface py-1 text-center text-[10px] font-bold text-content-faint">
            {d}
          </div>
        ))}
        {/* 교시 행 */}
        {Array.from({ length: maxP - minP + 1 }, (_, r) => minP + r).map((p) => (
          <Fragment key={p}>
            <div className="grid place-items-center bg-surface text-[9px] tabular-nums text-content-faint">
              {p}
            </div>
            {[0, 1, 2, 3, 4].map((d) => {
              const owners = cell.get(`${d}:${p}`) ?? [];
              const clash = owners.length > 1;
              const first = owners[0];
              const tone = first === undefined ? null : SLOT_COLORS[first % SLOT_COLORS.length];
              return (
                <div
                  key={d}
                  title={owners.map((i) => describeSlot(withSlots[i].section)).join(' / ')}
                  // 한 칸 높이 19→49px(사용자 지시). 높아진 만큼 이름을 잘라내지 않고
                  // 줄바꿈해 보여 준다(break-keep 으로 단어 중간 끊김 방지).
                  className="min-h-[49px] overflow-hidden break-keep px-[3px] py-[3px] text-[9px] font-semibold leading-tight"
                  style={
                    tone
                      ? {
                          background: clash ? '#FDECEC' : tone.bg,
                          color: clash ? WARN_RED : tone.fg,
                          boxShadow: clash ? `inset 0 0 0 1.5px ${WARN_RED}` : undefined,
                        }
                      : { background: '#FFFFFF' }
                  }
                >
                  {/* 충돌 칸은 어느 과목의 정보를 보여도 거짓이 되므로 '!' 만 두고
                      상세는 title 툴팁으로 넘긴다. 교수·강의실은 과목명보다 한 단
                      작고 흐리게 — 칸의 주인공은 과목명이다. */}
                  {clash ? (
                    '!'
                  ) : (
                    <>
                      <span className="block">{withSlots[first]?.section.name ?? ''}</span>
                      {withSlots[first]?.section.professor && (
                        <span className="mt-[2px] block text-[8px] font-medium opacity-75">
                          {withSlots[first].section.professor}
                        </span>
                      )}
                      {roomMaps[first]?.get(`${d}:${p}`) && (
                        <span className="block text-[8px] font-medium opacity-75">
                          {roomMaps[first].get(`${d}:${p}`)}
                        </span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      {noSlots.length > 0 && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed" style={{ color: WARN_AMBER }}>
          {ko
            ? `시간 정보를 읽지 못한 과목: ${noSlots.map((r) => r.section.name).join(', ')} — 시간표에 표시되지 않으니 직접 확인하세요.`
            : `Time not parsed: ${noSlots.map((r) => r.section.name).join(', ')}`}
        </p>
      )}
    </div>
  );
}

/**
 * 예산-성과 곡선.
 *
 * 원래 "효율적 프론티어"라는 경제학 용어로 축도 없이 선만 그렸더니, 무엇을 보는 그래프인지
 * 읽히지 않고 끝점이 테두리에 잘렸다. 그래서 ① 이름을 평범한 말로 바꾸고 ② 양축에 눈금과
 * 단위를 달고 ③ 선·점이 잘리지 않도록 안쪽 여백을 두고 ④ 이 곡선의 진짜 메시지인
 * "어느 지점부터는 더 걸어도 거의 늘지 않는다"를 문장으로 뽑아 준다.
 */
function BudgetCurve({
  points,
  budget,
  used,
  ko,
}: {
  points: { budget: number; expected: number }[];
  budget: number;
  used: number;
  ko: boolean;
}) {
  const W = 268;
  const H = 132;
  // 눈금 글자와 점 반지름이 잘리지 않도록 안쪽 여백을 확보한다
  const PAD = { l: 30, r: 12, t: 12, b: 24 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const maxY = Math.max(1, ...points.map((p) => p.expected));
  const x = (b: number) => PAD.l + (b / Math.max(1, budget)) * innerW;
  const y = (e: number) => PAD.t + innerH - (e / maxY) * innerH;

  // 꺾인 폴리라인 대신 단조 3차 보간 — 부드럽되 오버슛(예산↑인데 학점↓)은 생기지 않는다
  const path = monotonePath(points.map((p) => ({ x: x(p.budget), y: y(p.expected) })));
  const cur = points.reduce(
    (a, p) => (Math.abs(p.budget - used) < Math.abs(a.budget - used) ? p : a),
    points[0],
  );
  // 최대치의 95% 에 처음 도달하는 예산 = 사실상 포화 지점
  const sat = points.find((p) => p.expected >= maxY * 0.95);

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 w-full"
        role="img"
        aria-label={
          ko
            ? `가로축 마일리지 0부터 ${budget}, 세로축 기대 확보 학점 0부터 ${maxY.toFixed(1)}. 현재 ${used}mp에서 ${cur.expected.toFixed(1)}학점.`
            : `Budget 0–${budget}mp vs expected credits 0–${maxY.toFixed(1)}. Now ${cur.expected.toFixed(1)} at ${used}mp.`
        }
      >
        {/* 축 */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + innerH} stroke="#E0E6ED" strokeWidth="1" />
        <line
          x1={PAD.l}
          y1={PAD.t + innerH}
          x2={PAD.l + innerW}
          y2={PAD.t + innerH}
          stroke="#E0E6ED"
          strokeWidth="1"
        />
        {/* 세로 눈금 — 0 / 최대 */}
        <text x={PAD.l - 5} y={PAD.t + innerH + 3} textAnchor="end" fontSize="8.5" fill="#6E6E6E">
          0
        </text>
        <text x={PAD.l - 5} y={PAD.t + 4} textAnchor="end" fontSize="8.5" fill="#6E6E6E">
          {maxY.toFixed(1)}
        </text>
        {/* 가로 눈금 — 0 / 예산 */}
        <text x={PAD.l} y={H - 4} textAnchor="middle" fontSize="8.5" fill="#6E6E6E">
          0
        </text>
        <text x={PAD.l + innerW} y={H - 4} textAnchor="middle" fontSize="8.5" fill="#6E6E6E">
          {budget}mp
        </text>
        {/* 포화 지점 안내선 */}
        {sat && sat.budget > 0 && sat.budget < budget && (
          <line
            x1={x(sat.budget)}
            y1={PAD.t}
            x2={x(sat.budget)}
            y2={PAD.t + innerH}
            stroke="#A16207"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
        {/* 곡선 */}
        <path d={path} fill="none" stroke="#0057A8" strokeWidth="2" strokeLinejoin="round" />
        {/* 현재 위치 */}
        <line
          x1={x(cur.budget)}
          y1={y(cur.expected)}
          x2={x(cur.budget)}
          y2={PAD.t + innerH}
          stroke="#003377"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <circle cx={x(cur.budget)} cy={y(cur.expected)} r="3.5" fill="#003377" />
      </svg>
      {/* 축 설명 — 그래프만 봐서는 무엇인지 모르므로 반드시 글로 남긴다 */}
      <p className="mt-1 text-[10.5px] leading-relaxed text-content-faint">
        {ko
          ? '가로 = 쓰는 마일리지 · 세로 = 기대 확보 학점'
          : 'x = mileage spent · y = expected credits'}
      </p>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-content">
        {ko ? (
          <>
            지금 <b>{used}mp</b>를 걸면 평균 <b>{cur.expected.toFixed(1)}학점</b>을 확보합니다.
          </>
        ) : (
          <>
            At <b>{used}mp</b> you secure about <b>{cur.expected.toFixed(1)}</b> credits.
          </>
        )}
      </p>
      {sat && sat.budget > 0 && sat.budget < budget && (
        <p className="mt-1 text-[11px] leading-relaxed" style={{ color: WARN_AMBER }}>
          {ko
            ? `${sat.budget}mp를 넘기면 더 걸어도 거의 늘지 않습니다.`
            : `Beyond ${sat.budget}mp, extra mileage barely helps.`}
        </p>
      )}
    </>
  );
}
