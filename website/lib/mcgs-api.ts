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
import { fetchWithRetry } from './fetch-retry';

const BASE = API_BASE;

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  // Content-Type only when a body is sent — avoids CORS preflights on GETs.
  if (body != null) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetchWithRetry(`${BASE}/api${path}`, {
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

// ---------- System health ----------

export type ProbeStatus = 'ok' | 'degraded' | 'unknown' | 'disabled';

export interface Probe {
  name: string;
  status: ProbeStatus;
  note: string;
  response_ms: number | null;
  last_checked: string;
  details?: { cached?: boolean; url?: string; used_bytes?: number; free_bytes?: number; [key: string]: unknown };
}

export interface SystemHealth {
  overall: ProbeStatus;
  generated_at: string;
  cached: boolean;
  probes: Probe[];
  counts: Record<string, number>;
  deployment: {
    website_version: string | null;
    frontend_version: string | null;
    commit_hash: string | null;
    commit_short: string | null;
    commit_time: string | null;
    commit_message: string | null;
  };
}

// ---------- API surface ----------

export interface BridgeCategoryTile {
  key: string;
  label: string;
  short: string;
  producers: string[];
  open: number;
  oldest_waiting_seconds: number | null;
  oldest_waiting_at: string | null;
}

export interface BridgeSummary {
  categories: BridgeCategoryTile[];
  milestones: { open: number };
  total_actionable: number;
  computed_at: string;
}

export const mcgsApi = {
  counts: () => req<Counts>('GET', '/mcgs/counts'),
  bridgeSummary: () => req<BridgeSummary>('GET', '/mcgs/bridge/summary'),
  systemHealth: (opts: { fresh?: boolean } = {}) =>
    req<SystemHealth>('GET', `/mcgs/system-health${opts.fresh ? '?fresh=1' : ''}`),
  listSignals: (params: { limit?: number; status?: string[]; priority?: Priority[]; producer?: string[]; origin?: string[] } = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    (params.status || []).forEach(s => q.append('status', s));
    (params.priority || []).forEach(p => q.append('priority', p));
    (params.producer || []).forEach(p => q.append('producer', p));
    (params.origin || []).forEach(o => q.append('origin', o));
    return req<{ items: Signal[]; count: number }>('GET', `/mcgs/signals?${q.toString()}`);
  },
  listCases: (params: { limit?: number; status?: string[]; priority?: Priority[]; producer?: string[]; origin?: string[] } = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    (params.status || []).forEach(s => q.append('status', s));
    (params.priority || []).forEach(p => q.append('priority', p));
    (params.producer || []).forEach(p => q.append('producer', p));
    (params.origin || []).forEach(o => q.append('origin', o));
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
  kind: 'session' | 'plan' | 'tools' | 'delta' | 'done' | 'action_preview' | 'navigate' | 'error';
  text?: string;
  chat_id?: string;
  plan?: unknown;
  results?: unknown;
  reply_length?: number;
  // navigate event: emitted by the backend when George announces
  // "Opening the X now" and there's a matching MCGS route. Frontend
  // consumers should `router.push(path)` to actually navigate.
  path?: string;
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
 *
 * Hardened (June 2026):
 *   - `res.ok` is checked — a non-SSE error response (e.g. the preview
 *     edge's plain-text "404 page not found") becomes a visible
 *     `error` event instead of a silent stall.
 *   - A watchdog aborts after 30s with no first byte, or 60s with no
 *     new data mid-stream, and reports a friendly timeout.
 *   - A `done` event is GUARANTEED exactly once via `finally`, so the
 *     caller's busy state can never get stuck.
 */
export function askGeorge(
  message: string,
  onEvent: (ev: GeorgeStreamEvent) => void,
  chatId?: string | null,
  surfaceContext?: Record<string, unknown> | null,
): { abort: () => void } {
  const controller = new AbortController();
  const token = getToken();
  let timedOut = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const arm = (ms: number) => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  };

  (async () => {
    let doneEmitted = false;
    const emit = (ev: GeorgeStreamEvent) => {
      if (ev.kind === 'done') {
        if (doneEmitted) return;
        doneEmitted = true;
      }
      onEvent(ev);
    };
    try {
      arm(30_000); // 30s to reach the server and receive the first byte.
      // iter164d: use plain fetch() here, NOT fetchWithRetry. The
      // retry wrapper enforces a 10s per-attempt timeout that races
      // against fetch()'s response-arrival — fine for JSON endpoints,
      // fatal for SSE streaming. Safari's installed web-app (macOS
      // PWA / "Add to Dock") buffers streaming responses more
      // aggressively than Safari's normal window, so the first byte
      // frequently lands >10s after the request while GPT composes
      // its opening tokens. The 10s abort was silently killing every
      // George reply in the PWA even though the backend was responding
      // correctly (proven by Safari working fine on the same origin).
      // askGeorge has its OWN watchdog (30s to first byte, 60s between
      // chunks) which is the right shape for streaming; retries for
      // this endpoint would be user-facing double replies, not a
      // desirable behaviour, so we skip the retry loop entirely.
      const res = await fetch(`${BASE}/api/george/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`,
        },
        body: JSON.stringify({
          message,
          chat_id: chatId || undefined,
          scope: 'mcgs',
          surface_context: surfaceContext || undefined,
        }),
        signal: controller.signal,
        cache: 'no-store',
        // Preserve cookies / auth in standalone PWA mode where some
        // WKWebView contexts default to omit; explicit same-origin
        // matches the JWT-in-Authorization-header pattern above.
        credentials: 'same-origin',
      });
      if (!res.ok || !res.body) {
        emit({
          kind: 'error',
          text: `George couldn\u2019t reach the server just now (${res.status}). Please try again in a moment.`,
        });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        arm(60_000); // fresh 60s allowance between chunks.
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
            emit({ kind: evType as GeorgeStreamEvent['kind'], ...payload });
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        if (timedOut) {
          emit({
            kind: 'error',
            text: 'That took longer than it should have, so I\u2019ve stopped waiting. Please try again.',
          });
        }
        // User-initiated cancel: no error message; `finally` still
        // delivers `done` so the composer unlocks.
      } else {
        console.error('[george-chat] stream failed:', err);
        const msg = (err as Error).message || '';
        emit({
          kind: 'error',
          text: /took a moment too long/i.test(msg)
            ? 'George couldn\u2019t reach the server just now. Please try again in a moment.'
            : 'Sorry \u2014 something went wrong. Please try again in a moment.',
        });
      }
    } finally {
      if (watchdog) clearTimeout(watchdog);
      emit({ kind: 'done' });
    }
  })();
  return { abort: () => controller.abort() };
}

// ---------- Voice ----------

/**
 * POST an audio blob to the transcription endpoint. Returns the
 * transcript text so the caller can prefill an editable input.
 *
 * iter164e: the filename we send must match the actual container
 * inside the blob. Chrome/Firefox produce audio/webm (opus); Safari
 * — including the macOS installed WebApp / WKWebView — produces
 * audio/mp4 (AAC). If we always sent "clip.webm" the backend saved
 * the temp file with a .webm extension and Whisper 502'd because
 * the bytes inside were actually MP4/AAC. We now derive the file
 * extension from ``blob.type``.
 */
function _extForBlob(blob: Blob): string {
  const t = (blob.type || '').toLowerCase();
  if (t.startsWith('audio/webm')) return 'webm';
  if (t.startsWith('audio/mp4') || t === 'audio/aac' || t === 'audio/x-m4a') return 'm4a';
  if (t === 'audio/mpeg' || t === 'audio/mp3') return 'mp3';
  if (t === 'audio/wav' || t === 'audio/x-wav') return 'wav';
  if (t === 'audio/ogg' || t.startsWith('audio/ogg')) return 'ogg';
  // Fallback: whatever the browser gave us — the backend has its
  // own allow-list and will reset to 'webm' if this looks unusable.
  return 'webm';
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const token = getToken();
  const form = new FormData();
  const ext = _extForBlob(blob);
  form.append('audio', blob, `clip.${ext}`);
  const res = await fetchWithRetry(`${BASE}/api/george/voice/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token || ''}` },
    body: form,
  });
  const text = await res.text();
  let json: { detail?: string; transcript?: string } = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { detail: text }; }
  if (!res.ok) throw new Error(json?.detail || 'Transcription failed');
  return json.transcript || '';
}

/**
 * Fetch George's reply as an mp3 blob for playback via <audio>.
 *
 * Voice policy: the client sends a persona key ("george" = deep male,
 * "georgia" = bright female). The backend resolves this to the actual
 * OpenAI voice id so a bad client value can never leak the wrong voice.
 * Anything other than "georgia" falls back to the established male
 * voice server-side.
 */
export async function speakText(text: string, voice: 'george' | 'georgia' = 'george', speed = 0.95, signal?: AbortSignal): Promise<Blob> {
  const token = getToken();
  // Cache-buster query param defeats any browser/edge cache that might
  // otherwise replay a stale audio blob (e.g. a female clip after we
  // switched George's persona to male).
  const url = `${BASE}/api/george/voice/speak?_=${Date.now()}`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token || ''}`,
      'Cache-Control': 'no-cache',
    },
    body: JSON.stringify({ text, voice, speed }),
    signal,
  });
  if (!res.ok) throw new Error(`Speech failed: ${res.status}`);
  return await res.blob();
}

