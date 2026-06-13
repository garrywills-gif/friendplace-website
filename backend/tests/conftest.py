"""Pytest conftest for YouBelong backend tests.

- Ensures /app/backend is on sys.path so test files can import server modules
  (e.g., `from trivia_data import QUESTIONS`).
- Sets EXPO_PUBLIC_BACKEND_URL default if the runner forgot to export it.
"""
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://belong-together.preview.emergentagent.com",
)
