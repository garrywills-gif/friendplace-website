/**
 * Welcomes catalog — the "living homepage".
 *
 * `/meet` never changes structure. But what George or Georgia say
 * when the butterfly lands MAY change occasionally, so the site has
 * a heartbeat rather than a fixed script.
 *
 * Read `/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md#the-living-homepage`
 * before adding a variant.
 *
 * Anatomy of a welcome:
 *   • three text lines, one per beat (hello / name / closing)
 *   • two audio clips per companion (hello + intro),
 *     pre-rendered Ash for George, pre-rendered Nova for Georgia,
 *     so the pauses between sentences stay OUR pauses (not OpenAI's).
 *   • an optional active window (start / end ISO date, inclusive).
 *   • a priority so competing occasions have a deterministic winner.
 *
 * The catalog resolver:
 *   • picks the highest-priority variant whose window contains "now".
 *   • falls back to the "default" variant when nothing is active
 *     (the default has no window — it is always eligible with
 *     priority 0).
 *   • is deterministic and cheap; run it every page load.
 *
 * Audio strategy:
 *   • Variants either declare their own audio filenames under
 *     /public/audio, or point at 'default' to reuse the permanent
 *     hello / intro clips. If a variant declares filenames that
 *     404 in prod, the page still renders — the text lands on beat,
 *     just silently — so a missing file never breaks the welcome.
 */

import type { CompanionId } from './companion-context';

// ─── Types ────────────────────────────────────────────────────────────

export interface WelcomeLines {
  /** Line 1 — "Hello." (or a seasonal opener) */
  hello: string;
  /** Line 2 — "I'm George." / "I'm Georgia." (name line always present) */
  name: (companion: CompanionId) => string;
  /** Line 3 — the closing beat. */
  closing: string;
}

export interface WelcomeAudio {
  /** URL for the "hello" clip. */
  hello: string;
  /** URL for the "name + closing" clip. */
  intro: string;
}

export interface WelcomeVariant {
  /** Stable identifier — used in analytics + admin. */
  id: string;
  /** Short human label — "Default", "Christmas 2026", "1,000 members" */
  label: string;
  /** Optional occasion tag — 'christmas' | 'new-year' | 'easter' | 'milestone' | 'campaign' */
  occasion?: 'christmas' | 'new-year' | 'easter' | 'milestone' | 'campaign' | 'default';
  /** Highest priority variant with a matching window wins. Default is 0. */
  priority: number;
  /** ISO date (yyyy-mm-dd) inclusive. Omit to make the variant always eligible. */
  activeFrom?: string;
  /** ISO date (yyyy-mm-dd) inclusive. */
  activeUntil?: string;
  /** Text of the three-line greeting. */
  lines: WelcomeLines;
  /**
   * Audio source. Either explicit URLs per companion, or 'default'
   * to reuse the permanent /audio/hello-{companion}.mp3 +
   * /audio/intro-{companion}.mp3 clips.
   */
  audio: 'default' | Record<CompanionId, WelcomeAudio>;
  /** Free-form note kept for the person authoring the variant. */
  note?: string;
}

// ─── The catalog ──────────────────────────────────────────────────────
//
// Order does not matter — the resolver picks by priority + window.
// The `default` entry has no window and priority 0 so it is always
// the fallback. Add new variants above it; do NOT touch the default
// unless the permanent script is being changed platform-wide.

