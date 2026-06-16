"""YouBelong backend — FastAPI + MongoDB + WebSockets.

Real-time Coffee Lounge tables, private messaging, community groups, events,
notice board, butterfly points/badges, and a seeded sample dataset so the
prototype feels alive on first launch.
"""

from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Set
from pathlib import Path
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
from jose import jwt, JWTError
import os, uuid, logging, json, asyncio, random, re

from word_search import THEMES as WS_THEMES, DIFFICULTIES as WS_DIFFS, list_themes as ws_list_themes, generate_puzzle as ws_generate, daily_pick as ws_daily_pick, today_iso as ws_today_iso
from memory_match import THEMES as MM_THEMES, DIFFICULTIES as MM_DIFFS, list_themes as mm_list_themes, generate_puzzle as mm_generate, daily_pick as mm_daily_pick, today_iso as mm_today_iso
from sudoku import DIFFICULTIES as SD_DIFFS, generate_puzzle as sd_generate, daily_pick as sd_daily_pick, today_iso as sd_today_iso
from spot_difference import THEMES as STD_THEMES, DIFFICULTIES as STD_DIFFS, list_themes as std_list_themes, generate_puzzle as std_generate, daily_pick as std_daily_pick, today_iso as std_today_iso
from spot_library import list_active_puzzles as lib_active, get_puzzle as lib_get, public_card as lib_card  # noqa: E402
from milestones import MILESTONES as ML_DEFS, evaluate as ml_evaluate
from suburbs import search_suburbs as sb_search, by_postcode as sb_by_postcode, haversine_km as sb_haversine

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ---------------- Auth config & helpers ----------------
JWT_SECRET = os.environ.get("JWT_SECRET", "yb-dev-secret-change-me")
JWT_ALG = "HS256"
JWT_TTL_MIN = int(os.environ.get("JWT_TTL_MIN", "10080"))  # 7 days
RESET_TTL_MIN = int(os.environ.get("RESET_TTL_MIN", "10"))
MAX_LOGIN_ATTEMPTS = int(os.environ.get("MAX_LOGIN_ATTEMPTS", "5"))
LOCKOUT_MIN = int(os.environ.get("LOCKOUT_MIN", "15"))

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


