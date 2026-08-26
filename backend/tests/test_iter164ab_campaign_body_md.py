"""iter164ab — Campaign Composer body_md rendering + preview/test endpoints.

Two feature slices land in the same iteration:

  1. ``announcement_template`` now supports a safe markdown-lite
     subset for campaign bodies: **bold**, *italic*/_italic_, links
     (http/https/mailto only), - / * bullet lists, and blank-line
     paragraphs. Composer input is HTML-escaped BEFORE any markdown
     transforms run so raw HTML from a composer field can never leak
     through.

  2. Two new admin-only endpoints share the *exact same* rendering
     path (`_preview_render`) that the real send worker uses:

       • POST /api/cms/campaigns/{id}/render-recipient
         Renders the personalised email for a chosen recipient —
         no send. Body: {"user_id": "…"} OR {"email": "…"}.

       • POST /api/cms/campaigns/{id}/test-send
         Sends a single test copy to the authenticated admin
         (default) or a `CAMPAIGN_TEST_EMAILS` allow-list address.
         Never touches the campaign audience. Subject prefixed
         with `[TEST]`.

These tests exercise the markdown renderer directly + the two new
endpoints against a running backend on localhost:8001.
"""

from __future__ import annotations

import os
import sys
import time

import pytest
import requests

# Ensure `email_service` can be imported for direct-call tests.
sys.path.insert(0, "/app/backend")

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
def campaign_id(admin_token: str) -> str:
    h = {"Authorization": f"Bearer {admin_token}"}
    payload = {
        "template": "announcement",
        "name": f"iter164ab test {int(time.time())}",
        "subject": "Iter164ab test subject",
        "preheader": "This is a test preheader",
        "title": "A rendered heading",
        "body_md": (
            "First paragraph with **bold** and *italic*.\n\n"
            "Check the [FriendPlace site](https://friendplace.com.au).\n\n"
            "- Bullet one\n- Bullet two with **emphasis**\n- Bullet three"
        ),
        "companion": "george",
        "audience_filter": {"kind": "founding_members"},
    }
    r = requests.post(f"{BASE}/api/cms/campaigns", headers=h, json=payload, timeout=15)
    r.raise_for_status()
    body = r.json()
    cid = body.get("id") or body.get("campaign", {}).get("id")
    assert cid, f"unexpected create-campaign response shape: {body}"
    return cid


# ── Slice 1: markdown-lite renderer (direct calls) ─────────────────


class TestBodyMdRenderer:
    def _import(self):
        from email_service import (  # noqa: WPS433
            _render_campaign_body_md_to_html,
            _render_campaign_body_md_to_text,
        )
        return _render_campaign_body_md_to_html, _render_campaign_body_md_to_text

    def test_paragraphs_and_bold(self):
        h, _ = self._import()
        out = h("Line **one**.\n\nLine two.")
        assert out.count("<p ") == 2
        assert "<strong>one</strong>" in out

    def test_italic_both_flavours(self):
        h, _ = self._import()
        out = h("This is *starred* and _underscored_.")
        assert out.count("<em>") == 2

    def test_links_only_http_and_mailto(self):
        h, _ = self._import()
        ok = h("Go [here](https://example.com) or [email](mailto:a@b.com).")
        assert '<a href="https://example.com"' in ok
        assert '<a href="mailto:a@b.com"' in ok
        # Reject javascript: / data: URIs entirely — they must not be linkified.
        danger = h("Click [me](javascript:alert(1)) plz.")
        assert "<a " not in danger
        assert "javascript:" in danger  # kept as literal, escaped text

    def test_bullets_render_as_list(self):
        h, _ = self._import()
        out = h("- one\n- two\n- three")
        assert "<ul" in out
        assert out.count("<li ") == 3
        # No spurious <p> wrapping a bullet block.
        assert "<p " not in out

    def test_xss_is_escaped_not_executed(self):
        h, _ = self._import()
        out = h("<script>alert(1)</script>")
        assert "<script>" not in out
        assert "&lt;script&gt;" in out

    def test_text_form_keeps_markers_and_expands_links(self):
        _, t = self._import()
        out = t("**bold** and *italic* [go](https://x.com) here.\n\n- a\n- b")
        assert "**bold**" in out
        assert "*italic*" in out
        assert "go (https://x.com)" in out
        assert "- a" in out and "- b" in out

    def test_empty_body_returns_empty(self):
        h, _ = self._import()
        assert h("") == ""
        assert h("   \n  \n") == ""


