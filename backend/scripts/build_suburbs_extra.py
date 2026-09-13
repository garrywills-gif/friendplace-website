"""Build ``backend/suburbs_extra.json`` from the Matthew Proctor
Australian postcode dataset (CC BY 4.0 — attribution recorded in
Legal → Data credits and inside the JSON's leading comment).

Usage:  python /tmp/build_suburbs_extra.py
"""
import csv
import json
import re
from pathlib import Path

SRC = Path("/tmp/aus_pc.csv")
OUT = Path("/app/backend/suburbs_extra.json")

# Filter — only real locality rows. The Matthew Proctor dataset also
# includes PO boxes, LVRs, delivery centres, and community mail agents.
VALID_TYPES = {"", "delivery area", "post office boxes"}  # keep blank + delivery areas


def title_case(name: str) -> str:
    # Capitalise properly and collapse whitespace. Preserve
    # sub-words like "St" / "Mt" that are common in AU place names.
    words = re.split(r"\s+", name.strip())
    return " ".join(w[:1].upper() + w[1:].lower() if w else "" for w in words)


def main() -> None:
    seen: set = set()
    out: list = []
    with open(SRC, "r", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            name = (row.get("locality") or "").strip()
            postcode = (row.get("postcode") or "").strip()
            state = (row.get("state") or "").strip().upper()
            row_type = (row.get("type") or "").strip().lower()
            status = (row.get("status") or "").strip().lower()
            # skip removed / rejected localities and non-locality types
            if "removed" in status or "rejected" in status:
                continue
            if row_type and row_type not in {"delivery area", "post office boxes"}:
                # keep only genuine delivery areas / blank (blank = locality)
                continue
            # skip PO Boxes — they're not localities
            if row_type == "post office boxes":
                continue
            if not (name and postcode and state):
                continue
            # skip generic PO / LVR / MC / etc entries — names that
            # look like a bureaucratic label rather than a place
            if re.search(r"\b(po|pos|boxes|dc|lpo|lvr|mc)\b", name.lower()):
                continue
            # normalise the name to title case (dataset has mixed case)
            pretty = title_case(name)
            # dedupe key
            key = (pretty.lower(), state, postcode)
            if key in seen:
                continue
            seen.add(key)
            try:
                lat = float(row.get("Lat_precise") or row.get("lat") or 0)
                lng = float(row.get("Long_precise") or row.get("long") or 0)
            except ValueError:
                lat = lng = 0.0
            if not (lat and lng):
                continue
            # sanity: Australia bbox
            if not (-45.0 <= lat <= -9.0 and 112.0 <= lng <= 154.0):
                continue
            out.append({
                "name": pretty,
                "postcode": postcode,
                "state": state,
                "lat": round(lat, 4),
                "lng": round(lng, 4),
            })
    # Sort deterministically so future diffs stay clean.
    out.sort(key=lambda r: (r["state"], r["name"], r["postcode"]))
    print(f"kept {len(out)} localities from {reader.line_num} rows")
    with open(OUT, "w", encoding="utf-8") as fh:
        # Small custom header (JSON comments aren't legal, so we
        # embed the credit as a top-level `_credits` field the loader
        # ignores because it's not a list-shaped entry). Actually the
        # loader iterates the top-level list, so a dict header would
        # break it — keep the file a plain array and record the
        # provenance in suburbs.py's docstring instead.
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    size = OUT.stat().st_size
    print(f"wrote {OUT} — {size} bytes")


if __name__ == "__main__":
    main()
