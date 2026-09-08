/**
 * George's voice preference — persisted, reactive.
 *
 * C1 Voice Phase 3 (locked with Garry, 21 July 2026).
 *
 * The persona a member picks in Accessibility flows through
 * `georgeApi.speak()` on every subsequent speaker-button tap. We keep
 * this state in AsyncStorage so it survives app restarts, and hydrate
 * a tiny in-memory cache on boot so speaker buttons can render the
 * right icon/label without an async round-trip.
 *
 * `subscribe()` powers the `useGeorgeVoice()` hook so every open
 * speaker button and the Accessibility screen stay in sync when the
 * preference changes.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type GeorgeVoice = 'george' | 'georgia';

const STORAGE_KEY = '@friendplace/george_voice';
// Set when the member has EXPLICITLY chosen a companion (via
// Settings → Accessibility → Voice). Read by the onboarding tour so
// that a random tour host only announces a handoff to the saved
// companion when the member has actually made a choice — Garry's rule
// ("If they haven't chosen an everyday companion yet, don't invent
// one just for the handoff", Sep 2026).
const CHOSEN_FLAG_KEY = '@friendplace/george_voice_chosen';
export const DEFAULT_VOICE: GeorgeVoice = 'george';

// In-memory cache — synchronously readable by `getVoiceSync()` so
// components can decide what to fetch without awaiting AsyncStorage.
let _cached: GeorgeVoice | null = null;

// Subscribers get notified whenever the voice changes.
type Listener = (v: GeorgeVoice) => void;
const _listeners = new Set<Listener>();

/** Fire-and-forget prime of the cache. Call once on app boot. */
export async function hydrateVoice(): Promise<GeorgeVoice> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const value: GeorgeVoice = raw === 'georgia' ? 'georgia' : DEFAULT_VOICE;
    _cached = value;
    return value;
  } catch {
    _cached = DEFAULT_VOICE;
    return DEFAULT_VOICE;
  }
}

/** Synchronous read of the cached preference. Falls back to default
 *  if hydration hasn't finished yet. */
export function getVoiceSync(): GeorgeVoice {
  return _cached ?? DEFAULT_VOICE;
}

/** Async read (also warms the cache). */
export async function getVoice(): Promise<GeorgeVoice> {
  if (_cached) return _cached;
  return hydrateVoice();
}

/** Persist a new voice preference, mark the member as having chosen
 *  it, and notify subscribers. */
export async function setVoice(next: GeorgeVoice): Promise<void> {
  _cached = next;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, next);
    await AsyncStorage.setItem(CHOSEN_FLAG_KEY, '1');
  } catch {
    // Non-fatal — the in-memory cache is still updated, so the
    // preference sticks for this session at least.
  }
  _listeners.forEach(fn => {
    try { fn(next); } catch { /* one bad listener shouldn't kill the rest */ }
  });
}

/** Has the member explicitly chosen a companion voice, or are we
 *  still on the app-wide default? Used by the onboarding tour to
 *  decide whether a random tour host should hand off to a "saved"
 *  companion at the end of the flow. */
export async function hasChosenCompanion(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CHOSEN_FLAG_KEY)) === '1';
  } catch {
    return false;
  }
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribeVoice(fn: Listener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/** React hook — components re-render whenever the voice changes. */
export function useGeorgeVoice(): {
  voice: GeorgeVoice;
  setVoice: (v: GeorgeVoice) => Promise<void>;
  hydrated: boolean;
} {
  const [voice, setV] = useState<GeorgeVoice>(getVoiceSync);
  const [hydrated, setHydrated] = useState<boolean>(_cached !== null);

  useEffect(() => {
    let active = true;
    if (_cached === null) {
      hydrateVoice().then(v => {
        if (!active) return;
        setV(v);
        setHydrated(true);
      });
    } else {
      setHydrated(true);
    }
    const unsub = subscribeVoice(v => { if (active) setV(v); });
    return () => { active = false; unsub(); };
  }, []);

  return { voice, setVoice, hydrated };
}

/** Human labels for surfacing in UI. Keep in sync with the backend
 *  `_VOICE_MAP` in `/app/backend/services/george/voice/synthesize.py`. */
export const VOICE_LABELS: Record<GeorgeVoice, {
  short: string;
  full: string;
  flag: string;
  description: string;
}> = {
  george: {
    short: 'George',
    full: 'George (male)',
    flag: '🇦🇺',
    description: 'Warm, deep Aussie voice.',
  },
  georgia: {
    short: 'Georgia',
    full: 'Georgia (female)',
    flag: '🇦🇺',
    description: 'Bright, friendly Aussie voice.',
  },
};
