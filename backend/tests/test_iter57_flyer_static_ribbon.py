"""
Iteration 57 – Founding-member ribbon on the printable invite flyer.

Verifies:
  1) The ribbon copy is STATIC (no live "X of 500 places remaining"
     phrase anywhere on the flyer). We can't OCR the ribbon 100 %
     reliably at the glyph level, so we OCR the whole lower half and
     match a regex that would catch the "N of 500" / "remaining" family
     of copy the fix is meant to remove.
  2) The ribbon auto-hides when the founder cohort is full
     (founder_count >= cohort_cap). We simulate the full cohort by
     inserting 500 dummy non-demo founder users into Mongo, re-fetching
     the flyer, and asserting that (a) there is no more gold ribbon in
     the ribbon band, and (b) the QR frame has shifted UP the page
     (dynamic ribbon_bottom_y fallback).
  3) Existing regressions from iter55/iter56 still hold – A4 PNG
     (1240x1754), Content-Disposition filename ends in .png, no auth
     required.

Cleanup is idempotent – all seeded users are tagged with
`TEST_TAG` and deleted in a finally block.
"""
from __future__ import annotations

import io
import os
import re
import uuid
from typing import Iterable

import pytest
import pytesseract
import requests
from PIL import Image
from pymongo import MongoClient


# ── env / constants ─────────────────────────────────────────────────
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

ADMIN_ID = "7452ce79-7027-4a94-9669-0ee3a521a5ec"  # provided by review
VENUE = "North Ryde RSL"
FLYER_URL = f"{API}/admin/invite-flyer"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

TEST_TAG = "iter57_cohortfull_seed"

# Gold ribbon fill is "#FBBF24" == (251, 191, 36)
GOLD = (251, 191, 36)


# ── fixtures ────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def http() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Accept": "*/*"})
    return s


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL, serverSelectionTimeoutMS=3000)
    yield c[DB_NAME]
    c.close()


def _fetch_flyer(http: requests.Session) -> requests.Response:
    r = http.get(FLYER_URL, params={"admin_id": ADMIN_ID, "venue": VENUE}, timeout=30)
    return r


def _load_png(body: bytes) -> Image.Image:
    return Image.open(io.BytesIO(body)).convert("RGB")


def _row_gold_hits(img: Image.Image, y: int, *, tol: int = 25, step: int = 5) -> int:
    W = img.size[0]
    hits = 0
    for x in range(200, W - 200, step):
        r, g, b = img.getpixel((x, y))
        if (abs(r - GOLD[0]) <= tol
                and abs(g - GOLD[1]) <= tol
                and abs(b - GOLD[2]) <= tol):
            hits += 1
    return hits


def _first_dark_row_from(img: Image.Image, y_from: int, y_to: int,
                         *, min_dark: int = 120) -> int | None:
    """Return the y of the first row (from y_from..y_to) that has
    at least `min_dark` dark pixels between x=300..W-300 with step 3.
    Used to locate the top border of the navy QR frame.
    """
    W = img.size[0]
    for y in range(y_from, y_to):
        dark = 0
        for x in range(300, W - 300, 3):
            r, g, b = img.getpixel((x, y))
            if (r + g + b) < 250:
                dark += 1
                if dark >= min_dark:
                    return y
    return None


