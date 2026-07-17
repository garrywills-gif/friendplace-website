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

    return router
