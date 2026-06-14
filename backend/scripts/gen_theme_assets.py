"""
Generate photorealistic transparent-PNG object libraries for every Spot the
Difference theme via Gemini Nano Banana.

Run this once (or with --force to regenerate). Each asset:
  • Is prompted on a solid white background (model is much more reliable that
    way than asking for transparent PNG directly).
  • Has its background removed via flood-fill from the four corners —
    preserves bright white interior pixels (white sails, white seagull belly,
    cloud highlights) that a naive "knock out near-white" pass would destroy.
  • Is feathered (~4 px Gaussian) for soft anti-aliased edges.
  • Is auto-cropped to its bounding box and downscaled to ≤512 px on the
    long edge to keep bundle bandwidth modest.

Usage:
  python3 scripts/gen_theme_assets.py                # generate all themes
  python3 scripts/gen_theme_assets.py beach garden   # specific themes only
  python3 scripts/gen_theme_assets.py --force        # regenerate everything
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import os
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageFilter

load_dotenv("/app/backend/.env")

from emergentintegrations.llm.chat import LlmChat, UserMessage  # noqa: E402

OUT_ROOT = Path("/app/backend/static/spot_objects")

# ─── Theme catalogues ────────────────────────────────────────────────────────
# Each tuple is (slug, descriptive prompt). Slugs match the `asset` field set
# in spot_difference.py element definitions.
THEMES: Dict[str, List[Tuple[str, str]]] = {
    "beach": [
        ("sun",       "a bright golden sun with soft warm rays, photo-realistic"),
        ("cloud",     "a single fluffy white cumulus cloud, soft edges, photo-realistic"),
        ("palm1",     "a single tall coconut palm tree, lush green fronds, slight curve in trunk, photo-realistic"),
        ("palm2",     "a single shorter coconut palm tree, dense green fronds, straight trunk, photo-realistic"),
        ("wave",      "a small breaking ocean wave with crisp white sea foam crest, blue water, photo-realistic"),
        ("boat",      "a small white sailboat with a single white triangular sail, side view, photo-realistic"),
        ("umbrella",  "a single red and white striped beach umbrella, open, planted upright, photo-realistic"),
        ("ball",      "a single white volleyball with classic black panel lines, photo-realistic studio shot"),
        ("starfish",  "a single orange starfish lying flat, five arms, slight pebbled texture, photo-realistic"),
        ("crab",      "a single small red sand crab, top-down view, photo-realistic"),
        ("shell",     "a single pink and cream conch seashell, photo-realistic side angle"),
        ("seagull",   "a single white seagull in flight with wings fully spread, side view, photo-realistic"),
        ("icecream",  "a single vanilla ice cream cone with one creamy scoop, waffle cone, photo-realistic"),
        ("fish",      "a single small tropical reef fish, side view, blue body with yellow fins, photo-realistic"),
        ("kite",      "a single colourful diamond-shaped kite with a long red ribbon tail, photo-realistic"),
        ("lobster",   "a single bright red cooked lobster, top-down view, photo-realistic"),
        ("soccerball","a single classic black-and-white soccer ball, photo-realistic studio shot"),
        ("shavedice", "a single colourful Australian rainbow shaved-ice cup with bright syrup, photo-realistic"),
    ],
    "garden": [
        ("sun",       "a bright golden sun, soft warm rays, photo-realistic"),
        ("cloud1",    "a single fluffy white cumulus cloud, photo-realistic"),
        ("cloud2",    "a single small wispy white cloud, photo-realistic"),
        ("tree",      "a single lush green leafy tree with brown trunk, full canopy, photo-realistic"),
        ("flower1",   "a single pink tulip in full bloom, photo-realistic"),
        ("flower2",   "a single yellow sunflower in full bloom, photo-realistic"),
        ("flower3",   "a single red rose in full bloom, photo-realistic"),
        ("flower4",   "a single white daisy in full bloom, photo-realistic"),
        ("bee",       "a single honey bee in flight, side view, photo-realistic"),
        ("butterfly", "a single orange and black monarch butterfly with wings spread, photo-realistic"),
        ("watering",  "a single green metal garden watering can, side view, photo-realistic"),
        ("bench",     "a single wooden garden bench, side view, photo-realistic"),
        ("snail",     "a single brown garden snail with spiral shell, side view, photo-realistic"),
        ("rabbit",    "a single brown rabbit sitting upright, side view, photo-realistic"),
        ("hedge",     "a single neatly trimmed green boxwood hedge ball, photo-realistic"),
        ("hibiscus",  "a single bright pink hibiscus flower in bloom, photo-realistic"),
        ("cherry",    "a single delicate pink cherry blossom flower, photo-realistic"),
        ("turtle",    "a single small green garden turtle, side view, photo-realistic"),
    ],
    "coffee": [
        ("sign",      "a single chalkboard café sign with a coffee cup illustration, photo-realistic"),
        ("muffin",    "a single golden blueberry muffin in a paper liner, photo-realistic"),
        ("croissant", "a single golden flaky butter croissant, side view, photo-realistic"),
        ("donut",     "a single pink-glazed donut with sprinkles, photo-realistic"),
        ("cup1",      "a single white ceramic mug of hot black coffee with steam, photo-realistic"),
        ("cup2",      "a single small white teacup with hot green tea, photo-realistic"),
        ("cup3",      "a single tall clear glass of cold milk, photo-realistic"),
        ("cookie",    "a single chocolate chip cookie, top-down view, photo-realistic"),
        ("heart",     "a single bright red heart shape, glossy, photo-realistic"),
        ("flowers",   "a small bouquet of pink and white flowers in a clear vase, photo-realistic"),
        ("clock",     "a single classic round wall clock with roman numerals, front view, photo-realistic"),
        ("chair",     "a single wooden café chair, side view, photo-realistic"),
        ("newspaper", "a single folded newspaper, top-down view, photo-realistic"),
        ("cat",       "a single ginger tabby cat sitting upright, photo-realistic"),
        ("music",     "a single black musical note symbol, photo-realistic"),
        ("cake",      "a single slice of strawberry shortcake on a white plate, photo-realistic"),
        ("baguette",  "a single golden French baguette, photo-realistic"),
        ("sunflower", "a single yellow sunflower in a small pot, photo-realistic"),
        ("wine",      "a single glass of red wine, photo-realistic"),
    ],
    "wildlife": [
        ("tree",      "a single large gum eucalyptus tree, full canopy, photo-realistic"),
        ("sun",       "a bright golden sun, soft warm rays, photo-realistic"),
        ("kookaburra","a single Australian kookaburra perched on a branch, side view, photo-realistic"),
        ("magpie",    "a single Australian magpie standing, side view, black and white plumage, photo-realistic"),
        ("parrot",    "a single colourful Australian rainbow lorikeet perched, photo-realistic"),
        ("owl",       "a single brown owl perched on a branch, front view, photo-realistic"),
        ("robin",     "a single small red-breasted robin, side view, photo-realistic"),
        ("nest",      "a single woven brown bird nest with small eggs inside, photo-realistic"),
        ("feather",   "a single fluffy white feather, photo-realistic"),
        ("worm",      "a single pink garden earthworm, top-down view, photo-realistic"),
        ("berries",   "a small cluster of fresh blueberries, photo-realistic"),
        ("bee",       "a single honey bee in flight, side view, photo-realistic"),
        ("flower",    "a single bright purple wildflower in bloom, photo-realistic"),
        ("cloud",     "a single fluffy white cumulus cloud, photo-realistic"),
        ("ladybug",   "a single red ladybug with black spots, top-down view, photo-realistic"),
        ("flamingo",  "a single pink flamingo standing on one leg, side view, photo-realistic"),
        ("turkey",    "a single brown wild turkey, side view, photo-realistic"),
        ("goose",     "a single white domestic goose, side view, photo-realistic"),
    ],
    "kitchens": [
        ("house",     "a single small cosy country house with red roof, front view, photo-realistic"),
        ("sun",       "a bright golden sun, soft warm rays, photo-realistic"),
        ("tv",        "a single flat-screen television, front view, photo-realistic"),
        ("chair",     "a single comfy upholstered armchair, three-quarter view, photo-realistic"),
        ("lamp",      "a single warm glowing ceiling pendant light, photo-realistic"),
        ("clock",     "a single antique wooden mantel clock, front view, photo-realistic"),
        ("rug",       "a single oriental patterned rug, top-down view, photo-realistic"),
        ("plant",     "a single green potted houseplant in a terracotta pot, photo-realistic"),
        ("cat",       "a single ginger tabby cat curled up sleeping, photo-realistic"),
        ("mug",       "a single white ceramic coffee mug with steam, photo-realistic"),
        ("book",      "a single stack of three hardback books, side view, photo-realistic"),
        ("photo",     "a single framed photo of a smiling family, front view, photo-realistic"),
        ("candle",    "a single tall white pillar candle lit with a small flame, photo-realistic"),
        ("phone",     "a single classic black rotary dial telephone, side view, photo-realistic"),
        ("window",    "a single white-framed cottage window with curtains, front view, photo-realistic"),
        ("radio",     "a single vintage brown wooden radio with knobs, front view, photo-realistic"),
        ("torch",     "a single yellow torch flashlight, photo-realistic"),
        ("dog",       "a single small brown dachshund dog standing, side view, photo-realistic"),
    ],
    "country_towns": [
        ("sun",       "a bright golden sun, soft warm rays, photo-realistic"),
        ("cloud",     "a single fluffy white cumulus cloud, photo-realistic"),
        ("gum_tree",  "a single Australian gum eucalyptus tree, full canopy, photo-realistic"),
        ("clock",     "a single classic country town clock-tower clock face, front view, photo-realistic"),
        ("flag",      "a single Australian flag on a pole, side view, gently waving, photo-realistic"),
        ("mailbox",   "a single red Australian-style country mailbox on a wooden post, photo-realistic"),
        ("bench",     "a single weathered wooden park bench, side view, photo-realistic"),
        ("bike",      "a single vintage red bicycle leaning, side view, photo-realistic"),
        ("car",       "a single dusty red 1960s ute Australian utility truck, side view, photo-realistic"),
        ("flowers",   "a small bunch of bright yellow daisies, photo-realistic"),
        ("lamp",      "a single black wrought-iron street lamp lit at dusk, photo-realistic"),
        ("bird",      "a single magpie standing, side view, photo-realistic"),
        ("redflag",   "a single solid red rectangular flag on a pole, photo-realistic"),
        ("tulip",     "a single bright pink tulip in bloom, photo-realistic"),
        ("bulb",      "a single softly glowing incandescent light bulb, photo-realistic"),
    ],
    "classic_cars": [
        ("sun",       "a bright golden sun, soft warm rays, photo-realistic"),
        ("car_body",  "a single shiny classic 1950s red convertible car, side view, no people, photo-realistic"),
        ("wheel_lf",  "a single chrome car wheel hubcap, front view, photo-realistic"),
        ("wheel_rf",  "a single chrome car wheel hubcap, front view, photo-realistic"),
        ("key",       "a single old brass car key on a leather keychain, top-down view, photo-realistic"),
        ("hat",       "a single black gentleman's top hat, photo-realistic"),
        ("tools",     "a single open red metal mechanic's toolbox with tools, photo-realistic"),
        ("fuel",      "a single red vintage petrol jerry can, side view, photo-realistic"),
        ("trophy",    "a single golden trophy cup with handles, photo-realistic"),
        ("cloud",     "a single fluffy white cumulus cloud, photo-realistic"),
        ("leaf",      "a single dry brown autumn maple leaf, top-down view, photo-realistic"),
        ("bird",      "a single white dove in flight with wings spread, side view, photo-realistic"),
        ("cap",       "a single blue baseball cap, side view, photo-realistic"),
        ("oildrum",   "a single rusty red oil drum barrel, side view, photo-realistic"),
        ("whitewheel","a single plain white car wheel rim, front view, photo-realistic"),
    ],
    "parks_trails": [
        ("sun_ray",   "a bright golden sun with soft warm rays peeking through, photo-realistic"),
        ("tree_l",    "a single tall Australian eucalyptus gum tree, full canopy, photo-realistic"),
        ("tree_r",    "a single shorter Australian eucalyptus gum tree, full canopy, photo-realistic"),
        ("bench",     "a single weathered wooden park bench, side view, photo-realistic"),
        ("hiker_hat", "a single brown Australian wide-brim Akubra bush hat, photo-realistic"),
        ("stick",     "a single brown wooden walking stick with a curved handle, photo-realistic"),
        ("bottle",    "a single stainless-steel reusable water bottle, side view, photo-realistic"),
        ("leaf",      "a single fresh green eucalyptus leaf, top-down view, photo-realistic"),
        ("mushroom",  "a single red-capped white-spotted mushroom, photo-realistic"),
        ("butterfly", "a single blue Ulysses butterfly with wings spread, top-down view, photo-realistic"),
        ("bird",      "a single small brown wren bird, side view, photo-realistic"),
        ("signpost",  "a single wooden trail signpost arrow, photo-realistic"),
        ("cap",       "a single olive-green baseball cap, side view, photo-realistic"),
        ("sodacup",   "a single tall takeaway soft-drink cup with a straw, side view, photo-realistic"),
        ("clipboard","a single brown wooden clipboard with paper, top-down view, photo-realistic"),
    ],
}

NEGATIVE = (
    "Do not include any text, watermark, signature, or other objects. "
    "Do not include sand, sky, water, grass, ground, indoor scene, walls, table surface, or any background. "
    "The subject must be fully isolated."
)


def build_prompt(desc: str) -> str:
    return (
        f"A single isolated subject: {desc}. "
        "Subject occupies roughly the centre 70 percent of the frame. "
        "Background: pure flat solid #FFFFFF white, completely empty and uniform. "
        "Subject lit evenly with soft front-above studio lighting. "
        "Cast only a small soft drop shadow directly beneath the subject, "
        "no further than 8 percent of the subject height, low contrast, "
        "soft-edged so it blends naturally into any photo backdrop. "
        "Square 1024x1024 image. "
        + NEGATIVE
    )


def remove_background_floodfill(
    img: Image.Image,
    tolerance: int = 32,
    feather: float = 4.0,
) -> Image.Image:
    """Knock out only background pixels reachable from the four corners via a
    tolerance-bounded flood fill. Preserves any bright white pixels that are
    surrounded by non-white pixels (sails, clouds, fur, foam, etc.).
    """
    img = img.convert("RGB")
    w, h = img.size
    work = img.copy()
    sentinel = (255, 0, 255)  # magenta — no natural object should be exactly this
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        try:
            ImageDraw.floodfill(work, corner, sentinel, thresh=tolerance)
        except Exception:
            pass
    arr = np.array(work)
    bg = (arr[:, :, 0] == 255) & (arr[:, :, 1] == 0) & (arr[:, :, 2] == 255)
    mask_np = np.where(bg, 0, 255).astype(np.uint8)
    mask = Image.fromarray(mask_np, mode="L")
    if feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(radius=feather))
    out = img.convert("RGBA")
    out.putalpha(mask)
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


async def generate_one(theme_slug: str, asset_slug: str, desc: str, force: bool) -> bool:
    out_dir = OUT_ROOT / theme_slug
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{asset_slug}.png"
    if out_path.exists() and not force:
        print(f"    ↪︎ skip {asset_slug}.png (exists)")
        return True
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY missing from /app/backend/.env")
    chat = LlmChat(
        api_key=api_key,
        session_id=f"asset-{theme_slug}-{asset_slug}",
        system_message="You are an image generation assistant. Return exactly one image.",
    )
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(
        modalities=["image", "text"]
    )
    try:
        _text, images = await chat.send_message_multimodal_response(UserMessage(text=build_prompt(desc)))
    except Exception as e:
        print(f"    ✗ {asset_slug} api error: {e}")
        return False
    if not images:
        print(f"    ✗ {asset_slug} no image returned")
        return False
    raw = base64.b64decode(images[0]["data"])
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    cleaned = remove_background_floodfill(img)
    cleaned.thumbnail((512, 512), Image.LANCZOS)
    cleaned.save(out_path, "PNG", optimize=True)
    kb = out_path.stat().st_size // 1024
    print(f"    ✓ {asset_slug}.png ({kb} KB, {cleaned.size[0]}x{cleaned.size[1]})")
    return True


async def run(themes: List[str], force: bool) -> int:
    total = 0
    ok = 0
    for theme_slug in themes:
        spec = THEMES.get(theme_slug)
        if not spec:
            print(f"⚠️  unknown theme {theme_slug!r}, skipping")
            continue
        print(f"\n=== {theme_slug} ({len(spec)} assets) ===")
        for asset_slug, desc in spec:
            total += 1
            if await generate_one(theme_slug, asset_slug, desc, force):
                ok += 1
            await asyncio.sleep(0.3)
    print(f"\nDone. {ok}/{total} assets generated.")
    return 0 if ok == total else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("themes", nargs="*", help="theme slug(s); defaults to all")
    parser.add_argument("--force", action="store_true", help="regenerate existing PNGs")
    args = parser.parse_args()
    themes = args.themes or list(THEMES.keys())
    return asyncio.run(run(themes, args.force))


if __name__ == "__main__":
    sys.exit(main())
