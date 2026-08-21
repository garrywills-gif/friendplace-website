"""
V2 flyer artwork deliverable verification.

Verifies that all 14 deliverable files (7 per flyer × 2 flyers) are served
via the preview URL under /flyer-mockups/ with correct content types, PNG/PDF
magic bytes, exact pixel dimensions, non-trivial sizes, and that the mission
line at the bottom of each A4 preview is not clipped off-canvas.

All flyers are static assets served by the Next.js public folder through
nginx path-multiplex (see /app/config/nginx/app-proxy.conf).
"""
import io
import pytest
import requests
from PIL import Image

BASE_URL = "https://outreach-campaigns.preview.emergentagent.com"
FLYER_PATH = "/flyer-mockups"

# (filename, expected_content_type_prefix, expected_size_min_bytes)
PNG_SPECS = {
    # (width, height) exact for PNGs; width-only for thumb
    "a4":       {"size": (1240, 1754), "min_bytes": 100_000},
    "a4-hires": {"size": (2480, 3508), "min_bytes": 100_000},
    "a3-hires": {"size": (3508, 4960), "min_bytes": 100_000},
    "social":   {"size": (1080, 1080), "min_bytes": 30_000},
    "thumb":    {"width": 620,          "min_bytes": 30_000},
}

PDF_MIN_BYTES = 100_000  # >100 KB per spec

FLYERS = ["founding", "download"]
PNG_VARIANTS = ["a4", "a4-hires", "a3-hires", "social", "thumb"]
PDF_VARIANTS = ["a4", "a3"]


def _fetch(url: str) -> requests.Response:
    r = requests.get(url, timeout=60)
    assert r.status_code == 200, f"{url} -> HTTP {r.status_code}"
    # Never Expo's SPA fallback
    assert b"Unmatched Route" not in r.content, f"{url} returned Expo 404 HTML"
    return r


# --------------------- PNG deliverables ---------------------

@pytest.mark.parametrize("flyer", FLYERS)
@pytest.mark.parametrize("variant", PNG_VARIANTS)
def test_png_deliverable_served_and_dimensions(flyer, variant):
    filename = f"{flyer}-{variant}.png"
    url = f"{BASE_URL}{FLYER_PATH}/{filename}"
    r = _fetch(url)

    # Content-Type header
    ctype = r.headers.get("Content-Type", "")
    assert ctype.startswith("image/png"), f"{filename} Content-Type={ctype!r}"

    # PNG magic
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n", f"{filename} not a valid PNG"

    spec = PNG_SPECS[variant]
    # Size floor
    assert len(r.content) > spec["min_bytes"], (
        f"{filename} size {len(r.content)} < {spec['min_bytes']}"
    )

    # Pixel dimensions
    img = Image.open(io.BytesIO(r.content))
    if "size" in spec:
        assert img.size == spec["size"], (
            f"{filename} dimensions {img.size} != {spec['size']}"
        )
    else:
        assert img.size[0] == spec["width"], (
            f"{filename} width {img.size[0]} != {spec['width']}"
        )


# --------------------- PDF deliverables ---------------------

@pytest.mark.parametrize("flyer", FLYERS)
@pytest.mark.parametrize("variant", PDF_VARIANTS)
def test_pdf_deliverable_served(flyer, variant):
    filename = f"{flyer}-{variant}.pdf"
    url = f"{BASE_URL}{FLYER_PATH}/{filename}"
    r = _fetch(url)

    ctype = r.headers.get("Content-Type", "")
    assert "application/pdf" in ctype, f"{filename} Content-Type={ctype!r}"

    # PDF magic: %PDF-1.x
    head = r.content[:8]
    assert head.startswith(b"%PDF-1."), f"{filename} bad PDF header {head!r}"

    # Non-trivial size
    assert len(r.content) > PDF_MIN_BYTES, (
        f"{filename} size {len(r.content)} < {PDF_MIN_BYTES}"
    )


# --------------------- Mission line not clipped ---------------------

