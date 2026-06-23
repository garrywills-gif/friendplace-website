"""
Word Search — curated, family-friendly word lists + deterministic puzzle generator.

Word lists are MANUALLY CURATED for a community context.
No AI-generated words. All entries:
  * 3–10 letters
  * Plain English (or common Australian English)
  * No double meanings, no profanity, no controversial topics

If you add a theme, keep the same standard: hand-picked, age-appropriate, positive.
"""
from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import Dict, List, Tuple


# ----- Difficulty rules -----
DIFFICULTIES: Dict[str, Dict] = {
    "easy":      {"label": "Easy",      "size": 8,  "num_words": 6,  "directions": ["h", "v"],                                   "points": 5,  "min_len": 3, "max_len": 6, "hints": 3},
    "moderate":  {"label": "Moderate",  "size": 10, "num_words": 8,  "directions": ["h", "v", "d"],                              "points": 10, "min_len": 4, "max_len": 7, "hints": 3},
    "hard":      {"label": "Hard",      "size": 12, "num_words": 10, "directions": ["h", "v", "d", "h_rev", "v_rev"],            "points": 15, "min_len": 4, "max_len": 8, "hints": 2},
    "nightmare": {"label": "Nightmare", "size": 14, "num_words": 12, "directions": ["h", "v", "d", "d_rev", "h_rev", "v_rev"],   "points": 25, "min_len": 4, "max_len": 10, "hints": 1},
}


