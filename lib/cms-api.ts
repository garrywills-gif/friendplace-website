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

  // Security (Slice 0.5)
  securitySummary: () => req<{
    active_sessions: number; active_lockouts: number;
    fails_last_24h: number; successes_last_24h: number;
    thresholds: Record<string, number>;
  }>('GET', '/cms/security/summary'),
  securityEvents: (opts?: { outcome?: string; email?: string; limit?: number; skip?: number }) => {
    const p = new URLSearchParams();
    if (opts?.outcome) p.set('outcome', opts.outcome);
    if (opts?.email) p.set('email', opts.email);
    if (opts?.limit != null) p.set('limit', String(opts.limit));
    if (opts?.skip != null) p.set('skip', String(opts.skip));
    const qs = p.toString();
    return req<{ items: SecurityEvent[]; total: number }>('GET', `/cms/security/events${qs ? `?${qs}` : ''}`);
  },
  securitySessions: (activeOnly = true) =>
    req<{ items: AdminSession[] }>('GET', `/cms/security/sessions?active_only=${activeOnly}`),
  revokeSession: (jti: string) =>
    req<{ ok: boolean }>('POST', `/cms/security/sessions/${encodeURIComponent(jti)}/revoke`),
  securityLockouts: () =>
    req<{ items: Lockout[] }>('GET', '/cms/security/lockouts'),
  clearLockout: (body: { scope: 'email' | 'ip'; key: string }) =>
    req<{ ok: true }>('POST', '/cms/security/lockouts/clear', body),

  // ── Institutional Knowledge (George's memory) ──────────────────
  listKnowledge: (opts?: {
    type?: string; status?: string; visibility?: string; q?: string; limit?: number;
  }) => {
    const p = new URLSearchParams();
    if (opts?.type) p.set('type', opts.type);
    if (opts?.status) p.set('status', opts.status);
    if (opts?.visibility) p.set('visibility', opts.visibility);
    if (opts?.q) p.set('q', opts.q);
    if (opts?.limit != null) p.set('limit', String(opts.limit));
    const qs = p.toString();
    return req<{ items: KnowledgeEntry[]; types: string[] }>(
      'GET', `/cms/knowledge${qs ? `?${qs}` : ''}`,
    );
  },
  getKnowledge: (id: string) =>
    req<KnowledgeEntry>('GET', `/cms/knowledge/${encodeURIComponent(id)}`),
  knowledgeStats: () =>
    req<{
      total: number;
      by_type: Record<string, number>;
      drafts: number;
      public: number;
      admin_only: number;
      superseded: number;
    }>('GET', '/cms/knowledge-stats'),
  knowledgeDrafts: () =>
    req<{ items: KnowledgeEntry[] }>('GET', '/cms/knowledge-drafts'),
  createKnowledge: (body: Partial<KnowledgeEntry>) =>
    req<KnowledgeEntry>('POST', '/cms/knowledge', body),
  updateKnowledge: (id: string, patch: Partial<KnowledgeEntry>) =>
    req<KnowledgeEntry>('PATCH', `/cms/knowledge/${encodeURIComponent(id)}`, patch),
  confirmKnowledgeDraft: (id: string) =>
    req<KnowledgeEntry>('POST', `/cms/knowledge/${encodeURIComponent(id)}/confirm`, {}),
  discardKnowledge: (id: string) =>
    req<{ ok: true }>('POST', `/cms/knowledge/${encodeURIComponent(id)}/discard`, {}),
  supersedeKnowledge: (id: string, newEntry: Partial<KnowledgeEntry>) =>
    req<KnowledgeEntry>('POST', `/cms/knowledge/${encodeURIComponent(id)}/supersede`, newEntry),
  reseedKnowledge: () =>
    req<{ ok: true; created: number; updated: number; total: number }>('POST', '/cms/knowledge/reseed', {}),
  backfillKnowledgeEmbeddings: (opts?: { force?: boolean }) =>
    req<{ ok: true; embedded: number; failed: number; model: string; dim: number }>(
      'POST', '/cms/knowledge/backfill-embeddings', opts || {},
    ),
  knowledgeHealth: () =>
    req<{
      total: number;
      active: number;
      drafts: number;
      embedded: number;
      embedded_pct: number;
      model: string;
      dim: number;
      last_embedding_run: string | null;
      healthy: boolean;
    }>('GET', '/cms/knowledge-health'),
  knowledgeRetrievals: (opts?: { limit?: number; surface?: 'mcgs' | 'member' | 'public' }) => {
    const qs = new URLSearchParams();
    if (opts?.limit) qs.set('limit', String(opts.limit));
    if (opts?.surface) qs.set('surface', opts.surface);
    const query = qs.toString();
    return req<{
      items: Array<{
        id: string;
        at: string;
        surface: 'mcgs' | 'member' | 'public';
        session_id?: string;
        user_id?: string;
        admin_id?: string;
        query: string;
        hit_ids: string[];
        hit_scores: number[];
        hit_count: number;
        is_admin: boolean;
      }>;
      coverage: {
        since: string;
        days: number;
        by_surface: Record<string, { queries: number; grounded: number }>;
      };
    }>('GET', `/cms/knowledge-retrievals${query ? `?${query}` : ''}`);
  },
  retrieveKnowledge: (query: string, k = 5, types?: string[]) =>
    req<{ hits: KnowledgeEntry[]; count: number }>(
      'POST', '/cms/knowledge/retrieve',
      { query, k, types },
    ),

  // ── Launch Manager ─────────────────────────────────────────────
  getLaunchSettings: () =>
    req<{ settings: LaunchSettings; readiness: LaunchReadiness }>(
      'GET', '/cms/settings/launch',
    ),
  updateLaunchSettings: (patch: Partial<LaunchSettings>) =>
    req<{ settings: LaunchSettings; readiness: LaunchReadiness }>(
      'PATCH', '/cms/settings/launch', patch,
    ),
};

