# FriendPlace Mini-CMS

Self-service editor for the FriendPlace marketing website.

Deployment refresh: 26 July 2026

## Getting in for the first time

1. Visit `https://friendplace.com.au/admin` (or `/admin/setup` directly).
2. On the very first visit, the setup wizard appears. Create your admin
   account with a strong password (≥ 8 chars). **This screen is only
   shown once** — after the first admin is created, `/admin/setup` is
   permanently locked and everyone must sign in via `/admin/login`.
3. You'll land on the dashboard automatically after setup.

## What you can edit today (MVP)

* **Home page** — the six feature cards (icon, title, body). Reorder with ↑↓.
* **About page** — heading, tagline, and a full WYSIWYG body (headings,
  bold/italic, lists, quotes, links, images).
* **FAQs** — add/remove/reorder question–answer pairs.
* **Media library** — upload reusable images (up to 10 MB each).
  Copy the URL from any tile to paste into the About page (via the
  Image button in the editor toolbar) or referenced anywhere else.

Changes go live within about 60 seconds — the public pages use ISR
caching so edits appear on the next request after the window elapses.

## Password recovery

**Option A: email reset link** (recommended)
Visit `/admin/forgot`, enter your email. If it matches an admin we send
a reset link via Resend, valid for 30 minutes.

**Option B: emergency CLI reset** (server access required)
For when email delivery is broken or you've forgotten which email you
used:

```bash
# List all admin accounts
python /app/backend/scripts/cms_admin_reset.py --list

# Reset a specific admin's password
python /app/backend/scripts/cms_admin_reset.py --reset \
  --email you@friendplace.com.au \
  --password "NewStrongPass!23"

# Nuclear option — delete every admin and start the setup flow fresh
python /app/backend/scripts/cms_admin_reset.py --wipe --yes
```

## Coming next

* **Success Stories** editor (rich text + author avatar).
* **Founding Members** editor (name, number, blurb, avatar).
* **Cloudinary integration** — the Media Library already stores rows
  with a `provider` field, so migrating to Cloudinary is a swap of the
  upload handler in `/app/backend/cms_module.py` (`upload_media`). No
  page-side changes needed; existing URLs stay valid via the disk
  fallback mount at `/api/uploads`.

## Where the code lives

| What                                        | Path                                          |
|---------------------------------------------|-----------------------------------------------|
| Admin UI (Next.js)                          | `/app/website/app/admin/**`                   |
| Admin components (sidebar, editor, picker)  | `/app/website/components/admin/**`            |
| Client API helpers                          | `/app/website/lib/cms-api.ts`, `cms-auth.ts`  |
| Backend routes (auth + content + media)     | `/app/backend/cms_module.py`                  |
| Emergency CLI                               | `/app/backend/scripts/cms_admin_reset.py`     |
| Public read endpoints (site consumes these) | `/api/public/{about,features,faqs,founders,stories}` |
