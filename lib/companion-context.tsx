'use client';

/**
 * CompanionContext — the model that carries "who's showing me around"
 * from the public site through the RYI record and into the app.
 *
 * Read `/app/JOURNEY_CONTINUITY.md` before changing anything here.
 * Especially:
 *   > There is one voice — the FriendPlace voice — and every surface,
 *   > every companion, every message uses it. George and Georgia
 *   > simply speak that voice. The audience changes. The values never do.
 *
 * The companion is a personal preference for name / voice / avatar,
 * NOT a personality. Both companions know exactly the same things,
 * behave exactly the same way, and speak with exactly the same voice.
 *
 * Persistence:
 *   • localStorage on the browser \u2014 survives tab close, so
 *     a visitor who returns tomorrow sees the same companion who
 *     greeted them yesterday.
 *   • Mirrored to the RYI record on submit (via server) so it lives
 *     with the account they later create.
 *   • On first mobile login, the app reads the companion from the
 *     account and says "Welcome back." in that voice.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────

export type CompanionId = 'george' | 'georgia';

/** Display metadata for each companion. Voice / avatar / colour DIFFER;
 *  personality and values DO NOT. This is the only place in the code
 *  where the pair differ — everywhere else they are interchangeable. */
export const COMPANIONS: Record<CompanionId, {
  id: CompanionId;
  name: string;
  ttsPersona: 'george' | 'georgia'; // maps to backend persona key
  pronouns: { subject: string; object: string; possessive: string };
  greetingLine: string;             // spoken on butterfly-lands moment
  emailSignatureName: string;       // for the welcome email sign-off
}> = {
  george: {
    id: 'george',
    name: 'George',
    ttsPersona: 'george',
    pronouns: { subject: 'he', object: 'him', possessive: 'his' },
    greetingLine: "Hello. I'm George. I'm really pleased you found us.",
    emailSignatureName: 'George',
  },
  georgia: {
    id: 'georgia',
    name: 'Georgia',
    ttsPersona: 'georgia',
    pronouns: { subject: 'she', object: 'her', possessive: 'her' },
    greetingLine: "Hello. I'm Georgia. I'm really pleased you found us.",
    emailSignatureName: 'Georgia',
  },
};

// ─── Storage ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'fp_companion_choice';

function readStored(): CompanionId | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'george' || raw === 'georgia') return raw;
  } catch { /* storage blocked \u2014 fall through */ }
  return null;
}

function writeStored(id: CompanionId | null) {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage blocked */ }
}

// ─── Context ───────────────────────────────────────────────────────────

interface CompanionCtx {
  /** Current companion, or null if the visitor hasn't chosen yet. */
  companion: CompanionId | null;
  /** Convenience: full display metadata for the current companion. */
  meta: (typeof COMPANIONS)[CompanionId] | null;
  /** Choose a companion. Persists to localStorage immediately. */
  choose: (id: CompanionId) => void;
  /** Wipe the choice \u2014 used by a "start over" affordance and by logout. */
  clear: () => void;
  /** True once we've loaded the stored choice (avoids SSR flicker). */
  ready: boolean;
}

const Ctx = createContext<CompanionCtx | null>(null);

export function CompanionProvider({ children }: { children: ReactNode }) {
  const [companion, setCompanion] = useState<CompanionId | null>(null);
  const [ready, setReady] = useState(false);

  // Hydrate from localStorage after mount so SSR-rendered markup is
  // identical for every visitor (no flash of the wrong companion).
  useEffect(() => {
    setCompanion(readStored());
    setReady(true);
  }, []);

  const choose = useCallback((id: CompanionId) => {
    writeStored(id);
    setCompanion(id);
  }, []);

  const clear = useCallback(() => {
    writeStored(null);
    setCompanion(null);
  }, []);

  const value: CompanionCtx = {
    companion,
    meta: companion ? COMPANIONS[companion] : null,
    choose,
    clear,
    ready,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ─── Hook ──────────────────────────────────────────────────────────────

export function useCompanion(): CompanionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      'useCompanion() must be used inside <CompanionProvider>. Wrap the app in RootLayout.',
    );
  }
  return ctx;
}
