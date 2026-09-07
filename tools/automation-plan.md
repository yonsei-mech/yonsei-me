# 크롤링 자동화 계획

작성 2026-09. 저장소의 크롤 파이프라인 전수 조사를 바탕으로, **무엇을 어떤 순서로
자동화할지**와 **일부러 자동화하지 않는 것**을 정리한 계획서입니다. 각 파이프라인의
상세 절차는 해당 디렉터리 README(`tools/checker/`, `tools/mileage/`)가 정본이고,
이 문서는 그 위의 운영 계획만 다룹니다. 백로그 항목별 구현 설계(파일·CLI·종료 코드·검증
절차)는 [`automation-spec.md`](automation-spec.md) 에 있습니다.

---

## 1. 현황 인벤토리

### A. 자동화 후보 5건 — 사이트 사용처와 출처 (4번 교재는 조사 후 제외)

각 데이터가 **사이트 어디에서 소비되고**(경로 · 컴포넌트), **어디에서 오는지**(원 출처
링크)를 먼저 고정합니다. 구체 계획은 이 표를 기준으로 씁니다.

| # | 데이터 | 사이트에서 쓰는 곳 | 원 출처 | 저장 위치(산출물) |
| --- | --- | --- | --- | --- |
| 1 | 교수 학술활동 프로필 — 셸(연락처·홈페이지) + 논문·수상·학술활동·연구과제·지적재산권 (31명) | 교수진 상세 `/{locale}/faculty/<교수이름>` (`src/app/[locale]/faculty/[slug]/page.tsx`, 전수 프리렌더) · CMS 교수진 "실적 불러오기" | 교원정보시스템 `devcms.yonsei.ac.kr` — 링크 상세 ① | Supabase `content_files` = `content/faculty-profiles/<이름>.json` |
| 2 | 수강편람 과목 카탈로그 — 2022-1~현재 전 학기 통합(학정번호 키·별칭) | 학부 › 졸업요건 진단기 `/{locale}/undergraduate/checker` (`GraduationChecker.tsx` 가 `/data/course-catalog.json` fetch) | 연세포털 수강편람 내부 API `underwood1.yonsei.ac.kr` — 링크 상세 ② | `public/data/course-catalog.json` + 이력 정본 `tools/checker/data/catalog-history.json` |
| 3 | 수강신청 마일리지 이력 — 2015-2~ 분반별 컷·배정·순위 | 학부 › 마일리지 전략 `/{locale}/undergraduate/mileage` (`MileagePlanner.tsx`, 번들 URL 은 `src/lib/mileage/bundle.ts` 의 `MILEAGE_TERM`) | 같은 수강편람 내부 API(요약·원장) — 링크 상세 ② | `public/data/mileage-<년>-<학기>[-detail].json` + `tools/mileage/data/mileage-history.db.gz` |
| 4 | 강의계획서 교재 — 과목별 주교재·부교재·참고자료 서지 + 표지 이미지 (**자동화 제외** — 사유 6절) | 학부 › 교과목 소개 `/{locale}/undergraduate/courses` 의 교재 팝업 (`CourseCatalog.tsx` → `TextbookPopover.tsx`; 대학원 교과목 페이지에는 미사용) | 수강편람 강의계획서(②) + 교보문고 CDN — 링크 상세 ③ | `content/textbooks.json` + `public/img/textbooks/<ISBN>.jpg` |
| 5 | 입학 캘린더 — 2026학년도 전형 일정 22건(수시 21 · 재외국민 1) | 소개 › 입학 안내 `/{locale}/about/admission` 3번 섹션 (`AdmissionGuide.tsx` → `AdmissionCalendar.tsx`) | 연세대 입학처 공지·모집요강 — 링크 상세 ④ | `content/admission-guide.json` 의 `calendar` 블록 |

수집 코드·주기·현재 상태:

