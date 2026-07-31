"""Regression pass — Share a Moment batch #2 (backend only).

Covers:
  1. `first_moment: bool` on POST /api/moments — true only for member's
     first-ever moment.
  2. `first_comment_on_moment: bool` on POST /api/moments/{id}/comments
     — true only when the comment being posted is the first on that
     moment.
  3. `_clean_share_moment_suggestion` sanitizer — unit tests (quotes,
     hashtags, clamp, label defaults / rejection).
  4. Live George turn integration (SSE-less structural smoke): start +
     turn returns 200 and any `share_moment_suggestion` field has both
     `text` and `label`. Also verifies the schema is in the emitted
     system prompt.

Run:
    pytest /app/backend/tests/test_share_a_moment_batch2.py -v --tb=short \
        --junitxml=/app/test_reports/pytest/iter130_share_moment_batch2.xml
"""
import os
import sys
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set (see /app/frontend/.env)"
API = f"{BASE_URL}/api"

CMS_EMAIL = "hello@friendplace.com.au"
CMS_PASSWORD = "TestPass2026!"

# Ensure `import services...` works when we exercise the sanitizer directly.
sys.path.insert(0, "/app/backend")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _signup(api_client, tag: str) -> dict:
    username = f"TESTsm2_{tag}_{uuid.uuid4().hex[:6]}"
    r = api_client.post(f"{API}/auth/signup", json={
        "username": username,
        "password": "TestPass2026!",
        "email": f"{username}@example.com",
        "first_name": tag.capitalize(),
    })
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    j = r.json()
    return {"id": j["user"]["id"], "token": j["access_token"], "username": username}


@pytest.fixture(scope="module")
def author(api_client):
    return _signup(api_client, "author")


@pytest.fixture(scope="module")
def commenter(api_client):
    return _signup(api_client, "commenter")


@pytest.fixture(scope="module")
def commenter2(api_client):
    return _signup(api_client, "commenter2")


@pytest.fixture(scope="module")
def cms_token(api_client):
    r = api_client.post(f"{API}/cms/auth/login",
                        json={"email": CMS_EMAIL, "password": CMS_PASSWORD})
    assert r.status_code == 200, f"CMS login failed: {r.status_code} {r.text}"
    return r.json()["token"]


# ---------------------------------------------------------------------------
# 1. first_moment
# ---------------------------------------------------------------------------

class TestFirstMomentFlag:
    def test_first_moment_true_on_first_post(self, api_client, author):
        r = api_client.post(f"{API}/moments", json={
            "user_id": author["id"],
            "caption": "TEST first moment — batch2",
            "photos": [],
            "privacy": "everyone",
        })
        assert r.status_code == 200, r.text
        j = r.json()
        assert "id" in j
        assert j.get("first_moment") is True, (
            f"Expected first_moment=True on first post, got {j.get('first_moment')!r}"
        )
        # stash for cleanup
        author.setdefault("moment_ids", []).append(j["id"])

    def test_first_moment_false_on_second_post(self, api_client, author):
        r = api_client.post(f"{API}/moments", json={
            "user_id": author["id"],
            "caption": "TEST second moment — batch2",
            "photos": [],
            "privacy": "everyone",
        })
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("first_moment") is False, (
            f"Expected first_moment=False on second post, got {j.get('first_moment')!r}"
        )
        author.setdefault("moment_ids", []).append(j["id"])


# ---------------------------------------------------------------------------
# 2. first_comment_on_moment
# ---------------------------------------------------------------------------

class TestFirstCommentFlag:
    @pytest.fixture(scope="class")
    def moment_m(self, api_client, author):
        r = api_client.post(f"{API}/moments", json={
            "user_id": author["id"],
            "caption": "TEST moment M for comments",
        })
        assert r.status_code == 200, r.text
        return r.json()["id"]

    @pytest.fixture(scope="class")
    def moment_n(self, api_client, author):
        r = api_client.post(f"{API}/moments", json={
            "user_id": author["id"],
            "caption": "TEST moment N for comments",
        })
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_first_comment_on_moment_true(self, api_client, commenter, moment_m):
        r = api_client.post(f"{API}/moments/{moment_m}/comments", json={
            "user_id": commenter["id"],
            "body": "TEST first comment",
        })
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("first_comment_on_moment") is True, (
            f"Expected first_comment_on_moment=True, got {j.get('first_comment_on_moment')!r}"
        )

    def test_second_comment_on_moment_false(self, api_client, commenter2, moment_m):
        r = api_client.post(f"{API}/moments/{moment_m}/comments", json={
            "user_id": commenter2["id"],
            "body": "TEST second comment",
        })
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("first_comment_on_moment") is False, (
            f"Expected first_comment_on_moment=False, got {j.get('first_comment_on_moment')!r}"
        )

    def test_independent_moment_first_comment_true(self, api_client, commenter, moment_n):
        r = api_client.post(f"{API}/moments/{moment_n}/comments", json={
            "user_id": commenter["id"],
            "body": "TEST first comment on N",
        })
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("first_comment_on_moment") is True, (
            f"Expected first_comment_on_moment=True on unrelated moment, got {j.get('first_comment_on_moment')!r}"
        )


# ---------------------------------------------------------------------------
# 3. _clean_share_moment_suggestion — direct sanitizer tests
# ---------------------------------------------------------------------------

from services.george.event_creation.service import _clean_share_moment_suggestion  # noqa: E402


DEFAULT_LABEL = "🦋 Share this as a Moment"


