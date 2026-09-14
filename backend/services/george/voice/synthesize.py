"""
Text-to-speech via OpenAI TTS (C1 Voice Phase 2 — locked with Garry
22 July 2026).

George can read his replies aloud, opt-in only. The frontend fetches
audio on demand (each George bubble has a small speaker icon) rather
than auto-playing anything. Costs scale with clicks, not messages.

Design decisions:
- **Two personas from day one, ready for Phase 3 voice selection:**
    - `george`  → OpenAI `onyx`   (deep warm male, closest to a friendly Aussie male)
    - `georgia` → OpenAI `nova`   (bright friendly female)
  A future settings screen just needs to persist a `voice` preference
  and pass it here; nothing else changes.
- **No storage.** Generated audio bytes stream straight back to the
  client. We never keep TTS output on disk or in the database.
- **4000-char cap.** Well below OpenAI's 4096 hard limit, gives Sonnet
  headroom without hitting API errors.
- **MP3 format.** Universally supported by `expo-audio` and web
  browsers via HTMLAudioElement. AAC is a possible future switch if
  size matters.
"""
from __future__ import annotations

import asyncio
import os
from typing import Literal, Optional

from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech

# Whitelist of persona keys the frontend may send. Anything else falls
# back to `george` so no rogue value can slip through.
GeorgeVoiceKey = Literal["george", "georgia"]

# Map friendly persona name → OpenAI voice id.
_VOICE_MAP: dict[str, str] = {
    "george":  "onyx",   # deep, warm, mature male
    "georgia": "nova",   # bright, friendly female
}
_DEFAULT_VOICE: GeorgeVoiceKey = "george"

# Per-persona default pacing. Tuned for a natural, engaged delivery
# (TestFlight Jun 2026 — Garry: "a bit slow/monotone, make them slightly
# quicker, warmer and more expressive, not hyper"). Near-natural pace,
# Georgia a touch under George. Warmth/expressiveness comes from the
# tts-1-hd model above. Applied only when the caller hasn't set an
# explicit non-default speed, so "Preview voice" style overrides win.
_PERSONA_SPEED: dict[str, float] = {
    "george":  1.0,
    "georgia": 0.98,
}


def _add_natural_pauses(text: str) -> str:
    """Insert gentle pauses between sentences/thoughts so speech doesn't
    run together. OpenAI TTS lengthens the gap at a line break, so we
    add one after sentence-ending punctuation. Purely cosmetic for
    cadence — the words spoken are unchanged."""
    import re
    # A newline after . ! ? … when followed by whitespace + a letter.
    out = re.sub(r"([.!?\u2026])\s+(?=[\"'\u201c\u2018A-Za-z0-9])", r"\1\n", text)
    # Give em-dashes a small breath too.
    out = out.replace(" \u2014 ", " \u2014\n")
    return out


# TTS text length cap. OpenAI accepts up to 4096; we cap slightly lower
# to be safe against multi-byte characters expanding token count.
_MAX_TTS_CHARS = 4000


def _emergent_key() -> str:
    key = os.getenv("EMERGENT_LLM_KEY")
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY missing from environment")
    return key


def resolve_voice(persona: Optional[str]) -> str:
    """Return the OpenAI voice id for the given persona key. Falls back
    to the default if unrecognised or missing."""
    if not persona:
        return _VOICE_MAP[_DEFAULT_VOICE]
    key = persona.strip().lower()
    if key not in _VOICE_MAP:
        return _VOICE_MAP[_DEFAULT_VOICE]
    return _VOICE_MAP[key]


async def synthesize_george_speech(
    text: str,
    *,
    persona: Optional[str] = None,
    model: str = "tts-1-hd",
    speed: float = 1.0,
) -> bytes:
    """Generate George's spoken reply as MP3 bytes.

    Args:
        text: The reply text to speak. Trimmed and length-capped.
        persona: One of "george" (default) or "georgia".
        model: OpenAI TTS model. `tts-1` is faster + cheaper; `tts-1-hd`
            is slightly higher fidelity. We default to `tts-1` — the
            quality difference is small and most FriendPlace members
            will be listening on phone speakers.
        speed: Playback speed (0.25 to 4.0). Default 1.0.

    Returns:
        MP3 audio bytes ready to stream back to the client.

    Raises:
        ValueError: If the text is empty after trimming.
    """
    body = (text or "").strip()
    if not body:
        raise ValueError("Nothing to speak.")
    if len(body) > _MAX_TTS_CHARS:
        body = body[:_MAX_TTS_CHARS]

    key = (persona or _DEFAULT_VOICE).strip().lower()
    voice = resolve_voice(persona)
    # Calmer cadence: add gentle inter-sentence pauses, and apply the
    # persona's default pace unless the caller explicitly overrode speed.
    body = _add_natural_pauses(body)
    eff_speed = speed
    if abs(speed - 1.0) < 1e-6:
        eff_speed = _PERSONA_SPEED.get(key, 0.94)
    tts = OpenAITextToSpeech(api_key=_emergent_key())

    # iter164bg — silent single retry. TTS synthesis occasionally fails on a
    # transient upstream hiccup (rate blip, network). One quiet retry recovers
    # most of them, so an auto-speak playback or a manual "Try again" tap
    # rarely surfaces an error. IMPORTANT: George's reply TEXT is produced by a
    # SEPARATE call upstream, so a synth failure here never affects the text he
    # has already delivered — only the audio is retried, never the answer.
    last_err: Exception | None = None
    for attempt in range(2):  # initial attempt + one silent retry
        try:
            # `generate_speech` returns raw MP3 bytes.
            audio_bytes = await tts.generate_speech(
                text=body,
                model=model,
                voice=voice,  # type: ignore[arg-type]
                speed=eff_speed,
                response_format="mp3",
            )
            return audio_bytes
        except Exception as e:  # noqa: BLE001 — retry once, then re-raise
            last_err = e
            if attempt == 0:
                await asyncio.sleep(0.4)
                continue
            raise
    # Defensive: loop always returns or raises above.
    raise last_err  # type: ignore[misc]
