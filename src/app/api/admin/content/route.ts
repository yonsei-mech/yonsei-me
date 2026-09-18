// 콘텐츠 파일 admin API — 읽기(GET)·쓰기(PUT). 백엔드 전환 Stage C.
//
// 지금까지 CMS 의 콘텐츠 저장은 브라우저가 GitHub Contents API 로 직접 커밋하고
// Vercel 재배포(1~2분)를 기다려야 했다. 이 라우트가 그 자리를 대신한다:
// 프로덕션은 Supabase content_files 행을 갱신하고 revalidateTag('content') 를
// 호출해 **재배포 없이** 수 초 내 사이트에 반영된다(게시판의 'posts' 와 같은 관례).
//
// 인증은 /api/admin/posts 와 동일하다 — 프로덕션은 Auth.js 세션(=GitHub allowlist)
// 필수, dev 는 CMS 개방 모드와 같이 우회한다.
//
// dev 는 DB 를 거치지 않고 로컬 content/ 파일을 직접 읽고 쓴다. dev 서버가 작업
// 트리를 그대로 서빙하므로 파일이 곧 화면이고, 낙관적 동시성(version)도 필요 없다
// (기존 /api/dev-content 의 devCommit 도 sha 를 무시했다).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { revalidateTag } from 'next/cache';
import { isManagedPath, MANAGED_FILES } from '@/lib/admin/managed-content';
import { adminDb, requireAdmin } from '@/lib/admin/posts-server';
import { sanitizeEditorHtml } from '@/lib/admin/sanitize';

export const runtime = 'nodejs';

/** 충돌 문구 — 반드시 '409' 를 포함해야 한다. CollectionEditor 의 충돌 모달이
 *  msg.includes('409') 로 감지하는 계약이다(문구를 바꿀 때 숫자를 지우지 말 것). */
const CONFLICT_MESSAGE = '파일이 다른 곳에서 변경되었습니다 (409). 새로고침 후 다시 시도하세요.';

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production';
}

// ── dev 로컬 파일 경로 해석 ────────────────────────────────────────────
// 허용 목록은 isManagedPath(content/ 하위 고정 경로 + 동아리 본문 패턴)라 이미
// dev-content 라우트보다 좁다. 그래도 정규화 후 content/ 안인지 한 번 더 확인한다
// (경로 판정이 한 곳에만 있으면 그 한 곳이 뚫릴 때 방어선이 없다).
const CONTENT_ROOT = resolve(process.cwd(), 'content');

function devAbsPath(path: string): string | null {
  const norm = path.replace(/\\/g, '/');
  if (norm.includes('..')) return null;
  const abs = resolve(process.cwd(), norm);
  if (!abs.startsWith(CONTENT_ROOT + sep)) return null;
  return abs;
}

/** GET /api/admin/content?path=content/staff.json — 파일 원문 + 버전 */
export async function GET(request: Request): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const path = new URL(request.url).searchParams.get('path') ?? '';
  if (!isManagedPath(path)) {
    return Response.json({ error: '허용되지 않은 경로입니다.' }, { status: 400 });
  }

  if (isDev()) {
    const abs = devAbsPath(path);
    if (!abs) return Response.json({ error: '허용되지 않은 경로입니다.' }, { status: 400 });
    try {
      const content = await readFile(abs, 'utf8');
      // version=null → 클라이언트가 충돌 검사를 건너뛴다(dev 는 경쟁 상대가 없다)
      return Response.json({ content, version: null });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return Response.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
      }
      return Response.json({ error: '파일 읽기에 실패했습니다.' }, { status: 500 });
    }
  }

  const { data, error } = await adminDb()
    .from('content_files')
    .select('body, version')
    .eq('path', path)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
  return Response.json({ content: String(data.body), version: Number(data.version) });
}

interface PutBody {
  path?: string;
  content?: string;
  /** 읽은 시점의 행 버전 — 있으면 낙관적 갱신, 없으면 신규 생성 의도 */
  expectedVersion?: number;
}