class TestCleanShareMomentSuggestion:
    def test_none_returns_none(self):
        assert _clean_share_moment_suggestion(None) is None

    def test_non_dict_returns_none(self):
        assert _clean_share_moment_suggestion("hello") is None
        assert _clean_share_moment_suggestion(42) is None
        assert _clean_share_moment_suggestion([1, 2, 3]) is None

    def test_missing_text_returns_none(self):
        assert _clean_share_moment_suggestion({}) is None
        assert _clean_share_moment_suggestion({"label": "x"}) is None

    def test_empty_text_returns_none(self):
        assert _clean_share_moment_suggestion({"text": ""}) is None
        assert _clean_share_moment_suggestion({"text": "   "}) is None

    def test_trims_whitespace_defaults_label(self):
        out = _clean_share_moment_suggestion({"text": "  hello  "})
        assert out == {"text": "hello", "label": DEFAULT_LABEL}

    def test_strips_wrapping_double_quotes(self):
        out = _clean_share_moment_suggestion({"text": '"Just finished my walk!"'})
        assert out is not None
        assert out["text"] == "Just finished my walk!"
        assert out["label"] == DEFAULT_LABEL

    def test_strips_wrapping_single_quotes(self):
        out = _clean_share_moment_suggestion({"text": "'lovely day'"})
        assert out is not None
        assert out["text"] == "lovely day"

    def test_strips_curly_quotes(self):
        out = _clean_share_moment_suggestion({"text": "\u201cA quiet moment.\u201d"})
        assert out is not None
        assert out["text"] == "A quiet moment."

    def test_strips_hashtags(self):
        out = _clean_share_moment_suggestion(
            {"text": "The scones were lovely #baking #home"}
        )
        assert out is not None
        assert out["text"] == "The scones were lovely"

    def test_only_hashtags_returns_none(self):
        assert _clean_share_moment_suggestion({"text": "#baking #home"}) is None

    def test_clamps_long_text(self):
        long_text = "a" * 800
        out = _clean_share_moment_suggestion({"text": long_text})
        assert out is not None
        assert len(out["text"]) <= 500
        assert out["text"].endswith("…"), f"Expected ellipsis truncation, got: {out['text'][-5:]!r}"

    def test_custom_label_short_preserved(self):
        out = _clean_share_moment_suggestion({
            "text": "hi",
            "label": "🦋 Share as Moment",
        })
        assert out == {"text": "hi", "label": "🦋 Share as Moment"}

    def test_custom_label_too_long_falls_back(self):
        long_label = "A very long call to action button label " * 3
        out = _clean_share_moment_suggestion({
            "text": "hi",
            "label": long_label,
        })
        assert out is not None
        assert out["label"] == DEFAULT_LABEL


# ---------------------------------------------------------------------------
# 4. Live George turn integration — SSE-less structural smoke
# ---------------------------------------------------------------------------

class TestGeorgeShareMomentTurnIntegration:
    def test_schema_present_in_system_prompt(self):
        """Grep the loaded system prompt for share_moment_suggestion."""
        from services.george.event_creation import service as evt_service
        # The prompt lives in a module-level string constant. Grab any
        # attribute that looks like a str and check for the key.
        found = False
        for name in dir(evt_service):
            val = getattr(evt_service, name, None)
            if isinstance(val, str) and "share_moment_suggestion" in val and len(val) > 500:
                found = True
                break
        assert found, "share_moment_suggestion schema not found in any module-level prompt string"

    def test_start_and_turn_returns_200(self, api_client, cms_token):
        headers = {"Authorization": f"Bearer {cms_token}", "Content-Type": "application/json"}
        r = api_client.post(
            f"{API}/mcgs/george/event/start",
            json={"text": "hello George"},
            headers=headers,
            timeout=60,
        )
        assert r.status_code == 200, f"start failed: {r.status_code} {r.text[:400]}"
        session = r.json()
        assert isinstance(session.get("turns"), list), "session missing turns array"
        session_id = session.get("session_id") or session.get("id")
        assert session_id, f"session id missing in {list(session.keys())}"

        r2 = api_client.post(
            f"{API}/mcgs/george/event/session/{session_id}/turn",
            json={"text": "I just finished restoring my Holden today, she's a beauty."},
            headers=headers,
            timeout=90,
        )
        assert r2.status_code == 200, f"turn failed: {r2.status_code} {r2.text[:400]}"
        session2 = r2.json()
        assert isinstance(session2.get("turns"), list), "turn response missing turns array"

        # Any george-role turn with share_moment_suggestion must have text+label.
        any_share = False
        for turn in session2["turns"]:
            if turn.get("role") != "george":
                continue
            share = turn.get("share_moment_suggestion")
            if share is not None:
                any_share = True
                assert isinstance(share, dict), f"share_moment_suggestion not a dict: {share!r}"
                assert isinstance(share.get("text"), str) and share["text"].strip(), (
                    f"share_moment_suggestion.text missing or empty: {share!r}"
                )
                assert isinstance(share.get("label"), str) and share["label"].strip(), (
                    f"share_moment_suggestion.label missing or empty: {share!r}"
                )
                # Also confirm the drop-navigate rule: if share is present,
                # navigate_to key must NOT be "moments".
                nav = turn.get("navigate_to")
                if nav is not None:
                    assert nav.get("key") != "moments", (
                        "navigate_to.moments should be dropped when share_moment_suggestion is present"
                    )
        # LLM output non-deterministic — don't fail if the model doesn't emit it.
        if not any_share:
            print("NOTE: LLM did not emit share_moment_suggestion this run — skipping structural assertion")
