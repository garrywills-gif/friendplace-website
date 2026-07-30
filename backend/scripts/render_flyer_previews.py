"""Generate two FriendPlace flyer mockups (V1 designs) for review.

Flyer 1 — Founding Members (Pre-launch)  → drives people to friendplace.com.au
Flyer 2 — Download the App (Launch)      → drives App Store + Play Store downloads

Both are A4 portrait 1240×1754 @ 150 dpi PNGs, saved to
/app/website/public/flyer-mockups/ so the user can preview them via the
Next.js dev server at:
    https://<preview>/flyer-mockups/founding.png
    https://<preview>/flyer-mockups/download.png

Run:
    cd /app/backend && python scripts/render_flyer_previews.py
"""
from __future__ import annotations
import io
import os
from pathlib import Path
import qrcode
from PIL import Image, ImageDraw, ImageFont

# ─── paths & constants ───────────────────────────────────────────────
ROOT = Path(__file__).resolve().parents[1]
BUTTERFLY_PATH = ROOT / "assets" / "friendplace-app-icon-v5.png"
OUT_DIR = Path("/app/website/public/flyer-mockups")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# A4 portrait @ 150 dpi
W, H = 1240, 1754

# Brand palette (verified against BrandMasthead + PUBLIC_EXPERIENCE_PRINCIPLES)
NAVY_HEADER = "#0B1F45"      # banner background
NAVY_INK = "#0F3D6E"         # headlines
TEAL = "#0F766E"             # slogan
INK = "#0F172A"              # body copy
SLATE = "#475569"            # secondary copy
MUTED = "#B7C7E5"            # header contact strip
SKY = "#7DB1FF"              # "Place" in wordmark
GOLD = "#FBBF24"             # Founding Member ribbon
GOLD_DARK = "#7C5300"        # ribbon text
CREAM = "#FEFCF8"            # subtle background
DARK_CTA_BG = "#0A2540"      # download flyer footer

SIDE = 90  # generous side margins — safer than 100 to avoid crop
BANNER_H = 380  # slightly taller so the logo can grow ~10%


