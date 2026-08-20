'use client';

/**
 * Admin ▸ Enquiries ▸ Unified public submissions view
 *
 * Every public submission form (Contact, Register Interest, Support,
 * Report, Waitlist) persists to the database *before* any email is
 * sent. This page is the guaranteed source of truth: even if outbound
 * confirmation email delivery ever fails, no customer enquiry can be
 * lost — every submission is here.
 *
 * Locked with Garry (1 Aug 2026): "email should be a notification only,
 * not the only record."
 */

import { useEffect, useMemo, useState } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { enquiriesApi, type Enquiry } from '@/lib/cms-api';

type KindKey = 'all' | 'contact' | 'interest' | 'support' | 'report' | 'waitlist';

export default function AdminEnquiriesPage() {
  return (
    <AdminShell title="Enquiries">
      <EnquiriesPanel />
    </AdminShell>
  );
}

function EnquiriesPanel() {
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [kinds, setKinds] = useState<Array<{ key: string; label: string; count: number }>>([]);
  const [filter, setFilter] = useState<KindKey>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await enquiriesApi.list(filter === 'all' ? undefined : filter);
        if (cancelled) return;
        setRows(r.rows);
        setKinds(r.kinds);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load enquiries.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filter]);

  const totalAll = useMemo(() => kinds.reduce((n, k) => n + k.count, 0), [kinds]);

  const tabs: Array<{ key: KindKey; label: string; count: number }> = [
    { key: 'all',      label: 'All',              count: totalAll },
    ...kinds.map((k) => ({ key: k.key as KindKey, label: k.label, count: k.count })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Rationale strip — reminds admins WHY this page exists */}
      <div style={rationaleStrip}>
        Every public submission is persisted here <strong>before</strong> any confirmation email is sent.
        This page is the guaranteed record, even if an email fails to deliver.
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(t.key)}
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              border: `1.5px solid ${filter === t.key ? '#14B8A6' : '#CBD5E1'}`,
              background: filter === t.key ? '#F0FDFA' : '#FFFFFF',
              color: filter === t.key ? '#0F766E' : '#475569',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t.label}
            <span style={{
              marginLeft: 8, padding: '1px 8px', borderRadius: 999,
              background: filter === t.key ? '#14B8A6' : '#E2E8F0',
              color: filter === t.key ? '#FFFFFF' : '#475569',
              fontSize: 11, fontWeight: 800,
            }}>{t.count}</span>
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#64748B' }}>Loading enquiries&hellip;</p>}
      {error && (
        <div style={{ ...card, borderColor: '#FCA5A5', background: '#FEF2F2' }}>
          <p style={{ margin: 0, color: '#991B1B', fontWeight: 700 }}>Couldn&rsquo;t load enquiries</p>
          <p style={{ marginTop: 8, marginBottom: 0, color: '#7F1D1D', fontSize: 14 }}>{error}</p>
        </div>
      )}

      {!loading && !error && rows && rows.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: '#64748B' }}>
          <p style={{ margin: 0, fontSize: 15 }}>No enquiries recorded yet.</p>
          <p style={{ marginTop: 6, fontSize: 13 }}>
            When someone submits the Contact, Register Interest, Support, Report, or Waitlist form, it will appear here.
          </p>
        </div>
      )}

      {!loading && !error && rows && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r, i) => <EnquiryRow key={`${r.kind}-${r.id ?? i}`} r={r} />)}
        </div>
      )}
    </div>
  );
}

function EnquiryRow({ r }: { r: Enquiry }) {
  const kindColor = {
    contact:  { bg: '#EFF6FF', fg: '#1D4ED8' },
    interest: { bg: '#F0FDFA', fg: '#0F766E' },
    support:  { bg: '#FEF3C7', fg: '#92400E' },
    report:   { bg: '#FEE2E2', fg: '#991B1B' },
    waitlist: { bg: '#EDE9FE', fg: '#5B21B6' },
  }[r.kind] || { bg: '#F1F5F9', fg: '#475569' };
  const when = r.created_at ? new Date(r.created_at).toLocaleString() : '';

  return (
    <div style={rowCard}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <span style={{
          padding: '3px 10px', borderRadius: 999, background: kindColor.bg,
          color: kindColor.fg, fontSize: 11, fontWeight: 800, letterSpacing: '0.03em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}>{r.kind_label}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0A2540' }}>
            {r.name || '(no name)'}
            {r.email && <span style={{ color: '#64748B', fontWeight: 500, marginLeft: 8 }}>· {r.email}</span>}
          </div>
          {r.subject && <div style={{ fontSize: 13, color: '#475569', marginTop: 3 }}>{r.subject}</div>}
          {r.message && (
            <div style={{ fontSize: 13, color: '#64748B', marginTop: 6, lineHeight: 1.55, maxHeight: 60, overflow: 'hidden' }}>
              {r.message}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', minWidth: 140 }}>
          <div style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 6,
            background: '#F1F5F9', color: '#475569', fontSize: 11, fontWeight: 700,
          }}>{r.status}</div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>{when}</div>
          {r.id && <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: 3, fontFamily: '"SF Mono", Menlo, monospace' }}>{r.id}</div>}
          {r.email && (
            <a
              href={`/admin/marketing/send?${new URLSearchParams({
                email: r.email,
                name:  r.name || '',
                template_id: 'enquiry_reply',
                subject: r.subject ? `Re: ${r.subject}` : '',
              }).toString()}`}
              style={{
                display: 'inline-block', marginTop: 8, padding: '4px 12px',
                background: '#0D9488', color: '#FFFFFF', borderRadius: 8,
                fontSize: 12, fontWeight: 700, textDecoration: 'none',
              }}
              data-testid={`enquiry-reply-${r.kind}-${r.id ?? ''}`}
            >Reply →</a>
          )}
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: 20,
};
const rowCard: React.CSSProperties = { ...card, padding: 14 };
const rationaleStrip: React.CSSProperties = {
  background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: 12,
  padding: '10px 14px', fontSize: 13, color: '#0F766E',
};
