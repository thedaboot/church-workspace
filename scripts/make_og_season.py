"""주보 공개 보기(api/service-view.js)의 카카오톡 카드 그림 — 표지 사진이 없는 주보가 쓰는 절기 색 넷.

실행: python scripts/make_og_season.py   (Pillow 필요)
결과: public/og/season-{purple,gold,red,plain}.png (1200x630)
값은 넘기면서 보기 표지(src/components/worshipStory.jsx COVER)와 같다 — 그쪽 색을 바꾸면 여기도 다시 돌린다.
"""
from PIL import Image

C = {
    'purple': ((0x5a, 0x4a, 0x97), (0x3b, 0x2f, 0x6c)),
    'gold': ((0xf6, 0xee, 0xdb), (0xe9, 0xdc, 0xbc)),
    'red': ((0x9a, 0x40, 0x38), (0x6f, 0x2b, 0x25)),
    'plain': ((0x3f, 0x6f, 0xc4), (0x21, 0x31, 0x83)),
}
W, H = 1200, 630

for key, (a, b) in C.items():
    im = Image.new('RGB', (W, H))
    px = im.load()
    for y in range(H):
        for x in range(W):
            t = min(1, max(0, (y / H) * 0.8 + (x / W) * 0.2))   # 위→아래가 주, 옆으로 조금(165° 근사)
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    im.save(f'public/og/season-{key}.png', optimize=True)
