"""Built-in jigsaw catalogue (no user uploads).

Combines curated category-themed photos with a programmatically generated
"endless" library of seeded Picsum images so the puzzle list always feels
fresh and unlimited.
"""
from typing import List, Dict

CATEGORIES = ["Nature", "Gardens", "Animals", "Australia", "Travel", "Classic Cars", "Coffee & Cafes", "Local Landmarks"]

# Curated, category-themed Unsplash photos. These are the "featured" puzzles.
_CURATED: List[Dict] = [
    {"category": "Nature",        "id": "nat-forest",     "title": "Misty Forest",        "url": "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Nature",        "id": "nat-mountain",   "title": "Mountain Lake",       "url": "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Nature",        "id": "nat-river",      "title": "River Valley",        "url": "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Flowers",       "id": "flo-sunflower",  "title": "Sunflower Field",     "url": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Flowers",       "id": "flo-tulip",      "title": "Tulip Garden",        "url": "https://images.unsplash.com/photo-1462275646964-a0e3386b89fa?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Flowers",       "id": "flo-rose",       "title": "Pink Roses",          "url": "https://images.unsplash.com/photo-1454262041357-5d96f50a2f27?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Animals",       "id": "ani-dog",        "title": "Happy Pup",           "url": "https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Animals",       "id": "ani-cat",        "title": "Ginger Cat",          "url": "https://images.unsplash.com/photo-1574158622682-e40e69881006?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Animals",       "id": "ani-horse",      "title": "Grazing Horse",       "url": "https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Classic Cars",  "id": "car-vintage",    "title": "Vintage Roadster",    "url": "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Classic Cars",  "id": "car-coupe",      "title": "Chrome Coupe",        "url": "https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Classic Cars",  "id": "car-redclassic", "title": "Red Classic",         "url": "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Travel",        "id": "trv-suitcase",   "title": "Open Suitcase",       "url": "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Travel",        "id": "trv-beach",      "title": "Tropical Beach",      "url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Travel",        "id": "trv-balloons",   "title": "Hot Air Balloons",    "url": "https://images.unsplash.com/photo-1507608616759-54f48f0af0ee?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Australia",     "id": "aus-opera",      "title": "Sydney Opera House",  "url": "https://images.unsplash.com/photo-1523428096881-5bd79d043006?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Australia",     "id": "aus-uluru",      "title": "Uluru at Sunset",     "url": "https://images.unsplash.com/photo-1529108190281-9a4f620bc2d8?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Australia",     "id": "aus-coast",      "title": "Twelve Apostles",     "url": "https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Gardens",       "id": "gar-cottage",    "title": "Cottage Garden",      "url": "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Gardens",       "id": "gar-japanese",   "title": "Japanese Garden",     "url": "https://images.unsplash.com/photo-1504609813442-a8924e83f76e?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Gardens",       "id": "gar-roses",      "title": "Rose Walk",           "url": "https://images.unsplash.com/photo-1453831362806-3d5577f014a4?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Landmarks",     "id": "lan-eiffel",     "title": "Eiffel Tower",        "url": "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Landmarks",     "id": "lan-bigben",     "title": "Big Ben",             "url": "https://images.unsplash.com/photo-1486299267070-83823f5448dd?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Landmarks",     "id": "lan-colosseum",  "title": "The Colosseum",       "url": "https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Coffee & Cafes","id": "caf-latte",      "title": "Latte Art",           "url": "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Coffee & Cafes","id": "caf-window",     "title": "Cafe Window",         "url": "https://images.unsplash.com/photo-1453614512568-c4024d13c247?auto=format&fit=crop&w=1200&q=80"},
    {"category": "Coffee & Cafes","id": "caf-beans",      "title": "Coffee Beans",        "url": "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?auto=format&fit=crop&w=1200&q=80"},
]
# Normalise older category names to the new vocabulary so saved progress
# documents (and the curated list above) keep working.
_RENAME = {"Flowers": "Gardens", "Landmarks": "Local Landmarks"}
for _p in _CURATED:
    _p["category"] = _RENAME.get(_p["category"], _p["category"])

# --- Endless library --------------------------------------------------------
# Generated category puzzles using Picsum's seed endpoint, which returns a
# stable image for a given seed. We tag each with a category and a numbered
# title so the experience reads as a "rotating library" — 20 per category by
# default which can be increased without code changes.
# --- Endless library --------------------------------------------------------
# Retired 28 July 2026 (TestFlight round-2 feedback, Garry #5): the
# Picsum-seeded "endless library" categorised random photos under
# specific category labels (e.g. "Classic Cars #6" would render as a
# wheat field). The mismatch between title/category and image is
# jarring, so we now ship curated-only. If we want more variety, we
# can hand-pick more Unsplash sources per category — but never
# label an image with a category it doesn't visually match.
_GENERATED: List[Dict] = []

JIGSAW_CATALOGUE: List[Dict] = _CURATED + _GENERATED

# Difficulty -> grid (cols, rows) + difficulty-scaled points
DIFFICULTY_GRID: Dict[str, Dict] = {
    "easy":      {"cols": 4, "rows": 3, "pieces": 12, "label": "Easy",      "points": 10},
    "moderate":  {"cols": 6, "rows": 4, "pieces": 24, "label": "Moderate",  "points": 20},
    "hard":      {"cols": 8, "rows": 6, "pieces": 48, "label": "Hard",      "points": 40},
    "nightmare": {"cols": 12, "rows": 8, "pieces": 96, "label": "Nightmare", "points": 80},
}