export type SecurityEvent = {
  _id?: string; created_at: string;
  outcome: string; email?: string; ip?: string;
  user_agent?: string; ua?: { browser?: string; os?: string; raw?: string };
  geo?: { country?: string; region?: string; city?: string } | null;
  attempt_count?: number; jti?: string; locked_until?: string;
  admin_id?: string;
};

export type AdminSession = {
  jti: string; admin_id?: string; email?: string;
  ip?: string; user_agent?: string;
  geo?: { country?: string; region?: string; city?: string } | null;
  issued_at: string; expires_at: string;
  last_seen_at?: string; revoked_at?: string | null;
};

export type Lockout = {
  scope: 'email' | 'ip'; key: string;
  locked_until: string; reason?: string;
  created_at?: string; updated_at?: string;
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

export type KnowledgeSource = {
  label?: string;
  url?: string;
  path?: string;
  chat_session_id?: string;
};

export type LaunchSettings = {
  enabled: boolean;
  launch_at: string | null;         // ISO UTC
  timezone_hint: string;
  appstore_url: string;
  playstore_url: string;
  press_kit_ready: boolean;
  launch_complete: boolean;
  founding_target: number;
  welcome_message: string;
  updated_at?: string;
  updated_by?: string;
};

export type LaunchReadinessTone = 'ready' | 'wait' | 'warn' | 'live';

export type LaunchReadiness = {
  text: string;
  tone: LaunchReadinessTone;
  checklist: {
    launch_date_set: boolean;
    countdown_enabled: boolean;
    appstore_link: boolean;
    playstore_link: boolean;
    founding_target_met: boolean;
    press_kit_ready: boolean;
    launch_complete: boolean;
  };
  founding: { current: number; target: number };
};

export type KnowledgeEntry = {
  id: string;
  type: 'story' | 'principle' | 'decision' | 'feature' | 'roadmap' | 'philosophy';
  title: string;
  body_md: string;
  tags?: string[];
  sources?: KnowledgeSource[];
  related_ids?: string[];
  status: 'active' | 'superseded' | 'draft' | 'discarded';
  visibility: 'public' | 'admin';
  admin_context?: string | null;
  evolution_note?: string | null;
  confidence?: 'canonical' | 'working' | 'provisional';
  superseded_by?: string | null;
  superseded_at?: string;
  authored_by?: string;
  updated_by?: string;
  confirmed_by?: string;
  created_at?: string;
  updated_at?: string;
  effective_from?: string;
  effective_to?: string;
  latest_version?: KnowledgeEntry | null;
  related?: Pick<KnowledgeEntry, 'id' | 'title' | 'type'>[];
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


// ─────────────────────────────────────────────────────────────────────────
// Email template preview / test-send
// ─────────────────────────────────────────────────────────────────────────
//
// The CMS "Emails" panel uses these to render each transactional email
// in the browser (subject, preheader, desktop iframe, mobile iframe,
// light/dark mode preview) and one-click send a `[TEST]` copy to the
// configured recipient (defaults to hello@friendplace.com.au).

export type EmailTemplateMeta = {
  name: string;
  label: string;
  category: 'personal' | 'operational';
  signer: 'companion' | 'team';
  description: string;
  default_subject: string;
  default_preheader: string;
  html_url: string;
  render_url: string;
  send_url: string;
};

export type EmailPreviewList = {
  recipient: string;
  resend_configured: boolean;
  templates: EmailTemplateMeta[];
};

export type EmailRenderRequest = {
  companion?: 'george' | 'georgia';
  subject?: string;
  preheader?: string;
};

export type EmailSendRequest = EmailRenderRequest & {
  /** Optional real recipient. When set, the mail is sent to this
   *  address (subject NOT prefixed with [TEST]) and, if it matches
   *  a Founding Member awaiting contact, that founder's status is
   *  auto-advanced to "invited". Leave undefined to fall back to
   *  the configured EMAIL_PREVIEW_RECIPIENT test address. */
  to?: string;
};

export type EmailRenderResponse = {
  name: string;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  companion: string;
};

export type EmailSendResponse = {
  ok: boolean;
  sent: boolean;
  reason?: string | null;
  recipient: string;
  subject: string;
  sender?: string;
  message_id?: string | null;
  http_status?: number | null;
  error_code?: string | null;
  delivery_note?: string | null;
  dashboard_url?: string | null;
  mode?: 'test' | 'real';
  founder_status_change?: {
    founder_id: string;
    from_status: string;
    to_status: string;
    at: string;
  } | null;
};

export type EmailMessageStatus = {
  ok: boolean;
  message_id: string;
  last_event: string | null;
  status_label: string;
  status_tone: 'success' | 'pending' | 'error' | 'unknown';
  created_at?: string | null;
  to?: string[] | null;
  from?: string | null;
  subject?: string | null;
  ses_message_id?: string | null;
  http_status: number;
  error?: string | null;
  dashboard_url: string;
};

// ─────────────────────────────────────────────────────────────────────────
// Enquiries — unified list of every public submission (Contact, Register
// Interest, Support, Report, Waitlist). Every row persists to the DB
// *before* any email is sent, so this view is the guaranteed source of
// truth even if outbound email delivery ever fails.
// ─────────────────────────────────────────────────────────────────────────

export type Enquiry = {
  kind: 'contact' | 'interest' | 'support' | 'report' | 'waitlist';
  kind_label: string;
  id?: string | null;
  name?: string | null;
  email?: string | null;
  subject?: string | null;
  message?: string | null;
  status: string;
  created_at?: string | null;
  meta?: Record<string, any>;
};

// ─── Founding Members CRM (Phase 1) ─────────────────────────────
export type CRMFoundingMemberStatus = 'registered' | 'invited' | 'joined' | 'opted_out';

export type CRMFoundingMember = {
  id: string;
  founder_number?: number | null;
  founder_number_locked?: boolean;
  is_reserved?: boolean;
  first_name?: string;
  last_name?: string;
  email?: string;
  state_country?: string;
  suburb?: string;
  state?: string;
  heard_from?: string;
  companion_choice?: 'george' | 'georgia' | null;
  status: CRMFoundingMemberStatus;
  admin_notes?: string;
  tags?: string[];
  source?: string;
  created_at?: string;
  updated_at?: string;
};

export type CRMFoundingMembersStats = {
  total: number;
  new_today: number;
  awaiting_contact: number;
  invited: number;
  joined: number;
  opted_out: number;
  latest: {
    id?: string;
    name?: string;
    email?: string;
    state_country?: string;
    created_at?: string;
    founder_number?: number | null;
  } | null;
};

export type CRMTimelineEvent = {
  at?: string;
  kind:
    | 'registered'
    | 'ack_sent'
    | 'email_sent'
    | 'status_change'
    | 'campaign_received'
    | 'campaign_failed';
  title: string;
  detail?: string;
  status_from?: string;
  status_to?: string;
  template?: string;
  subject?: string;
  message_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  founder_number?: number;
  actor_email?: string;
};

export const foundingMembersCrmApi = {
  list: (opts: { status?: string; q?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.status) p.set('status', opts.status);
    if (opts.q) p.set('q', opts.q);
    p.set('limit', String(opts.limit || 500));
    return req<{ count: number; rows: CRMFoundingMember[] }>(
      'GET', `/cms/crm/founding-members?${p.toString()}`,
    );
  },
  stats: () => req<CRMFoundingMembersStats>('GET', '/cms/crm/founding-members/stats'),
  update: (
    id: string,
    patch: Partial<Pick<CRMFoundingMember, 'status' | 'admin_notes' | 'tags'>>,
  ) => req<CRMFoundingMember>('PATCH', `/cms/crm/founding-members/${id}`, patch),
    remove: (id: string) =>
    req<{
      ok: true;
      deleted_id: string;
      founder_number: number | null;
      email: string;
      first_name: string;
      deleted_by: string;
    }>('DELETE', `/cms/crm/founding-members/${encodeURIComponent(id)}`),
  timeline: (id: string) =>
    req<{ count: number; events: CRMTimelineEvent[] }>(
      'GET', `/cms/crm/founding-members/${id}/timeline`,
    ),
};

export const enquiriesApi = {
  list: (kind?: string, limit = 200) => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    params.set('limit', String(limit));
    return req<{
      count: number;
      rows: Enquiry[];
      kinds: Array<{ key: string; label: string; count: number }>;
    }>('GET', `/cms/enquiries?${params.toString()}`);
  },
};

export type EmailSendingHealthCheck = {
  label: string;
  state: 'healthy' | 'needs_attention' | 'broken';
  detail?: string;
  message_id?: string;
  dashboard_url?: string;
  sent_at?: string;
};

export type EmailSendingHealth = {
  overall: 'healthy' | 'needs_attention' | 'broken';
  checks: EmailSendingHealthCheck[];
  recipient: string;
  resend_configured: boolean;
};

export const emailPreviewsApi = {
  list: () => req<EmailPreviewList>('GET', '/cms/email-previews'),
  previewToken: () =>
    req<{ token: string; expires_at: string; ttl_seconds: number }>(
      'POST', '/cms/email-previews/preview-token',
    ),
  render: (name: string, body: EmailRenderRequest) =>
    req<EmailRenderResponse>('POST', `/cms/email-previews/${name}/render`, body),
  send: (name: string, body: EmailSendRequest) =>
    req<EmailSendResponse>('POST', `/cms/email-previews/${name}/send`, body),
  sendAll: () => req<{
    ok: boolean;
    sent: number;
    recipient: string;
    reason?: string;
    results: Array<{ name: string; sent: boolean; subject: string }>;
  }>('POST', '/cms/email-previews/send-all'),
  status: (messageId: string) =>
    req<EmailMessageStatus>('GET', `/cms/email-previews/message/${messageId}/status`),
  sendingHealth: () =>
    req<EmailSendingHealth>('GET', '/cms/email-previews/sending-health'),
};


// ─── Campaigns (Phase 2A) ─────────────────────────────────────────
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';

export type CampaignAudienceFilter = {
  statuses?: Array<'registered' | 'invited' | 'joined' | 'opted_out'>;
  tags_any?: string[];
  tags_all?: string[];
  exclude_reserved?: boolean;
  exclude_opted_out?: boolean;
  // CRM Phase 2C \u2014 target a saved segment. When set, the resolver
  // intersects the classic filter above with the segment's member list.
  segment_id?: string;
};

export type CampaignStats = {
  targeted: number;
  accepted: number;
  failed: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  // Iteration 3 (CRM Phase 2B) — Delivery & Engagement rollups.
  complained?: number;
  delayed?: number;
  unique_opens?: number;
  unique_clicks?: number;
  last_event_at?: string;
};

export type Campaign = {
  id: string;
  name: string;
  template: 'announcement' | 'invitation' | 'welcome';
  subject?: string;
  preheader?: string;
  companion?: 'george' | 'georgia';
  title?: string;
  body_md?: string;
  cta_label?: string;
  cta_url?: string;
  audience_filter: CampaignAudienceFilter;
  status: CampaignStatus;
  stats: CampaignStats;
  created_at?: string;
  created_by?: string;
  scheduled_at?: string;
  sent_at?: string;
  finished_at?: string;
  sample_html?: string;
};

export type CampaignRecipient = {
  id: string;
  campaign_id: string;
  founder_id: string;
  founder_number?: number;
  first_name?: string;
  email: string;
  status: 'pending' | 'sent' | 'failed' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained';
  message_id?: string;
  sent_at?: string;
  error?: string;
  subject?: string;
  // Iteration 3 (CRM Phase 2B) — Resend webhook rollup fields.
  delivered_at?: string;
  first_opened_at?: string;
  first_clicked_at?: string;
  bounced_at?: string;
  complained_at?: string;
  delayed_at?: string;
  open_count?: number;
  click_count?: number;
  bounce_type?: string;
  bounce_message?: string;
  last_event_type?: string;
  last_event_at?: string;
};

export type CampaignRecipientEvent = {
  type:
    | 'email.sent'
    | 'email.delivered'
    | 'email.delivery_delayed'
    | 'email.opened'
    | 'email.clicked'
    | 'email.bounced'
    | 'email.complained'
    | string;
  at: string;
  meta?: {
    subject?: string;
    link_url?: string;
    bounce_type?: string;
    bounce_msg?: string;
  };
};

export const campaignsApi = {
  list: () => req<{ count: number; rows: Campaign[] }>('GET', '/cms/campaigns'),
  get:  (id: string) => req<Campaign & { recipients: CampaignRecipient[] }>('GET', `/cms/campaigns/${id}`),
  timeline: (id: string, recipientId: string) =>
    req<{ recipient: CampaignRecipient; events: CampaignRecipientEvent[] }>(
      'GET', `/cms/campaigns/${id}/recipients/${recipientId}/timeline`,
    ),
  create: (body: Partial<Campaign>) => req<Campaign>('POST', '/cms/campaigns', body),
  update: (id: string, patch: Partial<Campaign>) =>
    req<Campaign>('PATCH', `/cms/campaigns/${id}`, patch),
  remove: (id: string) => req<{ ok: boolean }>('DELETE', `/cms/campaigns/${id}`),
  previewAudience: (id: string) =>
    req<{ count: number; sample: Array<{ id: string; first_name?: string; email: string; founder_number?: number; status?: string; tags?: string[] }> }>(
      'POST', `/cms/campaigns/${id}/preview-audience`,
    ),
  renderPreview: (id: string) =>
    req<{ subject: string; html: string; text: string; recipient?: { first_name?: string; email: string; founder_number?: number } | null }>(
      'POST', `/cms/campaigns/${id}/render-preview`,
    ),
  send: (id: string) =>
    req<{ ok: boolean; targeted: number; status: CampaignStatus; message: string }>(
      'POST', `/cms/campaigns/${id}/send`,
    ),
  schedule: (id: string, scheduledAtIso: string) =>
    req<Campaign>('POST', `/cms/campaigns/${id}/schedule`, { scheduled_at: scheduledAtIso }),
  unschedule: (id: string) =>
    req<Campaign>('POST', `/cms/campaigns/${id}/unschedule`),
};

// ---------------------------------------------------------------------------
// Segments — CRM Phase 2C
// ---------------------------------------------------------------------------
// A segment is a saved, named group of members. Predicate-driven so the
// schema doesn't need to change when we add a new filter type.

export type SegmentFilter = {
  id:          string;
  label:       string;
  emoji:       string;
  value_type:  'none' | 'text' | 'number' | 'boolean' | 'enum' | 'multi_enum' | 'days';
  value_hint:  { options?: string[]; options_source?: string; min?: number; max?: number; default?: number };
  description: string;
};

export type SegmentPredicateNode =
  | { op: 'filter'; id: string; value: unknown }
  | { op: 'and' | 'or' | 'nor'; children: SegmentPredicateNode[] }
  | { op: 'not'; child: SegmentPredicateNode };

export type Segment = {
  id:                 string;
  name:               string;
  emoji?:             string | null;
  description?:       string | null;
  predicate:          SegmentPredicateNode | Record<string, never>;
  predicate_summary?: string;
  last_count?:        number;
  last_counted_at?:   string;
  updated_at?:        string;
  created_at?:        string;
  created_by?:        string;
  archived?:          boolean;
  tags?:              string[];
};

export type SegmentPreview = {
  count:   number;
  summary: string;
  sample:  Array<{ id?: string; first_name?: string; username?: string; email?: string; suburb?: string; suburb_state?: string; interests?: string[]; avatar?: string }>;
};

export const segmentsApi = {
  list: () => req<{ items: Segment[]; count: number }>('GET', '/cms/segments'),
  filters: () => req<{ filters: SegmentFilter[] }>('GET', '/cms/segments/filters'),
  get:  (id: string) => req<Segment>('GET', `/cms/segments/${id}`),
  create: (body: Partial<Segment>) => req<Segment>('POST', '/cms/segments', body),
  update: (id: string, patch: Partial<Segment>) =>
    req<Segment>('PATCH', `/cms/segments/${id}`, patch),
  archive: (id: string) => req<{ ok: boolean }>('DELETE', `/cms/segments/${id}`),
  refreshCount: (id: string) => req<Segment>('POST', `/cms/segments/${id}/refresh-count`),
  preview: (predicate: SegmentPredicateNode | Record<string, never>) =>
    req<SegmentPreview>('POST', '/cms/segments/preview', { predicate }),
  // Campaign-drafting assistant \u2014 returns 1-3 saved segments that
  // look like a fit for the given subject/body. Snappy (no LLM).
  suggest: (body: { subject?: string; title?: string; body_md?: string; preheader?: string }) =>
    req<{ suggestions: Array<{ id: string; name: string; emoji?: string | null; count?: number; description?: string | null; confidence: number }> }>(
      'POST', '/cms/segments/suggest', body,
    ),
};

// ---------------------------------------------------------------------------
// Flyer Publishing Centre (Garry, 3 Aug 2026)
// ---------------------------------------------------------------------------
// Data-driven flyer library. Layouts come from the backend registry so the
// UI never hard-codes paper sizes or crop-mark rules — adding "DL flyer" or
// "postcard" later becomes a one-file backend change with zero MC edits.

export type FlyerField = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'time' | 'url' | 'select' | 'hidden';
  required?: boolean;
  help?: string;
  options?: string[];  // for select fields
};

