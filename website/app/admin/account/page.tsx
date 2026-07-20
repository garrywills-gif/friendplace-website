'use client';

/**
 * Mission Control — Account & Admins.
 *
 * A single page combining:
 *   1. "Your account" — read-only email/display name + change-password form.
 *   2. "Admins" — list every CMS admin, add another via an invite link,
 *      and remove peers (with guardrails: you can't delete yourself or
 *      the last remaining admin).
 *
 * All admins are equal (no roles) — locked with Garry on 20 July 2026.
 */

import { useEffect, useMemo, useState } from 'react';
import { AdminShell, adminStyles as a } from '@/components/admin/AdminShell';
import { cmsApi } from '@/lib/cms-api';
import { getAdmin, setToken, type CmsAdmin } from '@/lib/cms-auth';

type AdminRow = {
  id: string;
  email: string;
  display_name?: string;
  created_at?: string;
  last_login_at?: string | null;
};

export default function AccountPage() {
  return (
    <AdminShell title="Account & Admins">
      <YourAccountSection />
      <div style={{ height: 12 }} />
      <AdminsSection />
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// Your account — read-only identity + change-password form
// ---------------------------------------------------------------------------

function YourAccountSection() {
  const me = getAdmin();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const validationError = useMemo(() => {
    if (!current || !next || !confirm) return null;
    if (next.length < 8) return 'New password must be at least 8 characters.';
    if (next !== confirm) return 'New password and confirmation don\u2019t match.';
    if (next === current) return 'New password must be different from your current one.';
    return null;
  }, [current, next, confirm]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError) { setToast({ kind: 'err', msg: validationError }); return; }
    if (!current || !next || !confirm) { setToast({ kind: 'err', msg: 'Please fill in every field.' }); return; }
    setBusy(true);
    try {
      const res = await cmsApi.changePassword(current, next);
      // Silent token rotation keeps the admin signed in.
      setToken(res.token);
      setCurrent(''); setNext(''); setConfirm('');
      setToast({ kind: 'ok', msg: 'Password updated. You\u2019re still signed in.' });
    } catch (err: any) {
      setToast({ kind: 'err', msg: err?.message || 'Could not update password.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={a.card}>
      <h2 style={a.cardTitle}>Your account</h2>

      <div style={identityRow}>
        <IdentityField label="Email" value={me?.email || '\u2014'} />
        <IdentityField label="Display name" value={me?.display_name || 'Admin'} />
      </div>

      <div style={{ height: 24, borderTop: '1px solid #E2E8F0', margin: '20px 0' }} />

      <h3 style={sectionSubtitle}>Change password</h3>
      <p style={a.helper}>Passwords are at least 8 characters. Your session stays active after you change it.</p>

      <form onSubmit={submit} style={{ marginTop: 12 }}>
        <label style={a.label}>Current password</label>
        <input
          className="cms-input"
          style={a.input}
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={e => setCurrent(e.target.value)}
          required
        />

        <div style={{ height: 14 }} />
        <label style={a.label}>New password</label>
        <input
          className="cms-input"
          style={a.input}
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={e => setNext(e.target.value)}
          minLength={8}
          required
        />

        <div style={{ height: 14 }} />
        <label style={a.label}>Confirm new password</label>
        <input
          className="cms-input"
          style={a.input}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          minLength={8}
          required
        />

        {validationError && (
          <div style={inlineError}>{validationError}</div>
        )}

        <div style={{ height: 20 }} />
        <button
          type="submit"
          className="cms-btn-primary"
          style={{ ...a.primaryBtn, opacity: busy ? 0.65 : 1 }}
          disabled={busy}
        >
          {busy ? 'Updating\u2026' : 'Update password'}
        </button>
      </form>

      {toast && <FloatingToast kind={toast.kind} msg={toast.msg} />}
    </section>
  );
}

function IdentityField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', color: '#64748B', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#0A2540', marginTop: 4, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admins — list + invite + delete
// ---------------------------------------------------------------------------

function AdminsSection() {
  const me = getAdmin();
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState<{
    email: string;
    display_name: string;
    invite_url: string;
    expires_in_minutes: number;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await cmsApi.listAdmins();
      setRows(res.items);
    } catch (err: any) {
      setToast({ kind: 'err', msg: err?.message || 'Could not load admins.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const removeAdmin = async (row: AdminRow) => {
    if (!confirm(`Remove ${row.email} as an admin? They\u2019ll lose access to Mission Control immediately.`)) return;
    try {
      await cmsApi.deleteAdmin(row.id);
      setToast({ kind: 'ok', msg: `${row.email} has been removed.` });
      load();
    } catch (err: any) {
      setToast({ kind: 'err', msg: err?.message || 'Could not remove admin.' });
    }
  };

  const isSelf = (row: AdminRow) => row.id === me?.id;

  return (
    <section style={a.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 style={{ ...a.cardTitle, margin: 0 }}>Admins</h2>
        <button
          type="button"
          className="cms-btn-primary"
          style={a.primaryBtn}
          onClick={() => setInviteOpen(true)}
        >
          + Add admin
        </button>
      </div>
      <p style={a.helper}>Everyone here has equal access to Mission Control. Removing an admin is instant.</p>

      <div style={{ marginTop: 16, borderTop: '1px solid #E2E8F0' }}>
        {loading && <div style={{ padding: '20px 0', color: '#64748B' }}>Loading admins\u2026</div>}
        {!loading && rows && rows.length === 0 && (
          <div style={{ padding: '20px 0', color: '#64748B' }}>No admins yet.</div>
        )}
        {!loading && rows && rows.map(row => (
          <div key={row.id} style={adminRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#0A2540' }}>{row.display_name || 'Admin'}</span>
                {isSelf(row) && (
                  <span style={youBadge}>You</span>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#64748B', marginTop: 2, wordBreak: 'break-all' }}>{row.email}</div>
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
                {row.last_login_at
                  ? `Last signed in ${formatRelative(row.last_login_at)}`
                  : 'Hasn\u2019t signed in yet'}
                {row.created_at ? ` \u00b7 Added ${formatRelative(row.created_at)}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeAdmin(row)}
              disabled={isSelf(row) || (rows.length <= 1)}
              className="cms-danger-btn"
              style={{
                ...a.dangerBtn,
                opacity: (isSelf(row) || rows.length <= 1) ? 0.4 : 1,
                cursor: (isSelf(row) || rows.length <= 1) ? 'not-allowed' : 'pointer',
              }}
              title={isSelf(row) ? 'You can\u2019t remove yourself' : (rows.length <= 1 ? 'At least one admin must remain' : 'Remove admin')}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onCreated={(payload) => {
            setInvite(payload);
            setInviteOpen(false);
            setToast({ kind: 'ok', msg: `Invitation created for ${payload.email}.` });
            load();
          }}
        />
      )}

      {invite && (
        <InviteResultModal
          invite={invite}
          onClose={() => setInvite(null)}
        />
      )}

      {toast && <FloatingToast kind={toast.kind} msg={toast.msg} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Invite modal — collect email + display name
// ---------------------------------------------------------------------------

function InviteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: { email: string; display_name: string; invite_url: string; expires_in_minutes: number }) => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await cmsApi.createAdmin({
        email: email.trim(),
        display_name: displayName.trim() || undefined,
      });
      onCreated({
        email: res.admin.email,
        display_name: res.admin.display_name || 'Admin',
        invite_url: res.invite_url,
        expires_in_minutes: res.expires_in_minutes,
      });
    } catch (e: any) {
      setErr(e?.message || 'Could not create admin.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: 0, fontSize: 20, color: '#0A2540', fontWeight: 900 }}>Add admin</h3>
        <p style={{ ...a.helper, marginTop: 6 }}>
          We\u2019ll create their account and generate a one-time link so they can set their own password.
        </p>

        <form onSubmit={submit} style={{ marginTop: 18 }}>
          <label style={a.label}>Email</label>
          <input
            className="cms-input"
            style={a.input}
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
          />

          <div style={{ height: 14 }} />
          <label style={a.label}>Display name <span style={{ color: '#94A3B8', fontWeight: 500 }}>(optional)</span></label>
          <input
            className="cms-input"
            style={a.input}
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
          />

          {err && <div style={inlineError}>{err}</div>}

          <div style={{ height: 20 }} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={a.ghostBtn} disabled={busy}>Cancel</button>
            <button type="submit" className="cms-btn-primary" style={{ ...a.primaryBtn, opacity: busy ? 0.65 : 1 }} disabled={busy}>
              {busy ? 'Creating\u2026' : 'Create & get invite link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite result — surface the invite URL for copy-paste
// ---------------------------------------------------------------------------

function InviteResultModal({
  invite,
  onClose,
}: {
  invite: { email: string; display_name: string; invite_url: string; expires_in_minutes: number };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Rewrite the invite host to the current origin when possible, so
  // preview + prod environments both hand out a working link even if
  // CMS_FRONTEND_URL points elsewhere. Falls back to the raw URL.
  const displayUrl = useMemo(() => {
    if (typeof window === 'undefined') return invite.invite_url;
    try {
      const parsed = new URL(invite.invite_url);
      return `${window.location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return invite.invite_url;
    }
  }, [invite.invite_url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // no-op; user can select manually
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={{ ...modalCard, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: 0, fontSize: 20, color: '#0A2540', fontWeight: 900 }}>
          Invite created \u2728
        </h3>
        <p style={{ ...a.helper, marginTop: 6, fontSize: 14 }}>
          Send this link to <strong style={{ color: '#0A2540' }}>{invite.email}</strong>. They\u2019ll set
          their own password and be signed straight in. The link expires in {invite.expires_in_minutes} minutes.
        </p>

        <div style={{
          marginTop: 16, padding: 14, borderRadius: 12, background: '#F8FAFC',
          border: '1px solid #E2E8F0', wordBreak: 'break-all', fontSize: 13,
          color: '#0A2540', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}>
          {displayUrl}
        </div>

        <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={a.ghostBtn}>Close</button>
          <button
            type="button"
            className="cms-btn-primary"
            style={a.primaryBtn}
            onClick={copy}
          >
            {copied ? 'Copied \u2713' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function FloatingToast({ kind, msg }: { kind: 'ok' | 'err'; msg: string }) {
  return (
    <div
      role="status"
      style={{
        ...a.toast,
        background: kind === 'ok' ? '#0F766E' : '#B91C1C',
      }}
    >
      {msg}
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(days / 365);
    return `${years}y ago`;
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const identityRow: React.CSSProperties = {
  display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 4,
};

const sectionSubtitle: React.CSSProperties = {
  fontSize: 16, fontWeight: 800, color: '#0A2540', margin: 0, marginBottom: 4,
};

const inlineError: React.CSSProperties = {
  marginTop: 14, padding: '10px 14px', borderRadius: 10,
  background: '#FEF2F2', color: '#B91C1C', fontSize: 13, fontWeight: 700,
  border: '1px solid #FCA5A5',
};

const adminRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 16,
  padding: '16px 0', borderBottom: '1px solid #F1F5F9',
};

const youBadge: React.CSSProperties = {
  fontSize: 10, fontWeight: 900, letterSpacing: '0.08em',
  color: '#FFFFFF', background: '#0F766E',
  padding: '2px 8px', borderRadius: 999,
};

const modalBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(10,37,64,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24, zIndex: 500,
};

const modalCard: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: 20, padding: 28,
  maxWidth: 480, width: '100%',
  boxShadow: '0 24px 60px rgba(10,37,64,0.35)',
};
