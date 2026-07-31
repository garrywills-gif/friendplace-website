"""Seed George's institutional knowledge base from FriendPlace's own
documented history. Idempotent — re-run safely.

Run:
    cd /app/backend && python scripts/seed_george_kb.py
"""
from __future__ import annotations
import asyncio
import os
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()
from services import knowledge as kb  # noqa: E402


# ─── the canonical seed set ───────────────────────────────────────────
# Each entry is (id, type, title, body, tags, sources, related_ids).
# When one supersedes another, list related_ids and set superseded_by
# on the older one explicitly.

SEED: list[dict] = [
    # ── STORIES ──────────────────────────────────────────────────
    {
        "id": "KB-STORY-001", "type": "story",
        "title": "Why FriendPlace exists",
        "body_md": (
            "FriendPlace was created to help ordinary Australians make real "
            "friends and belong to real communities in a world that has become "
            "quietly, painfully lonely.\n\n"
            "It is not a dating app. It is not a social network. It is a place "
            "to belong, deliberately shaped so that showing up feels safe, "
            "unhurried, and human.\n\n"
            "The name 'FriendPlace' is the whole promise: a *place* for making "
            "friends, not a feed to consume."
        ),
        "tags": ["origin", "purpose", "identity"],
        "sources": [{"label": "Public experience principles", "url": "/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md"}],
    },
    {
        "id": "KB-STORY-002", "type": "story",
        "title": "Why George is a butterfly",
        "body_md": (
            "The butterfly is a symbol of transformation and gentleness. It "
            "arrives, it lingers if welcome, it leaves without demand.\n\n"
            "George isn't a helpdesk agent, a chatbot, or a mascot. He's the "
            "quiet host of the place — the presence that says 'come in, let me "
            "show you around'. The butterfly form makes that feel possible.\n\n"
            "It also lets George behave differently from every other AI in "
            "consumer software today: not eager, not upselling, not measuring "
            "engagement. Slow, kind, present when needed, invisible when not."
        ),
        "tags": ["george", "identity", "brand"],
        "sources": [{"label": "Meet page choreography", "url": "/app/website/app/meet/page.tsx"}],
        "related_ids": ["KB-STORY-001", "KB-STORY-005"],
        # Public entry with an admin-only layer. Members see the warm
        # story; admins see the design origin behind it.
        "admin_context": (
            "The butterfly choice grew directly out of the Quiet Host model "
            "(KB-STORY-005). We considered a house sparrow, a lighthouse, and "
            "an abstract 'presence' before settling on the butterfly for "
            "three reasons:\n\n"
            "1. It reads as a *visitor* rather than a *resident* — reinforces "
            "   that George is with you, not watching you.\n"
            "2. It has cultural resonance for older Australians (transformation, "
            "   gentleness, gardens) without being twee.\n"
            "3. It is impossible to make aggressive. A butterfly cannot upsell, "
            "   cannot demand, cannot dominate a screen. The form factor "
            "   *encodes* the behaviour we want."
        ),
    },
    {
        "id": "KB-STORY-003", "type": "story",
        "title": "The meaning of 'Because you belong too.'",
        "body_md": (
            "The slogan is not aspirational marketing — it is a rebuttal.\n\n"
            "Modern life often signals to older, quieter, or more introverted "
            "people that connection is *for other people*. FriendPlace's slogan "
            "says the opposite: **belonging is for you, too**. The 'too' is the "
            "whole sentence.\n\n"
            "This informs every design choice — from the calm typography to the "
            "absence of like counts, from the deliberate lack of viral hooks to "
            "the choice of a butterfly host over a bright brand mascot."
        ),
        "tags": ["slogan", "identity", "voice"],
        "sources": [{"label": "PUBLIC_EXPERIENCE_PRINCIPLES.md"}],
    },
    {
        "id": "KB-STORY-004", "type": "story",
        "title": "Why FriendPlace doesn't chase engagement",
        "body_md": (
            "The engagement economy has been catastrophic for well-being. "
            "Notifications, streaks, infinite scroll, and 'people like you' "
            "algorithms drive attention while corroding attention.\n\n"
            "FriendPlace opts out. There are no view counts on posts, no "
            "follower graphs, no push-notification tricks. The success measure "
            "is not time-in-app — it is the quality of the friendships that "
            "form because of it.\n\n"
            "If a user closes the app because they went to have coffee with "
            "someone they met here, that is a *win*, not a churn event."
        ),
        "tags": ["engagement", "philosophy", "identity"],
        "sources": [{"label": "PUBLIC_EXPERIENCE_PRINCIPLES.md"}],
        "related_ids": ["KB-STORY-001"],
    },
    {
        "id": "KB-STORY-005", "type": "story",
        "title": "The Quiet Host model",
        "body_md": (
            "The public website is designed as a *visit*, not a website.\n\n"
            "George/Georgia greets you at the door with 'come in, let me show "
            "you around', then steps back while you explore the rooms (About, "
            "How it works, Features). At the end, when you're ready, they "
            "invite you to leave your name at the door — Register Your Interest.\n\n"
            "This is deliberately the opposite of the modern conversion funnel. "
            "It respects visitors. It filters *for* people who value calm.\n\n"
            "FriendPlace isn't a website. It's a visit."
        ),
        "tags": ["public-site", "philosophy", "george"],
        "sources": [{"label": "PUBLIC_EXPERIENCE_PRINCIPLES.md"}, {"label": "Journey continuity"}],
        "related_ids": ["KB-STORY-002"],
    },
    {
        "id": "KB-STORY-006", "type": "story",
        "title": "Why we don't publicly list members",
        "body_md": (
            "Older adults are disproportionately targeted by scams, catfish, "
            "and social-media exploitation. A public member directory would "
            "make FriendPlace a hunting ground.\n\n"
            "Members are found through the *rooms* they choose to be in — a "
            "Coffee Lounge conversation they joined, a group they belong to, "
            "an event they attended. Never through a search-anyone directory.\n\n"
            "This is a safety decision that grew directly from the promise of "
            "'Because you belong too.' Belonging without exposure."
        ),
        "tags": ["safety", "privacy", "identity"],
        "related_ids": ["KB-STORY-003"],
    },

    # ── PRINCIPLES ───────────────────────────────────────────────
    {
        "id": "KB-PRIN-001", "type": "principle",
        "title": "Safety before growth",
        "body_md": (
            "When any decision trades safety for growth, safety wins. This "
            "applies to moderation thresholds, member visibility, admin access, "
            "and product features. Growth is a byproduct of trust, never the "
            "input to it."
        ),
        "tags": ["safety", "moderation", "product"],
    },
    {
        "id": "KB-PRIN-002", "type": "principle",
        "title": "Kindness at the surface, rigour underneath",
        "body_md": (
            "Every user-facing surface must feel warm and unhurried. Behind "
            "those surfaces, the engineering is rigorous — proper audit logs, "
            "identity-safe moderation, hardened auth, thoughtful failure modes. "
            "Users should never feel the rigour. Admins should never lack it."
        ),
        "tags": ["design", "engineering", "voice"],
    },
    {
        "id": "KB-PRIN-003", "type": "principle",
        "title": "Every new admin feature reaches George's knowledge before it ships",
        "body_md": (
            "George is the guide to FriendPlace and Mission Control. If a new "
            "admin feature is added, George should immediately know about it — "
            "not \"eventually,\" not \"once someone documents it,\" but by the "
            "same commit that ships the feature.\n\n"
            "**Concretely, every new admin-facing feature MUST:**\n\n"
            "  1. Appear in the Mission Control sidebar (`AdminShell.NAV_GROUPS`) "
            "with a clear, unambiguous label. The label should read the way an "
            "admin would ask for it (\"Email templates,\" not \"Emails\").\n"
            "  2. Ship with a `knowledge_base` entry (usually `type: feature`) "
            "that answers three questions concisely: *what does it do*, "
            "*where do I find it*, and *what are the common questions an "
            "admin will ask about it*.\n"
            "  3. Get seeded into the KB by rerunning "
            "`python scripts/seed_george_kb.py` — or, for urgent ships, be "
            "upserted directly via `knowledge.upsert_entry`. The retrieval "
            "layer picks up new entries on the very next George turn; no "
            "restart needed.\n\n"
            "**Why this matters:** an admin asking George \"where are the "
            "email templates?\" is trusting that George is a real guide to "
            "the platform. Every time George has to answer \"I don't have "
            "that documented yet,\" the trust in George as a guide erodes. "
            "The KB is not optional documentation — it is the knowledge "
            "surface George uses to *be* useful."
        ),
        "tags": ["principle", "george", "discoverability", "process"],
        "sources": [
            {"label": "GEORGE_KNOWLEDGE_MODEL.md"},
            {"label": "/app/website/components/admin/AdminShell.tsx"},
            {"label": "/app/backend/scripts/seed_george_kb.py"},
        ],
        "visibility": "public",
        "admin_context": (
            "Codified 1 Aug 2026 after an admin asked George where the "
            "Email Templates page was and George couldn't answer. The "
            "underlying feature (KB-FEAT-003) existed and worked, but it "
            "wasn't in the KB — so George couldn't be a guide to it. "
            "This principle is the fix at the process level, not just "
            "the one-off backfill."
        ),
    },



    # ── PHILOSOPHIES ─────────────────────────────────────────────
    {
        "id": "KB-PHIL-001", "type": "philosophy",
        "title": "Moderation is a conversation, not enforcement",
        "body_md": (
            "The default assumption is that a member who breaks a rule is "
            "still worth keeping. We start with the smallest intervention that "
            "could work — often a private note or a gentle warning — and only "
            "escalate when that fails.\n\n"
            "This is why every action is admin-attributed, why every step is "
            "logged in the same timeline, and why the Restore action is "
            "single-step: reversing course must be as easy as escalating.\n\n"
            "Moderation is not about winning. It is about keeping the community "
            "possible for everyone in it."
        ),
        "tags": ["moderation", "community"],
        "sources": [{"label": "MCGS_MIGRATION_AUDIT.md — Member identity safeguards"}],
        "related_ids": ["KB-PRIN-001"],
    },
    {
        "id": "KB-PHIL-002", "type": "philosophy",
        "title": "George helps admins understand, George never decides",
        "body_md": (
            "Every 'Ask George' prompt is framed around understanding — "
            "summarise, compare, spot patterns, check consistency. Never "
            "'decide for me' or 'take this action'.\n\n"
            "The fairness prompt — *'Have we treated similar cases "
            "consistently?'* — captures this ethic. George is a mirror, not "
            "a magistrate."
        ),
        "tags": ["george", "moderation"],
        "related_ids": ["KB-PHIL-001"],
        "visibility": "admin",  # admin-specific — about how MCGS uses George
    },
    {
        "id": "KB-PHIL-003", "type": "philosophy",
        "title": "Security should be highly visible to admins, almost invisible to users",
        "body_md": (
            "Normal administration should never feel frustrating. Malicious "
            "activity should be obvious, well-logged, and easy to respond to.\n\n"
            "This is the operating rule for every threshold, error message, "
            "and UI decision in the security model — the four-tier defence "
            "(Notify 3 → Block 5 → Escalate 20 → Urgent 50) exists to keep "
            "attackers loud and legitimate admins quiet."
        ),
        "tags": ["security", "admin-experience"],
        "sources": [{"label": "MCGS_SECURITY_MODEL.md"}],
        "visibility": "admin",  # admin-specific — security details stay internal
    },

    # ── DECISIONS ────────────────────────────────────────────────
    {
        "id": "KB-DEC-001", "type": "decision",
        "title": "Member profile is the single source of truth for moderation",
        "body_md": (
            "Every moderation action — warn, suspend, ban, restore, delete — "
            "originates from `/admin/members/{id}` after passing the identity "
            "confirmation dialog. Report detail pages and search results never "
            "trigger actions directly; they deep-link into the profile with "
            "the intended action pre-selected in the URL.\n\n"
            "Rationale: every decision must be made with the member's identity, "
            "moderation summary, and full history visible. This prevents "
            "wrong-person errors as the community grows and multiple members "
            "may share similar names."
        ),
        "tags": ["moderation", "member-management", "safety"],
        "sources": [{"label": "MCGS_MIGRATION_AUDIT.md — SSOT section"}],
        "related_ids": ["KB-PHIL-001", "KB-PRIN-001"],
    },
    {
        "id": "KB-DEC-002", "type": "decision",
        "title": "Four-tier login defence with layered visibility",
        "body_md": (
            "Login attack response: **Notify at 3** (email alert, login still "
            "works if next attempt is correct), **Block at 5** (15-min IP + "
            "email lockout, HTTP 429), **Escalate at 20** in 15 minutes (MCGS "
            "signal on The Bridge), **Urgent at 50** (pinned urgent signal + "
            "URGENT email).\n\n"
            "Rationale: no single channel is trusted — email, Bridge, and "
            "audit log all carry the alert so a missed notification is not a "
            "missed incident. Successful login clears counters, so legitimate "
            "typo-prone admins never accumulate risk."
        ),
        "tags": ["security", "auth"],
        "sources": [{"label": "MCGS_SECURITY_MODEL.md"}],
        "related_ids": ["KB-PHIL-003"],
    },

    # ── FEATURES ─────────────────────────────────────────────────
    {
        "id": "KB-FEAT-001", "type": "feature",
        "title": "Register Your Interest (RYI) flow",
        "body_md": (
            "The public site's only conversion action. `/register-interest` "
            "collects first name, email, state/country, how they heard about "
            "us, and their companion choice (George or Georgia).\n\n"
            "POST /api/public/register-interest inserts into "
            "`interest_registrations`, then fires two Resend emails: a warm "
            "confirmation to the registrant and a notification to "
            "hello@friendplace.com.au.\n\n"
            "The RYI page is deliberately reachable only after a visitor has "
            "walked through /meet → /about → /how-it-works → /features. It is "
            "an *invitation* accepted, not a signup form."
        ),
        "tags": ["ryi", "public-site", "onboarding"],
        "sources": [{"label": "PUBLIC_EXPERIENCE_PRINCIPLES.md"}, {"label": "/app/website/app/register-interest/page.tsx"}],
        "related_ids": ["KB-STORY-005"],
        "visibility": "public",  # RYI is a member-facing feature
    },
    {
        "id": "KB-FEAT-002", "type": "feature",
        "title": "MCGS Bridge and Signal Feed",
        "body_md": (
            "The Bridge (`/admin/bridge`) is Mission Control's home surface. "
            "It aggregates MCGS signals — moderation alerts, security alerts, "
            "George's suggestions — into a single triage feed.\n\n"
            "Signals live in `mcgs_signals` collection. Each carries a `kind` "
            "(e.g. `security.mass_login_attempts`), priority, urgency flag, "
            "and optional deeplink. George picks them up automatically for "
            "the Morning Briefing rhythm."
        ),
        "tags": ["mcgs", "bridge", "signals"],
    },
    {
        "id": "KB-FEAT-003", "type": "feature",
        "title": "Email Templates Studio (Mission Control ▸ Website ▸ Email templates)",
        "body_md": (
            "Where every FriendPlace transactional email is reviewed, edited "
            "and test-sent before it ever reaches a real inbox.\n\n"
            "**Where to find it:** Mission Control sidebar → **Website** "
            "group → **Email templates** (route: `/admin/emails`).\n\n"
            "**What lives there:** all five transactional emails, each built "
            "from the same letter-style shell (clean white background, full "
            "logo centred, personal-letter typography):\n\n"
            "  • **Welcome** — sent when a new account is confirmed. "
            "Personal letter from the visitor's chosen companion.\n"
            "  • **Waitlist thanks** — sent when someone joins the "
            "pre-launch waitlist. Signed by the companion.\n"
            "  • **Invitation** — sent when a member personally invites "
            "someone. Signed by the companion. Names the inviter.\n"
            "  • **Password reset** — six-digit code. Signed by *The "
            "FriendPlace Team* (operational, not personal).\n"
            "  • **Support acknowledgement** — ticket receipt. Signed by "
            "*The FriendPlace Team*.\n\n"
            "**What the studio lets an admin do:**\n\n"
            "  1. Pick a template from the left rail.\n"
            "  2. Edit the **subject** and **preheader** (preview text) "
            "inline; both fields re-render both previews after a ~250ms "
            "debounce.\n"
            "  3. On personal emails, flip between **George** and "
            "**Georgia** so both companion voices land in the same shell.\n"
            "  4. Watch a **desktop (720w)** and **mobile (375w)** preview "
            "side-by-side. Both are rendered server-side by the exact same "
            "code path that Resend uses, so nothing about the preview can "
            "drift from what a real send would look like.\n"
            "  5. Flip a **Light / Dark** surround to eyeball how the "
            "letter looks in Gmail-dark-theme clients (the letter itself "
            "stays white — email clients preserve that — but the chrome "
            "around it flips so contrast can be judged).\n"
            "  6. Read the **responsive validation** strip: subject length, "
            "preheader length, and (for personal emails) confirmation that "
            "the chosen companion actually appears in the rendered signature. "
            "The Send button stays disabled until every check is at least a "
            "warning-or-better.\n"
            "  7. Press **Send test to hello@friendplace.com.au** (the "
            "recipient is env-configurable via `EMAIL_PREVIEW_RECIPIENT`). "
            "Every preview send is prefixed with `[TEST]` in the subject "
            "so it can never be confused with a real production email.\n\n"
            "**How the honest status banner reads:**\n\n"
            "  • Green banner = **Resend accepted the message** (HTTP 200, "
            "message ID present). This is NOT the same as 'delivered' — "
            "acceptance is Resend's contract, delivery is the recipient "
            "mailbox's contract. The banner explicitly names this and "
            "surfaces the **message ID** so the admin can quote it in the "
            "Resend dashboard to confirm final state (Sent · Queued · "
            "Delivered · Bounced · Rejected).\n"
            "  • Red banner = **Send failed**. Surfaces the actual Resend "
            "error text, error code, HTTP status. Never claims success "
            "when the API refused.\n\n"
            "**Common admin questions this feature answers:**\n"
            "  - 'Where are the email templates?' → *Mission Control "
            "sidebar → Website → Email templates.*\n"
            "  - 'How do I send a test email?' → *Open the studio, pick a "
            "template, press Send test to hello@friendplace.com.au.*\n"
            "  - 'Can I change the Welcome email?' → *Yes — subject and "
            "preview text edit inline; body copy edits live in "
            "`email_service.welcome_template` and take effect the moment "
            "the backend restarts.*\n"
            "  - 'Why didn't my test email arrive?' → *Check the Resend "
            "dashboard using the message ID from the success banner. "
            "Common causes: spam/junk folder, DMARC/SPF misalignment, or "
            "the mailbox filtering same-domain sends. The current API "
            "key is send-only, so the backend can't poll delivery status.*"
        ),
        "tags": [
            "emails", "email-templates", "resend", "welcome", "waitlist",
            "invitation", "password-reset", "support", "admin-panel",
        ],
        "sources": [
            {"label": "/app/website/app/admin/emails/page.tsx"},
            {"label": "/app/backend/email_service.py"},
            {"label": "/app/backend/cms_module.py — /email-previews endpoints"},
        ],
        "related_ids": ["KB-PRIN-003"],
        "visibility": "admin",
        "admin_context": (
            "The studio is the ONLY place transactional email copy should "
            "be reviewed pre-send. Any new template must be added here "
            "(otherwise it's invisible to admins) AND registered in "
            "`_EMAIL_PREVIEW_TEMPLATES` in `cms_module.py`."
        ),
    },

    # ── ROADMAP ──────────────────────────────────────────────────
    {
        "id": "KB-ROAD-001", "type": "roadmap",
        "title": "MCGS Migration slice status",
        "body_md": (
            "Ten-slice migration to bring every mobile admin capability into "
            "Mission Control before adding new functionality.\n\n"
            "- Slice 0 (foundation: sidebar, admin_log, Ask George, placeholders): **done**\n"
            "- Slice 0.5 (security foundation, four-tier defence, sessions): **done**\n"
            "- Slice 1 (Member Management): **in progress** — backend + ConfirmIdentityAction dialog done; list/profile/retire pending\n"
            "- Slice 2 (Reports & Moderation): not started\n"
            "- Slice 3 (Feedback / Support): not started\n"
            "- Slice 4 (Events extend controls): not started\n"
            "- Slice 5 (Groups pending queue): not started\n"
            "- Slice 6 (Announcements): not started\n"
            "- Slice 7 (Website Content polish): not started\n"
            "- Slice 8 (Administration): not started\n"
            "- Slice 9 (Settings): not started\n"
            "- Slice 10 (Analytics): not started"
        ),
        "tags": ["mcgs", "migration", "status"],
        "sources": [{"label": "MCGS_MIGRATION_AUDIT.md"}],
    },
    {
        "id": "KB-ROAD-002", "type": "roadmap",
        "title": "V1 launch — outstanding items",
        "body_md": (
            "**Blocking**: Vercel deployment of `/app/website` to friendplace.com.au. "
            "Emergent Support confirmed the production Atlas cluster; the Next.js "
            "website is not yet deployed via the CLI path in `/app/website/DEPLOY.md`.\n\n"
            "**Ready to ship when the site is live**:\n"
            "- iOS + Android builds via Emergent Publish (needs `/register-interest` "
            "  live on friendplace.com.au first).\n"
            "- Two marketing flyers (Founding Members + App Download) — artwork locked, "
            "  waiting to print until URLs are live.\n\n"
            "**Future 2FA groundwork ready**: schema seats reserved on `cms_admins`; "
            "activate when a second admin is added."
        ),
        "tags": ["launch", "deployment"],
        "sources": [{"label": "DEPLOY.md"}, {"label": "MCGS_SECURITY_MODEL.md"}],
    },
]


