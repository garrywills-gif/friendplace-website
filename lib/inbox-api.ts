import { API_BASE } from './api-base';
import { clearAuth, getToken } from './cms-auth';
import { fetchWithRetry } from './fetch-retry';

export type Mailbox = {
  id: string;
  address: string;
  label: string;
  active?: boolean;
  created_at?: string;
  unread?: number;
};

export type InboxMessage = {
  id: string;
  mailbox: string;
  direction: 'inbound' | 'outbound';
  from_email: string;
  from_name: string;
  to_email: string;
  subject: string;
  text: string;
  html: string;
  snippet: string;
  thread_id: string;
  read: boolean;
  archived_at: string | null;
  received_at: string;
  created_at: string;
  sent_by?: string | null;
};

export type InboxListResponse = {
  count: number;
  rows: InboxMessage[];
  mailboxes: Mailbox[];
  total_unread: number;
};

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetchWithRetry(`${API_BASE}/api${path}`, {
    method,
    headers,
    cache: 'no-store',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearAuth();
    throw new Error('Your session has expired. Please sign in again.');
  }

  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { detail: text }; }

  if (!res.ok) {
    const msg = res.status >= 500
      ? (json?.detail || 'Inbox service is temporarily unavailable.')
      : json?.detail || json?.error || `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return json as T;
}

function listQuery(opts?: { mailbox?: string; read?: boolean; archived?: boolean; limit?: number }) {
  const qs = new URLSearchParams();
  if (opts?.mailbox) qs.set('mailbox', opts.mailbox);
  if (typeof opts?.read === 'boolean') qs.set('read', String(opts.read));
  qs.set('archived', String(opts?.archived ?? false));
  qs.set('limit', String(opts?.limit ?? 200));
  return qs.toString();
}

export const inboxApi = {
  mailboxes: () => req<{ mailboxes: Mailbox[] }>('GET', '/cms/email/mailboxes'),
  addMailbox: (address: string, label?: string) =>
    req<Mailbox>('POST', '/cms/email/mailboxes', { address, label }),
  removeMailbox: (id: string) =>
    req<{ ok: true }>('DELETE', `/cms/email/mailboxes/${encodeURIComponent(id)}`),

  list: (opts?: { mailbox?: string; read?: boolean; archived?: boolean; limit?: number }) =>
    req<InboxListResponse>('GET', `/cms/email/messages?${listQuery(opts)}`),
  get: (id: string) =>
    req<{ message: InboxMessage; thread: InboxMessage[] }>('GET', `/cms/email/messages/${encodeURIComponent(id)}`),
  setRead: (id: string, read: boolean) =>
    req<InboxMessage>('POST', `/cms/email/messages/${encodeURIComponent(id)}/read`, { read }),
  archive: (id: string) =>
    req<InboxMessage>('POST', `/cms/email/messages/${encodeURIComponent(id)}/archive`),
  restore: (id: string) =>
    req<InboxMessage>('POST', `/cms/email/messages/${encodeURIComponent(id)}/restore`),
  reply: (id: string, body: { body_text: string; body_html?: string; subject?: string }) =>
    req<{ ok: true; message_id: string; reply: InboxMessage }>('POST', `/cms/email/messages/${encodeURIComponent(id)}/reply`, body),
  unreadCount: () => req<{ count: number }>('GET', '/cms/email/unread-count'),
};
