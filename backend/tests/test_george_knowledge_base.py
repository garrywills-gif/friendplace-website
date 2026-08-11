"""Backend tests for George's Institutional Knowledge foundation (Phase 1).

Covers:
  * Auth-gate on /api/cms/knowledge*
  * List / detail / stats endpoints
  * Retrieval quality on canonical questions
  * Mongo text index existence
  * Regression on adjacent CMS endpoints
"""
from __future__ import annotations

import os
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://iphone-retest-batch.preview.emergentagent.com",
).rstrip("/")

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PW = "TestPass2026!"


# ─── fixtures ────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(api):
    r = api.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"CMS admin login failed: {r.status_code} {r.text}")
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ─── auth gate ───────────────────────────────────────────────────────
class TestAuthGate:
    def test_kb_list_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/cms/knowledge", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"

    def test_kb_stats_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/cms/knowledge-stats", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"

    def test_kb_retrieve_requires_auth(self, api):
        r = api.post(
            f"{BASE_URL}/api/cms/knowledge/retrieve",
            json={"query": "why george butterfly"},
            timeout=15,
        )
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


# ─── list + detail ───────────────────────────────────────────────────
class TestKnowledgeList:
    def test_list_returns_items_and_types(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/cms/knowledge", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "items" in j
        assert "types" in j
        assert isinstance(j["items"], list)
        # All six canonical types must be present in the type roster.
        expected_types = {"story", "principle", "decision", "feature", "roadmap", "philosophy"}
        assert set(j["types"]) == expected_types, f"types mismatch: {j['types']}"
        assert len(j["items"]) >= 17, f"expected >=17 items, got {len(j['items'])}"
        # No embedding leaks in list response.
        for it in j["items"]:
            assert "embedding" not in it

    def test_get_story_002(self, api, auth_headers):
        r = api.get(
            f"{BASE_URL}/api/cms/knowledge/KB-STORY-002",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["id"] == "KB-STORY-002"
        assert e["type"] == "story"
        assert e["title"] == "Why George is a butterfly"
        assert isinstance(e.get("body_md"), str) and len(e["body_md"]) > 100
        # Required fields
        for f in ("id", "type", "title", "body_md", "tags",
                  "sources", "status", "related_ids",
                  "superseded_by", "updated_at"):
            assert f in e, f"missing field: {f}"
        # Never expose embedding.
        assert "embedding" not in e

    def test_get_unknown_returns_404(self, api, auth_headers):
        r = api.get(
            f"{BASE_URL}/api/cms/knowledge/KB-DOES-NOT-EXIST",
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 404


# ─── stats ───────────────────────────────────────────────────────────
class TestKnowledgeStats:
    def test_stats_totals(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/cms/knowledge-stats",
                    headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["total"] >= 17
        for t in ("story", "principle", "decision", "feature", "roadmap", "philosophy"):
            assert t in j["by_type"], f"missing by_type.{t}"
        assert j["by_type"]["story"] == 6, f"expected 6 stories, got {j['by_type']['story']}"


# ─── retrieval ───────────────────────────────────────────────────────
class TestKnowledgeRetrieval:
    def _hit_ids(self, resp_json):
        return [h["id"] for h in resp_json.get("hits", [])]

    def test_retrieve_butterfly(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/cms/knowledge/retrieve",
            headers=auth_headers,
            json={"query": "Why is George a butterfly?", "k": 3},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        ids = self._hit_ids(r.json())
        assert ids, "no hits at all"
        assert ids[0] == "KB-STORY-002", f"top hit expected KB-STORY-002, got {ids}"

    def test_retrieve_no_public_list(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/cms/knowledge/retrieve",
            headers=auth_headers,
            json={"query": "Why do we not publicly list members?", "k": 3},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        ids = self._hit_ids(r.json())
        assert ids, "no hits"
        assert ids[0] == "KB-STORY-006", f"top hit expected KB-STORY-006, got {ids}"

    def test_retrieve_moderation(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/cms/knowledge/retrieve",
            headers=auth_headers,
            json={"query": "How does moderation work?", "k": 3},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        ids = self._hit_ids(r.json())
        assert ids, "no hits"
        assert ("KB-PHIL-001" in ids) or ("KB-DEC-001" in ids), \
            f"expected KB-PHIL-001 or KB-DEC-001 in top 3, got {ids}"

    def test_retrieve_outstanding_launch(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/cms/knowledge/retrieve",
            headers=auth_headers,
            json={"query": "What is still outstanding before launch?", "k": 3},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        ids = self._hit_ids(r.json())
        assert "KB-ROAD-002" in ids, f"expected KB-ROAD-002 in top 3, got {ids}"

    def test_retrieve_gibberish_tolerates_empty(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/cms/knowledge/retrieve",
            headers=auth_headers,
            json={"query": "random unrelated gibberish xyzzy quux", "k": 5},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        # tolerate 0-2 hits per spec
        assert len(j.get("hits", [])) <= 2, f"expected 0-2 hits, got {len(j['hits'])}"

    def test_retrieve_response_never_leaks_embedding(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/cms/knowledge/retrieve",
            headers=auth_headers,
            json={"query": "butterfly", "k": 3},
            timeout=30,
        )
        assert r.status_code == 200
        for h in r.json().get("hits", []):
            assert "embedding" not in h


# ─── text index existence ────────────────────────────────────────────
class TestMongoIndex:
    def test_kb_text_index_present(self):
        try:
            import asyncio
            from motor.motor_asyncio import AsyncIOMotorClient
        except Exception as e:
            pytest.skip(f"motor not available: {e}")
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME", "test_database")
        if not mongo_url:
            pytest.skip("MONGO_URL not set")

        async def _run():
            client = AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            info = await db["knowledge_base"].index_information()
            client.close()
            return info

        info = asyncio.get_event_loop().run_until_complete(_run())
        assert "kb_text_idx" in info, f"kb_text_idx missing. Have: {list(info.keys())}"
        idx = info["kb_text_idx"]
        weights = idx.get("weights") or {}
        # Weights on title/body_md/tags per implementation.
        for f in ("title", "body_md", "tags"):
            assert f in weights, f"text index missing weight for {f}: {weights}"


# ─── regression on adjacent CMS endpoints ────────────────────────────
class TestRegression:
    def test_admin_log(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/cms/admin-log",
                    headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text

    def test_members(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/cms/members",
                    headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text

    def test_security_summary(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/cms/security/summary",
                    headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
