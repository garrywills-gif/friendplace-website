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
    events_count: number;
    events_upcoming_count: number;
    status: { label: string; color: 'amber' | 'green' | 'red'; dot: string };
    updated_at?: string;
    system: {
      website: { label: string; color: 'amber' | 'green' | 'red'; dot: string };
      api: { ok: boolean; label: string };
      database: { ok: boolean; label: string };
      last_publish_at?: string;
      app_version: string;
    };
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

  // Success Stories
  listStories: () => req<{ items: SuccessStory[]; count: number }>('GET', '/cms/success-stories'),
  createStory: (data?: Partial<SuccessStory>) => req<SuccessStory>('POST', '/cms/success-stories', data || {}),
  getStory: (id: string) => req<SuccessStory>('GET', `/cms/success-stories/${id}`),
  updateStory: (id: string, patch: Partial<SuccessStory>) => req<SuccessStory>('PATCH', `/cms/success-stories/${id}`, patch),
  deleteStory: (id: string) => req<{ ok: true }>('DELETE', `/cms/success-stories/${id}`),
  reorderStories: (ids: string[]) => req<{ items: SuccessStory[] }>('POST', '/cms/success-stories/reorder', { ids }),

  // Founding Members
  listFoundingMembers: () => req<{ items: FoundingMember[]; count: number }>('GET', '/cms/founding-members'),
  createFoundingMember: (data?: Partial<FoundingMember>) => req<FoundingMember>('POST', '/cms/founding-members', data || {}),
  getFoundingMember: (id: string) => req<FoundingMember>('GET', `/cms/founding-members/${id}`),
  updateFoundingMember: (id: string, patch: Partial<FoundingMember>) => req<FoundingMember>('PATCH', `/cms/founding-members/${id}`, patch),
  deleteFoundingMember: (id: string) => req<{ ok: true }>('DELETE', `/cms/founding-members/${id}`),
  reorderFoundingMembers: (ids: string[]) => req<{ items: FoundingMember[] }>('POST', '/cms/founding-members/reorder', { ids }),

  // Events
  listEvents: () => req<{ items: EventRow[]; count: number }>('GET', '/cms/events'),
  createEvent: (data?: Partial<EventRow>) => req<EventRow>('POST', '/cms/events', data || {}),
  getEvent: (id: string) => req<EventRow>('GET', `/cms/events/${id}`),
  updateEvent: (id: string, patch: Partial<EventRow>) => req<EventRow>('PATCH', `/cms/events/${id}`, patch),
  deleteEvent: (id: string) => req<{ ok: true }>('DELETE', `/cms/events/${id}`),
  cancelEvent: (id: string, reason?: string) =>
    req<{ ok: true; emailed: number; event: EventRow; already_cancelled?: boolean }>('POST', `/cms/events/${id}/cancel`, reason ? { reason } : {}),
  // RSVPs
  listRsvps: (eventId: string) => req<{ items: EventRsvp[]; counts: { going: number; waitlist: number }; capacity: number | null }>('GET', `/cms/events/${eventId}/rsvps`),
  addRsvp: (eventId: string, data: Partial<EventRsvp>) => req<EventRsvp>('POST', `/cms/events/${eventId}/rsvps`, data),
  updateRsvp: (eventId: string, rsvpId: string, patch: Partial<EventRsvp>) => req<EventRsvp>('PATCH', `/cms/events/${eventId}/rsvps/${rsvpId}`, patch),
  deleteRsvp: (eventId: string, rsvpId: string) => req<{ ok: true }>('DELETE', `/cms/events/${eventId}/rsvps/${rsvpId}`),
};

export type SuccessStory = {
  id: string;
  title: string;
  body_html: string;
  author_name: string;
  author_role?: string;
  author_location?: string;
  author_avatar_url?: string;
  status: 'draft' | 'published';
  hidden?: boolean;
  order?: number;
  created_at: string;
  updated_at: string;
  created_by?: string;
};

export type FoundingMember = {
  id: string;
  name: string;
  number: number;
  bio_html: string;
  role?: string;
  location?: string;
  avatar_url?: string;
  status: 'draft' | 'published';
  hidden?: boolean;
  order?: number;
  created_at: string;
  updated_at: string;
  created_by?: string;
};

export type EventSponsor = {
  name?: string;
  logo_url?: string;
  website_url?: string;
};

export type EventRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  body_html: string;
  cover_image_url?: string;
  starts_at: string;
  ends_at?: string;
  timezone: string;
  is_online: boolean;
  venue_name?: string;
  venue_address?: string;
  venue_url?: string;
  meeting_url?: string;
  capacity: number | null;
  rsvp_deadline_at?: string;
  cost_type: 'free' | 'paid';
  cost_display: string;
  organiser_name?: string;
  organiser_contact?: string;
  accessibility_info?: string;
  sponsors: EventSponsor[];
  status: 'draft' | 'published' | 'cancelled';
  hidden?: boolean;
  cancelled_at?: string;
  cancellation_reason?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  rsvp_counts?: { going: number; waitlist: number };
};

export type EventRsvp = {
  id: string;
  event_id: string;
  name: string;
  email?: string;
  user_id?: string;
  guests_count: number;
  note?: string;
  status: 'going' | 'waitlist' | 'cancelled';
  created_at: string;
  updated_at: string;
};
