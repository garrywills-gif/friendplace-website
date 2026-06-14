"""
Spot The Difference — curated SVG-style scenes with deterministic difference picks.

Each scene is a positioned set of named elements (emoji as our "illustration").
A "difference" is a transform applied to scene A to produce scene B:
   * remove      — element disappears in B
   * recolor     — element gets a new tint in B
   * resize      — element grows in B
   * swap_emoji  — element shows a different emoji in B
   * move        — element shifts slightly in B

Every scene + every difference is hand-curated and family-friendly.
"""
from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import Dict, List


DIFFICULTIES: Dict[str, Dict] = {
    "easy":      {"label": "Easy",      "diffs": 3,  "points": 0,  "hints": 3, "ribbon": False},
    "moderate":  {"label": "Moderate",  "diffs": 5,  "points": 0,  "hints": 3, "ribbon": False},
    "hard":      {"label": "Hard",      "diffs": 7,  "points": 15, "hints": 2, "ribbon": True},
    "nightmare": {"label": "Nightmare", "diffs": 10, "points": 25, "hints": 1, "ribbon": True},
}

# Beat-the-Clock bonus: extra points if completed under the time bonus.
BEAT_THE_CLOCK = {
    "easy":      {"seconds": 90,  "bonus": 3},
    "moderate":  {"seconds": 150, "bonus": 5},
    "hard":      {"seconds": 240, "bonus": 8},
    "nightmare": {"seconds": 360, "bonus": 12},
}


def _scene_garden() -> Dict:
    """A friendly garden scene."""
    elements = [
        {"id": "sun",      "emoji": "☀️", "x": 88, "y": 12, "size": 36, "color": None},
        {"id": "cloud1",   "emoji": "☁️", "x": 22, "y": 14, "size": 28, "color": None},
        {"id": "cloud2",   "emoji": "☁️", "x": 58, "y": 10, "size": 24, "color": None},
        {"id": "tree",     "emoji": "🌳", "x": 14, "y": 50, "size": 56, "color": None},
        {"id": "flower1",  "emoji": "🌷", "x": 30, "y": 78, "size": 28, "color": None},
        {"id": "flower2",  "emoji": "🌻", "x": 44, "y": 80, "size": 28, "color": None},
        {"id": "flower3",  "emoji": "🌹", "x": 58, "y": 78, "size": 28, "color": None},
        {"id": "flower4",  "emoji": "🌼", "x": 72, "y": 80, "size": 28, "color": None},
        {"id": "bee",      "emoji": "🐝", "x": 50, "y": 36, "size": 22, "color": None},
        {"id": "butterfly","emoji": "🦋", "x": 70, "y": 36, "size": 22, "color": None},
        {"id": "watering", "emoji": "🪣", "x": 80, "y": 70, "size": 28, "color": None},
        {"id": "bench",    "emoji": "🪑", "x": 12, "y": 78, "size": 30, "color": None},
        {"id": "snail",    "emoji": "🐌", "x": 30, "y": 92, "size": 22, "color": None},
        {"id": "rabbit",   "emoji": "🐇", "x": 88, "y": 92, "size": 24, "color": None},
        {"id": "hedge",    "emoji": "🌿", "x": 50, "y": 60, "size": 22, "color": None},
    ]
    diff_pool = [
        {"target": "sun",       "type": "remove"},
        {"target": "butterfly", "type": "remove"},
        {"target": "snail",     "type": "remove"},
        {"target": "watering",  "type": "remove"},
        {"target": "flower1",   "type": "swap_emoji", "emoji": "🌺"},
        {"target": "flower3",   "type": "swap_emoji", "emoji": "🌸"},
        {"target": "cloud2",    "type": "move",  "dx": -6, "dy": 4},
        {"target": "bee",       "type": "move",  "dx": 10, "dy": -2},
        {"target": "rabbit",    "type": "swap_emoji", "emoji": "🐢"},
        {"target": "bench",     "type": "resize","size": 38},
        {"target": "tree",      "type": "resize","size": 48},
        {"target": "hedge",     "type": "remove"},
    ]
    return {"elements": elements, "diff_pool": diff_pool}


