'use client';

/**
 * Moderation (Oct 2026) — unified MCGS view over the central report store.
 * Filters: New · Reviewing · Urgent · Resolved · Dismissed. Detail shows the
 * reporter, reported member, reason, notes (evidence), the reported content,
 * the member's other reports and moderation history. Actions reuse the
 * existing MCGS member actions (warn / suspend / ban / restore) and the
 * shared content-removal logic; every action is logged and resolving the
 * last open report closes the linked Bridge complaint automatically.
 * Enquiries keeps reading the same records ("Replied" there = Resolved here).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
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
  if (!res.ok) throw new Error(typeof json?.detail === 'string' ? json.detail : json?.detail?.message || `Request failed (${res.status})`);
  return json;
}

const TABS = [
  { key: 'new', label: 'New' }, { key: 'reviewing', label: 'Reviewing' }, { key: 'urgent', label: 'Urgent' },
  { key: 'resolved', label: 'Resolved' }, { key: 'dismissed', label: 'Dismissed' },
];
const BADGE: Record<string, { bg: string; fg: string }> = {
  new: { bg: '#DBEAFE', fg: '#1E40AF' }, reviewing: { bg: '#FEF3C7', fg: '#92400E' },
  resolved: { bg: '#DCFCE7', fg: '#166534' }, dismissed: { bg: '#F1F5F9', fg: '#475569' },
};
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const who = (u?: any) => (u ? `${u.first_name || u.username || 'Member'}${u.username ? ` (@${u.username})` : ''}` : 'Unknown');
const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 16, marginBottom: 12 };
const btn = (c: string, outline = true, disabled = false): React.CSSProperties => ({
  padding: '7px 12px', borderRadius: 10, fontWeight: 800, fontSize: 12.5, cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1, border: `1.5px solid ${c}`, background: outline ? '#fff' : c, color: outline ? c : '#fff',
});
const h4: React.CSSProperties = { fontSize: 12, fontWeight: 900, color: '#0A2540', margin: '14px 0 6px', textTransform: 'uppercase', letterSpacing: 0.4 };

export default function ModerationPage() {
  const [tab, setTab] = useState('new');
  const [rows, setRows] = useState<any[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    try { const d = await call('GET', `/moderation/reports?status=${tab}`); setRows(d.reports); setCounts(d.counts || {}); }
    catch (e: any) { setMsg(e.message); }
  }, [tab]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  const openReport = async (id: string) => {
    if (open === id) { setOpen(null); setDetail(null); return; }
    setOpen(id); setDetail(null);
    try { setDetail(await call('GET', `/moderation/reports/${id}`)); } catch (e: any) { setMsg(e.message); }
  };

  const act = async (label: string, fn: () => Promise<any>) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(`✓ ${label}`); await load(); if (open) setDetail(await call('GET', `/moderation/reports/${open}`)); }
    catch (e: any) { setMsg(`Couldn't complete: ${e.message}`); } finally { setBusy(false); }
  };

  const ask = (q: string, min = 3) => {
    const v = window.prompt(q);
    if (v == null) return null;
    if (v.trim().length < min) { window.alert('Please add a short reason.'); return null; }
    return v.trim();
  };

  const setStatus = (r: any, status: string) => {
    const note = status === 'reviewing' ? '' : ask(`Note for marking this report ${status} (kept in the moderation history):`, 0);
    if (note === null && status !== 'reviewing') return;
    void act(`Report marked ${status}.`, () => call('POST', `/moderation/reports/${r.id}/status`, { status, note: note || '' }));
  };
  const member = (r: any, action: 'warn' | 'suspend' | 'ban' | 'restore') => {
    const uid = r.target_user_id; if (!uid) return;
    const name = who(detail?.target_user);
    const labels = { warn: 'Warn', suspend: 'Suspend', ban: 'Ban', restore: 'Restore' } as const;
    const reason = ask(`${labels[action]} ${name}?\n\nReason (shared with the member for warnings, suspensions and bans):`);
    if (!reason) return;
    let duration_hours: number | undefined;
    if (action === 'suspend') {
      const h = window.prompt('Suspend for how many hours?', '24');
      if (h == null) return;
      duration_hours = Math.max(1, parseInt(h, 10) || 24);
    }
    if (!window.confirm(`Confirm: ${labels[action]} ${name}${duration_hours ? ` for ${duration_hours} hours` : ''}?\n\nReason: ${reason}`)) return;
    void act(`${labels[action]} applied to ${name}.`, () => call('POST', `/members/${uid}/actions/${action}`, {
      reason, report_id: action === 'restore' ? undefined : r.id, duration_hours,
    }));
  };
  const removeContent = (r: any) => {
    const reason = ask('Remove the reported content?\n\nReason (kept in the moderation history):');
    if (!reason || !window.confirm('Confirm removing this content? Members will no longer see it.')) return;
    void act('Content removed and report resolved.', () => call('POST', '/moderation/content/remove', {
      target_type: r.target_type, target_id: r.target_id, report_id: r.id, reason,
    }));
  };
  return (
    <AdminShell title="Moderation">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t.key} data-testid={`mod-tab-${t.key}`} onClick={() => { setTab(t.key); setOpen(null); }}
            style={{ ...btn(t.key === 'urgent' ? '#B91C1C' : '#0F766E', tab !== t.key), minWidth: 96 }}>
            {t.key === 'urgent' ? '🚨 ' : ''}{t.label} ({counts[t.key] ?? '…'})
          </button>
        ))}
      </div>
      {msg && <div style={{ ...card, color: msg.startsWith('✓') ? '#166534' : '#B91C1C', fontWeight: 700 }}>{msg}</div>}

      {!rows ? <div style={card}>Loading…</div> : rows.length === 0 ? <div style={card}>No reports here.</div> : rows.map((r) => {
        const b = BADGE[r.bucket] || BADGE.new;
        const unresolved = r.bucket === 'new' || r.bucket === 'reviewing';
        return (
          <div key={r.id} style={{ ...card, borderLeft: `5px solid ${r.is_urgent ? '#DC2626' : unresolved ? '#2563EB' : '#CBD5E1'}` }} data-testid={`mod-row-${r.id}`}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => void openReport(r.id)}>
              {r.is_urgent && <span style={{ fontSize: 11, fontWeight: 900, color: '#fff', background: '#DC2626', borderRadius: 6, padding: '2px 6px' }}>URGENT</span>}
              <span style={{ fontSize: 11, fontWeight: 900, borderRadius: 999, padding: '2px 8px', background: b.bg, color: b.fg, textTransform: 'capitalize' }}>{r.bucket}</span>
              <span style={{ fontWeight: 900, color: '#0F172A' }}>{r.reason || 'Report'}</span>
              <span style={{ fontSize: 12.5, color: '#475569' }}>· {r.target_type || 'user'} · {who(r.target_user)} reported by {who(r.reporter)}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748B' }}>{fmt(r.created_at)}</span>
            </div>
            {open === r.id && (
              <div style={{ marginTop: 10 }}>
                {!detail ? 'Loading…' : (
                  <>
                    <div style={h4}>Evidence</div>
                    <div style={{ fontSize: 13, color: '#334155', whiteSpace: 'pre-wrap' }}>{r.notes || '(no notes from the reporter)'}</div>
                    {r.related_text && <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 4 }}>Snapshot: “{r.related_text}”</div>}
                    <div style={h4}>Reported content</div>
                    {detail.content ? (
                      <div style={{ fontSize: 13, background: '#F8FAFC', borderRadius: 10, padding: 10, color: '#334155' }}>
                        {detail.content.title && <b>{detail.content.title}<br /></b>}
                        {detail.content.body || detail.content.text || detail.content.caption || '(no text)'}
                        {(detail.content.removed || detail.content.hidden) && <div style={{ color: '#B91C1C', marginTop: 6, fontWeight: 800 }}>Already removed / hidden</div>}
                      </div>
                    ) : <div style={{ fontSize: 12.5, color: '#64748B' }}>{r.target_type === 'user' ? 'This report is about the member themselves.' : 'Content no longer available.'}</div>}
                    <div style={h4}>People</div>
                    <div style={{ fontSize: 13 }}>
                      Reported member: {r.target_user_id ? <Link href={`/admin/members/${r.target_user_id}`}>{who(detail.target_user)}</Link> : '—'}
                      {detail.target_user?.banned ? ' · BANNED' : detail.target_user?.restricted ? ' · restricted' : ''}
                      <br />Reporter: {r.reporter_id ? <Link href={`/admin/members/${r.reporter_id}`}>{who(detail.reporter)}</Link> : '—'}
                      {r.priority === 'high' ? ' · Founding Member / admin (priority)' : ''}
                    </div>
                    <div style={h4}>Other reports about this member ({detail.target_history.length})</div>
                    {detail.target_history.slice(0, 8).map((h: any) => <div key={h.id} style={{ fontSize: 12.5, color: '#475569' }}>{fmt(h.created_at)} — {h.reason} ({h.status})</div>)}
                    <div style={h4}>Reports filed by this reporter ({detail.reporter_history.length})</div>
                    {detail.reporter_history.slice(0, 5).map((h: any) => <div key={h.id} style={{ fontSize: 12.5, color: '#475569' }}>{fmt(h.created_at)} — {h.reason} ({h.status})</div>)}
                    <div style={h4}>Moderation history</div>
                    {detail.moderation_log.length === 0 ? <div style={{ fontSize: 12.5, color: '#64748B' }}>None.</div> :
                      detail.moderation_log.slice(0, 8).map((h: any) => <div key={h.id} style={{ fontSize: 12.5, color: '#475569' }}>{fmt(h.created_at)} — {h.action}{h.reason ? `: ${h.reason}` : ''}</div>)}
                    {r.target_user_id && <div style={{ marginTop: 6 }}><Link href={`/admin/members/${r.target_user_id}`} style={{ fontSize: 12.5, fontWeight: 800 }}>Open full member profile & Ask George →</Link></div>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                      {r.bucket === 'new' && <button style={btn('#92400E', true, busy)} disabled={busy} onClick={() => setStatus(r, 'reviewing')}>Mark reviewing</button>}
                      {unresolved && <button style={btn('#166534', true, busy)} disabled={busy} onClick={() => setStatus(r, 'resolved')}>Resolve</button>}
                      {unresolved && <button style={btn('#475569', true, busy)} disabled={busy} onClick={() => setStatus(r, 'dismissed')}>Dismiss</button>}
                      {!unresolved && <button style={btn('#1E40AF', true, busy)} disabled={busy} onClick={() => setStatus(r, 'reviewing')}>Re-open</button>}
                      {r.target_user_id && <button style={btn('#B45309', true, busy)} disabled={busy} onClick={() => member(r, 'warn')}>Warn</button>}
                      {r.target_user_id && <button style={btn('#B91C1C', true, busy)} disabled={busy} onClick={() => member(r, 'suspend')}>Suspend</button>}
                      {r.target_user_id && <button style={btn('#7F1D1D', false, busy)} disabled={busy} onClick={() => member(r, 'ban')}>Ban</button>}
                      {r.target_user_id && (detail.target_user?.restricted || detail.target_user?.banned) &&
                        <button style={btn('#0F766E', true, busy)} disabled={busy} onClick={() => member(r, 'restore')}>Restore</button>}
                      {['notice', 'message', 'dm', 'moment'].includes(r.target_type) && detail.content && !(detail.content.removed || detail.content.hidden) &&
                        <button style={btn('#B91C1C', true, busy)} disabled={busy} onClick={() => removeContent(r)}>Remove content</button>}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ ...card, marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 900, color: '#0F172A', marginRight: 'auto' }}>Earlier Moment reports (read-only)</div>
          <button style={btn('#334155')} onClick={async () => {
            if (legacy) { setLegacy(null); return; }
            try { setLegacy((await call('GET', '/moderation/legacy-moment-reports')).reports); } catch (e: any) { setMsg(e.message); }
          }}>{legacy ? 'Hide' : 'Show'}</button>
        </div>
        {legacy && (legacy.length === 0 ? <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 8 }}>None.</div> :
          legacy.map((x, i) => (
            <div key={i} style={{ fontSize: 12.5, color: '#475569', marginTop: 6 }}>
              {fmt(x.created_at)} — {x.reason}{x.details ? `: ${x.details}` : ''} · by {x.reporter_name} · Moment “{x.caption}” {x.hidden ? '(hidden)' : ''}
              {x.author_id && <> · <Link href={`/admin/members/${x.author_id}`}>author profile</Link></>}
            </div>
          )))}
      </div>
    </AdminShell>
  );
}
