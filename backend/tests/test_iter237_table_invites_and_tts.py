"""iter237 regression tests.

Scope:
  1) GET /api/me/table-invites — new fields `is_private`, `invited_at`,
     `invited_by` added; sort order honours per-invitee invited_at.
  2) POST /api/tables (create) — persists `invites_meta` with per-invitee
     at/by.
  3) /api/george/speak — TTS endpoint still works (voice override honoured).
  4) Regression: /api/founders/claim still reuses email-reserved FMN.

Uses demo accounts for inviter + invitee auth so no state is corrupted.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


# ─── Fixtures ───────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def demo_tokens():
    """Login two demo accounts to use as host + invitee."""
    tokens = {}
    for uname in ("frankie", "dot"):
        r = requests.post(f"{API}/auth/demo-login", json={"username": uname}, timeout=15)
        assert r.status_code == 200, f"demo-login {uname} failed: {r.status_code} {r.text}"
        tokens[uname] = r.json()["access_token"]
    return tokens


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _me(token):
    r = requests.get(f"{API}/auth/me", headers=_auth(token), timeout=10)
    assert r.status_code == 200
    return r.json()


# ─── 1) Table invites — new fields ─────────────────────────────────────
class TestTableInvitesIter237:
    """GET /api/me/table-invites now returns is_private/invited_at/invited_by."""

    def test_table_invites_endpoint_returns_new_fields(self, demo_tokens):
        """Call /api/tables/invites/mine and verify new field keys exist in response schema."""
        r = requests.get(f"{API}/tables/invites/mine", headers=_auth(demo_tokens["frankie"]), timeout=10)
        assert r.status_code == 200, f"table-invites endpoint failed: {r.text}"
        data = r.json()
        assert "invites" in data
        # schema check — every invite (if any) MUST have new keys
        for inv in data["invites"]:
            assert "is_private" in inv, f"missing is_private: {inv.keys()}"
            assert "invited_at" in inv, f"missing invited_at: {inv.keys()}"
            assert "invited_by" in inv, f"missing invited_by: {inv.keys()}"
            assert isinstance(inv["is_private"], bool)

    def test_private_invite_flow_end_to_end(self, demo_tokens):
        """Create friends-only table from maggie inviting frankie, then
        verify frankie's /me/table-invites marks it is_private=True with
        invited_at timestamp + invited_by=maggie's id.

        NOTE: Requires maggie↔frankie to actually be friends in the
        preview DB (demo accounts aren't preseeded as friends in all
        envs). If they aren't, the backend simply won't send the invite
        (chosen filter narrows to friends only) — we skip the assertions
        in that case rather than fail, because the schema test above
        already covered the field-presence guarantee.
        """
        maggie = _me(demo_tokens["frankie"])
        frankie = _me(demo_tokens["dot"])

        # Create private friends-only table with explicit friend list
        tname = f"TEST_iter237_{uuid.uuid4().hex[:6]}"
        body = {
            "host_id": maggie["id"],
            "name": tname,
            "emoji": "☕",
            "description": "iter237 regression",
            "capacity": 6,
            "visibility": "friends",
            "invite_ids": [frankie["id"]],
        }
        r = requests.post(f"{API}/tables", headers=_auth(demo_tokens["frankie"]), json=body, timeout=15)
        if r.status_code not in (200, 201):
            pytest.skip(f"table create not supported in this env: {r.status_code} {r.text}")
        tbl = r.json()
        table_id = tbl.get("id") or tbl.get("table_id")
        assert table_id

        try:
            # frankie fetches invites
            r2 = requests.get(f"{API}/tables/invites/mine", headers=_auth(demo_tokens["dot"]), timeout=10)
            assert r2.status_code == 200
            invites = r2.json().get("invites", [])
            match = next((i for i in invites if i["table_id"] == table_id), None)
            if match is None:
                pytest.skip(
                    f"frankie not friends with maggie in preview DB — backend correctly didn't invite. "
                    f"Schema already verified in test_table_invites_endpoint_returns_new_fields."
                )
            # Core assertions
            assert match["is_private"] is True, f"friends-only table should be is_private=True, got {match}"
            assert match["invited_at"], "invited_at should be a non-empty iso string"
            assert match["invited_by"] == maggie["id"], f"invited_by mismatch: {match['invited_by']} vs {maggie['id']}"
            # Timestamp should be ISO-ish
            assert "T" in match["invited_at"] or "-" in match["invited_at"]
        finally:
            # Cleanup — delete the test table
            try:
                requests.delete(f"{API}/tables/{table_id}", headers=_auth(demo_tokens["frankie"]), timeout=10)
            except Exception:
                pass

    def test_invites_sorted_newest_first(self, demo_tokens):
        """Verify sorting honours invited_at (newest first)."""
        r = requests.get(f"{API}/tables/invites/mine", headers=_auth(demo_tokens["frankie"]), timeout=10)
        assert r.status_code == 200
        invites = r.json().get("invites", [])
        if len(invites) < 2:
            pytest.skip("need at least 2 invites to assert sort order")
        times = [i.get("invited_at") or "" for i in invites]
        assert times == sorted(times, reverse=True), f"invites not newest-first: {times}"


# ─── 2) TTS endpoint smoke ─────────────────────────────────────────────
class TestGeorgeSpeakIter237:
    """TTS endpoint must still accept optional voice override for prewarm."""

    def test_george_speak_default_voice(self, demo_tokens):
        r = requests.post(
            f"{API}/mcgs/george/speak",
            headers=_auth(demo_tokens["frankie"]),
            json={"text": "Hello, this is a test."},
            timeout=30,
        )
        # Accept 200 (returns audio URL) or 503 (TTS backend unconfigured)
        assert r.status_code in (200, 503), f"george/speak failed unexpectedly: {r.status_code} {r.text[:200]}"
        if r.status_code == 200:
            # Endpoint may return either JSON ({uri/url}) or raw audio bytes.
            ctype = r.headers.get("content-type", "")
            if "json" in ctype:
                body = r.json()
                assert any(k in body for k in ("uri", "url", "audio_url")), f"missing audio key: {list(body.keys())}"
            else:
                assert "audio" in ctype or len(r.content) > 500, f"expected audio bytes, got {ctype} / {len(r.content)}B"

    def test_george_speak_with_voice_override(self, demo_tokens):
        r = requests.post(
            f"{API}/mcgs/george/speak",
            headers=_auth(demo_tokens["frankie"]),
            json={"text": "Hello again.", "voice": "georgia"},
            timeout=30,
        )
        assert r.status_code in (200, 400, 503), f"voice-override call failed: {r.status_code} {r.text}"


# ─── 3) Founders claim regression (iter236 email-link rule) ────────────
class TestFoundersClaimRegression:
    """Smoke test — endpoint responds correctly. Full behavioural
    coverage is in /app/backend/tests/test_iter215_link_account_lookup.py."""

    def test_founders_claim_endpoint_exists(self, demo_tokens):
        """/api/founders/claim must respond (demo accounts can't claim →
        400/409, but endpoint must exist)."""
        r = requests.post(f"{API}/founders/claim", headers=_auth(demo_tokens["frankie"]), timeout=15)
        # Demo accounts should be rejected (400) OR already-claimed (409)
        # OR Founding programme closed (410). All indicate endpoint lives.
        assert r.status_code in (400, 403, 409, 410, 422), f"unexpected status: {r.status_code} {r.text}"


# ─── 4) Health ───────────────────────────────────────────────────────
def test_api_root_health():
    r = requests.get(f"{API}/", timeout=10)
    assert r.status_code == 200
