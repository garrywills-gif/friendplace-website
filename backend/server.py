"""YouBelong backend — FastAPI + MongoDB + WebSockets.

Real-time Coffee Lounge tables, private messaging, community groups, events,
notice board, butterfly points/badges, and a seeded sample dataset so the
prototype feels alive on first launch.
"""

from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Set
from pathlib import Path
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
from jose import jwt, JWTError
import os, uuid, logging, json, asyncio, random

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
class User(BaseModel):
    id: str = Field(default_factory=nid)
    first_name: str = ""
    username: str
    email: str = ""
    suburb: str = ""
    interests: List[str] = []
    avatar: str = ""  # emoji or url
    bio: str = ""
    points: int = 0
    badges: List[str] = []
    friends: List[str] = []
    blocked: List[str] = []
    is_demo: bool = False
    # Privacy: who can see me / contact me
    privacy: str = "everyone"  # everyone | friends | invisible
    # Online presence
    last_seen_at: str = Field(default_factory=now_iso)
    created_at: str = Field(default_factory=now_iso)


class SignupBody(BaseModel):
    username: str
    password: str = Field(min_length=6)
    email: Optional[EmailStr] = None
    first_name: str = ""
    suburb: str = ""
    interests: List[str] = []
    avatar: str = ""


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
    rsvps: List[str] = []
    sponsor: Optional[dict] = None  # {name, message, discount_code}
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
        badges.add("Friendly Butterfly")
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
    """Return a user dict without sensitive fields."""
    u = dict(u or {})
    u.pop("_id", None)
    u.pop("password_hash", None)
    u.pop("failed_login_attempts", None)
    u.pop("lockout_until", None)
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
    if await db.users.find_one({"username": {"$regex": f"^{uname}$", "$options": "i"}}):
        raise HTTPException(400, "Username already taken")
    if body.email and await db.users.find_one({"email": {"$regex": f"^{body.email}$", "$options": "i"}}):
        raise HTTPException(400, "Email already registered")

    user = User(
        first_name=body.first_name or "",
        username=uname,
        email=(body.email or "").lower(),
        suburb=body.suburb,
        interests=body.interests,
        avatar=body.avatar,
        is_demo=False,
        points=5,
        badges=["Friendly Butterfly"],
    )
    doc = user.dict()
    doc["password_hash"] = hash_pw(body.password)
    doc["failed_login_attempts"] = 0
    doc["lockout_until"] = None
    await db.users.insert_one(doc)
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
    return {"access_token": make_token(u["id"]), "token_type": "bearer", "user": _safe_user(u)}


@api.get("/auth/me")
async def auth_me(user=Depends(current_user)):
    return user


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
async def list_users(suburb: Optional[str] = None, interest: Optional[str] = None, q: Optional[str] = None):
    query = {}
    if suburb:
        query["suburb"] = {"$regex": suburb, "$options": "i"}
    if interest:
        query["interests"] = {"$regex": interest, "$options": "i"}
    if q:
        query["$or"] = [
            {"first_name": {"$regex": q, "$options": "i"}},
            {"username": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.users.find(query, {"_id": 0}).to_list(500)
    return docs


@api.get("/users/{user_id}")
async def get_user(user_id: str):
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    return user


@api.post("/users/{user_id}/block/{other_id}")
async def block_user(user_id: str, other_id: str):
    await db.users.update_one({"id": user_id}, {"$addToSet": {"blocked": other_id}})
    return {"ok": True}


@api.post("/users/{user_id}/report/{other_id}")
async def report_user(user_id: str, other_id: str, reason: str = "unspecified"):
    await db.reports.insert_one({"id": nid(), "from": user_id, "target": other_id, "reason": reason, "created_at": now_iso()})
    return {"ok": True}


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


@api.post("/users/{user_id}/heartbeat")
async def heartbeat(user_id: str):
    await db.users.update_one({"id": user_id}, {"$set": {"last_seen_at": now_iso()}})
    return {"ok": True}


def _status_from(last_seen: Optional[str], privacy: str = "everyone") -> Dict:
    """Return {label, code} computed from the last-seen timestamp."""
    if privacy == "invisible":
        return {"label": "Offline", "code": "offline"}
    if not last_seen:
        return {"label": "Offline", "code": "offline"}
    try:
        ts = datetime.fromisoformat(last_seen)
    except Exception:
        return {"label": "Offline", "code": "offline"}
    delta = datetime.now(timezone.utc) - (ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc))
    secs = int(delta.total_seconds())
    if secs < 120:
        return {"label": "Online now", "code": "online"}
    if secs < 60 * 60 * 24:
        return {"label": "Active today", "code": "active_today"}
    if secs < 60 * 60 * 24 * 7:
        return {"label": "Last seen recently", "code": "recent"}
    return {"label": "Offline", "code": "offline"}


@api.get("/users/{user_id}/status")
async def user_status(user_id: str):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "last_seen_at": 1, "privacy": 1})
    if not u:
        raise HTTPException(404, "User not found")
    return _status_from(u.get("last_seen_at"), u.get("privacy", "everyone"))


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


