// 목록 캐시 무효화 — POST /api/revalidate.
//
// 왜 이게 있나
//   게시판 목록(`fetchBoardRows`)과 콘텐츠는 `unstable_cache` 의 태그(`posts`·`content`)로
//   묶여 있고 수명이 하루다(fd3427d, Supabase egress 절감). CMS 로 쓰면 쓰기 라우트가
//   그 자리에서 `revalidateTag` 를 불러 수 초 내 반영되지만, **DB 에 직접 넣는 경로**
//   (tools/automation/board-sync.mjs — 구 게시판 새 글 동기화)는 앱을 거치지 않아
//   태그를 털 방법이 없었다. 그래서 넣은 글이 상세 페이지에는 보이는데 목록에는
//   최대 24시간 안 뜬다(2026-09-16 세 호스트에서 실측). 이 라우트가 그 구멍을 메운다.
//
// 왜 CMS 라우트가 아니라 별도 라우트인가
//   `/api/admin/*` 은 Auth.js **세션 로그인**이 전제라 스크립트가 부를 수 없다. 여기서는
//   공유 비밀값 한 개(`REVALIDATE_SECRET`)로만 판정한다 — 하는 일이 "캐시를 비운다" 뿐이라
//   읽기·쓰기 권한이 필요 없고, 최악의 경우도 DB 재조회 몇 번이다.
//
// 전제: 인스턴스 1개
//   `revalidateTag` 는 그 프로세스의 캐시만 턴다. Cafe24 는 pm2 `instances: 1` 이고
//   (7-1), Vercel 은 Data Cache 가 배포·인스턴스를 넘어 공유된다 — 그래서 호스트마다
//   한 번씩 부르면 그 호스트가 정리된다. pm2 를 2 이상으로 올리면 이 전제가 깨진다.
//
// 공개 엔드포인트다 — 비밀값은 물론이고 내부 상태·오류 문구도 응답에 싣지 않는다.

import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

// 무효화 요청 자체가 캐시되면 아무 일도 일어나지 않는다 — 매 요청 그대로 실행한다
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/** 밖에서 털 수 있는 태그는 이 둘뿐 — 임의 문자열을 받으면 무효화 대상이 무한정 늘어난다 */
const ALLOWED_TAGS = ['posts', 'content'] as const;
type AllowedTag = (typeof ALLOWED_TAGS)[number];

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

function isAllowedTag(value: unknown): value is AllowedTag {
  return typeof value === 'string' && (ALLOWED_TAGS as readonly string[]).includes(value);
}

/** 길이까지 비밀이 되지 않도록 길이가 다르면 즉시 불일치로 본다(timingSafeEqual 은 길이가 같아야 한다). */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 본문 → 태그 목록. 본문 없음/빈 배열은 기본값, 그 밖의 이상한 입력은 null(=400). */
async function parseTags(request: Request): Promise<AllowedTag[] | null> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return null;
  }
  if (!raw.trim()) return ['posts'];

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;

  const tags = (body as { tags?: unknown }).tags;
  if (tags === undefined || tags === null) return ['posts'];
  if (!Array.isArray(tags)) return null;
  if (tags.length === 0) return ['posts'];
  if (!tags.every(isAllowedTag)) return null;
  return [...new Set(tags)];
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.REVALIDATE_SECRET ?? '';
  // 비밀값이 없는 서버는 **어떤 값도 받지 않는다** — 빈 문자열끼리 맞아떨어지는 사고 방지
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'unconfigured' }, { status: 503, headers: NO_STORE });
  }

  const given = request.headers.get('x-revalidate-secret');
  if (!given || !secretMatches(given, expected)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  const tags = await parseTags(request);
  if (!tags) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400, headers: NO_STORE });
  }

  for (const tag of tags) revalidateTag(tag);

  return NextResponse.json({ ok: true, tags, at: new Date().toISOString() }, { status: 200, headers: NO_STORE });
}
