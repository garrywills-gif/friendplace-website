/**
 * MCGS API client and George SSE streaming helper.
 *
 * Every read hits `/api/mcgs/*`. George streaming chat is a plain
 * `fetch(..., { body })` with a ReadableStream, not EventSource, so
 * we can POST the message. Server sends SSE-formatted frames either
 * way — we parse them here.
 */

import { getToken, clearAuth } from './cms-auth';
import { API_BASE } from './api-base';

const BASE = API_BASE;

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) clearAuth();
  const text = await res.text();
  // Safely parse — a stray HTML error page from a proxy, or a
  // truncated payload, must not surface as a raw
  // "Unable to parse JSON string" to the user.
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      if (!res.ok) {
        throw new Error(
          `George couldn't reach that just now (${res.status}). Please try again in a moment.`,
        );
      }
      throw new Error(
        "George's answer came back in an unexpected shape. Please try again.",
      );
    }
  }
  const j = json as { detail?: string; error?: string };
  if (!res.ok) throw new Error(j?.detail || j?.error || `Request failed (${res.status})`);
  return json as T;
}

// ---------- Types ----------

export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
export type SignalStatus = 'NEW' | 'SEEN' | 'IN_REVIEW' | 'SNOOZED' | 'ESCALATED' | 'RESOLVED' | 'DISMISSED';

export interface GeorgeRead {
  tldr: string;
  suggested_action: string;
  confidence: 'high' | 'moderate' | 'low';
  reasoning?: string;
  model?: string;
  generated_at?: string;
}