export const WELCOMES: WelcomeVariant[] = [
  // ── Christmas ─────────────────────────────────────────────────────
  // Seasonal variants ship in-code so any deploy locks the words.
  // Audio filenames are declared but if the mp3 isn't present yet,
  // the page still renders — the text lands on beat, in silence.
  {
    id: 'christmas',
    label: 'Christmas',
    occasion: 'christmas',
    priority: 50,
    activeFrom: '2026-12-15',
    activeUntil: '2026-12-27',
    lines: {
      hello: 'Hello.',
      name: (c) => (c === 'george' ? "I\u2019m George." : "I\u2019m Georgia."),
      closing: "Merry Christmas \u2014 I\u2019m really pleased you dropped in today.",
    },
    audio: {
      george:  { hello: '/audio/hello-george.mp3',  intro: '/audio/intro-george-christmas.mp3'  },
      georgia: { hello: '/audio/hello-georgia.mp3', intro: '/audio/intro-georgia-christmas.mp3' },
    },
    note: 'Warm, unhurried. Do not say "Happy Holidays" \u2014 Garry prefers "Merry Christmas".',
  },

  // ── New Year ─────────────────────────────────────────────────────
  {
    id: 'new-year',
    label: 'New Year',
    occasion: 'new-year',
    priority: 50,
    activeFrom: '2026-12-28',
    activeUntil: '2027-01-05',
    lines: {
      hello: 'Hello.',
      name: (c) => (c === 'george' ? "I\u2019m George." : "I\u2019m Georgia."),
      closing: "Happy New Year \u2014 I\u2019m so glad you found us.",
    },
    audio: {
      george:  { hello: '/audio/hello-george.mp3',  intro: '/audio/intro-george-newyear.mp3'  },
      georgia: { hello: '/audio/hello-georgia.mp3', intro: '/audio/intro-georgia-newyear.mp3' },
    },
  },

  // ── Easter ────────────────────────────────────────────────────────
  {
    id: 'easter',
    label: 'Easter',
    occasion: 'easter',
    priority: 50,
    // Easter Sunday moves each year; the window is set here per year
    // and updated in the catalog before it's needed. 2027 Easter is
    // Sunday 28 March; the window opens the Friday before.
    activeFrom: '2027-03-26',
    activeUntil: '2027-03-29',
    lines: {
      hello: 'Hello.',
      name: (c) => (c === 'george' ? "I\u2019m George." : "I\u2019m Georgia."),
      closing: "Happy Easter \u2014 I\u2019m really pleased you came by.",
    },
    audio: {
      george:  { hello: '/audio/hello-george.mp3',  intro: '/audio/intro-george-easter.mp3'  },
      georgia: { hello: '/audio/hello-georgia.mp3', intro: '/audio/intro-georgia-easter.mp3' },
    },
  },

  // ── DEFAULT ──────────────────────────────────────────────────────
  // Always eligible. Always wins when nothing else is active.
  // Do not touch this unless the permanent script is changing.
  {
    id: 'default',
    label: 'Default',
    occasion: 'default',
    priority: 0,
    lines: {
      hello: 'Hello.',
      name: (c) => (c === 'george' ? "I\u2019m George." : "I\u2019m Georgia."),
      closing: "I\u2019m really pleased you found us.",
    },
    audio: 'default',
  },
];

// ─── Resolver ─────────────────────────────────────────────────────────

/**
 * Pick the active welcome variant.
 *
 * @param now  A `Date` — defaults to `new Date()`. Passed in so tests
 *             (and, later, the admin preview inside `/admin/drafts`)
 *             can force a specific date.
 */
export function getActiveWelcome(now: Date = new Date()): WelcomeVariant {
  const today = toIsoDate(now);
  // Filter to eligible variants, sort by priority desc, take the top.
  const eligible = WELCOMES.filter((v) => isWithin(today, v.activeFrom, v.activeUntil));
  eligible.sort((a, b) => b.priority - a.priority);
  return eligible[0] || WELCOMES[WELCOMES.length - 1];
}

/** Resolve the audio URLs a welcome variant should play for a given companion. */
export function resolveAudio(variant: WelcomeVariant, companion: CompanionId): WelcomeAudio {
  if (variant.audio === 'default') {
    return {
      hello: `/audio/hello-${companion}.mp3`,
      intro: `/audio/intro-${companion}.mp3`,
    };
  }
  return variant.audio[companion];
}

// ─── Helpers ──────────────────────────────────────────────────────────

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isWithin(iso: string, from?: string, until?: string): boolean {
  if (from && iso < from) return false;
  if (until && iso > until) return false;
  return true;
}