# ------------- Tables (Coffee Lounge) -------------
@api.get("/tables")
async def list_tables():
    docs = await db.tables.find({}, {"_id": 0}).to_list(500)
    return docs


@api.post("/tables")
async def create_table(body: CreateTableBody):
    t = Table(**body.dict(), seated=[body.host_id])
    await db.tables.insert_one(t.dict())
    await award_points(body.host_id, 10)
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
    await db.tables.update_one({"id": table_id}, {"$addToSet": {"seated": user_id}})
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
    return await db.groups.find({}, {"_id": 0}).to_list(200)


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
    return await db.events.find({}, {"_id": 0}).sort("date", 1).to_list(200)


@api.post("/events")
async def create_event(body: Event):
    e = Event(**body.dict())
    await db.events.insert_one(e.dict())
    return e.dict()


@api.post("/events/{event_id}/rsvp/{user_id}")
async def rsvp_event(event_id: str, user_id: str):
    await db.events.update_one({"id": event_id}, {"$addToSet": {"rsvps": user_id}})
    await award_points(user_id, 6)
    return {"ok": True}


@api.post("/events/{event_id}/unrsvp/{user_id}")
async def unrsvp_event(event_id: str, user_id: str):
    await db.events.update_one({"id": event_id}, {"$pull": {"rsvps": user_id}})
    return {"ok": True}


# ------------- Notice Board -------------
@api.get("/notices")
async def list_notices():
    return await db.notices.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.post("/notices")
async def create_notice(body: Notice):
    n = Notice(**body.dict())
    await db.notices.insert_one(n.dict())
    await award_points(body.user_id, 4)
    return n.dict()


@api.post("/notices/{notice_id}/like/{user_id}")
async def like_notice(notice_id: str, user_id: str):
    await db.notices.update_one({"id": notice_id}, {"$addToSet": {"likes": user_id}})
    return {"ok": True}


@api.post("/notices/{notice_id}/comment")
async def comment_notice(notice_id: str, body: dict):
    comment = {"id": nid(), "user_id": body.get("user_id"), "user_name": body.get("user_name", ""), "text": body.get("text", ""), "created_at": now_iso()}
    await db.notices.update_one({"id": notice_id}, {"$push": {"comments": comment}})
    return comment


# ------------- Flutter (online ping) -------------
class FlutterDoc(BaseModel):
    id: str = Field(default_factory=nid)
    from_id: str
    to_id: str
    from_name: str = ""
    from_avatar: str = ""
    message: str = "wants to chat 🦋"
    read: bool = False
    created_at: str = Field(default_factory=now_iso)


