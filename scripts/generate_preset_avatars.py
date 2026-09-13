"""One-shot generator for the ~50 FriendPlace 3D preset avatars.

Uses the cropped George + Georgia reference images as visual anchors so
every generated character sits inside the same warm-Pixar-3D family.

Generates ~60 candidates (idempotent — skip if file exists) so we have
headroom to hand-curate down to the final ~50 that best match the
George/Georgia look after visual review.

Outputs land in `/app/frontend/assets/avatars/presets/portrait-XX.png`.
Delete this script after the launch batch is signed off.
"""
from __future__ import annotations

import asyncio
import base64
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

try:
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
except ImportError:
    print("emergentintegrations not installed")
    sys.exit(1)

API_KEY = os.getenv("EMERGENT_LLM_KEY")
if not API_KEY:
    print("EMERGENT_LLM_KEY missing")
    sys.exit(1)

MODEL_ID = "gemini-3.1-flash-image-preview"
DELAY = 1.0

OUT_DIR = Path("/app/frontend/assets/avatars/presets")
REF_DIR = Path("/app/scripts/refs")


def _b64(p: Path) -> str:
    return base64.b64encode(p.read_bytes()).decode("utf-8")


REF_GEORGE = _b64(REF_DIR / "george_ref.jpeg")
REF_GEORGIA = _b64(REF_DIR / "georgia_ref.jpeg")

# ---------- Style guardrail ----------
# The two reference images are attached to EVERY generation so the model
# grounds each new portrait against George + Georgia. The prompt then
# leans on "same visual family / new character / do not reproduce
# George or Georgia" to nudge diversity while holding the style.
STYLE_GUARDRAIL = (
    "STYLE: Match the exact visual family of the two attached FriendPlace "
    "reference characters (George and Georgia) — polished contemporary 3D "
    "character illustration, Pixar-quality, warm soft studio lighting, "
    "slightly stylised expressive proportions with a mature grounded feel, "
    "expressive eyes with catchlights, natural skin texture with subtle "
    "specular highlights, hair rendered with soft individual strands. NOT "
    "photographic, NOT emoji, NOT flat cartoon, NOT toy-like, NOT childish, "
    "NOT game-avatar. "
    "COMPOSITION: shoulder-up 3/4 pose, warm friendly half-smile, plain "
    "navy blue gradient background matching the FriendPlace references. "
    "FRAMING: subject centred, head fills approximately 60% of the vertical "
    "space, square 1:1 aspect ratio. "
    "CLOTHING: soft casual top in the specified colour, no logos, no text, "
    "no FriendPlace butterfly emblem on the clothing (that mark belongs "
    "exclusively to George and Georgia — new characters wear plain tops). "
    "IDENTITY: this is a NEW character in the same family, not a copy of "
    "George or Georgia. Facial features, hair, expression and clothing "
    "should be clearly distinct from both references. "
    "OUTPUT: no watermark, no text, no signature, no border."
)


@dataclass
class Preset:
    n: int                       # sequential index for filename
    age: str                     # "50s" | "60s" | "70s" | "80s"
    gender: str                  # "male" | "female" | "androgynous"
    heritage: str                # short descriptor
    hair: str                    # full hair description
    eyes: str                    # eye colour
    glasses: str = ""            # "" or glasses description
    facial_hair: str = ""        # "" or beard/moustache description
    top: str = ""                # top colour + kind
    accent: str = ""             # optional personality touch

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


