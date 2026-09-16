# BK21 스캔 문서 미러링 (`mirror-scans.mjs`)

구 사이트 `me.yonsei.ac.kr` 의 BK21 메뉴에 걸린 스캔 문서 6종(JPG 1,733장, 원본 825MB)을
내려받아 R2 로 옮기는 1회성 도구다.

구 페이지에는 **PDF 다운로드 링크가 없다** — 각 `.do` 페이지에 페이지 수만큼 `<img>` 가 박혀
있을 뿐이다. DNS 컷오버로 `me.yonsei.ac.kr` 이 우리 서버가 되는 순간 원본 주소는 사라지므로,
**컷오버 전에** 이 작업을 끝내야 한다.

## 대상

| key | 구 페이지 | 이미지 디렉터리 | 장수 | 표지 장 |
|---|---|---|---|---|
| `plan` | `/me/bk21/BK21_plan.do` | `/_res/me/img/BK21/` | 939 | **2** |
| `report-2021` | `/me/bk21/BK21_plan_2021.do` | `…/BK21/2021/` | 184 | 1 |
| `report-2022` | `/me/bk21/BK21_plan_2022.do` | `…/BK21/2022/` | 179 | 1 |
| `report-2023` | `/me/bk21/BK21_plan_2023.do` | `…/BK21/2023/` | 182 | 1 |
| `report-2024` | `/me/bk21/BK21_plan_2024.do` | `…/BK21/2024/` | 120 | 1 |
| `report-2025` | `/me/bk21/BK21_plan_2025.do` | `…/BK21/2025/` | 129 | 1 |

`plan` 은 2020년 4단계 BK21 사업계획서, 2023 은 성과평가보고서, 나머지는 자체평가보고서다.
`plan` 의 1장은 요약문에 가까운 **거의 백지**라 표지 썸네일은 2장으로 만든다(`DOCS[].coverPage`).

## ⚠️ 원본 자체가 결락돼 있다 (우리 쪽 실패가 아님)

각 장의 인쇄 푸터 쪽번호를 실측해 보니, **구 사이트에 올라간 이미지 세트가 원본 PDF 보다 짧다.**
링크되지 않은 뒷번호 이미지가 서버에 남아 있는지도 확인했지만 전부 404 였고
(`…/2023/…_v2_183.jpg`, `…/BK21/0940.jpg` 등), `/me/bk21/files.do` 에도 첨부 파일이 없다.
즉 **더 받을 것이 없다** — 학과가 업로드할 때 빠뜨린 것이다.

| key | 받은 장수 | 원본 쪽수(푸터) | 결락 |
|---|---|---|---|
| `plan` | 939 | **957** | 인쇄 쪽 **307–324 (18쪽)** 한 구간이 통째로 빠짐. 이미지 306=쪽306, 307=쪽325, 이후 끝까지 일정하게 +18. |
| `report-2023` | 182 | **511** | 인쇄 쪽 **184–511 (328쪽)** 이 아예 없음. 마지막 장 푸터가 `183 / 511`. |

→ 화면에 "총 957쪽"·"총 511쪽" 같은 표기를 **단독으로** 쓰면 안 된다. 뷰어가 보여줄 수 있는 것은
가진 장수뿐이다. 그래서 seed 는 세 가지를 같이 싣는다 — `pages`(가진 장수) · `printedTotal`(원본
쪽수) · `gaps`(빠진 인쇄 쪽 구간) · `note`(화면에 띄울 한/영 안내 문구). 빠진 구간은 학과에 원본
PDF 를 요청해 채워야 한다. 나머지 4종(2021·2022·2024·2025)은 푸터·장수가 맞고 `note` 가 `null` 이다.

## 사용 순서

