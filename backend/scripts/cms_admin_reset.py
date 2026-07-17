"""Emergency CLI reset for the FriendPlace Mini-CMS admin.

Use this when the admin has lost access and Resend can't help (email
domain misconfigured, forgotten address, etc.). Requires shell access
to the backend container.

Usage
─────
    python /app/backend/scripts/cms_admin_reset.py --list
    python /app/backend/scripts/cms_admin_reset.py --email admin@friendplace.com.au --password "NewStrongPass!23"
    python /app/backend/scripts/cms_admin_reset.py --wipe   # deletes ALL cms_admins → next visitor to /admin/setup creates a new one

Safe on production: only touches the `cms_admins` collection, never
`users` or `site_content`.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Make sure we can import from the backend package regardless of cwd.
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _connect():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    client = AsyncIOMotorClient(mongo_url)
    return client, client[db_name]


async def list_admins():
    client, db = await _connect()
    try:
        cur = db.cms_admins.find({}, {"_id": 0, "password_hash": 0})
        docs = await cur.to_list(length=None)
        if not docs:
            print("(No admins found. Anyone can visit /admin/setup to create one.)")
            return
        print(f"Found {len(docs)} admin(s):")
        for d in docs:
            print(f"  • {d.get('email')}  (id={d.get('id')}, last_login={d.get('last_login_at')})")
    finally:
        client.close()


async def force_reset(email: str, new_password: str):
    email = email.lower().strip()
    if len(new_password) < 8:
        raise SystemExit("Password must be at least 8 characters")
    client, db = await _connect()
    try:
        admin = await db.cms_admins.find_one({"email": email})
        if not admin:
            raise SystemExit(f"❌ No admin with email {email!r} found")
        await db.cms_admins.update_one(
            {"id": admin["id"]},
            {"$set": {"password_hash": pwd_ctx.hash(new_password), "reset_at": _now_iso()}},
        )
        print(f"✅ Password reset for {email}. You can log in now at /admin/login.")
    finally:
        client.close()


async def wipe_admins(confirm: bool):
    if not confirm:
        raise SystemExit(
            "This will DELETE every CMS admin. Re-run with --yes to confirm.\n"
            "After wipe, visit /admin/setup to create a fresh admin."
        )
    client, db = await _connect()
    try:
        res = await db.cms_admins.delete_many({})
        print(f"🧹 Deleted {res.deleted_count} admin(s). Visit /admin/setup to create a new one.")
    finally:
        client.close()


def main():
    p = argparse.ArgumentParser(description="Emergency reset for the FriendPlace Mini-CMS admin")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--list", action="store_true", help="List all admins")
    g.add_argument("--reset", action="store_true", help="Reset a specific admin's password")
    g.add_argument("--wipe", action="store_true", help="Delete all admins (next visitor to /admin/setup creates a fresh one)")

    p.add_argument("--email", help="Admin email (required with --reset)")
    p.add_argument("--password", help="New password (required with --reset)")
    p.add_argument("--yes", action="store_true", help="Confirm --wipe")
    args = p.parse_args()

    if args.list:
        asyncio.run(list_admins())
    elif args.reset:
        if not args.email or not args.password:
            raise SystemExit("--reset requires both --email and --password")
        asyncio.run(force_reset(args.email, args.password))
    elif args.wipe:
        asyncio.run(wipe_admins(args.yes))


if __name__ == "__main__":
    main()
