"""Iter 55 – verify flyer endpoint fixes:
   - No Bearer token required
   - PNG magic bytes
   - Content-Disposition uses sanitized venue-scoped filename
   - X-Content-Type-Options: nosniff header present
   - 403 for non-admin admin_id / unknown admin_id
"""
import os
import re
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

# The known admin id from the review request
KNOWN_ADMIN_ID = "7452ce79-7027-4a94-9669-0ee3a521a5ec"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def maggie_id(session):
    # maggie is the admin demo account. Get id via demo-login.
    r = session.post(f"{API}/auth/demo-login", json={"username": "maggie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"]


@pytest.fixture(scope="module")
def frankie_id(session):
    r = session.post(f"{API}/auth/demo-login", json={"username": "frankie"})
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"]


# ── flyer no-auth + png headers ────────────────────────────────────────
class TestFlyerNoAuth:
    def test_flyer_returns_png_no_bearer(self, session, maggie_id):
        """No Authorization header set anywhere. Should still 200 + image/png."""
        assert "Authorization" not in session.headers
        r = session.get(
            f"{API}/admin/invite-flyer",
            params={"admin_id": maggie_id, "venue": "North Ryde RSL"},
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("image/png"), r.headers
        assert r.content[:8] == PNG_MAGIC, f"body doesn't start with PNG magic: {r.content[:16]!r}"

    def test_flyer_content_disposition_sanitized(self, session, maggie_id):
        r = session.get(
            f"{API}/admin/invite-flyer",
            params={"admin_id": maggie_id, "venue": "North Ryde RSL"},
        )
        cd = r.headers.get("content-disposition", "")
        assert "inline" in cd.lower(), cd
        # filename should be sanitized, ending in .png, containing venue slug
        m = re.search(r'filename="([^"]+)"', cd)
        assert m, f"no filename in {cd!r}"
        fname = m.group(1)
        assert fname.endswith(".png"), f"filename doesn't end with .png: {fname}"
        assert ".json" not in fname, f"filename must not contain .json: {fname}"
        assert "North-Ryde-RSL" in fname, f"venue slug missing from filename: {fname}"

    def test_flyer_nosniff_header(self, session, maggie_id):
        r = session.get(
            f"{API}/admin/invite-flyer",
            params={"admin_id": maggie_id, "venue": "North Ryde RSL"},
        )
        assert r.headers.get("x-content-type-options", "").lower() == "nosniff"

    def test_flyer_empty_venue_generic_filename(self, session, maggie_id):
        r = session.get(f"{API}/admin/invite-flyer", params={"admin_id": maggie_id})
        assert r.status_code == 200
        cd = r.headers.get("content-disposition", "")
        assert 'filename="friendplace-flyer.png"' in cd, cd

    def test_flyer_special_chars_sanitized(self, session, maggie_id):
        # Malicious/weird venue name — must be scrubbed, no .json, no path chars.
        weird = "Bob's Bar & Grill / ../etc.png"
        r = session.get(
            f"{API}/admin/invite-flyer",
            params={"admin_id": maggie_id, "venue": weird},
        )
        assert r.status_code == 200
        cd = r.headers.get("content-disposition", "")
        m = re.search(r'filename="([^"]+)"', cd)
        assert m, cd
        fname = m.group(1)
        assert fname.endswith(".png") and ".json" not in fname
        # No path separators, no quotes, no spaces
        for bad in ("/", "\\", " ", "'", '"'):
            assert bad not in fname, f"unsanitized char {bad!r} in {fname}"


# ── admin id validation ────────────────────────────────────────────────
class TestFlyerAdminValidation:
    def test_flyer_non_admin_forbidden(self, session, frankie_id):
        r = session.get(
            f"{API}/admin/invite-flyer",
            params={"admin_id": frankie_id, "venue": "Somewhere"},
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}"

    def test_flyer_unknown_admin_id_forbidden(self, session):
        fake = str(uuid.uuid4())
        r = session.get(
            f"{API}/admin/invite-flyer",
            params={"admin_id": fake, "venue": "Ghost"},
        )
        assert r.status_code in (403, 404), f"expected 403/404, got {r.status_code}"

    def test_flyer_missing_admin_id_rejects(self, session):
        r = session.get(f"{API}/admin/invite-flyer", params={"venue": "X"})
        # FastAPI treats missing required query as 422
        assert r.status_code in (400, 422), r.status_code


# ── known admin_id from review request ────────────────────────────────
class TestFlyerKnownAdminId:
    def test_known_admin_id_from_review(self, session):
        """The review request supplies a specific admin id. Verify it works
        (may 403 if that id doesn't actually exist in this DB — that's fine,
        we treat both 200 and 403 as valid signals so long as we didn't get
        a 500 or 401)."""
        r = session.get(
            f"{API}/admin/invite-flyer",
            params={"admin_id": KNOWN_ADMIN_ID, "venue": "North Ryde RSL"},
        )
        assert r.status_code in (200, 403), f"unexpected {r.status_code}: {r.text[:200]}"
        if r.status_code == 200:
            assert r.content[:8] == PNG_MAGIC
            cd = r.headers.get("content-disposition", "")
            assert "North-Ryde-RSL" in cd and ".json" not in cd


# ── profile / stats sanity for the frontend "squashed 731" bug ──────
class TestProfileStats:
    def test_maggie_profile_returns_points(self, session):
        # demo-login envelope includes the full user object incl. numeric points
        r = session.post(f"{API}/auth/demo-login", json={"username": "maggie"})
        assert r.status_code == 200
        u = r.json()["user"]
        assert "points" in u, u
        assert isinstance(u["points"], (int, float))