def _scene_coffee() -> Dict:
    """A cosy coffee shop window."""
    elements = [
        {"id": "sign",     "emoji": "☕", "x": 14, "y": 14, "size": 38},
        {"id": "muffin",   "emoji": "🧁", "x": 30, "y": 50, "size": 28},
        {"id": "croissant","emoji": "🥐", "x": 50, "y": 52, "size": 30},
        {"id": "donut",    "emoji": "🍩", "x": 70, "y": 50, "size": 28},
        {"id": "cup1",     "emoji": "☕", "x": 24, "y": 78, "size": 26},
        {"id": "cup2",     "emoji": "🍵", "x": 50, "y": 80, "size": 26},
        {"id": "cup3",     "emoji": "🥛", "x": 76, "y": 78, "size": 26},
        {"id": "cookie",   "emoji": "🍪", "x": 42, "y": 30, "size": 22},
        {"id": "heart",    "emoji": "❤️", "x": 88, "y": 22, "size": 22},
        {"id": "flowers",  "emoji": "🌸", "x": 88, "y": 78, "size": 26},
        {"id": "clock",    "emoji": "🕰️", "x": 60, "y": 16, "size": 24},
        {"id": "chair",    "emoji": "🪑", "x": 12, "y": 84, "size": 26},
        {"id": "newspaper","emoji": "📰", "x": 36, "y": 90, "size": 24},
        {"id": "cat",      "emoji": "🐈", "x": 70, "y": 90, "size": 24},
        {"id": "music",    "emoji": "🎵", "x": 24, "y": 24, "size": 20},
    ]
    diff_pool = [
        {"target": "cookie",    "type": "remove"},
        {"target": "donut",     "type": "remove"},
        {"target": "newspaper", "type": "remove"},
        {"target": "cat",       "type": "remove"},
        {"target": "music",     "type": "remove"},
        {"target": "muffin",    "type": "swap_emoji", "emoji": "🍰"},
        {"target": "croissant", "type": "swap_emoji", "emoji": "🥖"},
        {"target": "flowers",   "type": "swap_emoji", "emoji": "🌻"},
        {"target": "cup1",      "type": "swap_emoji", "emoji": "🍷"},
        {"target": "heart",     "type": "move",   "dx": -8, "dy": 6},
        {"target": "clock",     "type": "resize", "size": 32},
        {"target": "sign",      "type": "resize", "size": 30},
    ]
    return {"elements": elements, "diff_pool": diff_pool}


def _scene_beach() -> Dict:
    """A sunny day at the beach."""
    elements = [
        {"id": "sun",      "emoji": "🌞", "x": 12, "y": 16, "size": 40},
        {"id": "cloud",    "emoji": "⛅", "x": 50, "y": 12, "size": 28},
        {"id": "palm1",    "emoji": "🌴", "x": 18, "y": 50, "size": 50},
        {"id": "palm2",    "emoji": "🌴", "x": 82, "y": 50, "size": 50},
        {"id": "wave",     "emoji": "🌊", "x": 50, "y": 56, "size": 30},
        {"id": "boat",     "emoji": "⛵", "x": 72, "y": 28, "size": 30},
        {"id": "umbrella", "emoji": "🏖️", "x": 38, "y": 70, "size": 36},
        {"id": "ball",     "emoji": "🏐", "x": 60, "y": 78, "size": 24},
        {"id": "starfish", "emoji": "⭐", "x": 26, "y": 88, "size": 22},
        {"id": "crab",     "emoji": "🦀", "x": 50, "y": 90, "size": 24},
        {"id": "shell",    "emoji": "🐚", "x": 74, "y": 90, "size": 22},
        {"id": "seagull",  "emoji": "🕊️", "x": 36, "y": 22, "size": 22},
        {"id": "icecream", "emoji": "🍦", "x": 86, "y": 76, "size": 24},
        {"id": "fish",     "emoji": "🐟", "x": 14, "y": 78, "size": 22},
        {"id": "kite",     "emoji": "🪁", "x": 64, "y": 16, "size": 22},
    ]
    diff_pool = [
        {"target": "cloud",   "type": "remove"},
        {"target": "boat",    "type": "remove"},
        {"target": "kite",    "type": "remove"},
        {"target": "fish",    "type": "remove"},
        {"target": "shell",   "type": "remove"},
        {"target": "crab",    "type": "swap_emoji", "emoji": "🦞"},
        {"target": "ball",    "type": "swap_emoji", "emoji": "⚽"},
        {"target": "icecream","type": "swap_emoji", "emoji": "🍧"},
        {"target": "seagull", "type": "move",   "dx": 8,  "dy": -4},
        {"target": "starfish","type": "move",   "dx": -6, "dy": 2},
        {"target": "sun",     "type": "resize", "size": 28},
        {"target": "umbrella","type": "resize", "size": 28},
    ]
    return {"elements": elements, "diff_pool": diff_pool}