```bash
node tools/bk21/mirror-scans.mjs fetch                 # 원본 JPG 내려받기 (≈0.8GB)
node tools/bk21/mirror-scans.mjs derive                # 뷰어용 WebP(최대 폭 1240) + cover.webp
node tools/bk21/mirror-scans.mjs upload                # 드라이런 — 올릴 개수·용량만 출력
node tools/bk21/mirror-scans.mjs upload --apply        # 실제 R2 업로드 (WebP + cover 만)
node tools/bk21/mirror-scans.mjs seed                  # 프런트용 씨앗 JSON 생성
```

**문서 정의(6종의 key·제목·원문 주소·분류)는 `docs.mjs` 가 단일 출처다.** 세 스크립트
(`mirror-scans.mjs`·`build-pdf.mjs`·`seed-reports.mjs`)가 그것을 가져다 쓴다 — 어느 한 곳에
다시 적지 마라.

## PDF 로 묶어 게시판에 올리기 (2026-09, 현행 경로)

낱장 이미지 뷰어 대신 **문서당 PDF 한 벌**을 게시판 글의 첨부로 올린다. 화면의 좌/우 펼침
리더(pdf.js)가 HTTP Range 로 필요한 쪽만 받아 가므로 1,733장을 낱장으로 들고 있을 이유가 없다.
(낱장 WebP 세트는 R2 에 그대로 남는다 — 지우지 마라.)

```bash
node tools/bk21/build-pdf.mjs                          # raw JPG → pdf/<key>.pdf (6종)
node tools/bk21/build-pdf.mjs --verify-only            # 만든 PDF 를 다시 열어 쪽수·쪽 크기 검증
node tools/bk21/mirror-scans.mjs upload-pdf            # 드라이런
node tools/bk21/mirror-scans.mjs upload-pdf --apply    # R2 uploads/legacy/bk21/<key>.pdf
node tools/bk21/seed-reports.mjs                       # 드라이런 — 들어갈 행을 표로
node tools/bk21/seed-reports.mjs --apply               # posts(board='bk21Reports') + attachments
```

`build-pdf` 옵션: `--doc=<key>` · `--max-width=1240` · `--quality=80` · `--force`(기존 PDF 재생성).

실측 결과 (폭 1240 · JPEG q80, plan 만 q65):

| key | 쪽수 | 용량 | 품질 | 1쪽 크기 |
|---|---|---|---|---|
| `plan` | 939 | 96.1MB | **65** | 595×842pt (마지막 쪽은 가로 595×420) |
| `report-2021` | 184 | 33.8MB | 80 | 380×538pt (1쪽만 저해상 793px) |
| `report-2022` | 179 | 38.3MB | 80 | 571×807pt |
| `report-2023` | 182 | 41.0MB | 80 | 571×807pt |
| `report-2024` | 120 | 33.4MB | 80 | 595×842pt |
| `report-2025` | 129 | 36.0MB | 80 | 595×841pt |

쪽 크기는 **장마다 그 픽셀 비율 그대로**다. 환산 기준은 하나 — 폭 1240px = 595pt(A4 폭),
`pt = px × 595/1240`. 세로도 같은 배율이라 비율이 보존되고 가로 장은 자연히 가로 쪽이 된다.
한 문서 안에서도 쪽 크기가 제각각인 것은 정상이다(함정 5).

공통 옵션: `--doc=<key>` 로 한 문서만.
- `fetch --concurrency=N` (기본 3)
- `derive --max-width=<px>` (기본 **1240**) — 원본이 그보다 좁으면 **업스케일하지 않고** 원 크기를
  유지한다. manifest 에 기록된 파생 폭과 다르면 그 문서를 통째로 다시 만든다(같으면 건너뜀).
- `upload --include-jpg` — 기본은 **WebP + cover 만** 올린다. 이 옵션을 줘야 원본 JPG 도 포함된다.

**전 단계가 재실행 안전하다.** 이미 있고 크기가 0 보다 큰 로컬 파일은 건너뛰고, 업로드는
`HeadObject` 로 R2 에 이미 있는 키를 건너뛴다. 중간에 죽으면 그냥 같은 명령을 다시 돌리면 된다.

