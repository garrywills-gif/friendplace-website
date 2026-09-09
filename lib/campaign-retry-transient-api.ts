import { API_BASE } from './api-base';
import { clearAuth, getToken } from './cms-auth';
import { fetchWithRetry } from './fetch-retry';

export type TransientBounceRetryResponse = {
  attempted: number;
  succeeded: number;
  failed_again: number;
  suppressed: number;
  eligible: number;
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
    const msg = json?.detail || json?.error || `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return json as T;
}

export const campaignRetryTransientApi = {
  retry: (campaignId: string) =>
    request<TransientBounceRetryResponse>(
      'POST',
      `/cms/campaigns/${encodeURIComponent(campaignId)}/retry-transient-bounces`,
    ),
};
