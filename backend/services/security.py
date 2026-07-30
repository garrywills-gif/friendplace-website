"""Admin login security service — Slice 0.5 foundation.

Four-tier defence:
    Tier 1 (Notify)   — ALERT_AFTER_FAILS       → Resend email
    Tier 2 (Block)    — LOCKOUT_AFTER_FAILS     → 429 + Retry-After
    Tier 3 (Escalate) — MASS_ATTACK_FAILS       → MCGS signal on The Bridge
    Tier 4 (Urgent)   — MASS_ATTACK_URGENT      → urgent signal + URGENT email

Every function is safe to call — logging/geo/email failures NEVER block
the caller (auth flow must survive an external outage). The single hard
rule: successful password verification MUST reset the counters. Any
other failure is best-effort.
"""
from __future__ import annotations

import os
import uuid
import re
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

logger = logging.getLogger("friendplace.security")

# ─── config from env (safe defaults) ──────────────────────────────────
def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default

def _feature_on() -> bool:
    return os.environ.get("ADMIN_SECURITY_FEATURES", "true").lower() == "true"

ALERT_AFTER = _env_int("ADMIN_ALERT_AFTER_FAILS", 3)
LOCKOUT_AFTER = _env_int("ADMIN_LOCKOUT_AFTER_FAILS", 5)
LOCKOUT_MINUTES = _env_int("ADMIN_LOCKOUT_MINUTES", 15)
MASS_ATTACK_FAILS = _env_int("ADMIN_MASS_ATTACK_FAILS", 20)
MASS_ATTACK_URGENT = _env_int("ADMIN_MASS_ATTACK_URGENT", 50)
MASS_ATTACK_WINDOW_MIN = _env_int("ADMIN_MASS_ATTACK_WINDOW_MINUTES", 15)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalise_email(email: str) -> str:
    return (email or "").strip().lower()


def client_ip_from_headers(headers: dict, fallback: str = "unknown") -> str:
    """Pull the real client IP from X-Forwarded-For (nginx sets it)."""
    xff = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    real = headers.get("x-real-ip") or headers.get("X-Real-IP")
    if real:
        return real.strip()
    return fallback


# ─── geo lookup (graceful) ────────────────────────────────────────────
# We try offline MaxMind GeoLite2 first; if the DB isn't present, we
# return None. NO runtime HTTP calls — external latency must not gate
# the login response. A production install can drop the DB at the path
# below and geo enrichment starts working automatically.

_GEO_DB_PATH = os.environ.get("GEOIP_DB_PATH", "/app/backend/data/GeoLite2-City.mmdb")
_geo_reader: Any = None

def _geo() -> Any:
    global _geo_reader
    if _geo_reader is not None:
        return _geo_reader
    try:
        import geoip2.database  # optional
        if os.path.exists(_GEO_DB_PATH):
            _geo_reader = geoip2.database.Reader(_GEO_DB_PATH)
            return _geo_reader
    except Exception:
        pass
    _geo_reader = False   # sentinel — do not retry
    return None

def geo_lookup(ip: Optional[str]) -> Optional[dict]:
    if not ip or ip in ("unknown", "127.0.0.1", "localhost"):
        return None
    reader = _geo()
    if not reader:
        return None
    try:
        r = reader.city(ip)
        return {
            "country": getattr(r.country, "iso_code", None),
            "region": (r.subdivisions.most_specific.iso_code
                       if r.subdivisions else None),
            "city": getattr(r.city, "name", None),
        }
    except Exception:
        return None


# ─── user-agent parsing (light, no dep) ───────────────────────────────
_UA_BROWSER = [
    ("Edge", r"Edg/"),
    ("Chrome", r"Chrome/"),
    ("Firefox", r"Firefox/"),
    ("Safari", r"Safari/"),
]
_UA_OS = [
    ("iOS", r"iPhone|iPad|iPod"),
    ("Android", r"Android"),
    ("macOS", r"Mac OS X|Macintosh"),
    ("Windows", r"Windows"),
    ("Linux", r"Linux|X11"),
]

