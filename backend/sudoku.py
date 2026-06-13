"""
Sudoku — deterministic 9x9 puzzle generator.

Produces a valid solved grid via random-but-validity-preserving transformations
of a base sudoku, then removes cells per difficulty.

Rules per house spec:
  easy      → ~40 clues  (~41 empties)
  moderate  → ~32 clues  (~49 empties)
  hard      → ~26 clues  (~55 empties)
  nightmare → ~20 clues  (~61 empties)
"""
from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import Dict, List, Tuple


DIFFICULTIES: Dict[str, Dict] = {
    "easy":      {"label": "Easy",      "clues": 40, "points": 5,  "hints": 3, "max_mistakes": 3},
    "moderate":  {"label": "Moderate",  "clues": 32, "points": 10, "hints": 3, "max_mistakes": 3},
    "hard":      {"label": "Hard",      "clues": 26, "points": 15, "hints": 2, "max_mistakes": 3},
    "nightmare": {"label": "Nightmare", "clues": 20, "points": 25, "hints": 1, "max_mistakes": 3},
}


_BASE: List[List[int]] = [
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    [4, 5, 6, 7, 8, 9, 1, 2, 3],
    [7, 8, 9, 1, 2, 3, 4, 5, 6],
    [2, 3, 4, 5, 6, 7, 8, 9, 1],
    [5, 6, 7, 8, 9, 1, 2, 3, 4],
    [8, 9, 1, 2, 3, 4, 5, 6, 7],
    [3, 4, 5, 6, 7, 8, 9, 1, 2],
    [6, 7, 8, 9, 1, 2, 3, 4, 5],
    [9, 1, 2, 3, 4, 5, 6, 7, 8],
]


def _transform(rng: random.Random) -> List[List[int]]:
    """Apply validity-preserving permutations to the base grid."""
    g = [row[:] for row in _BASE]

    # 1. Digit relabel (permute 1..9)
    perm = list(range(1, 10))
    rng.shuffle(perm)
    mapping = {i + 1: perm[i] for i in range(9)}
    g = [[mapping[v] for v in row] for row in g]

    # 2. Swap rows within each band
    for band in range(3):
        rows = [band * 3 + i for i in range(3)]
        rng.shuffle(rows)
        new_band = [g[r] for r in rows]
        g[band * 3:band * 3 + 3] = new_band

    # 3. Swap columns within each stack
    for stack in range(3):
        cols = [stack * 3 + i for i in range(3)]
        rng.shuffle(cols)
        for r in range(9):
            row = g[r]
            new_row = row[:]
            for i, c in enumerate(cols):
                new_row[stack * 3 + i] = row[c]
            g[r] = new_row

    # 4. Swap bands (groups of 3 rows)
    band_order = [0, 1, 2]
    rng.shuffle(band_order)
    g = [r for b in band_order for r in g[b * 3:b * 3 + 3]]

    # 5. Swap stacks (groups of 3 columns)
    stack_order = [0, 1, 2]
    rng.shuffle(stack_order)
    new_g = []
    for r in range(9):
        new_row = []
        for s in stack_order:
            new_row.extend(g[r][s * 3:s * 3 + 3])
        new_g.append(new_row)
    g = new_g

    # 6. Maybe transpose
    if rng.random() < 0.5:
        g = [[g[r][c] for r in range(9)] for c in range(9)]

    return g


def generate_puzzle(difficulty: str, seed: int) -> Dict:
    if difficulty not in DIFFICULTIES:
        raise ValueError(f"Unknown difficulty: {difficulty}")
    diff = DIFFICULTIES[difficulty]
    rng = random.Random(seed)
    solution = _transform(rng)

    # Remove cells to reach the target clue count.
    # Use a symmetric-ish removal: pick random cells without replacement.
    clue_count = diff["clues"]
    cells_to_remove = 81 - clue_count
    positions = [(r, c) for r in range(9) for c in range(9)]
    rng.shuffle(positions)
    puzzle = [row[:] for row in solution]
    for (r, c) in positions[:cells_to_remove]:
        puzzle[r][c] = 0

    return {
        "difficulty": difficulty,
        "difficulty_label": diff["label"],
        "clues": clue_count,
        "puzzle": puzzle,        # 0 = empty
        "solution": solution,    # full 9x9
        "points": diff["points"],
        "hint_quota": diff["hints"],
        "max_mistakes": diff["max_mistakes"],
        "seed": seed,
    }


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def daily_pick(date_iso: str) -> Dict:
    seed = abs(hash(date_iso)) % (10 ** 9)
    rng = random.Random(seed)
    difficulty = rng.choice(["easy", "moderate", "moderate", "hard"])
    return {"difficulty": difficulty, "seed": seed}