app = FastAPI(title="YouBelong API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("youbelong")


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
    # client uploads from the Coffee Lounge image picker.
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
    """
    u = dict(u or {})
    u.pop("_id", None)
    u.pop("password_hash", None)
    u.pop("failed_login_attempts", None)
    u.pop("lockout_until", None)
    u.pop("suburb_lat", None)
    u.pop("suburb_lng", None)
    return u


async def _find_user_by_identifier(identifier: str) -> Optional[dict]:
    ident = (identifier or "").strip().lower()
    if not ident:
        return None
    # try username (case-insensitive) then email
    u = await db.users.find_one({"username": {"$regex": f"^{ident}$", "$options": "i"}})
    if u:
        return u
    return await db.users.find_one({"email": {"$regex": f"^{ident}$", "$options": "i"}})


@api.post("/auth/signup")
async def signup(body: SignupBody):
    uname = body.username.strip()
    if len(uname) < 3:
        raise HTTPException(400, "Username must be at least 3 characters")
    if any(ch.isspace() for ch in uname):
        raise HTTPException(400, "Username can't contain spaces")
    if not re.match(r"^[A-Za-z0-9_.\-]+$", uname):
        raise HTTPException(400, "Username can only contain letters, numbers, and . _ -")
    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    if await db.users.find_one({"username": {"$regex": f"^{uname}$", "$options": "i"}}):
        raise HTTPException(400, "Username already taken")
    if body.email and await db.users.find_one({"email": {"$regex": f"^{body.email}$", "$options": "i"}}):
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
                "body": f"{user.first_name or user.username} just joined YouBelong through your share link. Welcome them in!",
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
    await db.users.insert_one(doc)
    # Award any new milestone badges to the inviter now that the new account
    # is committed and `invited_by` is on file.
    if doc.get("invited_by"):
        await _check_invite_milestones(doc["invited_by"])
    # Welcome notification to the new user themselves
    await db.notifications.insert_one({
        "id": nid(), "user_id": user.id, "type": "welcome",
        "title": "Welcome to YouBelong!",
        "body": "We're so glad you're here. Take a look at the Coffee Lounge or send a friend request to say hello.",
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
    u = await db.users.find_one({"username": {"$regex": f"^{body.username}$", "$options": "i"}})
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
    """Exchange an Emergent Google OAuth session_id for a YouBelong JWT.

    Emergent issues a one-time `session_id` in the redirect URL. We swap that
    server-side for the verified user profile (email/name/picture) and either
    link to an existing YouBelong account (matched by email) or create a brand
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
                "body": f"{user.first_name or user.username} just joined YouBelong through your share link. Welcome them in!",
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

    await db.users.insert_one(doc)
    # Award invite-milestone badges to the inviter (idempotent).
    if doc.get("invited_by"):
        await _check_invite_milestones(doc["invited_by"])
    await db.notifications.insert_one({
        "id": nid(), "user_id": user.id, "type": "welcome",
        "title": "Welcome to YouBelong!",
        "body": "We're so glad you're here. Take a moment to add your interests and join a few groups.",
        "read": False, "created_at": now_iso(),
    })
    try: await _broadcast_new_member(doc)
    except Exception as e: logger.warning("new-member broadcast failed: %s", e)
    return {"access_token": make_token(user.id), "token_type": "bearer", "user": _safe_user(doc), "is_new": True}


@api.get("/auth/me")
async def auth_me(user=Depends(current_user)):
    return _safe_user(user)


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
    logger.info(f"Password reset code for {u.get('username')}: {code}")
    # NOTE: returned in the response only because no email provider is wired yet.
    # Replace with email delivery (Resend / SendGrid) once a key is provided.
    return {
        "message": "Reset code generated.",
        "dev_code": code,
        "expires_in_minutes": RESET_TTL_MIN,
    }


@api.post("/auth/reset-password")
async def reset_password(body: ResetBody):
    u = await _find_user_by_identifier(body.identifier)
    if not u:
        raise HTTPException(400, "Invalid or expired code")
    rec = await db.password_resets.find_one({"user_id": u["id"], "code": body.code, "used": False})
    if not rec:
        raise HTTPException(400, "Invalid or expired code")
    try:
        exp = datetime.fromisoformat(rec["expires_at"])
    except Exception:
        raise HTTPException(400, "Invalid or expired code")
    if datetime.now(timezone.utc) > exp:
        raise HTTPException(400, "Invalid or expired code")

    await db.users.update_one(
        {"id": u["id"]},
        {"$set": {
            "password_hash": hash_pw(body.new_password),
            "failed_login_attempts": 0,
            "lockout_until": None,
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
):
    """List members. When `viewer_id` is provided, hides users blocked by or
    who have blocked the viewer, and excludes banned users.

    When `near_lat` + `near_lng` + `radius_km` are provided, only includes
    members whose suburb falls within that radius. Coordinates are NEVER
    returned to the client — only a friendly `distance_km` and the suburb
    name. Users with `location_visibility=private` are excluded from radius
    queries (they opted out of location matching)."""
    query: Dict = {"banned": {"$ne": True}, "profile_hidden": {"$ne": True}}
    if suburb:
        query["suburb"] = {"$regex": suburb, "$options": "i"}
    if interest:
        query["interests"] = {"$regex": interest, "$options": "i"}
    if q:
        query["$or"] = [
            {"first_name": {"$regex": q, "$options": "i"}},
            {"username": {"$regex": q, "$options": "i"}},
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
                u.pop("suburb_lat", None)
                u.pop("suburb_lng", None)
                out.append(u)
        out.sort(key=lambda x: x.get("distance_km", 9999))
        return out
    # Never leak raw coordinates in the public list response.
    for u in docs:
        u.pop("suburb_lat", None)
        u.pop("suburb_lng", None)
    return docs


@api.get("/users/{user_id}")
async def get_user(user_id: str):
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    return _safe_user(user)


@api.get("/users/{user_id}/invite-stats")
async def invite_stats(user_id: str, limit: int = 10):
    """How many real (non-demo) users joined YouBelong via this user's share
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
            f"You've earned the {latest} badge — thanks for growing the YouBelong community!",
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


@api.patch("/users/{user_id}/profile")
async def update_profile(user_id: str, body: ProfileUpdateBody):
    update: Dict = {}
    for f in ("first_name", "suburb", "bio", "avatar", "interests", "favourite_games", "birthday"):
        v = getattr(body, f, None)
        if v is not None:
            update[f] = v
    if update:
        await db.users.update_one({"id": user_id}, {"$set": update})
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "user": u}


class PrivacySettingsBody(BaseModel):
    profile_visibility: Optional[str] = None    # everyone | friends
    friend_requests: Optional[str] = None        # everyone | friends | off
    show_in_find_friends: Optional[bool] = None


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
# A small, curated list of starter community groups that brand-new YouBelong
# members can join with a single tap during the post-signup wizard. Sydney/AU
# leaning to match the seed dataset. The wizard mixes these with the existing
# seeded groups (Walking, Garden Club, etc.) — interest-matched first.
STARTER_GROUPS = [
    {"name": "Sydney Locals", "emoji": "🏙️", "description": "For everyone who calls Sydney home — share favourite spots, meetups and neighbourhood news.",
     "tags": ["local", "sydney", "meetups", "neighbourhood"]},
    {"name": "New Friends", "emoji": "👋", "description": "Brand new to YouBelong? Say hello and meet other members who just joined.",
     "tags": ["new", "introductions", "welcome"]},
    {"name": "Pet Lovers", "emoji": "🐾", "description": "Cats, dogs, chooks, fish — share pet stories, photos and walking buddies.",
     "tags": ["pets", "dogs", "cats", "animals"]},
    {"name": "Classic Cars", "emoji": "🚗", "description": "Restorations, cruises and Sunday-morning meetups for car enthusiasts.",
     "tags": ["cars", "classic cars", "vehicles", "motoring"]},
    {"name": "Gardening", "emoji": "🌱", "description": "Vegetable patches, balcony gardens, plant swaps and questions welcome.",
     "tags": ["gardening", "plants", "garden"]},
    {"name": "Walking & Trails", "emoji": "🥾", "description": "Bushwalks, beach strolls, and gentle daily walks — find a walking buddy.",
     "tags": ["walking", "fitness", "hiking", "outdoors"]},
    {"name": "Coffee Lounge Crew", "emoji": "☕", "description": "Regulars who love a virtual cuppa in the Coffee Lounge — chat anytime.",
     "tags": ["coffee", "chat", "lounge", "social"]},
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

    # Welcome notification — phrased to push the user into Coffee Lounge first
    await db.notifications.insert_one({
        "id": nid(), "user_id": body.user_id, "type": "onboarding_done",
        "title": "You're all set up!",
        "body": f"Welcome aboard! You've joined {len(joined)} group{'s' if len(joined) != 1 else ''}. Why not pop into the Coffee Lounge and say hello?",
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
        "body": f"{user.get('first_name') or user.get('username','?')} just joined YouBelong from {user.get('suburb') or 'nearby'}. Send a wave!",
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
    "in_coffee_lounge":  {"label": "In the Coffee Lounge", "code": "in_coffee_lounge",  "emoji": "☕"},
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
async def suburbs_search(q: str = "", limit: int = 10):
    """Typeahead — returns up to `limit` matches by name or postcode."""
    return {"results": sb_search(q, min(int(limit), 30))}


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
    "coffee":     ("☕", "let's celebrate in the Coffee Lounge"),
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
        "Community Points awarded for kindness.",
        {"from_id": from_user_id, "kind": body.kind},
    )
    # Award points for positive participation
    await award_points(from_user_id, 3)
    return {"ok": True}


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
            "Your friends at YouBelong would love to see you again.",
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


# ------------- Tables (Coffee Lounge) -------------
async def _prune_idle_tables() -> None:
    """Delete non-persistent tables (and their messages) that have had no
    activity for 24 hours. Keeps the Coffee Lounge tidy without a separate
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
                  "Pet Lovers", "New Friends", "Sydney Locals"}
    await db.tables.update_many(
        {"name": {"$in": list(seed_names)}, "persistent": {"$ne": True}},
        {"$set": {"persistent": True}},
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


@api.get("/tables")
async def list_tables(user_id: str | None = None):
    """List Coffee Lounge tables sorted by most recently active.

    When `user_id` is supplied the response is enriched with:
      • `host_display` — `{first_name, avatar}` for the table's host so the
        card can say "Started by Frank" without an extra round-trip.
      • `friends_seated` — array of `{id, first_name, avatar}` for any
        currently-seated members that are friends of `user_id`. The lounge
        UI surfaces this as a "Joyce is here 🌸" chip; it's the single
        biggest reason older users will tap into a table.

    Both fields are best-effort — if user lookups fail we silently omit
    them so the lounge always loads.
    """
    await _migrate_table_metadata()
    await _prune_idle_tables()
    docs = await db.tables.find({}, {"_id": 0}).sort("last_activity_at", -1).to_list(500)

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
        {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1},
    )
    user_map: dict[str, dict] = {}
    async for u in cursor:
        user_map[u["id"]] = {
            "id": u["id"],
            "first_name": u.get("first_name") or u.get("username") or "Friend",
            "avatar": u.get("avatar") or "🙂",
        }

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
            title = f"{emoji} {hname} just opened a Coffee Lounge table"
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
    if user_id in (t.get("seated") or []):
        return {"ok": True}
    await db.tables.update_one(
        {"id": table_id},
        {"$addToSet": {"seated": user_id}, "$set": {"last_activity_at": now_iso()}},
    )
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
    return {"ok": True}


@api.get("/tables/{table_id}/messages")
async def table_messages(table_id: str):
    docs = await db.messages.find({"table_id": table_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return docs


# ------------- Groups -------------
@api.get("/groups")
async def list_groups():
    # Newest groups first so new communities are discoverable.
    return await db.groups.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.post("/groups")
async def create_group(body: Group):
    g = Group(**body.dict())
    await db.groups.insert_one(g.dict())
    return g.dict()


@api.post("/groups/{group_id}/join/{user_id}")
async def join_group(group_id: str, user_id: str):
    await db.groups.update_one({"id": group_id}, {"$addToSet": {"members": user_id}})
    await award_points(user_id, 3)
    return {"ok": True}


@api.get("/groups/{group_id}/posts")
async def group_posts(group_id: str):
    return await db.group_posts.find({"group_id": group_id}, {"_id": 0}).sort("created_at", -1).to_list(200)


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


@api.post("/events")
async def create_event(body: Event):
    e = Event(**body.dict())
    await db.events.insert_one(e.dict())
    return e.dict()


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
    BOLD and TYPOGRAPHIC so it works at a glance from across a room:

        ┌────────────────────────────┐
        │     YOUBELONG (huge)       │  ← navy banner, fills top
        ├────────────────────────────┤
        │  FIND YOUR PEOPLE.         │  ← big bold headline
        │                            │
        │  Lead description (large)  │
        │  Sub description (medium)  │
        │                            │
        │     [ Large QR code ]      │  ← higher on page
        │     Scan to Join Free      │
        │     youbelongapp.com       │
        │                            │
        │ Because You Belong Too.    │  ← footer line
        └────────────────────────────┘
    """
    await _require_admin(admin_id)
    import io
    import qrcode
    from PIL import Image, ImageDraw, ImageFont
    from fastapi.responses import Response

    target_url = (url or "").strip() or "https://youbelongapp.com"
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
        bases: list[str] = []
        if condensed:
            # Condensed variant lets the wordmark grow significantly without
            # blowing past the page margins (regular Bold tops out around 180pt
            # for "YOUBELONG"; condensed bold easily reaches ~250pt).
            if bold and italic:
                bases.append("/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-BoldOblique.ttf")
            elif bold:
                bases.append("/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf")
            elif italic:
                bases.append("/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Oblique.ttf")
            else:
                bases.append("/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf")
        if italic and bold:
            bases.append("/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf")
        elif italic:
            bases.append("/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf")
        elif bold:
            bases.append("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
        bases.append("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
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

    # ─── Top banner: YOUBELONG — the dominant brand-mark on the flyer. ─────
    # Use the Condensed Bold cut so the wordmark can grow to ~190pt and span
    # almost the full page width — about 3× bigger than the previous flyer.
    BANNER_H = 280
    d.rectangle([0, 0, W, BANNER_H], fill=NAVY)
    SIDE = 100  # body-text margin used elsewhere on the page
    fit_centred("YOUBELONG", 70, W - 60, start_size=200, min_size=160,
                fill="#FFFFFF", bold=True, condensed=True)

    # ─── Headline ────────────────────────────────────────────────────────
    HEAD_Y = BANNER_H + 60
    fit_centred("FIND YOUR PEOPLE.", HEAD_Y, W - 2 * SIDE,
                start_size=110, min_size=72, fill=NAVY, bold=True)

    # ─── Lead description ────────────────────────────────────────────────
    lead = ("Meet new friends, join local events, chat in the Coffee Lounge, "
            "and connect with people who share your interests.")
    lead_y = wrap_centre(lead, HEAD_Y + 150, font(38, bold=False), INK,
                         max_w=W - 2 * SIDE, line_gap=12)

    sub = ("Whether you're new to the area, looking to expand your social "
           "circle, or simply want to feel more connected, YouBelong helps "
           "bring people together through friendship, community, and belonging.")
    wrap_centre(sub, lead_y + 24, font(30, bold=False), SLATE,
                max_w=W - 2 * SIDE, line_gap=10)

    # ─── QR code (large, positioned high on page so it's easy to scan) ──
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10, border=2,
    )
    qr.add_data(target_url)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color=INK, back_color="#FFFFFF").convert("RGB")
    qr_size = 600
    qr_img = qr_img.resize((qr_size, qr_size), Image.LANCZOS)
    qr_x = (W - qr_size) // 2
    qr_y = 880
    img.paste(qr_img, (qr_x, qr_y))
    d.rectangle([qr_x - 14, qr_y - 14, qr_x + qr_size + 14, qr_y + qr_size + 14],
                outline=NAVY, width=4)

    # ─── CTA + URL + closing line ─────────────────────────────────────────
    # Stack three lines tightly so they all fit within page-height (1754):
    #   1. Scan to Join Free (large)
    #   2. youbelongapp.com (medium)
    #   3. Because You Belong Too. (italic, brand colour)
    cta_y = qr_y + qr_size + 30  # 1580
    centre("Scan to Join Free", cta_y, font(56), NAVY)
    centre(target_url.replace("https://", "").replace("http://", ""),
           cta_y + 70, font(30, bold=False), SLATE)
    centre("Because You Belong Too.", cta_y + 116, font(40, italic=True), TEAL)

    # Optional small venue line — squeezed between QR and CTA when supplied.
    if venue:
        centre(f"Posted by {venue}", qr_y - 38, font(22, bold=False), SLATE)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={
            "Content-Disposition": 'inline; filename="youbelong-flyer.png"',
            "Cache-Control": "no-store",
        },
    )


@api.get("/admin/events")
async def admin_list_events(admin_id: str, status: str = "all"):
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
async def admin_archive_event(event_id: str, body: AdminHardDeleteBody):
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
async def admin_unarchive_event(event_id: str, body: AdminHardDeleteBody):
    await _require_admin(body.admin_id)
    await db.events.update_one({"id": event_id}, {"$set": {"archived": False}, "$unset": {"archived_at": "", "archived_by": "", "archived_reason": ""}})
    return {"ok": True}


@api.delete("/admin/events/{event_id}")
async def admin_hard_delete_event(event_id: str, admin_id: str, reason: Optional[str] = None):
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
async def admin_hard_delete_notice(notice_id: str, admin_id: str, reason: Optional[str] = None):
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


@api.delete("/admin/users/{user_id}")
async def admin_hard_delete_user(user_id: str, admin_id: str, reason: Optional[str] = None):
    """Hard-delete a user account and their content. ADMIN ONLY. Irreversible.

    Removes the user record, their notices, messages, friend connections,
    flutters, and any moderation reports they filed. Reports filed against
    them are kept (for audit) but the target_user_id is anonymised.
    """
    await _require_admin(admin_id)
    if user_id == admin_id:
        raise HTTPException(400, "Cannot hard-delete your own admin account")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1, "is_admin": 1})
    if not user:
        raise HTTPException(404, "User not found")
    if user.get("is_admin"):
        raise HTTPException(400, "Cannot hard-delete another admin")
    # Log BEFORE deletion so the audit entry exists
    await _log_moderation_action(
        user_id=user_id, by=admin_id, action="hard_delete",
        reason=reason or f"User @{user.get('username','?')} hard-deleted by admin",
        extra={"username_snapshot": user.get("username")},
    )
    await db.users.delete_one({"id": user_id})
    await db.notices.delete_many({"user_id": user_id})
    await db.messages.delete_many({"$or": [{"user_id": user_id}, {"from_id": user_id}, {"to_id": user_id}]})
    await db.flutters.delete_many({"$or": [{"from_id": user_id}, {"to_id": user_id}]})
    await db.notifications.delete_many({"user_id": user_id})
    await db.reports.delete_many({"reporter_id": user_id})
    await db.reports.update_many({"target_user_id": user_id}, {"$set": {"target_user_id": "[deleted]"}})
    # Pull from friends arrays everywhere
    await db.users.update_many({}, {"$pull": {"friends": user_id, "blocked": user_id}})
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
    return docs


@api.post("/notices")
async def create_notice(body: Notice):
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
    """Apply the YouBelong moderation policy (per house rules).

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
async def admin_list_reports(admin_id: str, status: str = "all"):
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
async def admin_get_report(report_id: str, admin_id: str):
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
async def admin_set_status(report_id: str, status: str, body: AdminActionBody):
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
async def admin_warn_user(body: AdminUserActionBody):
    await _require_admin(body.admin_id)
    target = await db.users.find_one({"id": body.user_id}, {"_id": 0, "username": 1, "first_name": 1, "avatar": 1})
    if not target:
        raise HTTPException(404, "User not found")
    await db.users.update_one({"id": body.user_id}, {"$push": {"warnings": {"id": nid(), "reason": body.reason, "issued_at": now_iso(), "by": body.admin_id}}})
    await db.notifications.insert_one({
        "id": nid(), "user_id": body.user_id, "type": "moderation_warning",
        "title": "Warning from the YouBelong team",
        "body": body.reason or "Please review our community guidelines.",
        "read": False, "created_at": now_iso(),
    })
    if body.report_id:
        await db.reports.update_one({"id": body.report_id}, {"$set": {"status": "resolved", "outcome": "warned", "admin_note": body.reason, "updated_at": now_iso()}})
    await _log_moderation_action(user_id=body.user_id, by=body.admin_id, action="warn", reason=body.reason, report_id=body.report_id)
    return {"ok": True}


@api.post("/admin/users/suspend")
async def admin_suspend_user(body: AdminUserActionBody):
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
async def admin_ban_user(body: AdminUserActionBody):
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
async def admin_restore_user(body: AdminUserActionBody):
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
async def admin_remove_content(body: AdminRemoveContentBody):
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
async def admin_user_moderation(user_id: str, admin_id: str):
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
async def admin_add_user_note(user_id: str, body: AdminNoteBody):
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
    doc = {
        "id": nid(), "user_id": body.user_id, "user_email": body.user_email,
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
    return {"ok": True, "ticket_id": doc["id"], "message": "Thank you. We've received your message and will get back to you soon."}


@api.get("/admin/support/tickets")
async def admin_list_tickets(admin_id: str, status: str = "all"):
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
async def admin_resolve_ticket(ticket_id: str, body: AdminActionBody):
    await _require_admin(body.admin_id)
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": {"status": "resolved", "updated_at": now_iso(), "admin_note": body.note}})
    return {"ok": True}


@api.get("/admin/summary")
async def admin_summary(admin_id: str):
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
async def admin_repeat_offenders(admin_id: str, days: int = MODERATION_WINDOW_DAYS, min_reporters: int = 2):
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
async def admin_clear_restriction(body: ModerationLiftBody):
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
    """Public-readable summary of YouBelong's moderation policy."""
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
async def admin_list_admins(admin_id: str):
    """Return every user currently flagged as admin. Visible to admins only."""
    await _require_admin(admin_id)
    rows = await db.users.find(
        {"is_admin": True},
        {"_id": 0, "id": 1, "username": 1, "first_name": 1, "avatar": 1, "suburb": 1},
    ).sort("username", 1).to_list(200)
    return {"admins": rows}


@api.get("/admin/users/search")
async def admin_search_users(admin_id: str, q: str = "", limit: int = 25):
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
async def admin_set_admin_flag(body: AdminPromoteBody):
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
        "title": "You're now a YouBelong moderator" if desired else "Your moderator access was removed",
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
    sender = await db.users.find_one({"id": body.from_id}, {"_id": 0})
    if not sender:
        raise HTTPException(404, "Sender not found")
    receiver = await db.users.find_one({"id": body.to_id}, {"_id": 0, "blocked": 1})
    if not receiver:
        raise HTTPException(404, "Recipient not found")
    if body.from_id in (receiver.get("blocked") or []):
        raise HTTPException(403, "Cannot flutter this user")
    f = FlutterDoc(
        from_id=body.from_id,
        to_id=body.to_id,
        from_name=sender.get("first_name", ""),
        from_avatar=sender.get("avatar", ""),
        message=body.message or "would like to chat 🦋",
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
async def my_conversations(user_id: str):
    docs = await db.dm_conversations.find({"participants": user_id}, {"_id": 0}).sort("updated_at", -1).to_list(100)
    # attach other user info + last message
    out = []
    for c in docs:
        other_id = next((p for p in c["participants"] if p != user_id), None)
        other = await db.users.find_one({"id": other_id}, {"_id": 0}) if other_id else None
        last = await db.messages.find_one({"dm_id": c["id"]}, {"_id": 0}, sort=[("created_at", -1)])
        out.append({**c, "other": other, "last": last})
    return out


@api.get("/dm/{conv_id}/messages")
async def dm_messages(conv_id: str):
    return await db.messages.find({"dm_id": conv_id}, {"_id": 0}).sort("created_at", 1).to_list(500)


@api.post("/dm/start")
async def start_dm(body: dict):
    a = body.get("user_id")
    b = body.get("other_id")
    if not a or not b:
        raise HTTPException(400, "user_id and other_id are required")
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


@app.websocket("/api/ws/table/{table_id}")
async def ws_table(websocket: WebSocket, table_id: str, user_id: str = Query(...)):
    room = f"table:{table_id}"
    await hub.connect(room, websocket)
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    await db.tables.update_one({"id": table_id}, {"$addToSet": {"seated": user_id}})
    # Auto-update presence status when sitting at a Coffee Lounge table.
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
                    f"☕ {user.get('first_name','A friend')} is in the Coffee Lounge and has a seat available",
                    f"Table: {tbl.get('name','Coffee Lounge')} — pull up a chair!",
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
            await hub.broadcast(room, {"type": "message", "message": msg.dict()})
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(room, websocket)
        await db.tables.update_one({"id": table_id}, {"$pull": {"seated": user_id}})
        # Restore prior status (if any) when leaving the Coffee Lounge.
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
async def ws_dm(websocket: WebSocket, conv_id: str, user_id: str = Query(...)):
    room = f"dm:{conv_id}"
    await hub.connect(room, websocket)
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
            await db.dm_conversations.update_one({"id": conv_id}, {"$set": {"updated_at": now_iso()}})
            await hub.broadcast(room, {"type": "message", "message": msg.dict()})
            # notify the OTHER participant about a new DM
            try:
                conv = await db.dm_conversations.find_one({"id": conv_id}, {"_id": 0})
                if conv:
                    others = [x for x in (conv.get("user_ids") or []) if x != user_id]
                    sender_name = (user or {}).get("first_name") or "Someone"
                    sender_avatar = (user or {}).get("avatar") or "🦋"
                    for other_id in others:
                        await push_notification(
                            other_id,
                            "dm",
                            f"{sender_avatar} {sender_name} sent you a message",
                            text[:120],
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
    {"first_name": "Frank", "username": "frankie", "suburb": "Manly", "interests": ["Woodwork", "Fishing", "Pets"], "avatar": "🔨", "bio": "Retired carpenter. Always tinkering.", "points": 42, "badges": ["Friendly Member", "Helpful Neighbour"]},
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
     "sponsor": {"name": "Café Belong", "message": "Senior's discount on coffee & cake", "discount_code": "BELONG10"}},
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
    {"group_idx": 4, "user_idx": 6, "text": "Cafe Belong has a senior's discount on Tuesdays — pass it on!"},
    {"group_idx": 1, "user_idx": 7, "text": "Saturday's food drive went brilliantly. Thank you to everyone who turned up. 🤝"},
]


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
    users_count = await db.users.count_documents({})
    if users_count > 0:
        logger.info("Seed skipped — data already present (%s users)", users_count)
        return
    logger.info("Seeding YouBelong sample data…")

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
    return {"app": "YouBelong", "status": "ok"}


@api.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(api)

# Push notifications (Emergent-managed relay). Mounted under /api/.
from push import router as push_router  # noqa: E402
app.include_router(push_router, prefix="/api")

# Static assets — currently used for Spot the Difference lifelike backdrops.
# Files live at /app/backend/static/spot_bg/<theme>.jpg and are served under
# /api/static/... so the Kubernetes ingress correctly proxies them to backend.
_STATIC_DIR = ROOT_DIR / "static"
_STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/api/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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
