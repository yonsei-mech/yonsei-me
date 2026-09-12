# 연세대학교 기계공학부 홈페이지

기계공학부 공식 홈페이지입니다. 학부·대학원 소개부터 교수진, 연구, 공지·행사, 동문까지
한 곳에서 보여 주도록 만들었고, 한국어와 영어를 함께 지원합니다. 화면 크기에 맞춰
자동으로 배치가 바뀌고(모바일·태블릿·데스크톱), 시각장애인용 화면 낭독기에서도
읽히도록 접근성 기준(WCAG AA)을 지켜 만들었습니다.

> **이 문서를 읽는 분께**
> 대부분의 교수·조교 선생님은 아래 **[콘텐츠 바꾸기](#콘텐츠-바꾸기)** 한 챕터만 보시면 됩니다.
> 거의 모든 내용은 **관리자 콘솔(웹 화면)에서** 직접 고칠 수 있습니다. 프로그램을 돌리거나
> 서버를 관리하실 일은 없고, 그 부분은 문서 뒤쪽 [개발자·운영자용](#개발자운영자용) 으로
> 따로 모아 두었습니다.

---

## 사이트 구성 한눈에 보기

| 메뉴 | 담고 있는 것 |
| --- | --- |
| **학부 소개** | 학부 개요·연혁, 교수진, 교직원, 오시는 길, 입학 안내 |
| **학부(학사)** | 교육 목표, 졸업 요건, **졸업요건 자동 진단기**, 교과목 편람, 교과과정 로드맵, 동아리, 장학 |
| **대학원** | 졸업 요건(단계별 안내), 교과목, 연구실 소개 영상 |
| **연구** | 연구 비전, 연구 역량, 연구실 목록, 학부 인턴 모집, 사회공헌 |
| **소식** | 공지사항, 뉴스, 학위논문, 학술자료, 취업 정보 (게시판) |
| **동문** | 동문 소식·행사 |
| **연락처** | 주소·전화·지도 |

홈 화면은 위에서부터 **대형 히어로 → 학과 목표 → 학과 공지 → 학과 일정 → 뉴스 & 행사 →
우리의 연구실 → 인스타그램 → 푸터** 순으로 이어집니다.

---

## 콘텐츠 바꾸기

내용을 고치는 길은 두 가지지만, **거의 모든 것이 방법 A(관리자 콘솔)로 됩니다.**
방법 B(파일 편집)는 콘솔에 아직 없는 일부 항목에만 필요합니다.

### 방법 A — 관리자 콘솔에서 (대부분의 콘텐츠)

사이트 주소 뒤에 `/contentmanagement` 를 붙여 접속하면 관리자 콘솔이 열립니다.
- 예: `https://(사이트주소)/ko/contentmanagement`
- **GitHub 계정으로 로그인**합니다. (처음이시면 운영 담당자에게 GitHub 아이디를 알려 주세요.)
- 왼쪽 메뉴나 카드에서 편집할 항목을 고르면, 바로 한국어·English 를 입력합니다.
  **"한→영 번역"** 버튼으로 영문 초안을 채우고(검토는 한 번 해 주세요), 사진·첨부파일도 올립니다.
- 저장하면 반영됩니다. (콘솔 안에 "사용 방법 4단계", "새 관리자 등록 절차" 안내가 접이식으로
  들어 있으니 처음엔 그걸 펼쳐 보시면 됩니다.)

**콘솔에서 편집할 수 있는 것 (콘솔 메뉴 그대로):**

| 그룹 | 항목 |
| --- | --- |
| **뉴스·공지 게시판** | 뉴스, 공지(학부·대학원·외부기관·장학생 선발), 세미나, 행사, 학위논문심사, 자료실, 취업 정보 |
| **학과 소개** | 연혁, **교수진**(프로필 사진 포함), 교직원 |
| **학사·교과** | 학부 교과목(+ 체계도 로드맵), 교과목 설명, 대학원 교과목, 장학금 안내 |
| **학생 활동·연구** | 동아리 소개(카드뉴스·SNS 포함), **연구실 · 소개 영상**, 인턴 모집 |
| **동문** | 동문 뉴스, 동문 소식·네트워크 |

> 즉 학과가 평소 업데이트하는 **공지·행사·교수진·연구실·교과목·연혁·동아리·장학**이 전부
> 콘솔에서 됩니다. 파일을 직접 만질 일은 거의 없습니다.

**언제 반영되나요?**
- **게시판**(뉴스·공지·행사 등) → 저장하면 **몇 초 안에 바로** 반영됩니다(재배포 불필요).
- **그 외**(교수진·교과목·연혁·연구실·동아리·장학금 등) → 저장하면 GitHub 저장소에 커밋되고,
  **1~2분 뒤** 자동 반영됩니다.

### 방법 B — 파일 편집 (콘솔에 아직 없는 일부)

아래 항목은 콘솔에 없어 `content/` 폴더의 파일을 고쳐야 합니다. 파일 편집이 익숙하지
않으시면 **어떤 파일인지만 확인해 운영 담당자에게 요청**하시거나, **Claude code, Codex 등의 AI를 이용해 수정하셔도** 됩니다.

| 바꾸려는 것 | 여기를 고치세요 |
| --- | --- |
| 홈 첫 화면(히어로 슬라이드·사진) | `content/hero-slides.json` |
| 학과 목표(교육 목표) | `content/editorial-tabs.json` |
| 졸업요건 데이터·자동 진단기 기준 | `content/undergraduate-requirements.json`, `content/checker-requirements.json`, `content/liberal-arts.json` |
| 연구 분야·비전 소개 | `content/research-gallery.json` 등 `content/research-*.json` |
| 푸터의 "관련 사이트" 목록 | `content/related-sites.json` |
| 인스타그램 계정 | `content/instagram.json` |
| 일부 규정·안내 긴 본문(대학원 졸업요건·교과과정 등) | `content/pages/*.md` (장학금·동아리 본문은 콘솔에서 편집) |
| 메뉴·버튼 등 화면 UI 문구 | `messages/ko.json`, `messages/en.json` |

#### 한국어·영어 함께 쓰기 (파일 편집 시)

파일 안의 항목은 한국어와 영어를 **쌍으로** 적습니다. 예를 들어 관련 사이트 한 줄은
이렇게 생겼습니다.

```json
{ "label": { "ko": "연세대학교", "en": "Yonsei University" }, "href": "https://www.yonsei.ac.kr" }
```

`"ko"` 에는 한국어, `"en"` 에는 영어를 넣으면 방문자가 언어를 바꿀 때 알아서 반영됩니다.
**새 항목은 기존 항목을 그대로 복사해 값만 바꾸는 것**이 가장 안전합니다(따옴표·쉼표 같은
기호를 실수로 지우면 화면이 깨질 수 있어요). 콘솔(방법 A)에서는 화면의 한국어·English
입력칸을 쓰므로 이런 걱정이 없습니다.

파일을 고친 뒤에는 저장소에 반영(커밋·푸시)되면 Vercel 이 자동으로 다시 배포합니다
(보통 1~2분). 이 과정은 운영 담당자가 도와드립니다.

---

## 개발자·운영자용

아래부터는 사이트를 직접 실행하거나 배포·설정하는 분을 위한 내용입니다.

### 로컬에서 실행

```bash
npm install
npm run dev        # http://localhost:3000  → /ko 로 이동
npm run build      # 프로덕션 빌드(전 페이지 정적 생성)
npm start          # 빌드 결과 서빙
npm run typecheck  # 타입 검사(tsc --noEmit)
npm run lint       # ESLint
```

별도의 테스트 러너는 없습니다. 변경 후에는 `npm run typecheck` 와 `npm run build` 로
확인하는 것을 권장합니다. (dev와 build는 출력 폴더가 분리돼 있어 동시에 돌려도 서로
간섭하지 않습니다.)

### 기술 스택

- **Next.js 14 (App Router)** · **TypeScript** · **Tailwind CSS**
- **next-intl** — 한국어(`/ko`, 기본)·영어(`/en`) 라우팅. 모든 경로에 언어 접두사 유지(SEO).
- **Auth.js(GitHub OAuth)** — 관리자 콘솔 로그인
- **Supabase(Postgres)** + **Cloudflare R2** — 게시판 글·첨부 저장
- **DeepL** — 관리자 콘솔의 "한→영 번역"(선택)
- 배포: **Vercel**

### 관리자 콘솔(CMS)이 저장하는 방식

콘솔(`/contentmanagement`)은 정적 사이트에 맞춰 **두 갈래로** 저장합니다. 관리자에게 보이는
편집 화면은 같지만 내부 경로가 다릅니다.

- **게시판**(뉴스·공지·세미나·행사·학위논문·자료실·취업·인턴·동문) → **Supabase DB**
  (`posts`/`attachments` 테이블). `/api/admin/posts` 로 쓰고 `revalidateTag('posts')` 로
  ISR 캐시를 갱신해 **재배포 없이 수 초 내** 반영됩니다. 읽기는 `src/lib/posts.ts` 로 일원화돼
  있으며, `SUPABASE_URL` 이 없거나 `BOARDS_SOURCE=git` 이면 `content/board.json`·`news.json`
  (오프라인·롤백용)을 대신 읽습니다.
- **참조 데이터·문서**(연혁·교수진·교직원·교과목 3종·동아리·연구실·장학금md) → **GitHub
  Contents API** 로 `content/*.json`·`content/pages/*.md` 를 **직접 커밋**("Git이 곧 DB").
  Vercel 이 그 커밋을 자동 배포해 1~2분 뒤 반영됩니다. 콘솔에 노출할 항목·폼은
  `src/lib/admin/resources.ts`(컬렉션)와 `src/lib/admin/boards.ts`(게시판)에 선언되어 있어,
  새 편집 항목을 늘리려면 이 파일에 정의를 추가하면 됩니다.

> 설계 의도: **자주 바뀌고 타이밍이 중요한 게시물**은 DB(즉시 반영), **가끔 바뀌는 구조적
> 참조 데이터**는 Git(버전관리·롤백·정적 안정성). 데이터 성격에 맞춘 하이브리드입니다.

### 폴더 구조

```
content/            # ← 콘텐츠(코드 아님)
  pages/*.md        #   긴 본문(마크다운)
messages/           # 화면 UI 문구(ko.json / en.json)
src/
  app/[locale]/     # 언어별 라우트(ko, en)
    page.tsx        #   홈
    about/ undergraduate/ graduate/ research/
    faculty/ faculty-recruitment/ news/ alumni/ contact/ sitemap/
    contentmanagement/   # 관리자 콘솔(로그인 필요, 검색 색인 제외)
  app/api/          # admin/posts(게시판 DB 쓰기)·auth(로그인)·translate·upload 엔드포인트
  components/       # 재사용 컴포넌트(Header, Footer, Hero, …)
    admin/          #   콘솔 UI(AdminConsole·BoardEditor·CollectionEditor·MarkdownEditor …)
  lib/
    content.ts faculty.ts pages.ts posts.ts   # 사이트 읽기 계층
    admin/          #   콘솔 스키마·저장(resources·boards·github·posts-server …)
  i18n/             # next-intl 설정
  middleware.ts     # 언어 라우팅 + 관리자 경로 보호
tailwind.config.ts  # 디자인 토큰(색상/타이포)
src/app/globals.css # CSS 변수 토큰 + 다크모드 + 접근성 스타일
tools/              # 개발용 원본 자료(스크랩·CSV 등). 자세한 건 tools/README.md
```

### 환경변수 · 배포

필요한 환경변수(로그인·번역·DB·첨부 스토리지)는 **`.env.example`** 에 키와 발급 방법이
정리돼 있습니다. 로컬은 `.env.local`, 배포는 Vercel 프로젝트 환경변수에 넣습니다.

- Vercel에 이 `yonsei-me/` 폴더를 프로젝트 루트로 연결하고 환경변수를 채우면 빌드·배포됩니다.
- **콘솔 편집자 추가**: 로그인 허용은 `ALLOWED_GITHUB_LOGINS` 에 GitHub 계정명 추가.
  참조 데이터(Git 커밋) 편집까지 하려면 그 계정을 저장소 **Collaborator(write)** 로도 초대해야
  합니다(게시판만 쓸 사람은 불필요). 환경변수 변경은 재배포부터 적용됩니다.
- **도메인 컷오버**(`me.yonsei.ac.kr` 이전): 절차·검증 명령·롤백은 **`CUTOVER_CHECKLIST.md`**
  에 따로 정리돼 있습니다. 학교 DNS 는 레코드 교체 방식이라 제약이 있어 순서가 중요합니다.

### 접근성 · 다국어 · SEO

- 시맨틱 HTML, `aria-*`·`aria-current`, 키보드 내비게이션, `:focus-visible` 포커스 링,
  본문 바로가기(skip-link), `prefers-reduced-motion` 존중, 색 대비 AA.
- 전 페이지 정적 생성(SSG)으로 빠른 로딩. 구조화 데이터(JSON-LD)·메타 설명·`sitemap.xml`·
  사람용 `/sitemap` 페이지 제공.

### 디자인 토큰

연세 네이비(`#00285E`)·블루(`#0057A8`) 기반. `tailwind.config.ts` 의 `yonsei.*` 와
CSS 변수(`--brand`, `--surface`, `--content`)로 관리하며 다크모드(`.dark`)에 대응합니다.
새 색을 하드코딩하기보다 기존 토큰을 쓰는 것을 권장합니다.

---

궁금한 점이나 사이트에 반영이 필요한 내용은 운영 담당자에게 편하게 요청해 주세요.
