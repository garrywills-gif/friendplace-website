"""Renderer — dispatches per (template, layout) to produce a print-ready PNG.

Design choice locked with Garry (3 Aug 2026):

  1. The existing PIL renderer at `server.py:admin_invite_flyer` is the
     SINGLE SOURCE OF TRUTH for the Founding Member design. We invoke
     it in-process to fetch the reference A4 render, then composite /
     scale for other layouts. Zero design duplication.

  2. For layouts SMALLER than A4 (A5 single, 2-up A5 on A4, 4-up A5 on
     A3), we downscale — this is loss-free in practice because we're
     shrinking a high-fidelity source.

  3. For layouts LARGER than A4 (A3 poster), we bicubic-upscale from
     the A4 base. This is a documented compromise: to get *native* A3
     pixel-perfect rendering we'd need to modify the existing PIL
     function to accept a size parameter. Garry chose to keep the
     existing renderer untouched. When we're ready to add a truly
     native A3 pipeline, the swap point is well-isolated: just change
     ``_render_founding_base_a4`` to accept a size and everything
     downstream benefits automatically.

  4. Multi-up layouts (2-up, 4-up) place tiled copies of the single
     flyer on a landscape sheet with crop marks so the sheet can be
     trimmed with a guillotine.

Public entry point: ``render_flyer(db, template_key, layout_key, params)``.
"""

from __future__ import annotations
import io
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

from PIL import Image, ImageDraw

from .registry import LAYOUTS, layout as layout_spec, LayoutSpec
from .templates import (
    COLL_FLYER_TEMPLATES,
    get_template,
    ENGINE_FOUNDING,
    ENGINE_STATIC_PDF,
)

logger = logging.getLogger("friendplace.flyers.renderer")


# ---------------------------------------------------------------------------
# Crop marks — thin corner marks at each tile boundary. Guillotines find
# them visually then trim; leaving a small "bleed" between tiles keeps
# the design edges safe if the cut wanders by a millimetre or two.
# ---------------------------------------------------------------------------
CROP_MARK_LEN_MM = 5.0     # length of each crop-mark line
CROP_MARK_OFFSET_MM = 1.5  # gap between the tile edge and the crop mark
CROP_MARK_WIDTH_PX = 2
CROP_MARK_COLOUR = (100, 116, 139)  # slate-500 — subtle so it doesn't fight the design


@dataclass
class RenderResult:
    """Everything the HTTP layer needs to send a response."""
    content: bytes
    media_type: str
    filename: str
    # A short human-readable summary of what was rendered — used by the
    # audit log and (later) George's confirmation messages.
    summary: str


# ---------------------------------------------------------------------------
# iter164y — bounded in-memory response cache for the founding-flyer engine.
# ---------------------------------------------------------------------------
# Motivation:
#   • Warm render: ~335 ms
#   • Cold render (fonts + qrcode + PIL fresh in memory): ~3 s locally, up
#     to 8-12 s observed on the Vercel-hosted admin against a freshly-woken
#     Emergent preview backend. That's tight against the 10 s per-attempt
#     retry-wrapper timeout on the front-end.
#   • The Publishing Centre editor re-fires a render on every keystroke.
#
# Shape:
#   • Simple {key: (expires_at, payload)} dict guarded by a lock.
#   • LRU eviction by insertion order when we exceed MAXLEN.
#   • TTL keeps stale QR codes / admin details from lingering forever.
#   • Cache is process-local; a Kubernetes rolling deploy or pod restart
#     transparently invalidates it. That's fine for a preview cache.
_RENDER_CACHE: "OrderedDict[Any, Any]" = None  # type: ignore[assignment]
_RENDER_CACHE_LOCK = None
_RENDER_CACHE_MAXLEN = 32
_RENDER_CACHE_TTL_SEC = 15 * 60

from collections import OrderedDict as _OD
from threading import Lock as _Lock
_RENDER_CACHE = _OD()  # type: OrderedDict[tuple, tuple]
_RENDER_CACHE_LOCK = _Lock()


def _render_cache_key(template_key: str, layout_key: str, params: Dict[str, Any]) -> tuple:
    """Canonicalise the render inputs into a hashable cache key.

    We stringify every value so that ``{"admin_id": "abc"}`` and
    ``{"admin_id": u"abc"}`` collapse to the same key. ``qr_code_id``
    is *included* because it materially changes the QR image pattern
    — but since the CMS front-end never supplies it, the auto-generated
    id is only baked into the cached bytes on the FIRST render; that's
    intentional (cheap consistency across an editing session).
    """
    keys = sorted((k, "" if v is None else str(v)) for k, v in (params or {}).items())
    return (template_key, layout_key, tuple(keys))


