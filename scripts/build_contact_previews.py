"""Build compact JPEG contact-sheet previews from the freshly generated
launch assets so the main agent can display them inline for approval.

Emits:
  /app/scripts/preview_avatars.jpg          — 6×4 grid of 24 portraits
  /app/scripts/preview_gallery.jpg          — 11 rows × 3 cols, one per theme
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

AV_DIR = Path("/app/frontend/assets/avatars")
GAL_DIR = Path("/app/frontend/assets/gallery")
OUT = Path("/app/scripts")

# Theme order + labels — must match the generator.
THEMES = [
    ("bbqs-sausage-sizzles",       "BBQs & sausage sizzles"),
    ("bush-walks-walking-groups",  "Bush walks & walking groups"),
    ("garage-sales",               "Garage sales"),
    ("fetes-fairs-cake-stalls",    "Fêtes, fairs & cake stalls"),
    ("coffee-catchups",            "Coffee catch-ups"),
    ("book-clubs-reading-groups",  "Book clubs & reading groups"),
    ("gardening-garden-groups",    "Gardening & garden groups"),
    ("pets-dog-meetups",           "Pets & dog meet-ups"),
    ("classic-cars-car-meets",     "Classic cars & car meets"),
    ("social-get-togethers",       "Social get-togethers"),
    ("community-activities",       "Community activities"),
]

BG = (15, 23, 42)
FG = (226, 232, 240)
ACCENT = (94, 234, 212)

try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
    FONT_S = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
except Exception:
    FONT = ImageFont.load_default()
    FONT_S = ImageFont.load_default()


def build_avatars() -> Path:
    # 6 cols × 4 rows, thumbnails 200x200, gap 8, top label bar 40.
    cols, rows = 6, 4
    thumb = 220
    gap = 10
    label_h = 8
    W = cols * thumb + (cols + 1) * gap
    H = 60 + rows * (thumb + label_h) + (rows + 1) * gap
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((gap, 20), "FriendPlace Avatars — 24 portraits", font=FONT, fill=ACCENT)
    for i in range(24):
        p = AV_DIR / f"portrait-{i+1:02d}.jpg"
        if not p.exists():
            continue
        col, row = i % cols, i // cols
        x = gap + col * (thumb + gap)
        y = 60 + gap + row * (thumb + label_h + gap)
        with Image.open(p) as src:
            src.thumbnail((thumb, thumb))
            # centre-crop to square
            src = src.crop((0, 0, thumb, thumb)) if src.size == (thumb, thumb) else src
            im.paste(src, (x, y))
        d.text((x + 4, y + thumb - 2), f"portrait-{i+1:02d}", font=FONT_S, fill=FG)
    out = OUT / "preview_avatars.jpg"
    im.save(out, quality=85, optimize=True)
    return out


def build_gallery() -> Path:
    # 11 rows × 3 cols, thumbnails 320x214 (3:2), theme label at left.
    cols = 3
    rows = len(THEMES)
    tw, th = 320, 214
    gap = 10
    label_w = 220
    header_h = 60
    W = label_w + cols * tw + (cols + 1) * gap
    H = header_h + rows * (th + gap) + gap
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((gap, 20), "FriendPlace Gallery — 33 photos (11 themes × 3)",
           font=FONT, fill=ACCENT)
    for r, (slug, label) in enumerate(THEMES):
        y = header_h + r * (th + gap) + gap
        # Row label — split into two lines if long.
        d.text((gap, y + 8), label, font=FONT_S, fill=FG)
        for c in range(cols):
            p = GAL_DIR / slug / f"{c+1:02d}.jpg"
            if not p.exists():
                continue
            x = label_w + gap + c * (tw + gap)
            with Image.open(p) as src:
                # Fit inside tw×th preserving aspect (letterbox on top/bottom).
                src.thumbnail((tw, th))
                canvas = Image.new("RGB", (tw, th), BG)
                ox = (tw - src.width) // 2
                oy = (th - src.height) // 2
                canvas.paste(src, (ox, oy))
                im.paste(canvas, (x, y))
            d.text((x + 4, y + th - 18), f"{slug}/{c+1:02d}", font=FONT_S, fill=FG)
    out = OUT / "preview_gallery.jpg"
    im.save(out, quality=85, optimize=True)
    return out


def main() -> None:
    a = build_avatars()
    g = build_gallery()
    print(f"avatars preview: {a}  ({a.stat().st_size // 1024} KB)")
    print(f"gallery preview: {g}  ({g.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
