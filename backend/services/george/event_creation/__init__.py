"""Conversational Event Creation — Phase 3 Milestone A.

George takes a free-form description of an event, extracts what's said,
infers sensible defaults from grounded sources, asks *one* warm
question at a time for genuinely missing fields, and produces a
complete draft as an Action Preview. Nothing is written until a human
taps *Approve*.

See `/app/memory/phase3-plan.md` for scope + principles.
"""
from .service import (
    start_event_conversation,
    take_conversation_turn,
    get_event_session,
    approve_event_draft,
    cancel_event_session,
    actor_george_presence,
    ensure_indexes,
    COLL_CONVERSATIONS,
)

__all__ = [
    "start_event_conversation",
    "take_conversation_turn",
    "get_event_session",
    "approve_event_draft",
    "cancel_event_session",
    "actor_george_presence",
    "ensure_indexes",
    "COLL_CONVERSATIONS",
]
