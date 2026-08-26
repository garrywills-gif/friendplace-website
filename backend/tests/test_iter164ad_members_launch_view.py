"""iter164ad — Members Launch View filter tests.

Contract with Garry (25 Aug 2026):

  * Default ``GET /api/cms/members`` excludes QA/test-flagged users
    (``is_test: true``).
  * Until the genuine Founding-Member count in ``db.users`` reaches
    ``MEMBERS_LAUNCH_FOUNDING_THRESHOLD`` (250), the default view is
    restricted to Founding Members only. This restriction lifts
    automatically once the count crosses the threshold — no code
    change needed.
  * ``include_test=true`` is an admin override that surfaces
    test-flagged rows AND lifts the launch gate.
  * Explicit ``status=`` filters (demo, admin, restricted, banned,
    etc.) always take precedence over the launch gate.
  * The response includes a ``launch_gate`` diagnostic dict so the
    UI can display a small hint to admins.

Tests hit a running backend on localhost:8001.
"""

from __future__ import annotations

import os
import uuid

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

BASE = "http://localhost:8001"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


@pytest.fixture(scope="module")
def admin_token() -> str:
    r = requests.post(
        f"{BASE}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def db():
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    yield client[os.environ.get("DB_NAME", "test_database")]
    client.close()


@pytest.fixture()
def seeded_users(db):
    """Seed a few users with distinctive flags. Cleanup on teardown."""
    tag = f"iter164ad-{uuid.uuid4().hex[:8]}"
    created_ids: list[str] = []

    def _mk(flags: dict) -> str:
        uid = str(uuid.uuid4())
        created_ids.append(uid)
        db.users.insert_one({
            "id": uid,
            "email": f"{uid[:6]}@{tag}.test",
            "first_name": "Iter164ad",
            "last_name": tag,
            "display_name": f"Iter164ad {tag}",
            "created_at": "2026-08-25T00:00:00Z",
            **flags,
        })
        return uid

    ids = {
        "founder":       _mk({"is_founder": True}),
        "founding_alt":  _mk({"is_founding_member": True}),
        "non_founder":   _mk({}),
        "demo":          _mk({"is_demo": True}),
        "test_founder":  _mk({"is_founder": True, "is_test": True}),
        "test_plain":    _mk({"is_test": True}),
    }
    yield ids, tag
    db.users.delete_many({"id": {"$in": created_ids}})


def _get(admin_token: str, path: str) -> dict:
    r = requests.get(
        f"{BASE}{path}",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def _rows_by_id(payload: dict) -> dict[str, dict]:
    return {r["id"]: r for r in payload.get("items", []) if r.get("id")}


# ---------------------------------------------------------------------------
# 1. Default excludes test-flagged users.
# ---------------------------------------------------------------------------

def test_default_excludes_test_flagged(admin_token, seeded_users):
    ids, tag = seeded_users
    # Search by our unique tag to keep the result set small & deterministic.
    payload = _get(admin_token, f"/api/cms/members?q={tag}&limit=200")
    rows = _rows_by_id(payload)
    assert ids["test_founder"] not in rows, "test-flagged founder should be hidden"
    assert ids["test_plain"]   not in rows, "test-flagged non-founder should be hidden"


# ---------------------------------------------------------------------------
# 2. include_test=true surfaces test-flagged rows.
# ---------------------------------------------------------------------------

def test_include_test_true_shows_test_users(admin_token, seeded_users):
    ids, tag = seeded_users
    payload = _get(
        admin_token,
        f"/api/cms/members?q={tag}&limit=200&include_test=true",
    )
    rows = _rows_by_id(payload)
    assert ids["test_founder"] in rows
    assert ids["test_plain"]   in rows


# ---------------------------------------------------------------------------
# 3. launch_gate diagnostic is returned.
# ---------------------------------------------------------------------------

def test_launch_gate_shape(admin_token, seeded_users):
    _, tag = seeded_users
    payload = _get(admin_token, f"/api/cms/members?q={tag}&limit=50")
    gate = payload.get("launch_gate")
    assert gate is not None
    assert set(gate.keys()) >= {
        "active", "threshold", "founder_count", "include_test", "reason",
    }
    assert gate["threshold"] == 250
    assert isinstance(gate["active"], bool)
    assert isinstance(gate["founder_count"], int)
    if gate["active"]:
        assert gate["reason"] and "Founding Members" in gate["reason"]
    else:
        assert gate["reason"] is None


# ---------------------------------------------------------------------------
# 4. Pre-launch: default view is Founding-Members only.
#
#    We can't easily assert the *entire* server-wide list, but we can
#    assert that when the gate is active, our seeded non-founder row
#    is hidden while our seeded founder rows are visible.
# ---------------------------------------------------------------------------

def test_prelaunch_hides_non_founders(admin_token, seeded_users):
    ids, tag = seeded_users
    payload = _get(admin_token, f"/api/cms/members?q={tag}&limit=200")
    gate = payload["launch_gate"]
    rows = _rows_by_id(payload)

    if gate["active"]:
        # Non-founder + demo should be hidden; founder rows visible.
        assert ids["founder"]      in rows
        assert ids["founding_alt"] in rows
        assert ids["non_founder"]  not in rows, (
            "non-founder should be hidden while launch gate is active"
        )
        assert ids["demo"] not in rows, (
            "demo (no founder flag) should be hidden while launch gate is active"
        )
    else:
        # Post-launch: everyone genuine is visible.
        assert ids["founder"]      in rows
        assert ids["non_founder"]  in rows


# ---------------------------------------------------------------------------
# 5. include_test=true lifts the launch gate.
# ---------------------------------------------------------------------------

def test_include_test_lifts_launch_gate(admin_token, seeded_users):
    ids, tag = seeded_users
    payload = _get(
        admin_token,
        f"/api/cms/members?q={tag}&limit=200&include_test=true",
    )
    gate = payload["launch_gate"]
    # gate.active is only ever set when include_test is False.
    assert gate["active"] is False
    assert gate["include_test"] is True
    rows = _rows_by_id(payload)
    # Non-founders and demos should now be visible too.
    assert ids["non_founder"] in rows
    assert ids["demo"]        in rows


# ---------------------------------------------------------------------------
# 6. Explicit status= filters bypass the launch gate.
# ---------------------------------------------------------------------------

def test_status_demo_bypasses_launch_gate(admin_token, seeded_users):
    ids, tag = seeded_users
    payload = _get(admin_token, f"/api/cms/members?q={tag}&status=demo&limit=200")
    rows = _rows_by_id(payload)
    # Demo user surfaces because status=demo is explicit intent.
    assert ids["demo"] in rows
    # But test-flagged rows still excluded (include_test still False).
    assert ids["test_founder"] not in rows


def test_status_founding_returns_founders(admin_token, seeded_users):
    ids, tag = seeded_users
    payload = _get(admin_token, f"/api/cms/members?q={tag}&status=founding&limit=200")
    rows = _rows_by_id(payload)
    assert ids["founder"]      in rows
    assert ids["founding_alt"] in rows
    assert ids["non_founder"]  not in rows
    assert ids["demo"]         not in rows


# ---------------------------------------------------------------------------
# 7. founder_count matches the internal Founding-Member count.
# ---------------------------------------------------------------------------

def test_founder_count_matches_db(admin_token, db):
    payload = _get(admin_token, "/api/cms/members?limit=1")
    reported = payload["launch_gate"]["founder_count"]
    actual = db.users.count_documents({
        "is_test": {"$ne": True},
        "is_demo": {"$ne": True},
        "$or": [
            {"is_founder": True},
            {"is_founding_member": True},
            {"founding_member": True},
        ],
    })
    assert reported == actual