@pytest.mark.parametrize("flyer", FLYERS)
def test_mission_line_present_in_a4_bottom(flyer):
    """The mission line 'Helping Australians build genuine friendships and
    stronger local communities.' must render entirely within the A4 canvas
    (1754 px tall). Verify by ensuring the last ~60px of the -a4.png contains
    non-white pixels (indicating text was actually drawn there and not clipped
    off the bottom edge)."""
    url = f"{BASE_URL}{FLYER_PATH}/{flyer}-a4.png"
    r = _fetch(url)
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    w, h = img.size
    assert (w, h) == (1240, 1754)

    # Scan the last 60px band for any non-near-white pixel
    band = img.crop((0, h - 60, w, h))
    pixels = band.load()
    non_white = 0
    total = band.size[0] * band.size[1]
    for y in range(band.size[1]):
        for x in range(band.size[0]):
            r_, g_, b_ = pixels[x, y]
            # treat > 240 in all channels as "essentially white/background"
            if r_ < 235 or g_ < 235 or b_ < 235:
                non_white += 1
    ratio = non_white / total
    # Some non-white pixels expected if mission line ends near the bottom.
    # A conservative floor: at least 0.2% of the band should be ink.
    assert ratio > 0.002, (
        f"{flyer}-a4.png bottom 60px is essentially blank "
        f"(non-white ratio={ratio:.4%}); mission line likely clipped/missing"
    )


# Bottom-region content check for ALL variant sizes.
# If footer content (mission line + slogan) is present, the last 6% of the
# canvas height should contain measurable ink for both A4 and A3 variants,
# and the last 5% for social.  This catches the "mission line rendered
# off-canvas" bug for hires/social exports too.
BOTTOM_INK_TARGETS = [
    ("founding-a4.png",        60,  0.002),
    ("founding-a4-hires.png",  200, 0.002),
    ("founding-a3-hires.png",  280, 0.002),
    ("founding-social.png",    60,  0.005),
    ("download-a4.png",        60,  0.002),
    ("download-a4-hires.png",  200, 0.002),
    ("download-a3-hires.png",  280, 0.002),
    ("download-social.png",    60,  0.005),
]


@pytest.mark.parametrize("filename,band_px,min_ratio", BOTTOM_INK_TARGETS)
def test_bottom_band_has_ink_all_variants(filename, band_px, min_ratio):
    """Footer content (mission line / slogan) must render inside the canvas
    for every variant, not just the A4 preview."""
    url = f"{BASE_URL}{FLYER_PATH}/{filename}"
    r = _fetch(url)
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    w, h = img.size
    band = img.crop((0, h - band_px, w, h))
    px = band.load()
    non_white = 0
    # sample every 3rd pixel horizontally for speed on hires
    step = 3 if w > 2000 else 1
    total = 0
    for y in range(band.size[1]):
        for x in range(0, band.size[0], step):
            total += 1
            r_, g_, b_ = px[x, y]
            if r_ < 235 or g_ < 235 or b_ < 235:
                non_white += 1
    ratio = non_white / total
    assert ratio > min_ratio, (
        f"{filename} bottom {band_px}px is nearly blank "
        f"(non-white ratio={ratio:.4%}); footer/mission line clipped or missing"
    )


# --------------------- Soft-check: Flyer 1 founding-a4 layout ---------------------

def test_founding_a4_headline_present():
    """'FIND YOUR PEOPLE' headline band should have substantial dark ink
    somewhere in y~300-500 (allowing for the navy full-bleed header frame).
    Verify there is meaningful text ink in the interior of the headline band."""
    url = f"{BASE_URL}{FLYER_PATH}/founding-a4.png"
    r = _fetch(url)
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    # Look at interior region only (avoid full-bleed side frames)
    interior = img.crop((150, 300, img.size[0] - 150, 550))
    px = interior.load()
    ink = 0
    for y in range(interior.size[1]):
        for x in range(0, interior.size[0], 3):
            r_, g_, b_ = px[x, y]
            if r_ < 200 or g_ < 200 or b_ < 200:
                ink += 1
    assert ink > 2000, f"headline interior region has insufficient ink ({ink} pixels)"


def test_founding_a4_gold_ribbon_present():
    """Gold-yellow benefits ribbon should exist somewhere in y=650..960.
    Look for a horizontal band where the average color is near #FBBF24
    (R ~251, G ~191, B ~36) across most of the width."""
    url = f"{BASE_URL}{FLYER_PATH}/founding-a4.png"
    r = _fetch(url)
    img = Image.open(io.BytesIO(r.content)).convert("RGB")

    found = False
    for y in range(650, 960, 5):
        row = img.crop((100, y, img.size[0] - 100, y + 1))
        px = row.load()
        n = row.size[0]
        rs = gs = bs = 0
        for x in range(n):
            r_, g_, b_ = px[x, 0]
            rs += r_; gs += g_; bs += b_
        ar, ag, ab = rs / n, gs / n, bs / n
        # near gold: R high, G mid-high, B low
        if 210 <= ar <= 255 and 150 <= ag <= 220 and ab < 100:
            found = True
            break
    assert found, "Gold-yellow ribbon (#FBBF24-ish) not detected in y=650..960"