def _render_cache_get(key: tuple) -> Optional[Dict[str, Any]]:
    import time as _time
    with _RENDER_CACHE_LOCK:
        entry = _RENDER_CACHE.get(key)
        if entry is None:
            return None
        expires_at, payload = entry
        if expires_at < _time.time():
            _RENDER_CACHE.pop(key, None)
            return None
        # Touch for LRU behaviour.
        _RENDER_CACHE.move_to_end(key)
        return payload


def _render_cache_put(key: tuple, payload: Dict[str, Any]) -> None:
    import time as _time
    with _RENDER_CACHE_LOCK:
        _RENDER_CACHE[key] = (_time.time() + _RENDER_CACHE_TTL_SEC, payload)
        _RENDER_CACHE.move_to_end(key)
        while len(_RENDER_CACHE) > _RENDER_CACHE_MAXLEN:
            _RENDER_CACHE.popitem(last=False)


async def render_flyer(
    db,
    template_key: str,
    layout_key: str,
    params: Optional[Dict[str, Any]] = None,
) -> RenderResult:
    """Render a template at the requested layout.

    Parameters
    ----------
    db
        Motor client. Needed for the founding-flyer engine which
        looks up the sharing admin + the founder count.
    template_key
        Slug of a document in `flyer_templates`.
    layout_key
        Slug from `registry.LAYOUTS` (`poster_a4`, `flyer_a5_2up_a4`…).
    params
        Free-form dict; keys must match the template's `fields` schema.
        For the founding flyer that's `{admin_id, venue, url}`.
    """
    tpl = await get_template(db, template_key)
    if not tpl:
        raise ValueError(f"Template '{template_key}' not found")
    if tpl.get("status") == "archived":
        raise ValueError(f"Template '{template_key}' is archived")

    lay = layout_spec(layout_key)
    if layout_key not in tpl.get("supported_layouts", []):
        raise ValueError(
            f"Template '{template_key}' does not support layout '{layout_key}'. "
            f"Supported: {', '.join(tpl.get('supported_layouts', []))}."
        )

    params = params or {}
    engine = tpl.get("engine")

    # iter164y: bounded in-memory LRU response cache. Warm-render for
    # a founding_flyer_v1 A4 poster is ~335 ms, cold is ~3 s (fonts +
    # qrcode module + PIL fresh in memory). On the Vercel-hosted admin
    # site every keystroke in the flyer editor re-fires a render (same
    # AuthedFlyerImage effect), which used to fan out into a request
    # storm and blow past the 10 s per-attempt retry-wrapper timeout
    # → the browser eventually surfaced "The server took a moment too
    # long to respond." Caching identical (template, layout, params)
    # tuples for 15 min flips repeat renders to O(1) so the editor
    # UX stays responsive even under a cold-pod cold-start.
    cache_hit = None
    cache_key = None
    if engine == ENGINE_FOUNDING:
        cache_key = _render_cache_key(template_key, layout_key, params)
        cache_hit = _render_cache_get(cache_key)

    if cache_hit is not None:
        png_bytes = cache_hit["png_bytes"]
        media_type = cache_hit["media_type"]
        ext = cache_hit["ext"]
    elif engine == ENGINE_FOUNDING:
        png_bytes = await _render_founding(db, tpl, lay, params)
        media_type = "image/png"
        ext = "png"
        if cache_key is not None:
            _render_cache_put(cache_key, {
                "png_bytes": png_bytes,
                "media_type": media_type,
                "ext": ext,
            })
    elif engine == ENGINE_STATIC_PDF:
        png_bytes, media_type, ext = await _serve_static_pdf(tpl, lay)
    else:
        raise ValueError(f"Unknown flyer engine '{engine}'")

    # Best-effort audit: bump used_count so Mission Control shows how
    # popular each template is. Fire-and-forget — if the write fails
    # we still return the render.
    try:
        await db[COLL_FLYER_TEMPLATES].update_one(
            {"key": tpl["key"]},
            {"$inc": {"used_count": 1}, "$set": {"last_used_at": _iso_now()}},
        )
    except Exception:  # noqa: BLE001
        logger.exception("used_count bump failed for %s", tpl["key"])

    venue_hint = (params.get("venue") or "").strip()
    filename_stem = f"{tpl['key']}-{lay.key}"
    if venue_hint:
        # Same sanitisation as the legacy endpoint so Safari doesn't
        # append weird extensions.
        import re as _re
        safe = _re.sub(r"[^A-Za-z0-9._-]+", "-", venue_hint).strip("-")
        if safe:
            filename_stem = f"{filename_stem}-{safe}"
    filename = f"{filename_stem}.{ext}"

    summary = f"{tpl['name']} · {lay.label}"
    if venue_hint:
        summary += f" · {venue_hint}"

    return RenderResult(content=png_bytes, media_type=media_type,
                        filename=filename, summary=summary)


