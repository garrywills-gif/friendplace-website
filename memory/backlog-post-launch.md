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
