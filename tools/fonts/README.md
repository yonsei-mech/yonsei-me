# tools/fonts/

웹폰트 원본과 생성 도구. **폴더 자체는 `.gitignore` 대상**이고(연세체 TTF 라이선스 문제),
아래 셋만 예외로 추적한다: `split-dynamic-subset.py` · `korean-slices.json` · `src/`.

## src/ — 원본 폰트

- `src/PretendardVariable.woff2` (2,057,688 B, 가변 wght 100–900) — 본문 서체 `--font-sans`
- `src/GmarketSansBold.woff2` (590,972 B, 고정 700) — 홈 히어로 제목 전용 `--font-hero`

두 파일은 예전에 `src/app/fonts/` 에 있었고 `next/font/local` 이 통짜로 실었다. 지금은
**빌드 입력**일 뿐이라 `src/` 로 옮겼다. 라이선스 원문은 그대로 `src/app/fonts/LICENSE-*.txt`
에 남아 있다(Paperlogy 는 여전히 `next/font` 가 싣는다 — 건드리지 않았다).

## 동적 서브셋 (unicode-range 분할)

첫 방문마다 폰트만 ~2.8MB 가 내려가던 걸(느린 4G 에서 그것만 ~15초) 없애기 위해,
두 폰트를 `unicode-range` 를 단 `@font-face` 조각으로 서빙한다. 브라우저는 **그 페이지에
실제로 나온 문자가 속한 조각만** 내려받는다. 폰트마다 분할 방식(`scheme`)이 다르다:

- **GmarketSans — `slices`**: 구글 폰트 Korean 과 같은 구간표(`korean-slices.json`, 124조각)
  그대로. 이 폰트엔 한글 음절이 관여하는 문맥 룩업·커닝이 없어(실측 0개) 어떻게 쪼개도
  원본과 픽셀 단위로 같다. 히어로 제목 "연세대학교 기계공학부"는 5조각 ~120KB 로 끝난다.
- **Pretendard — `core`**: KS X 1001 상용 2,350자 + 음절이 아닌 글리프 전부(라틴·기호·자모·
  PUA 대체형)를 `PretendardVariable.core.woff2` **한 파일(~740KB)** 에 담고, 남은 희귀 음절
  8,822자만 구간표로 쪼갠다. 이유: Pretendard 는 `calt` 문맥 룩업 39개가 한글 옆의 `:` `—`
  같은 문장부호를 한글용 변형 글리프로 바꾸는데, 문장부호와 한글이 **다른 파일**이면
  셰이퍼가 문맥을 못 봐 기본 글리프가 나온다(구글식 조각으로 픽셀 비교했더니 콜론·줄표가
  1px 어긋났다, 2026-09-10). 상용 한글과 문장부호를 한 파일에 두면 그 문맥이 원본 그대로
  살아난다. 희귀 음절 바로 옆의 문장부호만 이 한계에 남는다(2,350자 밖 음절 + 문장부호 인접).

**글리프는 하나도 버리지 않는다.** 생성기가 매번 "조각 전체의 cmap 합집합 == 원본 cmap"
을 단언하고, 안 맞으면 exit 1 로 죽는다. 구간표가 못 덮는 코드포인트는 `rest` 조각
하나로 회수한다(`core` 스킴에선 음절이 아닌 것이 전부 core 에 들어가 보통 비어 있다).
그래서 CMS 로 어떤 글자를 새로 써 넣어도 오늘과 똑같이 렌더된다.

검증 스크립트(세션 scratchpad `fontdiff/fontdiff.mjs`): 원본 통짜 woff2 와 조각 CSS 로 같은
문장(굵기 7종·희귀 음절·기호·한자 폴백 포함)을 헤드리스 Chrome 에 그려 픽셀 비교한다.
**합격 기준은 차이 픽셀 0.**

### 재생성

```bash
python tools/fonts/split-dynamic-subset.py     # fontTools + brotli 필요
```

출력 (스크립트가 넷 다 한 번에 만든다 — CSS·매니페스트와 파일이 어긋날 수 없다):

- `public/webfonts/pretendard/PretendardVariable.<id>.<hash8>.woff2` (`<id>` = core · 구간표 번호 · rest)
- `public/webfonts/gmarket/GmarketSansBold.<id>.<hash8>.woff2`
- `src/app/webfonts.css` — `@font-face` 전량 + 지표 보정 폴백 2개. **손으로 고치지 말 것**
- `src/app/webfonts-manifest.ts` — `WEBFONTS[font][id] → URL`. preload 가 경로를 여기서 찾는다.

파일명의 `<hash8>` 은 내용 sha256 앞 8자리다. `public/` 정적 파일은 Vercel 이
`max-age=0`(매 방문 재검증)으로 내보내므로 `next.config.mjs` 의 `headers()` 가 `/webfonts/*` 에
`immutable` 1년을 건다 — 그래서 내용이 바뀌면 이름도 바뀌어야 하고, 경로를 코드에 직접 적지
말고 매니페스트로 찾아야 한다.

`src/app/[locale]/layout.tsx` 가 `webfonts.css` 를 import 하고, 폰트 패밀리는
`src/app/globals.css` 의 `:root` 에서 `--font-sans` / `--font-hero` 로 연결된다.

### 함정

- **`public/fonts/` 는 `.gitignore` 대상이지만 `public/webfonts/` 는 아니다.** 조각 파일은
  반드시 커밋해야 배포된다(생성물이지만 Vercel 빌드는 파이썬을 돌리지 않는다).
- 조각의 `unicode-range` 는 구간표 그대로가 아니라 **실제로 담긴 cmap** 으로 다시 쓴다.
  구간표를 그대로 쓰면 폰트에 없는 글자까지 그 조각에 묶여, 오늘은 폴백 서체로 넘어가던
  글자가 두부(.notdef)로 보인다.
- 서브셋은 힌팅·레이아웃 피처(`--layout-features='*'`)·name 테이블을 전부 보존한다.
  피처를 줄이면 파일은 작아지지만 `tabular-nums`(ResearchGallery) 같은 게 조용히 죽는다.
- 가변 폰트를 인스턴스화하지 않는다 — `fvar`/`gvar` 이 남아 100–900 전 굵기가 유지된다.
- 조각 경계를 넘는 커닝·합자는 적용되지 않는다(구글 폰트도 같은 절충). 한글은 완성형이라
  영향이 없고, 라틴 합자는 전부 한 조각(id 123)에 들어 있다.
- preload: `[locale]/layout.tsx` 의 `<head>` 가 Pretendard `core` 한 파일을, 홈
  `[locale]/page.tsx` 가 히어로 제목이 쓰는 지마켓 조각 5개(123·116~119)를 preload 한다.
  구간표나 히어로 문구가 바뀌면 지마켓 목록을 다시 재야 한다(어떤 조각을 받는지는 CDP 로
  실측). 빠진 조각은 늦게 올 뿐 글자가 빠지진 않는다.
