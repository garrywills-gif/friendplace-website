'use client';

/**
 * /admin/marketing/history — every marketing send, newest first.
 * A read-only audit view; the actual send flow lives at
 * /admin/marketing/send. Keeps things scannable — no bulk actions.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { marketingApi, type MarketingSendRow } from '@/lib/cms-api';

export default function MarketingHistoryPage() {
  const [rows, setRows] = useState<MarketingSendRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await marketingApi.listSends({ limit: 200 });
        setRows(r.sends);
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AdminShell title="Send History">
      <p style={intro}>
        <Link href="/admin/crm" style={crumb}>CRM</Link>
        {' › '}Marketing{' › '}Send History —{' '}
        every marketing email FriendPlace has sent, newest first. One row per recipient.
      </p>

      {loading && <div style={muted}>Loading…</div>}
      {err && <div style={errBox}>Couldn’t load history: {err}</div>}

      {!loading && !err && rows.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: '#64748B' }}>
          Nothing sent yet. <Link href="/admin/marketing/send" style={link}>Send your first email →</Link>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Recipient</th>
                <th style={th}>Subject</th>
                <th style={th}>Template</th>
                <th style={th}>Flyer</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{formatDate(r.created_at)}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 700, color: '#0F172A' }}>{r.recipient_name || r.organisation_name || '—'}</div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>{r.recipient_email}</div>
                  </td>
                  <td style={td}>{r.subject}</td>
                  <td style={td}><code style={code}>{r.template_id}</code></td>
                  <td style={td}>
                    {r.flyer_template ? (
                      <span title={r.flyer_filename || ''}>
                        {r.flyer_template} <span style={mutedInline}>({r.flyer_layout})</span>
                      </span>
                    ) : <span style={mutedInline}>—</span>}
                  </td>
                  <td style={td}>
                    {r.status === 'sent'
                      ? <span style={pillOk}>sent</span>
                      : <span style={pillErr} title={r.error || ''}>failed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-AU', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return iso; }
}

const intro: React.CSSProperties = { margin: '4px 0 20px', color: '#475569', fontSize: 13, lineHeight: 1.5 };
const crumb: React.CSSProperties = { color: '#0F766E', textDecoration: 'none', fontWeight: 700 };
const link: React.CSSProperties = { color: '#0F766E', fontWeight: 700, textDecoration: 'none' };
const card: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: 32, marginTop: 12, fontSize: 14 };
const muted: React.CSSProperties = { color: '#64748B', fontSize: 13, padding: '20px 0' };
const errBox: React.CSSProperties = { background: '#FEE2E2', color: '#991B1B', padding: '10px 14px', borderRadius: 10, border: '1px solid #FECACA', fontSize: 13 };
const table: React.CSSProperties = { width: '100%', minWidth: 780, borderCollapse: 'separate', borderSpacing: 0, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#0F766E', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' };
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: '#0F172A', borderBottom: '1px solid #F1F5F9', verticalAlign: 'top' };
const code: React.CSSProperties = { background: '#F1F5F9', padding: '2px 6px', borderRadius: 6, fontSize: 12, color: '#0F172A' };
const pillOk: React.CSSProperties = { padding: '2px 10px', borderRadius: 999, background: '#DCFCE7', color: '#166534', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em' };
const pillErr: React.CSSProperties = { padding: '2px 10px', borderRadius: 999, background: '#FEE2E2', color: '#991B1B', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', cursor: 'help' };
const mutedInline: React.CSSProperties = { color: '#94A3B8', fontSize: 12 };
