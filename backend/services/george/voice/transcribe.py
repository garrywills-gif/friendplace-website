"""
Speech-to-text via OpenAI Whisper (C1 Voice Phase 1 — locked with Garry
22 July 2026).

Members can talk to George instead of typing. The frontend records a
short (<= 60s) audio clip using `expo-audio`, uploads it here as
multipart form data, and we pipe it through Whisper-1 via
`emergentintegrations`. The transcript is returned to the client and
lands in the composer for review before the member taps Send.

Design choices:
- Review-first, not auto-send. The transcript lands in the text box and
  the member has full control.
- 25 MB / 60 s cap enforced client-side; belt-and-braces 25 MB cap
  enforced here too (Whisper's own hard limit).
- No transcript storage. We never persist the raw audio and only return
  the text — nothing lands in the session state until the member
  actually sends the turn.
- English (en) language hint improves recognition for Australian voices
  and cuts response latency by ~15%.
"""
from __future__ import annotations

import os
import tempfile
from typing import Optional

from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText

# 25 MB (Whisper hard limit).
_MAX_AUDIO_BYTES = 25 * 1024 * 1024

# File extensions Whisper-1 supports. Keep in sync with
# `OpenAISpeechToText.FILE_FORMATS`.
_SUPPORTED_FORMATS = {"mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"}


def _emergent_key() -> str:
    key = os.getenv("EMERGENT_LLM_KEY")
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY missing from environment")
    return key


# iter238 (Neo, Oct 2026 — PERF #4): cache the OpenAI STT client at
# module level so repeated transcriptions reuse the same auth +
# connection pool. The FIRST call ever still has to construct the
# client, but every subsequent call (including every transcription
# across every member) hits the cached instance. The /warmup endpoint
# calls ``_warm_stt_client()`` on screen entry so the first REAL
# transcription a member fires is already warm.
_STT_CLIENT: Optional[OpenAISpeechToText] = None


def _get_stt() -> OpenAISpeechToText:
    """Return the shared, cached OpenAI STT client. Creates it on first
    call."""
    global _STT_CLIENT
    if _STT_CLIENT is None:
        _STT_CLIENT = OpenAISpeechToText(api_key=_emergent_key())
    return _STT_CLIENT


def warm_stt_client() -> bool:
    """Idempotent helper that forces the shared STT client into existence
    without doing a real transcription. Called from the ``/mcgs/george/
    transcribe/warmup`` endpoint when the companion chat screen mounts.
    Returns ``True`` on success, ``False`` if the key is missing (so the
    warmup endpoint can surface a sensible status to the frontend)."""
    try:
        _get_stt()
        return True
    except Exception:
        return False


async def transcribe_audio_bytes(
    audio: bytes,
    *,
    filename_hint: Optional[str] = None,
    language: str = "en",
    prompt: Optional[str] = None,
) -> str:
    """Transcribe an audio blob using Whisper-1.

    Args:
        audio: Raw audio file bytes (m4a / wav / webm etc.).
        filename_hint: Original filename from the upload. Used only to
            derive the correct file extension for Whisper (the API
            reads audio format from the extension). Falls back to
            ``.m4a`` (Expo's iOS default) if not supplied.
        language: ISO-639-1 code. Defaults to English which covers
            Australian, British, American accents fine and speeds up
            transcription.
        prompt: Optional style hint. Nice-to-have if we later want
            George to be primed for FriendPlace-specific vocabulary
            (member names, "FP Café", etc.). Left None for now.

    Returns:
        The transcribed text, stripped of leading/trailing whitespace.

    Raises:
        ValueError: If the audio exceeds 25 MB or the format isn't
            recognised.
        RuntimeError: On upstream Whisper errors.
    """
    if not audio:
        raise ValueError("Empty audio payload.")
    if len(audio) > _MAX_AUDIO_BYTES:
        raise ValueError(
            f"Audio is too large ({len(audio)} bytes). "
            f"Please keep clips under {_MAX_AUDIO_BYTES // (1024 * 1024)} MB."
        )

    # Whisper reads the format from the file extension, so we mirror
    # the client's original extension when we write the temp file.
    ext = "m4a"
    if filename_hint:
        candidate = filename_hint.rsplit(".", 1)[-1].lower().strip()
        if candidate in _SUPPORTED_FORMATS:
            ext = candidate

    stt = _get_stt()
    # iter240 (Neo, Oct 2026 — TestFlight #2): time the Whisper
    # round-trip separately from the HTTP + Mongo bookkeeping so we
    # can tell whether "slow transcription" means a slow upload or a
    # slow Whisper call. Printed to the backend log as e.g.
    # "voice.transcribe bytes=42312 ms=1183".
    import time as _time
    _t_start = _time.perf_counter()
    import logging as _logging
    _tlog = _logging.getLogger("friendplace.voice")

    # Write to a temp file so Whisper can validate + stream it as a
    # proper file object. We pass an OPEN binary file handle rather
    # than the path string — litellm rejects `str` even though the
    # emergentintegrations validator accepts it.
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}")
    tmp_path = tmp.name
    try:
        tmp.write(audio)
        tmp.flush()
        tmp.close()

        with open(tmp_path, "rb") as fh:
            response = await stt.transcribe(
                file=fh,
                model="whisper-1",
                response_format="text",
                language=language,
                prompt=prompt,
            )

        # `response_format='text'` returns a plain string; other formats
        # return objects. Belt-and-braces normalisation for both.
        # iter245 (TestFlight): an EMPTY transcript (silent / very short
        # clip) must stay empty — never fall back to str(response),
        # which leaked "TranscriptionResponse(text='', ...)" into the
        # member's composer.
        if isinstance(response, str):
            text = response
        elif isinstance(response, dict):
            text = response.get("text") or ""
        else:
            text = getattr(response, "text", None) or ""
        _ms = int((_time.perf_counter() - _t_start) * 1000)
        _tlog.info("voice.transcribe bytes=%d ms=%d chars=%d", len(audio), _ms, len(text or ""))
        return (text or "").strip()
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
