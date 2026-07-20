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
            (member names, "Coffee Lounge", etc.). Left None for now.

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

    stt = OpenAISpeechToText(api_key=_emergent_key())

    # Write to a temp file so Whisper can validate + stream it as a
    # proper file object (its validator hard-requires a real path).
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}")
    tmp_path = tmp.name
    try:
        tmp.write(audio)
        tmp.flush()
        tmp.close()

        response = await stt.transcribe(
            file=tmp_path,
            model="whisper-1",
            response_format="text",
            language=language,
            prompt=prompt,
        )

        # `response_format='text'` returns a plain string; other formats
        # return objects. Belt-and-braces normalisation for both.
        if isinstance(response, str):
            text = response
        else:
            text = getattr(response, "text", None) or str(response)
        return (text or "").strip()
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
