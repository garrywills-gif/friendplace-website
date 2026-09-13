"""
Australian suburb/locality dataset — the single central source used across
Signup, Profile, Find Friends, Notice Board, Community Groups and Local Events.

Data source
-----------
Derived from the community-maintained "Australian Postcodes" dataset by
Matthew Proctor (https://www.matthewproctor.com/australian_postcodes /
https://github.com/matthewproctor/australianpostcodes). The maintainer places
the data in the public domain — no formal attribution is required, though a
link back is encouraged, which we honour here.

The upstream CSV is pre-processed into ``australian_localities.json`` (one
representative row per locality+state, PO-box/removed rows dropped, invalid
0/0 coordinates dropped, names Title-cased). Each row:
``[name, postcode, state, lat, lng]``. ~17,500 localities nationwide, every
one with real coordinates for distance calculation.

To refresh the data, re-run the generator that produced
``australian_localities.json`` from the upstream CSV and redeploy.
"""
from __future__ import annotations

import json
import math
import os
from typing import Dict, List, Optional, Tuple

_DATA_PATH = os.path.join(os.path.dirname(__file__), "australian_localities.json")


def _load() -> List[Tuple[str, str, str, float, float]]:
    with open(_DATA_PATH, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    out: List[Tuple[str, str, str, float, float]] = []
    for row in raw:
        try:
            name, postcode, state, lat, lng = row
            out.append((str(name), str(postcode), str(state), float(lat), float(lng)))
        except (ValueError, TypeError):
            continue
    return out


# (name, postcode, state, lat, lng)
SUBURBS: List[Tuple[str, str, str, float, float]] = _load()

# Dataset build marker — bump when the underlying dataset changes so
# /api/suburbs/meta can prove production is serving the new data.
DATASET_VERSION = "au-localities-2026-full"


def search_suburbs(q: str, limit: int = 20) -> List[Dict]:
    """Rank localities for a typed query.

    Ranking (best first):
      0  name starts with the query
      1  postcode starts with the query
      2  every query word is a prefix of a name word (e.g. "marsd par")
      3  query is a substring of the name
    Ties break on shorter name then alphabetical, so "Windsor" sorts
    above "Windsor Downs" for the query "windsor".
    """
    if not q:
        return []
    needle = q.strip().lower()
    if not needle:
        return []
    words = [w for w in needle.split() if w]
    scored: List[Tuple[int, int, str, Dict]] = []
    for name, postcode, state, lat, lng in SUBURBS:
        n_lower = name.lower()
        score = -1
        if n_lower.startswith(needle):
            score = 0
        elif postcode.startswith(needle) and needle.isdigit():
            score = 1
        elif len(words) > 1 and _all_words_prefix(n_lower, words):
            score = 2
        elif needle in n_lower:
            score = 3
        if score >= 0:
            scored.append((score, len(name), name, {
                "name": name, "postcode": postcode, "state": state,
                "lat": lat, "lng": lng,
            }))
    scored.sort(key=lambda x: (x[0], x[1], x[2]))
    return [s[3] for s in scored[:limit]]


def _all_words_prefix(name_lower: str, words: List[str]) -> bool:
    name_words = name_lower.split()
    for w in words:
        if not any(nw.startswith(w) for nw in name_words):
            return False
    return True


def by_postcode(postcode: str) -> List[Dict]:
    """All localities sharing a postcode (often multiple)."""
    pc = (postcode or "").strip()
    return [
        {"name": n, "postcode": p, "state": s, "lat": la, "lng": lg}
        for n, p, s, la, lg in SUBURBS if p == pc
    ]


def resolve(name: str, state: Optional[str] = None,
            postcode: Optional[str] = None) -> Optional[Dict]:
    """Resolve a locality by name (+ optional state/postcode) to a single
    recognised row with coordinates. Used to validate and geocode a
    locality chosen anywhere in the app (creation locality, backfill, etc.).
    Returns None when the name is not a recognised Australian locality.
    """
    if not name:
        return None
    n = name.strip().lower()
    st = (state or "").strip().upper() or None
    pc = (postcode or "").strip() or None
    best: Optional[Dict] = None
    for nm, p, s, la, lg in SUBURBS:
        if nm.lower() != n:
            continue
        if pc and p == pc:
            return {"name": nm, "postcode": p, "state": s, "lat": la, "lng": lg}
        if st and s == st and best is None:
            best = {"name": nm, "postcode": p, "state": s, "lat": la, "lng": lg}
        elif best is None:
            best = {"name": nm, "postcode": p, "state": s, "lat": la, "lng": lg}
    return best


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance in km between two lat/lng pairs."""
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))
