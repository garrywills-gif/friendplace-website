# MCGS Security Model — Design Contract

**Status:** designed, not yet built. Awaiting sign-off & slice ordering decision.
**Playbook consulted:** `integration_playbook_expert_v2` — Feb 2026.
**Author:** Neo (agent) for Garry.

## Goal (Garry's brief)

> "If someone attempts to compromise Mission Control, we know about it immediately and have the tools to respond quickly, while ensuring legitimate administrators aren't locked out by an accidental typo."

## Two guiding principles

1. **Defence in depth, kindness at the surface.** Every threshold is soft first (alert only), hard second (lockout). No admin gets locked out on their third typo — they get an alert email and one more chance.
2. **Additive & feature-flagged.** All new logic sits behind `ADMIN_SECURITY_FEATURES=true`. The existing `/api/cms/auth/login` flow is preserved verbatim when the flag is off, so nothing that already works can break.
3. **Security should be highly visible to administrators, but almost invisible to legitimate users.** Normal admin work is never impeded; malicious activity is obvious, well-logged, and easy to respond to. Every threshold, error message, and UI decision is measured against this principle.

## Thresholds (adjustable via env)

| Env var | Default | Tier | Behaviour |
|---|---|---|---|
| `ADMIN_ALERT_AFTER_FAILS` | 3 | 1 · Notify | Send security alert email (once per window) |
| `ADMIN_LOCKOUT_AFTER_FAILS` | 5 | 2 · Block | Lock IP + email for `ADMIN_LOCKOUT_MINUTES`, return HTTP 429 + `Retry-After` |
| `ADMIN_MASS_ATTACK_FAILS` | 20 | 3 · Escalate | Raise an MCGS signal on The Bridge (medium priority) |
| `ADMIN_MASS_ATTACK_URGENT` | 50 | 4 · Urgent | Raise an urgent-priority MCGS signal + a second email marked URGENT |
| `ADMIN_MASS_ATTACK_WINDOW_MINUTES` | 15 | — | Rolling window for tier 3 & 4 detection |
| `ADMIN_LOCKOUT_MINUTES` | 15 | — | Lockout duration for tier 2 |

Fail-counters are **consecutive** — a successful login clears them. Counters are tracked per-email AND per-IP separately, and whichever hits threshold first triggers the response. Tier 3/4 are evaluated across *all* failures in the rolling window (not just one source), so distributed attacks are caught too.

## The four-tier defence pattern

Layered, no single point of failure — even if an admin misses an email or text, the Bridge shows the attack next time they open MCGS.

**Tier 1 — Notify (3 fails):** Email alert to `hello@friendplace.com.au`. Login still works if the next attempt is correct. This is the "friendly typo" tier.

**Tier 2 — Block (5 fails):** IP + email locked for 15 min. HTTP 429 + `Retry-After`. Admin can self-unlock from Security page on a different device/IP if legitimately locked out.

**Tier 3 — Escalate (20 fails in 15 min, any source):** MCGS signal appears on The Bridge with the message:

> 🚨 **Security Alert**
> Mission Control has detected an unusual number of failed administrator login attempts from the same source. The attempts have been blocked and logged. Please review the Security page.

Signal payload includes: window start, attempt count, top 3 source IPs (with geo), top 3 target emails, "Review Security page →" deep-link. George picks it up via the existing Signal → Case pipeline so admins see it in the morning briefing too.

**Tier 4 — Urgent (50 fails in 15 min):** Same signal but promoted to `urgent: true`, plus a second Resend email tagged `URGENT` in the subject line and a second alert channel (SMS via Twilio if configured later). Signal auto-pins to the top of The Bridge until an admin acknowledges it.

**Signal auto-resolves** when the window rolls past with no further failures — no manual clean-up required.

## Data model (4 new collections)

| Collection | Shape | TTL |
|---|---|---|
| `admin_login_attempts` | `{scope: "email"\|"ip", key, fail_count, first_fail_at, last_fail_at, alert_sent_at}` | — |
| `admin_lockouts` | `{scope, key, locked_until, reason, created_at}` | — |
| `admin_security_log` | `{created_at, outcome, email, ip, user_agent, geo, attempt_count, jti?, locked_until?}` | 90 days |
| `admin_sessions` | `{jti, admin_id, email, ip, user_agent, geo, issued_at, expires_at, revoked_at}` | expires_at |

Indexes: unique on `(scope, key)` for attempts + lockouts, unique on `jti`, TTL on `expires_at` and `created_at`.

## Login flow (feature-flagged, additive)

