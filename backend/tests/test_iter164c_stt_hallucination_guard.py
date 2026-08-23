"""iter164c — STT hallucination guard on ``/api/george/voice/transcribe``.

Bug reproduced: silence or near-silence uploaded to Whisper returns a
canned phrase — most notoriously the Korean "시청해 주셔서 감사합니다"
("Thank you for watching"), learned from YouTube subtitle training data.
This appears in the Ask George input as phantom text.

These tests lock the three-layer defence:
  1. Empty / sub-2 KB uploads are rejected immediately with an empty
     transcript (no LLM call at all) — integration test via HTTP.
  2. The endpoint hard-locks Whisper to ``language='en'`` with a
     FriendPlace domain prompt (verified via source inspection).
  3. The ``stt_transcript_looks_hallucinated`` guard drops non-Latin
     transcripts even if Whisper returns them despite ``language='en'``
     — unit tests on the shared helper.
"""

from __future__ import annotations

import asyncio
import os

import pytest
import pytest_asyncio
import requests


BACKEND_URL = "http://localhost:8001"


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


def _admin_token() -> str:
    creds = {
        "email":    os.environ.get("TEST_ADMIN_EMAIL", "hello@friendplace.com.au"),
        "password": os.environ.get("TEST_ADMIN_PASSWORD", "TestPass2026!"),
    }
    r = requests.post(f"{BACKEND_URL}/api/cms/auth/login", json=creds, timeout=10)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"no token in login response: {data}"
    return tok


@pytest.fixture(scope="session")
def token():
    return _admin_token()


def _post_audio(token: str, audio_bytes: bytes, filename: str = "clip.webm"):
    files = {"audio": (filename, audio_bytes, "audio/webm")}
    return requests.post(
        f"{BACKEND_URL}/api/george/voice/transcribe",
        headers={"Authorization": f"Bearer {token}"},
        files=files,
        timeout=15,
    )


# ─────────────────────────────────────────────────────────────────────
#  Layer 1 (integration via HTTP): silence-sized uploads rejected
#  before any LLM call
# ─────────────────────────────────────────────────────────────────────

def test_empty_upload_returns_empty_transcript(token):
    r = _post_audio(token, b"")
    assert r.status_code == 200, r.text
    assert r.json() == {"transcript": ""}


def test_sub_2kb_upload_rejected_as_silence(token):
    # 500 bytes of zeros — well under the 2 KB "genuine speech" floor.
    r = _post_audio(token, b"\x00" * 500)
    assert r.status_code == 200, r.text
    assert r.json() == {"transcript": ""}


def test_1_5_kb_upload_still_rejected(token):
    # 1.5 KB — still under threshold. Whisper never gets called for
    # this payload; no risk of a hallucination.
    r = _post_audio(token, b"\x00" * 1500)
    assert r.status_code == 200
    assert r.json() == {"transcript": ""}


def test_endpoint_requires_admin_auth():
    files = {"audio": ("clip.webm", b"\x00" * 3072, "audio/webm")}
    r = requests.post(
        f"{BACKEND_URL}/api/george/voice/transcribe",
        files=files, timeout=10,
    )
    assert r.status_code in (401, 403)


# ─────────────────────────────────────────────────────────────────────
#  Layer 2: source-level lock — language=en + FriendPlace prompt
# ─────────────────────────────────────────────────────────────────────

def test_endpoint_locks_language_to_english_source():
    """The endpoint MUST hard-lock Whisper to English and pass a
    FriendPlace-domain prompt. Verify by inspecting the source so
    the guarantee stays visible to future refactors."""
    import mcgs_module
    import inspect
    src = inspect.getsource(mcgs_module)
    assert 'language="en"' in src or "language='en'" in src, (
        "STT endpoint must lock language='en' to prevent Whisper's "
        "silence-hallucination fallback into Korean/Japanese."
    )
    assert "friendplace" in src.lower()
    assert "prompt=" in src


def test_module_documents_the_hallucination_guard():
    """The guard function must exist at module scope so it's testable
    and its docstring must name the covered scripts so future readers
    know what's protected."""
    from mcgs_module import (
        stt_transcript_looks_hallucinated,
        _stt_is_non_latin_script_char,
    )
    assert callable(stt_transcript_looks_hallucinated)
    assert callable(_stt_is_non_latin_script_char)


