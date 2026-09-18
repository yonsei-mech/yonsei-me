# tools/labs/

연구실 탭의 **AI 연구요약** 기능에 쓸 연구 주제 원본 데이터입니다. 빌드에는 관여하지 않는
개발 보조 자료라 `tools/` 아래 둡니다.

## research-topics.json

33개 연구실의 연구 주제를 각 연구실 **공식 홈페이지**에서 수집한 것입니다.

- 연구실 명단·외부 링크는 학부 연구실 페이지
  <https://me.yonsei.ac.kr/me/research/lab2.do> 의 표에서 뽑았습니다. 이 페이지의
  연구실명 링크는 내부 상세 페이지가 아니라 **각 연구실 홈페이지로 바로** 연결됩니다.
- 레코드마다 `evidence` 에 출처 페이지의 원문 발췌를 남겼습니다. **내용을 추측하거나
  생성하지 않았고**, 접근 실패한 곳은 `status: "failed"` 로 비워 두고 사유를 `note` 에 적었습니다.
- `content/labs-directory.json` 과는 `professorKo` 또는 `nameKo` 로 조인할 수 있습니다.

**33곳 전부 `ok` 입니다** (`partial` 0, `failed` 0).

## 출처 구분 — 재수집 시 반드시 확인할 것

| `provenance` | 뜻 | 건수 |
|---|---|---|
| (필드 없음) | 연구실 공식 홈페이지에서 직접 수집 | 25 |
| `department-pdf` | 홈페이지가 죽었거나 차단돼 **학부 PDF**에서 확보 | 6 |
| `user-supplied` | 홈페이지가 이미지 기반이라 **사용자가 원문 제공** | 2 |

⚠️ **크롤러를 다시 돌려도 `department-pdf`·`user-supplied` 8건은 복원되지 않습니다.**
덮어쓰지 마십시오. 해당 8건: 강신일 · 김우철 · 송순호 · 양현석 · 윤준영 · 전흥재(PDF),
이준상 · 정효일(사용자 제공).

`topics` 항목 앞의 **`[PDF]`** 접두사는 홈페이지 수집분에 학부 PDF 내용을 덧붙였다는 표시입니다
(김대은·이준상·정효일·현재상). 접두사가 없으면 홈페이지에서 온 것입니다.

## 보조 출처: 학부 '연구분야 소개' PDF

