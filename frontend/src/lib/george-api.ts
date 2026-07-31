import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { getVoice, DEFAULT_VOICE, type GeorgeVoice } from './george-voice';

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

export interface PausedEventSession {
  session_id: string;
  title?: string | null;
  paused_at?: string | null;
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
  paused_event_session?: PausedEventSession | null;
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
  welcome_back?: boolean;
  /** C1 Slice 2 — Deep-link chip. See `/app/frontend/src/lib/george-nav-map.ts`. */
  navigate_to?: { key: string; label: string } | null;
  /** Locked with Garry 31 July 2026 — George's one-tap
   *  "🦋 Share this as a Moment" chip. When present, the client
   *  renders a special chip that opens `/moments/new?draft=<text>`
   *  with the caption George suggested pre-filled. */
  share_moment_suggestion?: { text: string; label: string } | null;
  /** B6 Session 2 — Conversational event editing. When present, this
   * George turn was produced by the edit flow and the UI should render
   * an EventChangeSummaryCard beneath the bubble. */
  edit?: EventEditMeta | null;
  /** TestFlight feedback #1/#2 (Garry, 27 July 2026) — Inline
   * celebration turn produced by the client on event approval so the
   * chat conversation stays in place. Renders a warm confirmation
   * card below the bubble instead of jumping to a fullscreen modal. */
  celebration?: {
    outcome: 'published' | 'submitted_for_review';
    title?: string;
    emoji?: string;
    event_id?: string;
  } | null;
}

export type EventEditKind =
  | 'edit_awaiting_confirm'
  | 'edit_applied'
  | 'edit_declined'
  | 'edit_disambiguate'
  | 'edit_needs_details'
  | 'edit_undo_needs_target'
  | 'edit_no_change'
  | 'edit_error';

export type EventEditAction = 'update' | 'cancel' | 'restore' | 'undo';

export interface EventEditMeta {
  kind: EventEditKind;
  action?: EventEditAction;
  /** Fields the member proposed changing but that still need consent. */
  pending_changes?: Record<string, unknown>;
  /** Fields we already applied on this turn (low-risk or post-confirmation). */
  applied?: Record<string, unknown>;
  /** Snapshot of the field values BEFORE the apply (parallel to
   * `applied`). Populated on `edit_applied` turns so the UI can
   * render OLD → NEW diffs without re-reading the pre-apply event. */
  before?: Record<string, unknown>;
  /** Change summary + action for the UI's card view. */
  proposal?: { summary?: string; action?: EventEditAction; changes?: Record<string, unknown> };
  /** The target event we're editing. */
  event?: { id: string; title?: string; date?: string; time?: string; location?: string };
  /** When multiple events matched an ambiguous reference. */
  candidates?: { id: string; title?: string }[];
  /** The immutable audit row that was written. Used for undo affordances. */
  audit?: { id?: string; summary?: string; severity?: 'minor' | 'significant'; action?: string };
}

// B7 — George Remembers
export interface RemembersDisplay {
  emoji?: string;
  title?: string;
  when_label?: string;
  body?: string;
  cta_label?: string;
  cta_kind?: 'view_event' | string;
}