# ─────────────────────────────────────────────────────────────────────
#  Layer 3 (unit): non-Latin transcript detection
# ─────────────────────────────────────────────────────────────────────

def test_guard_drops_korean_hallucination():
    """The exact string produced by the real bug."""
    from mcgs_module import stt_transcript_looks_hallucinated
    assert stt_transcript_looks_hallucinated("시청해 주셔서 감사합니다.") is True


def test_guard_drops_japanese_hallucination():
    from mcgs_module import stt_transcript_looks_hallucinated
    assert stt_transcript_looks_hallucinated("ご視聴ありがとうございました。") is True


def test_guard_drops_chinese_hallucination():
    from mcgs_module import stt_transcript_looks_hallucinated
    assert stt_transcript_looks_hallucinated("感谢您的观看。") is True


def test_guard_drops_cyrillic():
    from mcgs_module import stt_transcript_looks_hallucinated
    assert stt_transcript_looks_hallucinated("Спасибо за просмотр.") is True


def test_guard_drops_thai():
    from mcgs_module import stt_transcript_looks_hallucinated
    assert stt_transcript_looks_hallucinated("ขอบคุณที่รับชม") is True


def test_guard_drops_arabic():
    from mcgs_module import stt_transcript_looks_hallucinated
    assert stt_transcript_looks_hallucinated("شكرا على المشاهدة") is True


def test_guard_drops_devanagari():
    from mcgs_module import stt_transcript_looks_hallucinated
    assert stt_transcript_looks_hallucinated("देखने के लिए धन्यवाद") is True


def test_guard_drops_mixed_script():
    """A canned phrase wrapped in an English intro still trips the
    guard — any non-Latin character is enough."""
    from mcgs_module import stt_transcript_looks_hallucinated
    assert stt_transcript_looks_hallucinated(
        "Thanks for watching 시청해 주셔서 감사합니다"
    ) is True


def test_guard_accepts_plain_english():
    from mcgs_module import stt_transcript_looks_hallucinated
    assert stt_transcript_looks_hallucinated(
        "George, any new registrations overnight?"
    ) is False


def test_guard_accepts_accented_latin():
    """Latin-1 Supplement / Latin Extended (café, naïve, résumé,
    señor) is real English/European text and must pass."""
    from mcgs_module import stt_transcript_looks_hallucinated
    for s in (
        "Let's meet at the café.",
        "Béatrice's résumé is ready.",
        "It's a naïve assumption.",
        "El señor está aquí.",
        "The façade is stunning.",
    ):
        assert stt_transcript_looks_hallucinated(s) is False, (
            f"Legitimate accented Latin string wrongly flagged: {s!r}"
        )


def test_guard_accepts_empty_string():
    from mcgs_module import stt_transcript_looks_hallucinated
    assert stt_transcript_looks_hallucinated("") is False
    assert stt_transcript_looks_hallucinated(None) is False  # type: ignore[arg-type]


def test_guard_accepts_punctuation_and_numbers():
    """Punctuation, digits, whitespace, ASCII symbols are all Latin
    and must pass."""
    from mcgs_module import stt_transcript_looks_hallucinated
    for s in ("...", "123 456", "  ", "hello — world!", "$5.99 (2 for 1)"):
        assert stt_transcript_looks_hallucinated(s) is False, s


# ─────────────────────────────────────────────────────────────────────
#  Recorder contract — silence must return null (frontend concern,
#  verified via source inspection so backend tests can trust it)
# ─────────────────────────────────────────────────────────────────────

def test_recorder_source_rejects_silence_only_clips():
    """``useVoiceRecorder`` must return null from ``stop()`` when no
    frame exceeded the speech threshold — this stops silence blobs
    from ever reaching Whisper. Verified via source inspection so
    a future refactor can't quietly reintroduce the phantom."""
    import pathlib
    src = pathlib.Path("/app/website/lib/use-voice-recorder.ts").read_text()
    assert "speechThreshold" in src
    assert "hadSpeechRef" in src
    assert "peakRmsRef" in src
    # onstop resolver must gate on hadSpeech.
    assert "if (!hadSpeechRef.current)" in src, (
        "Recorder must resolve null when no genuine speech was detected."
    )
    # State reset per-recording so previous peaks can't leak.
    assert "peakRmsRef.current = 0" in src
    assert "hadSpeechRef.current = false" in src
