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
  onboarding_complete?: boolean;
  has_active_onboarding?: boolean;
}

export interface EventDraftSource { field: string; source: string }
export interface EventDraft {
  title?: string | null;
  emoji?: string | null;
  description?: string | null;
  location?: string | null;
  date?: string | null;
  time?: string | null;
  capacity?: number | null;
  price?: string | null;
  audience?: string | null;
  sources?: EventDraftSource[];
}

export interface EventTurn {
  role: 'user' | 'george';
  content: string;
  at?: string;
  state?: string;
  excitement_line?: string | null;
  working_line?: string | null;
  warmth_line?: string | null;
  suggestion?: EventSuggestion | null;
  description_written?: boolean;
}

export interface EventSuggestion {
  kind: 'names' | 'description' | 'invitation';
  offer_line: string;
}

export interface EventSession {
  session_id: string;
  status: 'in_progress' | 'drafted' | 'approved' | 'cancelled';
  turns: EventTurn[];
  extracted?: Record<string, any>;
  defaults?: Record<string, any>;
  draft?: EventDraft | null;
  field_being_asked?: string | null;
  excitement_line?: string | null;
  working_line?: string | null;
  warmth_line?: string | null;
  suggestion?: EventSuggestion | null;
  suggestion_offered?: boolean;
  pending_suggestion?: EventSuggestion | null;
}

export interface EventApprovalResult {
  session_id: string;
  routed_to: string;
  outcome: 'published' | 'submitted_for_review';
  target: {
    id: string;
    title?: string;
    emoji?: string;
    date?: string;
    time?: string;
    location?: string;
  };
}

export const georgeApi = {
  presence: () => _req<Presence>('/mcgs/george/presence'),
  introduced: () => _req<{ ok: boolean; george_first_met_at: string }>(
    '/mcgs/george/introduced', { method: 'POST' },
  ),
  // Onboarding
  onboardingStart: () => _req<any>(
    '/mcgs/george/onboarding/start', { method: 'POST', body: JSON.stringify({}) },
  ),
  onboardingTurn: (sessionId: string, text: string) => _req<any>(
    `/mcgs/george/onboarding/session/${sessionId}/turn`,
    { method: 'POST', body: JSON.stringify({ text }) },
  ),
  onboardingApprove: (sessionId: string, edits?: Record<string, any>) => _req<any>(
    `/mcgs/george/onboarding/session/${sessionId}/approve`,
    { method: 'POST', body: JSON.stringify({ edits: edits || null }) },
  ),
  onboardingFinishLater: (sessionId: string) => _req<any>(
    `/mcgs/george/onboarding/session/${sessionId}/finish-later`, { method: 'POST' },
  ),
  // Event creation (Milestone B5)
  eventStart: (text: string = '') => _req<EventSession>(
    '/mcgs/george/event/start', { method: 'POST', body: JSON.stringify({ text }) },
  ),
  eventTurn: (sessionId: string, text: string) => _req<EventSession>(
    `/mcgs/george/event/session/${sessionId}/turn`,
    { method: 'POST', body: JSON.stringify({ text }) },
  ),
  eventGet: (sessionId: string) => _req<EventSession>(
    `/mcgs/george/event/session/${sessionId}`,
  ),
  eventApprove: (sessionId: string, edits?: Partial<EventDraft>) => _req<EventApprovalResult>(
    `/mcgs/george/event/session/${sessionId}/approve`,
    { method: 'POST', body: JSON.stringify({ edits: edits || null }) },
  ),
  eventCancel: (sessionId: string) => _req<any>(
    `/mcgs/george/event/session/${sessionId}/cancel`, { method: 'POST' },
  ),
};