# ---------- Preset catalog (60 candidates) ----------
# Deliberate distribution across age bands, gender presentation and
# heritage. Every row exercises at least one of glasses / facial hair /
# hair colour so we cover the customisation dimensions members will want
# to see reflected back.
PRESETS: list[Preset] = [
    # ── 50s: 12 candidates ─────────────────────────────────────────────
    Preset(1,  "early 50s", "female",       "Anglo-Australian",           "shoulder-length wavy brown hair with subtle warm highlights", "hazel", top="soft teal linen shirt"),
    Preset(2,  "mid 50s",   "male",         "Torres Strait Islander",     "short salt-and-pepper black hair",                            "dark brown", facial_hair="short neatly trimmed dark beard", top="olive henley"),
    Preset(3,  "late 50s",  "female",       "Chinese-Australian",         "straight chin-length black hair with grey at the temples",    "warm brown", glasses="thin-frame gold rectangular glasses", top="mustard cardigan over cream blouse"),
    Preset(4,  "early 50s", "male",         "Lebanese-Australian",        "short wavy dark brown hair",                                   "dark brown", facial_hair="close-trimmed dark beard", top="navy button-up shirt"),
    Preset(5,  "mid 50s",   "female",       "Fijian-Australian",          "natural black coily hair, shoulder length",                    "dark brown", top="rust-red linen top"),
    Preset(6,  "late 50s",  "male",         "Indian-Australian",          "short black hair greying at the temples",                      "dark brown", facial_hair="well-groomed grey moustache", top="soft grey polo shirt"),
    Preset(7,  "early 50s", "female",       "Māori-Australian",           "long dark wavy hair pulled loosely back",                      "dark brown", top="deep teal knit"),
    Preset(8,  "mid 50s",   "male",         "Anglo-Australian",           "short warm-blond hair, slightly tousled",                       "blue",       glasses="round tortoise-shell glasses", top="soft heather grey henley"),
    Preset(9,  "late 50s",  "female",       "Greek-Australian",           "shoulder-length dark curly hair with visible grey streaks",    "dark brown", top="terracotta linen shirt"),
    Preset(10, "early 50s", "androgynous",  "Vietnamese-Australian",      "cropped black pixie cut",                                       "dark brown", glasses="thin round black-frame glasses", top="charcoal button-up"),
    Preset(11, "mid 50s",   "female",       "African-Australian",         "short natural black coils",                                     "warm brown", top="mustard-yellow knit"),
    Preset(12, "late 50s",  "male",         "Italian-Australian",         "wavy chin-length dark grey hair swept back",                    "hazel",      facial_hair="short salt-and-pepper stubble", top="navy zip-up cardigan"),
    # ── 60s: 16 candidates ─────────────────────────────────────────────
    Preset(13, "early 60s", "female",       "Aboriginal Australian",      "silver-streaked curly dark hair, shoulder length",             "warm brown", top="burnt-orange knit"),
    Preset(14, "mid 60s",   "male",         "Greek-Australian",           "full head of thick grey hair",                                  "hazel",      facial_hair="short white beard", top="soft blue chambray shirt"),
    Preset(15, "late 60s",  "female",       "Vietnamese-Australian",      "short silver bob",                                              "dark brown", glasses="rimless rectangular reading glasses", top="moss-green blouse"),
    Preset(16, "early 60s", "male",         "African-Australian",         "close-cropped grey hair",                                       "dark brown", facial_hair="short grey beard", top="warm terracotta jumper"),
    Preset(17, "mid 60s",   "female",       "Northern-European Australian", "short silver-blonde hair, softly styled",                     "blue-grey",  top="soft cream cable-knit jumper"),
    Preset(18, "late 60s",  "male",         "Filipino-Australian",        "grey hair, short and neat",                                     "dark brown", facial_hair="neat grey moustache", top="dark teal polo shirt"),
    Preset(19, "early 60s", "female",       "Anglo-Australian",           "shoulder-length wavy silver hair with warm undertones",         "green",      glasses="tortoise-shell cat-eye glasses", top="dusty-rose cardigan"),
    Preset(20, "mid 60s",   "male",         "South Sudanese-Australian",  "close-cropped hair with grey at temples",                       "dark brown", top="navy blue jumper"),
    Preset(21, "late 60s",  "female",       "Italian-Australian",         "shoulder-length silver hair pinned loosely back",              "brown",      top="plum-purple knit"),
    Preset(22, "early 60s", "male",         "Lebanese-Australian",        "wavy grey hair, medium length",                                 "hazel",      facial_hair="salt-and-pepper trimmed beard", glasses="thin black-frame glasses", top="soft olive shirt"),
    Preset(23, "mid 60s",   "female",       "Sri Lankan-Australian",      "shoulder-length dark hair with silver streaks, softly waved",  "dark brown", top="deep teal blouse"),
    Preset(24, "late 60s",  "male",         "Māori-Australian",           "short salt-and-pepper hair",                                    "brown",      facial_hair="short white beard", top="charcoal henley"),
    Preset(25, "early 60s", "female",       "Chinese-Australian",         "chin-length straight black hair with a soft grey streak",       "dark brown", glasses="round wire-frame glasses", top="cream turtleneck"),
    Preset(26, "mid 60s",   "androgynous",  "Aboriginal Australian",      "short grey natural curls",                                      "warm brown", top="ochre-toned henley"),
    Preset(27, "late 60s",  "female",       "Polish-Australian",          "short silver-white hair, soft curls",                           "blue",       top="soft lavender knit"),
    Preset(28, "early 60s", "male",         "Indian-Australian",          "salt-and-pepper hair, medium length swept back",                "dark brown", glasses="rimless rectangular glasses", top="warm mustard henley"),
    # ── 70s: 16 candidates ─────────────────────────────────────────────
    Preset(29, "early 70s", "female",       "Italian-Australian",         "silver hair pulled softly back into a low bun",                 "warm brown", glasses="thin gold-frame glasses", top="plum cardigan"),
    Preset(30, "mid 70s",   "male",         "Māori-Australian",           "silver hair, short and neat",                                   "brown",      facial_hair="short white beard", top="soft heather-grey henley"),
    Preset(31, "late 70s",  "female",       "South Sudanese-Australian",  "silver braided hair, low soft bun",                              "warm brown", top="soft aubergine blouse"),
    Preset(32, "early 70s", "male",         "Aboriginal Australian",      "silver-white hair, short and neat",                              "warm brown", facial_hair="short white beard", top="soft sage green shirt"),
    Preset(33, "mid 70s",   "female",       "Japanese-Australian",        "short silver hair, softly styled",                               "dark brown", glasses="rimless round reading glasses", top="cream knit jumper"),
    Preset(34, "late 70s",  "male",         "Irish-Australian",           "fine white hair, softly parted",                                 "blue",       facial_hair="clean-shaven", top="navy shawl-collar cardigan"),
    Preset(35, "early 70s", "female",       "Anglo-Australian",           "short silver bob with a soft wave",                              "hazel",      top="soft rose-pink knit"),
    Preset(36, "mid 70s",   "male",         "Chinese-Australian",         "fine silver hair, short and combed neatly",                     "dark brown", glasses="rimless rectangular glasses", top="soft grey collared shirt"),
    Preset(37, "late 70s",  "female",       "Greek-Australian",           "silver hair pinned back with a soft twist",                     "warm brown", top="soft cream blouse with a warm shawl"),
    Preset(38, "early 70s", "male",         "African-Australian",         "close-cropped silver hair",                                      "dark brown", facial_hair="short salt-and-pepper beard", top="warm terracotta cardigan"),
    Preset(39, "mid 70s",   "female",       "Filipino-Australian",        "shoulder-length silver hair, softly styled",                    "dark brown", top="soft teal knit"),
    Preset(40, "late 70s",  "androgynous",  "Anglo-Australian",           "silver-white hair, short and swept back",                       "green",      glasses="round tortoise-shell reading glasses", top="soft moss-green cardigan"),
    Preset(41, "early 70s", "female",       "Lebanese-Australian",        "silver hair pinned into a soft chignon",                        "hazel",      top="soft plum-purple cardigan"),
    Preset(42, "mid 70s",   "male",         "Vietnamese-Australian",      "fine silver hair, short and neat",                               "dark brown", facial_hair="short grey moustache", top="soft charcoal jumper"),
    Preset(43, "late 70s",  "female",       "Northern-European Australian", "soft white curls, short",                                     "blue-grey",  glasses="fine gold-frame glasses on a chain", top="dusty-blue cardigan"),
    Preset(44, "early 70s", "male",         "Sri Lankan-Australian",      "silver hair, short",                                              "warm brown", top="warm rust polo shirt"),
    # ── 80s: 12 candidates ─────────────────────────────────────────────
    Preset(45, "early 80s", "female",       "Polish-Australian",          "soft white curls, short and neat",                              "blue",       glasses="fine gold-frame reading glasses", top="dusty-rose knit"),
    Preset(46, "mid 80s",   "male",         "Chinese-Australian",         "fine silver hair, short",                                        "dark brown", top="soft grey collared shirt"),
    Preset(47, "late 80s",  "female",       "First Nations Australian",   "silver-white plaited hair, long over one shoulder",             "warm brown", top="ochre-toned wrap"),
    Preset(48, "early 80s", "male",         "Dutch-Australian",           "fine white hair, short and neatly parted",                      "blue",       facial_hair="neat white moustache", top="soft blue jumper"),
    Preset(49, "mid 80s",   "female",       "Sri Lankan-Australian",      "silver hair pulled back into a soft low bun",                   "dark brown", top="teal-and-cream tunic"),
    Preset(50, "late 80s",  "male",         "Scottish-Australian",        "fine white hair, softly parted",                                 "blue",       facial_hair="short white beard", top="soft charcoal cardigan"),
    Preset(51, "early 80s", "female",       "Greek-Australian",           "shoulder-length silver hair, softly waved",                     "warm brown", glasses="rimless round glasses", top="warm cream cable-knit"),
    Preset(52, "mid 80s",   "male",         "Anglo-Australian",           "fine white hair, gently thinning",                               "hazel",      facial_hair="clean-shaven", top="soft heather-grey cardigan"),
    Preset(53, "late 80s",  "female",       "Vietnamese-Australian",      "silver-white hair, short and neat",                              "dark brown", top="soft plum blouse"),
    Preset(54, "early 80s", "male",         "African-Australian",         "close-cropped white hair",                                       "dark brown", facial_hair="neat short white beard", top="warm mustard cardigan"),
    Preset(55, "mid 80s",   "female",       "Italian-Australian",         "silver hair softly pinned back",                                 "warm brown", glasses="fine tortoise-shell glasses", top="warm terracotta shawl"),
    Preset(56, "late 80s",  "male",         "Māori-Australian",           "silver-white hair, short",                                       "brown",      facial_hair="short white beard", top="soft navy henley"),
    # ── 4 style variety top-ups ────────────────────────────────────────
    Preset(57, "mid 60s",   "female",       "Middle-Eastern Australian",  "shoulder-length dark hair wrapped in a soft teal headscarf",    "dark brown", top="soft cream blouse under the headscarf drape"),
    Preset(58, "early 70s", "male",         "Pacific Islander Australian","short salt-and-pepper hair",                                     "warm brown", facial_hair="short white beard", top="warm rust henley"),
    Preset(59, "late 50s",  "female",       "Latin-American Australian",  "long wavy dark hair with warm caramel highlights",               "hazel",      top="soft teal blouse"),
    Preset(60, "mid 70s",   "male",         "Anglo-Australian",           "silver hair, medium length, swept back",                         "green",      glasses="round black-frame glasses", facial_hair="short grey beard", top="soft navy zip-up hoodie"),
]


