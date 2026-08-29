"""One-shot generator for FriendPlace pre-launch bundled assets.

Generates 24 photographic adult portrait avatars + 33 gallery photos
(11 themes × 3 photos each) via Gemini Nano Banana using the Emergent
LLM key. All outputs land under /app/frontend/assets/{avatars,gallery}
so the mobile app can `require()` them directly.

Delete after the launch batch has been reviewed and wired.

Usage:  python /app/scripts/generate_launch_assets.py

Design notes:
* Prompts baked in with a shared "credible / natural / no-logo / no-cartoon"
  guardrail so each image lands in the same visual register.
* Runs sequentially with a small delay between calls to avoid rate-limit
  spikes. Total wall time ~10–15 minutes for 57 images.
* Emits a progress log so a background run can be inspected with `tail -f`.
* Idempotent: if the target file already exists AND is non-empty, we skip
  that generation. Safe to resume after a crash / interrupt.
* After all images land, generates a contact sheet HTML page at
  /app/scripts/contact_sheet.html so the user can eyeball everything
  in one view before we wire it into the app.
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

# Load backend .env (where EMERGENT_LLM_KEY lives).
load_dotenv("/app/backend/.env")

try:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
except ImportError:
    print("emergentintegrations not installed — install with:\n"
          "  pip install emergentintegrations --extra-index-url "
          "https://d33sy5i8bnduwe.cloudfront.net/simple/")
    sys.exit(1)

API_KEY = os.getenv("EMERGENT_LLM_KEY")
if not API_KEY:
    print("EMERGENT_LLM_KEY missing from /app/backend/.env")
    sys.exit(1)

MODEL_ID = "gemini-3.1-flash-image-preview"  # Nano Banana latest
DELAY_BETWEEN_CALLS_S = 1.0  # small breather between requests

AVATAR_DIR = Path("/app/frontend/assets/avatars")
GALLERY_DIR = Path("/app/frontend/assets/gallery")
CONTACT_SHEET = Path("/app/scripts/contact_sheet.html")

# ---------- Shared style guardrail ----------
# Baked into every prompt so the whole set reads as one cohesive
# photographic library. Written in imperative photo-briefing voice so
# Nano Banana grounds on it strongly.
STYLE_BASE = (
    "Photorealistic documentary-style photograph shot in Australia. Feels "
    "locally made, editorial rather than corporate stock. Natural warm "
    "daylight, soft depth of field, authentic candid moment. Believable "
    "everyday Australian setting — suburban backyard, country town, local "
    "park, community hall, coastal or bushland outskirts — with subtle "
    "regional cues (gum trees, weatherboard or brick homes, corrugated "
    "iron, Hills-Hoist-era backyards, Australian native plants) where "
    "the scene naturally allows. Warm friendly tone, modern-but-timeless "
    "mature palette. Absolutely no logos, no visible brand names, no "
    "watermarks, no text on clothing, no signage. No cartoon or "
    "illustration styling, no plastic or over-smoothed skin, no "
    "AI-glossy look, no generic corporate stock feel, no obviously "
    "American or European setting. Composition suitable as a bundled "
    "mobile-app asset for a friendly Australian over-50s community."
)

# ---------- Avatar prompts (24) ----------
# Diverse in age, gender presentation and heritage. Each subject: warm
# expression, shoulder-up framing, soft neutral or plainly-blurred
# background, no props, no branded clothing.
AVATAR_PROMPT_TAIL = (
    "Shoulder-up portrait, soft evenly-blurred neutral background, subject "
    "faces the camera with a warm natural expression, no glasses unless "
    "described, no jewellery beyond a small plain wedding band, no logos, "
    "no visible tattoos. Square 1:1 crop. Skin texture natural, hair "
    "realistic, catchlights in the eyes."
)


@dataclass
class Prompt:
    filename: str
    subject: str            # concise brief for the sitter
    tail: str = AVATAR_PROMPT_TAIL

    def full(self) -> str:
        return f"{self.subject} {self.tail} {STYLE_BASE}"


AVATARS: list[Prompt] = [
    # ── 50s (6) ──────────────────────────────────────────────────────────
    Prompt("portrait-01.jpg", "An Anglo-Australian woman in her early 50s with shoulder-length wavy brown hair with subtle grey streaks, warm easy smile, wearing a soft teal linen shirt."),
    Prompt("portrait-02.jpg", "A Torres Strait Islander man in his mid 50s with short salt-and-pepper hair and neatly trimmed beard, kind eyes, gentle smile, wearing an olive henley."),
    Prompt("portrait-03.jpg", "A Chinese-Australian woman in her late 50s with straight chin-length black hair with grey at the temples, thoughtful warm expression, wearing a mustard cardigan over a cream blouse."),
    Prompt("portrait-04.jpg", "A Lebanese-Australian man in his early 50s with wavy dark hair, close-trimmed beard, warm confident smile, wearing a navy button-up."),
    Prompt("portrait-05.jpg", "A Fijian-Australian woman in her mid 50s with natural coily hair, warm broad smile, wearing a rust-red linen top."),
    Prompt("portrait-06.jpg", "An Indian-Australian man in his late 50s with short black hair greying at temples and a well-groomed moustache, calm friendly expression, wearing a soft grey polo."),
    # ── 60s (6) ──────────────────────────────────────────────────────────
    Prompt("portrait-07.jpg", "An Aboriginal Australian woman in her early 60s with silver-streaked curly dark hair, warm dignified smile, wearing a burnt-orange knit."),
    Prompt("portrait-08.jpg", "A Greek-Australian man in his mid 60s with a full head of grey hair and short beard, gentle crinkled-eye smile, wearing a soft blue chambray shirt."),
    Prompt("portrait-09.jpg", "A Vietnamese-Australian woman in her late 60s with short silver bob and reading glasses, quiet warm smile, wearing a moss-green blouse."),
    Prompt("portrait-10.jpg", "An African-Australian man in his early 60s with close-cropped grey hair and short beard, cheerful open smile, wearing a warm terracotta jumper."),
    Prompt("portrait-11.jpg", "A Northern-European Australian woman in her mid 60s with short silver-blonde hair, laugh lines, warm easy smile, wearing a soft cream cable-knit."),
    Prompt("portrait-12.jpg", "A Filipino-Australian man in his late 60s with grey hair and a neat moustache, gentle contemplative smile, wearing a dark teal polo shirt."),
    # ── 70s (6) ──────────────────────────────────────────────────────────
    Prompt("portrait-13.jpg", "An Italian-Australian woman in her early 70s with silver hair pulled softly back, warm expressive eyes, small smile, wearing a plum cardigan."),
    Prompt("portrait-14.jpg", "A Māori-Australian man in his mid 70s with silver hair and warm laugh lines, calm dignified smile, wearing a heather-grey henley."),
    Prompt("portrait-15.jpg", "A South Sudanese-Australian woman in her late 70s with silver braided hair tucked in a low bun, quiet warm smile, wearing a soft aubergine blouse."),
    Prompt("portrait-16.jpg", "An Aboriginal Australian man in his early 70s with silver-white hair and short white beard, kind eyes, gentle smile, wearing a soft sage shirt."),
    Prompt("portrait-17.jpg", "A Japanese-Australian woman in her mid 70s with short silver hair and rimless glasses, gentle warm smile, wearing a cream knit."),
    Prompt("portrait-18.jpg", "An Irish-Australian man in his late 70s with fine white hair and clean-shaven, warm crinkled-eye smile, wearing a navy shawl-collar cardigan."),
    # ── 80s (6) ──────────────────────────────────────────────────────────
    Prompt("portrait-19.jpg", "A Polish-Australian woman in her early 80s with soft white curls and reading glasses on a chain, gentle warm smile, wearing a dusty-rose knit."),
    Prompt("portrait-20.jpg", "A Chinese-Australian man in his mid 80s with fine silver hair, quiet warm smile, wearing a soft grey collared shirt."),
    Prompt("portrait-21.jpg", "A First Nations Australian woman in her late 80s with silver-white plaited hair, deeply warm knowing smile, wearing an ochre-toned wrap."),
    Prompt("portrait-22.jpg", "A Dutch-Australian man in his early 80s with white hair and a neat white moustache, gentle cheerful smile, wearing a soft blue jumper."),
    Prompt("portrait-23.jpg", "A Sri Lankan-Australian woman in her mid 80s with silver hair pulled back and warm dark eyes, softly smiling, wearing a teal-and-cream tunic."),
    Prompt("portrait-24.jpg", "A Scottish-Australian man in his late 80s with fine white hair and light freckles, gentle warm smile, wearing a soft charcoal cardigan."),
]

# ---------- Gallery prompts (33) ----------
# 11 themes × 3 photographs. Every theme brief is written to feel like
# a real Australian community moment, not a stock-photo tableau.
GALLERY_PROMPT_TAIL = (
    "Landscape orientation, roughly 3:2 ratio, no overlay text, no logos, no "
    "brand names on cups, signs or clothing, no watermarks. Candid, "
    "documentary feel — like something a local Australian photographer would "
    "post to their neighbourhood page, not a stock library. Modest natural "
    "expressions on any people (no theatrical grins, no clipboards, no "
    "posed thumbs-up). Focus on the moment, not on the subjects' faces. "
    "Ages of any depicted people skew older adult / mid-life, in line "
    "with a community platform for over-50s. Believably Australian — "
    "clothing, homes, landscape and props should read as local, never "
    "American or European suburbia."
)


@dataclass
class GalleryItem:
    theme_slug: str
    filename: str
    subject: str

    def full(self) -> str:
        return f"{self.subject} {GALLERY_PROMPT_TAIL} {STYLE_BASE}"


GALLERY: list[GalleryItem] = [
    # ── 1. BBQs & sausage sizzles ────────────────────────────────────────
    GalleryItem("bbqs-sausage-sizzles", "01.jpg", "An Australian backyard BBQ with a plain hotplate, sausages and onions cooking, tongs in hand, blurred backyard beyond, no logos on the BBQ."),
    GalleryItem("bbqs-sausage-sizzles", "02.jpg", "A classic Aussie sausage sizzle setup outside a community hall — sausages and onions on a plain flat-top hotplate, a stack of plain white bread slices and tomato sauce bottle to the side, no branded signage."),
    GalleryItem("bbqs-sausage-sizzles", "03.jpg", "A small group of older adults gathered around an outdoor BBQ in a suburban backyard, plates in hand, warm early-evening light, faces mostly turned away or in soft focus."),
    # ── 2. Bush walks & walking groups ───────────────────────────────────
    GalleryItem("bush-walks-walking-groups", "01.jpg", "Two older adults walking side-by-side along a bushland track under gum trees, backs mostly to camera, comfortable walking shoes, dappled morning light."),
    GalleryItem("bush-walks-walking-groups", "02.jpg", "A small walking group of five or six older Australians in wide-brimmed hats and daypacks striding along a wide bush track, warm morning light through the canopy, no visible branding."),
    GalleryItem("bush-walks-walking-groups", "03.jpg", "A community walking group pausing at a bushland lookout — older adults chatting, water bottles in hand, distant blue-green ridgeline behind, natural morning light."),
    # ── 3. Garage sales ──────────────────────────────────────────────────
    GalleryItem("garage-sales", "01.jpg", "A friendly suburban garage sale — folding tables in a driveway with books, homewares and vintage crockery, no branded signage, older woman browsing, warm morning light."),
    GalleryItem("garage-sales", "02.jpg", "A close-up of a wooden trestle table at a garage sale — vintage teacups, a stack of paperbacks and a small ceramic vase, handwritten paper price tags, no logos."),
    GalleryItem("garage-sales", "03.jpg", "A driveway garage sale scene — an older couple setting out boxes of homewares and a rack of jackets, morning sun on a leafy suburban street, no branded materials visible."),
    # ── 4. Fêtes, fairs & cake stalls ────────────────────────────────────
    GalleryItem("fetes-fairs-cake-stalls", "01.jpg", "A charming community cake stall at a country fête — plain white platters of home-baked lamingtons, sponge cakes and slices under an open-sided marquee, handwritten paper labels, no branded packaging."),
    GalleryItem("fetes-fairs-cake-stalls", "02.jpg", "A wide shot of a small-town community fête on a village green — striped fabric bunting, a few unbranded marquees, older adults browsing, warm afternoon light, no readable signage."),
    GalleryItem("fetes-fairs-cake-stalls", "03.jpg", "A close-up of home-baked scones with jam and cream on a plain white cake stand at a church-hall fête, blurred bunting and marquee behind, warm daylight."),
    # ── 5. Coffee catch-ups ──────────────────────────────────────────────
    GalleryItem("coffee-catchups", "01.jpg", "Two friends in their sixties sitting across from each other at a small café table, mid-conversation, mugs of coffee between them, cropped so faces are partially visible, warm afternoon light."),
    GalleryItem("coffee-catchups", "02.jpg", "A pair of hands cradling a plain white cup of flat white coffee on a wooden café table, a small biscuit on a saucer beside it, blurred café interior in background."),
    GalleryItem("coffee-catchups", "03.jpg", "Three older women laughing gently at an outdoor café table with plain white cups, viewed from a slight distance so faces are soft."),
    # ── 6. Book clubs & reading groups ───────────────────────────────────
    GalleryItem("book-clubs-reading-groups", "01.jpg", "A close-up of a well-loved paperback book open on a wooden table beside a mug of tea, reading glasses folded to one side, warm window light."),
    GalleryItem("book-clubs-reading-groups", "02.jpg", "A cosy book-club scene — three older women seated in a living-room circle each holding a paperback, mid-discussion, cups of tea on a coffee table, soft lamp-light."),
    GalleryItem("book-clubs-reading-groups", "03.jpg", "A small reading group of four older adults sitting around a wooden library table with paperbacks and notebooks, gentle conversation, natural window light, no visible signage or logos."),
    # ── 7. Gardening & garden groups ─────────────────────────────────────
    GalleryItem("gardening-garden-groups", "01.jpg", "Older Australian gardener's hands in soil planting a small tomato seedling, terracotta pots to the side, natural sunlight."),
    GalleryItem("gardening-garden-groups", "02.jpg", "A community garden — raised timber beds with silverbeet, herbs and cherry tomatoes, two older adults tending the beds together in wide-brimmed hats, warm morning light."),
    GalleryItem("gardening-garden-groups", "03.jpg", "A small garden club gathered around a rose bush in a suburban garden — three older women in gardening gloves and hats sharing pruning tips, warm afternoon light, no branded gardening gear."),
    # ── 8. Pets & dog meet-ups ───────────────────────────────────────────
    GalleryItem("pets-dog-meetups", "01.jpg", "A friendly older adult sitting on a park bench with a medium-sized brown mixed-breed dog beside them, hand resting on the dog, blurred park background."),
    GalleryItem("pets-dog-meetups", "02.jpg", "A casual off-leash-park dog meet-up — three or four medium dogs of different breeds playing together on grass, older-adult owners chatting in the background, warm late-afternoon light."),
    GalleryItem("pets-dog-meetups", "03.jpg", "Two older Australians walking a Labrador and a small terrier along a suburban footpath at dusk, leads in hand, jacarandas overhead."),
    # ── 9. Classic cars & car meets ──────────────────────────────────────
    GalleryItem("classic-cars-car-meets", "01.jpg", "A restored vintage Holden-style Australian sedan parked on a country road at dusk, three-quarter view, warm golden hour light, no visible branding or emblems."),
    GalleryItem("classic-cars-car-meets", "02.jpg", "A small classic-car meet on a country oval — four or five restored vintage cars parked in a neat row on grass, bonnets open, older adults inspecting engines and chatting, warm afternoon light, no branded signage."),
    GalleryItem("classic-cars-car-meets", "03.jpg", "A close-up detail of a vintage car's polished chrome side-mirror and cream paintwork, no logos visible, soft outdoor light."),
    # ── 10. Social get-togethers ─────────────────────────────────────────
    # Catch-all A: lunches, casual gatherings, picnics.
    GalleryItem("social-get-togethers", "01.jpg", "A long timber outdoor table set for a casual family lunch — plain white plates, salad bowls, a jug of water and bread rolls, older adults seated around it mid-conversation, warm afternoon light, no branded packaging."),
    GalleryItem("social-get-togethers", "02.jpg", "An outdoor picnic on a grassy park lawn — a picnic rug with a wicker basket, thermos, sandwiches on a plain plate, two older adults sitting beside it chatting, dappled tree light."),
    GalleryItem("social-get-togethers", "03.jpg", "A living-room gathering with older adults sitting on couches with cups of tea and biscuits on a coffee table, warm lamp-lit ambience."),
    # ── 11. Community activities ─────────────────────────────────────────
    # Catch-all B: local halls, craft groups, markets, neighbourhood
    # activities.
    GalleryItem("community-activities", "01.jpg", "A small craft-group scene inside a community hall — three older women seated at a table knitting and crocheting together, baskets of yarn between them, warm afternoon light through hall windows, no branded materials."),
    GalleryItem("community-activities", "02.jpg", "The forecourt of a small Australian community centre or neighbourhood hall — brick building, a few older adults chatting near the doorway, no branded signage visible, warm afternoon light."),
    GalleryItem("community-activities", "03.jpg", "A neighbourhood weekend market on a suburban street — a few unbranded trestle-table stalls selling homemade jams, potted seedlings and hand-crafted homewares, older adults browsing, warm morning light."),
]


async def generate_one(prompt: str, out: Path) -> bool:
    """Generate a single image, return True on success. Skips if the
    output file already exists and is non-empty."""
    if out.exists() and out.stat().st_size > 1024:
        print(f"  ✓ SKIP (already exists) {out.name}")
        return True
    out.parent.mkdir(parents=True, exist_ok=True)
    session_id = f"asset-gen-{out.stem}-{int(time.time())}"
    chat = LlmChat(
        api_key=API_KEY,
        session_id=session_id,
        system_message="You are a professional photographic asset generator.",
    )
    chat.with_model("gemini", MODEL_ID).with_params(modalities=["image", "text"])
    msg = UserMessage(text=prompt)
    try:
        _text, images = await chat.send_message_multimodal_response(msg)
    except Exception as e:
        print(f"  ✗ ERROR {out.name}: {e}")
        return False
    if not images:
        print(f"  ✗ EMPTY {out.name} — no image returned")
        return False
    img = images[0]
    try:
        data = base64.b64decode(img["data"])
        out.write_bytes(data)
        print(f"  ✓ {out.name} ({len(data) // 1024} KB)")
        return True
    except Exception as e:
        print(f"  ✗ SAVE ERROR {out.name}: {e}")
        return False


def build_contact_sheet(avatar_files: list[Path], gallery_map: dict[str, list[Path]]) -> None:
    """Emit an HTML contact sheet showing every generated asset so the
    user can eyeball the whole batch in one page before we wire it in."""
    parts: list[str] = []
    parts.append("<!doctype html><html><head><meta charset='utf-8'>")
    parts.append("<title>FriendPlace Launch Assets — Contact Sheet</title>")
    parts.append("<style>"
                 "body{font-family:-apple-system,Segoe UI,sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:24px}"
                 "h1{color:#5EEAD4;margin:0 0 4px}"
                 "h2{color:#93C5FD;margin:28px 0 8px;font-size:20px}"
                 "h3{color:#F5D0B0;margin:20px 0 6px;font-size:15px;letter-spacing:.3px;text-transform:uppercase}"
                 ".sub{color:#94A3B8;margin-bottom:20px}"
                 ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}"
                 ".cell{background:#1E293B;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.3)}"
                 ".cell img{width:100%;display:block;aspect-ratio:1/1;object-fit:cover}"
                 ".gallery .cell img{aspect-ratio:3/2}"
                 ".cell .label{padding:6px 8px;font-size:11px;color:#CBD5E1}"
                 "</style></head><body>")
    parts.append("<h1>🦋 FriendPlace launch asset contact sheet</h1>")
    parts.append("<div class='sub'>24 photorealistic avatars + 33 gallery photos "
                 "(11 themes × 3). All community-oriented, no logos, no cartoons. "
                 "Approve or flag any you'd like re-generated before we wire.</div>")

    parts.append("<h2>Avatars (24)</h2><div class='grid'>")
    for p in avatar_files:
        rel = str(p.resolve())
        parts.append(f"<div class='cell'><img src='file://{rel}'/><div class='label'>{p.name}</div></div>")
    parts.append("</div>")

    theme_labels = {
        "bbqs-sausage-sizzles": "BBQs & sausage sizzles",
        "bush-walks-walking-groups": "Bush walks & walking groups",
        "garage-sales": "Garage sales",
        "fetes-fairs-cake-stalls": "Fêtes, fairs & cake stalls",
        "coffee-catchups": "Coffee catch-ups",
        "book-clubs-reading-groups": "Book clubs & reading groups",
        "gardening-garden-groups": "Gardening & garden groups",
        "pets-dog-meetups": "Pets & dog meet-ups",
        "classic-cars-car-meets": "Classic cars & car meets",
        "social-get-togethers": "Social get-togethers",
        "community-activities": "Community activities",
    }
    parts.append("<h2>Gallery (33)</h2>")
    for slug, files in gallery_map.items():
        parts.append(f"<h3>{theme_labels.get(slug, slug)}</h3>")
        parts.append("<div class='grid gallery'>")
        for p in files:
            rel = str(p.resolve())
            parts.append(f"<div class='cell'><img src='file://{rel}'/><div class='label'>{slug}/{p.name}</div></div>")
        parts.append("</div>")

    parts.append("</body></html>")
    CONTACT_SHEET.write_text("".join(parts))
    print(f"\n📸  Contact sheet:  {CONTACT_SHEET}")


async def main() -> None:
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    total = len(AVATARS) + len(GALLERY)
    idx = 0

    print(f"Generating {total} launch assets via Nano Banana ({MODEL_ID}) …\n")

    # Avatars
    print("── Avatars ──")
    avatar_files: list[Path] = []
    for p in AVATARS:
        idx += 1
        out = AVATAR_DIR / p.filename
        print(f"[{idx}/{total}] {p.filename}")
        ok = await generate_one(p.full(), out)
        if ok:
            avatar_files.append(out)
        await asyncio.sleep(DELAY_BETWEEN_CALLS_S)

    # Gallery
    print("\n── Gallery ──")
    gallery_map: dict[str, list[Path]] = {}
    for g in GALLERY:
        idx += 1
        out = GALLERY_DIR / g.theme_slug / g.filename
        print(f"[{idx}/{total}] {g.theme_slug}/{g.filename}")
        ok = await generate_one(g.full(), out)
        if ok:
            gallery_map.setdefault(g.theme_slug, []).append(out)
        await asyncio.sleep(DELAY_BETWEEN_CALLS_S)

    # Contact sheet — only include what actually landed, in stable order.
    print("\nBuilding contact sheet …")
    theme_order = [
        "bbqs-sausage-sizzles", "bush-walks-walking-groups", "garage-sales",
        "fetes-fairs-cake-stalls", "coffee-catchups",
        "book-clubs-reading-groups", "gardening-garden-groups",
        "pets-dog-meetups", "classic-cars-car-meets",
        "social-get-togethers", "community-activities",
    ]
    gallery_map_ordered = {
        slug: sorted(gallery_map.get(slug, []))
        for slug in theme_order
        if slug in gallery_map
    }
    build_contact_sheet(sorted(avatar_files), gallery_map_ordered)

    # Summary line for tail -f watchers.
    ok_count = len(avatar_files) + sum(len(v) for v in gallery_map.values())
    print(f"\n✅ Done — {ok_count}/{total} assets on disk.")


if __name__ == "__main__":
    asyncio.run(main())
