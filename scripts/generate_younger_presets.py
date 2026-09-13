"""Extension batch: 12 younger-adult FriendPlace preset avatars
(portrait-61 to portrait-72).

Same style guardrail, same reference-image anchoring as the original 60.
Only difference: these subjects are 18–45, split evenly across three
age bands (18-25, 25-35, 35-45). Idempotent — skip if file exists — so
this can safely be re-run.
"""
from __future__ import annotations

import asyncio
import base64
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

try:
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
except ImportError:
    print("emergentintegrations not installed")
    sys.exit(1)

API_KEY = os.getenv("EMERGENT_LLM_KEY")
MODEL_ID = "gemini-3.1-flash-image-preview"
DELAY = 1.0

OUT_DIR = Path("/app/frontend/assets/avatars/presets")
REF_DIR = Path("/app/scripts/refs")


def _b64(p: Path) -> str:
    return base64.b64encode(p.read_bytes()).decode("utf-8")


REF_GEORGE = _b64(REF_DIR / "george_ref.jpeg")
REF_GEORGIA = _b64(REF_DIR / "georgia_ref.jpeg")

# Identical guardrail to the original 60 so this batch sits in the same
# family exactly. Younger-adult framing tightened at the top so we don't
# drift toward teen / child renders.
STYLE_GUARDRAIL = (
    "STYLE: Match the exact visual family of the two attached FriendPlace "
    "reference characters (George and Georgia) — polished contemporary 3D "
    "character illustration, Pixar-quality, warm soft studio lighting, "
    "slightly stylised expressive proportions, expressive eyes with "
    "catchlights, natural skin texture with subtle specular highlights, "
    "hair rendered with soft individual strands. NOT photographic, NOT "
    "emoji, NOT flat cartoon, NOT toy-like, NOT childish, NOT teenaged, "
    "NOT game-avatar. Subject is a young or mid-life adult — clearly a "
    "grown adult, never a child or teenager. Adult facial proportions, "
    "adult jawline, adult neck and shoulders. "
    "COMPOSITION: shoulder-up 3/4 pose, warm friendly half-smile, plain "
    "navy blue gradient background matching the FriendPlace references. "
    "FRAMING: subject centred, head fills approximately 60% of the "
    "vertical space, square 1:1 aspect ratio. "
    "CLOTHING: soft casual top in the specified colour, no logos, no "
    "text, no FriendPlace butterfly emblem on the clothing. "
    "IDENTITY: this is a NEW character in the same family, not a copy of "
    "George or Georgia. Facial features, hair and clothing should be "
    "clearly distinct from both references. "
    "OUTPUT: no watermark, no text, no signature, no border."
)


@dataclass
class Preset:
    n: int
    age: str
    gender: str
    heritage: str
    hair: str
    eyes: str
    glasses: str = ""
    facial_hair: str = ""
    top: str = ""
    accent: str = ""

    def filename(self) -> str:
        return f"portrait-{self.n:02d}.png"

    def prompt(self) -> str:
        bits = [
            f"A friendly Australian adult in their {self.age}, {self.heritage} heritage, {self.gender} presentation.",
            f"Hair: {self.hair}.",
            f"Eyes: {self.eyes}.",
        ]
        if self.glasses:
            bits.append(f"Glasses: {self.glasses}.")
        if self.facial_hair:
            bits.append(f"Facial hair: {self.facial_hair}.")
        if self.top:
            bits.append(f"Wearing a {self.top}.")
        if self.accent:
            bits.append(self.accent)
        return " ".join(bits) + " " + STYLE_GUARDRAIL


