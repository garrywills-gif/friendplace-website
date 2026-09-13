'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { outreachApi, type OutreachOrg } from '@/lib/cms-api';

export default function OutreachDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [org, setOrg] = useState<OutreachOrg | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logKind, setLogKind] = useState('note');
  const [logBody, setLogBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setOrg(await outreachApi.get(params.id)); }
    catch (e: any) { setErr(e?.message || String(e)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params.id]);

  if (err) return <AdminShell title="Outreach"><div style={errBox}>{err}</div></AdminShell>;
  if (!org) return <AdminShell title="Outreach"><div style={muted}>Loading…</div></AdminShell>;

  const addLog = async () => {
    if (!logBody.trim()) return;
    setBusy(true);
    try {
      await outreachApi.log(org.id, { kind: logKind, body: logBody });
      setLogBody('');
      await load();
    } finally { setBusy(false); }
  };

  const markReplied = async (direction: 'inbound' | 'outbound') => {
    setBusy(true);
    try {
      const body = prompt(direction === 'inbound'
        ? `Paste what ${org.contact_name || org.organisation_name} said (optional):`
        : `What did we reply? (optional):`) || undefined;
      const subject = prompt('Subject (optional):') || undefined;
      await outreachApi.markReplied(org.id, { direction, body, subject });
      await load();
    } finally { setBusy(false); }
  };

  const emailAsIndividual = () => {
    const qs = new URLSearchParams({
      email: org.email,
      name: org.contact_name || org.organisation_name,
      kind: 'organisation',
      organisation_name: org.organisation_name,
      suburb: org.suburb || '',
    });
    router.push(`/admin/marketing/send?${qs.toString()}`);
  };

  return (
    <AdminShell title={org.organisation_name}>
      <p style={crumbs}>
        <Link href="/admin/crm" style={crumbLink}>CRM</Link>{' › '}
        <Link href="/admin/outreach" style={crumbLink}>Outreach</Link>{' › '}
        {org.organisation_name}
      </p>

      <div style={grid}>
        <div style={card}>
          <h3 style={cardTitle}>Details</h3>
          <div style={row}><b>Email:</b>&nbsp;{org.email}</div>
          <div style={row}><b>Contact:</b>&nbsp;{org.contact_name || '—'}</div>
          <div style={row}><b>Phone:</b>&nbsp;{org.phone || '—'}</div>
          <div style={row}><b>Category:</b>&nbsp;{org.category?.replace(/_/g, ' ') || '—'}</div>
          <div style={row}><b>Suburb / state:</b>&nbsp;{[org.suburb, org.state].filter(Boolean).join(', ') || '—'}</div>
          <div style={row}><b>Status:</b>&nbsp;<code>{org.status}</code></div>
          <div style={row}><b>Last contact:</b>&nbsp;{org.last_contact_at ? new Date(org.last_contact_at).toLocaleString() : '—'}</div>
          <div style={row}><b>Last reply from them:</b>&nbsp;{org.last_reply_at ? new Date(org.last_reply_at).toLocaleString() : '—'}</div>
          {org.notes && <div style={{ marginTop: 10, whiteSpace: 'pre-wrap', color: '#475569' }}>{org.notes}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button onClick={emailAsIndividual} style={primaryBtn} data-testid="email-this-org">Email this org</button>
            <button onClick={() => markReplied('inbound')} disabled={busy} style={secondaryBtn} data-testid="log-inbound-reply">Log inbound reply</button>
            <button onClick={() => markReplied('outbound')} disabled={busy} style={secondaryBtn} data-testid="log-outbound-reply">Log our reply</button>
          </div>
        </div>

        <div style={card}>
          <h3 style={cardTitle}>Communication history</h3>
          {(org.communications || []).length === 0 && <div style={muted}>Nothing yet.</div>}
          {(org.communications || []).slice().reverse().map((c, i) => (
            <div key={i} style={commRow}>
              <div style={{ fontSize: 11, color: '#0F766E', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{c.kind}</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>{new Date(c.at).toLocaleString()}</div>
              {c.subject && <div style={{ fontWeight: 600 }}>{c.subject}</div>}
              {c.body && <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{c.body}</div>}
            </div>
          ))}
          <div style={{ marginTop: 16, borderTop: '1px solid #E2E8F0', paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Add a note / call / meeting</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={logKind} onChange={(e) => setLogKind(e.target.value)} style={{ ...input, flex: '0 0 120px' }}>
                <option value="note">Note</option><option value="call">Call</option><option value="meeting">Meeting</option>
              </select>
              <input value={logBody} onChange={(e) => setLogBody(e.target.value)}
                placeholder="e.g. Called reception — Sarah out on Tuesday" style={{ ...input, flex: 1 }} />
              <button onClick={addLog} disabled={!logBody.trim() || busy} style={secondaryBtn}>Save</button>
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

const crumbs: React.CSSProperties = { margin: '4px 0 20px', color: '#475569', fontSize: 13, lineHeight: 1.5 };
const crumbLink: React.CSSProperties = { color: '#0F766E', textDecoration: 'none', fontWeight: 700 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(0, 1.3fr)', gap: 20 };
const card: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: 20 };
const cardTitle: React.CSSProperties = { margin: 0, fontSize: 15, fontWeight: 800, color: '#0A2540', marginBottom: 12 };
const row: React.CSSProperties = { fontSize: 13, color: '#334155', padding: '2px 0' };
const commRow: React.CSSProperties = { padding: '8px 0', borderBottom: '1px solid #F1F5F9' };
const input: React.CSSProperties = { border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' };
const primaryBtn: React.CSSProperties = { background: '#0D9488', color: '#FFFFFF', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { background: '#F1F5F9', color: '#0F172A', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const muted: React.CSSProperties = { color: '#64748B', fontSize: 13 };
const errBox: React.CSSProperties = { background: '#FEE2E2', color: '#991B1B', padding: 12, borderRadius: 10, border: '1px solid #FECACA' };