def _scene_pets() -> Dict:
    elements = [
        {"id": "dog",      "emoji": "🐕", "x": 28, "y": 60, "size": 46},
        {"id": "cat",      "emoji": "🐈", "x": 70, "y": 62, "size": 44},
        {"id": "ball",     "emoji": "🎾", "x": 50, "y": 80, "size": 24},
        {"id": "bone",     "emoji": "🦴", "x": 16, "y": 86, "size": 24},
        {"id": "yarn",     "emoji": "🧶", "x": 86, "y": 86, "size": 26},
        {"id": "bowl1",    "emoji": "🥣", "x": 18, "y": 70, "size": 22},
        {"id": "bowl2",    "emoji": "🥣", "x": 82, "y": 70, "size": 22},
        {"id": "house",    "emoji": "🏠", "x": 50, "y": 30, "size": 50},
        {"id": "bird",     "emoji": "🐦", "x": 28, "y": 22, "size": 22},
        {"id": "flower",   "emoji": "🌼", "x": 78, "y": 28, "size": 22},
        {"id": "rug",      "emoji": "🪟", "x": 50, "y": 90, "size": 22},
        {"id": "rabbit",   "emoji": "🐰", "x": 88, "y": 50, "size": 24},
        {"id": "treat",    "emoji": "🍖", "x": 12, "y": 50, "size": 22},
        {"id": "collar",   "emoji": "🎀", "x": 28, "y": 50, "size": 20},
        {"id": "fish_bowl","emoji": "🐠", "x": 50, "y": 50, "size": 26},
    ]
    diff_pool = [
        {"target": "bird",     "type": "remove"},
        {"target": "rabbit",   "type": "remove"},
        {"target": "treat",    "type": "remove"},
        {"target": "collar",   "type": "remove"},
        {"target": "flower",   "type": "remove"},
        {"target": "dog",      "type": "swap_emoji", "emoji": "🐩"},
        {"target": "cat",      "type": "swap_emoji", "emoji": "🐈‍⬛"},
        {"target": "ball",     "type": "swap_emoji", "emoji": "🎯"},
        {"target": "yarn",     "type": "move",   "dx": -8, "dy": -4},
        {"target": "bone",     "type": "move",   "dx": 8,  "dy": -4},
        {"target": "house",    "type": "resize", "size": 38},
        {"target": "fish_bowl","type": "resize", "size": 36},
    ]
    return {"elements": elements, "diff_pool": diff_pool}


