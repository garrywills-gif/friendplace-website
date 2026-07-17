# FriendPlace — Post-Launch Ideas Backlog

Ideas captured but explicitly deferred to keep launch focused.

---

## 🎨 Rotating "welcome" backgrounds (Mobile app + Website)

**Requested by:** David
**When:** Session 15 July 2026
**Priority:** Nice-to-have — NOT urgent, do not delay launch

**The idea:**
Make the welcome/onboarding screens feel more emotionally alive by
using bright, warm, real-life community images as the background —
people having coffee, walking together, gardening, attending community
events. Rotate a few images so the app + website feel fresh every time
someone opens them.

**Why it matters:**
The current gradient + butterfly is polished but slightly abstract.
Real photos of belonging would communicate what FriendPlace is
*emotionally* the moment someone lands on it — instead of relying on
the tagline to do the work alone.

**Scope when we build it (est. ~15–20 credits):**

Mobile app:
- [ ] Add a `WelcomeBackground` component that fades between 4–6
      curated lifestyle photos (cross-fade, 6–8s intervals)
- [ ] Respect `prefers-reduced-motion` — fall back to a single static
      image if the OS is set to reduce animation
- [ ] Serve images via the same MongoDB media library the Mini-CMS
      uses — so David can add / remove / reorder without a dev cycle
- [ ] Keep the FriendPlace butterfly + tagline overlaid on top for
      brand consistency
- [ ] Add a subtle navy gradient overlay (bottom → top, 40% opacity)
      so text stays readable regardless of the underlying photo

Website:
- [ ] Same treatment on the home hero background (behind the current
      navy gradient) — very soft, low-opacity so the hero copy still
      dominates
- [ ] Cross-fade timing tuned separately from the mobile app since the
      website context is different (visitors linger longer per screen)

**Curation criteria:**
- Warm/golden lighting
- Australian diversity (age, ethnicity, ability)
- Real moments — no staged corporate stock
- No overtly branded logos in the shot
- Landscape orientation for mobile portrait bg + website hero

**When to schedule:**
- After the mobile app is live on TestFlight ✅
- After the website is deployed to friendplace.com.au ✅
- Ideally paired with the Mission Control media library so David can
  swap the pool from the admin UI without any dev help


---

## 🎛 Mission Control expansion (Mini-CMS → full admin suite)

**Requested by:** Garry
**When:** Session 17 July 2026
**Priority:** Not urgent — post-launch polish

**The idea:**
Grow the Mini-CMS into a proper FriendPlace Mission Control that
covers content editing plus operational visibility for events,
sponsors, and community health.

**Shipped in this session (quick wins):**
- [x] Rename dashboard heading → "FriendPlace Mission Control"
- [x] Subtitle: "Welcome back, Garry. Manage your website, content and media from one place."
- [x] Dashboard summary cards with live counts (Pages / Media / FAQs /
      Founding Members / Website Status)
- [x] Website status badge — 🟠 Private / 🟢 Live / 🔴 Maintenance —
      auto-reads `FRIENDPLACE_INDEXABLE`
- [x] Sidebar FriendPlace logo scaled up ~25%

**Still to build (deferred):**
- [ ] **Success Stories editor** — CRUD with rich text, author name +
      avatar via Media Library, ordering
- [ ] **Founding Members editor** — name, number, blurb, avatar,
      published/hidden toggle, ordering
- [ ] **Events module** — list + create + RSVP roster, tied to Local
      Business Sponsorships (see line item elsewhere in this file)
- [ ] **Partnerships module** — sponsor logos, sponsorship tiers,
      testimonials, downloadable media kit
- [ ] **Analytics dashboard** — sign-ups by day, active users,
      event RSVPs, public-site → mobile-download funnel
- [ ] **Settings module** — brand copy (tagline / straplines),
      email templates, admin invites, danger zone (wipe/export)
- [ ] **Maintenance mode toggle** in the badge — clicking flips
      `FRIENDPLACE_INDEXABLE` (or a new `MAINTENANCE_MODE` env) and
      shows a friendly holding page on the public site
