"""
One-time / re-runnable script to generate lifelike backdrop images for the
Spot the Difference game using OpenAI GPT Image 1 via the Emergent Universal
LLM key.

Saves PNGs to /app/backend/static/spot_bg/<theme>.png

Run:
    python /app/backend/scripts/generate_spot_backgrounds.py
    python /app/backend/scripts/generate_spot_backgrounds.py --only garden
    python /app/backend/scripts/generate_spot_backgrounds.py --force   # overwrite existing
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

# Ensure /app/backend is on sys.path so we can import from spot_difference if needed
sys.path.insert(0, "/app/backend")

from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration  # noqa: E402

# Same themes as spot_difference.py — same atmosphere, just lifelike.
PROMPTS: dict[str, str] = {
    "garden": (
        "A peaceful sunny suburban back garden as a soft photographic illustration. "
        "Bright morning sun, a clear pale blue sky with a couple of fluffy clouds, "
        "lush green lawn, a winding stone path, gentle flower beds with soft pastel "
        "blossoms, a wooden bench in the distance. Wide landscape composition, soft "
        "natural lighting, warm and welcoming, no people, no text, no logos. "
        "Soft pastel colour palette, gentle painterly photo style, leaves plenty of "
        "empty space in the centre and upper area."
    ),
    "coffee_shop": (
        "Cozy neighbourhood coffee shop interior as a soft photographic illustration. "
        "Warm wooden tables, soft window light, blurred pastries on a counter, a "
        "small vase of flowers, tiny potted plants, gentle steam wisps. "
        "Wide landscape composition, no people, no text, no signs, no logos. "
        "Warm honey and cream colour palette, soft painterly photo style, plenty of "
        "calm empty space across the scene."
    ),
    "beach": (
        "A peaceful Australian beach scene at midday as a soft photographic illustration. "
        "Golden sand in the foreground, calm turquoise ocean, gentle white waves, soft "
        "puffy clouds in a pale blue sky, two palm trees framing the edges. "
        "Wide landscape composition, no people, no text, no logos, no boats. "
        "Soft pastel colour palette, gentle painterly photo style, plenty of open "
        "sky and sand for empty space."
    ),
    "pets": (
        "A cozy sunny living room as a soft photographic illustration. Soft wooden "
        "floor, a warm rug, gentle window light spilling in, a comfy armchair to one "
        "side, a small house plant. No animals visible, no people, no text, no logos. "
        "Warm cream and honey colour palette, soft painterly photo style, "
        "plenty of calm empty floor space in the centre."
    ),
    "birds": (
        "A lush leafy backyard tree scene as a soft photographic illustration. "
        "Tall friendly tree with broad green canopy in the centre, soft pale-blue "
        "morning sky behind, dappled sunlight, a few wispy clouds, a low garden "
        "fence at the bottom. Wide landscape composition, no birds, no people, no "
        "text, no logos. Soft pastel colour palette, gentle painterly photo style."
    ),
    "around_house": (
        "A warm lounge room interior as a soft photographic illustration. Soft "
        "wooden floor, neutral painted walls, a window with sheer curtains letting "
        "in gentle afternoon sunlight, a soft armchair in the corner, a rug. "
        "Wide landscape composition, no people, no animals, no text, no signs, no logos. "
        "Warm cream, honey and soft blue colour palette, gentle painterly photo style, "
        "plenty of calm empty space across the room."
    ),
}

OUTPUT_DIR = Path("/app/backend/static/spot_bg")


async def generate_one(image_gen: OpenAIImageGeneration, theme_key: str, prompt: str, force: bool) -> bool:
    out_path = OUTPUT_DIR / f"{theme_key}.png"
    jpg_path = OUTPUT_DIR / f"{theme_key}.jpg"
    if jpg_path.exists() and not force:
        print(f"[skip] {theme_key} — already exists at {jpg_path} (use --force to regenerate)")
        return True
    print(f"[gen ] {theme_key} — calling gpt-image-1 …")
    try:
        images = await image_gen.generate_images(
            prompt=prompt,
            model="gpt-image-1",
            number_of_images=1,
        )
    except Exception as e:  # pragma: no cover
        print(f"[err ] {theme_key}: generation failed — {e!r}")
        return False
    if not images:
        print(f"[err ] {theme_key}: no image bytes returned")
        return False
    out_path.write_bytes(images[0])
    kb = len(images[0]) / 1024
    print(f"[ok  ] {theme_key} → {out_path} ({kb:.0f} KB)")
    # Optimize: resize to landscape and save as JPEG to drop ~10x file size for
    # mobile clients. Source is usually 1024x1024.
    try:
        from PIL import Image
        from io import BytesIO
        img = Image.open(BytesIO(images[0])).convert("RGB")
        # Crop centre to 10:7 (landscape) so it matches the scene aspect ratio.
        w, h = img.size
        target_aspect = 10 / 7
        cur_aspect = w / h
        if cur_aspect > target_aspect:
            new_w = int(h * target_aspect)
            left = (w - new_w) // 2
            img = img.crop((left, 0, left + new_w, h))
        else:
            new_h = int(w / target_aspect)
            top = (h - new_h) // 2
            img = img.crop((0, top, w, top + new_h))
        # Downscale to a more mobile-friendly size while keeping crispness.
        img.thumbnail((1280, 896), Image.LANCZOS)
        img.save(jpg_path, "JPEG", quality=82, optimize=True, progressive=True)
        kb2 = jpg_path.stat().st_size / 1024
        print(f"[opt ] {theme_key} → {jpg_path} ({kb2:.0f} KB)")
    except Exception as e:
        print(f"[warn] {theme_key}: optimize failed — {e!r} (keeping PNG)")
    return True


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="Generate only this single theme key", default=None)
    ap.add_argument("--force", action="store_true", help="Regenerate even if file exists")
    args = ap.parse_args()

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        print("ERROR: EMERGENT_LLM_KEY not set in environment (check /app/backend/.env)")
        return 2

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    image_gen = OpenAIImageGeneration(api_key=api_key)

    targets = [args.only] if args.only else list(PROMPTS.keys())
    failed = []
    for key in targets:
        if key not in PROMPTS:
            print(f"[skip] unknown theme: {key}")
            failed.append(key)
            continue
        ok = await generate_one(image_gen, key, PROMPTS[key], args.force)
        if not ok:
            failed.append(key)

    if failed:
        print(f"\nDone with {len(failed)} failure(s): {failed}")
        return 1
    print("\nAll backgrounds generated successfully ✨")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
