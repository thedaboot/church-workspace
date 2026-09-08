"""SUIT에 없는 기호들의 보조 웹폰트를 만든다 (한 번 돌리고 결과물을 커밋한다).

왜:
  `◡̈`(U+25E1 아래 반원 + U+0308 결합 점 두 개)처럼 SUIT Variable에 없는 글자는 시스템
  글꼴로 떨어지는데, 반원과 결합 부호가 **서로 다른 글꼴**에서 오면 어긋나거나 빈 네모가
  된다(사용자 지적 2026-09-08). 두 글자가 같은 글꼴에서 나오게 작은 보조 글꼴을 SUIT
  바로 뒤에 둔다(index.css --font-sans · unicode-range로 그 글자들만 맡는다).

원본: DejaVu Sans (Bitstream Vera 라이선스 — 재배포 허용). matplotlib이 들고 있는
사본을 쓴다(pip install matplotlib fonttools brotli).

쓰는 법:
  python scripts/subset_symbols.py
  → src/assets/fonts/symbols.woff2 (symbols.css의 unicode-range와 RANGE가 같아야 한다)
"""
from pathlib import Path
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src/assets/fonts/symbols.woff2"
# 결합 부호 · 발음 기호(ᵕ ᴗ 같은 이모티콘 글자) · SUIT(U+25A0-25CF) 밖의 기하 도형
RANGE = "U+02B0-02FF,U+0300-036F,U+1D00-1D7F,U+25D0-25FF"


def find_source():
    try:
        import matplotlib
        p = Path(matplotlib.__file__).parent / "mpl-data/fonts/ttf/DejaVuSans.ttf"
        if p.exists():
            return p
    except ImportError:
        pass
    sys.exit("DejaVuSans.ttf를 못 찾았습니다 — pip install matplotlib (또는 경로를 직접 넣으세요)")


def main():
    src = find_source()
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    font = subset.load_font(str(src), opts)
    sub = subset.Subsetter(options=opts)
    sub.populate(unicodes=subset.parse_unicodes(RANGE))
    sub.subset(font)
    subset.save_font(font, str(OUT), opts)
    cmap = TTFont(str(OUT)).getBestCmap()
    for cp in (0x25E1, 0x0308):
        if cp not in cmap:
            sys.exit(f"U+{cp:04X}가 결과물에 없습니다")
    print(f"{OUT.name}: {len(cmap)} glyphs · {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
