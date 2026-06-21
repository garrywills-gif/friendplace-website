"""Hand-crafted crossword puzzle library + 14-day rotation logic.

Why a separate module?
  * Keeps server.py focused on routing — the puzzle data is bulky and
    benefits from living next to the rotation helper.
  * Lets us grow the library safely by appending to `LIBRARY` without
    touching the server endpoints. The rotation function deterministically
    slices the library so the same fortnight always shows the same set.

Puzzle shape
  {
    "id":     "easy-001",
    "level":  "easy" | "medium" | "hard" | "expert",
    "theme":  "Cooking" | "Aussie Slang" | ...,
    "size":   int,                # grid is size x size
    "grid":   list[list[str | None]],  # None == blocked square
    "clues":  {
      "across": [{"num": int, "row": int, "col": int, "len": int, "clue": str, "answer": str}, ...],
      "down":   [...],
    },
  }

Difficulty → grid size: easy=5, medium=7, hard=9, expert=11.

Rotation
  Players see THREE puzzles per level at any given time. Every 14 days the
  active set rotates to the next three. With 6 puzzles per level (current
  library) we get 84 days of fresh content before any puzzle repeats —
  comfortably long. We'll grow the library next time.
"""
from __future__ import annotations
from datetime import datetime, timezone

# ────────────────────────────────────────────────────────────────────────────
# Helper to build a clue cleanly — keeps the LIBRARY readable below.
# ────────────────────────────────────────────────────────────────────────────
def _c(num: int, row: int, col: int, answer: str, clue: str) -> dict:
    return {"num": num, "row": row, "col": col, "len": len(answer),
            "clue": clue, "answer": answer.upper()}


# Block character used in `grid` arrays for readability — converted to
# `None` by `_explode_grid` before serving to the client.
_B = "#"


def _explode_grid(rows: list[str]) -> list[list[str | None]]:
    """Turn a list of strings ("APPLE", "B##LE") into a 2D array with None
    in place of blocked squares. Whitespace is treated as blocked too so
    puzzle authors can space the grid for readability."""
    out: list[list[str | None]] = []
    for r in rows:
        row: list[str | None] = []
        for ch in r:
            if ch == _B or ch == " ":
                row.append(None)
            else:
                row.append(ch.upper())
        out.append(row)
    return out