export interface RemembersMessage {
  id: string;
  kind: 'pre_event' | 'post_event';
  event_id: string;
  recipient_id: string;
  content: string;
  /** Structured payload for the visual card. Falls back to `content`
   * when absent (rows created before Session 2 refinement). */
  display?: RemembersDisplay;
  status: 'scheduled' | 'delivered' | 'dismissed' | 'cancelled' | 'superseded';
  scheduled_for?: string;
  event_snapshot?: {
    title?: string;
    emoji?: string;
    date?: string;
    time?: string;
    location?: string;
  };
  created_at?: string;
  updated_at?: string;
  delivered_at?: string;
  seen_at?: string;
  dismissed_at?: string;
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
  // Event creation (Milestone B5, current_screen added in C1 Slice 3)
  eventStart: (text: string = '', currentScreen?: string | null) => _req<EventSession>(
    '/mcgs/george/event/start',
    { method: 'POST', body: JSON.stringify({ text, current_screen: currentScreen ?? null }) },
  ),
  eventTurn: (sessionId: string, text: string, currentScreen?: string | null) => _req<EventSession>(
    `/mcgs/george/event/session/${sessionId}/turn`,
    { method: 'POST', body: JSON.stringify({ text, current_screen: currentScreen ?? null }) },
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
  eventPause: (sessionId: string) => _req<{ session_id: string; status: string; paused_at: string }>(
    `/mcgs/george/event/session/${sessionId}/pause`, { method: 'POST' },
  ),
  eventResume: (sessionId: string) => _req<EventSession>(
    `/mcgs/george/event/session/${sessionId}/resume`, { method: 'POST' },
  ),

  // B7 — George Remembers (persistent inbox)
  remembersInbox: () => _req<{ items: RemembersMessage[] }>('/mcgs/george/remembers/inbox'),
  remembersDismiss: (msgId: string) => _req<RemembersMessage>(
    `/mcgs/george/remembers/${msgId}/dismiss`, { method: 'POST' },
  ),
  remembersSeen: (msgId: string) => _req<{ ok: boolean; row?: RemembersMessage }>(
    `/mcgs/george/remembers/${msgId}/seen`, { method: 'POST' },
  ),

  // C1 Voice Phase 1 — Speech-to-text via Whisper. Uploads a short
  // audio clip as multipart form data and returns the transcript.
  // The client should NEVER auto-send the transcript; the member
  // reviews it in the composer first (Garry's review-first rule).
  transcribe: async (audioUri: string, filename?: string, mimeType?: string): Promise<string> => {
    const tok = await _token();
    const form = new FormData();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form.append('file', {
      uri: audioUri,
      name: filename || 'george-voice.m4a',
      type: mimeType || 'audio/m4a',
    } as any);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (tok) headers.Authorization = `Bearer ${tok}`;
    const res = await fetch(`${BASE}/api/mcgs/george/transcribe`, {
      method: 'POST',
      headers,
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status} ${text}`);
    }
    const data = await res.json();
    return (data?.text || '').trim();
  },

  // C1 Voice Phase 2 — Text-to-speech. Fetches MP3 audio for George's
  // reply text and returns a local file URI (native) or blob URL (web)
  // ready for `expo-audio` playback. The frontend renders a speaker
  // icon on each George bubble; a tap calls this. Never auto-play.
  //
  // `persona` is optional — when omitted, we read the member's persisted
  // preference from `george-voice` (defaults to `george`). Passing an
  // explicit persona is useful for the "Preview voice" button on the
  // settings screen where we want to demo the *other* voice too.
  //
  // Platform note: `expo-audio`'s `useAudioPlayer` reliably plays
  // `blob:` URLs on web, but on iOS/Android the native `AVAudioPlayer`
  // / `ExoPlayer` implementations cannot resolve blob URIs — they need
  // a real `file://` path or a remote https URL. So on native we write
  // the mp3 bytes to the app's cache directory and return that path;
  // on web we return the blob URL directly. Cached files are named
  // by a hash of the text so repeated taps re-use the same file.
  speak: async (text: string, persona?: GeorgeVoice): Promise<string> => {
    const voice: GeorgeVoice = persona ?? (await getVoice()) ?? DEFAULT_VOICE;

    // ── Disk cache check (native only) ────────────────────────────────
    // Files are named by (voice + content-hash), so if the same text was
    // spoken in this voice previously and is still on disk, we can skip
    // the network + OpenAI TTS call entirely. Critical for cost after
    // TestFlight round-5 (Garry, Feb 2026): SpeakButton is now cloud-
    // backed on every screen (games, notices, DMs, events…) so caching
    // is the difference between "acceptable" and "expensive".
    const filename = `george-${voice}-${_shortHash(text)}.mp3`;
    if (Platform.OS !== 'web') {
      try {
        const cached = new File(Paths.cache, filename);
        // `.exists` is synchronous in expo-file-system's new File API.
        if (cached.exists) return cached.uri;
      } catch { /* fall through to network */ }
    }

    const tok = await _token();
    const res = await fetch(`${BASE}/api/mcgs/george/speak`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`speak ${res.status}: ${err.slice(0, 200)}`);
    }

    if (Platform.OS === 'web') {
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    }

    // Native: write the mp3 bytes into the app cache directory and
    // return the resulting `file://…mp3` URI. `expo-audio` plays this
    // path natively without any blob-URI hacks.
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const file = new File(Paths.cache, filename);
    try { file.delete(); } catch { /* first-run: no prior file */ }
    file.create();
    file.write(bytes);
    return file.uri;
  },
};

/** Small, non-crypto text hash used to name cached TTS files so
 * repeated taps of the same reply hit the same file. Not for
 * security — just for locality. */
function _shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) + input.charCodeAt(i);
    h = h & 0xffffffff;
  }
  return (h >>> 0).toString(36);
}