async def generate_one(preset: Preset) -> bool:
    out = OUT_DIR / preset.filename()
    if out.exists() and out.stat().st_size > 5000:
        print(f"  ✓ SKIP {preset.filename()}")
        return True
    out.parent.mkdir(parents=True, exist_ok=True)
    session_id = f"preset-{preset.n:02d}-{int(time.time())}"
    chat = LlmChat(
        api_key=API_KEY,
        session_id=session_id,
        system_message="You are a character-illustration generator producing consistent 3D character portraits for a mobile app avatar picker.",
    )
    chat.with_model("gemini", MODEL_ID).with_params(modalities=["image", "text"])
    msg = UserMessage(
        text=preset.prompt(),
        file_contents=[
            ImageContent(REF_GEORGE),
            ImageContent(REF_GEORGIA),
        ],
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
    print(f"Generating {len(PRESETS)} preset avatars via {MODEL_ID} …\n")
    ok = 0
    for i, p in enumerate(PRESETS, start=1):
        print(f"[{i}/{len(PRESETS)}] {p.filename()}  ({p.age}, {p.gender}, {p.heritage})")
        if await generate_one(p):
            ok += 1
        await asyncio.sleep(DELAY)
    print(f"\n✅ Done — {ok}/{len(PRESETS)} preset avatars on disk.")


if __name__ == "__main__":
    asyncio.run(main())
