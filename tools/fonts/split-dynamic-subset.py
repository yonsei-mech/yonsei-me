#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pretendard Variable / GmarketSans Bold 를 구글 폰트식 "동적 서브셋"으로 쪼갠다.

왜: next/font 로 통짜 woff2 를 싣던 시절, 첫 방문마다 Pretendard 2.06MB +
지마켓산스 591KB 가 무조건 내려갔다(홈 기준 폰트만 ~2.8MB). 한글 폰트는 글자가
많아 파일이 큰데, 한 페이지가 실제로 쓰는 음절은 수백 자뿐이다.

어떻게: 구글 폰트 Korean 이 쓰는 것과 같은 유니코드 구간표(korean-slices.json,
124조각)로 나눠 조각마다 @font-face 를 만들고 `unicode-range` 를 붙인다. 브라우저는
페이지에 실제로 나온 문자가 속한 조각만 내려받는다. **글리프는 하나도 버리지 않는다** —
조각을 전부 합치면 원본 cmap 과 정확히 같다(아래 커버리지 단언이 이를 강제한다).
따라서 CMS 로 어떤 글자를 새로 써 넣어도 오늘과 똑같이 렌더된다.

원본 파일: tools/fonts/src/*.woff2 (여기가 유일한 원본. src/app/fonts/ 에는 이제
Paperlogy 만 남는다).

재생성:
    python tools/fonts/split-dynamic-subset.py

출력:
    public/webfonts/pretendard/PretendardVariable.<id>.<hash8>.woff2   (id = core·구간표 번호·rest)
    public/webfonts/gmarket/GmarketSansBold.<id>.<hash8>.woff2
    src/app/webfonts.css          ← @font-face 전체. 손으로 고치지 말 것(이 스크립트가 덮어쓴다)
    src/app/webfonts-manifest.ts  ← id → URL. layout/page 의 preload 가 여기서 경로를 찾는다
  <hash8> 은 내용 sha256 앞 8자리 — /webfonts/ 는 immutable 1년 캐시(next.config headers)라
  내용이 바뀌면 이름이 바뀌어야 한다.

주의:
  * 서브셋은 힌팅·레이아웃 피처(GSUB/GPOS)·name 테이블을 **전부 보존**한다.
    (pyftsubset 기본값과 달리 --layout-features='*', --name-IDs='*')
  * 조각의 cmap 이 비면(그 구간 글리프가 폰트에 아예 없으면) 파일도 CSS 규칙도
    만들지 않는다 — 오늘처럼 폴백 서체로 넘어가는 동작이 그대로 유지된다.
  * 구간표가 못 덮는 코드포인트는 'rest' 조각 하나로 모아 반드시 포함시킨다.
"""

from __future__ import annotations

import hashlib
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import json

from fontTools import subset
from fontTools.ttLib import TTFont

# 윈도우에서 stdout 이 파일·파이프로 리다이렉트되면 CP949 로 열려 '✓'·'—' 같은 문자에서
# UnicodeEncodeError 로 죽는다(2026-09-10 실측 — Gmarket 조각과 CSS 를 못 만든 채 종료).
# 콘솔이든 파일이든 UTF-8 로 고정한다.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, 'reconfigure'):
        _stream.reconfigure(encoding='utf-8', errors='replace')

REPO = Path(__file__).resolve().parents[2]          # .../yonsei-me
HERE = Path(__file__).resolve().parent              # .../yonsei-me/tools/fonts
SLICE_TABLE = HERE / 'korean-slices.json'
CSS_OUT = REPO / 'src' / 'app' / 'webfonts.css'
# 조각 id → URL 매니페스트(생성물). 파일명에 내용 해시가 들어가므로 layout/page 의 preload 가
# 경로를 직접 적을 수 없다 — 이 파일을 import 해 id 로 찾는다.
MANIFEST_OUT = REPO / 'src' / 'app' / 'webfonts-manifest.ts'

# next/font 가 지금까지 생성하던 지표 보정 폴백을 그대로 옮겨 적은 것.
# (dev 빌드 CSS 에서 실측: .next-dev/static/css/app/[locale]/layout.css)
# 값이 바뀌면 폰트 로드 전/후 줄바꿈이 달라져 CLS 가 생긴다 — 손대지 말 것.
FALLBACK_FACES = """\
/* next/font 가 만들던 지표 보정 폴백을 그대로 옮긴 것(local Arial + override).
   폰트가 도착하기 전 텍스트가 차지하는 넓이를 실제 서체와 맞춰 CLS 를 막는다. */