async def main() -> None:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ.get("DB_NAME", "test_database")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    print(f"Seeding George's institutional knowledge base into `{db_name}.knowledge_base`")
    await kb.ensure_indexes(db)

    # Default visibility per type. Stories, principles, and philosophy
    # are member-safe by default; decisions, roadmap and feature-detail
    # entries are admin-only. Individual entries in SEED can override by
    # setting their own `visibility` field.
    TYPE_TO_VISIBILITY = {
        "story":      "public",
        "principle":  "public",
        "philosophy": "public",
        "feature":    "admin",
        "decision":   "admin",
        "roadmap":    "admin",
    }

    created = updated = 0
    for entry in SEED:
        payload = dict(entry)  # avoid mutating SEED
        payload.setdefault(
            "visibility",
            TYPE_TO_VISIBILITY.get(payload.get("type") or "", "admin"),
        )
        existing = await db[kb.COLLECTION].find_one(
            {"id": payload["id"]}, {"title": 1, "body_md": 1},
        )
        await kb.upsert_entry(db, payload)
        if existing:
            updated += 1
        else:
            created += 1
    total = await kb.count_entries(db)
    print(f"  ✓ created: {created}   updated: {updated}   total in KB: {total}")


if __name__ == "__main__":
    asyncio.run(main())
