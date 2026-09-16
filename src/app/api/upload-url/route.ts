// 대용량 첨부용 presigned PUT URL 발급 라우트.
//
// Vercel 함수 본문 한도(4.5MB) 때문에 큰 파일은 서버 경유가 불가능하다 —
// 이 라우트가 R2 presigned PUT URL 을 발급하면 브라우저가 R2 로 직접 업로드한다.
// (⚠ 교차 출처 직접 업로드라 프록시·백신망에서 막힐 수 있고, R2 버킷에 CORS
//  정책(PUT 허용)이 설정되어 있어야 한다. 작은 파일(≤4MB)은 항상 서버 경유.)
//
// 보안은 서버 경유와 동일 규칙(upload-validate 공유): 프로덕션 Auth.js 세션 필수,
// 경로 접두어·용량·MIME 검증. URL 은 10분 유효, 발급 시점에 최종 key 를 확정하므로
// 클라이언트가 저장 위치를 조작할 수 없다.

import { auth } from '@/auth';
import { r2PresignPut, r2PublicUrl, withRandomSuffix } from '@/lib/admin/r2';
import { maxUploadBytesFor, validateUpload } from '@/lib/admin/upload-validate';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    const devBypass = process.env.NODE_ENV !== 'production';
    if (!devBypass) {
      const session = await auth();
      if (!session?.user) {
        return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
      }
    }

    const body = (await request.json()) as {
      pathname?: string;
      contentType?: string;
      size?: number;
    };
    const pathname = body.pathname ?? '';
    const size = Number(body.size ?? 0);

    const check = validateUpload(pathname, body.contentType ?? null);
    if (!check.ok) {
      return Response.json({ error: check.error }, { status: check.status });
    }
    // 용량 상한은 파일 종류로 갈린다 — 영상 200MB, 그 외 20MB
    // (검증이 확정한 contentType 을 쓴다: 브라우저가 빈 타입을 보내도 확장자로 구제된다)
    const limit = maxUploadBytesFor(check.contentType, pathname);
    if (!Number.isFinite(size) || size <= 0 || size > limit) {
      return Response.json(
        { error: '영상은 200MB, 그 외 파일은 20MB 이하만 올릴 수 있습니다.' },
        { status: 413 },
      );
    }

    const key = withRandomSuffix(pathname);
    const putUrl = await r2PresignPut(key, check.contentType);
    return Response.json({ putUrl, publicUrl: r2PublicUrl(key), contentType: check.contentType });
  } catch (err) {
    const message = err instanceof Error ? err.message : '업로드 URL 발급에 실패했습니다.';
    console.error('[api/upload-url] presign 실패:', message, {
      hasR2Keys: Boolean(process.env.R2_ACCESS_KEY_ID && process.env.R2_ACCOUNT_ID),
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
