# tools/r2

`backfill-cache-control.mjs` — R2 에 이미 올라간 객체에 `Cache-Control: public, max-age=31536000,
immutable` 을 소급 적용한다.

왜: `src/lib/admin/r2.ts` 의 `r2Put` 이 오랫동안 `CacheControl` 없이 저장했다. r2.dev 응답에
Cache-Control 이 없으면 브라우저가 매번 재검증하고(PageSpeed "cache TTL None"), `next/image` 도
`minimumCacheTTL`(기본 60초)마다 같은 사진을 다시 최적화한다. `r2Put` 은 이제 헤더를 붙이므로
**신규 업로드는 자동**이고, 기존 객체만 이 스크립트로 한 번 보정하면 된다.

안전한 이유: 키에 랜덤 접미사(`withRandomSuffix`)가 붙어 한 키의 내용이 바뀌지 않는다. 보정은
같은 자리 `CopyObject`(`MetadataDirective=REPLACE`)라 본문 바이트는 그대로고 메타데이터만 다시
쓴다 — `ContentType`·`ContentDisposition`·사용자 `Metadata` 는 `HeadObject` 로 읽어 그대로 옮긴다.

자격증명은 저장소 루트의 `.env.local`(gitignore 됨)에서 읽는다 —
`R2_ACCOUNT_ID`·`R2_ACCESS_KEY_ID`·`R2_SECRET_ACCESS_KEY`·`R2_BUCKET`. 셸 환경변수가 이미 있으면
그쪽이 우선한다.

기본은 **드라이런**(아무것도 쓰지 않고 total / already-set / to-update 개수와 앞 20개 키만 출력).
실제 쓰기는 `--apply` 를 붙여야 한다.

PowerShell (저장소 루트 `yonsei-me` 에서):

```powershell
node tools/r2/backfill-cache-control.mjs; node tools/r2/backfill-cache-control.mjs --apply
```

범위를 좁히려면 `--prefix uploads/` 를 붙인다.

## 버킷 CORS (4MB 초과 직접 업로드)

`/api/upload-url` 이 발급한 presigned PUT 은 브라우저가 **R2 로 직접** 보낸다(교차 출처).
따라서 버킷의 CORS 정책이 사이트 출처들에 대해 `PUT` 을 허용해야 하고, 그러지 않으면
preflight 가 403 으로 끊겨 "업로드에 실패했습니다" 가 뜬다. 4MB 이하는 서버 경유
(`/api/upload-file`)라 CORS 와 무관하다 — 연구실 소개 영상처럼 큰 파일에서만 걸린다.

2026-09-16 실측: 버킷에 허용된 출처는 `http://localhost:3000` 과
`https://yonsei-me.vercel.app` 둘뿐이었다. `https://me.yonsei.ac.kr`,
`https://yonsei-me-sage.vercel.app`, `https://aquaelle06.mycafe24.com` 은 preflight 403.

⚠️ 이 설정은 **스크립트로 못 고친다.** 앱이 쓰는 R2 API 토큰에는 버킷 CORS 읽기·쓰기
권한이 없다(`GetBucketCors` → AccessDenied). Cloudflare 대시보드에서
**R2 → 버킷 → Settings → CORS policy** 에 아래 JSON 을 붙여 넣는다.

```json
[
  {
    "AllowedOrigins": ["https://me.yonsei.ac.kr", "https://aquaelle06.mycafe24.com", "https://yonsei-me-sage.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```
