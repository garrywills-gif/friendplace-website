"""Build a preset-avatars contact sheet for approval review."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SRC = Path("/app/frontend/assets/avatars/presets")
OUT = Path("/app/scripts/preview_presets.jpg")
BG = (15, 23, 42)
FG = (226, 232, 240)
ACCENT = (94, 234, 212)

try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    FONT_S = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
except Exception:
    FONT = ImageFont.load_default()
    FONT_S = ImageFont.load_default()

COLS, ROWS = 6, 10
THUMB = 210
GAP = 8
LABEL_H = 6
HEADER = 60
W = COLS * THUMB + (COLS + 1) * GAP
H = HEADER + ROWS * (THUMB + LABEL_H + 4) + (ROWS + 1) * GAP

im = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(im)
d.text((GAP, 20), "FriendPlace 3D Preset Avatars — 60 candidates (curate to ~50)", font=FONT, fill=ACCENT)

files = sorted(SRC.glob("portrait-*.png"))
for i, p in enumerate(files[:COLS * ROWS]):
    col, row = i % COLS, i // COLS
    x = GAP + col * (THUMB + GAP)
    y = HEADER + GAP + row * (THUMB + LABEL_H + 4 + GAP)
    with Image.open(p) as src:
        src.thumbnail((THUMB, THUMB))
        canvas = Image.new("RGB", (THUMB, THUMB), BG)
        ox = (THUMB - src.width) // 2
        oy = (THUMB - src.height) // 2
        canvas.paste(src, (ox, oy))
        im.paste(canvas, (x, y))
    d.text((x + 4, y + THUMB - 2), p.stem, font=FONT_S, fill=FG)

im.save(OUT, quality=82, optimize=True)
print(f"Contact sheet: {OUT}  ({OUT.stat().st_size // 1024} KB, {W}x{H})")
