"""PDF export helper for flyers (Garry, iter159 marketing launch).

Design goal: attach flyers to outbound marketing emails as a proper
PDF, without touching the PNG renderer that Garry explicitly wanted
left alone. This module is a THIN adapter — it takes the PNG bytes
already produced by `services.flyers.renderer.render_flyer` and wraps
them in a single-page PDF sized to the layout's real paper size.

Why not use PIL's built-in `Image.save(..., format='PDF')`?
    That works, but PIL emits the PDF at the image's pixel dimensions
    interpreted as points (1 pt = 1/72 in). Our PNG source is 300 DPI,
    so a naive save produces a giant multi-metre "page" that print
    dialogs handle awkwardly. We compute the true paper size from the
    layout registry and pass it explicitly so the PDF page matches
    what the printer expects (A4, A3, etc.).

Static-PDF templates (engine=static_pdf) skip this path — the render
endpoint already returns their bytes as `application/pdf` untouched.
"""
from __future__ import annotations

import io
import logging
from typing import Tuple

from PIL import Image

from .registry import layout as layout_spec

logger = logging.getLogger("friendplace.flyers.pdf_export")


# 1 point = 1/72 inch. PIL's PDF encoder measures pages in points.
_POINTS_PER_INCH = 72.0


def _mm_to_points(mm: float) -> float:
    return (mm / 25.4) * _POINTS_PER_INCH


def png_bytes_to_pdf_bytes(png_bytes: bytes, layout_key: str) -> Tuple[bytes, str]:
    """Convert PNG bytes to a single-page PDF sized for the given layout.

    Returns (pdf_bytes, filename_ext). The ext is always ``pdf``.

    Falls back to a "PIL-native" save if the layout registry can't
    resolve the layout — better a slightly-off PDF than a 500 error
    on the email send path.
    """
    lay = None
    try:
        lay = layout_spec(layout_key)
    except Exception:  # noqa: BLE001
        logger.exception("layout_spec(%r) failed; falling back to PIL-native PDF", layout_key)

    with Image.open(io.BytesIO(png_bytes)) as im:
        # PIL's PDF encoder needs an RGB image (drops alpha).
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")

        buf = io.BytesIO()
        save_kwargs: dict = {"format": "PDF", "resolution": 300.0}
        if lay is not None:
            # Cast the PIL image onto a canvas sized to the paper
            # dimensions in POINTS. PIL scales the image to fit the
            # canvas — using resolution=300 hints the DPI that
            # readers should assume when computing physical size.
            width_mm = float(getattr(lay, "width_mm", 0) or 0)
            height_mm = float(getattr(lay, "height_mm", 0) or 0)
            if width_mm > 0 and height_mm > 0:
                # Pillow >=9 supports the `pagesize` param through the
                # low-level PdfParser, but the public API only respects
                # image DPI. We work with DPI: set the resolution so
                # that (px / dpi * 72) == desired points.
                px_w, px_h = im.size
                dpi_w = px_w / (width_mm / 25.4)
                dpi_h = px_h / (height_mm / 25.4)
                # Use the smaller of the two to keep aspect intact —
                # our renderer already renders in-aspect, so both are
                # nearly identical in practice.
                dpi = min(dpi_w, dpi_h)
                if dpi > 0:
                    save_kwargs["resolution"] = float(dpi)
        im.save(buf, **save_kwargs)
        return buf.getvalue(), "pdf"


__all__ = ["png_bytes_to_pdf_bytes"]
