"""FriendPlace Mini-CMS routes.

Kept in a separate module so `server.py` stays a bit less colossal.
The router is wired into the main `/api` prefix by `server.py` via
`app.include_router(cms_module.router, prefix="/api")`.

Design decisions
────────────────
* **Separate identity from the mobile-app admin (`users.is_admin`)**.
  The CMS admin is a website-specific role stored in the new
  `cms_admins` collection with its own e-mail/password and its own
  JWTs. This keeps the mobile app's user model untouched and lets us
  hand website access to a non-mobile teammate later without also
  granting them mobile-admin powers.
* **First-login bootstrap**: the very first visitor to /admin/setup
  creates the admin. After that the route is permanently locked (per
  Garry's requirement — no hard-coded password).
* **Bearer-token auth** (localStorage on the client) rather than
  cookies. The website (Vercel) and the API (Emergent preview / prod)
  live on different origins, and cross-site cookies are painful in
  2026 browsers. Bearer tokens are the cleanest cross-origin auth for
  a low-risk internal admin tool.
* **Media library abstraction** — every media row has a `provider`
  field so we can migrate to Cloudinary later by swapping the upload
  handler; the public URL stored in the doc keeps every downstream
  reference intact.
"""

from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    Request,
)
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.responses import FileResponse
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field

# ---- Config (env-driven, no hard-coding) ---------------------------------
CMS_JWT_TTL_HOURS = int(os.getenv("CMS_JWT_TTL_HOURS", "12"))
CMS_RESET_TTL_MIN = int(os.getenv("CMS_RESET_TTL_MIN", "30"))
CMS_JWT_ALG = "HS256"

# `CMS_FRONTEND_URL` is the URL used to build reset links sent by email.
# Defaults to the production domain; override in dev/staging via env.
CMS_FRONTEND_URL = os.getenv("CMS_FRONTEND_URL", "https://friendplace.com.au")

# Media library storage — for MVP we use local disk. Files live at
# `/app/backend/uploads/cms/{id}.{ext}` and are served under
# `/api/uploads/cms/…` via StaticFiles mounted in server.py.
UPLOADS_ROOT = Path(__file__).parent / "uploads" / "cms"
UPLOADS_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_MIME_PREFIXES = ("image/",)
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB per file

# Bumped on any release that adds/changes a user-visible CMS surface.
# Surfaced in the Mission Control System Status card.
APP_VERSION = "1.0.0"

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---- Event display helpers (shared by admin + public routers) ----------

def _format_event_when(event: Dict[str, Any]) -> str:
    """Human-friendly Australia-formatted date string.

    Uses the event's own timezone if set; falls back to Australia/Sydney.
    Shared by both the public RSVP flow (confirmation emails) and the
    admin cancel flow (cancellation emails) so date wording never drifts
    between the two surfaces.
    """
    starts_at = event.get("starts_at") or ""
    tz_name = event.get("timezone") or "Australia/Sydney"
    if not starts_at:
        return "Date TBD"
    try:
        dt = datetime.fromisoformat(starts_at.replace("Z", "+00:00"))
    except Exception:
        return starts_at
    try:
        from zoneinfo import ZoneInfo
        dt = dt.astimezone(ZoneInfo(tz_name))
        tz_short = dt.tzname() or ""
    except Exception:
        tz_short = ""
    s = dt.strftime("%a %d/%m/%Y, %I:%M %p")
    s = s.replace(" 0", " ").replace(", 0", ", ")
    if tz_short:
        s = f"{s} {tz_short}"
    return s


def _format_event_where(event: Dict[str, Any]) -> str:
    if event.get("is_online"):
        return event.get("meeting_url") or "Online"
    parts = [event.get("venue_name") or "", event.get("venue_address") or ""]
    return " · ".join(p for p in parts if p) or "Location TBD"


def _short_rsvp_ref(rsvp_id: str) -> str:
    """Compact human-quotable ref like `FP-EV-9B12C4`."""
    return "FP-EV-" + rsvp_id.replace("-", "")[:6].upper()


# ---- Auth helpers --------------------------------------------------------

def _jwt_secret() -> str:
    """Read the shared JWT secret at call time so tests can monkey-patch
    the env before importing this module."""
    return os.environ.get("JWT_SECRET", "")


def _make_admin_token(admin_id: str, email: str, jti: str | None = None) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=CMS_JWT_TTL_HOURS)
    payload = {"sub": admin_id, "email": email, "purpose": "cms_admin", "exp": exp}
    if jti:
        payload["jti"] = jti
    return jwt.encode(payload, _jwt_secret(), algorithm=CMS_JWT_ALG)


def _make_reset_token(admin_id: str, email: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=CMS_RESET_TTL_MIN)
    return jwt.encode(
        {"sub": admin_id, "email": email, "purpose": "cms_reset", "exp": exp},
        _jwt_secret(),
        algorithm=CMS_JWT_ALG,
    )


def _decode(token: str, purpose: str) -> Dict[str, Any]:
    try:
        data = jwt.decode(token, _jwt_secret(), algorithms=[CMS_JWT_ALG])
    except JWTError as e:
        raise HTTPException(401, f"Invalid or expired token: {e}") from e
    if data.get("purpose") != purpose:
        raise HTTPException(401, "Token used for wrong purpose")
    return data


# ---- Pydantic models -----------------------------------------------------

class CmsSetupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    display_name: Optional[str] = None


class CmsLoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class CmsForgotIn(BaseModel):
    email: EmailStr


class CmsResetIn(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=200)


class CmsChangePasswordIn(BaseModel):
    """C1 Account settings — signed-in admin changes their own password."""
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=200)


class CmsAdminCreateIn(BaseModel):
    """C1 Account settings — an existing admin invites another admin.
    We create the row + generate a reset token so the invitee sets
    their own password via `/admin/reset?token=…` (identical flow to
    the "forgot password" wizard). No initial password is stored by
    the inviter, which is safer than sharing one out-of-band.

    `display_name` is required so no admin lands as a bare 'Admin'
    label in the sidebar — we surface warm human names everywhere
    identity is shown."""
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=80)


class CmsMeUpdateIn(BaseModel):
    """Signed-in admin edits their own profile. Right now only
    `display_name` is editable — email requires a separate confirm
    flow we haven't wired yet."""
    display_name: str = Field(min_length=1, max_length=80)


class CmsContentPatch(BaseModel):
    """Loose payload — a partial patch of the site_content document."""
    about: Optional[Dict[str, Any]] = None
    features: Optional[List[Dict[str, Any]]] = None
    faqs: Optional[List[Dict[str, Any]]] = None
    founders: Optional[Dict[str, Any]] = None
    success_stories: Optional[List[Dict[str, Any]]] = None
    download: Optional[Dict[str, Any]] = None
    home: Optional[Dict[str, Any]] = None
    founding_members: Optional[List[Dict[str, Any]]] = None


class SuccessStoryIn(BaseModel):
    """Payload for creating or updating a Success Story.

    Every field is optional on PATCH so partial updates are cheap; on
    POST we accept nothing but title (which auto-fills so new drafts
    are always addressable in the list view).
    """
    title: Optional[str] = None
    body_html: Optional[str] = None
    author_name: Optional[str] = None
    author_role: Optional[str] = None
    author_location: Optional[str] = None
    author_avatar_url: Optional[str] = None
    # `status` = editorial state; `hidden` = visibility override so a
    # published story can be temporarily hidden without demoting it
    # back to draft. Public site shows only status=published & !hidden.
    status: Optional[str] = None  # "draft" | "published"
    hidden: Optional[bool] = None


class SuccessStoriesReorderIn(BaseModel):
    """POST /cms/success-stories/reorder body — new full ordering by id."""
    ids: List[str] = Field(default_factory=list)


class FoundingMemberIn(BaseModel):
    """Payload for creating or updating a Founding Member card.

    All fields optional so the same model serves POST (empty defaults)
    and PATCH (partial updates).
    """
    name: Optional[str] = None
    number: Optional[int] = None
    bio_html: Optional[str] = None
    role: Optional[str] = None
    location: Optional[str] = None
    avatar_url: Optional[str] = None
    status: Optional[str] = None  # "draft" | "published"
    hidden: Optional[bool] = None


class FoundingMembersReorderIn(BaseModel):
    ids: List[str] = Field(default_factory=list)


class EventSponsorIn(BaseModel):
    """One sponsor row inside an event. All fields optional so Garry
    can save partial rows while editing."""
    name: Optional[str] = None
    logo_url: Optional[str] = None
    website_url: Optional[str] = None


class EventIn(BaseModel):
    """Create/update payload for an event. All fields optional so PATCH
    is truly partial."""
    title: Optional[str] = None
    description: Optional[str] = None            # short (~200 char) summary
    body_html: Optional[str] = None              # rich long description
    cover_image_url: Optional[str] = None
    starts_at: Optional[str] = None              # ISO-8601 datetime
    ends_at: Optional[str] = None
    timezone: Optional[str] = None
    is_online: Optional[bool] = None
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    venue_url: Optional[str] = None
    meeting_url: Optional[str] = None
    capacity: Optional[int] = None               # null = unlimited
    rsvp_deadline_at: Optional[str] = None
    cost_type: Optional[str] = None              # "free" | "paid"
    cost_display: Optional[str] = None           # e.g. "Free", "$15 pp", "Gold coin"
    organiser_name: Optional[str] = None
    organiser_contact: Optional[str] = None
    accessibility_info: Optional[str] = None
    sponsors: Optional[List[EventSponsorIn]] = None
    status: Optional[str] = None                 # "draft" | "published"
    hidden: Optional[bool] = None


class EventsReorderIn(BaseModel):
    ids: List[str] = Field(default_factory=list)


class EventRsvpIn(BaseModel):
    """Admin path for adding/editing an RSVP row."""
    name: Optional[str] = None
    email: Optional[str] = None
    user_id: Optional[str] = None
    guests_count: Optional[int] = None
    note: Optional[str] = None
    status: Optional[str] = None                 # "going" | "waitlist" | "cancelled"


class PublicRsvpIn(BaseModel):
    """Payload for public RSVPs (marketing website form + mobile app).

    Kept separate from the admin `EventRsvpIn` so the public form
    can validate `name` + `email` as required — the admin path
    treats every field as optional (partial edits).

    `user_id` is optional: the mobile app sends the logged-in user's
    id so their RSVPs are linked to their account (enabling the
    "My upcoming events" list). Anonymous website RSVPs leave it null.
    """
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    guests_count: Optional[int] = 0
    note: Optional[str] = None
    user_id: Optional[str] = None


class CancelEventIn(BaseModel):
    """Payload for admin-triggered event cancellation.

    Only optional field: a short reason string that gets rendered
    inside the outbound cancellation email so attendees know why.
    """
    reason: Optional[str] = None


class EventSubmissionIn(BaseModel):
    """Public "List your event" submission from the website.

    Draft-first: every submission lands in `cms_event_submissions`
    with status='pending' for admin review before it becomes a live
    `cms_events` row. Keeps FriendPlace safe from spam / fake / off-
    brand listings without slowing down legitimate clubs.
    """
    organisation_name: str = Field(min_length=2, max_length=120)
    contact_name: str = Field(min_length=2, max_length=120)
    contact_email: EmailStr
    contact_phone: Optional[str] = Field(default=None, max_length=40)
    event_title: str = Field(min_length=2, max_length=140)
    event_starts_at: str = Field(min_length=1)   # ISO datetime string
    event_ends_at: Optional[str] = None
    venue_name: Optional[str] = Field(default=None, max_length=140)
    venue_address: Optional[str] = Field(default=None, max_length=240)
    description: Optional[str] = Field(default=None, max_length=4000)
    capacity: Optional[int] = None
    cost_type: Optional[str] = Field(default="free")   # free | paid
    cost_display: Optional[str] = Field(default=None, max_length=80)
    accessibility_info: Optional[str] = Field(default=None, max_length=1000)
    cover_image_base64: Optional[str] = None           # optional data-URL
    agreed_to_review: bool = False


# ---- Router factory ------------------------------------------------------