/** PUT /api/admin/content — 파일 원문 저장(갱신 또는 신규 생성) */
export async function PUT(request: Request): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return Response.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
  }

  const path = body.path ?? '';
  if (!isManagedPath(path)) {
    return Response.json({ error: '허용되지 않은 경로입니다.' }, { status: 400 });
  }
  if (typeof body.content !== 'string') {
    return Response.json({ error: 'content 문자열이 필요합니다.' }, { status: 400 });
  }
  let content = body.content;

  // JSON 은 저장 전에 서버에서 파싱해 본다. 깨진 원문이 들어가면 사이트는
  // content-runtime 의 폴백으로 조용히 옛 스냅샷을 보여주고(변경이 사라진 것처럼
  // 보인다), CMS 는 다음 편집에서 목록 자체를 읽지 못한다.
  let parsed: unknown;
  if (path.endsWith('.json')) {
    try {
      parsed = JSON.parse(content);
    } catch {
      return Response.json({ error: 'JSON 형식이 올바르지 않습니다.' }, { status: 400 });
    }
  }

  // 대학원 졸업요건만 — STEP 본문(body)은 리치 에디터가 낸 HTML 이라 **저장 시점에**
  // 정화한다(게시물 bodyFormat:'html' 과 같은 규약이자 lib/graduate-requirements.ts
  // 주석이 약속한 지점). 렌더는 dangerouslySetInnerHTML 한 번뿐이라 정화가 여기 없으면
  // 어디에도 없다.
  // ⚠️ 형식이 어긋나면(배열이 아님·항목이 객체가 아님) 조용히 건너뛰고 원문 그대로
  //    저장한다. 여기서 새 400 을 만들면 이 라우트를 함께 쓰는 다른 저장 흐름의
  //    계약이 경로마다 갈린다 — 이 분기는 이 경로 하나에만 걸린다.
  if (path === MANAGED_FILES.graduateRequirements && Array.isArray(parsed)) {
    const steps = parsed.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const r = item as Record<string, unknown>;
      if (typeof r.body !== 'string') return item;
      return { ...r, body: sanitizeEditorHtml(r.body) };
    });
    // 직렬화 형식은 commitJson(content-api.ts)과 같아야 한다 — 다르면 저장할 때마다
    // 파일 전체가 들여쓰기 차이로 통째로 바뀐 것처럼 보인다.
    content = `${JSON.stringify(steps, null, 2)}\n`;
  }

  if (isDev()) {
    const abs = devAbsPath(path);
    if (!abs) return Response.json({ error: '허용되지 않은 경로입니다.' }, { status: 400 });
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
    } catch {
      return Response.json({ error: '파일 쓰기에 실패했습니다.' }, { status: 500 });
    }
    return Response.json({ version: null });
  }

  const expected = body.expectedVersion;
  if (expected !== undefined && !Number.isInteger(expected)) {
    return Response.json({ error: 'expectedVersion 이 올바르지 않습니다.' }, { status: 400 });
  }

  if (expected !== undefined) {
    // 낙관적 동시성 — 읽은 버전이 그대로 남아 있을 때만 갱신된다.
    // 행 존재 여부를 미리 조회하지 않는 이유: 0행 갱신이면 버전이 밀렸든 행이
    // 사라졌든 사용자가 할 일은 같다(최신본을 다시 불러오기). 같은 409 로 말한다.
    const { data, error } = await adminDb()
      .from('content_files')
      .update({ body: content, version: expected + 1 })
      .eq('path', path)
      .eq('version', expected)
      .select('version');
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) {
      return Response.json({ error: CONFLICT_MESSAGE }, { status: 409 });
    }
    revalidateTag('content');
    return Response.json({ version: expected + 1 });
  }

  // expectedVersion 없음 = 신규 생성 의도(동아리 소개 본문 첫 저장 등).
  // 이미 행이 있으면 unique 충돌(23505) — 내가 모르는 원본이 있다는 뜻이라 409 다.
  const { error } = await adminDb()
    .from('content_files')
    .insert({ path, body: content, version: 1 });
  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    return Response.json(
      { error: status === 409 ? CONFLICT_MESSAGE : error.message },
      { status },
    );
  }
  revalidateTag('content');
  return Response.json({ version: 1 });
}
