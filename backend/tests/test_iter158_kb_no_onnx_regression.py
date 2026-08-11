"""
Iter158 — post-deployment-fix regression check.

Validates that removing the local ONNX embeddings from KB retrieval
(fastembed + onnxruntime uninstalled; `_embed()` is a no-op) does not
break any downstream:

  1. Backend imports & module-load — `services.knowledge` imports without
     `fastembed`/`onnxruntime` present, and `EMBED_DIM == 0` / model label
     "keyword-only".
  2. GET /api/mcgs/system-health returns KB health payload without 500.
     It uses `knowledge.health(db)` under the hood.
  3. POST /api/george/chat still streams a coherent SSE response for a
     KB-triggering admin question (keyword-only retrieval path).
  4. Any KB-quoting call does not surface `fastembed` / `TextEmbedding`
     / `onnxruntime` / `_embed` errors.
"""

# --------------------------------------------------------------------- imports
import os
import re
import json
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

CMS_EMAIL = "hello@friendplace.com.au"
CMS_PASSWORD = "TestPass2026!"


# ============================================================ helpers ========
def _cms_login() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": CMS_EMAIL, "password": CMS_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"cms login failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("ok") is True
    assert "token" in body
    return body["token"]


def _admin_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# =============================================== Module-load sanity ==========
class TestKnowledgeModule:
    """Ensure the knowledge module imports cleanly without fastembed/onnx."""

    def test_no_fastembed_installed(self):
        with pytest.raises(ModuleNotFoundError):
            import fastembed  # noqa: F401

    def test_no_onnxruntime_installed(self):
        with pytest.raises(ModuleNotFoundError):
            import onnxruntime  # noqa: F401

    def test_knowledge_module_keyword_only(self):
        from services.knowledge import EMBED_DIM, EMBED_MODEL, _embed  # noqa
        assert EMBED_DIM == 0
        assert EMBED_MODEL == "keyword-only"

    @pytest.mark.asyncio
    async def test_embed_returns_none(self):
        from services.knowledge import _embed
        result = await _embed("anything at all")
        assert result is None


# =============================================== System health probe =========
class TestSystemHealthEndpoint:
    """GET /api/mcgs/system-health should return 200 and expose KB counters."""

    @classmethod
    def setup_class(cls):
        cls.token = _cms_login()

    def test_system_health_ok(self):
        r = requests.get(
            f"{BASE_URL}/api/mcgs/system-health",
            headers=_admin_headers(self.token),
            timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        data = r.json()
        # Should be a dict with some probes; must not contain any onnx/fastembed err
        blob = json.dumps(data).lower()
        assert "fastembed" not in blob
        assert "onnxruntime" not in blob
        assert "textembedding" not in blob

    def test_system_health_fresh_bypass_cache(self):
        r = requests.get(
            f"{BASE_URL}/api/mcgs/system-health?fresh=1",
            headers=_admin_headers(self.token),
            timeout=45,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"


# =============================================== George chat KB path =========
class TestGeorgeChatKeywordOnly:
    """POST /api/george/chat with a KB-triggering question should still
    produce a coherent SSE response. Retrieval now runs keyword-only.
    """

    @classmethod
    def setup_class(cls):
        cls.token = _cms_login()

    def _stream(self, message: str) -> dict:
        """Return dict of collected events keyed by kind."""
        url = f"{BASE_URL}/api/george/chat"
        payload = {"message": message}
        events = {"delta": [], "done": [], "session": [], "plan": [],
                  "tools": [], "kb_proposal": [], "navigate": [],
                  "action_preview": [], "error_lines": []}
        with requests.post(
            url, json=payload,
            headers={**_admin_headers(self.token), "Accept": "text/event-stream"},
            stream=True, timeout=90,
        ) as resp:
            assert resp.status_code == 200, f"{resp.status_code} {resp.text[:400]}"
            current_event = None
            for raw in resp.iter_lines(decode_unicode=True):
                if raw is None:
                    continue
                if raw == "":
                    current_event = None
                    continue
                if raw.startswith("event: "):
                    current_event = raw.split("event: ", 1)[1].strip()
                elif raw.startswith("data: ") and current_event:
                    payload_str = raw.split("data: ", 1)[1]
                    try:
                        parsed = json.loads(payload_str)
                    except Exception:
                        parsed = payload_str
                    events.setdefault(current_event, []).append(parsed)
                    if isinstance(parsed, str) and re.search(
                        r"(fastembed|onnxruntime|textembedding|_embed)",
                        parsed, re.IGNORECASE,
                    ):
                        events["error_lines"].append(parsed)
        return events

    def test_kb_triggering_question_streams_reply(self):
        # A textbook KB-triggering admin question — should hit needs_kb()=True
        # and go through the retrieve() keyword path.
        events = self._stream("What are the email templates we send today?")
        # We got at least one delta and a done marker.
        assert len(events["delta"]) > 0, f"No delta chunks received; events={events}"
        assert len(events["done"]) >= 1, f"No done event; events={events}"
        # Assemble reply text.
        reply = "".join(d.get("text", "") for d in events["delta"] if isinstance(d, dict))
        assert len(reply.strip()) > 0, "Reply was empty"
        # Sanity — reply should not surface any ONNX/fastembed error banners.
        assert not re.search(r"(fastembed|onnxruntime|textembedding|_embed)", reply, re.IGNORECASE), reply

    def test_bare_noun_kb_lookup(self):
        # Bare-noun form — needs_kb triggers via _BARE_NOUN_TRIGGERS.
        events = self._stream("email templates")
        assert len(events["delta"]) > 0, f"No delta received; events={events}"
        assert len(events["done"]) >= 1
        reply = "".join(d.get("text", "") for d in events["delta"] if isinstance(d, dict))
        assert reply.strip(), "Empty reply on bare-noun lookup"
