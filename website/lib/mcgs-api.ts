/**
 * MCGS API client and George SSE streaming helper.
 *
 * Every read hits `/api/mcgs/*`. George streaming chat is a plain
 * `fetch(..., { body })` with a ReadableStream, not EventSource, so
 * we can POST the message. Server sends SSE-formatted frames either
 * way — we parse them here.
 */

import { getToken, clearAuth } from './cms-auth';

const BASE = process.env.NEXT_PUBLIC_API_URL || '';

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
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json?.detail || json?.error || `Request failed (${res.status})`);
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
  kind: 'session' | 'plan' | 'tools' | 'delta' | 'done';
  text?: string;
  chat_id?: string;
  plan?: unknown;
  results?: unknown;
  reply_length?: number;
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
