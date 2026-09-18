'use client';

// 학생 제출 대기 건수 — 사이드바 필·모바일 메뉴 배지·대시보드 카드가 같은 값을 본다.
//
// 세 자리가 각자 조회하면 값이 서로 어긋나고(한쪽만 갱신) 요청도 세 벌 나간다. 그래서
// 모듈 하나가 값을 들고, 승인·반려처럼 건수를 바꾸는 쪽이 refreshThesisSummary() 로
// 다시 읽게 한다. 조회가 실패하면(권한·네트워크) 표시를 숨긴다 — 건수는 편집의
// 전제가 아니라 안내일 뿐이다.
//
//   GET /api/admin/thesis/summary → { count, nearest: { id, date, presenter } | null }

import { useEffect, useSyncExternalStore } from 'react';

export interface ThesisSummary {
  count: number;
  /** 가장 가까운 심사일의 대기 제출 */
  nearest: { id: string; date: string; presenter: string } | null;
}

let snapshot: ThesisSummary | null = null;
let started = false;
let running: Promise<void> | null = null;
let again = false;
const subscribers = new Set<() => void>();

function publish(next: ThesisSummary | null) {
  snapshot = next;
  subscribers.forEach((fn) => fn());
}

function parse(raw: unknown): ThesisSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.count !== 'number' || !Number.isFinite(r.count)) return null;
  const n = r.nearest as Record<string, unknown> | null | undefined;
  const nearest =
    n && typeof n === 'object' && typeof n.date === 'string'
      ? { id: String(n.id ?? ''), date: n.date, presenter: String(n.presenter ?? '') }
      : null;
  return { count: Math.max(0, Math.floor(r.count)), nearest };
}

async function fetchOnce() {
  try {
    const res = await fetch('/api/admin/thesis/summary', { cache: 'no-store' });
    if (!res.ok) {
      publish(null);
      return;
    }
    publish(parse(await res.json().catch(() => null)));
  } catch {
    // 네트워크 실패 — 직전 값을 그대로 둔다(잠깐 끊겼다고 필을 지웠다 켜지 않는다)
  }
}

/** 다시 읽기. 이미 읽는 중이면 끝난 뒤 한 번 더 읽는다(그 사이의 승인이 빠지지 않게) */
export function refreshThesisSummary(): Promise<void> {
  started = true;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await fetchOnce();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * 대기 건수 구독. 처음 쓰는 자리가 한 번 읽는다.
 * refreshOnMount — 대시보드처럼 "지금 들어와서 보는" 화면은 마운트마다 새로 읽는다
 * (콘솔을 열어 둔 사이에 들어온 제출을 놓치지 않게).
 */
export function useThesisSummary(opts?: { refreshOnMount?: boolean }): ThesisSummary | null {
  const value = useSyncExternalStore(subscribe, () => snapshot, () => null);
  const refreshOnMount = opts?.refreshOnMount === true;
  useEffect(() => {
    if (refreshOnMount || !started) void refreshThesisSummary();
  }, [refreshOnMount]);
  return value;
}
