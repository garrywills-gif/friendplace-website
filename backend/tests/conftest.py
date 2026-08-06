"""Pytest conftest for FriendPlace backend tests.

- Ensures /app/backend is on sys.path so test files can import server modules
  (e.g., `from trivia_data import QUESTIONS`).
- Sets EXPO_PUBLIC_BACKEND_URL default if the runner forgot to export it.
- Exposes ``TEST_MARKER`` \u2014 the canonical shape every test/seed writer
  should merge into its Mongo inserts so George's operational counts
  ignore them. See /app/backend/services/george/tools.py::exclude_test_data.
"""
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://george-mcgs-cms.preview.emergentagent.com",
)


# Canonical marker every test / seed insert must carry.
#
# Usage:
#   from tests.conftest import TEST_MARKER
#   await db.support_tickets.insert_one({**ticket, **TEST_MARKER})
#
# The `is_test` boolean is the primary signal (checked by George's tools);
# `environment` is a future-proof secondary. `created_by_test` names the
# source so we can trace stray records to a specific fixture. `origin`
# aligns with the iter155 Bridge cleanup schema so live Bridge queries
# (which filter ``origin='production'``) automatically exclude these.
TEST_MARKER = {
    "is_test": True,
    "environment": "test",
    "origin": "test",
}


def marker(source: str) -> dict:
    """Return TEST_MARKER with a ``created_by_test`` label attached.
    Prefer this over ``TEST_MARKER`` when you know the fixture name."""
    return {**TEST_MARKER, "created_by_test": source}