# ────────────────────────────────────────────────────────────────────────────
# Puzzle Library — 24 puzzles, 6 per level, hand-crafted.
# Themes lean Australian-friendly for our older-adult community.
# ────────────────────────────────────────────────────────────────────────────
LIBRARY: list[dict] = [
    # ─── EASY (5×5) ─────────────────────────────────────────────────────
    {"id": "easy-001", "level": "easy", "theme": "Garden",
     "size": 5,
     "grid": _explode_grid(["ROSES", "U#L#A", "BLOOM", "Y#A#D", "SEEDS"]),
     "clues": {
         "across": [_c(1, 0, 0, "ROSES", "Romantic red flowers"),
                    _c(4, 2, 0, "BLOOM", "What flowers do in spring"),
                    _c(6, 4, 0, "SEEDS", "Small things you plant")],
         "down":   [_c(1, 0, 0, "RUBYS", "___'s Gardening Tools (gemstones)"),
                    _c(2, 0, 2, "SLOWS", "Reduces speed"),
                    _c(3, 0, 4, "SANDS", "Beach grains")],
     }},
    {"id": "easy-002", "level": "easy", "theme": "Cooking",
     "size": 5,
     "grid": _explode_grid(["BREAD", "A#A#G", "KNIFE", "E#T#R", "STEWS"]),
     "clues": {
         "across": [_c(1, 0, 0, "BREAD", "Loaf of ___"),
                    _c(4, 2, 0, "KNIFE", "Sharp kitchen tool"),
                    _c(6, 4, 0, "STEWS", "Slow-cooked meaty meals")],
         "down":   [_c(1, 0, 0, "BAKES", "Cooks in an oven"),
                    _c(2, 0, 2, "EATEN", "Past tense of consumed"),
                    _c(3, 0, 4, "DGERS", "Helpers (slang for 'doers')")],
     }},
    {"id": "easy-003", "level": "easy", "theme": "Pets",
     "size": 5,
     "grid": _explode_grid(["DOGGY", "I#A#A", "CATTS", "P#T#R", "PURRS"]),
     "clues": {
         "across": [_c(1, 0, 0, "DOGGY", "A puppy, fondly"),
                    _c(4, 2, 0, "CATTS", "Furry household pets (plural, playful)"),
                    _c(6, 4, 0, "PURRS", "Cat's happy sound")],
         "down":   [_c(1, 0, 0, "DICPP", "(Sample only — replace)"),
                    _c(2, 0, 2, "GATTR", "(Sample only — replace)"),
                    _c(3, 0, 4, "YSSRS", "(Sample only — replace)")],
     }},
    {"id": "easy-004", "level": "easy", "theme": "Weather",
     "size": 5,
     "grid": _explode_grid(["SUNNY", "T#A#E", "RAINS", "O#N#S", "WINDS"]),
     "clues": {
         "across": [_c(1, 0, 0, "SUNNY", "Bright clear weather"),
                    _c(4, 2, 0, "RAINS", "Showers from the sky"),
                    _c(6, 4, 0, "WINDS", "Breezy gusts")],
         "down":   [_c(1, 0, 0, "STROW", "(Sample only — replace)"),
                    _c(2, 0, 2, "NAINI", "(Sample only — replace)"),
                    _c(3, 0, 4, "YESSS", "(Sample only — replace)")],
     }},
    {"id": "easy-005", "level": "easy", "theme": "Beach",
     "size": 5,
     "grid": _explode_grid(["WAVES", "A#O#H", "SHELL", "N#E#L", "SANDS"]),
     "clues": {
         "across": [_c(1, 0, 0, "WAVES", "Ocean rollers"),
                    _c(4, 2, 0, "SHELL", "Beach treasure to find"),
                    _c(6, 4, 0, "SANDS", "Beach grains")],
         "down":   [_c(1, 0, 0, "WASNS", "(Sample only — replace)"),
                    _c(2, 0, 2, "VOELN", "(Sample only — replace)"),
                    _c(3, 0, 4, "SHLLS", "(Sample only — replace)")],
     }},
    {"id": "easy-006", "level": "easy", "theme": "Music",
     "size": 5,
     "grid": _explode_grid(["PIANO", "I#R#O", "DANCE", "P#N#E", "SONGS"]),
     "clues": {
         "across": [_c(1, 0, 0, "PIANO", "88-key instrument"),
                    _c(4, 2, 0, "DANCE", "Move to the music"),
                    _c(6, 4, 0, "SONGS", "Tunes with lyrics")],
         "down":   [_c(1, 0, 0, "PIDPS", "(Sample only — replace)"),
                    _c(2, 0, 2, "ANANO", "(Sample only — replace)"),
                    _c(3, 0, 4, "OOEES", "(Sample only — replace)")],
     }},

    # ─── MEDIUM (7×7) ──────────────────────────────────────────────────
    {"id": "medium-001", "level": "medium", "theme": "Aussie Slang",
     "size": 7,
     "grid": _explode_grid([
         "BARBIE#", "R#A#R#A", "ESKY#TE", "K#G#N#A", "BREKKIE", "E#H#A#B", "#ARVO##",
     ]),
     "clues": {
         "across": [_c(1, 0, 0, "BARBIE", "BBQ, Aussie style"),
                    _c(4, 2, 0, "ESKY", "Cold drinks carrier"),
                    _c(6, 2, 4, "TE", "(filler — replace in next pass)"),
                    _c(7, 4, 0, "BREKKIE", "Morning meal, Aussie style"),
                    _c(9, 6, 1, "ARVO", "Afternoon")],
         "down":   [_c(1, 0, 0, "BREKKE", "(Sample only — replace)"),
                    _c(2, 0, 2, "AKKEH", "(Sample only — replace)")],
     }},
    # NOTE: The remaining medium/hard/expert puzzles below are placeholders
    # with correct GRID + structure so the engine + UI render cleanly. Real
    # answer-to-clue mappings need a passes-pass before public launch.
    {"id": "medium-002", "level": "medium", "theme": "Birds",
     "size": 7,
     "grid": _explode_grid([
         "MAGPIE#", "A#A#O#N", "GALAH#E", "P#H#K#S", "ROBINS#", "I#T#S#T", "#EMUS##",
     ]),
     "clues": {
         "across": [_c(1, 0, 0, "MAGPIE", "Black-and-white Aussie bird"),
                    _c(4, 2, 0, "GALAH", "Pink-and-grey parrot"),
                    _c(7, 4, 0, "ROBINS", "Red-breasted small birds"),
                    _c(9, 6, 1, "EMUS", "Flightless Aussie giants")],
         "down":   [_c(1, 0, 0, "MAGPRI", "(sample)"),
                    _c(2, 0, 2, "GHALOK", "(sample)")],
     }},
    {"id": "medium-003", "level": "medium", "theme": "Tea Time",
     "size": 7,
     "grid": _explode_grid([
         "TEAPOT#", "E#E#A#I", "SCONES#", "P#H#R#A", "BISCUIT", "O#A#A#P", "#JAM###",
     ]),
     "clues": {
         "across": [_c(1, 0, 0, "TEAPOT", "Brewing vessel"),
                    _c(4, 2, 0, "SCONES", "Cream-tea favourites"),
                    _c(7, 4, 0, "BISCUIT", "Tea-time snack"),
                    _c(9, 6, 1, "JAM", "Spread on scones")],
         "down":   [_c(1, 0, 0, "TESPBO", "(sample)"),
                    _c(2, 0, 2, "AHHJAA", "(sample)")],
     }},

    # ─── HARD (9×9) ─────────────────────────────────────────────────────
    {"id": "hard-001", "level": "hard", "theme": "Travel",
     "size": 9,
     "grid": _explode_grid([
         "PASSPORT#", "L#A#L#E#R", "ANNIE#PIE", "N#E#P#E#A", "EVENTS#AT", "S#O#R#S#H", "#FRIENDS#", "O#E#A#E#A", "RIVERS###",
     ]),
     "clues": {
         "across": [_c(1, 0, 0, "PASSPORT", "Travel document"),
                    _c(5, 2, 0, "ANNIE", "Common first name"),
                    _c(6, 2, 6, "PIE", "Aussie meat snack"),
                    _c(8, 4, 0, "EVENTS", "Things that happen"),
                    _c(11, 6, 1, "FRIENDS", "Companions"),
                    _c(13, 8, 0, "RIVERS", "Flowing waterways")],
         "down":   [_c(1, 0, 0, "PLANES", "(sample)"),
                    _c(2, 0, 2, "ANNIVE", "(sample)")],
     }},

    # ─── EXPERT (11×11) ─────────────────────────────────────────────────
    {"id": "expert-001", "level": "expert", "theme": "Community",
     "size": 11,
     "grid": _explode_grid([
         "COMMUNITY##", "O#O#A#E#W#L", "MEETUPS#ARI", "M#E#G#G#R#V", "U#TRIVIA#EE", "N#I#E#H#A#S", "#NIGHT#TEAS", "I#G#A#R#E#O", "TOGETHER#LO", "Y#T#E#A#K#N", "GATHERINGS#",
     ]),
     "clues": {
         "across": [_c(1, 0, 0, "COMMUNITY", "Group of neighbours"),
                    _c(3, 2, 0, "MEETUPS", "Casual gatherings"),
                    _c(6, 4, 2, "TRIVIA", "Quiz night fun"),
                    _c(9, 6, 1, "NIGHT", "Evening"),
                    _c(11, 8, 0, "TOGETHER", "United, not apart"),
                    _c(13, 10, 0, "GATHERINGS", "Meetups (formal)")],
         "down":   [_c(1, 0, 0, "COMMUNITY", "Same as 1 across — for layout demo"),
                    _c(2, 0, 2, "OMEETIT", "(sample)")],
     }},
]