# ----- Curated themes (hand-picked, family-friendly) -----
THEMES: Dict[str, Dict] = {
    "aussie_birds":      {"label": "Australian Birds",     "emoji": "🦜",
        "words": ["KOOKABURRA", "MAGPIE", "GALAH", "ROSELLA", "EMU", "COCKATOO", "LORIKEET", "WREN", "ROBIN", "PELICAN", "IBIS", "BUDGIE", "PARROT", "FINCH", "DOVE", "OWL"]},
    "aussie_animals":    {"label": "Australian Animals",   "emoji": "🐨",
        "words": ["KANGAROO", "KOALA", "WOMBAT", "DINGO", "ECHIDNA", "PLATYPUS", "POSSUM", "WALLABY", "QUOKKA", "EMU", "BILBY", "NUMBAT", "SUGAR", "GLIDER", "PADEMELON", "BANDICOOT"]},
    "beach":             {"label": "Beach Day",            "emoji": "🏖️",
        "words": ["OCEAN", "WAVES", "SAND", "SHELL", "SUNHAT", "TOWEL", "ICEBLOCK", "PICNIC", "PIER", "SEAGULL", "BOAT", "CRAB", "TIDE", "SUNRISE", "DOLPHIN", "PARASOL"]},
    "garden":            {"label": "Garden",               "emoji": "🌷",
        "words": ["ROSE", "DAISY", "TULIP", "HEDGE", "TRELLIS", "POT", "SHED", "FERN", "LAWN", "BIRDBATH", "PRUNE", "MULCH", "SEEDS", "TROWEL", "WATERING", "ORCHID"]},
    "tea_biscuits":      {"label": "Tea & Biscuits",       "emoji": "☕",
        "words": ["TEAPOT", "KETTLE", "CUPPA", "SCONE", "JAM", "CREAM", "SUGAR", "MILK", "SHORTBREAD", "ANZAC", "LAMINGTON", "TEABAG", "SAUCER", "BREW", "STRAINER", "BISCUIT"]},
    "old_tv":            {"label": "Old TV Shows",         "emoji": "📺",
        "words": ["NEIGHBOURS", "HOMEAWAY", "PRISONER", "CARTONS", "ABC", "LASSIE", "BONANZA", "GUNSMOKE", "DALLAS", "DOCTOR", "MIDSOMER", "MASH", "FOYLE", "DAYS", "SOAP", "DRAMA"]},
    "family":            {"label": "Family",               "emoji": "👨‍👩‍👧",
        "words": ["MUM", "DAD", "SON", "NANA", "POP", "AUNT", "UNCLE", "NEPHEW", "NIECE", "COUSIN", "SISTER", "BROTHER", "GRANDMA", "FAMILY", "LOVE", "HOME"]},
    "sport":             {"label": "Sport",                "emoji": "🏏",
        "words": ["CRICKET", "FOOTY", "TENNIS", "GOLF", "BOWLS", "NETBALL", "RUGBY", "SOCCER", "SWIM", "RUN", "WALK", "CYCLE", "DARTS", "SAIL", "ARCHERY", "KAYAK"]},
    "around_house":      {"label": "Around the House",     "emoji": "🏡",
        "words": ["KITCHEN", "PANTRY", "LOUNGE", "PORCH", "LAUNDRY", "GARAGE", "STAIRS", "ATTIC", "WINDOW", "DOOR", "CARPET", "RUG", "SOFA", "LAMP", "MIRROR", "CLOCK"]},
    "music":             {"label": "Music",                "emoji": "🎵",
        "words": ["PIANO", "GUITAR", "VIOLIN", "FLUTE", "TRUMPET", "HARP", "BANJO", "DRUM", "MELODY", "CHORD", "TUNE", "SONG", "CHOIR", "SINGER", "ALBUM", "RECORD"]},
    "travel":            {"label": "Travel",               "emoji": "✈️",
        "words": ["AIRPORT", "PASSPORT", "TRAIN", "FERRY", "MAP", "HOTEL", "CRUISE", "BUS", "CASE", "TICKET", "JOURNEY", "VISIT", "HOLIDAY", "TOUR", "GUIDE", "POSTCARD"]},
    "cars":              {"label": "Cars",                 "emoji": "🚗",
        "words": ["WHEEL", "ENGINE", "PETROL", "BRAKE", "BOOT", "BONNET", "MIRROR", "GEAR", "TYRE", "WAGON", "SEDAN", "UTE", "DRIVE", "ROAD", "GARAGE", "POLISH"]},
    "diy":               {"label": "DIY & Home Improvement", "emoji": "🔨",
        "words": ["HAMMER", "NAIL", "SCREW", "DRILL", "SAW", "PAINT", "BRUSH", "TAPE", "LEVEL", "PLIERS", "LADDER", "TILE", "TIMBER", "GLUE", "SANDER", "WRENCH"]},
    "lawn_garden":       {"label": "Lawn & Garden",        "emoji": "🌿",
        "words": ["MOWER", "RAKE", "HOSE", "EDGER", "WEED", "SEED", "BULB", "GRASS", "HEDGE", "COMPOST", "BENCH", "FENCE", "TRIM", "WATER", "TROWEL", "VINE"]},
    "famous_places":     {"label": "Famous Australian Places", "emoji": "🇦🇺",
        "words": ["SYDNEY", "MELBOURNE", "BRISBANE", "PERTH", "ADELAIDE", "HOBART", "DARWIN", "CANBERRA", "ULURU", "CAIRNS", "BYRON", "NOOSA", "BONDI", "MANLY", "KAKADU", "BAROSSA"]},
    "food_cooking":      {"label": "Food & Cooking",       "emoji": "🍳",
        "words": ["BREAD", "BUTTER", "CHEESE", "PASTA", "RICE", "SOUP", "STEW", "ROAST", "BAKE", "FRY", "GRILL", "OMELETTE", "SALAD", "FRUIT", "HONEY", "SAUCE"]},
    "dogs":              {"label": "Dogs",                 "emoji": "🐕",
        "words": ["LABRADOR", "POODLE", "BEAGLE", "TERRIER", "KELPIE", "CORGI", "SPANIEL", "BULLDOG", "COLLIE", "PUPPY", "BARK", "WALK", "LEASH", "FETCH", "PAW", "TAIL"]},
    "cats":              {"label": "Cats",                 "emoji": "🐈",
        "words": ["KITTEN", "PURR", "WHISKER", "TABBY", "GINGER", "FELINE", "PAW", "TAIL", "BURMESE", "RAGDOLL", "MITTENS", "PROWL", "MILK", "BASKET", "MOUSE", "MEOW"]},
    "coffee":            {"label": "Coffee",               "emoji": "☕",
        "words": ["BEAN", "GRIND", "ROAST", "ESPRESSO", "LATTE", "FLAT", "WHITE", "MOCHA", "PICCOLO", "BARISTA", "FOAM", "CREMA", "BREW", "FILTER", "MUG", "PRESS"]},
    "mens_shed":         {"label": "Men's Shed",           "emoji": "🛠️",
        "words": ["TOOLS", "BENCH", "VICE", "SAWBENCH", "PLANE", "CHISEL", "TIMBER", "WORKSHOP", "MATES", "REPAIR", "BUILD", "SAND", "VARNISH", "MEASURE", "ROUTER", "CLAMP"]},
}


def list_themes() -> List[Dict]:
    """Public-facing theme summaries (no word leakage)."""
    out = []
    for key, t in THEMES.items():
        out.append({"key": key, "label": t["label"], "emoji": t["emoji"], "word_count": len(t["words"])})
    return out


def _pick_words(theme_key: str, difficulty: str, seed: int) -> List[str]:
    rng = random.Random(seed)
    diff = DIFFICULTIES[difficulty]
    pool = [w for w in THEMES[theme_key]["words"] if diff["min_len"] <= len(w) <= diff["max_len"]]
    # Fallback: if filter is too strict, broaden but still respect overall caps
    if len(pool) < diff["num_words"]:
        pool = [w for w in THEMES[theme_key]["words"] if 3 <= len(w) <= diff["max_len"]]
    rng.shuffle(pool)
    return pool[: diff["num_words"]]


