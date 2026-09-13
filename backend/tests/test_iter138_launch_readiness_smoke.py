"""Iteration 138 — Launch Readiness smoke test.

This is a small, focused live-URL smoke suite that hits the endpoints and
George scenarios listed in Garry's V1 launch readiness sweep. It is
intentionally lean; deeper unit coverage lives in iter136/iter137/*.
"""
import json
import os

import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or "https://iphone-retest-batch.preview.emergentagent.com"
ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASS = "TestPass2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ─── CMS admin endpoints ─────────────────────────────────────────────
@pytest.mark.parametrize("path", [
    "/api/cms/auth/me",
    "/api/cms/members",
    "/api/cms/moments",
    "/api/cms/events",
    "/api/cms/campaigns",
    "/api/cms/segments",
    "/api/cms/founding-members",
    "/api/cms/admin-log",
    "/api/cms/enquiries",
    "/api/cms/flyer-templates",
    "/api/cms/knowledge",
    "/api/cms/knowledge-health",
])
def test_admin_endpoint_200(path, auth_headers):
    r = requests.get(f"{BASE}{path}", headers=auth_headers, timeout=15)
    assert r.status_code == 200, f"{path} → {r.status_code}: {r.text[:200]}"


# ─── MCGS endpoints ──────────────────────────────────────────────────
@pytest.mark.parametrize("path", [
    "/api/mcgs/system-health",
    "/api/mcgs/counts",
    "/api/mcgs/signals",
    "/api/mcgs/cases",
    "/api/mcgs/events/pending-approval",
    "/api/mcgs/rhythms/today",
])
def test_mcgs_endpoint_200(path, auth_headers):
    r = requests.get(f"{BASE}{path}", headers=auth_headers, timeout=15)
    assert r.status_code == 200, f"{path} → {r.status_code}: {r.text[:200]}"


# ─── Public endpoints (no auth) ──────────────────────────────────────
def test_public_events_200():
    r = requests.get(f"{BASE}/api/public/events", timeout=15)
    assert r.status_code == 200


def test_public_events_mine_200():
    r = requests.get(f"{BASE}/api/public/events/mine", timeout=15)
    assert r.status_code == 200


# ─── Flyer template auth gate ────────────────────────────────────────
def test_flyer_render_requires_auth():
    r = requests.get(f"{BASE}/api/cms/flyer-templates/founding_member_invite/render", timeout=15)
    assert r.status_code == 401


def test_flyer_render_with_auth(auth_headers):
    r = requests.get(
        f"{BASE}/api/cms/flyer-templates/founding_member_invite/render",
        headers=auth_headers,
        timeout=15,
    )
    assert r.status_code == 200


# ─── George navigation smoke via live SSE ────────────────────────────
def _stream_george(msg: str, pathname: str, headers) -> tuple[str, str | None]:
    """POST /api/george/chat and drain SSE. Returns (reply_text, navigate_path)."""
    r = requests.post(
        f"{BASE}/api/george/chat",
        headers={**headers, "Content-Type": "application/json"},
        json={"message": msg, "surface_context": {"pathname": pathname}},
        stream=True,
        timeout=60,
    )
    assert r.status_code == 200, r.text[:200]
    text, nav = "", None
    for raw in r.iter_lines(decode_unicode=True):
        if not raw or not raw.startswith("data:"):
            continue
        try:
            d = json.loads(raw[5:].strip())
        except Exception:
            continue
        if "text" in d:
            text += d["text"]
        if "path" in d and isinstance(d["path"], str) and d["path"].startswith("/admin"):
            nav = d["path"]
    return text, nav


def test_george_navigate_to_members(auth_headers):
    reply, nav = _stream_george("open members", "/admin/dashboard", auth_headers)
    assert nav == "/admin/members", f"nav={nav}, reply={reply[:200]}"


def test_george_navigate_to_flyers(auth_headers):
    reply, nav = _stream_george("take me to flyers", "/admin/dashboard", auth_headers)
    assert nav == "/admin/flyers", f"nav={nav}, reply={reply[:200]}"


def test_george_already_here_dashboard(auth_headers):
    """On dashboard, saying 'open dashboard' → NO navigate SSE."""
    reply, nav = _stream_george("open the dashboard", "/admin/dashboard", auth_headers)
    assert nav is None, f"expected suppression, got {nav}"


def test_george_where_am_i_on_members(auth_headers):
    reply, _ = _stream_george("where am I right now?", "/admin/members", auth_headers)
    assert "members" in reply.lower()


def test_george_nonsense_page_graceful(auth_headers):
    reply, nav = _stream_george("open the moon", "/admin/dashboard", auth_headers)
    assert nav is None
    # Should NOT falsely say "opening the moon now"
    assert "opening the moon" not in reply.lower()


def test_george_no_grounding_footer(auth_headers):
    reply, _ = _stream_george("show me system health", "/admin/dashboard", auth_headers)
    assert "Grounded in" not in reply
    assert "Grounded via" not in reply
    assert "[KB-" not in reply
    assert "Based on the tool output" not in reply
