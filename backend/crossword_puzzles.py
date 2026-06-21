"""Hand-crafted crossword puzzle library + 14-day rotation logic.

The library uses a **slot-based authoring** approach. Each puzzle declares
a list of word slots: (direction, row, col, answer, clue). The
`_build_puzzle` helper:

    1. Lays each word into the grid (cells outside any slot stay blocked).
    2. Validates every intersection — if two slots disagree on a shared
       letter, the module fails to import.
    3. Auto-numbers cells that start an across or down word.

Why this matters: previous iterations had hand-typed grids with broken
intersections and placeholder ("sample only") clues. The builder makes
those errors impossible — the module simply won't load.

Rotation
  Players see THREE puzzles per level at any given time. Every 14 days
  the active set rotates. With 8 puzzles per level the same trio comes
  back every ~16 weeks (well past the user's "fresh every 2 weeks" ask).

Points per completion (one-off per (user, puzzle)):
    easy=5, medium=10, hard=15, expert=25
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional


# ────────────────────────────────────────────────────────────────────────────
# Builder + validator
# ────────────────────────────────────────────────────────────────────────────
Direction = str  # "A" (across) or "D" (down)
Slot = tuple[Direction, int, int, str, str]


def _build_puzzle(
    puzzle_id: str,
    level: str,
    theme: str,
    size: int,
    slots: list[Slot],
) -> dict:
    """Construct, validate and number a crossword puzzle.

    Raises ValueError if any intersection conflicts or any slot is in an
    invalid place. This means a bad puzzle CANNOT ship — the module fails
    to import in dev, surfacing the problem immediately.
    """
    grid: list[list[Optional[str]]] = [[None] * size for _ in range(size)]

    # 1) Place letters and validate intersections.
    for d, r, c, answer, _clue in slots:
        ans = answer.upper()
        for i, ch in enumerate(ans):
            rr = r + i if d == "D" else r
            cc = c + i if d == "A" else c
            if not (0 <= rr < size and 0 <= cc < size):
                raise ValueError(
                    f"{puzzle_id}: slot {d}@({r},{c}) '{ans}' goes off the grid at ({rr},{cc})"
                )
            existing = grid[rr][cc]
            if existing is not None and existing != ch:
                raise ValueError(
                    f"{puzzle_id}: intersection conflict at ({rr},{cc}) — "
                    f"'{existing}' vs '{ch}' from slot {d}@({r},{c}) '{ans}'"
                )
            grid[rr][cc] = ch

    # 2) Auto-number every cell that *starts* an across or down word.
    numbers: dict[tuple[int, int], int] = {}
    counter = 0
    for r in range(size):
        for c in range(size):
            if grid[r][c] is None:
                continue
            starts_across = (
                (c == 0 or grid[r][c - 1] is None)
                and (c + 1 < size and grid[r][c + 1] is not None)
            )
            starts_down = (
                (r == 0 or grid[r - 1][c] is None)
                and (r + 1 < size and grid[r + 1][c] is not None)
            )
            if starts_across or starts_down:
                counter += 1
                numbers[(r, c)] = counter

    # 3) Build numbered clue lists.
    across_clues: list[dict] = []
    down_clues: list[dict] = []
    for d, r, c, answer, clue in slots:
        if (r, c) not in numbers:
            raise ValueError(
                f"{puzzle_id}: slot {d}@({r},{c}) '{answer}' is not at a word start. "
                "Either the cell has a filled neighbour above/left, or the slot has "
                "no continuing cell to the right/below."
            )
        entry = {
            "num": numbers[(r, c)],
            "row": r,
            "col": c,
            "len": len(answer),
            "clue": clue,
            "answer": answer.upper(),
            "dir": d,
        }
        if d == "A":
            across_clues.append(entry)
        elif d == "D":
            down_clues.append(entry)
        else:
            raise ValueError(f"{puzzle_id}: unknown direction '{d}'")

    across_clues.sort(key=lambda x: x["num"])
    down_clues.sort(key=lambda x: x["num"])

    return {
        "id": puzzle_id,
        "level": level,
        "theme": theme,
        "size": size,
        "grid": grid,
        "clues": {"across": across_clues, "down": down_clues},
    }


def _b(id_: str, level: str, theme: str, size: int, slots: list[Slot]) -> dict:
    return _build_puzzle(id_, level, theme, size, slots)


# ════════════════════════════════════════════════════════════════════════
# EASY (5×5) — 8 sparse mini-crosswords
# Each: 2-3 across + 1 down (where words allow)
# ════════════════════════════════════════════════════════════════════════
EASY_PUZZLES = [
    _b("easy-001", "easy", "Garden", 5, [
        ("A", 0, 0, "ROSES", "Romantic flowers, plural"),
        ("A", 2, 0, "TREES", "Tall plants giving shade"),
        ("D", 0, 2, "SEE",   "Catch sight of"),
    ]),
    _b("easy-002", "easy", "Cooking", 5, [
        ("A", 0, 0, "BREAD", "Loaf you bake"),
        ("A", 2, 0, "SUGAR", "Sweet white granules"),
        ("D", 0, 0, "BUS",   "Public transport on wheels"),
    ]),
    _b("easy-003", "easy", "Weather", 5, [
        ("A", 0, 0, "SUNNY", "Bright, clear day"),
        ("A", 2, 0, "RAINS", "Showers from the sky"),
        ("D", 0, 0, "SIR",   "Polite address to a man"),
    ]),
    _b("easy-004", "easy", "Pets", 5, [
        ("A", 0, 0, "PUPPY", "A young dog"),
        ("A", 2, 0, "KITTY", "A young cat, fondly"),
        ("D", 0, 2, "PAT",   "Gentle stroke"),
    ]),
    _b("easy-005", "easy", "Beach", 5, [
        ("A", 0, 0, "WAVES", "Ocean rollers"),
        ("A", 2, 0, "SANDS", "Beach grains, plural"),
        ("D", 0, 0, "WAS",   "Past tense of 'is'"),
    ]),
    _b("easy-006", "easy", "Music", 5, [
        ("A", 0, 0, "NOTES", "Symbols on a music stave"),
        ("A", 2, 0, "TUNES", "Catchy melodies"),
        ("D", 0, 0, "NUT",   "Walnut or peanut"),
    ]),
    _b("easy-007", "easy", "Books", 5, [
        ("A", 0, 0, "BOOKS", "Library treasures"),
        ("A", 2, 0, "PAGES", "Sheets in a novel"),
        ("D", 0, 4, "SOS",   "Distress signal"),
    ]),
    _b("easy-008", "easy", "Family", 5, [
        ("A", 0, 0, "MUMMY", "Mum, affectionately"),
        ("A", 2, 0, "DADDY", "Dad, affectionately"),
        ("D", 0, 0, "MUD",   "Wet earth after rain"),
    ]),
]


# ════════════════════════════════════════════════════════════════════════
# MEDIUM (7×7) — 8 puzzles, 4 across + 1 down each
# ════════════════════════════════════════════════════════════════════════
MEDIUM_PUZZLES = [
    _b("medium-001", "medium", "Aussie Slang", 7, [
        ("A", 0, 0, "BARBIE",  "BBQ, Aussie style"),
        ("A", 2, 0, "ESKY",    "Cold-drinks carrier"),
        ("A", 4, 0, "ARVO",    "Afternoon, slang"),
        ("A", 6, 0, "BREKKIE", "Morning meal, slang"),
        ("D", 0, 0, "BEE",     "Buzzy stinging insect"),
    ]),
    _b("medium-002", "medium", "Aussie Birds", 7, [
        ("A", 0, 0, "MAGPIE",  "Black-and-white warbler"),
        ("A", 2, 0, "GALAH",   "Pink-and-grey parrot"),
        ("A", 4, 0, "ROBIN",   "Red-breasted small bird"),
        ("A", 6, 0, "EMU",     "Flightless Aussie giant"),
        ("D", 0, 0, "MUG",     "Coffee cup"),
    ]),
    _b("medium-003", "medium", "Tea Time", 7, [
        ("A", 0, 0, "TEAPOT",  "Brewing vessel"),
        ("A", 2, 0, "CAKES",   "Birthday treats, plural"),
        ("A", 4, 0, "BISCUIT", "Tea-time snack"),
        ("A", 6, 0, "JAM",     "Spread on scones"),
        ("D", 0, 0, "TIC",     "Nervous twitch"),
    ]),
    _b("medium-004", "medium", "Holidays", 7, [
        ("A", 0, 0, "EASTER",  "Chocolate-egg holiday"),
        ("A", 2, 0, "ANZAC",   "Aussie/Kiwi memorial day"),
        ("A", 4, 0, "XMAS",    "Christmas, abbrev."),
        ("A", 6, 0, "NEWYEAR", "Jan 1 holiday (two words run together)"),
        ("D", 0, 0, "ERA",     "Long stretch of time"),
    ]),
    _b("medium-005", "medium", "Travel", 7, [
        ("A", 0, 0, "PACKING", "Filling the suitcase"),
        ("A", 2, 0, "TICKET",  "Boarding pass partner"),
        ("A", 4, 0, "HOTEL",   "Holiday accommodation"),
        ("A", 6, 0, "FLIGHT",  "Plane journey"),
        ("D", 0, 0, "PIT",     "Hollow in the ground"),
    ]),
    _b("medium-006", "medium", "Sports", 7, [
        ("A", 0, 0, "CRICKET", "Aussie summer game"),
        ("A", 2, 0, "TENNIS",  "Racket sport with a net"),
        ("A", 4, 0, "GOLF",    "Played on greens with clubs"),
        ("A", 6, 0, "RUGBY",   "Footy code with oval ball"),
        ("D", 0, 0, "CAT",     "Pet that purrs"),
    ]),
    _b("medium-007", "medium", "Around the House", 7, [
        ("A", 0, 0, "KITCHEN", "Where the cooking happens"),
        ("A", 2, 0, "LOUNGE",  "Sitting-room"),
        ("A", 4, 0, "GARDEN",  "Outdoor green space"),
        ("A", 6, 0, "PATIO",   "Outdoor paved area"),
    ]),
    _b("medium-008", "medium", "Friends & Family", 7, [
        ("A", 0, 0, "FRIENDS", "Mates"),
        ("A", 2, 0, "FAMILY",  "Loved ones"),
        ("A", 4, 0, "COUSINS", "Aunty's children"),
        ("A", 6, 0, "NANS",    "Grandmothers, plural"),
    ]),
]


# ════════════════════════════════════════════════════════════════════════
# HARD (9×9) — 8 puzzles, 5 across rows + 1 down
# ════════════════════════════════════════════════════════════════════════
HARD_PUZZLES = [
    _b("hard-001", "hard", "Travel & Adventure", 9, [
        ("A", 0, 0, "PASSPORT",  "Travel document"),
        ("A", 2, 0, "CONTINENT", "Major land mass"),
        ("A", 4, 0, "JOURNEY",   "A trip from A to B"),
        ("A", 6, 0, "LANDMARK",  "Famous local feature"),
        ("A", 8, 0, "SOUVENIR",  "Holiday keepsake"),
        ("D", 0, 0, "PIC",       "Photograph, slang"),
    ]),
    _b("hard-002", "hard", "Australian Cities", 9, [
        ("A", 0, 0, "BRISBANE", "QLD capital"),
        ("A", 2, 0, "ADELAIDE", "SA capital"),
        ("A", 4, 0, "HOBART",   "TAS capital"),
        ("A", 6, 0, "CAIRNS",   "Tropical FNQ city"),
        ("A", 8, 0, "GEELONG",  "Victorian seaside city"),
        ("D", 0, 0, "BOA",      "Big constrictor snake"),
    ]),
    _b("hard-003", "hard", "Music & Theatre", 9, [
        ("A", 0, 0, "ORCHESTRA", "Symphony ensemble"),
        ("A", 2, 0, "MUSICIAN",  "Player of instruments"),
        ("A", 4, 0, "OPERA",     "Sung dramatic work"),
        ("A", 6, 0, "CONCERT",   "Live music event"),
        ("A", 8, 0, "STAGE",     "Where the show unfolds"),
        ("D", 0, 4, "ETC",       "And so on, abbrev."),
    ]),
    _b("hard-004", "hard", "Cooking Up A Storm", 9, [
        ("A", 0, 0, "PAVLOVA",   "Iconic Aussie dessert"),
        ("A", 2, 0, "LAMINGTON", "Sponge dipped in chocolate"),
        ("A", 4, 0, "ROAST",     "Sunday lunch tradition"),
        ("A", 6, 0, "DAMPER",    "Campfire bush bread"),
        ("A", 8, 0, "VEGEMITE",  "Salty spread on toast"),
        ("D", 0, 0, "PAL",       "Buddy, mate"),
    ]),
    _b("hard-005", "hard", "Around the World", 9, [
        ("A", 0, 0, "ITALY",   "Land of pasta"),
        ("A", 2, 0, "JAPAN",   "Sushi homeland"),
        ("A", 4, 0, "ENGLAND", "London's country"),
        ("A", 6, 0, "FRANCE",  "Eiffel-tower nation"),
        ("A", 8, 0, "GERMANY", "Land of Oktoberfest"),
        ("D", 0, 4, "YEN",     "Japanese currency"),
    ]),
    _b("hard-006", "hard", "Nature", 9, [
        ("A", 0, 0, "FORESTS",  "Wooded regions, plural"),
        ("A", 2, 0, "MOUNTAIN", "Tall peak"),
        ("A", 4, 0, "RIVER",    "Flowing waterway"),
        ("A", 6, 0, "ESTUARY",  "Where river meets sea"),
        ("A", 8, 0, "REEF",     "Underwater coral ridge"),
        ("D", 0, 4, "SET",      "Group of items"),
    ]),
    _b("hard-007", "hard", "Sports Across Australia", 9, [
        ("A", 0, 0, "NETBALL",  "Hoops, no backboard"),
        ("A", 2, 0, "SAILING",  "Ocean racing sport"),
        ("A", 4, 0, "BOWLS",    "Older-adult favourite green sport"),
        ("A", 6, 0, "SURFING",  "Catching ocean waves"),
        ("A", 8, 0, "FOOTBALL", "Soccer, simply"),
        ("D", 0, 6, "LEG",      "Body part you walk on"),
    ]),
    _b("hard-008", "hard", "Classic Movies", 9, [
        ("A", 0, 0, "GODFATHER", "1972 mafia classic, with 'The'"),
        ("A", 2, 0, "GREASE",    "1978 musical with Travolta"),
        ("A", 4, 0, "ROCKY",     "Stallone boxing series"),
        ("A", 6, 0, "BENHUR",    "Chariot-race epic"),
        ("A", 8, 0, "TITANIC",   "1997 shipwreck film"),
        ("D", 0, 0, "GIG",       "Live music show, slang"),
    ]),
]


# ════════════════════════════════════════════════════════════════════════
# EXPERT (11×11) — 8 puzzles, 6 across rows + 1 down
# ════════════════════════════════════════════════════════════════════════
EXPERT_PUZZLES = [
    _b("expert-001", "expert", "Community Life", 11, [
        ("A", 0, 0,  "COMMUNITY",  "Group of neighbours"),
        ("A", 2, 0,  "GATHERING",  "A get-together"),
        ("A", 4, 0,  "FELLOWSHIP", "Bond of friendship"),
        ("A", 6, 0,  "VOLUNTEER",  "Helper without pay"),
        ("A", 8, 0,  "NEIGHBOUR",  "Person next door"),
        ("A", 10, 0, "TOGETHER",   "United, side by side"),
        ("D", 0, 0,  "COG",        "Tooth on a gear wheel"),
    ]),
    _b("expert-002", "expert", "World Capitals", 11, [
        ("A", 0, 0,  "CANBERRA",   "Aussie capital"),
        ("A", 2, 0,  "WELLINGTON", "Kiwi capital"),
        ("A", 4, 0,  "LONDON",     "Capital of England"),
        ("A", 6, 0,  "WASHINGTON", "USA capital"),
        ("A", 8, 0,  "TOKYO",      "Japan's capital"),
        ("A", 10, 0, "PARIS",      "France's capital"),
        ("D", 0, 0,  "COW",        "Moo-ing farm animal"),
    ]),
    _b("expert-003", "expert", "Famous Australians", 11, [
        ("A", 0, 0,  "BRADMAN",   "Cricketing knight, surname"),
        ("A", 2, 0,  "KIDMAN",    "Aussie actress, _ Nicole"),
        ("A", 4, 0,  "FREEMAN",   "Olympic gold runner Cathy _"),
        ("A", 6, 0,  "MENZIES",   "Long-serving PM Robert _"),
        ("A", 8, 0,  "HUTCHENCE", "INXS frontman Michael _"),
        ("A", 10, 0, "WATSON",    "Surname of cricketer Shane _"),
        ("D", 0, 4,  "MIA",       "Missing-in-action, abbrev."),
    ]),
    _b("expert-004", "expert", "On the Farm", 11, [
        ("A", 0, 0,  "PADDOCK",   "Fenced grazing field"),
        ("A", 2, 0,  "SHEARING",  "Wool-cutting season"),
        ("A", 4, 0,  "WOOLSHED",  "Where shearing happens"),
        ("A", 6, 0,  "LIVESTOCK", "Farm animals (cattle, sheep…)"),
        ("A", 8, 0,  "HARVEST",   "Crop-gathering time"),
        ("A", 10, 0, "RANCHER",   "Cattle-station owner"),
        ("D", 0, 2,  "DOE",       "Female deer"),
    ]),
    _b("expert-005", "expert", "Aussie Cars", 11, [
        ("A", 0, 0,  "HOLDEN",     "Aussie car brand, retired 2020"),
        ("A", 2, 0,  "MUSTANG",    "Ford pony car"),
        ("A", 4, 0,  "VOLKSWAGEN", "German people's car"),
        ("A", 6, 0,  "FALCON",     "Iconic Ford Aussie sedan"),
        ("A", 8, 0,  "TORANA",     "70s Holden classic"),
        ("A", 10, 0, "MONARO",     "Holden muscle car"),
        ("D", 0, 0,  "HAM",        "Sliced pork on sandwiches"),
    ]),
    _b("expert-006", "expert", "Aussie TV Classics", 11, [
        ("A", 0, 0,  "NEIGHBOURS",  "Ramsay Street drama"),
        ("A", 2, 0,  "HOMEANDAWAY", "Summer Bay soap (three words run)"),
        ("A", 4, 0,  "BLUEHEELERS", "Mt Thomas country cop drama"),
        ("A", 6, 0,  "SKIPPY",      "Bush kangaroo TV star"),
        ("A", 8, 0,  "PRISONER",    "80s Cell Block H drama"),
        ("A", 10, 0, "COUNTDOWN",   "Molly Meldrum's music show"),
    ]),
    _b("expert-007", "expert", "Garden Glory", 11, [
        ("A", 0, 0,  "HYDRANGEA",  "Big-bloom hedge plant"),
        ("A", 2, 0,  "FRANGIPANI", "Sweet tropical flower"),
        ("A", 4, 0,  "BOTTLEBRUSH","Red Aussie native shrub"),
        ("A", 6, 0,  "WATTLE",     "Yellow national emblem"),
        ("A", 8, 0,  "EUCALYPT",   "Gum tree, family name"),
        ("A", 10, 0, "GREVILLEA",  "Native bird-attracting shrub"),
        ("D", 0, 2,  "DNA",        "Genetic material"),
    ]),
    _b("expert-008", "expert", "Holiday Spots", 11, [
        ("A", 0, 0,  "GOLDCOAST",  "Surfers Paradise locale"),
        ("A", 2, 0,  "BYRONBAY",   "NSW hippie surf town"),
        ("A", 4, 0,  "BAROSSA",    "SA wine country"),
        ("A", 6, 0,  "KAKADU",     "Top End national park"),
        ("A", 8, 0,  "DAINTREE",   "FNQ ancient rainforest"),
        ("A", 10, 0, "ULURU",      "Red-centre monolith"),
        ("D", 0, 0,  "GOB",        "Mouth, casual slang"),
    ]),
]


# ────────────────────────────────────────────────────────────────────────
# Library aggregate + rotation
# ────────────────────────────────────────────────────────────────────────
LIBRARY: list[dict] = EASY_PUZZLES + MEDIUM_PUZZLES + HARD_PUZZLES + EXPERT_PUZZLES

PUZZLES_PER_PAGE = 3       # players see 3 active per level at any moment
ROTATION_DAYS = 14         # set rotates every fortnight

POINTS_BY_LEVEL = {
    "easy":   5,
    "medium": 10,
    "hard":   15,
    "expert": 25,
}


def _puzzles_by_level(level: str) -> list[dict]:
    return [p for p in LIBRARY if p["level"] == level]


def _current_rotation_window(now: datetime | None = None) -> int:
    """Integer rotation window — bumps by 1 every ROTATION_DAYS.

    Anchored at 2026-01-01 UTC so the window number is stable across
    deploys and processes."""
    if now is None:
        now = datetime.now(timezone.utc)
    anchor = datetime(2026, 1, 1, tzinfo=timezone.utc)
    delta_days = (now - anchor).days
    return max(0, delta_days // ROTATION_DAYS)


def active_puzzles(level: str, now: datetime | None = None) -> list[dict]:
    """Return PUZZLES_PER_PAGE puzzles currently active for `level`.

    Wraps modulo the pool size so the rotation never empties out.
    """
    pool = _puzzles_by_level(level)
    if not pool:
        return []
    window = _current_rotation_window(now)
    start = (window * PUZZLES_PER_PAGE) % len(pool)
    out = []
    for i in range(PUZZLES_PER_PAGE):
        out.append(pool[(start + i) % len(pool)])
    return out


def get_puzzle(puzzle_id: str) -> dict | None:
    return next((p for p in LIBRARY if p["id"] == puzzle_id), None)


def daily_puzzle(now: datetime | None = None) -> dict | None:
    """The shared "Daily Crossword" — same medium-level puzzle for everyone
    on a given UTC date. Rotates one-per-day through `MEDIUM_PUZZLES`.

    Anchored at 2026-01-01 UTC so the schedule is stable across deploys.

    Why medium?
      • Easy is too quick for a daily "let's chat about it" hook.
      • Hard/Expert intimidate first-timers.
      • Medium (7×7) is the social sweet-spot — solvable in ~5–8 min,
        plenty of words to chat about, fits the over-60 audience.
    """
    if not MEDIUM_PUZZLES:
        return None
    if now is None:
        now = datetime.now(timezone.utc)
    anchor = datetime(2026, 1, 1, tzinfo=timezone.utc)
    day_index = max(0, (now - anchor).days)
    return MEDIUM_PUZZLES[day_index % len(MEDIUM_PUZZLES)]


def daily_iso_date(now: datetime | None = None) -> str:
    """The UTC ISO date string for which the daily puzzle is keyed.
    Used by the client to label the daily card ("Tuesday 2 June 2026")."""
    if now is None:
        now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%d")


def levels_summary(now: datetime | None = None) -> list[dict]:
    out = []
    for lvl, label in [("easy", "Easy"), ("medium", "Medium"),
                       ("hard", "Hard"), ("expert", "Expert")]:
        pool = _puzzles_by_level(lvl)
        active = active_puzzles(lvl, now)
        out.append({
            "level": lvl,
            "label": label,
            "size": active[0]["size"] if active else 0,
            "active_count": len(active),
            "library_total": len(pool),
            "points": POINTS_BY_LEVEL.get(lvl, 5),
        })
    return out


def serialise(p: dict, *, with_answers: bool = False) -> dict:
    """Strip the `answer` field from clues before serving to the client.

    `Check answers` and `Reveal letter` go through server-side endpoints
    that read the in-memory puzzle (with answers) directly.
    """
    if with_answers:
        return p
    clues_safe = {}
    for dir_, lst in p["clues"].items():
        clues_safe[dir_] = [
            {k: v for k, v in cl.items() if k != "answer"} for cl in lst
        ]
    return {**p, "clues": clues_safe}