def _scene_birds() -> Dict:
    elements = [
        {"id": "tree",     "emoji": "🌳", "x": 50, "y": 50, "size": 80},
        {"id": "sun",      "emoji": "☀️", "x": 12, "y": 14, "size": 30},
        {"id": "kookaburra","emoji": "🦅", "x": 30, "y": 30, "size": 28},
        {"id": "magpie",   "emoji": "🐦", "x": 70, "y": 28, "size": 26},
        {"id": "parrot",   "emoji": "🦜", "x": 84, "y": 50, "size": 30},
        {"id": "owl",      "emoji": "🦉", "x": 16, "y": 50, "size": 28},
        {"id": "robin",    "emoji": "🐤", "x": 50, "y": 22, "size": 22},
        {"id": "nest",     "emoji": "🪺", "x": 50, "y": 38, "size": 24},
        {"id": "feather",  "emoji": "🪶", "x": 24, "y": 82, "size": 22},
        {"id": "worm",     "emoji": "🐛", "x": 70, "y": 88, "size": 22},
        {"id": "berries",  "emoji": "🫐", "x": 80, "y": 74, "size": 22},
        {"id": "bee",      "emoji": "🐝", "x": 36, "y": 70, "size": 22},
        {"id": "flower",   "emoji": "🌷", "x": 50, "y": 86, "size": 24},
        {"id": "cloud",    "emoji": "☁️", "x": 80, "y": 14, "size": 26},
        {"id": "ladybug",  "emoji": "🐞", "x": 14, "y": 82, "size": 20},
    ]
    diff_pool = [
        {"target": "robin",      "type": "remove"},
        {"target": "feather",    "type": "remove"},
        {"target": "worm",       "type": "remove"},
        {"target": "ladybug",    "type": "remove"},
        {"target": "cloud",      "type": "remove"},
        {"target": "parrot",     "type": "swap_emoji", "emoji": "🦩"},
        {"target": "owl",        "type": "swap_emoji", "emoji": "🦃"},
        {"target": "kookaburra", "type": "swap_emoji", "emoji": "🪿"},
        {"target": "berries",    "type": "move",   "dx": -8, "dy": -4},
        {"target": "bee",        "type": "move",   "dx": 8,  "dy": 2},
        {"target": "nest",       "type": "resize", "size": 36},
        {"target": "sun",        "type": "resize", "size": 22},
    ]
    return {"elements": elements, "diff_pool": diff_pool}


def _scene_house() -> Dict:
    elements = [
        {"id": "house",    "emoji": "🏠", "x": 50, "y": 38, "size": 90},
        {"id": "sun",      "emoji": "☀️", "x": 14, "y": 14, "size": 30},
        {"id": "tv",       "emoji": "📺", "x": 28, "y": 64, "size": 28},
        {"id": "chair",    "emoji": "🪑", "x": 70, "y": 64, "size": 28},
        {"id": "lamp",     "emoji": "💡", "x": 50, "y": 26, "size": 22},
        {"id": "clock",    "emoji": "🕰️", "x": 72, "y": 30, "size": 24},
        {"id": "rug",      "emoji": "🪟", "x": 50, "y": 86, "size": 26},
        {"id": "plant",    "emoji": "🪴", "x": 16, "y": 80, "size": 26},
        {"id": "cat",      "emoji": "🐈", "x": 50, "y": 78, "size": 26},
        {"id": "mug",      "emoji": "☕", "x": 30, "y": 84, "size": 22},
        {"id": "book",     "emoji": "📚", "x": 86, "y": 84, "size": 24},
        {"id": "photo",    "emoji": "🖼️", "x": 30, "y": 30, "size": 22},
        {"id": "candle",   "emoji": "🕯️", "x": 86, "y": 50, "size": 22},
        {"id": "phone",    "emoji": "☎️", "x": 16, "y": 60, "size": 22},
        {"id": "window",   "emoji": "🪟", "x": 76, "y": 16, "size": 24},
    ]
    diff_pool = [
        {"target": "photo",  "type": "remove"},
        {"target": "candle", "type": "remove"},
        {"target": "phone",  "type": "remove"},
        {"target": "mug",    "type": "remove"},
        {"target": "window", "type": "remove"},
        {"target": "tv",     "type": "swap_emoji", "emoji": "📻"},
        {"target": "lamp",   "type": "swap_emoji", "emoji": "🔦"},
        {"target": "cat",    "type": "swap_emoji", "emoji": "🐕"},
        {"target": "book",   "type": "move",   "dx": -8, "dy": -2},
        {"target": "plant",  "type": "move",   "dx": 8,  "dy": -2},
        {"target": "clock",  "type": "resize", "size": 34},
        {"target": "chair",  "type": "resize", "size": 36},
    ]
    return {"elements": elements, "diff_pool": diff_pool}


