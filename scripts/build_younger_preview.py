"""Contact sheet for the 12 younger-adult additions (portrait-61..72)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SRC = Path("/app/frontend/assets/avatars/presets")
OUT = Path("/app/scripts/preview_presets_younger.jpg")
BG = (15, 23, 42)
FG = (226, 232, 240)
ACCENT = (94, 234, 212)

try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
    FONT_S = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
    FONT_MED = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
except Exception:
    FONT = ImageFont.load_default(); FONT_S = ImageFont.load_default(); FONT_MED = ImageFont.load_default()

# Groups aligned to the user's brief: 4 × 18-25, 4 × 25-35, 4 × 35-45.
GROUPS = [
    ("18–25 (younger adults)", [61, 62, 63, 64]),
    ("25–35",                  [65, 66, 67, 68]),
    ("35–45",                  [69, 70, 71, 72]),
]

COLS = 4
THUMB = 260
GAP = 10
HEADER = 60
GROUP_H = 34
LABEL_H = 6
W = COLS * THUMB + (COLS + 1) * GAP
H = HEADER + sum(GROUP_H + THUMB + LABEL_H + GAP*2 for _ in GROUPS) + GAP

im = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(im)
d.text((GAP, 20), "FriendPlace 3D Preset Avatars — younger-adult additions (portraits 61–72)", font=FONT, fill=ACCENT)

y = HEADER
for label, ids in GROUPS:
    d.text((GAP, y), label, font=FONT_MED, fill=FG)
    y += GROUP_H
    for i, pid in enumerate(ids):
        p = SRC / f"portrait-{pid:02d}.png"
        x = GAP + i * (THUMB + GAP)
        with Image.open(p) as src:
            src.thumbnail((THUMB, THUMB))
            canvas = Image.new("RGB", (THUMB, THUMB), BG)
            ox = (THUMB - src.width) // 2
            oy = (THUMB - src.height) // 2
            canvas.paste(src, (ox, oy))
            im.paste(canvas, (x, y))
        d.text((x + 4, y + THUMB - 2), p.stem, font=FONT_S, fill=FG)
    y += THUMB + LABEL_H + GAP

im.save(OUT, quality=85, optimize=True)
print(f"Contact sheet: {OUT}  ({OUT.stat().st_size // 1024} KB, {W}x{H})")
