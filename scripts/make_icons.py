"""PWA/앱 아이콘 생성 — favicon.png과 같은 파스텔 톤 + 잉크 획 로고.

실행: python scripts/make_icons.py   (Pillow 필요)
결과: public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
"""
from PIL import Image, ImageDraw

SRC = 'src/assets/logo-light.png'   # 밝은 배경용(잉크 획) 로고
# favicon.png에서 샘플링한 파스텔 4코너 (좌상 하늘 → 우상 분홍 → 우하 라벤더)
TL, TR, BL, BR = (175, 210, 241), (240, 219, 236), (237, 238, 244), (230, 215, 245)


def gradient(size):
    """4코너 바이리니어 보간 — 작게 그린 뒤 확대해 부드럽게."""
    small = Image.new('RGB', (2, 2))
    small.putpixel((0, 0), TL); small.putpixel((1, 0), TR)
    small.putpixel((0, 1), BL); small.putpixel((1, 1), BR)
    return small.resize((size, size), Image.BICUBIC)


def rounded_mask(size, radius_ratio):
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    return mask


def make(size, logo_ratio, radius_ratio, out):
    """logo_ratio: 캔버스 폭 대비 로고 폭 / radius_ratio: 모서리 둥글기(0=사각)"""
    canvas = gradient(size).convert('RGBA')
    logo = Image.open(SRC).convert('RGBA')
    lw = int(size * logo_ratio)
    lh = max(1, round(logo.height * lw / logo.width))
    logo = logo.resize((lw, lh), Image.LANCZOS)
    canvas.alpha_composite(logo, ((size - lw) // 2, (size - lh) // 2))
    if radius_ratio > 0:
        canvas.putalpha(rounded_mask(size, radius_ratio))
    canvas.save(out)
    print(out, canvas.size)


# 홈 화면/설치 아이콘: OS가 알아서 마스킹하므로 꽉 찬 사각형으로 둔다
make(192, 0.78, 0.0, 'public/icon-192.png')
make(512, 0.78, 0.0, 'public/icon-512.png')
# Android maskable: 안전 영역(가운데 80%) 안에만 로고가 들어와야 잘리지 않는다
make(512, 0.58, 0.0, 'public/icon-maskable-512.png')
# iOS 홈 화면(사파리가 자체 라운딩) — 투명도 없이
make(180, 0.78, 0.0, 'public/apple-touch-icon.png')