# ── (1) basic fetch + static-copy assertions ────────────────────────
class TestFlyerStaticRibbon:
    """Ribbon copy must NOT contain a live count / 'remaining' phrase."""

    def test_flyer_returns_a4_png(self, http):
        r = _fetch_flyer(http)
        assert r.status_code == 200, r.text[:200]
        assert r.headers.get("content-type", "").startswith("image/png")
        cd = r.headers.get("content-disposition", "")
        assert cd.lower().endswith('.png"') or cd.lower().endswith(".png"), cd
        img = _load_png(r.content)
        assert img.size == (1240, 1754), img.size

    def test_ribbon_ocr_has_static_copy_and_no_live_count(self, http):
        r = _fetch_flyer(http)
        assert r.status_code == 200
        img = _load_png(r.content).convert("L")

        # Crop the ribbon band. Review says approx y=850..1050 / x=60..1180.
        # We widen slightly (y=830..1070) to compensate for OCR jitter and
        # any layout drift from earlier iterations.
        ribbon = img.crop((60, 830, 1180, 1070))
        ribbon_txt = pytesseract.image_to_string(ribbon)

        assert "FOUNDING MEMBER" in ribbon_txt.upper(), (
            f"'FOUNDING MEMBER' not detected in ribbon OCR:\n{ribbon_txt!r}"
        )
        assert re.search(r"free to join", ribbon_txt, re.IGNORECASE), (
            f"'Free to join' not detected in ribbon OCR:\n{ribbon_txt!r}"
        )

        # The whole point of iter57 – nothing that looks like the live
        # count should have survived. Check both the ribbon crop AND the
        # full page (defence-in-depth against copy leaking elsewhere).
        for scope, text in (
            ("ribbon", ribbon_txt),
            ("page", pytesseract.image_to_string(img)),
        ):
            lowered = text.lower()
            assert "remaining" not in lowered, (
                f"'remaining' word found in {scope} OCR:\n{text!r}"
            )
            assert not re.search(r"\d+\s*(?:of|/)\s*500", lowered), (
                f"'N of 500' style live count found in {scope} OCR:\n{text!r}"
            )
            assert not re.search(r"\d+\s*(?:spots?|places?|seats?)\s*(?:left|remaining|open)", lowered), (
                f"'N spots/places left' style live count found in {scope} OCR:\n{text!r}"
            )

    def test_ribbon_gold_present_when_cohort_open(self, http, mongo):
        """Sanity: while founder_count < cohort_cap, the gold ribbon
        rectangle IS drawn. Baseline for the 'hidden' assertion below.
        """
        # Only meaningful if cohort is currently open. Skip if not.
        count = mongo.users.count_documents(
            {"is_founder": True, "is_demo": {"$ne": True}}
        )
        if count >= 500:
            pytest.skip("Cohort already full in this DB – cannot baseline.")

        r = _fetch_flyer(http)
        assert r.status_code == 200
        img = _load_png(r.content)

        # scan the expected ribbon band – at least one row should have
        # >=50 gold hits if the ribbon rendered.
        max_hits = max(
            _row_gold_hits(img, y) for y in range(855, 1050, 8)
        )
        assert max_hits >= 50, (
            f"Expected gold ribbon in y=855..1050 while cohort open, "
            f"got max row gold_hits={max_hits}"
        )


