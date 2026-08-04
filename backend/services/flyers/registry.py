"""Layout registry — data-driven, add layouts without code changes.

Every entry describes ONE print-ready output. Both single-flyer layouts
(A3/A4/A5) and multi-up letterbox layouts (2-up A5 on A4, 4-up A5 on A3)
are described in the same shape.

Sizing convention:
  • Physical size is stored in MILLIMETRES so it's paper-accurate.
  • The renderer converts to pixels at `PRINT_DPI` (150 dpi by default)
    when producing the PNG for browser print.
  • Browsers use the `@page { size: … }` CSS rule to tell the printer
    the physical paper size — so even a 150-dpi PNG prints crisply
    at any physical size the printer supports.

Adding a new layout later (Garry, 3 Aug 2026):
  • DL flyer → add `dl` with width_mm=99, height_mm=210, kind="single".
  • Postcard → add `postcard_a6` with width_mm=105, height_mm=148,
    kind="single".
  • Both immediately appear in the Mission Control UI's layout picker
    without any code change.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Literal, Optional, Dict


# 150 dpi is the sweet spot for community-poster print quality — crisp
# enough for the QR to scan reliably at 30 cm reading distance while
# keeping the PNG payload under ~1 MB even for A3.
PRINT_DPI = 150


def _mm_to_px(mm: float) -> int:
    """Convert physical millimetres to pixels at the print DPI."""
    return round(mm / 25.4 * PRINT_DPI)


@dataclass(frozen=True)
class CategorySpec:
    """A grouping in the layout picker UI ("Standard Posters", "Letterbox…")."""
    key: str
    label: str
    description: str
    order: int


CATEGORIES: Dict[str, CategorySpec] = {
    "poster": CategorySpec(
        key="poster",
        label="Standard Posters",
        description="For community noticeboards, libraries, and shopping centres.",
        order=1,
    ),
    "flyer": CategorySpec(
        key="flyer",
        label="Letterbox Flyers",
        description="For letterbox drops, community handouts, and clubs.",
        order=2,
    ),
}


@dataclass(frozen=True)
class LayoutSpec:
    """One print-ready output shape.

    Attributes
    ----------
    key
        Stable slug used in URLs and Mongo (`poster_a3`, `flyer_a5_2up_a4`…).
    label
        Human-readable name shown in the picker ("A3 Poster", "2-up A5 on A4").
    category
        Which UI grouping the layout belongs to (see ``CATEGORIES``).
    width_mm / height_mm
        Physical size of the FINAL printed sheet, in millimetres.
    kind
        ``"single"``  → one copy of the flyer fills the sheet.
        ``"multi_up"`` → the sheet holds N tiled copies + crop marks.
    tiles_across / tiles_down
        For ``multi_up`` layouts, the grid dimensions. Each tile is
        computed as (sheet_width_mm / tiles_across).
    tile_size_mm
        For ``multi_up`` layouts, the intended finished-flyer size
        (used to label the layout so admins know what they're getting).
    crop_marks
        Draw crop marks between and around tiles so the sheet can be
        trimmed with a guillotine. Ignored on ``single`` layouts.
    order
        Sort order within the category (lower = shown first).
    description
        One-line explainer surfaced under the label in the UI.
    """

    key: str
    label: str
    category: str
    width_mm: float
    height_mm: float
    kind: Literal["single", "multi_up"] = "single"
    tiles_across: int = 1
    tiles_down: int = 1
    tile_size_mm: Optional[tuple] = None  # (w_mm, h_mm) — only for multi_up
    crop_marks: bool = False
    order: int = 100
    description: str = ""
    aliases: List[str] = field(default_factory=list)

    # ---- helpers ----------------------------------------------------

    @property
    def width_px(self) -> int:
        return _mm_to_px(self.width_mm)

    @property
    def height_px(self) -> int:
        return _mm_to_px(self.height_mm)

    @property
    def tile_count(self) -> int:
        return self.tiles_across * self.tiles_down

    def as_dict(self) -> dict:
        """JSON-safe view for the Mission Control UI + admin API."""
        return {
            "key": self.key,
            "label": self.label,
            "category": self.category,
            "category_label": CATEGORIES[self.category].label if self.category in CATEGORIES else self.category,
            "width_mm": self.width_mm,
            "height_mm": self.height_mm,
            "width_px": self.width_px,
            "height_px": self.height_px,
            "kind": self.kind,
            "tiles_across": self.tiles_across,
            "tiles_down": self.tiles_down,
            "tile_count": self.tile_count,
            "tile_size_mm": list(self.tile_size_mm) if self.tile_size_mm else None,
            "crop_marks": self.crop_marks,
            "order": self.order,
            "description": self.description,
        }


# --------------------------------------------------------------------
# Layout registry. Order = display order in the picker.
# Adding "DL flyer" (99×210 mm) or "postcard A6" (105×148 mm) later is
# literally one entry appended below.
# --------------------------------------------------------------------
LAYOUTS: Dict[str, LayoutSpec] = {
    # ── Standard Posters ────────────────────────────────────────────
    "poster_a3": LayoutSpec(
        key="poster_a3",
        label="A3 Poster",
        category="poster",
        width_mm=297,
        height_mm=420,
        kind="single",
        order=1,
        description="Large-format noticeboard poster. Great for libraries, cafés, community centres.",
    ),
    "poster_a4": LayoutSpec(
        key="poster_a4",
        label="A4 Poster",
        category="poster",
        width_mm=210,
        height_mm=297,
        kind="single",
        order=2,
        description="Standard noticeboard poster. Prints on any office printer.",
        aliases=["a4"],  # legacy shorthand from the old flyer.tsx
    ),
    # ── Letterbox Flyers ────────────────────────────────────────────
    "flyer_a5": LayoutSpec(
        key="flyer_a5",
        label="A5 Flyer (single)",
        category="flyer",
        width_mm=148,
        height_mm=210,
        kind="single",
        order=1,
        description="Single A5 letterbox flyer. Prints one per A5 sheet.",
    ),
    "flyer_a5_2up_a4": LayoutSpec(
        key="flyer_a5_2up_a4",
        label="2-up A5 on A4",
        category="flyer",
        width_mm=297,   # A4 LANDSCAPE
        height_mm=210,
        kind="multi_up",
        tiles_across=2,
        tiles_down=1,
        tile_size_mm=(148, 210),
        crop_marks=True,
        order=2,
        description="Two A5 flyers side-by-side on one A4 landscape sheet. Cut once with a guillotine.",
    ),
    "flyer_a5_4up_a3": LayoutSpec(
        key="flyer_a5_4up_a3",
        label="4-up A5 on A3",
        category="flyer",
        width_mm=420,   # A3 LANDSCAPE
        height_mm=297,
        kind="multi_up",
        tiles_across=2,
        tiles_down=2,
        tile_size_mm=(148, 210),
        crop_marks=True,
        order=3,
        description="Four A5 flyers in a 2×2 grid on one A3 landscape sheet. Two guillotine cuts.",
    ),
}


def layout(key: str) -> LayoutSpec:
    """Fetch a layout by key. Raises KeyError with a helpful message if
    the caller typoed the key (or asked for a future layout we haven't
    implemented yet)."""
    # Accept legacy aliases so old callers (mobile app, tests) keep working.
    for lay in LAYOUTS.values():
        if key == lay.key or key in lay.aliases:
            return lay
    raise KeyError(
        f"Unknown flyer layout '{key}'. Known layouts: "
        f"{', '.join(sorted(LAYOUTS.keys()))}."
    )


def layouts_for_category(category_key: str) -> List[LayoutSpec]:
    """All layouts belonging to a category, sorted by their `order`."""
    return sorted(
        [lay for lay in LAYOUTS.values() if lay.category == category_key],
        key=lambda l: l.order,
    )
