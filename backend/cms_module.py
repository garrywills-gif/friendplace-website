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
    BackgroundTasks,
    Body,
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
    # ============================================================
    # ============================================================
    # ENQUIRIES  ·  unified view across every public submission form
    # ============================================================
    # Guarantees Garry's launch requirement: "no customer enquiry can
    # ever be lost because of an email delivery issue." Every public
    # submission form (Contact, Register Interest, Support ticket,
    # Report, Waitlist) already persists to the DB *before* any email
    # is sent — this endpoint gives admins a single at-a-glance view.
    # If an outbound confirmation email ever fails to deliver, the
    # underlying record is still here.

    @router.get("/enquiries")
    async def list_enquiries(
        kind: Optional[str] = None,      # filter to one type: contact|interest|support|report|waitlist
        limit: int = 200,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Unified list of every public enquiry / registration.

        Returns rows from five collections in a normalised shape so the
        UI can render them side-by-side. Excludes test fixtures. Newest
        first. Capped at `limit` per collection so a spike can't hurt
        the browser."""
        lim = max(1, min(int(limit or 200), 500))

        async def _read(coll: str, mapper) -> list[dict]:
            docs = await db[coll].find(
                {"is_test": {"$ne": True}}, {"_id": 0}
            ).sort("created_at", -1).to_list(lim)
            return [mapper(d) for d in docs]

        rows: list[dict] = []
        if not kind or kind == "contact":
            rows += await _read("contact_submissions", lambda d: {
                "kind":       "contact",
                "kind_label": "Contact",
                "id":         d.get("id"),
                "name":       d.get("name"),
                "email":      d.get("email"),
                "subject":    d.get("subject"),
                "message":    d.get("message"),
                "status":     d.get("status") or "new",
                "created_at": d.get("created_at"),
                "meta":       {"category": d.get("category")},
            })
        if not kind or kind == "interest":
            rows += await _read("interest_registrations", lambda d: {
                "kind":       "interest",
                "kind_label": "Register Interest",
                "id":         d.get("id"),
                "name":       d.get("first_name") or d.get("name"),
                "email":      d.get("email"),
                "subject":    None,
                "message":    d.get("notes") or "",
                "status":     d.get("status") or "new",
                "created_at": d.get("created_at"),
                "meta":       {"suburb": d.get("suburb"), "state": d.get("state"), "companion": d.get("companion")},
            })
        if not kind or kind == "support":
            rows += await _read("support_tickets", lambda d: {
                "kind":       "support",
                "kind_label": "Support ticket",
                "id":         d.get("ref") or d.get("id"),
                "name":       d.get("name"),
                "email":      d.get("email"),
                "subject":    d.get("subject"),
                "message":    d.get("message"),
                "status":     d.get("status") or "open",
                "created_at": d.get("created_at"),
                "meta":       {"category": d.get("category"), "ref": d.get("ref")},
            })
        if not kind or kind == "report":
            rows += await _read("reports", lambda d: {
                "kind":       "report",
                "kind_label": "Report",
                "id":         d.get("id"),
                "name":       d.get("reporter_name"),
                "email":      d.get("reporter_email"),
                "subject":    d.get("reason") or d.get("category"),
                "message":    d.get("details") or d.get("notes"),
                "status":     d.get("status") or "open",
                "created_at": d.get("created_at"),
                "meta":       {"target_type": d.get("target_type"), "target_id": d.get("target_id")},
            })
        if not kind or kind == "waitlist":
            rows += await _read("waitlist", lambda d: {
                "kind":       "waitlist",
                "kind_label": "Waitlist",
                "id":         d.get("id"),
                "name":       d.get("first_name") or d.get("name"),
                "email":      d.get("email"),
                "subject":    None,
                "message":    "",
                "status":     "invited" if d.get("invited") else "waiting",
                "created_at": d.get("created_at"),
                "meta":       {"referral": d.get("referral_source")},
            })

        # Sort ALL rows across kinds by created_at DESC.
        rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return {
            "count": len(rows),
            "rows":  rows[:lim],
            "kinds": [
                {"key": "contact",  "label": "Contact",           "count": sum(1 for r in rows if r["kind"] == "contact")},
                {"key": "interest", "label": "Register Interest", "count": sum(1 for r in rows if r["kind"] == "interest")},
                {"key": "support",  "label": "Support",           "count": sum(1 for r in rows if r["kind"] == "support")},
                {"key": "report",   "label": "Report",            "count": sum(1 for r in rows if r["kind"] == "report")},
                {"key": "waitlist", "label": "Waitlist",          "count": sum(1 for r in rows if r["kind"] == "waitlist")},
            ],
        }


    # EMAIL TEMPLATE PREVIEW
    # ============================================================
    # Lets a signed-in CMS admin render each transactional email in a
    # normal browser tab (so we can iterate on copy without spamming a
    # real inbox), edit the subject and preheader inline, flip between
    # George and Georgia on personal emails, and one-click send a
    # `[TEST]` copy to `EMAIL_PREVIEW_RECIPIENT` (default:
    # hello@friendplace.com.au) for a final QA in a real mail client.
    #
    # The HTML endpoint accepts the CMS admin JWT via either the
    # Authorization header OR a `?token=<jwt>` query param — the query
    # variant is needed because iframes and plain link clicks can't
    # attach headers. Same-origin admins are still guarded.

    # ============================================================
    # FOUNDING MEMBERS CRM  (Phase 1 — the DB is the source of truth)
    # ============================================================
    # Every Register Interest submission (interest_registrations) is a
    # Founding Member. This surface lets admins manage each record
    # through the status ladder Registered → Invited → Joined → Opted
    # out and record admin_notes + tags. The public website form label
    # stays "Register Interest" — this is admin-side terminology only.
    #
    # Locked with Garry (1 Aug 2026): "the database must be the source
    # of truth" and "email notifications are useful, but the database
    # must be the source of truth". Phase 2 (bulk campaigns) will
    # build on top of this — but only after Phase 1 is validated.

    _FM_STATUSES = {"registered", "invited", "joined", "opted_out"}
    # Legacy "new" status (from the original RYI form) is treated as
    # equivalent to "registered" in the CRM — both mean "awaiting contact".
    _AWAITING_STATUSES = ["registered", "new"]

    def _normalise_fm_row(r: Dict[str, Any]) -> Dict[str, Any]:
        """Backfill CRM defaults + map legacy 'new' status to 'registered'."""
        s = r.get("status")
        if s in (None, "", "new"):
            r["status"] = "registered"
        r.setdefault("admin_notes", "")
        r.setdefault("tags", [])
        return r

    @router.get("/crm/founding-members")
    async def crm_founding_members_list(
        status: Optional[str] = None,
        q: Optional[str] = None,
        limit: int = 500,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """List Founding Members with optional status filter + free-text search."""
        lim = max(1, min(int(limit or 500), 1000))
        query: Dict[str, Any] = {"is_test": {"$ne": True}}
        if status and status in _FM_STATUSES:
            if status == "registered":
                # Include legacy "new" and missing-status rows too.
                query["$or"] = [
                    {"status": {"$exists": False}},
                    {"status": None},
                    {"status": {"$in": _AWAITING_STATUSES}},
                ]
            else:
                query["status"] = status
        if q:
            import re as _re
            rx = _re.compile(_re.escape(q), _re.IGNORECASE)
            search_or = [
                {"first_name": rx}, {"last_name": rx}, {"email": rx},
                {"state_country": rx}, {"suburb": rx}, {"state": rx},
                {"admin_notes": rx}, {"heard_from": rx},
                {"tags": rx},
            ]
            # Founder-number search: strip a leading "#" and any zero
            # padding, then match founder_number as an int. So "#0003",
            # "0003" and "3" all find the same row.
            digits = _re.sub(r"[^0-9]", "", q or "")
            if digits:
                try:
                    search_or.append({"founder_number": int(digits)})
                except ValueError:
                    pass
            if "$or" in query:
                existing_or = query.pop("$or")
                query["$and"] = [{"$or": existing_or}, {"$or": search_or}]
            else:
                query["$or"] = search_or
        # Sort by founder_number ASC — #0001 first, then #0002, etc.
        # This tells the story of FriendPlace's history from the
        # beginning. Rows without a founder_number (shouldn't happen
        # post-backfill, but defensive) fall to the end.
        rows = await db.interest_registrations.find(query, {"_id": 0}).sort(
            [("founder_number", 1), ("created_at", 1)]
        ).to_list(lim)
        rows = [_normalise_fm_row(r) for r in rows]
        return {"count": len(rows), "rows": rows}

    @router.get("/crm/founding-members/stats")
    async def crm_founding_members_stats(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """Aggregate counts for the Bridge dashboard card + CRM header.

        Reserved slots (#0001 Garry, #0002 George) are counted in
        `total` — they are Founding Members — but excluded from
        `new_today` and `awaiting_contact` because they don't need
        an invite. Their status is always `joined`.

        iter163: The counting rules now live in
        ``services/crm/founding_stats.py`` so this endpoint and
        George's ``founding_members_summary`` tool share ONE source
        of truth. "Today" is a Sydney calendar day (Australia/Sydney).
        """
        from services.crm.founding_stats import compute_founding_members_stats
        stats = await compute_founding_members_stats(db)
        latest = stats.get("latest")
        latest_summary = None
        if latest:
            latest_summary = {
                "name":            (latest.get("first_name") or latest.get("name")),
                "email":           latest.get("email"),
                "state_country":   latest.get("state_country"),
                "created_at":      latest.get("created_at"),
                "id":              latest.get("id"),
                "founder_number":  latest.get("founder_number"),
            }
        return {
            "total":            stats["total"],
            "new_today":        stats["new_today"],
            "awaiting_contact": stats["awaiting_contact"],
            "invited":          stats["invited"],
            "joined":           stats["joined"],
            "opted_out":        stats["opted_out"],
            "latest":           latest_summary,
        }

    @router.patch("/crm/founding-members/{member_id}")
    async def crm_founding_members_update(
        member_id: str,
        payload: Dict[str, Any],
        admin: dict = Depends(current_cms_admin),
    ):
        """Update a Founding Member's status, notes, or tags. All fields
        optional — only supplied ones are set. Every change is appended
        to `history[]` so we have a full audit trail."""
        from datetime import datetime, timezone
        updates: Dict[str, Any] = {}
        history_entry: Dict[str, Any] = {
            "at":       datetime.now(timezone.utc).isoformat(),
            "admin_id": admin.get("id"),
        }
        if "status" in payload:
            s = str(payload["status"]).lower()
            if s not in _FM_STATUSES:
                raise HTTPException(400, f"status must be one of: {sorted(_FM_STATUSES)}")
            updates["status"] = s
            history_entry["status"] = s
        if "admin_notes" in payload:
            updates["admin_notes"] = str(payload["admin_notes"])[:5000]
            history_entry["notes_updated"] = True
        if "tags" in payload:
            tags_in = payload["tags"] or []
            if not isinstance(tags_in, list):
                raise HTTPException(400, "tags must be a list of strings")
            updates["tags"] = [str(t)[:40] for t in tags_in][:20]
            history_entry["tags"] = updates["tags"]
        if not updates:
            raise HTTPException(400, "Nothing to update — provide status, admin_notes, or tags")
        updates["updated_at"] = history_entry["at"]
        res = await db.interest_registrations.update_one(
            {"id": member_id},
            {"$set": updates, "$push": {"history": history_entry}},
        )
        if res.matched_count == 0:
            raise HTTPException(404, "Founding member not found")
        row = await db.interest_registrations.find_one({"id": member_id}, {"_id": 0})
        return _normalise_fm_row(row) if row else row


    @router.delete("/crm/founding-members/{member_id}")
    async def crm_founding_members_delete(
        member_id: str,
        admin: dict = Depends(current_cms_admin),
    ):
        """Permanently delete a Founding Member registration.

        Admin-only, destructive, no soft-delete. Rules:
          • Refuses when ``is_reserved`` is truthy — reserved slots
            (#0001 Garry, #0002 George, #0003 Neo, and any future
            honorary insert) must remain protected. No override
            mechanism today; the deliberate escape hatch is direct
            DB Viewer access via the Emergent production console.
          • Does NOT rewind the ``counters/founder_number`` document.
            Founding numbers are monotonic by design — a gap in the
            sequence is preferred over reuse. Reclaiming a specific
            number requires a separate, deliberate counter edit
            (which the DB Viewer supports).
          • Deletes exactly one row from ``interest_registrations``.
            No cascade to ``users``, ``events``, or any other
            collection.
          • Returns the founder_number and email of the deleted row
            so the client can render a truthful confirmation and
            audit line.
        """
        row = await db.interest_registrations.find_one({"id": member_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Founding member not found")
        if bool(row.get("is_reserved")):
            raise HTTPException(
                403,
                "This is a reserved Founding Member slot and cannot be deleted "
                "from the CRM. If you truly need to remove it, use the "
                "Emergent Production Database Viewer.",
            )
        res = await db.interest_registrations.delete_one({"id": member_id})
        if res.deleted_count == 0:
            # Raced with another delete — treat as already gone.
            raise HTTPException(404, "Founding member not found")
        return {
            "ok":              True,
            "deleted_id":      member_id,
            "founder_number":  row.get("founder_number"),
            "email":           row.get("email"),
            "first_name":      row.get("first_name"),
            "deleted_by":      admin.get("id"),
        }


    @router.post("/crm/founding-members/retire-duplicate")
    async def crm_founding_members_retire_duplicate(
        payload: Dict[str, Any],
        admin: dict = Depends(current_cms_admin),
    ):
        """Admin-only cleanup endpoint (iter164).

        Retires a single duplicate Founding-Member registration
        (created before the iter164 email-uniqueness fix landed) by
        moving it into ``retired_registrations`` and removing it from
        the live collection.

        The mirror of ``backend/scripts/retire_duplicate_founding_members.py``,
        exposed over the CMS API so an admin can trigger it from a
        deployed environment without needing a production shell.

        Contract:
          - Requires a valid admin JWT (``current_cms_admin`` dep).
          - Body must be ``{"founder_number": <int>}``.
          - Refuses unless the target row has a NORMALISED duplicate
            (same lowercased/trimmed email as another row that is
            neither test-flagged nor reserved). The oldest row
            (lowest founder_number, else earliest created_at) is
            treated as the keeper and NEVER retired.
          - Refuses reserved (``is_reserved:true``) rows outright.
          - Refuses test-flagged (``is_test:true``) rows outright.
          - Writes an audit row into ``retired_registrations`` with
            ``retire_keeper_id``, ``retire_keeper_founder_number``,
            ``retire_reason`` and ``retired_at`` before deleting.
          - Idempotent: if the founder number is already in
            ``retired_registrations`` (previously retired), returns
            ``{"ok": true, "already_retired": true, ...}`` with the
            recorded keeper — no error, no re-write.
          - Does NOT rewind ``counters/founder_number``. Founding
            numbers are monotonic; a gap after retire is intentional.
          - Never touches any other row.
        """
        # ── Validate input ────────────────────────────────────────────
        raw_num = payload.get("founder_number")
        try:
            target_num = int(raw_num)
        except (TypeError, ValueError):
            raise HTTPException(
                400,
                "founder_number is required and must be an integer.",
            )
        if target_num < 3:
            # #0001/#0002 are always reserved; #0003+ are the only
            # candidates for retirement.
            raise HTTPException(
                400,
                "Reserved founder numbers (#0001, #0002) cannot be retired.",
            )

        # ── Idempotency: already retired? ─────────────────────────────
        prior = await db.retired_registrations.find_one(
            {"founder_number": target_num},
            {"_id": 0},
        )
        if prior:
            return {
                "ok":                True,
                "already_retired":   True,
                "retired_founder_number": target_num,
                "keeper_founder_number":  prior.get("retire_keeper_founder_number"),
                "keeper_id":         prior.get("retire_keeper_id"),
                "retired_at":        prior.get("retired_at"),
                "retire_reason":     prior.get("retire_reason"),
                "retired_by":        prior.get("retire_admin_id"),
                "note": "This founder number was already retired on a "
                        "previous call. No changes made.",
            }

        # ── Locate the target row ─────────────────────────────────────
        target = await db.interest_registrations.find_one(
            {"founder_number": target_num},
            {"_id": 0},
        )
        if not target:
            raise HTTPException(
                404,
                f"No Founding Member with number #{target_num:04d} in the "
                "live collection. If you already retired it, that action "
                "is recorded in retired_registrations.",
            )
        if bool(target.get("is_reserved")):
            raise HTTPException(
                403,
                f"#{target_num:04d} is a reserved slot and cannot be retired.",
            )
        if bool(target.get("is_test")):
            raise HTTPException(
                403,
                f"#{target_num:04d} is a test-flagged row — the retire "
                "endpoint is for real duplicates only.",
            )

        # ── Normalise email + find genuine duplicate ─────────────────
        email_norm = str(target.get("email") or "").strip().lower()
        if not email_norm:
            raise HTTPException(
                422,
                f"#{target_num:04d} has no email — cannot verify duplicate "
                "status. Use the DB Viewer if this row needs manual removal.",
            )

        # Fetch every candidate keeper for this email — same normalised
        # address, not reserved, not test-flagged, and NOT the target
        # itself. If none exists, the target is unique — refuse.
        cohort = await db.interest_registrations.find(
            {
                "email":       email_norm,
                "is_test":     {"$ne": True},
                "is_reserved": {"$ne": True},
            },
            {"_id": 0},
        ).to_list(None)
        others = [r for r in cohort if r.get("founder_number") != target_num]
        if not others:
            raise HTTPException(
                409,
                f"#{target_num:04d} ({email_norm}) is NOT a duplicate — no "
                "other live row shares that email. Refusing to retire.",
            )

        # Keeper = lowest founder_number (else earliest created_at).
        def _sort_key(r):
            fn = r.get("founder_number")
            fn_key = fn if isinstance(fn, int) else 10**9
            return (fn_key, r.get("created_at") or "")

        candidates = sorted(cohort, key=_sort_key)
        keeper = candidates[0]

        if keeper.get("founder_number") == target_num:
            # Target IS the oldest row — retiring it would orphan the
            # duplicate(s). Refuse; caller should ask us to retire the
            # newer number instead.
            other_numbers = sorted(
                r.get("founder_number") for r in others
                if isinstance(r.get("founder_number"), int)
            )
            raise HTTPException(
                409,
                f"#{target_num:04d} is the OLDEST row for {email_norm} and "
                f"must be preserved as the keeper. Retire one of the newer "
                f"duplicates instead: {[f'#{n:04d}' for n in other_numbers]}.",
            )

        # ── Write audit row, then delete live row ────────────────────
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        audit = dict(target)
        audit.pop("_id", None)
        audit["retired_at"]                    = now
        audit["retire_reason"]                 = (
            f"iter164 admin retire via CMS API of duplicate "
            f"#{target_num:04d} (keeper #{keeper.get('founder_number'):04d})"
        )
        audit["retire_keeper_id"]              = keeper.get("id")
        audit["retire_keeper_founder_number"]  = keeper.get("founder_number")
        audit["retire_admin_id"]               = admin.get("id")
        audit["retire_admin_email"]            = admin.get("email")

        await db.retired_registrations.insert_one(audit)
        del_res = await db.interest_registrations.delete_one(
            {"founder_number": target_num, "email": email_norm},
        )
        if del_res.deleted_count == 0:
            # Somebody else raced us — the audit row we just inserted
            # is still valid (it records what would have been retired),
            # but flag it so admins know.
            return {
                "ok":                True,
                "already_retired":   True,
                "retired_founder_number": target_num,
                "keeper_founder_number":  keeper.get("founder_number"),
                "keeper_id":         keeper.get("id"),
                "note": "Row was already gone at delete time (racy). "
                        "Audit row still written for the trail.",
            }

        return {
            "ok":                     True,
            "retired_founder_number": target_num,
            "retired_id":             target.get("id"),
            "retired_email":          email_norm,
            "keeper_founder_number":  keeper.get("founder_number"),
            "keeper_id":              keeper.get("id"),
            "keeper_created_at":      keeper.get("created_at"),
            "retired_at":             now,
            "retired_by":             admin.get("id"),
        }


    from fastapi.responses import HTMLResponse as _HTMLResponse  # noqa: WPS433

    _EMAIL_PREVIEW_TEMPLATES = [
        {
            "name":        "welcome",
            "label":       "Welcome",
            "category":    "personal",
            "signer":      "companion",       # George or Georgia
            "description": "Sent the first time an account is created and confirmed.",
        },
        {
            "name":        "waitlist",
            "label":       "Waitlist thanks",
            "category":    "personal",
            "signer":      "companion",
            "description": "Sent when someone joins the pre-launch waitlist.",
        },
        {
            "name":        "invitation",
            "label":       "Invitation",
            "category":    "personal",
            "signer":      "companion",
            "description": "Sent when someone is personally invited to FriendPlace.",
        },
        {
            "name":        "announcement",
            "label":       "Founding Member update",
            "category":    "personal",
            "signer":      "companion",
            "description": "The Founding Member Update template — used by campaigns to keep Founding Members in the loop as FriendPlace comes together.",
        },
        {
            "name":        "password_reset",
            "label":       "Password reset",
            "category":    "operational",
            "signer":      "team",
            "description": "Security email with the six-digit reset code.",
        },
        {
            "name":        "support_ack",
            "label":       "Support ack",
            "category":    "operational",
            "signer":      "team",
            "description": "Acknowledgement sent when a support ticket is created.",
        },
    ]

    def _preview_meta(name: str) -> dict:
        """Return the metadata row for the named template, or 404."""
        for row in _EMAIL_PREVIEW_TEMPLATES:
            if row["name"] == name:
                return row
        raise HTTPException(404, f"Unknown email template: {name}")

    def _preview_recipient() -> str:
        """Where 'send test' previews go. Env-overridable so we can
        redirect QA emails to a staging inbox later without a redeploy."""
        return (os.getenv("EMAIL_PREVIEW_RECIPIENT") or "hello@friendplace.com.au").strip()

    def _preview_sample(name: str, companion: str = "george") -> dict:
        """Sample data used for every preview render. Kept in ONE place
        so the list, HTML view, and 'send test' all produce identical
        content — makes the review loop deterministic. Personal
        templates accept a companion flip (george → georgia)."""
        if name == "welcome":
            return dict(
                first_name="Sarah",
                action_url="https://www.friendplace.com.au",
                companion=companion,
            )
        if name == "waitlist":
            return dict(first_name="Sarah", position=42, founder_number=42, companion=companion)
        if name == "invitation":
            return dict(
                first_name="Sarah",
                inviter_name="Michael Chen",
                accept_url="https://www.friendplace.com.au/invite/preview-abc123",
                expiry_days=14,
                companion=companion,
            )
        if name == "announcement":
            return dict(
                first_name="Sarah",
                title="A quiet update from FriendPlace",
                body_md=(
                    "It's been a busy month. We've been quietly welcoming the "
                    "first Founding Members and putting the finishing touches "
                    "on the things you'll see first — a home page that feels "
                    "like a doormat, gentle nudges from a friend rather than "
                    "notifications, and a small Events board that reads like "
                    "an invitation, not a listing.\n\nYou're #{founder_number} "
                    "on the wall — and you'll see that number again once "
                    "we open the doors, quietly, in a few weeks."
                ),
                founder_number=42,
                cta_label=None,
                cta_url=None,
                companion=companion,
            )
        if name == "password_reset":
            return dict(first_name="Sarah", code="493721", ttl_minutes=15)
        if name == "support_ack":
            return dict(
                first_name="Sarah",
                ticket_ref="FP-8A2C91",
                category="Contact Support",
                subject_snippet="Trouble adding a friend from the events page",
            )
        raise HTTPException(404, f"Unknown email template: {name}")

    def _preview_render(
        name: str,
        *,
        companion: str = "george",
        subject_override: Optional[str] = None,
        preheader_override: Optional[str] = None,
        data_overrides: Optional[Dict[str, Any]] = None,
    ) -> tuple[str, str, str]:
        """Return (subject, html, text) for the named template.

        For **previews** in the Email Studio iframe we pass no
        `data_overrides` and the deterministic sample data ("Sarah",
        "Michael Chen", …) fills in — kept identical across the list,
        HTML view and 'Send test' preview so the review loop is
        predictable.

        For **real sends** (the CRM "Compose invitation" flow → the
        Studio's Send button with a live recipient in ?to=), the caller
        passes a `data_overrides` dict carrying that recipient's actual
        first_name, companion choice, invitation accept_url, etc. Those
        values replace the sample data, so the email is genuinely
        personalised. This is the mechanism that makes both send paths
        share the SAME template code and letter design.
        """
        from email_service import (  # noqa: WPS433
            welcome_template,
            waitlist_template,
            invitation_template,
            announcement_template,
            password_reset_template,
            support_acknowledgement_template,
        )
        kwargs = _preview_sample(name, companion=companion)
        # Merge live recipient data over the sample defaults. Only keys
        # the template actually accepts should be forwarded — the samples
        # already enumerate the whole valid set.
        if data_overrides:
            for k, v in data_overrides.items():
                if k in kwargs and v not in (None, ""):
                    kwargs[k] = v
        # iter164p: fields whose "" value is meaningful (blank greeting ==
        # render no greeting line) must bypass the None/"" guard above.
        # `show_founder_badge` accepts explicit True/False — including
        # False, which the general guard would treat as truthy anyway,
        # but keeping the passthrough uniform here.
        if data_overrides is not None:
            if "greeting" in data_overrides:
                kwargs["greeting"] = data_overrides["greeting"]
            if "show_founder_badge" in data_overrides:
                kwargs["show_founder_badge"] = data_overrides["show_founder_badge"]
        # Only pass overrides that are actually set — passing None
        # explicitly would fight the templates' internal defaults.
        if subject_override is not None:
            kwargs["subject_override"] = subject_override
        if preheader_override is not None:
            kwargs["preheader_override"] = preheader_override
        if name == "welcome":
            return welcome_template(**kwargs)
        if name == "waitlist":
            return waitlist_template(**kwargs)
        if name == "invitation":
            return invitation_template(**kwargs)
        if name == "announcement":
            return announcement_template(**kwargs)
        if name == "password_reset":
            # Operational template — companion doesn't apply.
            kwargs.pop("companion", None)
            return password_reset_template(**kwargs)
        if name == "support_ack":
            kwargs.pop("companion", None)
            return support_acknowledgement_template(**kwargs)
        raise HTTPException(404, f"Unknown email template: {name}")

    def _extract_preheader(html: str) -> str:
        """Pull the hidden inbox-preview line out of a rendered letter.

        Every letter-shell renders the preheader inside a
        `display:none` div right at the top of `<body>`. Rather than
        expose it as a return value from every template, we just
        parse it back out for the CMS panel — one place to change if
        the shell layout ever changes.
        """
        import re
        m = re.search(
            r'<div[^>]*display:none[^>]*>\s*([\s\S]*?)\s*</div>',
            html,
        )
        if not m:
            return ""
        return re.sub(r'\s+', ' ', m.group(1)).strip()

    async def _admin_from_query_or_header(
        request: Request,
        token: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Same guarantees as `current_cms_admin`, but also accepts either
        a JWT or a short-lived *preview token* (issued by
        `/email-previews/preview-token`) via `?token=<value>` — so an
        admin can iframe the rendered HTML without leaking their long-
        lived JWT into query strings / browser history / referer headers.

        Preview tokens are opaque random strings, single-purpose (preview
        rendering only), scoped to one admin, and expire after 10 minutes.
        """
        tok = token or ""
        if not tok:
            auth = request.headers.get("authorization", "")
            if auth.lower().startswith("bearer "):
                tok = auth.split(" ", 1)[1].strip()
        if not tok:
            raise HTTPException(401, "Not authenticated")

        # First, try the preview-token path — cheaper, and the common
        # case for iframe hits from the Emails Studio.
        if len(tok) == 64 and all(c in "0123456789abcdef" for c in tok):
            from datetime import datetime, timezone
            row = await db.cms_preview_tokens.find_one({"token": tok}, {"_id": 0})
            if row:
                exp = row.get("expires_at") or ""
                try:
                    expired = datetime.fromisoformat(exp) < datetime.now(timezone.utc)
                except Exception:
                    expired = True
                if expired:
                    raise HTTPException(401, "Preview token expired — please refresh the page")
                admin = await db.cms_admins.find_one(
                    {"id": row["admin_id"]}, {"_id": 0, "password_hash": 0}
                )
                if not admin:
                    raise HTTPException(401, "Admin no longer exists")
                return admin
            # Fall through — the token might still be a legacy short JWT.

        # Fallback: treat as a JWT (kept for backwards compatibility with
        # any deep-links that already used the old scheme).
        payload = _decode(tok, "cms_admin")
        admin = await db.cms_admins.find_one(
            {"id": payload["sub"]}, {"_id": 0, "password_hash": 0}
        )
        if not admin:
            raise HTTPException(401, "Admin no longer exists")
        return admin

    @router.post("/email-previews/preview-token")
    async def email_preview_token(admin: dict = Depends(current_cms_admin)):
        """Mint a short-lived opaque token for the Emails Studio iframe.

        The Studio calls this once per session (or when the previous
        token nears expiry), then uses the returned token in the iframe
        `?token=…` query. This keeps the admin's long-lived JWT out of
        browser history, referrer headers, and any accidental screenshots
        of the URL bar.

        Tokens auto-expire after 10 minutes and are single-purpose —
        they only grant read of the email preview endpoints.
        """
        import secrets
        from datetime import datetime, timezone, timedelta
        token = secrets.token_hex(32)  # 64 hex chars
        now = datetime.now(timezone.utc)
        expires = now + timedelta(minutes=10)
        await db.cms_preview_tokens.insert_one({
            "token":      token,
            "admin_id":   admin["id"],
            "created_at": now.isoformat(),
            "expires_at": expires.isoformat(),
            "purpose":    "email_preview",
        })
        # Opportunistic sweep of stale tokens — keeps the collection tiny.
        try:
            await db.cms_preview_tokens.delete_many(
                {"expires_at": {"$lt": now.isoformat()}}
            )
        except Exception:
            pass
        return {
            "token":      token,
            "expires_at": expires.isoformat(),
            "ttl_seconds": 600,
        }

    @router.get("/email-previews")
    async def list_email_previews(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """List the transactional email templates available for preview,
        along with the default subject + preheader for each so the CMS
        panel can render editable fields at first paint (no second
        round-trip)."""
        from email_service import is_configured as _resend_ready  # noqa: WPS433
        items: list[dict] = []
        for meta in _EMAIL_PREVIEW_TEMPLATES:
            subject, html, _text = _preview_render(meta["name"])
            preheader = _extract_preheader(html)
            items.append({
                **meta,
                "default_subject":   subject,
                "default_preheader": preheader,
                "html_url":          f"/api/cms/email-previews/{meta['name']}.html",
                "render_url":        f"/api/cms/email-previews/{meta['name']}/render",
                "send_url":          f"/api/cms/email-previews/{meta['name']}/send",
            })
        return {
            "recipient":         _preview_recipient(),
            "resend_configured": _resend_ready(),
            "templates":         items,
        }

    @router.get("/email-previews/{name}.html", response_class=_HTMLResponse)
    async def email_preview_html(
        name: str,
        request: Request,
        token: Optional[str] = None,
        companion: str = "george",
        subject: Optional[str] = None,
        preheader: Optional[str] = None,
    ):
        """Render one template as a full HTML page (browser-viewable +
        iframe-safe). All render knobs are query params so the CMS
        panel can iframe with `?companion=georgia&subject=...&preheader=...`
        and re-render instantly on edit.

        Auth: `?token=<jwt>` or `Authorization: Bearer <jwt>`.
        """
        await _admin_from_query_or_header(request, token)
        _subject, html, _text = _preview_render(
            name,
            companion=companion or "george",
            subject_override=subject,
            preheader_override=preheader,
        )
        return _HTMLResponse(content=html, status_code=200)

    @router.post("/email-previews/{name}/render")
    async def email_preview_render(
        name: str,
        payload: Dict[str, Any] = None,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Return the fully-rendered subject / preheader / html / text
        for the named template with the caller's overrides applied.
        Used by the CMS panel to run its 'responsive validation'
        checks (subject/preheader length, presence of key elements)
        before enabling the Send Test button.
        """
        p = payload or {}
        companion = str(p.get("companion") or "george")
        subject_override = p.get("subject")
        preheader_override = p.get("preheader")
        subject, html, text = _preview_render(
            name,
            companion=companion,
            subject_override=(subject_override.strip() if isinstance(subject_override, str) and subject_override.strip() else None),
            preheader_override=(preheader_override.strip() if isinstance(preheader_override, str) and preheader_override.strip() else None),
        )
        preheader_out = _extract_preheader(html)
        return {
            "name":         name,
            "subject":      subject,
            "preheader":    preheader_out,
            "html":         html,
            "text":         text,
            "companion":    companion,
        }

    @router.post("/email-previews/{name}/send")
    async def email_preview_send(
        name: str,
        payload: Dict[str, Any] = None,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Send the rendered template to `EMAIL_PREVIEW_RECIPIENT`
        via Resend, applying the caller's overrides. Every preview
        message is prefixed with `[TEST]` in the subject so nobody
        confuses it with the real thing landing in the same inbox.

        The response includes the Resend message ID on success and
        the actual error text on failure — that way the CMS panel
        can display honest status (never "Sent" when the API refused
        the request) and operators have an ID to trace in the Resend
        dashboard for delivery status.
        """
        from email_service import (  # noqa: WPS433
            is_configured as _resend_ready,
            send_email_detailed,
            _config as _email_config,
        )
        p = payload or {}
        companion = str(p.get("companion") or "george")
        subject_override = p.get("subject")
        preheader_override = p.get("preheader")
        # Optional per-recipient override — used by the Founding Members
        # CRM "Email {name}" button. When present, the mail is sent to
        # that address (NOT prefixed with [TEST], since it's a real send)
        # and, if it maps to a Founding Member awaiting contact, the
        # CRM status is automatically advanced to "invited" with the
        # send captured in history. This is the mechanism that keeps
        # the CRM reflecting reality rather than intent.
        to_override_raw = p.get("to")
        to_override = (
            to_override_raw.strip().lower()
            if isinstance(to_override_raw, str) and "@" in to_override_raw
            else None
        )
        is_test_mode = to_override is None

        # Look up the founder BEFORE rendering, so their real first_name,
        # companion choice, etc. can replace the "Sarah" sample data
        # baked into the preview. This is the fix that makes real
        # invitations say "Dear Steven" instead of "Dear Sarah".
        founder_row: Optional[Dict[str, Any]] = None
        if to_override:
            try:
                founder_row = await db.interest_registrations.find_one(
                    {"email": to_override},
                    {"_id": 0, "id": 1, "first_name": 1,
                     "companion_choice": 1, "status": 1, "history": 1,
                     "founder_number": 1},
                )
            except Exception:
                founder_row = None

        # Build live-data overrides for the template render. Empty when
        # sending a [TEST] preview — that path keeps the sample data
        # so admins can review the design deterministically.
        data_overrides: Dict[str, Any] = {}
        if founder_row and not is_test_mode:
            fname = founder_row.get("first_name")
            if fname:
                data_overrides["first_name"] = fname
            # If the founder chose Georgia, honour that in personal
            # letters — otherwise keep whatever companion the admin
            # picked in the Studio dropdown.
            if founder_row.get("companion_choice"):
                companion = founder_row["companion_choice"]
                data_overrides["companion"] = companion
            # Founding Member Number — permanent, shown proudly in
            # the acknowledgement (waitlist) template. Invitations
            # don't include it in the body; the CRM already carries
            # that identity beside their name.
            if founder_row.get("founder_number"):
                data_overrides["founder_number"] = founder_row["founder_number"]
            # Personal accept URL — Phase-2 will replace this with a
            # signed one-time invite token. For now the founder's ID
            # is enough to disambiguate and the URL is unguessable.
            if name == "invitation":
                base_url = (os.getenv("PUBLIC_WEBSITE_URL") or "https://www.friendplace.com.au").rstrip("/")
                data_overrides["accept_url"] = f"{base_url}/invite/{founder_row['id']}"
                # Personal invitations aren't from "Michael Chen" — drop
                # the sample inviter so the letter reads "someone at
                # FriendPlace" (or, later, a real inviter name).
                data_overrides["inviter_name"] = ""

        subject, html, text = _preview_render(
            name,
            companion=companion,
            subject_override=(subject_override.strip() if isinstance(subject_override, str) and subject_override.strip() else None),
            preheader_override=(preheader_override.strip() if isinstance(preheader_override, str) and preheader_override.strip() else None),
            data_overrides=data_overrides or None,
        )
        to_addr = to_override or _preview_recipient()
        final_subject = f"[TEST] {subject}" if is_test_mode else subject
        _api_key, from_email, from_name, _reply_to = _email_config()
        from_field = f"{from_name} <{from_email}>" if from_name else from_email

        if not _resend_ready():
            return {
                "ok":            False,
                "sent":          False,
                "reason":        "RESEND_API_KEY not configured on backend",
                "error_code":    "api_key_missing",
                "recipient":     to_addr,
                "subject":       final_subject,
                "sender":        from_field,
            }

        result = await send_email_detailed(
            to=to_addr,
            subject=final_subject,
            html=html,
            text=text,
        )
        # Record every send in a small append-only log so the
        # "Most recent test send" strip on the Sending Health panel
        # can show the truest ground-truth status without having to
        # scan the entire Resend history.
        founder_status_change: Optional[Dict[str, Any]] = None
        if result.ok and result.message_id:
            try:
                await db.email_test_log.insert_one({
                    "message_id":  result.message_id,
                    "template":    name,
                    "companion":   companion if _preview_meta(name).get("category") == "personal" else None,
                    "recipient":   to_addr,
                    "subject":     final_subject,
                    "sender":      from_field,
                    "created_at":  now_iso() if callable(globals().get("now_iso")) else __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
                    "sent_by":     admin.get("id") if isinstance(admin, dict) else None,
                    "mode":        "test" if is_test_mode else "real",
                })
            except Exception:
                # Logging failure must never break the actual send flow.
                pass
            # Auto-advance Founding Member status when we successfully
            # emailed them a real (non-[TEST]) message. This is the
            # workflow-of-record that keeps the CRM honest: "Invited"
            # means an invitation was actually sent, not just intended.
            if not is_test_mode and to_override:
                try:
                    from datetime import datetime, timezone
                    now = datetime.now(timezone.utc).isoformat()
                    # Re-fetch to grab the freshest status + history —
                    # `founder_row` from earlier only projected the
                    # fields needed for template rendering.
                    founder = await db.interest_registrations.find_one(
                        {"email": to_override},
                        {"_id": 0, "id": 1, "status": 1, "history": 1},
                    )
                    if founder:
                        current_status = (founder.get("status") or "registered").lower()
                        # Only auto-transition from registered/new. Never
                        # regress from joined or opted_out.
                        if current_status in ("registered", "new", ""):
                            history = list(founder.get("history") or [])
                            history.append({
                                "at":         now,
                                "from":       current_status or "registered",
                                "to":         "invited",
                                "actor_id":   admin.get("id") if isinstance(admin, dict) else None,
                                "actor_email": admin.get("email") if isinstance(admin, dict) else None,
                                "reason":     "email_sent",
                                "template":   name,
                                "subject":    final_subject,
                                "message_id": result.message_id,
                            })
                            await db.interest_registrations.update_one(
                                {"id": founder["id"]},
                                {"$set": {
                                    "status":     "invited",
                                    "invited_at": now,
                                    "history":    history,
                                    "updated_at": now,
                                }},
                            )
                            founder_status_change = {
                                "founder_id":  founder["id"],
                                "from_status": current_status or "registered",
                                "to_status":   "invited",
                                "at":          now,
                            }
                        else:
                            # Still record the send in history without
                            # changing the status, so campaigns log
                            # every touchpoint.
                            history = list(founder.get("history") or [])
                            history.append({
                                "at":         now,
                                "from":       current_status,
                                "to":         current_status,   # no status change
                                "actor_id":   admin.get("id") if isinstance(admin, dict) else None,
                                "actor_email": admin.get("email") if isinstance(admin, dict) else None,
                                "reason":     "email_sent_no_status_change",
                                "template":   name,
                                "subject":    final_subject,
                                "message_id": result.message_id,
                            })
                            await db.interest_registrations.update_one(
                                {"id": founder["id"]},
                                {"$set": {"history": history, "updated_at": now}},
                            )
                except Exception:
                    # Never let the CRM auto-update break the actual
                    # send response — operators still need to know
                    # the mail went out.
                    import logging as _logging
                    _logging.getLogger("friendplace.email").exception("Founder auto-status advance failed")
        return {
            "ok":            result.ok,
            "sent":          result.ok,
            "recipient":     to_addr,
            "subject":       final_subject,
            "sender":        from_field,
            "message_id":    result.message_id,
            "http_status":   result.http_status,
            "reason":        result.error,
            "error_code":    result.error_code,
            "mode":          "test" if is_test_mode else "real",
            "founder_status_change": founder_status_change,
            "dashboard_url": (
                f"https://resend.com/emails/{result.message_id}"
                if result.message_id else None
            ),
            # Honest disclosure to the panel: this is delivery *acceptance*
            # by Resend, not proof of inbox delivery. Operators must
            # confirm final state (Sent / Queued / Delivered / Bounced
            # / Rejected) in the Resend dashboard using message_id.
            "delivery_note": (
                "Resend accepted the message. Live delivery status will "
                "appear here as it progresses through the pipeline."
                if result.ok else None
            ),
        }

    @router.post("/email-previews/send-all")
    async def email_preview_send_all(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """One-click: send every preview template (defaults, no
        overrides) to the configured recipient. Handy for full-suite
        review after a design change."""
        from email_service import (  # noqa: WPS433
            is_configured as _resend_ready,
            send_email_detailed,
        )
        to_addr = _preview_recipient()
        if not _resend_ready():
            return {
                "ok":        False,
                "sent":      0,
                "reason":    "RESEND_API_KEY not configured on backend",
                "recipient": to_addr,
            }
        results: list[dict] = []
        for tpl in _EMAIL_PREVIEW_TEMPLATES:
            subject, html, text = _preview_render(tpl["name"])
            final_subject = f"[TEST] {subject}"
            r = await send_email_detailed(
                to=to_addr,
                subject=final_subject,
                html=html,
                text=text,
            )
            results.append({
                "name":        tpl["name"],
                "sent":        r.ok,
                "subject":     final_subject,
                "message_id":  r.message_id,
                "http_status": r.http_status,
                "reason":      r.error,
                "error_code":  r.error_code,
            })
        return {
            "ok":        all(r["sent"] for r in results),
            "sent":      sum(1 for r in results if r["sent"]),
            "recipient": to_addr,
            "results":   results,
        }

    # ─── Campaigns (Phase 2A) ───────────────────────────────────────
    #
    # A campaign is a one-shot bulk send targeted at a slice of the
    # Founding Members CRM. Every send reuses the same letter-style
    # templates already wired for individual sends — same look, same
    # personalisation (first_name, founder_number, companion) — so a
    # campaign email is byte-identical to what a founder would receive
    # as an individual message.
    #
    # Two collections:
    #   • campaigns             – one doc per campaign (draft or sent)
    #   • campaign_recipients   – one doc per recipient (audit trail)
    #
    # Sending is throttled to ~8 emails/second (5 in parallel, 500 ms
    # between batches), well under Resend's 10 req/s cap.

    _CAMPAIGN_TEMPLATES = {"announcement", "invitation", "welcome"}

    def _build_audience_query(f: Dict[str, Any]) -> Dict[str, Any]:
        """Turn a campaign's audience filter into a Mongo query."""
        q: Dict[str, Any] = {"is_test": {"$ne": True}}
        if f.get("exclude_reserved", True):
            q["is_reserved"] = {"$ne": True}
        statuses = [s for s in (f.get("statuses") or []) if s in _FM_STATUSES]
        or_clauses: list[dict] = []
        if statuses:
            if "registered" in statuses:
                other = [s for s in statuses if s != "registered"]
                clause: dict = {"$or": [
                    {"status": {"$exists": False}},
                    {"status": None},
                    {"status": {"$in": ["registered", "new"] + other}},
                ]}
                or_clauses.append(clause)
            else:
                q["status"] = {"$in": statuses}
        elif f.get("exclude_opted_out", True):
            q["status"] = {"$ne": "opted_out"}
        tags_any = [str(t) for t in (f.get("tags_any") or []) if str(t).strip()]
        tags_all = [str(t) for t in (f.get("tags_all") or []) if str(t).strip()]
        if tags_any:
            q["tags"] = {"$in": tags_any}
        if tags_all:
            q["tags"] = {"$all": tags_all}
        if or_clauses:
            existing_and = q.pop("$and", [])
            q["$and"] = existing_and + or_clauses
        return q

    # ─── iter164r: campaign attachment helpers ─────────────────────
    # Per Garry (24 Aug 2026): "Real file attachments on outreach
    # campaigns — PDFs first, so we can send retirement-village
    # flyers to Outreach contacts without leaving the composer."
    #
    # Scope for the MVP:
    #   • PDFs only (application/pdf)
    #   • 5 MB hard cap per attachment
    #   • Base64 content stored inline on the campaign document
    #     (single ~5 MB PDF stays well within Mongo's 16 MB doc limit)
    #   • Mutation only while the campaign is still a draft
    #   • Attach behaviour is gated by an explicit boolean flag
    #     (`attach_file`, default OFF) so an uploaded file can be
    #     staged without automatically going out on the next send.
    _CAMPAIGN_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024  # 5 MB
    _CAMPAIGN_ATTACHMENT_ALLOWED_TYPES = {"application/pdf"}

    def _attachment_meta(att: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Return the public-facing subset of an attachment record.

        Callers get ``filename``, ``content_type``, ``size`` and
        ``uploaded_at`` — never the base64 bytes — so list/detail
        response payloads stay small and the composer can render a
        chip like "flyer.pdf · 214 KB" without a second round-trip.
        """
        if not isinstance(att, dict):
            return None
        if not att.get("filename"):
            return None
        return {
            "filename":     att.get("filename"),
            "content_type": att.get("content_type"),
            "size":         att.get("size"),
            "uploaded_at":  att.get("uploaded_at"),
        }

    def _campaign_summary(c: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id":              c.get("id"),
            "name":            c.get("name"),
            "template":        c.get("template"),
            "subject":         c.get("subject"),
            "preheader":       c.get("preheader"),
            "companion":       c.get("companion"),
            "title":           c.get("title"),
            "body_md":         c.get("body_md"),
            "cta_label":       c.get("cta_label"),
            "cta_url":         c.get("cta_url"),
            # iter164p — surface the new editable fields on read so the
            # composer can hydrate its greeting + founder-badge controls.
            "greeting":            c.get("greeting"),
            "show_founder_badge":  c.get("show_founder_badge"),
            # iter164r — attachment metadata only (never `content_b64`);
            # composers show the filename+size, the send worker reads the
            # full document to pull the base64 bytes.
            "attachment":      _attachment_meta(c.get("attachment")),
            # iter164r — explicit boolean flag deciding whether the
            # uploaded attachment (if any) is actually included with
            # the outgoing email. Defaults False so an admin can stage
            # a file without it going out on the next Send.
            "attach_file":     bool(c.get("attach_file")),
            "audience_filter": c.get("audience_filter") or {},
            "status":          c.get("status") or "draft",
            "stats":           c.get("stats") or {
                "targeted": 0, "accepted": 0, "failed": 0,
                "delivered": 0, "opened": 0, "clicked": 0, "bounced": 0,
            },
            "created_at":      c.get("created_at"),
            "created_by":      c.get("created_by"),
            "scheduled_at":    c.get("scheduled_at"),
            "sent_at":         c.get("sent_at"),
            "finished_at":     c.get("finished_at"),
            "sample_html":     c.get("sample_html"),
            # iter164ac — soft-archive metadata. Sent campaigns are
            # permanent (never hard-deleted); an admin can archive
            # them to hide from the default list while preserving
            # every recipient row, delivery record, message-id and
            # rendered sample HTML for audit + recovery.
            "is_archived":     bool(c.get("archived_at")),
            "archived_at":     c.get("archived_at"),
            "archived_by":     c.get("archived_by"),
            "archived_by_email": c.get("archived_by_email"),
        }

    async def _resolve_audience(f: Dict[str, Any], limit: int = 5000) -> list[dict]:
        """iter160a: dispatch across five audience kinds.

        f.audience_kind can be:
          - 'founding_members' (default; original behaviour)
          - 'saved_segment'    -> uses f.segment_id
          - 'custom_filter'    -> uses f.filter (a segment-shape filter, not saved)
          - 'outreach_contacts' -> f.outreach.{category, tags_any, status, ids}
          - 'manual_list'      -> f.manual_recipients: list of {name, email}
                                                       OR one-per-line strings
          - 'individual'       -> f.recipient_email + f.recipient_name

        Returns a normalised list of {id, first_name, email, companion_choice,
        founder_number, status, tags, organisation_name?} so the rest of the
        send pipeline is agnostic to the source.
        """
        kind = str((f or {}).get("audience_kind") or "").strip().lower()

        # iter161 defensive auto-detect (25 Feb 2026 production regression):
        # A draft saved by pre-iter161 frontend code could end up with
        # outreach/manual/individual data in its filter but no
        # audience_kind marker — the resolver would then silently fall
        # through to the founding_members query, returning a count that
        # tracks Founding Member registrations rather than the audience
        # Garry actually chose. Guard against that here by inferring the
        # kind from the filter's shape when the marker is absent AND the
        # shape is unambiguous. We refuse to guess when the filter is
        # empty or founding-member-shaped — those correctly default to
        # the historical founding_members path.
        if not kind:
            _outreach_spec = f.get("outreach") if isinstance(f, dict) else None
            _has_outreach = (
                isinstance(_outreach_spec, dict)
                and any(_outreach_spec.get(k) for k in ("category", "status", "tags_any", "ids"))
            )
            _has_manual = bool((f or {}).get("manual_recipients"))
            _has_individual = bool((f or {}).get("recipient_email"))
            # Founding-member shape has none of these three, so we only
            # override the default when one of them is present.
            import logging as _logging
            _log = _logging.getLogger("friendplace.campaigns")
            if _has_outreach and not (_has_manual or _has_individual):
                _log.warning(
                    "audience resolver: missing audience_kind, auto-routing to "
                    "outreach_contacts based on filter shape: %r",
                    _outreach_spec,
                )
                kind = "outreach_contacts"
            elif _has_manual and not (_has_outreach or _has_individual):
                _log.warning(
                    "audience resolver: missing audience_kind, auto-routing to "
                    "manual_list based on filter shape",
                )
                kind = "manual_list"
            elif _has_individual and not (_has_outreach or _has_manual):
                _log.warning(
                    "audience resolver: missing audience_kind, auto-routing to "
                    "individual based on filter shape",
                )
                kind = "individual"
            # else: safely fall through to founding_members (original behaviour).

        # -- 5) Individual send --
        if kind == "individual":
            addr = str(f.get("recipient_email") or "").strip()
            if not addr:
                return []
            return [{
                "id": None,
                "first_name": (f.get("recipient_name") or "").split(" ", 1)[0],
                "email": addr,
                "companion_choice": None,
                "founder_number": None,
                "status": None,
                "tags": [],
            }][:limit]

        # -- 4) Manual list (pasted addresses) --
        if kind == "manual_list":
            raw = f.get("manual_recipients") or []
            parsed: list[dict] = []
            if isinstance(raw, str):
                raw = raw.splitlines()
            seen: set = set()
            for item in raw:
                if isinstance(item, dict):
                    e = str(item.get("email") or "").strip().lower()
                    n = str(item.get("name") or "").strip()
                elif isinstance(item, str):
                    line = item.strip()
                    if not line: continue
                    # Support "Name <email>" and "Name | email" and bare "email"
                    if "|" in line:
                        n, e = [p.strip() for p in line.split("|", 1)]
                        e = e.lower()
                    elif "<" in line and line.endswith(">"):
                        n, rest = line.split("<", 1)
                        n, e = n.strip(), rest[:-1].strip().lower()
                    else:
                        n, e = "", line.lower()
                else:
                    continue
                if not e or "@" not in e or e in seen: continue
                seen.add(e)
                parsed.append({
                    "id": None,
                    "first_name": n.split(" ", 1)[0] if n else "",
                    "email": e,
                    "companion_choice": None,
                    "founder_number": None,
                    "status": None,
                    "tags": [],
                    "recipient_name": n,
                })
            return parsed[:limit]

        # -- 3) Outreach contacts --
        if kind == "outreach_contacts":
            from services.outreach.store import COLL_ORGS, normalise_category
            oq: Dict[str, Any] = {"is_test": {"$ne": True}}
            spec = f.get("outreach") or {}
            # iter161b (25 Feb 2026): normalise the category so a user
            # typing "retirement village" or "Retirement Village" also
            # matches the stored "retirement_village" key. Stored
            # values are never rewritten — only the query is
            # canonicalised. Empty / None passes through untouched.
            _cat = normalise_category(spec.get("category"))
            if _cat:                 oq["category"] = _cat
            if spec.get("status"):   oq["status"] = spec["status"]
            if spec.get("tags_any"): oq["tags"] = {"$in": list(spec["tags_any"])}
            if spec.get("ids"):      oq["id"] = {"$in": list(spec["ids"])}
            cur = db[COLL_ORGS].find(oq, {"_id": 0}).sort("updated_at", -1).limit(limit)
            out: list[dict] = []
            async for org in cur:
                out.append({
                    "id":               org.get("id"),
                    "first_name":       (org.get("contact_name") or "").split(" ", 1)[0],
                    "email":            org.get("email"),
                    "companion_choice": None,
                    "founder_number":   None,
                    "status":           org.get("status"),
                    "tags":             org.get("tags") or [],
                    "recipient_name":   org.get("contact_name"),
                    "organisation_name": org.get("organisation_name"),
                    "outreach_id":      org.get("id"),
                })
            return out

        # -- Default & 2) Founding-member-shaped (original behaviour) --
        q = _build_audience_query(f)
        # Saved segment intersection (existing behaviour preserved).
        segment_id = (f or {}).get("segment_id")
        if segment_id:
            from services import segments as _segments
            seg_emails = await _segments.resolve_segment_emails(db, segment_id)
            if not seg_emails:
                return []
            # Case-insensitive email match — interest_registrations may
            # have stored emails with mixed case.
            import re
            regexes = [
                {"$regex": f"^{re.escape(e)}$", "$options": "i"}
                for e in seg_emails
            ]
            existing_and = q.pop("$and", [])
            q["$and"] = existing_and + [{"$or": [{"email": r} for r in regexes]}]
        return await db.interest_registrations.find(
            q,
            {"_id": 0, "id": 1, "first_name": 1, "email": 1,
             "companion_choice": 1, "founder_number": 1, "status": 1, "tags": 1},
        ).sort([("founder_number", 1)]).to_list(limit)

    @router.get("/campaigns")
    async def campaigns_list(
        include_archived: bool = False,
        archived: bool = False,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """List campaigns.

        iter164ac — soft-archive filter:
          • Default (`include_archived=false`, `archived=false`) →
            only non-archived campaigns. This is what the composer's
            Campaigns list has always shown.
          • `?include_archived=true` → non-archived AND archived
            (union — full audit view).
          • `?archived=true` → archived campaigns ONLY (recovery /
            audit page).

        Archived campaigns are never hard-deleted; their `_id`,
        `recipients` sub-collection rows, message-ids, delivery
        history, stats, and `sample_html` are all preserved
        untouched — only the top-level `archived_at` /
        `archived_by` fields are added.
        """
        if archived:
            q = {"archived_at": {"$ne": None, "$exists": True}}
        elif include_archived:
            q = {}
        else:
            # Match documents where archived_at is missing OR None.
            q = {"$or": [{"archived_at": {"$exists": False}}, {"archived_at": None}]}
        rows = await db.campaigns.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"count": len(rows), "rows": [_campaign_summary(r) for r in rows]}

    @router.post("/campaigns")
    async def campaigns_create(payload: Dict[str, Any], admin: dict = Depends(current_cms_admin)):
        from datetime import datetime, timezone
        template = str(payload.get("template") or "announcement").lower()
        if template not in _CAMPAIGN_TEMPLATES:
            raise HTTPException(400, f"template must be one of {sorted(_CAMPAIGN_TEMPLATES)}")
        name = (str(payload.get("name") or "").strip() or "Untitled campaign")[:200]
        now = datetime.now(timezone.utc).isoformat()
        campaign = {
            "id":              str(uuid.uuid4()),
            "name":            name,
            "template":        template,
            "subject":         str(payload.get("subject") or "")[:200],
            "preheader":       str(payload.get("preheader") or "")[:200],
            "companion":       str(payload.get("companion") or "george"),
            "title":           str(payload.get("title") or "")[:200],
            "body_md":         str(payload.get("body_md") or "")[:20000],
            "cta_label":       str(payload.get("cta_label") or "")[:60],
            "cta_url":         str(payload.get("cta_url") or "")[:500],
            # iter164p: new fields. `greeting` is a literal template string
            # (may contain the "[Contact name]" placeholder that gets
            # substituted per-recipient at render time). Storing None means
            # "unset -> fall back to the legacy Dear {first_name}, greeting".
            # Storing "" means "no greeting line".
            # `show_founder_badge` toggles the Founding Member pill. None
            # means "legacy behaviour (show if founder_number is set)".
            "greeting":        (payload["greeting"][:200]
                                if isinstance(payload.get("greeting"), str) else None),
            "show_founder_badge": (payload["show_founder_badge"]
                                if isinstance(payload.get("show_founder_badge"), bool) else None),
            # iter164r: attachment metadata. Populated by the dedicated
            # upload endpoint (POST /campaigns/{id}/attachment). Storing
            # base64 content inline keeps the model self-contained for
            # the MVP (single ~5 MB PDF is well within Mongo's 16 MB
            # document limit); projections in list/detail responses
            # strip `content_b64` so response payloads stay small.
            "attachment":      None,
            # iter164r: explicit include-in-outgoing-email flag. Kept
            # separate from `attachment` so admins can upload/stage a
            # file without automatically shipping it on the next send.
            # Accepted on create for symmetry with PATCH; defaults False.
            "attach_file":     bool(payload.get("attach_file")) if "attach_file" in payload else False,
            "audience_filter": payload.get("audience_filter") or {},
            "status":          "draft",
            "stats":           {"targeted": 0, "accepted": 0, "failed": 0,
                                "delivered": 0, "opened": 0, "clicked": 0, "bounced": 0},
            "created_at":      now,
            "created_by":      admin.get("id"),
            "created_by_email": admin.get("email"),
        }
        await db.campaigns.insert_one(dict(campaign))
        return _campaign_summary(campaign)

    @router.get("/campaigns/{campaign_id}")
    async def campaigns_get(campaign_id: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        recipients = await db.campaign_recipients.find(
            {"campaign_id": campaign_id}, {"_id": 0}
        ).sort([("founder_number", 1)]).to_list(1000)
        return {**_campaign_summary(c), "recipients": recipients}

    @router.get("/campaigns/{campaign_id}/recipients/{recipient_id}/timeline")
    async def campaigns_recipient_timeline(
        campaign_id: str,
        recipient_id: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Per-recipient event history for the drill-down modal.

        Locked with Garry 1 Aug 2026: *"Every email is a timeline, not
        just a status."* Returns the ordered event log so support can
        answer "she says she never received it" with a real answer.
        """
        recip = await db.campaign_recipients.find_one(
            {"id": recipient_id, "campaign_id": campaign_id}, {"_id": 0},
        )
        if not recip:
            raise HTTPException(404, "Recipient not found on this campaign")
        events = await db.campaign_recipient_events.find(
            {"recipient_id": recipient_id, "campaign_id": campaign_id},
            {"_id": 0, "type": 1, "at": 1, "meta": 1},
        ).sort([("at", 1)]).to_list(200)
        # Prepend a "sent" pseudo-event from the recipient row itself,
        # so campaigns predating the webhook receiver still show a
        # complete timeline (Resend can also emit email.sent AFTER we
        # inserted the recipient, which we merge with dedupe).
        if recip.get("sent_at"):
            has_sent = any(e.get("type") == "email.sent" for e in events)
            if not has_sent:
                events.insert(0, {
                    "type": "email.sent",
                    "at":   recip["sent_at"],
                    "meta": {"subject": recip.get("subject")},
                })
        return {"recipient": recip, "events": events}

    @router.patch("/campaigns/{campaign_id}")
    async def campaigns_update(campaign_id: str, payload: Dict[str, Any],
                               admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        if c.get("status") != "draft":
            raise HTTPException(400, "Only drafts can be edited")
        updates: Dict[str, Any] = {}
        for key in ("name", "template", "subject", "preheader", "companion",
                    "title", "body_md", "cta_label", "cta_url", "audience_filter",
                    # iter164p — accept new editable fields on PATCH.
                    "greeting", "show_founder_badge",
                    # iter164r — accept the include-in-outgoing-email flag.
                    # The attachment bytes themselves are only mutated via
                    # POST/DELETE /campaigns/{id}/attachment.
                    "attach_file"):
            if key in payload:
                updates[key] = payload[key]
        # iter164p normalisation. Accept:
        #   greeting            : str | null   (null == "unset")
        #   show_founder_badge  : bool | null  (null == "unset")
        if "greeting" in updates and updates["greeting"] is not None:
            updates["greeting"] = str(updates["greeting"])[:200]
        if "show_founder_badge" in updates and updates["show_founder_badge"] is not None:
            if not isinstance(updates["show_founder_badge"], bool):
                # Coerce loosely-typed clients (e.g. checkbox strings).
                updates["show_founder_badge"] = str(updates["show_founder_badge"]).lower() in ("true", "1", "yes", "on")
        # iter164r: `attach_file` is strictly boolean. Coerce loose
        # truthy strings/ints for the same reason we coerce
        # `show_founder_badge` — some form serialisers ship checkboxes
        # as "on"/"1"/"true" rather than a JSON bool.
        if "attach_file" in updates:
            v = updates["attach_file"]
            if not isinstance(v, bool):
                updates["attach_file"] = str(v).lower() in ("true", "1", "yes", "on")
        if "template" in updates and updates["template"] not in _CAMPAIGN_TEMPLATES:
            raise HTTPException(400, "Unknown template")
        from datetime import datetime, timezone
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.campaigns.update_one({"id": campaign_id}, {"$set": updates})
        c2 = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        return _campaign_summary(c2)

    @router.delete("/campaigns/{campaign_id}")
    async def campaigns_delete(campaign_id: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        if c.get("status") not in ("draft", "scheduled"):
            raise HTTPException(400, "Sent campaigns are permanent — they can't be deleted")
        await db.campaigns.delete_one({"id": campaign_id})
        return {"ok": True}

    # ─── iter164ac: soft archive / unarchive for sent campaigns ────
    # Design contract with Garry (25 Aug 2026):
    #   • Sent campaigns are permanent — never hard-deleted.
    #   • Archive is a bookkeeping flip only. It NEVER touches
    #     recipient rows, delivery history, stats, message IDs, the
    #     rendered sample HTML, or the audience filter. Rendering
    #     and send behaviour are unchanged.
    #   • Only completed campaigns (status ∈ {sent, failed}) can be
    #     archived. In-flight campaigns (`sending`) MUST NOT be
    #     archived — closing the door while people are walking
    #     through it is a footgun.
    #   • Drafts and scheduled campaigns keep the DELETE path; they
    #     never need archiving because they can be removed outright.
    _ARCHIVABLE_STATUSES = {"sent", "failed"}

    @router.post("/campaigns/{campaign_id}/archive")
    async def campaigns_archive(
        campaign_id: str,
        admin: dict = Depends(current_cms_admin),
    ):
        from datetime import datetime, timezone
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        status = (c.get("status") or "").lower()
        if status not in _ARCHIVABLE_STATUSES:
            raise HTTPException(
                400,
                f"Only completed campaigns can be archived "
                f"(status must be one of {sorted(_ARCHIVABLE_STATUSES)}; "
                f"got {status!r}).",
            )
        if c.get("archived_at"):
            # Idempotent: archiving an already-archived campaign is a
            # no-op. Returning the current metadata keeps client
            # retry logic simple.
            return {
                "ok":             True,
                "id":             c.get("id"),
                "status":         c.get("status"),
                "is_archived":    True,
                "archived_at":    c.get("archived_at"),
                "archived_by":    c.get("archived_by"),
                "archived_by_email": c.get("archived_by_email"),
                "already_archived": True,
            }
        now = datetime.now(timezone.utc).isoformat()
        await db.campaigns.update_one(
            {"id": campaign_id},
            {"$set": {
                "archived_at":       now,
                "archived_by":       admin.get("id"),
                "archived_by_email": admin.get("email"),
                # NB: we intentionally do NOT touch `status` — the
                # domain fact "this campaign was sent" is separate
                # from the UI fact "we've filed it away".
            }},
        )
        return {
            "ok":                True,
            "id":                campaign_id,
            "status":            c.get("status"),
            "is_archived":       True,
            "archived_at":       now,
            "archived_by":       admin.get("id"),
            "archived_by_email": admin.get("email"),
            "already_archived":  False,
        }

    @router.post("/campaigns/{campaign_id}/unarchive")
    async def campaigns_unarchive(
        campaign_id: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Restore a soft-archived campaign so it shows in the default
        list again. Idempotent: unarchiving a campaign that isn't
        archived returns ``{ok: true, already_active: true}``.
        """
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        if not c.get("archived_at"):
            return {
                "ok":              True,
                "id":              c.get("id"),
                "status":          c.get("status"),
                "is_archived":     False,
                "already_active":  True,
            }
        await db.campaigns.update_one(
            {"id": campaign_id},
            {"$unset": {
                "archived_at":       "",
                "archived_by":       "",
                "archived_by_email": "",
            }},
        )
        return {
            "ok":              True,
            "id":              campaign_id,
            "status":          c.get("status"),
            "is_archived":     False,
            "already_active":  False,
        }

    @router.post("/campaigns/{campaign_id}/preview-audience")
    async def campaigns_preview_audience(campaign_id: str,
                                         admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        recipients = await _resolve_audience(c.get("audience_filter") or {}, limit=1000)
        return {"count": len(recipients), "sample": recipients[:10]}

    # iter164ag — Reconcile campaign stats from the raw Resend webhook
    # event log. Admins use this when a campaign's live rollup drifted
    # from the raw log (e.g. the webhook secret was rotated mid-send,
    # or events arrived while a bug in the receiver was in play). The
    # operation is idempotent — replays every raw event we accepted
    # for the campaign's recipients through the same rollup code path
    # that the live webhook uses, so a reconciled campaign matches a
    # freshly-flowed one byte-for-byte. Never triggers a new send.
    @router.post("/campaigns/{campaign_id}/reconcile-stats")
    async def campaigns_reconcile_stats(
        campaign_id: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        from services.campaign_webhooks import reconcile_campaign_stats
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "id": 1})
        if not c:
            raise HTTPException(404, "Campaign not found")
        return await reconcile_campaign_stats(db, campaign_id)

    @router.post("/campaigns/{campaign_id}/render-preview")
    async def campaigns_render_preview(campaign_id: str,
                                        admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        # iter164o preview privacy fix: previously we peeked at the FIRST
        # recipient and used their real first_name in the preview, which
        # leaked (e.g. "Dear Shelly,") when the audience was 40 Outreach
        # contacts. For any bulk audience the preview must render with a
        # neutral placeholder — the actual sent emails still personalise
        # each recipient in _campaign_send_worker unchanged.
        recipients = await _resolve_audience(c.get("audience_filter") or {}, limit=2)
        overrides: Dict[str, Any] = {}
        is_outreach = _is_outreach_campaign(c)
        if len(recipients) == 1:
            # A truly single-recipient campaign — safe to show that
            # recipient's real data in the preview (it's the one they'll
            # get regardless).
            r = recipients[0]
            if r.get("first_name"):
                overrides["first_name"] = r["first_name"]
            if r.get("founder_number"):
                overrides["founder_number"] = r["founder_number"]
        else:
            # Bulk (or empty) — placeholder so no real name leaks.
            overrides["first_name"] = "[Contact name]"
            # iter164p: also neutralise the sample `founder_number=42`
            # from _preview_sample so a bulk preview doesn't display a
            # fake Founding Member pill (real bulk recipients — e.g. 40
            # Outreach contacts — have no founder_number). The
            # show_founder_badge toggle can further suppress this when
            # a legitimate founder_number is present.
            overrides["founder_number"] = 0
        if c.get("template") == "announcement":
            # iter164o: pass title through raw — no silent
            # `or "A note from FriendPlace"` fallback. If the composer
            # cleared the field, that means "no headline". The
            # announcement_template renderer handles the empty case by
            # omitting the h1 entirely.
            overrides["title"]     = c.get("title") or ""
            overrides["body_md"]   = c.get("body_md") or ""
            overrides["cta_label"] = c.get("cta_label") or None
            overrides["cta_url"]   = c.get("cta_url")   or None
            # iter164p: forward the new editable fields. `greeting` and
            # `show_founder_badge` are only overridden when explicitly
            # set on the campaign; unset (None) leaves the template on
            # its back-compat default.
            if c.get("greeting") is not None:
                overrides["greeting"] = c.get("greeting")
            if c.get("show_founder_badge") is not None:
                overrides["show_founder_badge"] = c.get("show_founder_badge")
        # iter164af — outreach safety envelope for the preview path.
        # Single-recipient outreach: force first_name / greeting /
        # founder pill using the actual recipient. Bulk outreach:
        # keep the "[Contact name]" placeholder but still kill the
        # founder pill and default the greeting to "Hi …,".
        if is_outreach:
            _apply_outreach_safety(
                overrides, c,
                (recipients[0] if len(recipients) == 1 else None),
                bulk_preview=(len(recipients) != 1),
            )
        subject, html, text = _preview_render(
            c["template"],
            companion=c.get("companion") or "george",
            subject_override=(c.get("subject") or None),
            preheader_override=(c.get("preheader") or None),
            data_overrides=overrides or None,
        )
        preview_recipient = recipients[0] if len(recipients) == 1 else None
        return {"subject": subject, "html": html, "text": text,
                "recipient": preview_recipient,
                "audience_size": len(recipients) if len(recipients) < 2 else None,
                "is_outreach": is_outreach}

    # ─── iter164ab: campaign preview + test-send helper ────────────
    # Shared render pipeline so the render-preview, render-recipient,
    # test-send AND real send worker all produce byte-identical HTML
    # for the same (campaign, recipient) pair. Keeping this in one
    # place is what lets George promise the composer preview matches
    # exactly what lands in an inbox.
    #
    # ─── iter164af: outreach personalisation safety envelope ───────
    # Contract with Garry (26 Aug 2026, P0):
    #   • Outreach campaigns must NEVER render a Founding Member
    #     badge/pill, regardless of any stale sample data or
    #     recipient-level founder_number.
    #   • Outreach greeting is "Hi <first_name>," when the contact
    #     has a name, otherwise "Hi friend,". The "Sarah" sample
    #     first-name from _preview_sample must NEVER survive into an
    #     outreach render for a contact who happens to have no name.
    #   • Outreach is determined from the campaign's audience
    #     (audience_filter.audience_kind ∈ {outreach, outreach_contacts}) —
    #     NOT from whether a recipient happens to have a founder
    #     number. This prevents a Founding Member who is also listed
    #     as an Outreach contact from silently getting the founder
    #     treatment.
    #   • Founding Member campaign behaviour is preserved unchanged.
    _OUTREACH_AUDIENCE_KINDS = {"outreach", "outreach_contacts"}

    def _is_outreach_campaign(c: Dict[str, Any]) -> bool:
        """True when the campaign's audience is an Outreach contact
        list. Single source of truth for the outreach safety envelope.
        """
        f = c.get("audience_filter") or {}
        kind = str(f.get("audience_kind") or "").strip().lower()
        return kind in _OUTREACH_AUDIENCE_KINDS

    def _resolve_outreach_first_name(r: Optional[Dict[str, Any]]) -> str:
        """Per-recipient first-name resolution for outreach renders.

        Empty, whitespace-only, or missing names collapse to
        ``"friend"`` so the greeting reads "Hi friend,". Never returns
        the empty string.
        """
        fn = (r or {}).get("first_name") if r else None
        fn = str(fn or "").strip()
        return fn or "friend"

    def _apply_outreach_safety(
        overrides: Dict[str, Any],
        c: Dict[str, Any],
        r: Optional[Dict[str, Any]],
        *,
        bulk_preview: bool = False,
    ) -> None:
        """Enforce the outreach safety envelope on a render context.

        Idempotent — safe to call from any render path. Does nothing
        on non-outreach campaigns so Founding Member behaviour is
        preserved untouched.

        For outreach:
          • ``first_name``          = recipient's first_name (or
                                      ``"friend"``); ``"[Contact name]"``
                                      when ``bulk_preview=True``.
          • ``founder_number``      = 0 (kills the sample "#0042"
                                      pill defensively, even if some
                                      caller forgot to override).
          • ``show_founder_badge``  = False (template-level safety
                                      invariant — always suppresses
                                      the pill for outreach).
          • ``greeting``            = ``"Hi [Contact name],"`` when
                                      the composer left it unset;
                                      an explicit composer greeting
                                      is honoured verbatim.
        """
        if not _is_outreach_campaign(c):
            return
        if bulk_preview:
            overrides["first_name"] = "[Contact name]"
        else:
            overrides["first_name"] = _resolve_outreach_first_name(r)
        overrides["founder_number"]     = 0
        overrides["show_founder_badge"] = False
        # Only inject the outreach default greeting when the composer
        # hasn't asked for a specific one on the campaign doc AND no
        # earlier layer has already written one into `overrides`.
        composer_greeting = c.get("greeting")
        if composer_greeting is None and "greeting" not in overrides:
            overrides["greeting"] = "Hi [Contact name],"

    def _campaign_overrides_for_recipient(c: Dict[str, Any],
                                          r: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        overrides: Dict[str, Any] = {}
        if r:
            if r.get("first_name"):
                overrides["first_name"] = r["first_name"]
            if r.get("founder_number"):
                overrides["founder_number"] = r["founder_number"]
            if r.get("companion_choice"):
                overrides["companion"] = r["companion_choice"]
        if c.get("template") == "announcement":
            overrides["title"]     = c.get("title") or ""
            overrides["body_md"]   = c.get("body_md") or ""
            overrides["cta_label"] = c.get("cta_label") or None
            overrides["cta_url"]   = c.get("cta_url")   or None
            if c.get("greeting") is not None:
                overrides["greeting"] = c.get("greeting")
            if c.get("show_founder_badge") is not None:
                overrides["show_founder_badge"] = c.get("show_founder_badge")
        # iter164af — apply outreach safety envelope LAST so it wins
        # over any stale composer/recipient state (esp. missing
        # first_name / stray founder_number).
        _apply_outreach_safety(overrides, c, r)
        return overrides

    def _campaign_attachments_payload(c: Dict[str, Any]) -> Optional[list]:
        """Return the Resend `attachments=` payload iff the campaign's
        ``attach_file`` flag is ON AND a real attachment is on disk.
        Shape matches exactly what the send worker uses.
        """
        if not c.get("attach_file"):
            return None
        att = c.get("attachment")
        if not isinstance(att, dict) or not att.get("content_b64") or not att.get("filename"):
            return None
        return [{
            "filename":     att["filename"],
            "content":      att["content_b64"],
            "content_type": att.get("content_type") or "application/pdf",
        }]

    @router.post("/campaigns/{campaign_id}/render-recipient")
    async def campaigns_render_recipient(
        campaign_id: str,
        payload: Dict[str, Any],
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Render the *personalised* email for a single recipient
        without sending it. Powers the composer's "Review emails" list.

        Request body (JSON): either ``{"user_id": "…"}`` or
        ``{"email": "…"}`` — one of them must identify a real
        recipient inside the campaign's resolved audience. Returns
        the exact subject/html/text that the send worker would emit
        for that recipient.
        """
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        user_id = (payload or {}).get("user_id")
        email = (payload or {}).get("email")
        if not user_id and not email:
            raise HTTPException(400, "Provide user_id or email")
        recipients = await _resolve_audience(c.get("audience_filter") or {}, limit=5000)
        selected: Optional[Dict[str, Any]] = None
        for r in recipients:
            if user_id and r.get("id") == user_id:
                selected = r
                break
            if email and (r.get("email") or "").strip().lower() == str(email).strip().lower():
                selected = r
                break
        if not selected:
            raise HTTPException(
                404,
                "Recipient not found in this campaign's resolved audience",
            )
        overrides = _campaign_overrides_for_recipient(c, selected)
        companion = overrides.pop("companion", None) or c.get("companion") or "george"
        subject, html, text = _preview_render(
            c["template"], companion=companion,
            subject_override=(c.get("subject") or None),
            preheader_override=(c.get("preheader") or None),
            data_overrides=overrides,
        )
        att = _campaign_attachments_payload(c)
        return {
            "subject": subject,
            "html":    html,
            "text":    text,
            "recipient": {
                "id":             selected.get("id"),
                "email":          selected.get("email"),
                "first_name":     selected.get("first_name"),
                "founder_number": selected.get("founder_number"),
                "companion":      companion,
            },
            "attachment": (
                {"filename": att[0]["filename"],
                 "size":     len((c.get("attachment") or {}).get("content_b64") or "") * 3 // 4,
                 "content_type": att[0]["content_type"]}
                if att else None
            ),
        }

    @router.post("/campaigns/{campaign_id}/test-send")
    async def campaigns_test_send(
        campaign_id: str,
        payload: Optional[Dict[str, Any]] = None,
        admin: dict = Depends(current_cms_admin),
    ):
        """Send a single test copy of the campaign to a safe address.

        The audience is **never** touched. Allowed recipients:

          • The authenticated admin's own email (default when no
            ``to`` is provided).
          • Any address in the ``CAMPAIGN_TEST_EMAILS`` env var
            (comma-separated allow-list).

        Any other value in ``to`` is refused with 400 so a fat-finger
        can't accidentally spray a real subscriber.

        Personalisation data is taken from the recipient's ``users``
        row if one exists — otherwise the request falls back to the
        neutral preview sample (no name leak on a bulk campaign).
        """
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        payload = payload or {}
        to = str(payload.get("to") or "").strip().lower()
        admin_email = (admin.get("email") or "").strip().lower()
        # Build the allow-list. `CAMPAIGN_TEST_EMAILS` env var is a
        # comma-separated list (empty by default). The authenticated
        # admin's own email is always allowed.
        raw_env = os.environ.get("CAMPAIGN_TEST_EMAILS", "")
        allow_list = {
            e.strip().lower()
            for e in raw_env.split(",")
            if e.strip()
        }
        if admin_email:
            allow_list.add(admin_email)
        if not to:
            to = admin_email
        if not to:
            raise HTTPException(400, "No `to` address and admin has no email on file")
        if to not in allow_list:
            raise HTTPException(
                400,
                "Refusing to send test email to that address — "
                "only the signed-in admin or a CAMPAIGN_TEST_EMAILS "
                "allow-list address is permitted.",
            )
        # Personalise from the users row if we have one for the test
        # address. Otherwise fall back to the sample. Never look up
        # against the campaign audience — this endpoint is deliberately
        # decoupled from the audience filter.
        user_row = await db.users.find_one(
            {"email": {"$regex": f"^{re.escape(to)}$", "$options": "i"}},
            {"_id": 0, "id": 1, "first_name": 1, "founder_number": 1,
             "companion_choice": 1, "email": 1},
        )
        recipient = user_row or {"email": to, "first_name": "Test",
                                 "founder_number": None, "companion_choice": None}
        overrides = _campaign_overrides_for_recipient(c, recipient)
        # Belt-and-braces marker so a test copy is visually distinct
        # from a real send — inserted only into the subject, not the
        # body, so the rendered HTML is otherwise byte-identical to
        # what the audience would receive.
        preview_subject_prefix = "[TEST] "
        companion = overrides.pop("companion", None) or c.get("companion") or "george"
        subject, html, text = _preview_render(
            c["template"], companion=companion,
            subject_override=(c.get("subject") or None),
            preheader_override=(c.get("preheader") or None),
            data_overrides=overrides,
        )
        subject_with_prefix = f"{preview_subject_prefix}{subject}" if subject else preview_subject_prefix.strip()
        attachments = _campaign_attachments_payload(c)
        # Use send_email_detailed exactly as the real worker does —
        # SAME rendering path, same attachment handling.
        from email_service import send_email_detailed as _send  # noqa: WPS433
        result = await _send(
            to=to, subject=subject_with_prefix, html=html, text=text,
            attachments=attachments,
        )
        return {
            "ok":        bool(getattr(result, "ok", False)),
            "to":        to,
            "subject":   subject_with_prefix,
            "message_id": getattr(result, "message_id", None),
            "http_status": getattr(result, "http_status", None),
            "error":     getattr(result, "error", None),
            "error_code": getattr(result, "error_code", None),
            "attachment": (
                {"filename": attachments[0]["filename"],
                 "content_type": attachments[0]["content_type"]}
                if attachments else None
            ),
            "used_admin_email": to == admin_email,
        }


    # ─── iter164r: campaign attachment endpoints ───────────────────
    # Contract locked with Garry (24 Aug 2026):
    #   • Mutation only while the campaign is a draft.
    #   • PDFs only, 5 MB cap.
    #   • Base64 content stored inline on the campaign doc.
    #   • Presence of an attachment does NOT auto-send it — that's
    #     gated by the separate `attach_file` boolean on the campaign
    #     (see PATCH /campaigns/{id}).
    @router.post("/campaigns/{campaign_id}/attachment")
    async def campaigns_attachment_upload(
        campaign_id: str,
        file: UploadFile = File(...),
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        if c.get("status") != "draft":
            raise HTTPException(400, "Only drafts can have their attachment changed")
        content_type = (file.content_type or "").lower().split(";")[0].strip()
        if content_type not in _CAMPAIGN_ATTACHMENT_ALLOWED_TYPES:
            raise HTTPException(
                415,
                "Only PDF attachments are supported (application/pdf).",
            )
        # Read the whole file but bail as soon as we cross the size
        # cap to avoid buffering huge uploads into memory. Also do
        # a magic-byte sniff so a mislabelled non-PDF can't slip in
        # under a doctored Content-Type header.
        raw = await file.read(_CAMPAIGN_ATTACHMENT_MAX_BYTES + 1)
        try:
            await file.close()
        except Exception:
            pass
        if not raw:
            raise HTTPException(400, "Uploaded file is empty")
        if len(raw) > _CAMPAIGN_ATTACHMENT_MAX_BYTES:
            raise HTTPException(
                413,
                f"Attachment exceeds the {_CAMPAIGN_ATTACHMENT_MAX_BYTES // (1024 * 1024)} MB limit",
            )
        if not raw.startswith(b"%PDF"):
            raise HTTPException(400, "Uploaded file does not appear to be a valid PDF")
        import base64 as _b64
        b64 = _b64.b64encode(raw).decode("ascii")
        filename = (file.filename or "attachment.pdf").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        filename = filename[:200] or "attachment.pdf"
        now = datetime.now(timezone.utc).isoformat()
        attachment_doc = {
            "filename":     filename,
            "content_type": "application/pdf",
            "size":         len(raw),
            "content_b64":  b64,
            "uploaded_at":  now,
        }
        await db.campaigns.update_one(
            {"id": campaign_id},
            {"$set": {"attachment": attachment_doc, "updated_at": now}},
        )
        return {"ok": True, "attachment": _attachment_meta(attachment_doc)}

    @router.get("/campaigns/{campaign_id}/attachment")
    async def campaigns_attachment_meta(
        campaign_id: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        c = await db.campaigns.find_one(
            {"id": campaign_id},
            {"_id": 0, "attachment": 1, "attach_file": 1, "status": 1},
        )
        if not c:
            raise HTTPException(404, "Campaign not found")
        return {
            "attachment":  _attachment_meta(c.get("attachment")),
            "attach_file": bool(c.get("attach_file")),
        }

    @router.get("/campaigns/{campaign_id}/attachment/download")
    async def campaigns_attachment_download(
        campaign_id: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        c = await db.campaigns.find_one(
            {"id": campaign_id},
            {"_id": 0, "attachment": 1},
        )
        if not c:
            raise HTTPException(404, "Campaign not found")
        att = c.get("attachment") or {}
        if not att.get("content_b64") or not att.get("filename"):
            raise HTTPException(404, "This campaign has no attachment")
        import base64 as _b64
        from fastapi.responses import Response
        try:
            payload = _b64.b64decode(att["content_b64"])
        except Exception:
            raise HTTPException(500, "Stored attachment is corrupted")
        return Response(
            content=payload,
            media_type=att.get("content_type") or "application/pdf",
            headers={
                "Content-Disposition": f'inline; filename="{att["filename"]}"',
            },
        )

    @router.delete("/campaigns/{campaign_id}/attachment")
    async def campaigns_attachment_delete(
        campaign_id: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        if c.get("status") != "draft":
            raise HTTPException(400, "Only drafts can have their attachment removed")
        if not c.get("attachment"):
            # Idempotent: removing an already-absent attachment is a no-op.
            # Force attach_file back to False so the response is
            # internally consistent with the has-attachment branch and
            # a stale `attach_file=true, attachment=null` combo can't
            # linger on the doc.
            if c.get("attach_file"):
                now = datetime.now(timezone.utc).isoformat()
                await db.campaigns.update_one(
                    {"id": campaign_id},
                    {"$set": {"attach_file": False, "updated_at": now}},
                )
            return {"ok": True, "attachment": None, "attach_file": False}
        now = datetime.now(timezone.utc).isoformat()
        # Also flip attach_file back to False so a stale toggle
        # doesn't cause an empty attachment list to sneak into the
        # next send (Resend would reject an empty attachment entry,
        # but this keeps the audit trail sensible either way).
        await db.campaigns.update_one(
            {"id": campaign_id},
            {"$set": {"attachment": None, "attach_file": False, "updated_at": now}},
        )
        return {"ok": True, "attachment": None, "attach_file": False}

    async def _campaign_send_worker(campaign_id: str):
        """Background — send the campaign in batches of 5 with 500ms delay."""
        import asyncio
        from datetime import datetime, timezone
        from email_service import send_email_detailed  # noqa: WPS433
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c or c.get("status") not in ("draft", "sending"):
            return
        recipients = await _resolve_audience(c.get("audience_filter") or {}, limit=5000)
        stats = {"targeted": len(recipients), "accepted": 0, "failed": 0,
                 "delivered": 0, "opened": 0, "clicked": 0, "bounced": 0}
        await db.campaigns.update_one(
            {"id": campaign_id},
            {"$set": {"status": "sending", "stats": stats,
                      "sent_at": datetime.now(timezone.utc).isoformat()}},
        )
        sample_html_saved = False
        BATCH_SIZE, BATCH_DELAY = 5, 0.5
        for i in range(0, len(recipients), BATCH_SIZE):
            batch = recipients[i:i + BATCH_SIZE]
            async def _one(r: dict):
                nonlocal sample_html_saved
                overrides: Dict[str, Any] = {}
                if r.get("first_name"):
                    overrides["first_name"] = r["first_name"]
                if r.get("founder_number"):
                    overrides["founder_number"] = r["founder_number"]
                companion = c.get("companion") or "george"
                if r.get("companion_choice"):
                    companion = r["companion_choice"]
                    overrides["companion"] = companion
                if c.get("template") == "announcement":
                    # iter164o: pass title through raw — the composer's
                    # cleared-field intent must be respected. Renderer
                    # omits the h1 when title is empty.
                    overrides["title"]     = c.get("title") or ""
                    overrides["body_md"]   = c.get("body_md") or ""
                    overrides["cta_label"] = c.get("cta_label") or None
                    overrides["cta_url"]   = c.get("cta_url")   or None
                    # iter164p: forward the new editable fields per
                    # recipient. The template does the "[Contact name]"
                    # -> first_name substitution internally, using the
                    # first_name we set above from r["first_name"], so
                    # each recipient sees "Dear <their name>," even
                    # though the composer stored a single string.
                    if c.get("greeting") is not None:
                        overrides["greeting"] = c.get("greeting")
                    if c.get("show_founder_badge") is not None:
                        overrides["show_founder_badge"] = c.get("show_founder_badge")
                # iter164af — outreach safety envelope for the real
                # send worker. Applied LAST so it wins over any stale
                # recipient state (esp. missing first_name → "friend"
                # fallback and forced show_founder_badge=False).
                _apply_outreach_safety(overrides, c, r)
                subject, html, text = _preview_render(
                    c["template"], companion=companion,
                    subject_override=(c.get("subject") or None),
                    preheader_override=(c.get("preheader") or None),
                    data_overrides=overrides,
                )
                if not sample_html_saved:
                    await db.campaigns.update_one(
                        {"id": campaign_id},
                        {"$set": {"sample_html": html, "sample_subject": subject}},
                    )
                    sample_html_saved = True
                # iter164r: attach the staged PDF *only* when the
                # explicit `attach_file` flag is ON. The flag is
                # evaluated per-send (not per-recipient) but we
                # rebuild the attachments list here so an in-flight
                # toggle can't accidentally desync one batch from the
                # next. `content` is already base64 on disk, which is
                # exactly the shape Resend's Emails.send expects.
                attachments = None
                if c.get("attach_file") and isinstance(c.get("attachment"), dict):
                    _att = c["attachment"]
                    if _att.get("content_b64") and _att.get("filename"):
                        attachments = [{
                            "filename":     _att["filename"],
                            "content":      _att["content_b64"],
                            "content_type": _att.get("content_type") or "application/pdf",
                        }]
                result = await send_email_detailed(
                    to=r["email"], subject=subject, html=html, text=text,
                    attachments=attachments,
                )
                now = datetime.now(timezone.utc).isoformat()
                await db.campaign_recipients.insert_one({
                    "id":              str(uuid.uuid4()),
                    "campaign_id":     campaign_id,
                    "founder_id":      r["id"],
                    "founder_number":  r.get("founder_number"),
                    "first_name":      r.get("first_name"),
                    "email":           r["email"],
                    "status":          "sent" if result.ok else "failed",
                    "message_id":      result.message_id,
                    "sent_at":         now,
                    "error":           result.error if not result.ok else None,
                    "http_status":     result.http_status,
                    "subject":         subject,
                    # iter164ag — record the audience *shape* on the
                    # recipient row so the webhook receiver can flag
                    # bounces/complaints back to the right source-of-
                    # truth collection (outreach_organisations for
                    # outreach recipients, interest_registrations for
                    # Founding Members). Without this, an outreach
                    # bounce would silently no-op against founders,
                    # and we'd keep re-sending to an invalid address.
                    "audience_kind":   (c.get("audience_filter") or {}).get("audience_kind"),
                    "outreach_id":     r.get("outreach_id"),
                })
                await db.campaigns.update_one(
                    {"id": campaign_id},
                    {"$inc": {("stats.accepted" if result.ok else "stats.failed"): 1}},
                )
                # iter160a: if this recipient is an outreach organisation,
                # bump their last_contact_at and log the send in their
                # timeline. Idempotent on the per-recipient row id.
                if result.ok:
                    try:
                        from services.outreach.store import touch_last_contact as _tlc
                        await _tlc(
                            db, email=r["email"], campaign_id=campaign_id,
                            subject=subject,
                            send_id=str(r.get("id") or r["email"]) + "@" + campaign_id,
                        )
                    except Exception:
                        pass
                if result.ok and result.message_id:
                    try:
                        await db.email_test_log.insert_one({
                            "message_id":  result.message_id,
                            "template":    c["template"],
                            "companion":   companion,
                            "recipient":   r["email"],
                            "subject":     subject,
                            "created_at":  now,
                            "mode":        "campaign",
                            "campaign_id": campaign_id,
                        })
                    except Exception:
                        pass
                # Auto-advance status for invitation campaigns.
                if result.ok and c["template"] == "invitation":
                    current = (r.get("status") or "registered").lower()
                    if current in ("registered", "new", ""):
                        try:
                            hist = {
                                "at": now, "from": current or "registered", "to": "invited",
                                "actor_id": c.get("created_by"),
                                "actor_email": c.get("created_by_email"),
                                "reason": "campaign_sent",
                                "campaign_id": campaign_id,
                                "template": c["template"],
                                "subject": subject, "message_id": result.message_id,
                            }
                            await db.interest_registrations.update_one(
                                {"id": r["id"]},
                                {"$set": {"status": "invited", "invited_at": now,
                                          "updated_at": now},
                                 "$push": {"history": hist}},
                            )
                        except Exception:
                            import logging as _logging
                            _logging.getLogger("friendplace.email").exception("Campaign founder advance failed")
            await asyncio.gather(*[_one(r) for r in batch], return_exceptions=True)
            if i + BATCH_SIZE < len(recipients):
                await asyncio.sleep(BATCH_DELAY)
        finished = datetime.now(timezone.utc).isoformat()
        final = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0, "stats": 1})
        s = (final or {}).get("stats") or {}
        final_status = "failed" if (s.get("accepted", 0) == 0 and s.get("targeted", 0) > 0) else "sent"
        await db.campaigns.update_one(
            {"id": campaign_id},
            {"$set": {"status": final_status, "finished_at": finished}},
        )

    @router.post("/campaigns/{campaign_id}/send")
    async def campaigns_send(campaign_id: str, background_tasks: BackgroundTasks,
                             admin: dict = Depends(current_cms_admin)):
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        if c.get("status") not in ("draft",):
            raise HTTPException(400, f"Campaign is already {c.get('status')} — cannot send twice")
        from email_service import is_configured as _resend_ready  # noqa: WPS433
        if not _resend_ready():
            raise HTTPException(400, "RESEND_API_KEY not configured on backend")
        recipients = await _resolve_audience(c.get("audience_filter") or {}, limit=5000)
        if not recipients:
            raise HTTPException(400, "No recipients match this audience. Adjust filters and try again.")
        from datetime import datetime, timezone
        await db.campaigns.update_one(
            {"id": campaign_id},
            {"$set": {"status": "sending",
                      "sent_at": datetime.now(timezone.utc).isoformat(),
                      "sent_by": admin.get("id"),
                      "stats.targeted": len(recipients)}},
        )
        background_tasks.add_task(_campaign_send_worker, campaign_id)
        return {"ok": True, "targeted": len(recipients), "status": "sending",
                "message": f"Campaign sending to {len(recipients)} Founding Member(s). "
                           f"Refresh to see live progress."}

    # ─── CRM CSV export (2D) ────────────────────────────────────────
    @router.post("/campaigns/{campaign_id}/schedule")
    async def campaigns_schedule(
        campaign_id: str,
        payload: Dict[str, Any],
        admin: dict = Depends(current_cms_admin),
    ):
        """Move a draft into a scheduled state to send at `scheduled_at`.

        We keep it simple: the campaign stays in status 'scheduled' until
        the poller (see server.py startup) picks it up. Admin can cancel
        by hitting DELETE on the campaign (only allowed while draft OR
        scheduled), or edit the schedule by PATCHing scheduled_at.
        """
        from datetime import datetime, timezone
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        if c.get("status") not in ("draft", "scheduled"):
            raise HTTPException(400, f"Cannot schedule a campaign that is already {c.get('status')}")
        raw = str(payload.get("scheduled_at") or "").strip()
        if not raw:
            raise HTTPException(400, "scheduled_at (ISO 8601) is required")
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                # Interpret naive input as UTC — the compose UI always
                # sends an explicit timezone offset, but be safe.
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "scheduled_at must be a valid ISO 8601 timestamp")
        if dt <= datetime.now(timezone.utc):
            raise HTTPException(400, "scheduled_at must be in the future")
        await db.campaigns.update_one(
            {"id": campaign_id},
            {"$set": {
                "status":        "scheduled",
                "scheduled_at":  dt.isoformat(),
                "scheduled_by":  admin.get("id"),
                "updated_at":    datetime.now(timezone.utc).isoformat(),
            }},
        )
        c2 = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        return _campaign_summary(c2)

    @router.post("/campaigns/{campaign_id}/unschedule")
    async def campaigns_unschedule(
        campaign_id: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Return a scheduled campaign to draft status. Useful when
        the send date arrives too soon and the admin wants to hold."""
        c = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Campaign not found")
        if c.get("status") != "scheduled":
            raise HTTPException(400, "Only scheduled campaigns can be unscheduled")
        await db.campaigns.update_one(
            {"id": campaign_id},
            {"$set": {"status": "draft"}, "$unset": {"scheduled_at": ""}},
        )
        c2 = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        return _campaign_summary(c2)

    @router.get("/crm/founding-members/{member_id}/timeline")
    async def crm_founding_members_timeline(
        member_id: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Chronological event feed for one Founding Member.

        Aggregates from four sources so the CRM can render a single
        timeline without the caller stitching things together:

          1. The registration itself (`created_at` + founder_number).
          2. The automatic acknowledgement (`ack_sent_at` /
             `ack_message_id`).
          3. Every `history[]` entry on the founder — status
             transitions, admin overrides, individual invitation sends.
          4. Every `campaign_recipients` row where this founder was
             a recipient — cross-referenced with the campaign name.

        Events are returned newest-first (which matches how humans
        scan a "what happened" feed) but the frontend can flip that
        if it wants a chronological unfolding.
        """
        row = await db.interest_registrations.find_one(
            {"id": member_id}, {"_id": 0},
        )
        if not row:
            raise HTTPException(404, "Founding member not found")
        events: list[dict] = []

        # 1) Registration.
        fn = row.get("founder_number")
        fn_display = f"#{fn:04d}" if fn else ""
        events.append({
            "at":     row.get("created_at"),
            "kind":   "registered",
            "title":  f"Registered as Founding Member {fn_display}".strip(),
            "detail": (
                f"{row.get('first_name') or '(unnamed)'} joined the register "
                f"from {row.get('state_country') or 'somewhere in the world'}. "
                f"Heard about us via: {row.get('heard_from') or '—'}."
            ),
            "founder_number": fn,
        })

        # 2) Acknowledgement email.
        if row.get("ack_sent_at"):
            events.append({
                "at":         row["ack_sent_at"],
                "kind":       "ack_sent",
                "title":      "Acknowledgement email sent",
                "detail":     (
                    f"Sent the welcome letter — signed by "
                    f"{'Georgia' if (row.get('companion_choice') == 'georgia') else 'George'}."
                ),
                "message_id": row.get("ack_message_id"),
                "template":   "waitlist",
            })

        # 3) history[] entries — status transitions + email sends.
        for h in (row.get("history") or []):
            reason = (h.get("reason") or "").lower()
            from_s = h.get("from"); to_s = h.get("to")
            template = h.get("template")
            subject = h.get("subject")
            actor = h.get("actor_email") or h.get("actor_id")
            campaign_id = h.get("campaign_id")
            if reason == "email_sent":
                title = "Invitation sent from Mission Control" if template == "invitation" else "Email sent"
                detail = (
                    f"Subject: “{subject}”" if subject
                    else "A message was sent from Mission Control."
                )
            elif reason == "email_sent_no_status_change":
                title = "Email sent"
                detail = (
                    f"Subject: “{subject}”" if subject else "Follow-up email sent."
                )
            elif reason == "campaign_sent":
                title = "Received campaign invitation"
                detail = f"Subject: “{subject}”" if subject else "Received a campaign."
            elif reason == "admin_override":
                title = "Admin override"
                detail = f"Admin moved status from {from_s} to {to_s}"
                if actor:
                    detail += f" ({actor})"
            elif from_s and to_s and from_s != to_s:
                title = f"Status changed: {from_s} → {to_s}"
                detail = f"Reason: {reason or 'not recorded'}"
                if actor:
                    detail += f" ({actor})"
            else:
                continue    # nothing interesting to render
            events.append({
                "at":           h.get("at"),
                "kind":         "status_change" if (from_s and to_s and from_s != to_s) else "email_sent",
                "title":        title,
                "detail":       detail,
                "status_from":  from_s,
                "status_to":    to_s,
                "template":     template,
                "subject":      subject,
                "message_id":   h.get("message_id"),
                "campaign_id":  campaign_id,
                "actor_email":  h.get("actor_email"),
            })

        # 4) Campaign receipts — join campaign_recipients with campaigns.
        recip_rows = await db.campaign_recipients.find(
            {"founder_id": member_id}, {"_id": 0},
        ).to_list(500)
        if recip_rows:
            campaign_ids = list({r.get("campaign_id") for r in recip_rows if r.get("campaign_id")})
            campaigns_by_id: Dict[str, Dict[str, Any]] = {}
            if campaign_ids:
                async for c in db.campaigns.find(
                    {"id": {"$in": campaign_ids}},
                    {"_id": 0, "id": 1, "name": 1, "template": 1, "companion": 1},
                ):
                    campaigns_by_id[c["id"]] = c
            for r in recip_rows:
                c = campaigns_by_id.get(r.get("campaign_id") or "", {})
                cname = c.get("name") or "(untitled campaign)"
                template = c.get("template") or "campaign"
                kind = "campaign_received"
                if r.get("status") == "failed":
                    title = f"Campaign delivery failed: {cname}"
                    kind = "campaign_failed"
                elif template == "invitation":
                    title = f"Invitation sent via campaign: {cname}"
                else:
                    title = f"Received campaign: {cname}"
                events.append({
                    "at":           r.get("sent_at"),
                    "kind":         kind,
                    "title":        title,
                    "detail":       (
                        f"Subject: “{r.get('subject') or ''}”"
                        + (f" — {r.get('error')}" if r.get("status") == "failed" else "")
                    ),
                    "campaign_id":  r.get("campaign_id"),
                    "campaign_name": cname,
                    "template":     template,
                    "subject":      r.get("subject"),
                    "message_id":   r.get("message_id"),
                })

        # Sort newest first; missing `at` sinks to the bottom.
        events.sort(key=lambda e: e.get("at") or "", reverse=True)
        return {"count": len(events), "events": events}


    # ─── Share a Moment — Mission Control moderation ────────────────
    # These endpoints power `/admin/moments`. They mirror the raw
    # /api/admin/moments routes in server.py but use the CMS admin
    # JWT so the frontend admin only carries one credential. Kept in
    # this module (not in server.py) because the CMS shell drives the
    # UI — same pattern as the CRM & Campaigns endpoints above.
    _MOMENT_ADMIN_FILTERS = {"all", "featured", "hidden", "reported"}

    def _moment_row(m: dict) -> dict:
        """Shape a moment doc for the Mission Control moments table.
        Includes fields the public /api/moments never returns
        (reports list, hidden flag) so moderators can act with full
        context."""
        return {
            "id":              m.get("id"),
            "caption":         m.get("caption", ""),
            "photos":          list(m.get("photos") or []),
            "privacy":         m.get("privacy", "everyone"),
            "author_id":       m.get("author_id", ""),
            "author_name":     m.get("author_name", ""),
            "author_avatar":   m.get("author_avatar", "👤"),
            "created_at":      m.get("created_at"),
            "featured":        bool(m.get("featured")),
            "featured_at":     m.get("featured_at"),
            "hidden":          bool(m.get("hidden")),
            "hidden_at":       m.get("hidden_at"),
            "likes_count":     len(m.get("likes") or []),
            "comments_count":  len(m.get("comments") or []),
            "reports_count":   len(m.get("reports") or []),
            "reports":         list(m.get("reports") or []),
        }

    @router.get("/moments")
    async def cms_moments_list(
        q: Optional[str] = None,
        filter: str = "all",
        limit: int = 100,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        query: Dict[str, Any] = {}
        f = (filter or "all").lower()
        if f not in _MOMENT_ADMIN_FILTERS:
            f = "all"
        if f == "featured":
            query["featured"] = True
        elif f == "hidden":
            query["hidden"] = True
        elif f == "reported":
            query["reports.0"] = {"$exists": True}
        if q and q.strip():
            import re as _re
            safe = _re.escape(q.strip())
            rx = {"$regex": safe, "$options": "i"}
            query["$or"] = [{"caption": rx}, {"author_name": rx}]
        limit = max(1, min(int(limit or 100), 500))
        rows = await db.moments.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
        featured = await db.moments.find_one({"featured": True}, {"_id": 0, "id": 1})
        # Aggregate quick counters so the header can show
        # "3 featured · 12 reported · 148 total".
        total = await db.moments.count_documents({})
        reported = await db.moments.count_documents({"reports.0": {"$exists": True}})
        hidden = await db.moments.count_documents({"hidden": True})
        return {
            "count":    len(rows),
            "total":    total,
            "reported": reported,
            "hidden":   hidden,
            "featured_id": (featured or {}).get("id"),
            "rows":     [_moment_row(r) for r in rows],
        }

    @router.get("/moments/{moment_id}")
    async def cms_moments_get(
        moment_id: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        m = await db.moments.find_one({"id": moment_id}, {"_id": 0})
        if not m:
            raise HTTPException(404, "Moment not found")
        out = _moment_row(m)
        out["comments"] = list(m.get("comments") or [])
        return out

    @router.post("/moments/{moment_id}/action")
    async def cms_moments_action(
        moment_id: str,
        payload: Dict[str, Any],
        admin: dict = Depends(current_cms_admin),
    ):
        from datetime import datetime, timezone
        action = str(payload.get("action") or "").lower()
        m = await db.moments.find_one({"id": moment_id}, {"_id": 0, "id": 1})
        if not m:
            raise HTTPException(404, "Moment not found")
        now = datetime.now(timezone.utc).isoformat()
        if action == "feature":
            # One Moment of the Week at a time — unfeature others.
            await db.moments.update_many({"featured": True}, {"$set": {"featured": False}})
            await db.moments.update_one(
                {"id": moment_id},
                {"$set": {"featured": True, "hidden": False, "featured_at": now,
                          "featured_by": admin.get("email")}},
            )
        elif action == "unfeature":
            await db.moments.update_one({"id": moment_id}, {"$set": {"featured": False}})
        elif action == "hide":
            await db.moments.update_one(
                {"id": moment_id},
                {"$set": {"hidden": True, "featured": False, "hidden_at": now,
                          "hidden_by": admin.get("email")}},
            )
        elif action == "restore":
            await db.moments.update_one({"id": moment_id}, {"$set": {"hidden": False}})
        elif action == "clear_reports":
            await db.moments.update_one({"id": moment_id}, {"$set": {"reports": []}})
        else:
            raise HTTPException(400, "Unknown action")
        return {"ok": True, "action": action}

    @router.delete("/moments/{moment_id}")
    async def cms_moments_delete(
        moment_id: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        m = await db.moments.find_one({"id": moment_id}, {"_id": 0, "id": 1})
        if not m:
            raise HTTPException(404, "Moment not found")
        await db.moments.delete_one({"id": moment_id})
        return {"ok": True}


    # ─── CRM CSV export (2D) ────────────────────────────────────────
    @router.get("/crm/founding-members.csv")
    async def crm_founding_members_csv(
        status: Optional[str] = None, q: Optional[str] = None,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        from fastapi.responses import Response
        import csv, io
        query: Dict[str, Any] = {"is_test": {"$ne": True}}
        if status and status in _FM_STATUSES:
            if status == "registered":
                query["$or"] = [
                    {"status": {"$exists": False}},
                    {"status": None},
                    {"status": {"$in": _AWAITING_STATUSES}},
                ]
            else:
                query["status"] = status
        if q:
            import re as _re
            rx = _re.compile(_re.escape(q), _re.IGNORECASE)
            query["$or"] = [
                {"first_name": rx}, {"last_name": rx}, {"email": rx},
                {"state_country": rx}, {"admin_notes": rx},
                {"heard_from": rx}, {"tags": rx},
            ]
        rows = await db.interest_registrations.find(query, {"_id": 0}).sort(
            [("founder_number", 1), ("created_at", 1)],
        ).to_list(10000)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["founder_number", "first_name", "email", "state_country",
                    "status", "companion_choice", "tags", "heard_from",
                    "admin_notes", "created_at"])
        for r in rows:
            fn = r.get("founder_number")
            w.writerow([
                f"#{fn:04d}" if fn else "",
                r.get("first_name") or "",
                r.get("email") or "",
                r.get("state_country") or "",
                r.get("status") or "registered",
                r.get("companion_choice") or "",
                "; ".join(r.get("tags") or []),
                r.get("heard_from") or "",
                (r.get("admin_notes") or "").replace("\n", " ")[:500],
                r.get("created_at") or "",
            ])
        return Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=founding-members.csv"},
        )



    # ─── Live delivery status + sending health ──────────────────────
    #
    # Now that the backend has a full-access Resend key, Mission Control
    # can show the truth end-to-end: from "Resend accepted the message"
    # through to "Delivered to hello@friendplace.com.au" (or the actual
    # bounce/rejection reason). These three endpoints back the live
    # status ladder and the sidebar "Sending health" indicator on
    # `/admin/emails`.

    @router.get("/email-previews/message/{message_id}/status")
    async def email_message_status(
        message_id: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Live delivery status for a specific message.

        Called by the CMS panel every 2s after a Send Test until the
        message reaches a terminal state (delivered / bounced /
        rejected / complained) or ~30s elapses.
        """
        from email_service import fetch_message_status  # noqa: WPS433
        return await fetch_message_status(message_id)

    @router.get("/email-previews/domains")
    async def email_domains(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """Verified sending domains + per-record DKIM/SPF/DMARC state."""
        from email_service import fetch_domains_health  # noqa: WPS433
        return await fetch_domains_health()

    @router.get("/email-previews/sending-health")
    async def email_sending_health(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """Aggregated at-a-glance "email system healthy?" indicator.

        Combines: Resend configured, ANY sending domain verified with
        DKIM+SPF+DMARC green, and the last outbound send's status.
        Returns one of three overall states:
          • healthy       — green light. Everything is green.
          • needs_attention — orange. Sending works but something's not
                             green (DKIM warning, DMARC missing,
                             recent bounce, etc.).
          • broken        — red. Sending isn't working right now.
        """
        from email_service import (  # noqa: WPS433
            is_configured as _resend_ready,
            fetch_domains_health,
        )
        checks: list[dict] = []
        tone_worst = "healthy"

        def _worse(current: str, incoming: str) -> str:
            order = {"healthy": 0, "needs_attention": 1, "broken": 2}
            return incoming if order.get(incoming, 0) > order.get(current, 0) else current

        # Check 1 — Resend configured at all
        if not _resend_ready():
            checks.append({"label": "Resend API key configured", "state": "broken"})
            tone_worst = _worse(tone_worst, "broken")
        else:
            checks.append({"label": "Resend API key configured", "state": "healthy"})

        # Check 2 — Sending domain verified
        domains_result = await fetch_domains_health()
        if not domains_result.get("ok"):
            checks.append({
                "label": "Sending domain verified",
                "state": "needs_attention",
                "detail": domains_result.get("error") or "Couldn't read domain list.",
            })
            tone_worst = _worse(tone_worst, "needs_attention")
        else:
            verified = [d for d in domains_result["domains"] if d.get("status") == "verified" and d.get("sending_enabled")]
            if not verified:
                checks.append({
                    "label": "Sending domain verified",
                    "state": "broken",
                    "detail": "No verified sending domain — messages will not send.",
                })
                tone_worst = _worse(tone_worst, "broken")
            else:
                domain_names = ", ".join(d["name"] for d in verified)
                checks.append({
                    "label": "Sending domain verified",
                    "state": "healthy",
                    "detail": domain_names,
                })
                # Per-mechanism checks — check strictest interpretation
                # across all verified domains (worst mechanism wins).
                for mech in ("dkim", "spf", "dmarc"):
                    worst = "healthy"
                    for d in verified:
                        state = d.get(mech)
                        if state == "verified":
                            continue
                        if state in ("missing", "failed"):
                            worst = "needs_attention" if mech == "dmarc" else "broken"
                        elif state == "pending":
                            worst = _worse(worst, "needs_attention")
                        else:
                            worst = _worse(worst, "needs_attention")
                    checks.append({
                        "label": {"dkim": "DKIM", "spf": "SPF", "dmarc": "DMARC"}[mech],
                        "state": worst,
                    })
                    tone_worst = _worse(tone_worst, worst)

        # Check 3 — Last outbound test status. We record every test
        # send in `email_test_log` so we can surface the freshest
        # ground-truth state right in the sidebar.
        last = await db.email_test_log.find_one(
            {}, sort=[("created_at", -1)], projection={"_id": 0},
        )
        if last:
            from email_service import fetch_message_status  # noqa: WPS433
            live = await fetch_message_status(last.get("message_id") or "")
            state_map = {
                "delivered": "healthy",
                "opened": "healthy",
                "clicked": "healthy",
                "sent": "needs_attention",
                "queued": "needs_attention",
                "delivery_delayed": "needs_attention",
                "bounced": "broken",
                "rejected": "broken",
                "complained": "broken",
                None: "needs_attention",
            }
            last_state = state_map.get(live.get("last_event"), "needs_attention")
            checks.append({
                "label": "Most recent test send",
                "state": last_state,
                "detail": live.get("status_label"),
                "message_id": live.get("message_id"),
                "dashboard_url": live.get("dashboard_url"),
                "sent_at": last.get("created_at"),
            })
            tone_worst = _worse(tone_worst, last_state)
        else:
            checks.append({
                "label": "Most recent test send",
                "state": "healthy",
                "detail": "No test sends recorded yet.",
            })

        return {
            "overall": tone_worst,
            "checks": checks,
            "recipient": _preview_recipient(),
            "resend_configured": _resend_ready(),
        }




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

    # iter164ad — Members Launch View filter.
    #
    # Until the genuine (non-test, non-demo) Founding-Member count in
    # ``db.users`` reaches this threshold, the default ``/members``
    # view is restricted to Founding Members only. Once the count
    # crosses the threshold the restriction lifts automatically and
    # the list falls back to "all genuine non-test members".
    #
    # Intentionally a module-level constant so it's easy to grep for
    # and easy to tweak from a script/test if the launch strategy
    # changes.
    MEMBERS_LAUNCH_FOUNDING_THRESHOLD = 250

    @router.get("/members")
    async def list_members(
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
        q: Optional[str] = None,
        status: Optional[str] = None,  # banned|suspended|restricted|founding|demo|admin
        limit: int = 50,
        skip: int = 0,
        include_test: bool = False,  # iter164ad: default excludes QA/test-flagged users
    ):
        """Search + filter list. `q` matches name, email, username or id (case-insensitive).

        iter164ad — Members Launch View filter:

          * ``include_test`` defaults to ``False`` so QA/test-flagged
            users (``is_test: true``) are excluded from the normal
            admin view. Pass ``include_test=true`` for an explicit
            admin override (used when auditing seeded/test rows).

          * Pre-launch gating: while fewer than
            :data:`MEMBERS_LAUNCH_FOUNDING_THRESHOLD` genuine
            (non-test, non-demo) Founding Members exist in the users
            collection, the *default* Members view is restricted to
            Founding Members only — this matches the launch-period UX
            where the Members list *is* the Founding-Member roster.
            The restriction lifts automatically at the threshold; no
            code change or redeploy is needed.

          * Explicit ``status=`` filters (banned, suspended,
            restricted, founding, demo, admin) always take precedence
            and are NOT affected by the launch gate — an admin
            filtering by ``status=demo`` sees all demo rows regardless
            of the Founding-Member count.

          * ``include_test=true`` also lifts the launch gate, since
            the caller has explicitly asked for the full admin view.

        The response always includes a ``launch_gate`` diagnostic dict
        so the frontend can surface a small hint like "Pre-launch view
        — Founding Members only until 250 join".
        """
        mongo_q: dict = {}

        # iter164ad — test-flag filter (default excludes).
        if not include_test:
            mongo_q["is_test"] = {"$ne": True}

        # iter164ad — launch gate applies only to the *default* view:
        # no explicit status filter, and include_test not overridden.
        launch_gate_active = False
        genuine_founder_count: Optional[int] = None
        if status is None and not include_test:
            genuine_founder_q = {
                "is_test": {"$ne": True},
                "is_demo": {"$ne": True},
                "$or": [
                    {"is_founder": True},
                    {"is_founding_member": True},
                    {"founding_member": True},
                ],
            }
            genuine_founder_count = await db.users.count_documents(genuine_founder_q)
            if genuine_founder_count < MEMBERS_LAUNCH_FOUNDING_THRESHOLD:
                launch_gate_active = True
                mongo_q["$or"] = [
                    {"is_founder": True},
                    {"is_founding_member": True},
                    {"founding_member": True},
                ]

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
                {"is_founder": True},
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
        return {
            "items": rows,
            "total": total,
            "limit": limit,
            "skip": skip,
            # iter164ad — launch-gate diagnostics for the UI.
            "launch_gate": {
                "active":          launch_gate_active,
                "threshold":       MEMBERS_LAUNCH_FOUNDING_THRESHOLD,
                "founder_count":   genuine_founder_count,
                "include_test":    bool(include_test),
                "reason": (
                    "Pre-launch: Members view restricted to Founding "
                    f"Members until {MEMBERS_LAUNCH_FOUNDING_THRESHOLD} "
                    "genuine Founding Members exist."
                ) if launch_gate_active else None,
            },
        }

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

    # Body models declared at closure scope aren't reliably picked up
    # as request bodies by FastAPI's introspection in some Python
    # environments (parameters bind as query params instead), so the
    # member-action routes below accept a plain ``dict`` body and
    # validate the fields inline. Same schema, safer wiring.

    @router.post("/members/{user_id}/notes")
    async def add_member_note(
        user_id: str,
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),
    ):
        note = (body.get("note") or "").strip()
        if not note:
            raise HTTPException(400, "Note cannot be empty")
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(404, "Member not found")
        await _log_member_action(admin, user_id, "note", reason=note)
        return {"ok": True}

    @router.post("/members/{user_id}/actions/warn")
    async def warn_member(
        user_id: str,
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),
    ):
        reason = (body.get("reason") or "").strip()
        report_id = body.get("report_id") or None
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(404, "Member not found")
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": user_id,
            "type": "moderation_warning",
            "title": "You have received a warning",
            "body": reason or "Please review our community guidelines.",
            "read": False, "created_at": _iso_now(),
        })
        if report_id:
            await db.reports.update_one(
                {"id": report_id},
                {"$set": {"status": "resolved", "outcome": "warned",
                          "admin_note": reason, "updated_at": _iso_now()}},
            )
        await _log_member_action(admin, user_id, "warn",
                                 reason=reason, report_id=report_id)
        return {"ok": True}

    @router.post("/members/{user_id}/actions/suspend")
    async def suspend_member(
        user_id: str,
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),
    ):
        reason = (body.get("reason") or "").strip()
        report_id = body.get("report_id") or None
        duration_hours = int(body.get("duration_hours") or 24)
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(404, "Member not found")
        hours = max(1, duration_hours)
        until = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
        await db.users.update_one(
            {"id": user_id},
            {"$set": {
                "restricted": True,
                "suspended_until": until,
                "restricted_reason": reason or "Suspended by admin",
                "restricted_at": _iso_now(),
            }},
        )
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": user_id,
            "type": "moderation_suspension",
            "title": "Your account has been suspended",
            "body": f"Reason: {reason or 'See community guidelines'}. Lifted at {until}.",
            "read": False, "created_at": _iso_now(),
        })
        if report_id:
            await db.reports.update_one(
                {"id": report_id},
                {"$set": {"status": "resolved", "outcome": f"suspended_{hours}h",
                          "admin_note": reason, "updated_at": _iso_now()}},
            )
        await _log_member_action(
            admin, user_id, "suspend", reason=reason,
            report_id=report_id,
            extra={"duration_hours": hours, "until": until},
        )
        return {"ok": True, "suspended_until": until}

    @router.post("/members/{user_id}/actions/ban")
    async def ban_member(
        user_id: str,
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),
    ):
        reason = (body.get("reason") or "").strip()
        report_id = body.get("report_id") or None
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(404, "Member not found")
        await db.users.update_one(
            {"id": user_id},
            {"$set": {
                "banned": True, "restricted": True,
                "restricted_reason": reason or "Banned by admin",
                "restricted_at": _iso_now(),
            }},
        )
        if report_id:
            await db.reports.update_one(
                {"id": report_id},
                {"$set": {"status": "resolved", "outcome": "banned",
                          "admin_note": reason, "updated_at": _iso_now()}},
            )
        await _log_member_action(admin, user_id, "ban",
                                 reason=reason, report_id=report_id)
        return {"ok": True}

    @router.post("/members/{user_id}/actions/restore")
    async def restore_member(
        user_id: str,
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),
    ):
        reason = (body.get("reason") or "").strip()
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
        await _log_member_action(admin, user_id, "restore", reason=reason)
        return {"ok": True}

    @router.post("/members/{user_id}/actions/delete")
    async def delete_member(
        user_id: str,
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),
    ):
        confirm_member_id = (body.get("confirm_member_id") or "").strip()
        reason = (body.get("reason") or "").strip()
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(404, "Member not found")
        # GitHub-style safety gate — admin must have typed the Member ID.
        if confirm_member_id != user_id:
            raise HTTPException(400, "Member ID confirmation does not match")
        # Log FIRST so the audit trail survives the delete.
        await _log_member_action(
            admin, user_id, "delete",
            reason=reason or "Hard delete (right-to-erasure)",
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
    async def kb_backfill_embeddings(
        body: dict = Body(default={}),
        admin: dict = Depends(current_cms_admin),
    ):
        # `force=true` re-embeds every entry; used after a model swap
        # so stale vectors get replaced. Default is idempotent.
        force = bool(body.get("force", False))
        result = await _kb.backfill_embeddings(db, force=force)
        await _audit.log_admin_action(
            db, admin=admin, action="kb.embeddings.backfill",
            metadata={**result, "forced": force},
        )
        return {"ok": True, **result}

    @router.get("/knowledge-health")
    async def kb_health(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """Knowledge Health snapshot for Mission Control.

        Returns counts, embedding coverage, model name, dim and the
        last-embedding-run timestamp. Cheap enough to poll on view.
        """
        return await _kb.health(db)

    @router.get("/knowledge-retrievals")
    async def kb_retrievals(
        limit: int = 50,
        surface: str = "",
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Recent KB retrieval log across ALL Georges (MCGS + member + public).

        Feeds the "Recent retrievals" panel in Mission Control so admins
        can trace which entries informed a conversation and spot topics
        the KB doesn't yet cover (hit_count = 0).
        """
        from services.george import kb_grounding as _kbg
        rows = await _kbg.recent_hits(db, limit=max(1, min(200, int(limit))), surface=(surface or None))
        coverage = await _kbg.coverage_summary(db, days=7)
        return {"items": rows, "coverage": coverage}

    # ── George Daily Welcome (greeting library CRUD) ─────────────────
    @router.get("/george/greetings")
    async def list_greetings(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        from services.george import daily_welcome as _dw
        rows = await _dw.list_greetings(db)
        return {"items": rows}

    @router.post("/george/greetings")
    async def create_greeting(
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),
    ):
        from services.george import daily_welcome as _dw
        body = dict(body or {})
        body["created_by"] = admin.get("email") or "admin"
        try:
            saved = await _dw.upsert_greeting(db, body)
        except ValueError as ve:
            raise HTTPException(400, str(ve))
        await _audit.log_admin_action(
            db, admin=admin, action="george.greetings.create",
            metadata={"id": saved.get("id"), "text": saved.get("text")},
        )
        return saved

    @router.patch("/george/greetings/{gid}")
    async def update_greeting(
        gid: str,
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),
    ):
        from services.george import daily_welcome as _dw
        patch = dict(body or {})
        patch["id"] = gid
        try:
            saved = await _dw.upsert_greeting(db, patch)
        except ValueError as ve:
            raise HTTPException(400, str(ve))
        await _audit.log_admin_action(
            db, admin=admin, action="george.greetings.update",
            metadata={"id": gid},
        )
        return saved

    @router.delete("/george/greetings/{gid}")
    async def delete_greeting(
        gid: str,
        admin: dict = Depends(current_cms_admin),
    ):
        from services.george import daily_welcome as _dw
        ok = await _dw.delete_greeting(db, gid)
        if not ok:
            raise HTTPException(404, "Greeting not found")
        await _audit.log_admin_action(
            db, admin=admin, action="george.greetings.delete", metadata={"id": gid},
        )
        return {"ok": True}

    @router.get("/george/greetings/preview")
    async def preview_greeting(
        first_name: str = "Margaret",
        context: Optional[str] = None,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Preview a greeting without burning the current admin's
        once-per-day slot. Handy for shaping copy.

        Accepts the same `?context=` surface-tag list as the mobile
        endpoint (e.g. `context=home:share_a_moment_hero`) so admins
        can sanity-check that George picks a non-echoing greeting on
        each screen.
        """
        from services.george import daily_welcome as _dw
        active_contexts = [
            t.strip() for t in (context or "").split(",") if t and t.strip()
        ] or None
        # Use a stub user so we don't hit the state collection at all.
        return await _dw.get_daily_welcome(
            db,
            user={"id": None, "first_name": first_name},
            force=True,
            active_contexts=active_contexts,
        )

    # ── Launch Manager ───────────────────────────────────────────────
    from services import launch as _launch

    # ── Segments (CRM Phase 2C) ────────────────────────────────────
    #
    # A segment is a saved, named group of members. Predicate-driven
    # so future filters cost ~10 LOC in services/segments.py to add.
    # See services/segments.py for architecture notes.
    from services import segments as _segments

    @router.get("/segments")
    async def list_segments_ep(
        include_archived: bool = False,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        rows = await _segments.list_segments(db, include_archived=include_archived)
        return {"items": rows, "count": len(rows)}

    @router.get("/segments/filters")
    async def list_segment_filters(
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Return the catalog of available filter primitives. Consumed
        by the segment builder UI to render the filter picker."""
        return {"filters": _segments.filter_catalog()}

    @router.post("/segments/preview")
    async def preview_segment_ep(
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Live audience estimate for an unsaved predicate. Called by
        the builder UI on every filter change (debounced client-side)."""
        try:
            result = await _segments.run_predicate(
                db, body.get("predicate") or body, limit=6,
            )
        except _segments.SegmentError as e:
            raise HTTPException(400, str(e))
        return result

    @router.get("/segments/{sid}")
    async def get_segment_ep(sid: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        seg = await _segments.get_segment(db, sid)
        if not seg:
            raise HTTPException(404, "Segment not found")
        return seg

    @router.post("/segments")
    async def create_segment_ep(
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),
    ):
        try:
            saved = await _segments.upsert_segment(
                db, body, actor_email=admin.get("email"),
            )
        except _segments.SegmentError as e:
            raise HTTPException(400, str(e))
        await _audit.log_admin_action(
            db, admin=admin, action="segments.create",
            metadata={"id": saved.get("id"), "name": saved.get("name")},
        )
        return saved

    @router.patch("/segments/{sid}")
    async def update_segment_ep(
        sid: str,
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),
    ):
        patch = dict(body or {})
        patch["id"] = sid
        try:
            saved = await _segments.upsert_segment(
                db, patch, actor_email=admin.get("email"),
            )
        except _segments.SegmentError as e:
            raise HTTPException(400, str(e))
        await _audit.log_admin_action(
            db, admin=admin, action="segments.update",
            metadata={"id": sid},
        )
        return saved

    @router.delete("/segments/{sid}")
    async def delete_segment_ep(
        sid: str,
        hard: bool = False,
        admin: dict = Depends(current_cms_admin),
    ):
        ok = await _segments.delete_segment(db, sid, archive=not hard)
        if not ok:
            raise HTTPException(404, "Segment not found")
        await _audit.log_admin_action(
            db, admin=admin, action="segments.delete" if hard else "segments.archive",
            metadata={"id": sid},
        )
        return {"ok": True}

    @router.post("/segments/{sid}/refresh-count")
    async def refresh_segment_count_ep(
        sid: str,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        seg = await _segments.refresh_count(db, sid)
        if not seg:
            raise HTTPException(404, "Segment not found")
        return seg

    @router.post("/segments/suggest")
    async def suggest_segments_ep(
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Quiet campaign assistant. Given a draft campaign's subject
        and body, return the top 1\u20133 saved segments that look like a
        fit. Uses simple text overlap over segment names + descriptions
        + predicate summaries \u2014 no LLM call, so it stays snappy while
        the admin types. Locked with Garry, 1 Aug 2026: George should
        \u201cquietly think\u201d, not take over.
        """
        text = " ".join([
            str(body.get("subject") or ""),
            str(body.get("title") or ""),
            str(body.get("body_md") or ""),
            str(body.get("preheader") or ""),
        ]).lower()
        if not text.strip():
            return {"suggestions": []}
        rows = await _segments.list_segments(db, include_archived=False)
        scored: list[tuple[float, dict]] = []
        for seg in rows:
            corpus = " ".join([
                str(seg.get("name") or ""),
                str(seg.get("description") or ""),
                str(seg.get("predicate_summary") or ""),
            ]).lower()
            words = {w for w in corpus.replace(",", " ").split() if len(w) > 3}
            hits = sum(1 for w in words if w in text)
            if hits:
                scored.append((hits, seg))
        scored.sort(key=lambda p: p[0], reverse=True)
        return {"suggestions": [
            {
                "id":          s.get("id"),
                "name":        s.get("name"),
                "emoji":       s.get("emoji"),
                "count":       s.get("last_count"),
                "description": s.get("description"),
                "confidence":  min(1.0, score / 3.0),
            }
            for (score, s) in scored[:3]
        ]}

    @router.get("/settings/launch")
    async def get_launch_settings(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        settings = await _launch.get_settings(db)
        readiness = await _launch.readiness_observation(db, settings)
        return {"settings": settings, "readiness": readiness}

    @router.patch("/settings/launch")
    async def update_launch_settings(
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),
    ):
        try:
            saved = await _launch.save_settings(
                db, patch=body, updated_by=admin.get("email"),
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        readiness = await _launch.readiness_observation(db, saved)
        # Track only the boolean/date fields in the audit — never the raw URLs
        # (they're not sensitive but the audit stays tidy).
        await _audit.log_admin_action(
            db, admin=admin, action="launch.settings.update",
            metadata={
                k: (body[k] if k in ("enabled", "launch_complete", "press_kit_ready", "launch_at") else "set")
                for k in body.keys() if k in _launch.DEFAULTS
            },
        )
        return {"settings": saved, "readiness": readiness}

    # Ensure indexes on startup (idempotent).
    import asyncio as _asyncio
    # -----------------------------------------------------------------
    # Flyer Publishing Centre (Garry, 3 Aug 2026)
    # -----------------------------------------------------------------
    # Templates live in the `flyer_templates` collection. Layouts live
    # in `services.flyers.registry.LAYOUTS`. The renderer dispatches
    # to the existing PIL engine (via `services.flyers.renderer`) so
    # the design remains authored in exactly one place.
    #
    # All CRUD routes require CMS admin auth. The `/render` endpoint
    # is also admin-gated for now — public rendering (for the mobile
    # "Share a flyer" screen) will land as a signed public endpoint
    # in a follow-on. This keeps launch scope tight and avoids leaking
    # per-admin QR codes to unauthenticated callers.
    from services import flyers as _flyers

    @router.get("/flyer-layouts")
    async def flyer_layouts(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """Data-driven layout registry — the UI uses this to build the
        picker without hard-coding any layout details."""
        cats = sorted(_flyers.CATEGORIES.values(), key=lambda c: c.order)
        return {
            "categories": [
                {
                    "key": c.key,
                    "label": c.label,
                    "description": c.description,
                    "layouts": [lay.as_dict() for lay in _flyers.layouts_for_category(c.key)],
                }
                for c in cats
            ],
        }

    @router.get("/flyer-fields")
    async def flyer_fields_ep(admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        """Return the FIELD_LIBRARY so the /admin/flyers/[key] editor can
        show a menu of editable placeholders any template can opt into.
        Adding a new field is a data-only edit to `templates.FIELD_LIBRARY`."""
        return {"fields": _flyers.field_library()}

    @router.get("/flyer-templates")
    async def list_flyer_templates_ep(
        status: Optional[str] = None,
        category: Optional[str] = None,
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        rows = await _flyers.list_templates(db, status=status, category=category)
        return {"templates": rows}

    @router.get("/flyer-templates/{key}")
    async def get_flyer_template_ep(key: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        tpl = await _flyers.get_template(db, key)
        if not tpl:
            raise HTTPException(404, "Template not found")
        return tpl

    @router.post("/flyer-templates")
    async def create_flyer_template_ep(
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),
    ):
        key = str(body.get("key") or "").strip()
        name = str(body.get("name") or "").strip()
        if not key or not name:
            raise HTTPException(400, "key and name are required")
        # Prevent silent duplicate on repeated POSTs.
        existing = await _flyers.get_template(db, key)
        if existing:
            raise HTTPException(409, f"Template '{key}' already exists")
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        doc = {
            "key": key,
            "id": key,
            "name": name,
            "description": body.get("description") or "",
            "category": body.get("category") or "notice",
            "engine": body.get("engine") or _flyers.templates.ENGINE_FOUNDING,
            "fields": body.get("fields") or [],
            "supported_layouts": body.get("supported_layouts") or ["poster_a4"],
            "default_layout": body.get("default_layout") or "poster_a4",
            "static_assets": body.get("static_assets") or {},
            "george_hint": body.get("george_hint") or "",
            "status": "draft",
            "used_count": 0,
            "version": 1,
            "created_at": now,
            "updated_at": now,
            "created_by": admin.get("id"),
        }
        await db[_flyers.COLL_FLYER_TEMPLATES].insert_one(doc)
        doc.pop("_id", None)
        return doc

    @router.patch("/flyer-templates/{key}")
    async def edit_flyer_template_ep(
        key: str,
        body: dict = Body(...),
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        allowed = {
            "name", "description", "category", "fields",
            "supported_layouts", "default_layout", "george_hint",
            "preview_image", "static_assets",
        }
        update = {k: v for k, v in body.items() if k in allowed}
        if not update:
            raise HTTPException(400, "Nothing to update")
        from datetime import datetime, timezone
        update["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        r = await db[_flyers.COLL_FLYER_TEMPLATES].update_one(
            {"key": key}, {"$set": update, "$inc": {"version": 1}},
        )
        if r.matched_count == 0:
            raise HTTPException(404, "Template not found")
        return await _flyers.get_template(db, key)

    async def _set_flyer_status(key: str, new_status: str) -> dict:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        upd: dict = {"status": new_status, "updated_at": now}
        if new_status == "published":
            upd["published_at"] = now
        r = await db[_flyers.COLL_FLYER_TEMPLATES].update_one({"key": key}, {"$set": upd})
        if r.matched_count == 0:
            raise HTTPException(404, "Template not found")
        return await _flyers.get_template(db, key)

    @router.post("/flyer-templates/{key}/publish")
    async def publish_flyer_ep(key: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        return await _set_flyer_status(key, "published")

    @router.post("/flyer-templates/{key}/unpublish")
    async def unpublish_flyer_ep(key: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        return await _set_flyer_status(key, "draft")

    @router.post("/flyer-templates/{key}/archive")
    async def archive_flyer_ep(key: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        return await _set_flyer_status(key, "archived")

    @router.post("/flyer-templates/{key}/duplicate")
    async def duplicate_flyer_ep(key: str, admin: dict = Depends(current_cms_admin)):
        tpl = await _flyers.get_template(db, key)
        if not tpl:
            raise HTTPException(404, "Template not found")
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        # Suffix -copy / -copy-2 / -copy-3 … until we find a free slot.
        base = f"{key}-copy"
        n, cand = 0, base
        while await _flyers.get_template(db, cand):
            n += 1
            cand = f"{base}-{n}"
        new_doc = {**tpl, "key": cand, "id": cand, "status": "draft",
                   "used_count": 0, "version": 1,
                   "name": f"{tpl.get('name', key)} (copy)",
                   "created_at": now, "updated_at": now,
                   "published_at": None,
                   "created_by": admin.get("id")}
        new_doc.pop("_id", None)
        await db[_flyers.COLL_FLYER_TEMPLATES].insert_one(dict(new_doc))
        return new_doc

    @router.get("/flyer-templates/{key}/render")
    async def render_flyer_ep(
        key: str,
        request: Request,
        layout: str = "poster_a4",
        format: str = "png",
        admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        """Render a flyer for print / preview.

        Accepts ANY field from the FIELD_LIBRARY as an optional query
        parameter (`?venue=…&headline=…&meeting_day=…`). Engines
        consume the fields they care about; unknown fields are
        ignored so the API stays forward-compatible when new engines
        adopt more of the library.

        Returns raw bytes (PNG or PDF) with `inline` disposition so
        the Mission Control print modal can embed via <iframe> and
        trigger `window.print()` without a download step.

        Set ``?format=pdf`` to receive a single-page PDF sized to the
        layout's real paper size (iter159 marketing launch — used by
        outbound email attachments). PNG remains the default so the
        Mission Control iframe preview keeps working unchanged.

        Attribution note (Garry, 3 Aug 2026): the founding-flyer engine
        embeds a QR that credits an *app admin* from `users`. CMS
        admins live in `cms_admins` so when the caller doesn't pass
        `admin_id`, we auto-attribute to the first app admin found.
        """
        # Pull every known field from the query string. Unknown params
        # are silently ignored — the render layer will only pass what
        # each engine understands.
        params: Dict[str, Any] = {}
        qp = request.query_params
        for fkey in _flyers.KNOWN_FIELD_KEYS:
            v = qp.get(fkey)
            if v is not None and v != "":
                params[fkey] = v

        # iter164aa: `show_founding_member` is a per-render *toggle*
        # (not a content field), so it lives outside FIELD_LIBRARY.
        # The Publishing Centre editor's dedicated switch sends this
        # as ``true``/``false``; missing → renderer default (True).
        _sfm = qp.get("show_founding_member")
        if _sfm is not None and _sfm != "":
            params["show_founding_member"] = _sfm

        # admin_id fallback so previews always work from Mission Control
        # without asking the CMS admin to pick someone.
        if not params.get("admin_id"):
            fallback = await db.users.find_one(
                {"is_admin": True, "is_demo": {"$ne": True}}, {"_id": 0, "id": 1},
            )
            if not fallback:
                fallback = await db.users.find_one({"is_admin": True}, {"_id": 0, "id": 1})
            if fallback:
                params["admin_id"] = fallback["id"]

        try:
            result = await _flyers.render_flyer(
                db=db,
                template_key=key,
                layout_key=layout,
                params=params,
            )
        except (ValueError, KeyError, FileNotFoundError) as e:
            raise HTTPException(400, str(e))

        # iter159: transparent PDF conversion for outbound email
        # attachments. We only convert when the underlying render was
        # a PNG (founding engine). Static-PDF templates already return
        # `application/pdf` so we pass them through untouched.
        want_pdf = (format or "").strip().lower() == "pdf"
        if want_pdf and result.media_type == "image/png":
            try:
                from services.flyers.pdf_export import png_bytes_to_pdf_bytes
                pdf_bytes, _ext = png_bytes_to_pdf_bytes(result.content, layout)
                content_out = pdf_bytes
                media_out = "application/pdf"
                filename_out = result.filename.rsplit(".", 1)[0] + ".pdf"
            except Exception as exc:  # noqa: BLE001
                import logging as _logging
                _logging.getLogger("friendplace.flyers").exception("PDF conversion failed for %s/%s", key, layout)
                raise HTTPException(500, f"PDF conversion failed: {exc}")
        else:
            content_out = result.content
            media_out = result.media_type
            filename_out = result.filename

        from fastapi.responses import Response  # local import to match cms_module.py pattern
        return Response(
            content=content_out,
            media_type=media_out,
            headers={
                "Content-Disposition": f'inline; filename="{filename_out}"',
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                # A tiny audit breadcrumb — visible in the browser
                # devtools when debugging print quality.
                "X-Flyer-Summary": result.summary,
            },
        )

    # Seed the initial templates on boot (idempotent) + ensure indexes.
    try:
        _asyncio.get_event_loop().create_task(_flyers.seed_flyer_templates(db))
    except Exception:
        pass

    # ------------------------------------------------------------------
    # iter159 — Marketing sub-router (Send Email, preview, sends
    # history, contacts). Mounted here so it inherits the /cms prefix
    # AND the same admin auth dependency as every other CMS route.
    # Effective URLs: /api/cms/marketing/*
    # ------------------------------------------------------------------
    try:
        from services.marketing.router import build_marketing_router as _build_mkt_router
        from services.marketing.sends import ensure_indexes as _mkt_sends_indexes
        from services.marketing.contacts import ensure_indexes as _mkt_contacts_indexes

        router.include_router(_build_mkt_router(db, current_cms_admin))

        async def _bootstrap_marketing_indexes():
            try:
                await _mkt_sends_indexes(db)
                await _mkt_contacts_indexes(db)
            except Exception:  # noqa: BLE001
                import logging as _logging
                _logging.getLogger("friendplace.marketing").exception("marketing index bootstrap failed")

        try:
            _asyncio.get_event_loop().create_task(_bootstrap_marketing_indexes())
        except Exception:
            pass
    except Exception:  # noqa: BLE001
        # Never crash CMS boot because marketing failed to import —
        # log and continue with the rest of the admin surface.
        import logging as _logging
        _logging.getLogger("friendplace.marketing").exception("marketing router mount failed")

    # ------------------------------------------------------------------
    # iter160a — Outreach sub-router (organisations CRUD + timeline).
    # Effective URLs: /api/cms/outreach/*
    # ------------------------------------------------------------------
    try:
        from services.outreach.router import build_outreach_router as _build_outreach_router
        from services.outreach.store  import ensure_indexes as _outreach_indexes
        router.include_router(_build_outreach_router(db, current_cms_admin))
        async def _bootstrap_outreach_indexes():
            try:
                await _outreach_indexes(db)
            except Exception:
                import logging as _logging
                _logging.getLogger("friendplace.outreach").exception("outreach index bootstrap failed")
        try:
            _asyncio.get_event_loop().create_task(_bootstrap_outreach_indexes())
        except Exception:
            pass
    except Exception:
        import logging as _logging
        _logging.getLogger("friendplace.outreach").exception("outreach router mount failed")

    # ------------------------------------------------------------------
    # iter160b — Replies inbox sub-router (manual "Log a reply" flow).
    # Effective URLs: /api/cms/replies/*
    # ------------------------------------------------------------------
    try:
        from services.replies.router import build_replies_router as _build_replies_router
        from services.replies.store  import ensure_indexes as _replies_indexes
        router.include_router(_build_replies_router(db, current_cms_admin))
        async def _bootstrap_replies_indexes():
            try:
                await _replies_indexes(db)
            except Exception:
                import logging as _logging
                _logging.getLogger("friendplace.replies").exception("replies index bootstrap failed")
        try:
            _asyncio.get_event_loop().create_task(_bootstrap_replies_indexes())
        except Exception:
            pass
    except Exception:
        import logging as _logging
        _logging.getLogger("friendplace.replies").exception("replies router mount failed")

    # ------------------------------------------------------------------
    # iter162 — Reminders (Mission Control small V1).
    # Effective URLs: /api/cms/reminders/*
    # ------------------------------------------------------------------
    try:
        from services.reminders.router import build_reminders_router as _build_reminders_router
        from services.reminders.store  import ensure_indexes as _reminders_indexes
        router.include_router(_build_reminders_router(db, current_cms_admin))
        async def _bootstrap_reminders_indexes():
            try:
                await _reminders_indexes(db)
            except Exception:
                import logging as _logging
                _logging.getLogger("friendplace.reminders").exception("reminders index bootstrap failed")
        try:
            _asyncio.get_event_loop().create_task(_bootstrap_reminders_indexes())
        except Exception:
            pass
    except Exception:
        import logging as _logging
        _logging.getLogger("friendplace.reminders").exception("reminders router mount failed")

    # ------------------------------------------------------------------
    # iter164h — Butterfly Points manual recognition (Mission Control).
    # Effective URLs:
    #   POST /api/cms/members/{id}/butterfly-points/award
    #   POST /api/cms/members/{id}/butterfly-points/{ledger_id}/reverse
    #   GET  /api/cms/members/{id}/butterfly-points
    #   GET  /api/cms/members/butterfly-points/policy
    #   POST /api/cms/members/butterfly-points/preview
    # ------------------------------------------------------------------
    try:
        from services.butterfly_points.router import build_points_router as _build_points_router
        from services.butterfly_points.store  import ensure_indexes as _points_indexes
        # server.py owns the running-balance + notification helpers we
        # must delegate to; lazy-import to avoid a circular dep at
        # module load time.
        import server as _srv
        router.include_router(
            _build_points_router(
                db, current_cms_admin,
                award_points_impl=_srv.award_points,
                push_notification_impl=_srv.push_notification,
            ),
        )
        async def _bootstrap_points_indexes():
            try:
                await _points_indexes(db)
            except Exception:
                import logging as _logging
                _logging.getLogger("friendplace.butterfly_points").exception("butterfly_points index bootstrap failed")
        try:
            _asyncio.get_event_loop().create_task(_bootstrap_points_indexes())
        except Exception:
            pass
    except Exception:
        import logging as _logging
        _logging.getLogger("friendplace.butterfly_points").exception("butterfly_points router mount failed")

    # ------------------------------------------------------------------
    # iter160a — CRM unified-status endpoints (compute-on-the-fly).
    # ------------------------------------------------------------------
    @router.get("/crm/status-for/{email}")
    async def _crm_status_for(email: str, admin: dict = Depends(current_cms_admin)):  # noqa: ARG001
        from services.crm.status import status_for_email
        return await status_for_email(db, email)

    @router.get("/crm/awaiting-reply")
    async def _crm_awaiting_reply(
        limit: int = 200, admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        from services.crm.status import list_awaiting_reply
        return {"rows": await list_awaiting_reply(db, limit=limit)}

    @router.get("/crm/needs-follow-up")
    async def _crm_needs_follow_up(
        days: int = 7, limit: int = 200, admin: dict = Depends(current_cms_admin),  # noqa: ARG001
    ):
        from services.crm.status import list_needs_follow_up
        return {"rows": await list_needs_follow_up(db, days_since_last_contact=days, limit=limit)}

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

    # ── Scheduled campaign poller ───────────────────────────────────
    # Attach a small idempotent coroutine to the router so `server.py`
    # can spawn it at startup. Every 30 s it looks for scheduled
    # campaigns whose time has come and hands them off to the send
    # worker. Cancelling a scheduled campaign (DELETE) or bumping it
    # back to a draft (unschedule) removes it from the query.
    async def start_scheduled_poller() -> None:
        import asyncio as _asyncio
        from datetime import datetime, timezone
        while True:
            try:
                now_iso_val = datetime.now(timezone.utc).isoformat()
                async for c in db.campaigns.find(
                    {"status": "scheduled", "scheduled_at": {"$lte": now_iso_val}},
                    {"_id": 0, "id": 1},
                ):
                    # Atomically claim the campaign so a duplicate
                    # poller loop (rare, but possible during restarts)
                    # can't send twice.
                    claim = await db.campaigns.update_one(
                        {"id": c["id"], "status": "scheduled"},
                        {"$set": {"status": "sending"}},
                    )
                    if claim.modified_count:
                        _asyncio.create_task(_campaign_send_worker(c["id"]))
            except Exception:
                import logging as _logging
                _logging.getLogger("friendplace.email").exception(
                    "Scheduled campaign poller iteration failed",
                )
            await _asyncio.sleep(30)

    router.start_scheduled_poller = start_scheduled_poller  # type: ignore[attr-defined]

    return router