@font-face {
  font-family: 'Pretendard Fallback';
  src: local('Arial');
  ascent-override: 93.76%;
  descent-override: 23.75%;
  line-gap-override: 0.00%;
  size-adjust: 101.55%;
}
@font-face {
  font-family: 'GmarketSans Fallback';
  src: local('Arial');
  ascent-override: 62.23%;
  descent-override: 15.56%;
  line-gap-override: 11.67%;
  size-adjust: 128.55%;
}
"""

def ksx1001_syllables() -> set[int]:
    """KS X 1001 완성형 한글 2,350자 — EUC-KR 한글 영역(행 0xB0~0xC8)을 디코딩해 얻는다.
    (파이썬 'euc_kr' 코덱은 확장 완성형까지 인코딩하므로 encode 로 거르면 11,172자가 나온다.)"""
    out: set[int] = set()
    for row in range(0xB0, 0xC9):
        for col in range(0xA1, 0xFF):
            try:
                cp = ord(bytes([row, col]).decode('euc_kr'))
            except (UnicodeDecodeError, ValueError):
                continue
            if 0xAC00 <= cp <= 0xD7A3:
                out.add(cp)
    assert len(out) == 2350, len(out)
    return out


KSX1001 = ksx1001_syllables()

# scheme:
#  'slices' — 구글 구간표 그대로 124조각(+rest). 폰트에 한글 음절이 관여하는 문맥 룩업(calt/locl
#             chained)·커닝이 없을 때만 원본과 100% 같다. GmarketSans 가 그렇다(실측 0개).
#  'core'   — KS X 1001 상용 2,350자 + 한글 음절이 아닌 글리프 전부(라틴·기호·자모·PUA 대체형)를
#             'core' 한 파일에 담고, 남은 희귀 음절 8,822자만 구간표로 쪼갠다. Pretendard 는
#             calt 로 한글 옆의 ':' '—' 같은 문장부호를 한글용 변형 글리프로 바꾸는데(문맥
#             룩업 39개), 문장부호와 한글이 다른 파일이면 셰이퍼가 문맥을 못 봐 기본 글리프가
#             나온다(2026-09-10 픽셀 비교로 실측 — 1px 위치 차이). 상용 한글과 문장부호를 한
#             파일에 두면 그 문맥이 원본 그대로 살아난다. 대가는 첫 방문 ~740KB 한 파일
#             (원본 2.06MB, 구글식 조각은 페이지당 ~580KB/20파일).
FONTS = [
    dict(
        key='pretendard',
        src=HERE / 'src' / 'PretendardVariable.woff2',
        out_dir=REPO / 'public' / 'webfonts' / 'pretendard',
        basename='PretendardVariable',
        url_dir='/webfonts/pretendard',
        family='Pretendard Variable',
        weight='100 900',
        variable=True,
        scheme='core',
    ),
    dict(
        key='gmarket',
        src=HERE / 'src' / 'GmarketSansBold.woff2',
        out_dir=REPO / 'public' / 'webfonts' / 'gmarket',
        basename='GmarketSansBold',
        url_dir='/webfonts/gmarket',
        family='GmarketSans',
        weight='700',
        variable=False,
        scheme='slices',
    ),
]


# ── 유니코드 구간 문자열 ↔ 코드포인트 집합 ──────────────────────────────────
def parse_unicode_range(value: str) -> set[int]:
    """CSS unicode-range 값을 코드포인트 집합으로."""
    cps: set[int] = set()
    for part in value.split(','):
        part = part.strip()
        if not part:
            continue
        if not part.upper().startswith('U+'):
            raise ValueError(f'bad unicode-range token: {part!r}')
        body = part[2:]
        if '-' in body:
            lo_s, hi_s = body.split('-', 1)
            lo, hi = int(lo_s, 16), int(hi_s, 16)
        elif '?' in body:
            lo = int(body.replace('?', '0'), 16)
            hi = int(body.replace('?', 'F'), 16)
        else:
            lo = hi = int(body, 16)
        if hi < lo:
            raise ValueError(f'inverted range: {part!r}')
        cps.update(range(lo, hi + 1))
    return cps


def format_unicode_range(cps: set[int]) -> str:
    """코드포인트 집합을 CSS unicode-range 값으로(연속 구간 병합)."""
    ordered = sorted(cps)
    parts: list[str] = []
    i = 0
    n = len(ordered)
    while i < n:
        j = i
        while j + 1 < n and ordered[j + 1] == ordered[j] + 1:
            j += 1
        if i == j:
            parts.append('U+%x' % ordered[i])
        else:
            parts.append('U+%x-%x' % (ordered[i], ordered[j]))
        i = j + 1
    return ','.join(parts)


def font_codepoints(path: Path) -> set[int]:
    """폰트가 실제로 담고 있는 유니코드 코드포인트 전체(모든 유니코드 cmap 합집합)."""
    font = TTFont(str(path), lazy=True)
    cps: set[int] = set()
    for table in font['cmap'].tables:
        if table.isUnicode():
            cps.update(table.cmap.keys())
    font.close()
    return cps


def subset_options() -> subset.Options:
    """pyftsubset 옵션 — '보이는 것은 하나도 바뀌지 않는다'가 목표."""
    opts = subset.Options()
    opts.flavor = 'woff2'
    # 레이아웃 피처 전부 보존(커닝·합자·자간 등). 기본값은 일부만 남긴다.
    opts.layout_features = ['*']
    # name 테이블 전부 보존(라이선스·저작자 레코드 포함).
    opts.name_IDs = ['*']
    opts.name_legacy = True
    opts.name_languages = ['*']
    # .notdef 아웃라인 유지 — 없는 글자를 그리는 모양까지 원본과 같게.
    opts.notdef_outline = True
    opts.notdef_glyph = True
    # 힌팅 유지(기본 True). no-hinting 을 주지 않는다.
    opts.hinting = True
    # 글리프 클로저 ON(기본) — 합자·대체 글리프가 딸려온다.
    opts.layout_closure = True
    # 가변 폰트는 인스턴스화하지 않는다: fvar/gvar/HVAR 이 그대로 남아 100~900 전 굵기 유지.
    opts.desubroutinize = False
    opts.retain_gids = False
    opts.glyph_names = False
    return opts


def build_slice(job: tuple[str, str, str]) -> tuple[str, int, list[int]]:
    """한 조각 생성(워커 프로세스에서 실행). 조각 하나가 몇 초씩 걸리므로 코어 수만큼 병렬화한다.

    job = (원본 경로, 출력 경로, 코드포인트 목록). 반환은 (출력 경로, 글리프 수, cmap 목록).
    글리프가 .notdef 뿐이면(= 그 구간 글리프가 폰트에 아예 없으면) 파일을 쓰지 않고
    (경로, 0, []) 를 돌려준다 — 그러면 CSS 규칙도 만들지 않아 오늘처럼 폴백으로 넘어간다."""
    src, out, cp_list = job
    out_path = Path(out)
    opts = subset_options()
    font = subset.load_font(src, opts)
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(unicodes=set(cp_list))
    subsetter.subset(font)

    covered: set[int] = set()
    for table in font['cmap'].tables:
        if table.isUnicode():
            covered.update(table.cmap.keys())

    n_glyphs = len(font.getGlyphOrder())
    if not covered or n_glyphs <= 1:
        font.close()
        return out, 0, []

    out_path.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(out_path), opts)
    font.close()
    # 파일명에 내용 해시(sha256 앞 8자리)를 넣는다 — public/ 정적 파일은 Vercel 이
    # max-age=0 으로 내보내므로 next.config headers() 가 /webfonts/ 에 immutable 1년을 건다.
    # 그러려면 내용이 바뀔 때 이름도 바뀌어야 한다(같은 이름에 다른 내용 = 1년 묵은 폰트).
    digest = hashlib.sha256(out_path.read_bytes()).hexdigest()[:8]
    final = out_path.with_name(f'{out_path.stem}.{digest}{out_path.suffix}')
    os.replace(out_path, final)
    return str(final), n_glyphs, sorted(covered)


def main() -> int:
    slices = json.loads(SLICE_TABLE.read_text(encoding='utf-8'))
    slice_cps = [(str(s['id']), parse_unicode_range(s['range']), s['range']) for s in slices]
    table_union: set[int] = set()
    for _, cps, _ in slice_cps:
        table_union |= cps

    css_blocks: list[str] = []
    manifest: dict[str, dict[str, str]] = {}
    ok = True

    for spec in FONTS:
        src: Path = spec['src']
        if not src.exists():
            print(f'ERROR: 원본 폰트 없음: {src}', file=sys.stderr)
            return 2

        source_cps = font_codepoints(src)
        syllables = {c for c in source_cps if 0xAC00 <= c <= 0xD7A3}
        # 'core' 스킴: 음절이 아닌 것 전부 + 상용 2,350자를 한 파일로. 구간표 조각은 그 나머지만.
        core: set[int] = (source_cps - syllables) | (syllables & KSX1001) if spec['scheme'] == 'core' else set()
        work: list[tuple[str, set[int], str]] = []
        if core:
            work.append(('core', core, format_unicode_range(core)))
        for sid, cps, range_text in slice_cps:
            work.append((sid, cps - core, range_text))
        remainder = source_cps - core - table_union
        if remainder:
            work.append(('rest', set(remainder), format_unicode_range(remainder)))

        print(f'\n=== {spec["family"]} ({src.name}, {src.stat().st_size:,} B) — scheme={spec["scheme"]} ===')
        print(f'    원본 cmap 코드포인트: {len(source_cps):,}')
        if core:
            print(f'    core 조각           : {len(core):,} (비음절 {len(source_cps - syllables):,} + KS X 1001 {len(syllables & KSX1001):,})')
        print(f'    구간표가 덮는 것    : {len((source_cps - core) & table_union):,}')
        print(f'    rest 조각으로 회수  : {len(remainder):,}')

        # 지운다 — 예전 실행이 남긴 조각이 CSS 에 없는 채로 배포되지 않도록.
        out_dir: Path = spec['out_dir']
        out_dir.mkdir(parents=True, exist_ok=True)
        for stale in out_dir.glob(f'{spec["basename"]}.*.woff2'):
            stale.unlink()

        jobs: list[tuple[str, str, list[int]]] = []
        for sid, cps, _range_text in work:
            want = cps & source_cps
            if not want:
                continue
            jobs.append((str(src), str(out_dir / f'{spec["basename"]}.{sid}.woff2'), sorted(want)))

        workers = max(1, min(len(jobs), (os.cpu_count() or 4)))
        print(f'    조각 {len(jobs)}개를 워커 {workers}개로 생성 중…', flush=True)
        with ProcessPoolExecutor(max_workers=workers) as pool:
            # 순서 보존(map) — CSS 규칙 순서를 실행마다 똑같게 만들어 diff 를 깨끗하게 유지한다.
            results = list(pool.map(build_slice, jobs))

        rules: list[str] = []
        total_bytes = 0
        largest = ('', 0)
        union_covered: set[int] = set()
        made = 0

        for out_str, n_glyphs, covered_list in results:
            if not covered_list:
                continue
            out_path = Path(out_str)
            covered = set(covered_list)
            made += 1
            size = out_path.stat().st_size
            total_bytes += size
            if size > largest[1]:
                largest = (out_path.name, size)
            union_covered |= covered

            url = f'{spec["url_dir"]}/{out_path.name}'
            # 파일명 = <basename>.<sid>.<hash8>.woff2 — sid 를 되읽어 매니페스트에 넣는다.
            sid = out_path.name.split('.')[1]
            manifest.setdefault(spec['key'], {})[sid] = url
            if spec['variable']:
                src_line = (
                    f"  src: url('{url}') format('woff2-variations'),\n"
                    f"       url('{url}') format('woff2');"
                )
            else:
                src_line = f"  src: url('{url}') format('woff2');"
            # 실제로 담긴 코드포인트로 unicode-range 를 다시 만든다.
            # (구간표 그대로 쓰면 폰트에 없는 문자까지 이 조각에 묶여, 오늘은 폴백으로
            #  넘어가던 글자가 두부(.notdef)로 보일 수 있다.)
            rules.append(
                '@font-face {\n'
                f"  font-family: '{spec['family']}';\n"
                '  font-style: normal;\n'
                f'  font-weight: {spec["weight"]};\n'
                '  font-display: swap;\n'
                f'{src_line}\n'
                f'  unicode-range: {format_unicode_range(covered)};\n'
                '}'
            )
            print(f'    [{made:3d}/{len(jobs)}] {out_path.name:<34} {size:>7,} B  '
                  f'glyphs={n_glyphs:<5} cps={len(covered)}', flush=True)

        # ── 커버리지 단언: 조각 전부의 합집합 == 원본 cmap ────────────────
        missing = source_cps - union_covered
        extra = union_covered - source_cps
        print(f'    → 조각 {made}개, 합계 {total_bytes:,} B, 최대 {largest[0]} {largest[1]:,} B')
        print(f'    → 커버리지: 원본 {len(source_cps):,} / 조각합집합 {len(union_covered):,} '
              f'/ 누락 {len(missing)} / 초과 {len(extra)}')
        if missing or extra:
            ok = False
            sample = sorted(missing)[:20]
            print('    !! COVERAGE MISMATCH: ' + ', '.join('U+%04X' % c for c in sample), file=sys.stderr)
        else:
            print('    ✓ 커버리지 일치 — 렌더 가능한 문자 집합이 원본과 완전히 같다.')

        css_blocks.append(
            f'/* ── {spec["family"]} — {made} slices, {total_bytes:,} B total '
            f'(원본 {src.name} {src.stat().st_size:,} B) ── */\n' + '\n'.join(rules)
        )

    header = (
        '/* 이 파일은 tools/fonts/split-dynamic-subset.py 가 생성한다. 손으로 고치지 말 것.\n'
        '   재생성: python tools/fonts/split-dynamic-subset.py\n'
        '   원본 폰트: tools/fonts/src/ (라이선스는 src/app/fonts/LICENSE-*.txt) */\n'
    )
    CSS_OUT.write_text(header + '\n' + FALLBACK_FACES + '\n' + '\n\n'.join(css_blocks) + '\n',
                       encoding='utf-8')
    print(f'\nCSS: {CSS_OUT} ({CSS_OUT.stat().st_size:,} B)')

    # ── 매니페스트(TS) — preload 가 해시 파일명을 id 로 찾는다 ────────────────
    def sort_key(s: str):
        return (0, int(s)) if s.isdigit() else (1, s)

    ts_lines = [
        '// 이 파일은 tools/fonts/split-dynamic-subset.py 가 생성한다. 손으로 고치지 말 것.',
        '// 조각 id → URL. 파일명에 내용 해시가 들어가 있어(immutable 캐시 헤더 전제) 경로를',
        '// 코드에 직접 적지 말고 여기서 찾는다. id: 구글 구간표 0~123 · core(상용 한글+비음절) · rest.',
        "export const WEBFONTS: Record<'pretendard' | 'gmarket', Record<string, string>> = {",
    ]
    for key in ('pretendard', 'gmarket'):
        ts_lines.append(f'  {key}: {{')
        for sid in sorted(manifest.get(key, {}), key=sort_key):
            ts_lines.append(f"    '{sid}': '{manifest[key][sid]}',")
        ts_lines.append('  },')
    ts_lines.append('};')
    MANIFEST_OUT.write_text('\n'.join(ts_lines) + '\n', encoding='utf-8')
    print(f'MANIFEST: {MANIFEST_OUT} ({sum(len(v) for v in manifest.values())} entries)')
    if not ok:
        print('\nFAILED: 커버리지 불일치. 배포하지 말 것.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
