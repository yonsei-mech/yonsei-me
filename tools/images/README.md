# tools/images

`convert-webp.py` — `public/img/labs/*.jpg` · `public/img/research/*.jpg` 를 형제 `.webp` 로,
`public/img/eagle.png` 를 무손실 `eagle.webp` 로 변환한다(원본은 남긴다).

왜: 연구실 카드는 리스트를 2회 렌더해 66장이라 런타임 최적화기(`next/image`)에 태우지 않는다 —
원본 JPEG 이 그대로 나가면 홈 1회 로드가 3.5MB 였다. 정적 WebP 를 미리 만들고 컴포넌트가
확장자만 바꿔 가리킨다(`src/components/LabCarousel.tsx` 의 `cardImageUrl`).

**긴 변 상한 `MAX_WIDTH = 640`** (2026-09 이전 800). 카드 폭이 데스크톱 최대 290 CSS px 이라
DPR2 에서 580px, 폰(185px)은 DPR3 에서 555px — 640 이면 어느 화면에서도 축소만 일어난다.
800 이던 시절에는 카드가 쓰지 않는 폭을 25% 더 내려보내고 있었다. 바꾼 뒤에는 **반드시 다시
돌려서** 두 디렉터리의 `.webp` 를 전부 재생성해야 한다(원본 JPEG 은 건드리지 않는다).

⚠️ **불변식**: 위 두 디렉터리의 모든 `.jpg` 는 같은 이름의 `.webp` 형제를 가진다 —
`cardImageUrl` 이 존재 확인 없이 확장자만 바꾸므로, **JPEG 을 새로 넣었으면 반드시 다시 돌려라**.

```bash
python tools/images/convert-webp.py    # 저장소 루트(yonsei-me)에서
```
