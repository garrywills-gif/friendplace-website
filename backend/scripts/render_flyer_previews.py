"""FriendPlace flyer artwork — V2 designs (user-approved).

Two campaigns, single-purpose each:

  Flyer 1 — Founding Members (Pre-launch)  → drives friendplace.com.au sign-ups
  Flyer 2 — Download the App (Launch)      → drives App Store + Play Store

Both flyers ship as five deliverables each, saved to
`/app/website/public/flyer-mockups/` for preview:

  <name>-a4.png        1240 × 1754   A4 portrait, 150 dpi   digital preview
  <name>-a4-hires.png  2480 × 3508   A4 portrait, 300 dpi   print PNG
  <name>-a3-hires.png  3508 × 4960   A3 portrait, 300 dpi   large-format print
  <name>-a4.pdf        A4 portrait, 300 dpi                 printable PDF
  <name>-a3.pdf        A3 portrait, 300 dpi                 printable PDF
  <name>-social.png    1080 × 1080   square, 72 dpi         Instagram / FB

Design system (single source of truth for both flyers):

  Palette   #0B1F45 header · #7DB1FF "Place" · #0F3D6E navy ink · #0F766E teal
            #FBBF24 gold ribbon · #7C5300 gold ink · #475569 slate body
  Type      DejaVu Sans / Liberation Sans (whichever the host has)
  Slogan    "Because you belong too."           (teal, italic)
  Mission   "Helping Australians build genuine friendships and
             stronger local communities."      (slate, small)
  Grid      All pixel constants scale with `scale` so the same
            layout can render natively at any DPI.

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

# Brand palette
NAVY_HEADER = "#0B1F45"
NAVY_INK = "#0F3D6E"
TEAL = "#0F766E"
INK = "#0F172A"
SLATE = "#475569"
MUTED = "#B7C7E5"
SKY = "#7DB1FF"
GOLD = "#FBBF24"
GOLD_DARK = "#7C5300"
CREAM = "#FEFCF8"

MISSION_LINE = ("Helping Australians build genuine friendships "
                "and stronger local communities.")


# ─── font resolution ─────────────────────────────────────────────────
def _font(size: int, bold: bool = True, italic: bool = False,
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


class Canvas:
    """Wrapper around a PIL Image that scales every dimension by `s`.

    Rendering functions declare all sizes in the baseline 1240×1754 units;
    the canvas multiplies them by `s` at draw time. That way A4-150dpi
    (s=1) and A4-300dpi (s=2) produce identical layouts, just at
    different pixel densities."""

    def __init__(self, base_w: int, base_h: int, scale: float,
                 bg: str = "#FFFFFF"):
        self.s = scale
        self.base_w = base_w
        self.base_h = base_h
        self.W = int(base_w * scale)
        self.H = int(base_h * scale)
        self.img = Image.new("RGB", (self.W, self.H), bg)
        self.d = ImageDraw.Draw(self.img)

    def px(self, v: float) -> int:
        return int(v * self.s)

    def font(self, size: int, **kwargs) -> ImageFont.FreeTypeFont:
        return _font(self.px(size), **kwargs)

    def text_w(self, text: str, fnt: ImageFont.FreeTypeFont) -> int:
        b = self.d.textbbox((0, 0), text, font=fnt)
        return b[2] - b[0]

    def text_h(self, text: str, fnt: ImageFont.FreeTypeFont) -> int:
        b = self.d.textbbox((0, 0), text, font=fnt)
        return b[3] - b[1]

    def centre(self, text: str, y: int, fnt: ImageFont.FreeTypeFont,
               fill: str) -> int:
        b = self.d.textbbox((0, 0), text, font=fnt)
        self.d.text(((self.W - (b[2] - b[0])) / 2, self.px(y)),
                    text, font=fnt, fill=fill)
        return y + (b[3] - b[1]) / self.s

    def fit_headline(self, text: str, y: int, max_w: int,
                     start_size: int, min_size: int, fill: str,
                     condensed: bool = True, bold: bool = True) -> int:
        size = start_size
        while size > min_size:
            f = self.font(size, bold=bold, condensed=condensed)
            if self.text_w(text, f) <= self.px(max_w):
                break
            size -= 4
        f = self.font(size, bold=bold, condensed=condensed)
        b = self.d.textbbox((0, 0), text, font=f)
        self.d.text(((self.W - (b[2] - b[0])) / 2, self.px(y)),
                    text, font=f, fill=fill)
        return y + (b[3] - b[1]) / self.s

    def wrap_centre(self, text: str, y: int, fnt: ImageFont.FreeTypeFont,
                    fill: str, max_w: int, line_gap: int = 10) -> int:
        words = text.split()
        lines: list[str] = []
        cur = ""
        for w_ in words:
            cand = (cur + " " + w_).strip()
            if self.text_w(cand, fnt) <= self.px(max_w):
                cur = cand
            else:
                if cur:
                    lines.append(cur)
                cur = w_
        if cur:
            lines.append(cur)
        cur_y = y
        for line in lines:
            b = self.d.textbbox((0, 0), line, font=fnt)
            self.d.text(((self.W - (b[2] - b[0])) / 2, self.px(cur_y)),
                        line, font=fnt, fill=fill)
            cur_y += (b[3] - b[1]) / self.s + line_gap
        return cur_y

    def rectangle(self, box, **kwargs):
        b = [self.px(v) for v in box]
        self.d.rectangle(b, **kwargs)

    def rounded_rectangle(self, box, radius: int, **kwargs):
        b = [self.px(v) for v in box]
        self.d.rounded_rectangle(b, radius=self.px(radius), **kwargs)

    def line(self, pts, **kwargs):
        p = [self.px(v) for v in pts]
        w = kwargs.pop("width", 1)
        self.d.line(p, width=self.px(w), **kwargs)


def _make_qr(url: str, size_px: int) -> Image.Image:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10, border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    q = qr.make_image(fill_color=INK, back_color="#FFFFFF").convert("RGB")
    return q.resize((size_px, size_px), Image.LANCZOS)


def _paste_qr(c: Canvas, url: str, size: int, x: int, y: int,
              frame_w: int = 4) -> None:
    q = _make_qr(url, c.px(size))
    c.img.paste(q, (c.px(x), c.px(y)))
    c.rectangle([x - 14, y - 14, x + size + 14, y + size + 14],
                outline=NAVY_INK, width=frame_w)


def _draw_butterfly(c: Canvas, cx: int, cy: int, span: int,
                    ink: str, accent: str) -> None:
    """Small stylised butterfly rendered with Pillow primitives."""
    s = c.s
    d = c.d
    cx_px, cy_px = c.px(cx), c.px(cy)
    span_px = c.px(span)
    w = span_px // 2
    upper_w, upper_h = int(w * 0.95), int(w * 0.85)
    d.ellipse([cx_px - upper_w - 2, cy_px - upper_h,
               cx_px - 2, cy_px + upper_h // 6],
              fill=ink, outline=accent, width=max(2, int(2 * s)))
    d.ellipse([cx_px + 2, cy_px - upper_h,
               cx_px + upper_w + 2, cy_px + upper_h // 6],
              fill=ink, outline=accent, width=max(2, int(2 * s)))
    lower_w, lower_h = int(w * 0.6), int(w * 0.55)
    d.ellipse([cx_px - lower_w - 2, cy_px - 4,
               cx_px - 2, cy_px + lower_h * 2],
              fill=ink, outline=accent, width=max(2, int(2 * s)))
    d.ellipse([cx_px + 2, cy_px - 4,
               cx_px + lower_w + 2, cy_px + lower_h * 2],
              fill=ink, outline=accent, width=max(2, int(2 * s)))
    body_h = int(w * 1.05)
    d.rounded_rectangle([cx_px - 4, cy_px - body_h // 2,
                         cx_px + 4, cy_px + body_h // 2],
                        radius=max(2, int(4 * s)), fill=accent)
    d.line([cx_px - 3, cy_px - body_h // 2,
            cx_px - 12, cy_px - body_h // 2 - 16],
           fill=accent, width=max(2, int(3 * s)))
    d.line([cx_px + 3, cy_px - body_h // 2,
            cx_px + 12, cy_px - body_h // 2 - 16],
           fill=accent, width=max(2, int(3 * s)))
    d.ellipse([cx_px - upper_w + 8, cy_px - upper_h // 2 - 4,
               cx_px - upper_w + 22, cy_px - upper_h // 2 + 10], fill=accent)
    d.ellipse([cx_px + upper_w - 22, cy_px - upper_h // 2 - 4,
               cx_px + upper_w - 8, cy_px - upper_h // 2 + 10], fill=accent)


# ─── shared banner drawn on both flyers ──────────────────────────────
BANNER_H = 380
SIDE = 90


def _draw_banner(c: Canvas) -> int:
    c.rectangle([0, 0, c.base_w, BANNER_H], fill=NAVY_HEADER)

    text_left = SIDE
    try:
        butterfly = Image.open(BUTTERFLY_PATH).convert("RGBA")
        bfy_h = c.px(int(BANNER_H * 0.82))
        bfy_scale = bfy_h / butterfly.height
        bfy_w = int(butterfly.width * bfy_scale)
        butterfly = butterfly.resize((bfy_w, bfy_h), Image.LANCZOS)
        bfy_x = c.px(SIDE - 30)
        bfy_y = c.px(BANNER_H) // 2 - bfy_h // 2
        c.img.paste(butterfly, (bfy_x, bfy_y), butterfly)
        text_left = (bfy_x + bfy_w) / c.s + 30
    except Exception:
        pass

    wm_max_w = c.base_w - SIDE - text_left
    wm_size = 132
    while wm_size > 80:
        f_wm = c.font(wm_size, bold=True)
        if c.text_w("FriendPlace", f_wm) <= c.px(wm_max_w):
            break
        wm_size -= 4
    f_wm = c.font(wm_size, bold=True)
    wm_y = 52
    friend_bbox = c.d.textbbox((0, 0), "Friend", font=f_wm)
    friend_w = friend_bbox[2] - friend_bbox[0]
    c.d.text((c.px(text_left), c.px(wm_y)), "Friend",
             font=f_wm, fill="#FFFFFF")
    c.d.text((c.px(text_left) + friend_w, c.px(wm_y)), "Place",
             font=f_wm, fill=SKY)
    wm_bottom = wm_y + (friend_bbox[3] - friend_bbox[1]) / c.s

    f_tag = c.font(42, bold=True)
    c.d.text((c.px(text_left), c.px(wm_bottom + 14)),
             "Because you belong too.", font=f_tag, fill="#FFFFFF")

    div_y = BANNER_H - 80
    c.line([text_left, div_y, c.base_w - SIDE, div_y],
           fill="#22336D", width=2)
    f_contact = c.font(28, bold=False)
    c.d.text((c.px(text_left), c.px(div_y + 22)),
             "hello@friendplace.com.au", font=f_contact, fill=MUTED)
    email_w = c.text_w("hello@friendplace.com.au", f_contact)
    sep_x = text_left + email_w / c.s + 22
    c.d.text((c.px(sep_x), c.px(div_y + 22)), "·",
             font=f_contact, fill=MUTED)
    c.d.text((c.px(sep_x + 22), c.px(div_y + 22)),
             "www.friendplace.com.au", font=f_contact, fill=MUTED)

    return BANNER_H


def _draw_mission_footer(c: Canvas, y: int) -> None:
    """Small italic mission line + bottom rule. Used on both flyers."""
    c.line([SIDE + 60, y - 14, c.base_w - SIDE - 60, y - 14],
           fill="#E2E8F0", width=2)
    fnt = c.font(22, bold=False, italic=True)
    c.wrap_centre(MISSION_LINE, y + 6, fnt, SLATE,
                  max_w=c.base_w - 2 * SIDE - 60, line_gap=6)


# ─── FLYER 1 — Founding Members ──────────────────────────────────────
def render_founding(scale: float = 1.0) -> Image.Image:
    c = Canvas(1240, 1754, scale)
    _draw_banner(c)

    # Headline
    head_y = BANNER_H + 34
    c.fit_headline("FIND YOUR PEOPLE", head_y,
                   max_w=1240 - 2 * SIDE,
                   start_size=168, min_size=110, fill=NAVY_INK)

    # Sub-headline
    sub_y = head_y + 170
    c.wrap_centre(
        "Meet new friends, discover local events, join community groups.",
        sub_y, c.font(32, bold=False), SLATE,
        max_w=1240 - 2 * SIDE - 100, line_gap=10,
    )

    # ─── Compact gold ribbon: headline only, no bullets inside ────────
    RIBBON_Y = sub_y + 96
    RIBBON_H = 120
    c.rounded_rectangle([SIDE - 30, RIBBON_Y, 1240 - SIDE + 30,
                         RIBBON_Y + RIBBON_H],
                        radius=28, fill=GOLD, outline=GOLD_DARK, width=5)

    lead_size = 68
    lead_text = "BECOME A FOUNDING MEMBER"
    while lead_size > 44:
        lf = c.font(lead_size, bold=True, condensed=True)
        if c.text_w(lead_text, lf) <= c.px(1240 - 260):
            break
        lead_size -= 4
    lf = c.font(lead_size, bold=True, condensed=True)
    lb_h = c.text_h(lead_text, lf)
    lead_w_px = c.text_w(lead_text, lf)
    start_x_px = (c.W - lead_w_px) / 2
    lead_y = RIBBON_Y + (RIBBON_H - lb_h / c.s) / 2 - 6
    c.d.text((start_x_px, c.px(lead_y)),
             lead_text, font=lf, fill=GOLD_DARK)

    # ─── Benefits panel on WHITE (breathing room) ─────────────────────
    #   Intro sentence
    intro_y = RIBBON_Y + RIBBON_H + 26
    intro_fnt = c.font(26, bold=True)
    c.centre("Join free today and help shape FriendPlace before launch.",
             intro_y, intro_fnt, NAVY_INK)

    #   Two check-mark benefits (checks drawn as vector strokes for
    #   consistency across systems that lack Unicode heavy check ✔)
    def _draw_check(cx: int, cy: int, size: int, colour: str) -> None:
        s = c.s
        cx_px, cy_px = c.px(cx), c.px(cy)
        r = c.px(size)
        w = max(3, int(4 * s))
        c.d.line([cx_px - r * 6 // 10, cy_px + r * 1 // 10,
                  cx_px - r * 1 // 10, cy_px + r * 6 // 10],
                 fill=colour, width=w)
        c.d.line([cx_px - r * 1 // 10, cy_px + r * 6 // 10,
                  cx_px + r * 7 // 10, cy_px - r * 5 // 10],
                 fill=colour, width=w)

    check_fnt = c.font(24, bold=False)
    benefits = [
        "Have your say in new features",
        "Receive your exclusive Founding Member badge",
    ]
    by = intro_y + 44
    check_size = 16
    check_gap = 22   # gap between check and text
    for line in benefits:
        bb = c.d.textbbox((0, 0), line, font=check_fnt)
        text_w = bb[2] - bb[0]
        text_h = bb[3] - bb[1]
        # Full block width = check_size*2 + gap + text_w  (scaled to baseline)
        block_baseline_w = check_size * 2 + check_gap + text_w / c.s
        block_x = (1240 - block_baseline_w) / 2
        # Draw check centred on the text's vertical midpoint
        check_cx = block_x + check_size
        check_cy = by + text_h / c.s / 2
        _draw_check(int(check_cx), int(check_cy), check_size, TEAL)
        c.d.text((c.px(block_x + check_size * 2 + check_gap), c.px(by)),
                 line, font=check_fnt, fill=INK)
        by += text_h / c.s + 10

    #   Small urgency line (italic, muted)
    urgency_fnt = c.font(20, bold=False, italic=True)
    urgency_y = by + 6
    c.centre("Free to join \u2014 for a limited number of early members.",
             urgency_y, urgency_fnt, SLATE)

    # ─── Bottom-anchored footer stack (mirrors render_download()) ────
    PAGE_H = 1754
    mission_y = PAGE_H - 62
    slogan_y = mission_y - 40
    caption_y = slogan_y - 30
    pill_h = 56
    pill_y = caption_y - pill_h - 10
    cta_y = pill_y - 68

    # SCAN CTA
    c.fit_headline("SCAN TO JOIN FREE", cta_y,
                   max_w=1240 - 2 * SIDE,
                   start_size=58, min_size=44, fill=NAVY_INK)

    # PROMINENT WEBSITE URL PILL
    pill_text = "www.friendplace.com.au"
    pf = c.font(32, bold=True)
    pw = c.text_w(pill_text, pf) + c.px(52)
    pill_x = (c.W - pw) / 2
    c.d.rounded_rectangle(
        [pill_x, c.px(pill_y), pill_x + pw, c.px(pill_y + pill_h)],
        radius=c.px(pill_h // 2), fill=NAVY_INK,
    )
    tb = c.d.textbbox((0, 0), pill_text, font=pf)
    c.d.text((pill_x + (pw - (tb[2] - tb[0])) / 2,
              c.px(pill_y) + (c.px(pill_h) - (tb[3] - tb[1])) / 2 - c.px(4)),
             pill_text, font=pf, fill="#FFFFFF")

    # Small helper caption
    c.centre("Can't scan? Type this address into your phone browser.",
             caption_y, c.font(17, bold=False), SLATE)

    # Slogan
    c.centre("Because you belong too.", slogan_y,
             c.font(24, italic=True), TEAL)

    # Mission footer
    _draw_mission_footer(c, mission_y)

    # QR — placed between the benefits panel and the CTA using the
    # remaining vertical space. Anchoring the QR relative to the CTA
    # keeps the whole page composition tight regardless of scale.
    qr_size = 460
    qr_y = cta_y - qr_size - 18
    qr_x = (1240 - qr_size) // 2
    _paste_qr(c, "https://www.friendplace.com.au", qr_size, qr_x, qr_y)

    return c.img


# ─── FLYER 2 — Download the App ──────────────────────────────────────
def render_download(scale: float = 1.0) -> Image.Image:
    c = Canvas(1240, 1754, scale)
    _draw_banner(c)

    head_y = BANNER_H + 34
    l1_bottom = c.fit_headline("FRIENDPLACE", head_y,
                               max_w=1240 - 2 * SIDE,
                               start_size=178, min_size=120, fill=NAVY_INK)
    l2_bottom = c.fit_headline("IS NOW LIVE!", l1_bottom + 6,
                               max_w=1240 - 2 * SIDE,
                               start_size=178, min_size=120, fill=TEAL)

    sub_y = l2_bottom + 34
    end_y = c.wrap_centre(
        "Meet new friends, join community groups, discover local events "
        "and chat in FP Café.",
        sub_y, c.font(30, bold=False), SLATE,
        max_w=1240 - 2 * SIDE - 80, line_gap=8,
    )

    # Two QR blocks
    qr_size = 380
    gap_between = 100
    total_w = qr_size * 2 + gap_between
    qr_row_x = (1240 - total_w) // 2
    qr_row_y = end_y + 100

    def _store_block(x: int, y: int, title: str, sub: str,
                     qr_target: str) -> None:
        f_lbl = c.font(30, bold=True)
        lb = c.d.textbbox((0, 0), title, font=f_lbl)
        c.d.text((c.px(x) + (c.px(qr_size) - (lb[2] - lb[0])) / 2,
                  c.px(y - 46)), title, font=f_lbl, fill=NAVY_INK)
        _paste_qr(c, qr_target, qr_size, x, y, frame_w=3)
        f_sub = c.font(22, bold=False)
        sb = c.d.textbbox((0, 0), sub, font=f_sub)
        c.d.text((c.px(x) + (c.px(qr_size) - (sb[2] - sb[0])) / 2,
                  c.px(y + qr_size + 20)), sub, font=f_sub, fill=SLATE)

    _store_block(qr_row_x, qr_row_y, "APP STORE", "Scan on iPhone",
                 "https://apps.apple.com/app/friendplace")
    _store_block(qr_row_x + qr_size + gap_between, qr_row_y,
                 "GOOGLE PLAY", "Scan on Android",
                 "https://play.google.com/store/apps/details?id=au.com.friendplace")

    # ─── Bottom-anchored footer (fixed from top instead of stacked
    # so it never falls off the page regardless of scale). ────────────
    PAGE_H = 1754
    mission_y = PAGE_H - 62      # mission line sits above bottom rule
    slogan_y = mission_y - 46    # "Because you belong too."
    cta_top = slogan_y - 108     # "DOWNLOAD FRIENDPLACE TODAY"

    c.fit_headline("DOWNLOAD FRIENDPLACE TODAY", cta_top,
                   max_w=1240 - 2 * SIDE,
                   start_size=64, min_size=44, fill=NAVY_INK)

    c.centre("Because you belong too.", slogan_y,
             c.font(28, italic=True), TEAL)

    _draw_mission_footer(c, mission_y)

    return c.img


# ─── social square (1080 × 1080) — designed natively square ──────────
def render_founding_social() -> Image.Image:
    """Instagram / Facebook square version of the founding flyer."""
    c = Canvas(1080, 1080, 1.0)
    W = c.base_w

    # Header strip — condensed (fewer contact details, no divider rule)
    HDR_H = 200
    c.rectangle([0, 0, W, HDR_H], fill=NAVY_HEADER)
    try:
        butterfly = Image.open(BUTTERFLY_PATH).convert("RGBA")
        bfy_h = int(HDR_H * 0.72)
        bfy_scale = bfy_h / butterfly.height
        bfy_w = int(butterfly.width * bfy_scale)
        butterfly = butterfly.resize((bfy_w, bfy_h), Image.LANCZOS)
        c.img.paste(butterfly, (48, (HDR_H - bfy_h) // 2), butterfly)
        text_left = 48 + bfy_w + 20
    except Exception:
        text_left = 60
    f_wm = c.font(72, bold=True)
    friend_bbox = c.d.textbbox((0, 0), "Friend", font=f_wm)
    c.d.text((text_left, 46), "Friend", font=f_wm, fill="#FFFFFF")
    c.d.text((text_left + (friend_bbox[2] - friend_bbox[0]), 46),
             "Place", font=f_wm, fill=SKY)
    c.d.text((text_left, 46 + (friend_bbox[3] - friend_bbox[1]) + 6),
             "Because you belong too.",
             font=c.font(26, bold=True), fill="#FFFFFF")

    # Big headline
    head_y = HDR_H + 34
    c.fit_headline("FIND YOUR PEOPLE", head_y, max_w=W - 100,
                   start_size=130, min_size=90, fill=NAVY_INK)

    c.wrap_centre(
        "Meet new friends. Join local events. Feel connected.",
        head_y + 130, c.font(28, bold=False), SLATE,
        max_w=W - 120, line_gap=8,
    )

    # Gold ribbon (single line, compact)
    RIBBON_Y = head_y + 216
    RIBBON_H = 100
    c.rounded_rectangle([50, RIBBON_Y, W - 50, RIBBON_Y + RIBBON_H],
                        radius=22, fill=GOLD, outline=GOLD_DARK, width=4)
    lead_txt = "BECOME A FOUNDING MEMBER"
    lf = c.font(40, bold=True, condensed=True)
    while c.text_w(lead_txt, lf) > W - 100:
        lf = c.font(int(lf.size / c.s) - 2, bold=True, condensed=True)
    lb = c.d.textbbox((0, 0), lead_txt, font=lf)
    lead_w = lb[2] - lb[0]
    start_x = (W - lead_w) / 2
    lead_y = RIBBON_Y + (RIBBON_H - (lb[3] - lb[1])) / 2 - 4
    c.d.text((start_x, lead_y),
             lead_txt, font=lf, fill=GOLD_DARK)

    # QR
    qr_size = 320
    qr_y = RIBBON_Y + RIBBON_H + 22
    qr_x = (W - qr_size) // 2
    _paste_qr(c, "https://www.friendplace.com.au", qr_size, qr_x, qr_y)

    # URL pill
    pill_y = qr_y + qr_size + 22
    pill_h = 52
    pill_text = "www.friendplace.com.au"
    pf = c.font(28, bold=True)
    pw = c.text_w(pill_text, pf) + 52
    pill_x = (W - pw) / 2
    c.d.rounded_rectangle(
        [pill_x, pill_y, pill_x + pw, pill_y + pill_h],
        radius=pill_h // 2, fill=NAVY_INK,
    )
    tb = c.d.textbbox((0, 0), pill_text, font=pf)
    c.d.text((pill_x + (pw - (tb[2] - tb[0])) / 2,
              pill_y + (pill_h - (tb[3] - tb[1])) / 2 - 4),
             pill_text, font=pf, fill="#FFFFFF")

    c.centre("Because you belong too.", pill_y + pill_h + 14,
             c.font(22, italic=True), TEAL)
    # Mission line
    c.wrap_centre(
        MISSION_LINE, pill_y + pill_h + 50,
        c.font(17, bold=False, italic=True), SLATE,
        max_w=W - 100, line_gap=4,
    )
    return c.img


def render_download_social() -> Image.Image:
    c = Canvas(1080, 1080, 1.0)
    W = c.base_w

    # Header (same as founding square)
    HDR_H = 200
    c.rectangle([0, 0, W, HDR_H], fill=NAVY_HEADER)
    try:
        butterfly = Image.open(BUTTERFLY_PATH).convert("RGBA")
        bfy_h = int(HDR_H * 0.72)
        bfy_scale = bfy_h / butterfly.height
        bfy_w = int(butterfly.width * bfy_scale)
        butterfly = butterfly.resize((bfy_w, bfy_h), Image.LANCZOS)
        c.img.paste(butterfly, (48, (HDR_H - bfy_h) // 2), butterfly)
        text_left = 48 + bfy_w + 20
    except Exception:
        text_left = 60
    f_wm = c.font(72, bold=True)
    friend_bbox = c.d.textbbox((0, 0), "Friend", font=f_wm)
    c.d.text((text_left, 46), "Friend", font=f_wm, fill="#FFFFFF")
    c.d.text((text_left + (friend_bbox[2] - friend_bbox[0]), 46),
             "Place", font=f_wm, fill=SKY)
    c.d.text((text_left, 46 + (friend_bbox[3] - friend_bbox[1]) + 6),
             "Because you belong too.",
             font=c.font(26, bold=True), fill="#FFFFFF")

    # Big two-line headline
    head_y = HDR_H + 34
    l1_b = c.fit_headline("FRIENDPLACE", head_y, max_w=W - 100,
                          start_size=130, min_size=90, fill=NAVY_INK)
    l2_b = c.fit_headline("IS NOW LIVE!", l1_b + 4, max_w=W - 100,
                          start_size=130, min_size=90, fill=TEAL)

    c.wrap_centre(
        "Meet friends, join groups, chat in FP Café.",
        l2_b + 46, c.font(26, bold=False), SLATE,
        max_w=W - 120, line_gap=8,
    )

    # Two QR side-by-side
    qr_size = 300
    gap = 60
    total = qr_size * 2 + gap
    row_x = (W - total) // 2
    row_y = l2_b + 130

    def _sq_store(x, y, title, sub, url):
        f_lbl = c.font(24, bold=True)
        lb = c.d.textbbox((0, 0), title, font=f_lbl)
        c.d.text((x + (qr_size - (lb[2] - lb[0])) / 2, y - 38),
                 title, font=f_lbl, fill=NAVY_INK)
        _paste_qr(c, url, qr_size, x, y, frame_w=3)
        f_sub = c.font(18, bold=False)
        sb = c.d.textbbox((0, 0), sub, font=f_sub)
        c.d.text((x + (qr_size - (sb[2] - sb[0])) / 2, y + qr_size + 12),
                 sub, font=f_sub, fill=SLATE)

    _sq_store(row_x, row_y, "APP STORE", "iPhone",
              "https://apps.apple.com/app/friendplace")
    _sq_store(row_x + qr_size + gap, row_y, "GOOGLE PLAY", "Android",
              "https://play.google.com/store/apps/details?id=au.com.friendplace")

    # Bottom-anchored footer (mirrors render_download layout)
    PAGE_H = 1080
    mission_y = PAGE_H - 42
    slogan_y = mission_y - 36
    c.centre("Because you belong too.", slogan_y,
             c.font(24, italic=True), TEAL)
    c.wrap_centre(
        MISSION_LINE, mission_y,
        c.font(17, bold=False, italic=True), SLATE,
        max_w=W - 100, line_gap=4,
    )
    return c.img


# ─── deliverable pipeline ────────────────────────────────────────────
def _save_pdf(im: Image.Image, path: Path, dpi: int) -> None:
    im.convert("RGB").save(str(path), format="PDF", resolution=float(dpi))


def _write_deliverables(name: str, portrait_scale2: Image.Image,
                        social: Image.Image) -> None:
    """
    portrait_scale2 is the master A4 rendered at scale=2 → 2480×3508 (300 dpi)
    We derive from it:
        <name>-a4.png         1240 × 1754    downscaled (preview)
        <name>-a4-hires.png   2480 × 3508    native 300 dpi
        <name>-a3-hires.png   3508 × 4960    scaled up 1.414×
        <name>-a4.pdf         A4 print       resolution=300
        <name>-a3.pdf         A3 print       resolution=300
        <name>-social.png     1080 × 1080    native
    """
    # A4 lo-res preview
    a4_lo = portrait_scale2.copy()
    a4_lo.thumbnail((1240, 1754), Image.LANCZOS)
    a4_lo.save(OUT_DIR / f"{name}-a4.png", format="PNG", optimize=True)

    # A4 hi-res PNG (master)
    portrait_scale2.save(OUT_DIR / f"{name}-a4-hires.png",
                         format="PNG", optimize=True)

    # A4 PDF (300 dpi print)
    _save_pdf(portrait_scale2, OUT_DIR / f"{name}-a4.pdf", dpi=300)

    # A3 hi-res PNG — upscale 2480×3508 → 3508×4960 (scale 1.414)
    a3_w, a3_h = 3508, 4960
    a3 = portrait_scale2.resize((a3_w, a3_h), Image.LANCZOS)
    a3.save(OUT_DIR / f"{name}-a3-hires.png",
            format="PNG", optimize=True)
    _save_pdf(a3, OUT_DIR / f"{name}-a3.pdf", dpi=300)

    # Social square
    social.save(OUT_DIR / f"{name}-social.png",
                format="PNG", optimize=True)

    # Small thumb for chat inline (max 620 wide)
    thumb = portrait_scale2.copy()
    thumb.thumbnail((620, 1400), Image.LANCZOS)
    thumb.save(OUT_DIR / f"{name}-thumb.png",
               format="PNG", optimize=True)


def main() -> None:
    print(f"Rendering to {OUT_DIR} …")

    # Master renders at scale=2 (native 300 dpi for A4)
    print("  • Flyer 1 master @ 300 dpi …")
    f1 = render_founding(scale=2.0)
    print("  • Flyer 1 social 1080² …")
    f1_sq = render_founding_social()
    _write_deliverables("founding", f1, f1_sq)
    print("    ✓ founding — a4, a4-hires, a3-hires, a4.pdf, a3.pdf, social, thumb")

    print("  • Flyer 2 master @ 300 dpi …")
    f2 = render_download(scale=2.0)
    print("  • Flyer 2 social 1080² …")
    f2_sq = render_download_social()
    _write_deliverables("download", f2, f2_sq)
    print("    ✓ download — a4, a4-hires, a3-hires, a4.pdf, a3.pdf, social, thumb")

    print("Done.")


if __name__ == "__main__":
    main()
