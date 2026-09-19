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

2026-09-16 실측: 버킷에 허용된 출처는 `http://localhost:3000` 과 당시 Vercel 도메인
둘뿐이었고, `https://me.yonsei.ac.kr` 과 `https://aquaelle06.mycafe24.com` 은 preflight
403 이었다. 그 뒤 호스팅이 Cafe24 로 넘어가 Vercel 출처는 전부 제거했다.

⚠️ 이 설정은 **스크립트로 못 고친다.** 앱이 쓰는 R2 API 토큰에는 버킷 CORS 읽기·쓰기
권한이 없다(`GetBucketCors` → AccessDenied). Cloudflare 대시보드에서
**R2 → 버킷(`yonsei-me`) → Settings → CORS policy** 에 **[`cors.json`](./cors.json)** 의
내용을 그대로 붙여 넣는다. 정책을 바꿀 일이 생기면 대시보드에서 직접 고치지 말고
`cors.json` 을 고쳐 커밋한 뒤 붙여 넣는다 — 그래야 실제 설정이 저장소에 남는다.

### 출처 목록의 근거

`cors.json` 의 `AllowedOrigins` 는 아래 근거로 고른 것이다. 하나라도 빠지면 그 출처에서만
대용량 업로드가 조용히 깨지므로, 지우기 전에 근거를 확인할 것.

| 출처 | 근거 |
| --- | --- |
| `http://localhost:3000` | 로컬 개발 |
| `https://me.yonsei.ac.kr` | 정규 도메인. `src/lib/site.ts` 의 `SITE_URL` 기본값 |
| `https://aquaelle06.mycafe24.com` | 실제 배포 호스트(`.github/workflows/deploy.yml` 의 `DEPLOY_HOST`) |

출처를 넉넉히 넣어도 안전한 이유: 이 CORS 정책은 접근 제어가 아니다. presigned URL 은
`/api/upload-url` 이 **Auth.js 세션을 확인한 뒤에만** 발급하고(프로덕션), 서명·경로·용량·MIME
가 모두 서버에서 확정된다. CORS 는 "브라우저가 이 출처에서 교차 출처 PUT 을 보내도 되는가"
만 정하므로, 목록에 있다고 아무나 올릴 수 있는 것이 아니다.

> CORS 정책은 병합이 아니라 **전체 교체**다. 출처를 하나 추가하려고 그것만 붙여 넣으면
> 나머지가 전부 끊긴다. 항상 `cors.json` 전체를 붙여 넣는다.

임시 도메인(스테이징·테스트 호스트)에서 대용량 업로드를 검증해야 하면 그 출처를 잠깐
추가하거나, 로컬(`localhost:3000`)에서 확인한다.

### wrangler 로 적용하려면

CORS 읽기·쓰기 권한이 있는 별도 토큰이 있다면 CLI 로도 된다. 단 **wrangler 의 파일 형식은
대시보드 형식과 다르다**(`{"rules":[{"allowed":{"origins":[...],"methods":[...]}}]}`) —
`cors.json` 을 그대로 넘기면 안 되고, 적용 후 반드시 `list` 로 확인할 것.

```sh
npx wrangler r2 bucket cors set yonsei-me --file <wrangler-형식-파일>
npx wrangler r2 bucket cors list yonsei-me
```

### 커스텀 도메인을 붙여도 이 문제는 안 풀린다

R2 커스텀 도메인은 **읽기(GET)** 응답에 CORS 헤더를 자동으로 붙여 주지만, 업로드는 그 경로를
타지 않는다. `r2PresignPut()` 이 서명하는 대상은 S3 API 엔드포인트
(`<account>.r2.cloudflarestorage.com`, `src/lib/admin/r2.ts`)이고 브라우저는 거기로 직접
PUT 한다(`src/lib/admin/storage.ts`). 따라서 커스텀 도메인 도입과 무관하게 이 버킷 CORS
정책은 계속 필요하다.
