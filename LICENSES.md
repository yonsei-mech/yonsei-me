# 자산 라이선스 가이드

연세대학교 기계공학부 홈페이지에 사용된 **서체·이미지·로고·오픈소스 소프트웨어**의 출처와
이용 근거를 정리한 문서다. Git 저장소에 커밋되어 실제 배포본에 포함되는 자산 전량을 다룬다.

모든 항목은 ① 저장소에서 직접 확인되는 사실 ② 배포처 공식 문서 ③ 파일에 내장된 메타데이터로
뒷받침되며, [부록 A](#부록-a-검증-절차)의 명령으로 누구나 재현할 수 있다.

- **최종 갱신**: 2026-08-01
- **성격**: 제작자 자체 점검 결과이며 법률 자문이 아니다.

---

## 0. 요약

| 구분 | 수량 | 라이선스 근거 |
|---|---|---|
| 서체(웹폰트) | 3종 4파일 | SIL Open Font License 1.1 |
| 연세체 워드마크 | — | 폰트 파일 미배포 · SVG 패스만 포함 |
| 오픈소스 라이브러리 | 35종 | MIT · Apache-2.0 · ISC · GSAP 표준 라이선스 |
| 스톡 사진 | 61장 | Unsplash License (표기 의무 없음) |
| 학과 자료 | 64장 | 학과 공식 사이트 — 동일 주체의 홈페이지 개편안 |
| 동아리 사진 | 26장 | 각 동아리로부터 게재 전제 직접 제공 |
| 자체 제작 그래픽 | 6개 | 본 프로젝트 제작물 |
| 기업 로고 | 23개 | 위키미디어 커먼즈 · 상표의 지명적 사용 |
| 연세대 상징 | 3개 | 학교 상징의 자체 학과 홈페이지 사용 |

**카피레프트(GPL/AGPL) 의존성 0건, 출처 표기 의무가 발생하는 자산 0건.**

---

## 1. 서체 — 3종 전부 SIL Open Font License 1.1

배포되는 폰트 파일은 아래 4개가 전부다.

```
src/app/fonts/PretendardVariable.woff2
src/app/fonts/GmarketSansBold.woff2
src/app/fonts/Paperlogy-6SemiBold.woff2
src/app/fonts/Paperlogy-7Bold.woff2
```

| 서체 | 사용처 | 저작권자 | 배포처 |
|---|---|---|---|
| Pretendard (Variable) | 본문·UI 전역 (`--font-sans`) | Kil Hyung-jin | [github.com/orioncactus/pretendard](https://github.com/orioncactus/pretendard) |
| Gmarket Sans Bold | 홈 히어로 제목 (`--font-hero`) | eBay Korea Co., Ltd. | [corp.gmarket.com/fonts](https://corp.gmarket.com/fonts/) |
| Paperlogy 6·7 | 탭·세부탭 제목 (`--font-subhead`) | PT& (이주임) | [freesentation.blog/paperlogyfont](https://freesentation.blog/paperlogyfont) |
| Newsreader Italic 500 | 동문 인터뷰 목록의 'more' 링크 | Production Type | [fonts.google.com/specimen/Newsreader](https://fonts.google.com/specimen/Newsreader) |

> Newsreader(2026-09 추가)는 구글 폰트가 배포하는 **라틴 서브셋 woff2 한 조각**만
> 자체 호스팅한다(`public/webfonts/newsreader/newsreader-italic-500-latin.woff2`,
> 25.6KB · `@font-face` 는 `src/app/globals.css`). 서브셋 역시 OFL 1.1 이 허용하는
> 파생이며, 예약 이름을 쓰는 파생 폰트의 재배포가 아니라 동일 서체를 웹 포맷으로
> 싣는 것이라 이름 제약과 무관하다(아래 '포맷 변환' 문단과 같은 근거).

**이용 근거.** OFL 1.1은 폰트를 웹사이트에 임베딩·번들·재배포하는 것을 명시적으로 허용한다
("The fonts, including any derivative works, can be bundled, embedded, redistributed and/or
sold with any software"). 금지되는 것은 폰트를 그 자체로 판매하는 행위와 다른 라이선스로
재배포하는 행위이며, 본 사이트는 어느 쪽에도 해당하지 않는다.

**포맷 변환.** 세 서체 모두 원본 TTF를 `woff2`로 변환해 자체 호스팅한다(용량·성능 목적).
OFL 1.1은 수정·파생을 허용하므로 포맷 변환은 허용 범위 내이며, 예약 이름(Reserved Font
Name)을 쓰는 파생 폰트를 배포하는 것이 아니라 동일 서체를 웹 포맷으로 싣는 것이므로 이름
제약과도 무관하다. 원본 TTF/OTF 묶음(`public/fonts/`)은 `.gitignore`에 등재되어 저장소에도
배포본에도 포함되지 않는다.

**저작권 고지.** OFL 1.1 제2항에 따라 폰트 사본과 같은 디렉터리에 서체별 라이선스 파일을
동봉한다.

```
src/app/fonts/LICENSE-Pretendard.txt     # 배포 묶음의 LICENSE.txt 원본 그대로
src/app/fonts/LICENSE-GmarketSans.txt    # 폰트 name 테이블 license 필드 전문
src/app/fonts/LICENSE-Paperlogy.txt      # 저작권 고지 + SIL OFL 1.1 전문
```

> ⚠️ Gmarket Sans의 라이선스 본문은 표준 OFL 1.1에 저작권자가 **조항 6)을 추가한 판본**이다
> (제작물 이미지의 폰트 홍보 활용에 관한 조항). 표준 OFL 전문으로 대체하지 말 것.

### 1-1. 연세체 워드마크

헤더 로고의 "연세대학교 기계공학부" 워드마크는 연세대학교 전용 서체(연세체)로 조판되어
있으나, **연세체 폰트 파일은 저장소에도 배포본에도 포함되지 않는다.**

빌드 이전 단계에서 `tools/generate-wordmark.mjs`가 글자의 외곽선을 SVG path 데이터로 변환해
`src/components/logo-wordmark.ts`로 출력해 두고, 배포되는 것은 그 좌표 데이터뿐이다. 원본
TTF가 놓이는 `tools/fonts/`는 `.gitignore`에 등재되어 있다.

이 구분은 국내 판례와 일치한다.

- **대법원 1996. 8. 23. 선고 94누5632 판결** — 서체도안(글자꼴 자체)은 실용적 기능과 별개의
  독립적 예술성을 갖추지 않는 한 저작권법상 저작물에 해당하지 않는다.
- **대법원 2001. 5. 15. 선고 98도732 판결** — 반면 **폰트 파일**은 컴퓨터프로그램저작물로
  보호된다. 침해가 성립하는 지점은 폰트 파일의 복제·배포다.

본 사이트는 보호 대상인 폰트 파일을 복제·배포하지 않고, 보호 대상이 아닌 글자 외곽선만을
도형 데이터로 사용한다. 워드마크의 내용은 연세대학교 기계공학부 자신의 명칭이고 본 사이트는
해당 학과의 홈페이지이므로, 표장 사용의 주체·목적도 어긋나지 않는다.

---

## 2. 오픈소스 소프트웨어

`package.json`에 선언된 런타임·빌드 의존성 전량이다.

| 라이선스 | 패키지 |
|---|---|
| **MIT** | next 14.2.35, react 18.3.1, react-dom, next-intl, tailwindcss, postcss, autoprefixer, eslint, eslint-config-next, @supabase/supabase-js, @tiptap/* (11종), lenis, marked, sanitize-html, opentype.js, @types/* (4종) |
| **Apache-2.0** | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, tesseract.js, typescript |
| **ISC** | next-auth (v5 beta) |
| **GSAP 표준 라이선스** | gsap 3.15.0 |

**GSAP.** 유일하게 MIT 계열이 아닌 의존성이다. 2025년 4월 30일 개정된
[GSAP Standard "No Charge" License](https://gsap.com/standard-license/)에 따라 상업적
프로젝트를 포함한 사용이 무료이고, 과거 유료(members-only)였던 SplitText·MorphSVG 등 모든
플러그인도 무상 사용 범위에 포함된다. 로열티나 귀속 표시 의무는 없다. 금지되는 것은 "코드
없이 시각적 애니메이션을 만드는 도구"를 GSAP으로 만드는 것으로, 본 사이트와 무관하다. 본
사이트가 사용하는 `gsap/SplitText`·`gsap/CustomEase`는 인증 토큰 없이 공개 배포판에서 그대로
받아 쓰는 모듈이다.

---

## 3. 사진·이미지

배포본에 포함되는 이미지는 **총 181개**다. 출처별 내역의 합계가 181과 일치한다.

> Unsplash 61 + 학과 자료 64 + 동아리 26 + 자체 제작 6 + 기업 로고 23(4절)
> + 연세대 엠블럼 1(5절) = **181**

### 3-1. 스톡 사진 — Unsplash (61장)

| 위치 | 수량 | 용도 |
|---|---|---|
| `public/img/labs/` | 33 | 연구실 카드 대표 이미지 |
| `public/img/programs/` | 13 | 학부·대학원 프로그램 카드 |
| `public/img/hero/`, `hero-mobile/` | 12 | 홈 히어로 슬라이드(6종 × 데스크톱/모바일 크롭) |
| `public/img/research/` | 3 | 연구 분야 카드 |

[Unsplash License](https://unsplash.com/license)는 사진의 다운로드·복제·수정·배포·사용을
**상업적 목적을 포함해 무상으로, 사진작가나 Unsplash에 대한 허락이나 출처 표기 없이**
허용한다. 금지되는 것은 사진 자체를 판매하는 행위와 Unsplash와 경쟁하는 유사 서비스를
만드는 행위이며, 본 사이트는 어느 쪽에도 해당하지 않는다. 따라서 **표기 의무가 없다.**

수급은 Unsplash 검색의 `license=free` 조건으로 한정하며, **Unsplash+ 및 Getty Images 유료
콘텐츠(`premium` 플래그)는 배제한다.**

### 3-2. 학과 공식 자료 (64장)

| 위치 | 수량 | 내용 |
|---|---|---|
| `public/img/faculty/` | 52 | 교수 프로필 사진 |
| `public/img/history/` | 4 | 학과 연혁 사진 (1960·1970·1990·2010) |
| `public/img/directions/` | 4 | 오시는 길 안내 사진 |
| `public/img/pages/` | 4 | 교육과정 로드맵, 연구 비전·BK21 사업단 비전 도표 |

출처는 연세대학교 기계공학부 공식 사이트(`me.yonsei.ac.kr`)다. 수집 경로는 저장소에 코드로
남아 있다(`tools/crawl-faculty-profiles.mjs` — 순차 요청 + 요청 간 300ms 지연으로 학교 서버
부하를 억제한다).

**이용 근거.** 본 사이트는 제3자를 위한 별개 서비스가 아니라 **같은 학과의 홈페이지 개편안**
이다. 해당 자료의 저작권·초상권 주체와 본 사이트가 대상으로 삼는 주체가 동일하므로, 자료가
원래 게시되던 목적(학과 소개)의 범위를 벗어나지 않는다. 다만 **실제 채택·운영 시에는 학과의
공식 승인 및 교원 개인의 초상 이용 동의 확인을 전제로 한다.**

### 3-3. 동아리 제공 사진 (26장)

| 위치 | 수량 | 내용 |
|---|---|---|
| `public/img/club-photos/` | 22 | 동아리 카드뉴스용 활동 사진 |
| `public/img/clubs/` | 4 | 동아리 대표 이미지 |

MECAR·ROBOIN·SPACEY·연세드론 4개 동아리로부터 **게재를 전제로 직접 제공받은 자료**다.
저작권자가 게재 목적을 알고 제공한 것이므로 이용 허락이 존재한다.

### 3-4. 자체 제작 (6개)

`public/img/hero.svg`, `feature-2.svg`, `program.svg`, `public/og/cover.png`,
`public/img/eagle.png`, `eagle_empty.png` — 본 프로젝트에서 제작·가공한 그래픽이다.
독수리 상징의 근거는 5절을 참조한다.

### 3-5. 배포본에 포함되지 않는 로컬 자산

다음은 작업 디렉터리에만 존재하고 커밋되지 않아 배포본에 포함되지 않으므로, 공개 게시 대상이
아니다.

- `public/img/LOGO_ENG.png`, `LOGO_KOR.png` — 코드 참조 0건. 미커밋.
- `public/img/board/`, `public/files/` — 게시판 첨부 샘플. 미커밋.
- `public/uploads/` — 로컬 첨부 업로드 폴더. `.gitignore` 등재.
- `public/fonts/` — 폰트 원본 TTF/OTF. `.gitignore` 등재.

---

## 4. 기업 로고 (23개)

`public/img/career-logos/`에 있는 졸업생 진출 기업 로고다. 진로 안내 탭(`CareerPaths`)에서
"이런 분야·기업으로 진출한다"는 **사실 정보를 식별**하기 위해 표시된다.

삼성전자, 현대자동차, LG, 포스코, 기아, 한화, 두산, 한국항공우주산업, HD현대중공업,
삼성중공업, 한화오션, 현대엔지니어링, 한국전력공사, 삼성E&A, LG에너지솔루션, 삼성SDI,
SK온, 현대모비스, 두산로보틱스, HL만도, LIG넥스원, ASML, Bosch.

**출처.** 위키미디어 커먼즈가 주된 수급처다. 파일 내부에 그 흔적이 남아 있다 — 다수의 SVG가
Inkscape로 생성되었고(`<!-- Created with Inkscape ... -->`), Creative Commons 네임스페이스
(`xmlns:cc="http://creativecommons.org/ns#"`)를 포함하며, `prod-posco.svg`에는 커먼즈의 SVG
정리 작업으로 알려진 기여자 서명(`by Marsupilami`)이 남아 있다.

**이용 근거는 저작권과 상표권 두 갈래로 나뉜다.**

1. **저작권** — 기업 로고 상당수는 문자와 단순 도형의 조합이어서 저작권 성립에 필요한
   창작성 요건을 충족하지 못한다. 위키미디어 커먼즈가 이런 로고를 `PD-textlogo`(저작권 성립
   요건 미달로 퍼블릭 도메인) 분류로 호스팅하는 근거가 이것이다.
2. **상표권** — 상표는 저작권과 별개의 권리이고, 퍼블릭 도메인이라도 상표로서는 계속
   보호된다. 다만 상표권은 **출처 혼동을 일으키는 사용**을 막는 권리이지 언급 자체를 막는
   권리가 아니다. 본 사이트의 사용은 **지명적 사용(nominative use)** — 그 기업을 가리키기
   위해 그 기업의 표장을 쓰는 것 — 에 해당한다:
   - 졸업생 진출 현황이라는 **사실을 서술**하는 맥락에서만 노출된다.
   - 후원·제휴·인증을 시사하는 문구나 배치가 없다.
   - 로고를 변형하거나 본 사이트의 식별표지처럼 쓰지 않는다.
   - 상업적 광고·판촉에 사용하지 않는다(비영리 대학 학과 홈페이지).

**대체 가능성.** 이 표시는 기업명 텍스트로 대체해도 정보 전달에 지장이 없다. 각 기업의 요청이
있을 경우 즉시 텍스트로 교체할 수 있도록, 로고 경로는 데이터 파일
(`content/career-paths.json`) 한 곳에서만 관리한다.

---

## 5. 연세대학교 상징

| 자산 | 사용처 |
|---|---|
| `public/logo.svg` | 헤더·푸터 엠블럼, 학부 입학 안내 그래픽 |
| `public/img/eagle.png` | 로딩 인디케이터, 대학원 안내 그래픽, 빈 상태 마스코트 |
| `src/components/logo-wordmark.ts` | 헤더 워드마크 (1-1절) |

연세대학교의 엠블럼과 독수리 상징은 학교의 식별표지다. 본 사이트는 **연세대학교 기계공학부
자신의 홈페이지**이므로, 표장을 그 소유 주체를 가리키기 위해 쓰는 정당한 사용에 해당한다.
제3자가 연세대와의 관련성을 가장하는 사용이 아니다. 실제 운영 시에는 연세대학교 UI(University
Identity) 가이드라인의 색상·여백·변형 금지 규정을 따르는 것을 전제로 한다.

---

## 6. 텍스트 콘텐츠 및 외부 서비스

학과 게시판 게시글과 교육과정·교원 정보 등 본문 데이터는 학과 공식 사이트에서 이전한 것으로,
3-2절과 동일한 근거(동일 주체의 홈페이지 개편안, 원 게시 목적의 범위 내)가 적용된다.

지도는 카카오맵이 공식 제공하는 임베드 위젯(`roughmap`)을 그 배포 방식 그대로 불러오며
(`src/components/KakaoMap.tsx`), 지도 데이터를 복제해 재호스팅하지 않는다.

---

## 부록 A. 검증 절차

이 문서의 주장은 아래 명령으로 제3자가 직접 재현할 수 있다. 모두 `yonsei-me/`에서 실행한다.

**① 배포되는 폰트 파일과 라이선스 고지 확인**

```bash
git ls-files src/app/fonts public/fonts
```

**② 의존성 라이선스 전량 수집**

```bash
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));for(const n of [...Object.keys(p.dependencies),...Object.keys(p.devDependencies)]){const m=JSON.parse(fs.readFileSync('node_modules/'+n+'/package.json','utf8'));console.log((n+'@'+m.version).padEnd(42)+(m.license||'?'));}"
```

**③ 이미지 메타데이터에 제3자 출처 마커가 없음을 확인**

```bash
node -e "const fs=require('fs'),path=require('path');let hit=0;for(const d of ['public/img/labs','public/img/programs','public/img/research','public/img/hero','public/img/hero-mobile','public/img/history','public/img/club-photos','public/img/clubs','public/img/directions','public/img/pages']){for(const f of fs.readdirSync(d)){const s=fs.readFileSync(path.join(d,f)).subarray(0,200000).toString('latin1');const m=s.match(/(flickr|wikimedia|pexels|getty|shutterstock)/i);if(m){hit++;console.log(d+'/'+f+' :: '+m[0]);}}}console.log(hit?hit+' hit':'clean');"
```

**④ 배포되는 이미지 목록 전량**

```bash
git ls-files public/img public/og public/logo.svg
```

## 부록 B. 참고 문헌

- [SIL Open Font License 1.1](https://openfontlicense.org/) — 서체 3종 공통 라이선스
- [Pretendard 저장소](https://github.com/orioncactus/pretendard)
- [G마켓 공식 폰트 안내](https://corp.gmarket.com/fonts/)
- [Paperlogy 공식 배포 페이지](https://freesentation.blog/paperlogyfont)
- [Unsplash License](https://unsplash.com/license)
- [GSAP Standard "No Charge" License](https://gsap.com/standard-license/)
- [대법원 1996. 8. 23. 선고 94누5632 판결](https://casenote.kr/대법원/94누5632) — 서체도안의 저작물성 부정
- 대법원 2001. 5. 15. 선고 98도732 판결 — 폰트 파일의 컴퓨터프로그램저작물성 인정