| # | 수집 코드 | 주기 | 현재 상태 |
| --- | --- | --- | --- |
| 1 | `tools/crawl-faculty-profiles.mjs` + `src/lib/faculty-crawl/core.ts` (CMS 버튼 `/api/admin/faculty-crawl` 과 공용) | 매월 2일 03:00 KST | **자동화 완료** — `.github/workflows/crawl-faculty-profiles.yml` → DB 병합 |
| 2 | 외부 크롤러 `courses` 명령 + 래퍼 `tools/checker/crawl-terms.mjs` → `build-catalog.mjs` | 학기 1회 | 수동 — **로그인 쿠키 필요** |
| 3 | 외부 크롤러 `npm run mileage` + `tools/mileage/build-db.mjs` → `precompute.mjs` | 학기 1회 | 수동 — **로그인 쿠키 필요, 수 시간 소요** |
| 4 | 크롤 코드 없음 — 수업계획서는 JSON API 가 없는 ClipReport PDF 라 2026-08-20 수동 추출본(`Desktop\교재 매칭`)을 `generate_all_formats.py` 로 후처리 → `mirror-covers.mjs` → `build-content.mjs` | 학기 1회 | **자동화 제외**(6절) — 수동 갱신 |
| 5 | 수집 코드 없음 — 전량 수기 입력(관리자 콘솔 미지원, 파일 직접 편집) | 학년도 1회 전면 + 변경 시 | 수동 |

### 출처 링크 상세

**① 교원정보시스템** (공개 — 로그인 불필요)

- 상세 셸: `https://devcms.yonsei.ac.kr/faculty/name_search.do?mode=view&userId=<암호화ID>`
- 리포트: `https://devcms.yonsei.ac.kr/faculty/name_search.do?mode=report&userId=<암호화ID>&reportType=<article|award|conference|funding|patent>` — 100행 초과 시 2쪽은 `mode=report_next` (원본 제공은 분류당 최대 2쪽·200건)
- `userId` 는 각 프로필 파일의 `sourceUrl` 에 저장돼 있고, 옛 `me.yonsei.ac.kr` 표기는 `core.ts` 의 `infoHost()` 가 devcms 로 바꿔 요청합니다.

**② 연세포털 수강편람 시스템** (로그인 세션 쿠키 `YONSEI_COOKIE` 필요 — 수 시간 만료) — ⚠️ 2026-09-06 실측 정정: 읽기 API 5종 모두 **Cookie 없이 정상 응답**. 쿠키는 게이트(NetFunnel·점검) 시 통과용 선택 사항. 상세는 `automation-phase3.md` 1절

- 베이스: `https://underwood1.yonsei.ac.kr/` — 과목 카탈로그·마일리지 요약/원장·강의계획서 모두 이 시스템의 내부 `.do` API 입니다.
- **요청 규약** (크롤러 `src/api.js` 실측 정본 — 2026-09-03 크롤러 사본에서 확정):
  - 전부 **POST**, `Content-Type: application/x-www-form-urlencoded` + `Cookie: <YONSEI_COOKIE>`.
  - eXBuilder6/Cleopatra 폼 인코딩: 고정 파라미터 `_menuId=MTA5MzM2MTI3MjkzMTI2NzYwMDA=` ·
    `_pgmId=NDE0MDA4NTU1NjY=` · `_menuNm=`(빈 값), 데이터 필드는 `@d1#<필드명>=<값>` 키,
    말미에 `@d#=@d1#` · `@d1#=dmCond` · `@d1tp=dm` 세 항목 고정.
  - 응답 본문이 `{` 로 시작하지 않으면 **세션 만료**(로그인 HTML) — 크롤러의 만료 판정 기준.
