"""
Memory Match — curated emoji pairs per theme + deterministic puzzle generator.

Each card is identified by a CHARACTER (an emoji or short string). Players flip
two cards at a time, looking for matching pairs.

Word lists / icon sets are HAND-CURATED. No AI-generated content.
"""
from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import Dict, List


# ----- Difficulty rules (Easy / Moderate / Hard / Nightmare) -----
# `pairs` is the number of distinct emoji pairs on the board.
DIFFICULTIES: Dict[str, Dict] = {
    "easy":      {"label": "Easy",      "cols": 4, "rows": 4, "pairs": 8,  "points": 5,  "preview_seconds": 4},
    "moderate":  {"label": "Moderate",  "cols": 4, "rows": 6, "pairs": 12, "points": 10, "preview_seconds": 3},
    "hard":      {"label": "Hard",      "cols": 6, "rows": 6, "pairs": 18, "points": 15, "preview_seconds": 2},
    "nightmare": {"label": "Nightmare", "cols": 6, "rows": 8, "pairs": 24, "points": 25, "preview_seconds": 1},
}


# ----- Curated themed emoji sets (each ≥ 24 entries so Nightmare has enough) -----
THEMES: Dict[str, Dict] = {
    "aussie_animals":  {"label": "Australian Animals", "emoji": "🐨",
        "cards": ["🦘","🐨","🐊","🦎","🐍","🦅","🦜","🐢","🐬","🐟","🦈","🦀","🐠","🦋","🐝","🐞","🕷️","🦂","🦉","🐺","🦝","🦔","🐇","🦇"]},
    "garden":          {"label": "Garden",             "emoji": "🌷",
        "cards": ["🌷","🌹","🌻","🌼","🌸","🌺","🥀","🌾","🌿","🍀","🌱","🌵","🌳","🌲","🌴","🍂","🍁","🍃","🪴","🪻","💐","🌽","🍅","🥕"]},
    "tea_biscuits":    {"label": "Tea & Biscuits",     "emoji": "☕",
        "cards": ["☕","🍵","🫖","🥛","🍞","🥐","🥨","🧁","🍪","🍯","🥞","🧈","🍰","🍮","🍩","🍫","🍬","🍭","🍡","🍓","🥜","🍐","🍊","🍋"]},
    "around_house":    {"label": "Around the House",   "emoji": "🏡",
        "cards": ["🛋️","🛏️","🚪","🪑","🪟","🖼️","💡","🕯️","🧺","🧹","🪣","🧴","🧼","🪥","🛁","🚿","🧻","🪒","📺","☎️","⏰","🕰️","🗝️","🧰"]},
    "music":           {"label": "Music",               "emoji": "🎵",
        "cards": ["🎵","🎶","🎼","🎤","🎧","🎷","🎺","🎸","🪕","🎻","🥁","🪘","🪗","🎹","📻","🎙️","🎚️","🎛️","🪈","🪇","🎬","🪩","🎭","💿"]},
    "travel":          {"label": "Travel",              "emoji": "✈️",
        "cards": ["✈️","🚂","🚆","🚌","🚐","🚎","🚕","🚗","🛳️","⛴️","🚤","⛵","🚁","🚀","🛶","🏝️","🗺️","🧳","🎫","🛂","🛬","🗽","🗼","🌍"]},
    "food_cooking":    {"label": "Food & Cooking",      "emoji": "🍳",
        "cards": ["🍳","🥘","🍲","🥣","🥗","🍿","🥪","🌭","🍔","🍟","🍕","🥙","🌮","🌯","🍣","🍱","🍙","🍘","🥟","🍜","🍝","🍤","🥩","🍗"]},
    "dogs":            {"label": "Dogs",                "emoji": "🐕",
        "cards": ["🐕","🐩","🐶","🦮","🐕‍🦺","🐾","🦴","🥎","🪀","🏠","🛁","🍖","🥩","🏞️","🌳","🚶","🥎","🪢","🦺","⛹️","🎾","🚿","🛌","🛀"]},
    "cats":            {"label": "Cats",                "emoji": "🐈",
        "cards": ["🐈","🐈‍⬛","🐱","🐾","🪀","🧶","🪺","🐭","🐁","🥛","🍽️","🛌","🌙","☁️","🪟","🪴","🪪","🎀","🐾","💤","🐟","🥣","🪑","🪤"]},
    "coffee":          {"label": "Coffee",              "emoji": "☕",
        "cards": ["☕","🫘","🥄","🍪","🥐","🥛","🧁","🍰","🍩","🍫","🧈","🥥","🪵","🪴","☁️","🌅","📰","💬","🎶","🧇","🥖","🪟","🧴","☘️"]},
    "sport":           {"label": "Sport",               "emoji": "🏏",
        "cards": ["🏏","🎾","⚽","🏉","🏈","⚾","🎱","🏸","🏐","🏀","🏓","🥏","🥎","🥊","🥋","🛼","⛳","🎯","🎳","⛸️","🥌","🎿","🚴","🏊"]},
    "weather":         {"label": "Weather",             "emoji": "🌤️",
        "cards": ["☀️","🌤️","⛅","🌥️","☁️","🌦️","🌧️","⛈️","🌩️","🌨️","❄️","☃️","⛄","🌬️","💨","🌪️","🌫️","🌈","☂️","☔","🌊","🌒","🌞","⭐"]},
}


def list_themes() -> List[Dict]:
    return [{"key": k, "label": t["label"], "emoji": t["emoji"], "card_count": len(t["cards"])} for k, t in THEMES.items()]


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def generate_puzzle(theme_key: str, difficulty: str, seed: int) -> Dict:
    if theme_key not in THEMES:
        raise ValueError(f"Unknown theme: {theme_key}")
    if difficulty not in DIFFICULTIES:
        raise ValueError(f"Unknown difficulty: {difficulty}")
    diff = DIFFICULTIES[difficulty]
    rng = random.Random(seed)
    pool = list(THEMES[theme_key]["cards"])
    rng.shuffle(pool)
    chosen = pool[: diff["pairs"]]
    cards = chosen + chosen  # one pair each
    rng.shuffle(cards)
    return {
        "theme": theme_key,
        "theme_label": THEMES[theme_key]["label"],
        "theme_emoji": THEMES[theme_key]["emoji"],
        "difficulty": difficulty,
        "difficulty_label": diff["label"],
        "cols": diff["cols"],
        "rows": diff["rows"],
        "pairs": diff["pairs"],
        "cards": cards,
        "points": diff["points"],
        "preview_seconds": diff["preview_seconds"],
        "seed": seed,
    }


def daily_pick(date_iso: str) -> Dict[str, str]:
    seed = abs(hash(date_iso)) % (10 ** 9)
    rng = random.Random(seed)
    theme_key = rng.choice(list(THEMES.keys()))
    difficulty = rng.choice(["easy", "moderate", "moderate", "hard"])
    return {"theme": theme_key, "difficulty": difficulty, "seed": seed}