def parse_user_agent(ua: str) -> dict:
    if not ua:
        return {"browser": None, "os": None, "raw": ""}
    return {
        "browser": next((b for b, rx in _UA_BROWSER if re.search(rx, ua)), None),
        "os": next((o for o, rx in _UA_OS if re.search(rx, ua)), None),
        "raw": ua[:200],
    }


# ─── indexes ──────────────────────────────────────────────────────────
async def ensure_indexes(db: Any) -> None:
    """Idempotent — safe to call on every boot."""
    try:
        await db.admin_login_attempts.create_index(
            [("scope", 1), ("key", 1)], unique=True,
        )
        await db.admin_lockouts.create_index(
            [("scope", 1), ("key", 1)], unique=True,
        )
        await db.admin_sessions.create_index("jti", unique=True)
        # TTL: sessions expire naturally at expires_at.
        await db.admin_sessions.create_index(
            "expires_at", expireAfterSeconds=0,
        )
        # Security log kept for 90 days.
        await db.admin_security_log.create_index(
            "created_at", expireAfterSeconds=60 * 60 * 24 * 90,
        )
        logger.info("Admin security indexes verified.")
    except Exception as e:
        logger.warning("ensure_indexes failed: %s", e)


# ─── counters, lockouts, log ──────────────────────────────────────────
async def is_locked(db: Any, scope: str, key: str) -> Optional[dict]:
    """Return the lockout row if key is currently locked, else None."""
    try:
        row = await db.admin_lockouts.find_one(
            {"scope": scope, "key": key, "locked_until": {"$gt": _now()}},
            {"_id": 0},
        )
        return row
    except Exception:
        return None


