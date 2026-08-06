'use client';

/* ─────────────────────────────────────────────────────────────
 * 🔒 APPROVED BASELINE — iter152, June 2026
 *   Hero pill arrival choreography, float animation, caption
 *   follow-on and reduced-motion path are LOCKED.
 *   See /app/website/APPROVED_ONBOARDING_JOURNEY.md.
 * ─────────────────────────────────────────────────────────── */

/**
 * HeroInvitation — the hero-level "Meet George or Georgia" pill.
 *
 * Sits under the primary hero CTAs (Get the App / See how it works).
 * The invitation waits ~1.3s so visitors can read "Find your people."
 * and the intro paragraph BEFORE the invitation quietly floats into
 * view — the pause is a design decision, not a load delay.
 *
 * ARRIVAL (Garry, iter147, locked)
 * ────────────────────────────────
 * The pill doesn't just appear. It gently floats into view, settles
 * naturally into place, and then remains still. The animation runs
 * once when the page loads and simply draws the visitor's attention
 * to the invitation — it isn't a continuous shimmer.
 *
 * The caption underneath follows a breath later so the two beats
 * feel like one thought, not a hurried pair.
 *
 * NAVIGATION (Garry, iter147, locked)
 * ────────────────────────────────────
 * Tapping the pill navigates directly to /meet, where the visitor
 * meets the choice screen ("Meet George or Georgia") in a full,
 * uninterrupted moment. We deliberately do NOT open the concierge
 * overlay from this pill — that popup collapsed Meet + Welcome into
 * one hurried interaction, which is exactly what we're now avoiding.
 * The overlay component is still available for other entry points
 * that need an in-page invitation, but the hero pill is a clean
 * navigation.
 *
 * REDUCED MOTION
 * ──────────────
 * A visitor who has asked for less motion still gets a clean fade
 * in, with a short delay so it feels intentional — no float, no
 * settle, no scale wobble.
 */

import Link from 'next/link';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';

export default function HeroInvitation() {
  return (
    <div className="hero-invitation">
      <Link
        href="/meet"
        className="hero-invitation-pill"
        aria-label="Meet George or Georgia — the FriendPlace welcome host"
      >
        <span aria-hidden style={{ display: 'inline-flex', width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
          <GeorgeButterflyMark size={22} />
        </span>
        <span>Meet George or Georgia</span>
      </Link>

      <div className="hero-invitation-caption">
        Take a friendly guided tour, or simply say hello.
      </div>

      {/* Arrival choreography.
       *
       *   heroPillArrive — fades in, floats up from below with a
       *     soft overshoot, and settles. Total ~1.6s including a
       *     subtle scale settle at the end. Runs once. `both` fill
       *     mode keeps the pill invisible during the 1.3s pre-delay
       *     and locked at the final resting state afterwards, so
       *     there's no flash-of-visible-pill before the animation.
       *
       *   heroCaptionArrive — softer beat that follows 400ms later.
       *
       * Reduced-motion visitors get a plain 500ms opacity fade with
       * no transform/scale movement.
       */}
      <style>{`
        .hero-invitation {
          margin-top: 24px;
        }

        .hero-invitation-pill {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          max-width: 480px;
          padding: 15px 26px;
          background: rgba(94, 234, 212, 0.12);
          color: #5EEAD4;
          border: 1.5px solid rgba(94, 234, 212, 0.55);
          border-radius: 999px;
          font-size: 16px;
          font-weight: 800;
          text-decoration: none;
          box-shadow:
            inset 0 0 0 1px rgba(94,234,212,0.15),
            0 8px 22px rgba(5,25,44,0.28);
          cursor: pointer;
          transition: background 160ms ease, border-color 160ms ease, box-shadow 240ms ease;
          animation: heroPillArrive 1600ms cubic-bezier(0.22, 1, 0.36, 1) 1300ms both;
        }

        .hero-invitation-pill:hover {
          background: rgba(94, 234, 212, 0.18);
          border-color: rgba(94, 234, 212, 0.75);
          box-shadow:
            inset 0 0 0 1px rgba(94,234,212,0.22),
            0 10px 26px rgba(5,25,44,0.34);
        }
        .hero-invitation-pill:focus-visible {
          outline: 2px solid #5EEAD4;
          outline-offset: 3px;
        }

        .hero-invitation-caption {
          margin-top: 10px;
          font-size: 14px;
          color: #94A3B8;
          font-style: italic;
          line-height: 1.5;
          max-width: 480px;
          animation: heroCaptionArrive 1000ms cubic-bezier(0.22, 1, 0.36, 1) 1700ms both;
        }

        @keyframes heroPillArrive {
          /* Invisible, waiting below the resting line. */
          0%   { opacity: 0; transform: translateY(28px) scale(0.94); }
          /* Fades in as it rises, briefly overshoots the resting line
           * so the arrival feels like a gentle landing rather than a
           * mechanical slide. */
          55%  { opacity: 1; transform: translateY(-6px) scale(1.02); }
          80%  {              transform: translateY(2px)  scale(0.998); }
          /* Settles. And stays. */
          100% { opacity: 1; transform: translateY(0)    scale(1); }
        }

        @keyframes heroCaptionArrive {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0);   }
        }

        @media (prefers-reduced-motion: reduce) {
          .hero-invitation-pill {
            animation: heroPillFadeReduced 500ms ease 320ms both;
          }
          .hero-invitation-caption {
            animation: heroPillFadeReduced 500ms ease 500ms both;
          }
          @keyframes heroPillFadeReduced {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
        }
      `}</style>
    </div>
  );
}
