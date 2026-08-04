"""
System Health probes for The Bridge.

One consolidated status endpoint that aggregates parallel probes across
every operational surface (backend, database, George LLM, email service,
push notifications, storage, website). Designed for operational
visibility — not analytics — so:

  * Each probe reports { name, status, note, response_ms, last_checked }
  * Live probes (LLM + Resend) are cached per-probe for 5 minutes to
    keep costs and latency negligible.
  * The overall payload is cached for 60 seconds to protect against
    accidental hammering when an admin leaves the dashboard open.
  * Any probe can be force-refreshed by passing ``fresh=True``.
  * Individual probes NEVER raise — they downgrade to
    ``status = "unknown"`` with the failure reason in ``note`` so a
    single flaky probe never kills the dashboard.

Design constraints from the product owner (Stabilisation & Polish
phase — Aug 2026):
  * Live cached probes (not just env checks) for George AI + Email.
  * Show response times and last-checked timestamps.
  * Include deployment version + commit + basic DB counts.
  * NO graphs, history, or alerts — this is an operational dashboard.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Literal, Optional

import httpx

log = logging.getLogger("friendplace.system_health")


# ---------------------------------------------------------------------------
# Constants — tuned for a lightweight operational check
# ---------------------------------------------------------------------------

#: Overall payload cache. Prevents accidental hammering while a dashboard
#: tab is left open. Can be bypassed with ``fresh=True``.
OVERALL_TTL_SECONDS: int = 60

#: Per-probe cache for the two live-network probes (George LLM + Resend).
#: We deliberately don't re-hit those integrations every dashboard open.
LIVE_PROBE_TTL_SECONDS: int = 300  # 5 minutes

#: Every probe MUST return within this budget or it's marked degraded.
PROBE_TIMEOUT_SECONDS: float = 4.0

#: Where uploaded flyer / user media lands on disk.
UPLOADS_DIR: Path = Path(__file__).resolve().parent.parent / "uploads"

#: Default public site URL when the ``PUBLIC_SITE_URL`` env var isn't set.
DEFAULT_PUBLIC_SITE_URL: str = "https://friendplace.com.au"


ProbeStatus = Literal["ok", "degraded", "unknown", "disabled"]


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class ProbeResult:
    """Structured result for a single health check."""

    name: str
    status: ProbeStatus
    note: str = ""
    response_ms: Optional[int] = None
    last_checked: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    # Free-form key/value pairs surfaced by specific probes (e.g. site
    # URL, storage size, cached flag). Kept small — the UI shows them as
    # secondary text under the probe card.
    details: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Simple in-memory caches
# ---------------------------------------------------------------------------


_overall_cache: dict[str, tuple[float, dict]] = {}
_probe_cache: dict[str, tuple[float, ProbeResult]] = {}


def _cache_get(cache: dict, key: str, ttl: int) -> Any | None:
    entry = cache.get(key)
    if entry is None:
        return None
    ts, value = entry
    if (time.time() - ts) > ttl:
        return None
    return value


def _cache_set(cache: dict, key: str, value: Any) -> None:
    cache[key] = (time.time(), value)


# ---------------------------------------------------------------------------
# Probe runner — never raises, always times
# ---------------------------------------------------------------------------


async def _run_probe(
    name: str,
    fn: Callable[[], Awaitable[ProbeResult]],
    *,
    timeout: float = PROBE_TIMEOUT_SECONDS,
) -> ProbeResult:
    """Execute a probe with a timeout and structured error handling."""
    started = time.perf_counter()
    try:
        result = await asyncio.wait_for(fn(), timeout=timeout)
    except asyncio.TimeoutError:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return ProbeResult(
            name=name,
            status="degraded",
            note=f"Probe timed out after {timeout:.1f}s.",
            response_ms=elapsed_ms,
        )
    except Exception as exc:  # pragma: no cover - defensive
        log.exception("system_health probe %s crashed", name)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return ProbeResult(
            name=name,
            status="unknown",
            note=f"Probe error: {type(exc).__name__}: {str(exc)[:120]}",
            response_ms=elapsed_ms,
        )
    # If the probe forgot to set response_ms, fill it in.
    if result.response_ms is None:
        result.response_ms = int((time.perf_counter() - started) * 1000)
    return result


# ---------------------------------------------------------------------------
# Individual probes
# ---------------------------------------------------------------------------


async def _probe_backend() -> ProbeResult:
    """Self-report — if this endpoint responds, the API is up.

    Tautological but useful in the UI (it gives admins a labelled
    'Backend API' card next to Database + Website).
    """
    return ProbeResult(
        name="Backend API",
        status="ok",
        note="Serving requests.",
        response_ms=0,
    )


async def _probe_database(db) -> ProbeResult:
    """MongoDB ping — same probe used by /api/health."""
    started = time.perf_counter()
    try:
        await db.command("ping")
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return ProbeResult(
            name="Database",
            status="ok",
            note="MongoDB responding.",
            response_ms=elapsed_ms,
        )
    except Exception as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return ProbeResult(
            name="Database",
            status="degraded",
            note=f"MongoDB ping failed: {str(exc)[:120]}",
            response_ms=elapsed_ms,
        )


async def _probe_george_llm() -> ProbeResult:
    """Live cheapest-possible Haiku ping. Cached for LIVE_PROBE_TTL."""
    cached = _cache_get(_probe_cache, "george_llm", LIVE_PROBE_TTL_SECONDS)
    if cached is not None:
        cached.details = {**cached.details, "cached": True}
        return cached

    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        result = ProbeResult(
            name="George AI",
            status="disabled",
            note="EMERGENT_LLM_KEY not configured.",
            response_ms=0,
        )
        _cache_set(_probe_cache, "george_llm", result)
        return result

    started = time.perf_counter()
    try:
        # Deferred import so unit tests can run without the SDK on path.
        from emergentintegrations.llm.chat import LlmChat, UserMessage

        chat = (
            LlmChat(
                api_key=key,
                session_id="system-health-probe",
                system_message="Reply with the single word: ok",
            )
            .with_model("anthropic", "claude-haiku-4-5-20251001")
        )
        raw = await chat.send_message(UserMessage(text="ok"))
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        ok = bool((raw or "").strip())
        result = ProbeResult(
            name="George AI",
            status="ok" if ok else "degraded",
            note=(
                "George AI responding normally."
                if ok
                else "George AI returned an empty response — key may be stale."
            ),
            response_ms=elapsed_ms,
            details={"model": "claude-haiku-4-5-20251001"},
        )
    except Exception as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        result = ProbeResult(
            name="George AI",
            status="degraded",
            note=f"George AI not reachable: {str(exc)[:140]}",
            response_ms=elapsed_ms,
        )
    _cache_set(_probe_cache, "george_llm", result)
    return result


async def _probe_email() -> ProbeResult:
    """Verify the Resend API key is live by listing domains.

    ``GET https://api.resend.com/domains`` requires only the API key,
    is idempotent, and returns 200 for any active key. Cached 5 min.
    """
    cached = _cache_get(_probe_cache, "email", LIVE_PROBE_TTL_SECONDS)
    if cached is not None:
        cached.details = {**cached.details, "cached": True}
        return cached

    key = os.environ.get("RESEND_API_KEY")
    if not key:
        result = ProbeResult(
            name="Email service",
            status="disabled",
            note="RESEND_API_KEY not configured.",
            response_ms=0,
        )
        _cache_set(_probe_cache, "email", result)
        return result

    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(
                "https://api.resend.com/domains",
                headers={"Authorization": f"Bearer {key}"},
            )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        if r.status_code == 200:
            data = r.json() if r.content else {}
            n = len(data.get("data") or [])
            result = ProbeResult(
                name="Email service",
                status="ok",
                note=f"Resend API reachable ({n} domain{'s' if n != 1 else ''} configured).",
                response_ms=elapsed_ms,
            )
        elif r.status_code in {401, 403}:
            result = ProbeResult(
                name="Email service",
                status="degraded",
                note=f"Resend API rejected the key (HTTP {r.status_code}).",
                response_ms=elapsed_ms,
            )
        else:
            result = ProbeResult(
                name="Email service",
                status="degraded",
                note=f"Resend API returned HTTP {r.status_code}.",
                response_ms=elapsed_ms,
            )
    except httpx.TimeoutException:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        result = ProbeResult(
            name="Email service",
            status="degraded",
            note="Resend API timed out — may be unreachable.",
            response_ms=elapsed_ms,
        )
    except Exception as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        result = ProbeResult(
            name="Email service",
            status="unknown",
            note=f"Resend probe error: {type(exc).__name__}.",
            response_ms=elapsed_ms,
        )
    _cache_set(_probe_cache, "email", result)
    return result


async def _probe_push() -> ProbeResult:
    """Env-check for Emergent push relay (there is no probeable endpoint)."""
    key = os.environ.get("EMERGENT_PUSH_KEY", "")
    if not key or key == "placeholder":
        return ProbeResult(
            name="Push notifications",
            status="disabled",
            note=(
                "Will activate after production deployment — the real key "
                "is injected by the build pipeline when the app is "
                "published to the App Store / Play Store."
            ),
            response_ms=0,
        )
    return ProbeResult(
        name="Push notifications",
        status="ok",
        note="Push key configured.",
        response_ms=0,
    )


async def _probe_storage() -> ProbeResult:
    """Verify the uploads directory is writable and report usage."""
    try:
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        # Cheap write test.
        probe_file = UPLOADS_DIR / ".health_probe"
        probe_file.write_text("ok", encoding="utf-8")
        probe_file.unlink(missing_ok=True)

        # Total disk usage — POSIX du equivalent, but bounded to the
        # uploads dir so we don't scan the whole container.
        total_bytes = sum(
            f.stat().st_size for f in UPLOADS_DIR.rglob("*") if f.is_file()
        )
        # Available space on the mount.
        _, _, free = shutil.disk_usage(UPLOADS_DIR)
        return ProbeResult(
            name="Storage",
            status="ok",
            note=(
                f"Uploads dir writable · {_fmt_bytes(total_bytes)} used · "
                f"{_fmt_bytes(free)} free on the volume."
            ),
            response_ms=0,
            details={
                "used_bytes": total_bytes,
                "free_bytes": free,
                "path": str(UPLOADS_DIR),
            },
        )
    except Exception as exc:
        return ProbeResult(
            name="Storage",
            status="degraded",
            note=f"Uploads dir check failed: {type(exc).__name__}: {str(exc)[:120]}",
            response_ms=0,
        )


async def _probe_website() -> ProbeResult:
    """HEAD the public site URL to verify the marketing site is up.

    Enriches the ``details`` payload with the deployed website version
    and short commit hash so admins can confirm at a glance that the
    live site matches the latest deployment (both come from the same
    monorepo, so equality is expected).
    """
    url = os.environ.get("PUBLIC_SITE_URL", DEFAULT_PUBLIC_SITE_URL)
    deployment = _read_deployment_meta()
    base_details: dict[str, Any] = {
        "url": url,
        "website_version": deployment.get("website_version"),
        "commit_short": deployment.get("commit_short"),
    }
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=3.0, follow_redirects=True) as client:
            r = await client.head(url)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        if 200 <= r.status_code < 400:
            return ProbeResult(
                name="Website",
                status="ok",
                note=f"{url} responded HTTP {r.status_code}.",
                response_ms=elapsed_ms,
                details={**base_details, "status_code": r.status_code},
            )
        return ProbeResult(
            name="Website",
            status="degraded",
            note=f"{url} responded HTTP {r.status_code}.",
            response_ms=elapsed_ms,
            details={**base_details, "status_code": r.status_code},
        )
    except httpx.TimeoutException:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return ProbeResult(
            name="Website",
            status="degraded",
            note=f"{url} timed out.",
            response_ms=elapsed_ms,
            details=base_details,
        )
    except Exception as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return ProbeResult(
            name="Website",
            status="unknown",
            note=f"HEAD failed: {type(exc).__name__}: {str(exc)[:120]}",
            response_ms=elapsed_ms,
            details=base_details,
        )


# ---------------------------------------------------------------------------
# Deployment metadata
# ---------------------------------------------------------------------------


def _read_version_from(package_json: Path) -> Optional[str]:
    try:
        return json.loads(package_json.read_text(encoding="utf-8")).get("version")
    except Exception:
        return None


def _read_deployment_meta() -> dict[str, Any]:
    """Version + last-commit metadata for the footer strip.

    Reads directly from ``git log`` and the two ``package.json`` files
    so we never need to babysit a separate ``VERSION`` file.
    """
    root = Path(__file__).resolve().parent.parent.parent  # /app
    website_version = _read_version_from(root / "website" / "package.json")
    frontend_version = _read_version_from(root / "frontend" / "package.json")

    commit_hash = None
    commit_time = None
    commit_message = None
    try:
        # ``%H`` full hash · ``%ct`` unix commit-time · ``%s`` subject
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%H|%ct|%s"],
            cwd=root,
            timeout=1,
            text=True,
        ).strip()
        parts = out.split("|", 2)
        if len(parts) == 3:
            commit_hash, unix_ts, commit_message = parts
            commit_time = datetime.fromtimestamp(
                int(unix_ts), tz=timezone.utc
            ).isoformat()
    except Exception:
        pass

    return {
        "website_version": website_version,
        "frontend_version": frontend_version,
        "commit_hash": commit_hash,
        "commit_short": (commit_hash[:7] if commit_hash else None),
        "commit_time": commit_time,
        "commit_message": commit_message,
    }


# ---------------------------------------------------------------------------
# Database counts (operational snapshot — NOT analytics)
# ---------------------------------------------------------------------------


async def _database_counts(db) -> dict[str, int]:
    """Small snapshot of core collection sizes.

    Uses ``estimated_document_count`` (near-instant, metadata-only) so
    the dashboard stays snappy even on large collections.
    """
    counts: dict[str, int] = {}
    for coll in (
        "users",
        "events",
        "moments",
        "interest_registrations",
        "campaigns",
        "support_tickets",
        "signals",
    ):
        try:
            counts[coll] = await db[coll].estimated_document_count()
        except Exception:
            counts[coll] = -1  # unknown; UI treats -1 as "—"
    return counts


# ---------------------------------------------------------------------------
# Overall status derivation
# ---------------------------------------------------------------------------


def _overall_status(probes: list[ProbeResult]) -> ProbeStatus:
    """Worst-of-all, ignoring 'disabled' which is a config choice not a fault."""
    order = {"ok": 0, "disabled": 0, "unknown": 1, "degraded": 2}
    live = [p for p in probes if p.status in order]
    if not live:
        return "unknown"
    worst = max(live, key=lambda p: order[p.status])
    return worst.status


def _fmt_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024  # type: ignore[assignment]
    return f"{n:.1f} PB"


# ---------------------------------------------------------------------------
# Public API — collect_health() and helpers
# ---------------------------------------------------------------------------


async def collect_health(db, *, fresh: bool = False) -> dict[str, Any]:
    """Aggregate every probe + metadata block.

    Args:
        db: motor async database handle.
        fresh: bypass the overall cache and force fresh probes.

    Returns a JSON-serialisable dict:

    ::

        {
          "overall": "ok"|"degraded"|"unknown",
          "generated_at": ISO,
          "cached": bool,          # true if this response was served from cache
          "probes": [ProbeResult, ...],
          "counts": {...},
          "deployment": {...}
        }
    """
    if not fresh:
        cached = _cache_get(_overall_cache, "all", OVERALL_TTL_SECONDS)
        if cached is not None:
            return {**cached, "cached": True}

    probes = await asyncio.gather(
        _run_probe("Backend API", _probe_backend),
        _run_probe("Database", lambda: _probe_database(db)),
        _run_probe("George AI", _probe_george_llm),
        _run_probe("Email service", _probe_email),
        _run_probe("Push notifications", _probe_push),
        _run_probe("Storage", _probe_storage),
        _run_probe("Website", _probe_website),
    )

    counts = await _database_counts(db)
    deployment = _read_deployment_meta()

    payload = {
        "overall": _overall_status(list(probes)),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "probes": [asdict(p) for p in probes],
        "counts": counts,
        "deployment": deployment,
    }
    _cache_set(_overall_cache, "all", payload)
    return payload


async def short_health_summary(db) -> Optional[str]:
    """One-sentence health note suitable for embedding in George's briefing.

    Returns ``None`` when everything is ``ok`` so George stays quiet;
    otherwise a compact human-readable summary naming the degraded
    surfaces so George can weave it into the morning briefing.
    """
    payload = await collect_health(db)
    if payload["overall"] == "ok":
        return None
    degraded_names = [
        p["name"]
        for p in payload["probes"]
        if p["status"] in {"degraded", "unknown"}
    ]
    if not degraded_names:
        return None
    if len(degraded_names) == 1:
        return f"{degraded_names[0]} is looking degraded — worth a quick look on the Health tab."
    joined = ", ".join(degraded_names[:-1]) + f" and {degraded_names[-1]}"
    return f"A few surfaces are degraded ({joined}) — the Health tab has the detail."


__all__ = [
    "ProbeResult",
    "collect_health",
    "short_health_summary",
]
