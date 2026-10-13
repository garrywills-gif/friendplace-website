'use client';
import { useCallback, useEffect, useState } from 'react';
import { pendingGroupsApi, type PendingGroupRow } from '@/lib/cms-api';
import { AdminShell } from '@/components/admin/AdminShell';

export default function PendingGroupsPage() {
  const [items, setItems] = useState<PendingGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejectFor, setRejectFor] = useState<PendingGroupRow | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try { const data = await pendingGroupsApi.list(); setItems(data.items || []); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Unable to load suggestions'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const approve = async (g: PendingGroupRow) => {
    if (!window.confirm(`Approve "${g.name}" and make it a live Community Group?`)) return;
    setBusy(true);
    try { await pendingGroupsApi.approve(g.id); setMessage(`Approved: ${g.name}. Member notified.`); await load(); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Approval failed'); }
    finally { setBusy(false); }
  };
  const reject = async () => {
    if (!rejectFor) return;
    setBusy(true);
    try {
      await pendingGroupsApi.reject(rejectFor.id, reason.trim() || undefined);
      setMessage(`Rejected: ${rejectFor.name}. Member notified.`);
      setRejectFor(null); setReason(''); await load();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Rejection failed'); }
    finally { setBusy(false); }
  };
  return (
    <AdminShell title="Pending groups">
      <p style={{color:'#475569'}}>Community Group suggestions waiting for review ({items.length}).</p>
      {message && <p role="status" style={{padding:12,background:'#F0FDFA',borderRadius:8}}>{message}</p>}
      {loading ? <p>Loading suggestions…</p> : items.length === 0 ?
        <div data-testid="pending-groups-empty" style={{padding:32,borderRadius:14,background:'#F8FAFC',textAlign:'center'}}>
          <h3>No group suggestions waiting.</h3><p>New suggestions from members will appear here.</p>
        </div> :
        <div style={{display:'grid',gap:14}}>
          {items.map(g => <article key={g.id} data-testid={`pending-group-${g.id}`} style={{padding:20,border:'1px solid #E2E8F0',borderRadius:14,background:'#FFF'}}>
            <h3 style={{color:'#0A2540',marginTop:0}}>{g.emoji || '🌟'} {g.name}</h3>
            <p style={{fontSize:13,color:'#475569'}}>
              Suggested by <strong>{g.member.name || g.member.username || 'Member'}</strong>
              {g.member.username ? ` (@${g.member.username})` : ''}
              {g.member.email ? ` · ${g.member.email}` : ''}
              {!g.member.exists ? ' · account no longer exists' : ''}
              {g.suggested_at ? ` · ${new Date(g.suggested_at).toLocaleString('en-AU')}` : ''}
              {g.locality ? ` · ${g.locality}` : ''}
            </p>
            {g.description && <p>{g.description}</p>}
            {g.reason && <p style={{background:'#F0FDFA',padding:12,borderRadius:8}}><strong>Why they suggested it: </strong>{g.reason}</p>}
            <div style={{display:'flex',gap:10}}>
              <button data-testid={`pending-group-approve-${g.id}`} disabled={busy} onClick={() => approve(g)}
                style={{background:'#0A2540',color:'white',border:0,padding:'10px 18px',borderRadius:10}}>Approve</button>
              <button data-testid={`pending-group-reject-${g.id}`} disabled={busy} onClick={() => {setRejectFor(g);setReason('');}}
                style={{background:'#FEF2F2',color:'#991B1B',border:'1px solid #FCA5A5',padding:'10px 18px',borderRadius:10}}>Reject</button>
            </div>
          </article>)}
        </div>
      }
      {rejectFor && <div role="dialog" aria-modal="true" aria-label="Reject group suggestion"
        style={{position:'fixed',inset:0,background:'rgba(15,23,42,.55)',display:'flex',alignItems:'center',justifyContent:'center',padding:20,zIndex:100}}>
        <div style={{width:'100%',maxWidth:520,background:'white',borderRadius:16,padding:24}}>
          <h2>Reject {rejectFor.name}?</h2>
          <label htmlFor="group-rejection-reason">Reason (sent to member and recorded in the activity log)</label>
          <textarea id="group-rejection-reason" data-testid="pending-group-reject-reason" rows={4} maxLength={500}
            value={reason} onChange={e => setReason(e.target.value)} style={{width:'100%',boxSizing:'border-box',padding:12,marginTop:8}} />
          <div style={{display:'flex',gap:10,marginTop:16}}>
            <button disabled={busy} onClick={() => setRejectFor(null)}>Cancel</button>
            <button disabled={busy} data-testid="pending-group-reject-confirm" onClick={reject}
              style={{background:'#991B1B',color:'white',border:0,borderRadius:8,padding:'10px 16px'}}>Reject and notify</button>
          </div>
        </div>
      </div>}
    </AdminShell>
  );
}
