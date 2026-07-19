"""Channel-agnostic Signal event bus.

Any time a Signal or Case is created / transitioned / assigned, the
service publishes an event to this bus. Anyone can subscribe:

* SSE endpoint (Phase 1)
* Phone-push worker (Phase 3)
* Email worker (Phase 3)
* Mobile-app WebSocket bridge (later)
* Analytics stream (later)

Subscribers get their own ``asyncio.Queue`` — no coupling between them,
no single point of failure, no polling. The bus is deliberately
in-process for Phase 1 (Mongo Change Streams could replace or
complement it later; the subscriber contract wouldn't change).

Design refs:
- `/app/memory/mcgs-architecture.md` §9 (Scalability plan, Lever 1)
- `/app/memory/mcgs-phase1-plan.md` §3.4
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional

log = logging.getLogger("friendplace.mcgs.events")

# All valid event types.
EVENT_TYPES = {
    "signal.created", "signal.updated",
    "case.created", "case.updated", "case.assigned",
}


class SignalEventBus:
    """In-process pub/sub. One instance per FastAPI process."""

    def __init__(self, buffer_size: int = 256) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._buffer_size = buffer_size

    async def publish(self, event_type: str, **payload: Any) -> None:
        if event_type not in EVENT_TYPES:
            log.warning("unknown event type %s; publishing anyway", event_type)

        envelope = {
            "type": event_type,
            "at": datetime.now(timezone.utc).isoformat(),
            **payload,
        }

        # Fan out to every subscriber. Never let one slow subscriber
        # block the others. Drop with a warning if a queue is full.
        dead: list[asyncio.Queue] = []
        for q in list(self._subscribers):
            try:
                q.put_nowait(envelope)
            except asyncio.QueueFull:
                log.warning("subscriber queue full — dropping event %s", event_type)
            except Exception:
                dead.append(q)
        for q in dead:
            self._subscribers.discard(q)

    async def subscribe(self) -> tuple[asyncio.Queue, callable]:
        """Register a subscriber and return the queue + unsubscribe fn."""
        q: asyncio.Queue = asyncio.Queue(maxsize=self._buffer_size)
        self._subscribers.add(q)

        def _unsub() -> None:
            self._subscribers.discard(q)

        return q, _unsub

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)


# Module-level singleton so any code path can publish without wiring.
# Callers must be inside a running event loop when using it.
signal_events = SignalEventBus()


async def iter_events(q: asyncio.Queue) -> AsyncIterator[dict]:
    """Convenience async iterator wrapper for a subscription queue."""
    while True:
        event = await q.get()
        yield event