def _scene_country_towns() -> Dict:
    """A quintessential Australian country main street."""
    elements = [
        {"id": "sun",       "emoji": "☀️", "x": 86, "y": 10, "size": 32, "color": None},
        {"id": "cloud",     "emoji": "☁️", "x": 30, "y": 12, "size": 26, "color": None},
        {"id": "gum_tree",  "emoji": "🌳", "x": 14, "y": 56, "size": 50, "color": None},
        {"id": "clock",     "emoji": "🕰️", "x": 48, "y": 30, "size": 30, "color": None},
        {"id": "flag",      "emoji": "🏁", "x": 72, "y": 28, "size": 26, "color": None},
        {"id": "mailbox",   "emoji": "📮", "x": 82, "y": 70, "size": 28, "color": None},
        {"id": "bench",     "emoji": "🪑", "x": 36, "y": 82, "size": 28, "color": None},
        {"id": "bike",      "emoji": "🚲", "x": 56, "y": 80, "size": 30, "color": None},
        {"id": "car",       "emoji": "🚗", "x": 70, "y": 60, "size": 32, "color": None},
        {"id": "flowers",   "emoji": "🌼", "x": 24, "y": 76, "size": 24, "color": None},
        {"id": "lamp",      "emoji": "🪔", "x": 90, "y": 40, "size": 26, "color": None},
        {"id": "bird",      "emoji": "🐦", "x": 58, "y": 14, "size": 22, "color": None},
    ]
    diff_pool = [
        {"target": "clock",   "type": "remove"},
        {"target": "bird",    "type": "remove"},
        {"target": "bike",    "type": "remove"},
        {"target": "flag",    "type": "swap_emoji", "emoji": "🚩"},
        {"target": "flowers", "type": "swap_emoji", "emoji": "🌷"},
        {"target": "mailbox", "type": "move", "dx": -8, "dy": 0},
        {"target": "car",     "type": "move", "dx": 10, "dy": 0},
        {"target": "lamp",    "type": "swap_emoji", "emoji": "💡"},
        {"target": "gum_tree","type": "resize", "size": 44},
        {"target": "cloud",   "type": "move", "dx": 14, "dy": 0},
    ]
    return {"elements": elements, "diff_pool": diff_pool}


def _scene_classic_cars() -> Dict:
    """A vintage Australian classic car restoration scene."""
    elements = [
        {"id": "sun",        "emoji": "☀️", "x": 86, "y": 10, "size": 32, "color": None},
        {"id": "car_body",   "emoji": "🚗", "x": 50, "y": 58, "size": 64, "color": None},
        {"id": "wheel_lf",   "emoji": "⚙️", "x": 30, "y": 78, "size": 22, "color": None},
        {"id": "wheel_rf",   "emoji": "⚙️", "x": 70, "y": 78, "size": 22, "color": None},
        {"id": "key",        "emoji": "🔑", "x": 18, "y": 30, "size": 26, "color": None},
        {"id": "hat",        "emoji": "🎩", "x": 28, "y": 42, "size": 26, "color": None},
        {"id": "tools",      "emoji": "🧰", "x": 14, "y": 80, "size": 30, "color": None},
        {"id": "fuel",       "emoji": "⛽", "x": 86, "y": 60, "size": 30, "color": None},
        {"id": "trophy",     "emoji": "🏆", "x": 80, "y": 30, "size": 26, "color": None},
        {"id": "cloud",      "emoji": "☁️", "x": 22, "y": 14, "size": 24, "color": None},
        {"id": "leaf",       "emoji": "🍂", "x": 42, "y": 88, "size": 20, "color": None},
        {"id": "bird",       "emoji": "🕊️", "x": 60, "y": 20, "size": 22, "color": None},
    ]
    diff_pool = [
        {"target": "key",     "type": "remove"},
        {"target": "trophy",  "type": "remove"},
        {"target": "bird",    "type": "remove"},
        {"target": "leaf",    "type": "remove"},
        {"target": "hat",     "type": "swap_emoji", "emoji": "🧢"},
        {"target": "fuel",    "type": "swap_emoji", "emoji": "🛢️"},
        {"target": "wheel_lf","type": "swap_emoji", "emoji": "⚪"},
        {"target": "tools",   "type": "move", "dx": 8, "dy": 0},
        {"target": "car_body","type": "move", "dx": -4, "dy": 0},
        {"target": "cloud",   "type": "resize", "size": 30},
    ]
    return {"elements": elements, "diff_pool": diff_pool}