`https://devcms.yonsei.ac.kr/cms/resFileDownload.do?siteId=me&type=etc&fileName=labs.pdf`
(<https://me.yonsei.ac.kr/me/graduate/labs.do> 의 "연구실 소개자료")

**35쪽**이고 1쪽 표지, **2~34쪽에 연구실당 한 쪽씩**(33곳 전부) `Research Area` 슬라이드,
35쪽 'Thank you' 입니다. 접근 불가였던 6곳을 이걸로 전부 메웠습니다. 대부분 쪽은 텍스트 레이어가
있어 `pdftotext -enc UTF-8` 로 추출됩니다. 쪽 이미지는 아래 '연구실 소개자료 뷰어' 의
`build-brochure.mjs` 로 굽습니다(pdfjs 렌더링 — `pdftoppm` 불필요).

한계:
- **강건욱**(2쪽)·**김용준**(8쪽)은 텍스트 레이어가 없는 이미지 쪽이라 텍스트 추출로는 아무것도
  나오지 않습니다. ⚠️ 예전 이 문서는 "강건욱 연구실만 PDF에 없다"고 적었는데 **틀렸습니다** —
  텍스트 추출 결과만 보고 내린 오판이고, 2쪽에 실려 있습니다(렌더링으로 확인).
- **민경민**(14쪽)은 텍스트 레이어가 있지만 글꼴 매핑이 깨져 판독 불가, **이형석**(26쪽)은 이름
  석 자만 텍스트입니다. 이 네 곳 모두 홈페이지 수집분이 이미 충분해 문제되지 않았습니다.
- 슬라이드라 그림 캡션이 본문과 섞여 나옵니다. **전흥재**(29쪽)는 텍스트가 겹쳐 추출돼 일부
  문장이 뒤섞였고, 판독 가능한 항목만 옮겼습니다.

## 연구실 소개자료 뷰어 — `build-brochure.mjs`

구 사이트의 "연구실 소개자료" 버튼(위 PDF 32MB 통째 다운로드)을 새 사이트에선 **사이트 안 이미지
뷰어**로 되살립니다. 이 스크립트는 그 뷰어가 쓰는 쪽 이미지를 굽고, 원본 PDF 를 R2 에 올립니다.

- **원본**: <https://devcms.yonsei.ac.kr/cms/resFileDownload.do?siteId=me&type=etc&fileName=labs.pdf>
  (35쪽, 32,191,417B, 쪽마다 870×630pt 가로형)
- **쪽↔교수 대응은 `content/lab-brochure.json` 이 단일 출처**입니다(`cover: 1`, `pages[]` 에
  `{page, professorKo}` 33건, 출력 경로 `imageBase`). 스크립트는 이 JSON 을 읽기만 하고, 여기
  적힌 표지 + 쪽만 굽습니다(35쪽 'Thank you' 는 제외).

```bash
node tools/labs/build-brochure.mjs render     --pdf "<labs.pdf 경로>" [--force]
node tools/labs/build-brochure.mjs check      --pdf "<labs.pdf 경로>"
node tools/labs/build-brochure.mjs upload-pdf --pdf "<labs.pdf 경로>" [--apply]   # 기본 드라이런
```

| 명령 | 하는 일 | 산출물 |
|---|---|---|
| `render` | 쪽마다 1740px 로 한 번 그려 본 이미지·썸네일 두 벌을 뽑는다. 있는 파일은 건너뜀(`--force` 로 다시) | `public/img/labs/brochure/pNN.webp`(폭 1740, q78) · `…/thumb/pNN.webp`(폭 360, q70) |
| `check` | 쪽마다 교수 이름·첫 이메일을 텍스트 레이어에서 찾아 `faculty-directory.json` 과 대조. 항상 exit 0 | 콘솔 표만 |
| `upload-pdf` | 원본 PDF 를 R2 `uploads/legacy/labs/labs-brochure-v1.pdf` 에 올린다(immutable 캐시, 이미 있으면 생략) | 공개 URL → `content/lab-brochure.json` 의 `pdf.url` 에 붙여 넣기 |

실측(2026-09-18): 34장 본 이미지 6.40MB(장당 82~254KB) + 썸네일 0.62MB(7~25KB).
`check` 는 이메일 28/28 일치, 텍스트로 확인 못 하는 5쪽(2·8·14·26·33)은 렌더링 이미지로 눈 확인 완료.

**새 판이 오면**
1. 새 PDF 를 받아 `check` 부터 돌린다 — 쪽이 밀렸으면 `content/lab-brochure.json` 의 `pages[]`
   (쪽↔교수)와 `pdf.bytes`·`pdf.pageCount` 를 고친다. 텍스트 레이어 없는 쪽은 썸네일을 눈으로 본다.
2. `render --force` 로 전 쪽을 다시 굽는다(빠진 교수의 `pNN.webp` 는 지운다).
3. 스크립트의 `PDF_VERSION` 을 `v2` 로 올리고 `upload-pdf --apply` → 새 URL 을 `pdf.url` 에 넣는다.
   R2 객체는 immutable 캐시라 **같은 키(v1)에 덮어쓰면 옛 파일이 계속 서빙**된다.

## 수집할 때 걸린 함정

구형 `.yonsei.ac.kr` 연구실 사이트가 많아 일반적인 페치 도구로는 절반 가까이 실패합니다.

- **HTTP 전용 서버**: `optomecha`, `ssd` 는 443 이 ECONNREFUSED 다. HTTP→HTTPS 를 강제
  승격하는 도구(WebFetch 등)로는 절대 못 읽는다. `http://` 그대로 요청해야 한다.
- **자체 서명 인증서**: `nos`, `mems`, `mdophm` 은 self-signed cert 오류가 난다.
  검증을 끄고(`rejectUnauthorized: false`) 요청해야 한다.
- **EUC-KR 인코딩**: 구형 사이트는 UTF-8 이 아니다. charset 을 보고 디코딩하지 않으면
  한글이 깨진다.
- **JS 렌더링**: `mcmclab` 은 정적 요청 시 본문이 빈 채로 온다. 헤드리스 브라우저가 필요하다.
- **JS 라우팅**: `nemd` 의 메뉴는 `javascript:main_topsub02(n)` 이다. 실제 주소는
  `/pagegenerater.asp?catalogid=nemd&language=ko&pagecode=sub02_0n`.
- **주제별 개별 페이지**: `ssd` 는 연구주제 4개가 `research_topic.html` ~ `_4.html` 로
  나뉘어 있어 첫 페이지만 보면 1/4만 얻는다.

위 조건을 모두 처리하는 수집 스크립트는 세션 스크래치패드의 `fetch-lab.mjs` 였습니다
(리다이렉트 추적 + 인증서 무시 + charset 디코딩). 재수집이 필요하면 같은 방식으로 만드십시오.

## 사이트 데이터에 반영이 필요한 발견

`content/labs-directory.json` 의 링크 상태 문제입니다. **이 파일은 다른 세션이 관리하므로
여기서 고치지 않았습니다.**

| 연구실 | 교수 | 문제 |
|---|---|---|
| 산술 광학 영상 및 응용 | 주철민 | `boilab.wordpress.com` → **`https://cii-yonsei.com/` 로 이전**(301 2단계). 링크 갱신 필요 |
| 지능형 구조 및 통합 설계 | 전흥재 | `isid.yonsei.ac.kr` **도메인 만료** — cafe24 만료 안내로 리다이렉트 |
| 어드밴스드 열공학 | 김우철 | `atel.yonsei.ac.kr` **서버 다운** (80 timeout / 443 refused) |
| 내연기관 & 청정에너지 | 송순호 | `cleanenergy.yonsei.ac.kr` **서버 다운** (80·443 모두 refused) |
| 정밀제어시스템 | 양현석 | `mservo.yonsei.ac.kr` **서버 다운** (ping 100% 손실) |
| 마이크로 나노 응용 기술 개발 | 강신일 | `nanofab.yonsei.ac.kr` **IP 차단**(IIS 403.503 IpRestrictionModule). 교내망에서는 열릴 수 있음 |
| 정밀 생산 메카트로닉스 | 윤준영 | 연구실 홈페이지가 **아예 없음** (학부 표에서 유일하게 링크 없음, PDF에도 'webpage under construction') |
| 생체역학 및 연성재료 | 이형석 | 홈페이지 영문명이 `Mechanobiology and Soft Materials Lab. (MSML)` — 학부 표기와 다름 |
| 내연기관 & 청정에너지 | 송순호 | PDF에 병기된 대체 주소 `engine.yonsei.ac.kr` 도 403 — 살아있는 주소가 없음 |
| 바이오칩 | 정효일 | PDF는 `nanobio.yonsei.ac.kr` 로 표기 — 학부 표의 Google Sites 주소와 다름 |

### 연락처 불일치 (학부 연구실 표 vs PDF·faculty-directory)

| 교수 | 학부 연구실 표 | PDF |
|---|---|---|
| 양현석 | 공학관 A283 / 02-2123-7214 | 제1공학관 584호 / 02-2123-2824 |
| 윤준영 | 공학관 A190 / 02-2123-7445 | 제1공학관 N205호 / 02-2123-2817 (← `faculty-directory.json` 과 일치) |

이 데이터셋의 `location`·`phone` 은 **학부 연구실 표 기준**을 그대로 두었습니다. 사이트에
반영할 때 어느 쪽을 신뢰할지 판단이 필요합니다.

## 이 데이터로 만든 사이트 문안 — `content/lab-summaries.json`

연구실 목록(연구 › 연구실)의 **'AI 연구요약' 패널 문안**입니다. 실시간 생성이 아니라 미리 써 둔
문장이고, 위 `research-topics.json`(각 연구실 공식 홈페이지 + 학부 '연구분야 소개' PDF)을
학부생 이상 눈높이로 압축한 것입니다. 기법명·응용처 같은 고유명사는 일부러 남겨 둡니다 —
진학을 판단하는 정보라 쉬운 비유로 바꾸면 가치가 사라집니다.

- 파일 최상위가 곧 `{ "<지도교수 한글 이름>": { "ko": …, "en": … } }` 인 객체이고,
  키는 `content/labs-directory.json` 의 `professorKo` 와 조인합니다.
- **값에 개행을 넣지 마십시오.** 패널이 `white-space: pre-line` 이라 줄바꿈이 그대로 빈 줄이 됩니다.
- 분량 기준: 한국어 180~230자, 영어 320~420자(패널에서 약 3줄).
- 관리자 콘솔의 **'연구실 · 소개 영상'** 리소스에서 각 연구실의 **'자세히'** 폼으로 편집합니다
  (Supabase `content_files` 가 원본, 저장소의 이 파일은 빌드 시점 폴백 스냅샷).
