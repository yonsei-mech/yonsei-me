#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
public/img/labs, public/img/research 의 JPEG 를 WebP 형제 파일로 변환한다.

왜: 연구실 카드(LabCarousel)는 CSS background-image 라 next/image 최적화 경로를
    타지 못한다 — 원본 JPEG 이 그대로 나간다(홈 1회 로드 3.5MB). 런타임 최적화기
    대신 정적 WebP 를 미리 만들어 두고 컴포넌트가 확장자만 바꿔 가리킨다.

규약(LabCarousel.cardImageUrl 이 의존하는 불변식):
    public/img/labs/**.jpg, public/img/research/**.jpg 의 **모든** 파일은
    같은 이름의 .webp 형제를 가진다. 새 JPEG 을 넣었으면 이 스크립트를 다시 돌려라.

원본 JPEG 은 지우지 않는다 — 다른 페이지·JSON(content/labs-directory.json 등)이
아직 .jpg 경로를 참조한다.

추가로 public/img/eagle.png(CSS 마스크 .eagle-mask)를 무손실 WebP 로 변환한다.
마스크는 알파 채널이 그림 자체라 손실 압축을 쓰면 실루엣이 뭉개진다 → lossless.

실행:  python tools/images/convert-webp.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
JPEG_DIRS = [ROOT / "public" / "img" / "labs", ROOT / "public" / "img" / "research"]
EAGLE_PNG = ROOT / "public" / "img" / "eagle.png"

# 카드는 aspect-[7/8] w-[185px] sm:w-[290px] — 데스크톱 최대 290 CSS px 이라 DPR2 에서
# 580px, 폰(185px)은 DPR3 에서 555px 이면 충분하다. 그래서 상한은 640px 이다.
# (2026-09 이전에는 800 이었다 — 카드가 쓰지 않는 25% 폭을 그냥 내려보내고 있었다.)
MAX_WIDTH = 640
QUALITY = 88
METHOD = 6


def human(n: int) -> str:
    return f"{n:,}"


def convert_jpeg(src: Path) -> tuple[int, int, str]:
    """JPEG → 형제 .webp. (원본 바이트, 결과 바이트, 비고) 를 돌려준다."""
    dst = src.with_suffix(".webp")
    with Image.open(src) as im:
        im = im.convert("RGB")
        note = ""
        if im.width > MAX_WIDTH:
            h = round(im.height * MAX_WIDTH / im.width)
            note = f"resize {im.width}x{im.height} -> {MAX_WIDTH}x{h}"
            im = im.resize((MAX_WIDTH, h), Image.LANCZOS)
        im.save(dst, "WEBP", quality=QUALITY, method=METHOD)
    return src.stat().st_size, dst.stat().st_size, note


def convert_eagle() -> tuple[int, int, str] | None:
    if not EAGLE_PNG.exists():
        return None
    dst = EAGLE_PNG.with_suffix(".webp")
    with Image.open(EAGLE_PNG) as im:
        # 알파를 손실 없이 보존해야 마스크 실루엣이 픽셀 단위로 같다.
        if im.mode not in ("RGBA", "LA"):
            im = im.convert("RGBA")
        im.save(dst, "WEBP", lossless=True, method=METHOD)
    return EAGLE_PNG.stat().st_size, dst.stat().st_size, "lossless (alpha mask)"


def main() -> int:
    rows: list[tuple[str, int, int, str]] = []

    for d in JPEG_DIRS:
        if not d.is_dir():
            print(f"!! missing dir: {d}", file=sys.stderr)
            continue
        for src in sorted(d.glob("*.jpg")):
            before, after, note = convert_jpeg(src)
            rows.append((str(src.relative_to(ROOT)).replace("\\", "/"), before, after, note))

    eagle = convert_eagle()
    if eagle:
        before, after, note = eagle
        rows.append((str(EAGLE_PNG.relative_to(ROOT)).replace("\\", "/"), before, after, note))

    w = max((len(r[0]) for r in rows), default=10)
    print(f"{'file'.ljust(w)}  {'src bytes':>12}  {'webp bytes':>12}  {'saving':>8}  note")
    print("-" * (w + 50))
    tb = ta = 0
    for name, before, after, note in rows:
        tb += before
        ta += after
        pct = (1 - after / before) * 100 if before else 0.0
        print(f"{name.ljust(w)}  {human(before):>12}  {human(after):>12}  {pct:7.1f}%  {note}")
    print("-" * (w + 50))
    pct = (1 - ta / tb) * 100 if tb else 0.0
    print(f"{'TOTAL'.ljust(w)}  {human(tb):>12}  {human(ta):>12}  {pct:7.1f}%  {len(rows)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