def test_founding_a4_navy_pill_present():
    """Navy pill containing 'www.friendplace.com.au' should exist somewhere
    around y=1560..1700 (the pill is thin, so scan pixel-wise rather than
    averaging entire rows). Look for at least one column-slice of navy
    (all channels < ~90) at least 15px tall in that band."""
    url = f"{BASE_URL}{FLYER_PATH}/founding-a4.png"
    r = _fetch(url)
    img = Image.open(io.BytesIO(r.content)).convert("RGB")

    # Sample center column x=620 down through y=1560..1720 looking for a
    # contiguous run of navy pixels >= 15 rows tall.
    px = img.load()
    navy_run = 0
    best_run = 0
    for y in range(1560, 1720):
        r_, g_, b_ = px[620, y]
        if r_ < 90 and g_ < 90 and b_ < 130:
            navy_run += 1
            best_run = max(best_run, navy_run)
        else:
            navy_run = 0
    assert best_run >= 15, (
        f"Navy pill (dark run) not found in center column y=1560..1720; "
        f"longest navy run = {best_run}px"
    )


# ---------- Butterfly removed from gold ribbon (iter_114 request) ----------

# (filename, ribbon central slice x_lo, x_hi, y_lo, y_hi)
# The ribbon interior is scanned for bright-white pixels; the butterfly wing
# icon on FriendPlace assets is predominantly bright white (#FFFFFF). If the
# butterfly was removed, the ribbon's central 300-px slice should contain
# ONLY gold fill (~#FBBF24) and dark-gold text (~#7C5300), with essentially
# no bright-white pixels (0 white in a strict >245 threshold scan).
BUTTERFLY_ABSENT_TARGETS = [
    # Ribbon shrunk (RIBBON_H=120) per iter_115 layout change; ribbon interior
    # now lives at approx y=683..797 on founding-a4.png. Sample its central
    # gold region.
    ("founding-a4.png",     470, 770, 710, 780),   # portrait ribbon slice
    ("founding-social.png", 390, 690, 460, 540),   # square ribbon slice
]


@pytest.mark.parametrize("filename,x_lo,x_hi,y_lo,y_hi", BUTTERFLY_ABSENT_TARGETS)
def test_no_butterfly_inside_gold_ribbon(filename, x_lo, x_hi, y_lo, y_hi):
    """The butterfly icon must NOT appear inside the gold ribbon on either
    founding variant. Verify by scanning the ribbon's central 300-px-wide
    slice for bright-white pixels — a butterfly wing would produce many
    (thousands of) near-white pixels; a text-only ribbon produces zero."""
    url = f"{BASE_URL}{FLYER_PATH}/{filename}"
    r = _fetch(url)
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    px = img.load()
    bright_white = 0
    for y in range(y_lo, y_hi):
        for x in range(x_lo, x_hi):
            r_, g_, b_ = px[x, y]
            if r_ > 245 and g_ > 245 and b_ > 245:
                bright_white += 1
    # Text-only ribbon should have ~0 bright-white pixels.
    # A butterfly icon would produce thousands.
    assert bright_white < 50, (
        f"{filename} ribbon central slice contains {bright_white} "
        f"bright-white pixels — butterfly icon may still be present"
    )




# --------------------- Regression: existing routes ---------------------

@pytest.mark.parametrize("path", ["/meet", "/register-interest", "/admin"])
def test_website_routes_regression(path):
    r = requests.get(f"{BASE_URL}{path}", timeout=30, allow_redirects=True)
    assert r.status_code == 200, f"{path} -> {r.status_code}"
    assert "text/html" in r.headers.get("Content-Type", "")


# --------------------- V3 layout pixel-scan (iter_115) ---------------------

def _last_ink_y(img, threshold=235):
    w, h = img.size
    px = img.load()
    step = 3 if w > 2000 else 1
    for y in range(h - 1, -1, -1):
        for x in range(0, w, step):
            r_, g_, b_ = px[x, y]
            if r_ < threshold or g_ < threshold or b_ < threshold:
                return y
    return -1


