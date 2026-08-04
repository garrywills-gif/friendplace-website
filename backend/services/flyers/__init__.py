"""Flyer Publishing Centre — templating layer above the existing PIL renderer.

The single source of truth for flyer *design* is the existing PIL renderer
at `server.py:admin_invite_flyer`. This module wraps it with:

  1. A `flyer_templates` collection storing template metadata (name,
     description, category, status, supported layouts, used_count).
  2. A layout registry (`registry.LAYOUTS`) that describes the physical
     size + composition rules for every print output we support:
     A3 poster, A4 poster, A5 single, 2-up-A5 on A4, 4-up-A5 on A3, …
  3. A dispatcher (`renderer.render_flyer`) that produces the final PNG
     for a `(template_key, layout_key, params)` triple by calling the
     existing renderer as the base and compositing / scaling as needed.

Design principles locked with Garry (3 Aug 2026):

  • The existing `/api/admin/invite-flyer` endpoint is preserved
    verbatim for backward-compat with the mobile app and existing tests.
  • Templates are DATA — new templates can be added by inserting a
    document into `flyer_templates`. No code change required.
  • Layouts are DATA too — adding "DL flyer" or "postcard" later is a
    one-entry addition in `registry.LAYOUTS`.
  • The architecture is *George-ready*: `list_flyer_templates` and
    `render_flyer` are pure functions that a future tool binding can
    call directly without any HTTP overhead.
"""

from .registry import (
    LAYOUTS,
    LayoutSpec,
    CategorySpec,
    CATEGORIES,
    layout,
    layouts_for_category,
)
from .renderer import render_flyer, RenderResult
from .templates import (
    seed_flyer_templates,
    COLL_FLYER_TEMPLATES,
    list_templates,
    get_template,
    field_library,
    resolve_field,
    KNOWN_FIELD_KEYS,
    ensure_indexes as ensure_flyer_indexes,
)

__all__ = [
    "LAYOUTS",
    "LayoutSpec",
    "CategorySpec",
    "CATEGORIES",
    "layout",
    "layouts_for_category",
    "render_flyer",
    "RenderResult",
    "seed_flyer_templates",
    "COLL_FLYER_TEMPLATES",
    "list_templates",
    "get_template",
    "field_library",
    "resolve_field",
    "KNOWN_FIELD_KEYS",
    "ensure_flyer_indexes",
]
