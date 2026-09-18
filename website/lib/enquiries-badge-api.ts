import { API_BASE } from './api-base';
import { getToken, clearAuth } from './cms-auth';
import { fetchWithRetry } from './fetch-retry';
import { handledEnquiryIds } from './enquiry-handled';

export const enquiriesBadgeApi = {
  unreadCount: async (): Promise<{ count: number }> => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    // Count the actual contact-enquiry rows here instead of trusting the
    // legacy unread-count endpoint, because a successfully-sent personal
    // reply is now tracked as handled by Mission Control.
    const res = await fetchWithRetry(`${API_BASE}/api/cms/enquiries?kind=contact&limit=500`, {
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

    const handled = handledEnquiryIds();
    const rows = Array.isArray(json?.rows) ? json.rows : [];
    const count = rows.filter((row: any) => {
      const status = String(row?.status || '').toLowerCase();
      const alreadyClosed = status === 'replied' || status === 'resolved' || status === 'closed';
      return !alreadyClosed && (!row?.id || !handled.has(String(row.id)));
    }).length;

    return { count };
  },
};