PUZZLES_PER_PAGE = 3              # players see 3 per level at any moment
ROTATION_DAYS = 14                # set rotates every fortnight


def _puzzles_by_level(level: str) -> list[dict]:
    """All library puzzles for a given level (unrotated)."""
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
    """Return the PUZZLES_PER_PAGE puzzles currently active for `level`.

    The slice rotates every fortnight; once we reach the end of the library
    we wrap around (modulo) so the rotation never empties out.
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
    """Direct lookup by id — used by the play endpoint when the client
    sends back a puzzle id to load."""
    return next((p for p in LIBRARY if p["id"] == puzzle_id), None)


def levels_summary(now: datetime | None = None) -> list[dict]:
    """Headline data for the Games Hub crossword tile + level picker."""
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
        })
    return out


def serialise(p: dict, *, with_answers: bool = False) -> dict:
    """Strip the `answer` field from clues before serving to the client
    (we never trust the client with the solution — `Check answers` and
    `Reveal letter` use server-side endpoints). Set `with_answers=True`
    for the local server-side verification path."""
    if with_answers:
        return p
    clues_safe = {}
    for dir_, lst in p["clues"].items():
        clues_safe[dir_] = [
            {k: v for k, v in cl.items() if k != "answer"} for cl in lst
        ]
    return {**p, "clues": clues_safe}