- **엔드포인트 5개** (전부 `/sch/sles/` 하위, 크롤러 `src/courses.js`·`mileage.js`·`backfill.mjs`):

  | 용도 | 경로 | 핵심 파라미터 | 응답 데이터셋 |
  | --- | --- | --- | --- |
  | 코드 목록 (캠퍼스→대학→학과 3단) | `SlescsCtr/findSchSlesHandbList.do` | `dsNm=dsCampsBusnsCd\|dsUnivCd\|dsFaclyCd`, `lv1~lv3`(상위 코드·`%`), `univGbn=A`, `findAuthGbn=8`, `level=B`, `syy`, `smtDivCd` | `dsNm` 과 동명 (신촌 학부는 `deptCd='s1'`) |
  | 과목 목록 | `SlessyCtr/findAtnlcHandbList.do` | `syy`, `smtDivCd`, `campsBusnsCd='s1'`, `univCd`, `faclyCd`, `hy`(학년), `cdt='%'`, `kwdDivCd='1'`, `searchGbn='1'` 등 | `dsSles251` — **200건 상한**, 초과 시 `hy=1~6` 분할 재조회 |
  | 마일리지 학기 목록 | `SlessyCtr/findMlgSyySmtDivCdList.do` | `sysinstDivCd`, `subjtnb`, `corseDvclsNo`, `prctsCorseDvclsNo` | `dsSyySmtDivCd` — **최근 6학기 롤링 창** |
  | 마일리지 요약 | `SlessyCtr/findMlgAppcsResltList.do` | 위 4개 + `syy`, `smtDivCd`, `syySmtDivCd` | `dsSles251[0]` |
  | 마일리지 순위(원장) | `SlessyCtr/findMlgRankResltList.do` | 요약과 동일 | `dsSles440` |

  옛 학기는 학기 목록 API 를 거치지 않고 요약·원장에 `syy`·`smtDivCd` 를 직접 지정하면
  조회됩니다(2015-2 까지 실측 — `backfill.mjs` 가 이 방식). 요청 간 지연은 크롤러 기준
  40~150ms + 동시성 5~6, 실패 시 1초 간격 2회 재시도.
- **강의계획서(교재)는 API 가 없습니다** (2026-09-04 확정) — 수업계획서는 JSON 데이터셋이
  아니라 ClipReport 리포트 엔진이 PDF 로 렌더링합니다(`Y.Report.callReport()` 가
  `slessy0020_prn01.crf`, 영문·캠퍼스·학번대별 01~11 변형을 리포트 서버에 POST — 2026-07-31
  세션 실측). 포털 딥링크는 `/com/lgin/SsoCtr/initExtPageWork.do?link=sylla&params=<base64>`.
  `Desktop\교재 매칭` 의 2026-08-20 결과 JSON 은 화면에서 수동 추출한 것이고, 크롤 코드는
  이 PC 어디에도 없습니다(Desktop·Documents·Downloads 코드 파일 전수 스캔 + 세션 기록
  검색). 따라서 교재 파이프라인은 **자동화 대상에서 제외**합니다(6절).
- 크롤러 정본 저장소: <https://github.com/yonsei-mech/yosnei-mileage-crawler> — 이관 상태는 3절 **2-0**.

**③ 교재 표지**

- 교보문고 CDN: `https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/<ISBN>.jpg` — ⚠️ 미보유 ISBN 도 HTTP 200 + `image/jpeg` 헤더의 플레이스홀더(실제는 PNG 34,150B)를 주므로 JPEG 매직바이트로 판별.
- 교보 미보유·오기 ISBN 의 대체 출처(Open Library 등)는 `tools/textbooks/mirror-covers.mjs` 의 `FALLBACK`/`OVERRIDE` 표에 ISBN 별 URL·검수 근거가 명시돼 있습니다.

**④ 연세대 입학처·일반대학원** (공개 — 로그인 불필요)