@api.post("/flutters/send")
async def send_flutter(body: dict):
    sender = await db.users.find_one({"id": body["from_id"]}, {"_id": 0})
    if not sender:
        raise HTTPException(404, "Sender not found")
    f = FlutterDoc(
        from_id=body["from_id"],
        to_id=body["to_id"],
        from_name=sender.get("first_name", ""),
        from_avatar=sender.get("avatar", ""),
        message=body.get("message", "wants to chat 🦋"),
    )
    await db.flutters.insert_one(f.dict())
    await award_points(body["from_id"], 2)
    await push_notification(
        body["to_id"],
        "flutter",
        f"{f.from_avatar} {f.from_name} is online and looking for company",
        f.message or "",
        {"from_id": body["from_id"], "flutter_id": f.id},
    )
    return f.dict()


@api.get("/flutters/{user_id}")
async def my_flutters(user_id: str):
    return await db.flutters.find({"to_id": user_id, "read": False}, {"_id": 0}).sort("created_at", -1).to_list(100)


@api.post("/flutters/{flutter_id}/read")
async def mark_flutter_read(flutter_id: str):
    await db.flutters.update_one({"id": flutter_id}, {"$set": {"read": True}})
    return {"ok": True}


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
    a = body["user_id"]
    b = body["other_id"]
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
    await hub.broadcast(room, {"type": "presence", "event": "join", "user": user})
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            text = (payload.get("text") or "").strip()
            if not text:
                continue
            msg = Message(
                table_id=table_id,
                user_id=user_id,
                user_name=user.get("first_name", "") if user else "",
                avatar=user.get("avatar", "") if user else "",
                text=text,
            )
            await db.messages.insert_one(msg.dict())
            await award_points(user_id, 1)
            await hub.broadcast(room, {"type": "message", "message": msg.dict()})
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(room, websocket)
        await db.tables.update_one({"id": table_id}, {"$pull": {"seated": user_id}})
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
    {"first_name": "Margaret", "username": "maggie", "suburb": "Bondi", "interests": ["Gardening", "Books", "Tea"], "avatar": "🌸", "bio": "Loves roses and a good cuppa.", "points": 78, "badges": ["Friendly Butterfly", "Helpful Neighbour", "Social Star"]},
    {"first_name": "Frank", "username": "frankie", "suburb": "Manly", "interests": ["Woodwork", "Fishing", "Pets"], "avatar": "🔨", "bio": "Retired carpenter. Always tinkering.", "points": 42, "badges": ["Friendly Butterfly", "Helpful Neighbour"]},
    {"first_name": "Joyce", "username": "joycey", "suburb": "Surry Hills", "interests": ["Books", "Cats", "Tea"], "avatar": "📚", "bio": "Two cats and a hundred books.", "points": 55, "badges": ["Friendly Butterfly", "Helpful Neighbour"]},
    {"first_name": "Bill", "username": "billdo", "suburb": "Bondi", "interests": ["Men's Shed", "Walking", "Cricket"], "avatar": "🧓", "bio": "Up at 5, walking by 6.", "points": 31, "badges": ["Friendly Butterfly"]},
    {"first_name": "Dorothy", "username": "dot", "suburb": "Newtown", "interests": ["Crochet", "Trivia", "Pets"], "avatar": "🧶", "bio": "Crochet anything you ask!", "points": 64, "badges": ["Friendly Butterfly", "Helpful Neighbour", "Social Star"]},
    {"first_name": "Arthur", "username": "art", "suburb": "Manly", "interests": ["Gardening", "Birdwatching"], "avatar": "🌳", "bio": "Birds visit my balcony daily.", "points": 22, "badges": ["Friendly Butterfly"]},
    {"first_name": "Eileen", "username": "eil", "suburb": "Sydney CBD", "interests": ["Art", "Coffee", "Travel"], "avatar": "🎨", "bio": "Watercolours and lattes.", "points": 105, "badges": ["Friendly Butterfly", "Helpful Neighbour", "Social Star", "Community Builder"]},
    {"first_name": "Roy", "username": "roy", "suburb": "Parramatta", "interests": ["Cricket", "Trivia", "BBQs"], "avatar": "🏏", "bio": "Trivia king of the neighborhood.", "points": 38, "badges": ["Friendly Butterfly", "Helpful Neighbour"]},
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
            message="wants to chat 🦋",
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
