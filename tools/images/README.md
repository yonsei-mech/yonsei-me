# tools/images

`convert-webp.py` — `public/img/labs/*.jpg` · `public/img/research/*.jpg` 를 형제 `.webp` 로,
`public/img/eagle.png` 를 무손실 `eagle.webp` 로 변환한다(원본은 남긴다).

왜: 연구실 카드는 CSS `background-image` 라 `next/image` 최적화를 못 탄다 — 원본 JPEG 이
그대로 나가 홈 1회 로드가 3.5MB 였다. 정적 WebP 를 미리 만들고 컴포넌트가 확장자만 바꿔 가리킨다
(`src/components/LabCarousel.tsx` 의 `cardImageUrl`).

⚠️ **불변식**: 위 두 디렉터리의 모든 `.jpg` 는 같은 이름의 `.webp` 형제를 가진다 —
`cardImageUrl` 이 존재 확인 없이 확장자만 바꾸므로, **JPEG 을 새로 넣었으면 반드시 다시 돌려라**.

```bash
python tools/images/convert-webp.py    # 저장소 루트(yonsei-me)에서
```
