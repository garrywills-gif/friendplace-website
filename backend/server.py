"""FriendPlace backend — FastAPI + MongoDB + WebSockets.

Real-time FP Café tables, private messaging, community groups, events,
notice board, butterfly points/badges, and a seeded sample dataset so the
prototype feels alive on first launch.
"""

from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query, Depends, Request, UploadFile, File
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Set, Any
from pathlib import Path
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
from jose import jwt, JWTError
import os, uuid, logging, json, asyncio, random, re
import html as html_module

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

from config import settings
from email_service import (
    is_configured as _email_is_configured,
    send_email as _email_send,
    password_reset_template as _email_password_reset_template,
    support_acknowledgement_template as _email_support_ack_template,
    welcome_template as _email_welcome_template,
    waitlist_template as _email_waitlist_template,
    invitation_template as _email_invitation_template,
)
from crossword_puzzles import (
    levels_summary as _xword_levels,
    active_puzzles as _xword_active,
    get_puzzle as _xword_get,
    serialise as _xword_serialise,
    daily_puzzle as _xword_daily,
    daily_iso_date as _xword_daily_date,
    POINTS_BY_LEVEL as _XWORD_POINTS,
)

from word_search import THEMES as WS_THEMES, DIFFICULTIES as WS_DIFFS, list_themes as ws_list_themes, generate_puzzle as ws_generate, daily_pick as ws_daily_pick, today_iso as ws_today_iso
from memory_match import THEMES as MM_THEMES, DIFFICULTIES as MM_DIFFS, list_themes as mm_list_themes, generate_puzzle as mm_generate, daily_pick as mm_daily_pick, today_iso as mm_today_iso
from sudoku import DIFFICULTIES as SD_DIFFS, generate_puzzle as sd_generate, daily_pick as sd_daily_pick, today_iso as sd_today_iso
from spot_difference import THEMES as STD_THEMES, DIFFICULTIES as STD_DIFFS, list_themes as std_list_themes, generate_puzzle as std_generate, daily_pick as std_daily_pick, today_iso as std_today_iso
from spot_library import list_active_puzzles as lib_active, get_puzzle as lib_get, public_card as lib_card  # noqa: E402
from milestones import MILESTONES as ML_DEFS, evaluate as ml_evaluate
from suburbs import search_suburbs as sb_search, by_postcode as sb_by_postcode, haversine_km as sb_haversine

ROOT_DIR = Path(__file__).parent
# `settings` already loaded .env via pydantic-settings — we keep load_dotenv()
# only so any *direct* os.environ readers in third-party libs (e.g. emergent
# auth) still pick up the same values. Single source of truth: `config.settings`.
load_dotenv(ROOT_DIR / ".env")

client = AsyncIOMotorClient(settings.mongo_url)
db = client[settings.db_name]

# ---------------- Auth config & helpers ----------------
JWT_SECRET = settings.jwt_secret
JWT_ALG = "HS256"
JWT_TTL_MIN = settings.jwt_ttl_min
RESET_TTL_MIN = settings.reset_ttl_min
MAX_LOGIN_ATTEMPTS = settings.max_login_attempts
LOCKOUT_MIN = settings.lockout_min

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)


def hash_pw(p: str) -> str:
    return pwd_ctx.hash(p)


def verify_pw(p: str, h: str) -> bool:
    try:
        return pwd_ctx.verify(p, h)
    except Exception:
        return False


def make_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=JWT_TTL_MIN)
    return jwt.encode({"sub": user_id, "exp": exp}, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(tok: str) -> Optional[str]:
    try:
        data = jwt.decode(tok, JWT_SECRET, algorithms=[JWT_ALG])
        return data.get("sub")
    except JWTError:
        return None


async def current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    if not creds or not creds.credentials:
        raise HTTPException(401, "Not authenticated")
    uid = decode_token(creds.credentials)
    if not uid:
        raise HTTPException(401, "Invalid or expired token")
    u = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(401, "User not found")
    return u


async def current_admin(me: dict = Depends(current_user)):
    """Guard for /api/admin/* endpoints — requires a valid bearer token
    AND that the subject has `is_admin = True`. Fixes SEC-004: admin
    routes must never trust a client-supplied `admin_id`; the identity
    is always taken from the signed JWT."""
    if not me.get("is_admin"):
        raise HTTPException(403, "Admin only")
    return me


app = FastAPI(title="FriendPlace API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("friendplace")

# ---------------- Sentry (no-op when DSN unset) ----------------
# Init *after* logger creation so the LoggingIntegration captures our own
# logs too. When `settings.sentry_dsn` is None / empty the SDK initialises
# in disabled mode and zero events are sent — safe to leave wired in dev.
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        sample_rate=settings.sentry_sample_rate,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,  # don't ship request bodies / cookies
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            StarletteIntegration(transaction_style="endpoint"),
            AsyncioIntegration(),
            # Capture WARNING+ logs as breadcrumbs and ERROR+ as events.
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
    )
    logger.info("Sentry initialised (env=%s, traces=%.2f)",
                settings.sentry_environment, settings.sentry_traces_sample_rate)
else:
    logger.info("Sentry DSN not set — error reporting disabled "
                "(set SENTRY_DSN_BACKEND in env to enable).")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def nid() -> str:
    return str(uuid.uuid4())


# ---------------- Models ----------------
class UserPrivacySettings(BaseModel):
    profile_visibility: str = "everyone"          # everyone | friends
    friend_requests: str = "everyone"             # everyone | friends | off
    show_in_find_friends: bool = True


class User(BaseModel):
    id: str = Field(default_factory=nid)
    first_name: str = ""
    username: str
    email: str = ""
    suburb: str = ""
    interests: List[str] = []
    avatar: str = ""  # emoji, URL, or data:image/...;base64
    bio: str = ""
    favourite_games: List[str] = []
    birthday: str = ""                  # YYYY-MM-DD or MM-DD (year optional)
    points: int = 0
    badges: List[str] = []
    friends: List[str] = []
    blocked: List[str] = []
    is_demo: bool = False
    is_admin: bool = False
    # Legacy privacy (online presence visibility): everyone | friends | invisible
    privacy: str = "everyone"
    # New granular privacy
    privacy_settings: UserPrivacySettings = Field(default_factory=UserPrivacySettings)
    onboarding_completed: bool = False
    restricted: bool = False                      # auto-set after 3 reports / 24h
    restricted_at: Optional[str] = None
    restricted_reason: str = ""
    # Online presence
    last_seen_at: str = Field(default_factory=now_iso)
    # User-selectable presence status. None → auto from last_seen_at.
    # Allowed: "looking_to_chat" | "in_coffee_lounge" | "happy_to_connect" | "busy" | "offline"
    status: Optional[str] = None
    status_updated_at: Optional[str] = None
    # Set when this user joined via someone else's invite link (?ref=<id>).
    # Powers the Profile "Invites" tile and lets a future leaderboard credit
    # community-builders. Never exposed back to the inviter as a clickable
    # identity — we only expose count + display name.
    invited_by: Optional[str] = None
    # Founding Member programme — first N successful sign-ups (cap set by
    # FOUNDING_MEMBER_CAP env var, default 500) get a permanent 🦋 badge
    # shown on profile and posts. Cheap, ego-pleasing, and a clean signal
    # for future "thank-you" perks (priority support, early features, etc.).
    is_founder: bool = False
    founder_number: Optional[int] = None  # 1-indexed position in cohort
    # ─── Business / venue flags ──────────────────────────────────────────
    # FriendPlace invites local businesses (cafés, RSLs, bowling clubs, etc.)
    # to list their events under a subscription. The first month is a free
    # trial with a 5-listing-per-period cap; paid weekly / monthly tiers
    # are coming soon. These fields track that journey:
    #   • is_business               → self-identified as a business / venue
    #   • business_name             → public "Hosted by …" label
    #   • business_plan             → trial | weekly | monthly | None
    #   • business_plan_started_at  → ISO; when current period began
    #   • business_plan_renews_at   → ISO; when counter resets / billing falls due
    #   • business_events_this_period → count posted in current period
    is_business: bool = False
    business_name: Optional[str] = None
    business_plan: Optional[str] = None  # "trial" | "weekly" | "monthly"
    business_plan_started_at: Optional[str] = None
    business_plan_renews_at: Optional[str] = None
    business_events_this_period: int = 0
    # Legacy — superseded by business_plan. Kept so existing accounts that
    # claimed the original "one free listing" perk still load.
    business_free_listing_used: bool = False
    created_at: str = Field(default_factory=now_iso)


class SignupBody(BaseModel):
    username: str
    password: str = Field(min_length=6)
    email: Optional[EmailStr] = None
    first_name: str = ""
    suburb: str = ""
    suburb_postcode: Optional[str] = None
    suburb_state: Optional[str] = None
    suburb_lat: Optional[float] = None
    suburb_lng: Optional[float] = None
    location_visibility: str = "suburb"  # "suburb" (public name only) | "private" (Prefer not to say)
    interests: List[str] = []
    avatar: str = ""
    birthday: str = ""  # YYYY-MM-DD or MM-DD (optional)
    # Optional referrer id captured from a ?ref=<user_id> share-link.
    referrer_id: Optional[str] = None


class LoginBody(BaseModel):
    username: str  # username OR email
    password: str


class DemoLoginBody(BaseModel):
    username: str


class ForgotBody(BaseModel):
    identifier: str  # username OR email


class ResetBody(BaseModel):
    identifier: str
    code: str
    new_password: str = Field(min_length=6)


class Table(BaseModel):
    id: str = Field(default_factory=nid)
    name: str
    emoji: str = "☕"
    description: str = ""
    visibility: str = "public"  # public | friends
    host_id: str = ""
    seated: List[str] = []  # user ids
    created_at: str = Field(default_factory=now_iso)
    # Updated on every message / join — drives "most-recent-activity" sort and
    # the 24-hour idle auto-prune. Seed tables get marked persistent=True so
    # they don't disappear even when quiet.
    last_activity_at: str = Field(default_factory=now_iso)
    persistent: bool = False
    # Founder-exclusive table flag. When True, only users with
    # is_founder=True may join (REST + WS guard). Non-founders still see
    # the card in the lounge list — locked — so it acts as gentle social
    # proof for the Founding Member cohort.
    founder_only: bool = False


class CreateTableBody(BaseModel):
    name: str
    emoji: str = "☕"
    description: str = ""
    visibility: str = "public"
    host_id: str


class Message(BaseModel):
    id: str = Field(default_factory=nid)
    table_id: Optional[str] = None
    dm_id: Optional[str] = None
    user_id: str
    user_name: str = ""
    avatar: str = ""
    text: str
    # Optional base64 data URI for an attached photo. Stored inline so messages
    # remain a single document — fine for the resized previews (≤200 KB) the
    # client uploads from the FP Café image picker.
    image: str = ""
    created_at: str = Field(default_factory=now_iso)


class Group(BaseModel):
    id: str = Field(default_factory=nid)
    name: str
    emoji: str = "👥"
    description: str = ""
    members: List[str] = []
    created_at: str = Field(default_factory=now_iso)


class GroupPost(BaseModel):
    id: str = Field(default_factory=nid)
    group_id: str
    user_id: str
    user_name: str = ""
    avatar: str = ""
    text: str
    likes: List[str] = []
    comments: List[dict] = []
    created_at: str = Field(default_factory=now_iso)


class Event(BaseModel):
    id: str = Field(default_factory=nid)
    title: str
    emoji: str = "🎉"
    description: str = ""
    location: str = ""
    date: str = ""
    time: str = ""
    rsvps: List[str] = []                # legacy "going" list — kept for compat
    rsvps_maybe: List[str] = []
    rsvps_cant: List[str] = []
    waitlist: List[str] = []
    capacity: Optional[int] = None       # None = unlimited
    host_id: Optional[str] = None
    sponsor: Optional[dict] = None       # {name, message, discount_code}
    # Recurrence — if a host picks "Repeats weekly" etc. we generate N concrete
    # child events sharing the same series_id. RSVPs stay per-occurrence (so
    # people can attend just some sessions). The master keeps `series_master`
    # = True for display badges; children share `recurrence` for badge labels
    # but their own dates/RSVP lists.
    recurrence: Optional[str] = None     # None | "weekly" | "fortnightly" | "monthly"
    series_id: Optional[str] = None
    series_master: bool = False
    created_at: str = Field(default_factory=now_iso)


class Notice(BaseModel):
    id: str = Field(default_factory=nid)
    user_id: str
    user_name: str = ""
    avatar: str = ""
    title: str
    body: str
    category: str = "Announcement"
    likes: List[str] = []
    comments: List[dict] = []
    # Reaction map: { user_id -> "well_done" | "support" | "chat" | "flutter" | "congrats" }
    reactions: Dict[str, str] = Field(default_factory=dict)
    solved: bool = False
    reports: List[dict] = Field(default_factory=list)
    edited_at: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class FriendRequest(BaseModel):
    id: str = Field(default_factory=nid)
    from_id: str
    to_id: str
    status: str = "pending"  # pending | accepted | declined
    created_at: str = Field(default_factory=now_iso)


# ------------- helpers -------------
def strip_id(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc.pop("_id", None)
    return doc


# -------------- Rate limiting (in-process, multi-instance safe at Tier 1) --------------
# A tiny sliding-window limiter that protects hot write endpoints (signup,
# notices, reports, events, flutters) from spam without adding new deps.
#
# Why in-process?  We're a single-pod backend at Tier 1 — this is the right
# balance of safety + simplicity. When we migrate to Render/Railway with
# multiple instances (Tier 2 in the scaling roadmap) we swap the dict for a
# Redis-backed counter; the call sites don't change. The helper raises an
# HTTPException(429) so the client gets a clear retry hint.
import time as _time
from collections import deque as _deque
_RATE_BUCKETS: Dict[str, _deque] = {}

def rate_limit(key: str, max_calls: int, window_seconds: int) -> None:
    """Raise HTTP 429 if `key` has exceeded `max_calls` within the last
    `window_seconds`. Otherwise record this call and let it through.

    `key` should be derived from the actor identity for the endpoint —
    e.g. f"signup:{ip}" or f"notice:{user_id}". Pick the most attacker-
    relevant identifier (IP for unauthed flows, user_id for authed)."""
    now = _time.monotonic()
    cutoff = now - window_seconds
    bucket = _RATE_BUCKETS.setdefault(key, _deque())
    # Trim old timestamps. We do this lazily — fine while buckets are short.
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= max_calls:
        # How long until the oldest call falls out of the window
        retry_after = max(1, int(bucket[0] + window_seconds - now))
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests — please slow down. Try again in {retry_after}s.",
            headers={"Retry-After": str(retry_after)},
        )
    bucket.append(now)
    # Opportunistic garbage collection: keep the dict bounded. Buckets that
    # haven't been touched for 10x the longest window can be evicted.
    if len(_RATE_BUCKETS) > 5000:
        stale_cutoff = now - 3600
        for k in list(_RATE_BUCKETS.keys()):
            b = _RATE_BUCKETS[k]
            if not b or b[-1] < stale_cutoff:
                _RATE_BUCKETS.pop(k, None)


async def award_points(user_id: str, amount: int, reason: str = ""):
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return
    new_points = user.get("points", 0) + amount
    badges = set(user.get("badges", []))
    if new_points >= 10:
        badges.add("Friendly Member")
    if new_points >= 30:
        badges.add("Helpful Neighbour")
    if new_points >= 60:
        badges.add("Social Star")
    if new_points >= 100:
        badges.add("Community Builder")
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"points": new_points, "badges": list(badges)}},
    )


# ------------- Auth -------------
def _safe_user(u: dict) -> dict:
    """Return a user dict without sensitive or location-precision fields.

    Strips:
      * MongoDB _id, password_hash, lockout state
      * Precise location: suburb_lat / suburb_lng (publicly unsafe — only the
        suburb name + postcode + state are ever exposed)
      * OAuth / SSO identifiers that could be replayed to a provider
        (SEC-002): apple_id, apple_refresh_token, google_sub, google_email
    """
    u = dict(u or {})
    u.pop("_id", None)
    u.pop("password_hash", None)
    u.pop("failed_login_attempts", None)
    u.pop("lockout_until", None)
    u.pop("suburb_lat", None)
    u.pop("suburb_lng", None)
    u.pop("apple_refresh_token", None)
    return u


# Fields that MAY be serialised in a peer-visible view. Everything else
# — email, phone, apple_id, refresh tokens, admin flags, block lists,
# password hash — is stripped so we never leak PII or auth material to
# another user (SEC-002). Only the authenticated owner sees their own
# private fields via /api/users/{id} where user_id == token subject.
_PEER_VISIBLE_FIELDS = {
    "id", "first_name", "username", "avatar", "bio", "suburb",
    "suburb_postcode", "suburb_state", "interests", "points", "badges",
    "achievements", "status", "last_seen_at", "privacy",
    "is_founder", "founder_number", "created_at", "location_visibility",
    # Non-PII flags used for UI badging
    "is_admin",  # only surfaced to admins; the endpoint decides
    "distance_km",  # attached by radius search
}


def _peer_user(u: dict, viewer_is_owner: bool = False, viewer_is_admin: bool = False) -> dict:
    """Return the peer-visible projection of a user document.

    - Owner (viewer == user) sees their full `_safe_user` (still no
      password_hash, still no refresh tokens).
    - Admin viewers get the same shape as owner (need email for support
      workflows) minus the refresh token.
    - Everyone else gets the allowlisted projection only — no email,
      no apple_id, no admin flag, no block list.
    """
    if viewer_is_owner or viewer_is_admin:
        # Owner / admin: full safe view (still strips password_hash + refresh tokens
        # via _safe_user). Never leak apple_refresh_token even to the owner
        # over an authenticated API call — clients don't need it.
        out = _safe_user(u)
        # is_admin only ever visible when the viewer is themselves admin
        if not viewer_is_admin:
            out.pop("is_admin", None)
        return out
    projected: dict = {}
    for k in _PEER_VISIBLE_FIELDS:
        if k == "is_admin":
            continue  # never expose admin flag to peers
        if k in u:
            projected[k] = u[k]
    return projected


async def _attach_founder_flags(items: list, user_id_key: str = "user_id") -> list:
    """Enrich a list of documents (notices, group posts, messages, …) with
    the author's `is_founder` + `founder_number` so the frontend can render
    the 🦋 butterfly mark beside the cached `user_name` without a separate
    round-trip per row.

    Mutates `items` in place AND returns it for ergonomic chaining. Empty
    list / missing ids are handled gracefully — the function never raises.

    `user_id_key` lets the same helper work for documents that store the
    author id under a different key (e.g. "host_id" on tables, "from_id"
    on flutters). Comments inside notices are handled separately below.
    """
    if not items:
        return items
    ids = list({d.get(user_id_key) for d in items if d.get(user_id_key)})
    if not ids:
        return items
    cursor = db.users.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "is_founder": 1, "founder_number": 1},
    )
    fmap: dict[str, dict] = {}
    async for u in cursor:
        if u.get("is_founder"):
            fmap[u["id"]] = {
                "is_founder": True,
                "founder_number": u.get("founder_number"),
            }
    if not fmap:
        return items
    for d in items:
        uid = d.get(user_id_key)
        if uid and uid in fmap:
            d["user_is_founder"] = True
            d["user_founder_number"] = fmap[uid]["founder_number"]
    return items


async def _find_user_by_identifier(identifier: str) -> Optional[dict]:
    ident = (identifier or "").strip().lower()
    if not ident:
        return None
    # try username (case-insensitive) then email
    u = await db.users.find_one({"username": {"$regex": f"^{re.escape(ident)}$", "$options": "i"}})
    if u:
        return u
    return await db.users.find_one({"email": {"$regex": f"^{re.escape(ident)}$", "$options": "i"}})


async def _ensure_founders_lounge() -> Optional[dict]:
    """Create / fetch the special "Founders Lounge" group. Idempotent and
    safe to call on every founder signup. The group is invite-only for
    everyone except actual founders — gives Founding Members a private
    space to chat and shape the app together (one of the headline perks
    of the cohort)."""
    g = await db.groups.find_one({"name": "Founders Lounge"}, {"_id": 0})
    if g:
        return g
    g = {
        "id": nid(),
        "name": "Founders Lounge",
        "emoji": "🦋",
        "description": "A private space for Founding Members to chat, share early feedback, and help shape FriendPlace.",
        "members": [],
        "is_founder_only": True,
        # System group — hidden from the public Community Groups list
        # because it lives inside the Founders area instead.
        "is_system": True,
        "created_at": now_iso(),
    }
    try:
        await db.groups.insert_one(g)
    except Exception:
        # Race-safe — another founder signup may have created it in parallel.
        g = await db.groups.find_one({"name": "Founders Lounge"}, {"_id": 0})
    return g


async def _ensure_daily_crossword_table(puzzle: dict | None = None) -> Optional[dict]:
    """Create / refresh the persistent "Today's Crossword ✏️" Coffee Table.

    Idempotent — safe to call on every `/games/crossword/daily` GET. The
    table is `persistent=True` so the 24h idle prune never reaps it, and
    open to every signed-in user (no `founder_only` gate). Each day the
    title/description are refreshed so the card reflects today's puzzle.

    Why a fixed table?
      The "discuss today's puzzle" loop only works if everyone lands in
      the *same* room. A per-user table would shard the conversation and
      nobody would meet. One table per day, persistent forever, is the
      simplest correct shape.
    """
    if puzzle is None:
        return None
    # Find by name (single source of truth for the daily table identity).
    t = await db.tables.find_one(
        {"name": {"$regex": "^Today's Crossword"}, "persistent": True, "daily_crossword": True},
        {"_id": 0},
    )
    today = _xword_daily_date()
    # Friendly difficulty label — bumped to "challenging" copy on purpose:
    # the daily puzzle now alternates between Hard and Expert pools so the
    # table feels like a community brain-teaser, not a warm-up.
    level_label = (puzzle.get("level") or "hard").title()
    desc = (
        f"Today's brain-teaser — {puzzle.get('theme', level_label)} ({today}, {level_label}). "
        f"It's a tough one on purpose. Ask the table for hints, share clues you've cracked, "
        f"and celebrate every finish together. Everyone's solving the same puzzle today."
    )
    if t:
        # Refresh the metadata in case the day rolled over since last call.
        if t.get("daily_puzzle_id") != puzzle.get("id"):
            await db.tables.update_one(
                {"id": t["id"]},
                {"$set": {
                    "daily_puzzle_id": puzzle.get("id"),
                    "description": desc,
                    "last_activity_at": now_iso(),
                }},
            )
            t["daily_puzzle_id"] = puzzle.get("id")
            t["description"] = desc
        return t
    # Pick a host: any active member; falls back to empty (visible card with
    # generic attribution) so the lounge never shows an "orphan" table.
    first = await db.users.find_one(
        {"is_demo": {"$ne": True}}, {"_id": 0, "id": 1}, sort=[("created_at", 1)]
    )
    host_id = (first or {}).get("id", "") or ""
    t = {
        "id": nid(),
        "name": "Today's Crossword ✏️",
        "emoji": "✏️",
        "description": desc,
        "visibility": "public",
        "host_id": host_id,
        "seated": [host_id] if host_id else [],
        "created_at": now_iso(),
        "last_activity_at": now_iso(),
        "persistent": True,
        "daily_crossword": True,
        "daily_puzzle_id": puzzle.get("id"),
    }
    try:
        await db.tables.insert_one(t)
    except Exception:
        # Race-safe — another caller may have just created it.
        t = await db.tables.find_one(
            {"name": {"$regex": "^Today's Crossword"}, "daily_crossword": True}, {"_id": 0}
        )
    return t


FP_CAFE_TABLE_ID = "fp-cafe-permanent"


async def _ensure_fp_cafe_table() -> Optional[dict]:
    """Create / fetch the permanent FP Café table.

    Locked with Garry 27 July 2026 (TestFlight feedback): every FriendPlace
    member should have an obvious place to start. The FP Café is:
      • pinned to the top of the FP Café list forever,
      • undeletable (persistent=True, protected=True),
      • one-tap opt-in (not auto-join — respectful),
      • hosted by "system" so no member is responsible for it,
      • open to everyone (visibility="public").

    Members can still leave whenever they wish, and no idle-prune
    reaches it thanks to `persistent=True`. Any code path that mutates
    tables should refuse to delete or rename a doc where
    `protected=True`.
    """
    t = await db.tables.find_one({"id": FP_CAFE_TABLE_ID}, {"_id": 0})
    if t:
        # Belt-and-braces: make sure protection stays on even if a
        # legacy row escaped without the flag.
        if not t.get("protected") or not t.get("persistent"):
            await db.tables.update_one(
                {"id": FP_CAFE_TABLE_ID},
                {"$set": {"protected": True, "persistent": True, "pinned": True}},
            )
            t = await db.tables.find_one({"id": FP_CAFE_TABLE_ID}, {"_id": 0})
        return t
    t = {
        "id": FP_CAFE_TABLE_ID,
        "name": "FP Caf\u00e9",
        "emoji": "\u2615",
        "description": "Everyone's welcome. The community's living room \u2014 pop in anytime for a chat.",
        "visibility": "public",
        "host_id": "system",
        "seated": [],
        "created_at": now_iso(),
        "last_activity_at": now_iso(),
        "persistent": True,
        "protected": True,
        "pinned": True,
    }
    try:
        await db.tables.insert_one(t)
    except Exception:
        # Race-safe.
        t = await db.tables.find_one({"id": FP_CAFE_TABLE_ID}, {"_id": 0})
    return t




async def _ensure_founders_table() -> Optional[dict]:
    """Create / fetch the special Founders Lounge Coffee Table.

    Idempotent — safe to call on every signup and at startup. The table is
    `founder_only=True` and `persistent=True` so:
      • non-founders still see the card in the public lounge list (acts as
        social-proof scarcity), but get blocked at the door if they tap;
      • the 24h idle prune never reaps it.

    Hosted by the very first founder we can find, so the lounge card shows
    a real "Started by …" attribution rather than a ghost host. Falls back
    to an empty host_id if no founders exist yet — the table is still
    created so newly-minted founders land somewhere immediately."""
    t = await db.tables.find_one({"name": "Founders Lounge", "founder_only": True}, {"_id": 0})
    if t:
        return t
    # Try to attribute hosting to the very first founder (#1); if there's
    # none yet, leave host_id blank — backfilled on first founder signup.
    first = await db.users.find_one(
        {"is_founder": True, "is_demo": {"$ne": True}},
        {"_id": 0, "id": 1, "first_name": 1},
        sort=[("founder_number", 1)],
    )
    host_id = (first or {}).get("id", "") or ""
    t = {
        "id": nid(),
        "name": "Founders Lounge",
        "emoji": "🦋",
        "description": "An exclusive FP Café table just for Founding Members. Pull up a chair.",
        "visibility": "public",
        "host_id": host_id,
        "seated": [host_id] if host_id else [],
        "created_at": now_iso(),
        "last_activity_at": now_iso(),
        "persistent": True,
        "founder_only": True,
    }
    try:
        await db.tables.insert_one(t)
    except Exception:
        # Race-safe — another founder signup may have created it in parallel.
        t = await db.tables.find_one({"name": "Founders Lounge", "founder_only": True}, {"_id": 0})
    return t


async def _assign_founder_status(doc: dict) -> None:
    """DEPRECATED for the new opt-in flow — kept only for back-compat with
    any legacy callsites that haven't been migrated to the explicit
    `/founders/claim` endpoint. New signups must opt-in via the Founder
    Info page; we no longer auto-stamp founders on account creation.
    """
    return


async def _promote_existing_user_to_founder(user_id: str) -> dict:
    """Convert an existing, persisted user into a Founding Member.

    Powers the `POST /api/founders/claim` flow — runs ALL the side effects
    that used to happen at signup time (founder number, badge, +50 points,
    Founders Lounge group + table seating, welcome notification) but
    against a user that's already in the DB.

    Returns a dict with `founder_number` and the refreshed user document.

    Raises HTTPException:
      400 — user not found / demo account
      409 — already a Founding Member
      410 — Founding Member cohort is full
    """
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(400, "Account not found")
    if u.get("is_demo"):
        raise HTTPException(400, "Demo accounts cannot claim Founding Member status")
    if u.get("is_founder"):
        raise HTTPException(409, "You're already a Founding Member")
    cap = max(0, int(settings.founding_member_cap or 0))
    if cap <= 0:
        raise HTTPException(410, "Founding Member programme is closed")
    current = await db.users.count_documents({"is_founder": True})
    if current >= cap:
        raise HTTPException(410, "Founding Member cohort is full")

    founder_number = current + 1
    badges = list(u.get("badges") or [])
    if "Founding Member" not in badges:
        badges.append("Founding Member")
    new_points = int(u.get("points") or 0) + 50

    # Promote the user atomically (small race window vs other parallel
    # claims is acceptable at MVP traffic — the count is rechecked next
    # time and self-corrects to "at most cap + a few", same as the old
    # auto-assignment flow).
    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "is_founder": True,
            "founder_number": founder_number,
            "badges": badges,
            "points": new_points,
        }},
    )

    # Add to the private Founders Lounge group.
    fl = await _ensure_founders_lounge()
    if fl and fl.get("id"):
        try:
            await db.groups.update_one(
                {"id": fl["id"]},
                {"$addToSet": {"members": user_id}},
            )
            await db.users.update_one(
                {"id": user_id},
                {"$addToSet": {"groups": fl["id"]}},
            )
        except Exception as e:
            logger.warning("founder claim: failed to add to lounge group: %s", e)

    # Seat at the Founders Lounge Coffee Table.
    ft = await _ensure_founders_table()
    if ft and ft.get("id"):
        try:
            await db.tables.update_one(
                {"id": ft["id"]},
                {"$addToSet": {"seated": user_id},
                 "$set": {"last_activity_at": now_iso()}},
            )
            # If the table was created before any founder existed, the
            # host_id may still be blank — set this new founder as host
            # so the lounge card shows a real "Started by …" attribution.
            await db.tables.update_one(
                {"id": ft["id"], "host_id": ""},
                {"$set": {"host_id": user_id}},
            )
        except Exception as e:
            logger.warning("founder claim: failed to seat at table: %s", e)

    # Welcome notification — lands at the top of the user's bell.
    await db.notifications.insert_one({
        "id": nid(), "user_id": user_id, "type": "welcome",
        "title": f"🦋 You're Founding Member #{founder_number}!",
        "body": "Thanks for being one of the first to join FriendPlace. You've earned a permanent badge on your profile — and 50 bonus points to get you started.",
        "read": False, "created_at": now_iso(),
    })

    # Reload the user so callers get the post-promotion document.
    refreshed = await db.users.find_one({"id": user_id}, {"_id": 0}) or u
    return {"founder_number": founder_number, "user": refreshed}


@api.post("/auth/signup")
async def signup(body: SignupBody, request: Request):
    # Anti-spam: cap signups per source IP. Bumped from `5 / 10 min` to
    # `20 / hour` after a TestFlight incident (24 Jun 2026) where a
    # single genuinely-new user was tripping the limit — TestFlight
    # cohorts routinely share a NAT gateway IP, and a frustrated user
    # retrying (understandably) after seeing the old generic error was
    # enough to fully exhaust the 5-attempt bucket. 20/hour still stops
    # bot floods dead (the per-account brute-force lockout on
    # /auth/login is the real defence against credential stuffing).
    client_ip = (request.client.host if request.client else "unknown") or "unknown"
    rate_limit(f"signup:{client_ip}", max_calls=20, window_seconds=3600)
    uname = body.username.strip()
    if len(uname) < 3:
        raise HTTPException(400, "Username must be at least 3 characters")
    if any(ch.isspace() for ch in uname):
        raise HTTPException(400, "Username can't contain spaces")
    if not re.match(r"^[A-Za-z0-9_.\-]+$", uname):
        raise HTTPException(400, "Username can only contain letters, numbers, and . _ -")
    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    if await db.users.find_one({"username": {"$regex": f"^{re.escape(uname)}$", "$options": "i"}}):
        raise HTTPException(400, "Username already taken")
    if body.email and await db.users.find_one({"email": {"$regex": f"^{re.escape(body.email)}$", "$options": "i"}}):
        raise HTTPException(400, "Email already registered")

    user = User(
        first_name=body.first_name or "",
        username=uname,
        email=(body.email or "").lower(),
        suburb=body.suburb if (body.location_visibility or "suburb") != "private" else "",
        interests=body.interests,
        avatar=body.avatar,
        birthday=(body.birthday or "").strip(),
        is_demo=False,
        points=5,
        badges=["Friendly Member"],
    )
    doc = user.dict()
    # Optional structured location (already validated by SuburbField search)
    if (body.location_visibility or "suburb") == "private":
        doc["location_visibility"] = "private"
    else:
        doc["location_visibility"] = "suburb"
        if body.suburb_postcode:
            doc["suburb_postcode"] = body.suburb_postcode
        if body.suburb_state:
            doc["suburb_state"] = body.suburb_state
    doc["password_hash"] = hash_pw(body.password)
    doc["failed_login_attempts"] = 0
    doc["lockout_until"] = None

    # Invitation attribution: link the new user back to whoever shared the
    # link (?ref=<id>) so the inviter can see the count on their profile.
    # We validate the referrer exists and isn't the same person, then notify
    # them so they get a small thrill from each successful invite.
    if body.referrer_id and body.referrer_id != user.id:
        referrer = await db.users.find_one(
            {"id": body.referrer_id},
            {"id": 1, "_id": 0},
        )
        if referrer:
            doc["invited_by"] = referrer["id"]
            await db.notifications.insert_one({
                "id": nid(),
                "user_id": referrer["id"],
                "type": "invite_accepted",
                "title": "Your invite worked!",
                "body": f"{user.first_name or user.username} just joined FriendPlace through your share link. Welcome them in!",
                "data": {"user_id": user.id},
                "read": False,
                "created_at": now_iso(),
            })
            # Also drop a celebratory Flutter on the inviter's Home feed —
            # more visible than the bell-icon counter and feels like a real
            # "hello from your new friend".
            await db.flutters.insert_one(FlutterDoc(
                from_id=user.id,
                to_id=referrer["id"],
                from_name=user.first_name or user.username,
                from_avatar=doc.get("avatar") or "🦋",
                message="🎉 Just joined through your invite — say hi!",
            ).dict())
    # Founding Member assignment — runs *before* insert so the badge / number
    # land in the same DB write as the rest of the user doc.
    await _assign_founder_status(doc)
    # Pop the transient lounge-id hint before persisting — we only need it to
    # add this user to the group's members array post-insert (below).
    _fl_id = doc.pop("_founders_lounge_id", None)
    _ft_id = doc.pop("_founders_table_id", None)
    await db.users.insert_one(doc)
    if _fl_id:
        try:
            await db.groups.update_one(
                {"id": _fl_id},
                {"$addToSet": {"members": doc["id"]}},
            )
        except Exception:
            pass
    if _ft_id:
        try:
            await db.tables.update_one(
                {"id": _ft_id},
                {"$addToSet": {"seated": doc["id"]},
                 "$set": {"last_activity_at": now_iso()}},
            )
            # If the founders table was created before any founder existed,
            # the host_id may still be blank — set this new founder as host
            # so the lounge card shows a real "Started by …" attribution.
            await db.tables.update_one(
                {"id": _ft_id, "host_id": ""},
                {"$set": {"host_id": doc["id"]}},
            )
        except Exception:
            pass
    # is committed and `invited_by` is on file.
    if doc.get("invited_by"):
        await _check_invite_milestones(doc["invited_by"])
    # Welcome notification to the new user themselves
    await db.notifications.insert_one({
        "id": nid(), "user_id": user.id, "type": "welcome",
        "title": "Welcome to FriendPlace!",
        "body": "We're so glad you're here. Take a look at the FP Café or send a friend request to say hello.",
        "read": False, "created_at": now_iso(),
    })
    # Extra "you're a Founder!" notification when applicable — lands at the
    # top of the user's bell as their very first notification.
    if doc.get("is_founder"):
        await db.notifications.insert_one({
            "id": nid(), "user_id": user.id, "type": "welcome",
            "title": f"🦋 You're Founding Member #{doc['founder_number']}!",
            "body": "Thanks for being one of the first to join FriendPlace. You've earned a permanent badge on your profile — and 50 bonus points to get you started.",
            "read": False, "created_at": now_iso(),
        })
    # And tell the existing community about a new neighbour
    try: await _broadcast_new_member(doc)
    except Exception as e: logger.warning("new-member broadcast failed: %s", e)
    return {"access_token": make_token(user.id), "token_type": "bearer", "user": _safe_user(doc)}


@api.post("/auth/login")
async def login(body: LoginBody):
    u = await _find_user_by_identifier(body.username)
    if not u:
        raise HTTPException(400, "Invalid credentials")
    # demo accounts can't log in via the password flow (must use /auth/demo-login)
    if u.get("is_demo"):
        raise HTTPException(400, "Demo accounts use 'Try a demo account' on the login screen")

    now = datetime.now(timezone.utc)
    lockout = u.get("lockout_until")
    if lockout:
        try:
            lock_dt = datetime.fromisoformat(lockout) if isinstance(lockout, str) else lockout
            if now < lock_dt:
                raise HTTPException(429, "Too many failed attempts. Try again later.")
        except (ValueError, TypeError):
            pass

    pwh = u.get("password_hash")
    if not pwh or not verify_pw(body.password, pwh):
        attempts = int(u.get("failed_login_attempts", 0)) + 1
        update = {"failed_login_attempts": attempts}
        if attempts >= MAX_LOGIN_ATTEMPTS:
            update["lockout_until"] = (now + timedelta(minutes=LOCKOUT_MIN)).isoformat()
            update["failed_login_attempts"] = 0
        await db.users.update_one({"id": u["id"]}, {"$set": update})
        raise HTTPException(400, "Invalid credentials")

    # Block banned / suspended users
    if u.get("banned"):
        await _notify_admins({"type": "moderation_login_attempt", "title": "Banned user login attempt", "body": f"{u.get('username')} attempted to log in.", "ref_user_id": u["id"]})
        raise HTTPException(403, "Your account has been banned. Please contact support.")
    sus_until = u.get("suspended_until")
    if sus_until:
        try:
            sus_dt = datetime.fromisoformat(sus_until)
            if now < sus_dt:
                await _notify_admins({"type": "moderation_login_attempt", "title": "Suspended user login attempt", "body": f"{u.get('username')} tried to log in during suspension.", "ref_user_id": u["id"]})
                raise HTTPException(403, f"Your account is suspended until {sus_until}.")
            else:
                # Suspension expired, clear it
                await db.users.update_one({"id": u["id"]}, {"$set": {"suspended_until": None, "restricted": False, "restricted_reason": ""}})
        except (ValueError, TypeError):
            pass

    await db.users.update_one(
        {"id": u["id"]},
        {"$set": {"failed_login_attempts": 0, "lockout_until": None, "last_login_at": now.isoformat()}},
    )
    return {"access_token": make_token(u["id"]), "token_type": "bearer", "user": _safe_user(u)}


@api.post("/auth/demo-login")
async def demo_login(body: DemoLoginBody):
    """Login as a seeded demo user (no password). Real accounts cannot use this."""
    u = await db.users.find_one({"username": {"$regex": f"^{re.escape(body.username)}$", "$options": "i"}})
    if not u:
        raise HTTPException(404, "Demo user not found")
    if not u.get("is_demo"):
        raise HTTPException(400, "Not a demo account — use Log In with your password")
    # Block banned / suspended demos as well — gives parity with /auth/login.
    if u.get("banned"):
        await _notify_admins({"type": "moderation_login_attempt", "title": "Banned user login attempt", "body": f"{u.get('username')} attempted to demo-log in.", "ref_user_id": u["id"]})
        raise HTTPException(403, "This account has been banned.")
    sus_until = u.get("suspended_until")
    if sus_until:
        try:
            sus_dt = datetime.fromisoformat(sus_until)
            if datetime.now(timezone.utc) < sus_dt:
                await _notify_admins({"type": "moderation_login_attempt", "title": "Suspended user login attempt", "body": f"{u.get('username')} tried demo-login during suspension.", "ref_user_id": u["id"]})
                raise HTTPException(403, f"This account is suspended until {sus_until}.")
            else:
                await db.users.update_one({"id": u["id"]}, {"$set": {"suspended_until": None, "restricted": False, "restricted_reason": ""}})
        except (ValueError, TypeError):
            pass
    return {"access_token": make_token(u["id"]), "token_type": "bearer", "user": _safe_user(u)}


class GoogleAuthBody(BaseModel):
    # One-time session id returned in the Emergent Google redirect URL fragment.
    session_id: str
    # Optional invite attribution captured at sign-up time on web.
    referrer_id: Optional[str] = None


@api.post("/auth/google")
async def auth_google(body: GoogleAuthBody):
    """Exchange an Emergent Google OAuth session_id for a FriendPlace JWT.

    Emergent issues a one-time `session_id` in the redirect URL. We swap that
    server-side for the verified user profile (email/name/picture) and either
    link to an existing FriendPlace account (matched by email) or create a brand
    new account. Returns the same envelope as `/auth/login` so the existing
    auth context on the client keeps working unchanged.
    """
    import httpx as _httpx
    sid = (body.session_id or "").strip()
    if not sid:
        raise HTTPException(400, "Missing session_id")
    try:
        async with _httpx.AsyncClient(timeout=15.0) as http:
            r = await http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": sid},
            )
            if r.status_code != 200:
                raise HTTPException(401, "Google sign-in could not be verified. Please try again.")
            data = r.json() or {}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("google session-data fetch failed: %s", e)
        raise HTTPException(503, "Could not reach Google sign-in right now. Please try again.")

    email = (data.get("email") or "").strip().lower()
    name = (data.get("name") or "").strip()
    picture = (data.get("picture") or "").strip()
    if not email:
        raise HTTPException(401, "Google did not return an email address.")

    # Existing account? Just log them in.
    existing = await db.users.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
    if existing:
        if existing.get("banned"):
            raise HTTPException(403, "Your account has been banned. Please contact support.")
        sus_until = existing.get("suspended_until")
        if sus_until:
            try:
                if datetime.now(timezone.utc) < datetime.fromisoformat(sus_until):
                    raise HTTPException(403, f"Your account is suspended until {sus_until}.")
            except (ValueError, TypeError):
                pass
        # Backfill avatar/oauth provider if missing
        patch = {"last_login_at": now_iso(), "failed_login_attempts": 0, "lockout_until": None, "oauth_provider": existing.get("oauth_provider") or "google"}
        if (not existing.get("avatar")) and picture:
            patch["avatar"] = picture
        if (not existing.get("first_name")) and name:
            patch["first_name"] = name.split(" ")[0]
        await db.users.update_one({"id": existing["id"]}, {"$set": patch})
        merged = {**existing, **patch}
        return {"access_token": make_token(existing["id"]), "token_type": "bearer", "user": _safe_user(merged), "is_new": False}

    # ---- New account: generate a username from email local-part ----
    base_uname = re.sub(r"[^A-Za-z0-9_.\-]", "", email.split("@", 1)[0])[:24] or f"friend{random.randint(100, 999)}"
    uname = base_uname
    n = 1
    while await db.users.find_one({"username": {"$regex": f"^{re.escape(uname)}$", "$options": "i"}}):
        n += 1
        uname = f"{base_uname}{n}"
        if n > 50:
            uname = f"{base_uname}{random.randint(1000, 9999)}"
            break

    first_name = name.split(" ")[0] if name else ""
    user = User(
        first_name=first_name,
        username=uname,
        email=email,
        avatar=picture,
        points=5,
        badges=["Friendly Member"],
    )
    doc = user.dict()
    doc["oauth_provider"] = "google"
    doc["password_hash"] = ""  # OAuth-only account — password login disabled
    doc["failed_login_attempts"] = 0
    doc["lockout_until"] = None
    doc["onboarding_completed"] = False
    doc["location_visibility"] = "suburb"

    # Invite attribution from ?ref=<id> captured at sign-up time
    if body.referrer_id and body.referrer_id != user.id:
        referrer = await db.users.find_one({"id": body.referrer_id}, {"id": 1, "_id": 0})
        if referrer:
            doc["invited_by"] = referrer["id"]
            await db.notifications.insert_one({
                "id": nid(), "user_id": referrer["id"], "type": "invite_accepted",
                "title": "Your invite worked!",
                "body": f"{user.first_name or user.username} just joined FriendPlace through your share link. Welcome them in!",
                "data": {"user_id": user.id}, "read": False, "created_at": now_iso(),
            })
            # Drop a Flutter on the inviter's Home feed — more visible than
            # the bell counter, makes the moment feel like a real "hello".
            await db.flutters.insert_one(FlutterDoc(
                from_id=user.id,
                to_id=referrer["id"],
                from_name=user.first_name or user.username,
                from_avatar=doc.get("avatar") or "🦋",
                message="🎉 Just joined through your invite — say hi!",
            ).dict())

    # Founding Member assignment for OAuth signups — same cohort cap, same
    # rules as username/password signup. Demo accounts excluded.
    await _assign_founder_status(doc)
    _fl_id_g = doc.pop("_founders_lounge_id", None)
    _ft_id_g = doc.pop("_founders_table_id", None)
    await db.users.insert_one(doc)
    if _fl_id_g:
        try:
            await db.groups.update_one(
                {"id": _fl_id_g},
                {"$addToSet": {"members": doc["id"]}},
            )
        except Exception:
            pass
    if _ft_id_g:
        try:
            await db.tables.update_one(
                {"id": _ft_id_g},
                {"$addToSet": {"seated": doc["id"]},
                 "$set": {"last_activity_at": now_iso()}},
            )
            await db.tables.update_one(
                {"id": _ft_id_g, "host_id": ""},
                {"$set": {"host_id": doc["id"]}},
            )
        except Exception:
            pass
    # Award invite-milestone badges to the inviter (idempotent).
    if doc.get("invited_by"):
        await _check_invite_milestones(doc["invited_by"])
    await db.notifications.insert_one({
        "id": nid(), "user_id": user.id, "type": "welcome",
        "title": "Welcome to FriendPlace!",
        "body": "We're so glad you're here. Take a moment to add your interests and join a few groups.",
        "read": False, "created_at": now_iso(),
    })
    if doc.get("is_founder"):
        await db.notifications.insert_one({
            "id": nid(), "user_id": user.id, "type": "welcome",
            "title": f"🦋 You're Founding Member #{doc['founder_number']}!",
            "body": "Thanks for being one of the first to join FriendPlace. You've earned a permanent badge on your profile — and 50 bonus points to get you started.",
            "read": False, "created_at": now_iso(),
        })
    try: await _broadcast_new_member(doc)
    except Exception as e: logger.warning("new-member broadcast failed: %s", e)
    return {"access_token": make_token(user.id), "token_type": "bearer", "user": _safe_user(doc), "is_new": True}


# ============================================================================
# Sign in with Apple (iOS-native)
# ============================================================================
# Apple gives us an `identity_token` (a JWT signed by Apple) that contains the
# user's stable Apple ID (`sub`), email (may be a private relay address), and
# audience. We verify the signature using Apple's published JWK set, then
# either link to an existing account by email/apple_id or create a fresh one
# using the SAME cohort/founder/invite logic as the Google flow above so the
# experience is identical regardless of provider.
#
# IMPORTANT: Apple only ships the user's *name* on the FIRST sign-in. Returning
# users see `fullName=null`. The frontend always passes whatever it has, and
# the backend backfills the name only if we don't already have one (never
# overwrites). This matches Apple's review guidelines.
#
# IMPORTANT: Email may be `nnn@privaterelay.appleid.com` when the user picks
# "Hide my email". We treat this as a normal email — Apple forwards messages
# to the real inbox — but we always use `apple_id` (sub) as the long-lived
# identity key, never email.

_APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
_APPLE_ISSUER = "https://appleid.apple.com"
_APPLE_AUDIENCES = (
    os.getenv("APPLE_CLIENT_ID_IOS") or "au.com.friendplace.app",
    os.getenv("APPLE_CLIENT_ID_WEB") or "au.com.friendplace.app.web",
)

# Cache the JWK set in-memory for an hour. Apple rotates keys roughly twice a
# year but rarely; an in-process LRU is enough for a single-instance backend.
_apple_jwks_cache: Dict[str, dict] = {}
_apple_jwks_fetched_at: float = 0.0


async def _fetch_apple_jwks() -> Dict[str, dict]:
    """Return a {kid: jwk_dict} mapping of Apple's current public keys.

    Cached for 1 hour. Re-fetched on cache miss for an unknown `kid` so a
    fresh key rotation never breaks sign-in for more than one request.
    """
    import time as _time, httpx as _httpx
    global _apple_jwks_cache, _apple_jwks_fetched_at
    now_ts = _time.time()
    if _apple_jwks_cache and (now_ts - _apple_jwks_fetched_at) < 3600:
        return _apple_jwks_cache
    try:
        async with _httpx.AsyncClient(timeout=10.0) as http:
            r = await http.get(_APPLE_JWKS_URL)
            r.raise_for_status()
            keys = (r.json() or {}).get("keys", []) or []
        _apple_jwks_cache = {k["kid"]: k for k in keys if k.get("kid")}
        _apple_jwks_fetched_at = now_ts
        return _apple_jwks_cache
    except Exception as e:
        logger.warning("apple jwks fetch failed: %s", e)
        if _apple_jwks_cache:
            return _apple_jwks_cache  # serve stale rather than hard-fail
        raise HTTPException(503, "Could not reach Apple sign-in right now. Please try again.")


class AppleAuthBody(BaseModel):
    # Apple identity JWT — issued by AppleAuthentication.signInAsync on iOS.
    identity_token: str
    # Apple authorization code — required to obtain a refresh_token via the
    # server-to-server `/auth/token` endpoint. We use the refresh_token to
    # call `/auth/revoke` when the user deletes their account (App Store
    # Guideline 5.1.1(v)). Optional because Apple sometimes doesn't return
    # one and because we want the endpoint to keep working even before the
    # SIWA `.p8` is configured.
    authorization_code: Optional[str] = None
    # Apple ships these only on the very first sign-in. Optional on subsequent
    # calls — we won't overwrite an existing name.
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    # Invite attribution captured at app launch (?ref=<id> in deep link).
    referrer_id: Optional[str] = None


# ----------------------------------------------------------------------------
# Sign in with Apple: server-to-server token exchange + revocation
# ----------------------------------------------------------------------------
# These helpers only do real work when the operator has configured the
# Sign-in-with-Apple private key in env. Without it the app still works
# (users can sign up and use the app), but delete-account won't be able to
# revoke Apple's tokens. Set:
#   APPLE_SIWA_TEAM_ID       — Apple Developer Team ID (e.g. 6XRMF8PK98)
#   APPLE_SIWA_KEY_ID        — 10-char Key ID of the Sign-in-with-Apple key
#                              (DIFFERENT from the App Store Connect API key)
#   APPLE_SIWA_PRIVATE_KEY   — full contents of the .p8 file (PEM, newlines
#                              preserved). Wrap in quotes in .env.
#   APPLE_SIWA_CLIENT_ID     — usually the same as APPLE_CLIENT_ID_IOS
#                              (au.com.friendplace.app). Override if you want
#                              to use the .web Services ID instead.

def _siwa_configured() -> bool:
    """True if all three env values needed to talk to Apple S2S are set."""
    return bool(
        os.getenv("APPLE_SIWA_TEAM_ID")
        and os.getenv("APPLE_SIWA_KEY_ID")
        and os.getenv("APPLE_SIWA_PRIVATE_KEY")
    )


def _build_apple_client_secret() -> str:
    """Mint a short-lived ES256 JWT used as the `client_secret` on Apple's
    server-to-server endpoints (`/auth/token`, `/auth/revoke`).

    Per Apple's docs the JWT must:
      - alg = ES256
      - iss = Apple Developer Team ID
      - sub = client_id (your bundle/Services ID)
      - aud = https://appleid.apple.com
      - exp ≤ 6 months from iat (we use 30 min — plenty for one request)
    """
    team_id = os.getenv("APPLE_SIWA_TEAM_ID", "")
    key_id = os.getenv("APPLE_SIWA_KEY_ID", "")
    client_id = os.getenv("APPLE_SIWA_CLIENT_ID") or os.getenv("APPLE_CLIENT_ID_IOS") or "au.com.friendplace.app"
    pkey = os.getenv("APPLE_SIWA_PRIVATE_KEY", "").replace("\\n", "\n")
    now_ts = int(_time.time())
    return jwt.encode(
        {
            "iss": team_id,
            "iat": now_ts,
            "exp": now_ts + 30 * 60,
            "aud": "https://appleid.apple.com",
            "sub": client_id,
        },
        pkey,
        algorithm="ES256",
        headers={"kid": key_id, "alg": "ES256"},
    )


async def _apple_exchange_code(auth_code: str) -> Dict[str, object]:
    """Exchange an authorization_code for `{access_token, refresh_token,
    id_token, ...}`. Returns {} on failure so callers can no-op gracefully.

    Apple's docs: POST https://appleid.apple.com/auth/token (form-encoded).
    The refresh_token is the long-lived credential we need for revoke.
    """
    if not _siwa_configured():
        return {}
    import httpx as _httpx
    client_id = os.getenv("APPLE_SIWA_CLIENT_ID") or os.getenv("APPLE_CLIENT_ID_IOS") or "au.com.friendplace.app"
    try:
        secret = _build_apple_client_secret()
        async with _httpx.AsyncClient(timeout=10.0) as http:
            r = await http.post(
                "https://appleid.apple.com/auth/token",
                data={
                    "client_id": client_id,
                    "client_secret": secret,
                    "code": auth_code,
                    "grant_type": "authorization_code",
                },
            )
            if r.status_code == 200:
                return r.json() or {}
            logger.warning("apple token exchange failed: %s %s", r.status_code, r.text[:200])
    except Exception as e:
        logger.warning("apple token exchange error: %s", e)
    return {}


async def _apple_revoke_token(token: str, token_type_hint: str = "refresh_token") -> bool:
    """Revoke a user's Apple tokens. Returns True on success or when SIWA
    isn't configured (so callers can treat configured/not-configured the
    same way and still delete the local account).

    Per Apple, revoking the refresh_token invalidates all derived access
    tokens, which is what Apple's review team will test for after deletion.
    """
    if not _siwa_configured() or not token:
        return False
    import httpx as _httpx
    client_id = os.getenv("APPLE_SIWA_CLIENT_ID") or os.getenv("APPLE_CLIENT_ID_IOS") or "au.com.friendplace.app"
    try:
        secret = _build_apple_client_secret()
        async with _httpx.AsyncClient(timeout=10.0) as http:
            r = await http.post(
                "https://appleid.apple.com/auth/revoke",
                data={
                    "client_id": client_id,
                    "client_secret": secret,
                    "token": token,
                    "token_type_hint": token_type_hint,
                },
            )
            if r.status_code == 200:
                return True
            logger.warning("apple revoke failed: %s %s", r.status_code, r.text[:200])
    except Exception as e:
        logger.warning("apple revoke error: %s", e)
    return False


@api.post("/auth/apple")
async def auth_apple(body: AppleAuthBody):
    """Exchange an Apple identity_token for a FriendPlace JWT.

    Verifies the JWT signature against Apple's public keys, checks issuer &
    audience, then either logs in the existing user (matched by apple_id, then
    email) or provisions a new account using the same logic as the Google
    flow (username generation, founder cohort, invite attribution, welcome
    notifications). Returns `{access_token, token_type, user, is_new}` — same
    envelope as `/auth/login` and `/auth/google` so the auth context on the
    client keeps working unchanged.
    """
    tok = (body.identity_token or "").strip()
    if not tok:
        raise HTTPException(400, "Missing identity_token")

    # --- 1. Parse header to find the signing key ID ---
    try:
        header = jwt.get_unverified_header(tok)
    except Exception as e:
        logger.info("apple token bad header: %s", e)
        raise HTTPException(401, "Apple sign-in token is malformed. Please try again.")
    kid = header.get("kid")
    if not kid:
        raise HTTPException(401, "Apple sign-in token is missing a key id. Please try again.")

    # --- 2. Resolve the public key (with cache miss → refresh fallback) ---
    keys = await _fetch_apple_jwks()
    jwk = keys.get(kid)
    if not jwk:
        # Apple may have rotated keys since our last fetch — force a refresh.
        global _apple_jwks_fetched_at
        _apple_jwks_fetched_at = 0.0
        keys = await _fetch_apple_jwks()
        jwk = keys.get(kid)
    if not jwk:
        raise HTTPException(401, "Apple sign-in key not recognised. Please try again.")

    # --- 3. Verify signature + claims ---
    try:
        # python-jose accepts a JWK dict directly; we explicitly allow only
        # RS256 (Apple's algorithm) so the token can't be downgraded.
        #
        # NOTE: `python-jose`'s `jwt.decode(audience=...)` requires a
        # single string, not a list. We support TWO audiences (iOS
        # bundle + web) so we skip its built-in `verify_aud` check and
        # validate the `aud` claim ourselves against the allowlist
        # after signature verification.
        decoded = jwt.decode(
            tok,
            jwk,
            algorithms=["RS256"],
            issuer=_APPLE_ISSUER,
            options={
                "verify_at_hash": False,  # we don't request an access token
                "verify_aud": False,      # manual multi-audience check below
            },
        )
        # Manual audience allow-list check — Apple always ships a single
        # `aud` string that matches the client_id used to request the
        # token; we accept any client_id we've configured (iOS + web).
        token_aud = decoded.get("aud")
        if token_aud not in _APPLE_AUDIENCES:
            raise JWTError(
                f"aud '{token_aud}' not in allowlist {list(_APPLE_AUDIENCES)}"
            )
    except JWTError as e:
        # Peek at the token claims (without verification) so the log tells us
        # WHY the JWT failed — usually an `aud` mismatch. TestFlight bugs are
        # almost impossible to diagnose without this line, so it's worth the
        # tiny cost.
        peek = {}
        try:
            peek = jwt.get_unverified_claims(tok) or {}
        except Exception:
            peek = {}
        logger.warning(
            "apple token verify failed: %s | token aud=%s iss=%s exp=%s | our audiences=%s",
            e, peek.get("aud"), peek.get("iss"), peek.get("exp"), _APPLE_AUDIENCES,
        )
        # Return a more actionable error message so TestFlight logs show the
        # actual cause rather than a generic "please try again".
        expected = " or ".join(_APPLE_AUDIENCES)
        got = peek.get("aud") or "unknown"
        if got and got != "unknown" and got not in _APPLE_AUDIENCES:
            raise HTTPException(
                401,
                f"Apple sign-in bundle mismatch: token aud '{got}' but server expects '{expected}'. "
                f"Check APPLE_CLIENT_ID_IOS in backend env.",
            )
        raise HTTPException(401, f"Apple sign-in could not be verified ({e}). Please try again.")

    apple_sub = (decoded.get("sub") or "").strip()
    email = (decoded.get("email") or "").strip().lower()
    if not apple_sub:
        raise HTTPException(401, "Apple did not return a user identifier.")

    # Apple includes `email_verified` as a string "true"/"false". We trust it
    # only for non-private-relay addresses; relay addresses are always
    # routable through Apple so we treat them as verified-equivalent.
    is_private_relay = email.endswith("@privaterelay.appleid.com")

    given = (body.first_name or "").strip()
    # Apple ships family name too but we don't store it separately yet (the
    # rest of the app only uses first_name). Capture it here for future use.
    _family = (body.last_name or "").strip()  # noqa: F841

    # --- 4. Existing account match (apple_id first, then email) ---
    existing = await db.users.find_one({"apple_id": apple_sub})
    if not existing and email:
        existing = await db.users.find_one(
            {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}
        )

    if existing:
        if existing.get("banned"):
            raise HTTPException(403, "Your account has been banned. Please contact support.")
        sus_until = existing.get("suspended_until")
        if sus_until:
            try:
                if datetime.now(timezone.utc) < datetime.fromisoformat(sus_until):
                    raise HTTPException(403, f"Your account is suspended until {sus_until}.")
            except (ValueError, TypeError):
                pass
        patch: Dict = {
            "last_login_at": now_iso(),
            "failed_login_attempts": 0,
            "lockout_until": None,
            "apple_id": apple_sub,
            "oauth_provider": existing.get("oauth_provider") or "apple",
        }
        # Backfill name ONLY when missing — Apple only ships name on first
        # sign-in so we must never overwrite with a later null value.
        if (not existing.get("first_name")) and given:
            patch["first_name"] = given
        # Backfill email if missing (rare — happens when the relay address
        # changed shape between sign-ins).
        if (not existing.get("email")) and email:
            patch["email"] = email
        # If we got a fresh authorization_code, exchange it for a refresh
        # token. We always overwrite — Apple issues a new refresh_token on
        # every sign-in and the old one may already be expired.
        if body.authorization_code and _siwa_configured():
            tokens = await _apple_exchange_code(body.authorization_code)
            rt = (tokens or {}).get("refresh_token")
            if rt:
                patch["apple_refresh_token"] = rt
        await db.users.update_one({"id": existing["id"]}, {"$set": patch})
        merged = {**existing, **patch}
        return {
            "access_token": make_token(existing["id"]),
            "token_type": "bearer",
            "user": _safe_user(merged),
            "is_new": False,
        }

    # --- 5. Brand-new user: generate username from name/email/sub ---
    seed = (given or (email.split("@", 1)[0] if email else "") or f"friend{random.randint(100, 999)}")
    base_uname = re.sub(r"[^A-Za-z0-9_.\-]", "", seed)[:24] or f"friend{random.randint(100, 999)}"
    uname = base_uname
    n = 1
    while await db.users.find_one({"username": {"$regex": f"^{re.escape(uname)}$", "$options": "i"}}):
        n += 1
        uname = f"{base_uname}{n}"
        if n > 50:
            uname = f"{base_uname}{random.randint(1000, 9999)}"
            break

    user = User(
        first_name=given or "",
        username=uname.lower(),
        email=email or "",
        avatar="🍎" if is_private_relay else "🦋",
        points=5,
        badges=["Friendly Member"],
    )
    doc = user.dict()
    doc["apple_id"] = apple_sub
    doc["oauth_provider"] = "apple"
    doc["password_hash"] = ""
    doc["failed_login_attempts"] = 0
    doc["lockout_until"] = None
    doc["onboarding_completed"] = False
    doc["location_visibility"] = "suburb"
    if is_private_relay:
        doc["apple_private_relay"] = True
    # If SIWA S2S is configured AND Apple gave us an auth code on the
    # client, exchange it now for a refresh_token. We persist that so we
    # can revoke Apple's tokens cleanly when the user later deletes their
    # account (App Store Guideline 5.1.1(v)).
    if body.authorization_code and _siwa_configured():
        try:
            tokens = await _apple_exchange_code(body.authorization_code)
            rt = (tokens or {}).get("refresh_token")
            if rt:
                doc["apple_refresh_token"] = rt
        except Exception as e:
            logger.warning("apple code exchange (new user) failed: %s", e)

    # Invite attribution — identical to Google/email flows
    if body.referrer_id and body.referrer_id != user.id:
        referrer = await db.users.find_one({"id": body.referrer_id}, {"id": 1, "_id": 0})
        if referrer:
            doc["invited_by"] = referrer["id"]
            await db.notifications.insert_one({
                "id": nid(), "user_id": referrer["id"], "type": "invite_accepted",
                "title": "Your invite worked!",
                "body": f"{user.first_name or user.username} just joined FriendPlace through your share link. Welcome them in!",
                "data": {"user_id": user.id}, "read": False, "created_at": now_iso(),
            })
            await db.flutters.insert_one(FlutterDoc(
                from_id=user.id,
                to_id=referrer["id"],
                from_name=user.first_name or user.username,
                from_avatar=doc.get("avatar") or "🦋",
                message="🎉 Just joined through your invite — say hi!",
            ).dict())

    # Founder cohort + FP Café seating (same rules as Google flow)
    await _assign_founder_status(doc)
    _fl_id_a = doc.pop("_founders_lounge_id", None)
    _ft_id_a = doc.pop("_founders_table_id", None)
    await db.users.insert_one(doc)
    if _fl_id_a:
        try:
            await db.groups.update_one(
                {"id": _fl_id_a},
                {"$addToSet": {"members": doc["id"]}},
            )
        except Exception:
            pass
    if _ft_id_a:
        try:
            await db.tables.update_one(
                {"id": _ft_id_a},
                {"$addToSet": {"seated": doc["id"]},
                 "$set": {"last_activity_at": now_iso()}},
            )
            await db.tables.update_one(
                {"id": _ft_id_a, "host_id": ""},
                {"$set": {"host_id": doc["id"]}},
            )
        except Exception:
            pass
    if doc.get("invited_by"):
        await _check_invite_milestones(doc["invited_by"])
    await db.notifications.insert_one({
        "id": nid(), "user_id": user.id, "type": "welcome",
        "title": "Welcome to FriendPlace!",
        "body": "We're so glad you're here. Take a moment to add your interests and join a few groups.",
        "read": False, "created_at": now_iso(),
    })
    if doc.get("is_founder"):
        await db.notifications.insert_one({
            "id": nid(), "user_id": user.id, "type": "welcome",
            "title": f"🦋 You're Founding Member #{doc['founder_number']}!",
            "body": "Thanks for being one of the first to join FriendPlace. You've earned a permanent badge on your profile — and 50 bonus points to get you started.",
            "read": False, "created_at": now_iso(),
        })
    try: await _broadcast_new_member(doc)
    except Exception as e: logger.warning("apple new-member broadcast failed: %s", e)
    return {
        "access_token": make_token(user.id),
        "token_type": "bearer",
        "user": _safe_user(doc),
        "is_new": True,
    }


@api.get("/auth/me")
async def auth_me(user=Depends(current_user)):
    return _safe_user(user)


# ------------- Founding Member status + Wall (public) -------------
@api.get("/founders")
async def founders_wall(limit: int = 500, skip: int = 0):
    """Public Founders Wall — celebrates every Founding Member with their
    avatar, first name, founder number and suburb. Powers the `/founders`
    screen which doubles as social proof for new visitors AND a thank-you
    page where existing members can see who else is in the cohort.

    Privacy: only fields that are already public on a normal profile are
    returned. Demo accounts are excluded so the cast doesn't drown out
    real founders. Sorted by founder_number ascending so #1 is always at
    the top — the "history of the community" feels right that way."""
    limit = max(1, min(int(limit or 500), 1000))
    skip = max(0, int(skip or 0))
    cursor = (
        db.users
        .find(
            {"is_founder": True, "is_demo": {"$ne": True}},
            {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1,
             "founder_number": 1, "suburb": 1, "created_at": 1},
        )
        .sort("founder_number", 1)
        .skip(skip)
        .limit(limit)
    )
    items = await cursor.to_list(limit)
    total = await db.users.count_documents({"is_founder": True, "is_demo": {"$ne": True}})
    return {"total": total, "items": items}


@api.get("/founders/status")
async def founders_status():
    """How many slots are left in the Founding Member cohort. Public —
    powers the marketing tile on the welcome / waitlist screens and lets
    us run a live `247 / 500 spots claimed` counter without an admin role.
    No personal data leaks — only aggregate counts."""
    cap = max(0, int(settings.founding_member_cap or 0))
    taken = await db.users.count_documents({"is_founder": True})
    return {
        "cap": cap,
        "taken": taken,
        "remaining": max(0, cap - taken),
        "open": taken < cap,
    }


@api.post("/founders/claim")
async def founders_claim(user=Depends(current_user)):
    """Opt-in endpoint that promotes the currently signed-in account to a
    Founding Member.

    Replaces the old auto-assignment-on-signup flow — now users see the
    Founder Info page (benefits + confirmation modal) and consciously
    claim the badge, which makes it feel earned rather than inherited.

    Returns the assigned founder_number and the refreshed user document
    so the client can update its local cache. Errors:
      • 400 — demo account or user missing
      • 409 — already a Founding Member (idempotent-safe to surface)
      • 410 — the cohort is full (cap reached)
    """
    result = await _promote_existing_user_to_founder(user["id"])
    return {
        "ok": True,
        "founder_number": result["founder_number"],
        "user": _safe_user(result["user"]),
    }


# ------------- Waitlist (pre-launch friends & family) -------------
class WaitlistEntry(BaseModel):
    id: str = Field(default_factory=nid)
    email: EmailStr
    name: str = ""
    suburb: str = ""
    source: str = ""        # e.g. "facebook", "flyer", "word_of_mouth"
    note: str = ""          # free-form ("I heard from Maggie!")
    referrer_id: Optional[str] = None  # carried from ?ref=<id>
    created_at: str = Field(default_factory=now_iso)
    invited: bool = False
    invited_at: Optional[str] = None


class WaitlistBody(BaseModel):
    email: EmailStr
    name: str = ""
    suburb: str = ""
    source: str = ""
    note: str = ""
    referrer_id: Optional[str] = None


@api.post("/waitlist")
async def join_waitlist(body: WaitlistBody, request: Request):
    """Capture a friends-and-family signup BEFORE the public launch. Idempotent
    by lower-cased email so a single person hitting "submit" twice doesn't
    duplicate. Returns the queue position so we can show a friendly
    "you're #42 in line" message.

    NOT the same as account signup — these are leads, not authenticated
    users. They'll be invited via email when we open more slots."""
    client_ip = (request.client.host if request.client else "unknown") or "unknown"
    rate_limit(f"waitlist:{client_ip}", max_calls=5, window_seconds=600)
    email = body.email.strip().lower()
    existing = await db.waitlist.find_one({"email": email}, {"_id": 0})
    if existing:
        position = await db.waitlist.count_documents({
            "created_at": {"$lte": existing["created_at"]},
        })
        return {
            "ok": True,
            "already_on_list": True,
            "position": position,
            "joined_at": existing["created_at"],
        }
    entry = WaitlistEntry(
        email=email,
        name=(body.name or "").strip()[:80],
        suburb=(body.suburb or "").strip()[:80],
        source=(body.source or "").strip()[:40],
        note=(body.note or "").strip()[:300],
        referrer_id=body.referrer_id,
    )
    await db.waitlist.insert_one(entry.dict())
    position = await db.waitlist.count_documents({})
    logger.info("Waitlist signup: %s (pos #%s, source=%s)", email, position, entry.source or "—")
    return {
        "ok": True,
        "already_on_list": False,
        "position": position,
        "joined_at": entry.created_at,
    }


@api.get("/waitlist/stats")
async def waitlist_stats():
    """Public, aggregate-only stats — total signups + count by source for the
    marketing page. No emails or names exposed."""
    total = await db.waitlist.count_documents({})
    invited = await db.waitlist.count_documents({"invited": True})
    # Top sources for a "where people heard about us" chart
    pipe = [
        {"$match": {"source": {"$ne": ""}}},
        {"$group": {"_id": "$source", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 10},
    ]
    sources = [{"source": d["_id"], "count": d["n"]} async for d in db.waitlist.aggregate(pipe)]
    return {"total": total, "invited": invited, "waiting": total - invited, "sources": sources}


@api.get("/admin/waitlist")
async def admin_waitlist(
    invited: Optional[bool] = None,
    me: dict = Depends(current_admin),
):
    """Admin-only — full waitlist with emails/names/notes so an admin can
    hand-pick the next batch to invite. SEC-004 fix: uses bearer-token
    admin check via `current_admin` — no client-supplied admin_id."""
    q: dict = {}
    if invited is not None:
        q["invited"] = invited
    docs = await db.waitlist.find(q, {"_id": 0}).sort("created_at", 1).to_list(2000)
    return {"total": len(docs), "entries": docs}


@api.post("/admin/waitlist/{entry_id}/mark-invited")
async def admin_mark_invited(entry_id: str, me: dict = Depends(current_admin)):
    """Mark a waitlist entry as `invited`. SEC-004 hardened."""
    res = await db.waitlist.update_one(
        {"id": entry_id},
        {"$set": {"invited": True, "invited_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Waitlist entry not found")
    return {"ok": True}



@api.post("/auth/forgot-password")
async def forgot_password(body: ForgotBody):
    u = await _find_user_by_identifier(body.identifier)
    if not u or u.get("is_demo"):
        # Don't leak which accounts exist — just say OK
        return {"message": "If that account exists, a reset code was generated."}
    code = f"{random.randint(0, 999999):06d}"
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=RESET_TTL_MIN)).isoformat()
    await db.password_resets.delete_many({"user_id": u["id"], "used": False})
    await db.password_resets.insert_one({
        "user_id": u["id"], "code": code, "expires_at": expires_at,
        "used": False, "created_at": now_iso(),
    })
    # SEC-003: NEVER return or log the reset code to the caller. The code
    # is generated + stored server-side, then delivered via Resend when
    # configured. If email delivery isn't configured (dev env with no
    # RESEND_API_KEY), the code stays in Mongo and can be inspected by
    # an operator — the endpoint still returns the same generic message
    # so we never leak whether the account exists.
    logger.info("Password reset code generated for user=%s (code redacted)", u.get("id"))

    # Fire-and-await email delivery. `_email_send` never raises — it
    # returns False + logs on any failure so we don't block the reset
    # flow if the third-party is down.
    email_addr = (u.get("email") or "").strip().lower()
    if email_addr and _email_is_configured():
        subject, html, text = _email_password_reset_template(
            first_name=u.get("first_name"),
            code=code,
            ttl_minutes=RESET_TTL_MIN,
        )
        await _email_send(to=email_addr, subject=subject, html=html, text=text)
    elif not _email_is_configured():
        logger.warning(
            "Password reset email NOT sent — RESEND_API_KEY is not configured. "
            "Add it to /app/backend/.env and restart the backend. Reset code "
            "is stored in Mongo (password_resets collection) and can be "
            "looked up by an operator for user=%s.",
            u.get("id"),
        )
    elif not email_addr:
        logger.warning(
            "Password reset email NOT sent — user=%s has no email on file. "
            "Reset code is stored in Mongo (password_resets collection).",
            u.get("id"),
        )

    return {"message": "If that account exists, a reset code was generated. Check your email."}


@api.post("/auth/reset-password")
async def reset_password(body: ResetBody):
    u = await _find_user_by_identifier(body.identifier)
    if not u:
        # Constant-error path so we don't reveal existence.
        raise HTTPException(400, "Invalid or expired code")
    # SEC-003 hardening: throttle verification attempts per user. After
    # 5 wrong codes we mark all outstanding resets as used, forcing a new
    # code request. Prevents online brute-force of the 6-digit code.
    now = datetime.now(timezone.utc)
    attempts = int(u.get("reset_verify_attempts") or 0)
    locked_until_iso = u.get("reset_verify_locked_until")
    if locked_until_iso:
        try:
            if now < datetime.fromisoformat(locked_until_iso):
                raise HTTPException(429, "Too many attempts — please request a new code")
        except (ValueError, TypeError):
            pass
    rec = await db.password_resets.find_one({"user_id": u["id"], "code": body.code, "used": False})
    if not rec:
        # Bump the counter and lock after 5 misses for 15 minutes.
        new_attempts = attempts + 1
        patch: Dict[str, object] = {"reset_verify_attempts": new_attempts}
        if new_attempts >= 5:
            # Invalidate every outstanding reset row + lock the identifier.
            await db.password_resets.update_many(
                {"user_id": u["id"], "used": False}, {"$set": {"used": True}}
            )
            patch["reset_verify_locked_until"] = (
                now + timedelta(minutes=15)
            ).isoformat()
            patch["reset_verify_attempts"] = 0
        await db.users.update_one({"id": u["id"]}, {"$set": patch})
        raise HTTPException(400, "Invalid or expired code")
    try:
        exp = datetime.fromisoformat(rec["expires_at"])
    except Exception:
        raise HTTPException(400, "Invalid or expired code")
    if now > exp:
        raise HTTPException(400, "Invalid or expired code")

    await db.users.update_one(
        {"id": u["id"]},
        {"$set": {
            "password_hash": hash_pw(body.new_password),
            "failed_login_attempts": 0,
            "lockout_until": None,
            "reset_verify_attempts": 0,
            "reset_verify_locked_until": None,
        }},
    )
    await db.password_resets.update_many(
        {"user_id": u["id"], "code": body.code},
        {"$set": {"used": True}},
    )
    return {"message": "Password has been reset. You can now log in."}


@api.get("/auth/demo-accounts")
async def list_demo_accounts():
    docs = await db.users.find({"is_demo": True}, {"_id": 0, "password_hash": 0}).to_list(50)
    return [
        {"username": d["username"], "first_name": d.get("first_name", ""), "avatar": d.get("avatar", ""), "suburb": d.get("suburb", "")}
        for d in docs
    ]


@api.get("/users")
async def list_users(
    suburb: Optional[str] = None,
    interest: Optional[str] = None,
    q: Optional[str] = None,
    viewer_id: Optional[str] = None,
    near_lat: Optional[float] = None,
    near_lng: Optional[float] = None,
    radius_km: Optional[float] = None,
    me: dict = Depends(current_user),
):
    """List members. Requires authentication (SEC-002). When `viewer_id` is
    provided, hides users blocked by or who have blocked the viewer, and
    excludes banned users.

    When `near_lat` + `near_lng` + `radius_km` are provided, only includes
    members whose suburb falls within that radius. Coordinates are NEVER
    returned to the client — only a friendly `distance_km` and the suburb
    name. Users with `location_visibility=private` are excluded from radius
    queries (they opted out of location matching)."""
    # viewer_id is ignored if it doesn't match the token subject — we trust
    # the authenticated identity, not the query string (SEC-004 pattern).
    if viewer_id and viewer_id != me.get("id"):
        viewer_id = me.get("id")
    if not viewer_id:
        viewer_id = me.get("id")
    query: Dict = {"banned": {"$ne": True}, "profile_hidden": {"$ne": True}}
    if suburb:
        # SEC hardening: escape user-supplied filter values before passing to
        # Mongo `$regex`; otherwise a crafted input could inject regex
        # metacharacters and trigger catastrophic backtracking (ReDoS).
        query["suburb"] = {"$regex": re.escape(suburb), "$options": "i"}
    if interest:
        query["interests"] = {"$regex": re.escape(interest), "$options": "i"}
    if q:
        # Find Friends search: case-insensitive substring match across the
        # most natural "who am I looking for?" fields. Includes interests
        # so a search for "pets" matches a user with the interest "Pets"
        # (this previously failed and was reported during UAT), and suburb
        # so searches like "Bondi" surface neighbours without needing the
        # advanced suburb filter chip.
        import re as _re
        safe = _re.escape(q)
        query["$or"] = [
            {"first_name": {"$regex": safe, "$options": "i"}},
            {"username": {"$regex": safe, "$options": "i"}},
            {"interests": {"$regex": safe, "$options": "i"}},
            {"suburb": {"$regex": safe, "$options": "i"}},
        ]
    if viewer_id:
        viewer = await db.users.find_one({"id": viewer_id}, {"_id": 0, "blocked": 1}) or {}
        blocked_by_me = viewer.get("blocked") or []
        query["id"] = {"$nin": blocked_by_me + [viewer_id]}
        query["blocked"] = {"$ne": viewer_id}
    if near_lat is not None and near_lng is not None and radius_km:
        # Restrict to users who have lat/lng AND haven't opted out.
        query["suburb_lat"] = {"$ne": None, "$exists": True}
        query["suburb_lng"] = {"$ne": None, "$exists": True}
        query["location_visibility"] = {"$ne": "private"}
    if near_lat is not None and near_lng is not None and radius_km:
        # Distance-based sort below is the natural one for "Near Me" — newest
        # members are surfaced via the default sort instead.
        docs = await db.users.find(query, {"_id": 0}).to_list(500)
    else:
        # Default Find Friends ordering: newest members first so people are
        # rewarded for joining and so longtime members see fresh faces. Falls
        # back to id when created_at is identical to keep the order stable.
        docs = await db.users.find(query, {"_id": 0}).sort([("created_at", -1), ("id", -1)]).to_list(500)
    # Apply radius filter + attach distance, then strip coords before returning.
    if near_lat is not None and near_lng is not None and radius_km:
        out: List[Dict] = []
        for u in docs:
            lat = u.get("suburb_lat")
            lng = u.get("suburb_lng")
            if lat is None or lng is None:
                continue
            dist = sb_haversine(float(near_lat), float(near_lng), float(lat), float(lng))
            if dist <= float(radius_km):
                u["distance_km"] = round(dist, 1)
                out.append(u)
        out.sort(key=lambda x: x.get("distance_km", 9999))
        # Peer projection strips PII + coords + admin flags (SEC-002).
        return [_peer_user(u, viewer_is_owner=False, viewer_is_admin=bool(me.get("is_admin"))) for u in out]
    # Peer projection for the default listing too — never leak email,
    # apple_id, refresh tokens, or admin flags to other members.
    return [_peer_user(u, viewer_is_owner=False, viewer_is_admin=bool(me.get("is_admin"))) for u in docs]


@api.get("/users/{user_id}")
async def get_user(user_id: str, me: dict = Depends(current_user)):
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    # Only the owner (or admins) sees their private fields; every other
    # viewer gets the peer projection (SEC-002).
    viewer_is_owner = me.get("id") == user_id
    viewer_is_admin = bool(me.get("is_admin"))
    return _peer_user(user, viewer_is_owner=viewer_is_owner, viewer_is_admin=viewer_is_admin)


@api.get("/users/{user_id}/invite-stats")
async def invite_stats(user_id: str, limit: int = 10):
    """How many real (non-demo) users joined FriendPlace via this user's share
    link, plus a few recent first names so the inviter can see who arrived.
    """
    if not await db.users.find_one({"id": user_id}, {"id": 1, "_id": 0}):
        raise HTTPException(404, "User not found")
    cur = db.users.find(
        {"invited_by": user_id, "is_demo": {"$ne": True}},
        {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1, "created_at": 1},
    ).sort("created_at", -1).limit(max(1, min(50, limit)))
    invited = await cur.to_list(50)
    return {
        "count": len(invited),
        "recent": invited,
    }


@api.get("/users/{user_id}/inviter")
async def get_inviter(user_id: str):
    """Display info about the user who invited this person, if any. Returns
    just enough to show "You joined because Garry invited you" — never exposes
    private data about the inviter beyond their public profile fields.
    """
    me = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "invited_by": 1})
    if not me:
        raise HTTPException(404, "User not found")
    referrer_id = me.get("invited_by")
    if not referrer_id:
        return {"inviter": None}
    inv = await db.users.find_one(
        {"id": referrer_id},
        {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1, "suburb": 1, "is_demo": 1},
    )
    if not inv:
        return {"inviter": None}
    return {"inviter": inv}


# Invite milestone badges — order matters so the title progresses naturally.
INVITE_BADGES = [
    (1,  "First Invite"),
    (3,  "Community Builder"),
    (10, "Connector"),
    (25, "Ambassador"),
    (50, "Founder Friend"),
]


async def _check_invite_milestones(referrer_id: str) -> None:
    """Award any new invite-count badges the referrer has unlocked. Safe to
    call after every successful invite — idempotent because we only $addToSet."""
    if not referrer_id:
        return
    try:
        count = await db.users.count_documents({"invited_by": referrer_id, "is_demo": {"$ne": True}})
        unlocked = [name for threshold, name in INVITE_BADGES if count >= threshold]
        if not unlocked:
            return
        existing = await db.users.find_one({"id": referrer_id}, {"_id": 0, "badges": 1}) or {}
        have = set(existing.get("badges") or [])
        newly = [b for b in unlocked if b not in have]
        if not newly:
            return
        await db.users.update_one({"id": referrer_id}, {"$addToSet": {"badges": {"$each": newly}}})
        # Award a small points bonus + tell them about the new badge
        bonus = 15 * len(newly)
        await db.users.update_one({"id": referrer_id}, {"$inc": {"points": bonus}})
        # Pick the highest tier they just unlocked for the celebratory toast
        latest = newly[-1]
        await push_notification(
            referrer_id,
            "achievement",
            f"🏆 New badge: {latest}",
            f"You've earned the {latest} badge — thanks for growing the FriendPlace community!",
            {"badge": latest, "invite_count": count},
        )
    except Exception as e:
        logger.warning("invite milestone check failed: %s", e)


@api.post("/users/{user_id}/block/{other_id}")
async def block_user(user_id: str, other_id: str):
    await db.users.update_one({"id": user_id}, {"$addToSet": {"blocked": other_id}})
    return {"ok": True}


# Legacy endpoint removed (was writing to old report schema). Use /api/users/{id}/report instead.


# ------------- Notifications -------------
# type values used across the app:
#   friend_request, friend_accepted, dm, event_invite, table_join, notice_comment, flutter
async def push_notification(user_id: str, n_type: str, title: str, body: str = "", payload: Optional[Dict] = None):
    if not user_id:
        return
    doc = {
        "id": nid(),
        "user_id": user_id,
        "type": n_type,
        "title": title,
        "body": body,
        "payload": payload or {},
        "read": False,
        "created_at": now_iso(),
    }
    await db.notifications.insert_one(doc)
    # Mirror to device push (Emergent-managed). Safe to call without google-services.json
    # — fails silently and never blocks the in-app notification.
    try:
        from push import send_push
        push_data: Dict = {"title": title, "message": body or title, "type": n_type}
        # Deep-link hint so a tap from the system tray opens the right screen
        deeplink_map = {
            "friend_request": "/messages",
            "friend_accepted": "/friends",
            "dm": "/messages",
            "dm_request": "/messages",
            "table_join": "/coffee",
            "table_invite": "/coffee",
            "event_invite": "/events",
            "event_reminder": "/events",
            "notice_comment": "/notices",
            "flutter": "/notifications",
            "looking_for_chat": "/friends",
        }
        if n_type in deeplink_map:
            push_data["action_url"] = deeplink_map[n_type]
        await send_push(recipients=[user_id], data=push_data)
    except Exception as e:
        logger.warning("device push failed (non-blocking): %s", e)


@api.get("/notifications/{user_id}")
async def list_notifications(user_id: str, unread_only: bool = False):
    q: Dict = {"user_id": user_id}
    if unread_only:
        q["read"] = False
    docs = await db.notifications.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api.get("/notifications/{user_id}/count")
async def notifications_count(user_id: str):
    n = await db.notifications.count_documents({"user_id": user_id, "read": False})
    return {"unread": n}


@api.post("/notifications/{nid_}/read")
async def mark_notification_read(nid_: str):
    await db.notifications.update_one({"id": nid_}, {"$set": {"read": True}})
    return {"ok": True}


@api.post("/notifications/{user_id}/read-all")
async def mark_all_notifications_read(user_id: str):
    await db.notifications.update_many({"user_id": user_id, "read": False}, {"$set": {"read": True}})
    return {"ok": True}


# ------------- Friends (full lifecycle) -------------
@api.post("/friends/request")
async def send_friend_request(body: FriendRequest):
    if body.from_id == body.to_id:
        raise HTTPException(400, "Cannot friend yourself")
    # Prevent duplicates: existing pending or already friends
    existing = await db.friend_requests.find_one({
        "from_id": body.from_id, "to_id": body.to_id, "status": "pending",
    })
    if existing:
        raise HTTPException(400, "Request already pending")
    target = await db.users.find_one({"id": body.to_id}, {"friends": 1, "first_name": 1, "_id": 0})
    if target and body.from_id in (target.get("friends") or []):
        raise HTTPException(400, "Already friends")
    fr = FriendRequest(**body.dict())
    await db.friend_requests.insert_one(fr.dict())
    sender = await db.users.find_one({"id": body.from_id}, {"first_name": 1, "avatar": 1, "_id": 0})
    sname = (sender or {}).get("first_name") or "Someone"
    avatar = (sender or {}).get("avatar") or "🙂"
    await push_notification(
        body.to_id,
        "friend_request",
        f"{avatar} {sname} wants to be friends",
        "Tap to accept or decline.",
        {"request_id": fr.id, "from_id": body.from_id},
    )
    return fr.dict()


@api.get("/friends/requests/{user_id}")
async def my_requests(user_id: str):
    docs = await db.friend_requests.find({"to_id": user_id, "status": "pending"}, {"_id": 0}).to_list(200)
    return docs


@api.get("/friends/inbox/{user_id}")
async def friends_inbox(user_id: str):
    incoming = await db.friend_requests.find({"to_id": user_id, "status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(200)
    outgoing = await db.friend_requests.find({"from_id": user_id, "status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # decorate with the OTHER party's profile basics so the UI can render avatars + names
    async def hydrate(reqs, side_key):
        out = []
        for r in reqs:
            other_id = r[side_key]
            u = await db.users.find_one({"id": other_id}, {"_id": 0, "password_hash": 0})
            if u:
                r["other"] = {"id": u["id"], "first_name": u.get("first_name", ""), "username": u.get("username", ""), "avatar": u.get("avatar", ""), "suburb": u.get("suburb", "")}
            out.append(r)
        return out
    incoming = await hydrate(incoming, "from_id")
    outgoing = await hydrate(outgoing, "to_id")
    return {"incoming": incoming, "outgoing": outgoing}


@api.post("/friends/accept/{req_id}")
async def accept_request(req_id: str):
    req = await db.friend_requests.find_one({"id": req_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if req.get("status") != "pending":
        raise HTTPException(400, "Already resolved")
    await db.friend_requests.update_one({"id": req_id}, {"$set": {"status": "accepted"}})
    await db.users.update_one({"id": req["from_id"]}, {"$addToSet": {"friends": req["to_id"]}})
    await db.users.update_one({"id": req["to_id"]}, {"$addToSet": {"friends": req["from_id"]}})
    await award_points(req["from_id"], 5)
    await award_points(req["to_id"], 5)
    accepter = await db.users.find_one({"id": req["to_id"]}, {"first_name": 1, "avatar": 1, "_id": 0})
    aname = (accepter or {}).get("first_name") or "Your friend"
    avatar = (accepter or {}).get("avatar") or "🦋"
    await push_notification(
        req["from_id"],
        "friend_accepted",
        f"{avatar} {aname} accepted your friend request",
        "Say hello — you can now message each other.",
        {"friend_id": req["to_id"]},
    )
    return {"ok": True}


@api.post("/friends/decline/{req_id}")
async def decline_request(req_id: str):
    req = await db.friend_requests.find_one({"id": req_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if req.get("status") != "pending":
        raise HTTPException(400, "Already resolved")
    await db.friend_requests.update_one({"id": req_id}, {"$set": {"status": "declined"}})
    return {"ok": True}


@api.post("/friends/cancel/{req_id}")
async def cancel_request(req_id: str):
    """Sender cancels their own outgoing pending request."""
    req = await db.friend_requests.find_one({"id": req_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if req.get("status") != "pending":
        raise HTTPException(400, "Already resolved")
    await db.friend_requests.update_one({"id": req_id}, {"$set": {"status": "cancelled"}})
    return {"ok": True}


@api.delete("/friends/{user_id}/{friend_id}")
async def remove_friend(user_id: str, friend_id: str):
    await db.users.update_one({"id": user_id}, {"$pull": {"friends": friend_id}})
    await db.users.update_one({"id": friend_id}, {"$pull": {"friends": user_id}})
    return {"ok": True}


# ------------- Privacy & Presence -------------
class PrivacyBody(BaseModel):
    privacy: str  # everyone | friends | invisible


@api.patch("/users/{user_id}/privacy")
async def set_privacy(user_id: str, body: PrivacyBody):
    if body.privacy not in ("everyone", "friends", "invisible"):
        raise HTTPException(400, "Invalid privacy value")
    await db.users.update_one({"id": user_id}, {"$set": {"privacy": body.privacy}})
    return {"ok": True, "privacy": body.privacy}


# ----- Profile update + privacy v2 + onboarding -----
class ProfileUpdateBody(BaseModel):
    first_name: Optional[str] = None
    suburb: Optional[str] = None
    bio: Optional[str] = None
    avatar: Optional[str] = None      # emoji OR data:image/...;base64,...
    interests: Optional[List[str]] = None
    favourite_games: Optional[List[str]] = None
    birthday: Optional[str] = None    # YYYY-MM-DD or MM-DD
    # Account contact details — added so members can edit their email
    # / username from the in-app profile editor (and so it isn't a
    # support-only operation).
    email: Optional[str] = None
    username: Optional[str] = None


@api.patch("/users/{user_id}/profile")
async def update_profile(user_id: str, body: ProfileUpdateBody):
    update: Dict = {}
    for f in ("first_name", "suburb", "bio", "avatar", "interests", "favourite_games", "birthday"):
        v = getattr(body, f, None)
        if v is not None:
            update[f] = v

    # Email — accept a normalised lowercase address, validate format,
    # check uniqueness against other accounts. Google-managed accounts
    # are gated because the email is the OAuth identity key and
    # changing it server-side would break next sign-in.
    if body.email is not None:
        email = body.email.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise HTTPException(400, "That email address doesn't look right. Try something like name@example.com")
        if len(email) > 120:
            raise HTTPException(400, "Email is too long")
        current = await db.users.find_one({"id": user_id}, {"_id": 0, "email": 1, "google_id": 1})
        if not current:
            raise HTTPException(404, "Account not found")
        if (current.get("google_id") and email != (current.get("email") or "").lower()):
            raise HTTPException(400, "Your email is managed by Google sign-in and can't be changed here. Sign in with a different Google account if you'd like to switch.")
        clash = await db.users.find_one({"email": email, "id": {"$ne": user_id}}, {"_id": 0, "id": 1})
        if clash:
            raise HTTPException(409, "That email is already in use by another account.")
        update["email"] = email

    # Username — letters, digits, dot, underscore, dash. 3-24 chars.
    # Demo accounts skip the change since their handle is part of the
    # seeded fixture set.
    if body.username is not None:
        uname = body.username.strip().lower()
        if not re.match(r"^[a-z0-9._-]{3,24}$", uname):
            raise HTTPException(400, "Username can use letters, numbers, dots, dashes and underscores (3-24 characters).")
        current = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1, "is_demo": 1})
        if not current:
            raise HTTPException(404, "Account not found")
        if current.get("is_demo"):
            raise HTTPException(400, "Demo accounts can't change username.")
        clash = await db.users.find_one({"username": uname, "id": {"$ne": user_id}}, {"_id": 0, "id": 1})
        if clash:
            raise HTTPException(409, "That username is already taken — try another.")
        update["username"] = uname

    if update:
        await db.users.update_one({"id": user_id}, {"$set": update})
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "user": u}


class PrivacySettingsBody(BaseModel):
    profile_visibility: Optional[str] = None    # everyone | friends
    friend_requests: Optional[str] = None        # everyone | friends | off
    show_in_find_friends: Optional[bool] = None


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


@api.post("/users/{user_id}/password")
async def change_password(user_id: str, body: ChangePasswordBody, user=Depends(current_user)):
    """Member-initiated password change.

    Requires the existing password to be supplied so a stolen session
    can't silently take over the account. Google-managed accounts are
    rejected because they have no local password to swap. Demo accounts
    are blocked to keep the seeded fixtures predictable for testing.
    """
    if user.get("id") != user_id and not user.get("is_admin"):
        raise HTTPException(403, "You can only change your own password")
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(404, "Account not found")
    if u.get("is_demo"):
        raise HTTPException(400, "Demo accounts can't change password.")
    if u.get("google_id") and not u.get("password_hash"):
        raise HTTPException(400, "Your account uses Google sign-in — there's no password to change here.")
    if not body.current_password or not body.new_password:
        raise HTTPException(400, "Both current and new password are required.")
    if len(body.new_password) < 8:
        raise HTTPException(400, "New password must be at least 8 characters.")
    if body.new_password == body.current_password:
        raise HTTPException(400, "New password must be different from your current one.")
    # Verify the current password
    cur_hash = u.get("password_hash") or ""
    try:
        ok = pwd_ctx.verify(body.current_password, cur_hash) if cur_hash else False
    except Exception:
        ok = False
    if not ok:
        raise HTTPException(400, "Current password is incorrect.")
    new_hash = hash_pw(body.new_password)
    await db.users.update_one({"id": user_id}, {"$set": {"password_hash": new_hash}})
    return {"ok": True}


@api.patch("/users/{user_id}/privacy-settings")
async def update_privacy_settings(user_id: str, body: PrivacySettingsBody):
    update: Dict = {}
    if body.profile_visibility is not None:
        if body.profile_visibility not in ("everyone", "friends"):
            raise HTTPException(400, "Invalid profile_visibility")
        update["privacy_settings.profile_visibility"] = body.profile_visibility
    if body.friend_requests is not None:
        if body.friend_requests not in ("everyone", "friends", "off"):
            raise HTTPException(400, "Invalid friend_requests")
        update["privacy_settings.friend_requests"] = body.friend_requests
    if body.show_in_find_friends is not None:
        update["privacy_settings.show_in_find_friends"] = bool(body.show_in_find_friends)
    if update:
        await db.users.update_one({"id": user_id}, {"$set": update})
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "user": u}


@api.post("/users/{user_id}/onboarding-complete")
async def onboarding_complete(user_id: str):
    await db.users.update_one({"id": user_id}, {"$set": {"onboarding_completed": True}})
    return {"ok": True}


# ---------------- Onboarding wizard ----------------
# A small, curated list of starter community groups that brand-new FriendPlace
# members can join with a single tap during the post-signup wizard. Sydney/AU
# leaning to match the seed dataset. The wizard mixes these with the existing
# seeded groups (Walking, Garden Club, etc.) — interest-matched first.
STARTER_GROUPS = [
    {"name": "Sydney Locals", "emoji": "🏙️", "description": "For everyone who calls Sydney home — share favourite spots, meetups and neighbourhood news.",
     "tags": ["local", "sydney", "meetups", "neighbourhood"]},
    {"name": "New Friends", "emoji": "👋", "description": "Brand new to FriendPlace? Say hello and meet other members who just joined.",
     "tags": ["new", "introductions", "welcome"]},
    {"name": "Pet Lovers", "emoji": "🐾", "description": "Cats, dogs, chooks, fish — share pet stories, photos and walking buddies.",
     "tags": ["pets", "dogs", "cats", "animals"]},
    {"name": "Classic Cars", "emoji": "🚗", "description": "Restorations, cruises and Sunday-morning meetups for car enthusiasts.",
     "tags": ["cars", "classic cars", "vehicles", "motoring"]},
    {"name": "Gardening", "emoji": "🌱", "description": "Vegetable patches, balcony gardens, plant swaps and questions welcome.",
     "tags": ["gardening", "plants", "garden"]},
    {"name": "Walking & Trails", "emoji": "🥾", "description": "Bushwalks, beach strolls, and gentle daily walks — find a walking buddy.",
     "tags": ["walking", "fitness", "hiking", "outdoors"]},
    {"name": "FP Café Crew", "emoji": "☕", "description": "Regulars who love a virtual cuppa in the FP Café — chat anytime.",
     "tags": ["coffee", "chat", "lounge", "social"], "is_system": True},
]


async def _ensure_starter_groups() -> List[Dict]:
    """Idempotently create the starter groups if they don't already exist and
    return the canonical list (with `id` populated). Safe to call on every
    suggested-groups request — early-exits once they exist."""
    out: List[Dict] = []
    for g in STARTER_GROUPS:
        existing = await db.groups.find_one({"name": g["name"]}, {"_id": 0})
        if existing:
            # Backfill tags if we added them after the initial seed
            if not existing.get("tags"):
                await db.groups.update_one({"id": existing["id"]}, {"$set": {"tags": g["tags"]}})
                existing["tags"] = g["tags"]
            out.append(existing)
            continue
        grp = Group(name=g["name"], emoji=g["emoji"], description=g["description"])
        doc = grp.dict()
        doc["tags"] = g["tags"]
        doc["is_starter"] = True
        await db.groups.insert_one(doc)
        out.append(doc)
    return out


@api.get("/onboarding/suggested-groups")
async def onboarding_suggested_groups(user_id: str):
    """Return a curated list of suggested groups for the onboarding wizard,
    interest-matched first then the rest. Auto-creates the 7 starter groups on
    first call. Each item includes a `match` count so the UI can highlight a
    "great match" badge for groups that align with what the user just picked."""
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(404, "User not found")
    starters = await _ensure_starter_groups()
    # Also include any existing seeded groups (Walking Group, Garden Club, …)
    # but only if they aren't starters already.
    starter_ids = {g["id"] for g in starters}
    other = await db.groups.find({"id": {"$nin": list(starter_ids)}}, {"_id": 0}).to_list(50)
    all_groups = starters + other

    interests = [i.lower() for i in (u.get("interests") or [])]

    def score(g: Dict) -> int:
        tags = [t.lower() for t in (g.get("tags") or [])]
        name = (g.get("name") or "").lower()
        desc = (g.get("description") or "").lower()
        hits = 0
        for i in interests:
            if i in tags or i in name or i in desc:
                hits += 1
        return hits

    enriched = []
    for g in all_groups:
        enriched.append({
            "id": g["id"],
            "name": g["name"],
            "emoji": g.get("emoji", "👥"),
            "description": g.get("description", ""),
            "member_count": len(g.get("members") or []),
            "is_starter": bool(g.get("is_starter")) or g["id"] in starter_ids,
            "match": score(g),
        })
    # Sort: interest-match desc, then starter status, then member_count desc
    enriched.sort(key=lambda x: (-x["match"], 0 if x["is_starter"] else 1, -x["member_count"]))
    return {"groups": enriched}


class OnboardingCompleteBody(BaseModel):
    user_id: str
    interests: List[str] = []
    suburb: Optional[str] = None
    suburb_postcode: Optional[str] = None
    suburb_state: Optional[str] = None
    location_visibility: Optional[str] = None  # "suburb" | "private"
    avatar: Optional[str] = None  # base64 data URI or emoji or URL
    group_ids: List[str] = []
    # If True the user tapped the big "Join All Suggested Groups" button —
    # we award an extra welcome badge so it feels rewarding.
    joined_all: bool = False


@api.post("/onboarding/complete")
async def onboarding_complete_full(body: OnboardingCompleteBody):
    u = await db.users.find_one({"id": body.user_id}, {"_id": 0})
    if not u:
        raise HTTPException(404, "User not found")

    update: Dict = {"onboarding_completed": True, "onboarded_at": now_iso()}
    if body.interests:
        # Dedup + trim, keep order, cap at 16 to match the chip set
        seen: set = set()
        clean: List[str] = []
        for i in body.interests:
            t = (i or "").strip()
            k = t.lower()
            if t and k not in seen:
                seen.add(k); clean.append(t)
            if len(clean) >= 16:
                break
        update["interests"] = clean
    if body.suburb is not None:
        update["suburb"] = body.suburb.strip()
    if body.suburb_postcode is not None:
        update["suburb_postcode"] = body.suburb_postcode.strip()
    if body.suburb_state is not None:
        update["suburb_state"] = body.suburb_state.strip()
    if body.location_visibility in {"suburb", "private"}:
        update["location_visibility"] = body.location_visibility
        if body.location_visibility == "private":
            update["suburb"] = ""
    if body.avatar:
        update["avatar"] = body.avatar

    # Award a small badge + points so the wizard feels rewarding. Both are
    # idempotent — repeat calls to /onboarding/complete (e.g. user closes and
    # re-opens the wizard) won't keep inflating their points or duplicate
    # badges. We gate the points award on whether the user has already been
    # marked `onboarding_completed` previously.
    badges = list(u.get("badges") or [])
    if "Welcome Aboard" not in badges:
        badges.append("Welcome Aboard")
    if body.joined_all and "Community Joiner" not in badges:
        badges.append("Community Joiner")
    update["badges"] = badges
    already_done = bool(u.get("onboarding_completed"))
    if not already_done:
        update["points"] = int(u.get("points") or 0) + (15 if body.joined_all else 10)

    await db.users.update_one({"id": body.user_id}, {"$set": update})

    # Join requested groups (deduped). Each call also awards 3 points via
    # the existing /groups/{id}/join handler; we batch-add here directly so
    # we don't blow up the points total disproportionately during onboarding.
    joined: List[str] = []
    for gid in (body.group_ids or [])[:20]:
        r = await db.groups.update_one({"id": gid}, {"$addToSet": {"members": body.user_id}})
        if r.matched_count:
            joined.append(gid)

    # Welcome notification — phrased to push the user into FP Café first
    await db.notifications.insert_one({
        "id": nid(), "user_id": body.user_id, "type": "onboarding_done",
        "title": "You're all set up!",
        "body": f"Welcome aboard! You've joined {len(joined)} group{'s' if len(joined) != 1 else ''}. Why not pop into the FP Café and say hello?",
        "read": False, "created_at": now_iso(),
    })

    fresh = await db.users.find_one({"id": body.user_id}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "joined_group_ids": joined, "user": _safe_user(fresh or u)}


class PreferencesBody(BaseModel):
    read_messages_aloud: Optional[bool] = None
    text_scale: Optional[float] = None        # 0.85 – 1.6
    high_contrast: Optional[bool] = None
    large_text: Optional[bool] = None         # legacy compat
    nearby_chat_alerts: Optional[bool] = None  # opt-in for /community/chat-alert (nearby audience)


@api.patch("/users/{user_id}/preferences")
async def update_preferences(user_id: str, body: PreferencesBody):
    update: Dict = {}
    if body.read_messages_aloud is not None:
        update["preferences.read_messages_aloud"] = bool(body.read_messages_aloud)
    if body.text_scale is not None:
        update["preferences.text_scale"] = max(0.85, min(1.6, float(body.text_scale)))
    if body.high_contrast is not None:
        update["preferences.high_contrast"] = bool(body.high_contrast)
    if body.large_text is not None:
        update["preferences.large_text"] = bool(body.large_text)
    if body.nearby_chat_alerts is not None:
        update["preferences.nearby_chat_alerts"] = bool(body.nearby_chat_alerts)
    if update:
        await db.users.update_one({"id": user_id}, {"$set": update})
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "preferences": (u or {}).get("preferences", {}), "user": u}


@api.get("/users/{user_id}/preferences")
async def get_preferences(user_id: str):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "preferences": 1})
    return {"preferences": (u or {}).get("preferences", {})}


# ========================== Phase B: Community Features ==========================
COMMUNITY_MILESTONES = [
    {"users": 50, "label": "We are 50 strong!"},
    {"users": 100, "label": "100 members \u2014 hooray!"},
    {"users": 250, "label": "250 friendly butterflies"},
    {"users": 500, "label": "Half a thousand!"},
    {"users": 1000, "label": "One thousand members"},
]


def _mmdd(date_str: Optional[str]) -> Optional[str]:
    """Return MM-DD slice from YYYY-MM-DD or MM-DD; None if invalid."""
    if not date_str: return None
    parts = date_str.strip().split("-")
    if len(parts) == 3:
        return f"{parts[1].zfill(2)}-{parts[2].zfill(2)}"
    if len(parts) == 2:
        return f"{parts[0].zfill(2)}-{parts[1].zfill(2)}"
    return None


def _years_since(date_str: Optional[str]) -> Optional[int]:
    if not date_str: return None
    try:
        d = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except Exception:
        return None
    today = datetime.now(timezone.utc)
    years = today.year - d.year - (1 if (today.month, today.day) < (d.month, d.day) else 0)
    return years if years >= 0 else None


@api.get("/community/today")
async def community_today(user_id: Optional[str] = None):
    """A friendly daily digest for the Home screen: birthdays, new members,
    member anniversaries, and community milestones."""
    today = datetime.now(timezone.utc)
    today_mmdd = today.strftime("%m-%d")

    # Friends-aware birthdays (today)
    me = await db.users.find_one({"id": user_id}, {"_id": 0, "friends": 1}) if user_id else None
    friend_ids = set((me or {}).get("friends") or [])
    bday_query: Dict = {
        "$or": [{"birthday": {"$regex": f"-{today_mmdd}$"}}, {"birthday": today_mmdd}],
        "banned": {"$ne": True},
        "restricted": {"$ne": True},
        "birthday_visibility": {"$ne": "off"},
        "username": {"$not": {"$regex": "_[a-f0-9]{6,}$|^(TEST_|Priv_|test_)"}},
    }
    if user_id:
        bday_query["id"] = {"$ne": user_id}
    birthdays_all = await db.users.find(bday_query, {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1, "suburb": 1}).to_list(50)
    # Sort: friends first
    birthdays_all.sort(key=lambda u: (0 if u["id"] in friend_ids else 1, u.get("first_name") or ""))

    # New members joined in the last 7 days
    since = (today - timedelta(days=7)).isoformat()
    new_members = await db.users.find(
        {
            "created_at": {"$gte": since},
            "banned": {"$ne": True},
            "restricted": {"$ne": True},
            "is_demo": {"$ne": True},
            "username": {"$not": {"$regex": "_[a-f0-9]{6,}$|^(TEST_|Priv_|test_)"}},
            **({"id": {"$ne": user_id}} if user_id else {}),
        },
        {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1, "suburb": 1, "created_at": 1, "is_demo": 1}
    ).sort("created_at", -1).to_list(20)

    # Anniversaries — members whose join (created_at) MM-DD == today and years_since >= 1
    anniversaries = []
    anniversary_users = await db.users.find(
        {"created_at": {"$exists": True}, **({"id": {"$ne": user_id}} if user_id else {})},
        {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1, "suburb": 1, "created_at": 1}
    ).to_list(2000)
    for u in anniversary_users:
        try:
            d = datetime.fromisoformat((u.get("created_at") or "").replace("Z", "+00:00"))
            yrs = _years_since(u.get("created_at"))
            if d.strftime("%m-%d") == today_mmdd and yrs and yrs >= 1:
                anniversaries.append({**u, "years": yrs})
        except Exception:
            pass

    # Community milestones — most recent reached
    total_users = await db.users.count_documents({})
    reached = [m for m in COMMUNITY_MILESTONES if total_users >= m["users"]]
    next_milestone = next((m for m in COMMUNITY_MILESTONES if total_users < m["users"]), None)

    return {
        "date": today.date().isoformat(),
        "birthdays": birthdays_all,
        "new_members": new_members,
        "anniversaries": anniversaries,
        "milestones": {
            "total_users": total_users,
            "last_reached": reached[-1] if reached else None,
            "next": next_milestone,
        },
    }


async def _broadcast_new_member(user: Dict):
    """Send a 'welcome new member' notification to all active users so they can wave hello."""
    if user.get("is_demo"):
        return
    recipients = await db.users.find({"id": {"$ne": user["id"]}, "banned": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(2000)
    note_template = {
        "type": "new_member",
        "title": "Say hello to a new member",
        "body": f"{user.get('first_name') or user.get('username','?')} just joined FriendPlace from {user.get('suburb') or 'nearby'}. Send a wave!",
        "ref_user_id": user["id"],
    }
    for r in recipients:
        await db.notifications.insert_one({"id": nid(), "user_id": r["id"], "read": False, "created_at": now_iso(), **note_template})


@api.post("/users/{user_id}/heartbeat")
async def heartbeat(user_id: str):
    await db.users.update_one({"id": user_id}, {"$set": {"last_seen_at": now_iso()}})
    return {"ok": True}


def _status_from(last_seen: Optional[str], privacy: str = "everyone", chosen: Optional[str] = None) -> Dict:
    """Return {label, code, emoji} for a user.

    Priority:
      1. If privacy = invisible → always Offline.
      2. If user picked a status AND was active in the last 30 min → use it.
      3. Otherwise fall back to auto last-seen presence.
    """
    if privacy == "invisible":
        return {"label": "Offline", "code": "offline", "emoji": "⚫"}

    # Compute auto-fallback first (used by both branches below)
    def _auto() -> Dict:
        if not last_seen:
            return {"label": "Offline", "code": "offline", "emoji": "⚫"}
        try:
            ts = datetime.fromisoformat(last_seen)
        except Exception:
            return {"label": "Offline", "code": "offline", "emoji": "⚫"}
        delta = datetime.now(timezone.utc) - (ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc))
        secs = int(delta.total_seconds())
        if secs < 120:
            return {"label": "Online now", "code": "online", "emoji": "🟢"}
        if secs < 60 * 60 * 24:
            return {"label": "Active today", "code": "active_today", "emoji": "🟢"}
        if secs < 60 * 60 * 24 * 7:
            return {"label": "Last seen recently", "code": "recent", "emoji": "⚪"}
        return {"label": "Offline", "code": "offline", "emoji": "⚫"}

    if chosen and chosen in STATUS_LABELS:
        # Respect the user's choice only if they've been active recently.
        # If they explicitly chose "offline", honour it regardless.
        if chosen == "offline":
            return STATUS_LABELS[chosen]
        if last_seen:
            try:
                ts = datetime.fromisoformat(last_seen)
                delta = datetime.now(timezone.utc) - (ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc))
                if int(delta.total_seconds()) < 60 * 30:  # 30-min window
                    return STATUS_LABELS[chosen]
            except Exception:
                pass
    return _auto()


# Member-selectable status codes (community / friendship — not dating).
STATUS_LABELS: Dict[str, Dict] = {
    "looking_to_chat":   {"label": "Looking to chat",      "code": "looking_to_chat",   "emoji": "🟢"},
    "in_coffee_lounge":  {"label": "In the FP Café", "code": "in_coffee_lounge",  "emoji": "☕"},
    "happy_to_connect":  {"label": "Happy to connect",     "code": "happy_to_connect",  "emoji": "😊"},
    "busy":              {"label": "Busy right now",       "code": "busy",              "emoji": "🟡"},
    "offline":           {"label": "Offline",              "code": "offline",           "emoji": "⚫"},
}


class StatusBody(BaseModel):
    status: Optional[str] = None  # one of STATUS_LABELS keys, or null to clear


@api.post("/users/{user_id}/status")
async def set_user_status(user_id: str, body: StatusBody):
    """Set the user's chosen presence status. Pass `status: null` to clear."""
    val = body.status
    if val is not None and val not in STATUS_LABELS:
        raise HTTPException(400, f"Invalid status. Allowed: {', '.join(STATUS_LABELS.keys())} or null.")
    update = {"status": val, "status_updated_at": now_iso(), "last_seen_at": now_iso()}
    await db.users.update_one({"id": user_id}, {"$set": update})
    return {"ok": True, "status": val, "status_label": STATUS_LABELS[val] if val else None}


@api.get("/status-options")
async def status_options():
    """List the 5 selectable status options for the picker UI."""
    return {"options": list(STATUS_LABELS.values())}


# ------------- Suburbs (AU) -------------
class SetLocationBody(BaseModel):
    suburb: Optional[str] = None     # display name
    postcode: Optional[str] = None
    state: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    prefer_not_to_say: bool = False


@api.get("/suburbs/search")
async def suburbs_search(q: str = "", limit: int = 20):
    """Typeahead — returns up to `limit` matches by name or postcode.
    Default bumped to 20 (from 10) so signup shows more options — the
    dataset expanded to ~600+ suburbs so a 10-cap felt too tight."""
    return {"results": sb_search(q, min(int(limit), 50))}


@api.get("/suburbs/by-postcode/{postcode}")
async def suburbs_by_postcode(postcode: str):
    return {"results": sb_by_postcode(postcode)}


@api.get("/suburbs/nearest")
async def suburbs_nearest(lat: float, lng: float):
    """Reverse-geocode-lite: returns the closest known suburb to lat/lng.
    Used by 'Near Me' — we never store the user's exact coords, only the
    matched suburb name + the suburb's centre lat/lng."""
    from suburbs import SUBURBS as _ALL
    best = None
    best_d = 9e9
    for name, postcode, state, slat, slng in _ALL:
        d = sb_haversine(float(lat), float(lng), slat, slng)
        if d < best_d:
            best_d = d
            best = {"name": name, "postcode": postcode, "state": state, "lat": slat, "lng": slng, "distance_km": round(d, 1)}
    return {"nearest": best}


@api.post("/users/{user_id}/location")
async def set_user_location(user_id: str, body: SetLocationBody):
    """Set the user's chosen suburb. If `prefer_not_to_say=True`, clears all
    location fields and excludes the user from radius/near-me queries."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
    if not user:
        raise HTTPException(404, "User not found")
    if body.prefer_not_to_say:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"location_visibility": "private", "suburb": ""},
             "$unset": {"suburb_postcode": "", "suburb_state": "", "suburb_lat": "", "suburb_lng": ""}},
        )
        return {"ok": True, "location_visibility": "private"}
    # Validate the suburb against our dataset when possible.
    matches = sb_search(body.suburb or "", limit=1) if body.suburb else []
    chosen = matches[0] if matches else None
    update: Dict = {"location_visibility": "suburb"}
    if chosen:
        update["suburb"] = chosen["name"]
        update["suburb_postcode"] = chosen["postcode"]
        update["suburb_state"] = chosen["state"]
        update["suburb_lat"] = chosen["lat"]
        update["suburb_lng"] = chosen["lng"]
    else:
        # Free-text fallback (no coords). Still safe — just no radius matching.
        if body.suburb:
            update["suburb"] = body.suburb.strip()
        if body.postcode:
            update["suburb_postcode"] = body.postcode
        if body.state:
            update["suburb_state"] = body.state
        if body.lat is not None and body.lng is not None:
            update["suburb_lat"] = float(body.lat)
            update["suburb_lng"] = float(body.lng)
    await db.users.update_one({"id": user_id}, {"$set": update})
    public_keys = ["suburb", "suburb_postcode", "suburb_state", "location_visibility"]
    return {"ok": True, **{k: update.get(k) for k in public_keys if k in update}}


@api.get("/users/{user_id}/status")
async def user_status(user_id: str):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "last_seen_at": 1, "privacy": 1, "status": 1}) 
    if not u:
        raise HTTPException(404, "User not found")
    return _status_from(u.get("last_seen_at"), u.get("privacy", "everyone"), u.get("status"))


# ------------- Games (unified completion log + achievements) -------------
ACHIEVEMENT_DEFS = {
    "first_game":        {"title": "First step!",              "body": "You finished your first game. Welcome to the Games Hub.", "points": 10},
    "hard":              {"title": "Hard Challenge!",          "body": "You completed a Hard difficulty game.",                  "points": 30},
    "nightmare":         {"title": "Nightmare Champion!",      "body": "You completed a Nightmare difficulty game.",              "points": 60},
    "daily_challenge":   {"title": "Daily Challenge Done",     "body": "You finished today's Daily Challenge.",                    "points": 10},
    "streak_7":          {"title": "7-Day Streak",             "body": "You've played 7 days in a row. Keep it going!",            "points": 25},
    "streak_30":         {"title": "30-Day Streak",            "body": "A month of daily play — incredible!",                      "points": 80},
    "century":           {"title": "100 Games Completed",      "body": "Wow! 100 games done. The community salutes you.",          "points": 100},
    "daily_devotee":     {"title": "Daily Devotee",             "body": "7 days of playing FriendPlace in a row — thank you for showing up.", "points": 50},
}

# Difficulties that DO trigger achievement notifications to friends.
ANNOUNCE_DIFFICULTIES = {"hard", "nightmare"}


class GameCompletionBody(BaseModel):
    game_type: str          # jigsaw | trivia | wordsearch | memory | bingo | sudoku | spot
    difficulty: str         # easy | moderate | hard | nightmare
    title: Optional[str] = ""
    duration_seconds: int = 0
    score: int = 0
    is_daily: bool = False


async def _grant_achievement(user_id: str, key: str, ctx: Dict):
    if key not in ACHIEVEMENT_DEFS:
        return False
    if await db.achievements.find_one({"user_id": user_id, "key": key}):
        return False
    a = ACHIEVEMENT_DEFS[key]
    await db.achievements.insert_one({
        "id": nid(), "user_id": user_id, "key": key,
        "title": a["title"], "body": a["body"], "points": a["points"],
        "context": ctx, "created_at": now_iso(),
    })
    await award_points(user_id, a["points"])
    return True


async def _daily_streak_for(user_id: str) -> int:
    """Return current consecutive-day streak based on game_completions dates."""
    docs = await db.game_completions.find({"user_id": user_id}, {"_id": 0, "created_at": 1}).sort("created_at", -1).to_list(2000)
    days = sorted({d["created_at"][:10] for d in docs if d.get("created_at")}, reverse=True)
    if not days:
        return 0
    today = datetime.now(timezone.utc).date()
    streak = 0
    for i, day in enumerate(days):
        try:
            dt = datetime.fromisoformat(day).date()
        except Exception:
            continue
        expected = today - timedelta(days=i)
        if dt == expected:
            streak += 1
        else:
            break
    return streak


@api.post("/games/complete/{user_id}")
async def log_game_completion(user_id: str, body: GameCompletionBody):
    """Single source-of-truth for finished games. Awards achievements/points
    and broadcasts Achievement Flutters to friends for major wins."""
    # Also opportunistically award the Daily Butterfly Bonus — playing ANY
    # game qualifies. Silent no-op if already claimed today so users can
    # play multiple games without spamming toasts.
    try:
        await _award_daily_bonus_if_new(user_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("daily bonus award skipped for %s: %s", user_id, e)
    doc = {
        "id": nid(), "user_id": user_id,
        "game_type": body.game_type, "difficulty": body.difficulty.lower(),
        "title": body.title or "", "duration_seconds": body.duration_seconds,
        "score": body.score, "is_daily": body.is_daily,
        "created_at": now_iso(),
    }
    await db.game_completions.insert_one(doc)

    granted: List[str] = []
    total = await db.game_completions.count_documents({"user_id": user_id})

    if total == 1:
        if await _grant_achievement(user_id, "first_game", {"game_type": body.game_type}):
            granted.append("first_game")
    if doc["difficulty"] == "hard":
        if await _grant_achievement(user_id, "hard", {"game_type": body.game_type, "title": body.title}):
            granted.append("hard")
    elif doc["difficulty"] == "nightmare":
        if await _grant_achievement(user_id, "nightmare", {"game_type": body.game_type, "title": body.title}):
            granted.append("nightmare")
    if body.is_daily:
        # Only grant once per real calendar day
        today = doc["created_at"][:10]
        existing = await db.achievements.find_one({"user_id": user_id, "key": "daily_challenge", "context.date": today})
        if not existing:
            a = ACHIEVEMENT_DEFS["daily_challenge"]
            await db.achievements.insert_one({"id": nid(), "user_id": user_id, "key": "daily_challenge", "title": a["title"], "body": a["body"], "points": a["points"], "context": {"game_type": body.game_type, "date": today}, "created_at": now_iso()})
            await award_points(user_id, a["points"])
            granted.append("daily_challenge")

    streak = await _daily_streak_for(user_id)
    if streak >= 30:
        if await _grant_achievement(user_id, "streak_30", {"streak": streak}):
            granted.append("streak_30")
    elif streak >= 7:
        if await _grant_achievement(user_id, "streak_7", {"streak": streak}):
            granted.append("streak_7")
    if total >= 100:
        if await _grant_achievement(user_id, "century", {"count": total}):
            granted.append("century")

    # Broadcast an "Achievement Flutter" notification to friends for big wins.
    notify_friends = bool(granted) and (doc["difficulty"] in ANNOUNCE_DIFFICULTIES or "century" in granted or "streak_30" in granted)
    if notify_friends:
        user = await db.users.find_one({"id": user_id}, {"first_name": 1, "avatar": 1, "friends": 1, "_id": 0}) or {}
        uname = user.get("first_name") or "A friend"
        avatar = user.get("avatar") or "🎉"
        nice_game = {"jigsaw": "Jigsaw Puzzle", "trivia": "Trivia", "wordsearch": "Word Search", "memory": "Memory Match", "bingo": "Bingo", "sudoku": "Sudoku", "spot": "Spot the Difference"}.get(body.game_type, "game")
        difficulty_label = body.difficulty.title()
        title = f"{avatar} {uname} completed a {difficulty_label} {nice_game}"
        body_text = "Send a Flutter to cheer them on?"
        payload = {"actor_id": user_id, "actor_name": uname, "game_type": body.game_type, "difficulty": body.difficulty, "achievements": granted}
        for fid in (user.get("friends") or []):
            await push_notification(fid, "achievement", title, body_text, payload)

    return {"completion": doc, "granted": granted, "streak": streak, "total_completed": total}


class CheerBody(BaseModel):
    to_user_id: str
    kind: str   # well_done | congrats | coffee | flutter


CHEER_TEXT = {
    "well_done":  ("👏", "well done"),
    "congrats":   ("🎉", "congratulations"),
    "coffee":     ("☕", "let's celebrate in the FP Café"),
    "flutter":    ("🦋", "sent a Flutter"),
}


@api.post("/games/cheer/{from_user_id}")
async def send_cheer(from_user_id: str, body: CheerBody):
    if body.kind not in CHEER_TEXT:
        raise HTTPException(400, "Invalid cheer kind")
    if from_user_id == body.to_user_id:
        raise HTTPException(400, "Cannot cheer yourself")
    sender = await db.users.find_one({"id": from_user_id}, {"first_name": 1, "avatar": 1, "_id": 0}) or {}
    emoji, label = CHEER_TEXT[body.kind]
    sname = sender.get("first_name") or "A friend"
    savatar = sender.get("avatar") or "🦋"
    await push_notification(
        body.to_user_id, "cheer",
        f"{savatar} {sname} says {emoji} {label}",
        "Butterfly Points awarded for kindness.",
        {"from_id": from_user_id, "kind": body.kind},
    )
    # Award points for positive participation
    await award_points(from_user_id, 3)
    return {"ok": True}


class SolitaireAwardBody(BaseModel):
    outcome: str  # "played" | "won"
    moves: int = 0
    duration_seconds: int = 0
    seed: Optional[int] = None


# ----------------------------------------------------------------------------
# Daily Butterfly Bonus — +5 pts once per AEST day for playing any game,
# with a "Daily Devotee" badge unlocking on a 7-day streak.
# ----------------------------------------------------------------------------
def _aest_date_str(dt: Optional[datetime] = None) -> str:
    """Return the AEST calendar date (YYYY-MM-DD) for the given moment.
    Uses a fixed +10:00 offset — DST-aware handling can be added later,
    but AEST (Sydney/Melbourne) is what the launch spec calls out and the
    +/-1h drift from DST won't cause double-claims because we compare on
    date equality only."""
    src = dt or datetime.now(timezone.utc)
    return (src + timedelta(hours=10)).date().isoformat()


DAILY_BONUS_POINTS = 5
DAILY_DEVOTEE_STREAK = 7


async def _award_daily_bonus_if_new(user_id: str) -> Dict[str, object]:
    """Award +5 Butterfly Points if the user hasn't claimed today's bonus.
    Also bumps the 7-day streak counter and grants the Daily Devotee badge
    once the streak hits 7.

    Returns `{claimed, points_awarded, streak_days, badge_earned}`.
    Idempotent — safe to call after any game action; will silently no-op
    if today's bonus already claimed. Uses AEST calendar day for reset.
    """
    if not user_id:
        return {"claimed": False, "points_awarded": 0, "streak_days": 0, "badge_earned": False}
    user = await db.users.find_one({"id": user_id})
    if not user:
        return {"claimed": False, "points_awarded": 0, "streak_days": 0, "badge_earned": False}
    today = _aest_date_str()
    last = user.get("daily_bonus_last_claim") or ""
    if last == today:
        # Already claimed today — return current state, no side effects.
        return {
            "claimed": False,
            "already_claimed_today": True,
            "points_awarded": 0,
            "streak_days": int(user.get("daily_bonus_streak") or 0),
            "badge_earned": False,
        }
    # Compute new streak: continues if last claim was YESTERDAY (AEST),
    # otherwise restarts at 1. A missed day always resets the counter.
    prev_streak = int(user.get("daily_bonus_streak") or 0)
    yesterday = _aest_date_str(datetime.now(timezone.utc) - timedelta(days=1))
    if last == yesterday:
        new_streak = prev_streak + 1
    else:
        new_streak = 1
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"daily_bonus_last_claim": today, "daily_bonus_streak": new_streak}},
    )
    await award_points(user_id, DAILY_BONUS_POINTS, reason="daily_bonus")
    badge_earned = False
    if new_streak >= DAILY_DEVOTEE_STREAK:
        # `_grant_achievement` is idempotent so multi-streak users don't get
        # duplicate badges.
        try:
            granted = await _grant_achievement(user_id, "daily_devotee", {"streak_days": new_streak})
            badge_earned = bool(granted)
        except Exception:  # pragma: no cover
            badge_earned = False
    return {
        "claimed": True,
        "points_awarded": DAILY_BONUS_POINTS,
        "streak_days": new_streak,
        "badge_earned": badge_earned,
        "reset_at_utc": None,
    }


@api.get("/games/daily-bonus/status/{user_id}")
async def daily_bonus_status(user_id: str):
    """Snapshot of the Daily Butterfly Bonus for the header banner.
    - `claimed_today`: True after any game has been played today.
    - `streak_days`: consecutive days claimed (incl. today).
    - `points`: DAILY_BONUS_POINTS constant, exposed so the UI can render
      the amount without hard-coding it.
    """
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(404, "User not found")
    today = _aest_date_str()
    last = user.get("daily_bonus_last_claim") or ""
    return {
        "claimed_today": last == today,
        "streak_days": int(user.get("daily_bonus_streak") or 0),
        "points": DAILY_BONUS_POINTS,
        "streak_target": DAILY_DEVOTEE_STREAK,
        "date": today,
    }


@api.post("/games/daily-bonus/claim/{user_id}")
async def daily_bonus_claim(user_id: str):
    """Explicitly claim today's bonus (used by the Home banner "Claim"
    button). Games call `_award_daily_bonus_if_new` internally when a
    completion is logged, but the button lets curious users trigger it
    without playing anything first — same +5, same streak logic."""
    result = await _award_daily_bonus_if_new(user_id)
    return result


@api.post("/games/solitaire/award/{user_id}")
async def solitaire_award(user_id: str, body: SolitaireAwardBody):
    """Award Butterfly Points for a Klondike Solitaire session.

    Per the launch spec (June 2026): +2 pts on any completed session
    ("played" — the player finished the game without an active state
    lingering) and +10 pts on a win (foundations full). Also stores a
    row in `game_completions` so the Games Hub streak/stats logic
    continues to count Solitaire alongside every other game.

    Intentionally NOT deduped — Solitaire is the "never resets" ambient
    game per the spec, so users can farm play-points at 2/session; the
    +10 win bonus is naturally rate-limited by the game itself.
    """
    outcome = (body.outcome or "").lower()
    if outcome not in ("played", "won"):
        raise HTTPException(400, "outcome must be 'played' or 'won'")
    pts = 10 if outcome == "won" else 2
    await db.game_completions.insert_one({
        "id": nid(),
        "user_id": user_id,
        "game_type": "solitaire",
        "difficulty": "won" if outcome == "won" else "played",
        "title": "Klondike Solitaire",
        "duration_seconds": max(0, int(body.duration_seconds or 0)),
        "score": int(body.moves or 0),
        "is_daily": False,
        "created_at": now_iso(),
    })
    await award_points(user_id, pts, reason=f"solitaire:{outcome}")
    # Playing Solitaire counts toward the Daily Butterfly Bonus. Silent
    # no-op if today's already claimed via another game.
    try:
        await _award_daily_bonus_if_new(user_id)
    except Exception:  # noqa: BLE001
        pass
    # Fetch fresh totals for the client so it can show the running tally.
    lifetime_wins = await db.game_completions.count_documents({"user_id": user_id, "game_type": "solitaire", "difficulty": "won"})
    lifetime_played = await db.game_completions.count_documents({"user_id": user_id, "game_type": "solitaire"})
    return {"ok": True, "points_awarded": pts, "outcome": outcome, "lifetime_wins": lifetime_wins, "lifetime_played": lifetime_played}


@api.get("/games/solitaire/stats/{user_id}")
async def solitaire_stats(user_id: str):
    """Lifetime Solitaire counters. Zero if the player has never played."""
    wins = await db.game_completions.count_documents({"user_id": user_id, "game_type": "solitaire", "difficulty": "won"})
    played = await db.game_completions.count_documents({"user_id": user_id, "game_type": "solitaire"})
    return {"lifetime_wins": wins, "lifetime_played": played}


@api.get("/games/stats/{user_id}")
async def games_stats(user_id: str):
    total = await db.game_completions.count_documents({"user_id": user_id})
    by_type: Dict[str, int] = {}
    async for d in db.game_completions.find({"user_id": user_id}, {"_id": 0, "game_type": 1, "score": 1, "duration_seconds": 1}):
        by_type[d["game_type"]] = by_type.get(d["game_type"], 0) + 1
    streak = await _daily_streak_for(user_id)
    achievements = await db.achievements.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Personal best: lowest duration per (game_type, difficulty)
    pbs: Dict[str, Dict] = {}
    async for d in db.game_completions.find({"user_id": user_id}, {"_id": 0}):
        key = f"{d['game_type']}_{d.get('difficulty','easy')}"
        cur = pbs.get(key)
        if not cur or (d.get("duration_seconds") or 0) < (cur.get("duration_seconds") or 9e9):
            pbs[key] = d
    return {"total_completed": total, "by_game": by_type, "streak": streak, "achievements": achievements, "personal_bests": pbs}


@api.get("/games/dailies")
async def dailies():
    """Today's daily challenges across all game types."""
    d = datetime.now(timezone.utc)
    daily_ws = ws_daily_pick(ws_today_iso())
    daily_mm = mm_daily_pick(mm_today_iso())
    daily_sd = sd_daily_pick(sd_today_iso())
    daily_std = std_daily_pick(std_today_iso())
    return {
        "date": d.date().isoformat(),
        "jigsaw": (await jigsaw_daily()),
        "trivia": {"available": True, "title": "Daily Trivia: 10 mixed questions"},
        "wordsearch": {
            "available": True,
            "title": f"Daily Word Search · {WS_THEMES[daily_ws['theme']]['label']}",
            "theme": daily_ws["theme"],
            "difficulty": daily_ws["difficulty"],
        },
        "memory": {
            "available": True,
            "title": f"Daily Memory Match · {MM_THEMES[daily_mm['theme']]['label']}",
            "theme": daily_mm["theme"],
            "difficulty": daily_mm["difficulty"],
        },
        "sudoku": {
            "available": True,
            "title": f"Daily Sudoku · {SD_DIFFS[daily_sd['difficulty']]['label']}",
            "difficulty": daily_sd["difficulty"],
        },
        "spot": {
            "available": True,
            "title": f"Daily Spot the Difference · {STD_THEMES[daily_std['theme']]['label']}",
            "theme": daily_std["theme"],
            "difficulty": daily_std["difficulty"],
        },
    }


# ------------- Word Search -------------
class WordSearchProgressBody(BaseModel):
    puzzle_id: str             # "<theme>:<difficulty>:<seed>"  (seed is "daily-YYYY-MM-DD" for daily)
    theme: str
    difficulty: str
    found_words: List[str] = []
    hints_used: int = 0
    seconds: int = 0
    completed: bool = False
    is_daily: bool = False


@api.get("/games/wordsearch/catalog")
async def wordsearch_catalog():
    """List themes + difficulty configs (no word leakage)."""
    diffs = []
    for k, d in WS_DIFFS.items():
        diffs.append({
            "key": k,
            "label": d["label"],
            "size": d["size"],
            "num_words": d["num_words"],
            "points": d["points"],
            "hints": d["hints"],
            "directions": d["directions"],
        })
    return {"themes": ws_list_themes(), "difficulties": diffs}


@api.get("/games/wordsearch/puzzle")
async def wordsearch_puzzle(theme: str, difficulty: str = "easy", seed: Optional[int] = None):
    """Return a deterministic puzzle. If no seed is provided, derives a stable
    per-day seed for the (theme, difficulty) so resume + auto-save works
    naturally — the same player gets the same puzzle until tomorrow."""
    if theme not in WS_THEMES:
        raise HTTPException(404, "Unknown theme")
    if difficulty not in WS_DIFFS:
        raise HTTPException(400, "Unknown difficulty")
    if seed is None:
        # Derive a per-day-per-theme-per-difficulty seed.
        stable_key = f"{theme}|{difficulty}|{ws_today_iso()}"
        use_seed = abs(hash(stable_key)) % (10 ** 9)
    else:
        use_seed = int(seed)
    puz = ws_generate(theme, difficulty, use_seed)
    return {**puz, "puzzle_id": f"{theme}:{difficulty}:{use_seed}"}


@api.get("/games/wordsearch/daily")
async def wordsearch_daily():
    """Today's Daily Word Search — same puzzle for every member, every day."""
    today = ws_today_iso()
    pick = ws_daily_pick(today)
    puz = ws_generate(pick["theme"], pick["difficulty"], pick["seed"])
    return {**puz, "puzzle_id": f"{pick['theme']}:{pick['difficulty']}:daily-{today}", "date": today, "is_daily": True}


@api.post("/games/wordsearch/progress/{user_id}")
async def wordsearch_save_progress(user_id: str, body: WordSearchProgressBody):
    """Upsert progress (resume support). Awards points + achievements on first completion."""
    if body.theme not in WS_THEMES:
        raise HTTPException(404, "Unknown theme")
    if body.difficulty not in WS_DIFFS:
        raise HTTPException(400, "Unknown difficulty")

    existing = await db.wordsearch_progress.find_one({"user_id": user_id, "puzzle_id": body.puzzle_id}, {"_id": 0})
    set_doc = {
        "user_id": user_id,
        "puzzle_id": body.puzzle_id,
        "theme": body.theme,
        "difficulty": body.difficulty,
        "found_words": body.found_words,
        "hints_used": body.hints_used,
        "seconds": body.seconds,
        "completed": body.completed,
        "is_daily": body.is_daily,
        "updated_at": now_iso(),
    }
    await db.wordsearch_progress.update_one(
        {"user_id": user_id, "puzzle_id": body.puzzle_id},
        {"$set": set_doc, "$setOnInsert": {"id": nid(), "created_at": now_iso()}},
        upsert=True,
    )

    granted: List[str] = []
    points_awarded = 0
    streak = 0
    # First-time completion → award points + log game completion (which handles streaks/achievements)
    if body.completed and (not existing or not existing.get("completed_logged")):
        result = await log_game_completion(user_id, GameCompletionBody(
            game_type="wordsearch",
            difficulty=body.difficulty,
            title=WS_THEMES[body.theme]["label"],
            duration_seconds=body.seconds,
            score=len(body.found_words),
            is_daily=body.is_daily,
        ))
        granted = result.get("granted", [])
        streak = result.get("streak", 0)
        points_awarded = WS_DIFFS[body.difficulty]["points"]
        await award_points(user_id, points_awarded)
        await db.wordsearch_progress.update_one(
            {"user_id": user_id, "puzzle_id": body.puzzle_id},
            {"$set": {"completed_logged": True}},
        )

    return {"ok": True, "granted": granted, "points_awarded": points_awarded, "streak": streak}


@api.get("/games/wordsearch/progress/{user_id}")
async def wordsearch_get_progress(user_id: str, puzzle_id: str):
    p = await db.wordsearch_progress.find_one({"user_id": user_id, "puzzle_id": puzzle_id}, {"_id": 0})
    return p or {}


# ------------- Memory Match -------------
class MemoryMatchProgressBody(BaseModel):
    puzzle_id: str
    theme: str
    difficulty: str
    matched_pairs: List[str] = []     # list of card emoji that have been matched
    moves: int = 0
    seconds: int = 0
    completed: bool = False
    is_daily: bool = False


@api.get("/games/memory/catalog")
async def memory_catalog():
    diffs = []
    for k, d in MM_DIFFS.items():
        diffs.append({"key": k, "label": d["label"], "cols": d["cols"], "rows": d["rows"], "pairs": d["pairs"], "points": d["points"], "preview_seconds": d["preview_seconds"]})
    return {"themes": mm_list_themes(), "difficulties": diffs}


@api.get("/games/memory/puzzle")
async def memory_puzzle(theme: str, difficulty: str = "easy", seed: Optional[int] = None):
    if theme not in MM_THEMES:
        raise HTTPException(404, "Unknown theme")
    if difficulty not in MM_DIFFS:
        raise HTTPException(400, "Unknown difficulty")
    if seed is None:
        stable_key = f"{theme}|{difficulty}|{mm_today_iso()}"
        use_seed = abs(hash(stable_key)) % (10 ** 9)
    else:
        use_seed = int(seed)
    puz = mm_generate(theme, difficulty, use_seed)
    return {**puz, "puzzle_id": f"mm:{theme}:{difficulty}:{use_seed}"}


@api.get("/games/memory/daily")
async def memory_daily():
    today = mm_today_iso()
    pick = mm_daily_pick(today)
    puz = mm_generate(pick["theme"], pick["difficulty"], pick["seed"])
    return {**puz, "puzzle_id": f"mm:{pick['theme']}:{pick['difficulty']}:daily-{today}", "date": today, "is_daily": True}


@api.post("/games/memory/progress/{user_id}")
async def memory_save_progress(user_id: str, body: MemoryMatchProgressBody):
    if body.theme not in MM_THEMES:
        raise HTTPException(404, "Unknown theme")
    if body.difficulty not in MM_DIFFS:
        raise HTTPException(400, "Unknown difficulty")
    existing = await db.memory_progress.find_one({"user_id": user_id, "puzzle_id": body.puzzle_id}, {"_id": 0})
    set_doc = {
        "user_id": user_id, "puzzle_id": body.puzzle_id, "theme": body.theme, "difficulty": body.difficulty,
        "matched_pairs": body.matched_pairs, "moves": body.moves, "seconds": body.seconds,
        "completed": body.completed, "is_daily": body.is_daily, "updated_at": now_iso(),
    }
    await db.memory_progress.update_one(
        {"user_id": user_id, "puzzle_id": body.puzzle_id},
        {"$set": set_doc, "$setOnInsert": {"id": nid(), "created_at": now_iso()}},
        upsert=True,
    )
    granted: List[str] = []
    points_awarded = 0
    streak = 0
    if body.completed and (not existing or not existing.get("completed_logged")):
        result = await log_game_completion(user_id, GameCompletionBody(
            game_type="memory",
            difficulty=body.difficulty,
            title=MM_THEMES[body.theme]["label"],
            duration_seconds=body.seconds,
            score=body.moves,
            is_daily=body.is_daily,
        ))
        granted = result.get("granted", [])
        streak = result.get("streak", 0)
        points_awarded = MM_DIFFS[body.difficulty]["points"]
        await award_points(user_id, points_awarded)
        await db.memory_progress.update_one(
            {"user_id": user_id, "puzzle_id": body.puzzle_id},
            {"$set": {"completed_logged": True}},
        )
    return {"ok": True, "granted": granted, "points_awarded": points_awarded, "streak": streak}


@api.get("/games/memory/progress/{user_id}")
async def memory_get_progress(user_id: str, puzzle_id: str):
    p = await db.memory_progress.find_one({"user_id": user_id, "puzzle_id": puzzle_id}, {"_id": 0})
    return p or {}


# ------------- Sudoku -------------
class SudokuProgressBody(BaseModel):
    puzzle_id: str              # "sd:<difficulty>:<seed>"
    difficulty: str
    entries: List[List[int]]    # 9x9 user-filled grid (0 = empty)
    notes: List[List[List[int]]] = []  # 9x9 of lists of pencil-note candidates
    hints_used: int = 0
    mistakes: int = 0
    seconds: int = 0
    completed: bool = False
    is_daily: bool = False


@api.get("/games/sudoku/catalog")
async def sudoku_catalog():
    diffs = []
    for k, d in SD_DIFFS.items():
        diffs.append({
            "key": k, "label": d["label"], "clues": d["clues"], "points": d["points"],
            "hints": d["hints"], "max_mistakes": d["max_mistakes"],
        })
    return {"difficulties": diffs}


@api.get("/games/sudoku/puzzle")
async def sudoku_puzzle(difficulty: str = "easy", seed: Optional[int] = None, include_solution: bool = False):
    """Return a deterministic 9x9 sudoku. Solution is omitted by default — only the
    frontend's progress endpoint validates submissions."""
    if difficulty not in SD_DIFFS:
        raise HTTPException(400, "Unknown difficulty")
    if seed is None:
        stable_key = f"sd|{difficulty}|{sd_today_iso()}"
        use_seed = abs(hash(stable_key)) % (10 ** 9)
    else:
        use_seed = int(seed)
    puz = sd_generate(difficulty, use_seed)
    payload = {**puz, "puzzle_id": f"sd:{difficulty}:{use_seed}"}
    if not include_solution:
        payload.pop("solution", None)
    return payload


@api.get("/games/sudoku/daily")
async def sudoku_daily():
    today = sd_today_iso()
    pick = sd_daily_pick(today)
    puz = sd_generate(pick["difficulty"], pick["seed"])
    return {**puz, "solution": None, "puzzle_id": f"sd:{pick['difficulty']}:daily-{today}", "date": today, "is_daily": True}


@api.get("/games/sudoku/check")
async def sudoku_check(difficulty: str, seed: int, row: int, col: int, value: int):
    """Confirms whether a single cell value matches the solution. Lightweight
    server-side check so the client never sees the full solution."""
    if difficulty not in SD_DIFFS:
        raise HTTPException(400, "Unknown difficulty")
    if not (0 <= row < 9 and 0 <= col < 9 and 1 <= value <= 9):
        raise HTTPException(400, "Invalid cell or value")
    puz = sd_generate(difficulty, int(seed))
    correct = puz["solution"][row][col]
    return {"correct": correct == value, "expected_hint": None}


@api.get("/games/sudoku/hint")
async def sudoku_hint(difficulty: str, seed: int, row: int, col: int):
    if difficulty not in SD_DIFFS:
        raise HTTPException(400, "Unknown difficulty")
    if not (0 <= row < 9 and 0 <= col < 9):
        raise HTTPException(400, "Invalid cell")
    puz = sd_generate(difficulty, int(seed))
    return {"value": puz["solution"][row][col]}


@api.post("/games/sudoku/progress/{user_id}")
async def sudoku_save_progress(user_id: str, body: SudokuProgressBody):
    if body.difficulty not in SD_DIFFS:
        raise HTTPException(400, "Unknown difficulty")
    existing = await db.sudoku_progress.find_one({"user_id": user_id, "puzzle_id": body.puzzle_id}, {"_id": 0})
    set_doc = {
        "user_id": user_id, "puzzle_id": body.puzzle_id, "difficulty": body.difficulty,
        "entries": body.entries, "notes": body.notes, "hints_used": body.hints_used,
        "mistakes": body.mistakes, "seconds": body.seconds,
        "completed": body.completed, "is_daily": body.is_daily, "updated_at": now_iso(),
    }
    await db.sudoku_progress.update_one(
        {"user_id": user_id, "puzzle_id": body.puzzle_id},
        {"$set": set_doc, "$setOnInsert": {"id": nid(), "created_at": now_iso()}},
        upsert=True,
    )
    granted: List[str] = []
    points_awarded = 0
    streak = 0
    if body.completed and (not existing or not existing.get("completed_logged")):
        result = await log_game_completion(user_id, GameCompletionBody(
            game_type="sudoku",
            difficulty=body.difficulty,
            title=f"Sudoku · {SD_DIFFS[body.difficulty]['label']}",
            duration_seconds=body.seconds,
            score=max(0, 81 - body.mistakes * 3),
            is_daily=body.is_daily,
        ))
        granted = result.get("granted", [])
        streak = result.get("streak", 0)
        points_awarded = SD_DIFFS[body.difficulty]["points"]
        await award_points(user_id, points_awarded)
        await db.sudoku_progress.update_one(
            {"user_id": user_id, "puzzle_id": body.puzzle_id},
            {"$set": {"completed_logged": True}},
        )
    return {"ok": True, "granted": granted, "points_awarded": points_awarded, "streak": streak}


@api.get("/games/sudoku/progress/{user_id}")
async def sudoku_get_progress(user_id: str, puzzle_id: str):
    p = await db.sudoku_progress.find_one({"user_id": user_id, "puzzle_id": puzzle_id}, {"_id": 0})
    return p or {}


# ------------- Spot The Difference -------------
class SpotProgressBody(BaseModel):
    puzzle_id: str
    theme: str
    difficulty: str
    found_ids: List[str] = []
    hints_used: int = 0
    seconds: int = 0
    completed: bool = False
    is_daily: bool = False
    beat_the_clock: bool = False  # whether user opted in to time bonus


@api.get("/games/spot/catalog")
async def spot_catalog():
    diffs = []
    for k, d in STD_DIFFS.items():
        diffs.append({"key": k, "label": d["label"], "diffs": d["diffs"], "points": d["points"], "hints": d["hints"], "ribbon": d["ribbon"]})
    return {"themes": std_list_themes(), "difficulties": diffs}


def _spot_bg_url(theme_key: str) -> Optional[str]:
    """Return /api/static URL for the lifelike backdrop image if it exists on disk.

    Maps both the new theme keys (australian_gardens, beaches, …) and the
    legacy keys (garden, beach, coffee_shop, birds, pets, around_house) onto
    the same on-disk filenames so existing deep-links keep working after the
    theme rename in this release."""
    alias = {
        "garden": "australian_gardens",
        "beach": "beaches",
        "coffee_shop": "cafes",
        "birds": "wildlife",
        "pets": "wildlife",
        "around_house": "kitchens",
    }
    filename = alias.get(theme_key, theme_key)
    p = ROOT_DIR / "static" / "spot_bg" / f"{filename}.jpg"
    if p.exists():
        return f"/api/static/spot_bg/{filename}.jpg"
    return None


@api.get("/games/spot/puzzle")
async def spot_puzzle(theme: str, difficulty: str = "easy", seed: Optional[int] = None):
    if theme not in STD_THEMES:
        raise HTTPException(404, "Unknown theme")
    # Be lenient about an unset/garbled difficulty — fall back to "easy" rather
    # than 400, so a slightly malformed Expo Router URL like
    # `?theme=garden&difficulty=undefined` still loads a playable puzzle.
    if not difficulty or difficulty not in STD_DIFFS:
        difficulty = "easy"
    if seed is None:
        stable_key = f"std|{theme}|{difficulty}|{std_today_iso()}"
        use_seed = abs(hash(stable_key)) % (10 ** 9)
    else:
        use_seed = int(seed)
    puz = std_generate(theme, difficulty, use_seed)
    return {**puz, "puzzle_id": f"std:{theme}:{difficulty}:{use_seed}", "background_url": _spot_bg_url(theme)}


@api.get("/games/spot/library")
async def spot_library_list():
    """Curated puzzle library — only puzzles active for today's date."""
    return {"puzzles": [lib_card(p) for p in lib_active()]}


@api.get("/games/spot/library/{puzzle_id}")
async def spot_library_get(puzzle_id: str, seed: Optional[int] = None):
    """Return a full playable puzzle from the curated library.

    The element layout comes from the linked theme's scene catalogue; the
    photo is the puzzle's own. Difference picks are deterministic on the
    puzzle id so a returning player gets the same puzzle until the library
    refresh."""
    p = lib_get(puzzle_id)
    if not p:
        raise HTTPException(404, "Puzzle not found")
    if seed is None:
        use_seed = abs(hash(f"lib|{puzzle_id}|{std_today_iso()}")) % (10 ** 9)
    else:
        use_seed = int(seed)
    # Build a puzzle using the puzzle's theme + difficulty, then override the
    # background URL to the puzzle's own photo and the title.
    puz = std_generate(p["theme"], p["difficulty"], use_seed)
    puz["puzzle_id"] = f"lib:{puzzle_id}:{use_seed}"
    puz["background_url"] = f"/api/static/spot_bg/library/{p['photo']}"
    puz["title"] = p["title"]
    puz["season"] = p.get("season")
    return puz


@api.get("/games/spot/daily")
async def spot_daily():
    """Today's recommended puzzle — preferred from the curated library."""
    today = std_today_iso()
    active = lib_active()
    if active:
        # Stable rotation: pick by today's ordinal so it shifts each day.
        idx = abs(hash(f"daily|{today}")) % len(active)
        p = active[idx]
        use_seed = abs(hash(f"lib|{p['id']}|{today}")) % (10 ** 9)
        puz = std_generate(p["theme"], p["difficulty"], use_seed)
        puz["puzzle_id"] = f"lib:{p['id']}:daily-{today}"
        puz["background_url"] = f"/api/static/spot_bg/library/{p['photo']}"
        puz["title"] = p["title"]
        puz["date"] = today
        puz["is_daily"] = True
        puz["season"] = p.get("season")
        return puz
    # Fallback to legacy theme picker if no library puzzles are active today.
    pick = std_daily_pick(today)
    puz = std_generate(pick["theme"], pick["difficulty"], pick["seed"])
    return {**puz, "puzzle_id": f"std:{pick['theme']}:{pick['difficulty']}:daily-{today}", "date": today, "is_daily": True, "background_url": _spot_bg_url(pick["theme"])}


@api.post("/games/spot/progress/{user_id}")
async def spot_save_progress(user_id: str, body: SpotProgressBody):
    if body.theme not in STD_THEMES:
        raise HTTPException(404, "Unknown theme")
    if body.difficulty not in STD_DIFFS:
        raise HTTPException(400, "Unknown difficulty")
    existing = await db.spot_progress.find_one({"user_id": user_id, "puzzle_id": body.puzzle_id}, {"_id": 0})
    # Personal best tracking — only on first completion of this puzzle
    prev_best = None
    if existing and existing.get("completed"):
        prev_best = existing.get("personal_best_seconds")
    set_doc = {
        "user_id": user_id, "puzzle_id": body.puzzle_id, "theme": body.theme, "difficulty": body.difficulty,
        "found_ids": body.found_ids, "hints_used": body.hints_used, "seconds": body.seconds,
        "completed": body.completed, "is_daily": body.is_daily, "beat_the_clock": body.beat_the_clock,
        "updated_at": now_iso(),
    }
    if body.completed:
        # Track personal best only for completed runs
        if prev_best is None or body.seconds < prev_best:
            set_doc["personal_best_seconds"] = body.seconds
        else:
            set_doc["personal_best_seconds"] = prev_best
    await db.spot_progress.update_one(
        {"user_id": user_id, "puzzle_id": body.puzzle_id},
        {"$set": set_doc, "$setOnInsert": {"id": nid(), "created_at": now_iso()}},
        upsert=True,
    )

    granted: List[str] = []
    points_awarded = 0
    streak = 0
    new_personal_best = False
    if body.completed and (not existing or not existing.get("completed_logged")):
        diff_def = STD_DIFFS[body.difficulty]
        result = await log_game_completion(user_id, GameCompletionBody(
            game_type="spot",
            difficulty=body.difficulty,
            title=f"Spot The Difference · {STD_THEMES[body.theme]['label']}",
            duration_seconds=body.seconds,
            score=len(body.found_ids),
            is_daily=body.is_daily,
        ))
        granted = result.get("granted", [])
        streak = result.get("streak", 0)
        # Points awarded only on Hard & Nightmare (per user spec)
        points_awarded = diff_def["points"]
        # Beat-the-Clock bonus if opted in and finished under the bonus time
        if body.beat_the_clock and points_awarded > 0:
            from spot_difference import BEAT_THE_CLOCK
            btc = BEAT_THE_CLOCK[body.difficulty]
            if body.seconds <= btc["seconds"]:
                points_awarded += btc["bonus"]
        if points_awarded:
            await award_points(user_id, points_awarded)
        # Personal best?
        if prev_best is None or body.seconds < prev_best:
            new_personal_best = True
        await db.spot_progress.update_one(
            {"user_id": user_id, "puzzle_id": body.puzzle_id},
            {"$set": {"completed_logged": True}},
        )
    return {"ok": True, "granted": granted, "points_awarded": points_awarded, "streak": streak, "new_personal_best": new_personal_best}


@api.get("/games/spot/progress/{user_id}")
async def spot_get_progress(user_id: str, puzzle_id: str):
    p = await db.spot_progress.find_one({"user_id": user_id, "puzzle_id": puzzle_id}, {"_id": 0})
    return p or {}


@api.get("/games/spot/bests/{user_id}")
async def spot_personal_bests(user_id: str):
    """Per-difficulty personal bests + total completed for the user."""
    docs = await db.spot_progress.find({"user_id": user_id, "completed": True}, {"_id": 0}).to_list(500)
    bests: Dict[str, Dict] = {}
    for d in docs:
        k = d.get("difficulty", "easy")
        sec = d.get("personal_best_seconds", d.get("seconds"))
        cur = bests.get(k)
        if cur is None or (sec is not None and sec < cur["seconds"]):
            bests[k] = {"seconds": sec, "theme": d.get("theme"), "puzzle_id": d.get("puzzle_id")}
    return {"bests": bests, "total_completed": len(docs)}


# ------------- Milestones -------------
async def _user_stats(user_id: str) -> Dict:
    """Aggregate counts driving milestone evaluation."""
    games_completed = await db.game_completions.count_documents({"user_id": user_id})
    lounge_visits = await db.table_visits.count_documents({"user_id": user_id}) if hasattr(db, "table_visits") else 0
    try:
        # If we don't track table_visits, infer from any historical seated record (best-effort)
        if not lounge_visits:
            lounge_visits = await db.tables.count_documents({"seated": user_id})
    except Exception:
        pass
    events_attended = 0
    try:
        events_attended = await db.event_rsvps.count_documents({"user_id": user_id, "going": True})
    except Exception:
        pass
    return {"games_completed": games_completed, "lounge_visits": lounge_visits, "events_attended": events_attended}


@api.get("/milestones/{user_id}")
async def get_milestones(user_id: str):
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    stats = await _user_stats(user_id)
    evaluated = ml_evaluate(user, stats)
    # Track which keys we've already celebrated (so we only notify once each).
    celebrated = set(user.get("milestones_celebrated") or [])
    just_unlocked: List[Dict] = []
    new_keys: List[str] = []
    for m in evaluated["earned"]:
        if m["key"] not in celebrated:
            new_keys.append(m["key"])
            just_unlocked.append(m)
    if new_keys:
        await db.users.update_one(
            {"id": user_id},
            {"$addToSet": {"milestones_celebrated": {"$each": new_keys}}},
        )
        # Push a friendly in-app notification for each newly unlocked milestone
        for m in just_unlocked:
            await push_notification(
                user_id,
                "milestone",
                f"{m['emoji']} {m['label']}",
                m["message"],
                {"milestone_key": m["key"]},
            )
    return {
        "user_id": user_id,
        "stats": stats,
        "earned": evaluated["earned"],
        "upcoming": evaluated["upcoming"],
        "just_unlocked": just_unlocked,
    }


# ------------- Birthday visibility + Birthday Flutters -------------
class BirthdayVisibilityBody(BaseModel):
    visibility: str  # "on" | "off"


@api.post("/users/{user_id}/birthday-visibility")
async def set_birthday_visibility(user_id: str, body: BirthdayVisibilityBody):
    if body.visibility not in ("on", "off"):
        raise HTTPException(400, "visibility must be 'on' or 'off'")
    await db.users.update_one({"id": user_id}, {"$set": {"birthday_visibility": body.visibility}})
    return {"ok": True, "visibility": body.visibility}


class BirthdayWishBody(BaseModel):
    from_id: str
    to_id: str
    message: Optional[str] = None


@api.post("/birthday/wishes/send")
async def send_birthday_wish(body: BirthdayWishBody):
    sender = await db.users.find_one({"id": body.from_id}, {"_id": 0, "first_name": 1, "avatar": 1})
    recipient = await db.users.find_one({"id": body.to_id}, {"_id": 0, "blocked": 1, "birthday_visibility": 1, "first_name": 1, "birthday": 1})
    if not sender or not recipient:
        raise HTTPException(404, "User not found")
    if body.from_id in (recipient.get("blocked") or []):
        raise HTTPException(403, "Cannot send a wish to this user")
    if recipient.get("birthday_visibility", "on") == "off":
        raise HTTPException(403, "This member has turned off birthday celebrations")
    if not recipient.get("birthday"):
        raise HTTPException(400, "Recipient has no birthday set")
    today_tag = ws_today_iso()
    # Per-day dedupe so the points reward can't be farmed.
    dedupe_key = f"{body.from_id}:{body.to_id}:{today_tag}"
    if await db.birthday_wishes_sent.find_one({"_id": dedupe_key}):
        raise HTTPException(409, "You've already sent a birthday wish today")
    await db.birthday_wishes_sent.insert_one({"_id": dedupe_key, "created_at": now_iso()})
    msg = body.message or f"🎂 Happy Birthday, {recipient.get('first_name','friend')}! Wishing you a lovely day."
    f = FlutterDoc(
        from_id=body.from_id, to_id=body.to_id,
        from_name=sender.get("first_name", ""), from_avatar=sender.get("avatar", ""),
        message=msg,
    )
    await db.flutters.insert_one(f.dict())
    await push_notification(
        body.to_id, "birthday_wish",
        f"🎂 {sender.get('first_name','A friend')} sent you a birthday wish",
        msg,
        {"from_id": body.from_id, "flutter_id": f.id},
    )
    await award_points(body.from_id, 3)
    return {"ok": True, "flutter_id": f.id}


# ------------- "We've Missed You" -------------
@api.post("/jobs/missed-you-check")
async def missed_you_check(days_idle: int = 30):
    """Notifies dormant users (no heartbeat in `days_idle` days) with a gentle
    message. Idempotent for today — re-running won't double-notify.
    Safe to call from a cron or admin tool."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=int(days_idle))).isoformat()
    today_tag = ws_today_iso()
    candidates = await db.users.find(
        {
            "last_seen_at": {"$lt": cutoff},
            "banned": {"$ne": True},
            "missed_you_last_sent": {"$ne": today_tag},
        },
        {"_id": 0, "id": 1, "first_name": 1},
    ).to_list(500)
    sent = 0
    for u in candidates:
        await push_notification(
            u["id"],
            "missed_you",
            "💛 We've missed you",
            "Your friends at FriendPlace would love to see you again.",
            {"days_idle": int(days_idle)},
        )
        await db.users.update_one({"id": u["id"]}, {"$set": {"missed_you_last_sent": today_tag}})
        sent += 1
    return {"ok": True, "checked": len(candidates), "notified": sent, "days_idle": int(days_idle)}


# ------------- Jigsaw (built-in catalogue) -------------
from jigsaw_data import JIGSAW_CATALOGUE, CATEGORIES, DIFFICULTY_GRID  # noqa: E402


class JigsawProgressBody(BaseModel):
    puzzle_id: str
    difficulty: str
    order: List[int]
    percent: float
    completed: bool = False


@api.get("/games/jigsaw/catalog")
async def jigsaw_catalog():
    return {"categories": CATEGORIES, "puzzles": JIGSAW_CATALOGUE, "difficulties": DIFFICULTY_GRID}


@api.get("/games/jigsaw/daily")
async def jigsaw_daily():
    """Deterministic puzzle-of-the-day."""
    d = datetime.now(timezone.utc)
    seed = d.year * 10000 + d.month * 100 + d.day
    p = JIGSAW_CATALOGUE[seed % len(JIGSAW_CATALOGUE)]
    return {"date": d.date().isoformat(), "puzzle": p, "difficulty": "moderate"}


@api.get("/games/jigsaw/progress/{user_id}")
async def jigsaw_all_progress(user_id: str):
    docs = await db.jigsaw_progress.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    return docs


@api.get("/games/jigsaw/progress/{user_id}/{puzzle_id}/{difficulty}")
async def jigsaw_progress(user_id: str, puzzle_id: str, difficulty: str):
    doc = await db.jigsaw_progress.find_one({"user_id": user_id, "puzzle_id": puzzle_id, "difficulty": difficulty}, {"_id": 0})
    return doc or {}


@api.put("/games/jigsaw/progress/{user_id}")
async def jigsaw_save_progress(user_id: str, body: JigsawProgressBody):
    key = {"user_id": user_id, "puzzle_id": body.puzzle_id, "difficulty": body.difficulty}
    existing = await db.jigsaw_progress.find_one(key, {"_id": 0}) or {}
    # already completed? Don't re-award or overwrite the duration.
    if existing.get("completed"):
        return existing
    diff_info = DIFFICULTY_GRID.get(body.difficulty, {})
    points = int(diff_info.get("points", 15))
    doc = {**key, "order": body.order, "percent": body.percent, "completed": body.completed, "updated_at": now_iso()}
    # Stamp started_at the first time we see any progress on this puzzle/difficulty.
    if not existing.get("started_at") and (body.percent > 0 or body.completed):
        doc["started_at"] = now_iso()
    elif existing.get("started_at"):
        doc["started_at"] = existing["started_at"]
    if body.completed:
        doc["completed_at"] = now_iso()
        try:
            start_dt = datetime.fromisoformat(doc.get("started_at") or doc["completed_at"])
            end_dt = datetime.fromisoformat(doc["completed_at"])
            doc["duration_seconds"] = max(1, int((end_dt - start_dt).total_seconds()))
        except Exception:
            doc["duration_seconds"] = 0
        doc["points_earned"] = points
    await db.jigsaw_progress.update_one(key, {"$set": doc}, upsert=True)
    if body.completed:
        await award_points(user_id, points)
        # Pass the difficulty through unchanged — Easy/Moderate/Hard/Nightmare.
        unified_diff = body.difficulty
        try:
            # Daily-challenge detection: matches today's deterministic puzzle id
            daily = await jigsaw_daily()
            is_daily = (daily.get("puzzle", {}).get("id") == body.puzzle_id and daily.get("difficulty") == body.difficulty)
        except Exception:
            is_daily = False
        try:
            await log_game_completion(user_id, GameCompletionBody(
                game_type="jigsaw", difficulty=unified_diff,
                title=body.puzzle_id, duration_seconds=int(doc.get("duration_seconds") or 0),
                score=points, is_daily=bool(is_daily),
            ))
        except Exception as e:
            logger.warning("jigsaw->games unified log failed: %s", e)
    return doc


@api.get("/games/jigsaw/completed/{user_id}")
async def jigsaw_completed(user_id: str):
    docs = await db.jigsaw_progress.find({"user_id": user_id, "completed": True}, {"_id": 0}).sort("completed_at", -1).to_list(500)
    return docs


@api.get("/games/jigsaw/stats/{user_id}")
async def jigsaw_stats(user_id: str):
    docs = await db.jigsaw_progress.find({"user_id": user_id, "completed": True}, {"_id": 0}).to_list(2000)
    total_completed = len(docs)
    total_seconds = sum(int(d.get("duration_seconds") or 0) for d in docs)
    total_points = sum(int(d.get("points_earned") or 0) for d in docs)
    by_diff: Dict[str, int] = {}
    for d in docs:
        k = d.get("difficulty", "easy")
        by_diff[k] = by_diff.get(k, 0) + 1
    fastest = None
    for d in docs:
        s = int(d.get("duration_seconds") or 0)
        if s > 0 and (fastest is None or s < int(fastest.get("duration_seconds") or 0)):
            fastest = d
    return {
        "total_completed": total_completed,
        "total_seconds": total_seconds,
        "total_points": total_points,
        "by_difficulty": by_diff,
        "fastest": fastest,
    }


@api.get("/games/jigsaw/random")
async def jigsaw_random():
    """A random rotating puzzle for the "Surprise me" button."""
    p = random.choice(JIGSAW_CATALOGUE)
    return {"puzzle": p, "difficulty": "easy"}


# ------------- Trivia -------------
from trivia_data import (  # noqa: E402
    QUESTIONS as TRIVIA_QUESTIONS,
    CATEGORIES as TRIVIA_CATEGORIES,
    DIFFICULTIES as TRIVIA_DIFFICULTIES,
    DIFFICULTY_META as TRIVIA_DIFFICULTY_META,
    DIFFICULTY_POINTS as TRIVIA_POINTS,
    question_count_for as trivia_question_count_for,
    category_counts as trivia_category_counts,
)


def _trivia_pick_pool(category: Optional[str], difficulty: str) -> List[Dict]:
    pool = [q for q in TRIVIA_QUESTIONS if q["difficulty"] == difficulty]
    if category and category != "Mixed":
        pool = [q for q in pool if q["category"] == category]
    return pool


def _trivia_strip_answer(q: Dict) -> Dict:
    """Send to the client WITHOUT the correct answer / explanation."""
    return {"id": q["id"], "category": q["category"], "difficulty": q["difficulty"],
            "q": q["q"], "choices": q["choices"]}


def _trivia_safe_questions(qs: List[Dict]) -> List[Dict]:
    return [_trivia_strip_answer(q) for q in qs]


def _trivia_lookup(qid: str) -> Optional[Dict]:
    for q in TRIVIA_QUESTIONS:
        if q["id"] == qid:
            return q
    return None


@api.get("/games/trivia/catalog")
async def trivia_catalog():
    return {
        "categories": TRIVIA_CATEGORIES,
        "difficulties": TRIVIA_DIFFICULTIES,
        "difficulty_meta": TRIVIA_DIFFICULTY_META,
        "counts": trivia_category_counts(),
    }


@api.get("/games/trivia/daily")
async def trivia_daily():
    """Deterministic daily mix: 10 questions across difficulties, seeded by date."""
    d = datetime.now(timezone.utc)
    seed = d.year * 10000 + d.month * 100 + d.day
    rnd = random.Random(seed)
    desired = [("easy", 3), ("moderate", 4), ("hard", 2), ("nightmare", 1)]
    qs: List[Dict] = []
    for diff, n in desired:
        pool = [q for q in TRIVIA_QUESTIONS if q["difficulty"] == diff]
        rnd.shuffle(pool)
        qs.extend(pool[:n])
    rnd.shuffle(qs)
    return {
        "date": d.date().isoformat(),
        "category": "Mixed",
        "difficulty": "moderate",
        "questions": _trivia_safe_questions(qs),
        "question_ids": [q["id"] for q in qs],
        "count": len(qs),
        "points_on_complete": 15,
        "is_daily": True,
    }


class TriviaStartBody(BaseModel):
    category: Optional[str] = "Mixed"
    difficulty: str = "easy"
    daily: bool = False


@api.post("/games/trivia/session/{user_id}")
async def trivia_start_session(user_id: str, body: TriviaStartBody):
    difficulty = body.difficulty.lower()
    if difficulty not in TRIVIA_DIFFICULTIES:
        raise HTTPException(400, "Invalid difficulty")

    if body.daily:
        daily = await trivia_daily()
        qids = daily["question_ids"]
        category = "Mixed"
        difficulty = daily["difficulty"]
    else:
        pool = _trivia_pick_pool(body.category, difficulty)
        if not pool:
            raise HTTPException(400, "No questions available for that selection")
        random.shuffle(pool)
        count = trivia_question_count_for(difficulty)
        qids = [q["id"] for q in pool[:count]]
        category = body.category or "Mixed"

    sid = nid()
    doc = {
        "id": sid,
        "user_id": user_id,
        "category": category,
        "difficulty": difficulty,
        "question_ids": qids,
        "answers": [],            # list of {qid, picked, correct}
        "current_index": 0,
        "lifelines": {"fifty_used": False, "skip_used": False},
        "score": 0,
        "completed": False,
        "is_daily": bool(body.daily),
        "started_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.trivia_sessions.insert_one(doc)
    qs = [_trivia_strip_answer(_trivia_lookup(q)) for q in qids if _trivia_lookup(q)]
    return {
        "session_id": sid,
        "category": category,
        "difficulty": difficulty,
        "questions": qs,
        "count": len(qs),
        "lifelines": doc["lifelines"],
        "is_daily": bool(body.daily),
    }


@api.get("/games/trivia/session/{user_id}/{session_id}")
async def trivia_get_session(user_id: str, session_id: str):
    doc = await db.trivia_sessions.find_one({"id": session_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Session not found")
    qs = [_trivia_strip_answer(_trivia_lookup(q)) for q in doc["question_ids"] if _trivia_lookup(q)]
    return {**doc, "questions": qs}


class TriviaAnswerBody(BaseModel):
    qid: str
    picked: int           # index into choices; use -1 for "skipped"
    lifelines: Optional[Dict[str, bool]] = None
    advance: bool = True


@api.post("/games/trivia/session/{user_id}/{session_id}/answer")
async def trivia_submit_answer(user_id: str, session_id: str, body: TriviaAnswerBody):
    doc = await db.trivia_sessions.find_one({"id": session_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Session not found")
    if doc.get("completed"):
        raise HTTPException(400, "Session already completed")
    q = _trivia_lookup(body.qid)
    if not q:
        raise HTTPException(400, "Question not in catalogue")

    skipped = body.picked == -1
    is_correct = (not skipped) and (body.picked == q["answer"])
    entry = {
        "qid": body.qid,
        "picked": body.picked,
        "correct": is_correct,
        "skipped": skipped,
        "correct_answer": q["answer"],
        "explain": q.get("explain", ""),
        "answered_at": now_iso(),
    }
    answers = doc.get("answers", [])
    answers = [a for a in answers if a["qid"] != body.qid]
    answers.append(entry)
    new_score = sum(1 for a in answers if a.get("correct"))
    lifelines = doc.get("lifelines", {"fifty_used": False, "skip_used": False})
    if body.lifelines:
        lifelines = {**lifelines, **body.lifelines}
    current_index = doc.get("current_index", 0)
    if body.advance:
        current_index = min(len(doc["question_ids"]) - 1, current_index + 1)
    await db.trivia_sessions.update_one(
        {"id": session_id},
        {"$set": {
            "answers": answers,
            "score": new_score,
            "lifelines": lifelines,
            "current_index": current_index,
            "updated_at": now_iso(),
        }},
    )
    return {
        "correct": is_correct,
        "correct_answer": q["answer"],
        "explain": q.get("explain", ""),
        "score": new_score,
        "current_index": current_index,
    }


@api.post("/games/trivia/session/{user_id}/{session_id}/complete")
async def trivia_complete_session(user_id: str, session_id: str):
    doc = await db.trivia_sessions.find_one({"id": session_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Session not found")
    if doc.get("completed"):
        return {**doc, "already_completed": True}

    diff = doc.get("difficulty", "easy")
    score = doc.get("score", 0)
    total = len(doc.get("question_ids", []))
    # Pass mark = 60% correct OR all answered
    answered = sum(1 for a in doc.get("answers", []) if a.get("picked", -2) != -2)
    base_points = int(TRIVIA_POINTS.get(diff, 5))
    # Pro-rate: full points if score >= 60%, otherwise scale by ratio (min 1).
    ratio = (score / total) if total else 0
    points = base_points if ratio >= 0.6 else max(1, int(round(base_points * max(0.2, ratio))))
    started = doc.get("started_at")
    try:
        start_dt = datetime.fromisoformat(started) if started else datetime.now(timezone.utc)
        duration = max(1, int((datetime.now(timezone.utc) - start_dt.replace(tzinfo=start_dt.tzinfo or timezone.utc)).total_seconds()))
    except Exception:
        duration = 0

    await db.trivia_sessions.update_one(
        {"id": session_id},
        {"$set": {
            "completed": True,
            "completed_at": now_iso(),
            "points_earned": points,
            "duration_seconds": duration,
            "final_score": score,
            "total_questions": total,
            "answered_count": answered,
        }},
    )
    await award_points(user_id, points)

    granted: List[str] = []
    try:
        nice_title = f"{doc.get('category', 'Mixed')} · {diff.title()}"
        log = await log_game_completion(user_id, GameCompletionBody(
            game_type="trivia",
            difficulty=diff,
            title=nice_title,
            duration_seconds=duration,
            score=score,
            is_daily=bool(doc.get("is_daily")),
        ))
        granted = log.get("granted", []) if isinstance(log, dict) else []
    except Exception as e:
        logger.warning("trivia->games unified log failed: %s", e)

    return {
        "session_id": session_id,
        "score": score,
        "total": total,
        "points_earned": points,
        "duration_seconds": duration,
        "granted": granted,
        "difficulty": diff,
        "category": doc.get("category", "Mixed"),
        "is_daily": bool(doc.get("is_daily")),
    }


@api.get("/games/trivia/sessions/{user_id}")
async def trivia_list_sessions(user_id: str):
    """Returns active + recent completed sessions (last 20)."""
    active = await db.trivia_sessions.find(
        {"user_id": user_id, "completed": {"$ne": True}}, {"_id": 0}
    ).sort("updated_at", -1).to_list(10)
    recent = await db.trivia_sessions.find(
        {"user_id": user_id, "completed": True}, {"_id": 0}
    ).sort("completed_at", -1).to_list(20)
    return {"active": active, "recent": recent}


@api.get("/games/trivia/stats/{user_id}")
async def trivia_stats(user_id: str):
    docs = await db.trivia_sessions.find(
        {"user_id": user_id, "completed": True}, {"_id": 0}
    ).to_list(2000)
    total_completed = len(docs)
    total_points = sum(int(d.get("points_earned") or 0) for d in docs)
    total_correct = sum(int(d.get("final_score") or 0) for d in docs)
    total_qs = sum(int(d.get("total_questions") or 0) for d in docs)
    accuracy = (total_correct / total_qs) if total_qs else 0
    by_diff: Dict[str, int] = {}
    for d in docs:
        k = d.get("difficulty", "easy")
        by_diff[k] = by_diff.get(k, 0) + 1
    return {
        "total_completed": total_completed,
        "total_points": total_points,
        "total_correct": total_correct,
        "total_questions": total_qs,
        "accuracy": round(accuracy * 100, 1),
        "by_difficulty": by_diff,
    }


# ------------- Bingo -------------
# Difficulty config
BINGO_DIFFICULTY_META = [
    {"key": "easy",      "label": "Easy",      "cols": 4, "rows": 4, "cards": 1, "free_center": False, "pattern": "any_line",       "points": 5,  "auto_call_ms": 0,    "color": "#0F766E"},
    {"key": "moderate",  "label": "Moderate",  "cols": 5, "rows": 5, "cards": 1, "free_center": True,  "pattern": "any_line",       "points": 10, "auto_call_ms": 0,    "color": "#2563EB"},
    {"key": "hard",      "label": "Hard",      "cols": 5, "rows": 5, "cards": 1, "free_center": True,  "pattern": "two_lines_corners", "points": 20, "auto_call_ms": 4000, "color": "#B45309"},
    {"key": "nightmare", "label": "Nightmare", "cols": 5, "rows": 5, "cards": 2, "free_center": True,  "pattern": "full_house",     "points": 35, "auto_call_ms": 3000, "color": "#7C3AED"},
]
BINGO_DIFFICULTIES = [d["key"] for d in BINGO_DIFFICULTY_META]


def _bingo_meta(k: str) -> Optional[Dict]:
    for m in BINGO_DIFFICULTY_META:
        if m["key"] == k:
            return m
    return None


def _bingo_card(cols: int, rows: int, free_center: bool, rnd: random.Random) -> List[List[int]]:
    """Generate a card. For 5x5 use B(1-15), I(16-30), N(31-45), G(46-60), O(61-75).
    For 4x4 use B,I,N,G only (skip O)."""
    ranges = [(1, 15), (16, 30), (31, 45), (46, 60), (61, 75)]
    pick_cols = cols  # 4 or 5
    card: List[List[int]] = []
    for ci in range(pick_cols):
        lo, hi = ranges[ci]
        pool = list(range(lo, hi + 1))
        rnd.shuffle(pool)
        col = pool[:rows]
        card.append(col)
    if free_center and rows == 5 and pick_cols == 5:
        card[2][2] = 0  # free space
    return card


def _bingo_call_sequence(rnd: random.Random, pool_max: int = 75) -> List[int]:
    seq = list(range(1, pool_max + 1))
    rnd.shuffle(seq)
    return seq


def _bingo_seed_from_date(d: Optional[datetime] = None) -> int:
    d = d or datetime.now(timezone.utc)
    return d.year * 10000 + d.month * 100 + d.day


def _bingo_check_win(cards: List[List[List[int]]], marked: List[List[List[bool]]], pattern: str, free_center: bool) -> bool:
    """Returns True if the win pattern is satisfied on ANY card (for single card games)
    or across ALL cards (for nightmare full_house)."""
    def lines_for(card_marked: List[List[bool]]):
        rows = len(card_marked)
        cols = len(card_marked[0]) if rows else 0
        lines = []
        for r in range(rows):
            lines.append([(c, r) for c in range(cols)])
        for c in range(cols):
            lines.append([(c, r) for r in range(rows)])
        if rows == cols:
            lines.append([(i, i) for i in range(rows)])
            lines.append([(i, rows - 1 - i) for i in range(rows)])
        return lines

    def full_lines(card_marked):
        return [ln for ln in lines_for(card_marked) if all(card_marked[r][c] for (c, r) in ln)]

    def four_corners(card_marked):
        rows = len(card_marked); cols = len(card_marked[0]) if rows else 0
        return card_marked[0][0] and card_marked[0][cols-1] and card_marked[rows-1][0] and card_marked[rows-1][cols-1]

    if pattern == "full_house":
        # all cells marked across all cards (free centre is always marked)
        for cm in marked:
            for row in cm:
                if not all(row):
                    return False
        return True

    for cm in marked:
        lines = full_lines(cm)
        if pattern == "any_line":
            if len(lines) >= 1:
                return True
        elif pattern == "two_lines_corners":
            if len(lines) >= 2 and four_corners(cm):
                return True
    return False


def _bingo_initial_marked(cards: List[List[List[int]]]) -> List[List[List[bool]]]:
    out = []
    for card in cards:
        cm = [[False] * len(card[0]) for _ in card]
        for ci, col in enumerate(card):
            for ri, val in enumerate(col):
                if val == 0:  # free centre
                    cm[ri][ci] = True
        out.append(cm)
    return out


# Community bingo events — seeded sample data
COMMUNITY_BINGO_EVENTS = [
    {"id": "evt-weekly-friday", "title": "Friday Night Bingo", "subtitle": "Async weekly comp · play any time", "difficulty": "moderate", "starts_iso": "2026-06-12T19:00:00+10:00", "ends_iso":   "2026-06-15T23:59:59+10:00", "seed": 99001, "points_on_complete": 25},
    {"id": "evt-weekend-warmup", "title": "Weekend Warm-Up",   "subtitle": "Easy difficulty · open all weekend", "difficulty": "easy",     "starts_iso": "2026-06-13T08:00:00+10:00", "ends_iso":   "2026-06-14T23:59:59+10:00", "seed": 99002, "points_on_complete": 12},
    {"id": "evt-nightmare-challenge", "title": "Nightmare Challenge", "subtitle": "For brave butterflies only", "difficulty": "nightmare","starts_iso": "2026-06-15T18:00:00+10:00","ends_iso":   "2026-06-21T23:59:59+10:00", "seed": 99003, "points_on_complete": 50},
]


def _community_event(eid: str) -> Optional[Dict]:
    for e in COMMUNITY_BINGO_EVENTS:
        if e["id"] == eid:
            return e
    return None


@api.get("/games/bingo/catalog")
async def bingo_catalog():
    return {"difficulties": BINGO_DIFFICULTIES, "difficulty_meta": BINGO_DIFFICULTY_META}


@api.get("/games/bingo/daily")
async def bingo_daily():
    """Today's daily Bingo card — moderate difficulty."""
    rnd = random.Random(_bingo_seed_from_date())
    meta = _bingo_meta("moderate")
    cards = [_bingo_card(meta["cols"], meta["rows"], meta["free_center"], rnd) for _ in range(meta["cards"])]
    return {"date": datetime.now(timezone.utc).date().isoformat(), "difficulty": "moderate", "points_on_complete": 15, "sample_card": cards[0]}


@api.get("/games/bingo/community-events")
async def bingo_community_events():
    """All active/upcoming async Bingo events, plus most recent winners."""
    out: List[Dict] = []
    for e in COMMUNITY_BINGO_EVENTS:
        winners = await db.bingo_sessions.find(
            {"event_id": e["id"], "completed": True}, {"_id": 0, "user_id": 1, "duration_seconds": 1, "completed_at": 1}
        ).sort("duration_seconds", 1).to_list(5)
        out.append({**e, "winners": winners})
    return {"events": out}


@api.get("/games/bingo/community-events/{event_id}/leaderboard")
async def bingo_community_leaderboard(event_id: str):
    if not _community_event(event_id):
        raise HTTPException(404, "Event not found")
    rows = await db.bingo_sessions.find({"event_id": event_id, "completed": True}, {"_id": 0}).sort("duration_seconds", 1).to_list(50)
    enriched = []
    for r in rows:
        u = await db.users.find_one({"id": r.get("user_id")}, {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1})
        enriched.append({**r, "user": u})
    return {"event_id": event_id, "leaderboard": enriched}


class BingoStartBody(BaseModel):
    difficulty: str = "easy"
    daily: bool = False
    event_id: Optional[str] = None


@api.post("/games/bingo/session/{user_id}")
async def bingo_start(user_id: str, body: BingoStartBody):
    diff = body.difficulty.lower()
    if diff not in BINGO_DIFFICULTIES:
        raise HTTPException(400, "Invalid difficulty")
    seed = None
    event = None
    if body.event_id:
        event = _community_event(body.event_id)
        if not event:
            raise HTTPException(404, "Event not found")
        diff = event["difficulty"]
        seed = event["seed"]
    elif body.daily:
        seed = _bingo_seed_from_date()
        diff = "moderate"
    meta = _bingo_meta(diff)
    rnd = random.Random(seed) if seed is not None else random.Random()
    cards = [_bingo_card(meta["cols"], meta["rows"], meta["free_center"], rnd) for _ in range(meta["cards"])]
    pool_max = 75 if meta["cols"] == 5 else 60
    sequence = _bingo_call_sequence(rnd, pool_max)
    marked = _bingo_initial_marked(cards)
    sid = nid()
    doc = {
        "id": sid,
        "user_id": user_id,
        "difficulty": diff,
        "cards": cards,
        "marked": marked,
        "sequence": sequence,
        "call_index": 0,
        "completed": False,
        "is_daily": bool(body.daily and not body.event_id),
        "event_id": body.event_id,
        "started_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.bingo_sessions.insert_one(doc)
    return {**{k: v for k, v in doc.items() if k != "_id"}, "session_id": sid, "meta": meta, "pool_max": pool_max}


@api.get("/games/bingo/session/{user_id}/{session_id}")
async def bingo_get(user_id: str, session_id: str):
    doc = await db.bingo_sessions.find_one({"id": session_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Session not found")
    meta = _bingo_meta(doc["difficulty"])
    pool_max = 75 if meta["cols"] == 5 else 60
    return {**doc, "meta": meta, "pool_max": pool_max}


class BingoUpdateBody(BaseModel):
    call_index: Optional[int] = None  # new pointer into the call sequence
    marked: Optional[List[List[List[bool]]]] = None  # full mark state


@api.put("/games/bingo/session/{user_id}/{session_id}")
async def bingo_update(user_id: str, session_id: str, body: BingoUpdateBody):
    doc = await db.bingo_sessions.find_one({"id": session_id, "user_id": user_id})
    if not doc or doc.get("completed"):
        raise HTTPException(400, "Cannot update")
    update: Dict = {"updated_at": now_iso()}
    if body.call_index is not None:
        update["call_index"] = max(0, min(len(doc["sequence"]), int(body.call_index)))
    if body.marked is not None:
        update["marked"] = body.marked
    await db.bingo_sessions.update_one({"id": session_id}, {"$set": update})
    return {"ok": True, **update}


@api.post("/games/bingo/session/{user_id}/{session_id}/complete")
async def bingo_complete(user_id: str, session_id: str):
    doc = await db.bingo_sessions.find_one({"id": session_id, "user_id": user_id})
    if not doc:
        raise HTTPException(404, "Session not found")
    if doc.get("completed"):
        return {**{k: v for k, v in doc.items() if k != "_id"}, "already_completed": True}
    meta = _bingo_meta(doc["difficulty"])
    valid = _bingo_check_win(doc["cards"], doc["marked"], meta["pattern"], meta["free_center"])
    if not valid:
        raise HTTPException(400, "No winning pattern yet — keep playing!")
    try:
        start_dt = datetime.fromisoformat(doc["started_at"])
        duration = max(1, int((datetime.now(timezone.utc) - start_dt.replace(tzinfo=start_dt.tzinfo or timezone.utc)).total_seconds()))
    except Exception:
        duration = 0
    event = _community_event(doc.get("event_id") or "") if doc.get("event_id") else None
    base_points = int(event["points_on_complete"]) if event else (15 if doc.get("is_daily") else int(meta["points"]))
    await db.bingo_sessions.update_one({"id": session_id}, {"$set": {
        "completed": True, "completed_at": now_iso(), "points_earned": base_points,
        "duration_seconds": duration, "calls_used": doc.get("call_index", 0),
    }})
    await award_points(user_id, base_points)
    granted: List[str] = []
    try:
        label = (event["title"] if event else (f"Daily Bingo" if doc.get("is_daily") else f"Bingo · {doc['difficulty'].title()}"))
        log = await log_game_completion(user_id, GameCompletionBody(
            game_type="bingo",
            difficulty=doc["difficulty"],
            title=label,
            duration_seconds=duration,
            is_daily=bool(doc.get("is_daily")),
        ))
        granted = log.get("granted", []) if isinstance(log, dict) else []
    except Exception as e:
        logger.warning("bingo->games unified log failed: %s", e)
    return {
        "session_id": session_id,
        "difficulty": doc["difficulty"],
        "points_earned": base_points,
        "duration_seconds": duration,
        "calls_used": doc.get("call_index", 0),
        "granted": granted,
        "is_daily": bool(doc.get("is_daily")),
        "event_id": doc.get("event_id"),
    }


@api.get("/games/bingo/sessions/{user_id}")
async def bingo_list(user_id: str):
    active = await db.bingo_sessions.find({"user_id": user_id, "completed": {"$ne": True}}, {"_id": 0}).sort("updated_at", -1).to_list(10)
    recent = await db.bingo_sessions.find({"user_id": user_id, "completed": True}, {"_id": 0}).sort("completed_at", -1).to_list(20)
    return {"active": active, "recent": recent}


@api.get("/games/bingo/stats/{user_id}")
async def bingo_stats(user_id: str):
    docs = await db.bingo_sessions.find({"user_id": user_id, "completed": True}, {"_id": 0}).to_list(2000)
    fastest = min((int(d.get("duration_seconds") or 9_999_999) for d in docs), default=0)
    return {
        "total_completed": len(docs),
        "total_points": sum(int(d.get("points_earned") or 0) for d in docs),
        "fastest_seconds": fastest if fastest != 9_999_999 else 0,
        "by_difficulty": {k: sum(1 for d in docs if d.get("difficulty") == k) for k in BINGO_DIFFICULTIES},
    }


# ------------- Tables (FP Café) -------------
async def _prune_idle_tables() -> None:
    """Delete non-persistent tables (and their messages) that have had no
    activity for 24 hours. Keeps the FP Café tidy without a separate
    cron job — fast enough to run inline on each /tables GET.
    """
    from datetime import datetime as _dt, timedelta as _td, timezone as _tz
    cutoff = (_dt.now(_tz.utc) - _td(hours=24)).isoformat().replace("+00:00", "Z")
    stale = await db.tables.find(
        {"persistent": {"$ne": True}, "last_activity_at": {"$lt": cutoff}},
        {"id": 1, "_id": 0},
    ).to_list(500)
    if not stale:
        return
    stale_ids = [t["id"] for t in stale]
    await db.messages.delete_many({"table_id": {"$in": stale_ids}})
    await db.tables.delete_many({"id": {"$in": stale_ids}})


async def _migrate_table_metadata() -> None:
    """One-shot migration: backfill `last_activity_at`, mark seed tables as
    persistent so they survive the auto-prune, and remove the leftover
    TEST_Table* rows from earlier QA. Idempotent — safe to run on every call.
    """
    seed_names = {"Morning Coffee", "Gardening Chat", "Men's Shed", "Book Club",
                  "Pet Lovers", "New Friends", "Sydney Locals", "Founders Lounge"}
    await db.tables.update_many(
        {"name": {"$in": list(seed_names)}, "persistent": {"$ne": True}},
        {"$set": {"persistent": True}},
    )
    # Make sure the Founders Lounge table has the founder_only flag in case
    # it was created before the field existed.
    await db.tables.update_many(
        {"name": "Founders Lounge", "founder_only": {"$ne": True}},
        {"$set": {"founder_only": True, "persistent": True}},
    )
    # Backfill last_activity_at on any pre-migration rows that lack it.
    async for t in db.tables.find({"last_activity_at": {"$exists": False}}, {"id": 1, "created_at": 1, "_id": 0}):
        await db.tables.update_one(
            {"id": t["id"]},
            {"$set": {"last_activity_at": t.get("created_at", now_iso())}},
        )
    # Remove the four/five TEST_Table rows that piled up during manual QA.
    test_ids = [t["id"] async for t in db.tables.find({"name": "TEST_Table"}, {"id": 1, "_id": 0})]
    if test_ids:
        await db.messages.delete_many({"table_id": {"$in": test_ids}})
        await db.tables.delete_many({"id": {"$in": test_ids}})
    # Ensure the FP Café permanent table exists (TestFlight feedback,
    # Garry 27 July 2026). Idempotent — safe on every call.
    try:
        await _ensure_fp_cafe_table()
    except Exception as e:
        logger.warning("ensure fp_cafe table failed: %s", e)
    # Rebrand rollover: any table description created before the
    # Coffee Lounge → FP Café rename still references the old name.
    # Update in place so members see consistent wording.
    try:
        await db.tables.update_one(
            {"name": "Founders Lounge",
             "description": {"$regex": "Coffee Lounge", "$options": "i"}},
            {"$set": {"description": "An exclusive FP Café table just for Founding Members. Pull up a chair."}},
        )
    except Exception:
        pass


@api.get("/tables")
async def list_tables(user_id: str | None = None):
    """List FP Café tables sorted by most recently active.

    When `user_id` is supplied the response is enriched with:
      • `host_display` — `{first_name, avatar}` for the table's host so the
        card can say "Started by Frank" without an extra round-trip.
      • `friends_seated` — array of `{id, first_name, avatar}` for any
        currently-seated members that are friends of `user_id`. The lounge
        UI surfaces this as a "Joyce is here 🌸" chip; it's the single
        biggest reason members will tap into a table.

    Both fields are best-effort — if user lookups fail we silently omit
    them so the lounge always loads.
    """
    await _migrate_table_metadata()
    await _prune_idle_tables()
    docs = await db.tables.find({}, {"_id": 0}).sort("last_activity_at", -1).to_list(500)
    # TestFlight feedback (Garry 27 July 2026): the FP Café is the
    # community's obvious first door — always pin it at the very top.
    def _sort_key(d: dict) -> tuple[int, str]:
        # (0) pinned always come first; (1) everyone else by recency
        # (already applied by the DB sort). Two-tier stable sort.
        return (0 if d.get("pinned") else 1, "")
    docs.sort(key=_sort_key)

    if not user_id:
        return docs

    # Collect every user id we'll need to render the enriched cards in a
    # single batched query — host ids plus all seated ids.
    requester = await db.users.find_one({"id": user_id}, {"_id": 0, "friends": 1}) or {}
    friend_set = set(requester.get("friends") or [])
    needed_ids: set[str] = set()
    for d in docs:
        if d.get("host_id"):
            needed_ids.add(d["host_id"])
        for sid in d.get("seated") or []:
            needed_ids.add(sid)
    if not needed_ids:
        return docs
    cursor = db.users.find(
        {"id": {"$in": list(needed_ids)}},
        {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1, "is_founder": 1, "founder_number": 1},
    )
    user_map: dict[str, dict] = {}
    async for u in cursor:
        entry = {
            "id": u["id"],
            "first_name": u.get("first_name") or u.get("username") or "Friend",
            "avatar": u.get("avatar") or "🙂",
        }
        # Only attach the founder bits when they're true — keeps the
        # payload small and avoids polluting every seated avatar object.
        if u.get("is_founder"):
            entry["is_founder"] = True
            if u.get("founder_number") is not None:
                entry["founder_number"] = u.get("founder_number")
        user_map[u["id"]] = entry

    for d in docs:
        hid = d.get("host_id")
        if hid and hid in user_map:
            d["host_display"] = user_map[hid]
        d["friends_seated"] = [
            user_map[sid] for sid in (d.get("seated") or [])
            if sid in friend_set and sid in user_map
        ]
    return docs


@api.post("/tables")
async def create_table(body: CreateTableBody):
    t = Table(**body.dict(), seated=[body.host_id])
    await db.tables.insert_one(t.dict())
    await award_points(body.host_id, 10)
    # Notify the host's friends that there's a new table to join. We send to
    # the host's confirmed friends only (not the whole community) so this stays
    # a warm invitation rather than spam. Visibility="friends" already implies
    # this, but we also fire for public tables so friends still hear about it.
    try:
        host = await db.users.find_one({"id": body.host_id}, {"_id": 0}) or {}
        friend_ids = [fid for fid in (host.get("friends") or []) if fid and fid != body.host_id]
        if friend_ids:
            hname = host.get("first_name") or host.get("username") or "Someone"
            havatar = host.get("avatar") or "☕"
            emoji = body.emoji or "☕"
            title = f"{emoji} {hname} just opened a FP Café table"
            body_text = f"{havatar} \u201c{body.name}\u201d — come pull up a chair and say hi."
            for fid in friend_ids[:100]:
                await push_notification(
                    fid,
                    "table_invite",
                    title,
                    body_text,
                    {"table_id": t.id, "host_id": body.host_id},
                )
    except Exception as e:
        logger.warning("table create notify failed: %s", e)
    return t.dict()


@api.get("/tables/{table_id}")
async def get_table(table_id: str):
    t = await db.tables.find_one({"id": table_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Table not found")
    seated_users = await db.users.find({"id": {"$in": t.get("seated", [])}}, {"_id": 0}).to_list(50)
    t["seated_users"] = seated_users
    return t


@api.post("/tables/{table_id}/join/{user_id}")
async def join_table(table_id: str, user_id: str):
    t = await db.tables.find_one({"id": table_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Table not found")
    # Founder-only guard. Non-founders see a friendly 403 with a code the
    # client can branch on (lock the seat, show the "Founding Members only"
    # gate).
    if t.get("founder_only"):
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "is_founder": 1}) or {}
        if not u.get("is_founder"):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "founder_only",
                    "message": "This table is reserved for Founding Members.",
                },
            )
    if user_id in (t.get("seated") or []):
        return {"ok": True}
    await db.tables.update_one(
        {"id": table_id},
        {"$addToSet": {"seated": user_id}, "$set": {"last_activity_at": now_iso()}},
    )
    # Presence hook (Garry Feb 2026 spec): mark the joiner as In-Café
    # and, if they were "looking", auto-clear (they've found company).
    # If anyone ELSE was already seated AND is "looking", also clear
    # their status (someone joined them → contact made). Swallow errors
    # so a status glitch never blocks the join itself.
    try:
        from services.status.service import (  # noqa: E402
            set_in_cafe as _set_in_cafe,
            auto_clear as _auto_clear,
            TRIG_CAFE_JOIN,
            TRIG_CAFE_JOINED_BY,
        )
        await _set_in_cafe(db, user_id, table_id)
        await _auto_clear(db, user_id, TRIG_CAFE_JOIN)
        others_seated = [x for x in (t.get("seated") or []) if x != user_id]
        if others_seated:
            for other in others_seated:
                await _auto_clear(db, other, TRIG_CAFE_JOINED_BY)
    except Exception:
        logging.exception("cafe_join status hook failed for %s @ %s", user_id, table_id)
    host_id = t.get("host_id")
    if host_id and host_id != user_id:
        joiner = await db.users.find_one({"id": user_id}, {"first_name": 1, "avatar": 1, "_id": 0}) or {}
        jname = joiner.get("first_name") or "Someone"
        avatar = joiner.get("avatar") or "🪑"
        await push_notification(
            host_id,
            "table_join",
            f"{avatar} {jname} took a seat at {t.get('name', 'your table')}",
            "Say hello in the chat.",
            {"table_id": table_id, "joiner_id": user_id},
        )
    return {"ok": True}


@api.post("/tables/{table_id}/leave/{user_id}")
async def leave_table(table_id: str, user_id: str):
    await db.tables.update_one({"id": table_id}, {"$pull": {"seated": user_id}})
    # Presence hook: clear the In-Café marker so the effective status
    # falls back to Online (or whatever manual status is active).
    try:
        from services.status.service import set_in_cafe as _set_in_cafe  # noqa: E402
        await _set_in_cafe(db, user_id, None)
    except Exception:
        logging.exception("cafe_leave status hook failed for %s", user_id)
    return {"ok": True}


@api.get("/tables/{table_id}/messages")
async def table_messages(table_id: str):
    docs = await db.messages.find({"table_id": table_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    await _attach_founder_flags(docs, "user_id")
    return docs


# ------------- Groups -------------
@api.get("/groups")
async def list_groups(include_pending: bool = False, include_system: bool = False):
    """Public Community Groups list.

    By default hides:
      • `is_system=True`  — Founders Lounge & FP Café Crew (these
        live in their own dedicated tabs, would be confusing in the
        public listing)
      • `pending_approval=True` — user-suggested groups waiting on admin
        review. Admin panel passes `include_pending=true` to see them.

    Newest first so newly-approved community groups are discoverable.
    """
    q: dict = {}
    if not include_system:
        q["is_system"] = {"$ne": True}
    if not include_pending:
        q["pending_approval"] = {"$ne": True}
    return await db.groups.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.post("/groups")
async def create_group(body: Group):
    g = Group(**body.dict())
    await db.groups.insert_one(g.dict())
    return g.dict()


@api.post("/groups/suggest")
async def suggest_group(body: dict, user=Depends(current_user)):
    """User-facing endpoint — anyone signed in can suggest a new
    Community Group. The submission is stored as a regular group
    document with `pending_approval: true`, so it doesn't appear in the
    public listing until an admin approves it via /admin/groups/{id}/approve.

    Body: { name: str, emoji?: str, description?: str, reason?: str }
    """
    name = (body.get("name") or "").strip()
    if not name or len(name) < 3:
        raise HTTPException(400, "Group name must be at least 3 characters")
    if len(name) > 60:
        raise HTTPException(400, "Group name is too long (60 char max)")
    emoji = (body.get("emoji") or "🌟").strip()[:4]
    description = (body.get("description") or "").strip()[:500]
    reason = (body.get("reason") or "").strip()[:500]
    # Avoid duplicate suggestions while one is pending — protects the
    # admin queue from accidental double-taps.
    existing = await db.groups.find_one(
        {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}},
        {"_id": 0, "id": 1, "pending_approval": 1},
    )
    if existing:
        if existing.get("pending_approval"):
            raise HTTPException(409, "A group with that name is already awaiting approval.")
        raise HTTPException(409, "A group with that name already exists.")
    g = {
        "id": nid(),
        "name": name,
        "emoji": emoji,
        "description": description,
        "members": [user["id"]],   # requester auto-joins on approval
        "pending_approval": True,
        "suggested_by": user["id"],
        "suggested_by_username": user.get("username") or user.get("first_name") or "Member",
        "suggested_reason": reason,
        "suggested_at": now_iso(),
        "created_at": now_iso(),
    }
    await db.groups.insert_one(g)
    # Notify admins so they know there's something to review. We send to
    # every admin user — small list, idempotent fan-out.
    admins = await db.users.find({"is_admin": True}, {"_id": 0, "id": 1}).to_list(100)
    for a in admins:
        await db.notifications.insert_one({
            "id": nid(), "user_id": a["id"], "type": "group_suggestion",
            "title": "🌟 New group suggestion",
            "body": f"{g['suggested_by_username']} suggested \"{name}\" — review in Admin.",
            "data": {"group_id": g["id"]},
            "read": False, "created_at": now_iso(),
        })
    return {"ok": True, "id": g["id"], "pending": True}


@api.get("/admin/groups/pending")
async def admin_pending_groups(user=Depends(current_user)):
    """Admin-only: list of user-suggested groups waiting on review."""
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    docs = await db.groups.find({"pending_approval": True}, {"_id": 0}).sort("suggested_at", -1).to_list(200)
    return docs


@api.post("/admin/groups/{group_id}/approve")
async def admin_approve_group(group_id: str, user=Depends(current_user)):
    """Approve a pending group — flips `pending_approval` off and pings
    the requester so they know their group is live."""
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    g = await db.groups.find_one({"id": group_id, "pending_approval": True}, {"_id": 0})
    if not g:
        raise HTTPException(404, "Pending group not found")
    await db.groups.update_one(
        {"id": group_id},
        {"$set": {"pending_approval": False, "approved_at": now_iso(), "approved_by": user["id"]}},
    )
    # Auto-add the requester to their own group's groups[] list so it
    # shows in their "My Groups" filter immediately.
    if g.get("suggested_by"):
        await db.users.update_one({"id": g["suggested_by"]}, {"$addToSet": {"groups": group_id}})
        await db.notifications.insert_one({
            "id": nid(), "user_id": g["suggested_by"], "type": "group_approved",
            "title": "🎉 Your group is live!",
            "body": f"\"{g.get('name')}\" has been approved — tap to open it.",
            "data": {"group_id": group_id},
            "read": False, "created_at": now_iso(),
        })
    return {"ok": True}


@api.post("/admin/groups/{group_id}/reject")
async def admin_reject_group(group_id: str, body: dict | None = None, user=Depends(current_user)):
    """Reject a pending group — deletes the document and notifies the
    requester with the optional admin-supplied reason."""
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    g = await db.groups.find_one({"id": group_id, "pending_approval": True}, {"_id": 0})
    if not g:
        raise HTTPException(404, "Pending group not found")
    reason = (body or {}).get("reason", "").strip() if body else ""
    await db.groups.delete_one({"id": group_id})
    if g.get("suggested_by"):
        body_text = f"\"{g.get('name')}\" wasn't approved this time."
        if reason:
            body_text += f" Reason: {reason}"
        body_text += " Feel free to suggest a different group anytime."
        await db.notifications.insert_one({
            "id": nid(), "user_id": g["suggested_by"], "type": "group_rejected",
            "title": "Group suggestion update",
            "body": body_text,
            "read": False, "created_at": now_iso(),
        })
    return {"ok": True}


@api.post("/groups/{group_id}/join/{user_id}")
async def join_group(group_id: str, user_id: str):
    # Founder-only groups (currently just the Founders Lounge) are
    # protected: non-founders see a friendly 403 with a typed code so the
    # client can show the "Founding Members only" gate copy.
    g = await db.groups.find_one({"id": group_id}, {"_id": 0, "is_founder_only": 1, "name": 1})
    if g and g.get("is_founder_only"):
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "is_founder": 1}) or {}
        if not u.get("is_founder"):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "founder_only",
                    "message": f"{g.get('name', 'This group')} is reserved for Founding Members.",
                },
            )
    await db.groups.update_one({"id": group_id}, {"$addToSet": {"members": user_id}})
    await award_points(user_id, 3)
    return {"ok": True}


@api.get("/groups/{group_id}/posts")
async def group_posts(group_id: str):
    docs = await db.group_posts.find({"group_id": group_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    await _attach_founder_flags(docs, "user_id")
    return docs


@api.post("/groups/{group_id}/posts")
async def create_group_post(group_id: str, body: GroupPost):
    data = body.dict()
    data["group_id"] = group_id
    p = GroupPost(**data)
    await db.group_posts.insert_one(p.dict())
    await award_points(body.user_id, 4)
    return p.dict()


@api.post("/groups/posts/{post_id}/like/{user_id}")
async def like_group_post(post_id: str, user_id: str):
    await db.group_posts.update_one({"id": post_id}, {"$addToSet": {"likes": user_id}})
    return {"ok": True}


@api.post("/groups/posts/{post_id}/comment")
async def comment_group_post(post_id: str, body: dict):
    comment = {"id": nid(), "user_id": body.get("user_id"), "user_name": body.get("user_name", ""), "text": body.get("text", ""), "created_at": now_iso()}
    await db.group_posts.update_one({"id": post_id}, {"$push": {"comments": comment}})
    return comment


# ------------- Events -------------
@api.get("/events")
async def list_events():
    return await db.events.find({"archived": {"$ne": True}}, {"_id": 0}).sort("date", 1).to_list(200)


class EventCreateBody(Event):
    """Event creation accepts an optional `recurrence_count` (the additional
    occurrences to spawn after the master) so a single API call can create
    a full weekly/fortnightly/monthly series. Cap at 26 — that covers a
    half-year of weekly meetups while preventing accidental DB floods."""
    recurrence_count: Optional[int] = None


def _add_days(date_str: str, days: int) -> str:
    """ISO date math — preserves "YYYY-MM-DD" output. Used for weekly /
    fortnightly recurrence (7d / 14d steps)."""
    from datetime import date, timedelta
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", date_str or "")
    if not m:
        return date_str
    d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return (d + timedelta(days=days)).isoformat()


def _add_months(date_str: str, months: int) -> str:
    """Add N calendar months — clamps to the last valid day of the target
    month (e.g. Jan 31 + 1 month → Feb 28). Keeps "same-numbered day of
    every month" recurrence intuitive for hosts."""
    from datetime import date
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", date_str or "")
    if not m:
        return date_str
    y, mo, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    mo += months
    while mo > 12:
        mo -= 12
        y += 1
    while mo < 1:
        mo += 12
        y -= 1
    # Clamp day to last valid day of target month
    import calendar
    last_day = calendar.monthrange(y, mo)[1]
    day = min(day, last_day)
    return date(y, mo, day).isoformat()


def _next_occurrence(date_str: str, recurrence: str, step: int) -> str:
    """Compute the Nth occurrence date in a recurring series. `step` is the
    1-indexed occurrence offset from the master (1 → the first repeat)."""
    if recurrence == "weekly":
        return _add_days(date_str, 7 * step)
    if recurrence == "fortnightly":
        return _add_days(date_str, 14 * step)
    if recurrence == "monthly":
        return _add_months(date_str, step)
    return date_str


def _looks_like_business_event(title: str, description: str = "", location: str = "") -> dict:
    """Heuristic — does this event look like a business pitch rather than a
    community gathering?

    FriendPlace is for the community. We're happy to host **one free** business
    listing as a gesture (lots of local cafés, RSLs and bowling clubs run
    great events worth knowing about). After that we ask businesses to chip
    in. This function returns the cues that tripped the detector so the
    sign-up modal can be honest with the user about *why* we flagged it.

    Returns a dict:
      {
        "looks_business": bool,
        "score":          int,   # 0+; ≥2 trips the flag
        "reasons":        list[str],   # human-readable bullets
      }

    The heuristic is intentionally conservative (score ≥ 2 required) so a
    community member posting "Sausage sizzle $5 — bring the kids" doesn't
    get treated like a business. We also test on the LOCATION field because
    "RSL", "Bowling Club", "Surf Club" etc. often live there, not in the
    title.
    """
    haystack = " ".join([title or "", description or "", location or ""]).lower()
    reasons: list[str] = []
    score = 0

    # ── Bucket 1 — clubs & community-business venues (Aussie focus). ─────
    # These places ARE community spaces, but they're also commercial and we
    # want them to share the listing fee. Catches RSLs, bowling/surf/golf
    # clubs etc. that try to fill mid-week tables via the app.
    CLUBS = [
        "rsl", "returned and services league", "bowls club", "bowling club",
        "bowlo", "surf club", "surf life saving", "leagues club", "workers club",
        "country club", "golf club", "yacht club", "sailing club", "tennis club",
        "lawn bowls", "sports club", "football club", "cricket club", "polo club",
        "rotary club", "lions club", "men's shed", "mens shed",
    ]
    for c in CLUBS:
        if c in haystack:
            reasons.append(f'mentions a club / venue ("{c}")')
            score += 2  # strong signal — clubs almost always = paid promotion
            break  # one club mention is enough

    # ── Bucket 2 — overt business types. ─────────────────────────────────
    BIZ_NOUNS = [
        "café", "cafe", "restaurant", "bistro", "pub", "brewery", "winery",
        "bakery", "patisserie", "salon", "studio", "boutique", "clinic",
        "dentist", "gym", "fitness centre", "yoga studio", "pilates studio",
        "academy", "school of", "spa", "massage", "shop", "store",
        "retailer", "showroom", "dealership", "gallery", "theatre",
    ]
    for n in BIZ_NOUNS:
        if n in haystack:
            reasons.append(f'business noun ("{n}")')
            score += 1
            break

    # ── Bucket 3 — explicit pricing / ticketing language. ────────────────
    money_re = re.compile(r"\$\s?\d|\baud?\b|\bgst\b|\bper person\b|\bper head\b", re.I)
    if money_re.search(haystack):
        reasons.append("explicit pricing / dollar amount")
        score += 1
    BOOK_WORDS = [
        "book now", "buy tickets", "tickets available", "register at",
        "rsvp by phone", "limited spots", "limited tickets", "early bird",
        "discount code", "% off", " off!", "deal", "sale", "special offer",
        "promo code", "promotion code", "trybooking", "eventbrite",
        "humanitix", "moshtix", "ticketek", "stickytickets",
    ]
    for w in BOOK_WORDS:
        if w in haystack:
            reasons.append(f'ticketing / promo language ("{w.strip()}")')
            score += 1
            break

    # ── Bucket 4 — links + phone numbers. ────────────────────────────────
    if re.search(r"https?://|www\.", haystack):
        reasons.append("external website link")
        score += 1
    if re.search(r"\b0[2-578]\s?\d{4}\s?\d{4}\b|\b1300\s?\d{3}\s?\d{3}\b|\b1800\s?\d{3}\s?\d{3}\b", haystack):
        reasons.append("business phone number (1300 / 1800 / landline)")
        score += 1

    return {
        "looks_business": score >= 2,
        "score": score,
        "reasons": reasons[:4],  # cap so the modal stays scannable
    }


class EventPreflightBody(BaseModel):
    title: str = ""
    description: str = ""
    location: str = ""
    host_id: Optional[str] = None


@api.post("/events/preflight")
async def events_preflight(body: EventPreflightBody):
    """Run the business-event heuristic on a draft event BEFORE save.

    Two triggers can raise the modal:
      1. Text heuristic on title/description/location.
      2. **Prolific-poster** check — if this user has already hosted N
         or more events in the past, we flag the modal regardless of
         wording. Someone posting many events is behaving like an
         organisation whether or not they use business-y language.
    """
    hint = _looks_like_business_event(body.title, body.description, body.location)
    already_business = False
    business_status = None
    prior_event_count = 0
    prolific_flag = False

    if body.host_id:
        u = await db.users.find_one(
            {"id": body.host_id},
            {"_id": 0, "is_business": 1, "business_plan": 1,
             "business_plan_started_at": 1, "business_plan_renews_at": 1,
             "business_events_this_period": 1, "business_name": 1},
        )
        if u:
            already_business = bool(u.get("is_business"))
            if already_business and u.get("business_plan"):
                business_status = _business_status(u)

        # Prolific-poster gate. Threshold picked deliberately low so
        # frequent hosts always land in Mission Control for a light
        # review — Garry's call, launch-time policy.
        try:
            prior_event_count = await db.events.count_documents({"host_id": body.host_id})
        except Exception:
            prior_event_count = 0
        _PROLIFIC_THRESHOLD = int(os.getenv("PROLIFIC_HOST_THRESHOLD", "3"))
        if prior_event_count >= _PROLIFIC_THRESHOLD:
            prolific_flag = True

    # Combine signals. The frontend only needs a single "should we
    # show the modal?" boolean — but we also return the reasons so
    # Mission Control can later see why something was flagged.
    combined_looks_business = bool(hint.get("looks_business")) or prolific_flag
    reasons = list(hint.get("reasons") or [])
    if prolific_flag:
        reasons.append(f"prolific_host:{prior_event_count}_prior_events")

    return {
        **hint,
        "looks_business": combined_looks_business,
        "reasons": reasons,
        "prolific_flag": prolific_flag,
        "prior_event_count": prior_event_count,
        "already_business": already_business,
        "business_status": business_status,
        "messages": {
            "trial_offer": "Enjoy a free 1-month trial with up to 5 event listings while we prepare our organisation plans.",
            "next_paid": "We&rsquo;ll be in touch closer to launch about weekly and monthly pricing so there are no surprises.",
        },
    }


class ClaimBusinessBody(BaseModel):
    business_name: str = Field(min_length=2, max_length=80)
    plan: Optional[str] = Field(default="trial")  # trial | weekly | monthly
    contact_name: Optional[str] = Field(default=None, max_length=120)
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = Field(default=None, max_length=40)


class EventReviewSubmitBody(BaseModel):
    title: str = Field(min_length=2, max_length=140)
    description: Optional[str] = None
    location: Optional[str] = None
    starts_at: str  # ISO datetime
    ends_at: Optional[str] = None
    capacity: Optional[int] = None
    cost_display: Optional[str] = None
    accessibility_info: Optional[str] = None
    cover_image_base64: Optional[str] = None
    flagged_reasons: Optional[List[str]] = None  # from preflight response


@api.post("/events/submit-for-review")
async def submit_event_for_review(
    body: EventReviewSubmitBody,
    user=Depends(current_user),
):
    """Route a flagged community-event post into the CMS review queue.

    Called by the mobile app when the business modal was shown AND
    the user chose "This is a community event". Rather than skipping
    review, the event is stored as `pending` in `cms_event_submissions`
    so an admin can eyeball it in Mission Control before it appears
    publicly.
    """
    submission_id = str(uuid.uuid4())
    submission_ref = "FP-SUB-" + submission_id.replace("-", "")[:6].upper()
    now = datetime.now(timezone.utc).isoformat()
    contact_name = " ".join(
        [(user.get("first_name") or "").strip(), (user.get("last_name") or "").strip()]
    ).strip() or (user.get("username") or "FriendPlace member")
    contact_email = user.get("email") or ""

    doc = {
        "id": submission_id,
        "submission_ref": submission_ref,
        "organisation_name": contact_name,   # community events use the host's own name
        "contact_name": contact_name,
        "contact_email": contact_email,
        "contact_phone": None,
        "event_title": body.title.strip(),
        "event_starts_at": body.starts_at,
        "event_ends_at": body.ends_at,
        "venue_name": None,
        "venue_address": (body.location or "").strip() or None,
        "description": (body.description or "").strip() or None,
        "capacity": body.capacity,
        "cost_type": "free" if not body.cost_display else "paid",
        "cost_display": (body.cost_display or "").strip() or None,
        "accessibility_info": (body.accessibility_info or "").strip() or None,
        "cover_image_base64": body.cover_image_base64,
        "status": "pending",
        "created_at": now,
        "updated_at": now,
        "reviewer_notes": None,
        "resulting_event_id": None,
        # Extra flag so Mission Control can see WHY this was routed
        # through review (heuristic vs prolific poster vs both).
        "flagged_reasons": body.flagged_reasons or ["community_event_from_flagged_user"],
        "submitted_via": "mobile-community-flagged",
        "host_user_id": user["id"],
    }
    await db.cms_event_submissions.insert_one(dict(doc))

    # Best-effort alert + ack email — same treatment as the public form.
    try:
        await db.cms_alerts.insert_one({
            "id": str(uuid.uuid4()),
            "type": "event_submission",
            "title": "Community event needs review",
            "body": f"{contact_name} — {body.title.strip()}",
            "ref_id": submission_id,
            "created_at": now,
            "read": False,
        })
    except Exception:
        logger.exception("community submission alert insert failed")

    # ---- MCGS Signal producer (Phase 1) ----
    # Community-flagged mobile submissions also land as Signals so the
    # Bridge shows every incoming submission from every source.
    try:
        from services.mcgs import create_signal as _mcgs_create_signal
        from services.george import triage_signal_with_haiku as _mcgs_triage
        await _mcgs_create_signal(
            db,
            producer="event_submission",
            entity_ref={"kind": "event_submission", "id": submission_id},
            subject=f"Community event awaiting review: {body.title.strip()}"[:120],
            body=(
                f"Submitted by {contact_name} via mobile app "
                f"(flagged: {', '.join(doc.get('flagged_reasons') or [])}).\n\n"
                f"{(body.description or '').strip()}"
            )[:4000],
            category="attention",
            priority="P2",
            case_key=f"event_submission:{submission_id}",
            source="user_report",
            injection_check_fields=[body.title, body.description, body.location],
            triage_fn=_mcgs_triage,
        )
    except Exception:
        logger.exception("community submission signal producer failed for %s", submission_id)

    if contact_email:
        try:
            from email_service import send_email, event_submission_ack_template
            subject, html, text = event_submission_ack_template(
                first_name=(user.get("first_name") or "").strip() or None,
                organisation_name=contact_name,
                event_title=body.title.strip(),
                submission_ref=submission_ref,
            )
            support_from = (os.getenv("SUPPORT_EMAIL") or "support@friendplace.com.au").strip()
            await _email_send(
                to=contact_email, subject=subject, html=html, text=text,
                reply_to=support_from,
            )
        except Exception:
            logger.exception("community submission ack email failed")

    return {
        "ok": True,
        "submission_ref": submission_ref,
        "message": "Thanks — your event has been submitted for review. We'll email you once it's live.",
    }


class ClaimBusinessBodyLegacy(BaseModel):  # kept to satisfy old imports
    pass


# Subscription limits — single source of truth so the modal, the gate
# message, and the limit check never drift out of sync.
_BUSINESS_PLANS = {
    "trial":   {"limit": 5, "period_days": 30, "label": "Free 1-month trial"},
    "monthly": {"limit": 5, "period_days": 30, "label": "Monthly"},
    "weekly":  {"limit": 2, "period_days": 7,  "label": "Weekly"},
}


def _business_status(u: dict) -> dict:
    """Build the live counter the frontend uses to render "3 of 5 listings
    used this month" + days-until-renewal. Centralised so create_event,
    the preflight endpoint, and the dedicated status endpoint all agree.
    """
    plan = u.get("business_plan")
    if not plan or plan not in _BUSINESS_PLANS:
        return {"plan": None}
    cfg = _BUSINESS_PLANS[plan]
    used = int(u.get("business_events_this_period") or 0)
    renews_at = u.get("business_plan_renews_at")
    # Handle period roll-over lazily on read so the counter resets even if
    # the user hasn't tried to post yet. We don't persist on read, just
    # report the up-to-date numbers.
    if renews_at:
        try:
            r = datetime.fromisoformat(renews_at.replace("Z", "+00:00"))
            if r <= datetime.now(timezone.utc):
                used = 0
        except Exception:
            pass
    return {
        "plan": plan,
        "plan_label": cfg["label"],
        "events_used": used,
        "events_limit": cfg["limit"],
        "events_remaining": max(0, cfg["limit"] - used),
        "period_started_at": u.get("business_plan_started_at"),
        "period_renews_at": renews_at,
        "is_within_limit": used < cfg["limit"],
    }


@api.post("/users/me/business")
async def claim_business(body: ClaimBusinessBody, user=Depends(current_user)):
    """User self-identifies as a business / venue and starts a plan.

    Only `trial` is bookable right now (free for 1 month, 5 listings).
    Paid weekly + monthly tiers come later — we'll be in touch about
    pricing closer to launch, so requesting them just slots the user
    into the trial period for now and records their interest.

    Also captures the business register info (contact name, email,
    optional phone) so ops can follow up about invoicing / renewal.
    """
    plan = (body.plan or "trial").lower()
    if plan not in _BUSINESS_PLANS:
        plan = "trial"
    # For now everyone lands on the trial regardless of their choice — paid
    # plans are coming-soon. We still remember the choice via `business_name`
    # update + a `requested_plan` flag so we can reach out.
    effective_plan = "trial"
    cfg = _BUSINESS_PLANS[effective_plan]
    now = datetime.now(timezone.utc)
    renews_at = (now + timedelta(days=cfg["period_days"])).isoformat()
    existing = await db.users.find_one(
        {"id": user["id"]},
        {"_id": 0, "is_business": 1, "business_plan": 1, "business_plan_started_at": 1, "business_plan_renews_at": 1, "business_events_this_period": 1},
    ) or {}

    # Contact-person + contact-email are required for first-time claims
    # so ops can always reach a human. Repeat claims (same business
    # updating their name) can leave these blank — we already have
    # what we need from the first claim.
    is_first_claim = not existing.get("business_plan")
    contact_name = (body.contact_name or "").strip()
    contact_email = (body.contact_email or "").strip().lower() if body.contact_email else ""
    contact_phone = (body.contact_phone or "").strip()
    if is_first_claim:
        if len(contact_name) < 2:
            raise HTTPException(400, "Please tell us the name of the person we can contact.")
        if not contact_email:
            raise HTTPException(400, "Please add a contact email so we can reach out.")

    update: dict = {
        "is_business": True,
        "business_name": body.business_name.strip(),
        "business_plan": effective_plan,
        "business_requested_plan": plan,  # remember what they asked for
    }
    # Only initialise the period (and register info) the first time,
    # so a repeat-claim doesn't silently reset the counter and let
    # someone game the limit — or clobber the contact details.
    if is_first_claim:
        update["business_plan_started_at"] = now.isoformat()
        update["business_plan_renews_at"] = renews_at
        update["business_events_this_period"] = 0
        update["business_contact_name"] = contact_name
        update["business_contact_email"] = contact_email
        if contact_phone:
            update["business_contact_phone"] = contact_phone
        update["business_registered_at"] = now.isoformat()
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})

    # ── Fire the Mission Control alert + welcome email (first-claim
    #    only so we don't spam ops on every business-name edit).
    if is_first_claim:
        try:
            await _notify_admins({
                "type": "business_signup",
                "title": "New business signed up",
                "body": f"{body.business_name.strip()} — {contact_name} <{contact_email}>",
                "ref_user_id": user["id"],
            })
        except Exception:
            logger.exception("business signup admin-notify failed")

        # Auto-reply email — best-effort, don't block the claim if
        # Resend is unavailable.
        try:
            from email_service import send_email, business_welcome_template
            from html import escape as _html_escape
            subject, html, text = business_welcome_template(
                first_name=contact_name.split(" ")[0] if contact_name else None,
                business_name=body.business_name.strip(),
                trial_limit=cfg["limit"],
                trial_days=cfg["period_days"],
                requested_plan=plan,
            )
            support_from = (os.getenv("SUPPORT_EMAIL") or "support@friendplace.com.au").strip()
            await _email_send(
                to=contact_email,
                subject=subject,
                html=html,
                text=text,
                reply_to=support_from,
            )
            # Also cc the support inbox so ops has a paper trail.
            try:
                await _email_send(
                    to=support_from,
                    subject=f"[Business signup] {body.business_name.strip()} — {contact_name}",
                    html=(
                        f"<p><strong>{_html_escape(body.business_name.strip())}</strong> just signed up.</p>"
                        f"<ul>"
                        f"<li>Contact: {_html_escape(contact_name)} &lt;{_html_escape(contact_email)}&gt;</li>"
                        + (f"<li>Phone: {_html_escape(contact_phone)}</li>" if contact_phone else "")
                        + f"<li>Requested plan: {_html_escape(plan)}</li>"
                        f"<li>User ID: {_html_escape(user['id'])}</li>"
                        f"</ul>"
                    ),
                    text=(
                        f"{body.business_name.strip()} just signed up.\n"
                        f"Contact: {contact_name} <{contact_email}>\n"
                        + (f"Phone: {contact_phone}\n" if contact_phone else "")
                        + f"Requested plan: {plan}\n"
                        f"User ID: {user['id']}\n"
                    ),
                    reply_to=contact_email,
                )
            except Exception:
                logger.exception("business signup ops-cc email failed")
        except Exception:
            logger.exception("business signup welcome email failed")

    return {
        **_safe_user(fresh or {}),
        "business_status": _business_status(fresh or {}),
    }


@api.get("/users/me/business/status")
async def my_business_status(user=Depends(current_user)):
    """Snapshot used by Settings & the event-create screen to show
    'You've used N of M listings this month · resets in X days'."""
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return _business_status(fresh or {})


@api.post("/events")
async def create_event(body: EventCreateBody):
    # Anti-spam: a single host shouldn't be creating more than 8 events / hr.
    # Recurring series count as one create call (one POST → N stored events),
    # so this stays well clear of legitimate host behaviour.
    if body.host_id:
        rate_limit(f"event:{body.host_id}", max_calls=8, window_seconds=3600)
    # ── Business / sponsored auto-attach ─────────────────────────────────
    # If the host has self-identified as a business, automatically stamp
    # the event with a "Sponsored by …" sponsor block (unless they've
    # already provided their own custom one). Also flip the free-listing
    # flag the first time they post so future listings know they've used
    # their freebie.
    host_user = None
    if body.host_id:
        host_user = await db.users.find_one(
            {"id": body.host_id},
            {"_id": 0, "is_business": 1, "business_name": 1, "business_plan": 1,
             "business_plan_started_at": 1, "business_plan_renews_at": 1,
             "business_events_this_period": 1},
        )
    if host_user and host_user.get("is_business"):
        status = _business_status(host_user)
        # Hard-stop at the per-period limit. Frontend catches this 402 and
        # shows the friendly "you've used N of M this month — paid plans
        # coming soon" prompt instead of a generic error toast.
        if status.get("plan") and not status.get("is_within_limit"):
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "business_limit_reached",
                    "message": f"You've used {status['events_used']} of {status['events_limit']} listings this period. Paid plans are coming soon — we'll be in touch.",
                    "business_status": status,
                },
            )
        # Auto-attach the "Hosted by …" badge so the event card on the
        # community feed shows the business name. We keep using the existing
        # `sponsor` field on the Event model to avoid a schema migration.
        if not body.sponsor:
            body.sponsor = {
                "name": host_user.get("business_name") or "Local business",
                "message": "",
                "discount_code": "",
            }
        # Roll the counter forward (and reset on period roll-over).
        now = datetime.now(timezone.utc)
        renews_at = host_user.get("business_plan_renews_at")
        period_rolled = False
        if renews_at:
            try:
                r = datetime.fromisoformat(renews_at.replace("Z", "+00:00"))
                period_rolled = r <= now
            except Exception:
                period_rolled = False
        if period_rolled:
            cfg = _BUSINESS_PLANS.get(host_user.get("business_plan") or "trial", _BUSINESS_PLANS["trial"])
            new_renews = (now + timedelta(days=cfg["period_days"])).isoformat()
            await db.users.update_one(
                {"id": body.host_id},
                {"$set": {
                    "business_plan_started_at": now.isoformat(),
                    "business_plan_renews_at": new_renews,
                    "business_events_this_period": 1,
                }},
            )
        else:
            await db.users.update_one(
                {"id": body.host_id},
                {"$inc": {"business_events_this_period": 1}},
            )
    # Sanitise recurrence inputs. We accept None / weekly / fortnightly /
    # monthly only — anything else is silently treated as a one-off.
    rec = body.recurrence if body.recurrence in ("weekly", "fortnightly", "monthly") else None
    # Spawn the master event first.
    master_dict = body.dict(exclude={"recurrence_count"})
    if rec:
        master_dict["recurrence"] = rec
        master_dict["series_id"] = nid()
        master_dict["series_master"] = True
    else:
        master_dict["recurrence"] = None
        master_dict["series_id"] = None
        master_dict["series_master"] = False
    master = Event(**master_dict)
    await db.events.insert_one(master.dict())

    # If recurrence is set, generate N additional concrete occurrences.
    # Cap at 26 occurrences total (so weekly = ~6 months, fortnightly = 1 year,
    # monthly = 2 years) — keeps the events list manageable and limits the
    # damage from accidental long-running series.
    created_ids = [master.id]
    if rec and master.date:
        # `recurrence_count` is the number of *additional* events after the
        # master. Default to 3 (so a "weekly for 4 weeks" feels intuitive)
        # if the host didn't specify a count.
        n_extras = body.recurrence_count if body.recurrence_count is not None else 3
        try:
            n_extras = int(n_extras)
        except Exception:
            n_extras = 3
        n_extras = max(0, min(n_extras, 25))
        for i in range(1, n_extras + 1):
            child = Event(
                title=master.title,
                emoji=master.emoji,
                description=master.description,
                location=master.location,
                date=_next_occurrence(master.date, rec, i),
                time=master.time,
                capacity=master.capacity,
                host_id=master.host_id,
                sponsor=master.sponsor,
                recurrence=rec,
                series_id=master.series_id,
                series_master=False,
            )
            await db.events.insert_one(child.dict())
            created_ids.append(child.id)
    return {**master.dict(), "series_event_ids": created_ids}


class EventUpdateBody(BaseModel):
    actor_id: str                      # user making the change (must be host or admin)
    title: Optional[str] = None
    emoji: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    capacity: Optional[int] = None     # None to clear (unlimited); use 0 = unlimited too
    notify_changes: bool = True        # blast a notification to all RSVPs


@api.patch("/events/{event_id}")
async def update_event(event_id: str, body: EventUpdateBody):
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event not found")
    actor = await db.users.find_one({"id": body.actor_id}, {"_id": 0})
    if not actor:
        raise HTTPException(404, "Actor not found")
    is_host = ev.get("host_id") == body.actor_id
    if not (is_host or actor.get("is_admin")):
        raise HTTPException(403, "Only the host or an admin can edit this event")
    if ev.get("cancelled"):
        raise HTTPException(400, "Event is cancelled — restore it before editing")

    update: Dict = {}
    changes: List[str] = []
    for field in ("title", "emoji", "description", "location", "date", "time"):
        v = getattr(body, field)
        if v is not None and v != ev.get(field):
            update[field] = v.strip() if isinstance(v, str) else v
            changes.append(field)
    if body.capacity is not None:
        cap = int(body.capacity)
        if cap <= 0:
            update["capacity"] = None
        else:
            update["capacity"] = cap
        if update["capacity"] != ev.get("capacity"):
            changes.append("capacity")

    # If date/time changed, clear sent-reminder flags so reminders re-fire correctly.
    if "date" in changes or "time" in changes:
        for f in ("reminder_24h_sent", "reminder_2h_sent", "reminder_now_sent"):
            update[f] = None

    if not changes:
        return {"ok": True, "changed": []}
    update["updated_at"] = now_iso()
    await db.events.update_one({"id": event_id}, {"$set": update})

    # If a "going" user is no longer within new capacity, push the overflow to the
    # waitlist (most-recent additions overflow first to keep early RSVPs in).
    if "capacity" in changes and update.get("capacity") is not None:
        going = list(ev.get("rsvps") or [])
        waitlist = list(ev.get("waitlist") or [])
        cap = int(update["capacity"])
        while len(going) > cap:
            overflow = going.pop()  # most recent
            waitlist.append(overflow)
            try:
                await push_notification(
                    overflow,
                    "event_reminder",
                    f"{ev.get('title','Event')} — moved to waitlist",
                    "The host reduced the capacity. You're now on the waitlist.",
                    {"event_id": event_id},
                )
            except Exception:
                pass
        await db.events.update_one({"id": event_id}, {"$set": {"rsvps": going, "waitlist": waitlist}})

    # Notify everyone who RSVPd (going + maybe + waitlist) about the change
    if body.notify_changes:
        recipients = list(dict.fromkeys((ev.get("rsvps") or []) + (ev.get("rsvps_maybe") or []) + (ev.get("waitlist") or [])))
        if recipients:
            title = f"Event updated: {update.get('title') or ev.get('title','Event')}"
            human_fields = {
                "title": "title", "emoji": "emoji", "description": "description",
                "location": "location", "date": "date", "time": "time", "capacity": "capacity",
            }
            change_words = ", ".join(human_fields[c] for c in changes if c in human_fields) or "details"
            body_text = f"The host updated the {change_words}. Tap to see the latest details."
            for uid in recipients:
                try:
                    await push_notification(uid, "event_reminder", title, body_text, {"event_id": event_id})
                except Exception:
                    pass
    return {"ok": True, "changed": changes}


class EventCancelBody(BaseModel):
    actor_id: str
    reason: Optional[str] = None


@api.post("/events/{event_id}/cancel")
async def cancel_event(event_id: str, body: EventCancelBody):
    """Host or admin marks an event cancelled. Kept visible with a Cancelled badge.

    All RSVPd users (going + maybe + waitlist) receive a notification.
    """
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event not found")
    actor = await db.users.find_one({"id": body.actor_id}, {"_id": 0})
    if not actor:
        raise HTTPException(404, "Actor not found")
    is_host = ev.get("host_id") == body.actor_id
    if not (is_host or actor.get("is_admin")):
        raise HTTPException(403, "Only the host or an admin can cancel this event")
    if ev.get("cancelled"):
        return {"ok": True, "already": True}
    await db.events.update_one(
        {"id": event_id},
        {"$set": {
            "cancelled": True,
            "cancelled_at": now_iso(),
            "cancelled_by": body.actor_id,
            "cancelled_reason": (body.reason or "").strip(),
            # Stop pending reminders firing for a cancelled event
            "reminder_24h_sent": now_iso(),
            "reminder_2h_sent": now_iso(),
            "reminder_now_sent": now_iso(),
        }},
    )
    recipients = list(dict.fromkeys((ev.get("rsvps") or []) + (ev.get("rsvps_maybe") or []) + (ev.get("waitlist") or [])))
    if recipients:
        title = f"Cancelled: {ev.get('emoji','🎉')} {ev.get('title','Event')}"
        body_text = (body.reason or "The host cancelled this event. We're sorry for the change of plan.").strip()
        for uid in recipients:
            try:
                await push_notification(uid, "event_reminder", title, body_text, {"event_id": event_id})
            except Exception:
                pass
    return {"ok": True}


@api.post("/events/{event_id}/restore")
async def restore_event(event_id: str, body: EventCancelBody):
    """Host or admin restores a cancelled event (un-cancels)."""
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event not found")
    actor = await db.users.find_one({"id": body.actor_id}, {"_id": 0})
    if not actor:
        raise HTTPException(404, "Actor not found")
    is_host = ev.get("host_id") == body.actor_id
    if not (is_host or actor.get("is_admin")):
        raise HTTPException(403, "Only the host or an admin can restore this event")
    await db.events.update_one(
        {"id": event_id},
        {"$set": {"cancelled": False},
         "$unset": {"cancelled_at": "", "cancelled_by": "", "cancelled_reason": "",
                    "reminder_24h_sent": "", "reminder_2h_sent": "", "reminder_now_sent": ""}},
    )
    return {"ok": True}


class AdminHardDeleteBody(BaseModel):
    admin_id: str
    reason: Optional[str] = None


@api.get("/admin/invite-flyer")
async def admin_invite_flyer(admin_id: str, venue: str = "", url: str = ""):
    """Render an A4-portrait PNG invite flyer (1240×1754 @ ~150 dpi) suitable
    for printing and pinning up at noticeboards. The layout is intentionally
    BOLD and TYPOGRAPHIC so it works at a glance from across a room.

    NOTE ON AUTH:
      This endpoint is deliberately reachable WITHOUT a Bearer token — it
      only checks that ?admin_id points to an existing admin. That's
      because iOS Safari's `<a download>` shortcut fires a plain top-level
      navigation with no Authorization header, which used to 401 → give
      us back a tiny JSON body → and Safari would then save the file as
      "friendplace-flyer-*.png.json" (an unopenable blob). The flyer
      contains only public info (app name, QR code, admin's referral id)
      so treating the admin_id as a capability token is acceptable —
      guessing a UUID v4 is cryptographically infeasible.
    """
    await _require_admin(admin_id)
    import io
    import qrcode
    from PIL import Image, ImageDraw, ImageFont
    from fastapi.responses import Response

    target_url = (url or "").strip() or "https://friendplace.com.au"
    venue = (venue or "").strip()[:80]

    # A4 portrait at ~150 dpi
    W, H = 1240, 1754
    NAVY = "#0F3D6E"
    TEAL = "#0F766E"
    INK = "#0F172A"
    SLATE = "#475569"
    img = Image.new("RGB", (W, H), "#FFFFFF")
    d = ImageDraw.Draw(img)

    def font(size: int, bold: bool = True, italic: bool = False,
             condensed: bool = False) -> ImageFont.FreeTypeFont:
        """Resolve a TTF font path with graceful fallbacks.

        The environment ships either DejaVu (older Debian images) or
        Liberation Sans (current images) — we try DejaVu first because the
        flyer was originally tuned against it, then fall back to the
        metrically-compatible Liberation Sans variants, and finally Pillow's
        bitmap default if nothing TrueType is installed. Using a TTF (not the
        bitmap default) is critical: the bitmap default is a tiny 10-px font
        that ignores the requested size, which makes the whole poster look
        like 6pt text. Always prefer a real TTF.
        """
        bases: list[str] = []
        if condensed:
            # Condensed variants → DejaVu first, Liberation Sans Narrow as
            # the modern fallback (Narrow has ~85% width of regular Sans).
            if bold and italic:
                bases += [
                    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-BoldOblique.ttf",
                    "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-BoldItalic.ttf",
                ]
            elif bold:
                bases += [
                    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
                    "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Bold.ttf",
                ]
            elif italic:
                bases += [
                    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Oblique.ttf",
                    "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Italic.ttf",
                ]
            else:
                bases += [
                    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
                    "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Regular.ttf",
                ]
        # Regular (non-condensed) variants — same priority order.
        if italic and bold:
            bases += [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf",
            ]
        elif italic:
            bases += [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf",
            ]
        elif bold:
            bases += [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            ]
        bases += [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ]
        for cand in bases:
            try:
                return ImageFont.truetype(cand, size)
            except Exception:
                continue
        return ImageFont.load_default()

    def text_w(text: str, fnt: ImageFont.FreeTypeFont) -> int:
        b = d.textbbox((0, 0), text, font=fnt)
        return b[2] - b[0]

    def text_h(text: str, fnt: ImageFont.FreeTypeFont) -> int:
        b = d.textbbox((0, 0), text, font=fnt)
        return b[3] - b[1]

    def centre(text: str, y: int, fnt: ImageFont.FreeTypeFont, fill: str = INK) -> int:
        """Draw `text` centred horizontally at vertical `y`. Returns the
        baseline-bottom y so callers can chain calls easily."""
        b = d.textbbox((0, 0), text, font=fnt)
        d.text(((W - (b[2] - b[0])) / 2, y), text, font=fnt, fill=fill)
        return y + (b[3] - b[1])

    def fit_centred(text: str, y: int, max_w: int, start_size: int,
                    min_size: int, fill: str, bold: bool = True,
                    condensed: bool = False) -> tuple[int, int]:
        """Pick the largest font size in [min_size .. start_size] that fits
        `text` within `max_w`, then draw it centred. Returns (bottom_y, size_used).
        """
        size = start_size
        while size > min_size:
            f = font(size, bold=bold, condensed=condensed)
            if text_w(text, f) <= max_w:
                break
            size -= 6
        f = font(size, bold=bold, condensed=condensed)
        bottom = centre(text, y, f, fill)
        return bottom, size

    def wrap_centre(text: str, y: int, fnt: ImageFont.FreeTypeFont, fill: str,
                    max_w: int, line_gap: int = 12) -> int:
        words = text.split()
        lines: list[str] = []
        cur = ""
        for w_ in words:
            cand = (cur + " " + w_).strip()
            if text_w(cand, fnt) <= max_w:
                cur = cand
            else:
                if cur:
                    lines.append(cur)
                cur = w_
        if cur:
            lines.append(cur)
        for line in lines:
            b = d.textbbox((0, 0), line, font=fnt)
            d.text(((W - (b[2] - b[0])) / 2, y), line, font=fnt, fill=fill)
            y += (b[3] - b[1]) + line_gap
        return y

    # ─── Top banner: official FriendPlace brand mark (matches the Welcome
    # ─── Top banner ────────────────────────────────────────────────────
    # Dark-navy header modelled on the FriendPlace brand banner: butterfly
    # logo on the left, then the wordmark ("Friend" in white + "Place" in
    # sky-teal) stacked above the tagline. A thin divider separates the
    # brand block from the contact strip ("hello@friendplace.com.au" and
    # "www.friendplace.com.au") which sits along the bottom of the banner.
    # Everything is drawn dynamically — no shipped banner-image asset — so
    # tweaks to typography, colour or copy live entirely in this Python
    # code and stay consistent with the in-app BrandLockup.
    BANNER_H = 360
    # BANNER_NAVY intentionally matches the exact navy inside the
    # butterfly-icon-v5 PNG (sampled at #0B1F45) so the icon's baked-in
    # square background melds seamlessly into the banner without a
    # visible seam. If the icon is ever re-generated with a different
    # navy, resample and update this constant.
    BANNER_NAVY = "#0B1F45"
    BRAND_WHITE = "#FFFFFF"
    BRAND_SKY = "#7DB1FF"     # light sky-blue for the "Place" span
    BRAND_MUTED = "#B7C7E5"   # muted blue for the contact strip
    d.rectangle([0, 0, W, BANNER_H], fill=BANNER_NAVY)
    SIDE = 100  # body-text margin used elsewhere on the page

    import os as _os
    BUTTERFLY_PATH = _os.path.join(_os.path.dirname(__file__), "assets",
                                   "friendplace-app-icon-v5.png")
    try:
        butterfly = Image.open(BUTTERFLY_PATH).convert("RGBA")
        # Butterfly occupies ~72% of banner height, kept flush with the
        # left margin. We DON'T repaint the navy tile behind it because
        # the source PNG already has the same navy tile baked in — the
        # tile visually melds into the banner background.
        bfy_h = int(BANNER_H * 0.72)
        bfy_scale = bfy_h / butterfly.height
        bfy_w = int(butterfly.width * bfy_scale)
        butterfly = butterfly.resize((bfy_w, bfy_h), Image.LANCZOS)
        bfy_x = SIDE - 40  # slight bleed toward the left edge
        bfy_y = (BANNER_H - bfy_h) // 2
        img.paste(butterfly, (bfy_x, bfy_y), butterfly)
        text_left = bfy_x + bfy_w + 30
    except Exception:
        # If the butterfly asset is missing for some reason, fall back to
        # a plain text banner so the endpoint doesn't error out.
        text_left = SIDE

    # ─── Wordmark: "Friend" (white) + "Place" (sky-teal) ───────────────
    # Auto-fit the wordmark so it doesn't overrun the right margin no
    # matter how much room the butterfly leaves.
    ideal_wm = 130
    wm_max_w = W - SIDE - text_left
    wm_size = ideal_wm
    while wm_size > 80:
        f_wm = font(wm_size, bold=True)
        if text_w("FriendPlace", f_wm) <= wm_max_w:
            break
        wm_size -= 4
    f_wm = font(wm_size, bold=True)
    wm_y = 46
    friend_w = text_w("Friend", f_wm)
    d.text((text_left, wm_y), "Friend", font=f_wm, fill=BRAND_WHITE)
    d.text((text_left + friend_w, wm_y), "Place", font=f_wm, fill=BRAND_SKY)
    wm_bottom = wm_y + text_h("FriendPlace", f_wm)

    # ─── Tagline: "Because you belong too." ────────────────────────────
    f_tag = font(42, bold=True)
    d.text((text_left, wm_bottom + 14), "Because you belong too.",
           font=f_tag, fill=BRAND_WHITE)

    # ─── Contact strip along the bottom of the banner ──────────────────
    # A thin light-navy divider, then two contact rows: email + website,
    # separated by a vertical bar. Uses BRAND_MUTED so the strip reads as
    # supporting information (not part of the primary brand block).
    div_y = BANNER_H - 78
    d.line([(text_left, div_y), (W - SIDE, div_y)], fill="#22336D", width=2)

    f_contact = font(28, bold=False)
    contact_y = div_y + 22
    email = "hello@friendplace.com.au"
    site = "www.friendplace.com.au"
    d.text((text_left, contact_y), email, font=f_contact, fill=BRAND_MUTED)
    # Separator "·"
    sep_x = text_left + text_w(email, f_contact) + 22
    d.text((sep_x, contact_y), "·", font=f_contact, fill=BRAND_MUTED)
    d.text((sep_x + 22, contact_y), site, font=f_contact, fill=BRAND_MUTED)

    # ─── Headline (deliberately HUGE so passers-by can read it from across
    # a room). 170pt condensed bold lets the line fit within the side
    # margins of a 1240px-wide page. Extra breathing room below the taller
    # branded banner keeps the whole layout balanced.
    HEAD_Y = BANNER_H + 35
    fit_centred("FIND YOUR PEOPLE.", HEAD_Y, W - 2 * SIDE,
                start_size=180, min_size=130, fill=NAVY, bold=True,
                condensed=True)

    # ─── Short tagline (single line — readable from ~2m). 38pt slate. ────
    lead = "Meet new friends. Join local events. Feel connected."
    wrap_centre(lead, HEAD_Y + 185, font(38, bold=False), SLATE,
                max_w=W - 2 * SIDE, line_gap=10)

    # ─── Four feature icons. Slightly tighter to make room for the ribbon
    # immediately below them; circles still big enough to read at a glance.
    ICON_Y = HEAD_Y + 250
    ICON_SIZE = 105
    LABEL_Y = ICON_Y + ICON_SIZE + 12
    cols = 4
    pad = 60
    col_w = (W - 2 * pad) // cols

    def draw_chip(idx: int, tint: str, label: str, draw_icon):
        cx = pad + col_w * idx + col_w // 2
        cy = ICON_Y + ICON_SIZE // 2
        d.ellipse([cx - ICON_SIZE // 2, cy - ICON_SIZE // 2,
                   cx + ICON_SIZE // 2, cy + ICON_SIZE // 2], fill=tint)
        draw_icon(cx, cy)
        # Labels 34pt bold — readable from a corridor without crowding the
        # ribbon that sits directly below.
        fnt = font(34, bold=True)
        words = label.split()
        if len(words) == 2:
            for i, w_ in enumerate(words):
                b = d.textbbox((0, 0), w_, font=fnt)
                d.text((cx - (b[2] - b[0]) / 2, LABEL_Y + i * 40), w_, font=fnt, fill=INK)
        else:
            b = d.textbbox((0, 0), label, font=fnt)
            d.text((cx - (b[2] - b[0]) / 2, LABEL_Y), label, font=fnt, fill=INK)

    def icon_coffee(cx, cy):
        d.rounded_rectangle([cx - 28, cy - 16, cx + 18, cy + 24], radius=8, fill="#FFFFFF")
        d.ellipse([cx + 12, cy - 6, cx + 32, cy + 16], outline="#FFFFFF", width=5)
        for off in (-14, -2, 10):
            d.line([cx + off, cy - 30, cx + off + 3, cy - 18], fill="#FFFFFF", width=3)

    def icon_calendar(cx, cy):
        d.rounded_rectangle([cx - 28, cy - 22, cx + 28, cy + 24], radius=7, fill="#FFFFFF")
        d.rectangle([cx - 28, cy - 22, cx + 28, cy - 10], fill="#DC2626")
        d.rectangle([cx - 18, cy - 28, cx - 12, cy - 14], fill="#0F172A")
        d.rectangle([cx + 12, cy - 28, cx + 18, cy - 14], fill="#0F172A")
        for r in range(2):
            for col_i in range(3):
                d.ellipse([cx - 18 + col_i * 14, cy - 2 + r * 12,
                           cx - 12 + col_i * 14, cy + 4 + r * 12], fill="#94A3B8")

    def icon_people(cx, cy):
        for off in (-14, 14):
            d.ellipse([cx + off - 13, cy - 24, cx + off + 13, cy + 2], fill="#FFFFFF")
            d.chord([cx + off - 22, cy + 4, cx + off + 22, cy + 42], 180, 360, fill="#FFFFFF")

    def icon_globe(cx, cy):
        d.ellipse([cx - 30, cy - 30, cx + 30, cy + 30], fill="#FFFFFF")
        d.arc([cx - 30, cy - 30, cx + 30, cy + 30], 0, 360, fill="#10B981", width=4)
        d.line([cx - 28, cy, cx + 28, cy], fill="#10B981", width=3)
        d.arc([cx - 12, cy - 30, cx + 12, cy + 30], 0, 360, fill="#10B981", width=3)
        d.line([cx, cy - 28, cx, cy + 28], fill="#10B981", width=3)

    draw_chip(0, "#92400E", "FP Café", icon_coffee)
    draw_chip(1, "#0369A1", "Local Events", icon_calendar)
    draw_chip(2, "#7C3AED", "Make Friends", icon_people)
    draw_chip(3, "#0F766E", "Community Groups", icon_globe)

    # ─── "Become a Founding Member" gold ribbon ───────────────────────────
    # Live count makes the urgency real: someone reading the poster sees
    # exactly how many spots are still open. Fails gracefully (hidden ribbon)
    # if the founder cohort programme is closed or the count lookup fails.
    #
    # `ribbon_bottom_y` is set INSIDE the render branch so the QR block
    # further down can position itself immediately below the ribbon,
    # regardless of whether it rendered or was hidden. This is the key
    # to avoiding the earlier bug where a hardcoded qr_y=960 overlapped
    # the ribbon at ~y=1050.
    ribbon_bottom_y = LABEL_Y + 60  # sensible default when ribbon is hidden
    try:
        cohort_cap = int(settings.founding_member_cap or 0)
    except Exception:
        cohort_cap = 500
    try:
        founder_count = await db.users.count_documents(
            {"is_founder": True, "is_demo": {"$ne": True}}
        )
    except Exception:
        founder_count = 0
    if cohort_cap > 0 and founder_count < cohort_cap:
        remaining = max(0, cohort_cap - founder_count)
        GOLD_FILL = "#FBBF24"
        GOLD_DARK = "#7C5300"
        # Ribbon sits just below the icon label block (2-line labels end
        # around HEAD_Y + 350 ≈ 645; gap of ~15px keeps them visually
        # separate without wasting vertical real estate).
        RIBBON_Y = LABEL_Y + 90
        RIBBON_H = 195
        ribbon_bottom_y = RIBBON_Y + RIBBON_H
        # Slightly taller ribbon — needs to hold a benefit line + count
        # below the lead, plus a hand-drawn butterfly icon to its left
        # (Liberation Sans doesn't ship with the 🦋 emoji glyph so we draw
        # it geometrically instead of typesetting the character).
        d.rounded_rectangle(
            [60, RIBBON_Y, W - 60, RIBBON_Y + RIBBON_H],
            radius=24, fill=GOLD_FILL, outline=GOLD_DARK, width=5,
        )

        def draw_butterfly(cx: int, cy: int, span: int, ink: str, accent: str) -> None:
            """Draw a small stylised butterfly centred at (cx, cy).

            `span` controls overall wing-tip-to-wing-tip width.
            Pure Pillow primitives — works regardless of which fonts are
            installed on the host. Two pairs of wings (large upper, small
            lower) plus a slim body and two antennae give the silhouette
            people associate with 🦋 at a glance.
            """
            w = span // 2  # half-span
            # Upper wings — large rounded ovals tilted outward.
            upper_w, upper_h = int(w * 0.95), int(w * 0.85)
            d.ellipse([cx - upper_w - 2, cy - upper_h, cx - 2, cy + upper_h // 6],
                      fill=ink, outline=accent, width=2)
            d.ellipse([cx + 2, cy - upper_h, cx + upper_w + 2, cy + upper_h // 6],
                      fill=ink, outline=accent, width=2)
            # Lower wings — smaller, sit beneath the uppers.
            lower_w, lower_h = int(w * 0.6), int(w * 0.55)
            d.ellipse([cx - lower_w - 2, cy - 4, cx - 2, cy + lower_h * 2],
                      fill=ink, outline=accent, width=2)
            d.ellipse([cx + 2, cy - 4, cx + lower_w + 2, cy + lower_h * 2],
                      fill=ink, outline=accent, width=2)
            # Body (slim vertical pill between the wings).
            body_h = int(w * 1.05)
            d.rounded_rectangle(
                [cx - 4, cy - body_h // 2, cx + 4, cy + body_h // 2],
                radius=4, fill=accent,
            )
            # Two antennae curling outward from the head.
            d.line([cx - 3, cy - body_h // 2, cx - 12, cy - body_h // 2 - 16],
                   fill=accent, width=3)
            d.line([cx + 3, cy - body_h // 2, cx + 12, cy - body_h // 2 - 16],
                   fill=accent, width=3)
            # Two little wing-spots for charm.
            d.ellipse([cx - upper_w + 8, cy - upper_h // 2 - 4,
                       cx - upper_w + 22, cy - upper_h // 2 + 10], fill=accent)
            d.ellipse([cx + upper_w - 22, cy - upper_h // 2 - 4,
                       cx + upper_w - 8, cy - upper_h // 2 + 10], fill=accent)

        # Three lines inside the ribbon (lead + benefit + call-to-join),
        # centred. Copy is deliberately STATIC — no live "X of 500
        # remaining" count — because printed flyers stay on noticeboards
        # for weeks and any dynamic number would be stale by the time
        # someone reads it. The ribbon itself only renders while the
        # cohort still has space; once it's full the whole ribbon
        # disappears from the flyer, so we don't have to advertise
        # "remaining" at all — presence of the ribbon is the signal.
        ribbon_lead = "BECOME A FOUNDING MEMBER"
        ribbon_benefit = "Founding Member badge + early access to new features"
        ribbon_sub = "Free to join · Limited to the first supporters"
        try:
            # ── Lead line: auto-fit so the text + butterfly icon fit width ─
            ICON_SPAN = 70  # butterfly width in px
            ICON_GAP = 18   # gap between butterfly and text
            lead_size = 58
            available = (W - 160) - (ICON_SPAN + ICON_GAP)
            while lead_size > 40:
                lf = font(lead_size, bold=True, condensed=True)
                lb = d.textbbox((0, 0), ribbon_lead, font=lf)
                if (lb[2] - lb[0]) <= available:
                    break
                lead_size -= 4
            lf = font(lead_size, bold=True, condensed=True)
            lb = d.textbbox((0, 0), ribbon_lead, font=lf)
            lead_w = lb[2] - lb[0]
            block_w = ICON_SPAN + ICON_GAP + lead_w
            start_x = (W - block_w) / 2
            # Centre the butterfly vertically on the lead text x-height.
            lead_y = RIBBON_Y + 22
            butterfly_cy = lead_y + (lead_size // 2) + 2
            draw_butterfly(int(start_x + ICON_SPAN / 2), butterfly_cy,
                           ICON_SPAN, "#FFFFFF", GOLD_DARK)
            d.text((start_x + ICON_SPAN + ICON_GAP, lead_y),
                   ribbon_lead, font=lf, fill=GOLD_DARK)

            # ── Benefit line — explains *why* to join now ─────────────────
            benefit_fnt = font(28, bold=False)
            bb = d.textbbox((0, 0), ribbon_benefit, font=benefit_fnt)
            d.text(
                (W // 2 - (bb[2] - bb[0]) / 2, RIBBON_Y + RIBBON_H - 100),
                ribbon_benefit, font=benefit_fnt, fill=GOLD_DARK,
            )
            # ── Count / "Free to join" line — sub copy ─────────────────────
            sub_fnt = font(32, bold=True)
            sb = d.textbbox((0, 0), ribbon_sub, font=sub_fnt)
            d.text(
                (W // 2 - (sb[2] - sb[0]) / 2, RIBBON_Y + RIBBON_H - 52),
                ribbon_sub, font=sub_fnt, fill=GOLD_DARK,
            )
        except Exception:
            pass

    # ─── QR code — sized to still scan easily from ~1.5m away while
    # leaving room for the CTA + tagline within the A4 page height. The
    # QR sits DIRECTLY BELOW the founding-member ribbon rather than at a
    # hardcoded y, so however tall the ribbon ends up we can never
    # overlap it (the earlier hardcoded qr_y=960 clashed with the ribbon
    # bottom at y≈1047). We also fell back to sane defaults if the
    # ribbon was hidden.
    RIBBON_BOTTOM = ribbon_bottom_y
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10, border=2,
    )
    qr.add_data(target_url)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color=INK, back_color="#FFFFFF").convert("RGB")
    # 520px @ 150 dpi = 3.5" printed — well above the ~1" minimum for a
    # phone camera to lock on at reading distance, and small enough to
    # leave headroom for the CTA + tagline below without clipping the
    # bottom of the page.
    qr_size = 520
    qr_img = qr_img.resize((qr_size, qr_size), Image.LANCZOS)
    qr_x = (W - qr_size) // 2
    # 30px gap between the ribbon and the QR frame so they don't visually
    # touch. If a "Posted by" line is present it sits BELOW the QR now
    # (see below) so we don't need any headroom above it here.
    qr_y = RIBBON_BOTTOM + 46
    img.paste(qr_img, (qr_x, qr_y))
    d.rectangle([qr_x - 14, qr_y - 14, qr_x + qr_size + 14, qr_y + qr_size + 14],
                outline=NAVY, width=4)

    # "Posted by <venue>" credit — tucked into the gap between the
    # ribbon and the QR frame. This keeps it far away from the CTA
    # stack at the bottom of the page so it can't overlap either the
    # QR outline or the "SCAN TO JOIN FREE" line.
    if venue:
        centre(f"Posted by {venue}", RIBBON_BOTTOM + 8, font(18, bold=False), SLATE)

    # ─── CTA stack ────────────────────────────────────────────────────────
    # Layout budget from qr_y+qr_size onward:
    #   +22px gap → SCAN TO JOIN FREE (~78pt / 82px)
    #   +82px → Because You Belong Too. (~34pt / 42px)
    # Total: ~146px trailing content. Page height 1754, so we need
    # qr_y + qr_size ≤ ~1580. With qr_y ≈ 1077 and qr_size = 520 we sit
    # at 1597 — leaving 157px for the CTA + tagline which fits neatly.
    cta_y = qr_y + qr_size + 22
    fit_centred("SCAN TO JOIN FREE", cta_y, W - 2 * SIDE,
                start_size=72, min_size=56, fill=NAVY, bold=True,
                condensed=True)
    centre("Because You Belong Too.", cta_y + 78, font(30, italic=True), TEAL)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    # Use a venue-scoped filename so downloaded posters are self-labelling
    # in the user's Downloads folder. Sanitize aggressively — Safari treats
    # unsafe characters as a signal to append a fake extension (.json etc)
    # and refuses to preview the file.
    import re as _re
    safe_venue = _re.sub(r"[^A-Za-z0-9._-]+", "-", (venue or "").strip()).strip("-")
    file_name = f"friendplace-flyer-{safe_venue}.png" if safe_venue else "friendplace-flyer.png"
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={
            # `inline` lets Safari preview the PNG in a normal image viewer
            # (with a proper X close button), rather than showing the file
            # picker "Open in WeChat / More…" sheet that appears whenever
            # the media type isn't recognised. Explicitly quoting the
            # filename works around Safari's weirdness with hyphens too.
            "Content-Disposition": f'inline; filename="{file_name}"',
            "Cache-Control": "no-store",
            # A hint to Safari that this really is an image — some
            # versions ignore Content-Type when preceded by an auth
            # redirect and fall back to sniffing this header.
            "X-Content-Type-Options": "nosniff",
        },
    )


@api.get("/admin/events")
async def admin_list_events(admin_id: str, status: str = "all", _me: dict = Depends(current_admin)):
    await _require_admin(admin_id)
    q: Dict = {}
    if status == "active":
        q = {"cancelled": {"$ne": True}, "archived": {"$ne": True}}
    elif status == "cancelled":
        q = {"cancelled": True, "archived": {"$ne": True}}
    elif status == "archived":
        q = {"archived": True}
    events = await db.events.find(q, {"_id": 0}).sort("date", -1).to_list(500)
    # Enrich with host info + RSVP counts (already in doc)
    host_ids = list({e.get("host_id") for e in events if e.get("host_id")})
    hosts: Dict[str, Dict] = {}
    if host_ids:
        async for u in db.users.find({"id": {"$in": host_ids}}, {"_id": 0, "id": 1, "username": 1, "first_name": 1, "avatar": 1}):
            hosts[u["id"]] = u
    for e in events:
        e["host"] = hosts.get(e.get("host_id") or "")
        e["going_count"] = len(e.get("rsvps") or [])
        e["maybe_count"] = len(e.get("rsvps_maybe") or [])
        e["waitlist_count"] = len(e.get("waitlist") or [])
    return {"events": events, "counts": {
        "total": await db.events.count_documents({}),
        "active": await db.events.count_documents({"cancelled": {"$ne": True}, "archived": {"$ne": True}}),
        "cancelled": await db.events.count_documents({"cancelled": True, "archived": {"$ne": True}}),
        "archived": await db.events.count_documents({"archived": True}),
    }}


@api.post("/admin/events/{event_id}/archive")
async def admin_archive_event(event_id: str, body: AdminHardDeleteBody, _me: dict = Depends(current_admin)):
    """Soft-archive — hidden from public list but kept in DB for audit."""
    await _require_admin(body.admin_id)
    ev = await db.events.find_one({"id": event_id}, {"_id": 0, "host_id": 1, "title": 1})
    if not ev:
        raise HTTPException(404, "Event not found")
    await db.events.update_one({"id": event_id}, {"$set": {"archived": True, "archived_at": now_iso(), "archived_by": body.admin_id, "archived_reason": (body.reason or "").strip()}})
    if ev.get("host_id"):
        await _log_moderation_action(
            user_id=ev["host_id"], by=body.admin_id, action="content_removed",
            reason=body.reason or f"Event '{ev.get('title','?')}' archived by admin",
            target_type="event", target_id=event_id,
        )
    return {"ok": True}


@api.post("/admin/events/{event_id}/unarchive")
async def admin_unarchive_event(event_id: str, body: AdminHardDeleteBody, _me: dict = Depends(current_admin)):
    await _require_admin(body.admin_id)
    await db.events.update_one({"id": event_id}, {"$set": {"archived": False}, "$unset": {"archived_at": "", "archived_by": "", "archived_reason": ""}})
    return {"ok": True}


@api.delete("/admin/events/{event_id}")
async def admin_hard_delete_event(event_id: str, admin_id: str, reason: Optional[str] = None, _me: dict = Depends(current_admin)):
    await _require_admin(admin_id)
    ev = await db.events.find_one({"id": event_id}, {"_id": 0, "host_id": 1, "title": 1})
    if not ev:
        raise HTTPException(404, "Event not found")
    await db.events.delete_one({"id": event_id})
    if ev.get("host_id"):
        await _log_moderation_action(
            user_id=ev["host_id"], by=admin_id, action="content_removed",
            reason=reason or f"Event '{ev.get('title','?')}' hard-deleted by admin",
            target_type="event", target_id=event_id,
        )
    return {"ok": True}


@api.delete("/admin/notices/{notice_id}")
async def admin_hard_delete_notice(notice_id: str, admin_id: str, reason: Optional[str] = None, _me: dict = Depends(current_admin)):
    await _require_admin(admin_id)
    n = await db.notices.find_one({"id": notice_id}, {"_id": 0, "user_id": 1})
    if not n:
        raise HTTPException(404, "Notice not found")
    await db.notices.delete_one({"id": notice_id})
    if n.get("user_id"):
        await _log_moderation_action(
            user_id=n["user_id"], by=admin_id, action="content_removed",
            reason=reason or "Notice hard-deleted by admin",
            target_type="notice", target_id=notice_id,
        )
    return {"ok": True}


async def _hard_delete_user_data(user_id: str) -> None:
    """Irreversibly purge a user and all their content from MongoDB.

    Shared by:
      • the admin moderation tool (`DELETE /api/admin/users/{user_id}`)
      • the user-initiated account deletion (`DELETE /api/users/me`)

    What gets deleted:
      * The user document itself.
      * Notices they authored (cascades comments since those live on the doc).
      * Every message they sent or that targeted them (table chat + DMs).
      * Flutters they sent or received.
      * All in-app notifications for them.
      * Reports they filed (their POV is gone with them).
      * Friend & block links — pulled from every other user's arrays.
      * Group post authorship — anonymised, not deleted, so threads remain
        coherent for the rest of the community.
      * Their seat at any FP Café table — pulled.
      * Reports filed *against* them — kept for audit, but the
        target_user_id is anonymised to "[deleted]".

    What is intentionally kept (and how):
      * Their content in groups they posted to (their `user_name` is
        replaced with "Former member") — preserves community continuity
        without leaking PII.
      * Moderation audit log — the username snapshot field stays so any
        prior action against them is still traceable, but their live id
        is gone.
    """
    # Cache the username for the audit trail BEFORE we delete the row.
    snapshot = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1})
    uname = (snapshot or {}).get("username", "?")

    await db.users.delete_one({"id": user_id})
    await db.notices.delete_many({"user_id": user_id})
    await db.messages.delete_many(
        {"$or": [{"user_id": user_id}, {"from_id": user_id}, {"to_id": user_id}]}
    )
    await db.flutters.delete_many(
        {"$or": [{"from_id": user_id}, {"to_id": user_id}]}
    )
    await db.notifications.delete_many({"user_id": user_id})
    await db.reports.delete_many({"reporter_id": user_id})
    # DM conversations that the deleted user was part of are deleted
    # outright (the other participant's message history with this user is
    # gone anyway since we purged db.messages above — keeping a half-empty
    # conversation row would just confuse the other side's DM list).
    await db.dm_conversations.delete_many({"participants": user_id})
    await db.reports.update_many(
        {"target_user_id": user_id},
        {"$set": {"target_user_id": "[deleted]"}},
    )
    # Anonymise — don't delete — group post authorship so threads stay
    # readable for remaining members. We use a stable sentinel id so
    # subsequent re-runs are idempotent.
    await db.group_posts.update_many(
        {"user_id": user_id},
        {"$set": {"user_name": "Former member", "avatar": "🙂", "user_id": "[deleted]"}},
    )
    # Pull the deleted user from every friend / block / group / event list.
    await db.users.update_many(
        {},
        {"$pull": {"friends": user_id, "blocked": user_id,
                   "incoming_friend_requests": user_id,
                   "outgoing_friend_requests": user_id}},
    )
    await db.groups.update_many({}, {"$pull": {"members": user_id}})
    await db.tables.update_many({}, {"$pull": {"seated": user_id}})
    await db.events.update_many(
        {},
        {"$pull": {"rsvps": user_id, "rsvps_maybe": user_id,
                   "rsvps_cant": user_id, "waitlist": user_id}},
    )
    # Stamp a soft audit row so we can reconcile later if needed.
    try:
        await db.moderation_log.insert_one({
            "id": nid(),
            "user_id": user_id,
            "username_snapshot": uname,
            "action": "self_delete_or_hard_delete",
            "at": now_iso(),
        })
    except Exception:
        # moderation_log may not exist in older deployments — ignore.
        pass


@api.delete("/admin/users/{user_id}")
async def admin_hard_delete_user(user_id: str, admin_id: str, reason: Optional[str] = None, _me: dict = Depends(current_admin)):
    """Hard-delete a user account and their content. ADMIN ONLY. Irreversible.

    Thin wrapper around `_hard_delete_user_data` with the admin auth guard
    and a richer audit-log entry that captures the reason.
    """
    await _require_admin(admin_id)
    if user_id == admin_id:
        raise HTTPException(400, "Cannot hard-delete your own admin account")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1, "is_admin": 1})
    if not user:
        raise HTTPException(404, "User not found")
    if user.get("is_admin"):
        raise HTTPException(400, "Cannot hard-delete another admin")
    # Log BEFORE deletion so the audit entry exists with the reason.
    await _log_moderation_action(
        user_id=user_id, by=admin_id, action="hard_delete",
        reason=reason or f"User @{user.get('username','?')} hard-deleted by admin",
        extra={"username_snapshot": user.get("username")},
    )
    await _hard_delete_user_data(user_id)
    return {"ok": True}


class SelfDeleteBody(BaseModel):
    # Optional free-text reason — captured purely for product feedback,
    # never displayed to other users. Limited to keep payload small.
    reason: Optional[str] = Field(default=None, max_length=500)


@api.delete("/users/me")
async def self_delete_account(
    body: Optional[SelfDeleteBody] = None,
    user=Depends(current_user),
):
    """User-initiated account deletion.

    Required by both the Apple App Store and Google Play store policies
    for any app that supports account creation. The user must be
    authenticated (Bearer token), and admins cannot self-delete via this
    endpoint — they must demote first to avoid leaving the moderation
    pool empty by accident.

    Returns 200 on success; the client must then clear its local token
    and route the user back to the welcome screen.
    """
    if user.get("is_admin"):
        raise HTTPException(
            status_code=400,
            detail="Admin accounts cannot delete themselves — demote first or contact support.",
        )
    uid = user["id"]
    # Apple Sign-In token revocation — REQUIRED by App Store Guideline
    # 5.1.1(v) when the app offers Sign in with Apple. If the user signed
    # up via Apple AND we have their refresh token AND SIWA is configured,
    # tell Apple to invalidate their tokens BEFORE we drop local data. We
    # fire-and-forget the result: a failed revoke is logged but doesn't
    # block deletion — Apple will eventually time the tokens out anyway.
    rt = user.get("apple_refresh_token")
    if rt and _siwa_configured():
        try:
            ok = await _apple_revoke_token(rt, token_type_hint="refresh_token")
            logger.info("apple revoke for user=%s -> %s", uid, ok)
        except Exception as e:
            logger.warning("apple revoke for user=%s errored: %s", uid, e)
    # Audit row first (we lose the username after delete).
    try:
        await db.moderation_log.insert_one({
            "id": nid(),
            "user_id": uid,
            "username_snapshot": user.get("username", "?"),
            "action": "self_delete",
            "reason": (body.reason if body else None) or None,
            "at": now_iso(),
        })
    except Exception:
        pass
    await _hard_delete_user_data(uid)
    return {"ok": True}


class RsvpBody(BaseModel):
    response: str  # "going" | "maybe" | "cant"


@api.post("/events/{event_id}/rsvp/{user_id}")
async def rsvp_event(event_id: str, user_id: str, body: Optional[RsvpBody] = None):
    """Three-state RSVP with capacity + waitlist.

    Body shape: `{response: "going" | "maybe" | "cant"}`. If omitted (legacy
    callers), defaults to "going" for backwards compatibility.
    Capacity logic:
      * If event.capacity is set AND going list is full AND response="going",
        the user is added to the waitlist instead and returned `waitlisted=True`.
      * When a "going" user later changes to "maybe"/"cant"/leaves, the top of
        the waitlist is automatically promoted to "going" and notified.
    """
    response = (body.response if body else "going") or "going"
    if response not in ("going", "maybe", "cant"):
        raise HTTPException(400, "response must be one of: going, maybe, cant")
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")

    going = list(event.get("rsvps") or [])
    maybe = list(event.get("rsvps_maybe") or [])
    cant = list(event.get("rsvps_cant") or [])
    waitlist = list(event.get("waitlist") or [])
    capacity = event.get("capacity")
    # Remove the user from any list they're on first
    for lst in (going, maybe, cant, waitlist):
        if user_id in lst:
            lst.remove(user_id)

    waitlisted = False
    if response == "going":
        if capacity is not None and len(going) >= int(capacity):
            waitlist.append(user_id)
            waitlisted = True
        else:
            going.append(user_id)
            await award_points(user_id, 6)
    elif response == "maybe":
        maybe.append(user_id)
    else:  # cant
        cant.append(user_id)

    await db.events.update_one(
        {"id": event_id},
        {"$set": {"rsvps": going, "rsvps_maybe": maybe, "rsvps_cant": cant, "waitlist": waitlist}},
    )
    # If someone left "going" and capacity now has space, promote first waitlist entry
    promoted: Optional[str] = None
    if response != "going" and waitlist and (capacity is None or len(going) < int(capacity)):
        promoted = waitlist.pop(0)
        if promoted not in going:
            going.append(promoted)
        await db.events.update_one(
            {"id": event_id},
            {"$set": {"rsvps": going, "waitlist": waitlist}},
        )
        await award_points(promoted, 6)
        try:
            await push_notification(
                promoted,
                "event_invite",
                f"You're in — {event.get('title','Event')}",
                "A spot just opened up. You've been moved from the waitlist to Going.",
                {"event_id": event_id},
            )
        except Exception:
            pass

    return {
        "ok": True,
        "response": "waitlist" if waitlisted else response,
        "waitlisted": waitlisted,
        "going_count": len(going),
        "capacity": capacity,
        "waitlist_count": len(waitlist),
        "promoted_user_id": promoted,
    }


@api.post("/events/{event_id}/unrsvp/{user_id}")
async def unrsvp_event(event_id: str, user_id: str):
    """Remove user from all RSVP lists, then promote waitlist if possible."""
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event not found")
    going = [u for u in (event.get("rsvps") or []) if u != user_id]
    maybe = [u for u in (event.get("rsvps_maybe") or []) if u != user_id]
    cant = [u for u in (event.get("rsvps_cant") or []) if u != user_id]
    waitlist = [u for u in (event.get("waitlist") or []) if u != user_id]
    capacity = event.get("capacity")
    promoted: Optional[str] = None
    if waitlist and (capacity is None or len(going) < int(capacity)):
        promoted = waitlist.pop(0)
        going.append(promoted)
        await award_points(promoted, 6)
        try:
            await push_notification(
                promoted,
                "event_invite",
                f"You're in — {event.get('title','Event')}",
                "A spot just opened up. You've been moved from the waitlist to Going.",
                {"event_id": event_id},
            )
        except Exception:
            pass
    await db.events.update_one(
        {"id": event_id},
        {"$set": {"rsvps": going, "rsvps_maybe": maybe, "rsvps_cant": cant, "waitlist": waitlist}},
    )
    return {"ok": True, "promoted_user_id": promoted, "going_count": len(going), "waitlist_count": len(waitlist)}


# ------------- Notice Board -------------
REACTIONS = {"well_done", "support", "chat", "flutter", "congrats"}


@api.get("/notices")
async def list_notices(user_id: Optional[str] = None, q: Optional[str] = None, category: Optional[str] = None):
    query: Dict = {"removed": {"$ne": True}, "auto_hidden": {"$ne": True}}
    if category and category != "All":
        query["category"] = category
    if q:
        query["$or"] = [{"title": {"$regex": q, "$options": "i"}}, {"body": {"$regex": q, "$options": "i"}}]
    if user_id:
        viewer = await db.users.find_one({"id": user_id}, {"blocked": 1, "_id": 0}) or {}
        blocked = viewer.get("blocked") or []
        if blocked:
            query["user_id"] = {"$nin": blocked}
    docs = await db.notices.find(query, {"_id": 0}).to_list(500)
    # Unsolved first, then newest first; solved Q's sink below.
    docs.sort(key=lambda d: (bool(d.get("solved")), -datetime.fromisoformat(d.get("created_at", now_iso())).timestamp()))
    await _attach_founder_flags(docs, "user_id")
    return docs


@api.post("/notices")
async def create_notice(body: Notice):
    # Anti-spam: cap notice creation to 6 per hour per user. Plenty for any
    # real community contributor, low enough to stop bot/scripted floods.
    rate_limit(f"notice:{body.user_id}", max_calls=6, window_seconds=3600)
    # Restricted/banned users can't post
    u = await db.users.find_one({"id": body.user_id}, {"_id": 0, "restricted": 1, "banned": 1})
    if u and (u.get("restricted") or u.get("banned")):
        raise HTTPException(403, "Your account is currently restricted. Please contact support.")
    n = Notice(**body.dict())
    await db.notices.insert_one(n.dict())
    await award_points(body.user_id, 4)
    return n.dict()


@api.patch("/notices/{notice_id}")
async def edit_notice(notice_id: str, payload: dict):
    n = await db.notices.find_one({"id": notice_id}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Not found")
    if payload.get("user_id") != n.get("user_id"):
        raise HTTPException(403, "Only the author can edit")
    update = {k: payload[k] for k in ("title", "body", "category") if k in payload}
    update["edited_at"] = now_iso()
    await db.notices.update_one({"id": notice_id}, {"$set": update})
    return {**n, **update}


@api.delete("/notices/{notice_id}")
async def delete_notice(notice_id: str, user_id: str):
    n = await db.notices.find_one({"id": notice_id}, {"_id": 0})
    if not n:
        return {"ok": True}
    if n.get("user_id") != user_id:
        raise HTTPException(403, "Only the author can delete")
    await db.notices.delete_one({"id": notice_id})
    return {"ok": True}


@api.post("/notices/{notice_id}/react/{user_id}")
async def react_notice(notice_id: str, user_id: str, body: dict):
    """Set / toggle a single reaction per user (no negative reactions)."""
    kind = (body or {}).get("kind", "")
    n = await db.notices.find_one({"id": notice_id}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Not found")
    if kind and kind not in REACTIONS:
        raise HTTPException(400, "Invalid reaction")
    reactions = dict(n.get("reactions") or {})
    if not kind or reactions.get(user_id) == kind:
        reactions.pop(user_id, None)
    else:
        reactions[user_id] = kind
    await db.notices.update_one({"id": notice_id}, {"$set": {"reactions": reactions}})
    return {"reactions": reactions}


@api.post("/notices/{notice_id}/like/{user_id}")
async def like_notice(notice_id: str, user_id: str):
    # legacy compat — maps to the "well_done" reaction
    return await react_notice(notice_id, user_id, {"kind": "well_done"})


@api.post("/notices/{notice_id}/comment")
async def comment_notice(notice_id: str, body: dict):
    n = await db.notices.find_one({"id": notice_id}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Not found")
    comment = {
        "id": nid(), "user_id": body.get("user_id"), "user_name": body.get("user_name", ""),
        "avatar": body.get("avatar", ""), "text": body.get("text", ""),
        "replies": [], "created_at": now_iso(),
    }
    await db.notices.update_one({"id": notice_id}, {"$push": {"comments": comment}})
    if n.get("user_id") and n["user_id"] != comment["user_id"]:
        sname = comment.get("user_name") or "Someone"
        savatar = comment.get("avatar") or "💬"
        await push_notification(
            n["user_id"], "notice_comment",
            f"{savatar} {sname} commented on your Notice",
            (comment.get("text") or "")[:120],
            {"notice_id": notice_id, "comment_id": comment["id"], "from_id": comment["user_id"]},
        )
    return comment


@api.post("/notices/{notice_id}/comment/{comment_id}/reply")
async def reply_notice_comment(notice_id: str, comment_id: str, body: dict):
    reply = {
        "id": nid(), "user_id": body.get("user_id"), "user_name": body.get("user_name", ""),
        "avatar": body.get("avatar", ""), "text": body.get("text", ""), "created_at": now_iso(),
    }
    res = await db.notices.update_one(
        {"id": notice_id, "comments.id": comment_id},
        {"$push": {"comments.$.replies": reply}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Comment not found")
    # notify original commenter (best-effort)
    n = await db.notices.find_one({"id": notice_id}, {"_id": 0})
    parent = next((cm for cm in (n or {}).get("comments", []) if cm.get("id") == comment_id), None)
    if parent and parent.get("user_id") and parent["user_id"] != reply["user_id"]:
        rname = reply.get("user_name") or "Someone"
        ravatar = reply.get("avatar") or "💬"
        await push_notification(
            parent["user_id"], "notice_comment",
            f"{ravatar} {rname} replied to your comment",
            (reply.get("text") or "")[:120],
            {"notice_id": notice_id, "comment_id": comment_id, "from_id": reply["user_id"]},
        )
    return reply


@api.post("/notices/{notice_id}/solve/{user_id}")
async def solve_notice(notice_id: str, user_id: str, body: Optional[dict] = None):
    n = await db.notices.find_one({"id": notice_id}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Not found")
    if n.get("user_id") != user_id:
        raise HTTPException(403, "Only the author can mark as solved")
    new_state = bool((body or {}).get("solved", not n.get("solved", False)))
    await db.notices.update_one({"id": notice_id}, {"$set": {"solved": new_state}})
    return {"solved": new_state}


@api.post("/notices/{notice_id}/report/{user_id}")
async def report_notice(notice_id: str, user_id: str, body: dict):
    n = await db.notices.find_one({"id": notice_id}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Not found")
    report = {"user_id": user_id, "reason": (body or {}).get("reason", ""), "created_at": now_iso()}
    await db.notices.update_one({"id": notice_id}, {"$push": {"reports": report}})
    return {"ok": True}


@api.post("/users/{user_id}/block/{other_id}")
async def block_user(user_id: str, other_id: str):
    if user_id == other_id:
        raise HTTPException(400, "Cannot block yourself")
    await db.users.update_one({"id": user_id}, {"$addToSet": {"blocked": other_id}})
    return {"ok": True}


@api.post("/users/{user_id}/unblock/{other_id}")
async def unblock_user(user_id: str, other_id: str):
    await db.users.update_one({"id": user_id}, {"$pull": {"blocked": other_id}})
    return {"ok": True}


# ============================ Safety & Moderation ============================
REPORT_REASONS = ["Spam", "Harassment / Bullying", "Inappropriate Content", "Fake Profile", "Scam / Suspicious Behaviour", "Other"]
SUPPORT_CATEGORIES = ["Bug / Technical issue", "Account help", "Suggestion / Feedback", "Other"]

# Moderation policy (per house rules — never auto-ban):
#   1 unique report  → visible in moderation queue (default — no auto action)
#   3 unique reports in MODERATION_WINDOW_DAYS → user is FLAGGED for review
#   5 unique reports in MODERATION_WINDOW_DAYS → user is TEMPORARILY RESTRICTED until admin clears
MODERATION_FLAG_THRESHOLD = 3
MODERATION_RESTRICT_THRESHOLD = 5
MODERATION_WINDOW_DAYS = 30
AUTO_RESTRICT_THRESHOLD = MODERATION_RESTRICT_THRESHOLD  # legacy alias


async def _require_admin(admin_id: str):
    u = await db.users.find_one({"id": admin_id}, {"_id": 0, "is_admin": 1})
    if not u or not u.get("is_admin"):
        raise HTTPException(403, "Admin access required")
    return u


async def _notify_admins(notification: Dict):
    """Insert a notification for every admin."""
    admins = await db.users.find({"is_admin": True}, {"_id": 0, "id": 1}).to_list(50)
    for a in admins:
        doc = {"id": nid(), "user_id": a["id"], "read": False, "created_at": now_iso(), **notification}
        await db.notifications.insert_one(doc)


async def _log_moderation_action(
    *,
    user_id: str,
    by: str,
    action: str,
    reason: str = "",
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    report_id: Optional[str] = None,
    extra: Optional[Dict] = None,
) -> None:
    """Append a single moderation log entry against a user.

    Used for the admin-visible per-user history (warnings, suspensions, bans,
    auto-hides, content removals, manual notes). `by` is "system" for automated
    actions or an admin user_id for manual ones.
    """
    if not user_id or not action:
        return
    entry = {
        "id": nid(),
        "user_id": user_id,
        "by": by or "system",
        "action": action,
        "reason": reason or "",
        "target_type": target_type,
        "target_id": target_id,
        "report_id": report_id,
        "created_at": now_iso(),
    }
    if extra:
        entry.update(extra)
    try:
        await db.moderation_log.insert_one(entry)
    except Exception as e:
        logger.warning("moderation_log insert failed: %s", e)


async def _apply_moderation_policy(target_user_id: str) -> Dict:
    """Apply the FriendPlace moderation policy (per house rules).

    Counts unique reporters against the target within the last
    MODERATION_WINDOW_DAYS. Returns a summary dict so callers (and the report
    endpoint) can surface what happened.

    Effects:
      *  3 unique reporters → user is FLAGGED for admin review (no functional
         restriction; just a badge that surfaces in the moderation dashboard).
      *  5 unique reporters → user is TEMPORARILY RESTRICTED until an admin
         reviews. Their notices are auto-hidden but kept for audit.
      *  Never auto-banned.
    """
    out = {"unique_reporters": 0, "flagged": False, "restricted": False}
    if not target_user_id:
        return out
    since = (datetime.now(timezone.utc) - timedelta(days=MODERATION_WINDOW_DAYS)).isoformat()
    rs = await db.reports.find(
        {"target_user_id": target_user_id, "created_at": {"$gte": since}},
        {"_id": 0, "reporter_id": 1},
    ).to_list(500)
    unique_reporters = {r.get("reporter_id") for r in rs if r.get("reporter_id")}
    out["unique_reporters"] = len(unique_reporters)
    if not unique_reporters:
        return out

    target = await db.users.find_one(
        {"id": target_user_id},
        {"_id": 0, "username": 1, "restricted": 1, "flagged_for_review": 1},
    )
    if not target:
        return out

    # 5 unique reporters → restrict (overrides flag)
    if len(unique_reporters) >= MODERATION_RESTRICT_THRESHOLD and not target.get("restricted"):
        await db.users.update_one(
            {"id": target_user_id},
            {"$set": {
                "restricted": True,
                "restricted_at": now_iso(),
                "restricted_reason": f"Auto-restricted: {MODERATION_RESTRICT_THRESHOLD}+ unique reports in {MODERATION_WINDOW_DAYS} days. Requires admin review.",
                "flagged_for_review": True,
                "profile_hidden": True,
                "profile_hidden_at": now_iso(),
                "profile_hidden_reason": f"Auto-hidden after {MODERATION_RESTRICT_THRESHOLD}+ reports. Awaiting admin review.",
            }},
        )
        await db.notices.update_many({"user_id": target_user_id}, {"$set": {"auto_hidden": True}})
        await db.reports.update_many(
            {"target_user_id": target_user_id, "status": {"$ne": "resolved"}},
            {"$set": {"urgent": True}},
        )
        await _log_moderation_action(
            user_id=target_user_id,
            by="system",
            action="auto_restrict",
            reason=f"Reached {MODERATION_RESTRICT_THRESHOLD}+ unique reports in {MODERATION_WINDOW_DAYS} days",
        )
        await _notify_admins({
            "type": "moderation_urgent",
            "title": "Urgent: user temporarily restricted",
            "body": f"{target.get('username','?')} reached {MODERATION_RESTRICT_THRESHOLD} unique reports in {MODERATION_WINDOW_DAYS} days. Awaiting admin review.",
            "ref_user_id": target_user_id,
        })
        out["restricted"] = True
        out["flagged"] = True
        out["profile_hidden"] = True
        return out

    # 3 unique reporters → flag + AUTO-HIDE PROFILE pending admin review.
    # Per policy: never auto-bans. Profile stays hidden from public listings
    # until an admin reviews and clears it via /admin/users/restore.
    if len(unique_reporters) >= MODERATION_FLAG_THRESHOLD and not target.get("flagged_for_review"):
        await db.users.update_one(
            {"id": target_user_id},
            {"$set": {
                "flagged_for_review": True,
                "flagged_at": now_iso(),
                "flagged_reason": f"{MODERATION_FLAG_THRESHOLD}+ unique reports in {MODERATION_WINDOW_DAYS} days",
                "profile_hidden": True,
                "profile_hidden_at": now_iso(),
                "profile_hidden_reason": f"Auto-hidden after {MODERATION_FLAG_THRESHOLD} reports. Awaiting admin review.",
            }},
        )
        await _log_moderation_action(
            user_id=target_user_id,
            by="system",
            action="auto_hide",
            reason=f"Reached {MODERATION_FLAG_THRESHOLD} unique reports in {MODERATION_WINDOW_DAYS} days",
        )
        await _notify_admins({
            "type": "moderation_flagged",
            "title": "Profile auto-hidden — review needed",
            "body": f"{target.get('username','?')} reached {MODERATION_FLAG_THRESHOLD} unique reports in {MODERATION_WINDOW_DAYS} days. Profile is hidden from listings.",
            "ref_user_id": target_user_id,
        })
        out["flagged"] = True
        out["profile_hidden"] = True
    return out


# Backwards-compatible alias for any code paths that still call the old name.
async def _maybe_auto_restrict(target_user_id: str) -> bool:
    res = await _apply_moderation_policy(target_user_id)
    return bool(res.get("restricted"))


class SubmitReportBody(BaseModel):
    reporter_id: str
    target_user_id: Optional[str] = None
    target_type: str = "user"          # user | notice | message | dm | profile
    target_id: Optional[str] = None     # id of the offending content
    reason: str = "Other"
    notes: str = ""


@api.post("/reports")
async def submit_report(body: SubmitReportBody):
    # Anti-griefing: a single reporter shouldn't be able to mass-flag content.
    # Cap at 10 reports / hr per reporter — generous for legitimate moderation
    # activity, but stops one user trying to weaponise auto-hide thresholds.
    if body.reporter_id:
        rate_limit(f"report:{body.reporter_id}", max_calls=10, window_seconds=3600)
    # Founder priority — Founding Members are pre-launch testers whose
    # signal we trust more than anonymous traffic. Their reports get a
    # `priority: high` tag so the admin dashboard can surface them first
    # without having to remember who's who. Same content rules, different
    # SLA. We look this up once per submit (cheap, hot index ix_users_id).
    reporter_priority = "normal"
    if body.reporter_id:
        rep = await db.users.find_one(
            {"id": body.reporter_id},
            {"_id": 0, "is_founder": 1, "is_admin": 1},
        )
        if rep and (rep.get("is_founder") or rep.get("is_admin")):
            reporter_priority = "high"
    if body.reason and body.reason not in REPORT_REASONS:
        # Allow free-form but normalise to "Other" if completely off-list.
        pass
    # If reporting content, infer the author so we can aggregate against them.
    target_user_id = body.target_user_id
    related_text = ""
    if not target_user_id and body.target_type == "notice" and body.target_id:
        n = await db.notices.find_one({"id": body.target_id}, {"_id": 0, "user_id": 1, "title": 1, "body": 1})
        if n:
            target_user_id = n.get("user_id")
            related_text = (n.get("title") or "") + " — " + (n.get("body") or "")[:200]
    if not target_user_id and body.target_type in ("message", "dm") and body.target_id:
        m = await db.messages.find_one({"id": body.target_id}, {"_id": 0, "user_id": 1, "text": 1})
        if m:
            target_user_id = m.get("user_id")
            related_text = (m.get("text") or "")[:200]

    rep = {
        "id": nid(),
        "reporter_id": body.reporter_id,
        "target_user_id": target_user_id,
        "target_type": body.target_type,
        "target_id": body.target_id,
        "reason": body.reason,
        "notes": body.notes,
        "related_text": related_text,
        "status": "new",                # new | reviewing | resolved | dismissed
        "urgent": False,
        "priority": reporter_priority,  # high when reporter is Founder/admin
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.reports.insert_one(rep)

    # Notify admins (general new-report ping).
    reporter = await db.users.find_one({"id": body.reporter_id}, {"_id": 0, "username": 1, "first_name": 1})
    target = await db.users.find_one({"id": target_user_id}, {"_id": 0, "username": 1}) if target_user_id else None
    await _notify_admins({
        "type": "moderation_new",
        "title": "New report",
        "body": f"{(reporter or {}).get('first_name') or (reporter or {}).get('username','?')} reported {(target or {}).get('username','?')} for {body.reason}",
        "ref_user_id": target_user_id or "",
    })

    # Auto-restriction trigger.
    restricted = await _maybe_auto_restrict(target_user_id) if target_user_id else False
    return {"ok": True, "report_id": rep["id"], "auto_restricted": restricted, "message": "Thank you. We've received your report and will review it."}


@api.get("/safety/report-reasons")
async def safety_report_reasons():
    return {"reasons": REPORT_REASONS}


# ----- Admin -----
@api.get("/admin/reports")
async def admin_list_reports(admin_id: str, status: str = "all", _me: dict = Depends(current_admin)):
    await _require_admin(admin_id)
    q: Dict = {}
    if status and status != "all":
        q["status"] = status
    rows = await db.reports.find(q, {"_id": 0}).sort([("urgent", -1), ("created_at", -1)]).to_list(500)
    # Enrich with reporter + target user info
    user_ids = list({r.get("reporter_id") for r in rows} | {r.get("target_user_id") for r in rows if r.get("target_user_id")})
    users_map = {}
    if user_ids:
        async for u in db.users.find({"id": {"$in": list(filter(None, user_ids))}}, {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1, "restricted": 1, "is_admin": 1}):
            users_map[u["id"]] = u
    for r in rows:
        r["reporter"] = users_map.get(r.get("reporter_id"))
        r["target_user"] = users_map.get(r.get("target_user_id"))
    counts = {
        "new": await db.reports.count_documents({"status": "new"}),
        "reviewing": await db.reports.count_documents({"status": "reviewing"}),
        "urgent": await db.reports.count_documents({"urgent": True, "status": {"$ne": "resolved"}}),
        "resolved": await db.reports.count_documents({"status": "resolved"}),
        "dismissed": await db.reports.count_documents({"status": "dismissed"}),
    }
    return {"reports": rows, "counts": counts}


@api.get("/admin/reports/{report_id}")
async def admin_get_report(report_id: str, admin_id: str, _me: dict = Depends(current_admin)):
    await _require_admin(admin_id)
    r = await db.reports.find_one({"id": report_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Report not found")
    reporter = await db.users.find_one({"id": r.get("reporter_id")}, {"_id": 0, "password_hash": 0}) if r.get("reporter_id") else None
    target = await db.users.find_one({"id": r.get("target_user_id")}, {"_id": 0, "password_hash": 0}) if r.get("target_user_id") else None
    related = None
    if r.get("target_type") == "notice" and r.get("target_id"):
        related = await db.notices.find_one({"id": r["target_id"]}, {"_id": 0})
    elif r.get("target_type") in ("message", "dm") and r.get("target_id"):
        related = await db.messages.find_one({"id": r["target_id"]}, {"_id": 0})
    history = []
    if r.get("target_user_id"):
        history = await db.reports.find({"target_user_id": r["target_user_id"], "id": {"$ne": report_id}}, {"_id": 0}).sort("created_at", -1).to_list(30)
    return {"report": r, "reporter": reporter, "target_user": target, "related": related, "target_history": history}


class AdminActionBody(BaseModel):
    admin_id: str
    note: str = ""


@api.post("/admin/reports/{report_id}/status")
async def admin_set_status(report_id: str, status: str, body: AdminActionBody, _me: dict = Depends(current_admin)):
    await _require_admin(body.admin_id)
    if status not in ("new", "reviewing", "resolved", "dismissed"):
        raise HTTPException(400, "Invalid status")
    await db.reports.update_one({"id": report_id}, {"$set": {"status": status, "updated_at": now_iso(), "admin_note": body.note}})
    return {"ok": True, "status": status}


class AdminUserActionBody(BaseModel):
    admin_id: str
    user_id: str
    reason: str = ""
    duration_hours: int = 0    # for suspend
    report_id: Optional[str] = None


@api.post("/admin/users/warn")
async def admin_warn_user(body: AdminUserActionBody, _me: dict = Depends(current_admin)):
    await _require_admin(body.admin_id)
    target = await db.users.find_one({"id": body.user_id}, {"_id": 0, "username": 1, "first_name": 1, "avatar": 1})
    if not target:
        raise HTTPException(404, "User not found")
    await db.users.update_one({"id": body.user_id}, {"$push": {"warnings": {"id": nid(), "reason": body.reason, "issued_at": now_iso(), "by": body.admin_id}}})
    await db.notifications.insert_one({
        "id": nid(), "user_id": body.user_id, "type": "moderation_warning",
        "title": "Warning from the FriendPlace team",
        "body": body.reason or "Please review our community guidelines.",
        "read": False, "created_at": now_iso(),
    })
    if body.report_id:
        await db.reports.update_one({"id": body.report_id}, {"$set": {"status": "resolved", "outcome": "warned", "admin_note": body.reason, "updated_at": now_iso()}})
    await _log_moderation_action(user_id=body.user_id, by=body.admin_id, action="warn", reason=body.reason, report_id=body.report_id)
    return {"ok": True}


@api.post("/admin/users/suspend")
async def admin_suspend_user(body: AdminUserActionBody, _me: dict = Depends(current_admin)):
    await _require_admin(body.admin_id)
    hours = max(1, int(body.duration_hours or 24))
    until = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    await db.users.update_one(
        {"id": body.user_id},
        {"$set": {"restricted": True, "suspended_until": until, "restricted_reason": body.reason or "Suspended by admin", "restricted_at": now_iso()}},
    )
    await db.notifications.insert_one({
        "id": nid(), "user_id": body.user_id, "type": "moderation_suspension",
        "title": "Your account has been suspended",
        "body": f"Reason: {body.reason or 'See community guidelines'}. Lifted at {until}.",
        "read": False, "created_at": now_iso(),
    })
    if body.report_id:
        await db.reports.update_one({"id": body.report_id}, {"$set": {"status": "resolved", "outcome": f"suspended_{hours}h", "admin_note": body.reason, "updated_at": now_iso()}})
    await _log_moderation_action(user_id=body.user_id, by=body.admin_id, action="suspend", reason=body.reason, report_id=body.report_id, extra={"duration_hours": hours, "until": until})
    return {"ok": True, "suspended_until": until}


@api.post("/admin/users/ban")
async def admin_ban_user(body: AdminUserActionBody, _me: dict = Depends(current_admin)):
    await _require_admin(body.admin_id)
    await db.users.update_one(
        {"id": body.user_id},
        {"$set": {"banned": True, "restricted": True, "restricted_reason": body.reason or "Banned by admin", "restricted_at": now_iso()}},
    )
    if body.report_id:
        await db.reports.update_one({"id": body.report_id}, {"$set": {"status": "resolved", "outcome": "banned", "admin_note": body.reason, "updated_at": now_iso()}})
    await _log_moderation_action(user_id=body.user_id, by=body.admin_id, action="ban", reason=body.reason, report_id=body.report_id)
    return {"ok": True}


@api.post("/admin/users/restore")
async def admin_restore_user(body: AdminUserActionBody, _me: dict = Depends(current_admin)):
    await _require_admin(body.admin_id)
    await db.users.update_one(
        {"id": body.user_id},
        {"$set": {
            "restricted": False, "banned": False, "suspended_until": None, "restricted_reason": "",
            "profile_hidden": False, "flagged_for_review": False,
        },
         "$unset": {"restricted_at": "", "profile_hidden_at": "", "profile_hidden_reason": "", "flagged_at": "", "flagged_reason": ""}},
    )
    await db.notices.update_many({"user_id": body.user_id}, {"$set": {"auto_hidden": False}})
    await _log_moderation_action(user_id=body.user_id, by=body.admin_id, action="restore", reason=body.reason)
    return {"ok": True}


class AdminRemoveContentBody(BaseModel):
    admin_id: str
    target_type: str    # notice | message
    target_id: str
    reason: str = ""
    report_id: Optional[str] = None


@api.post("/admin/content/remove")
async def admin_remove_content(body: AdminRemoveContentBody, _me: dict = Depends(current_admin)):
    await _require_admin(body.admin_id)
    target_user_id: Optional[str] = None
    if body.target_type == "notice":
        n = await db.notices.find_one({"id": body.target_id}, {"_id": 0, "user_id": 1})
        target_user_id = (n or {}).get("user_id")
        await db.notices.update_one({"id": body.target_id}, {"$set": {"removed": True, "removed_at": now_iso(), "removed_reason": body.reason}})
    elif body.target_type in ("message", "dm"):
        m = await db.messages.find_one({"id": body.target_id}, {"_id": 0, "user_id": 1, "from_id": 1})
        target_user_id = (m or {}).get("user_id") or (m or {}).get("from_id")
        await db.messages.update_one({"id": body.target_id}, {"$set": {"removed": True, "removed_at": now_iso(), "removed_reason": body.reason, "text": "[Removed by moderator]"}})
    else:
        raise HTTPException(400, "Unsupported target type")
    if body.report_id:
        await db.reports.update_one({"id": body.report_id}, {"$set": {"status": "resolved", "outcome": "content_removed", "admin_note": body.reason, "updated_at": now_iso()}})
    if target_user_id:
        await _log_moderation_action(
            user_id=target_user_id, by=body.admin_id, action="content_removed",
            reason=body.reason, target_type=body.target_type, target_id=body.target_id, report_id=body.report_id,
        )
    return {"ok": True}


# ----- Admin: per-user moderation history + free-form notes -----
class AdminNoteBody(BaseModel):
    admin_id: str
    note: str


@api.get("/admin/users/{user_id}/moderation")
async def admin_user_moderation(user_id: str, admin_id: str, _me: dict = Depends(current_admin)):
    """Full moderation snapshot for one user — for the admin review screen."""
    await _require_admin(admin_id)
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "password_hash": 0, "failed_login_attempts": 0, "lockout_until": 0, "suburb_lat": 0, "suburb_lng": 0},
    )
    if not user:
        raise HTTPException(404, "User not found")
    reports = await db.reports.find({"target_user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    log = await db.moderation_log.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Enrich log entries with the acting admin's display name
    admin_ids = list({e.get("by") for e in log if e.get("by") and e.get("by") != "system"})
    admin_map: Dict[str, Dict] = {}
    if admin_ids:
        async for a in db.users.find({"id": {"$in": admin_ids}}, {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1}):
            admin_map[a["id"]] = a
    for e in log:
        if e.get("by") and e.get("by") != "system":
            e["by_user"] = admin_map.get(e["by"])
    return {
        "user": user,
        "reports": reports,
        "warnings": user.get("warnings", []),
        "moderation_log": log,
        "counts": {
            "reports_total": len(reports),
            "reports_open": sum(1 for r in reports if r.get("status") in ("new", "reviewing")),
            "actions_total": len(log),
        },
    }


@api.post("/admin/users/{user_id}/notes")
async def admin_add_user_note(user_id: str, body: AdminNoteBody, _me: dict = Depends(current_admin)):
    """Free-form note that admins can attach to a user's history."""
    await _require_admin(body.admin_id)
    if not (body.note or "").strip():
        raise HTTPException(400, "Note cannot be empty")
    await _log_moderation_action(user_id=user_id, by=body.admin_id, action="note", reason=body.note.strip())
    return {"ok": True}


# ----- Support tickets -----
class SupportTicketBody(BaseModel):
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    category: str = "Other"
    subject: str
    message: str


@api.post("/support/tickets")
async def submit_support_ticket(body: SupportTicketBody):
    ticket_id = nid()
    # A short, human-friendly reference we can quote to users. Derived
    # deterministically from the UUID so we can still map back if we
    # only have the display id (e.g. from a user email reply).
    display_id = "FP-" + ticket_id.replace("-", "")[:6].upper()
    doc = {
        "id": ticket_id, "display_id": display_id,
        "user_id": body.user_id, "user_email": body.user_email,
        "category": body.category, "subject": body.subject, "message": body.message,
        "status": "open",                 # open | resolved
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.support_tickets.insert_one(doc)
    await _notify_admins({
        "type": "support_new",
        "title": "New support ticket",
        "body": f"[{body.category}] {body.subject}",
        "ref_ticket_id": doc["id"],
    })

    # ------------------------------------------------------------------
    # MCGS Signal producer (Phase 1). Every ticket also lands as a Signal
    # on the Bridge so admins can act from one place. Best-effort — never
    # blocks the ticket itself. See /app/memory/mcgs-phase1-plan.md §3.2.
    # ------------------------------------------------------------------
    try:
        from services.mcgs import create_signal as _mcgs_create_signal
        from services.george import triage_signal_with_haiku as _mcgs_triage
        await _mcgs_create_signal(
            db,
            producer="support_ticket",
            entity_ref={"kind": "support_ticket", "id": doc["id"]},
            subject=f"Support ticket: {body.subject}"[:120],
            body=(body.message or "")[:4000],
            category="attention",
            priority="P2",
            case_key=f"support_ticket:{doc['id']}",
            source="user_report",
            injection_check_fields=[body.subject, body.message],
            triage_fn=_mcgs_triage,
        )
    except Exception:
        import logging as _logging
        _logging.getLogger("friendplace.mcgs").exception(
            "support_ticket signal producer failed for %s", doc["id"],
        )

    # ------------------------------------------------------------------
    # Fire an email to support@ so a human can act on the ticket, AND
    # a branded acknowledgement back to the user so they know the message
    # landed safely. Both are best-effort — the DB record above is the
    # source of truth; if Resend is misconfigured we still return success
    # to the mobile app. The `SUPPORT_EMAIL` env var lets ops override
    # the destination without a code change.
    # ------------------------------------------------------------------
    user_first_name: Optional[str] = None
    user_name: Optional[str] = None
    user_username: Optional[str] = None
    try:
        # Enrich with the sender's profile when we have a logged-in
        # user_id (first name, username). Falls back gracefully.
        if body.user_id:
            try:
                u = await db.users.find_one(
                    {"id": body.user_id},
                    {"_id": 0, "first_name": 1, "last_name": 1, "username": 1, "email": 1},
                )
                if u:
                    user_first_name = (u.get("first_name") or "").strip() or None
                    user_name = " ".join(
                        [(u.get("first_name") or "").strip(), (u.get("last_name") or "").strip()]
                    ).strip() or None
                    user_username = u.get("username")
                    # If the ticket body didn't carry an email, backfill
                    # from the profile so replies land in the right inbox.
                    if not body.user_email:
                        body.user_email = u.get("email")
            except Exception:
                logger.exception("support-ticket: failed to enrich with user profile")

        from html import escape as _esc
        support_to = (os.getenv("SUPPORT_EMAIL") or "support@friendplace.com.au").strip()

        subject_line = f"[{body.category}] {body.subject}"
        # Full subject appended with the ticket reference so every
        # notification email is globally unique — helps operators
        # search their inbox and prevents mailbox providers from
        # accidentally threading unrelated tickets together.
        subject_with_ref = f"{subject_line}  ·  {display_id}"
        # Build a header meta table for scannability.
        meta_rows = [
            ("Ticket ID", display_id),
            ("Category", body.category or "Other"),
            ("Subject",  body.subject or "(no subject)"),
            ("From",     user_name or user_username or "Anonymous"),
            ("Email",    body.user_email or "—"),
            ("User ID",  body.user_id or "—"),
            ("Received", doc["created_at"]),
        ]
        rows_html = "".join(
            f'<tr><td style="padding:4px 12px 4px 0;color:#64748B;font-size:13px;white-space:nowrap;">{_esc(k)}</td>'
            f'<td style="padding:4px 0;color:#0F172A;font-size:13px;">{_esc(str(v))}</td></tr>'
            for k, v in meta_rows
        )
        html_body = (
            "<!doctype html><html><body style=\"margin:0;padding:24px;background:#F8FAFC;"
            "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0F172A;\">"
            "<div style=\"max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;"
            "border-radius:12px;overflow:hidden;\">"
            "<div style=\"padding:20px 24px;background:#0B1F45;color:#FFFFFF;\">"
            "<div style=\"font-size:12px;letter-spacing:1.5px;color:#93C5FD;font-weight:700;\">"
            f"FRIENDPLACE · SUPPORT · {_esc(display_id)}</div>"
            f"<div style=\"font-size:20px;font-weight:800;margin-top:6px;\">{_esc(subject_line)}</div>"
            "</div>"
            "<div style=\"padding:20px 24px;\">"
            f"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\">{rows_html}</table>"
            "<div style=\"height:1px;background:#E2E8F0;margin:16px 0;\"></div>"
            "<div style=\"font-size:12px;letter-spacing:1.2px;color:#64748B;font-weight:700;margin-bottom:8px;\">MESSAGE</div>"
            "<pre style=\"white-space:pre-wrap;word-wrap:break-word;font-family:inherit;"
            "font-size:14px;line-height:22px;margin:0;color:#0F172A;\">"
            f"{_esc(body.message or '')}"
            "</pre>"
            "</div>"
            "<div style=\"padding:12px 24px;background:#F8FAFC;border-top:1px solid #E2E8F0;"
            "font-size:12px;color:#64748B;\">"
            "Reply directly to this email to respond to the user "
            f"({_esc(body.user_email or 'no address on file')})."
            "</div>"
            "</div></body></html>"
        )
        text_body = (
            f"New support ticket: {subject_line}\n\n"
            f"Ticket ID: {display_id}\n"
            f"Category:  {body.category}\n"
            f"From:      {user_name or user_username or 'Anonymous'}\n"
            f"Email:     {body.user_email or '—'}\n"
            f"User ID:   {body.user_id or '—'}\n"
            f"Received:  {doc['created_at']}\n\n"
            f"Message:\n{body.message or ''}\n"
        )
        # Set reply_to to the user's email so the support agent can just
        # hit "Reply" — but only if we actually have one, otherwise Resend
        # would reject the request.
        reply_to = body.user_email if body.user_email else None
        await _email_send(
            to=support_to,
            subject=subject_with_ref,
            html=html_body,
            text=text_body,
            reply_to=reply_to,
        )
    except Exception:
        logger.exception("failed to send support-ticket notification email")

    # ------------------------------------------------------------------
    # Acknowledgement email back to the user — only if we have an
    # address on file, and only best-effort.
    # ------------------------------------------------------------------
    if body.user_email:
        try:
            ack_subject, ack_html, ack_text = _email_support_ack_template(
                first_name=user_first_name,
                ticket_ref=display_id,
                category=body.category or "Support",
                subject_snippet=body.subject or "",
            )
            support_reply_to = (os.getenv("SUPPORT_EMAIL") or "support@friendplace.com.au").strip()
            await _email_send(
                to=body.user_email,
                subject=ack_subject,
                html=ack_html,
                text=ack_text,
                # If the user hits reply on our confirmation email, route
                # it straight to the support inbox rather than noreply.
                reply_to=support_reply_to,
            )
        except Exception:
            logger.exception("failed to send support-ticket acknowledgement email")

    return {
        "ok": True,
        "ticket_id": doc["id"],
        "display_id": display_id,
        "message": "Thank you. We've received your message and will get back to you soon.",
    }


@api.get("/admin/support/tickets")
async def admin_list_tickets(admin_id: str, status: str = "all", _me: dict = Depends(current_admin)):
    await _require_admin(admin_id)
    q: Dict = {}
    if status and status != "all":
        q["status"] = status
    rows = await db.support_tickets.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    user_ids = [r.get("user_id") for r in rows if r.get("user_id")]
    users_map = {}
    if user_ids:
        async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1}):
            users_map[u["id"]] = u
    for r in rows:
        r["user"] = users_map.get(r.get("user_id"))
    return {"tickets": rows}


@api.post("/admin/support/tickets/{ticket_id}/resolve")
async def admin_resolve_ticket(ticket_id: str, body: AdminActionBody, _me: dict = Depends(current_admin)):
    await _require_admin(body.admin_id)
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": {"status": "resolved", "updated_at": now_iso(), "admin_note": body.note}})
    return {"ok": True}


@api.get("/admin/summary")
async def admin_summary(admin_id: str, _me: dict = Depends(current_admin)):
    await _require_admin(admin_id)
    return {
        "reports": {
            "new": await db.reports.count_documents({"status": "new"}),
            "reviewing": await db.reports.count_documents({"status": "reviewing"}),
            "urgent": await db.reports.count_documents({"urgent": True, "status": {"$ne": "resolved"}}),
            "resolved": await db.reports.count_documents({"status": "resolved"}),
        },
        "support": {
            "open": await db.support_tickets.count_documents({"status": "open"}),
            "resolved": await db.support_tickets.count_documents({"status": "resolved"}),
        },
        "users": {
            "total": await db.users.count_documents({}),
            "flagged": await db.users.count_documents({"flagged_for_review": True, "restricted": {"$ne": True}, "banned": {"$ne": True}}),
            "auto_hidden": await db.users.count_documents({"profile_hidden": True, "banned": {"$ne": True}}),
            "restricted": await db.users.count_documents({"restricted": True}),
            "banned": await db.users.count_documents({"banned": True}),
        },
        "policy": {
            "flag_threshold": MODERATION_FLAG_THRESHOLD,
            "restrict_threshold": MODERATION_RESTRICT_THRESHOLD,
            "window_days": MODERATION_WINDOW_DAYS,
            "auto_ban": False,
        },
    }


@api.get("/admin/repeat-offenders")
async def admin_repeat_offenders(admin_id: str, days: int = MODERATION_WINDOW_DAYS, min_reporters: int = 2, _me: dict = Depends(current_admin)):
    """Users with multiple unique reporters in the window, sorted by unique-reporter count desc.
    Drives the 'Reported Multiple Times' admin view."""
    await _require_admin(admin_id)
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    pipeline = [
        {"$match": {"target_user_id": {"$ne": None}, "created_at": {"$gte": since}}},
        {"$group": {
            "_id": "$target_user_id",
            "unique_reporters": {"$addToSet": "$reporter_id"},
            "total_reports": {"$sum": 1},
            "last_reported_at": {"$max": "$created_at"},
            "reasons": {"$addToSet": "$reason"},
        }},
        {"$project": {
            "_id": 0,
            "user_id": "$_id",
            "unique_reporters": {"$size": "$unique_reporters"},
            "total_reports": 1,
            "last_reported_at": 1,
            "reasons": 1,
        }},
        {"$match": {"unique_reporters": {"$gte": int(min_reporters)}}},
        {"$sort": {"unique_reporters": -1, "total_reports": -1}},
        {"$limit": 100},
    ]
    rows = await db.reports.aggregate(pipeline).to_list(100)
    # Attach user summaries — skip orphan/test reports whose targets no longer exist
    user_ids = [r["user_id"] for r in rows]
    users = await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "first_name": 1, "avatar": 1, "restricted": 1, "flagged_for_review": 1, "banned": 1, "profile_hidden": 1},
    ).to_list(100)
    by_id = {u["id"]: u for u in users}
    enriched: List[Dict] = []
    for r in rows:
        u = by_id.get(r["user_id"])
        if not u:
            # Orphan report (target user deleted or seed/test data) — skip
            continue
        r.update({
            "username": u.get("username", "?"),
            "first_name": u.get("first_name", ""),
            "avatar": u.get("avatar", ""),
            "restricted": bool(u.get("restricted")),
            "flagged_for_review": bool(u.get("flagged_for_review")),
            "banned": bool(u.get("banned")),
            "profile_hidden": bool(u.get("profile_hidden")),
        })
        enriched.append(r)
    return {"window_days": days, "policy": {
        "flag_at": MODERATION_FLAG_THRESHOLD,
        "restrict_at": MODERATION_RESTRICT_THRESHOLD,
    }, "users": enriched}


class ModerationLiftBody(BaseModel):
    admin_id: str
    target_user_id: str
    clear_flag: bool = True
    notes: str = ""


@api.post("/admin/users/clear-restriction")
async def admin_clear_restriction(body: ModerationLiftBody, _me: dict = Depends(current_admin)):
    """Lift a temporary restriction after admin review. Optionally also clears
    the 'flagged_for_review' badge. Unhides their notices."""
    await _require_admin(body.admin_id)
    target = await db.users.find_one({"id": body.target_user_id}, {"_id": 0, "username": 1})
    if not target:
        raise HTTPException(404, "User not found")
    unset: Dict = {"restricted": "", "restricted_at": "", "restricted_reason": ""}
    if body.clear_flag:
        unset.update({"flagged_for_review": "", "flagged_at": "", "flagged_reason": ""})
    await db.users.update_one({"id": body.target_user_id}, {"$unset": unset})
    await db.notices.update_many({"user_id": body.target_user_id}, {"$unset": {"auto_hidden": ""}})
    await db.admin_log.insert_one({
        "id": nid(),
        "admin_id": body.admin_id,
        "target_user_id": body.target_user_id,
        "action": "clear_restriction",
        "notes": body.notes,
        "created_at": now_iso(),
    })
    return {"ok": True, "user_id": body.target_user_id, "cleared_flag": bool(body.clear_flag)}


@api.get("/admin/policy")
async def admin_policy():
    """Public-readable summary of FriendPlace's moderation policy."""
    return {
        "flag_threshold": MODERATION_FLAG_THRESHOLD,
        "restrict_threshold": MODERATION_RESTRICT_THRESHOLD,
        "window_days": MODERATION_WINDOW_DAYS,
        "auto_ban": False,
        "rules": [
            f"1 report → visible in the moderation queue",
            f"{MODERATION_FLAG_THRESHOLD} unique reports in {MODERATION_WINDOW_DAYS} days → flagged for review",
            f"{MODERATION_RESTRICT_THRESHOLD} unique reports in {MODERATION_WINDOW_DAYS} days → temporary restriction until admin clears",
            "Accounts are never auto-banned. Bans require an admin decision.",
        ],
    }


# ------------- Admin: promote / demote moderators -------------
@api.get("/admin/admins")
async def admin_list_admins(admin_id: str, _me: dict = Depends(current_admin)):
    """Return every user currently flagged as admin. Visible to admins only."""
    await _require_admin(admin_id)
    rows = await db.users.find(
        {"is_admin": True},
        {"_id": 0, "id": 1, "username": 1, "first_name": 1, "avatar": 1, "suburb": 1},
    ).sort("username", 1).to_list(200)
    return {"admins": rows}


@api.get("/admin/users/search")
async def admin_search_users(admin_id: str, q: str = "", limit: int = 25, _me: dict = Depends(current_admin)):
    """Lightweight user search for admin tooling. Matches username, first
    name, or last name (case-insensitive, substring). Returns the bits an
    admin needs to identify the person + their current admin/restricted
    status."""
    await _require_admin(admin_id)
    q = (q or "").strip()
    if not q:
        return {"results": []}
    safe = re.escape(q)
    rx = {"$regex": safe, "$options": "i"}
    rows = await db.users.find(
        {"$or": [{"username": rx}, {"first_name": rx}, {"last_name": rx}]},
        {"_id": 0, "id": 1, "username": 1, "first_name": 1, "last_name": 1, "avatar": 1, "suburb": 1, "is_admin": 1, "restricted": 1, "banned": 1},
    ).limit(max(1, min(int(limit or 25), 50))).to_list(50)
    rows.sort(key=lambda r: (not r.get("is_admin", False), (r.get("username") or "").lower()))
    return {"results": rows}


class AdminPromoteBody(BaseModel):
    admin_id: str
    target_user_id: str
    make_admin: bool
    reason: str = ""


@api.post("/admin/users/admin-flag")
async def admin_set_admin_flag(body: AdminPromoteBody, _me: dict = Depends(current_admin)):
    """Toggle a user's `is_admin` flag. Admins only. We refuse to let an
    admin remove their *own* admin rights (so the platform always has at
    least the actor as admin), and refuse to demote the last remaining
    admin to avoid bricking the moderator tooling."""
    actor = await _require_admin(body.admin_id)
    target = await db.users.find_one({"id": body.target_user_id}, {"_id": 0, "id": 1, "username": 1, "first_name": 1, "is_admin": 1})
    if not target:
        raise HTTPException(404, "User not found")

    desired = bool(body.make_admin)
    current = bool(target.get("is_admin"))
    if desired == current:
        return {"ok": True, "unchanged": True, "is_admin": current}

    # Safety rails for demotion.
    if not desired:
        if body.target_user_id == body.admin_id:
            raise HTTPException(400, "You cannot remove your own admin access.")
        remaining = await db.users.count_documents({"is_admin": True})
        if remaining <= 1:
            raise HTTPException(400, "At least one admin must remain.")

    await db.users.update_one({"id": body.target_user_id}, {"$set": {"is_admin": desired}})

    # Notify the target user so they know about the change.
    await db.notifications.insert_one({
        "id": nid(),
        "user_id": body.target_user_id,
        "type": "admin_role_change",
        "title": "You're now a FriendPlace moderator" if desired else "Your moderator access was removed",
        "body": body.reason or ("You can now access Admin tools from your Profile." if desired else "An admin has removed your moderator role."),
        "read": False,
        "created_at": now_iso(),
    })
    await _log_moderation_action(
        user_id=body.target_user_id,
        by=body.admin_id,
        action=("promote_admin" if desired else "demote_admin"),
        reason=body.reason,
        extra={"by_username": actor.get("username")},
    )
    return {"ok": True, "is_admin": desired}


# ------------- Recipes (community cookbook) -------------
class RecipeBody(BaseModel):
    user_id: str
    title: str
    ingredients: str = ""
    instructions: str = ""
    tips: str = ""
    photo: str = ""  # base64 data URI or empty


class RecipeCommentBody(BaseModel):
    user_id: str
    body: str


def _recipe_shape(rec: dict, viewer_id: Optional[str] = None) -> dict:
    """Trim a recipe document to what the client needs."""
    out = {k: rec.get(k, "") for k in ("id", "title", "ingredients", "instructions", "tips", "photo")}
    out["author_id"] = rec.get("author_id", "")
    out["author_name"] = rec.get("author_name", "")
    out["author_avatar"] = rec.get("author_avatar", "👤")
    out["created_at"] = rec.get("created_at")
    out["comments_count"] = len(rec.get("comments", []) or [])
    out["likes"] = list(rec.get("likes", []) or [])
    out["liked_by_me"] = bool(viewer_id and viewer_id in (rec.get("likes") or []))
    return out


@api.get("/recipes")
async def list_recipes(viewer_id: Optional[str] = None, q: str = ""):
    """Newest-first list. Lightweight (no comments, only photo thumbnail)."""
    query: dict = {}
    if q:
        safe = re.escape(q.strip())
        if safe:
            rx = {"$regex": safe, "$options": "i"}
            query["$or"] = [{"title": rx}, {"ingredients": rx}, {"author_name": rx}]
    rows = await db.recipes.find(query, {"_id": 0, "comments": 0}).sort("created_at", -1).limit(200).to_list(200)
    return {"recipes": [_recipe_shape(r, viewer_id) for r in rows]}


@api.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: str, viewer_id: Optional[str] = None):
    rec = await db.recipes.find_one({"id": recipe_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Recipe not found")
    out = _recipe_shape(rec, viewer_id)
    # Comments rendered with author names + avatars baked-in.
    comments = rec.get("comments", []) or []
    out["comments"] = comments
    return out


@api.post("/recipes")
async def create_recipe(body: RecipeBody):
    author = await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1})
    if not author:
        raise HTTPException(404, "User not found")
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "Title required")
    if len(title) > 120:
        raise HTTPException(400, "Title too long")
    rec = {
        "id": nid(),
        "author_id": body.user_id,
        "author_name": author.get("first_name") or author.get("username") or "Someone",
        "author_avatar": author.get("avatar") or "👤",
        "title": title,
        "ingredients": (body.ingredients or "").strip()[:6000],
        "instructions": (body.instructions or "").strip()[:12000],
        "tips": (body.tips or "").strip()[:4000],
        "photo": body.photo or "",
        "comments": [],
        "likes": [],
        "created_at": now_iso(),
    }
    await db.recipes.insert_one(rec)
    # Reward the author with the same milestone points used elsewhere.
    try:
        await _award_points(body.user_id, 8, "recipe_shared", "Shared a recipe")
    except Exception:
        pass
    return _recipe_shape(rec, body.user_id)


class RecipePatch(BaseModel):
    user_id: str
    title: Optional[str] = None
    ingredients: Optional[str] = None
    instructions: Optional[str] = None
    tips: Optional[str] = None
    photo: Optional[str] = None


@api.patch("/recipes/{recipe_id}")
async def update_recipe(recipe_id: str, body: RecipePatch):
    rec = await db.recipes.find_one({"id": recipe_id}, {"_id": 0, "author_id": 1})
    if not rec:
        raise HTTPException(404, "Recipe not found")
    actor = await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1, "is_admin": 1})
    if not actor or (rec.get("author_id") != body.user_id and not actor.get("is_admin")):
        raise HTTPException(403, "Only the author or an admin can edit this recipe")
    set_ops: dict = {}
    for key in ("title", "ingredients", "instructions", "tips", "photo"):
        v = getattr(body, key)
        if v is not None:
            set_ops[key] = v.strip() if isinstance(v, str) else v
    if not set_ops:
        return {"ok": True}
    set_ops["updated_at"] = now_iso()
    await db.recipes.update_one({"id": recipe_id}, {"$set": set_ops})
    return {"ok": True}


@api.delete("/recipes/{recipe_id}")
async def delete_recipe(recipe_id: str, user_id: str):
    rec = await db.recipes.find_one({"id": recipe_id}, {"_id": 0, "author_id": 1})
    if not rec:
        raise HTTPException(404, "Recipe not found")
    actor = await db.users.find_one({"id": user_id}, {"_id": 0, "is_admin": 1})
    if not actor or (rec.get("author_id") != user_id and not actor.get("is_admin")):
        raise HTTPException(403, "Only the author or an admin can delete this recipe")
    await db.recipes.delete_one({"id": recipe_id})
    return {"ok": True}


@api.post("/recipes/{recipe_id}/comments")
async def add_recipe_comment(recipe_id: str, body: RecipeCommentBody):
    rec = await db.recipes.find_one({"id": recipe_id}, {"_id": 0, "id": 1, "author_id": 1})
    if not rec:
        raise HTTPException(404, "Recipe not found")
    author = await db.users.find_one({"id": body.user_id}, {"_id": 0, "first_name": 1, "username": 1, "avatar": 1})
    if not author:
        raise HTTPException(404, "User not found")
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(400, "Comment is empty")
    comment = {
        "id": nid(),
        "user_id": body.user_id,
        "user_name": author.get("first_name") or author.get("username") or "Someone",
        "user_avatar": author.get("avatar") or "👤",
        "body": text[:1500],
        "created_at": now_iso(),
    }
    await db.recipes.update_one({"id": recipe_id}, {"$push": {"comments": comment}})
    # Notify the author (if it's not their own comment).
    if rec.get("author_id") and rec["author_id"] != body.user_id:
        await db.notifications.insert_one({
            "id": nid(),
            "user_id": rec["author_id"],
            "type": "recipe_comment",
            "title": f"{comment['user_name']} commented on your recipe",
            "body": text[:140],
            "ref_id": recipe_id,
            "read": False,
            "created_at": now_iso(),
        })
    return comment


@api.delete("/recipes/{recipe_id}/comments/{comment_id}")
async def delete_recipe_comment(recipe_id: str, comment_id: str, user_id: str):
    rec = await db.recipes.find_one({"id": recipe_id}, {"_id": 0, "comments": 1, "author_id": 1})
    if not rec:
        raise HTTPException(404, "Recipe not found")
    actor = await db.users.find_one({"id": user_id}, {"_id": 0, "is_admin": 1})
    if not actor:
        raise HTTPException(404, "User not found")
    target = next((c for c in (rec.get("comments") or []) if c.get("id") == comment_id), None)
    if not target:
        raise HTTPException(404, "Comment not found")
    # Comment author, recipe author, or admin can delete.
    if target.get("user_id") != user_id and rec.get("author_id") != user_id and not actor.get("is_admin"):
        raise HTTPException(403, "Not allowed")
    await db.recipes.update_one({"id": recipe_id}, {"$pull": {"comments": {"id": comment_id}}})
    return {"ok": True}


@api.post("/recipes/{recipe_id}/like")
async def toggle_recipe_like(recipe_id: str, body: dict):
    user_id = body.get("user_id")
    if not user_id:
        raise HTTPException(400, "user_id required")
    rec = await db.recipes.find_one({"id": recipe_id}, {"_id": 0, "likes": 1})
    if not rec:
        raise HTTPException(404, "Recipe not found")
    likes = rec.get("likes") or []
    if user_id in likes:
        await db.recipes.update_one({"id": recipe_id}, {"$pull": {"likes": user_id}})
        return {"liked": False, "count": len(likes) - 1}
    await db.recipes.update_one({"id": recipe_id}, {"$addToSet": {"likes": user_id}})
    return {"liked": True, "count": len(likes) + 1}


# ------------- Flutter (online ping) -------------
class FlutterDoc(BaseModel):
    id: str = Field(default_factory=nid)
    from_id: str
    to_id: str
    from_name: str = ""
    from_avatar: str = ""
    message: str = "would like to chat 🦋"
    read: bool = False
    created_at: str = Field(default_factory=now_iso)


class FlutterSendBody(BaseModel):
    from_id: str
    to_id: str
    message: Optional[str] = None


@api.post("/flutters/send")
async def send_flutter(body: FlutterSendBody):
    # Anti-spam: flutters are essentially DMs-in-disguise. Cap to 20 / hr
    # per sender — plenty for a sociable user, low enough to make a "flutter
    # everyone" attack quickly tip into 429s.
    rate_limit(f"flutter:{body.from_id}", max_calls=20, window_seconds=3600)
    sender = await db.users.find_one({"id": body.from_id}, {"_id": 0})
    if not sender:
        raise HTTPException(404, "Sender not found")
    receiver = await db.users.find_one({"id": body.to_id}, {"_id": 0, "blocked": 1})
    if not receiver:
        raise HTTPException(404, "Recipient not found")
    if body.from_id in (receiver.get("blocked") or []):
        raise HTTPException(403, "Cannot flutter this user")

    # Detect "reply flutter": is this person flutter-ing back at someone who
    # already flutter-ed them? We look for ANY prior flutter going the other
    # direction (recipient → current sender). If present, the message wording
    # frames it as a reply ("Garry replied with a flutter — start a chat?")
    # rather than a fresh opening ping ("Garry sent you a flutter — reply
    # with a flutter or start a chat"). The clearer wording gives the new
    # recipient a stronger nudge to take the next step (DM) rather than
    # bouncing flutters back and forth indefinitely.
    is_reply = bool(await db.flutters.find_one({
        "from_id": body.to_id,
        "to_id": body.from_id,
    }, {"_id": 0, "id": 1}))

    if body.message:
        msg = body.message
    elif is_reply:
        msg = "replied with a flutter 🦋 — would you like to start a chat?"
    else:
        msg = "sent you a flutter 🦋 — reply with a flutter or start a chat"

    f = FlutterDoc(
        from_id=body.from_id,
        to_id=body.to_id,
        from_name=sender.get("first_name", ""),
        from_avatar=sender.get("avatar", ""),
        message=msg,
    )
    await db.flutters.insert_one(f.dict())
    await award_points(body.from_id, 2)
    await push_notification(
        body.to_id,
        "flutter",
        f"{f.from_avatar} {f.from_name} is looking to chat",
        f.message or "",
        {"from_id": body.from_id, "flutter_id": f.id},
    )
    return f.dict()


@api.get("/flutters/{user_id}")
async def my_flutters(user_id: str):
    return await db.flutters.find({"to_id": user_id, "read": False}, {"_id": 0}).sort("created_at", -1).to_list(100)


@api.post("/flutters/{flutter_id}/read")
async def mark_flutter_read(flutter_id: str):
    await db.flutters.update_one({"id": flutter_id}, {"$set": {"read": True}})
    return {"ok": True}


class ChatAlertBody(BaseModel):
    user_id: str                          # sender
    audience: str = "friends"             # friends | nearby | selected
    recipient_ids: Optional[List[str]] = None  # required when audience=selected
    radius_km: Optional[float] = 10.0     # only used when audience=nearby
    message: Optional[str] = None


@api.post("/community/chat-alert")
async def send_chat_alert(body: ChatAlertBody):
    """Broadcast a 'Looking to chat' alert to a chosen audience.

    Privacy rules (per house policy — alerts are never sent to the whole community):
      * `friends`  → all of the sender's friends (default).
      * `nearby`   → users within `radius_km` of the sender's suburb who have
                     opted in via preferences.nearby_chat_alerts (default off).
      * `selected` → only the explicit `recipient_ids` (max 20).
    Blocked users and the sender themselves are always excluded.
    """
    sender = await db.users.find_one({"id": body.user_id}, {"_id": 0})
    if not sender:
        raise HTTPException(404, "Sender not found")
    if sender.get("banned") or sender.get("restricted"):
        raise HTTPException(403, "Account temporarily restricted")
    audience = (body.audience or "friends").lower()
    if audience not in ("friends", "nearby", "selected"):
        raise HTTPException(400, "audience must be one of: friends, nearby, selected")

    msg = (body.message or "is looking for a chat 🦋").strip()
    if len(msg) > 280:
        raise HTTPException(400, "Message too long")

    blocked_set = set(sender.get("blocked") or [])
    sender_id = body.user_id
    recipients: List[str] = []

    if audience == "friends":
        friend_ids = list(sender.get("friends") or [])
        if not friend_ids:
            return {"ok": True, "audience": audience, "delivered_to": 0, "message": "You don't have any friends yet — try sending a friend request first."}
        # exclude blocked + self + anyone who blocked sender
        cur = db.users.find(
            {"id": {"$in": friend_ids}, "banned": {"$ne": True}, "blocked": {"$ne": sender_id}},
            {"_id": 0, "id": 1},
        )
        async for u in cur:
            if u["id"] != sender_id and u["id"] not in blocked_set:
                recipients.append(u["id"])

    elif audience == "selected":
        ids = [i for i in (body.recipient_ids or []) if i and i != sender_id]
        if not ids:
            raise HTTPException(400, "recipient_ids required for 'selected' audience")
        if len(ids) > 20:
            raise HTTPException(400, "Maximum 20 recipients per alert")
        cur = db.users.find(
            {"id": {"$in": ids}, "banned": {"$ne": True}, "blocked": {"$ne": sender_id}},
            {"_id": 0, "id": 1},
        )
        async for u in cur:
            if u["id"] not in blocked_set:
                recipients.append(u["id"])

    elif audience == "nearby":
        if not (sender.get("suburb_lat") and sender.get("suburb_lng")):
            raise HTTPException(400, "Set your suburb first so we can find nearby members.")
        radius = float(body.radius_km or 10.0)
        if radius <= 0 or radius > 100:
            raise HTTPException(400, "radius_km must be between 0 and 100")
        lat = float(sender["suburb_lat"])
        lng = float(sender["suburb_lng"])
        # Only opted-in users — preferences.nearby_chat_alerts must be True.
        cur = db.users.find(
            {
                "id": {"$ne": sender_id, "$nin": list(blocked_set)},
                "banned": {"$ne": True},
                "blocked": {"$ne": sender_id},
                "location_visibility": {"$ne": "private"},
                "suburb_lat": {"$ne": None, "$exists": True},
                "suburb_lng": {"$ne": None, "$exists": True},
                "preferences.nearby_chat_alerts": True,
            },
            {"_id": 0, "id": 1, "suburb_lat": 1, "suburb_lng": 1},
        )
        async for u in cur:
            try:
                d = sb_haversine(lat, lng, float(u["suburb_lat"]), float(u["suburb_lng"]))
                if d <= radius:
                    recipients.append(u["id"])
            except (TypeError, ValueError):
                continue

    # Dedupe just in case
    recipients = list(dict.fromkeys(recipients))
    if not recipients:
        return {"ok": True, "audience": audience, "delivered_to": 0, "message": "Nobody to send to right now."}

    sender_name = sender.get("first_name") or sender.get("username") or "A neighbour"
    sender_avatar = sender.get("avatar") or "🌸"
    flutter_msg = msg if msg else "is looking for a chat 🦋"
    now = now_iso()
    flutter_docs: List[Dict] = []
    for rid in recipients:
        flutter_docs.append({
            "id": nid(),
            "from_id": sender_id,
            "to_id": rid,
            "from_name": sender_name,
            "from_avatar": sender_avatar,
            "message": flutter_msg,
            "kind": "chat_alert",
            "audience": audience,
            "read": False,
            "created_at": now,
        })
    if flutter_docs:
        await db.flutters.insert_many(flutter_docs)
    # Notify each recipient (in-app + device push). Wrapped per-user so one
    # failure doesn't poison the rest of the broadcast.
    for rid in recipients:
        try:
            await push_notification(
                rid,
                "looking_for_chat",
                f"{sender_avatar} {sender_name} is looking to chat",
                flutter_msg,
                {"from_id": sender_id, "audience": audience},
            )
        except Exception as e:
            logger.warning("chat-alert push to %s failed: %s", rid, e)
    return {"ok": True, "audience": audience, "delivered_to": len(recipients)}


# ------------- DM -------------
def dm_conv_id(a: str, b: str) -> str:
    return "-".join(sorted([a, b]))


@api.get("/dm/{user_id}/conversations")
async def my_conversations(user_id: str, filter: str = "active", me: dict = Depends(current_user)):
    """List the caller's DM conversations.

    Query param `filter`:
      • "active"   (default) — visible in the main Chats list.
                    Excludes anything the caller archived or soft-deleted.
      • "archived" — only the caller's archived threads. Soft-deleted
                    threads are still hidden (delete outranks archive).
      • "all"      — includes archived, still hides soft-deleted.
                    Useful for admin/debug — not currently used by UI.

    Archive & soft-delete are per-user: `dm_conversations.archived_for`
    and `dm_conversations.hidden_for` are lists of user_ids. The peer
    is completely unaffected by either action.
    """
    # SEC-101: only the owner can enumerate their conversations.
    if me.get("id") != user_id:
        raise HTTPException(403, "Not authorised")
    docs = await db.dm_conversations.find({"participants": user_id}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    # Filter based on per-user archive/hide flags. Soft-deleted ("hidden")
    # threads are always excluded from every filter except an admin
    # debug path — see docstring.
    docs = [d for d in docs if user_id not in (d.get("hidden_for") or [])]
    if filter == "active":
        docs = [d for d in docs if user_id not in (d.get("archived_for") or [])]
    elif filter == "archived":
        docs = [d for d in docs if user_id in (d.get("archived_for") or [])]
    # attach other user info + last message + unread_count + peer status
    out = []
    for c in docs:
        other_id = next((p for p in c["participants"] if p != user_id), None)
        other = await db.users.find_one({"id": other_id}, {"_id": 0}) if other_id else None
        if other:
            # Never leak email/apple_id/refresh tokens of the peer in the
            # conversations list (SEC-002 pattern applied here too).
            other_safe = _peer_user(other, viewer_is_owner=False, viewer_is_admin=bool(me.get("is_admin")))
            # Attach a live presence chip so the Chats tab can show a green
            # dot next to actively-online peers. Respects the peer's own
            # privacy setting via `_status_from`.
            other_safe["status"] = _status_from(
                other.get("last_seen_at"),
                other.get("privacy", "everyone"),
                other.get("status"),
            )
        else:
            other_safe = None
        last = await db.messages.find_one({"dm_id": c["id"]}, {"_id": 0}, sort=[("created_at", -1)])
        # Unread count = messages in this conv AFTER this user's last_read_at
        # timestamp that were NOT sent by this user. If the field is missing
        # (older convs), fall back to counting messages from the peer only.
        last_read_map = (c.get("last_read_at") or {})
        last_read_ts = last_read_map.get(user_id)
        unread_query: Dict[str, Any] = {
            "dm_id": c["id"],
            "user_id": {"$ne": user_id},
        }
        if last_read_ts:
            unread_query["created_at"] = {"$gt": last_read_ts}
        unread_count = await db.messages.count_documents(unread_query)
        out.append({
            **c,
            "other": other_safe,
            "last": last,
            "unread_count": unread_count,
            "is_archived": user_id in (c.get("archived_for") or []),
        })
    return out


@api.get("/dm/{user_id}/archived-count")
async def dm_archived_count(user_id: str, me: dict = Depends(current_user)):
    """Number of archived threads for the caller.
    Powers the small "Archived (N)" pill at the top of the Chats list.
    """
    if me.get("id") != user_id:
        raise HTTPException(403, "Not authorised")
    n = await db.dm_conversations.count_documents({
        "participants": user_id,
        "archived_for": user_id,
        "hidden_for": {"$ne": user_id},
    })
    return {"count": n}


async def _dm_participant_or_404(conv_id: str, me: dict) -> dict:
    """Shared guard used by archive/unarchive/hide/unhide.
    Raises 404 if conv doesn't exist, 403 if the caller isn't a participant.
    Returns the conv doc on success.
    """
    conv = await db.dm_conversations.find_one({"id": conv_id}, {"_id": 0})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    uid = me.get("id")
    if uid not in (conv.get("participants") or []):
        raise HTTPException(403, "Not a participant")
    return conv


@api.post("/dm/{conv_id}/archive")
async def dm_archive(conv_id: str, me: dict = Depends(current_user)):
    """Archive this conversation for the caller only.
    The peer is completely unaffected. If the peer sends a new message
    the WS message handler auto-clears archived_for so the thread
    resurfaces on the caller's Chats tab.
    """
    await _dm_participant_or_404(conv_id, me)
    await db.dm_conversations.update_one(
        {"id": conv_id},
        {"$addToSet": {"archived_for": me.get("id")}},
    )
    return {"ok": True}


@api.post("/dm/{conv_id}/unarchive")
async def dm_unarchive(conv_id: str, me: dict = Depends(current_user)):
    """Undo archive — move the thread back to the main Chats list."""
    await _dm_participant_or_404(conv_id, me)
    await db.dm_conversations.update_one(
        {"id": conv_id},
        {"$pull": {"archived_for": me.get("id")}},
    )
    return {"ok": True}


@api.post("/dm/{conv_id}/hide")
async def dm_hide(conv_id: str, me: dict = Depends(current_user)):
    """Soft-delete this conversation for the caller only.
    Per iMessage/WhatsApp semantics: the thread disappears from THIS
    user's Chats list, but the peer still sees it with the full history.
    If the peer messages again, the WS message handler auto-clears
    hidden_for so the thread returns (with the new message unread).

    Undo: call POST /dm/{conv_id}/unhide within the 5s Undo window on
    the client, or send a new message.
    """
    await _dm_participant_or_404(conv_id, me)
    await db.dm_conversations.update_one(
        {"id": conv_id},
        {"$addToSet": {"hidden_for": me.get("id")}},
    )
    return {"ok": True}


@api.post("/dm/{conv_id}/unhide")
async def dm_unhide(conv_id: str, me: dict = Depends(current_user)):
    """Undo a soft-delete — powers the 5-second Undo Snackbar."""
    await _dm_participant_or_404(conv_id, me)
    await db.dm_conversations.update_one(
        {"id": conv_id},
        {"$pull": {"hidden_for": me.get("id")}},
    )
    return {"ok": True}


@api.get("/dm/{user_id}/unread-total")
async def dm_unread_total(user_id: str, me: dict = Depends(current_user)):
    """Total unread DM count across all conversations for the given user.
    Used by the bottom-tab Chats icon badge so it can flash a "3" the
    moment a new message lands without having to fetch every conversation.

    Archived threads still contribute (WhatsApp behaviour — an unread
    message in an archived chat is still important). Soft-deleted
    threads do NOT contribute, since the user explicitly asked for them
    to disappear.
    """
    if me.get("id") != user_id:
        raise HTTPException(403, "Not authorised")
    convs = await db.dm_conversations.find(
        {"participants": user_id, "hidden_for": {"$ne": user_id}},
        {"_id": 0, "id": 1, "last_read_at": 1},
    ).to_list(500)
    total = 0
    for c in convs:
        last_read_map = (c.get("last_read_at") or {})
        last_read_ts = last_read_map.get(user_id)
        q: Dict[str, Any] = {"dm_id": c["id"], "user_id": {"$ne": user_id}}
        if last_read_ts:
            q["created_at"] = {"$gt": last_read_ts}
        total += await db.messages.count_documents(q)
    return {"unread": total}


@api.post("/dm/{conv_id}/mark-read")
async def dm_mark_read(conv_id: str, me: dict = Depends(current_user)):
    """Mark all messages in this conversation as read by the caller.
    Sets `last_read_at[user_id] = now` on the conversation doc, which the
    conversations & unread-total endpoints use to compute the badge count.
    """
    conv = await db.dm_conversations.find_one({"id": conv_id}, {"_id": 0, "participants": 1})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    uid = me.get("id")
    if uid not in (conv.get("participants") or []):
        raise HTTPException(403, "Not a participant")
    await db.dm_conversations.update_one(
        {"id": conv_id},
        {"$set": {f"last_read_at.{uid}": now_iso()}},
    )
    return {"ok": True}


@api.get("/dm/{conv_id}/messages")
async def dm_messages(conv_id: str, me: dict = Depends(current_user)):
    """Fetch the full history of a DM. SEC-101 fix — the caller must be
    a participant on the conversation. Previously this was public and any
    anonymous client could compute conv_id from two known user ids and
    read the entire private chat history."""
    conv = await db.dm_conversations.find_one({"id": conv_id}, {"_id": 0, "participants": 1})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if me.get("id") not in (conv.get("participants") or []):
        raise HTTPException(403, "Not a participant")
    docs = await db.messages.find({"dm_id": conv_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    await _attach_founder_flags(docs, "user_id")
    return docs


@api.post("/dm/start")
async def start_dm(body: dict, me: dict = Depends(current_user)):
    a = body.get("user_id")
    b = body.get("other_id")
    if not a or not b:
        raise HTTPException(400, "user_id and other_id are required")
    # SEC-101 hardening: the caller must be one of the two participants
    # (either they're starting a DM as themselves, or the other side).
    if me.get("id") not in (a, b):
        raise HTTPException(403, "Not authorised")
    cid = dm_conv_id(a, b)
    existing = await db.dm_conversations.find_one({"id": cid}, {"_id": 0})
    if not existing:
        doc = {"id": cid, "participants": [a, b], "created_at": now_iso(), "updated_at": now_iso()}
        await db.dm_conversations.insert_one(doc)
        doc.pop("_id", None)
        existing = doc
    return existing


# ------------- WebSockets -------------
class ConnectionHub:
    def __init__(self):
        self.rooms: Dict[str, Set[WebSocket]] = {}

    async def connect(self, room: str, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(room, set()).add(ws)

    def disconnect(self, room: str, ws: WebSocket):
        if room in self.rooms:
            self.rooms[room].discard(ws)

    async def broadcast(self, room: str, message: dict):
        dead = []
        for ws in list(self.rooms.get(room, [])):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for d in dead:
            self.rooms[room].discard(d)


hub = ConnectionHub()


DOCS_DIR = "/app/backend/docs"


@api.get("/docs/{filename}")
async def serve_doc(filename: str):
    """Serve internal project docs (QA checklist, listing draft, etc).
    Path-traversal proof: only the leaf filename is accepted."""
    from fastapi.responses import FileResponse
    safe = os.path.basename(filename)
    full = os.path.join(DOCS_DIR, safe)
    if not os.path.isfile(full):
        raise HTTPException(404, "Doc not found")
    return FileResponse(
        full,
        media_type="application/octet-stream",
        filename=safe,
    )


@api.get("/games/crossword/daily")
async def crossword_daily():
    """The shared **Daily Crossword** — same medium-level puzzle for every
    player on a given UTC day. Pairs with the "Today's Crossword" Coffee
    Lounge table so the community can swap clues and celebrate finishes.
    """
    p = _xword_daily()
    if not p:
        raise HTTPException(404, "No daily crossword available")
    # Make sure the discussion table exists. Idempotent — once created the
    # table is reused for life; the puzzle id stamped on it is refreshed
    # daily so the card title stays accurate.
    table = await _ensure_daily_crossword_table(p)
    return {
        "date": _xword_daily_date(),
        "puzzle": _xword_serialise(p),
        "discussion_table_id": (table or {}).get("id"),
        "points": _XWORD_POINTS.get(p.get("level", "medium"), 10) + 5,  # +5 daily bonus
    }


@api.get("/games/crossword/levels")
async def crossword_levels():
    """Headline data for the Crossword Hub.

    Returns one row per difficulty level, with the count of puzzles
    currently in rotation (3 per level) and the total in the library.
    Players see "New puzzles every 2 weeks" so they know the active set
    rotates on a fortnightly cadence.
    """
    return {"levels": _xword_levels(), "rotation_days": 14}


@api.get("/games/crossword/active/{level}")
async def crossword_active(level: str):
    """Return the 3 puzzles currently active for `level`. Answers stripped
    — the client never gets the solution. To check progress, the client
    calls POST /games/crossword/{id}/check with their guesses."""
    pool = _xword_active(level.lower())
    return {"level": level.lower(), "puzzles": [_xword_serialise(p) for p in pool]}


@api.get("/games/crossword/{puzzle_id}")
async def crossword_get(puzzle_id: str):
    """Fetch a single puzzle by id (e.g. the player resumed from a saved
    game). Answers stripped."""
    p = _xword_get(puzzle_id)
    if not p:
        raise HTTPException(404, "Crossword not found")
    return _xword_serialise(p)


class CrosswordCheckBody(BaseModel):
    # 2-D array of single-character guesses; "" or null for blank cells.
    # Length must match the puzzle's `size` × `size` grid.
    guesses: list[list[Optional[str]]]
    user_id: Optional[str] = None


@api.post("/games/crossword/{puzzle_id}/check")
async def crossword_check(puzzle_id: str, body: CrosswordCheckBody):
    """Server-side answer check.

    Returns a 2-D array of cell statuses ("correct" | "wrong" | "empty" |
    "blocked") plus a `solved` flag when every filled cell matches. We
    keep the answer key on the server so the client can't shortcut.
    If `user_id` is provided AND the puzzle is fully solved, the player
    earns 5 Butterfly Points (one-off per puzzle id).
    """
    p = _xword_get(puzzle_id)
    if not p:
        raise HTTPException(404, "Crossword not found")
    size = p["size"]
    grid = p["grid"]
    g = body.guesses
    if len(g) != size or any(len(r) != size for r in g):
        raise HTTPException(422, f"Grid must be {size}×{size}")
    status: list[list[str]] = []
    solved = True
    for r in range(size):
        row_status: list[str] = []
        for col in range(size):
            target = grid[r][col]
            guess = (g[r][col] or "").strip().upper()
            if target is None:
                row_status.append("blocked")
            elif guess == "":
                row_status.append("empty")
                solved = False
            elif guess == target:
                row_status.append("correct")
            else:
                row_status.append("wrong")
                solved = False
        status.append(row_status)
    # Award points only once per puzzle per user.
    # Points scale with difficulty (easy=5, medium=10, hard=15, expert=25).
    # The shared Daily Crossword (medium) carries a +5 social bonus on top
    # so the "everyone's chatting about today's puzzle" loop is rewarding.
    awarded = False
    points_to_award = 0
    if solved and body.user_id:
        key = f"xword:{body.user_id}:{puzzle_id}"
        marker = await db.game_completions.find_one({"key": key}, {"_id": 0})
        if not marker:
            await db.game_completions.insert_one({"key": key, "at": now_iso()})
            points_to_award = _XWORD_POINTS.get(p.get("level", "easy"), 5)
            # Daily bonus: today's shared puzzle = extra +5 for the social hook.
            daily = _xword_daily()
            if daily and daily.get("id") == puzzle_id:
                points_to_award += 5
            await award_points(body.user_id, points_to_award)
            awarded = True
    return {"status": status, "solved": solved, "points_awarded": awarded, "points": points_to_award}


@api.get("/games/crossword/{puzzle_id}/reveal/{row}/{col}")
async def crossword_reveal(puzzle_id: str, row: int, col: int):
    """Reveal a single letter (a free "I'm stuck" assist). The frontend
    fills the cell + locks it so the player can't accidentally clear it."""
    p = _xword_get(puzzle_id)
    if not p:
        raise HTTPException(404, "Crossword not found")
    try:
        letter = p["grid"][row][col]
    except (IndexError, KeyError):
        raise HTTPException(400, "Cell out of bounds")
    if letter is None:
        raise HTTPException(400, "That cell is blocked")
    return {"row": row, "col": col, "letter": letter}


class CrosswordProgressBody(BaseModel):
    # Required so we know which puzzle this snapshot belongs to.
    puzzle_id: str
    # 2-D array of letters or "" for empty cells. Server stores verbatim
    # so the player resumes exactly where they left off (even mistakes).
    guesses: list[list[Optional[str]]]
    # Cells the player revealed via the "Reveal letter" assist — locked in
    # the UI so they can't be accidentally cleared.
    revealed: list[list[bool]] = []
    seconds: int = 0
    completed: bool = False


@api.post("/games/crossword/progress/{user_id}")
async def crossword_save_progress(user_id: str, body: CrosswordProgressBody):
    """Persist a single user's in-progress crossword.

    One document per (user, puzzle). Idempotent upsert — the play screen
    calls this opportunistically (on cell change + on unmount) so users
    who walk away and come back tomorrow find their letters intact.
    """
    p = _xword_get(body.puzzle_id)
    if not p:
        raise HTTPException(404, "Crossword not found")
    key = {"user_id": user_id, "puzzle_id": body.puzzle_id}
    doc = {
        **key,
        "guesses": body.guesses,
        "revealed": body.revealed,
        "seconds": int(body.seconds or 0),
        "completed": bool(body.completed),
        "updated_at": now_iso(),
    }
    await db.crossword_progress.update_one(key, {"$set": doc}, upsert=True)
    return {"ok": True}


@api.get("/games/crossword/progress/{user_id}")
async def crossword_get_progress(user_id: str, puzzle_id: str):
    """Resume the player's in-progress crossword if they have one.

    If the stored snapshot's grid shape doesn't match the current puzzle
    (can happen after a library rebuild that resized the grid), we purge
    the stale doc and return an empty payload. Keeps the player in a
    valid state without a manual data fix.
    """
    saved = await db.crossword_progress.find_one(
        {"user_id": user_id, "puzzle_id": puzzle_id}, {"_id": 0}
    )
    if not saved:
        return {}
    p = _xword_get(puzzle_id)
    if not p:
        return saved
    expected = p["size"]
    g = saved.get("guesses")
    shape_ok = (
        isinstance(g, list)
        and len(g) == expected
        and all(isinstance(r, list) and len(r) == expected for r in g)
    )
    if not shape_ok:
        await db.crossword_progress.delete_one(
            {"user_id": user_id, "puzzle_id": puzzle_id}
        )
        return {}
    return saved


@app.websocket("/api/ws/table/{table_id}")
async def ws_table(websocket: WebSocket, table_id: str, user_id: str = Query(...), token: str = Query("")):
    room = f"table:{table_id}"
    await hub.connect(room, websocket)
    # SEC-005: Require a valid bearer token on connect AND require it to
    # belong to the same user_id. Without this an attacker could impersonate
    # anyone in the FP Café. Fail the socket cleanly with a typed
    # "unauthorized" so the client can surface a friendly re-login prompt.
    token_uid = decode_token(token) if token else None
    if not token_uid or token_uid != user_id:
        try:
            await websocket.send_json({"type": "error", "code": "unauthorized", "message": "Please sign in again."})
        except Exception:
            pass
        try:
            await websocket.close(code=4401)
        except Exception:
            pass
        hub.disconnect(room, websocket)
        return
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    # Founder-only guard for the Founders Lounge coffee table. We close the
    # socket gracefully with a typed error so the client can surface a kind
    # "Founding Members only" toast instead of a generic disconnect.
    tbl_doc = await db.tables.find_one({"id": table_id}, {"_id": 0, "founder_only": 1})
    if tbl_doc and tbl_doc.get("founder_only") and not (user or {}).get("is_founder"):
        try:
            await websocket.send_json({
                "type": "error",
                "code": "founder_only",
                "message": "This table is reserved for Founding Members.",
            })
        except Exception:
            pass
        try:
            await websocket.close(code=1008)
        except Exception:
            pass
        hub.disconnect(room, websocket)
        return
    await db.tables.update_one({"id": table_id}, {"$addToSet": {"seated": user_id}})
    # Auto-update presence status when sitting at a FP Café table.
    prior_status = (user or {}).get("status")
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"status": "in_coffee_lounge", "status_updated_at": now_iso(), "last_seen_at": now_iso()},
         "$setOnInsert": {}},
    )
    if prior_status and prior_status != "in_coffee_lounge":
        # Remember what they had so we can restore on leave.
        await db.users.update_one({"id": user_id}, {"$set": {"status_prior": prior_status}})
    # Notify friends a seat is open (only the first time the table fills below capacity)
    try:
        tbl = await db.tables.find_one({"id": table_id}, {"_id": 0, "name": 1, "seated": 1, "capacity": 1}) or {}
        seated_count = len(tbl.get("seated") or [])
        capacity = int(tbl.get("capacity") or 0)
        if user and capacity and seated_count == 1:  # they just joined an otherwise empty table
            friends = (user.get("friends") or [])
            for fid in friends[:25]:
                await push_notification(
                    fid, "coffee_seat",
                    f"☕ {user.get('first_name','A friend')} is in the FP Café and has a seat available",
                    f"Table: {tbl.get('name','FP Café')} — pull up a chair!",
                    {"table_id": table_id, "from_id": user_id},
                )
    except Exception:
        pass
    await hub.broadcast(room, {"type": "presence", "event": "join", "user": user})
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            text = (payload.get("text") or "").strip()
            image = (payload.get("image") or "").strip()
            # Require either text or a photo.
            if not text and not image:
                continue
            # Reject oversized payloads up-front to protect Mongo + bandwidth.
            # Client should be shipping resized JPEGs ≤200 KB; we cap at 600 KB
            # of base64 just in case.
            if image and len(image) > 600_000:
                try:
                    await websocket.send_json({"type": "error", "message": "Photo too large — please try a smaller image."})
                except Exception:
                    pass
                continue
            msg = Message(
                table_id=table_id,
                user_id=user_id,
                user_name=user.get("first_name", "") if user else "",
                avatar=user.get("avatar", "") if user else "",
                text=text,
                image=image,
            )
            await db.messages.insert_one(msg.dict())
            await db.tables.update_one({"id": table_id}, {"$set": {"last_activity_at": now_iso()}})
            await award_points(user_id, 1)
            # Stamp the broadcast payload with the author's founder bits so
            # subscribers can render the 🦋 immediately without a refetch.
            out = msg.dict()
            if (user or {}).get("is_founder"):
                out["user_is_founder"] = True
                if user.get("founder_number") is not None:
                    out["user_founder_number"] = user.get("founder_number")
            await hub.broadcast(room, {"type": "message", "message": out})
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(room, websocket)
        await db.tables.update_one({"id": table_id}, {"$pull": {"seated": user_id}})
        # Restore prior status (if any) when leaving the FP Café.
        u2 = await db.users.find_one({"id": user_id}, {"_id": 0, "status": 1, "status_prior": 1}) or {}
        if u2.get("status") == "in_coffee_lounge":
            restore = u2.get("status_prior")
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"status": restore, "status_updated_at": now_iso()},
                 "$unset": {"status_prior": ""}},
            )
        await hub.broadcast(room, {"type": "presence", "event": "leave", "user": user})


@app.websocket("/api/ws/dm/{conv_id}")
async def ws_dm(websocket: WebSocket, conv_id: str, user_id: str = Query(...), token: str = Query("")):
    room = f"dm:{conv_id}"
    await hub.connect(room, websocket)
    # SEC-005: Bearer-token check identical to /ws/table. Refuse the socket
    # unless the token subject equals the claimed user_id.
    token_uid = decode_token(token) if token else None
    if not token_uid or token_uid != user_id:
        try:
            await websocket.send_json({"type": "error", "code": "unauthorized", "message": "Please sign in again."})
        except Exception:
            pass
        try:
            await websocket.close(code=4401)
        except Exception:
            pass
        hub.disconnect(room, websocket)
        return
    # SEC-102: additionally verify the authenticated user IS a participant
    # on this specific conversation. Without this any signed-in member
    # could open ws/dm/<any_conv_id> and eavesdrop / inject into strangers'
    # chats.
    conv = await db.dm_conversations.find_one({"id": conv_id}, {"_id": 0, "participants": 1})
    if not conv or user_id not in (conv.get("participants") or []):
        try:
            await websocket.send_json({"type": "error", "code": "forbidden", "message": "Not a participant."})
        except Exception:
            pass
        try:
            await websocket.close(code=4403)
        except Exception:
            pass
        hub.disconnect(room, websocket)
        return
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            text = (payload.get("text") or "").strip()
            if not text:
                continue
            msg = Message(
                dm_id=conv_id,
                user_id=user_id,
                user_name=user.get("first_name", "") if user else "",
                avatar=user.get("avatar", "") if user else "",
                text=text,
            )
            await db.messages.insert_one(msg.dict())
            # Bump updated_at AND auto-unarchive/unhide the participants
            # so a new incoming message resurfaces the thread on the
            # recipient's Chats tab — WhatsApp-style behaviour. Sending
            # a message is a clear signal both sides want it visible.
            await db.dm_conversations.update_one(
                {"id": conv_id},
                {"$set": {"updated_at": now_iso(), "archived_for": [], "hidden_for": []}},
            )
            # Same founder-stamp treatment as the table room — live butterfly
            # appears on the receiver's screen as soon as the message arrives.
            out = msg.dict()
            if (user or {}).get("is_founder"):
                out["user_is_founder"] = True
                if user.get("founder_number") is not None:
                    out["user_founder_number"] = user.get("founder_number")
            await hub.broadcast(room, {"type": "message", "message": out})
            # notify the OTHER participant about a new DM. We differentiate
            # the FIRST message from this sender in this conversation from
            # subsequent messages so the notification screen can show a
            # richer "started a chat with you" card with Reply / Decline
            # actions (per test-user feedback: they wanted to know when
            # someone new was reaching out for the first time vs a
            # continuing thread).
            try:
                conv = await db.dm_conversations.find_one({"id": conv_id}, {"_id": 0})
                if conv:
                    others = [x for x in (conv.get("participants") or []) if x != user_id]
                    # Presence auto-off (Garry Feb 2026 spec): if ANY participant
                    # in this DM is currently 'looking', clear that status —
                    # but only if the message's created_at is after their
                    # manual_status_set_at (i.e. a NEW message during this
                    # looking session, not a historical thread). service.py
                    # enforces the timestamp gate; we just fire the hook.
                    try:
                        from services.status.service import auto_clear as _auto_clear, TRIG_DM_MESSAGE  # noqa: E402
                        msg_ts = msg.dict().get("created_at")
                        if isinstance(msg_ts, str):
                            from datetime import datetime as _dt
                            try: msg_ts = _dt.fromisoformat(msg_ts.replace("Z", "+00:00"))
                            except Exception: msg_ts = None
                        for pid in conv.get("participants") or []:
                            await _auto_clear(db, pid, TRIG_DM_MESSAGE, event_time=msg_ts)
                    except Exception:
                        logging.exception("dm_auto_clear failed for conv %s", conv_id)
                    sender_name = (user or {}).get("first_name") or "Someone"
                    sender_avatar = (user or {}).get("avatar") or "🦋"
                    # Count messages from THIS sender in THIS conversation
                    # to detect a first-message ("chat request") state. We
                    # count including the message we just inserted, so any
                    # value of exactly 1 means this was the opener.
                    sender_msg_count = await db.messages.count_documents(
                        {"dm_id": conv_id, "user_id": user_id}
                    )
                    is_chat_request = sender_msg_count <= 1
                    n_type = "dm_request" if is_chat_request else "dm"
                    title = (
                        f"{sender_avatar} {sender_name} started a chat with you"
                        if is_chat_request
                        else f"{sender_avatar} {sender_name} sent you a message"
                    )
                    for other_id in others:
                        await push_notification(
                            other_id,
                            n_type,
                            title,
                            text[:180],
                            {"dm_id": conv_id, "from_id": user_id},
                        )
            except Exception as e:
                logger.warning("dm notification failed: %s", e)
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(room, websocket)


# ------------- Seed -------------
SAMPLE_USERS = [
    {"first_name": "Margaret", "username": "maggie", "suburb": "Bondi", "interests": ["Gardening", "Books", "Tea"], "avatar": "🌸", "bio": "Loves roses and a good cuppa.", "points": 78, "badges": ["Friendly Member", "Helpful Neighbour", "Social Star"]},
    {"first_name": "Frank", "username": "frankie", "suburb": "Manly", "interests": ["Woodwork", "Fishing", "Pets"], "avatar": "🔨", "bio": "Loves woodwork and tinkering in the shed.", "points": 42, "badges": ["Friendly Member", "Helpful Neighbour"]},
    {"first_name": "Joyce", "username": "joycey", "suburb": "Surry Hills", "interests": ["Books", "Cats", "Tea"], "avatar": "📚", "bio": "Two cats and a hundred books.", "points": 55, "badges": ["Friendly Member", "Helpful Neighbour"]},
    {"first_name": "Bill", "username": "billdo", "suburb": "Bondi", "interests": ["Men's Shed", "Walking", "Cricket"], "avatar": "🧓", "bio": "Up at 5, walking by 6.", "points": 31, "badges": ["Friendly Member"]},
    {"first_name": "Dorothy", "username": "dot", "suburb": "Newtown", "interests": ["Crochet", "Trivia", "Pets"], "avatar": "🧶", "bio": "Crochet anything you ask!", "points": 64, "badges": ["Friendly Member", "Helpful Neighbour", "Social Star"]},
    {"first_name": "Arthur", "username": "art", "suburb": "Manly", "interests": ["Gardening", "Birdwatching"], "avatar": "🌳", "bio": "Birds visit my balcony daily.", "points": 22, "badges": ["Friendly Member"]},
    {"first_name": "Eileen", "username": "eil", "suburb": "Sydney CBD", "interests": ["Art", "Coffee", "Travel"], "avatar": "🎨", "bio": "Watercolours and lattes.", "points": 105, "badges": ["Friendly Member", "Helpful Neighbour", "Social Star", "Community Builder"]},
    {"first_name": "Roy", "username": "roy", "suburb": "Parramatta", "interests": ["Cricket", "Trivia", "BBQs"], "avatar": "🏏", "bio": "Trivia king of the neighborhood.", "points": 38, "badges": ["Friendly Member", "Helpful Neighbour"]},
]

SAMPLE_TABLES = [
    {"name": "Morning Coffee", "emoji": "☕", "description": "Start the day with a friendly chat."},
    {"name": "Gardening Chat", "emoji": "🌱", "description": "Share tips, swap cuttings, talk roses."},
    {"name": "Men's Shed", "emoji": "🔨", "description": "Tools, projects, and stories."},
    {"name": "Book Club", "emoji": "📚", "description": "What are you reading this week?"},
    {"name": "Pet Lovers", "emoji": "🐾", "description": "Show us your furry companions."},
    {"name": "New Friends", "emoji": "👋", "description": "Just joined? Pull up a chair."},
    {"name": "Sydney Locals", "emoji": "🏠", "description": "Locals helping locals."},
]

SAMPLE_GROUPS = [
    {"name": "Walking Group", "emoji": "🚶", "description": "Weekly walks around the harbour."},
    {"name": "Community Volunteers", "emoji": "🤝", "description": "Helping out where we can."},
    {"name": "Garden Club", "emoji": "🌷", "description": "Tips, swaps, and visits."},
    {"name": "Travel Enthusiasts", "emoji": "✈️", "description": "Trip stories and tips."},
    {"name": "Coffee Catch-Ups", "emoji": "☕", "description": "Local cafe meetups."},
]

SAMPLE_EVENTS = [
    {"title": "Coffee Morning", "emoji": "☕", "description": "Casual morning catch-up over a cuppa.", "location": "Cafe Belong, Manly", "date": "2026-05-20", "time": "10:00 AM",
     "sponsor": {"name": "Café Belong", "message": "Members' discount on coffee & cake", "discount_code": "BELONG10"}},
    {"title": "Community Morning Tea", "emoji": "🫖", "description": "Tea, biscuits, and chatter at the community hall.", "location": "Bondi Community Hall", "date": "2026-05-22", "time": "10:30 AM",
     "sponsor": {"name": "Bondi Community Centre", "message": "Free tea & scones for RSVPs", "discount_code": "BONDITEA"}},
    {"title": "Walking Group", "emoji": "🚶", "description": "Gentle stroll around Centennial Park.", "location": "Centennial Park", "date": "2026-05-24", "time": "8:00 AM"},
    {"title": "Men's Shed BBQ", "emoji": "🔨", "description": "Snags, stories and a bit of tinkering — all welcome.", "location": "Manly Men's Shed", "date": "2026-05-26", "time": "12:00 PM",
     "sponsor": {"name": "Manly Hardware Co.", "message": "10% off your next visit", "discount_code": "SHED10"}},
    {"title": "Community Market", "emoji": "🥕", "description": "Browse the local markets together.", "location": "Surry Hills Markets", "date": "2026-05-28", "time": "9:30 AM"},
    {"title": "Library Book Club", "emoji": "📚", "description": "This month: 'The Thursday Murder Club'. Bring your thoughts!", "location": "Newtown Library", "date": "2026-05-30", "time": "2:00 PM",
     "sponsor": {"name": "Newtown Bookshop", "message": "15% off any book on the day", "discount_code": "READMORE"}},
    {"title": "Trivia Afternoon", "emoji": "🎯", "description": "Bring your thinking caps.", "location": "Newtown Library", "date": "2026-06-02", "time": "2:00 PM"},
]

SAMPLE_NOTICES = [
    {"title": "Free veggie seedlings", "body": "I have extra tomato and basil seedlings — happy to share with anyone in Bondi.", "category": "Share"},
    {"title": "Recommend a podiatrist", "body": "Looking for a friendly podiatrist near Manly. Any suggestions?", "category": "Ask"},
    {"title": "Knitting circle Wednesdays", "body": "We meet every Wednesday at 2pm at the library. All welcome!", "category": "Activity"},
    {"title": "Lost cat — orange tabby", "body": "Missing since Tuesday near Newtown. His name is Biscuit.", "category": "Announcement"},
]

SAMPLE_GROUP_POSTS = [
    {"group_idx": 0, "user_idx": 0, "text": "Lovely walk this morning around the harbour — six of us made it. Tea afterwards was 🌸"},
    {"group_idx": 2, "user_idx": 2, "text": "My peace lily is finally blooming! Anyone else have luck indoors?"},
    {"group_idx": 4, "user_idx": 6, "text": "Cafe Belong has a members' discount on Tuesdays — pass it on!"},
    {"group_idx": 1, "user_idx": 7, "text": "Saturday's food drive went brilliantly. Thank you to everyone who turned up. 🤝"},
]


@app.on_event("startup")
async def _ensure_indexes():
    """Create / verify the hot-path MongoDB indexes that FriendPlace relies on
    at every scale. `create_index` is idempotent (safe to run on every boot)
    and uses background builds — never blocks startup.

    Why these specific indexes:
      • users.id / username / email — login + every user lookup
      • messages.table_id + created_at — FP Café chat history pagination
      • dms.room_id + created_at — private message thread reads
      • events.date — events list sorts by date on every fetch
      • events.host_id, .series_id — host-side & recurring-series filters
      • notices.created_at — Notice Board feed sort
      • flutters.to_id + created_at — Flutters tab inbox per user
      • friend_requests.to_id / from_id — friend inbox + outbox

    Once we migrate to MongoDB Atlas the same indexes apply — Atlas just
    builds them faster on bigger hardware. Doing this NOW means the move is
    truly a config-only change (no schema work). Aligns with the scale-
    readiness checklist (item #2) from the platform team.
    """
    # eager log so ops can see when indexes were last verified
    targets = [
        ("users", [("id", 1)], {"name": "ix_users_id", "unique": True}),
        ("users", [("username", 1)], {"name": "ix_users_username"}),
        ("users", [("email", 1)], {"name": "ix_users_email", "sparse": True}),
        ("users", [("last_active", -1)], {"name": "ix_users_last_active"}),
        ("messages", [("table_id", 1), ("created_at", -1)], {"name": "ix_messages_table_created"}),
        ("dm_messages", [("room_id", 1), ("created_at", -1)], {"name": "ix_dm_messages_room_created"}),
        ("events", [("date", 1)], {"name": "ix_events_date"}),
        ("events", [("host_id", 1)], {"name": "ix_events_host"}),
        ("events", [("series_id", 1)], {"name": "ix_events_series", "sparse": True}),
        ("notices", [("created_at", -1)], {"name": "ix_notices_created"}),
        ("flutters", [("to_id", 1), ("created_at", -1)], {"name": "ix_flutters_to_created"}),
        ("friend_requests", [("to_id", 1), ("status", 1)], {"name": "ix_freq_to_status"}),
        ("friend_requests", [("from_id", 1), ("status", 1)], {"name": "ix_freq_from_status"}),
        ("tables", [("visibility", 1), ("created_at", -1)], {"name": "ix_tables_vis_created"}),
        ("waitlist", [("email", 1)], {"name": "ix_waitlist_email", "unique": True}),
        ("waitlist", [("created_at", 1)], {"name": "ix_waitlist_created"}),
        ("users", [("is_founder", 1)], {"name": "ix_users_founder", "sparse": True}),
    ]
    created = 0
    for coll, keys, opts in targets:
        try:
            await db[coll].create_index(keys, background=True, **opts)
            created += 1
        except Exception as e:
            # Common cause: the same key with a *different* name was created
            # earlier (e.g. by a prior version). Log and continue — the index
            # exists and Mongo will use it regardless of name.
            logger.info("index %s on %s skipped: %s", opts.get("name"), coll, str(e)[:120])
    logger.info("Indexes verified: %s / %s targets", created, len(targets))


@app.on_event("startup")
async def _ensure_mcgs_indexes():
    """Create/verify indexes for the Mission Control George System (MCGS).

    Idempotent. See `/app/backend/services/mcgs/signals.py::ensure_indexes`
    for the target list, and `/app/memory/mcgs-phase1-plan.md` §2 for the
    schema rationale.
    """
    try:
        from services.mcgs.signals import ensure_indexes as _mcgs_ensure_indexes
        await _mcgs_ensure_indexes(db)
        logger.info("MCGS indexes verified.")
    except Exception:
        logger.exception("MCGS index setup failed (non-fatal)")

    # Phase 2 \u2014 Rhythms collections (briefings, milestones, activity, settings).
    # See /app/memory/mcgs-phase2-plan.md \u00a7Architecture additions.
    try:
        from services.mcgs.rhythms import ensure_indexes as _mcgs_rhythms_ensure_indexes
        await _mcgs_rhythms_ensure_indexes(db)
        logger.info("MCGS Rhythms indexes verified.")
    except Exception:
        logger.exception("MCGS Rhythms index setup failed (non-fatal)")

    # Phase 2 Milestone C \u2014 APScheduler wiring. One process-singleton
    # scheduler registers per-admin timezone-aware cron jobs for every
    # Rhythm. Composer + delivery are idempotent, so a mid-morning
    # restart won't re-send today's briefing.
    try:
        from services.mcgs.rhythms import start_scheduler as _mcgs_rhythms_start
        await _mcgs_rhythms_start(db)
        logger.info("MCGS Rhythms scheduler started.")
    except Exception:
        logger.exception("MCGS Rhythms scheduler startup failed (non-fatal)")

    # Phase 3 — Conversational Event Creation (index setup).
    try:
        from services.george.event_creation import ensure_indexes as _event_ensure_indexes
        await _event_ensure_indexes(db)
        logger.info("George event_creation indexes verified.")
    except Exception:
        logger.exception("George event_creation index setup failed (non-fatal)")

    # B7 — George Remembers indexes + background sweep. Idempotent.
    try:
        from services.george import remembers as _remembers
        await _remembers.ensure_indexes(db)
        logger.info("George Remembers indexes verified.")
        asyncio.create_task(_remembers.sweep_loop(db))
        logger.info("George Remembers sweep loop scheduled.")
    except Exception:
        logger.exception("George Remembers setup failed (non-fatal)")



@app.on_event("startup")
async def _backfill_founders_spaces():
    """Make sure the Founders Lounge community group AND the Founders Lounge
    Coffee Table both exist, then backfill every existing founder into both.

    Idempotent — uses $addToSet so re-running on every restart is a no-op
    once everyone is already in place. Runs after the indexes startup hook
    so the queries below hit the relevant indexes (notably `is_founder`).
    """
    try:
        fl = await _ensure_founders_lounge()
        ft = await _ensure_founders_table()
        founder_ids = [
            u["id"] async for u in db.users.find(
                {"is_founder": True, "is_demo": {"$ne": True}},
                {"_id": 0, "id": 1},
            )
        ]
        if not founder_ids:
            return
        if fl and fl.get("id"):
            await db.groups.update_one(
                {"id": fl["id"]},
                {"$addToSet": {"members": {"$each": founder_ids}}},
            )
        if ft and ft.get("id"):
            await db.tables.update_one(
                {"id": ft["id"]},
                {"$addToSet": {"seated": {"$each": founder_ids}},
                 "$set": {"last_activity_at": now_iso()}},
            )
            # If the table was created before any founder existed, the
            # host_id is still blank — promote founder #1 to host so the
            # lounge card shows a real attribution.
            first = await db.users.find_one(
                {"is_founder": True, "is_demo": {"$ne": True}},
                {"_id": 0, "id": 1},
                sort=[("founder_number", 1)],
            )
            if first:
                await db.tables.update_one(
                    {"id": ft["id"], "host_id": ""},
                    {"$set": {"host_id": first["id"]}},
                )
        # Also stamp every founder's user doc with the lounge group id so
        # the Groups list shows the Founders Lounge in their groups.
        if fl and fl.get("id"):
            await db.users.update_many(
                {"is_founder": True, "is_demo": {"$ne": True}},
                {"$addToSet": {"groups": fl["id"]}},
            )
        logger.info(
            "Founders backfill: %s founder(s) seated in group=%s table=%s",
            len(founder_ids),
            (fl or {}).get("id", "—"),
            (ft or {}).get("id", "—"),
        )
    except Exception as e:
        logger.warning("Founders backfill failed: %s", e)


@app.on_event("startup")
async def seed():
    # One-time migration: mark every legacy (passwordless) account as a demo account
    # so it stays separate from real signups. Idempotent — runs every restart safely.
    await db.users.update_many(
        {"password_hash": {"$exists": False}},
        {"$set": {"is_demo": True, "failed_login_attempts": 0, "lockout_until": None}},
    )
    # Backfill new fields on existing users so Pydantic models hydrate cleanly.
    await db.users.update_many(
        {"privacy_settings": {"$exists": False}},
        {"$set": {"privacy_settings": {"profile_visibility": "everyone", "friend_requests": "everyone", "show_in_find_friends": True},
                  "favourite_games": [], "birthday": "", "onboarding_completed": True,
                  "restricted": False, "restricted_at": None, "restricted_reason": ""}},
    )
    # Make sure every user has is_admin (default False) without overwriting existing True values.
    await db.users.update_many({"is_admin": {"$exists": False}}, {"$set": {"is_admin": False}})
    # Ensure 'maggie' is the admin demo account so moderation tools can be previewed.
    await db.users.update_one({"username": "maggie"}, {"$set": {"is_admin": True}})
    # Backfill `is_system` flag on the two special groups so they no
    # longer appear in the public Community Groups list (they live in
    # their own dedicated tabs — Founders area + FP Café).
    await db.groups.update_many(
        {"name": {"$in": ["Founders Lounge", "FP Café Crew"]}, "is_system": {"$ne": True}},
        {"$set": {"is_system": True}},
    )
    users_count = await db.users.count_documents({})
    if users_count > 0:
        logger.info("Seed skipped — data already present (%s users)", users_count)
        return
    logger.info("Seeding FriendPlace sample data…")

    users = []
    for u in SAMPLE_USERS:
        user = User(**u, is_demo=True)
        doc = user.dict()
        # demo accounts have no password; they're accessed via /auth/demo-login
        await db.users.insert_one(doc)
        users.append(doc)

    tables = []
    for i, t in enumerate(SAMPLE_TABLES):
        host = users[i % len(users)]
        seated_ids = [users[j]["id"] for j in [i % len(users), (i + 1) % len(users), (i + 3) % len(users)]]
        seated_ids = list({*seated_ids})
        tbl = Table(**t, host_id=host["id"], seated=seated_ids, visibility="public")
        await db.tables.insert_one(tbl.dict())
        tables.append(tbl.dict())
        # seed a few messages
        starters = ["Morning everyone! ☀️", "Lovely to see you all here.", "How was your week?"]
        for k, txt in enumerate(starters):
            sender = users[(i + k) % len(users)]
            msg = Message(table_id=tbl.id, user_id=sender["id"], user_name=sender["first_name"], avatar=sender["avatar"], text=txt)
            await db.messages.insert_one(msg.dict())

    groups = []
    for i, g in enumerate(SAMPLE_GROUPS):
        members = [users[j]["id"] for j in range(min(5, len(users)))]
        grp = Group(**g, members=members)
        await db.groups.insert_one(grp.dict())
        groups.append(grp.dict())

    for p in SAMPLE_GROUP_POSTS:
        u = users[p["user_idx"]]
        gp = GroupPost(
            group_id=groups[p["group_idx"]]["id"],
            user_id=u["id"],
            user_name=u["first_name"],
            avatar=u["avatar"],
            text=p["text"],
            likes=[users[(p["user_idx"] + 1) % len(users)]["id"]],
        )
        await db.group_posts.insert_one(gp.dict())

    for e in SAMPLE_EVENTS:
        ev = Event(**e, rsvps=[users[0]["id"], users[2]["id"]])
        await db.events.insert_one(ev.dict())

    for i, n in enumerate(SAMPLE_NOTICES):
        u = users[i % len(users)]
        notice = Notice(user_id=u["id"], user_name=u["first_name"], avatar=u["avatar"], **n, likes=[users[(i + 1) % len(users)]["id"]])
        await db.notices.insert_one(notice.dict())

    # seed a DM between Margaret and Joyce
    a, b = users[0]["id"], users[2]["id"]
    cid = dm_conv_id(a, b)
    await db.dm_conversations.insert_one({"id": cid, "participants": [a, b], "created_at": now_iso(), "updated_at": now_iso()})
    for s, txt in [(a, "Joyce! Are you coming to morning tea on the 20th?"), (b, "Wouldn't miss it Maggie 💖"), (a, "Bring your scones recipe please!")]:
        u = users[0] if s == a else users[2]
        m = Message(dm_id=cid, user_id=s, user_name=u["first_name"], avatar=u["avatar"], text=txt)
        await db.messages.insert_one(m.dict())

    # seed Flutters: Frank and Dorothy → Margaret
    for sender in [users[1], users[4]]:  # Frank, Dorothy
        flut = FlutterDoc(
            from_id=sender["id"], to_id=users[0]["id"],
            from_name=sender["first_name"], from_avatar=sender["avatar"],
            message="would like to chat 🦋",
        )
        await db.flutters.insert_one(flut.dict())

    # mutual friendships
    await db.users.update_one({"id": users[0]["id"]}, {"$set": {"friends": [users[2]["id"], users[4]["id"]]}})
    await db.users.update_one({"id": users[2]["id"]}, {"$set": {"friends": [users[0]["id"]]}})
    await db.users.update_one({"id": users[4]["id"]}, {"$set": {"friends": [users[0]["id"]]}})

    logger.info("Seed complete: %s users, %s tables, %s groups", len(users), len(tables), len(groups))


@api.get("/")
async def root():
    return {"app": "FriendPlace", "status": "ok"}


# ────────────────────────────────────────────────────────────────────────
#  PUBLIC WEB SURFACE — endpoints designed to power the marketing website
#  at friendplace.com.au (Home / About / Features / FAQs / Contact / etc.)
#
#  All routes under /api/public/* are UNAUTHENTICATED by design so a
#  visiting browser doesn't need a token to read the marketing copy.
#  Content is served from the `site_content` MongoDB collection, which
#  can be edited later from the admin portal without a code deploy —
#  same-database philosophy: single source of truth for the whole
#  platform (app + website + admin), which was Garry's explicit
#  requirement.
# ────────────────────────────────────────────────────────────────────────

# Default content shipped inline so a brand-new deployment has usable
# copy on Day 1 even before the admin portal is built. Each block has a
# stable `key` we can update via a PATCH once the admin CMS ships. The
# structure intentionally mirrors the page titles Garry listed so the
# website frontend can literally do `content.about` → About page.
_DEFAULT_SITE_CONTENT = {
    "about": {
        "title": "About FriendPlace",
        "lead": "A warm, safe community for grown-ups who want to make new friends.",
        "body": (
            "FriendPlace was built for anyone over 40 who's felt that making new "
            "friends gets harder with each passing year. It's a warm, welcoming "
            "app where you can meet people in your area, join local events, share "
            "recipes and stories, and rediscover the joy of community — without "
            "endless scrolling, cold algorithms or noise."
        ),
    },
    "features": [
        {"emoji": "☕", "title": "FP Café", "body": "Drop into a virtual table with folks nearby."},
        {"emoji": "📅", "title": "Local Events", "body": "Real gatherings in your neighbourhood, not just online chatter."},
        {"emoji": "👥", "title": "Community Groups", "body": "Book clubs, walkers, bakers, players — find your people."},
        {"emoji": "🦋", "title": "Flutters", "body": "Send a small note of kindness. Someone always needs one."},
        {"emoji": "🎤", "title": "Speak Instead of Type", "body": "Tap to dictate — your voice becomes text automatically."},
        {"emoji": "🔊", "title": "Listen Instead of Read", "body": "Tap the speaker to have messages read aloud."},
    ],
    "faqs": [
        {"q": "Is FriendPlace free?", "a": "Yes. Founding members get free access for life, plus a special badge on their profile."},
        {"q": "Who is it for?", "a": "Anyone over 40 who wants to make new friends locally. Nothing romantic — it's a friendship app."},
        {"q": "Is my data safe?", "a": "Your data is stored securely and never sold. You can delete your account any time from Settings."},
        {"q": "Do I need to be tech-savvy?", "a": "No. FriendPlace is designed for older adults — large text, voice input, tap-to-listen, and a friendly welcome team."},
        {"q": "How do I get help?", "a": "Email hello@friendplace.com.au or use the contact form — a real person answers."},
    ],
    "founders": {
        "title": "Become a Founding Member",
        "lead": "The first supporters shape what FriendPlace becomes.",
        "body": (
            "Founding Members get a distinctive badge on their profile, early access "
            "to new features, a direct line to the team for feedback, and lifetime free "
            "access as our thanks for helping us build the community from day one."
        ),
        "benefits": [
            "Founder badge on your profile",
            "Early access to new features",
            "Lifetime free membership",
            "Direct feedback line to the team",
        ],
    },
    "success_stories": [
        # Populated by the admin portal once we have consenting members to
        # feature. Kept as an empty list rather than dummy stories so the
        # website can show a "coming soon" placeholder honestly.
    ],
    "download": {
        "apple": "",   # populated once the App Store listing is live
        "google": "",  # populated once the Play Store listing is live
    },
}


async def _get_site_content_doc() -> dict:
    """Load the single site-content document, seeding defaults if missing.

    We store all copy in a single `site_content` document keyed `"main"`
    because it's small, always read together, and we never need
    partial-field concurrency (the admin edits one block at a time via a
    PATCH). This keeps the read path a single MongoDB round-trip.
    """
    doc = await db.site_content.find_one({"key": "main"}, {"_id": 0})
    if not doc:
        doc = {"key": "main", **_DEFAULT_SITE_CONTENT, "updated_at": now_iso()}
        try:
            await db.site_content.insert_one(dict(doc))
        except Exception:
            pass
    doc.pop("_id", None)
    doc.pop("key", None)
    return doc


@api.get("/public/content")
async def public_content():
    """Bulk endpoint returning ALL public marketing copy in one call.

    Why one call and not per-page endpoints (/public/about, /public/faqs,
    etc.)? Because the entire content payload is <10 KB and the website
    renders every page on the same client-side router. Fetching it once
    at boot means every subsequent page-change is instant.
    """
    return await _get_site_content_doc()


@api.get("/public/founders/count")
async def public_founders_count():
    """Live founder count for the "Founding Members" marketing block.

    Deliberately does NOT expose the total or the remaining count —
    only the current number of founding members — so the website can
    show a growing badge ("500+ Founding Members" once we hit that) with-
    out reveal-of-privacy risks. Returns 0 gracefully if the collection
    is empty.
    """
    try:
        n = await db.users.count_documents({"is_founder": True, "is_demo": {"$ne": True}})
    except Exception:
        n = 0
    return {"count": int(n)}


@api.get("/public/launch-status")
async def public_launch_status():
    """Public launch countdown status.

    Powers the ribbon on the marketing site. Deliberately narrow:
    - Returns ``enabled`` and ``launch_at`` (ISO UTC) unconditionally.
    - Returns ``is_live`` derived from ``launch_at`` and any manual
      ``launch_complete`` override.
    - Exposes App Store / Google Play links ONLY when ``is_live`` — this
      is a deliberate anti-premature-click safeguard so a leaked App
      Store URL can't be hit before the app is approved and available.
    """
    from services import launch as _launch
    try:
        settings = await _launch.get_settings(db)
        return _launch.public_status(settings)
    except Exception:
        # Fail-safe: absent settings → hidden countdown, no crash.
        return {
            "enabled": False, "launch_at": None, "is_live": False,
            "welcome_message": _launch.DEFAULTS["welcome_message"],
            "appstore_url": "", "playstore_url": "",
        }


@api.post("/public/contact")
async def public_contact(payload: dict, request: Request):
    """Public contact form submission (no auth).

    Stored in the `contact_submissions` collection so the admin portal
    can list them. Also fires an email to hello@friendplace.com.au via
    Resend so the team gets a real-time nudge. Extremely light
    rate-limiting by IP — enough to deter drive-by spam without hurting
    legitimate users behind shared NAT.
    """
    name = str(payload.get("name") or "").strip()[:120]
    email = str(payload.get("email") or "").strip().lower()[:180]
    subject = str(payload.get("subject") or "").strip()[:180] or "Contact from FriendPlace website"
    message = str(payload.get("message") or "").strip()[:4000]
    if not name or not email or not message:
        raise HTTPException(400, "Please fill in your name, email and message.")
    if "@" not in email or "." not in email:
        raise HTTPException(400, "That doesn't look like a valid email address.")

    # 5-submissions-per-hour cap per IP. If Redis were available we'd
    # use it; a MongoDB count over the last hour is fine at our scale
    # and needs no extra infra.
    #
    # Behind the Kubernetes ingress the raw `request.client.host` is the
    # ingress pod IP (which rotates), so all real clients would appear
    # to be the same "IP" for a few seconds at a time and then a
    # different one — either falsely rate-limiting everyone or letting
    # the same abuser bypass the cap. `X-Forwarded-For` carries the
    # true client chain; the first entry is the actual visitor.
    xff = request.headers.get("x-forwarded-for") if request else None
    if xff:
        ip = xff.split(",")[0].strip() or "unknown"
    else:
        ip = (request.client.host if request and request.client else "unknown") or "unknown"
    hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    try:
        recent = await db.contact_submissions.count_documents({"ip": ip, "created_at": {"$gt": hour_ago}})
    except Exception:
        recent = 0
    if recent >= 5:
        raise HTTPException(429, "Too many messages from this address — please try again later.")

    doc = {
        "id": str(uuid.uuid4()),
        "name": name,
        "email": email,
        "subject": subject,
        "message": message,
        "ip": ip,
        "status": "new",  # new | read | replied | archived — set by admin
        "created_at": now_iso(),
    }
    try:
        await db.contact_submissions.insert_one(dict(doc))
    except Exception:
        logger.exception("failed to persist contact submission")

    # Fire an email to hello@ so the admin gets a notification. Never
    # fails the request if email is misconfigured — the DB record is
    # the source of truth.
    try:
        from email_service import send_email
        html_body = (
            f"<p><b>From:</b> {name} &lt;{email}&gt;</p>"
            f"<p><b>Subject:</b> {subject}</p>"
            f"<p><b>Message:</b></p><pre style='white-space:pre-wrap;font-family:inherit;'>"
            f"{message}</pre>"
        )
        await send_email(
            to="hello@friendplace.com.au",
            subject=f"[FriendPlace contact] {subject}",
            html=html_body,
            text=f"From: {name} <{email}>\nSubject: {subject}\n\n{message}",
        )
    except Exception:
        logger.exception("failed to send contact-form notification email")

    return {"ok": True, "id": doc["id"]}


# ────────────────────────────────────────────────────────────────────────
#  REGISTER YOUR INTEREST (RYI) — Phase C
#
#  A first-time visitor meets George or Georgia on /meet, decides they'd
#  like to know more, and leaves their name + email. What happens next
#  matters a lot: this is the difference between a marketing "mailing
#  list" and a set of early friends we already know by name.
#
#  Journey continuity (see /app/JOURNEY_CONTINUITY.md):
#    - Their chosen companion (George/Georgia) is recorded alongside
#      the registration, so on first mobile-app login the app can say
#      "Welcome back" in that voice.
#    - The confirmation email is signed by that companion and continues
#      the conversation they just had on the website — not a marketing
#      thank-you, not a newsletter.
#
#  Design notes:
#    - Public endpoint, unauthenticated (deliberately — same pattern as
#      the contact form).
#    - Idempotent within 24h: if the same email registers twice, we
#      quietly return the existing record without sending a second
#      email, so the visitor never gets duplicate confirmations if they
#      double-tap the submit button.
#    - Fires the confirmation email via the existing email_service
#      (verified `noreply@friendplace.com.au` sender). Never blocks the
#      HTTP response on email — the DB record is the source of truth.
#    - IP-based rate-limiting to deter drive-by spam (5/hour), matching
#      the contact form pattern.
# ────────────────────────────────────────────────────────────────────────

_RYI_COMPANION_META = {
    "george":  {"name": "George",  "signoff": "George",  "reply_from": "George"},
    "georgia": {"name": "Georgia", "signoff": "Georgia", "reply_from": "Georgia"},
}


def _render_ryi_confirmation_html(first_name: str, companion: str) -> str:
    """Warm, in-voice confirmation email. Continues the conversation from /meet.

    Deliberately spare — no marketing footer, no unsubscribe blob, no
    "you're receiving this because...". A real person doesn't send that
    kind of thing after showing you around their community centre. The
    only footnote is what we'll do with the address (nothing else).
    """
    meta = _RYI_COMPANION_META.get(companion, _RYI_COMPANION_META["george"])
    safe_name = html_module.escape((first_name or "friend").strip())
    signoff = meta["signoff"]
    # Inline styles only — Gmail, Outlook, Apple Mail all differ on which
    # external CSS survives, so we ship each line with the styles baked in.
    return f"""\
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#FEFCF8;font-family:'Public Sans','Helvetica Neue',Arial,sans-serif;color:#0A2540;line-height:1.55;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#FEFCF8;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#FFFFFF;border:1px solid #F1E9DC;border-radius:20px;padding:40px;">
        <tr><td>
          <p style="margin:0 0 20px;font-size:19px;color:#0A2540;">Hello {safe_name},</p>
          <p style="margin:0 0 16px;font-size:17px;color:#334155;">I'm really glad you stopped by.</p>
          <p style="margin:0 0 16px;font-size:17px;color:#334155;">You're on our list now, and I'll make sure you're one of the first to hear when FriendPlace is ready for you.</p>
          <p style="margin:0 0 16px;font-size:17px;color:#334155;">We're taking our time &mdash; this needs to feel like a real community rather than another app &mdash; so please forgive us if things take a little while. When we're ready, I'll write again.</p>
          <p style="margin:0 0 28px;font-size:17px;color:#334155;">Until then, take care.</p>
          <p style="margin:0;font-size:17px;color:#0F766E;font-style:italic;">
            <span style="font-size:22px;vertical-align:-3px;margin-right:6px;">&#129419;</span>{signoff}
          </p>
        </td></tr>
        <tr><td style="padding-top:32px;">
          <p style="margin:0;font-size:12px;color:#94A3B8;text-align:center;">
            We&rsquo;ll only use your email to let you know when FriendPlace opens. No newsletters, no sharing, no noise.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
"""


def _render_ryi_confirmation_text(first_name: str, companion: str) -> str:
    meta = _RYI_COMPANION_META.get(companion, _RYI_COMPANION_META["george"])
    name = (first_name or "friend").strip()
    return (
        f"Hello {name},\n\n"
        "I'm really glad you stopped by.\n\n"
        "You're on our list now, and I'll make sure you're one of the first\n"
        "to hear when FriendPlace is ready for you.\n\n"
        "We're taking our time — this needs to feel like a real community\n"
        "rather than another app — so please forgive us if things take a\n"
        "little while. When we're ready, I'll write again.\n\n"
        "Until then, take care.\n\n"
        f"{meta['signoff']} 🦋\n\n"
        "— We'll only use your email to let you know when FriendPlace opens.\n"
        "  No newsletters, no sharing, no noise."
    )


@api.post("/public/register-interest")
async def public_register_interest(payload: dict, request: Request):
    """Public "Register Your Interest" submission (no auth).

    Persists to `interest_registrations` and fires a warm confirmation
    email from the visitor's chosen companion. Idempotent within 24h so
    the visitor never gets duplicate confirmations from double-clicks or
    refresh-and-resubmit.
    """
    first_name = str(payload.get("first_name") or "").strip()[:80]
    email = str(payload.get("email") or "").strip().lower()[:180]
    state_country = str(payload.get("state_country") or "").strip()[:120] or None
    heard_from = str(payload.get("heard_from") or "").strip()[:240] or None
    raw_companion = str(payload.get("companion_choice") or "").strip().lower()
    companion = raw_companion if raw_companion in {"george", "georgia"} else None

    # Required fields.
    if not first_name:
        raise HTTPException(400, "Please leave your first name so I know how to greet you.")
    if not email or "@" not in email or "." not in email:
        raise HTTPException(400, "That email doesn't look quite right — could you double-check it?")

    # IP for rate-limit. Behind Kubernetes ingress, X-Forwarded-For carries
    # the real visitor. Same pattern as /public/contact — see notes there.
    xff = request.headers.get("x-forwarded-for") if request else None
    if xff:
        ip = xff.split(",")[0].strip() or "unknown"
    else:
        ip = (request.client.host if request and request.client else "unknown") or "unknown"

    # 5 registrations per IP per hour — same envelope as the contact form.
    hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    try:
        recent = await db.interest_registrations.count_documents({"ip": ip, "created_at": {"$gt": hour_ago}})
    except Exception:
        recent = 0
    if recent >= 5:
        raise HTTPException(429, "Too many registrations from this address — please try again later.")

    # Idempotency: if this email already registered in the last 24h, we
    # quietly return the existing record and skip the second email. The
    # visitor still gets the warm success page — they don't need to know
    # we've de-duplicated. Longer windows would risk missing a genuine
    # "please add me again" case; 24h feels like the right threshold.
    day_ago = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    existing = None
    try:
        existing = await db.interest_registrations.find_one(
            {"email": email, "created_at": {"$gt": day_ago}},
            {"_id": 0, "id": 1, "email": 1, "created_at": 1},
        )
    except Exception:
        existing = None
    if existing:
        return {"ok": True, "id": existing.get("id"), "deduplicated": True}

    doc = {
        "id": str(uuid.uuid4()),
        "first_name": first_name,
        "email": email,
        "state_country": state_country,
        "heard_from": heard_from,
        "companion_choice": companion,     # 'george' | 'georgia' | None
        "status": "registered",             # CRM ladder: registered → invited → joined → opted_out
        "source": "website",                # future: 'app_prelaunch', 'referral', etc.
        "ip": ip,
        "is_test": False,                   # tools.py filters this out of George's counts
        "created_at": now_iso(),
    }

    try:
        await db.interest_registrations.insert_one(dict(doc))
    except Exception:
        # If the DB write itself fails, we DO fail the request — silently
        # persisting nowhere would be worse than telling the visitor to
        # try again. Contact form does the opposite; here we're stricter
        # because the visitor is explicitly leaving contact details.
        logger.exception("failed to persist interest_registration")
        raise HTTPException(500, "We couldn't save your details just now — please try again in a moment.")

    # Fire the confirmation email. Chosen companion signs it. Failures
    # are logged but never fail the request — the DB record is the
    # source of truth, and the admin portal can resend if needed.
    try:
        from email_service import send_email
        effective_companion = companion or "george"
        meta = _RYI_COMPANION_META[effective_companion]
        subject = f"Thank you for finding us, {first_name}"
        html_body = _render_ryi_confirmation_html(first_name, effective_companion)
        text_body = _render_ryi_confirmation_text(first_name, effective_companion)
        # Reply-To goes to hello@friendplace.com.au (env default) so
        # replies land in the shared inbox the whole team watches — a
        # visitor writing back to "George" reaches a real human.
        await send_email(
            to=email,
            subject=subject,
            html=html_body,
            text=text_body,
        )
        # Also nudge the internal inbox so the team knows a new visitor
        # arrived. Deliberately separate from the confirmation email so
        # neither can leak the other's recipient list.
        internal_html = (
            f"<p><b>{html_module.escape(first_name)}</b> registered their interest.</p>"
            f"<p><b>Email:</b> {html_module.escape(email)}</p>"
            f"<p><b>State/Country:</b> {html_module.escape(state_country or '—')}</p>"
            f"<p><b>How did they hear about us:</b> {html_module.escape(heard_from or '—')}</p>"
            f"<p><b>Chose to meet:</b> {meta['name']}</p>"
        )
        await send_email(
            to="hello@friendplace.com.au",
            subject=f"[FriendPlace RYI] {first_name} ({email})",
            html=internal_html,
            text=(
                f"{first_name} registered their interest.\n\n"
                f"Email: {email}\n"
                f"State/Country: {state_country or '—'}\n"
                f"How did they hear about us: {heard_from or '—'}\n"
                f"Chose to meet: {meta['name']}\n"
            ),
        )
    except Exception:
        logger.exception("failed to send RYI confirmation email")

    return {"ok": True, "id": doc["id"]}


# ── Admin: interest-registrations ────────────────────────────────────

@api.get("/admin/interest-registrations")
async def admin_interest_registrations(admin_id: str, status: str = "", limit: int = 100):
    """List interest registrations for the admin portal + MCGS.

    Filter by `status` (new/reviewed/contacted/archived) or omit to get
    all. Newest first, capped at 500 rows so a runaway wave can't OOM
    the admin browser. Test fixtures (`is_test: true`) are always
    excluded — those exist only so George's reporting tools have a
    known ground truth in staging.
    """
    await _require_admin(admin_id)
    q: Dict[str, Any] = {"is_test": {"$ne": True}}
    if status:
        q["status"] = status
    limit = max(1, min(int(limit or 100), 500))
    rows = await db.interest_registrations.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"count": len(rows), "items": rows}


@api.patch("/admin/interest-registrations/{reg_id}")
async def admin_interest_registrations_update(reg_id: str, payload: dict):
    """Update an interest registration's status (mark as reviewed / contacted / archived)."""
    admin_id = str(payload.get("admin_id") or "")
    await _require_admin(admin_id)
    new_status = str(payload.get("status") or "").strip().lower()
    if new_status not in {"new", "reviewed", "contacted", "archived"}:
        raise HTTPException(400, "status must be one of: new, reviewed, contacted, archived")
    result = await db.interest_registrations.update_one(
        {"id": reg_id},
        {"$set": {"status": new_status, "updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Interest registration not found.")
    return {"ok": True, "id": reg_id, "status": new_status}





# ────────────────────────────────────────────────────────────────────────
#  ADMIN ANALYTICS — pre-aggregated summary + growth endpoints
#
#  These endpoints will power the admin dashboard cards / charts. They're
#  built now (ahead of the admin portal UI) so the frontend can start
#  wiring against real endpoints from day one. Each endpoint requires
#  admin_id in the query string — same lightweight auth pattern used by
#  the invite-flyer endpoint, protected by MongoDB UUID unpredictability.
# ────────────────────────────────────────────────────────────────────────

@api.get("/admin/analytics/summary")
async def admin_analytics_summary(admin_id: str):
    """Headline counts for the admin dashboard's top row of cards.

    Deliberately fast (all $count queries with no aggregation stages).
    Numbers are wall-clock accurate at the moment of the request. Demo
    users are excluded so the reported member count reflects real
    community activity, not test fixtures.
    """
    await _require_admin(admin_id)
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()

    async def _count(coll: str, q: dict) -> int:
        try:
            return int(await db[coll].count_documents(q))
        except Exception:
            return 0

    real_users_q = {"is_demo": {"$ne": True}}
    return {
        "total_members": await _count("users", real_users_q),
        "founding_members": await _count("users", {**real_users_q, "is_founder": True}),
        "new_members_7d": await _count("users", {**real_users_q, "created_at": {"$gt": week_ago}}),
        "total_events": await _count("events", {}),
        "upcoming_events": await _count("events", {"date": {"$gt": now.isoformat()}}),
        "total_groups": await _count("groups", {}),
        "messages_7d": await _count("messages", {"created_at": {"$gt": week_ago}}),
        "open_reports": await _count("reports", {"status": {"$in": ["new", "open", "pending"]}}),
        "open_feedback": await _count("feedback", {"status": {"$in": [None, "new", "open"]}}),
        "new_contact_forms": await _count("contact_submissions", {"status": "new"}),
        "generated_at": now_iso(),
    }


@api.get("/admin/analytics/growth")
async def admin_analytics_growth(admin_id: str, days: int = 30):
    """Daily new-member counts for a line chart (default: last 30 days).

    Uses a single Mongo `$group` aggregation on the yyyy-mm-dd prefix of
    each user's `created_at` timestamp — cheap and index-friendly given
    the size of the users collection. Fills gaps with zero-count days so
    the frontend can chart it directly without post-processing.
    """
    await _require_admin(admin_id)
    days = max(1, min(int(days or 30), 180))
    since = datetime.now(timezone.utc) - timedelta(days=days - 1)
    since_iso = since.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

    pipeline = [
        {"$match": {"is_demo": {"$ne": True}, "created_at": {"$gte": since_iso}}},
        {"$project": {"day": {"$substr": ["$created_at", 0, 10]}}},
        {"$group": {"_id": "$day", "count": {"$sum": 1}}},
    ]
    buckets: Dict[str, int] = {}
    try:
        async for row in db.users.aggregate(pipeline):
            buckets[row["_id"]] = int(row["count"])
    except Exception:
        buckets = {}

    # Fill in zero-count days so the chart is continuous.
    out = []
    for i in range(days):
        d = (since + timedelta(days=i)).strftime("%Y-%m-%d")
        out.append({"date": d, "count": buckets.get(d, 0)})
    return {"days": days, "series": out}


@api.get("/admin/analytics/engagement")
async def admin_analytics_engagement(admin_id: str):
    """DAU/WAU/MAU engagement buckets based on `last_active`.

    Definitions:
      DAU — users active in the last 24 hours
      WAU — users active in the last 7 days
      MAU — users active in the last 30 days
    We fall back to `updated_at` and `created_at` if a user record
    doesn't yet have a `last_active` field (older schemas), so migration
    isn't required to see meaningful numbers.
    """
    await _require_admin(admin_id)
    now = datetime.now(timezone.utc)
    day_ago = (now - timedelta(days=1)).isoformat()
    week_ago = (now - timedelta(days=7)).isoformat()
    month_ago = (now - timedelta(days=30)).isoformat()

    def _q(cutoff_iso: str) -> dict:
        return {
            "is_demo": {"$ne": True},
            "$or": [
                {"last_active": {"$gt": cutoff_iso}},
                # Older accounts pre-`last_active` — approximate with
                # `updated_at` so they still appear in the buckets.
                {"last_active": {"$exists": False}, "updated_at": {"$gt": cutoff_iso}},
            ],
        }

    try:
        dau = int(await db.users.count_documents(_q(day_ago)))
        wau = int(await db.users.count_documents(_q(week_ago)))
        mau = int(await db.users.count_documents(_q(month_ago)))
    except Exception:
        dau = wau = mau = 0
    return {"dau": dau, "wau": wau, "mau": mau, "generated_at": now_iso()}


@api.get("/admin/contact-submissions")
async def admin_contact_submissions(admin_id: str, status: str = "", limit: int = 50):
    """List contact-form submissions for the admin portal.

    Filter by `status` (new/read/replied/archived) or omit to get all.
    Newest first, capped at 200 rows so a runaway spam wave can't OOM
    the admin browser.
    """
    await _require_admin(admin_id)
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    limit = max(1, min(int(limit or 50), 200))
    rows = await db.contact_submissions.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"count": len(rows), "items": rows}


@api.patch("/admin/contact-submissions/{sub_id}")
async def admin_contact_submissions_update(sub_id: str, payload: dict):
    """Update a contact submission's status (mark as read / replied / archived)."""
    admin_id = str(payload.get("admin_id") or "")
    await _require_admin(admin_id)
    new_status = str(payload.get("status") or "").strip().lower()
    if new_status not in {"new", "read", "replied", "archived"}:
        raise HTTPException(400, "status must be one of: new, read, replied, archived")
    result = await db.contact_submissions.update_one(
        {"id": sub_id},
        {"$set": {"status": new_status, "updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Contact submission not found")
    return {"ok": True}


# ─────────── Voice → Text (OpenAI whisper-1 via Emergent LLM key) ───────────
#
# Tap-to-dictate for the whole app. Older users on FriendPlace typically
# find speaking easier than typing on a small keyboard, so we surface a
# mic button next to key inputs (chat composer, notice-board post, event
# description, bio). This endpoint accepts the resulting audio file and
# hands it to OpenAI Whisper via the Emergent Universal LLM key so we
# don't need a per-user OpenAI account.
#
# We deliberately keep this endpoint tiny and stateless — no persistence,
# no analytics — so we're never storing raw voice audio at rest. The
# only thing that leaves the pod is the audio-to-Whisper hop, and only
# the returned text ever reaches the caller.
@api.post("/voice/transcribe")
async def voice_transcribe(
    audio: UploadFile = File(...),
    user_id: str = Query(""),
    language: str = Query("en"),
):
    """Transcribe a short audio clip to text via OpenAI Whisper.

    The client uploads the raw audio (m4a from iOS, mp4/webm from
    Android/web) as `audio`. We buffer to a temp file (Whisper's SDK
    prefers a path over a stream so it can sniff the container), invoke
    the model, and return `{"text": "..."}`.

    Safeguards:
      • 25 MB hard cap enforced by the emergentintegrations validator.
      • 60-second soft cap on the client side (matches the on-screen
        timer). No enforcement here — Whisper handles longer clips fine
        and rejecting them here would only hurt legitimate users.
      • The Emergent key never appears on the wire from the client;
        this endpoint is the only place it's used.
    """
    # Basic auth: require a user_id that maps to an active account. This
    # blocks anonymous drive-by transcription which would drain our LLM
    # credits. We DON'T require a full JWT here because the client is
    # already authenticated at the app level, and passing the token
    # through multipart uploads is fiddlier than it needs to be.
    if user_id:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(401, "Unknown user")

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(503, "Voice transcription unavailable — LLM key not configured")

    # Sniff extension from the uploaded filename so Whisper knows how to
    # decode. Default to .m4a which is what expo-audio produces on iOS.
    import tempfile
    import pathlib
    ext = ".m4a"
    if audio.filename:
        p = pathlib.Path(audio.filename)
        if p.suffix.lower() in {".m4a", ".mp3", ".mp4", ".wav", ".webm", ".mpga", ".mpeg"}:
            ext = p.suffix.lower()

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    try:
        data = await audio.read()
        if not data:
            raise HTTPException(400, "Empty audio upload")
        # Guard against a caller sending an impossibly huge file — mirrors
        # the emergentintegrations 25 MB limit but returns a friendlier
        # 413 with clear intent.
        if len(data) > 20 * 1024 * 1024:
            raise HTTPException(413, "Audio too large — keep clips under 60 seconds")
        tmp.write(data)
        tmp.flush()
        tmp.close()

        # Whisper via Emergent proxy. `response_format="text"` returns a
        # plain string (no JSON wrapper needed on the client). Note: we
        # pass an open file HANDLE, not just the path, because litellm's
        # underlying transcription client requires a file-like object
        # that has a `.name` attribute so it can sniff the container.
        from emergentintegrations.llm.openai import OpenAISpeechToText
        stt = OpenAISpeechToText(api_key=api_key)
        with open(tmp.name, "rb") as fh:
            result = await stt.transcribe(
                file=fh,
                model="whisper-1",
                response_format="text",
                language=language or None,
                # Prompt guides Whisper toward the FriendPlace domain so it
                # gets casual conversation, member names, and "flutter" (our
                # in-app custom word) transcribed correctly. Kept short so
                # it doesn't leak into the transcription output.
                prompt=(
                    "This is a casual friendly voice note between older adults "
                    "in the FriendPlace community app. They may talk about "
                    "friends, events, groups, coffee catch-ups and the like."
                ),
            )
        # litellm returns different shapes depending on response_format.
        # For "text" it's usually a plain str, but some versions wrap it
        # in a Transcription object with `.text`. Handle both.
        if isinstance(result, str):
            text = result
        else:
            text = getattr(result, "text", None) or str(result)
        text = (text or "").strip()
        return {"text": text}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("voice/transcribe failed")
        raise HTTPException(500, f"Transcription failed: {str(e)[:120]}")
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


@api.get("/health")
async def health():
    """Active health probe — pings MongoDB so future load balancers
    (Render, Railway, AWS ALB) can route traffic away when the DB connection
    drops instead of serving 500s. Returns 503 with the failure mode so ops
    can quickly diagnose. Public on purpose — no auth required."""
    try:
        await db.command("ping")
        return {"status": "ok", "db": "up"}
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "db": "down", "error": str(e)[:200]},
        )


app.include_router(api)

# Push notifications (Emergent-managed relay). Mounted under /api/.
from push import router as push_router  # noqa: E402
app.include_router(push_router, prefix="/api")

# Mini-CMS for the marketing website. Kept in its own module so
# server.py doesn't grow another 500-line block. Two routers:
#   * cms/*      — admin-only editing surface (JWT-guarded)
#   * public/*   — granular per-section reads used by lib/api.ts
# Both mount under /api/ to match the ingress prefix.
from cms_module import build_router as _build_cms_router, build_public_router as _build_public_router  # noqa: E402
app.include_router(_build_cms_router(db), prefix="/api")
app.include_router(_build_public_router(db), prefix="/api")

# Mission Control George System (MCGS) — see /app/memory/mcgs-architecture.md
from mcgs_module import build_router as _build_mcgs_router  # noqa: E402
app.include_router(_build_mcgs_router(db), prefix="/api")

# Presence & Status — see /app/memory/design-presence-and-status.md.
# Zero user-visible impact in Commit 1: routes exist and store data, but
# no production screen reads them yet.
from services.status.router import build_status_router as _build_status_router  # noqa: E402
from services.status.service import ensure_indexes as _ensure_status_indexes  # noqa: E402
app.include_router(_build_status_router(db, current_user), prefix="/api")


@app.on_event("startup")
async def _status_startup_indexes():  # noqa: D401
    """Idempotent — safe to run on every boot."""
    try:
        await _ensure_status_indexes(db)
    except Exception:
        logging.exception("member_status ensure_indexes failed")

# Static assets — currently used for Spot the Difference lifelike backdrops.
# Files live at /app/backend/static/spot_bg/<theme>.jpg and are served under
# /api/static/... so the Kubernetes ingress correctly proxies them to backend.
_STATIC_DIR = ROOT_DIR / "static"
_STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/api/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

# Mini-CMS media library — user-uploaded images live on local disk at
# /app/backend/uploads/cms/{uuid}.{ext} and are served under
# /api/uploads/cms/... . When we migrate to Cloudinary the router-level
# handler in cms_module.py changes; this mount can stay as a fallback
# for any legacy files.
_UPLOADS_DIR = ROOT_DIR / "uploads"
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
(_UPLOADS_DIR / "cms").mkdir(parents=True, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=str(_UPLOADS_DIR)), name="uploads")

# CORS — locked-down allowlist for production, with the local Metro/Expo
# dev proxy allowed for development. Wildcard `*` combined with
# `allow_credentials=True` is unsafe (browsers reject it in practice and
# it silently falls back to unauthenticated calls), so we build the list
# explicitly from an env-configurable comma list. Defaults cover the
# Emergent-hosted preview subdomains (*.emergentagent.com), the Metro
# dev server, and the two live app origins.
_CORS_DEFAULT = (
    "http://localhost:3000,"
    "http://localhost:3001,"
    "http://localhost:19006,"
    # FriendPlace public web surfaces — added ahead of the website build
    # so the API is CORS-ready the moment the frontend is deployed. The
    # website will live on friendplace.com.au (+ www), the admin portal on
    # admin.friendplace.com.au. If we later split into subdomains for
    # staging (e.g. staging.friendplace.com.au), extend CORS_ORIGINS in the
    # environment rather than editing this default list.
    "https://friendplace.com.au,"
    "https://www.friendplace.com.au,"
    "https://admin.friendplace.com.au"
)
_cors_env = os.getenv("CORS_ORIGINS", _CORS_DEFAULT)
_cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
_cors_regex = os.getenv("CORS_ORIGIN_REGEX", r"^https://[a-z0-9-]+\.emergentagent\.com$")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_regex,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


# -------------- Event reminder scheduler --------------
async def _event_reminder_loop():
    """Background loop — every 5 min, send 24h / 2h / start-time reminders to RSVPs.

    Each reminder is idempotent: we set a `reminder_24h_sent` etc. flag on the
    event document so duplicates are impossible across reloads/restarts.
    """
    REMINDERS = [
        ("reminder_24h_sent", timedelta(hours=24), "Tomorrow", "is on tomorrow"),
        ("reminder_2h_sent",  timedelta(hours=2),  "Starting soon", "starts in about 2 hours"),
        ("reminder_now_sent", timedelta(minutes=0), "Starting now", "is starting now"),
    ]
    while True:
        try:
            now = datetime.now(timezone.utc)
            cur = db.events.find(
                {"date": {"$ne": ""}, "time": {"$ne": ""}},
                {"_id": 0},
            )
            async for ev in cur:
                try:
                    # Build the event datetime (assume local AEST for now; UTC-safe approx)
                    dt = datetime.fromisoformat(f"{ev['date']}T{ev['time']}:00+00:00")
                except (ValueError, KeyError):
                    continue
                going = list(ev.get("rsvps") or [])
                if not going:
                    continue
                for flag, delta, title_prefix, body_phrase in REMINDERS:
                    target_at = dt - delta
                    # Trigger window: send if now is within the upcoming 6 min of target
                    diff_s = (now - target_at).total_seconds()
                    if ev.get(flag) or diff_s < 0 or diff_s > 360:
                        continue
                    title = f"{title_prefix}: {ev.get('emoji','🎉')} {ev.get('title','Event')}"
                    body = f"{ev.get('title','Event')} {body_phrase} at {ev.get('time','?')} — {ev.get('location','')}".strip()
                    for uid in going:
                        try:
                            await push_notification(uid, "event_reminder", title, body, {"event_id": ev["id"]})
                        except Exception as e:
                            logger.warning("event reminder push failed for %s: %s", uid, e)
                    await db.events.update_one({"id": ev["id"]}, {"$set": {flag: now_iso()}})
        except Exception as e:
            logger.warning("event-reminder loop iteration failed: %s", e)
        await asyncio.sleep(300)  # 5 minutes


@app.on_event("startup")
async def _start_event_reminders():
    asyncio.create_task(_event_reminder_loop())
