"""Generate voice clips for the Meet → Welcome → Begin → You're all
set journey. Uses the same OpenAI TTS pipeline (Ash for George, Nova
for Georgia) as the existing invite/hello/intro clips.

Re-run only when the on-screen copy for these lines changes. Locked
with Garry (iter147, Aug 2026) — this is the entire spoken journey.
"""

import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

OUT_DIR = Path("/app/website/public/audio")

# Each clip is deliberately short so the pause between beats is
# carried by the choreography timers, not padded silence in the mp3.
CLIPS = {
    # Welcome moment — three beats delivered in one warm greeting.
    "welcome":     "Welcome.",
    "gladfound":   "Hi\u2026 I\u2019m so glad you found us.",
    "comeinside":  "Come inside and let me show you around.",
    # Journey close — the final emotional beat at /features tour end.
    # Written as one continuous line so George's cadence carries
    # naturally from "you're all set" into the butterfly reminder.
    "ending":      "You\u2019re all set. FriendPlace is yours to explore now. And remember\u2026 if you ever need me, just tap the butterfly.",
}

VOICES = {
    "george":  "ash",
    "georgia": "nova",
}


async def generate() -> None:
    from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise SystemExit("EMERGENT_LLM_KEY missing from /app/backend/.env")

    tts = OpenAITextToSpeech(api_key=key)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for clip_id, text in CLIPS.items():
        for persona, voice in VOICES.items():
            out_path = OUT_DIR / f"{clip_id}-{persona}.mp3"
            print(f"[{clip_id}/{persona}] voice={voice}: {text!r}")
            audio = await tts.generate_speech(
                text=text,
                model="tts-1-hd",
                voice=voice,
                speed=1.02,
                response_format="mp3",
            )
            out_path.write_bytes(audio)
            print(f"    -> {out_path} ({len(audio):,} bytes)")

    print("Done.")


if __name__ == "__main__":
    asyncio.run(generate())