# ---------------------------------------------------------------------------
# Founding-flyer engine
# ---------------------------------------------------------------------------

async def _render_founding_base_a4(db, params: Dict[str, Any]) -> Image.Image:
    """Call the existing PIL renderer and return its A4 output as a PIL
    Image. This is the ONLY place that talks to the legacy renderer —
    if we ever add a native multi-size path, this is the swap point.
    """
    # Deferred import to avoid a circular dependency (server.py imports
    # this module during startup for seeding).
    from server import admin_invite_flyer
    admin_id = str(params.get("admin_id") or "").strip()
    if not admin_id:
        raise ValueError("founding-flyer render requires admin_id")
    venue = str(params.get("venue") or "").strip()[:80]
    url = str(params.get("url") or "").strip()
    # Attribution params — every new render gets a unique qr_code_id so
    # we can distinguish physical prints even when they point at the same
    # flyer template. `flyer_id` and `campaign_id` come from the caller
    # (CMS render endpoint) so ops can override defaults.
    import uuid as _uuid
    flyer_id = str(params.get("flyer_id") or params.get("template_key") or "").strip()
    qr_code_id = str(params.get("qr_code_id") or "").strip() or f"qr_{_uuid.uuid4().hex[:12]}"
    campaign_id = str(params.get("campaign_id") or "").strip()
    # iter164t: pipe the editable content overrides through to the
    # base PIL renderer so the Publishing Centre preview reflects
    # per-flyer headline / supporting text edits in real time.
    headline = str(params.get("headline") or "").strip()
    supporting_text = str(params.get("supporting_text") or "").strip()
    # iter164aa: `show_founding_member` toggles the yellow "BECOME A
    # FOUNDING MEMBER" ribbon at the bottom of the poster. Default
    # True at the renderer level preserves every existing legacy
    # caller (mobile app /admin/invite-flyer download link, invite
    # emails, etc.); the Publishing Centre editor overrides to False
    # for the pre-launch Register-Your-Interest flow. FastAPI's usual
    # bool coercion recognises "true"/"false"/"1"/"0"/"yes"/"no"; we
    # replicate it here for the internal callers.
    _sfm_raw = params.get("show_founding_member")
    if _sfm_raw is None or (isinstance(_sfm_raw, str) and not _sfm_raw.strip()):
        show_founding_member = True
    elif isinstance(_sfm_raw, bool):
        show_founding_member = _sfm_raw
    else:
        show_founding_member = str(_sfm_raw).strip().lower() in ("true", "1", "yes", "on")
    resp = await admin_invite_flyer(
        admin_id=admin_id,
        venue=venue,
        url=url,
        flyer_id=flyer_id,
        qr_code_id=qr_code_id,
        campaign_id=campaign_id,
        headline=headline,
        supporting_text=supporting_text,
        show_founding_member=show_founding_member,
    )
    # `resp` is a FastAPI Response; the raw PNG bytes are on `.body`.
    return Image.open(io.BytesIO(resp.body)).convert("RGB")


async def _render_founding(
    db,
    tpl: Dict[str, Any],  # noqa: ARG001 — tpl reserved for future per-template overrides
    lay: LayoutSpec,
    params: Dict[str, Any],
) -> bytes:
    """Turn the base A4 render into whichever layout was requested."""
    # Inject the template key as the default flyer_id so the QR carries
    # attribution even when the CMS caller doesn't pass one explicitly.
    if not params.get("flyer_id"):
        params = {**params, "flyer_id": tpl.get("key")}
    base = await _render_founding_base_a4(db, params)

    if lay.kind == "single":
        # Fit the base render onto a canvas at the layout's physical
        # size. Bicubic (Image.LANCZOS) for scaling — best perceptual
        # quality for both upscale and downscale.
        target = (lay.width_px, lay.height_px)
        scaled = _fit_preserving_aspect(base, target)
        out = Image.new("RGB", target, "#FFFFFF")
        off_x = (target[0] - scaled.size[0]) // 2
        off_y = (target[1] - scaled.size[1]) // 2
        out.paste(scaled, (off_x, off_y))
        return _to_png_bytes(out)

    # multi-up
    return _to_png_bytes(_compose_multi_up(base, lay))


def _fit_preserving_aspect(img: Image.Image, target: tuple) -> Image.Image:
    """Resize `img` to fit inside `target` (w, h) without stretching."""
    tw, th = target
    iw, ih = img.size
    scale = min(tw / iw, th / ih)
    nw, nh = max(1, int(iw * scale)), max(1, int(ih * scale))
    return img.resize((nw, nh), Image.LANCZOS)


