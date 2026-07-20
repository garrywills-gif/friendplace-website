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
 *      "chats", "recipes", "help", "settings", "notifications",
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
  | 'games' | 'groups' | 'notices' | 'events' | 'recipes'
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
    recipes: 'recipes', founders: 'founders', help: 'help',
    notifications: 'notifications', settings: 'settings',
    onboarding: 'onboarding', auth: 'auth', waitlist: 'landing',
    messages: 'chats', 'edit-profile': 'profile',
    group: 'groups', event: 'events', notice: 'notices',
    user: 'friends',
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
  closeGeorge: () => void;       // just close the modal, keep session
}

const Ctx = createContext<GeorgeCtx | null>(null);

const STORAGE_KEY = 'george.activeSession';

export function GeorgeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentScreen = useMemo(() => pathnameToScreenKey(pathname), [pathname]);
  const butterflyVisible = !HIDDEN_SCREENS.has(currentScreen);

  const [activeSessionId, _setActiveSessionId] = useState<string | null>(null);
  const [openRequested, setOpenRequested] = useState<number>(0);
  const hydrated = useRef(false);

  // Hydrate from AsyncStorage once on mount.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) _setActiveSessionId(raw);
      } catch { /* ignore — non-fatal */ }
      hydrated.current = true;
    })();
  }, []);

  const setActiveSessionId = useCallback((id: string | null) => {
    _setActiveSessionId(id);
    if (!hydrated.current) return;
    (async () => {
      try {
        if (id) await AsyncStorage.setItem(STORAGE_KEY, id);
        else    await AsyncStorage.removeItem(STORAGE_KEY);
      } catch { /* ignore */ }
    })();
  }, []);

  const clearActiveSession = useCallback(() => setActiveSessionId(null), [setActiveSessionId]);

  const openGeorge = useCallback(() => {
    setOpenRequested(n => n + 1);
  }, []);

  const closeGeorge = useCallback(() => {
    // Keep activeSessionId — the whole point of C1 Slice 3 is that the
    // conversation follows George. Closing the modal is not the same
    // as ending the conversation. Only "Don't save" or explicit reset
    // clears the session.
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
    closeGeorge,
  }), [
    currentScreen, pathname, butterflyVisible,
    activeSessionId, setActiveSessionId, clearActiveSession,
    openRequested, openGeorge, closeGeorge,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGeorge(): GeorgeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGeorge must be used inside GeorgeProvider');
  return ctx;
}
