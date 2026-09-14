"""MCGS Email — a combined FriendPlace mailbox inbox.

Ingests real inbound email (via a provider webhook) addressed to any
managed FriendPlace address, stores it threaded, and lets Mission
Control read / mark / archive / reply — reusing the existing Resend
outbound infrastructure. Mailboxes are data-driven so new addresses
are added from MCGS without code changes.
"""

from services.email_inbox.store import (
    DEFAULT_MAILBOXES,
    seed_default_mailboxes,
    ensure_inbox_indexes,
)
from services.email_inbox.router import build_email_inbox_router

__all__ = [
    "DEFAULT_MAILBOXES",
    "seed_default_mailboxes",
    "ensure_inbox_indexes",
    "build_email_inbox_router",
]