- 수시: `https://admission.yonsei.ac.kr/seoul/admission/html/rolling/`
- 정시: `https://admission.yonsei.ac.kr/seoul/admission/html/regular/`
- 편입: `https://admission.yonsei.ac.kr/seoul/admission/html/transfer/`
- 대학원: `https://graduate.yonsei.ac.kr/graduate/admission/`
- 참고: 링크 허브 페이지(`/{locale}/admission`)는 같은 섹션의 `guide.asp` 딥링크(예 `…/rolling/guide.asp`)를 씁니다.
- ⚠️ 실측(2026-09-04): 위 디렉터리 루트 URL 4개 중 `admission.yonsei.ac.kr/…/rolling|regular|transfer/` 와 `graduate.yonsei.ac.kr/graduate/admission/` 은 **403** 이고, 열리는 것은 `guide.asp`·`notice.asp`(EUC-KR)와 대학원 `index.do` 입니다. 입학 캘린더의 원 출처는 `…/html/counsel/calendar.asp?s_year=<YYYY>` 입니다(변경 감지 워커의 1순위 대상).

### B. 1회성 완료 — 자동화 제외 (5건)

구 게시판 10종 전량(`tools/crawl-boards.mjs`), 구 사이트 자산 R2 미러링
(`scripts/mirror-legacy-assets.mjs`), 첨부 크기 백필, 구 홈페이지 정적 페이지 스크랩
(`tools/import-raw/`), 연구실 연구주제 수집(`tools/labs/`). 제외 사유는 [6절](#6-자동화하지-않는-것).

---

## 2. 원칙 (모든 단계 공통)

1. **상대 서버 배려** — 순차 처리 + 요청 간 300ms, 식별 가능한 User-Agent, HEAD 금지
   (WAF 403). 기존 크롤러의 매너 규칙을 새 워커에도 그대로 적용합니다.
2. **파괴적 자동 반영 금지** — 자동 실행은 병합 전용(교수 실적)이거나 감지·알림 전용
   (입학처)입니다. 덮어쓰기가 필요한 파이프라인(학기 갱신)은 사람이 게이트를 통과시킵니다.
3. **검증 게이트 없이는 반영 없음** — 각 파이프라인의 기존 게이트(학기 일치 검증,
   build-catalog exit 1, verify-matching 6/6, `--verify-against` 불일치 0, 백테스트 공통
   분반 비교, typecheck)를 자동화가 우회하지 않습니다.
4. **비밀값** — `YONSEI_COOKIE`(학사 계정 세션)는 저장소·Actions 어디에도 저장하지
   않습니다. 이 저장소는 Public이므로 Actions Secrets 추가는 항목마다 사람이 판단합니다
   (`crawl-faculty-profiles.yml` 머리말의 service-role 키 주의와 동일).
5. **알림 채널은 GitHub Issue 하나로 통일** — 실패·변경 감지·정기 리마인더 모두
   `GITHUB_TOKEN`(issues: write)으로 이슈를 만듭니다. 이력이 남고 추가 인프라가 없습니다.

---

## 3. 단계별 계획

### Phase 1 — 로그인 불필요 · 즉시 착수 가능

**1-1. 교수 학술활동 워크플로 실패 가시화** (기존 자동화 보강)

현재 `tools/crawl-faculty-profiles.mjs`는 개별 요청이 실패해도 로그만 남기고 exit 0으로
끝나므로, 원본 마크업 변경·차단 같은 구조적 실패가 나도 **워크플로는 초록불**입니다.

- 스크립트에 실패 임계 초과 시(예: 대상의 20% 이상 전부 실패) exit 1 옵션을 추가하고
  워크플로에서 켭니다. 병합 전용 설계라 부분 실패는 데이터를 훼손하지 않으므로,
  임계 미만 실패는 로그로 충분합니다.
- 워크플로에 `if: failure()` 스텝으로 실행 로그 링크를 담은 이슈를 자동 생성합니다.
  (같은 제목의 열린 이슈가 있으면 중복 생성하지 않습니다.)

**1-2. 입학처 변경 감지 워커** (신규 — 입학 캘린더의 자동화 형태)

입학처 일정은 구조화 API가 아니라 공지 HTML·모집요강 PDF이고, 파일 disclaimer부터
"세부 시간·장소 변경 가능"인 데이터라 **무검수 자동 반영은 하지 않습니다**. 대신:

- 주 1회 GitHub Actions로 입학처의 **공식 입학 캘린더**(`counsel/calendar.asp` — 우리
  `admission-guide.json` 의 일정이 바로 이 표에서 온 것) · 모집요강 PDF 링크(`guide.asp`) ·
  공지 목록(`notice.asp`)을 받아 정규화한 뒤 직전 스냅샷과 비교합니다. 디렉터리 루트
  (`rolling/` 등)는 403 이라 대상이 아닙니다 — 실측과 파서 설계는 `automation-spec.md` 3절.
- 스냅샷은 전용 브랜치(예: `bot/admission-watch`)에 봇 커밋으로 보관해 main을 오염시키지
  않습니다. 변경이 있으면 diff 요약을 이슈로 올리고, 담당자가 확인 후
  `content/admission-guide.json`을 갱신합니다(영문은 콘솔의 DeepL 번역 재사용).
- 새 학년도 전환(모집요강 공표기, 통상 4~5월)에는 감지와 별개로 **연 1회 전면 재작성
  리마인더 이슈**를 만듭니다(1-3의 리마인더 워크플로에 포함). 현재 파일이 2026학년도분이라
  **2027학년도 갱신이 첫 실전**입니다.

**1-3. 정기 리마인더 워크플로** (신규 1개로 통합)

cron 스케줄 하나짜리 워크플로가 시기별 체크리스트 이슈를 만듭니다. 사람이 해야 하는
작업(쿠키 갱신이 필요한 학기 크롤, 입학 캘린더 재작성)의 누락을 막는 게 목적입니다.

| 시기(안) | 이슈 내용 |
| --- | --- |
| 12월 초 · 1월 중순 · 6월 초 · 7월 중순 | 새 학기(겨울·1학기·여름·2학기) 데이터 갱신 체크리스트 — `tools/checker/README.md`·`tools/mileage/README.md` 절차 링크 + 교재 수동 갱신 항목(6절) |
| 4월 말 | 새 학년도 입학 캘린더 전면 재작성 |

시기는 실제 수강신청·모집요강 공표 일정에 맞춰 조정합니다(cron 값만 고치면 됨).

### Phase 2 — 학기 파이프라인 반자동화 (쿠키만 사람이)

핵심 병목은 `YONSEI_COOKIE`입니다: 학사 계정 로그인 세션이고 수 시간이면 만료되며
커밋·Secrets 저장 금지 대상입니다. 그래서 목표를 "완전 무인"이 아니라 **"쿠키 한 번
넣으면 나머지 전 단계가 스스로 돈다"**로 잡습니다.

**2-0. 크롤러 저장소 이관** (✅ 결정·정리 완료 2026-09-04 — 남은 것은 푸시 1회)

원격 `yonsei-mech/yosnei-mileage-crawler` 는 **이미 비공개**(`gh repo view`: PRIVATE, 용량
2MB)이고, 로컬에서만 만들어졌던 556만 줄 데이터 커밋은 원격에 간 적이 없습니다(185MB
단일 파일이라 GitHub 100MB 한도에 걸려 푸시 자체가 불가 — 폐기). 초기 커밋 `ae1242e` 의
`.env` 에 세션 쿠키가 들어갔던 이력은 사실이지만, 비공개 저장소 + 2026-07-26 발급으로
이미 만료된 세션 ID 라 실효 위험이 없습니다.

**결정: 비공개 유지, 이력 재초기화(force-push)는 하지 않는다.** 얻는 것(만료 쿠키·2MB
데이터 제거)이 force-push 의 실수 비용보다 작습니다. 대신 로컬에서 정리 커밋 `be347a5`
를 만들었습니다(origin/main 위 fast-forward — `git push origin main` 만 하면 됨):

1. ✅ `.env`·`courses.json`·`mileage_data.json` 추적 해제 + `.gitignore`(쿠키·산출물·
   백업 세대·`courses.json.pre-checker`). 파일은 디스크에 그대로 남아 파이프라인이 씁니다.
2. ✅ 코드 반영 — `mileage.js` 동시 워커·키 기반 재개, `backfill.mjs`(2015-1~2023-1 소급),
   `run-update.mjs`(크롤→에러 재시도→build-db→precompute 원샷), README·기본 학기.
3. ✅ README 의 쿠키 경고 블록 유지.
4. ✅ 이 저장소 참조 갱신 — `tools/mileage/README.md` 의 저장소 URL 을 yonsei-mech 로.
   `tools/checker/crawl-terms.mjs` 의 `CRAWLER_DIR` 기본값(로컬 경로)은 그대로 유효.

참고: 저장소 이름의 오타(`yosnei-`)는 GitHub 이 옛 이름을 리다이렉트하므로 고쳐도 되지만
필수는 아닙니다 — 고치면 이 문서·두 README·로컬 origin URL 을 함께 바꿉니다.
`run-update.mjs` 는 마일리지 구간 한정이라 2-1 의 `update-semester.mjs` 가 흡수·대체합니다.

**2-1. 원샷 오케스트레이터 `tools/automation/update-semester.mjs`** (신규 — 설계는 `automation-spec.md` 4절)

로컬(크롤러 repo가 있는 머신)에서 `node tools/automation/update-semester.mjs --target 2027-10`
한 번으로 다음을 순서대로 실행·검증합니다. 각 단계는 기존 스크립트를 그대로 호출하고,
게이트 실패 시 그 지점에서 멈춰 **재실행하면 이어서 진행**합니다(기존 이어받기 설계 활용).

```
① checker:   crawl-terms --only <신학기> → build-catalog(게이트) → verify-matching 6/6
② mileage:   크롤러 courses + npm run mileage → build-db --base --verify-against
             → backtest 신·구 공통 분반 비교(리포트 출력, 채택 판단은 사람)
             → precompute --target → bundle.ts MILEAGE_TERM 갱신
③ 마무리:    npm run typecheck → 커밋 대상 파일 목록 출력(명시 스테이징 — git add -A 금지)
   (교재는 자동화 제외 — 6절)
```

- 쿠키 만료(FatalError)는 정상 시나리오로 취급: "쿠키 갱신 후 같은 명령 재실행" 안내를
  출력하고 exit 1. 지금 수동 절차와 동일한 복구 경로입니다.
- `professor-history.csv` 보강, `RECENCY_ALIAS` 재검토, backtest 채택 판단처럼 **판단이
  필요한 지점은 자동화하지 않고** 체크리스트로 출력만 합니다.
- 커밋·푸시는 하지 않습니다. 산출물 검토 후 사람이 커밋합니다(마일리지 README의
  "측정하지 않은 개선은 주장하지 않는다" 원칙과 명시 스테이징 규칙 유지).

### Phase 3 — 완전 무인화 검토 (착수 보류, 판단 필요)

> 2026-09-04: 반자동·수동 반영 3건(2·3·5)을 사람 없이 돌리기 위한 구체 계획을
> [`automation-phase3.md`](automation-phase3.md) 로 분리했습니다 — 병목 3개(로그인 쿠키·실행 주체와
> 판단·반영과 번역)와 단계 P3-0~P3-6. 아래 두 단락은 그 문서가 출발점으로 삼은 당초 판단입니다.

- **쿠키 자동 발급(학교 SSO 자동 로그인)은 권장하지 않습니다.** 학사 계정 보안과 이용
  약관 리스크가 있고, 실패 시 계정이 잠기는 최악 시나리오의 비용이 자동화 이득보다
  큽니다. 하려면 별도 계정·학교 측 협의가 선행돼야 합니다.
- 차선: 쿠키 수명(수 시간) 안에 전 단계가 끝나도록 오케스트레이터를 로컬 cron/작업
  스케줄러에 걸고, 시작 직전에만 사람이 쿠키를 갱신하는 "예약 반자동"까지가 현실적
  상한입니다. 마일리지 이력 크롤이 수 시간 걸리므로 최근 6학기 롤링 창 안에서
  이어받기가 되는 현 구조가 전제입니다.

---

## 4. 스케줄 총괄 (계획 완성 시점 기준)

| 무엇 | 방식 | 주기 |
| --- | --- | --- |
| 교수 학술활동 수집 | GitHub Actions (기존) + 실패 이슈(1-1) | 매월 2일 03:00 KST |
| 입학처 변경 감지 | GitHub Actions (신규 1-2) | 주 1회 |
| 학기 갱신·입학 캘린더 리마인더 | GitHub Actions (신규 1-3) | 연 5회 이슈 |
| 학기 데이터 갱신 (체커·마일리지) | 로컬 오케스트레이터 (신규 2-1) — 쿠키는 사람 | 학기 1회, 리마인더로 트리거 |

## 5. 리스크와 열어 둔 결정

| 리스크 / 결정 | 대응 |
| --- | --- |
| 원본 마크업 변경으로 파서 실패 (전 크롤러가 실측 기반 정규식) | 1-1 실패 가시화로 조기 감지. 파서 수정은 수동 — 실측 주석이 있는 해당 모듈만 고친다 |
| Public repo에 Supabase service-role 키 Secrets 유지 여부 | 기존 워크플로 머리말대로 사람 판단 사항으로 유지. 대안: 크롤 전용 최소 권한 키 발급 검토 |
| 입학처 페이지 구조 변경·차단 | 감지 워커는 실패해도 사이트에 무영향(알림 전용). 실패 자체도 이슈로 보고 |
| 마일리지 `--base` 누락 시 과거 이력 소실 | 오케스트레이터가 `--base`·`--verify-against`를 강제 인자로 고정 |
| 스냅샷 브랜치 비대화 (입학처 감지) | 정규화된 텍스트만 저장(수 KB), 연 1회 스쿼시 |
| 크롤러 저장소의 공개/비공개 | ✅ 결정: **비공개 유지**(이미 PRIVATE, 2-0). Actions 에서 쓰려면 체크아웃 토큰이 필요해짐(당장은 로컬 실행이라 무관) |

## 6. 자동화하지 않는 것

- **구 게시판 재크롤** — 컷오버 전까지만 **신규 글만** 매일 동기화합니다
  (`tools/automation/board-sync.mjs`, P3-7 · 작업 스케줄러 `yonsei-me board-sync` 04:30).
  기존 글의 **수정·삭제·상단고정 변경은 동기화하지 않습니다** — 이미 적재된 글은 R2
  미러링·링크 재작성을 거쳤는데 원문으로 덮으면 그 가공이 되돌아갑니다. 도메인 컷오버 후
  게시판 정본은 우리 Supabase+CMS이므로 그날 **작업을 해제**하고
  (`register-tasks.ps1 -Unregister -Only board-sync`) `tools/crawl-boards.mjs`는 다시
  아카이브 도구로 은퇴합니다.
- **연구실 홈페이지 정기 재크롤** — `tools/labs/README.md`가 경고하듯 PDF·사용자 제공
  8건은 재크롤로 복원되지 않고, 구형 사이트 함정(HTTP 전용·자체서명 인증서·EUC-KR·JS
  렌더링) 탓에 무인 크롤 신뢰도가 낮습니다. AI 연구요약 문안은 CMS에서 관리 중이므로
  필요할 때 수동 갱신합니다. (선택 아이디어: `labs-directory.json` 외부 링크 생존
  확인만 월 1회 자동화 — 죽은 링크 이슈 보고. 저부하·무검수 가능이라 Phase 1에 편입 가능)
- **교재(강의계획서) 파이프라인** — 수업계획서는 JSON API 없이 ClipReport 가 PDF 로
  렌더링하는 화면이라(1절 ②) 크롤러를 새로 쓰려면 리포트 엔진 응답을 파싱해야 하고,
  실제 대상은 학과 개설 과목 30여 개/학기에 교재 등록 과목은 그 절반입니다. 학기당
  한 번 화면에서 뽑아 `Desktop\교재 매칭` 의 후처리(`generate_all_formats.py`) →
  `tools/textbooks/mirror-covers.mjs` → `build-content.mjs` 로 반영하는 지금 절차가
  더 경제적입니다. 1-3 리마인더 이슈의 학기 체크리스트에 항목으로만 넣습니다.
- **학교 SSO 자동 로그인** — 5절 리스크 판단 전까지 금지.

## 7. 구현 백로그

| # | 작업 | 단계 | 규모 | 비고 |
| --- | --- | --- | --- | --- |
| 0 | 크롤러 저장소 이관 마무리 | 2-0 | S | ✅ 결정·정리 완료 — 로컬 커밋 `be347a5` 를 `git push origin main` 하면 끝 |
| 1 | 교수 수집기 실패 임계 exit 2 + 실패 이슈 스텝 | 1-1 | S | ✅ 2026-09-04 `20bc9a3` — `--fail-threshold`·`--timeout-ms`, 이슈 헬퍼 `tools/automation/issue.mjs`. 푸시 후 dispatch(simulate_failure·dry_run)로 워크플로 경로 확인 필요 |
| 2 | 입학처 스냅샷·diff 스크립트 + 주 1회 워크플로 | 1-2 | M | ✅ 2026-09-04 — `admission-watch.mjs` + `admission-watch.yml`(공식 캘린더 구조 파싱·모집요강 PDF·공지, 스냅샷 브랜치 `bot/admission-watch`). 첫 실행이 우리 캘린더 오류 2건을 잡음(외국국적 오타·12/29 6차 충원 시각) |
| 3 | 정기 리마인더 워크플로 (체크리스트 이슈 5종) | 1-3 | S | ✅ 2026-09-04 `530c181` — `reminders.yml` + `remind.mjs` + 템플릿 3종(정규/계절/입학 캘린더). 첫 실전 12/1 |
| 4 | `tools/automation/update-semester.mjs` 오케스트레이터 | 2-1 | L | ✅ 2026-09-04 `3d1f38e`(+ 학기 목록 단일화 `5666fc1`, build-db base 겹침 방어 `984b05d`). 2026-20 재생성으로 무회귀 확인. 첫 실전 2026-21(12월) |
| 5 | ~~교재 파이프라인 분리 옵션~~ | — | — | 삭제 — 교재는 자동화 제외(6절) |
| 6 | (선택) 연구실 링크 생존 체크 워커 | 6절 | S | 이슈 보고 전용 |
| 7 | (보류) 예약 반자동 실행 검토 | 3 | — | 5절 결정 후 |

권장 착수 순서는 1 → 3 → 2 → 4였고, **2026-09-04 에 네 항목 모두 구현·로컬 검증을 마쳤습니다.**
워크플로 3종의 실기 확인도 끝났습니다(2026-09-04 dispatch: 교수 수집 simulate_failure →
빨간불 + 실패 이슈 #1 생성 → 재실행 시 댓글 → 시험 이슈 닫음 / 리마인더 dry-run / 입학처 감시
첫 실행 orphan 경로 dry-run). 남은 것은 첫 실전뿐입니다 — 10/2 교수 수집, 매주 월요일 입학처
감시(첫 실 스케줄에서 `bot/admission-watch` 브랜치 생성), 12/1 리마인더 → 2026-21 오케스트레이터.
1·3은 반나절 규모로 즉시 효과가 있습니다. 2는 2027학년도 입학 캘린더 갱신 전
(2027년 봄)까지만 준비되면 됩니다. 4는 0이 끝나야 크롤러를 저장소 기준으로 부를 수
있으므로 그 뒤에 착수하되, 다음 학기 갱신(2026-21 겨울, 12월경)을 첫 실전으로 삼아
그전에 완성하는 것을 목표로 합니다.
