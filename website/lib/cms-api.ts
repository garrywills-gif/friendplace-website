/**
 * API client for the FriendPlace Mini-CMS admin.
 *
 * Every call to `/api/cms/*` MUST go through here so the JWT is
 * attached consistently and 401s auto-clear the stored token (which
 * flips the guard into a login redirect on the next render).
 */

import { getToken, clearAuth } from './cms-auth';

const BASE = process.env.NEXT_PUBLIC_API_URL || '';

async function req<T>(
  method: string,
  path: string,
  body?: any,
  isFormData = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: isFormData ? body : body != null ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  if (res.status === 401) {
    // Token expired or revoked — nudge back to login.
    clearAuth();
  }

  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { detail: text }; }

  if (!res.ok) {
    const msg = json?.detail || json?.error || `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return json as T;
}

export const cmsApi = {
  // Auth
  setupRequired: () => req<{ setup_required: boolean }>('GET', '/cms/auth/setup-required'),
  setup: (data: { email: string; password: string; display_name?: string }) =>
    req<{ ok: true; token: string; admin: any }>('POST', '/cms/auth/setup', data),
  login: (data: { email: string; password: string }) =>
    req<{ ok: true; token: string; admin: any }>('POST', '/cms/auth/login', data),
  me: () => req<{ id: string; email: string; display_name?: string; last_login_at?: string }>('GET', '/cms/auth/me'),
  forgot: (email: string) => req<{ ok: true }>('POST', '/cms/auth/forgot', { email }),
  reset: (token: string, new_password: string) =>
    req<{ ok: true; token: string }>('POST', '/cms/auth/reset', { token, new_password }),

  // Content
  getContent: () => req<any>('GET', '/cms/content'),
  patchContent: (patch: any) => req<any>('PATCH', '/cms/content', patch),
  stats: () => req<{
    pages_count: number;
    media_count: number;
    faqs_count: number;
    success_stories_count: number;
    founding_members_count_editable: number;
    founder_signups_count: number;
    status: { label: string; color: 'amber' | 'green' | 'red'; dot: string };
    updated_at?: string;
  }>('GET', '/cms/stats'),

  // Media
  listMedia: () => req<{ items: any[]; count: number }>('GET', '/cms/media'),
  uploadMedia: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<any>('POST', '/cms/media/upload', fd, true);
  },
  updateMedia: (id: string, patch: any) => req<any>('PATCH', `/cms/media/${id}`, patch),
  deleteMedia: (id: string) => req<{ ok: true }>('DELETE', `/cms/media/${id}`),
};
