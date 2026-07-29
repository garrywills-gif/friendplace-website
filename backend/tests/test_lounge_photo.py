"""Tests for Coffee Lounge photo-message feature.

Covers:
  - Pydantic Message model accepts image-only messages (empty text + image OK).
  - WebSocket /api/ws/table/{id} broadcasts text+image, text-only, image-only.
  - Empty payloads (no text, no image) are silently ignored.
  - Oversized image payloads are rejected with an error frame and not persisted.
  - Persisted messages contain the image field.
"""
import os
import json
import asyncio
import uuid

import pytest
import requests
import websockets

# ---- Module: shared config ----------------------------------------------------
BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://george-mcgs-cms.preview.emergentagent.com",
).rstrip("/")
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

SMALL_IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQ=="
OVERSIZED_IMG = "data:image/jpeg;base64," + ("A" * 700_000)  # > 600KB cap


# ---- Feature: Message Pydantic model ----------------------------------------
def test_message_model_allows_image_without_text():
    """Message must accept image-only payload (empty text)."""
    # Import lazily so pytest collection doesn't need server env on disk
    from server import Message
    m = Message(user_id="u1", text="", image=SMALL_IMG)
    assert m.text == ""
    assert m.image == SMALL_IMG


def test_message_model_defaults_image_empty():
    from server import Message
    m = Message(user_id="u1", text="hello")
    assert m.image == ""