def _scene_parks_trails() -> Dict:
    """A peaceful bushland walking trail through eucalypt forest."""
    elements = [
        {"id": "sun_ray",    "emoji": "🌤️", "x": 80, "y": 14, "size": 30, "color": None},
        {"id": "tree_l",     "emoji": "🌳", "x": 14, "y": 50, "size": 56, "color": None},
        {"id": "tree_r",     "emoji": "🌳", "x": 86, "y": 50, "size": 50, "color": None},
        {"id": "bench",      "emoji": "🪑", "x": 32, "y": 82, "size": 28, "color": None},
        {"id": "hiker_hat",  "emoji": "🎩", "x": 50, "y": 36, "size": 24, "color": None},
        {"id": "stick",      "emoji": "🦯", "x": 60, "y": 76, "size": 28, "color": None},
        {"id": "bottle",     "emoji": "🍶", "x": 70, "y": 80, "size": 24, "color": None},
        {"id": "leaf",       "emoji": "🍃", "x": 44, "y": 24, "size": 22, "color": None},
        {"id": "mushroom",   "emoji": "🍄", "x": 24, "y": 84, "size": 22, "color": None},
        {"id": "butterfly",  "emoji": "🦋", "x": 56, "y": 50, "size": 22, "color": None},
        {"id": "bird",       "emoji": "🐦", "x": 36, "y": 18, "size": 22, "color": None},
        {"id": "signpost",   "emoji": "🪧", "x": 80, "y": 78, "size": 26, "color": None},
    ]
    diff_pool = [
        {"target": "mushroom",  "type": "remove"},
        {"target": "leaf",      "type": "remove"},
        {"target": "bird",      "type": "remove"},
        {"target": "butterfly", "type": "remove"},
        {"target": "hiker_hat", "type": "swap_emoji", "emoji": "🧢"},
        {"target": "bottle",    "type": "swap_emoji", "emoji": "🥤"},
        {"target": "bench",     "type": "move", "dx": 8, "dy": 0},
        {"target": "stick",     "type": "move", "dx": -8, "dy": 0},
        {"target": "tree_r",    "type": "resize", "size": 44},
        {"target": "signpost",  "type": "swap_emoji", "emoji": "📋"},
    ]
    return {"elements": elements, "diff_pool": diff_pool}


THEMES: Dict[str, Dict] = {
    "australian_gardens": {"label": "Australian Gardens", "emoji": "🌷", "scene": _scene_garden},
    "beaches":            {"label": "Beaches",            "emoji": "🏖️", "scene": _scene_beach},
    "cafes":              {"label": "Cafés",              "emoji": "☕", "scene": _scene_coffee},
    "wildlife":           {"label": "Wildlife",           "emoji": "🦜", "scene": _scene_birds},
    "country_towns":      {"label": "Country Towns",      "emoji": "🏘️", "scene": _scene_country_towns},
    "classic_cars":       {"label": "Classic Cars",       "emoji": "🚗", "scene": _scene_classic_cars},
    "kitchens":           {"label": "Kitchens",           "emoji": "🍳", "scene": _scene_house},
    "parks_trails":       {"label": "Parks & Trails",     "emoji": "🌲", "scene": _scene_parks_trails},
    # Legacy aliases — keep the old theme keys working so existing progress &
    # daily-puzzle deep links don't 404 after the rename.
    "garden":       {"label": "Australian Gardens", "emoji": "🌷", "scene": _scene_garden,        "_alias_of": "australian_gardens"},
    "beach":        {"label": "Beaches",            "emoji": "🏖️", "scene": _scene_beach,        "_alias_of": "beaches"},
    "coffee_shop":  {"label": "Cafés",              "emoji": "☕", "scene": _scene_coffee,       "_alias_of": "cafes"},
    "birds":        {"label": "Wildlife",           "emoji": "🦜", "scene": _scene_birds,        "_alias_of": "wildlife"},
    "pets":         {"label": "Wildlife",           "emoji": "🦜", "scene": _scene_birds,        "_alias_of": "wildlife"},
    "around_house": {"label": "Kitchens",           "emoji": "🍳", "scene": _scene_house,        "_alias_of": "kitchens"},
}