## 산출물과 용량

| 경로 | 내용 | 추적 |
|---|---|---|
| `raw/<key>/NNNN.jpg` | 원본 JPG (4자리 0 패딩, 1부터) | ✗ gitignore |
| `derived/<key>/NNNN.webp` | 뷰어용 WebP q80, **최대 폭 1240**(업스케일 없음) | ✗ gitignore |
| `derived/<key>/cover.webp` | 표지 썸네일(너비 480, `coverPage` 장) | ✗ gitignore |
| `pdf/<key>.pdf` | 게시판 첨부용 문서 PDF (`build-pdf.mjs`) | ✗ gitignore |
| `manifest.json` | 문서·장수·바이트·원본 URL + 파생 장별 `{n,w,h,bytes}` + `pdf` 항목 | ✓ |
| `bk21-reports.seed.json` | 프런트가 쓸 문서 목록(R2 URL·결락 정보 포함) | ✓ |

실측 용량 (파생 폭 1240 기준):

| key | 장수 | 대표 크기 | 다른 크기 장 | WebP 합 | cover |
|---|---|---|---|---|---|
| `plan` | 939 | 1240×876 (가로) | 306 | 55.4MB | 38KB |
| `report-2021` | 184 | 1240×1752 | 1 | 18.9MB | 30KB |
| `report-2022` | 179 | 1190×1682 | 0 | 21.8MB | 29KB |
| `report-2023` | 182 | 1190×1682 | 0 | 22.9MB | 39KB |
| `report-2024` | 120 | 1240×1753 | 47 | 19.7MB | 30KB |
| `report-2025` | 129 | 1240×1753 | 57 | 22.5MB | 54KB |
| **합계** | **1,733** | | | **161.4MB** | |

즉 **기본 업로드는 1,739개 객체 · 161.4MB**(WebP 1,733 + cover 6). `--include-jpg` 를 붙이면
원본 JPG 825MB 가 얹혀 **3,472개 · 986.2MB** 가 된다. R2 무료 10GB 안이긴 하지만 화면이 원본
JPG 를 쓰지 않으므로 기본값대로 WebP 만 올리면 된다 — 원본은 로컬 `raw/` 에 남아 있으니
나중에 필요하면 `--include-jpg` 로 추가 업로드하면 그만이다(기존 키는 `HeadObject` 로 건너뛴다).

R2 키는 `uploads/legacy/bk21/<key>/NNNN.webp`·`cover.webp`(`--include-jpg` 면 `NNNN.jpg` 도),
캐시 헤더는 `public, max-age=31536000, immutable`(키가 내용별로 고정이라 안전).

`seed` 가 만드는 `bk21-reports.seed.json` 은 **씨앗일 뿐이다** — 이 스크립트는 `content/` 에
직접 쓰지 않는다. 프런트 슬라이스가 `content/bk21-reports.json` 으로 가져다 쓴다.

## seed 파일 형식

```json
{ "key": "plan", "title": { "ko": "사업계획서", "en": "Project Plan" }, "year": 2020,
  "pages": 939, "width": 1240, "height": 876,
  "pageSizes": [{ "n": 1, "w": 1240, "h": 1755 }, { "n": 2, "w": 1240, "h": 1753 }],
  "baseUrl": "<R2_PUBLIC_BASE_URL>/uploads/legacy/bk21/plan", "coverUrl": "<…>/cover.webp",
  "legacyPath": "bk21/bk21_plan.do",
  "printedTotal": 957, "gaps": [{ "from": 307, "to": 324 }],
  "note": { "ko": "…", "en": "…" } }
```