export interface Signal {
  id: string;
  case_id: string;
  category: string;
  priority: Priority;
  subject: string;
  body: string;
  source: string;
  producer: string;
  entity_ref: { kind: string; id: string };
  george_read?: GeorgeRead | null;
  status: SignalStatus;
  assignee_id?: string | null;
  channels_available?: string[];
  prompt_injection_suspected?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Case {
  id: string;
  case_key: string;
  subject: string;
  category: string;
  priority: Priority;
  status: SignalStatus;
  signal_ids: string[];
  assignee_id?: string | null;
  first_signal_at: string;
  last_signal_at: string;
  george_read?: GeorgeRead | null;
  created_at: string;
  updated_at: string;
}

export interface Counts {
  signals: { open: number; new: number; in_review: number };
  cases: { open: number };
  per_producer: Record<string, number>;
  computed_at: string;
}

// ---------- API surface ----------

export const mcgsApi = {
  counts: () => req<Counts>('GET', '/mcgs/counts'),
  listSignals: (params: { limit?: number; status?: string[]; priority?: Priority[] } = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    (params.status || []).forEach(s => q.append('status', s));
    (params.priority || []).forEach(p => q.append('priority', p));
    return req<{ items: Signal[]; count: number }>('GET', `/mcgs/signals?${q.toString()}`);
  },
  listCases: (params: { limit?: number; status?: string[]; priority?: Priority[] } = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    (params.status || []).forEach(s => q.append('status', s));
    (params.priority || []).forEach(p => q.append('priority', p));
    return req<{ items: Case[]; count: number }>('GET', `/mcgs/cases?${q.toString()}`);
  },
  getCase: (id: string) => req<Case & { signals: Signal[] }>('GET', `/mcgs/cases/${id}`),
  transitionSignal: (id: string, to: SignalStatus, extra: { notes?: string; resolved_action?: string } = {}) =>
    req<Signal>('PATCH', `/mcgs/signals/${id}/state`, { to, ...extra }),
  transitionCase: (id: string, to: SignalStatus, extra: { notes?: string; resolved_action?: string } = {}) =>
    req<Case>('PATCH', `/mcgs/cases/${id}/state`, { to, ...extra }),
  assignCase: (id: string, assignee_id: string | null) =>
    req<Case>('POST', `/mcgs/cases/${id}/assign`, { assignee_id }),
  streamUrl: () => `${BASE}/api/mcgs/stream`,
};

// ---------- Rhythms (Phase 2) ----------

export interface RhythmSettings {
  admin_id: string;
  timezone: string;
  morning_weekday_at: string;
  morning_weekend_at: string;
  midday_at: string;
  eod_at: string;
  eod_inactivity_wait_minutes: number;
  email_channel_enabled: boolean;
  push_channel_enabled: boolean;
  eod_email_enabled: boolean;
  midday_push_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  vacation_mode: boolean;
  updated_at?: string | null;
}

export interface BriefingSection {
  heading: string;
  bullets: string[];
}

export interface BriefingContent {
  opener_id: string;
  opener_line: string;
  continuity_line: string | null;
  noticed_line: string | null;
  sections: BriefingSection[];
  recommendation_heading?: string;
  recommendation: string;
  tone_note?: string;
  celebrated_moments?: string[];
}

export interface BriefingRow {
  id: string;
  admin_id: string;
  rhythm_type: 'morning' | 'midday' | 'eod' | 'milestone';
  date_key: string;
  delivered_at: string;
  status: 'queued' | 'delivered' | 'seen' | 'acknowledged' | 'skipped';
  bridge_seen_at?: string | null;
  bridge_acknowledged_at?: string | null;
  opener_used?: string | null;
  content_json: BriefingContent;
  content_markdown: string;
  grounded_sources?: Record<string, unknown>;
  composer_model?: string;
  created_at: string;
}

export const rhythmsApi = {
  getSettings: () => req<RhythmSettings>('GET', '/mcgs/rhythms/settings'),
  updateSettings: (patch: Partial<RhythmSettings>) =>
    req<RhythmSettings>('PUT', '/mcgs/rhythms/settings', patch),
  today: () =>
    req<{ date_key: string; items: BriefingRow[]; count: number }>(
      'GET', '/mcgs/rhythms/today',
    ),
  composeMorning: (force = false) =>
    req<BriefingRow>('POST', `/mcgs/rhythms/morning/compose${force ? '?force=true' : ''}`),
  deliverMorning: () =>
    req<{ briefing_id: string; channels: Record<string, string>; already_seen_on_bridge: boolean; delivered_at: string }>(
      'POST', '/mcgs/rhythms/morning/deliver',
    ),
  schedulerStatus: () =>
    req<{ running: boolean; jobs: { id: string; next_run_at: string | null; trigger: string }[] }>(
      'GET', '/mcgs/rhythms/scheduler',
    ),
  markSeen: (id: string) =>
    req<{ updated: number; seen_at: string }>('POST', `/mcgs/rhythms/briefings/${id}/seen`),
  acknowledge: (id: string) =>
    req<{ acknowledged_at: string }>('POST', `/mcgs/rhythms/briefings/${id}/acknowledge`),
  heartbeat: () => req<{ ok: boolean; admin_id: string }>('POST', '/mcgs/rhythms/heartbeat'),
};

// ---------- Conversational Event Creation (Phase 3) ----------

export interface EventDraftSource {
  field: string;
  source: string;
}

export interface EventDraft {
  title?: string;
  emoji?: string;
  description?: string;
  location?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  duration_minutes?: number;
  capacity?: number | null;
  price?: string | null;
  audience?: string | null;
  sources?: EventDraftSource[];
}

export interface EventTurn {
  role: 'user' | 'george';
  content: string;
  at: string;
  state?: 'needs_question' | 'ready_to_draft';
  excitement_line?: string | null;
  working_line?: string | null;
}

export interface EventSession {
  id: string;
  session_id: string;
  actor_id: string;
  actor_role: 'admin' | 'member' | 'organisation';
  host_id: string;
  status: 'in_progress' | 'drafted' | 'approved' | 'cancelled';
  turns: EventTurn[];
  extracted?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  draft?: EventDraft | null;
  field_being_asked?: string | null;
  excitement_line?: string | null;
  working_line?: string | null;
  created_at: string;
  updated_at: string;
  routed_to?: string;
  target_id?: string;
}

export interface EventApprovalResult {
  session_id: string;
  routed_to: string;
  outcome: 'published' | 'submitted_for_review';
  target: EventDraft & { id: string };
}

export const eventCreationApi = {
  start: (text: string) =>
    req<EventSession>('POST', '/mcgs/george/event/start', { text }),
  turn: (sessionId: string, text: string) =>
    req<EventSession>('POST', `/mcgs/george/event/session/${sessionId}/turn`, { text }),
  get: (sessionId: string) =>
    req<EventSession>('GET', `/mcgs/george/event/session/${sessionId}`),
  approve: (sessionId: string, edits?: Partial<EventDraft>) =>
    req<EventApprovalResult>('POST', `/mcgs/george/event/session/${sessionId}/approve`, { edits: edits || null }),
  cancel: (sessionId: string) =>
    req<{ session_id: string; status: string }>('POST', `/mcgs/george/event/session/${sessionId}/cancel`),
};

// ---------- SSE stream ----------

export interface StreamEvent {
  type: string;
  [k: string]: unknown;
}

/**
 * Subscribe to /api/mcgs/stream. EventSource doesn't support headers,
 * so we use fetch + ReadableStream and parse SSE frames ourselves.
 * Returns an unsubscribe function.
 */
export function subscribeToBridge(
  onEvent: (ev: StreamEvent) => void,
  onError?: (err: unknown) => void,
): () => void {
  const abort = new AbortController();
  const token = getToken();
  (async () => {
    try {
      const res = await fetch(`${BASE}/api/mcgs/stream`, {
        headers: { Authorization: `Bearer ${token || ''}` },
        signal: abort.signal,
      });
      if (!res.body) throw new Error('no body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames separated by \n\n
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let evType = 'message';
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) evType = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length === 0) continue;
          try {
            const payload = JSON.parse(dataLines.join('\n'));
            onEvent({ type: evType, ...payload });
          } catch {
            // Ignore comments / keep-alives.
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') onError?.(err);
    }
  })();
  return () => abort.abort();
}

// ---------- George grounded chat ----------

export interface GeorgeStreamEvent {
  kind: 'session' | 'plan' | 'tools' | 'delta' | 'done' | 'action_preview';
  text?: string;
  chat_id?: string;
  plan?: unknown;
  results?: unknown;
  reply_length?: number;
  // action_preview payload arrives with the same top-level fields as
  // the /api/mcgs/proposals/* endpoint response — action_type, target,
  // what, why, sources, confidence, draft, case_id, etc.
  action_type?: string;
  target?: { kind: string; id: string };
  what?: string;
  why?: string;
  sources?: Array<{ label: string; kind: string; id: string }>;
  confidence?: 'high' | 'moderate' | 'low';
  confidence_reason?: string;
  draft?: string;
  case_id?: string | null;
  decision?: string;
  generated_at?: string;
  generated_by?: { kind: string; model: string };
}

/**
 * POST /api/george/chat and stream events back. Returns an object
 * with an `abort` method the caller can invoke to cancel.
 */
export function askGeorge(
  message: string,
  onEvent: (ev: GeorgeStreamEvent) => void,
  chatId?: string | null,
): { abort: () => void } {
  const controller = new AbortController();
  const token = getToken();
  (async () => {
    try {
      const res = await fetch(`${BASE}/api/george/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`,
        },
        body: JSON.stringify({ message, chat_id: chatId || undefined, scope: 'mcgs' }),
        signal: controller.signal,
      });
      if (!res.body) throw new Error('no body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let evType = 'message';
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) evType = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length === 0) continue;
          try {
            const payload = JSON.parse(dataLines.join('\n'));
            onEvent({ kind: evType as GeorgeStreamEvent['kind'], ...payload });
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') {
        onEvent({ kind: 'delta', text: '\n\nSorry — something went wrong. Try again in a moment.' });
        onEvent({ kind: 'done' });
      }
    }
  })();
  return { abort: () => controller.abort() };
}

// ---------- Voice ----------

/**
 * POST a webm audio blob to the transcription endpoint. Returns the
 * transcript text so the caller can prefill an editable input.
 */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const token = getToken();
  const form = new FormData();
  form.append('audio', blob, 'clip.webm');
  const res = await fetch(`${BASE}/api/george/voice/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token || ''}` },
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.detail || 'Transcription failed');
  return json.transcript || '';
}

/**
 * Fetch George's reply as an mp3 blob for playback via <audio>.
 */
export async function speakText(text: string, voice = 'onyx', speed = 0.95): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${BASE}/api/george/voice/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
    body: JSON.stringify({ text, voice, speed }),
  });
  if (!res.ok) throw new Error(`Speech failed: ${res.status}`);
  return await res.blob();
}