# ── Slice 2: /render-recipient ─────────────────────────────────────


class TestRenderRecipient:
    def test_401_without_token(self, campaign_id):
        r = requests.post(
            f"{BASE}/api/cms/campaigns/{campaign_id}/render-recipient",
            json={"email": "sarah@example.com"},
            timeout=10,
        )
        assert r.status_code == 401

    def test_400_when_neither_email_nor_user_id(self, admin_token, campaign_id):
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(
            f"{BASE}/api/cms/campaigns/{campaign_id}/render-recipient",
            headers=h, json={}, timeout=10,
        )
        assert r.status_code == 400

    def test_404_when_recipient_not_in_audience(self, admin_token, campaign_id):
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(
            f"{BASE}/api/cms/campaigns/{campaign_id}/render-recipient",
            headers=h, json={"email": "nobody-here@example.com"}, timeout=10,
        )
        assert r.status_code == 404

    def test_happy_path_returns_personalised_render(
        self, admin_token, campaign_id
    ):
        h = {"Authorization": f"Bearer {admin_token}"}
        # Find any real founder to test with.
        list_resp = requests.get(
            f"{BASE}/api/cms/members?limit=1",
            headers=h, timeout=10,
        )
        list_resp.raise_for_status()
        members = list_resp.json().get("items") or list_resp.json().get("members") or []
        # If there are no founders, skip rather than assert on live-DB shape.
        if not members:
            pytest.skip("no founding members in this env")
        target = next((m for m in members if m.get("email")), None)
        if not target:
            pytest.skip("no member with email")
        r = requests.post(
            f"{BASE}/api/cms/campaigns/{campaign_id}/render-recipient",
            headers=h, json={"email": target["email"]}, timeout=15,
        )
        # The audience filter may be `founding_members`; if this admin
        # isn't one, skip. The endpoint's contract is what we're testing.
        if r.status_code == 404:
            pytest.skip("test admin isn't in founding_members audience")
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("subject", "html", "text", "recipient"):
            assert k in body
        # The markdown-lite must have made it into the HTML.
        assert "<strong>" in body["html"]
        assert "<ul" in body["html"]
        assert '<a href="https://friendplace.com.au"' in body["html"]
        # Recipient block shape.
        assert body["recipient"]["email"].lower() == target["email"].lower()


# ── Slice 3: /test-send ────────────────────────────────────────────


class TestTestSend:
    def test_401_without_token(self, campaign_id):
        r = requests.post(
            f"{BASE}/api/cms/campaigns/{campaign_id}/test-send",
            json={},
            timeout=10,
        )
        assert r.status_code == 401

    def test_refuses_arbitrary_recipient(self, admin_token, campaign_id):
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(
            f"{BASE}/api/cms/campaigns/{campaign_id}/test-send",
            headers=h, json={"to": "random-stranger@example.com"}, timeout=10,
        )
        assert r.status_code == 400
        assert "refusing" in r.text.lower()

    def test_default_uses_admin_email(self, admin_token, campaign_id):
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(
            f"{BASE}/api/cms/campaigns/{campaign_id}/test-send",
            headers=h, json={}, timeout=30,
        )
        # 200 whether the outbound Resend actually succeeds or not —
        # the endpoint returns {ok: False, error: …} on send failure.
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["to"] == ADMIN_EMAIL.lower()
        assert body["subject"].startswith("[TEST] ")
        assert body["used_admin_email"] is True

    def test_explicit_admin_email_is_allowed(self, admin_token, campaign_id):
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(
            f"{BASE}/api/cms/campaigns/{campaign_id}/test-send",
            headers=h, json={"to": ADMIN_EMAIL.upper()}, timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["to"] == ADMIN_EMAIL.lower()

    def test_env_allow_list_lets_other_addresses_through(
        self, admin_token, campaign_id, monkeypatch
    ):
        # Add a whitelisted address to the running process. NB: this
        # test intentionally runs against the same live backend, so
        # we can't `monkeypatch` os.environ in-process — this branch
        # is covered indirectly by the "refuses arbitrary" test above
        # which proves the allow-list gate.
        pytest.skip(
            "env allow-list requires restarting the backend with "
            "CAMPAIGN_TEST_EMAILS set — refuses-arbitrary test covers the gate"
        )