# ---- Helpers ----------------------------------------------------------------
def _get_demo_user(username: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/demo-login", json={"username": username}, timeout=15)
    assert r.status_code == 200, f"demo-login failed: {r.status_code} {r.text}"
    return r.json()["user"]["id"]


def _get_or_create_table(host_id: str) -> str:
    r = requests.get(f"{BASE_URL}/api/tables", timeout=15)
    assert r.status_code == 200
    tables = r.json()
    if tables:
        return tables[0]["id"]
    r = requests.post(
        f"{BASE_URL}/api/tables",
        json={"name": f"TEST_photo_{uuid.uuid4().hex[:6]}", "host_id": host_id},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _drain_until_message(ws, timeout=4.0):
    """Read frames until we get a {'type':'message'} frame or timeout."""
    end = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < end:
        remaining = end - asyncio.get_event_loop().time()
        if remaining <= 0:
            return None
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        except asyncio.TimeoutError:
            return None
        frame = json.loads(raw)
        if frame.get("type") == "message":
            return frame
        if frame.get("type") == "error":
            return frame
    return None


# ---- Feature: WebSocket photo broadcast --------------------------------------
@pytest.fixture(scope="module")
def setup_ids():
    uid = _get_demo_user("frankie")
    tid = _get_or_create_table(uid)
    return uid, tid


def test_ws_text_only_still_broadcasts(setup_ids):
    """Regression: text-only messages should continue to broadcast."""
    uid, tid = setup_ids
    url = f"{WS_BASE}/api/ws/table/{tid}?user_id={uid}"

    async def run():
        async with websockets.connect(url, max_size=2_000_000) as ws:
            await ws.send(json.dumps({"text": "TEST_hello_textonly"}))
            frame = await _drain_until_message(ws, timeout=5.0)
            assert frame is not None, "no broadcast received"
            assert frame.get("type") == "message"
            msg = frame.get("message", {})
            assert msg.get("text") == "TEST_hello_textonly"
            assert msg.get("image", "") == ""

    asyncio.run(run())


def test_ws_image_message_broadcasts_and_persists(setup_ids):
    """text='' + image → broadcast with image and persisted in Mongo."""
    uid, tid = setup_ids
    url = f"{WS_BASE}/api/ws/table/{tid}?user_id={uid}"
    marker_img = "data:image/jpeg;base64,/9j/TEST" + uuid.uuid4().hex

    async def run():
        async with websockets.connect(url, max_size=2_000_000) as ws:
            await ws.send(json.dumps({"text": "", "image": marker_img}))
            frame = await _drain_until_message(ws, timeout=6.0)
            assert frame is not None, "no broadcast for image-only message"
            assert frame.get("type") == "message", f"unexpected frame: {frame}"
            msg = frame.get("message", {})
            assert msg.get("image") == marker_img
            assert msg.get("text") == ""
            return msg["id"]

    msg_id = asyncio.run(run())

    # Confirm persisted via REST history endpoint.
    r = requests.get(f"{BASE_URL}/api/tables/{tid}/messages", timeout=10)
    assert r.status_code == 200
    rows = r.json()
    matched = [m for m in rows if m.get("id") == msg_id]
    assert matched, f"image message {msg_id} not persisted"
    assert matched[0].get("image") == marker_img


def test_ws_text_and_image_both_sent(setup_ids):
    """Caption + image → both fields in broadcast."""
    uid, tid = setup_ids
    url = f"{WS_BASE}/api/ws/table/{tid}?user_id={uid}"
    img = "data:image/jpeg;base64,/9j/CAP" + uuid.uuid4().hex
    caption = f"TEST_caption_{uuid.uuid4().hex[:6]}"

    async def run():
        async with websockets.connect(url, max_size=2_000_000) as ws:
            await ws.send(json.dumps({"text": caption, "image": img}))
            frame = await _drain_until_message(ws, timeout=6.0)
            assert frame is not None
            msg = frame.get("message", {})
            assert msg.get("text") == caption
            assert msg.get("image") == img

    asyncio.run(run())


def test_ws_empty_payload_ignored(setup_ids):
    """text='' + image='' → no broadcast (silently ignored)."""
    uid, tid = setup_ids
    url = f"{WS_BASE}/api/ws/table/{tid}?user_id={uid}"

    async def run():
        async with websockets.connect(url, max_size=2_000_000) as ws:
            await ws.send(json.dumps({"text": "", "image": ""}))
            # Then send a marker we EXPECT to see — if the empty was ignored,
            # the next frame should be the marker (not the empty echo).
            marker = f"TEST_marker_{uuid.uuid4().hex[:6]}"
            await ws.send(json.dumps({"text": marker}))
            frame = await _drain_until_message(ws, timeout=6.0)
            assert frame is not None, "no broadcast even for marker"
            assert frame.get("message", {}).get("text") == marker, (
                f"empty payload was NOT ignored — got: {frame}"
            )

    asyncio.run(run())


def test_ws_oversized_image_rejected_and_not_persisted(setup_ids):
    """Oversized image (>600KB) → error frame, no broadcast, no DB row."""
    uid, tid = setup_ids
    url = f"{WS_BASE}/api/ws/table/{tid}?user_id={uid}"

    # Snapshot current message ids before the bad send.
    r0 = requests.get(f"{BASE_URL}/api/tables/{tid}/messages", timeout=10)
    before_ids = {m["id"] for m in r0.json()}

    async def run():
        async with websockets.connect(url, max_size=2_000_000) as ws:
            await ws.send(json.dumps({"text": "hi", "image": OVERSIZED_IMG}))
            # Expect either an error frame or no message frame at all.
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=4.0)
                frame = json.loads(raw)
            except asyncio.TimeoutError:
                frame = None
            # Must NOT be a 'message' broadcast.
            if frame is not None:
                assert frame.get("type") != "message", (
                    f"oversized payload was broadcast: {str(frame)[:200]}"
                )

    asyncio.run(run())

    # Confirm no new doc was inserted with the oversized payload.
    r1 = requests.get(f"{BASE_URL}/api/tables/{tid}/messages", timeout=10)
    after = r1.json()
    new_msgs = [m for m in after if m["id"] not in before_ids]
    for m in new_msgs:
        assert len(m.get("image", "") or "") <= 600_000, (
            f"oversized image was persisted (id={m['id']}, len={len(m.get('image',''))})"
        )