async def bump_attempt(db: Any, scope: str, key: str) -> dict:
    from pymongo import ReturnDocument
    now = _now()
    row = await db.admin_login_attempts.find_one_and_update(
        {"scope": scope, "key": key},
        {
            "$inc": {"fail_count": 1},
            "$set": {"last_fail_at": now, "updated_at": now},
            "$setOnInsert": {
                "first_fail_at": now, "created_at": now, "alert_sent_at": None,
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return row


async def reset_counters(db: Any, email: str, ip: str) -> None:
    try:
        await db.admin_login_attempts.delete_many({
            "scope": {"$in": ["email", "ip"]},
            "key": {"$in": [email, ip]},
        })
    except Exception:
        pass


async def create_lockout(db: Any, scope: str, key: str, reason: str) -> datetime:
    now = _now()
    locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
    try:
        await db.admin_lockouts.update_one(
            {"scope": scope, "key": key},
            {
                "$set": {
                    "locked_until": locked_until,
                    "reason": reason,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now, "scope": scope, "key": key},
            },
            upsert=True,
        )
    except Exception:
        pass
    return locked_until


async def clear_lockout(db: Any, scope: str, key: str) -> None:
    try:
        await db.admin_lockouts.delete_one({"scope": scope, "key": key})
    except Exception:
        pass


async def log_event(db: Any, **doc: Any) -> None:
    """Append a single security event. Best-effort — never raise."""
    try:
        entry = dict(doc)
        entry["_id"] = str(uuid.uuid4())
        entry["created_at"] = _now()
        await db.admin_security_log.insert_one(entry)
    except Exception:
        pass


# ─── active-session tracking ──────────────────────────────────────────
async def create_session(
    db: Any, *, admin_id: str, email: str, ip: str,
    user_agent: str, geo: Optional[dict], ttl_hours: int = 8,
) -> str:
    jti = str(uuid.uuid4())
    try:
        await db.admin_sessions.insert_one({
            "jti": jti,
            "admin_id": admin_id,
            "email": email,
            "ip": ip,
            "user_agent": user_agent[:200] if user_agent else "",
            "geo": geo,
            "issued_at": _now(),
            "expires_at": _now() + timedelta(hours=ttl_hours),
            "last_seen_at": _now(),
            "revoked_at": None,
        })
    except Exception:
        pass
    return jti


async def session_is_valid(db: Any, jti: Optional[str]) -> bool:
    """Deps: dep on jti presence in `admin_sessions` collection.
    If the JWT has no jti (issued before Slice 0.5), we soft-accept so
    existing sessions don't die on rollout."""
    if not jti:
        return True   # legacy token — soft-accept
    try:
        row = await db.admin_sessions.find_one(
            {"jti": jti},
            {"_id": 0, "revoked_at": 1, "expires_at": 1},
        )
        if not row:
            return True   # migration soft-accept
        if row.get("revoked_at"):
            return False
        exp = row.get("expires_at")
        if exp and exp < _now():
            return False
        # Touch last-seen (best-effort).
        try:
            await db.admin_sessions.update_one(
                {"jti": jti}, {"$set": {"last_seen_at": _now()}},
            )
        except Exception:
            pass
        return True
    except Exception:
        return True   # never block auth on DB fault


async def revoke_session(db: Any, jti: str) -> bool:
    try:
        r = await db.admin_sessions.update_one(
            {"jti": jti, "revoked_at": None},
            {"$set": {"revoked_at": _now()}},
        )
        return r.modified_count > 0
    except Exception:
        return False


# ─── alerting (Resend + MCGS signal) ──────────────────────────────────
def _resend_client() -> Any:
    try:
        import resend
        api_key = os.environ.get("RESEND_API_KEY")
        if not api_key:
            return None
        resend.api_key = api_key
        return resend
    except Exception:
        return None


def _alert_recipients() -> list[str]:
    to = os.environ.get("SECURITY_ALERT_TO") or "hello@friendplace.com.au"
    return [x.strip() for x in to.split(",") if x.strip()]


async def send_alert_email(
    *, email: str, ip: str, ua: dict, geo: Optional[dict],
    count: int, locked: bool, urgent: bool = False,
) -> None:
    client = _resend_client()
    if client is None:
        return
    subject = ("🚨 URGENT " if urgent else "🚨 ") + \
        f"Mission Control login alert · {email}"
    location = None
    if geo:
        parts = [geo.get("city"), geo.get("region"), geo.get("country")]
        location = ", ".join(p for p in parts if p) or None
    html = f"""
    <div style="font-family:-apple-system,Segoe UI,sans-serif;color:#0F172A;max-width:560px">
      <h2 style="color:#B91C1C;margin:0 0 12px">Security Alert</h2>
      <p style="margin:0 0 16px;color:#334155">
        Mission Control detected <strong>{count} failed login attempt{"s" if count != 1 else ""}</strong>
        {"and has temporarily locked this source." if locked else "on your account."}
      </p>
      <table style="border-collapse:collapse;width:100%;margin:14px 0">
        <tr><td style="padding:6px 10px;background:#F8FAFC;font-weight:700">Time</td>
            <td style="padding:6px 10px">{_now().strftime('%Y-%m-%d %H:%M:%S UTC')}</td></tr>
        <tr><td style="padding:6px 10px;background:#F8FAFC;font-weight:700">Email</td>
            <td style="padding:6px 10px"><code>{email}</code></td></tr>
        <tr><td style="padding:6px 10px;background:#F8FAFC;font-weight:700">IP</td>
            <td style="padding:6px 10px"><code>{ip}</code></td></tr>
        <tr><td style="padding:6px 10px;background:#F8FAFC;font-weight:700">Location</td>
            <td style="padding:6px 10px">{location or 'Unknown'}</td></tr>
        <tr><td style="padding:6px 10px;background:#F8FAFC;font-weight:700">Browser / OS</td>
            <td style="padding:6px 10px">{ua.get('browser') or '?'} on {ua.get('os') or '?'}</td></tr>
        <tr><td style="padding:6px 10px;background:#F8FAFC;font-weight:700">Attempts</td>
            <td style="padding:6px 10px">{count}</td></tr>
        <tr><td style="padding:6px 10px;background:#F8FAFC;font-weight:700">Lockout</td>
            <td style="padding:6px 10px">{'Yes — 15 min' if locked else 'No'}</td></tr>
      </table>
      <p style="margin:16px 0 8px;color:#334155">
        <strong>Was this you?</strong> If yes, no action needed — try again in a moment.
      </p>
      <p style="margin:0;color:#334155">
        <strong>Not you?</strong> Open the Security page in Mission Control and review recent activity.
      </p>
    </div>
    """
    try:
        client.Emails.send({
            "from": "FriendPlace <hello@friendplace.com.au>",
            "to": _alert_recipients(),
            "subject": subject,
            "html": html,
        })
    except Exception as e:
        logger.warning("Resend alert send failed: %s", e)


async def raise_mcgs_signal(
    db: Any, *, count: int, window_min: int,
    urgent: bool, top_ips: list, top_emails: list,
) -> None:
    """Drop a signal on The Bridge. Uses the existing `mcgs_signals`
    collection so it lands in the Signal Feed and George can escalate."""
    try:
        signal = {
            "id": str(uuid.uuid4()),
            "created_at": _now(),
            "kind": "security.mass_login_attempts",
            "priority": "urgent" if urgent else "high",
            "urgent": urgent,
            "pinned": urgent,
            "title": ("🚨 URGENT — Mass admin login attempts detected"
                      if urgent else
                      "🚨 Security Alert — Unusual admin login attempts"),
            "body": (
                "Mission Control has detected an unusual number of failed "
                "administrator login attempts from the same source. "
                "The attempts have been blocked and logged. "
                "Please review the Security page."
            ),
            "meta": {
                "attempts": count,
                "window_minutes": window_min,
                "top_ips": top_ips,
                "top_emails": top_emails,
            },
            "deeplink": "/admin/security",
            "status": "new",
        }
        await db.mcgs_signals.insert_one(signal)
    except Exception as e:
        logger.warning("MCGS signal insert failed: %s", e)


async def check_mass_attack(db: Any) -> None:
    """Called after every failed login. If failures in the window cross
    a mass-attack threshold, raise (or upgrade) an MCGS signal."""
    now = _now()
    window_start = now - timedelta(minutes=MASS_ATTACK_WINDOW_MIN)
    try:
        count = await db.admin_security_log.count_documents({
            "created_at": {"$gte": window_start},
            "outcome": {"$in": ["fail", "lockout_created", "lockout_hit"]},
        })
    except Exception:
        return
    if count < MASS_ATTACK_FAILS:
        return
    urgent = count >= MASS_ATTACK_URGENT
    # Dedupe: if a signal already exists in this window, skip (or
    # upgrade to urgent if it wasn't already).
    try:
        existing = await db.mcgs_signals.find_one({
            "kind": "security.mass_login_attempts",
            "status": "new",
            "created_at": {"$gte": window_start},
        })
        if existing:
            if urgent and not existing.get("urgent"):
                await db.mcgs_signals.update_one(
                    {"id": existing["id"]},
                    {"$set": {"urgent": True, "pinned": True,
                              "priority": "urgent",
                              "title": "🚨 URGENT — Mass admin login attempts detected",
                              "meta.attempts": count}},
                )
            return
    except Exception:
        pass

    # Top offenders — best-effort aggregation.
    top_ips: list = []
    top_emails: list = []
    try:
        pipeline = [
            {"$match": {"created_at": {"$gte": window_start},
                        "outcome": {"$in": ["fail", "lockout_created"]}}},
            {"$group": {"_id": "$ip", "count": {"$sum": 1},
                        "geo": {"$last": "$geo"}}},
            {"$sort": {"count": -1}},
            {"$limit": 3},
        ]
        async for row in db.admin_security_log.aggregate(pipeline):
            top_ips.append({"ip": row["_id"], "count": row["count"], "geo": row.get("geo")})
        pipeline2 = [
            {"$match": {"created_at": {"$gte": window_start},
                        "outcome": {"$in": ["fail", "lockout_created"]}}},
            {"$group": {"_id": "$email", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 3},
        ]
        async for row in db.admin_security_log.aggregate(pipeline2):
            top_emails.append({"email": row["_id"], "count": row["count"]})
    except Exception:
        pass

    await raise_mcgs_signal(
        db,
        count=count, window_min=MASS_ATTACK_WINDOW_MIN,
        urgent=urgent, top_ips=top_ips, top_emails=top_emails,
    )
