"""
Curated Spot-the-Difference puzzle library.

Each puzzle = (unique photo + reuse a theme's element catalogue + override
title and seasonal metadata). Adding a new puzzle is a single PUZZLES entry +
a JPG drop into /app/backend/static/spot_bg/library/.

Seasons:
- None            → always available
- "christmas"     → active Nov 25 – Jan 5
- "easter"        → active 14 days before/after Easter Sunday (TBD)
- "spring"        → Sep–Nov
- "autumn"        → Mar–May
- "australia_day" → Jan 18 – Jan 28
- "mothers_day"   → May (entire month)
- "fathers_day"   → Sep (entire month)
- "anzac"         → April only (NOT activated by default per user preference)
"""
from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional

# We re-use the existing theme catalogues so we don't have to redesign 14
# element layouts from scratch — each library puzzle gets its OWN photo but
# shares its element layout with its theme's scene function.
from spot_difference import (
    _scene_garden, _scene_coffee, _scene_beach, _scene_birds, _scene_house,
    _scene_country_towns, _scene_classic_cars, _scene_parks_trails,
)

# Photo filename → which scene function provides the element catalogue.
PUZZLES: List[Dict] = [
    # ===== Launch library (12 puzzles) =====
    {"id": "p001", "title": "Morning in the back garden",   "photo": "garden_morning.jpg",   "theme": "australian_gardens", "scene": _scene_garden,        "difficulty": "easy",     "season": None},
    {"id": "p002", "title": "Down in the potting shed",     "photo": "garden_potting.jpg",   "theme": "australian_gardens", "scene": _scene_garden,        "difficulty": "moderate", "season": None},
    {"id": "p003", "title": "Sunset at the beach",          "photo": "beach_sunset.jpg",     "theme": "beaches",            "scene": _scene_beach,         "difficulty": "easy",     "season": None},
    {"id": "p004", "title": "A quiet morning at the café",  "photo": "cafe_window.jpg",      "theme": "cafes",              "scene": _scene_coffee,        "difficulty": "easy",     "season": None},
    {"id": "p005", "title": "Fresh from the bakery",        "photo": "cafe_pastries.jpg",    "theme": "cafes",              "scene": _scene_coffee,        "difficulty": "moderate", "season": None},
    {"id": "p006", "title": "Rainbow lorikeet on a branch", "photo": "wildlife_lorikeet.jpg","theme": "wildlife",           "scene": _scene_birds,         "difficulty": "easy",     "season": None},
    {"id": "p007", "title": "Outside the heritage pub",     "photo": "country_town_pub.jpg", "theme": "country_towns",      "scene": _scene_country_towns, "difficulty": "moderate", "season": None},
    {"id": "p008", "title": "The red restoration",          "photo": "classic_car_red.jpg",  "theme": "classic_cars",       "scene": _scene_classic_cars,  "difficulty": "easy",     "season": None},
    {"id": "p009", "title": "Vintage show winner",          "photo": "classic_car_blue.jpg", "theme": "classic_cars",       "scene": _scene_classic_cars,  "difficulty": "moderate", "season": None},
    {"id": "p010", "title": "Sunday morning baking",        "photo": "kitchen_baking.jpg",   "theme": "kitchens",           "scene": _scene_house,         "difficulty": "easy",     "season": None},
    {"id": "p011", "title": "A fresh breakfast spread",     "photo": "kitchen_breakfast.jpg","theme": "kitchens",           "scene": _scene_house,         "difficulty": "moderate", "season": None},
    {"id": "p012", "title": "Walk through the gum forest",  "photo": "trail_eucalypt.jpg",   "theme": "parks_trails",       "scene": _scene_parks_trails,  "difficulty": "easy",     "season": None},
    # ===== Christmas (auto-activates Nov 25 – Jan 5) =====
    {"id": "x001", "title": "Christmas morning glow",       "photo": "christmas_tree.jpg",   "theme": "kitchens",           "scene": _scene_house,         "difficulty": "moderate", "season": "christmas"},
    {"id": "x002", "title": "Aussie Christmas table",       "photo": "christmas_table.jpg",  "theme": "kitchens",           "scene": _scene_house,         "difficulty": "moderate", "season": "christmas"},
]


# Map season → (month, day) range for auto-activation.
# Christmas wraps year-end so its predicate handles both halves.
def _season_active(season: Optional[str], today: date) -> bool:
    if season is None:
        return True
    m, d = today.month, today.day
    if season == "christmas":
        # Nov 25 → Dec 31 or Jan 1 → Jan 5
        return (m == 11 and d >= 25) or (m == 12) or (m == 1 and d <= 5)
    if season == "easter":
        # Approx. April 1 – April 30 (good enough for puzzle rotation)
        return m == 4
    if season == "spring":          # AU spring
        return m in (9, 10, 11)
    if season == "autumn":          # AU autumn
        return m in (3, 4, 5)
    if season == "australia_day":
        return m == 1 and 18 <= d <= 28
    if season == "mothers_day":
        return m == 5
    if season == "fathers_day":
        return m == 9
    if season == "anzac":
        return m == 4
    return False


def list_active_puzzles(today: Optional[date] = None) -> List[Dict]:
    today = today or date.today()
    return [p for p in PUZZLES if _season_active(p.get("season"), today)]


def get_puzzle(puzzle_id: str) -> Optional[Dict]:
    return next((p for p in PUZZLES if p["id"] == puzzle_id), None)


def public_card(p: Dict) -> Dict:
    """Shape sent to the client for the library list — no Python callables."""
    return {
        "id": p["id"],
        "title": p["title"],
        "photo_url": f"/api/static/spot_bg/library/{p['photo']}",
        "theme": p["theme"],
        "difficulty": p["difficulty"],
        "season": p.get("season"),
    }