# ─── font resolution (same graceful fallback as server.py) ───────────
def font(size: int, bold: bool = True, italic: bool = False,
         condensed: bool = False) -> ImageFont.FreeTypeFont:
    bases: list[str] = []
    if condensed:
        if bold and italic:
            bases += [
                "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-BoldOblique.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-BoldItalic.ttf",
            ]
        elif bold:
            bases += [
                "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Bold.ttf",
            ]
        elif italic:
            bases += [
                "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Oblique.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Italic.ttf",
            ]
        else:
            bases += [
                "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Regular.ttf",
            ]
    if italic and bold:
        bases += [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf",
        ]
    elif italic:
        bases += [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf",
        ]
    elif bold:
        bases += [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        ]
    bases += [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for cand in bases:
        try:
            return ImageFont.truetype(cand, size)
        except Exception:
            continue
    return ImageFont.load_default()


# ─── drawing helpers ─────────────────────────────────────────────────
def draw_banner(d: ImageDraw.ImageDraw, img: Image.Image) -> int:
    """Navy branded banner across the top. Returns text_left for use by
    the wordmark. Butterfly logo enlarged by ~15% per user request."""
    d.rectangle([0, 0, W, BANNER_H], fill=NAVY_HEADER)

    text_left = SIDE
    try:
        butterfly = Image.open(BUTTERFLY_PATH).convert("RGBA")
        # Logo occupies ~82% of banner height (was ~72% → ~15% larger)
        bfy_h = int(BANNER_H * 0.82)
        bfy_scale = bfy_h / butterfly.height
        bfy_w = int(butterfly.width * bfy_scale)
        butterfly = butterfly.resize((bfy_w, bfy_h), Image.LANCZOS)
        bfy_x = SIDE - 30
        bfy_y = (BANNER_H - bfy_h) // 2
        img.paste(butterfly, (bfy_x, bfy_y), butterfly)
        text_left = bfy_x + bfy_w + 30
    except Exception:
        pass

    # Wordmark: "Friend" (white) + "Place" (sky) — auto-fit width
    wm_max_w = W - SIDE - text_left
    wm_size = 132
    while wm_size > 80:
        f_wm = font(wm_size, bold=True)
        b = d.textbbox((0, 0), "FriendPlace", font=f_wm)
        if (b[2] - b[0]) <= wm_max_w:
            break
        wm_size -= 4
    f_wm = font(wm_size, bold=True)
    wm_y = 52
    friend_bbox = d.textbbox((0, 0), "Friend", font=f_wm)
    friend_w = friend_bbox[2] - friend_bbox[0]
    d.text((text_left, wm_y), "Friend", font=f_wm, fill="#FFFFFF")
    d.text((text_left + friend_w, wm_y), "Place", font=f_wm, fill=SKY)
    wm_bottom = wm_y + (friend_bbox[3] - friend_bbox[1])

    # Tagline under the wordmark
    f_tag = font(42, bold=True)
    d.text((text_left, wm_bottom + 14), "Because you belong too.",
           font=f_tag, fill="#FFFFFF")

    # Contact strip
    div_y = BANNER_H - 80
    d.line([(text_left, div_y), (W - SIDE, div_y)], fill="#22336D", width=2)
    f_contact = font(28, bold=False)
    d.text((text_left, div_y + 22), "hello@friendplace.com.au",
           font=f_contact, fill=MUTED)
    email_w = d.textbbox((0, 0), "hello@friendplace.com.au", font=f_contact)[2]
    sep_x = text_left + email_w + 22
    d.text((sep_x, div_y + 22), "·", font=f_contact, fill=MUTED)
    d.text((sep_x + 22, div_y + 22), "www.friendplace.com.au",
           font=f_contact, fill=MUTED)

    return BANNER_H


def fit_headline(d: ImageDraw.ImageDraw, text: str, y: int,
                 max_w: int, start_size: int, min_size: int,
                 fill: str, condensed: bool = True) -> int:
    """Draw a big centred headline that auto-shrinks to fit max_w.
    Uses a 4-px step for finer resolution. Returns bottom_y."""
    size = start_size
    while size > min_size:
        f = font(size, bold=True, condensed=condensed)
        b = d.textbbox((0, 0), text, font=f)
        if (b[2] - b[0]) <= max_w:
            break
        size -= 4
    f = font(size, bold=True, condensed=condensed)
    b = d.textbbox((0, 0), text, font=f)
    d.text(((W - (b[2] - b[0])) / 2, y), text, font=f, fill=fill)
    return y + (b[3] - b[1])


def draw_centre(d: ImageDraw.ImageDraw, text: str, y: int,
                fnt: ImageFont.FreeTypeFont, fill: str) -> int:
    b = d.textbbox((0, 0), text, font=fnt)
    d.text(((W - (b[2] - b[0])) / 2, y), text, font=fnt, fill=fill)
    return y + (b[3] - b[1])


def wrap_centre(d: ImageDraw.ImageDraw, text: str, y: int,
                fnt: ImageFont.FreeTypeFont, fill: str,
                max_w: int, line_gap: int = 10) -> int:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w_ in words:
        cand = (cur + " " + w_).strip()
        if d.textbbox((0, 0), cand, font=fnt)[2] <= max_w:
            cur = cand
        else:
            if cur:
                lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    for line in lines:
        b = d.textbbox((0, 0), line, font=fnt)
        d.text(((W - (b[2] - b[0])) / 2, y), line, font=fnt, fill=fill)
        y += (b[3] - b[1]) + line_gap
    return y


def make_qr(url: str, size: int) -> Image.Image:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10, border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    q = qr.make_image(fill_color=INK, back_color="#FFFFFF").convert("RGB")
    return q.resize((size, size), Image.LANCZOS)


def draw_butterfly_glyph(d: ImageDraw.ImageDraw, cx: int, cy: int,
                         span: int, ink: str, accent: str) -> None:
    """Hand-drawn butterfly (Liberation Sans has no 🦋 glyph)."""
    w = span // 2
    upper_w, upper_h = int(w * 0.95), int(w * 0.85)
    d.ellipse([cx - upper_w - 2, cy - upper_h, cx - 2, cy + upper_h // 6],
              fill=ink, outline=accent, width=2)
    d.ellipse([cx + 2, cy - upper_h, cx + upper_w + 2, cy + upper_h // 6],
              fill=ink, outline=accent, width=2)
    lower_w, lower_h = int(w * 0.6), int(w * 0.55)
    d.ellipse([cx - lower_w - 2, cy - 4, cx - 2, cy + lower_h * 2],
              fill=ink, outline=accent, width=2)
    d.ellipse([cx + 2, cy - 4, cx + lower_w + 2, cy + lower_h * 2],
              fill=ink, outline=accent, width=2)
    body_h = int(w * 1.05)
    d.rounded_rectangle([cx - 4, cy - body_h // 2, cx + 4, cy + body_h // 2],
                        radius=4, fill=accent)
    d.line([cx - 3, cy - body_h // 2, cx - 12, cy - body_h // 2 - 16],
           fill=accent, width=3)
    d.line([cx + 3, cy - body_h // 2, cx + 12, cy - body_h // 2 - 16],
           fill=accent, width=3)
    d.ellipse([cx - upper_w + 8, cy - upper_h // 2 - 4,
               cx - upper_w + 22, cy - upper_h // 2 + 10], fill=accent)
    d.ellipse([cx + upper_w - 22, cy - upper_h // 2 - 4,
               cx + upper_w - 8, cy - upper_h // 2 + 10], fill=accent)


# ─── FLYER 1 — Founding Members (Pre-launch) ─────────────────────────
def render_founding() -> Image.Image:
    img = Image.new("RGB", (W, H), "#FFFFFF")
    d = ImageDraw.Draw(img)

    # 1. Banner
    banner_bottom = draw_banner(d, img)

    # 2. Headline — SAFE margins, capped size to prevent overflow.
    # "FIND YOUR PEOPLE" at 168pt condensed fits ~980px; we allow 1060px.
    head_y = banner_bottom + 40
    fit_headline(d, "FIND YOUR PEOPLE", head_y,
                 max_w=W - 2 * SIDE, start_size=168, min_size=110,
                 fill=NAVY_INK)

    # 3. Sub-headline
    sub_y = head_y + 170
    wrap_centre(d, "Meet new friends, discover local events, join community groups.",
                sub_y, font(34, bold=False), SLATE,
                max_w=W - 2 * SIDE - 100, line_gap=10)

    # 4. Gold ribbon — "BECOME A FOUNDING MEMBER"
    RIBBON_Y = sub_y + 105
    RIBBON_H = 240
    d.rounded_rectangle([SIDE - 30, RIBBON_Y, W - SIDE + 30,
                         RIBBON_Y + RIBBON_H],
                        radius=28, fill=GOLD,
                        outline=GOLD_DARK, width=5)

    # Butterfly + lead line
    ICON_SPAN = 78
    ICON_GAP = 20
    lead_size = 60
    lead_text = "BECOME A FOUNDING MEMBER"
    while lead_size > 42:
        lf = font(lead_size, bold=True, condensed=True)
        lb = d.textbbox((0, 0), lead_text, font=lf)
        if (lb[2] - lb[0]) <= W - 260 - (ICON_SPAN + ICON_GAP):
            break
        lead_size -= 4
    lf = font(lead_size, bold=True, condensed=True)
    lb = d.textbbox((0, 0), lead_text, font=lf)
    lead_w = lb[2] - lb[0]
    block_w = ICON_SPAN + ICON_GAP + lead_w
    start_x = (W - block_w) / 2
    lead_y = RIBBON_Y + 24
    draw_butterfly_glyph(d, int(start_x + ICON_SPAN / 2),
                         lead_y + lead_size // 2 + 2, ICON_SPAN,
                         "#FFFFFF", GOLD_DARK)
    d.text((start_x + ICON_SPAN + ICON_GAP, lead_y),
           lead_text, font=lf, fill=GOLD_DARK)

    # Benefit bullets (3 lines) inside the ribbon
    bul_fnt = font(26, bold=False)
    bul_bold = font(26, bold=True)
    benefits = [
        "Founding Member badge",
        "Early access to new features",
        "Help build Australia's friendliest community",
    ]
    by = lead_y + lead_size + 26
    for b_txt in benefits:
        bullet = "•  " + b_txt
        bb = d.textbbox((0, 0), bullet, font=bul_bold)
        d.text(((W - (bb[2] - bb[0])) / 2, by), bullet,
               font=bul_bold, fill=GOLD_DARK)
        by += (bb[3] - bb[1]) + 4

    # 5. QR code — LARGER (560px instead of 520)
    qr_size = 560
    qr_y = RIBBON_Y + RIBBON_H + 34
    qr_x = (W - qr_size) // 2
    qr_img = make_qr("https://www.friendplace.com.au", qr_size)
    img.paste(qr_img, (qr_x, qr_y))
    d.rectangle([qr_x - 14, qr_y - 14, qr_x + qr_size + 14,
                 qr_y + qr_size + 14], outline=NAVY_INK, width=4)

    # 6. Scan CTA + fallback URL for manual typing
    cta_y = qr_y + qr_size + 26
    fit_headline(d, "SCAN TO JOIN FREE", cta_y,
                 max_w=W - 2 * SIDE, start_size=68, min_size=52,
                 fill=NAVY_INK)
    draw_centre(d, "Can't scan? Visit www.friendplace.com.au",
                cta_y + 74, font(24, bold=False), SLATE)

    # 7. Slogan foot
    draw_centre(d, "Because you belong too.",
                cta_y + 116, font(28, italic=True), TEAL)

    return img


# ─── FLYER 2 — Download the App (Launch) ─────────────────────────────
def render_download() -> Image.Image:
    img = Image.new("RGB", (W, H), "#FFFFFF")
    d = ImageDraw.Draw(img)

    # 1. Banner (identical branding)
    banner_bottom = draw_banner(d, img)

    # 2. Launch headline — celebratory, uses accent teal for LIVE
    head_y = banner_bottom + 40
    # Split into two lines so we get a bold, poster-y feel
    line1 = "FRIENDPLACE"
    line2 = "IS NOW LIVE!"
    l1_bottom = fit_headline(d, line1, head_y, max_w=W - 2 * SIDE,
                             start_size=178, min_size=120, fill=NAVY_INK)
    l2_bottom = fit_headline(d, line2, l1_bottom + 6,
                             max_w=W - 2 * SIDE,
                             start_size=178, min_size=120, fill=TEAL)

    # 3. Sub-headline
    sub_y = l2_bottom + 40
    end_y = wrap_centre(
        d,
        "Meet new friends, join community groups, discover local events "
        "and chat in FP Café.",
        sub_y, font(30, bold=False), SLATE,
        max_w=W - 2 * SIDE - 80, line_gap=8,
    )

    # 4. Two QR blocks side-by-side (App Store | Google Play)
    qr_size = 380
    gap_between = 120
    total_w = qr_size * 2 + gap_between
    qr_row_x = (W - total_w) // 2
    qr_row_y = end_y + 40

    def store_block(x: int, y: int, title: str, sub: str,
                    qr_target: str) -> None:
        # Store label above
        f_lbl = font(30, bold=True)
        lb = d.textbbox((0, 0), title, font=f_lbl)
        d.text((x + (qr_size - (lb[2] - lb[0])) / 2, y - 46),
               title, font=f_lbl, fill=NAVY_INK)
        # QR
        qi = make_qr(qr_target, qr_size)
        img.paste(qi, (x, y))
        d.rectangle([x - 10, y - 10, x + qr_size + 10, y + qr_size + 10],
                    outline=NAVY_INK, width=3)
        # Store sub-label below
        f_sub = font(22, bold=False)
        sb = d.textbbox((0, 0), sub, font=f_sub)
        d.text((x + (qr_size - (sb[2] - sb[0])) / 2, y + qr_size + 20),
               sub, font=f_sub, fill=SLATE)

    # Placeholder store URLs (user replaces with real store links post-launch)
    store_block(qr_row_x, qr_row_y, "APP STORE",
                "Scan on iPhone",
                "https://apps.apple.com/app/friendplace")
    store_block(qr_row_x + qr_size + gap_between, qr_row_y,
                "GOOGLE PLAY", "Scan on Android",
                "https://play.google.com/store/apps/details?id=au.com.friendplace")

    # 5. CTA block below the QRs
    cta_top = qr_row_y + qr_size + 90
    fit_headline(d, "DOWNLOAD FRIENDPLACE TODAY", cta_top,
                 max_w=W - 2 * SIDE, start_size=76, min_size=48,
                 fill=NAVY_INK)

    # 6. Slogan foot
    draw_centre(d, "Because you belong too.",
                cta_top + 90, font(30, italic=True), TEAL)

    return img


# ─── entry point ─────────────────────────────────────────────────────
def main() -> None:
    print(f"Rendering to {OUT_DIR} …")
    f1 = render_founding()
    f1.save(OUT_DIR / "founding.png", format="PNG", optimize=True)
    print("  ✓ founding.png")

    f2 = render_download()
    f2.save(OUT_DIR / "download.png", format="PNG", optimize=True)
    print("  ✓ download.png")

    # Also save small preview thumbnails (max width 620) for chat inline use
    for name in ("founding", "download"):
        src = OUT_DIR / f"{name}.png"
        thumb = Image.open(src)
        thumb.thumbnail((620, 900), Image.LANCZOS)
        thumb.save(OUT_DIR / f"{name}-thumb.png", format="PNG", optimize=True)
        print(f"  ✓ {name}-thumb.png")

    print("Done.")


if __name__ == "__main__":
    main()
