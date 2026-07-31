/**
 * GeorgeContext — global state for FriendPlace's companion (C1 Slice 3).
 *
 * Locked with Garry 22 July 2026: "George follows the member, and the
 * conversation follows George." This context provides three things
 * every screen needs:
 *
 *   1. `activeSessionId` — the single in-play George conversation that
 *      persists across screen navigation. Reopening the butterfly on
 *      any screen restores this exact session.
 *   2. `currentScreen`   — a short canonical key ("home", "lounge",
 *      "friends", "events", "groups", "notices", "games", "profile",
 *      "chats", "moments", "help", "settings", "notifications",
 *      "founders", "onboarding", "auth", "landing") derived from the
 *      current expo-router pathname. Sent to the backend on every turn
 *      so George quietly knows where the member is.
 *   3. `openGeorge()` / `closeGeorge()` / `resetGeorge()` — a single
 *      controller so the butterfly (mounted globally in the root
 *      layout) can be summoned from anywhere.
 *
 * PERSISTENCE: `activeSessionId` is mirrored to AsyncStorage so the
 * conversation survives cold restarts within the same day. The server
 * remains the source of truth for content (turns, draft, status);
 * this cache is only used to know WHICH session to resume.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo,
  useRef, useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';

// ---- Screen key derivation ------------------------------------------------

/** Canonical screen keys George understands. Keep in sync with the
 * backend `_SCREEN_OPENERS` map and the CURRENT SCREEN section of
 * `services/george/event_creation/service.py`. */
export type GeorgeScreenKey =
  | 'home' | 'chats' | 'friends' | 'lounge' | 'profile'
  | 'games' | 'groups' | 'notices' | 'events' | 'moments'
  | 'founders' | 'help' | 'notifications' | 'settings'
  | 'onboarding' | 'auth' | 'landing' | 'unknown';

/** Derive a canonical screen key from an expo-router pathname. Everything
 * below a top-level segment collapses to that segment ("/games/solitaire"
 * → "games"), which is what George's prompt expects. */
export function pathnameToScreenKey(pathname: string | null | undefined): GeorgeScreenKey {
  if (!pathname) return 'unknown';
  const p = pathname.split('?')[0].split('#')[0]; // strip query/hash
  if (p === '/' || p === '') return 'landing';
  const parts = p.split('/').filter(Boolean);
  // Skip route groups like "(tabs)" — expo-router strips them from the
  // rendered URL, but the raw pathname sometimes still contains them
  // during transitions. Take the first non-group segment.
  const head = parts.find(seg => !seg.startsWith('(') && !seg.startsWith('+'));
  if (!head) return 'unknown';
  const first = head.toLowerCase();

  // Direct matches
  const known: Record<string, GeorgeScreenKey> = {
    home: 'home', chats: 'chats', friends: 'friends',
    lounge: 'lounge', profile: 'profile', games: 'games',
    groups: 'groups', notices: 'notices', events: 'events',
    moments: 'moments', founders: 'founders', help: 'help',
    notifications: 'notifications', settings: 'settings',
    onboarding: 'onboarding', auth: 'auth', waitlist: 'landing',
    messages: 'chats', 'edit-profile': 'profile',
    group: 'groups', event: 'events', notice: 'notices',
    user: 'friends',
    // Recipes has been retired for members (superseded by Share a
    // Moment). If someone lands on /recipes via a deep link we still
    // want George to appear as if they're on Moments — the redirect
    // in app/recipes/index.tsx sends them there anyway.
    recipes: 'moments',
  };
  return known[first] ?? 'unknown';
}

/** Routes on which George is NOT shown. */
const HIDDEN_SCREENS: ReadonlySet<GeorgeScreenKey> = new Set<GeorgeScreenKey>([
  'auth', 'onboarding', 'landing',
]);

// ---- Context --------------------------------------------------------------

interface GeorgeCtx {
  currentScreen: GeorgeScreenKey;
  currentPathname: string | null;
  butterflyVisible: boolean;
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  clearActiveSession: () => void;
  openRequested: number;         // bumped by openGeorge() so the host reacts
  openGeorge: () => void;
  /** B6 Session 3 — Open George with a prefilled first message.
   * Sets `pendingOpener` and bumps `openRequested`. The Butterfly
   * host will forward the opener to a fresh event conversation so
   * George naturally begins the edit dialogue on the target event. */
  openGeorgeWithPrompt: (text: string) => void;
  /** Opener text set by `openGeorgeWithPrompt`, consumed once by the
   * event surface (either used as the first user turn on a new session
   * or dropped into the composer for review if a session is active). */
  pendingOpener: string | null;
  consumePendingOpener: () => string | null;
  closeGeorge: () => void;       // just close the modal, keep session
  /** Slice 3 v2 — set to a screen key by whoever triggered a
   * George-led navigation (e.g. the "Take me to FP Café" chip).
   * The butterfly reads this and plays a brief flutter-in on the new
   * page, then clears it. */
  landedFrom: GeorgeScreenKey | null;
  markGeorgeLedNavigation: (destination: GeorgeScreenKey) => void;
  consumeLanded: () => void;
}

