import { API_BASE } from './api-base';
import { clearAuth, getToken } from './cms-auth';
import { fetchWithRetry } from './fetch-retry';
import type { OutreachOrg, OutreachStatus } from './cms-api';

type OutreachListParams = {
  q?: string;
  category?: string;
  status?: OutreachStatus;
  limit?: number;
};

export type OutreachListResponse = {
  count?: number;
  rows?: OutreachOrg[];
  organisations?: OutreachOrg[];
};

async function request<T>(method: string, path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchWithRetry(`${API_BASE}/api${path}`, {
    method,
    headers,
    cache: 'no-store',
  });

  if (res.status === 401) {
    clearAuth();
    throw new Error('Your session has expired. Please sign in again.');
  }

  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; }
  catch { json = { detail: text }; }

  if (!res.ok) {
    const msg = res.status >= 500
      ? 'Outreach service is temporarily unavailable.'
      : json?.detail || json?.error || `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return json as T;
}

function buildListQuery(archived: boolean, params?: OutreachListParams) {
  const qs = new URLSearchParams({ archived: archived ? 'true' : 'false' });
  if (params?.q) qs.set('q', params.q);
  if (params?.category) qs.set('category', params.category);
  if (params?.status) qs.set('status', params.status);
  if (params?.limit) qs.set('limit', String(params.limit));
  return qs.toString();
}

export const outreachArchiveApi = {
  listActive: (params?: OutreachListParams) =>
    request<OutreachListResponse>('GET', `/cms/outreach/organisations?${buildListQuery(false, params)}`),
  list: (params?: OutreachListParams) =>
    request<OutreachListResponse>('GET', `/cms/outreach/organisations?${buildListQuery(true, params)}`),
  archive: (id: string) =>
    request<OutreachOrg>('POST', `/cms/outreach/organisations/${encodeURIComponent(id)}/archive`),
  restore: (id: string) =>
    request<OutreachOrg>('POST', `/cms/outreach/organisations/${encodeURIComponent(id)}/unarchive`),
};
