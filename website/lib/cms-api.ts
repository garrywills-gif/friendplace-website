/**
 * API client for the FriendPlace Mini-CMS admin.
 *
 * Every call to `/api/cms/*` MUST go through here so the JWT is
 * attached consistently and 401s auto-clear the stored token (which
 * flips the guard into a login redirect on the next render).
 */

import { getToken, clearAuth } from './cms-auth';
import { API_BASE } from './api-base';
import { fetchWithRetry } from './fetch-retry';

const BASE = API_BASE;

async function req<T>(
  method: string,
  path: string,
  body?: any,
  isFormData = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  // Only attach Content-Type when a JSON body is actually sent.
  // A Content-Type header on GETs forces a CORS preflight (OPTIONS),
  // doubling round-trips through the edge for zero benefit.
  if (!isFormData && body != null) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetchWithRetry(`${BASE}/api${path}`, {
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
  updateMe: (display_name: string) =>
    req<{
      ok: true;
      admin: { id: string; email: string; display_name: string; last_login_at?: string | null };
    }>('PATCH', '/cms/auth/me', { display_name }),
  forgot: (email: string) => req<{ ok: true }>('POST', '/cms/auth/forgot', { email }),
  reset: (token: string, new_password: string) =>
    req<{ ok: true; token: string }>('POST', '/cms/auth/reset', { token, new_password }),
  changePassword: (current_password: string, new_password: string) =>
    req<{ ok: true; token: string }>('POST', '/cms/auth/change-password', { current_password, new_password }),

  // Admins — same-tier management (all admins are equal in permissions).
  listAdmins: () => req<{
    items: Array<{
      id: string;
      email: string;
      display_name?: string;
      created_at?: string;
      last_login_at?: string | null;
    }>;
    count: number;
  }>('GET', '/cms/admins'),
  createAdmin: (data: { email: string; display_name?: string }) =>
    req<{
      ok: true;
      admin: {
        id: string;
        email: string;
        display_name?: string;
        created_at?: string;
        last_login_at?: string | null;
      };
      invite_url: string;
      expires_in_minutes: number;
    }>('POST', '/cms/admins', data),
  deleteAdmin: (id: string) => req<{ ok: true }>('DELETE', `/cms/admins/${id}`),

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

  // Public event submissions (draft-first) — used by the /list-your-event
  // page. Nothing auth-gated here; Mission Control handles review.
  submitPublicEvent: (payload: PublicEventSubmission) =>
    req<{ ok: true; submission_ref: string; message: string }>('POST', '/public/events/submit', payload),
  listEventSubmissions: (status?: string) =>
    req<{ items: EventSubmissionRow[]; counts: { pending: number; approved: number; rejected: number } }>(
      'GET', `/cms/event-submissions${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),
  approveEventSubmission: (id: string) =>
    req<{ ok: true; event_id: string; event_slug: string }>('POST', `/cms/event-submissions/${id}/approve`, {}),
  rejectEventSubmission: (id: string, reason?: string) =>
    req<{ ok: true }>('POST', `/cms/event-submissions/${id}/reject`, reason ? { reason } : {}),
  // RSVPs
  listRsvps: (eventId: string) => req<{ items: EventRsvp[]; counts: { going: number; waitlist: number }; capacity: number | null }>('GET', `/cms/events/${eventId}/rsvps`),
  addRsvp: (eventId: string, data: Partial<EventRsvp>) => req<EventRsvp>('POST', `/cms/events/${eventId}/rsvps`, data),
  updateRsvp: (eventId: string, rsvpId: string, patch: Partial<EventRsvp>) => req<EventRsvp>('PATCH', `/cms/events/${eventId}/rsvps/${rsvpId}`, patch),
  deleteRsvp: (eventId: string, rsvpId: string) => req<{ ok: true }>('DELETE', `/cms/events/${eventId}/rsvps/${rsvpId}`),

  // Admin audit log (Slice 0 foundation)
  listAuditLog: (opts?: {
    action_prefix?: string;
    target_type?: string;
    target_id?: string;
    admin_id?: string;
    limit?: number;
    skip?: number;
  }) => {
    const p = new URLSearchParams();
    if (opts?.action_prefix) p.set('action_prefix', opts.action_prefix);
    if (opts?.target_type) p.set('target_type', opts.target_type);
    if (opts?.target_id) p.set('target_id', opts.target_id);
    if (opts?.admin_id) p.set('admin_id', opts.admin_id);
    if (opts?.limit != null) p.set('limit', String(opts.limit));
    if (opts?.skip != null) p.set('skip', String(opts.skip));
    const qs = p.toString();
    return req<{ items: AuditLogEntry[]; total: number; limit: number; skip: number }>(
      'GET', `/cms/admin-log${qs ? `?${qs}` : ''}`,
    );
  },
  auditLogActions: () =>
    req<{ actions: string[] }>('GET', '/cms/admin-log/actions'),

  // Member management (Slice 1)
  listMembers: (opts?: { q?: string; status?: string; limit?: number; skip?: number }) => {
    const p = new URLSearchParams();
    if (opts?.q) p.set('q', opts.q);
    if (opts?.status) p.set('status', opts.status);
    if (opts?.limit != null) p.set('limit', String(opts.limit));
    if (opts?.skip != null) p.set('skip', String(opts.skip));
    const qs = p.toString();
    return req<{ items: MemberRow[]; total: number; limit: number; skip: number }>(
      'GET', `/cms/members${qs ? `?${qs}` : ''}`,
    );
  },
  getMember: (id: string) =>
    req<MemberProfile>('GET', `/cms/members/${encodeURIComponent(id)}`),
  addMemberNote: (id: string, note: string) =>
    req<{ ok: true }>('POST', `/cms/members/${encodeURIComponent(id)}/notes`, { note }),
  warnMember: (id: string, body: { reason: string; report_id?: string }) =>
    req<{ ok: true }>('POST', `/cms/members/${encodeURIComponent(id)}/actions/warn`, body),
  suspendMember: (id: string, body: { reason: string; duration_hours: number; report_id?: string }) =>
    req<{ ok: true; suspended_until: string }>('POST', `/cms/members/${encodeURIComponent(id)}/actions/suspend`, body),
  banMember: (id: string, body: { reason: string; report_id?: string }) =>
    req<{ ok: true }>('POST', `/cms/members/${encodeURIComponent(id)}/actions/ban`, body),
  restoreMember: (id: string, body: { reason: string }) =>
    req<{ ok: true }>('POST', `/cms/members/${encodeURIComponent(id)}/actions/restore`, body),
  deleteMember: (id: string, body: { confirm_member_id: string; reason: string }) =>
    req<{ ok: true }>('POST', `/cms/members/${encodeURIComponent(id)}/actions/delete`, body),
};

export type MemberRow = {
  id: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  username?: string;
  email?: string;
  avatar?: string;
  created_at?: string;
  last_active?: string;
  restricted?: boolean;
  banned?: boolean;
  suspended_until?: string | null;
  restricted_reason?: string;
  flagged_for_review?: boolean;
  profile_hidden?: boolean;
  is_admin?: boolean;
  is_demo?: boolean;
  is_founding?: boolean;
};

export type MemberModerationLogEntry = {
  id: string;
  user_id: string;
  by: string;
  action: string;
  reason?: string;
  report_id?: string;
  created_at: string;
  duration_hours?: number;
  until?: string;
  target_type?: string;
  target_id?: string;
  by_user?: { id?: string; display_name?: string; first_name?: string; username?: string; avatar?: string | null; email?: string };
};

export type MemberReport = {
  id: string;
  reporter_id?: string;
  target_user_id?: string;
  target_type?: string;
  target_id?: string;
  reason?: string;
  status?: string;
  urgent?: boolean;
  outcome?: string;
  admin_note?: string;
  created_at?: string;
  updated_at?: string;
};

export type MemberProfile = {
  user: MemberRow & Record<string, any>;
  reports: MemberReport[];
  warnings: any[];
  moderation_log: MemberModerationLogEntry[];
  counts: {
    reports_total: number;
    reports_open: number;
    warnings: number;
    suspensions: number;
    bans: number;
    notes: number;
    actions_total: number;
    last_action_at: string | null;
    last_action: string | null;
  };
};

export type AuditLogEntry = {
  _id: string;
  ts: string;
  admin_id?: string;
  admin_email?: string;
  admin_name?: string;
  action: string;
  target_type?: string;
  target_id?: string;
  reason?: string;
  metadata?: Record<string, any>;
  ip?: string;
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

export type PublicEventSubmission = {
  organisation_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  event_title: string;
  event_starts_at: string;
  event_ends_at?: string;
  venue_name?: string;
  venue_address?: string;
  description?: string;
  capacity?: number | null;
  cost_type?: 'free' | 'paid';
  cost_display?: string;
  accessibility_info?: string;
  cover_image_base64?: string;
  agreed_to_review: boolean;
};

export type EventSubmissionRow = {
  id: string;
  submission_ref: string;
  organisation_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string | null;
  event_title: string;
  event_starts_at: string;
  event_ends_at?: string | null;
  venue_name?: string | null;
  venue_address?: string | null;
  description?: string | null;
  capacity?: number | null;
  cost_type?: string;
  cost_display?: string | null;
  accessibility_info?: string | null;
  cover_image_base64?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewer_notes?: string | null;
  resulting_event_id?: string | null;
  created_at: string;
  updated_at: string;
};
