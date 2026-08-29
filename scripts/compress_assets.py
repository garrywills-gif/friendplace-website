"""Compress launch assets to bundle-friendly sizes.

Avatars: PNG 1024x1024 -> JPEG 512x512 @ ~78% quality.
Gallery: JPEG ~1264x848 -> JPEG 1024x683 @ ~78% quality.

Overwrites the source files with the compressed versions so the app
requires the same paths but ships far smaller assets.
"""
from pathlib import Path
from PIL import Image
import shutil

AV_DIR = Path("/app/frontend/assets/avatars/presets")
GAL_DIR = Path("/app/frontend/assets/gallery")

def compress_avatar(src: Path) -> tuple[int, int]:
    before = src.stat().st_size
    with Image.open(src) as im:
        im = im.convert("RGB")
        im.thumbnail((512, 512), Image.LANCZOS)
    # Save as .jpg alongside; remove the .png.
    dst = src.with_suffix(".jpg")
    im.save(dst, "JPEG", quality=82, optimize=True, progressive=True)
    if dst != src:
        src.unlink()
    return before, dst.stat().st_size

def compress_gallery(src: Path) -> tuple[int, int]:
    before = src.stat().st_size
    with Image.open(src) as im:
        im = im.convert("RGB")
        # Preserve aspect within max 1024x683
        im.thumbnail((1024, 683), Image.LANCZOS)
    im.save(src, "JPEG", quality=80, optimize=True, progressive=True)
    return before, src.stat().st_size

# ---- Avatars ----
av_files = sorted(AV_DIR.glob("portrait-*.png"))
print(f"Compressing {len(av_files)} avatars…")
av_before = av_after = 0
for p in av_files:
    b, a = compress_avatar(p)
    av_before += b; av_after += a
print(f"  Avatars: {av_before//1024} KB -> {av_after//1024} KB  ({(av_after*100//av_before)}%)")

# ---- Gallery ----
gal_files = sorted(GAL_DIR.rglob("*.jpg"))
print(f"Compressing {len(gal_files)} gallery images…")
gal_before = gal_after = 0
for p in gal_files:
    b, a = compress_gallery(p)
    gal_before += b; gal_after += a
print(f"  Gallery: {gal_before//1024} KB -> {gal_after//1024} KB  ({(gal_after*100//gal_before)}%)")

print(f"\nTotal on disk after compression:")
def du(path):
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
print(f"  avatars/presets: {du(AV_DIR)//1024} KB")
print(f"  gallery:         {du(GAL_DIR)//1024} KB")