| 필드 | 뜻 |
|---|---|
| `pages` | **우리가 가진** 장수. 뷰어가 넘길 수 있는 최대치 |
| `width`/`height` | 파생본의 **대표 크기**(최빈값). 뷰어 기본 비율 |
| `pageSizes` | 대표와 크기가 다른 장만 `[{n,w,h}]`. 전부 같으면 `null` |
| `baseUrl` | 장 URL 은 뷰어가 조립한다 — `` `${baseUrl}/${String(n).padStart(4,'0')}.webp` `` |
| `coverUrl` | 표지 썸네일(폭 480). plan 만 2장, 나머지 1장 |
| `printedTotal` | 원본 인쇄본 쪽수(푸터 실측). 결락이 없으면 `pages` 와 같다 |
| `gaps` | 빠진 인쇄 쪽 구간 `[{from,to}]`. 없으면 `[]` |
| `note` | 결락 안내 문구(한/영). 없으면 `null` |

⚠️ `pages` 와 `printedTotal` 은 다른 수다. 화면에 "957쪽"만 띄우면 넘길 수 없는 쪽을 약속하는 셈이
되고, `pages` 만 띄우면 문서가 잘렸다는 사실이 사라진다 — `note` 와 함께 써라.

## 함정 (실측)

1. **이미지 직접 요청은 `Referer` 없이 403.** 구 서버가 핫링크를 막는다. 해당 `.do` 페이지를
   `Referer` 로, 브라우저 UA 를 함께 보내야 200 이 온다. 페이지 HTML 자체는 헤더 없이 200.
2. **파일명 규칙이 문서마다 다르다.** `plan`/2021/2022 는 `0001.jpg`(4자리 0 패딩),
   2023 은 `…_v2_1.jpg` 로 **0 패딩이 없어** 사전순 정렬하면 순서가 깨지고, 2024/2025 는
   `…_페이지_001.jpg`(3자리). 그래서 파일명 패턴을 추측하지 않고 **페이지 HTML 의 `<img src>`
   등장 순서**를 그대로 쓴다. 장수가 위 표와 다르면 경고를 찍는다.
3. 파일명에 한글이 들어간다 — 요청 URL 은 `new URL()` 로 퍼센트 인코딩해서 보낸다.
4. **2025 보고서는 블라인드본**(`…최종_블라인드…`)이다. 심사용으로 일부가 가려진 판본이니
   공개 표기에서 "원본"인 양 쓰지 말 것.
5. **해상도는 문서마다 다르고, 한 문서 안에서도 다르다 — 이게 가장 큰 함정이다.**
   - `plan` 은 **633장이 가로(1240×876), 306장이 세로**다. 한 비율로 전 장을 그리면 절반이 깨진다.
   - `report-2021` 은 **1장만** 793×1121 이고 나머지 183장은 1240×1752 다. 그래서 문서 대표
     크기를 "첫 장" 으로 잡으면 안 된다 — `derive` 는 **최빈값**을 쓴다.
   - `report-2024`·`2025` 는 장마다 세로가 제각각이다(1240×1427 ~ 1240×3106, 47·57장이 예외).
   `fetch` 가 기록하는 `width`/`height` 는 1장만 잰 값이라 대표값이 아니다. `derive` 가 장별로
   실측해 `derivedPages[]` + 최빈값 `derivedWidth`/`derivedHeight` 를 남기니 **그 값을 써라**.
   뷰어는 seed 의 `pageSizes` 에 있는 장만 개별 비율로 그리면 된다.
6. 상대 서버 배려로 동시 3·요청 간 150ms 를 유지한다. 올릴 때는 R2 상대라 동시 4.
7. **표지는 1장이 아닐 수 있다.** `plan` 의 1장은 거의 백지다(sharp `stats()` 실측 — 엔트로피
   0.09 · 평균 밝기 253.8/255, 2장은 1.67 · 239.2). 그래서 `coverPage: 2`. 표지 규칙을 바꾸면
   manifest 의 `derive.coverPage` 와 달라져 `cover.webp` 가 자동으로 다시 만들어진다.