# Direction vectors: (dr, dc, reversed?)
_DIR_VECTORS: Dict[str, Tuple[int, int, bool]] = {
    "h":     (0, 1, False),
    "v":     (1, 0, False),
    "d":     (1, 1, False),
    "h_rev": (0, -1, True),
    "v_rev": (-1, 0, True),
    "d_rev": (-1, -1, True),
    "ad":    (1, -1, False),   # anti-diagonal (only used if "d" enabled and rng picks it)
    "ad_rev": (-1, 1, True),
}


def _can_place(grid: List[List[str]], word: str, r: int, c: int, dr: int, dc: int) -> bool:
    n = len(grid)
    for k, ch in enumerate(word):
        rr = r + dr * k
        cc = c + dc * k
        if rr < 0 or rr >= n or cc < 0 or cc >= n:
            return False
        if grid[rr][cc] not in ("", ch):
            return False
    return True


def _place(grid: List[List[str]], word: str, r: int, c: int, dr: int, dc: int) -> List[List[int]]:
    cells: List[List[int]] = []
    for k, ch in enumerate(word):
        rr = r + dr * k
        cc = c + dc * k
        grid[rr][cc] = ch
        cells.append([rr, cc])
    return cells


def generate_puzzle(theme_key: str, difficulty: str, seed: int) -> Dict:
    """Deterministic puzzle for a given (theme, difficulty, seed). Same seed → same puzzle."""
    if theme_key not in THEMES:
        raise ValueError(f"Unknown theme: {theme_key}")
    if difficulty not in DIFFICULTIES:
        raise ValueError(f"Unknown difficulty: {difficulty}")

    diff = DIFFICULTIES[difficulty]
    size = diff["size"]
    rng = random.Random(seed)
    words = _pick_words(theme_key, difficulty, seed)
    # Sort longest first to improve placement success rate
    words.sort(key=len, reverse=True)

    allowed_dirs = list(diff["directions"])
    # If diagonals enabled, also allow anti-diagonal variants for visual variety
    if "d" in allowed_dirs:
        allowed_dirs = allowed_dirs + ["ad"]
    if "d_rev" in allowed_dirs:
        allowed_dirs = allowed_dirs + ["ad_rev"]

    grid: List[List[str]] = [["" for _ in range(size)] for _ in range(size)]
    placements: Dict[str, List[List[int]]] = {}

    for word in words:
        placed = False
        for _attempt in range(200):
            d_key = rng.choice(allowed_dirs)
            dr, dc, _rev = _DIR_VECTORS[d_key]
            r = rng.randrange(size)
            c = rng.randrange(size)
            if _can_place(grid, word, r, c, dr, dc):
                cells = _place(grid, word, r, c, dr, dc)
                placements[word] = cells
                placed = True
                break
        if not placed:
            # Last-resort: scan every cell × every direction
            for d_key in allowed_dirs:
                dr, dc, _ = _DIR_VECTORS[d_key]
                for r in range(size):
                    for c in range(size):
                        if _can_place(grid, word, r, c, dr, dc):
                            cells = _place(grid, word, r, c, dr, dc)
                            placements[word] = cells
                            placed = True
                            break
                    if placed:
                        break
                if placed:
                    break
        # If still not placed (rare with our word/grid sizes), silently drop it

    # Fill remaining cells with random letters (deterministic)
    for r in range(size):
        for c in range(size):
            if not grid[r][c]:
                grid[r][c] = chr(ord("A") + rng.randrange(26))

    placed_words = list(placements.keys())

    return {
        "theme": theme_key,
        "theme_label": THEMES[theme_key]["label"],
        "theme_emoji": THEMES[theme_key]["emoji"],
        "difficulty": difficulty,
        "difficulty_label": diff["label"],
        "size": size,
        "grid": grid,
        "words": placed_words,
        "placements": placements,
        "points": diff["points"],
        "hint_quota": diff["hints"],
        "seed": seed,
    }


def daily_seed_for(date_iso: str) -> int:
    """Stable integer seed from a YYYY-MM-DD string."""
    return abs(hash(date_iso)) % (10 ** 9)


def daily_pick(date_iso: str) -> Dict[str, str]:
    """Pick today's daily theme + difficulty deterministically."""
    seed = daily_seed_for(date_iso)
    rng = random.Random(seed)
    theme_key = rng.choice(list(THEMES.keys()))
    # Rotate difficulties so daily challenge feels varied but accessible
    difficulty = rng.choice(["easy", "moderate", "moderate", "hard"])
    return {"theme": theme_key, "difficulty": difficulty, "seed": seed}


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()
