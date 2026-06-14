"""
Generate photorealistic transparent-PNG beach objects via Gemini Nano Banana.

Run once to populate /app/backend/static/spot_objects/beach/*.png.
Each asset is generated against a pure-white background (the model is much more
reliable producing isolated subjects on solid backgrounds than truly
transparent ones), then post-processed with PIL: near-white pixels are knocked
out to alpha=0 with a soft 6-pixel feather, producing a clean cut-out.
"""
from __future__ import annotations

import asyncio
import base64
import io
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image, ImageFilter

load_dotenv("/app/backend/.env")

# Importing after dotenv load so the library picks up env if it needs to.
from emergentintegrations.llm.chat import LlmChat, UserMessage  # noqa: E402

OUT_DIR = Path("/app/backend/static/spot_objects/beach")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# 18 beach objects (15 base + 3 swap targets).
ASSETS = [
    ("sun",       "a bright golden cartoon-realistic sun with soft rays, friendly face hidden"),
    ("cloud",     "a single fluffy white cumulus cloud, soft edges, photo-realistic"),
    ("palm1",     "a single tall coconut palm tree, lush green fronds, slight curve in trunk, photo-realistic"),
    ("palm2",     "a single shorter coconut palm tree, dense fronds, straight trunk, photo-realistic"),
    ("wave",      "a single small breaking ocean wave with white sea foam crest, photo-realistic"),
    ("boat",      "a small white sailboat with a single white triangular sail, side view, photo-realistic"),
    ("umbrella",  "a single red and white striped beach umbrella, open, planted in sand, photo-realistic"),
    ("ball",      "a single white volleyball with classic panels, photo-realistic, clean studio shot"),
    ("starfish",  "a single orange starfish lying flat, five arms, slight texture, photo-realistic"),
    ("crab",      "a single small red sand crab, top-down view, photo-realistic"),
    ("shell",     "a single pink and cream conch seashell, photo-realistic, side angle"),
    ("seagull",   "a single white seagull in flight with wings spread, side view, photo-realistic"),
    ("icecream",  "a single vanilla ice cream cone with one scoop, photo-realistic"),
    ("fish",      "a single small tropical reef fish, side view, blue and yellow, photo-realistic"),
    ("kite",      "a single colourful diamond-shaped kite with a long ribbon tail, photo-realistic"),
    # Swap variants used by diff_pool
    ("lobster",   "a single bright red lobster, top-down view, photo-realistic"),
    ("soccerball","a single classic black and white soccer ball, photo-realistic, clean studio shot"),
    ("shavedice", "a single colourful Australian shaved-ice dessert in a cup with rainbow syrup, photo-realistic"),
]

NEGATIVE = (
    "Do not include any text, watermark, signature, or other objects. "
    "Do not include sand, sky, water, ground, shadows on a surface, or any background scene. "
    "Subject must be fully isolated."
)

# Gemini Nano Banana is much more reliable with a solid white background than
# with a transparent one. We post-process whites to alpha=0 below.
def build_prompt(desc: str) -> str:
    return (
        f"A single isolated subject: {desc}. "
        "Subject occupies roughly the centre 70% of the frame. "
        "Background: pure flat solid #FFFFFF white, completely empty. "
        "Subject is brightly and evenly lit from front-above so no part of it is pure white. "
        "Cast a soft, subtle drop shadow directly beneath the subject, no further than 10% of the subject height. "
        "Square 1024x1024 image. "
        + NEGATIVE
    )


def knockout_white(img: Image.Image, threshold: int = 240, feather: int = 4) -> Image.Image:
    """Convert near-white pixels to fully transparent with a feathered edge.

    1. Build an alpha mask: pixels where R,G,B all >= threshold → 0, else 255.
    2. Blur the mask slightly so the edge is soft (anti-aliased).
    3. Trim transparent borders so the asset is tightly cropped.
    """
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    mask = Image.new("L", (w, h), 255)
    mpx = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            if r >= threshold and g >= threshold and b >= threshold:
                # Distance below 255 = how non-white. Closer to white = more transparent.
                # Hard cut for very-white pixels, soft for borderline.
                avg = (r + g + b) / 3
                if avg >= 252:
                    mpx[x, y] = 0
                else:
                    # Fade from 255 (avg=threshold) to 0 (avg=252) so the edge is soft.
                    mpx[x, y] = int(((avg - 252) / (threshold - 252)) * 255)
                    mpx[x, y] = max(0, min(255, 255 - mpx[x, y]))
    if feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(radius=feather))
    img.putalpha(mask)
    return img.crop(img.getbbox() or (0, 0, w, h))


async def generate_one(slug: str, desc: str) -> bool:
    out_path = OUT_DIR / f"{slug}.png"
    if out_path.exists():
        print(f"  ↪︎ skip {slug}.png (already exists)")
        return True
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY missing from /app/backend/.env")
    chat = LlmChat(
        api_key=api_key,
        session_id=f"beach-asset-{slug}",
        system_message="You are an image generation assistant. Return one image only.",
    )
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(
        modalities=["image", "text"]
    )
    msg = UserMessage(text=build_prompt(desc))
    try:
        text, images = await chat.send_message_multimodal_response(msg)
    except Exception as e:
        print(f"  ✗ {slug} api error: {e}")
        return False
    if not images:
        print(f"  ✗ {slug} no image returned (text={text!r:.80})")
        return False
    raw = base64.b64decode(images[0]["data"])
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    cleaned = knockout_white(img)
    # Resize down so PNGs are ~512px on the long edge — perfectly crisp on iPad
    # without bloating the bundle.
    cleaned.thumbnail((512, 512), Image.LANCZOS)
    cleaned.save(out_path, "PNG", optimize=True)
    kb = out_path.stat().st_size // 1024
    print(f"  ✓ {slug}.png ({kb} KB, {cleaned.size[0]}x{cleaned.size[1]})")
    return True


async def main() -> int:
    print(f"Generating {len(ASSETS)} beach assets → {OUT_DIR}")
    ok = 0
    for slug, desc in ASSETS:
        success = await generate_one(slug, desc)
        if success:
            ok += 1
        # Light throttle to be polite to the upstream API.
        await asyncio.sleep(0.3)
    print(f"\nDone. {ok}/{len(ASSETS)} assets generated.")
    return 0 if ok == len(ASSETS) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