# Review-request minimum last-ink-y targets after V3 layout changes.
LAST_INK_TARGETS = [
    ("founding-a4.png",       1700),
    ("download-a4.png",       1700),
    ("download-a4-hires.png", 3400),
    ("download-a3-hires.png", 4800),
    ("download-social.png",   1030),
]


@pytest.mark.parametrize("filename,min_last_y", LAST_INK_TARGETS)
def test_last_ink_y_meets_target(filename, min_last_y):
    url = f"{BASE_URL}{FLYER_PATH}/{filename}"
    r = _fetch(url)
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    last = _last_ink_y(img)
    assert last >= min_last_y, (
        f"{filename} last-ink-y={last} < target {min_last_y} "
        f"— footer/mission line is drawn too high on the canvas"
    )


def test_founding_a4_ribbon_is_compact():
    """After V3 layout changes, the gold ribbon is compact (RIBBON_H=120) and
    a horizontal line at y=860 sits BELOW the ribbon on the WHITE background."""
    url = f"{BASE_URL}{FLYER_PATH}/founding-a4.png"
    r = _fetch(url)
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    px = img.load()
    # y=860 should be mostly white (background) across the width interior
    white_count = 0
    total = 0
    for x in range(200, 1040, 20):
        r_, g_, b_ = px[x, 860]
        total += 1
        if r_ > 240 and g_ > 240 and b_ > 240:
            white_count += 1
    assert white_count == total, (
        f"y=860 is not white — ribbon appears to extend past y=860 "
        f"({white_count}/{total} sampled pixels were near-white)"
    )


def test_founding_a4_teal_checkmarks_present():
    """Two teal (#0F766E ~ RGB 15,118,110) vector checkmarks should appear
    in the benefits panel below the ribbon (roughly y=870..970, x=200..400)."""
    url = f"{BASE_URL}{FLYER_PATH}/founding-a4.png"
    r = _fetch(url)
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    px = img.load()
    teal_pixels = 0
    for y in range(870, 980):
        for x in range(200, 450):
            r_, g_, b_ = px[x, y]
            # Near-teal: low R, mid G, mid B, with G and B similar
            if r_ < 60 and 90 <= g_ <= 160 and 80 <= b_ <= 150:
                teal_pixels += 1
    assert teal_pixels >= 40, (
        f"Teal checkmarks not found in benefits region (only {teal_pixels} "
        f"teal-ish pixels detected — expected two vector-drawn checks)"
    )


def test_founding_a4_intro_navy_text_present():
    """The bold navy intro line 'Join free today...' should render below the
    ribbon (roughly y=825..870). Scan for a row-run of navy-dark pixels."""
    url = f"{BASE_URL}{FLYER_PATH}/founding-a4.png"
    r = _fetch(url)
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    px = img.load()
    rows_with_navy = 0
    for y in range(820, 875):
        dark = 0
        for x in range(150, 1090):
            r_, g_, b_ = px[x, y]
            if r_ < 80 and g_ < 80 and b_ < 150:
                dark += 1
        if dark > 40:
            rows_with_navy += 1
    assert rows_with_navy >= 5, (
        f"Bold navy intro line not detected in y=820..875 "
        f"(only {rows_with_navy} rows had substantial navy ink)"
    )


# --------------------- iter_117: spacing bump between IS NOW LIVE! and sub-heading ---------------------

def test_download_a4_headline_subheading_breathing_room():
    """After the +46 px spacing bump (sub_y = l2_bottom + 34 -> +80), there
    must be a clear white band between the descender of 'LIVE!' and the top
    of the 'Meet new friends...' sub-heading. Require at least a 30-row
    run of essentially-white interior pixels somewhere in y=680..770."""
    url = f"{BASE_URL}{FLYER_PATH}/download-a4.png"
    r = _fetch(url)
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    px = img.load()

    def row_ink(y, x_lo=100, x_hi=1140, thresh=200):
        return sum(
            1 for x in range(x_lo, x_hi)
            if px[x, y][0] < thresh or px[x, y][1] < thresh or px[x, y][2] < thresh
        )

    # Find the longest run of near-white rows in the window y=680..770.
    best = cur = 0
    for y in range(680, 771):
        if row_ink(y) <= 5:
            cur += 1
            best = max(best, cur)
        else:
            cur = 0
    assert best >= 30, (
        f"download-a4.png: white gap between 'IS NOW LIVE!' and "
        f"'Meet new friends...' is only {best} rows; expected >= 30 "
        f"after the +46 px spacing bump."
    )