8. **파생본 폭을 바꾸면 그 문서는 통째로 다시 만들어진다**(manifest 의 `derive.maxWidth` 비교).
   1차에 만든 원해상도 파생본이 이 규칙으로 전량 교체됐다. 반대로 폭이 같으면 장별로 건너뛰므로
   중간에 죽어도 다시 돌리면 된다.

## PDF·게시판 적재의 함정

1. **`plan`(939쪽)은 q80·q70 둘 다 100MB 를 넘는다** — 실측 q80 117.9MB · q70 102.4MB ·
   **q65 96.1MB**. 상한은 `MAX_PDF_UPLOAD_BYTES = 100 * 1024 * 1024`(= 100MiB,
   `src/lib/admin/upload-validate.ts`)이므로 **plan 만 `--quality=65`** 로 만든다.
   `build-pdf` 가 100MiB 초과를 경고로 알려 주니 그 줄이 뜨면 품질을 더 낮춰라.
   나머지 5종은 q80 에서 33~41MB 로 여유가 있다 — 굳이 같이 낮추지 마라.
2. **글의 고정 식별자는 `posts.id` 가 아니라 `posts.slug` 다.** `bk21rep-plan` ·
   `bk21rep-2021` … `bk21rep-2025`(docs.mjs 의 `postSlug`). 화면 리졸버가 이 문자열을
   하드코딩하므로 **바꾸면 링크가 전부 깨진다.** `posts.id` 는 `bigint generated always as
   identity` 라 문자열을 받지 못한다 — 텍스트 고정키가 들어갈 컬럼은 `slug text unique`
   하나뿐이고, `seed-reports.mjs` 의 멱등 키도 그것이다.
   같은 이유로 `attachments.id`(역시 bigint identity)에도 고정 id 를 줄 수 없어, 첨부는 글
   단위로 **통째 교체**한다(`delete by post_id` → `insert`). 크기 컬럼 이름도 `size` 가 아니라
   **`size_bytes`** 다.
3. **`posts.source_url` 에는 부분 유니크 인덱스가 걸려 있다.** 구 게시판 임포터가 같은 `.do`
   주소를 이미 가져갔다면 insert 가 충돌한다 — `seed-reports.mjs` 드라이런이 slug·source_url
   양쪽을 미리 조회해 충돌을 표로 알려 주고, 충돌이 있으면 `--apply` 도 아무것도 쓰지 않는다.
4. **결락은 PDF 에서도 그대로다.** plan 의 인쇄 쪽 307~324, report-2023 의 184~511 은 원본
   업로드에 없다(위 "원본 자체가 결락돼 있다"). 그래서 두 건만 `excerpt_ko/en` 에 안내 문구가
   실린다 — PDF 쪽수를 원본 쪽수인 양 쓰지 마라.
5. **본문(`body_html`)은 비워 둔다.** 화면이 첫 PDF 첨부를 펼침 리더로 그리는 구조라 본문
   HTML 이 곧 문서가 아니다. `body_html_ko` 는 not null 이라 빈 문자열, `body_html_en` 은 null.
6. **`created_at` 은 발간 실일자가 아니다** — 목록 정렬·연도 표기용 대푯값이다
   (plan `2020-09-01`, 보고서 `<연도>-12-31`).
7. **같은 R2 키에 덮어쓰지 않는다.** `upload-pdf` 는 `HeadObject` 로 이미 있으면 건너뛴다.
   캐시가 `immutable` 이라 내용을 바꿔 올리려면 R2 에서 지우고 다시 올려야 한다.
8. **`useObjectStreams:false` 로 저장한다.** 객체 스트림은 여러 객체를 한 덩어리로 압축해서,
   Range 로 한 쪽만 받고 싶은 리더가 덩어리째 받아야 한다. 끄면 쪽 객체가 각각 xref 주소를
   갖는다(파일은 조금 커지지만 리더가 필요한 쪽만 집어 간다).
