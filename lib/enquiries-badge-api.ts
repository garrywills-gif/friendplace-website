import { API_BASE } from './api-base';
import { getToken, clearAuth } from './cms-auth';
import { fetchWithRetry } from './fetch-retry';

export const enquiriesBadgeApi = {
  unreadCount: async (): Promise<{ count: number }> => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetchWithRetry(`${API_BASE}/api/cms/enquiries/unread-count`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    if (res.status === 401) clearAuth();

    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { detail: text }; }

    if (!res.ok) {
      const msg = json?.detail || json?.error || `Request failed (${res.status})`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }

    return { count: Number(json?.count ?? 0) };
  },
};