def _compose_multi_up(base: Image.Image, lay: LayoutSpec) -> Image.Image:
    """Tile `base` across `lay.tiles_across × lay.tiles_down` and add
    crop marks. Deliberately draws crop marks OUTSIDE the tiles (in a
    small bleed strip) so they don't intrude on the design itself.
    """
    canvas = Image.new("RGB", (lay.width_px, lay.height_px), "#FFFFFF")
    draw = ImageDraw.Draw(canvas)

    # Each tile is the sheet dimension / grid dimension. This
    # naturally divides the sheet edge-to-edge — no per-tile margins.
    # If you want visible white margins between tiles later, tweak
    # `margin_mm` and shrink the tile before pasting.
    tile_w = lay.width_px // lay.tiles_across
    tile_h = lay.height_px // lay.tiles_down

    # Fit base into a tile-sized rectangle preserving aspect (A5 has
    # the same aspect as A4, so we won't add letterboxing on our
    # supported layouts — but this guards future D-L / postcard sizes).
    tile_img = _fit_preserving_aspect(base, (tile_w, tile_h))
    off_dx = (tile_w - tile_img.size[0]) // 2
    off_dy = (tile_h - tile_img.size[1]) // 2

    for row in range(lay.tiles_down):
        for col in range(lay.tiles_across):
            x = col * tile_w
            y = row * tile_h
            canvas.paste(tile_img, (x + off_dx, y + off_dy))

    if lay.crop_marks:
        _draw_crop_marks(draw, lay, tile_w, tile_h)

    return canvas


def _draw_crop_marks(draw: ImageDraw.ImageDraw, lay: LayoutSpec,
                     tile_w: int, tile_h: int) -> None:
    """Draw thin corner marks at every tile boundary. See CROP_MARK_*
    constants at the top of the module for tunables."""
    from .registry import _mm_to_px
    mark = _mm_to_px(CROP_MARK_LEN_MM)
    gap = _mm_to_px(CROP_MARK_OFFSET_MM)

    for row in range(lay.tiles_down + 1):
        for col in range(lay.tiles_across + 1):
            cx = col * tile_w
            cy = row * tile_h
            # For each of the four crop-mark "arms" around this
            # vertex, draw a short line offset by `gap` from the
            # intersection so the mark sits in the bleed strip.
            #  ─  arm to the LEFT
            if col > 0:
                draw.line(
                    [(cx - gap - mark, cy), (cx - gap, cy)],
                    fill=CROP_MARK_COLOUR, width=CROP_MARK_WIDTH_PX,
                )
            #  ─  arm to the RIGHT
            if col < lay.tiles_across:
                draw.line(
                    [(cx + gap, cy), (cx + gap + mark, cy)],
                    fill=CROP_MARK_COLOUR, width=CROP_MARK_WIDTH_PX,
                )
            #  │  arm going UP
            if row > 0:
                draw.line(
                    [(cx, cy - gap - mark), (cx, cy - gap)],
                    fill=CROP_MARK_COLOUR, width=CROP_MARK_WIDTH_PX,
                )
            #  │  arm going DOWN
            if row < lay.tiles_down:
                draw.line(
                    [(cx, cy + gap), (cx, cy + gap + mark)],
                    fill=CROP_MARK_COLOUR, width=CROP_MARK_WIDTH_PX,
                )


# ---------------------------------------------------------------------------
# Static-PDF engine — serves pre-generated PDFs from
# /app/website/public/flyer-mockups/ so the mockups Garry provided become
# real, downloadable, printable flyers with zero extra work.
# ---------------------------------------------------------------------------

STATIC_PDF_ROOT = "/app/website/public/flyer-mockups"


async def _serve_static_pdf(tpl: Dict[str, Any], lay: LayoutSpec) -> tuple:
    """Return (bytes, media_type, extension) for a static-PDF template."""
    mapping: Dict[str, str] = tpl.get("static_assets") or {}
    asset = mapping.get(lay.key)
    if not asset:
        # Fall back to the A4 PDF if the specific layout wasn't mapped —
        # every static template ships at least the A4 flavour.
        asset = mapping.get("poster_a4") or "download-a4.pdf"
    path = os.path.join(STATIC_PDF_ROOT, asset)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Static flyer asset missing: {path}")
    with open(path, "rb") as fh:
        data = fh.read()
    # PDF → we set the correct media type so the print dialogue on the
    # frontend can either embed via <iframe> for print or trigger a
    # download.
    if asset.lower().endswith(".pdf"):
        return data, "application/pdf", "pdf"
    return data, "image/png", "png"


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