export type FlyerLayout = {
  key: string;
  label: string;
  category: string;
  category_label: string;
  width_mm: number;
  height_mm: number;
  width_px: number;
  height_px: number;
  kind: 'single' | 'multi_up';
  tiles_across: number;
  tiles_down: number;
  tile_count: number;
  tile_size_mm: [number, number] | null;
  crop_marks: boolean;
  order: number;
  description: string;
};

export type FlyerLayoutCategory = {
  key: string;
  label: string;
  description: string;
  layouts: FlyerLayout[];
};

export type FlyerTemplate = {
  key: string;
  id: string;
  name: string;
  description: string;
  category: string;
  engine: string;
  fields: FlyerField[];
  supported_layouts: string[];
  default_layout: string;
  status: 'draft' | 'published' | 'archived';
  used_count: number;
  version: number;
  preview_image?: string | null;
  static_assets?: Record<string, string>;
  george_hint?: string;
  created_at?: string;
  updated_at?: string;
  published_at?: string | null;
  last_used_at?: string;
};

export const flyersApi = {
  listLayouts: () => req<{ categories: FlyerLayoutCategory[] }>('GET', '/cms/flyer-layouts'),
  listFieldLibrary: () => req<{ fields: FlyerField[] }>('GET', '/cms/flyer-fields'),
  list: (opts?: { status?: string; category?: string }) => {
    const q: string[] = [];
    if (opts?.status)   q.push(`status=${encodeURIComponent(opts.status)}`);
    if (opts?.category) q.push(`category=${encodeURIComponent(opts.category)}`);
    const qs = q.length ? `?${q.join('&')}` : '';
    return req<{ templates: FlyerTemplate[] }>('GET', `/cms/flyer-templates${qs}`);
  },
  get: (key: string) => req<FlyerTemplate>('GET', `/cms/flyer-templates/${key}`),
  publish:   (key: string) => req<FlyerTemplate>('POST', `/cms/flyer-templates/${key}/publish`),
  unpublish: (key: string) => req<FlyerTemplate>('POST', `/cms/flyer-templates/${key}/unpublish`),
  archive:   (key: string) => req<FlyerTemplate>('POST', `/cms/flyer-templates/${key}/archive`),
  duplicate: (key: string) => req<FlyerTemplate>('POST', `/cms/flyer-templates/${key}/duplicate`),
  update: (key: string, patch: Partial<FlyerTemplate>) =>
    req<FlyerTemplate>('PATCH', `/cms/flyer-templates/${key}`, patch),
  // Build the render URL — the caller passes it to <iframe> for print
  // or window.open() for download. `fields` is a free-form dict; any
  // key from the backend field library is a valid query param.
  renderUrl: (key: string, opts: { layout: string; fields?: Record<string, string | undefined> }): string => {
    const q = new URLSearchParams({ layout: opts.layout });
    for (const [k, v] of Object.entries(opts.fields || {})) {
      if (v !== undefined && v !== null && String(v).trim() !== '') q.set(k, String(v));
    }
    return `${BASE}/api/cms/flyer-templates/${key}/render?${q.toString()}`;
  },
  // Authenticated blob fetch — same URL as `renderUrl` but pulls the
  // bytes with the admin's Bearer token attached and hands back an
  // object URL suitable for <img src> and <iframe src>. Required
  // because the render endpoint sits behind CMS auth and browser
  // `<img>` requests don't attach the Authorization header. Caller
  // is responsible for `URL.revokeObjectURL(url)` when done —
  // typically in a useEffect cleanup.
  renderBlob: async (
    key: string,
    opts: { layout: string; fields?: Record<string, string | undefined> },
  ): Promise<{ url: string; contentType: string }> => {
    const q = new URLSearchParams({ layout: opts.layout });
    for (const [k, v] of Object.entries(opts.fields || {})) {
      if (v !== undefined && v !== null && String(v).trim() !== '') q.set(k, String(v));
    }
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
      `${BASE}/api/cms/flyer-templates/${key}/render?${q.toString()}`,
      { headers, cache: 'no-store' },
    );
    if (res.status === 401) {
      clearAuth();
      throw new Error('Session expired — please sign in again.');
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || `Render failed (${res.status})`);
    }
    const blob = await res.blob();
    return {
      url: URL.createObjectURL(blob),
      contentType: res.headers.get('Content-Type') || 'application/octet-stream',
    };
  },
};

