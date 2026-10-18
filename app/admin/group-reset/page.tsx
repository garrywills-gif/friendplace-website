'use client';
/**
 * Community Groups Reset (iter288) — one-time pre-launch activity reset.
 * Admin-only (MCGS session). Step 1 Preview is read-only. Step 2 runs only
 * after typing GO, with a verified Member Backup from the last hour and a
 * freshly verified group backup. Restore puts a group backup back.
 * Group definitions, accounts, FMNs and Share a Moment are never touched.
 */
import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { getToken, clearAuth } from '@/lib/cms-auth';
import { API_BASE } from '@/lib/api-base';

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

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 18, marginBottom: 16 };
const bad: React.CSSProperties = { ...card, background: '#FEF2F2', borderColor: '#FECACA', color: '#7F1D1D' };
const good: React.CSSProperties = { ...card, background: '#F0FDF4', borderColor: '#BBF7D0', color: '#065F46' };
const btn = (bg: string, disabled: boolean): React.CSSProperties => ({
  padding: '10px 18px', borderRadius: 10, border: 'none', background: bg, color: '#fff', fontWeight: 700,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
});

export default function GroupResetPage() {
  const [p, setP] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [go, setGo] = useState('');
  const [restoreId, setRestoreId] = useState('');
  const [restoreWord, setRestoreWord] = useState('');
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try { setRuns((await call('GET', '/group-reset/runs')).runs || []); } catch { /* non-fatal */ }
  }, []);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  const preview = async () => {
    setBusy(true); setErr(null); setResult(null); setGo('');
    try { setP(await call('POST', '/group-reset/preview')); } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const execute = async () => {
    if (!p || go !== 'GO') return;
    if (!window.confirm(`Reset ${p.groups} groups to 0 members and 0 posts? A verified backup is taken first.`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await call('POST', '/group-reset/execute', { plan_token: p.plan_token, confirm: go });
      setResult(r); setP(null); setGo(''); await loadRuns();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const restore = async () => {
    if (restoreWord !== 'RESTORE' || !restoreId) return;
    setBusy(true); setErr(null); setRestoreMsg(null);
    try {
      const r = await call('POST', '/group-reset/restore', { backup_id: restoreId, confirm: restoreWord });
      setRestoreMsg(`Restored: ${r.restored.groups} groups, ${r.restored.group_posts} posts, ${r.restored.user_groups} member group lists, ${r.restored.notifications} notifications, ${r.restored.founders_table} café table seat lists.`);
      setRestoreWord('');
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const stat = (label: string, v: any) => (
    <div key={label} style={{ background: '#F8FAFC', borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 12, color: '#64748B' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>{v ?? '—'}</div>
    </div>
  );

  return (
    <AdminShell title="Community Groups Reset">
      <p style={{ color: '#475569', marginTop: 0 }}>
        One-time pre-launch cleanup. Every group is kept exactly as it is (name, icon, description, settings, protection)
        and its activity is reset to <b>0 members and 0 posts</b>. Group posts, their comments and reactions, members&apos;
        group lists, group-activity notifications and the Founders Lounge café table seats are removed (the table and
        its messages stay). Member accounts, administrator access, Founding Member
        registrations, FMNs and Share a Moment (including For Mum ❤️🦋) are never touched.
      </p>

      {err && <div data-testid="gr-error" style={bad}>{err}</div>}

      <div style={card}>
        <div style={{ fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>Step 1 — Preview (changes nothing)</div>
        <button data-testid="gr-preview" onClick={preview} disabled={busy} style={btn('#0F766E', busy)}>
          {busy && !p ? 'Checking…' : p ? 'Refresh preview' : 'Preview live counts'}
        </button>
      </div>

      {p && (
        <>
          <div style={card} data-testid="gr-counts">
            <div style={{ fontWeight: 800, color: '#0F172A', marginBottom: 10 }}>What the reset would affect</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 10 }}>
              {stat('Groups kept', p.groups)}
              {stat('Memberships removed', p.memberships)}
              {stat('Posts removed', p.posts)}
              {stat('Comments removed', p.comments)}
              {stat('Reactions removed', p.reactions)}
              {stat('Group notifications removed', p.notifications)}
              {stat('Member group lists cleared', p.users_with_group_lists)}
              {stat('Founders Lounge café seats cleared', p.founders_table_seats)}
              {stat('Memberships of deleted accounts', p.orphaned_memberships)}
              {stat('Posts by deleted accounts', p.orphaned_posts)}
            </div>
          </div>

          <div style={card} data-testid="gr-founders">
            <div style={{ fontWeight: 800, color: '#0F172A', marginBottom: 10 }}>
              Founders Lounge members ({(p.founders_lounge_members || []).length})
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr style={{ textAlign: 'left', color: '#64748B' }}>
                <th style={{ padding: 6 }}>Name</th><th style={{ padding: 6 }}>Username</th>
                <th style={{ padding: 6 }}>Founding status</th><th style={{ padding: 6 }}>Account</th>
              </tr></thead>
              <tbody>
                {(p.founders_lounge_members || []).map((m: any) => (
                  <tr key={m.user_id} style={{ borderTop: '1px solid #E2E8F0' }}>
                    <td style={{ padding: 6 }}>{m.first_name || '—'}</td>
                    <td style={{ padding: 6 }}>{m.username ? `@${m.username}` : '—'}</td>
                    <td style={{ padding: 6 }}>{m.is_founder ? 'Founder ✓' : 'Not a founder'}</td>
                    <td style={{ padding: 6, color: m.orphaned ? '#B91C1C' : '#065F46' }}>
                      {m.orphaned ? `Deleted account (${String(m.user_id).slice(0, 8)}…)` : 'Exists'}
                    </td>
                  </tr>
                ))}
                {!(p.founders_lounge_members || []).length && (
                  <tr><td colSpan={4} style={{ padding: 10, color: '#64748B' }}>No members.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={card} data-testid="gr-per-group">
            <div style={{ fontWeight: 800, color: '#0F172A', marginBottom: 10 }}>Per group (before reset)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr style={{ textAlign: 'left', color: '#64748B' }}>
                <th style={{ padding: 6 }}>Group</th><th style={{ padding: 6 }}>Members</th><th style={{ padding: 6 }}>Posts</th>
              </tr></thead>
              <tbody>
                {(p.per_group || []).map((g: any) => (
                  <tr key={g.id} style={{ borderTop: '1px solid #E2E8F0' }}>
                    <td style={{ padding: 6 }}>{g.name}</td><td style={{ padding: 6 }}>{g.members}</td><td style={{ padding: 6 }}>{g.posts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={p.member_backup_fresh ? card : bad} data-testid="gr-backup">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Safety checks</div>
            <div>
              Member Backup in the last hour: {p.member_backup_fresh
                ? <b style={{ color: '#065F46' }}>Yes ✓ ({fmt(p.latest_member_backup?.finished_at)})</b>
                : <b>No — open <a href="/admin/member-backups">Member Backups</a> and tap Back Up Now, then refresh the preview.</b>}
            </div>
            <div style={{ marginTop: 4 }}>A separate verified backup of all group activity is written and checked automatically before anything is removed. If it fails, nothing is deleted.</div>
          </div>

          <div style={card}>
            <div style={{ fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>Step 2 — Run the reset</div>
            <div style={{ color: '#475569', marginBottom: 10 }}>Type <b>GO</b> to confirm. If anything changed since this preview, the reset refuses and asks you to preview again.</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input data-testid="gr-go" value={go} onChange={(e) => setGo(e.target.value)} placeholder="Type GO"
                style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #CBD5E1', width: 140 }} />
              <button data-testid="gr-execute" onClick={execute} disabled={busy || go !== 'GO' || !p.member_backup_fresh}
                style={btn('#B91C1C', busy || go !== 'GO' || !p.member_backup_fresh)}>
                {busy ? 'Working…' : 'Reset all group activity'}
              </button>
            </div>
          </div>
        </>
      )}

      {result && (
        <div style={result.protected_unchanged ? good : bad} data-testid="gr-result">
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Reset complete</div>
          <div>{result.groups_reset} groups reset · {result.posts_deleted} posts removed · {result.user_group_lists_cleared} member group lists cleared · {result.notifications_deleted} notifications removed · {result.founders_table_seats_cleared} Founders Lounge café seats cleared</div>
          <div>Remaining: {result.memberships_remaining} memberships, {result.posts_remaining} posts</div>
          <div>Accounts, FMNs, group definitions and Share a Moment: {result.protected_unchanged ? 'unchanged ✓' : `CHANGED: ${result.protected_changed.join(', ')}`}</div>
          <div>Group backup ID (keep for restore): <b>{result.group_backup_id}</b></div>
        </div>
      )}

      <div style={card}>
        <div style={{ fontWeight: 800, color: '#0F172A', marginBottom: 10 }}>Reset history &amp; restore</div>
        {runs.length ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 12 }}>
            <thead><tr style={{ textAlign: 'left', color: '#64748B' }}>
              <th style={{ padding: 6 }}>When</th><th style={{ padding: 6 }}>By</th><th style={{ padding: 6 }}>Posts</th>
              <th style={{ padding: 6 }}>Memberships</th><th style={{ padding: 6 }}>Backup ID</th>
            </tr></thead>
            <tbody>
              {runs.map((r: any) => (
                <tr key={r.group_backup_id} style={{ borderTop: '1px solid #E2E8F0' }}>
                  <td style={{ padding: 6 }}>{fmt(r.at)}</td><td style={{ padding: 6 }}>{r.by}</td>
                  <td style={{ padding: 6 }}>{r.posts_deleted}</td><td style={{ padding: 6 }}>{r.counts_before?.memberships}</td>
                  <td style={{ padding: 6 }}><code>{r.group_backup_id}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div style={{ color: '#64748B', marginBottom: 12 }}>No resets have been run.</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input data-testid="gr-restore-id" value={restoreId} onChange={(e) => setRestoreId(e.target.value.trim())} placeholder="Backup ID"
            style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #CBD5E1', width: 200 }} />
          <input data-testid="gr-restore-word" value={restoreWord} onChange={(e) => setRestoreWord(e.target.value)} placeholder="Type RESTORE"
            style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #CBD5E1', width: 160 }} />
          <button data-testid="gr-restore" onClick={restore} disabled={busy || restoreWord !== 'RESTORE' || !restoreId}
            style={btn('#334155', busy || restoreWord !== 'RESTORE' || !restoreId)}>Restore backup</button>
        </div>
        {restoreMsg && <div style={{ ...good, marginTop: 12, marginBottom: 0 }}>{restoreMsg}</div>}
      </div>
    </AdminShell>
  );
}
