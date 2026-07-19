import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * George Platform — mobile API client.
 *
 * George is a shared platform. This client talks to the same endpoints
 * as Mission Control (`/api/mcgs/george/*`); the backend resolves the
 * caller's actor type (admin | member) from the bearer token and routes
 * accordingly. The mobile app is the *destination* for George — this
 * client will grow to cover every capability George exposes.
 */

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const TOKEN_STORAGE_KEY = 'yb_token';

async function _token(): Promise<string | null> {
  try { return await AsyncStorage.getItem(TOKEN_STORAGE_KEY); }
  catch { return null; }
}

async function _req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const tok = await _token();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...((opts.headers as Record<string, string>) || {}),
  };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(`${BASE}/api${path}`, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---- Presence -----------------------------------------------------------

export interface PresenceUnfinished {
  session_id: string;
  title?: string | null;
  status: string;
  updated_at?: string;
}

export interface Presence {
  actor_id: string;
  name?: string;
  first_meeting?: boolean;
  unfinished: PresenceUnfinished[];
  last_completed?: { title?: string; approved_at?: string } | null;
  actor_type?: 'admin' | 'member';
}

export const georgeApi = {
  presence: () => _req<Presence>('/mcgs/george/presence'),
  introduced: () => _req<{ ok: boolean; george_first_met_at: string }>(
    '/mcgs/george/introduced', { method: 'POST' },
  ),
};
