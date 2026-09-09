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
