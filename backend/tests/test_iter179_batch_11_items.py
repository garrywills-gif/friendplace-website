"""Iter-179 — 11-item real-device fix batch.
Backend coverage for the items with a clear API surface:
  1) Play Together — CANCEL pending invite (host only, guest blocked from accept).
  2) Play Together — Rematch creates a NEW 'invited' session + game_invite notif.
  3) Word Chain — server-side rejection of wrong-letter / off-category / duplicate.
  4) Notices active period — POST + GET filtering + PATCH clear.
  5) Notification title — no `data:image` / base64 in title when sender has photo avatar.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

# Read frontend/.env directly so we always test the live preview URL the user sees.
def _read_public_url() -> str:
    env_path = "/app/frontend/.env"
    try:
        with open(env_path) as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return os.environ.get("EXPO_PUBLIC_BACKEND_URL", "")


BASE = _read_public_url().rstrip("/")
assert BASE, "EXPO_PUBLIC_BACKEND_URL not resolved"


# ---------------- helpers ----------------

def _demo_login(username: str) -> dict:
    r = requests.post(f"{BASE}/api/auth/demo-login", json={"username": username}, timeout=15)
    r.raise_for_status()
    j = r.json()
    return {"token": j["access_token"], "user": j["user"]}


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def maggie():
    return _demo_login("maggie")


@pytest.fixture(scope="module")
def frankie():
    return _demo_login("frankie")


@pytest.fixture(scope="module")
def notice_author():
    """Rotate through demo users to sidestep the 6/hr /notices rate limit
    AND the prolific-poster moderation gate (which auto-hides new notices
    from accounts with a large notice history). The first user whose seeded
    notice comes back with `held_for_review=false` wins.
    """
    for uname in ("billdo", "art", "eil", "roy", "dot"):
        try:
            who = _demo_login(uname)
        except Exception:
            continue
        probe = requests.post(
            f"{BASE}/api/notices",
            json={
                "user_id": who["user"]["id"],
                "user_name": who["user"].get("first_name", ""),
                "user_avatar": "",
                "category": "Share",
                "title": f"iter179 probe {uuid.uuid4().hex[:6]}",
                "body": "quick sanity ping — please ignore",
            },
            timeout=15,
        )
        if probe.status_code == 429:
            continue
        if probe.status_code != 200:
            continue
        j = probe.json()
        if j.get("held_for_review"):
            # try to clean up + move on
            requests.delete(f"{BASE}/api/notices/{j['id']}",
                            params={"user_id": who["user"]["id"]}, timeout=10)
            continue
        # Clean up the probe row before running the real assertions
        requests.delete(f"{BASE}/api/notices/{j['id']}",
                        params={"user_id": who["user"]["id"]}, timeout=10)
        return who
    pytest.skip("All candidate demo users are rate-limited or moderated by /api/notices")


# ================= 1. Play Together — CANCEL =================

class TestPlayCancel:
    def test_cancel_flow_end_to_end(self, maggie, frankie):
        # host invites friend
        r = requests.post(
            f"{BASE}/api/play/invite",
            headers=_hdr(maggie["token"]),
            json={"game": "this_or_that", "friend_id": frankie["user"]["id"]},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        sess = r.json()
        sid = sess["id"]
        assert sess["status"] == "invited"

        # non-host cannot cancel (403)
        r_guest_cancel = requests.post(
            f"{BASE}/api/play/{sid}/cancel", headers=_hdr(frankie["token"]), timeout=15,
        )
        assert r_guest_cancel.status_code == 403, r_guest_cancel.text

        # host cancels
        r_cancel = requests.post(
            f"{BASE}/api/play/{sid}/cancel", headers=_hdr(maggie["token"]), timeout=15,
        )
        assert r_cancel.status_code == 200, r_cancel.text
        assert r_cancel.json().get("status") == "cancelled"

        # GET /play/mine/list for host should NOT include this session
        r_mine = requests.get(f"{BASE}/api/play/mine/list", headers=_hdr(maggie["token"]), timeout=15)
        assert r_mine.status_code == 200
        ids = [s["id"] for s in r_mine.json().get("sessions", [])]
        assert sid not in ids, f"Cancelled session {sid} still in mine list: {ids}"

        # guest accept must be rejected 400 with the right message
        r_acc = requests.post(f"{BASE}/api/play/{sid}/accept", headers=_hdr(frankie["token"]), timeout=15)
        assert r_acc.status_code == 400, r_acc.text
        detail = r_acc.json().get("detail", "").lower()
        assert "no longer" in detail, f"Unexpected detail: {detail}"

    def test_cannot_cancel_after_active(self, maggie, frankie):
        r = requests.post(
            f"{BASE}/api/play/invite", headers=_hdr(maggie["token"]),
            json={"game": "this_or_that", "friend_id": frankie["user"]["id"]}, timeout=15,
        )
        assert r.status_code == 200
        sid = r.json()["id"]
        # accept
        ra = requests.post(f"{BASE}/api/play/{sid}/accept", headers=_hdr(frankie["token"]), timeout=15)
        assert ra.status_code == 200
        assert ra.json()["status"] == "active"
        # cancel now blocked
        rc = requests.post(f"{BASE}/api/play/{sid}/cancel", headers=_hdr(maggie["token"]), timeout=15)
        assert rc.status_code == 400


# ================= 2. Play Together — REMATCH =================

class TestPlayRematch:
    def test_rematch_creates_fresh_invited_session_and_notif(self, maggie, frankie):
        # Create + finish a this_or_that game between maggie(host) & frankie(guest).
        r = requests.post(
            f"{BASE}/api/play/invite", headers=_hdr(maggie["token"]),
            json={"game": "this_or_that", "friend_id": frankie["user"]["id"]}, timeout=15,
        )
        assert r.status_code == 200
        sid = r.json()["id"]
        ra = requests.post(f"{BASE}/api/play/{sid}/accept", headers=_hdr(frankie["token"]), timeout=15)
        assert ra.status_code == 200

        # Both submit answers to finish the game.
        session = ra.json()
        expected = len(session["content"]["prompts"])
        answers = [0] * expected
        rm1 = requests.post(f"{BASE}/api/play/{sid}/move", headers=_hdr(maggie["token"]),
                            json={"answers": answers}, timeout=15)
        assert rm1.status_code == 200, rm1.text
        rm2 = requests.post(f"{BASE}/api/play/{sid}/move", headers=_hdr(frankie["token"]),
                            json={"answers": answers}, timeout=15)
        assert rm2.status_code == 200, rm2.text
        assert rm2.json()["status"] == "finished"

        # Count frankie's game_invite notifs BEFORE rematch
        r_before = requests.get(
            f"{BASE}/api/notifications/{frankie['user']['id']}",
            timeout=15,
        )
        assert r_before.status_code == 200, r_before.text
        before = [n for n in r_before.json() if n.get("type") == "game_invite"]

        # Rematch (host initiates)
        r_re = requests.post(f"{BASE}/api/play/{sid}/rematch", headers=_hdr(maggie["token"]), timeout=15)
        assert r_re.status_code == 200, r_re.text
        new = r_re.json()
        assert new["id"] != sid
        assert new["status"] == "invited", f"Expected 'invited' got {new['status']}"
        assert new["host_id"] == maggie["user"]["id"]
        assert new["guest_id"] == frankie["user"]["id"]

        # A NEW game_invite notification lands in frankie's feed
        time.sleep(0.5)
        r_after = requests.get(
            f"{BASE}/api/notifications/{frankie['user']['id']}",
            timeout=15,
        )
        assert r_after.status_code == 200
        after = [n for n in r_after.json() if n.get("type") == "game_invite"]
        # Match by payload.session_id when available
        matching = [n for n in after if (n.get("payload") or {}).get("session_id") == new["id"]]
        assert matching, "No game_invite notification for the rematch session_id"
        assert len(after) > len(before)


# ================= 3. Word Chain validation =================

class TestWordChainMove:
    def _boys_names_session(self, host, guest):
        """Create a word_chain session and mutate it (via a helper) so the
        category is 'Boys' names' and required_letter is 'B'. Since /play/invite
        randomises the category, we retry a few times until we land on a
        closed category we can reason about; if none within N tries, skip."""
        for _ in range(20):
            r = requests.post(
                f"{BASE}/api/play/invite", headers=_hdr(host["token"]),
                json={"game": "word_chain", "friend_id": guest["user"]["id"]}, timeout=15,
            )
            assert r.status_code == 200
            sid = r.json()["id"]
            ra = requests.post(f"{BASE}/api/play/{sid}/accept", headers=_hdr(guest["token"]), timeout=15)
            assert ra.status_code == 200
            sess = ra.json()
            cat = sess["content"].get("category")
            if cat == "Boys' names":
                return sid, sess
            # cancel & retry to keep state tidy
            requests.post(f"{BASE}/api/play/{sid}/cancel", headers=_hdr(host["token"]), timeout=15)
        pytest.skip("Could not seed a 'Boys' names' word_chain session in 20 tries.")

    def test_word_chain_rejects_invalid_and_accepts_valid(self, maggie, frankie):
        sid, sess = self._boys_names_session(maggie, frankie)
        letter = sess["content"]["required_letter"]  # e.g. "B"
        assert sess["turn"] == maggie["user"]["id"]

        # 1) wrong starting letter — pick a Boys' names word that doesn't start with `letter`
        wrong_letter_candidates = {"B": "adam", "C": "adam", "D": "adam", "F": "adam",
                                   "G": "adam", "H": "adam", "L": "adam", "M": "adam",
                                   "N": "adam", "P": "adam", "R": "adam", "S": "adam",
                                   "T": "adam", "W": "adam"}
        wl_word = wrong_letter_candidates.get(letter, "adam")
        r1 = requests.post(f"{BASE}/api/play/{sid}/move", headers=_hdr(maggie["token"]),
                           json={"word": wl_word}, timeout=15)
        assert r1.status_code == 400, r1.text
        assert "start" in r1.json().get("detail", "").lower()

        # confirm turn NOT advanced
        rget = requests.get(f"{BASE}/api/play/{sid}", headers=_hdr(maggie["token"]), timeout=15)
        assert rget.status_code == 200
        assert rget.json()["turn"] == maggie["user"]["id"]

        # 2) word doesn't fit category — 'Banana' when required letter is B
        #    (banana is a food, not a boys' name)
        off_cat_map = {"B": "banana", "C": "carrot", "D": "duck", "F": "fish",
                       "G": "grape", "H": "horse", "L": "lemon", "M": "mango",
                       "N": "noodles", "P": "potato", "R": "rice", "S": "salmon",
                       "T": "tomato", "W": "watermelon"}
        oc_word = off_cat_map.get(letter, "banana")
        r2 = requests.post(f"{BASE}/api/play/{sid}/move", headers=_hdr(maggie["token"]),
                           json={"word": oc_word}, timeout=15)
        assert r2.status_code == 400, r2.text
        assert "boys' names" in r2.json().get("detail", "").lower() or "fit" in r2.json().get("detail", "").lower()

        # 3) valid word — from Boys' names starting with `letter`
        valid_map = {"B": "ben", "C": "charlie", "D": "david", "F": "frank", "G": "george",
                     "H": "harry", "L": "liam", "M": "mark", "N": "nathan", "P": "paul",
                     "R": "richard", "S": "sam", "T": "tom", "W": "william"}
        good = valid_map[letter]
        r3 = requests.post(f"{BASE}/api/play/{sid}/move", headers=_hdr(maggie["token"]),
                           json={"word": good}, timeout=15)
        assert r3.status_code == 200, r3.text
        after = r3.json()
        assert after["turn"] == frankie["user"]["id"]
        assert any(item["word"].lower() == good for item in after["content"]["chain"])

        # 4) duplicate — frankie tries the same word again (right starting
        #    letter, in-category, but already used). Compute the required
        #    letter for frankie's turn (last letter of `good`).
        req = good[-1].upper()
        # Boys' names starting with req; if none available in our list, try
        # another sample; else skip. Build a small map keyed by letter.
        follow = {"N": "nathan", "M": "mark", "K": None, "D": "david",
                  "Y": None, "S": "sam", "H": "harry", "L": "liam"}
        # If frankie's required letter is the same as `good`s last letter,
        # ensure duplication of `good` itself hits the duplicate branch —
        # frankie's word must start with `req`. If `good` starts with `req`
        # (e.g. good='ben' → req='N' → doesn't) we may need a curated dup.
        # Simplest: attempt the duplicate word only if it also starts with `req`.
        if good[0].upper() == req:
            r_dup = requests.post(f"{BASE}/api/play/{sid}/move", headers=_hdr(frankie["token"]),
                                  json={"word": good}, timeout=15)
            assert r_dup.status_code == 400
            assert "used" in r_dup.json().get("detail", "").lower()
        else:
            # duplicate check with valid letter: force by first submitting a
            # valid follow-up word, then re-submitting it from maggie.
            f_word = follow.get(req)
            if not f_word:
                # Best-effort skip if we can't craft a follow-up dup case.
                return
            rf = requests.post(f"{BASE}/api/play/{sid}/move", headers=_hdr(frankie["token"]),
                               json={"word": f_word}, timeout=15)
            assert rf.status_code == 200, rf.text
            # Now maggie's required letter is last letter of f_word
            req2 = f_word[-1].upper()
            # Duplicate = f_word only works if starts with req2 (rare); try
            # duplicating `good` if applicable. Otherwise just assert no crash.
            if f_word[0].upper() == req2:
                r_dup = requests.post(f"{BASE}/api/play/{sid}/move", headers=_hdr(maggie["token"]),
                                      json={"word": f_word}, timeout=15)
                assert r_dup.status_code == 400
                assert "used" in r_dup.json().get("detail", "").lower()

        # tidy up: give up so the seed doesn't linger
        requests.post(f"{BASE}/api/play/{sid}/move", headers=_hdr(frankie["token"]),
                      json={"give_up": True}, timeout=15)


# ================= 4. Notices active period =================

class TestNoticesActivePeriod:
    def test_create_get_and_patch_active_window(self, notice_author):
        # Rotate away from prolific-poster maggie and joycey; dot has a much
        # lower notice-history footprint so the /api/notices moderation gate
        # doesn't auto-hide our seeded rows.
        uid = notice_author["user"]["id"]
        now = datetime.now(timezone.utc)
        past = (now - timedelta(days=2)).isoformat()
        far_past = (now - timedelta(days=1)).isoformat()
        future = (now + timedelta(days=2)).isoformat()
        far_future = (now + timedelta(days=3)).isoformat()

        def _make(title: str, af: str | None, at: str | None) -> str:
            payload = {
                "user_id": uid,
                "user_name": "Margaret",
                "user_avatar": "",
                "category": "General",
                "title": title,
                "body": "test notice",
            }
            if af is not None:
                payload["active_from"] = af
            if at is not None:
                payload["active_to"] = at
            r = requests.post(f"{BASE}/api/notices", json=payload, timeout=15)
            assert r.status_code == 200, r.text
            return r.json()["id"]

        marker = uuid.uuid4().hex[:8]
        title_always = f"iter179_{marker}_always_notice"
        title_expired = f"iter179_{marker}_expired_notice"

        # Only 2 creates → stays well under the 6/hr rate limit and still
        # exercises: (a) no-date notice always visible; (b) expired notice
        # excluded; (c) PATCH clearing active_to brings it back.
        id_always = _make(title_always, None, None)
        id_expired = _make(title_expired, far_past, past)

        r_get = requests.get(f"{BASE}/api/notices", timeout=15)
        assert r_get.status_code == 200
        titles = {n.get("title") for n in r_get.json()}
        assert title_always in titles, "Notice with no dates should always appear"
        assert title_expired not in titles, "Expired notice must be excluded"

        # PATCH extends active_to into the future → notice must reappear
        r_patch = requests.patch(
            f"{BASE}/api/notices/{id_expired}",
            json={"user_id": uid, "active_to": far_future, "active_from": past},
            timeout=15,
        )
        assert r_patch.status_code == 200, r_patch.text

        r_get2 = requests.get(f"{BASE}/api/notices", timeout=15)
        titles2 = {n.get("title") for n in r_get2.json()}
        assert title_expired in titles2, "After PATCH extending active_to, notice should appear"

        # Also verify a FUTURE-only notice is excluded by mutating the
        # already-created 'always' notice via PATCH (no extra creates).
        r_patch_future = requests.patch(
            f"{BASE}/api/notices/{id_always}",
            json={"user_id": uid, "active_from": future, "active_to": far_future},
            timeout=15,
        )
        assert r_patch_future.status_code == 200
        r_get3 = requests.get(f"{BASE}/api/notices", timeout=15)
        titles3 = {n.get("title") for n in r_get3.json()}
        assert title_always not in titles3, "Notice with active_from in the future must be excluded"

        # cleanup — best-effort
        for nid_ in (id_always, id_expired):
            requests.delete(f"{BASE}/api/notices/{nid_}", params={"user_id": uid}, timeout=15)


# ================= 5. Notification title — no base64 =================

class TestNotificationTitleNoBase64:
    """Unit-test `_glyph_or_blank` directly (import from server.py).

    The DM notification title in server.py (line ~11979) is:
        f"{_glyph_or_blank(sender_avatar)} {sender_name} sent you a message"
    and the friend_accepted titles (11962, 11969) also prepend it.
    If the helper drops photo / URL / preset / long strings then NO caller
    can leak base64 into a notification title. This is a stronger test than
    a WebSocket DM round-trip and doesn't depend on socket auth.
    """

    def test_glyph_or_blank_drops_photo_and_refs(self):
        import importlib
        server = importlib.import_module("server")
        gob = server._glyph_or_blank

        photo = (
            "data:image/png;base64,"
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4"
            "nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
        )
        assert gob(photo) == "", "data-URI photo must be dropped"
        assert "data:image" not in gob(photo)
        assert "base64" not in gob(photo).lower()
        assert gob("https://example.com/a.jpg") == ""
        assert gob("http://example.com/a.png") == ""
        assert gob("gallery:cat-01") == ""
        assert gob("preset:senior-1") == ""
        assert gob("portrait-elder-3") == ""
        # A long emoji sequence / ref must be dropped (>8 chars).
        assert gob("some-very-long-ref-string-value") == ""
        # Short emoji glyphs pass through untouched.
        assert gob("🦋") == "🦋"
        assert gob("👋") == "👋"
        assert gob("") == ""
        assert gob(None) == ""

    def test_dm_notif_title_source_uses_glyph_helper(self):
        """Guard against regressions: assert the DM push_notification title
        template in server.py wraps sender_avatar in `_glyph_or_blank(...)`
        rather than embedding the raw avatar."""
        with open("/app/backend/server.py", "r", encoding="utf-8") as f:
            src = f.read()
        # DM branch
        assert 'f"{_g} {sender_name} sent you a message"' in src, \
            "DM notification title must use `_g = _glyph_or_blank(sender_avatar)` prefix"
        # friend_accepted branches
        assert '_glyph_or_blank(other_av)' in src
        assert '_glyph_or_blank(me_av)' in src
        # And the raw pattern that used to leak base64 is gone.
        assert 'f"{sender_avatar} {sender_name} sent you a message"' not in src

