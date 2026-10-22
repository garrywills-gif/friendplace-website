'use client';

/**
 * Home Announcements — Phase 1 MCGS management.
 * Drafts, edit, publish now / schedule, move back to draft, remove,
 * audience (all / Founding Members / one Community Group), per-member read
 * tracking and read counts. Members see nothing until "Show announcements
 * to members" is switched ON (after the Phase 2 app update is released).
 */
import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { getToken, clearAuth } from '@/lib/cms-auth';
import { API_BASE } from '@/lib/api-base';

type Audience = { type: 'all' | 'founders' | 'group'; group_id?: string; group_name?: string };
type Ann = {
  id: string; title: string; body_md: string; audience: Audience; status: string; effective_status: string;
  publish_at?: string | null; created_at: string; updated_at: string; created_by?: string; updated_by?: string;
  read_count: number; audience_size: number;
};
type Group = { id: string; name: string; emoji?: string };

async function call(method: string, path: string, body?: any) {
  const headers: Record<string, string> = {};
  if (body != null) headers['Content-Type'] = 'application/json';
  const t = getToken();
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(`${API_BASE}/api/cms${path}`, {
    method, headers, body: body != null ? JSON.stringify(body) : undefined, cache: 'no-store',
  });
  if (res.status === 401) clearAuth();
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json?.detail === 'string' ? json.detail : `Request failed (${res.status})`);
  return json;
}

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: '#F1F5F9', fg: '#475569' },
  scheduled: { label: 'Scheduled', bg: '#FEF3C7', fg: '#92400E' },
  live: { label: 'Live', bg: '#DCFCE7', fg: '#166534' },
  removed: { label: 'Removed', bg: '#FEE2E2', fg: '#991B1B' },
};
const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 18, marginBottom: 16 };
const input: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1.5px solid #CBD5E1', borderRadius: 10, fontSize: 14, boxSizing: 'border-box', background: '#fff' };
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 800, color: '#334155', margin: '12px 0 4px' };
const btn = (bg: string, disabled = false, outline = false): React.CSSProperties => ({
  padding: '8px 14px', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1, border: outline ? `1.5px solid ${bg}` : 'none', background: outline ? '#fff' : bg, color: outline ? bg : '#fff',
});
const empty = { id: '', title: '', body_md: '', audience: { type: 'all' } as Audience };
export default function AnnouncementsPage() {
  const [rows, setRows] = useState<Ann[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<typeof empty | null>(null);
  const [when, setWhen] = useState<Record<string, string>>({});
  const [readers, setReaders] = useState<Record<string, any[]>>({});

  const load = useCallback(async () => {
    try {
      const r = await call('GET', '/announcements');
      setRows(r.announcements); setGroups(r.groups || []); setEnabled(!!r.members_enabled); setErr(null);
    } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setErr(null); setToast(null);
    try { await fn(); setToast(ok); await load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const save = () => edit && run(async () => {
    const body = { title: edit.title, body_md: edit.body_md, audience: edit.audience };
    if (edit.id) await call('PATCH', `/announcements/${edit.id}`, body); else await call('POST', '/announcements', body);
    setEdit(null);
  }, edit.id ? 'Announcement updated.' : 'Draft saved.');

  const publish = (a: Ann) => {
    const local = when[a.id];
    const iso = local ? new Date(local).toISOString() : null;
    const msg = iso
      ? `Schedule "${a.title}" for ${fmt(iso)}?`
      : `Publish "${a.title}" now?`;
    if (!window.confirm(`${msg}\n\nAudience: ${audienceText(a.audience)} (${a.audience_size} members)` +
      (enabled ? '' : '\n\nMembers won\'t see it until "Show announcements to members" is switched on.'))) return;
    void run(() => call('POST', `/announcements/${a.id}/publish`, iso ? { publish_at: iso } : {}), iso ? 'Scheduled.' : 'Published.');
  };

  const toggleEnabled = () => {
    const next = !enabled;
    const msg = next
      ? 'Show announcements to members?\n\nOnly switch this on once the updated FriendPlace app (with the Home announcement card) is live in the App Store and Google Play.'
      : 'Hide announcements from members? Nothing is deleted — read records are kept.';
    if (!window.confirm(msg)) return;
    void run(() => call('PUT', '/announcements-settings', { members_enabled: next }), next ? 'Announcements are now visible to members.' : 'Announcements hidden from members.');
  };

  const audienceText = (au: Audience) => au.type === 'founders' ? 'Founding Members'
    : au.type === 'group' ? `Group: ${au.group_name || 'unknown'}` : 'All members';

  const loadReaders = async (id: string) => {
    if (readers[id]) { setReaders(({ [id]: _drop, ...rest }) => rest); return; }
    try { const r = await call('GET', `/announcements/${id}/reads`); setReaders((c) => ({ ...c, [id]: r.reads })); }
    catch (e: any) { setErr(e.message); }
  };

  return (
    <AdminShell title="Announcements">
      <div style={{ ...card, background: enabled ? '#F0FDF4' : '#FFFBEB', borderColor: enabled ? '#BBF7D0' : '#FDE68A' }} data-testid="ann-switch">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontWeight: 900, color: '#0F172A' }}>
              Show announcements to members: {enabled ? 'ON' : 'OFF'}
            </div>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
              {enabled
                ? 'Live announcements appear on members\u2019 Home screen (in app versions that include the announcement card).'
                : 'Members see nothing yet. You can prepare, schedule and publish announcements safely. Switch on after the updated app is released.'}
            </div>
          </div>
          <button data-testid="ann-toggle" style={btn(enabled ? '#B91C1C' : '#0F766E', busy, true)} disabled={busy} onClick={toggleEnabled}>
            {enabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </div>

      {err && <div style={{ ...card, background: '#FEF2F2', borderColor: '#FECACA', color: '#7F1D1D' }}>{err}</div>}
      {toast && <div style={{ ...card, background: '#F0FDF4', borderColor: '#BBF7D0', color: '#065F46' }}>{toast}</div>}

      {edit ? (
        <div style={card} data-testid="ann-editor">
          <div style={{ fontWeight: 900, color: '#0F172A' }}>{edit.id ? 'Edit announcement' : 'New announcement'}</div>
          <label style={label}>Title</label>
          <input data-testid="ann-title" style={input} maxLength={140} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <label style={label}>Message</label>
          <textarea data-testid="ann-body" style={{ ...input, minHeight: 160, fontFamily: 'inherit' }} maxLength={8000}
            value={edit.body_md} onChange={(e) => setEdit({ ...edit, body_md: e.target.value })} />
          <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>Keep it short and friendly. **bold**, *italic*, links and “- ” bullet lists are supported.</div>
          <label style={label}>Audience</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select data-testid="ann-audience" style={{ ...input, width: 240 }} value={edit.audience.type}
              onChange={(e) => setEdit({ ...edit, audience: { type: e.target.value as Audience['type'], group_id: e.target.value === 'group' ? groups[0]?.id : undefined } })}>
              <option value="all">All members</option>
              <option value="founders">Founding Members</option>
              <option value="group">A Community Group…</option>
            </select>
            {edit.audience.type === 'group' && (
              <select data-testid="ann-group" style={{ ...input, width: 260 }} value={edit.audience.group_id || ''}
                onChange={(e) => setEdit({ ...edit, audience: { type: 'group', group_id: e.target.value } })}>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.emoji ? `${g.emoji} ` : ''}{g.name}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button data-testid="ann-save" style={btn('#0F766E', busy || !edit.title.trim() || !edit.body_md.trim())}
              disabled={busy || !edit.title.trim() || !edit.body_md.trim()} onClick={() => void save()}>
              {edit.id ? 'Save changes' : 'Save draft'}
            </button>
            <button style={btn('#475569', busy, true)} onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <button data-testid="ann-new" style={btn('#0F766E')} onClick={() => setEdit({ ...empty, audience: { type: 'all' } })}>+ New announcement</button>
        </div>
      )}

      {!rows ? <div style={card}>Loading…</div> : rows.length === 0 ? (
        <div style={card}>No announcements yet.</div>
      ) : rows.map((a) => {
        const st = STATUS[a.effective_status] || STATUS.draft;
        const removed = a.effective_status === 'removed';
        return (
          <div key={a.id} style={card} data-testid={`ann-row-${a.id}`}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 900, padding: '2px 8px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span>
              <span style={{ fontWeight: 900, color: '#0F172A', fontSize: 15 }}>{a.title}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748B' }}>
                {a.effective_status === 'scheduled' ? `Goes live ${fmt(a.publish_at)}` : a.effective_status === 'live' ? `Live since ${fmt(a.publish_at)}` : `Updated ${fmt(a.updated_at)}`}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#334155', whiteSpace: 'pre-wrap', margin: '8px 0' }}>{a.body_md}</div>
            <div style={{ fontSize: 12, color: '#64748B' }}>
              Audience: <b>{audienceText(a.audience)}</b> ({a.audience_size} members) · Read by <b>{a.read_count}</b>
              {a.audience_size ? ` (${Math.round((a.read_count / a.audience_size) * 100)}%)` : ''} · by {a.updated_by || a.created_by || '—'}
            </div>
            {!removed && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
                <button style={btn('#0F766E', busy, true)} disabled={busy} onClick={() => setEdit({ id: a.id, title: a.title, body_md: a.body_md, audience: { type: a.audience.type, group_id: a.audience.group_id } })}>Edit</button>
                {a.effective_status === 'draft' && (
                  <>
                    <input type="datetime-local" style={{ ...input, width: 210 }} value={when[a.id] || ''}
                      onChange={(e) => setWhen((c) => ({ ...c, [a.id]: e.target.value }))} title="Leave empty to publish now" />
                    <button data-testid={`ann-publish-${a.id}`} style={btn('#0F766E', busy)} disabled={busy} onClick={() => publish(a)}>
                      {when[a.id] ? 'Schedule' : 'Publish now'}
                    </button>
                  </>
                )}
                {(a.effective_status === 'scheduled' || a.effective_status === 'live') && (
                  <button style={btn('#92400E', busy, true)} disabled={busy}
                    onClick={() => window.confirm('Move back to draft? It stops showing to members; read records are kept.') &&
                      void run(() => call('POST', `/announcements/${a.id}/unpublish`), 'Moved back to draft.')}>Move to draft</button>
                )}
                <button style={btn('#B91C1C', busy, true)} disabled={busy}
                  onClick={() => window.confirm(`Remove "${a.title}"?\n\nIt will no longer show to any member. The record and read history are kept.`) &&
                    void run(() => call('POST', `/announcements/${a.id}/remove`), 'Announcement removed.')}>Remove</button>
                <button style={btn('#334155', false, true)} onClick={() => void loadReaders(a.id)}>{readers[a.id] ? 'Hide readers' : 'Who has read it'}</button>
              </div>
            )}
            {readers[a.id] && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: '#334155' }}>
                {readers[a.id].length === 0 ? 'Nobody has read it yet.' : readers[a.id].map((r) => (
                  <div key={r.user_id}>{r.first_name || r.username || r.user_id} {r.username ? `(@${r.username})` : ''} — {fmt(r.read_at)}</div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </AdminShell>
  );
}