PRESETS: list[Preset] = [
    # ── 18–25 (4) ─────────────────────────────────────────────────────
    Preset(61, "early 20s", "female",      "Anglo-Australian",           "long straight honey-blonde hair with a soft centre parting",      "green",      top="soft sage-green oversized jumper", accent="Youthful adult in their early twenties, clearly out of their teens."),
    Preset(62, "early 20s", "male",        "Vietnamese-Australian",      "short black hair with a soft undercut, modern styled",             "dark brown", top="charcoal-grey zip-up hoodie",       accent="Youthful adult in his early twenties, clearly out of his teens."),
    Preset(63, "mid 20s",   "androgynous", "Aboriginal Australian",      "shoulder-length wavy dark hair, natural texture",                  "warm brown", glasses="thin round black-frame glasses", top="soft terracotta oversized tee",     accent="Young adult in their mid twenties, clearly out of their teens."),
    Preset(64, "mid 20s",   "female",      "Sudanese-Australian",        "medium-length natural black coils, softly shaped",                 "dark brown", top="soft mustard-yellow crewneck",      accent="Young adult in her mid twenties, clearly out of her teens."),
    # ── 25–35 (4) ─────────────────────────────────────────────────────
    Preset(65, "late 20s",  "male",        "Lebanese-Australian",        "short wavy dark brown hair, modern side part",                     "dark brown", facial_hair="short trimmed dark stubble", top="soft teal button-up shirt",         accent="Young adult in his late twenties."),
    Preset(66, "early 30s", "female",      "Chinese-Australian",         "shoulder-length straight black hair with a soft fringe",           "dark brown", top="soft cream oversized knit",         accent="Young-adult professional in her early thirties."),
    Preset(67, "early 30s", "male",        "Māori-Australian",           "short dark hair, neat modern cut",                                 "brown",      facial_hair="close-trimmed short dark beard", top="olive-green henley",              accent="Young-adult professional in his early thirties."),
    Preset(68, "mid 30s",   "female",      "Indian-Australian",          "long wavy dark hair with warm caramel highlights",                 "warm brown", glasses="round tortoise-shell glasses",  top="soft dusty-rose knit",              accent="Adult in her mid thirties."),
    # ── 35–45 (4) ─────────────────────────────────────────────────────
    Preset(69, "late 30s",  "male",        "African-Australian",         "close-cropped natural black hair, neat modern cut",                "dark brown", facial_hair="short trimmed beard",       top="navy zip-up hoodie",                accent="Adult in his late thirties."),
    Preset(70, "early 40s", "female",      "Greek-Australian",           "shoulder-length dark wavy hair swept to one side",                 "hazel",      top="soft terracotta linen shirt",       accent="Adult in her early forties."),
    Preset(71, "early 40s", "male",        "Anglo-Australian",           "short warm-brown hair with just a hint of grey at the temples",    "blue",       glasses="thin black-frame rectangular glasses", top="soft charcoal henley",       accent="Adult in his early forties."),
    Preset(72, "mid 40s",   "female",      "Filipino-Australian",        "long straight dark brown hair with subtle highlights",             "dark brown", top="soft plum-purple blouse",           accent="Adult in her mid forties."),
]


async def generate_one(preset: Preset) -> bool:
    out = OUT_DIR / preset.filename()
    if out.exists() and out.stat().st_size > 5000:
        print(f"  ✓ SKIP {preset.filename()}")
        return True
    out.parent.mkdir(parents=True, exist_ok=True)
    session_id = f"younger-{preset.n:02d}-{int(time.time())}"
    chat = LlmChat(
        api_key=API_KEY,
        session_id=session_id,
        system_message="You are a character-illustration generator producing consistent 3D character portraits for a mobile app avatar picker.",
    )
    chat.with_model("gemini", MODEL_ID).with_params(modalities=["image", "text"])
    msg = UserMessage(
        text=preset.prompt(),
        file_contents=[ImageContent(REF_GEORGE), ImageContent(REF_GEORGIA)],
    )
    try:
        _text, images = await chat.send_message_multimodal_response(msg)
    except Exception as e:
        print(f"  ✗ ERROR {preset.filename()}: {e}")
        return False
    if not images:
        print(f"  ✗ EMPTY {preset.filename()}")
        return False
    try:
        data = base64.b64decode(images[0]["data"])
        out.write_bytes(data)
        print(f"  ✓ {preset.filename()} ({len(data)//1024} KB)")
        return True
    except Exception as e:
        print(f"  ✗ SAVE {preset.filename()}: {e}")
        return False


async def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Generating {len(PRESETS)} younger-adult presets …\n")
    ok = 0
    for i, p in enumerate(PRESETS, start=1):
        print(f"[{i}/{len(PRESETS)}] {p.filename()}  ({p.age}, {p.gender}, {p.heritage})")
        if await generate_one(p):
            ok += 1
        await asyncio.sleep(DELAY)
    print(f"\n✅ Done — {ok}/{len(PRESETS)} younger-adult avatars on disk.")


if __name__ == "__main__":
    asyncio.run(main())