def list_themes() -> List[Dict]:
    # Don't expose legacy alias keys in the picker — they exist only so deep
    # links + saved progress from earlier theme names still work.
    return [{"key": k, "label": t["label"], "emoji": t["emoji"]} for k, t in THEMES.items() if "_alias_of" not in t]


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _apply_diff(scene_b: List[Dict], d: Dict) -> Dict:
    """Apply one difference transform to scene_b. Returns a 'difference' dict
    describing where the change happened (so the client can hit-test taps).
    """
    target_id = d["target"]
    elem = next((e for e in scene_b if e["id"] == target_id), None)
    if elem is None:
        return {}
    region_x = elem["x"]
    region_y = elem["y"]
    if d["type"] == "remove":
        scene_b.remove(elem)
    elif d["type"] == "swap_emoji":
        elem["emoji"] = d["emoji"]
    elif d["type"] == "move":
        elem["x"] = elem["x"] + d.get("dx", 0)
        elem["y"] = elem["y"] + d.get("dy", 0)
        # Region centered between A and B positions for tappability.
        region_x = (region_x + elem["x"]) / 2
        region_y = (region_y + elem["y"]) / 2
    elif d["type"] == "resize":
        elem["size"] = d["size"]
    return {
        "id": f"d_{target_id}_{d['type']}",
        "target": target_id,
        "type": d["type"],
        "x": region_x,
        "y": region_y,
        # A generous tap region (percent of board) so older users can find them.
        "radius": 10,
    }


def generate_puzzle(theme_key: str, difficulty: str, seed: int) -> Dict:
    if theme_key not in THEMES:
        raise ValueError(f"Unknown theme: {theme_key}")
    if difficulty not in DIFFICULTIES:
        raise ValueError(f"Unknown difficulty: {difficulty}")
    diff = DIFFICULTIES[difficulty]
    rng = random.Random(seed)
    scene_data = THEMES[theme_key]["scene"]()
    scene_a = [dict(e) for e in scene_data["elements"]]
    scene_b = [dict(e) for e in scene_data["elements"]]
    pool = list(scene_data["diff_pool"])
    rng.shuffle(pool)
    picked = pool[: diff["diffs"]]
    differences: List[Dict] = []
    used_targets = set()
    for d in picked:
        if d["target"] in used_targets:
            continue
        out = _apply_diff(scene_b, d)
        if out:
            differences.append(out)
            used_targets.add(d["target"])

    return {
        "theme": theme_key,
        "theme_label": THEMES[theme_key]["label"],
        "theme_emoji": THEMES[theme_key]["emoji"],
        "difficulty": difficulty,
        "difficulty_label": diff["label"],
        "diff_count": len(differences),
        "scene_a": scene_a,
        "scene_b": scene_b,
        "differences": differences,
        "points": diff["points"],
        "hint_quota": diff["hints"],
        "ribbon": diff["ribbon"],
        "beat_the_clock": BEAT_THE_CLOCK[difficulty],
        "seed": seed,
    }


def daily_pick(date_iso: str) -> Dict:
    seed = abs(hash(date_iso)) % (10 ** 9)
    rng = random.Random(seed)
    theme_key = rng.choice(list(THEMES.keys()))
    difficulty = rng.choice(["easy", "moderate", "moderate", "hard"])
    return {"theme": theme_key, "difficulty": difficulty, "seed": seed}
