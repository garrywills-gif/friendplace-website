"""Iter-60 verification: internal rename FriendPlace -> FriendPlace.

Focused checks (no logic changes upstream — this is a naming sweep):
  * GET /api/ returns {"app":"FriendPlace","status":"ok"}
  * GET /api/health still returns 200 with db up
  * Apple SIWA config now uses au.com.friendplace.app bundle IDs
  * Milestone messages contain "FriendPlace" (not "FriendPlace")
  * No `youbelong` string in /app/backend/*.py (top-level) or /app/frontend/{app,src}
    or /app/frontend/app.json.
"""
import os
import re
import subprocess
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
           os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")


# ---------------- Root health ----------------

def test_root_returns_friendplace_brand():
    r = requests.get(f"{BASE_URL}/api/", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("app") == "FriendPlace", data
    assert data.get("status") == "ok", data


def test_api_health_endpoint():
    r = requests.get(f"{BASE_URL}/api/health", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("status") == "ok"
    assert data.get("db") == "up"


# ---------------- Apple SIWA bundle IDs ----------------

def test_apple_env_uses_friendplace_bundle():
    # Backend env values loaded into server.py
    from importlib import import_module
    server = import_module("server")
    # There are 3+ places that reference APPLE_CLIENT_ID_IOS. Check the
    # exported constant is the friendplace bundle.
    ios_bundle = os.environ.get("APPLE_CLIENT_ID_IOS") or getattr(
        server, "APPLE_CLIENT_ID_IOS", None
    )
    assert ios_bundle == "au.com.friendplace.app", f"unexpected: {ios_bundle}"


# ---------------- Milestone copy ----------------

def test_milestones_reference_friendplace_not_youbelong():
    from milestones import MILESTONES
    joined = " | ".join(m.get("message", "") for m in MILESTONES)
    assert "FriendPlace" not in joined, f"FriendPlace leaked in milestones: {joined}"
    # At least one message references FriendPlace
    assert "FriendPlace" in joined


def test_milestones_new_member_welcome_wording():
    from milestones import MILESTONES
    new = next(m for m in MILESTONES if m["key"] == "new_member")
    assert "FriendPlace" in new["message"]
    assert "FriendPlace" not in new["message"]


# ---------------- Source-tree audit ----------------

def _grep(root: Path, pattern: str, extra_args=None) -> list[str]:
    extra_args = extra_args or []
    if not root.exists():
        return []
    cmd = [
        "grep",
        "-rin",
        "--exclude-dir=__pycache__",
        "--exclude-dir=.metro-cache",
        "--exclude-dir=node_modules",
        *extra_args,
        pattern,
        str(root),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return [ln for ln in result.stdout.splitlines() if ln.strip()]


def test_no_youbelong_in_backend_toplevel_py():
    backend = Path("/app/backend")
    hits = []
    for py in backend.glob("*.py"):
        content = py.read_text(errors="ignore")
        for i, line in enumerate(content.splitlines(), 1):
            if re.search(r"youbelong", line, re.IGNORECASE):
                hits.append(f"{py}:{i}: {line.strip()}")
    assert not hits, "FriendPlace found in backend top-level:\n" + "\n".join(hits)


def test_no_youbelong_in_frontend_app_and_src():
    hits = _grep(Path("/app/frontend/app"), "youbelong")
    hits += _grep(Path("/app/frontend/src"), "youbelong")
    assert not hits, "FriendPlace leftover in frontend/app or frontend/src:\n" + \
        "\n".join(hits)


def test_no_youbelong_in_frontend_app_json():
    p = Path("/app/frontend/app.json")
    assert p.exists()
    text = p.read_text()
    assert "youbelong" not in text.lower(), text


def test_frontend_app_json_has_friendplace_identifiers():
    import json as _json
    cfg = _json.loads(Path("/app/frontend/app.json").read_text())
    expo = cfg.get("expo", {})
    assert expo.get("slug") == "friendplace"
    assert expo.get("scheme") == "friendplace"
    ios = expo.get("ios", {})
    android = expo.get("android", {})
    assert ios.get("bundleIdentifier") == "au.com.friendplace.app"
    assert android.get("package") == "au.com.friendplace.app"
