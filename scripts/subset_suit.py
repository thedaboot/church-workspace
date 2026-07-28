"""SUIT Variable 웹폰트를 두 조각으로 나눈다 (한 번 돌리고 결과물을 커밋한다).

왜:
  패키지가 주는 통짜 SUIT-Variable.woff2가 610KB다. 앱을 처음 여는 사람은 화면에
  글자가 몇 개 나오든 이걸 전부 받는다.

무엇을:
  common — 라틴·기호 + 상용 한글 2,350자(KS X 1001)  → 첫 로드에 받는 조각 (500KB)
  rest   — 나머지 현대 한글 음절                      → 희귀 음절이 화면에 나올 때만 (95KB)

  unicode-range로 갈라 두면 브라우저가 필요한 조각만 받는다. 어느 쪽이든 같은
  폰트이므로 글자가 깨질 일은 없다. 합계 595KB로 원본보다 오히려 작다(폰트에 있던
  안 쓰는 글리프가 함께 빠진다).

한 번 시도했다가 접은 방법 — 잘게 쪼개기:
  Pretendard처럼 사용 빈도별 92조각으로 나눠 봤다. 결과가 기대와 달랐다:
    · 조각마다 폰트 테이블 오버헤드가 붙어 합계가 610KB → 920KB로 늘어난다
    · 한글은 조각을 넓게 건드린다 — 로그인 화면만 12조각 282KB, 앱 문구 전체는
      28조각 485KB였다(2분할의 500KB와 사실상 같다)
    · 그런데 요청 수는 28개 이상, 캐시 항목도 그만큼 쪼개진다
  한글 폰트 크기는 "상용 2,350자를 실제로 그려 넣은 것"에서 나오기 때문에, 잘게
  나눠도 그 2,350자를 대부분 받게 된다. 그래서 2분할로 되돌렸다.

쓰는 법:
  pip install fonttools brotli
  python scripts/subset_suit.py
  → src/assets/fonts/ 에 woff2 2개 + suit.css 생성 (index.css가 이걸 import한다)

SUIT 버전을 올리면 다시 돌려서 결과물을 커밋하면 된다.
"""
from pathlib import Path
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "node_modules/@sun-typeface/suit/fonts/variable/woff2/SUIT-Variable.woff2"
OUT = ROOT / "src/assets/fonts"

# 라틴·숫자·기호 — 화면에 나오는 것들. 넉넉히 잡아도 크기에 거의 영향이 없다.
# (실제로 빠뜨렸던 것: ⌘ — "붙여넣기(Ctrl/⌘+V)" 안내 문구에 쓰인다.
#  범위 밖 문자는 시스템 폰트로 떨어져서 한 문장 안에서 자획이 달라진다.)
LATIN = ("U+0020-007E,U+00A0-00FF,U+2013-2015,U+2018-201D,U+2022,U+2026,U+203B,"
         "U+20A9,U+2190-2199,U+21B3,U+2318,U+2252,U+22EF,U+2500-2502,U+25A0-25CF,"
         "U+2713-2715,U+3001-3002,U+300C-300F,U+FF01-FF5E")


def ks_x_1001_syllables():
    """상용 한글 2,350자 — ISO-2022-KR로 인코딩되는 음절이 정확히 그 집합이다
    (파이썬의 euc_kr/cp949 코덱은 11,172자를 다 받아서 필터로 쓸 수 없다)."""
    out = []
    for cp in range(0xAC00, 0xD7A4):
        try:
            chr(cp).encode("iso2022_kr")
        except UnicodeEncodeError:
            continue
        out.append(cp)
    return out


def to_ranges(codepoints):
    """[0xAC00, 0xAC01, 0xAC04] → 'U+AC00-AC01,U+AC04' (CSS unicode-range)"""
    parts, start, prev = [], None, None
    for cp in sorted(codepoints):
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            parts.append((start, prev))
            start = prev = cp
    if start is not None:
        parts.append((start, prev))
    return ",".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in parts)


def write_subset(unicodes, dest: Path):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]     # 커닝·자모 조합 유지
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    font = subset.load_font(SRC, opts)
    sub = subset.Subsetter(options=opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    subset.save_font(font, dest, opts)
    axes = [a.axisTag for a in font["fvar"].axes] if "fvar" in font else []
    font.close()
    if "wght" not in axes:
        sys.exit(f"{dest.name}: 가변 굵기 축(wght)이 사라졌습니다 — 앱이 500~900을 씁니다")
    return dest.stat().st_size


def main():
    if not SRC.exists():
        sys.exit(f"원본 폰트가 없습니다: {SRC}\n  npm install 먼저 하세요.")
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("SUIT-Variable*.woff2"):
        old.unlink()

    available = set(TTFont(SRC, fontNumber=0).getBestCmap().keys())
    common_hangul = [c for c in ks_x_1001_syllables() if c in available]
    rest_hangul = [c for c in range(0xAC00, 0xD7A4) if c in available and c not in set(common_hangul)]

    common_range = f"{LATIN},{to_ranges(common_hangul)}"
    rest_range = to_ranges(rest_hangul)

    common_cps = [c for part in common_range.split(",") for c in _expand(part)]
    n1 = write_subset(common_cps, OUT / "SUIT-Variable.common.woff2")
    n2 = write_subset(rest_hangul, OUT / "SUIT-Variable.rest.woff2")

    css = f"""/* 생성된 파일입니다 — 직접 고치지 말고 scripts/subset_suit.py를 다시 돌리세요.
   통짜 SUIT-Variable.woff2(610KB)를 두 조각으로 나눈 것입니다:
     common — 라틴·기호 + 상용 한글 2,350자 (첫 로드에 받는다)
     rest   — 나머지 현대 한글 음절 (희귀 음절이 화면에 나올 때만 받는다)
   font-display: swap — 받는 동안 글자가 안 보이는 것(FOIT, 최대 3초)을 막습니다. */
@font-face {{
  font-family: 'SUIT Variable';
  font-weight: 100 900;
  font-display: swap;
  src: url('./SUIT-Variable.common.woff2') format('woff2-variations');
  unicode-range: {common_range};
}}
@font-face {{
  font-family: 'SUIT Variable';
  font-weight: 100 900;
  font-display: swap;
  src: url('./SUIT-Variable.rest.woff2') format('woff2-variations');
  unicode-range: {rest_range};
}}
"""
    (OUT / "suit.css").write_text(css, encoding="utf-8")
    print(f"common {n1/1024:.0f} KB + rest {n2/1024:.0f} KB = {(n1+n2)/1024:.0f} KB "
          f"(통짜 원본 {SRC.stat().st_size/1024:.0f} KB)")


def _expand(part):
    part = part.strip().lower().removeprefix("u+")
    if not part:
        return []
    if "-" in part:
        a, b = part.split("-", 1)
        return range(int(a, 16), int(b, 16) + 1)
    return [int(part, 16)]


if __name__ == "__main__":
    main()
