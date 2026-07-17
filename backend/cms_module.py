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


# ---- Auth helpers --------------------------------------------------------

def _jwt_secret() -> str:
    """Read the shared JWT secret at call time so tests can monkey-patch
    the env before importing this module."""
    return os.environ.get("JWT_SECRET", "")


def _make_admin_token(admin_id: str, email: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=CMS_JWT_TTL_HOURS)
    return jwt.encode(
        {"sub": admin_id, "email": email, "purpose": "cms_admin", "exp": exp},
        _jwt_secret(),
        algorithm=CMS_JWT_ALG,
    )


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
    async def login(body: CmsLoginIn):
        email = str(body.email).lower().strip()
        admin = await db.cms_admins.find_one({"email": email})
        if not admin or not pwd_ctx.verify(body.password, admin.get("password_hash", "")):
            # Same message for both cases → no user-enumeration.
            raise HTTPException(401, "Invalid email or password")
        token = _make_admin_token(admin["id"], admin["email"])
        await db.cms_admins.update_one(
            {"id": admin["id"]}, {"$set": {"last_login_at": _now_iso()}}
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
        if "status" in update and update["status"] not in ("draft", "published"):
            raise HTTPException(400, "status must be 'draft' or 'published'")
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
        if "status" in update and update["status"] not in ("draft", "published"):
            raise HTTPException(400, "status must be 'draft' or 'published'")
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
        if "status" in update and update["status"] not in ("draft", "published"):
            raise HTTPException(400, "status must be 'draft' or 'published'")

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

    return router


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

    @router.get("/events/{slug}")
    async def public_event_by_slug(slug: str):
        doc = await db.cms_events.find_one(
            {"slug": slug, "status": "published", "hidden": {"$ne": True}},
            {
                "_id": 0,
                "id": 1, "slug": 1, "title": 1, "description": 1, "body_html": 1,
                "cover_image_url": 1, "starts_at": 1, "ends_at": 1, "timezone": 1,
                "is_online": 1, "venue_name": 1, "venue_address": 1, "venue_url": 1,
                "meeting_url": 1, "capacity": 1, "rsvp_deadline_at": 1,
                "cost_type": 1, "cost_display": 1, "organiser_name": 1,
                "organiser_contact": 1, "accessibility_info": 1, "sponsors": 1,
            },
        )
        if not doc:
            raise HTTPException(404, "Event not found")
        going = await db.event_rsvps.count_documents({"event_id": doc["id"], "status": "going"})
        waitlist = await db.event_rsvps.count_documents({"event_id": doc["id"], "status": "waitlist"})
        doc["rsvp_counts"] = {"going": int(going), "waitlist": int(waitlist)}
        return doc

    return router
