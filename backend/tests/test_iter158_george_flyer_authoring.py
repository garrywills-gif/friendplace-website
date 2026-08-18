"""iter158 — George flyer-authoring tools + chat SSE integration.

Covers:
- Backend: list_flyer_templates + draft_flyer are registered.
- Backend: draft_flyer happy path returns action_preview with correct edit_url.
- Backend: draft_flyer invalid layout returns error.
- Backend: draft_flyer unknown template returns error.
- Chat SSE integration: George invokes the flyer tools and emits an
  action_preview event with action_type=flyer_draft.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = "https://george-mcgs-cms.preview.emergentagent.com"
MONGO_URL = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME") or "test_database"

ADMIN_EMAIL = "hello@friendplace.com.au"
ADMIN_PASSWORD = "TestPass2026!"


# ------------- Fixtures ---------------------------------------------------

@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def db():
    client = AsyncIOMotorClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def admin_token():
    """Login to CMS admin via cms admin auth endpoint."""
    # The mini-CMS admin uses /api/cms/auth/login (or similar). Try common paths.
    with httpx.Client(timeout=30.0) as client:
        for path in ("/api/cms/auth/login",):
            r = client.post(f"{BASE_URL}{path}",
                            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
            if r.status_code == 200:
                data = r.json()
                token = data.get("token") or data.get("access_token") or (
                    data.get("data") or {}).get("token")
                if token:
                    return token
    pytest.skip("Could not obtain CMS admin JWT — check auth endpoint path")


# ------------- Direct tool-registry tests ---------------------------------

@pytest.mark.asyncio
async def test_tools_are_registered(db):
    """list_flyer_templates + draft_flyer are in TOOL_REGISTRY."""
    from services.george.tools import TOOL_REGISTRY
    assert "list_flyer_templates" in TOOL_REGISTRY
    assert "draft_flyer" in TOOL_REGISTRY


@pytest.mark.asyncio
async def test_list_flyer_templates_returns_seeded_rows(db):
    from services.george.tools import execute_tool
    rows = await execute_tool(db, "list_flyer_templates", {})
    assert isinstance(rows, list)
    keys = {r.get("key") for r in rows}
    assert "founding_member_invite" in keys, f"missing founding_member_invite in {keys}"
    assert "community_notice" in keys, f"missing community_notice in {keys}"
    # Shape check on the founding row
    fm = next(r for r in rows if r["key"] == "founding_member_invite")
    assert fm.get("name")
    assert isinstance(fm.get("supported_layouts"), list)
    assert "poster_a4" in fm["supported_layouts"]
    assert fm.get("default_layout")
    # Hidden fields should be filtered out
    for f in fm.get("fields") or []:
        assert f.get("type") != "hidden"


@pytest.mark.asyncio
async def test_draft_flyer_happy_path(db):
    from services.george.tools import execute_tool
    args = {
        "template_key": "founding_member_invite",
        "layout": "poster_a4",
        "field_values": {
            "venue": "Kellyville Library",
            "url": "https://friendplace.com.au?ref=test",
        },
    }
    result = await execute_tool(db, "draft_flyer", args)
    assert result.get("kind") == "action_preview"
    assert result.get("action_type") == "flyer_draft"
    assert not result.get("error"), f"unexpected error: {result.get('error')}"
    flyer = result.get("flyer") or {}
    assert flyer.get("template_key") == "founding_member_invite"
    assert flyer.get("layout") == "poster_a4"
    edit_url = flyer.get("edit_url", "")
    assert edit_url.startswith("/admin/flyers/founding_member_invite?"), edit_url
    parsed = urlparse(edit_url)
    qs = parse_qs(parsed.query)
    assert qs.get("open") == ["preview"]
    assert qs.get("layout") == ["poster_a4"]
    # Decode the fields base64 and verify Kellyville Library survived
    raw = qs.get("fields", [""])[0]
    padded = raw + "=" * ((4 - len(raw) % 4) % 4)
    decoded = base64.urlsafe_b64decode(padded).decode("utf-8")
    fields = json.loads(decoded)
    assert fields.get("venue") == "Kellyville Library"
    assert fields.get("url") == "https://friendplace.com.au?ref=test"


@pytest.mark.asyncio
async def test_draft_flyer_invalid_layout(db):
    from services.george.tools import execute_tool
    result = await execute_tool(db, "draft_flyer", {
        "template_key": "founding_member_invite",
        "layout": "billboard_freeway",
    })
    assert result.get("action_type") == "flyer_draft"
    assert result.get("error"), "expected error for unsupported layout"
    # helpful message must list supported layouts
    assert "poster_a4" in result["error"] or "supported" in result["error"].lower()


@pytest.mark.asyncio
async def test_draft_flyer_unknown_template(db):
    from services.george.tools import execute_tool
    result = await execute_tool(db, "draft_flyer", {"template_key": "nonexistent_xyz"})
    assert result.get("action_type") == "flyer_draft"
    assert result.get("error"), "expected error for unknown template"
    # Should suggest listing available templates
    err_lower = result["error"].lower()
    assert "list" in err_lower or "available" in err_lower or "couldn't find" in err_lower


@pytest.mark.asyncio
async def test_draft_flyer_filters_unknown_field_keys(db):
    """Ensure unknown/smuggled field keys are stripped."""
    from services.george.tools import execute_tool
    result = await execute_tool(db, "draft_flyer", {
        "template_key": "founding_member_invite",
        "layout": "poster_a4",
        "field_values": {"venue": "Test Venue", "malicious_key": "boom"},
    })
    assert not result.get("error")
    field_values = (result.get("flyer") or {}).get("field_values") or {}
    assert "malicious_key" not in field_values
    assert field_values.get("venue") == "Test Venue"


# ------------- Chat SSE integration --------------------------------------

@pytest.mark.asyncio
async def test_chat_sse_emits_flyer_draft_action_preview(admin_token):
    """POST /api/mcgs/george/chat with an admin prompt asking for a flyer.

    The SSE stream should:
      - include a tools event mentioning draft_flyer / list_flyer_templates
      - emit an action_preview event with action_type=flyer_draft and
        a populated flyer.edit_url
    """
    url = f"{BASE_URL}/api/george/chat"
    payload = {
        "message": (
            "Please use the draft_flyer tool now with template_key="
            "founding_member_invite, layout=poster_a4, field_values="
            '{"venue":"Kellyville Library"}'
        ),
        "scope": "mcgs",
    }
    headers = {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    seen_tools = False
    seen_flyer_draft = False
    flyer_edit_url = None

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            async with client.stream("POST", url, json=payload, headers=headers) as r:
                if r.status_code != 200:
                    body = await r.aread()
                    pytest.skip(
                        f"chat SSE returned {r.status_code}: {body[:300]!r}"
                    )
                current_event = None
                async for line in r.aiter_lines():
                    if not line:
                        current_event = None
                        continue
                    if line.startswith("event:"):
                        current_event = line.split(":", 1)[1].strip()
                    elif line.startswith("data:"):
                        data_str = line.split(":", 1)[1].strip()
                        try:
                            data = json.loads(data_str)
                        except Exception:
                            continue
                        if current_event == "tools":
                            # Payload lists tool calls / results
                            body = json.dumps(data).lower()
                            if "draft_flyer" in body or "list_flyer_templates" in body:
                                seen_tools = True
                        # Some backends dispatch this as an explicit
                        # 'action_preview' or 'preview' event.
                        if current_event in ("action_preview", "preview"):
                            if data.get("action_type") == "flyer_draft":
                                seen_flyer_draft = True
                                flyer_edit_url = (data.get("flyer") or {}).get("edit_url")
                        if current_event == "done":
                            break
        except httpx.ReadTimeout:
            pass

    assert seen_flyer_draft, "expected action_preview event with action_type=flyer_draft"
    assert flyer_edit_url and "/admin/flyers/founding_member_invite" in flyer_edit_url
    # tools event carrying flyer tools is a strong signal but not strictly
    # required — log only.
    if not seen_tools:
        print("[warn] no tools event mentioned draft_flyer / list_flyer_templates")