// ---------------------------------------------------------------------------
// Share a Moment — Mission Control moderation
// ---------------------------------------------------------------------------
// The moments admin UI is intentionally lightweight: list, filter, feature
// Moment of the Week, hide, restore, delete, view reports. Everything else
// (edit caption, edit photos) is deliberately not exposed — moderators only
// remove or promote, never rewrite what a member said.

export type MomentReport = {
  id: string;
  user_id: string;
  user_name: string;
  reason: 'inappropriate' | 'spam' | 'not_respectful' | 'other';
  details?: string;
  created_at: string;
};

export type MomentComment = {
  id: string;
  user_id: string;
  user_name: string;
  user_avatar: string;
  body: string;
  created_at: string;
};

export type MomentRow = {
  id: string;
  caption: string;
  photos: string[];
  privacy: 'everyone' | 'friends';
  author_id: string;
  author_name: string;
  author_avatar: string;
  created_at: string;
  featured: boolean;
  featured_at?: string;
  hidden: boolean;
  hidden_at?: string;
  likes_count: number;
  comments_count: number;
  reports_count: number;
  reports: MomentReport[];
};

export type MomentDetail = MomentRow & { comments: MomentComment[] };

export type MomentsListResponse = {
  count: number;
  total: number;
  reported: number;
  hidden: number;
  featured_id?: string | null;
  rows: MomentRow[];
};

