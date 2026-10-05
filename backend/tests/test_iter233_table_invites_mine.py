"""iter233 — FP Café "my pending table invites" endpoint smoke tests.

Scope (per Neo's testing_request):
  1. GET /api/tables/invites/mine returns {"invites": [...]} envelope.
  2. 401 without / with invalid bearer.
  3. A seeded table that invites the caller appears with the documented
     shape (table_id, name, emoji, description, host:{first_name,avatar},
     seated_count, capacity, visibility, founder_only).
  4. Excludes tables the caller hosts.
  5. POST /tables/{id}/decline/{uid} removes it from subsequent fetches.
  6. POST /tables/{id}/join/{uid} removes it from subsequent fetches.
  7. decline is per-user: a second un-declined invite still surfaces.

Friend-graph note (observed in preview DB, Jan 2026):
  frankie (Frank) ↔ dot (Dorothy) are confirmed friends; `create_table`
  intersects body.invite_ids with host.friends, so the invitee under test
  must be a real friend of the host. We use frankie→dot throughout.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get(
    "EXPO_BACKEND_URL"
)
if not BASE_URL:
    raise RuntimeError(
        "EXPO_PUBLIC_BACKEND_URL / EXPO_BACKEND_URL not set — refusing to run",
    )
BASE_URL = BASE_URL.rstrip("/")


# ---------- helpers ----------
def _demo_login(session: requests.Session, username: str) -> dict:
    r = session.post(
        f"{BASE_URL}/api/auth/demo-login",
        json={"username": username},
        timeout=20,
    )
    assert r.status_code == 200, (
        f"demo-login({username}) → {r.status_code} {r.text}"
    )
    data = r.json()
    assert "access_token" in data and "user" in data
    return data


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def api():
    return requests.Session()


@pytest.fixture(scope="module")
def frankie(api):
    # host (Frank)
    return _demo_login(api, "frankie")


@pytest.fixture(scope="module")
def dot(api):
    # invitee under test (Dorothy) — confirmed friend of frankie
    return _demo_login(api, "dot")


@pytest.fixture(scope="module")
def maggie(api):
    # second host used by test_07 (two independent invites to the same user)
    return _demo_login(api, "maggie")


def _create_table(
    api,
    host_login: dict,
    *,
    name: str,
    invite_ids: list[str],
    visibility: str = "friends",
    founder_only: bool = False,
) -> str:
    body = {
        "name": name,
        "emoji": "☕",
        "description": "iter233 smoke-test table",
        "visibility": visibility,
        "host_id": host_login["user"]["id"],
        "invite_ids": invite_ids,
        "founder_only": founder_only,
    }
    r = api.post(f"{BASE_URL}/api/tables", json=body, timeout=20)
    assert r.status_code == 200, f"create_table → {r.status_code} {r.text}"
    t = r.json()
    assert t.get("id")
    assert host_login["user"]["id"] in (t.get("seated") or [])
    return t["id"]


def _fetch_invites(api, token: str) -> list[dict]:
    r = api.get(
        f"{BASE_URL}/api/tables/invites/mine", headers=_auth(token), timeout=20
    )
    assert r.status_code == 200, f"invites/mine → {r.status_code} {r.text}"
    body = r.json()
    assert isinstance(body, dict) and "invites" in body
    assert isinstance(body["invites"], list)
    return body["invites"]


# ---------- tests ----------
class TestTableInvitesMine:

    def test_01_no_auth_returns_401(self, api):
        r = api.get(f"{BASE_URL}/api/tables/invites/mine", timeout=20)
        assert r.status_code == 401, (
            f"expected 401 without bearer, got {r.status_code} {r.text}"
        )

    def test_02_bad_token_returns_401(self, api):
        r = api.get(
            f"{BASE_URL}/api/tables/invites/mine",
            headers=_auth("not-a-real-token"),
            timeout=20,
        )
        assert r.status_code == 401

    def test_03_envelope_shape_always_returns_invites_key(self, api, dot):
        invites = _fetch_invites(api, dot["access_token"])
        assert isinstance(invites, list)

    def test_04_seeded_invite_appears_with_documented_shape(
        self, api, frankie, dot
    ):
        tid = _create_table(
            api,
            frankie,
            name="TEST_iter233_shape",
            invite_ids=[dot["user"]["id"]],
            visibility="friends",
        )
        invites = _fetch_invites(api, dot["access_token"])
        row = next((r for r in invites if r.get("table_id") == tid), None)
        assert row is not None, (
            f"seeded invite {tid} missing from dot's invites: {invites}"
        )
        for key in (
            "table_id",
            "name",
            "emoji",
            "description",
            "host",
            "seated_count",
            "capacity",
            "visibility",
            "founder_only",
        ):
            assert key in row, f"missing field '{key}' in invite row: {row}"
        assert row["name"] == "TEST_iter233_shape"
        assert row["emoji"] == "☕"
        assert row["visibility"] == "friends"
        assert row["founder_only"] is False
        assert isinstance(row["seated_count"], int)
        assert row["seated_count"] >= 1  # host auto-seated at creation
        assert isinstance(row["capacity"], int)
        assert isinstance(row["host"], dict)
        assert "first_name" in row["host"]
        assert "avatar" in row["host"]
        assert row["host"]["first_name"] == "Frank"
        assert "_id" not in row

    def test_05_host_does_not_see_own_table_in_invites(
        self, api, frankie, dot
    ):
        tid = _create_table(
            api,
            frankie,
            name="TEST_iter233_hostexclude",
            invite_ids=[dot["user"]["id"]],
            visibility="friends",
        )
        invites = _fetch_invites(api, frankie["access_token"])
        assert all(r.get("table_id") != tid for r in invites), (
            f"host unexpectedly saw their own table {tid} in invites"
        )

    def test_06_decline_removes_invite_from_subsequent_fetch(
        self, api, frankie, dot
    ):
        tid = _create_table(
            api,
            frankie,
            name="TEST_iter233_decline",
            invite_ids=[dot["user"]["id"]],
            visibility="friends",
        )
        pre = _fetch_invites(api, dot["access_token"])
        assert any(r.get("table_id") == tid for r in pre), (
            f"invite {tid} missing pre-decline: {pre}"
        )
        r = api.post(
            f"{BASE_URL}/api/tables/{tid}/decline/{dot['user']['id']}",
            headers=_auth(dot["access_token"]),
            timeout=20,
        )
        assert r.status_code == 200, f"decline → {r.status_code} {r.text}"
        assert r.json().get("ok") is True
        post = _fetch_invites(api, dot["access_token"])
        assert all(r.get("table_id") != tid for r in post), (
            f"declined invite {tid} still present in dot's invites"
        )

    def test_07_join_removes_invite_from_subsequent_fetch(
        self, api, frankie, dot
    ):
        tid = _create_table(
            api,
            frankie,
            name="TEST_iter233_join",
            invite_ids=[dot["user"]["id"]],
            visibility="friends",
        )
        pre = _fetch_invites(api, dot["access_token"])
        assert any(r.get("table_id") == tid for r in pre), (
            f"invite {tid} missing pre-join: {pre}"
        )
        r = api.post(
            f"{BASE_URL}/api/tables/{tid}/join/{dot['user']['id']}",
            headers=_auth(dot["access_token"]),
            timeout=20,
        )
        assert r.status_code == 200, f"join → {r.status_code} {r.text}"
        post = _fetch_invites(api, dot["access_token"])
        assert all(r.get("table_id") != tid for r in post), (
            f"joined invite {tid} still present in dot's invites"
        )
        # Also verify the authoritative DB side: dot is now in seated.
        tr = api.get(f"{BASE_URL}/api/tables/{tid}", timeout=20)
        assert tr.status_code == 200
        assert dot["user"]["id"] in (tr.json().get("seated") or [])

    def test_08_decline_is_per_table_not_cross_invite(
        self, api, frankie, dot
    ):
        """Dot gets two separate invites from frankie. Declining one must
        NOT remove the other — decline is scoped to a single table."""
        tid_keep = _create_table(
            api,
            frankie,
            name="TEST_iter233_keep",
            invite_ids=[dot["user"]["id"]],
            visibility="friends",
        )
        tid_drop = _create_table(
            api,
            frankie,
            name="TEST_iter233_drop",
            invite_ids=[dot["user"]["id"]],
            visibility="friends",
        )
        # Decline only the "drop" one.
        r = api.post(
            f"{BASE_URL}/api/tables/{tid_drop}/decline/{dot['user']['id']}",
            headers=_auth(dot["access_token"]),
            timeout=20,
        )
        assert r.status_code == 200
        post = _fetch_invites(api, dot["access_token"])
        kept = [row.get("table_id") for row in post]
        assert tid_keep in kept, (
            "declining one invite incorrectly removed an unrelated invite"
        )
        assert tid_drop not in kept, (
            "declined invite still surfacing in /invites/mine"
        )
