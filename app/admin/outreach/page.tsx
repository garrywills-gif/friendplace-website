'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';
import {
  outreachApi,
  type OutreachOrg,
  type OutreachStatus,
} from '@/lib/cms-api';

const STATUS_LABELS: Record<OutreachStatus, string> = {
  not_contacted: 'Not contacted',
  contacted: 'Contacted',
  awaiting_reply: 'Awaiting our reply',
  replied: 'Replied',
  joined: 'Joined',
  declined: 'Declined',
  bounced: 'Bounced',
  unsubscribed: 'Unsubscribed',
};

export default function OutreachPage() {
  const [rows, setRows] = useState<OutreachOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await outreachApi.list({
        q: q.trim() || undefined,
        status: status ? (status as OutreachStatus) : undefined,
        category: category || undefined,
        limit: 500,
      });

      setRows(result.organisations || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load outreach organisations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status, category]);

  const categories = useMemo(() => {
    return Array.from(
      new Set(rows.map((r) => r.category).filter(Boolean)),
    ).sort();
  }, [rows]);

  return (
    <AdminShell title="Organisation Outreach">
      <div style={topBar}>
        <div>
          <p style={intro}>
            Track retirement villages, community organisations, libraries,
            councils, clubs and other FriendPlace outreach contacts.
          </p>
        </div>

        <Link
          href="/admin/outreach/new"
          style={{ ...adminStyles.primaryBtn, textDecoration: 'none' }}
        >
          + New organisation
        </Link>
      </div>

      <div style={filters}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load();
          }}
          placeholder="Search organisation, contact or email…"
          style={{ ...adminStyles.input, marginBottom: 0, flex: '1 1 260px' }}
        />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ ...adminStyles.input, marginBottom: 0, minWidth: 180 }}
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ ...adminStyles.input, marginBottom: 0, minWidth: 190 }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void load()}
          style={adminStyles.ghostBtn}
        >
          Search
        </button>
      </div>

      {error && <div style={errorBox}>{error}</div>}

      {loading ? (
        <p style={{ color: '#64748B' }}>Loading organisations…</p>
      ) : rows.length === 0 ? (
        <div style={emptyCard}>
          <div style={{ fontSize: 34 }}>🏢</div>
          <h3 style={{ margin: '8px 0', color: '#0A2540' }}>
            No outreach organisations yet
          </h3>
          <p style={{ color: '#64748B', margin: '0 0 16px' }}>
            Add your first organisation and it will be available for outreach
            campaigns and CRM follow-up.
          </p>

          <Link
            href="/admin/outreach/new"
            style={{ ...adminStyles.primaryBtn, textDecoration: 'none' }}
          >
            + New organisation
          </Link>
        </div>
      ) : (
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Organisation</th>
                <th style={th}>Contact</th>
                <th style={th}>Category</th>
                <th style={th}>Status</th>
                <th style={th}>Last contact</th>
                <th style={th}></th>
              </tr>
            </thead>

            <tbody>
              {rows.map((org) => (
                <tr key={org.id}>
                  <td style={td}>
                    <div style={{ fontWeight: 800, color: '#0A2540' }}>
                      {org.organisation_name}
                    </div>
                    {org.suburb && (
                      <div style={muted}>
                        {org.suburb}
                        {org.state ? `, ${org.state}` : ''}
                      </div>
                    )}
                  </td>

                  <td style={td}>
                    <div>{org.contact_name || '—'}</div>
                    <div style={muted}>{org.email}</div>
                  </td>

                  <td style={td}>
                    {org.category
                      ? org.category.replace(/_/g, ' ')
                      : '—'}
                  </td>

                  <td style={td}>
                    <span style={statusPill}>
                      {STATUS_LABELS[org.status] || org.status}
                    </span>
                  </td>

                  <td style={td}>
                    {org.last_contact_at
                      ? new Date(org.last_contact_at).toLocaleDateString('en-AU')
                      : '—'}
                  </td>

                  <td style={{ ...td, textAlign: 'right' }}>
                    <Link
                      href={`/admin/outreach/${org.id}`}
                      style={viewLink}
                    >
                      Open →
                    </Link>
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

const topBar: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
  marginBottom: 20,
};

const intro: React.CSSProperties = {
  margin: 0,
  color: '#475569',
  fontSize: 14,
  lineHeight: 1.6,
  maxWidth: 700,
};

const filters: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
  marginBottom: 18,
};

const tableWrap: React.CSSProperties = {
  overflowX: 'auto',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 16,
};

const table: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
};

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 14px',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#64748B',
  borderBottom: '1px solid #E2E8F0',
};

const td: React.CSSProperties = {
  padding: '14px',
  fontSize: 13,
  color: '#334155',
  borderBottom: '1px solid #F1F5F9',
  verticalAlign: 'top',
};

const muted: React.CSSProperties = {
  marginTop: 3,
  color: '#94A3B8',
  fontSize: 12,
};

const statusPill: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 9px',
  borderRadius: 999,
  background: '#F0FDFA',
  color: '#0F766E',
  fontWeight: 800,
  fontSize: 11,
};

const viewLink: React.CSSProperties = {
  color: '#0F766E',
  fontWeight: 800,
  textDecoration: 'none',
};

const emptyCard: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px dashed #CBD5E1',
  borderRadius: 16,
  padding: '48px 24px',
  textAlign: 'center',
};

const errorBox: React.CSSProperties = {
  marginBottom: 16,
  padding: 12,
  borderRadius: 10,
  background: '#FEF2F2',
  color: '#B91C1C',
  fontSize: 13,
};
