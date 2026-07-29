"""One-shot: generate the "Come in… let me show you around." mp3s in
Ash (George) and Nova (Georgia) using the same OpenAI TTS pipeline as
the live MCGS voice endpoint. Drops the results into the website's
public audio directory.

Only re-run this if the invitation copy in
`/app/website/lib/welcomes.ts` changes.
"""

import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

OUT_DIR = Path("/app/website/public/audio")
INVITE_TEXT = "Come in\u2026 let me show you around."

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

    for persona, voice in VOICES.items():
        print(f"[{persona}] generating with voice={voice}\u2026")
        audio = await tts.generate_speech(
            text=INVITE_TEXT,
            model="tts-1-hd",
            voice=voice,
            speed=1.02,
            response_format="mp3",
        )
        out_path = OUT_DIR / f"invite-{persona}.mp3"
        out_path.write_bytes(audio)
        print(f"  \u2192 {out_path} ({len(audio)} bytes)")

    print("Done.")


if __name__ == "__main__":
    asyncio.run(generate())
