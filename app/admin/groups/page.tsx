'use client';
import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { allGroupsApi, type AllGroupRow } from '@/lib/cms-api';

export default function AllGroupsPage() {
  const [rows, setRows] = useState<AllGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await allGroupsApi.list()).rows || []); }
    catch (e: any) { flash(e?.message || 'Failed to load groups'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const protect = async (g: AllGroupRow, val: boolean) => {
    setBusyId(g.id);
    try { await allGroupsApi.protect(g.id, val); setRows(rs => rs.map(r => r.id === g.id ? { ...r, is_protected: val } : r)); }
    catch (e: any) { flash(e?.message || 'Update failed'); }
    finally { setBusyId(null); }
  };
  const remove = async (g: AllGroupRow) => {
    const typed = window.prompt(`Delete the group "${g.name}" permanently?\n\nThis removes the group, its ${g.post_count} post(s) and its member list (${g.member_count} member(s)). It cannot be undone.\n\nType the group name exactly to confirm:`);
    if (typed === null) return;
    if (typed.trim() !== g.name.trim()) { flash('Name did not match — nothing deleted.'); return; }
    setBusyId(g.id);
    try { await allGroupsApi.remove(g.id, typed.trim()); flash(`Deleted "${g.name}".`); await load(); }
    catch (e: any) { flash(e?.message || 'Delete failed'); }
    finally { setBusyId(null); }
  };
  const shown = rows.filter(r => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <AdminShell title="All groups">
      <p style={{ marginTop: 0, color: '#475569', fontSize: 14 }}>Every Community Group ({rows.length}). Tick <b>Protected</b> for official / permanent groups — protected groups can&apos;t be deleted.</p>
      <input data-testid="groups-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search groups…" style={{ width: '100%', maxWidth: 360, padding: '10px 12px', borderRadius: 10, border: '1px solid #CBD5E1', fontSize: 14, marginBottom: 14 }} />
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>Loading…</div> : (
        <div style={{ background: '#FFF', border: '1px solid #E2E8F0', borderRadius: 16, overflow: 'hidden' }}>
          {shown.map((g, i) => (
            <div key={g.id} data-testid={`group-row-${g.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? '1px solid #F1F5F9' : 'none', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#0A2540' }}>
                  {g.emoji || '👥'} {g.name}
                  {g.pending && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, color: '#92400E', background: '#FEF3C7', padding: '2px 8px', borderRadius: 999 }}>PENDING</span>}
                  {g.is_protected && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, color: '#065F46', background: '#D1FAE5', padding: '2px 8px', borderRadius: 999 }}>PROTECTED</span>}
                </div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{g.member_count} member{g.member_count === 1 ? '' : 's'} · {g.post_count} post{g.post_count === 1 ? '' : 's'}{g.suggested_by_username ? ` · suggested by @${g.suggested_by_username}` : ''}</div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
                <input data-testid={`group-protect-${g.id}`} type="checkbox" checked={g.is_protected} disabled={busyId === g.id} onChange={e => protect(g, e.target.checked)} /> Protected
              </label>
              <button data-testid={`group-delete-${g.id}`} onClick={() => remove(g)} disabled={g.is_protected || busyId === g.id}
                title={g.is_protected ? 'Protected groups cannot be deleted' : 'Delete this group'}
                style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #FCA5A5', background: g.is_protected ? '#F8FAFC' : '#FEF2F2', color: g.is_protected ? '#94A3B8' : '#991B1B', fontWeight: 800, fontSize: 13, cursor: g.is_protected ? 'default' : 'pointer' }}>Delete</button>
            </div>
          ))}
          {shown.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#64748B' }}>No groups found.</div>}
        </div>
      )}
      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#0A2540', color: '#FFF', padding: '12px 18px', borderRadius: 12, fontWeight: 700, fontSize: 14, zIndex: 200 }}>{toast}</div>}
    </AdminShell>
  );
}