# ── (2) cohort-full → ribbon hidden + QR shifts up ──────────────────
class TestFlyerRibbonHiddenWhenCohortFull:
    """Seed 500 dummy founder users → refetch → ribbon must be absent."""

    @pytest.fixture(scope="class")
    def baseline_qr_top(self, http, mongo):
        """Locate the top border of the navy QR frame BEFORE we mutate
        the DB. We compare against this after the seed to prove the QR
        moved UP the page. Must resolve before seed_full_cohort.
        """
        # Guard – if the DB is already cohort-full (e.g. left-over test
        # data) we cannot capture a meaningful baseline.
        cnt = mongo.users.count_documents(
            {"is_founder": True, "is_demo": {"$ne": True}}
        )
        assert cnt < 500, (
            f"Cannot baseline QR position: cohort already full ({cnt}). "
            f"Clean leftover TEST_ founder docs first."
        )
        r = _fetch_flyer(http)
        assert r.status_code == 200
        img = _load_png(r.content)
        # Baseline scan starts well below the ribbon band.
        y = _first_dark_row_from(img, 1060, 1250, min_dark=120)
        assert y is not None, "Could not locate QR frame border pre-seed"
        return y

    @pytest.fixture(scope="class")
    def seed_full_cohort(self, mongo, baseline_qr_top):
        # Forcing `baseline_qr_top` as a dependency guarantees it
        # resolves BEFORE we mutate the DB.
        _ = baseline_qr_top
        """Insert 500 dummy non-demo founder users tagged for cleanup.

        Uses a bulk insert_many for speed. Cleanup happens even if the
        test body raises.
        """
        # If enough founders already exist we still add a safety margin
        # so count_documents(...) is guaranteed >= 500 during the test.
        existing = mongo.users.count_documents(
            {"is_founder": True, "is_demo": {"$ne": True}}
        )
        need = max(0, 500 - existing) + 10  # +10 safety margin

        docs = []
        for i in range(need):
            docs.append({
                "id": f"{TEST_TAG}-{uuid.uuid4()}",
                "username": f"{TEST_TAG}-{i}-{uuid.uuid4().hex[:6]}",
                "is_founder": True,
                "is_demo": False,
                "seeded_by": TEST_TAG,
            })
        if docs:
            mongo.users.insert_many(docs, ordered=False)

        try:
            yield need
        finally:
            mongo.users.delete_many({"seeded_by": TEST_TAG})

    def test_ribbon_hidden_when_cohort_full(self, http, mongo, seed_full_cohort):
        # Confirm precondition – DB actually reports >= 500 non-demo founders.
        cnt = mongo.users.count_documents(
            {"is_founder": True, "is_demo": {"$ne": True}}
        )
        assert cnt >= 500, f"Seed did not achieve cohort-full state (count={cnt})"

        r = _fetch_flyer(http)
        assert r.status_code == 200
        img = _load_png(r.content)
        assert img.size == (1240, 1754)

        # Any gold in the ribbon band would be a bug – rectangle span is
        # y=RIBBON_Y..RIBBON_Y+195 which lands in y≈855..1050 on the
        # canvas. Allow a few stray anti-alias pixels only.
        worst = max(
            _row_gold_hits(img, y) for y in range(855, 1050, 5)
        )
        assert worst < 15, (
            f"Ribbon still appears gold when cohort is full – "
            f"max row gold_hits={worst}. Expected < 15 (anti-alias only)."
        )

        # Also OCR the whole page – neither 'FOUNDING MEMBER' nor
        # 'Free to join' copy should render at all now.
        page_txt = pytesseract.image_to_string(img.convert("L")).upper()
        assert "FOUNDING MEMBER" not in page_txt, (
            f"Ribbon copy leaked into cohort-full flyer:\n{page_txt!r}"
        )

    def test_qr_shifts_up_when_cohort_full(self, http, seed_full_cohort, baseline_qr_top):
        r = _fetch_flyer(http)
        assert r.status_code == 200
        img = _load_png(r.content)

        # Look for the QR frame top border – it should now sit UP the
        # page compared to the baseline. Start scan from just below the
        # icon-label block (≈y=650).
        new_top = _first_dark_row_from(img, 650, baseline_qr_top, min_dark=120)
        assert new_top is not None, (
            f"Could not locate QR frame border above baseline "
            f"y={baseline_qr_top} when cohort full"
        )
        assert new_top < baseline_qr_top - 100, (
            f"QR frame did not shift up meaningfully: baseline={baseline_qr_top}, "
            f"new={new_top} (delta={baseline_qr_top - new_top}px)"
        )


# ── (3) tiny regression stubs from iter55/56 – belt-and-braces ──────
class TestFlyerRegression:
    def test_no_auth_required(self, http):
        # No Authorization header, no cookie – must still be 200.
        r = requests.get(FLYER_URL, params={"admin_id": ADMIN_ID, "venue": VENUE},
                         timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/png")

    def test_filename_ends_with_png(self, http):
        r = _fetch_flyer(http)
        cd = r.headers.get("content-disposition", "")
        m = re.search(r'filename="([^"]+)"', cd)
        assert m, cd
        assert m.group(1).endswith(".png"), m.group(1)