1. Normalise email + capture IP (`X-Forwarded-For` respecting nginx proxy) + user-agent.
2. Look up geo via **offline MaxMind GeoLite2-City DB** at `/app/backend/data/GeoLite2-City.mmdb` (playbook's recommended approach — no runtime API dependency, kept updated via `geoipupdate` cron / initContainer).
3. Check `admin_lockouts` for email OR IP — if locked, log `outcome: "lockout_hit"` and return 429 + `Retry-After`.
4. Verify password (existing passlib bcrypt path).
5. **On failure:** bump both email + IP counters. If threshold ≥ alert → send Resend alert email (once, marked with `alert_sent_at`). If threshold ≥ lockout → create lockouts, log `lockout_created`, return 429.
6. **On success:** delete both counters (reset), mint JWT with new `jti` claim, insert `admin_sessions` row, log `outcome: "success"`, return token.

## Security alert email

Sent via existing Resend integration (`hello@friendplace.com.au` sender, `RESEND_API_KEY` in `backend/.env`). Idempotency key `admin-alert:<email>:<ip>:<count>` prevents duplicates on retry.

Body includes: **time, email/username entered, IP address, approximate location (city/region/country from GeoLite2), browser/device (parsed user-agent), attempt count, whether lockout was triggered, "Was this you? / Not you?" instructions.**

Future extension slot: SMS via Twilio (integration playbook, one-line swap). Push notifications are Emergent-managed and only work on real device builds — deferred to launch.

## MCGS Security page (`/admin/security`)

Six panels, all filterable/sortable, all keyed on the collections above:

1. **Successful logins** (last 30 days) — timestamp, admin, IP, geo, user-agent.
2. **Failed login attempts** (last 30 days) — same fields + attempt count, outcome.
3. **Active admin sessions** — one row per unrevoked, unexpired `jti`. Actions: **Revoke session** (sets `revoked_at=now`, next request from that token gets 401).
4. **Locked IPs / emails** — active lockouts with unlock button.
5. **Password changes** — every `POST /api/cms/auth/change-password` and every reset appends a `password_change` event to `admin_security_log`. Rows show who, when, from what IP, whether via reset flow or self-change.
6. **Ask George**: *"Is anything unusual in the last 24 hours?"* / *"Which IPs have failed most?"* / *"Are any active sessions from unusual locations for this admin?"*

Every action on this page auto-writes an `admin_log` entry (Slice 0 foundation) so admin-security actions themselves are audited.

## JWT revocation strategy

- Add `jti` claim to every token issued by `_make_admin_token()`.
- Add a small middleware step in `current_cms_admin`: after decoding the JWT, check `admin_sessions` for `{jti, revoked_at: None, expires_at > now}`. Miss → 401.
- Logging out revokes only the current `jti`. Revoking from Security page revokes any session admin selects.
- Cleaner than a JWT blacklist because one session row = one active token.

## Future 2FA groundwork (not built now, but designed in)

Schema seat reserved on `cms_admins` doc:

```
totp_enabled: bool
totp_secret_enc: str   # encrypted with TOTP_ENC_KEY from env
totp_last_used_step: int
backup_code_hashes: [str]  # bcrypt-hashed, single-use
```

Library: `pyotp`. Enrolment flow: `pyotp.random_base32()` → `provisioning_uri()` → QR displayed → admin verifies with 6-digit code → `totp_enabled=true`. Verified codes tracked in `totp_last_used_step` to prevent replay.

**Trigger for building 2FA:** as soon as a second admin is added. Single-admin systems have less attack surface; multi-admin systems must have 2FA.

## Balance — protecting from typos AND from mass attacks

The four tiers stack so no single missed channel means an undetected breach:

- **First 2 fails**: silent (only per-attempt log row).
- **3rd fail**: email alert. Login still works if the next attempt is correct.
- **5th consecutive fail**: 15-minute lockout on email + IP.
- **20 fails in 15 min (any source)**: 🚨 Security Alert appears on The Bridge — impossible to miss the next time an admin opens MCGS.
- **50 fails in 15 min**: same signal promoted to urgent + second URGENT email + top-pin on The Bridge.
- **Any successful login** clears the consecutive counter for that email/IP.
- **Unlock button** on the Security page: admin can unlock themselves from a different session/IP if legitimately locked out.
- **Rate-window shielding**: alert email sent once per attempt-window, never on every subsequent fail. Signals auto-resolve when the window rolls past cleanly.

## What the playbook explicitly warned against

- Do NOT trust `X-Forwarded-For` unless the proxy is explicitly trusted (nginx-app-proxy already sets this header — safe here).
- Do NOT use free IP-geo APIs for production (rate-limited, HTTP-only). Offline GeoLite2 is the right choice.
- Do NOT store TOTP secrets in plaintext.
- Do NOT send an alert on every fail after threshold — send one, mark, reset when counter resets.

## Files touched (when this ships)

- `/app/backend/cms_module.py` — feature-flagged auth flow, revocation dep
- `/app/backend/services/security.py` — new helpers (bump counter, is_locked, create_lockout, send_alert, geo_lookup, log_security_event)
- `/app/backend/data/GeoLite2-City.mmdb` — bundled offline DB
- `/app/website/app/admin/security/page.tsx` — Security dashboard (6 panels)
- `/app/website/app/admin/security/session-revoke.ts` — session revoke handler
- Sidebar: add "Security" under System group

## Testing checklist (for when we build)

1. 1st + 2nd wrong password: counters increment, no email, no 429, no signal.
2. 3rd wrong password: exactly one Resend email sent, still 401.
3. 4th wrong password: still 401 (email not sent again).
4. 5th wrong password: 429 + `Retry-After`, lockout row created for both email + IP.
5. Correct password before threshold: counters deleted.
6. Correct password during active lockout: 429 (lockout wins).
7. 20 fails from mixed sources within 15 minutes: exactly one MCGS signal created, medium priority.
8. 50 fails within 15 minutes: signal promoted to urgent + second URGENT email sent + pinned to Bridge.
9. Rolling window rolls past with no new fails: mass-attack signal auto-resolves.
10. Revoked `jti`: next request → 401.
11. Unlock action on Security page: lockout row removed, admin can log in again.
12. Feature flag off: all behaviour identical to today (verified by existing test suite still passing).

---

**Ordering decision (Garry to confirm):**

- **Option A** — finish Slice 1 (Member Management) first (~2–3 more days of work), then Security. Slice 1 currently has backend + `ConfirmIdentityAction` dialog done; list page + profile page + retirement not yet started.
- **Option B** — pause Slice 1 (backend + dialog stays as-is, ready to resume), do Security next (~2 days), then finish Slice 1.
- **Option C** — build Security in parallel with what remains of Slice 1 (higher context risk; not recommended unless there's active threat).
