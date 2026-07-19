"""George Platform — permissions layer.

George is a shared platform. He doesn't decide who can publish; he asks
FriendPlace. This module is that question.

Actors have PERMISSIONS. Roles are not the source of truth. An
organisation may be highly trusted (`publish_events=True`) or not
(`publish_events=False`) — the same role behaves differently depending
on its permission object.

Current capabilities (June 2026):
  - `publish_events` — approving a George draft goes straight to `events`.

Future capabilities the object is designed to hold (not yet enforced):
  - `create_groups`
  - `message_members`
  - `manage_volunteers`

Usage
-----
    from services.george.permissions import can, actor_permissions

    perms = await actor_permissions(db, actor_id=..., actor_role=...)
    if can(perms, "publish_events"):
        # publish
    else:
        # send to the FriendPlace team for a look
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Optional

# The permission keys we currently know about. Add here as new George
# capabilities graduate from concept to permission-gated behaviour.
KNOWN_CAPABILITIES = (
    "publish_events",
    "create_groups",
    "message_members",
    "manage_volunteers",
)

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

def default_permissions(role: str) -> Dict[str, bool]:
    """The permission set an actor of a given role has BEFORE we look at
    their own stored overrides.

    - Admins: everything on. Publishing is one of the things they do.
    - Members: everything off. They always route through the FriendPlace team.
    - Organisations: everything off by default; permissions are earned per-org.
    """
    if role == "admin":
        return {k: True for k in KNOWN_CAPABILITIES}
    return {k: False for k in KNOWN_CAPABILITIES}


# ---------------------------------------------------------------------------
# Resolution — permission object for a specific actor
# ---------------------------------------------------------------------------

async def actor_permissions(
    db: Any,
    *,
    actor_id: Optional[str],
    actor_role: str,
) -> Dict[str, bool]:
    """Resolve the effective permission object for an actor.

    Order of precedence (highest wins):
      1. Explicit overrides on the actor document itself.
         - members  → users collection (currently no overrides supported).
         - organisations → organisations collection (`permissions.*`).
         - admins  → no overrides needed; role default is full trust.
      2. Role default from `default_permissions`.

    Unknown keys are ignored; missing keys fall back to the role default.
    """
    perms = dict(default_permissions(actor_role))

    if not actor_id or actor_role == "admin":
        return perms

    stored: Optional[dict] = None
    try:
        if actor_role == "organisation":
            stored = await db.organisations.find_one({"id": actor_id}, {"_id": 0, "permissions": 1})
        elif actor_role == "member":
            stored = await db.users.find_one({"id": actor_id}, {"_id": 0, "permissions": 1})
    except Exception:
        # Never crash George on a permissions read — fall back to defaults.
        stored = None

    overrides = (stored or {}).get("permissions") or {}
    for k in KNOWN_CAPABILITIES:
        if k in overrides and isinstance(overrides[k], bool):
            perms[k] = overrides[k]
    return perms


def can(perms: Dict[str, bool], capability: str) -> bool:
    """True iff the actor has the given capability enabled."""
    return bool(perms.get(capability))


def audit_summary(perms: Dict[str, bool], capabilities: Iterable[str] | None = None) -> Dict[str, bool]:
    """Return a stable subset of the permission object for audit logging."""
    keys = list(capabilities) if capabilities is not None else list(KNOWN_CAPABILITIES)
    return {k: bool(perms.get(k)) for k in keys}