def build_router(db) -> APIRouter:
    """Build the CMS router bound to the given Motor database handle.

    We inject `db` instead of importing from server.py to avoid a
    circular import (server.py imports and mounts this router).
    """
    router = APIRouter(prefix="/cms", tags=["cms"])

    # ---------------- Auth dependency ---------------------------------

    async def current_cms_admin(
        creds: HTTPAuthorizationCredentials = Depends(bearer),
    ) -> Dict[str, Any]:
        if not creds or not creds.credentials:
            raise HTTPException(401, "Not authenticated")
        payload = _decode(creds.credentials, "cms_admin")
        admin = await db.cms_admins.find_one(
            {"id": payload["sub"]}, {"_id": 0, "password_hash": 0}
        )
        if not admin:
            raise HTTPException(401, "Admin no longer exists")
        # Slice 0.5 — revocation gate via admin_sessions.jti
        try:
            from services import security as _sec
            if not await _sec.session_is_valid(db, payload.get("jti")):
                raise HTTPException(401, "Session revoked")
        except HTTPException:
            raise
        except Exception:
            pass  # never block auth on optional dep failure
        return admin

    # ============================================================
    # AUTHENTICATION
    # ============================================================

    @router.get("/auth/setup-required")
    async def setup_required():
        """Front-door check the login page hits to decide whether to
        show the setup wizard or the standard login form.
        """
        n = await db.cms_admins.count_documents({})
        return {"setup_required": n == 0}

    @router.post("/auth/setup")
    async def setup(body: CmsSetupIn):
        """Create the very first admin. Locked after first success."""
        n = await db.cms_admins.count_documents({})
        if n > 0:
            raise HTTPException(403, "Setup already completed. Use the login page.")

        admin_id = str(uuid.uuid4())
        doc = {
            "id": admin_id,
            "email": str(body.email).lower().strip(),
            "display_name": (body.display_name or "").strip() or "Admin",
            "password_hash": pwd_ctx.hash(body.password),
            "created_at": _now_iso(),
            "last_login_at": None,
        }
        await db.cms_admins.insert_one(dict(doc))
        token = _make_admin_token(admin_id, doc["email"])
        return {
            "ok": True,
            "token": token,
            "admin": {
                "id": admin_id,
                "email": doc["email"],
                "display_name": doc["display_name"],
            },
        }

    @router.post("/auth/login")
    async def login(body: CmsLoginIn, request: Request):
        from services import security as _sec
        email = _sec.normalise_email(body.email)
        ip = _sec.client_ip_from_headers(dict(request.headers), fallback=(request.client.host if request.client else "unknown"))
        ua_raw = request.headers.get("user-agent", "")
        ua = _sec.parse_user_agent(ua_raw)
        geo = _sec.geo_lookup(ip)

        # Tier 2 gate — is source currently locked?
        for scope, key in (("email", email), ("ip", ip)):
            locked = await _sec.is_locked(db, scope, key)
            if locked:
                await _sec.log_event(
                    db, outcome="lockout_hit", email=email, ip=ip,
                    user_agent=ua_raw, ua=ua, geo=geo,
                    locked_until=locked.get("locked_until"),
                )
                await _sec.check_mass_attack(db)
                raise HTTPException(
                    429, "Too many attempts. Try again shortly.",
                    headers={"Retry-After": str(_sec.LOCKOUT_MINUTES * 60)},
                )

        admin = await db.cms_admins.find_one({"email": email})
        ok = bool(admin) and pwd_ctx.verify(body.password, admin.get("password_hash", "") if admin else "")

        if not ok:
            email_state = await _sec.bump_attempt(db, "email", email)
            ip_state = await _sec.bump_attempt(db, "ip", ip)
            count = max(int(email_state.get("fail_count", 1)), int(ip_state.get("fail_count", 1)))

            # Tier 1 — send alert once per window (either counter triggers)
            already_alerted = email_state.get("alert_sent_at") or ip_state.get("alert_sent_at")
            if count >= _sec.ALERT_AFTER and not already_alerted:
                await _sec.send_alert_email(
                    email=email, ip=ip, ua=ua, geo=geo,
                    count=count, locked=False, urgent=False,
                )
                try:
                    await db.admin_login_attempts.update_many(
                        {"scope": {"$in": ["email", "ip"]},
                         "key": {"$in": [email, ip]}},
                        {"$set": {"alert_sent_at": _sec._now()}},
                    )
                except Exception:
                    pass

            # Tier 2 — lockout
            locked_flag = False
            if count >= _sec.LOCKOUT_AFTER:
                locked_until = await _sec.create_lockout(db, "email", email, "bruteforce")
                await _sec.create_lockout(db, "ip", ip, "bruteforce")
                locked_flag = True
                await _sec.log_event(
                    db, outcome="lockout_created", email=email, ip=ip,
                    user_agent=ua_raw, ua=ua, geo=geo,
                    attempt_count=count, locked_until=locked_until,
                )
                await _sec.check_mass_attack(db)
                raise HTTPException(
                    429, "Too many attempts. Try again shortly.",
                    headers={"Retry-After": str(_sec.LOCKOUT_MINUTES * 60)},
                )

            await _sec.log_event(
                db, outcome="fail", email=email, ip=ip,
                user_agent=ua_raw, ua=ua, geo=geo, attempt_count=count,
            )
            await _sec.check_mass_attack(db)
            # Same generic message → no user enumeration.
            raise HTTPException(401, "Invalid email or password")

        # ─── Success ────────────────────────────────────────────────
        await _sec.reset_counters(db, email, ip)
        jti = await _sec.create_session(
            db, admin_id=admin["id"], email=admin["email"],
            ip=ip, user_agent=ua_raw, geo=geo, ttl_hours=8,
        )
        token = _make_admin_token(admin["id"], admin["email"], jti=jti)
        await db.cms_admins.update_one(
            {"id": admin["id"]}, {"$set": {"last_login_at": _now_iso()}}
        )
        await _sec.log_event(
            db, outcome="success", email=email, ip=ip,
            user_agent=ua_raw, ua=ua, geo=geo, jti=jti,
            admin_id=admin["id"],
        )
        return {
            "ok": True,
            "token": token,
            "admin": {
                "id": admin["id"],
                "email": admin["email"],
                "display_name": admin.get("display_name") or "Admin",
            },
        }

    @router.get("/auth/me")
    async def me(admin: dict = Depends(current_cms_admin)):
        return {
            "id": admin["id"],
            "email": admin["email"],
            "display_name": admin.get("display_name") or "Admin",
            "last_login_at": admin.get("last_login_at"),
        }

    @router.patch("/auth/me")
    async def update_me(
        body: CmsMeUpdateIn,
        admin: dict = Depends(current_cms_admin),
    ):
        """Signed-in admin updates their own display name. We keep the
        payload deliberately narrow (only `display_name` today) so this
        endpoint doesn't grow into a Swiss-army knife."""
        new_name = body.display_name.strip()
        if not new_name:
            raise HTTPException(400, "Display name can\u2019t be empty.")
        await db.cms_admins.update_one(
            {"id": admin["id"]},
            {"$set": {"display_name": new_name}},
        )
        return {
            "ok": True,
            "admin": {
                "id": admin["id"],
                "email": admin["email"],
                "display_name": new_name,
                "last_login_at": admin.get("last_login_at"),
            },
        }

    @router.post("/auth/forgot")
    async def forgot(body: CmsForgotIn):
        """Request a password-reset email. Always returns 200 (no
        enumeration) — the caller can't tell whether the email exists."""
        email = str(body.email).lower().strip()
        admin = await db.cms_admins.find_one({"email": email})
        if admin:
            token = _make_reset_token(admin["id"], admin["email"])
            reset_url = f"{CMS_FRONTEND_URL}/admin/reset?token={token}"
            # Send email — imported lazily so tests without email
            # deps still import the module.
            try:
                from email_service import send_email  # noqa: WPS433 (lazy)
                html = (
                    f"<p>Hi,</p>"
                    f"<p>Someone (hopefully you) asked to reset the FriendPlace "
                    f"Mini-CMS admin password.</p>"
                    f"<p><a href='{reset_url}' style='background:#0A2540;color:#fff;"
                    f"padding:12px 20px;border-radius:12px;text-decoration:none;"
                    f"font-weight:700;'>Reset password</a></p>"
                    f"<p style='color:#64748B;font-size:13px'>Or paste this link into "
                    f"your browser:<br><code>{reset_url}</code></p>"
                    f"<p style='color:#64748B;font-size:13px'>This link expires in "
                    f"{CMS_RESET_TTL_MIN} minutes. If you didn't request a reset, "
                    f"you can safely ignore this email.</p>"
                )
                await send_email(
                    to=email,
                    subject="FriendPlace Admin — reset your password",
                    html=html,
                    text=f"Reset your FriendPlace admin password: {reset_url}",
                )
            except Exception:
                # Don't leak whether email delivery failed.
                pass
        return {"ok": True}

    @router.post("/auth/reset")
    async def reset(body: CmsResetIn):
        payload = _decode(body.token, "cms_reset")
        admin = await db.cms_admins.find_one({"id": payload["sub"]})
        if not admin:
            raise HTTPException(400, "Invalid reset token")
        await db.cms_admins.update_one(
            {"id": admin["id"]},
            {"$set": {"password_hash": pwd_ctx.hash(body.new_password)}},
        )
        # Return a fresh access token so the user can go straight into
        # the CMS after reset — better UX than "now please log in".
        token = _make_admin_token(admin["id"], admin["email"])
        return {"ok": True, "token": token}

    # ============================================================
    # ACCOUNT — signed-in admin changes own password + manages peers
    # ============================================================

    @router.post("/auth/change-password")
    async def change_password(
        body: CmsChangePasswordIn,
        admin: dict = Depends(current_cms_admin),
    ):
        """Signed-in admin rotates their own password. Verifies the
        current password (defence against a stolen session), hashes
        the new one, and returns a fresh access token so the frontend
        can silently continue without a full re-login."""
        current_hash = admin.get("password_hash") or ""
        # We fetch a fresh doc — `current_cms_admin` strips `password_hash`
        # for safety, so `admin["password_hash"]` won't be present here.
        fresh = await db.cms_admins.find_one({"id": admin["id"]})
        if not fresh or not pwd_ctx.verify(body.current_password, fresh.get("password_hash", "")):
            raise HTTPException(401, "Current password is incorrect")
        if pwd_ctx.verify(body.new_password, fresh.get("password_hash", "")):
            raise HTTPException(400, "New password must be different from your current one")
        await db.cms_admins.update_one(
            {"id": admin["id"]},
            {"$set": {"password_hash": pwd_ctx.hash(body.new_password)}},
        )
        # Rotate the token so the client stays signed in seamlessly.
        token = _make_admin_token(admin["id"], admin["email"])
        return {"ok": True, "token": token}

    @router.get("/admins")
    async def list_admins(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """List every CMS admin (id, email, display_name, timestamps).
        All admins are equal — anyone signed in can see the full list.
        Password hashes are never returned."""
        cursor = db.cms_admins.find(
            {},
            {"_id": 0, "password_hash": 0},
        ).sort("created_at", 1)
        items = [row async for row in cursor]
        return {"items": items, "count": len(items)}

    @router.post("/admins")
    async def create_admin(
        body: CmsAdminCreateIn,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Invite another admin. Creates the row with an *unusable*
        password placeholder and returns a reset link the invitee uses
        to set their own password (identical flow to /auth/reset).

        The frontend surfaces the link so the inviter can share it via
        their own channel (Slack, SMS, email) — a proper email-provider
        wiring will send it automatically later.
        """
        email = str(body.email).lower().strip()
        existing = await db.cms_admins.find_one({"email": email})
        if existing:
            raise HTTPException(400, "An admin with this email already exists.")
        admin_id = str(uuid.uuid4())
        # Placeholder hash of a random unusable secret. The invitee must
        # go through the reset flow to set a real password — this row
        # cannot log in until they do.
        placeholder = uuid.uuid4().hex + uuid.uuid4().hex
        doc = {
            "id": admin_id,
            "email": email,
            "display_name": body.display_name.strip(),
            "password_hash": pwd_ctx.hash(placeholder),
            "created_at": _now_iso(),
            "last_login_at": None,
        }
        await db.cms_admins.insert_one(dict(doc))
        # Build a reset link the inviter can hand to the new admin.
        reset_token = _make_reset_token(admin_id, email)
        reset_url = f"{CMS_FRONTEND_URL}/admin/reset?token={reset_token}"
        # Best-effort email delivery — mirrors the /auth/forgot flow so
        # both paths behave identically. If it fails we still return
        # the link so the inviter can share it manually.
        try:
            from email_service import send_email  # noqa: WPS433 (lazy)
            html = (
                f"<p>Hi,</p>"
                f"<p>You\u2019ve been invited as a FriendPlace Mini-CMS admin.</p>"
                f"<p><a href='{reset_url}' style='background:#0A2540;color:#fff;"
                f"padding:12px 20px;border-radius:12px;text-decoration:none;"
                f"font-weight:700;'>Set your password</a></p>"
                f"<p style='color:#64748B;font-size:13px'>Or paste this link into "
                f"your browser:<br><code>{reset_url}</code></p>"
                f"<p style='color:#64748B;font-size:13px'>This link expires in "
                f"{CMS_RESET_TTL_MIN} minutes.</p>"
            )
            await send_email(
                to=email,
                subject="You\u2019ve been invited to FriendPlace Mission Control",
                html=html,
                text=f"Set your FriendPlace admin password: {reset_url}",
            )
        except Exception:
            # Best-effort: fail silently, the inviter still gets the link.
            pass
        return {
            "ok": True,
            "admin": {
                "id": admin_id,
                "email": email,
                "display_name": doc["display_name"],
                "created_at": doc["created_at"],
                "last_login_at": None,
            },
            "invite_url": reset_url,
            "expires_in_minutes": CMS_RESET_TTL_MIN,
        }

    @router.delete("/admins/{target_id}")
    async def delete_admin(
        target_id: str,
        admin: dict = Depends(current_cms_admin),
    ):
        """Delete another admin. Guardrails:
        - You cannot delete yourself.
        - You cannot delete the last remaining admin (would lock everyone
          out of the CMS).
        """
        if target_id == admin["id"]:
            raise HTTPException(400, "You can\u2019t delete your own account here.")
        target = await db.cms_admins.find_one({"id": target_id})
        if not target:
            raise HTTPException(404, "Admin not found.")
        total = await db.cms_admins.count_documents({})
        if total <= 1:
            raise HTTPException(400, "At least one admin must remain.")
        await db.cms_admins.delete_one({"id": target_id})
        return {"ok": True}


    # ============================================================
    # CONTENT
    # ============================================================

    @router.get("/content")
    async def get_content(admin: dict = Depends(current_cms_admin)):
        """Returns the full site_content document for editing."""
        doc = await db.site_content.find_one({"key": "main"}, {"_id": 0})
        if not doc:
            # Seed from defaults so the editor never starts blank.
            from server import _DEFAULT_SITE_CONTENT  # noqa: WPS433 (lazy)
            doc = {"key": "main", **_DEFAULT_SITE_CONTENT, "updated_at": _now_iso()}
            await db.site_content.insert_one(dict(doc))
        doc.pop("key", None)
        return doc

    # ------------------------------------------------------------------
    # DASHBOARD STATS
    # ------------------------------------------------------------------
    # Powers the Mission Control summary cards. Kept as a single call so
    # the dashboard renders in one round-trip and doesn't fan out to five
    # separate endpoints.

    @router.get("/stats")
    async def dashboard_stats(admin: dict = Depends(current_cms_admin)):
        content = await db.site_content.find_one({"key": "main"}, {"_id": 0}) or {}
        try:
            media_count = await db.cms_media.count_documents({})
        except Exception:
            media_count = 0
        try:
            founder_count = await db.users.count_documents(
                {"is_founder": True, "is_demo": {"$ne": True}}
            )
        except Exception:
            founder_count = 0
        try:
            success_stories_count = await db.cms_success_stories.count_documents({})
        except Exception:
            success_stories_count = 0
        try:
            founding_members_editable_count = await db.cms_founding_members.count_documents({})
        except Exception:
            founding_members_editable_count = 0
        try:
            # Count events that are still in the future (published+visible only).
            events_upcoming = await db.cms_events.count_documents({
                "status": "published",
                "hidden": {"$ne": True},
                "starts_at": {"$gte": _now_iso()},
            })
        except Exception:
            events_upcoming = 0
        try:
            events_all = await db.cms_events.count_documents({})
        except Exception:
            events_all = 0
        # `pages_count` is fixed today — Home / About / FAQs / Founders.
        # Grows automatically as new CMS-editable pages come online.
        pages_count = 4
        indexable = os.getenv("FRIENDPLACE_INDEXABLE", "false").lower() == "true"
        maintenance = os.getenv("FRIENDPLACE_MAINTENANCE", "false").lower() == "true"
        if maintenance:
            status = {"label": "Maintenance", "color": "red", "dot": "🔴"}
        elif indexable:
            status = {"label": "Live", "color": "green", "dot": "🟢"}
        else:
            status = {"label": "Private (No Index)", "color": "amber", "dot": "🟠"}

        # Live system-health signals for the expanded System Status card.
        # If we can hit this route the API is up by definition; the DB
        # ping tells us whether Mongo is reachable *right now*.
        db_ok = True
        try:
            await db.command("ping")
        except Exception:
            db_ok = False

        return {
            "pages_count": pages_count,
            "media_count": int(media_count),
            "faqs_count": len(content.get("faqs") or []),
            "success_stories_count": int(success_stories_count),
            "founding_members_count_editable": int(founding_members_editable_count),
            "events_count": int(events_all),
            "events_upcoming_count": int(events_upcoming),
            "founder_signups_count": int(founder_count),
            "status": status,
            "updated_at": content.get("updated_at"),
            # ── System Status panel ─────────────────────────────────
            "system": {
                "website": status,
                "api": {"ok": True, "label": "Online"},
                "database": {"ok": db_ok, "label": "Connected" if db_ok else "Disconnected"},
                "last_publish_at": content.get("updated_at"),
                "app_version": APP_VERSION,
            },
        }

    @router.patch("/content")
    async def patch_content(
        patch: CmsContentPatch,
        admin: dict = Depends(current_cms_admin),
    ):
        """Merges the provided fields into the site_content doc.

        Only known top-level fields are updated (defensive against a
        stray key being persisted). `updated_at` is stamped every time.
        """
        update: Dict[str, Any] = {"updated_at": _now_iso()}
        for field in (
            "about",
            "features",
            "faqs",
            "founders",
            "success_stories",
            "download",
            "home",
            "founding_members",
        ):
            val = getattr(patch, field)
            if val is not None:
                update[field] = val
        # If the doc doesn't exist yet, upsert so the first save works.
        await db.site_content.update_one(
            {"key": "main"},
            {"$set": update, "$setOnInsert": {"key": "main"}},
            upsert=True,
        )
        doc = await db.site_content.find_one({"key": "main"}, {"_id": 0})
        if doc:
            doc.pop("key", None)
        return doc or {}

    # ============================================================
    # SUCCESS STORIES
    # ============================================================
    # Dedicated collection so each story has its own id, timestamps,
    # ordering, and editorial state. Public site consumes only
    # published & non-hidden rows via /api/public/stories.

    async def _load_stories(only_public: bool = False) -> List[Dict[str, Any]]:
        q: Dict[str, Any] = {}
        if only_public:
            q = {"status": "published", "hidden": {"$ne": True}}
        cur = db.cms_success_stories.find(q, {"_id": 0}).sort([("order", 1), ("created_at", -1)])
        return await cur.to_list(length=None)

    @router.get("/success-stories")
    async def list_stories(admin: dict = Depends(current_cms_admin)):
        """Admin list — includes drafts and hidden stories."""
        items = await _load_stories(only_public=False)
        return {"items": items, "count": len(items)}

    @router.post("/success-stories")
    async def create_story(
        body: Optional[SuccessStoryIn] = None,
        admin: dict = Depends(current_cms_admin),
    ):
        # New drafts get a placeholder title so the list view has
        # something to click on — Garry can edit it immediately.
        try:
            existing = await db.cms_success_stories.count_documents({})
        except Exception:
            existing = 0
        story_id = str(uuid.uuid4())
        now = _now_iso()
        doc: Dict[str, Any] = {
            "id": story_id,
            "title": (body.title if body and body.title else "Untitled story"),
            "body_html": (body.body_html if body else "") or "",
            "author_name": (body.author_name if body else "") or "",
            "author_role": (body.author_role if body else "") or "",
            "author_location": (body.author_location if body else "") or "",
            "author_avatar_url": (body.author_avatar_url if body else "") or "",
            "status": (body.status if body and body.status else "draft"),
            "hidden": bool(body.hidden) if body and body.hidden is not None else False,
            "order": int(existing),  # append at end
            "created_at": now,
            "updated_at": now,
            "created_by": admin.get("email"),
        }
        await db.cms_success_stories.insert_one(dict(doc))
        return doc

    @router.get("/success-stories/{story_id}")
    async def get_story(
        story_id: str,
        admin: dict = Depends(current_cms_admin),
    ):
        doc = await db.cms_success_stories.find_one({"id": story_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Story not found")
        return doc

    @router.patch("/success-stories/{story_id}")
    async def patch_story(
        story_id: str,
        body: SuccessStoryIn,
        admin: dict = Depends(current_cms_admin),
    ):
        update: Dict[str, Any] = {"updated_at": _now_iso()}
        # Only include explicitly-supplied fields so PATCH remains partial.
        for field in (
            "title", "body_html", "author_name", "author_role",
            "author_location", "author_avatar_url", "status", "hidden",
        ):
            val = getattr(body, field)
            if val is not None:
                update[field] = val
        if "status" in update and update["status"] not in ("draft", "published", "cancelled"):
            raise HTTPException(400, "status must be 'draft', 'published' or 'cancelled'")
        res = await db.cms_success_stories.update_one({"id": story_id}, {"$set": update})
        if res.matched_count == 0:
            raise HTTPException(404, "Story not found")
        doc = await db.cms_success_stories.find_one({"id": story_id}, {"_id": 0})
        return doc

    @router.delete("/success-stories/{story_id}")
    async def delete_story(
        story_id: str,
        admin: dict = Depends(current_cms_admin),
    ):
        res = await db.cms_success_stories.delete_one({"id": story_id})
        if res.deleted_count == 0:
            raise HTTPException(404, "Story not found")
        return {"ok": True}

    @router.post("/success-stories/reorder")
    async def reorder_stories(
        body: SuccessStoriesReorderIn,
        admin: dict = Depends(current_cms_admin),
    ):
        """Bulk reorder — client sends the full desired ordering by id."""
        for idx, story_id in enumerate(body.ids):
            await db.cms_success_stories.update_one(
                {"id": story_id}, {"$set": {"order": idx, "updated_at": _now_iso()}}
            )
        items = await _load_stories(only_public=False)
        return {"items": items, "count": len(items)}


    # ============================================================
    # FOUNDING MEMBERS
    # ============================================================
    # Dedicated collection so each showcased founding member has its
    # own id, member number, timestamps and ordering. Public site
    # renders only published & non-hidden rows via /api/public/founders.

    async def _load_founding_members(only_public: bool = False) -> List[Dict[str, Any]]:
        q: Dict[str, Any] = {}
        if only_public:
            q = {"status": "published", "hidden": {"$ne": True}}
        cur = db.cms_founding_members.find(q, {"_id": 0}).sort([("order", 1), ("number", 1)])
        return await cur.to_list(length=None)

    async def _next_founding_number() -> int:
        """Auto-suggest the next member number so new drafts don't
        clash. If numbers get sparse (someone deletes #4) we still just
        pick MAX+1; Garry can override in the editor."""
        try:
            cur = db.cms_founding_members.find({}, {"_id": 0, "number": 1}).sort("number", -1).limit(1)
            docs = await cur.to_list(length=1)
            if docs and isinstance(docs[0].get("number"), int):
                return int(docs[0]["number"]) + 1
        except Exception:
            pass
        return 1

    @router.get("/founding-members")
    async def list_founding_members(admin: dict = Depends(current_cms_admin)):
        items = await _load_founding_members(only_public=False)
        return {"items": items, "count": len(items)}

    @router.post("/founding-members")
    async def create_founding_member(
        body: Optional[FoundingMemberIn] = None,
        admin: dict = Depends(current_cms_admin),
    ):
        try:
            existing = await db.cms_founding_members.count_documents({})
        except Exception:
            existing = 0
        member_id = str(uuid.uuid4())
        now = _now_iso()
        # Number defaults to next-available; Garry can change it later.
        next_num = await _next_founding_number()
        doc: Dict[str, Any] = {
            "id": member_id,
            "name": (body.name if body and body.name else ""),
            "number": (body.number if body and body.number is not None else next_num),
            "bio_html": (body.bio_html if body else "") or "",
            "role": (body.role if body else "") or "",
            "location": (body.location if body else "") or "",
            "avatar_url": (body.avatar_url if body else "") or "",
            "status": (body.status if body and body.status else "draft"),
            "hidden": bool(body.hidden) if body and body.hidden is not None else False,
            "order": int(existing),
            "created_at": now,
            "updated_at": now,
            "created_by": admin.get("email"),
        }
        await db.cms_founding_members.insert_one(dict(doc))
        return doc

    @router.get("/founding-members/{member_id}")
    async def get_founding_member(
        member_id: str,
        admin: dict = Depends(current_cms_admin),
    ):
        doc = await db.cms_founding_members.find_one({"id": member_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Member not found")
        return doc

    @router.patch("/founding-members/{member_id}")
    async def patch_founding_member(
        member_id: str,
        body: FoundingMemberIn,
        admin: dict = Depends(current_cms_admin),
    ):
        update: Dict[str, Any] = {"updated_at": _now_iso()}
        for field in ("name", "number", "bio_html", "role", "location",
                      "avatar_url", "status", "hidden"):
            val = getattr(body, field)
            if val is not None:
                update[field] = val
        if "status" in update and update["status"] not in ("draft", "published", "cancelled"):
            raise HTTPException(400, "status must be 'draft', 'published' or 'cancelled'")
        # Belt-and-braces: never let a published founding member exist
        # with number < 1, regardless of what the client sent.
        if update.get("status") == "published":
            current = await db.cms_founding_members.find_one({"id": member_id}, {"_id": 0}) or {}
            effective_number = update.get("number", current.get("number"))
            if not isinstance(effective_number, int) or effective_number < 1:
                raise HTTPException(400, "Add a member number of 1 or higher before publishing")
        res = await db.cms_founding_members.update_one({"id": member_id}, {"$set": update})
        if res.matched_count == 0:
            raise HTTPException(404, "Member not found")
        doc = await db.cms_founding_members.find_one({"id": member_id}, {"_id": 0})
        return doc

    @router.delete("/founding-members/{member_id}")
    async def delete_founding_member(
        member_id: str,
        admin: dict = Depends(current_cms_admin),
    ):
        res = await db.cms_founding_members.delete_one({"id": member_id})
        if res.deleted_count == 0:
            raise HTTPException(404, "Member not found")
        return {"ok": True}

    @router.post("/founding-members/reorder")
    async def reorder_founding_members(
        body: FoundingMembersReorderIn,
        admin: dict = Depends(current_cms_admin),
    ):
        for idx, member_id in enumerate(body.ids):
            await db.cms_founding_members.update_one(
                {"id": member_id}, {"$set": {"order": idx, "updated_at": _now_iso()}}
            )
        items = await _load_founding_members(only_public=False)
        return {"items": items, "count": len(items)}


    # ============================================================
    # EVENTS
    # ============================================================
    # `cms_events` — full event record with sponsors embedded.
    # `event_rsvps` — one row per RSVP with waitlist status.
    # Slugs are auto-generated from the title, dedup with numeric suffix.

    def _slugify(title: str) -> str:
        base = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")
        return base or "event"

    async def _unique_slug(title: str, ignore_id: Optional[str] = None) -> str:
        base = _slugify(title)
        candidate = base
        i = 1
        while True:
            q: Dict[str, Any] = {"slug": candidate}
            if ignore_id:
                q["id"] = {"$ne": ignore_id}
            exists = await db.cms_events.find_one(q, {"_id": 0, "id": 1})
            if not exists:
                return candidate
            i += 1
            candidate = f"{base}-{i}"

    async def _rsvp_counts_for(event_id: str) -> Dict[str, int]:
        going = await db.event_rsvps.count_documents(
            {"event_id": event_id, "status": "going"}
        )
        waitlist = await db.event_rsvps.count_documents(
            {"event_id": event_id, "status": "waitlist"}
        )
        return {"going": int(going), "waitlist": int(waitlist)}

    async def _load_events(only_public: bool = False) -> List[Dict[str, Any]]:
        q: Dict[str, Any] = {}
        if only_public:
            q = {"status": "published", "hidden": {"$ne": True}}
        cur = db.cms_events.find(q, {"_id": 0}).sort([("starts_at", 1), ("created_at", 1)])
        events = await cur.to_list(length=None)
        # Enrich each event with live RSVP counts so the list view can
        # show "12/40" without a second round-trip per row.
        for ev in events:
            ev["rsvp_counts"] = await _rsvp_counts_for(ev["id"])
        return events

    @router.get("/events")
    async def list_events(admin: dict = Depends(current_cms_admin)):
        items = await _load_events(only_public=False)
        return {"items": items, "count": len(items)}

    @router.post("/events")
    async def create_event(
        body: Optional[EventIn] = None,
        admin: dict = Depends(current_cms_admin),
    ):
        event_id = str(uuid.uuid4())
        now = _now_iso()
        title = (body.title if body and body.title else "New event")
        slug = await _unique_slug(title)
        doc: Dict[str, Any] = {
            "id": event_id,
            "slug": slug,
            "title": title,
            "description": (body.description if body else "") or "",
            "body_html": (body.body_html if body else "") or "",
            "cover_image_url": (body.cover_image_url if body else "") or "",
            "starts_at": (body.starts_at if body else "") or "",
            "ends_at": (body.ends_at if body else "") or "",
            "timezone": (body.timezone if body and body.timezone else "Australia/Sydney"),
            "is_online": bool(body.is_online) if body and body.is_online is not None else False,
            "venue_name": (body.venue_name if body else "") or "",
            "venue_address": (body.venue_address if body else "") or "",
            "venue_url": (body.venue_url if body else "") or "",
            "meeting_url": (body.meeting_url if body else "") or "",
            "capacity": (body.capacity if body and body.capacity is not None else None),
            "rsvp_deadline_at": (body.rsvp_deadline_at if body else "") or "",
            "cost_type": (body.cost_type if body and body.cost_type else "free"),
            "cost_display": (body.cost_display if body else "") or "Free",
            "organiser_name": (body.organiser_name if body else "") or "",
            "organiser_contact": (body.organiser_contact if body else "") or "",
            "accessibility_info": (body.accessibility_info if body else "") or "",
            "sponsors": [dict(s) for s in (body.sponsors if body and body.sponsors else [])],
            "status": (body.status if body and body.status else "draft"),
            "hidden": bool(body.hidden) if body and body.hidden is not None else False,
            "created_at": now,
            "updated_at": now,
            "created_by": admin.get("email"),
        }
        await db.cms_events.insert_one(dict(doc))
        doc["rsvp_counts"] = {"going": 0, "waitlist": 0}
        return doc

    @router.get("/events/{event_id}")
    async def get_event(
        event_id: str,
        admin: dict = Depends(current_cms_admin),
    ):
        doc = await db.cms_events.find_one({"id": event_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Event not found")
        doc["rsvp_counts"] = await _rsvp_counts_for(event_id)
        return doc

    @router.patch("/events/{event_id}")
    async def patch_event(
        event_id: str,
        body: EventIn,
        admin: dict = Depends(current_cms_admin),
    ):
        update: Dict[str, Any] = {"updated_at": _now_iso()}
        # Only take fields explicitly sent so PATCH is truly partial.
        simple_fields = (
            "description", "body_html", "cover_image_url",
            "starts_at", "ends_at", "timezone", "is_online",
            "venue_name", "venue_address", "venue_url", "meeting_url",
            "capacity", "rsvp_deadline_at", "cost_type", "cost_display",
            "organiser_name", "organiser_contact", "accessibility_info",
            "status", "hidden",
        )
        for field in simple_fields:
            val = getattr(body, field)
            if val is not None:
                update[field] = val
        if body.sponsors is not None:
            update["sponsors"] = [dict(s) for s in body.sponsors]
        # If title changed, regenerate slug (unique within collection).
        if body.title is not None:
            update["title"] = body.title
            update["slug"] = await _unique_slug(body.title, ignore_id=event_id)
        # Belt-and-braces: never let a published event exist without a title.
        if update.get("status") == "published":
            current = await db.cms_events.find_one({"id": event_id}, {"_id": 0}) or {}
            title = update.get("title", current.get("title"))
            starts = update.get("starts_at", current.get("starts_at"))
            if not (title or "").strip():
                raise HTTPException(400, "Add a title before publishing")
            if not (starts or "").strip():
                raise HTTPException(400, "Add a start date/time before publishing")
        if "status" in update and update["status"] not in ("draft", "published", "cancelled"):
            raise HTTPException(400, "status must be 'draft', 'published' or 'cancelled'")

        res = await db.cms_events.update_one({"id": event_id}, {"$set": update})
        if res.matched_count == 0:
            raise HTTPException(404, "Event not found")
        doc = await db.cms_events.find_one({"id": event_id}, {"_id": 0})
        if doc:
            doc["rsvp_counts"] = await _rsvp_counts_for(event_id)
        return doc

    @router.delete("/events/{event_id}")
    async def delete_event(
        event_id: str,
        admin: dict = Depends(current_cms_admin),
    ):
        res = await db.cms_events.delete_one({"id": event_id})
        if res.deleted_count == 0:
            raise HTTPException(404, "Event not found")
        # Cascade RSVPs — nobody wants orphans in the roster query.
        await db.event_rsvps.delete_many({"event_id": event_id})
        return {"ok": True}

    @router.post("/events/{event_id}/cancel")
    async def cancel_event(
        event_id: str,
        body: Optional[CancelEventIn] = None,
        admin: dict = Depends(current_cms_admin),
    ):
        """Admin-triggered cancellation.

        Design:
          - Sets `status='cancelled'` on the event (kept, not deleted,
            so the public page can render a "This event has been
            cancelled" banner and existing links don't 404).
          - Fans out branded cancellation emails via Resend to every
            attendee whose RSVP is still `going` or `waitlist`.
          - Attaches a `METHOD:CANCEL` ICS so Apple/Google/Outlook
            calendars auto-strike the entry and pull reminders.
          - All emails are best-effort — the DB flip is the source
            of truth. The response returns how many mails we
            attempted so Mission Control can show "Emailed N
            attendees" toast.
        """
        event = await db.cms_events.find_one({"id": event_id}, {"_id": 0})
        if not event:
            raise HTTPException(404, "Event not found")
        if event.get("status") == "cancelled":
            return {"ok": True, "already_cancelled": True, "emailed": 0}

        reason = ((body.reason if body else None) or "").strip() or None
        now = _now_iso()

        # Flip the event's editorial state to cancelled and stash the
        # reason so the public UI + future audit reads can surface it.
        await db.cms_events.update_one(
            {"id": event_id},
            {"$set": {
                "status": "cancelled",
                "cancelled_at": now,
                "cancellation_reason": reason or "",
                "updated_at": now,
            }},
        )

        # Fetch every active RSVP so we can email each attendee.
        active = await db.event_rsvps.find(
            {"event_id": event_id, "status": {"$in": ["going", "waitlist"]}},
            {"_id": 0},
        ).to_list(length=None)

        # Fire the emails asynchronously (best-effort, log-and-continue).
        emailed = 0
        if active:
            from email_service import send_email, event_cancelled_template
            from ics_builder import event_to_ics
            import base64 as _b64
            import logging as _logging
            log = _logging.getLogger("friendplace.events")

            site_url = os.getenv("FRIENDPLACE_PUBLIC_URL", "https://www.friendplace.com.au").rstrip("/")
            # A single cancelled ICS is enough — same event, same UID,
            # every recipient's calendar will match & remove the entry.
            cancelled_ics = event_to_ics(event, site_url=site_url, cancelled=True)
            when_display = _format_event_when(event)

            for rsvp in active:
                email = (rsvp.get("email") or "").strip()
                if not email:
                    # Some seeded RSVPs (mobile-only) may lack an email.
                    # Mark them cancelled and move on.
                    continue
                try:
                    subject, html, text = event_cancelled_template(
                        first_name=(rsvp.get("name") or "").split(" ")[0] or None,
                        event_title=event.get("title") or "your event",
                        event_when_display=when_display,
                        reason=reason,
                        ticket_ref=_short_rsvp_ref(rsvp["id"]),
                    )
                    attachments = [{
                        "filename": f"{event.get('slug', 'event')}.ics",
                        "content": _b64.b64encode(cancelled_ics.encode("utf-8")).decode("ascii"),
                        "content_type": "text/calendar; method=CANCEL",
                    }]
                    ok = await send_email(
                        to=email, subject=subject, html=html, text=text,
                        attachments=attachments,
                    )
                    if ok:
                        emailed += 1
                except Exception:
                    log.exception("event cancellation email failed for rsvp=%s", rsvp.get("id"))

        # Flip every active RSVP to cancelled so the roster is clean.
        # (Do this AFTER emails so the "was going/was waitlist" info is
        # still visible during the fan-out.)
        await db.event_rsvps.update_many(
            {"event_id": event_id, "status": {"$in": ["going", "waitlist"]}},
            {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
        )

        doc = await db.cms_events.find_one({"id": event_id}, {"_id": 0})
        if doc:
            doc["rsvp_counts"] = await _rsvp_counts_for(event_id)
        return {"ok": True, "emailed": emailed, "event": doc}

    # ---- RSVPs (admin-side management) --------------------------------
    # Public RSVP endpoint (from marketing site / mobile app) comes in
    # Session B. For v1 the admin can add RSVPs manually.

    @router.get("/events/{event_id}/rsvps")
    async def event_rsvps(
        event_id: str,
        admin: dict = Depends(current_cms_admin),
    ):
        ev = await db.cms_events.find_one({"id": event_id}, {"_id": 0, "id": 1, "capacity": 1})
        if not ev:
            raise HTTPException(404, "Event not found")
        cur = db.event_rsvps.find({"event_id": event_id}, {"_id": 0}).sort("created_at", 1)
        rows = await cur.to_list(length=None)
        counts = await _rsvp_counts_for(event_id)
        return {
            "items": rows,
            "counts": counts,
            "capacity": ev.get("capacity"),
        }

    @router.post("/events/{event_id}/rsvps")
    async def add_rsvp(
        event_id: str,
        body: EventRsvpIn,
        admin: dict = Depends(current_cms_admin),
    ):
        ev = await db.cms_events.find_one({"id": event_id}, {"_id": 0})
        if not ev:
            raise HTTPException(404, "Event not found")
        # Waitlist logic: if capacity is set and 'going' is at/above
        # capacity, new RSVPs default to 'waitlist'.
        counts = await _rsvp_counts_for(event_id)
        capacity = ev.get("capacity")
        requested = (body.status or "going").lower()
        if requested not in ("going", "waitlist", "cancelled"):
            raise HTTPException(400, "status must be going/waitlist/cancelled")
        if requested == "going" and isinstance(capacity, int) and capacity > 0 and counts["going"] >= capacity:
            requested = "waitlist"
        rsvp_id = str(uuid.uuid4())
        now = _now_iso()
        doc = {
            "id": rsvp_id,
            "event_id": event_id,
            "name": (body.name or "").strip(),
            "email": (body.email or "").strip().lower(),
            "user_id": body.user_id or None,
            "guests_count": int(body.guests_count) if body.guests_count is not None else 0,
            "note": (body.note or "").strip(),
            "status": requested,
            "created_at": now,
            "updated_at": now,
            "created_by": admin.get("email"),
        }
        await db.event_rsvps.insert_one(dict(doc))
        return doc

    @router.patch("/events/{event_id}/rsvps/{rsvp_id}")
    async def patch_rsvp(
        event_id: str,
        rsvp_id: str,
        body: EventRsvpIn,
        admin: dict = Depends(current_cms_admin),
    ):
        update: Dict[str, Any] = {"updated_at": _now_iso()}
        for field in ("name", "email", "user_id", "guests_count", "note", "status"):
            val = getattr(body, field)
            if val is not None:
                update[field] = val
        if "status" in update and update["status"] not in ("going", "waitlist", "cancelled"):
            raise HTTPException(400, "status must be going/waitlist/cancelled")
        res = await db.event_rsvps.update_one(
            {"id": rsvp_id, "event_id": event_id}, {"$set": update}
        )
        if res.matched_count == 0:
            raise HTTPException(404, "RSVP not found")
        # Auto-promote first waitlist entry to 'going' when a going slot
        # opens up (someone cancels).
        if update.get("status") == "cancelled":
            ev = await db.cms_events.find_one({"id": event_id}, {"_id": 0, "capacity": 1})
            cap = (ev or {}).get("capacity")
            counts = await _rsvp_counts_for(event_id)
            if isinstance(cap, int) and cap > 0 and counts["going"] < cap:
                next_up = await db.event_rsvps.find_one(
                    {"event_id": event_id, "status": "waitlist"},
                    {"_id": 0}, sort=[("created_at", 1)]
                )
                if next_up:
                    await db.event_rsvps.update_one(
                        {"id": next_up["id"]},
                        {"$set": {"status": "going", "updated_at": _now_iso()}}
                    )
        doc = await db.event_rsvps.find_one({"id": rsvp_id}, {"_id": 0})
        return doc

    @router.delete("/events/{event_id}/rsvps/{rsvp_id}")
    async def delete_rsvp(
        event_id: str,
        rsvp_id: str,
        admin: dict = Depends(current_cms_admin),
    ):
        res = await db.event_rsvps.delete_one({"id": rsvp_id, "event_id": event_id})
        if res.deleted_count == 0:
            raise HTTPException(404, "RSVP not found")
        return {"ok": True}


    # ============================================================
    # MEDIA LIBRARY
    # ============================================================

    @router.get("/media")
    async def list_media(
        admin: dict = Depends(current_cms_admin),
        limit: int = 200,
    ):
        cur = db.cms_media.find({}, {"_id": 0}).sort("created_at", -1).limit(min(limit, 500))
        items = await cur.to_list(length=None)
        return {"items": items, "count": len(items)}

    @router.post("/media/upload")
    async def upload_media(
        request: Request,
        file: UploadFile = File(...),
        admin: dict = Depends(current_cms_admin),
    ):
        """Local-disk media upload. Returns the DB row with a public URL.

        Cloudinary swap plan: replace the disk write block below with a
        cloudinary.uploader.upload() call, set provider="cloudinary" and
        store the cloudinary_public_id + secure_url. Downstream code
        keeps reading `url` from the row, so nothing else changes.
        """
        if not file.content_type or not any(
            file.content_type.startswith(p) for p in ALLOWED_MIME_PREFIXES
        ):
            raise HTTPException(415, "Only image uploads are supported for now")

        # Read into memory so we can enforce a size cap before writing.
        data = await file.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"File too large — max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")

        # Extension from the filename, fallback via content-type.
        ext = ""
        if file.filename and "." in file.filename:
            ext = file.filename.rsplit(".", 1)[-1].lower()
            ext = re.sub(r"[^a-z0-9]", "", ext)[:6]
        if not ext:
            ext = (file.content_type.split("/", 1)[-1] or "bin").lower()
            ext = re.sub(r"[^a-z0-9]", "", ext)[:6]

        media_id = str(uuid.uuid4())
        stored_name = f"{media_id}.{ext}"
        dest = UPLOADS_ROOT / stored_name
        dest.write_bytes(data)

        public_url = f"/api/uploads/cms/{stored_name}"
        # If the request came in behind ingress there may be an X-Forwarded-Host
        # we could use to build an absolute URL, but relative URLs are
        # fine — same origin for both website and API in prod.

        doc = {
            "id": media_id,
            "provider": "local",
            "url": public_url,
            "cloudinary_public_id": None,
            "filename": file.filename or stored_name,
            "stored_name": stored_name,
            "mime": file.content_type,
            "size_bytes": len(data),
            "alt": "",
            "created_at": _now_iso(),
            "uploaded_by": admin.get("email"),
        }
        try:
            await db.cms_media.insert_one(dict(doc))
        except Exception:
            # Roll back the disk write so we don't accumulate orphan files
            # whenever Mongo is unreachable / duplicate-keys / etc.
            try:
                dest.unlink(missing_ok=True)
            except Exception:
                pass
            raise
        return doc

    @router.patch("/media/{media_id}")
    async def update_media(
        media_id: str,
        body: Dict[str, Any],
        admin: dict = Depends(current_cms_admin),
    ):
        """Patch the alt-text (and any future metadata)."""
        allowed = {"alt", "filename"}
        update = {k: v for k, v in (body or {}).items() if k in allowed}
        if not update:
            raise HTTPException(400, "Nothing to update")
        res = await db.cms_media.update_one({"id": media_id}, {"$set": update})
        if res.matched_count == 0:
            raise HTTPException(404, "Media not found")
        doc = await db.cms_media.find_one({"id": media_id}, {"_id": 0})
        return doc

    @router.delete("/media/{media_id}")
    async def delete_media(
        media_id: str,
        admin: dict = Depends(current_cms_admin),
    ):
        doc = await db.cms_media.find_one({"id": media_id})
        if not doc:
            raise HTTPException(404, "Media not found")
        # Best-effort disk cleanup — never fail the request over it.
        try:
            if doc.get("provider") == "local" and doc.get("stored_name"):
                path = UPLOADS_ROOT / doc["stored_name"]
                if path.exists():
                    path.unlink()
        except Exception:
            pass
        await db.cms_media.delete_one({"id": media_id})
        return {"ok": True}

    # ── EVENT SUBMISSIONS (admin review) ─────────────────────────
    # Companion to the public `/events/submit` endpoint. Admins can
    # list pending submissions in Mission Control, approve one (which
    # promotes it into `cms_events` as a draft — never auto-publishes),
    # or reject it with a reason (which emails the submitter).

    @router.get("/event-submissions")
    async def list_event_submissions(
        status: Optional[str] = None,
        admin: dict = Depends(current_cms_admin),
    ):
        q: dict = {}
        if status:
            q["status"] = status
        cur = db.cms_event_submissions.find(q, {"_id": 0}).sort("created_at", -1)
        items = await cur.to_list(length=200)
        counts = {
            "pending": await db.cms_event_submissions.count_documents({"status": "pending"}),
            "approved": await db.cms_event_submissions.count_documents({"status": "approved"}),
            "rejected": await db.cms_event_submissions.count_documents({"status": "rejected"}),
        }
        return {"items": items, "counts": counts}

    @router.get("/event-submissions/{sub_id}")
    async def get_event_submission(sub_id: str, admin: dict = Depends(current_cms_admin)):
        doc = await db.cms_event_submissions.find_one({"id": sub_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Submission not found")
        return doc

    @router.post("/event-submissions/{sub_id}/approve")
    async def approve_event_submission(sub_id: str, admin: dict = Depends(current_cms_admin)):
        """Promote a pending submission into a DRAFT `cms_events` row —
        never auto-publishes. The admin fine-tunes and publishes from
        the normal event editor."""
        sub = await db.cms_event_submissions.find_one({"id": sub_id}, {"_id": 0})
        if not sub:
            raise HTTPException(404, "Submission not found")
        if sub.get("status") != "pending":
            raise HTTPException(400, f"Submission is already {sub.get('status')}")

        event_id = str(uuid.uuid4())
        slug_base = re.sub(r"[^a-z0-9]+", "-", (sub.get("event_title") or "event").lower()).strip("-") or "event"
        slug = slug_base
        n = 1
        while await db.cms_events.find_one({"slug": slug}):
            n += 1
            slug = f"{slug_base}-{n}"

        cover_url = ""
        cover_b64 = sub.get("cover_image_base64")
        if cover_b64 and isinstance(cover_b64, str) and cover_b64.startswith("data:"):
            cover_url = cover_b64

        event_doc = {
            "id": event_id, "slug": slug,
            "title": sub.get("event_title") or "",
            "description": sub.get("description") or "",
            "body_html": "",
            "cover_image_url": cover_url,
            "starts_at": sub.get("event_starts_at"),
            "ends_at": sub.get("event_ends_at"),
            "timezone": "Australia/Sydney",
            "is_online": False,
            "venue_name": sub.get("venue_name") or "",
            "venue_address": sub.get("venue_address") or "",
            "venue_url": "",
            "meeting_url": "",
            "capacity": sub.get("capacity"),
            "rsvp_deadline_at": "",
            "cost_type": sub.get("cost_type") or "free",
            "cost_display": sub.get("cost_display") or ("Free" if (sub.get("cost_type") or "free") == "free" else ""),
            "organiser_name": sub.get("organisation_name") or "",
            "organiser_contact": sub.get("contact_email") or "",
            "accessibility_info": sub.get("accessibility_info") or "",
            "sponsors": [],
            "status": "draft",
            "hidden": False,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "created_by": f"submission:{sub.get('submission_ref')}",
        }
        await db.cms_events.insert_one(dict(event_doc))
        await db.cms_event_submissions.update_one(
            {"id": sub_id},
            {"$set": {"status": "approved", "resulting_event_id": event_id, "updated_at": _now_iso()}},
        )
        return {"ok": True, "event_id": event_id, "event_slug": slug}

    @router.post("/event-submissions/{sub_id}/reject")
    async def reject_event_submission(
        sub_id: str,
        body: Optional[Dict[str, Any]] = None,
        admin: dict = Depends(current_cms_admin),
    ):
        sub = await db.cms_event_submissions.find_one({"id": sub_id}, {"_id": 0})
        if not sub:
            raise HTTPException(404, "Submission not found")
        if sub.get("status") != "pending":
            raise HTTPException(400, f"Submission is already {sub.get('status')}")
        reason = ((body or {}).get("reason") or "").strip()
        await db.cms_event_submissions.update_one(
            {"id": sub_id},
            {"$set": {"status": "rejected", "reviewer_notes": reason or None, "updated_at": _now_iso()}},
        )
        try:
            from email_service import send_email
            support_from = (os.getenv("SUPPORT_EMAIL") or "support@friendplace.com.au").strip()
            reason_line = f"<br><em>{reason}</em>" if reason else ""
            await send_email(
                to=sub.get("contact_email") or "",
                subject=f"Your event submission — {sub.get('submission_ref')}",
                html=(
                    f"<p>Hi { (sub.get('contact_name') or 'there') },</p>"
                    f"<p>Thanks for submitting <strong>{ sub.get('event_title') or 'your event' }</strong> for FriendPlace.</p>"
                    f"<p>After review, we weren&rsquo;t able to publish this listing on this occasion.{reason_line}</p>"
                    "<p>You&rsquo;re very welcome to submit another event any time — just reply to this email if you&rsquo;d like a hand.</p>"
                    "<p>💜 The FriendPlace Team</p>"
                ),
                text=(
                    f"Hi {sub.get('contact_name') or 'there'},\n\n"
                    f"Thanks for submitting {sub.get('event_title') or 'your event'} for FriendPlace.\n\n"
                    f"After review, we weren't able to publish this listing on this occasion."
                    + (f"\n\nReason from our team:\n  {reason}\n" if reason else "") +
                    "\nYou're very welcome to submit another event any time — just reply to this email if you'd like a hand.\n\n💜 The FriendPlace Team"
                ),
                reply_to=support_from,
            )
        except Exception:
            import logging as _logging
            _logging.getLogger("friendplace.events").exception("rejection email failed")
        return {"ok": True}

    # ==================================================================
    # MEMBER MANAGEMENT — Slice 1
    # ==================================================================
    #
    # Thin wrappers over the existing mobile-admin data model. Both
    # collections are shared: `users`, `reports`, `moderation_log`,
    # `notifications`. Every write path also lands an entry in
    # `admin_log` via services.audit.log_admin_action() so the
    # cross-cutting audit view (Slice 0) sees everything.
    #
    # Auth: `current_cms_admin` from the CMS JWT. We do NOT require the
    # actor to be flagged as a mobile-admin — anyone with CMS access is
    # a moderator. All actions key off the target's unique Member ID.

    from services import audit as _audit  # local import
    from datetime import datetime, timedelta, timezone

    def _iso_now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _actor_id(admin: dict) -> str:
        # Prefer the CMS admin id, but log the email so mobile-audit
        # trails can identify the actor even if CMS admins are separate.
        return f"cms:{admin.get('id') or admin.get('email')}"

    async def _log_member_action(
        admin: dict, user_id: str, action: str, reason: str = "",
        report_id: Optional[str] = None, extra: Optional[dict] = None,
    ) -> None:
        # 1. Per-member timeline (existing collection used by mobile).
        entry = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "by": _actor_id(admin),
            "action": action,
            "reason": reason or "",
            "report_id": report_id,
            "created_at": _iso_now(),
            **(extra or {}),
        }
        try:
            await db.moderation_log.insert_one(entry)
        except Exception:
            pass
        # 2. Cross-cutting admin_log (Slice 0).
        await _audit.log_admin_action(
            db, admin=admin, action=f"member.{action}",
            target_type="member", target_id=user_id, reason=reason,
            metadata={"report_id": report_id, **(extra or {})},
        )

    def _project_member_row(u: dict) -> dict:
        """Trim a user doc to fields safe & useful for admin lists."""
        return {
            "id": u.get("id"),
            "first_name": u.get("first_name"),
            "last_name": u.get("last_name"),
            "display_name": u.get("display_name"),
            "username": u.get("username"),
            "email": u.get("email"),
            "avatar": u.get("avatar") or u.get("profile_image"),
            "created_at": u.get("created_at"),
            "last_active": u.get("last_active"),
            "restricted": bool(u.get("restricted")),
            "banned": bool(u.get("banned")),
            "suspended_until": u.get("suspended_until"),
            "restricted_reason": u.get("restricted_reason"),
            "flagged_for_review": bool(u.get("flagged_for_review")),
            "profile_hidden": bool(u.get("profile_hidden")),
            "is_admin": bool(u.get("is_admin")),
            "is_demo": bool(u.get("is_demo")),
            "is_founding": bool(u.get("is_founding_member") or u.get("founding_member")),
        }

    @router.get("/members")
    async def list_members(
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
        q: Optional[str] = None,
        status: Optional[str] = None,  # banned|suspended|restricted|founding|demo|admin
        limit: int = 50,
        skip: int = 0,
    ):
        """Search + filter list. `q` matches name, email, username or id (case-insensitive)."""
        mongo_q: dict = {}
        if status == "banned":
            mongo_q["banned"] = True
        elif status == "suspended":
            mongo_q["suspended_until"] = {"$exists": True, "$ne": None}
        elif status == "restricted":
            mongo_q["restricted"] = True
        elif status == "founding":
            mongo_q["$or"] = [
                {"is_founding_member": True},
                {"founding_member": True},
            ]
        elif status == "demo":
            mongo_q["is_demo"] = True
        elif status == "admin":
            mongo_q["is_admin"] = True

        if q:
            needle = q.strip()
            if needle:
                # Escape special regex chars in user input.
                import re as _re
                esc = _re.escape(needle)
                rx = {"$regex": esc, "$options": "i"}
                or_terms = [
                    {"first_name": rx}, {"last_name": rx}, {"display_name": rx},
                    {"username": rx}, {"email": rx}, {"id": needle},
                ]
                # Merge with any existing $or from status filter.
                if "$or" in mongo_q:
                    mongo_q = {"$and": [mongo_q, {"$or": or_terms}]}
                else:
                    mongo_q["$or"] = or_terms

        total = await db.users.count_documents(mongo_q)
        cursor = (
            db.users.find(mongo_q, {"_id": 0, "password_hash": 0})
            .sort("created_at", -1)
            .skip(max(0, int(skip)))
            .limit(max(1, min(int(limit), 200)))
        )
        rows = [_project_member_row(u) async for u in cursor]
        return {"items": rows, "total": total, "limit": limit, "skip": skip}

    @router.get("/members/{user_id}")
    async def get_member(user_id: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """Full profile payload — user + reports + warnings + moderation_log + counts.

        Same shape as the existing mobile endpoint
        `GET /api/admin/users/{user_id}/moderation` so the desktop UI
        can consume the exact same data model without duplication.
        """
        user = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "password_hash": 0, "failed_login_attempts": 0,
             "lockout_until": 0, "suburb_lat": 0, "suburb_lng": 0},
        )
        if not user:
            raise HTTPException(404, "Member not found")

        reports = await db.reports.find(
            {"target_user_id": user_id}, {"_id": 0},
        ).sort("created_at", -1).to_list(200)

        log_rows = await db.moderation_log.find(
            {"user_id": user_id}, {"_id": 0},
        ).sort("created_at", -1).to_list(200)

        # Enrich actions with the acting admin's display info.
        actor_ids: set[str] = set()
        for e in log_rows:
            by = e.get("by")
            if not by or by == "system":
                continue
            actor_ids.add(by[4:] if by.startswith("cms:") else by)
        actor_map: dict = {}
        if actor_ids:
            async for a in db.users.find(
                {"id": {"$in": list(actor_ids)}},
                {"_id": 0, "id": 1, "first_name": 1, "username": 1, "avatar": 1},
            ):
                actor_map[a["id"]] = a
            async for a in db.cms_admins.find(
                {"$or": [
                    {"id": {"$in": list(actor_ids)}},
                    {"email": {"$in": list(actor_ids)}},
                ]},
                {"_id": 0, "id": 1, "email": 1, "display_name": 1},
            ):
                actor_map[a.get("id") or a.get("email")] = {
                    "id": a.get("id"),
                    "display_name": a.get("display_name") or a.get("email"),
                    "email": a.get("email"),
                    "avatar": None,
                }
        for e in log_rows:
            by = e.get("by") or ""
            key = by[4:] if by.startswith("cms:") else by
            if key and key != "system":
                e["by_user"] = actor_map.get(key)

        # Denormalised counts for the Moderation Summary card.
        counts = {
            "reports_total": len(reports),
            "reports_open": sum(1 for r in reports if r.get("status") in ("new", "reviewing")),
            "warnings": sum(1 for e in log_rows if e.get("action") == "warn"),
            "suspensions": sum(1 for e in log_rows if e.get("action") == "suspend"),
            "bans": sum(1 for e in log_rows if e.get("action") == "ban"),
            "notes": sum(1 for e in log_rows if e.get("action") == "note"),
            "actions_total": len(log_rows),
            "last_action_at": log_rows[0].get("created_at") if log_rows else None,
            "last_action": log_rows[0].get("action") if log_rows else None,
        }
        return {
            "user": user,
            "reports": reports,
            "warnings": user.get("warnings", []),
            "moderation_log": log_rows,
            "counts": counts,
        }

    # ---- Moderation action bodies ----
    class _MemberActionBody(BaseModel):
        reason: str = ""
        report_id: Optional[str] = None

    class _SuspendBody(_MemberActionBody):
        duration_hours: int = 24

    class _NoteBody(BaseModel):
        note: str

    class _DeleteBody(BaseModel):
        confirm_member_id: str  # must equal path user_id — GitHub-style safe delete
        reason: str = ""

    @router.post("/members/{user_id}/notes")
    async def add_member_note(
        user_id: str, body: _NoteBody,
        admin: dict = Depends(current_cms_admin),
    ):
        note = (body.note or "").strip()
        if not note:
            raise HTTPException(400, "Note cannot be empty")
        await db.users.update_one({"id": user_id}, {"$set": {}})  # touch to error-out on missing
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(404, "Member not found")
        await _log_member_action(admin, user_id, "note", reason=note)
        return {"ok": True}

    @router.post("/members/{user_id}/actions/warn")
    async def warn_member(
        user_id: str, body: _MemberActionBody,
        admin: dict = Depends(current_cms_admin),
    ):
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(404, "Member not found")
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": user_id,
            "type": "moderation_warning",
            "title": "You have received a warning",
            "body": body.reason or "Please review our community guidelines.",
            "read": False, "created_at": _iso_now(),
        })
        if body.report_id:
            await db.reports.update_one(
                {"id": body.report_id},
                {"$set": {"status": "resolved", "outcome": "warned",
                          "admin_note": body.reason, "updated_at": _iso_now()}},
            )
        await _log_member_action(admin, user_id, "warn",
                                 reason=body.reason, report_id=body.report_id)
        return {"ok": True}

    @router.post("/members/{user_id}/actions/suspend")
    async def suspend_member(
        user_id: str, body: _SuspendBody,
        admin: dict = Depends(current_cms_admin),
    ):
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(404, "Member not found")
        hours = max(1, int(body.duration_hours or 24))
        until = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
        await db.users.update_one(
            {"id": user_id},
            {"$set": {
                "restricted": True,
                "suspended_until": until,
                "restricted_reason": body.reason or "Suspended by admin",
                "restricted_at": _iso_now(),
            }},
        )
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": user_id,
            "type": "moderation_suspension",
            "title": "Your account has been suspended",
            "body": f"Reason: {body.reason or 'See community guidelines'}. Lifted at {until}.",
            "read": False, "created_at": _iso_now(),
        })
        if body.report_id:
            await db.reports.update_one(
                {"id": body.report_id},
                {"$set": {"status": "resolved", "outcome": f"suspended_{hours}h",
                          "admin_note": body.reason, "updated_at": _iso_now()}},
            )
        await _log_member_action(
            admin, user_id, "suspend", reason=body.reason,
            report_id=body.report_id,
            extra={"duration_hours": hours, "until": until},
        )
        return {"ok": True, "suspended_until": until}

    @router.post("/members/{user_id}/actions/ban")
    async def ban_member(
        user_id: str, body: _MemberActionBody,
        admin: dict = Depends(current_cms_admin),
    ):
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(404, "Member not found")
        await db.users.update_one(
            {"id": user_id},
            {"$set": {
                "banned": True, "restricted": True,
                "restricted_reason": body.reason or "Banned by admin",
                "restricted_at": _iso_now(),
            }},
        )
        if body.report_id:
            await db.reports.update_one(
                {"id": body.report_id},
                {"$set": {"status": "resolved", "outcome": "banned",
                          "admin_note": body.reason, "updated_at": _iso_now()}},
            )
        await _log_member_action(admin, user_id, "ban",
                                 reason=body.reason, report_id=body.report_id)
        return {"ok": True}

    @router.post("/members/{user_id}/actions/restore")
    async def restore_member(
        user_id: str, body: _MemberActionBody,
        admin: dict = Depends(current_cms_admin),
    ):
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(404, "Member not found")
        await db.users.update_one(
            {"id": user_id},
            {"$set": {
                "restricted": False, "banned": False,
                "suspended_until": None, "restricted_reason": "",
                "profile_hidden": False, "flagged_for_review": False,
            },
             "$unset": {"restricted_at": "", "profile_hidden_at": "",
                        "profile_hidden_reason": "", "flagged_at": "",
                        "flagged_reason": ""}},
        )
        await db.notices.update_many(
            {"user_id": user_id}, {"$set": {"auto_hidden": False}},
        )
        await _log_member_action(admin, user_id, "restore", reason=body.reason)
        return {"ok": True}

    @router.post("/members/{user_id}/actions/delete")
    async def delete_member(
        user_id: str, body: _DeleteBody,
        admin: dict = Depends(current_cms_admin),
    ):
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(404, "Member not found")
        # GitHub-style safety gate — admin must have typed the Member ID.
        if (body.confirm_member_id or "").strip() != user_id:
            raise HTTPException(400, "Member ID confirmation does not match")
        # Log FIRST so the audit trail survives the delete.
        await _log_member_action(
            admin, user_id, "delete",
            reason=body.reason or "Hard delete (right-to-erasure)",
        )
        # Anonymise historical reports so the audit chain survives.
        await db.reports.update_many(
            {"target_user_id": user_id},
            {"$set": {"target_user_id": "[deleted]"}},
        )
        await db.reports.delete_many({"reporter_id": user_id})
        await db.users.delete_one({"id": user_id})
        return {"ok": True}

    # ==================================================================
    # ADMIN AUDIT LOG (Slice 0)
    # ==================================================================
    # Read-only endpoints backing /admin/audit-log. Every consequential
    # admin action across MCGS should write to this log via
    # `services.audit.log_admin_action()`. See services/audit.py for the
    # helper and the KNOWN_ACTIONS catalogue.

    from services import audit as _audit  # local import — module boundary

    @router.get("/admin-log")
    async def list_audit_log(
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
        action_prefix: Optional[str] = None,
        target_type: Optional[str] = None,
        target_id: Optional[str] = None,
        admin_id: Optional[str] = None,
        limit: int = 50,
        skip: int = 0,
    ):
        rows = await _audit.list_admin_log(
            db,
            admin_id=admin_id,
            action_prefix=action_prefix,
            target_type=target_type,
            target_id=target_id,
            limit=limit,
            skip=skip,
        )
        total = await _audit.count_admin_log(
            db,
            admin_id=admin_id,
            action_prefix=action_prefix,
            target_type=target_type,
        )
        return {"items": rows, "total": total, "limit": limit, "skip": skip}

    @router.get("/admin-log/actions")
    async def known_actions(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """Return the catalogue of well-known action strings so the UI
        can build filter dropdowns without hard-coding the list."""
        return {"actions": list(_audit.KNOWN_ACTIONS)}

    # ==================================================================
    # SECURITY — Slice 0.5
    # ==================================================================
    from services import security as _sec

    @router.get("/security/summary")
    async def security_summary(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        from datetime import datetime as _dt, timezone as _tz, timedelta as _td
        now = _dt.now(_tz.utc)
        day_ago = now - _td(hours=24)
        active_sessions = await db.admin_sessions.count_documents(
            {"revoked_at": None, "expires_at": {"$gt": now}},
        )
        active_lockouts = await db.admin_lockouts.count_documents(
            {"locked_until": {"$gt": now}},
        )
        fails_24h = await db.admin_security_log.count_documents(
            {"created_at": {"$gte": day_ago},
             "outcome": {"$in": ["fail", "lockout_created", "lockout_hit"]}},
        )
        logins_24h = await db.admin_security_log.count_documents(
            {"created_at": {"$gte": day_ago}, "outcome": "success"},
        )
        return {
            "active_sessions": active_sessions,
            "active_lockouts": active_lockouts,
            "fails_last_24h": fails_24h,
            "successes_last_24h": logins_24h,
            "thresholds": {
                "alert_after": _sec.ALERT_AFTER,
                "lockout_after": _sec.LOCKOUT_AFTER,
                "lockout_minutes": _sec.LOCKOUT_MINUTES,
                "mass_attack_fails": _sec.MASS_ATTACK_FAILS,
                "mass_attack_urgent": _sec.MASS_ATTACK_URGENT,
                "mass_attack_window_minutes": _sec.MASS_ATTACK_WINDOW_MIN,
            },
        }

    @router.get("/security/events")
    async def security_events(
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
        outcome: Optional[str] = None,   # success | fail | lockout_created | lockout_hit
        email: Optional[str] = None,
        limit: int = 100,
        skip: int = 0,
    ):
        q: dict = {}
        if outcome:
            q["outcome"] = outcome
        if email:
            q["email"] = _sec.normalise_email(email)
        cur = (db.admin_security_log.find(q, {"_id": 0})
               .sort("created_at", -1)
               .skip(max(0, int(skip)))
               .limit(max(1, min(int(limit), 500))))
        rows = []
        async for r in cur:
            r["created_at"] = (r.get("created_at").isoformat()
                               if hasattr(r.get("created_at"), "isoformat")
                               else r.get("created_at"))
            if isinstance(r.get("locked_until"), _sec.datetime):
                r["locked_until"] = r["locked_until"].isoformat()
            rows.append(r)
        total = await db.admin_security_log.count_documents(q)
        return {"items": rows, "total": total, "limit": limit, "skip": skip}

    @router.get("/security/sessions")
    async def security_sessions(
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
        active_only: bool = True,
    ):
        from datetime import datetime as _dt, timezone as _tz
        q: dict = {}
        if active_only:
            q = {"revoked_at": None, "expires_at": {"$gt": _dt.now(_tz.utc)}}
        cur = db.admin_sessions.find(q, {"_id": 0}).sort("issued_at", -1).limit(200)
        rows = []
        async for r in cur:
            for k in ("issued_at", "expires_at", "revoked_at", "last_seen_at"):
                v = r.get(k)
                if hasattr(v, "isoformat"):
                    r[k] = v.isoformat()
            rows.append(r)
        return {"items": rows}

    @router.post("/security/sessions/{jti}/revoke")
    async def security_revoke_session(
        jti: str, admin: dict = Depends(current_cms_admin),
    ):
        ok = await _sec.revoke_session(db, jti)
        await _audit.log_admin_action(
            db, admin=admin, action="admin.session.revoke",
            target_type="admin_session", target_id=jti,
        )
        await _sec.log_event(
            db, outcome="session_revoked", email=admin.get("email"),
            ip=None, user_agent=None, ua=None, geo=None,
            jti=jti, admin_id=admin.get("id"),
        )
        return {"ok": ok}

    @router.get("/security/lockouts")
    async def security_lockouts(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        from datetime import datetime as _dt, timezone as _tz
        cur = db.admin_lockouts.find(
            {"locked_until": {"$gt": _dt.now(_tz.utc)}}, {"_id": 0},
        ).sort("locked_until", -1)
        rows = []
        async for r in cur:
            for k in ("locked_until", "created_at", "updated_at"):
                v = r.get(k)
                if hasattr(v, "isoformat"):
                    r[k] = v.isoformat()
            rows.append(r)
        return {"items": rows}

    @router.post("/security/lockouts/clear")
    async def security_clear_lockout(
        body: dict, admin: dict = Depends(current_cms_admin),
    ):
        scope = body.get("scope")
        key = body.get("key")
        if scope not in ("email", "ip") or not key:
            raise HTTPException(400, "scope and key required")
        await _sec.clear_lockout(db, scope, key)
        await db.admin_login_attempts.delete_one({"scope": scope, "key": key})
        await _audit.log_admin_action(
            db, admin=admin, action="admin.lockout.clear",
            target_type=scope, target_id=key,
        )
        return {"ok": True}

    # ==================================================================
    # KNOWLEDGE BASE — George's institutional memory
    # ==================================================================
    from services import knowledge as _kb

    @router.get("/knowledge")
    async def kb_list(
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
        type: Optional[str] = None,
        status: Optional[str] = None,
        visibility: Optional[str] = None,
        q: Optional[str] = None,
        limit: int = 100,
    ):
        query: dict = {}
        if type and type in _kb.ALLOWED_TYPES:
            query["type"] = type
        if status:
            query["status"] = status
        if visibility and visibility in _kb.ALLOWED_VISIBILITY:
            query["visibility"] = visibility
        if q:
            query["$text"] = {"$search": q}
        cur = db[_kb.COLLECTION].find(query, {"_id": 0, "embedding": 0})\
                                 .sort("updated_at", -1).limit(max(1, min(int(limit), 500)))
        rows = []
        async for r in cur:
            for k in ("created_at", "updated_at", "effective_from", "effective_to"):
                v = r.get(k)
                if hasattr(v, "isoformat"):
                    r[k] = v.isoformat()
            rows.append(r)
        return {"items": rows, "types": list(_kb.ALLOWED_TYPES)}

    @router.get("/knowledge/{entry_id}")
    async def kb_get(entry_id: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        r = await db[_kb.COLLECTION].find_one({"id": entry_id}, {"_id": 0, "embedding": 0})
        if not r:
            raise HTTPException(404, "Entry not found")
        for k in ("created_at", "updated_at", "effective_from", "effective_to"):
            v = r.get(k)
            if hasattr(v, "isoformat"):
                r[k] = v.isoformat()
        return r

    @router.post("/knowledge/retrieve")
    async def kb_retrieve(
        body: dict, admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        query = (body.get("query") or "").strip()
        k = int(body.get("k") or 5)
        types = body.get("types") or None
        hits = await _kb.retrieve(db, query, k=k, types=types)
        # Drop embeddings from response.
        for h in hits:
            h.pop("embedding", None)
            for k2 in ("created_at", "updated_at", "effective_from", "effective_to"):
                v = h.get(k2)
                if hasattr(v, "isoformat"):
                    h[k2] = v.isoformat()
        return {"hits": hits, "count": len(hits)}

    @router.get("/knowledge-stats")
    async def kb_stats(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        total = await db[_kb.COLLECTION].count_documents({})
        by_type = {}
        for t in _kb.ALLOWED_TYPES:
            by_type[t] = await db[_kb.COLLECTION].count_documents({"type": t})
        drafts = await db[_kb.COLLECTION].count_documents({"status": "draft"})
        public = await db[_kb.COLLECTION].count_documents({"visibility": "public"})
        admin_only = await db[_kb.COLLECTION].count_documents({"visibility": "admin"})
        superseded = await db[_kb.COLLECTION].count_documents({"status": "superseded"})
        return {
            "total": total,
            "by_type": by_type,
            "drafts": drafts,
            "public": public,
            "admin_only": admin_only,
            "superseded": superseded,
        }

    @router.get("/knowledge-drafts")
    async def kb_drafts(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        rows = await _kb.list_drafts(db)
        return {"items": rows}

    @router.post("/knowledge")
    async def kb_create(body: dict, admin: dict = Depends(current_cms_admin)):
        title = (body.get("title") or "").strip()
        body_md = (body.get("body_md") or "").strip()
        if not title or not body_md:
            raise HTTPException(400, "title and body_md are required")
        entry_type = body.get("type") or "decision"
        if entry_type not in _kb.ALLOWED_TYPES:
            raise HTTPException(400, f"type must be one of: {_kb.ALLOWED_TYPES}")
        visibility = body.get("visibility") or _kb.DEFAULT_VISIBILITY
        if visibility not in _kb.ALLOWED_VISIBILITY:
            raise HTTPException(400, f"visibility must be one of: {_kb.ALLOWED_VISIBILITY}")
        payload = {
            "type": entry_type,
            "title": title,
            "body_md": body_md,
            "tags": body.get("tags") or [],
            "sources": body.get("sources") or [],
            "related_ids": body.get("related_ids") or [],
            "visibility": visibility,
            "admin_context": body.get("admin_context"),
            "evolution_note": body.get("evolution_note"),
            "confidence": body.get("confidence") or "canonical",
            "status": body.get("status") or "active",
        }
        # Allow the caller to specify an id (used for seeded / imported
        # entries where we want to preserve the narrative KB-STORY-*
        # numbering). Fall through to auto-id if the caller doesn't ask
        # for one or if the requested id is already taken.
        wanted_id = (body.get("id") or "").strip()
        if wanted_id:
            existing = await db[_kb.COLLECTION].find_one({"id": wanted_id})
            if existing:
                raise HTTPException(409, f"KB id already in use: {wanted_id}")
            payload["id"] = wanted_id
        created = await _kb.create_entry(
            db, entry=payload, authored_by=admin.get("email"),
        )
        await _audit.log_admin_action(
            db, admin=admin, action="kb.entry.create",
            target_type="knowledge", target_id=created["id"],
            metadata={"title": created["title"], "visibility": created["visibility"]},
        )
        created.pop("embedding", None)
        return created

    @router.patch("/knowledge/{entry_id}")
    async def kb_update(entry_id: str, body: dict, admin: dict = Depends(current_cms_admin)):
        updated = await _kb.update_entry(
            db, entry_id, patch=body, updated_by=admin.get("email"),
        )
        if not updated:
            raise HTTPException(404, "Entry not found")
        await _audit.log_admin_action(
            db, admin=admin, action="kb.entry.update",
            target_type="knowledge", target_id=entry_id,
            metadata={k: v for k, v in body.items() if k in ("title", "visibility", "status")},
        )
        return updated

    @router.post("/knowledge/{entry_id}/confirm")
    async def kb_confirm(entry_id: str, admin: dict = Depends(current_cms_admin)):
        updated = await _kb.confirm_draft(
            db, entry_id, confirmed_by=admin.get("email"),
        )
        if not updated:
            raise HTTPException(404, "Entry not found")
        await _audit.log_admin_action(
            db, admin=admin, action="kb.entry.confirm",
            target_type="knowledge", target_id=entry_id,
            metadata={"title": updated.get("title")},
        )
        return updated

    @router.post("/knowledge/{entry_id}/discard")
    async def kb_discard(entry_id: str, admin: dict = Depends(current_cms_admin)):
        existing = await db[_kb.COLLECTION].find_one({"id": entry_id})
        if not existing:
            raise HTTPException(404, "Entry not found")
        ok = await _kb.discard_entry(db, entry_id)
        if not ok:
            raise HTTPException(500, "Failed to discard")
        await _audit.log_admin_action(
            db, admin=admin, action="kb.entry.discard",
            target_type="knowledge", target_id=entry_id,
            metadata={
                "title": existing.get("title"),
                "was_status": existing.get("status"),
            },
        )
        return {"ok": True}

    @router.post("/knowledge/{entry_id}/supersede")
    async def kb_supersede(entry_id: str, body: dict, admin: dict = Depends(current_cms_admin)):
        title = (body.get("title") or "").strip()
        body_md = (body.get("body_md") or "").strip()
        if not title or not body_md:
            raise HTTPException(400, "title and body_md are required for the new entry")
        new_payload = {
            "type": body.get("type"),
            "title": title,
            "body_md": body_md,
            "tags": body.get("tags"),
            "sources": body.get("sources"),
            "visibility": body.get("visibility"),
            "admin_context": body.get("admin_context"),
            "evolution_note": body.get("evolution_note"),
        }
        # Strip Nones so create_entry's defaults win where not provided.
        new_payload = {k: v for k, v in new_payload.items() if v is not None}
        created = await _kb.supersede_entry(
            db, entry_id, new_entry=new_payload, updated_by=admin.get("email"),
        )
        if not created:
            raise HTTPException(404, "Entry not found")
        await _audit.log_admin_action(
            db, admin=admin, action="kb.entry.supersede",
            target_type="knowledge", target_id=entry_id,
            metadata={"new_id": created["id"], "title": created["title"]},
        )
        created.pop("embedding", None)
        return created

    @router.post("/knowledge/reseed")
    async def kb_reseed(admin: dict = Depends(current_cms_admin)):
        """Re-run the seed script to refresh the canonical entries from
        FriendPlace's own documentation. Non-destructive — updates
        existing entries in place, doesn't touch drafts."""
        try:
            from scripts import seed_george_kb as _seed  # type: ignore
        except Exception:
            # Fallback: import via file path when 'scripts' package isn't on
            # the module search path in this deployment layout.
            import importlib.util as _iu, pathlib as _pl
            spec = _iu.spec_from_file_location(
                "seed_george_kb",
                str(_pl.Path(__file__).parent / "scripts" / "seed_george_kb.py"),
            )
            _seed = _iu.module_from_spec(spec)  # type: ignore
            spec.loader.exec_module(_seed)  # type: ignore
        created = updated = 0
        for entry in _seed.SEED:
            existing = await db[_kb.COLLECTION].find_one(
                {"id": entry["id"]}, {"title": 1, "body_md": 1, "admin_context": 1},
            )
            await _kb.upsert_entry(db, dict(entry))
            if existing:
                updated += 1
            else:
                created += 1
        total = await _kb.count_entries(db)
        await _audit.log_admin_action(
            db, admin=admin, action="kb.reseed",
            metadata={"created": created, "updated": updated, "total": total},
        )
        return {"ok": True, "created": created, "updated": updated, "total": total}

    @router.post("/knowledge/backfill-embeddings")
    async def kb_backfill_embeddings(admin: dict = Depends(current_cms_admin)):
        result = await _kb.backfill_embeddings(db)
        await _audit.log_admin_action(
            db, admin=admin, action="kb.embeddings.backfill",
            metadata=result,
        )
        return {"ok": True, **result}

    # Ensure indexes on startup (idempotent).
    import asyncio as _asyncio
    try:
        _asyncio.get_event_loop().create_task(_sec.ensure_indexes(db))
        _asyncio.get_event_loop().create_task(_kb.ensure_indexes(db))
    except Exception:
        pass

    return router


# ---- helper used by cancel_event above (moved before router closes) ----


# ---- Granular public read endpoints -------------------------------------
# The website's `lib/api.ts` calls these per-section URLs. Serving them
# from the single `site_content` doc keeps the admin CMS as the sole
# source of truth without asking the website to know how the doc is
# shaped.

def build_public_router(db) -> APIRouter:
    router = APIRouter(prefix="/public", tags=["public"])

    async def _content() -> Dict[str, Any]:
        doc = await db.site_content.find_one({"key": "main"}, {"_id": 0})
        if not doc:
            from server import _DEFAULT_SITE_CONTENT  # noqa: WPS433
            doc = dict(_DEFAULT_SITE_CONTENT)
        doc.pop("key", None)
        return doc

    @router.get("/about")
    async def about():
        c = await _content()
        about_block = c.get("about") or {}
        return {
            "heading": about_block.get("title") or about_block.get("heading") or "",
            "body": about_block.get("body") or "",
            "mission": about_block.get("lead") or about_block.get("mission") or "",
        }

    @router.get("/features")
    async def features():
        c = await _content()
        feats = c.get("features") or []
        # Normalise emoji → icon so the website's `FeatureCard` type matches.
        out = []
        for f in feats:
            out.append({
                "icon": f.get("icon") or f.get("emoji") or "•",
                "title": f.get("title") or "",
                "body": f.get("body") or f.get("description") or "",
            })
        return {"features": out}

    @router.get("/faqs")
    async def faqs():
        c = await _content()
        return {"faqs": c.get("faqs") or []}

    @router.get("/founders")
    async def founders():
        c = await _content()
        # Prefer the dedicated CMS collection when it has published rows.
        # Falls back to legacy site_content.founding_members during
        # migration so nothing goes missing.
        try:
            cur = db.cms_founding_members.find(
                {"status": "published", "hidden": {"$ne": True}},
                # Public projection — admin metadata never ships.
                {
                    "_id": 0,
                    "id": 1,
                    "name": 1,
                    "number": 1,
                    "role": 1,
                    "location": 1,
                    "avatar_url": 1,
                    "bio_html": 1,
                    "order": 1,
                },
            ).sort([("order", 1), ("number", 1)])
            cms_members = await cur.to_list(length=None)
        except Exception:
            cms_members = []
        # Homepage grid consumes m.name / m.number / m.avatar. Provide
        # `avatar` as an alias so existing rendering keeps working
        # regardless of which shape came through.
        members: List[Dict[str, Any]] = []
        if cms_members:
            for m in cms_members:
                members.append({
                    **m,
                    # Fallback to legacy `avatar` key so the homepage's
                    # `m.avatar || m.name.charAt(0)` line renders images
                    # via the new avatar_url without any page changes.
                    "avatar": m.get("avatar_url") or "",
                })
        else:
            members = c.get("founding_members") or []

        try:
            count = await db.users.count_documents({"is_founder": True, "is_demo": {"$ne": True}})
        except Exception:
            count = 0
        return {"members": members, "count": int(count), "cap": 250}

    @router.get("/stories")
    async def stories():
        # Read from the dedicated collection when it exists, filtered to
        # published & non-hidden. Falls back to legacy site_content
        # entries so nothing goes missing during the migration window.
        try:
            cur = db.cms_success_stories.find(
                {
                    "status": "published",
                    "hidden": {"$ne": True},
                },
                # Explicit projection — admin-only fields like created_by
                # / created_at MUST NOT leak on the public API. Only ship
                # what the public StoryCard actually needs.
                {
                    "_id": 0,
                    "id": 1,
                    "title": 1,
                    "body_html": 1,
                    "author_name": 1,
                    "author_role": 1,
                    "author_location": 1,
                    "author_avatar_url": 1,
                    "order": 1,
                    "updated_at": 1,
                },
            ).sort([("order", 1), ("updated_at", -1)])
            items = await cur.to_list(length=None)
        except Exception:
            items = []
        if not items:
            c = await _content()
            items = c.get("success_stories") or []
        return {"stories": items}

    # ── EVENTS (public) ─────────────────────────────────────────────
    @router.get("/events")
    async def public_events():
        """Upcoming published+visible events, ordered by start time.
        Admin metadata is stripped; RSVP counts included for capacity
        indicators on the public grid."""
        now = datetime.now(timezone.utc).isoformat()
        try:
            cur = db.cms_events.find(
                {"status": "published", "hidden": {"$ne": True}},
                {
                    "_id": 0,
                    "id": 1, "slug": 1, "title": 1, "description": 1, "body_html": 1,
                    "cover_image_url": 1, "starts_at": 1, "ends_at": 1, "timezone": 1,
                    "is_online": 1, "venue_name": 1, "venue_address": 1, "venue_url": 1,
                    "meeting_url": 1, "capacity": 1, "rsvp_deadline_at": 1,
                    "cost_type": 1, "cost_display": 1, "organiser_name": 1,
                    "organiser_contact": 1, "accessibility_info": 1, "sponsors": 1,
                },
            ).sort([("starts_at", 1)])
            items = await cur.to_list(length=None)
        except Exception:
            items = []
        # Filter out past events and annotate with going/waitlist counts.
        upcoming = [ev for ev in items if not ev.get("starts_at") or ev["starts_at"] >= now]
        for ev in upcoming:
            going = await db.event_rsvps.count_documents({"event_id": ev["id"], "status": "going"})
            waitlist = await db.event_rsvps.count_documents({"event_id": ev["id"], "status": "waitlist"})
            ev["rsvp_counts"] = {"going": int(going), "waitlist": int(waitlist)}
        return {"events": upcoming}

    # ── EVENT RSVP + ICS (public) ─────────────────────────────────
    # NOTE: the `.ics` route is declared BEFORE `/events/{slug}` so
    # FastAPI matches it first — otherwise the slug matcher would
    # swallow "test-morning-coffee.ics" as a literal slug.

    async def _fetch_public_event(slug: str) -> Dict[str, Any]:
        """Slug → published-or-cancelled+visible event, or 404.

        Cancelled events are still fetchable so the public detail page
        can render a "This event has been cancelled" banner — a saved
        link 404-ing would be a worse UX. RSVP endpoints separately
        gate on `status == 'published'`.
        """
        doc = await db.cms_events.find_one(
            {"slug": slug, "status": {"$in": ["published", "cancelled"]}, "hidden": {"$ne": True}},
            {"_id": 0},
        )
        if not doc:
            raise HTTPException(404, "Event not found")
        return doc

    @router.get("/events/{slug}.ics")
    async def public_event_ics(slug: str):
        """Return the raw iCalendar file for an event so users can
        subscribe/add it to their own calendar without RSVPing.

        For cancelled events we emit `METHOD:CANCEL` so opening the
        file removes the entry from the user's calendar (matches the
        email fan-out behaviour).
        """
        from fastapi.responses import Response
        from ics_builder import event_to_ics
        event = await _fetch_public_event(slug)
        site_url = os.getenv("FRIENDPLACE_PUBLIC_URL", "https://www.friendplace.com.au")
        is_cancelled = event.get("status") == "cancelled"
        ics_text = event_to_ics(event, site_url=site_url, cancelled=is_cancelled)
        return Response(
            content=ics_text,
            media_type="text/calendar; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{slug}.ics"'},
        )

    @router.get("/events/{slug}")
    async def public_event_by_slug(slug: str):
        doc = await db.cms_events.find_one(
            {"slug": slug, "status": {"$in": ["published", "cancelled"]}, "hidden": {"$ne": True}},
            {
                "_id": 0,
                "id": 1, "slug": 1, "title": 1, "description": 1, "body_html": 1,
                "cover_image_url": 1, "starts_at": 1, "ends_at": 1, "timezone": 1,
                "is_online": 1, "venue_name": 1, "venue_address": 1, "venue_url": 1,
                "meeting_url": 1, "capacity": 1, "rsvp_deadline_at": 1,
                "cost_type": 1, "cost_display": 1, "organiser_name": 1,
                "organiser_contact": 1, "accessibility_info": 1, "sponsors": 1,
                # Include cancellation metadata so the public page can
                # render a "This event has been cancelled" banner.
                "status": 1, "cancelled_at": 1, "cancellation_reason": 1,
            },
        )
        if not doc:
            raise HTTPException(404, "Event not found")
        going = await db.event_rsvps.count_documents({"event_id": doc["id"], "status": "going"})
        waitlist = await db.event_rsvps.count_documents({"event_id": doc["id"], "status": "waitlist"})
        doc["rsvp_counts"] = {"going": int(going), "waitlist": int(waitlist)}
        return doc

    @router.post("/events/{slug}/rsvp")
    async def public_event_rsvp(slug: str, body: PublicRsvpIn):
        """Create a public RSVP by name+email.

        - Waitlists automatically when the event is at capacity.
        - Idempotent per email: if the same email RSVPs twice, we
          update the existing row instead of creating a duplicate.
        - Sends a branded confirmation email with an .ics attachment
          and a magic-link URL to manage/cancel the RSVP.
        """
        event = await _fetch_public_event(slug)
        # A cancelled event politely refuses new RSVPs — but existing
        # ones already got a cancellation email, so this branch mainly
        # protects the case where someone browses a stale bookmark.
        if event.get("status") == "cancelled":
            raise HTTPException(400, "This event has been cancelled and is no longer accepting RSVPs.")
        event_id = event["id"]
        email = (body.email or "").strip().lower()
        name = (body.name or "").strip()
        if not name:
            raise HTTPException(400, "Please add your name.")
        # RSVP-deadline check (soft; only rejects if a deadline exists).
        deadline = event.get("rsvp_deadline_at") or ""
        if deadline:
            try:
                if datetime.fromisoformat(deadline.replace("Z", "+00:00")) < datetime.now(timezone.utc):
                    raise HTTPException(400, "RSVPs for this event have closed.")
            except HTTPException:
                raise
            except Exception:
                pass  # invalid ISO — treat as no deadline

        # Determine going vs waitlist based on current capacity usage.
        capacity = event.get("capacity")
        going_now = await db.event_rsvps.count_documents(
            {"event_id": event_id, "status": "going"}
        )
        target_status = "going"
        if isinstance(capacity, int) and capacity > 0 and going_now >= capacity:
            target_status = "waitlist"

        now = _now_iso()
        existing = await db.event_rsvps.find_one(
            {"event_id": event_id, "email": email}, {"_id": 0}
        )

        if existing:
            # Re-submitting flips a "cancelled" row back to
            # going/waitlist and refreshes name/guests/note. Keeps
            # the original id + cancel_token stable so previous
            # confirmation-email links keep working. Also backfills
            # `user_id` if the RSVP was first created anonymously
            # (website) and the same person is now logged in on
            # mobile — so the linkage becomes accurate over time.
            new_status = target_status if existing.get("status") == "cancelled" else existing.get("status")
            update_fields: Dict[str, Any] = {
                "name": name,
                "guests_count": int(body.guests_count or 0),
                "note": (body.note or "").strip(),
                "status": new_status,
                "updated_at": now,
                "created_by": existing.get("created_by") or ("mobile-app" if body.user_id else "public-web"),
            }
            if body.user_id and not existing.get("user_id"):
                update_fields["user_id"] = body.user_id
            await db.event_rsvps.update_one(
                {"id": existing["id"]}, {"$set": update_fields},
            )
            rsvp_doc = await db.event_rsvps.find_one({"id": existing["id"]}, {"_id": 0})
        else:
            rsvp_id = str(uuid.uuid4())
            cancel_token = uuid.uuid4().hex + uuid.uuid4().hex  # 64-char opaque
            rsvp_doc = {
                "id": rsvp_id,
                "event_id": event_id,
                "cancel_token": cancel_token,
                "name": name,
                "email": email,
                "user_id": body.user_id,
                "guests_count": int(body.guests_count or 0),
                "note": (body.note or "").strip(),
                "status": target_status,
                "created_at": now,
                "updated_at": now,
                "created_by": "mobile-app" if body.user_id else "public-web",
            }
            await db.event_rsvps.insert_one(dict(rsvp_doc))

        # Build the confirmation email + ICS attachment (best-effort).
        try:
            from email_service import send_email, event_rsvp_confirmation_template
            from ics_builder import event_to_ics
            import base64 as _b64

            site_url = os.getenv("FRIENDPLACE_PUBLIC_URL", "https://www.friendplace.com.au").rstrip("/")
            event_url = f"{site_url}/events/{slug}"
            manage_url = f"{site_url}/events/{slug}/rsvp/{rsvp_doc.get('cancel_token', '')}"
            ticket_ref = _short_rsvp_ref(rsvp_doc["id"])

            when_display = _format_event_when(event)
            where_display = _format_event_where(event)
            cost_display = event.get("cost_display") or None
            first_name = name.split(" ")[0] if name else None

            subject, html, text = event_rsvp_confirmation_template(
                first_name=first_name,
                event_title=event.get("title") or "your event",
                event_when_display=when_display,
                event_where_display=where_display,
                event_cost_display=cost_display,
                event_url=event_url,
                manage_url=manage_url,
                rsvp_status=rsvp_doc.get("status") or "going",
                guests_count=int(rsvp_doc.get("guests_count") or 0),
                ticket_ref=ticket_ref,
            )
            ics_text = event_to_ics(event, site_url=site_url)
            attachments = [{
                "filename": f"{slug}.ics",
                "content": _b64.b64encode(ics_text.encode("utf-8")).decode("ascii"),
                # Resend supports MIME content-type via `content_type` on
                # attachments; if the SDK is older it just falls back to
                # application/octet-stream — still opens in every calendar.
                "content_type": "text/calendar",
            }]
            await send_email(
                to=email,
                subject=subject,
                html=html,
                text=text,
                attachments=attachments,
            )
        except Exception:
            # Log-and-continue: the RSVP itself is saved.
            import logging as _logging
            _logging.getLogger("friendplace.events").exception(
                "public RSVP saved but confirmation email failed"
            )

        # Response omits `cancel_token` from the body (the user only
        # needs it via the emailed link — the site UI reads the token
        # from the URL, not from this response).
        rsvp_doc.pop("cancel_token", None)
        rsvp_doc["display_ref"] = _short_rsvp_ref(rsvp_doc["id"])
        return {
            "ok": True,
            "rsvp": rsvp_doc,
            "message": (
                "You're all set — check your inbox for your calendar invite."
                if rsvp_doc.get("status") == "going"
                else "This event is fully booked, so you're now on the waitlist."
            ),
        }

    @router.get("/events/{slug}/rsvp/{token}")
    async def public_event_rsvp_lookup(slug: str, token: str):
        """Resolve a cancel_token to its RSVP + parent event so the
        website can render a personalised manage/cancel page.

        Deliberately kept minimal — returns only what the page needs
        to show and does not leak other attendees.
        """
        event = await _fetch_public_event(slug)
        rsvp = await db.event_rsvps.find_one(
            {"event_id": event["id"], "cancel_token": token},
            {"_id": 0, "cancel_token": 0},
        )
        if not rsvp:
            raise HTTPException(404, "RSVP not found or already cancelled")
        return {
            "event": {
                "id": event["id"], "slug": event["slug"], "title": event["title"],
                "starts_at": event.get("starts_at"), "ends_at": event.get("ends_at"),
                "timezone": event.get("timezone"),
                "venue_name": event.get("venue_name"), "venue_address": event.get("venue_address"),
                "is_online": event.get("is_online"), "meeting_url": event.get("meeting_url"),
                "cover_image_url": event.get("cover_image_url"),
                "cost_display": event.get("cost_display"),
            },
            "rsvp": {**rsvp, "display_ref": _short_rsvp_ref(rsvp["id"])},
        }

    @router.post("/events/{slug}/rsvp/{token}/cancel")
    async def public_event_rsvp_cancel(slug: str, token: str):
        """Cancel a public RSVP via magic-link token.

        - Sets `status=cancelled` on the RSVP.
        - If a spot opens up (capacity was set), promotes the next
          waitlist entry to `going` and (best-effort) emails them
          the good news.
        """
        event = await _fetch_public_event(slug)
        rsvp = await db.event_rsvps.find_one(
            {"event_id": event["id"], "cancel_token": token}, {"_id": 0}
        )
        if not rsvp:
            raise HTTPException(404, "RSVP not found or already cancelled")
        if rsvp.get("status") == "cancelled":
            return {"ok": True, "already_cancelled": True}

        was_going = rsvp.get("status") == "going"
        await db.event_rsvps.update_one(
            {"id": rsvp["id"]},
            {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
        )

        # Promote next waitlist entry if capacity allows.
        promoted = None
        capacity = event.get("capacity")
        if was_going and isinstance(capacity, int) and capacity > 0:
            going_now = await db.event_rsvps.count_documents(
                {"event_id": event["id"], "status": "going"}
            )
            if going_now < capacity:
                next_up = await db.event_rsvps.find_one(
                    {"event_id": event["id"], "status": "waitlist"},
                    {"_id": 0},
                    sort=[("created_at", 1)],
                )
                if next_up:
                    await db.event_rsvps.update_one(
                        {"id": next_up["id"]},
                        {"$set": {"status": "going", "updated_at": _now_iso()}},
                    )
                    promoted = next_up
                    # Send them the "you're in!" email.
                    try:
                        from email_service import send_email, event_rsvp_confirmation_template
                        from ics_builder import event_to_ics
                        import base64 as _b64
                        site_url = os.getenv("FRIENDPLACE_PUBLIC_URL", "https://www.friendplace.com.au").rstrip("/")
                        event_url = f"{site_url}/events/{event['slug']}"
                        manage_url = f"{site_url}/events/{event['slug']}/rsvp/{next_up.get('cancel_token', '')}"
                        subject, html, text = event_rsvp_confirmation_template(
                            first_name=(next_up.get("name") or "").split(" ")[0] or None,
                            event_title=event.get("title") or "your event",
                            event_when_display=_format_event_when(event),
                            event_where_display=_format_event_where(event),
                            event_cost_display=event.get("cost_display") or None,
                            event_url=event_url,
                            manage_url=manage_url,
                            rsvp_status="going",
                            guests_count=int(next_up.get("guests_count") or 0),
                            ticket_ref=_short_rsvp_ref(next_up["id"]),
                        )
                        ics_text = event_to_ics(event, site_url=site_url)
                        attachments = [{
                            "filename": f"{event['slug']}.ics",
                            "content": _b64.b64encode(ics_text.encode("utf-8")).decode("ascii"),
                            "content_type": "text/calendar",
                        }]
                        await send_email(
                            to=(next_up.get("email") or "").strip(),
                            subject=subject, html=html, text=text,
                            attachments=attachments,
                        )
                    except Exception:
                        import logging as _logging
                        _logging.getLogger("friendplace.events").exception(
                            "waitlist promotion email failed"
                        )

        return {"ok": True, "promoted_email": bool(promoted)}

    # ── EVENTS "MINE" (public) ────────────────────────────────────
    # Returns the user's active RSVPs joined with the event summary.
    # Powers the mobile app's "My upcoming events" section. Uses a
    # simple `user_id` query param — this is a read-only listing of
    # the caller's own rows, so we don't need JWT here (the risk
    # of a MongoDB UUID being guessed is negligible).

    @router.get("/events/mine")
    async def public_events_mine(user_id: str):
        """RSVPs for `user_id`, most-imminent first, active only.

        Response shape:
            { "items": [ { "event": {...summary...}, "rsvp": {...} } ] }
        """
        if not user_id:
            raise HTTPException(400, "user_id is required")
        cur = db.event_rsvps.find(
            {"user_id": user_id, "status": {"$in": ["going", "waitlist"]}},
            {"_id": 0, "cancel_token": 0},
        )
        rsvps = await cur.to_list(length=None)
        if not rsvps:
            return {"items": []}
        event_ids = list({r["event_id"] for r in rsvps})
        ev_cur = db.cms_events.find(
            {"id": {"$in": event_ids}},
            {
                "_id": 0,
                "id": 1, "slug": 1, "title": 1, "description": 1,
                "cover_image_url": 1, "starts_at": 1, "ends_at": 1,
                "timezone": 1, "is_online": 1, "venue_name": 1,
                "venue_address": 1, "meeting_url": 1, "cost_display": 1,
                "status": 1,
            },
        )
        events = {e["id"]: e for e in await ev_cur.to_list(length=None)}
        items = []
        for r in rsvps:
            ev = events.get(r["event_id"])
            if not ev:
                continue
            items.append({
                "event": ev,
                "rsvp": {**r, "display_ref": _short_rsvp_ref(r["id"])},
            })
        # Most-imminent first; missing starts_at goes last.
        items.sort(key=lambda x: (x["event"].get("starts_at") or "9999"))
    # ── PUBLIC EVENT SUBMISSIONS ─────────────────────────────────
    # "List your event" flow on the marketing website (draft-first).
    # Anyone with a browser can submit; nothing appears publicly
    # until an admin reviews it in Mission Control.

    @router.post("/events/submit")
    async def public_event_submit(body: EventSubmissionIn):
        """Accept a public event submission and stash it as pending.

        - Generates a short human-quotable ref (e.g. FP-SUB-A1B2C3)
          which is echoed to the submitter's email.
        - Fires a Mission Control admin notification.
        - Sends an acknowledgement email to the submitter.
        - Never publishes. Admin action required.
        """
        if not body.agreed_to_review:
            raise HTTPException(400, "Please confirm the submission is subject to FriendPlace approval.")
        try:
            datetime.fromisoformat(body.event_starts_at.replace("Z", "+00:00"))
        except Exception:
            raise HTTPException(400, "Please provide a valid start date/time.")

        submission_id = str(uuid.uuid4())
        submission_ref = "FP-SUB-" + submission_id.replace("-", "")[:6].upper()
        now = _now_iso()
        doc = {
            "id": submission_id,
            "submission_ref": submission_ref,
            "organisation_name": body.organisation_name.strip(),
            "contact_name": body.contact_name.strip(),
            "contact_email": body.contact_email.lower().strip(),
            "contact_phone": (body.contact_phone or "").strip() or None,
            "event_title": body.event_title.strip(),
            "event_starts_at": body.event_starts_at,
            "event_ends_at": body.event_ends_at,
            "venue_name": (body.venue_name or "").strip() or None,
            "venue_address": (body.venue_address or "").strip() or None,
            "description": (body.description or "").strip() or None,
            "capacity": body.capacity,
            "cost_type": body.cost_type or "free",
            "cost_display": (body.cost_display or "").strip() or None,
            "accessibility_info": (body.accessibility_info or "").strip() or None,
            "cover_image_base64": body.cover_image_base64,
            "status": "pending",       # pending | approved | rejected
            "created_at": now,
            "updated_at": now,
            "reviewer_notes": None,
            "resulting_event_id": None,
        }
        await db.cms_event_submissions.insert_one(dict(doc))

        # ---- MCGS Signal producer (Phase 1) ----
        # Every event submission also lands as a Signal on the Bridge.
        # Best-effort; never blocks the submission response.
        try:
            from services.mcgs import create_signal as _mcgs_create_signal
            from services.george import triage_signal_with_haiku as _mcgs_triage
            await _mcgs_create_signal(
                db,
                producer="event_submission",
                entity_ref={"kind": "event_submission", "id": submission_id},
                subject=f"Event awaiting review: {body.event_title.strip()}"[:120],
                body=(
                    f"Submitted by {body.organisation_name.strip()} — "
                    f"{body.contact_name.strip()} <{body.contact_email.lower().strip()}>\n\n"
                    f"{(body.description or '').strip()}"
                )[:4000],
                category="attention",
                priority="P2",
                case_key=f"event_submission:{submission_id}",
                source="user_report",
                injection_check_fields=[body.event_title, body.description, body.venue_name],
                triage_fn=_mcgs_triage,
            )
        except Exception:
            import logging as _logging
            _logging.getLogger("friendplace.mcgs").exception(
                "event_submission signal producer failed for %s", submission_id,
            )

        # Notify Mission Control (best-effort; never blocks the submit).
        try:
            # `_notify_admins` isn't imported inside cms_module — dispatch
            # via a lightweight collection insert instead. Mission Control
            # can query `cms_alerts` next to the existing badge counter.
            await db.cms_alerts.insert_one({
                "id": str(uuid.uuid4()),
                "type": "event_submission",
                "title": "New event awaiting review",
                "body": f"{body.organisation_name.strip()} — {body.event_title.strip()}",
                "ref_id": submission_id,
                "created_at": now,
                "read": False,
            })
        except Exception:
            import logging as _logging
            _logging.getLogger("friendplace.events").exception("submission alert insert failed")

        # Acknowledgement email to submitter.
        try:
            from email_service import send_email, event_submission_ack_template
            subject, html, text = event_submission_ack_template(
                first_name=body.contact_name.split(" ")[0] if body.contact_name else None,
                organisation_name=body.organisation_name.strip(),
                event_title=body.event_title.strip(),
                submission_ref=submission_ref,
            )
            support_from = (os.getenv("SUPPORT_EMAIL") or "support@friendplace.com.au").strip()
            await send_email(
                to=body.contact_email,
                subject=subject, html=html, text=text,
                reply_to=support_from,
            )
        except Exception:
            import logging as _logging
            _logging.getLogger("friendplace.events").exception("submission ack email failed")

        return {
            "ok": True,
            "submission_ref": submission_ref,
            "message": "Thanks — your event has been submitted for review.",
        }

    return router
