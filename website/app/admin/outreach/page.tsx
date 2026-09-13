'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { outreachApi, type OutreachOrg, type OutreachStatus } from '@/lib/cms-api';

const STATUS_LABELS: Record<OutreachStatus, string> = {
  not_contacted:  'Not contacted',
  contacted:      'Contacted',
  awaiting_reply: 'Awaiting our reply',
  replied:        'Replied',
  joined:         'Joined',
  declined:       'Declined',
  bounced:        'Bounced',
  unsubscribed:   'Unsubscribed',
};

const STATUS_COLOURS: Record<OutreachStatus, { bg: string; fg: string }> = {
  not_contacted:  { bg: '#F1F5F9', fg: '#475569' },
  contacted:      { bg: '#DBEAFE', fg: '#1E40AF' },
  awaiting_reply: { bg: '#FEE2E2', fg: '#991B1B' },
  replied:        { bg: '#DCFCE7', fg: '#166534' },
  joined:         { bg: '#D1FAE5', fg: '#065F46' },
  declined:       { bg: '#F3F4F6', fg: '#6B7280' },
  bounced:        { bg: '#FEF3C7', fg: '#92400E' },
  unsubscribed:   { bg: '#E5E7EB', fg: '#4B5563' },
};

export default function OutreachListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<OutreachOrg[]>([]);
  const [statuses, setStatuses] = useState<OutreachStatus[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<OutreachStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await outreachApi.list({
        q: q || undefined,
        status: statusFilter || undefined,
        category: categoryFilter || undefined,
      });
      setRows(r.organisations);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    (async () => {
      const m = await outreachApi.meta();
      setStatuses(m.statuses);
      setCategories(m.categories);
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, statusFilter, categoryFilter]);

  return (
    <AdminShell title="Outreach Organisations">
      <p style={crumbs}>
        <Link href="/admin/crm" style={crumbLink}>CRM</Link>
        {' › '}Marketing{' › '}Outreach — retirement villages, community centres,
        libraries, councils and clubs.
      </p>

      <div style={toolbar}>
        <input placeholder="Search name, contact, email, suburb…" value={q}
          onChange={(e) => setQ(e.target.value)} style={{ ...input, flex: 1, minWidth: 220 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={input}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={input}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        <Link href="/admin/outreach/new" style={addBtn}>+ Add organisation</Link>
      </div>

      {loading && <div style={muted}>Loading…</div>}
      {!loading && rows.length === 0 && (
        <div style={emptyCard}>
          No organisations yet. <Link href="/admin/outreach/new" style={link}>Add your first one →</Link>
        </div>
      )}
      {!loading && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Organisation</th>
                <th style={th}>Contact</th>
                <th style={th}>Category</th>
                <th style={th}>Suburb</th>
                <th style={th}>Status</th>
                <th style={th}>Last contact</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }}
                    onClick={() => router.push(`/admin/outreach/${r.id}`)}>
                  <td style={td}>
                    <div style={{ fontWeight: 700, color: '#0F172A' }}>{r.organisation_name}</div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>{r.email}</div>
                  </td>
                  <td style={td}>{r.contact_name || <span style={dim}>—</span>}</td>
                  <td style={td}>{r.category ? r.category.replace(/_/g, ' ') : <span style={dim}>—</span>}</td>
                  <td style={td}>{r.suburb || <span style={dim}>—</span>}</td>
                  <td style={td}>
                    <span style={{ ...pill, ...(STATUS_COLOURS[r.status] || {}) }}>
                      {STATUS_LABELS[r.status] || r.status}
                    </span>
                  </td>
                  <td style={td}>{r.last_contact_at ? fmtDate(r.last_contact_at) : <span style={dim}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return iso; }
}

const crumbs: React.CSSProperties = { margin: '4px 0 20px', color: '#475569', fontSize: 13, lineHeight: 1.5 };
const crumbLink: React.CSSProperties = { color: '#0F766E', textDecoration: 'none', fontWeight: 700 };
const link: React.CSSProperties = { color: '#0F766E', fontWeight: 700, textDecoration: 'none' };
const toolbar: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 };
const input: React.CSSProperties = { border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 12px', fontSize: 14, color: '#0F172A', background: '#FFFFFF' };
const addBtn: React.CSSProperties = { background: '#0D9488', color: '#FFFFFF', textDecoration: 'none', padding: '10px 16px', borderRadius: 10, fontWeight: 700, fontSize: 13 };
const muted: React.CSSProperties = { color: '#64748B', fontSize: 13, padding: '20px 0' };
const emptyCard: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: 32, marginTop: 12, textAlign: 'center', color: '#64748B' };
const table: React.CSSProperties = { width: '100%', minWidth: 780, borderCollapse: 'separate', borderSpacing: 0, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#0F766E', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' };
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: '#0F172A', borderBottom: '1px solid #F1F5F9', verticalAlign: 'top' };
const dim: React.CSSProperties = { color: '#94A3B8' };
const pill: React.CSSProperties = { padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: '0.04em' };
