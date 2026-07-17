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
        return {
            "pages_count": pages_count,
            "media_count": int(media_count),
            "faqs_count": len(content.get("faqs") or []),
            "success_stories_count": len(content.get("success_stories") or []),
            "founding_members_count_editable": len(content.get("founding_members") or []),
            "founder_signups_count": int(founder_count),
            "status": status,
            "updated_at": content.get("updated_at"),
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
        members = c.get("founding_members") or []
        try:
            count = await db.users.count_documents({"is_founder": True, "is_demo": {"$ne": True}})
        except Exception:
            count = 0
        return {"members": members, "count": int(count), "cap": 250}

    @router.get("/stories")
    async def stories():
        c = await _content()
        return {"stories": c.get("success_stories") or []}

    return router
