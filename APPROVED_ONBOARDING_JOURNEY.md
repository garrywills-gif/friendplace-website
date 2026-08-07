# 🔒 APPROVED BASELINE — FriendPlace Onboarding & Founding Member Journey

**Status:** LOCKED — approved by Garry on real-device iPhone Safari testing (iter152, June 2026).

**Git tag:** `approved-onboarding-founding-member-journey`

## The approved journey (end-to-end)

    Meet George/Georgia
        → Welcome
        → Guided Tour (/about → /how-it-works → /features)
        → "You're all set."
        → Register Interest
        → 🎉 Founding Member reveal (name, permanent number, voice, farewell, ticks)
        → Continue Exploring → "Why FriendPlace?"

## What is frozen (do NOT modify without Garry's explicit sign-off)

The following files, sections, timings, copy, voices, animations, and
routing decisions are the approved baseline. Any changes to them
must be:

1. Explicitly requested by Garry (in writing / in-app message).
2. Made in isolation — no other refactor may sit alongside a change here.
3. Verified end-to-end against this document before merge.

### Files (with the exact lines that are frozen)

| File | Frozen aspect |
| --- | --- |
| `/app/website/app/meet/page.tsx` | Timing gates (`SAY_WELCOME`, `SAY_GLAD`, `SAY_SHOW`, `CTAS_APPEAR`), butterfly choreography, three-beat greeting order, replay button delays (1400 ms / 4400 ms). |
| `/app/website/components/TourNav.tsx` (`TourEnding`) | Three-line closing beat: "You're all set." / "FriendPlace is yours to explore now." / "And remember… if you ever need me, just tap the butterfly. 🦋" — plus the "Not opened yet? Let me know when we do →" secondary link. |
| `/app/website/components/site/TourEndingVoice.tsx` | Auto-playing tour-ending voice. |
| `/app/website/components/site/HeroInvitation.tsx` | Hero-level "Meet George or Georgia" pill, arrival animation timings (1300 ms delay, 1600 ms arrival, 400 ms caption follow), reduced-motion path. |
| `/app/website/app/features/page.tsx` | Features grid does NOT contain a "Founding Members" tile — that reveal is post-registration only. |
| `/app/website/app/register-interest/page.tsx` | Form intro copy ("Whenever you're ready."), no pre-tease. Success page order: 🎉 Congratulations → status line → number card → celebration audio (Ash/Nova) → replay button → farewell paragraph → 🦋 sign-off → two ✅ ticks → "Continue Exploring →". Scroll-to-top on `done`. Preview-aware `whyHref`. |
| `/app/website/app/page.tsx` | `id="why-friendplace"` anchor with `scrollMarginTop: 80`. Homepage section order. |
| `/app/backend/server.py` — `public_register_interest` handler | Founding Member number allocation + email side-effects. |
| `/app/backend/server.py` — `public_founding_member_audio` handler | Personalised TTS endpoint. Voice map: George → Ash, Georgia → Nova. Rate limit 30/IP/hour. |
| `/app/backend/scripts/generate_welcome_journey_audio.py` | Voice map (Ash/Nova) + pre-rendered clip set (welcome / gladfound / comeinside / ending). |
| `/app/config/nginx/app-proxy.conf` | `/site` alias route → website upstream. Required for preview-environment "Continue Exploring". |

## How to restore the baseline if a regression is introduced

    git checkout approved-onboarding-founding-member-journey -- <file>

Or roll the whole set back:

    git diff approved-onboarding-founding-member-journey -- \
        website/app/meet/page.tsx \
        website/app/register-interest/page.tsx \
        website/app/features/page.tsx \
        website/app/page.tsx \
        website/components/TourNav.tsx \
        website/components/site/HeroInvitation.tsx \
        website/components/site/TourEndingVoice.tsx \
        backend/server.py

## Verification checklist (run BEFORE any broader website refactor lands)

1. `/meet` — butterfly lands, three beats deliver in ~6.8s / 8.2s / 11.2s cadence with a held 1.3 s smile beat between "…glad you found us." and "Come inside…".
2. `/features` — Tour ending renders the three-line George return; no Founding Members tile in the grid.
3. `/register-interest` form intro reads "Whenever you're ready." with no Founding Member pre-tease.
4. Submitting the RYI form:
   - Page scrolls to top on reveal.
   - Celebration audio auto-plays (or the "Hear George" prompt is shown if Safari blocked autoplay).
   - Number card shows `#{0000}` padded.
   - Farewell paragraph is the single approved copy.
   - Two ✅ ticks below.
   - "Continue Exploring →" href resolves to `/site#why-friendplace` on preview, `/#why-friendplace` on production.
5. Following "Continue Exploring →" lands on the "❤️ Not what you're used to. In the best way." section (No swiping / No followers / No popularity contests).

## Notes for future agents

> Do not "improve" this journey. Every choice — every millisecond of
> silence, every line break, every voice — is deliberate and has been
> pressure-tested on a real device. If you feel the urge to
> "streamline" it, that is exactly the moment to ask Garry first.
