/**
 * 구 URL 리졸버 공용 도우미 (Route Handler 전용).
 *
 * 왜 페이지가 아니라 Route Handler 인가: next-intl 미들웨어가 모든 요청에 rewrite 를
 * 거는데, Next 14 는 rewrite 된 **페이지** 렌더에서 `permanentRedirect()`/`notFound()` 의
 * 상태코드를 잃고 200 을 내보낸다(프로덕션 실측). Route Handler 는 자체 Response 를
 * 그대로 반환하므로 308/404 가 온전히 나간다 — 구 URL 의 색인·백링크 이전은 정확한
 * 상태코드가 목적이라 이 경로를 쓴다.
 */

/** 로케일 없는 새 경로(board-links 헬퍼 산출물)로 308 영구 이동 */
export function legacyRedirect(req: Request, locale: string, path: string): Response {
  return Response.redirect(new URL(`/${locale}${path}`, req.url), 308);
}

/**
 * 없는 글의 구 URL — 목적지로 떠넘기지 않고 여기서 404(또는 410) 한다.
 * Route Handler 라 [locale]/not-found.tsx 를 못 빌린다: 죽은 옛 링크에 도달하는 드문
 * 경우이므로, 홈으로 가는 링크 하나를 담은 최소 문서로 충분하다(상태코드가 본질).
 *
 * status 404 vs 410:
 *  - 404 = "이 주소엔 지금 아무것도 없다"(잘못된 id 인지 지워진 글인지 모른다). 구글은
 *    일시적일 수 있다고 보고 한동안 재크롤을 반복하며 색인에서 천천히 뺀다.
 *  - 410 Gone = "영구히 없어졌다". 게시판 자체를 폐지해 대응 문서가 영영 생기지 않는
 *    경우(인턴 모집·동문 뉴스, 2026-09)에 쓴다 — 색인 제거가 빠르고 크롤 예산을 아낀다.
 *  글 단위로 존재 여부를 조회하는 리졸버(/news/post/<id> 등)는 둘을 구분할 수 없으니 404.
 */
export function legacyNotFound(locale: string, status: 404 | 410 = 404): Response {
  const ko = locale === 'ko';
  const title =
    status === 410
      ? ko
        ? '더 이상 제공하지 않는 페이지입니다'
        : 'This page is no longer available'
      : ko
        ? '페이지를 찾을 수 없습니다'
        : 'Page not found';
  const home = ko ? '홈으로 돌아가기' : 'Back to home';
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${status} · ${title}</title></head><body style="font-family:sans-serif;display:grid;place-items:center;min-height:100dvh;margin:0"><main style="text-align:center"><p style="font-size:56px;font-weight:700;color:#003377;margin:0">${status}</p><h1 style="font-size:20px;font-weight:600">${title}</h1><p><a href="/${locale}" style="color:#0057A8">${home}</a></p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