const Ctx = createContext<GeorgeCtx | null>(null);

const STORAGE_KEY = 'george.activeSession';
// Bug #5 (TestFlight, 27 July 2026): a stored session was resurfacing
// unexpectedly on later opens. Cap the persisted session's lifetime
// so a dropped/backgrounded chat can't spring back after a long gap.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function GeorgeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentScreen = useMemo(() => pathnameToScreenKey(pathname), [pathname]);
  const butterflyVisible = !HIDDEN_SCREENS.has(currentScreen);

  const [activeSessionId, _setActiveSessionId] = useState<string | null>(null);
  const [openRequested, setOpenRequested] = useState<number>(0);
  const [landedFrom, setLandedFrom] = useState<GeorgeScreenKey | null>(null);
  const [pendingOpener, setPendingOpener] = useState<string | null>(null);
  const hydrated = useRef(false);

  // Hydrate from AsyncStorage once on mount.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          // The stored value may be a bare session_id (legacy) or a
          // JSON object `{ id, ts }` (v2). Fall through gracefully.
          let sid: string | null = null;
          let ts: number | null = null;
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.id) {
              sid = String(parsed.id);
              ts = typeof parsed.ts === 'number' ? parsed.ts : null;
            }
          } catch { /* legacy string form */ }
          if (!sid) sid = raw;
          // Enforce TTL — if the stored session is older than 24h,
          // discard it silently so a stale chat doesn't reappear.
          if (ts !== null && Date.now() - ts > SESSION_TTL_MS) {
            try { await AsyncStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
          } else if (sid) {
            _setActiveSessionId(sid);
          }
        }
      } catch { /* ignore — non-fatal */ }
      hydrated.current = true;
    })();
  }, []);

  const setActiveSessionId = useCallback((id: string | null) => {
    _setActiveSessionId(id);
    if (!hydrated.current) return;
    (async () => {
      try {
        if (id) {
          const payload = JSON.stringify({ id, ts: Date.now() });
          await AsyncStorage.setItem(STORAGE_KEY, payload);
        } else {
          await AsyncStorage.removeItem(STORAGE_KEY);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const clearActiveSession = useCallback(() => setActiveSessionId(null), [setActiveSessionId]);

  const openGeorge = useCallback(() => {
    setOpenRequested(n => n + 1);
  }, []);

  const openGeorgeWithPrompt = useCallback((text: string) => {
    const trimmed = (text || '').trim();
    setPendingOpener(trimmed || null);
    setOpenRequested(n => n + 1);
  }, []);

  const consumePendingOpener = useCallback((): string | null => {
    const t = pendingOpener;
    if (t !== null) setPendingOpener(null);
    return t;
  }, [pendingOpener]);

  const closeGeorge = useCallback(() => {
    // Keep activeSessionId — the whole point of C1 Slice 3 is that the
    // conversation follows George. Closing the modal is not the same
    // as ending the conversation. Only "Don't save" or explicit reset
    // clears the session.
  }, []);

  const markGeorgeLedNavigation = useCallback((destination: GeorgeScreenKey) => {
    // Called by the "Take me to X" chip just before navigation fires.
    // The butterfly on the destination page will detect the flag and
    // play a brief flutter-in animation, then clear it.
    setLandedFrom(destination);
  }, []);

  const consumeLanded = useCallback(() => {
    setLandedFrom(null);
  }, []);

  const value = useMemo<GeorgeCtx>(() => ({
    currentScreen,
    currentPathname: pathname,
    butterflyVisible,
    activeSessionId,
    setActiveSessionId,
    clearActiveSession,
    openRequested,
    openGeorge,
    openGeorgeWithPrompt,
    pendingOpener,
    consumePendingOpener,
    closeGeorge,
    landedFrom,
    markGeorgeLedNavigation,
    consumeLanded,
  }), [
    currentScreen, pathname, butterflyVisible,
    activeSessionId, setActiveSessionId, clearActiveSession,
    openRequested, openGeorge, openGeorgeWithPrompt,
    pendingOpener, consumePendingOpener, closeGeorge,
    landedFrom, markGeorgeLedNavigation, consumeLanded,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGeorge(): GeorgeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGeorge must be used inside GeorgeProvider');
  return ctx;
}