export type MomentAdminAction = 'feature' | 'unfeature' | 'hide' | 'restore' | 'clear_reports';

export const momentsApi = {
  list: (opts: { q?: string; filter?: 'all' | 'featured' | 'hidden' | 'reported'; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.q) p.set('q', opts.q);
    if (opts.filter) p.set('filter', opts.filter);
    if (opts.limit) p.set('limit', String(opts.limit));
    const qs = p.toString();
    return req<MomentsListResponse>('GET', `/cms/moments${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => req<MomentDetail>('GET', `/cms/moments/${id}`),
  action: (id: string, action: MomentAdminAction) =>
    req<{ ok: boolean; action: MomentAdminAction }>('POST', `/cms/moments/${id}/action`, { action }),
  remove: (id: string) => req<{ ok: boolean }>('DELETE', `/cms/moments/${id}`),
};

// CSV export lives on the CRM URL for symmetry — this is a browser
// download so we just build the URL and let the browser fetch it
// with the standard auth header via a hidden fetch + blob dance.
export function csvExportUrl(opts: { status?: string; q?: string } = {}) {
  const p = new URLSearchParams();
  if (opts.status) p.set('status', opts.status);
  if (opts.q) p.set('q', opts.q);
  return `/cms/crm/founding-members.csv?${p.toString()}`;
}

/** Trigger a browser download of the Founding Members CSV using the
 *  admin's bearer token — can't use a plain <a href> because the
 *  endpoint is JWT-gated. Streams to a Blob, then simulates a click. */
export async function downloadFoundingMembersCsv(opts: { status?: string; q?: string } = {}): Promise<void> {
  const token = getToken();
  const res = await fetch(`${BASE}/api${csvExportUrl(opts)}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `CSV export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `founding-members-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
