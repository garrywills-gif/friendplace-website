"""George & Georgia — always-available AI companion.

A warm, free-form conversational companion for members. NOT a
questionnaire and NOT a feature-routing bot. See service.py.
"""
from .service import (  # noqa: F401
    get_or_create_companion_session,
    companion_turn,
    reset_companion_session,
    ensure_indexes,
)
