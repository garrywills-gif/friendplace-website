'use client';

/**
 * Organisation Outreach — group member list.
 *
 * Route: `/admin/outreach/group/[slug]`
 *
 * Shows every organisation in the given category (slug) with the
 * columns Garry asked for: Organisation | Contact | Status | Last
 * Contact | View. Clicking an organisation goes to the existing
 * detail page at `/admin/outreach/{id}` — nothing about the detail
 * or communications history changes.
 *
 * `?archived=true` reads from the archived list so this page mirrors
 * the Active/Archived toggle on the parent group table.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';
import { type OutreachOrg, type OutreachStatus } from '@/lib/cms-api';
import { outreachArchiveApi, type OutreachListResponse } from '@/lib/outreach-archive-api';

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

const STATUS_STYLES: Record<OutreachStatus, { bg: string; fg: string }> = {
  not_contacted:  { bg: '#F1F5F9', fg: '#475569' },
  contacted:      { bg: '#DCFCE7', fg: '#166534' },
  awaiting_reply: { bg: '#EEF2FF', fg: '#3730A3' },
  replied:        { bg: '#F0FDFA', fg: '#0F766E' },
  joined:         { bg: '#ECFDF5', fg: '#047857' },
  declined:       { bg: '#FEF2F2', fg: '#B91C1C' },
  bounced:        { bg: '#FEF2F2', fg: '#B91C1C' },
  unsubscribed:   { bg: '#FEF3C7', fg: '#92400E' },
};

const CATEGORY_LABELS: Record<string, string> = {
  retirement_village:     'Retirement Villages',
  u3a:                    'U3A',
  mens_shed:              "Men's Sheds",
  probus:                 'Probus Clubs',
  community_centre:       'Community Centres',
  community_organisation: 'Community Organisations',
  rsl_club:               'RSL / Clubs',
  rsl:                    'RSL / Clubs',
  library_council:        'Libraries / Councils',
  library:                'Libraries / Councils',
  seniors_organisation:   'Seniors Organisations',
  event_submission:       'Event Submissions',
  outreach:               'Other Outreach',
  uncategorised:          'Uncategorised',
};

function labelFor(slug: string): string {
  if (!slug) return 'Uncategorised';
  if (CATEGORY_LABELS[slug]) return CATEGORY_LABELS[slug];
  return slug
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function rowsFrom(result: OutreachListResponse): OutreachOrg[] {
  return result.rows || result.organisations || [];
}

type SortKey = 'name' | 'status' | 'last';

export default function OutreachGroupPage() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const slug = decodeURIComponent(String(params?.slug ?? ''));
  const archived = search?.get('archived') === 'true';

  const [rows, setRows] = useState<OutreachOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | OutreachStatus>('');
  const [sort, setSort] = useState<SortKey>('name');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const opts = { limit: 500 };
        const res = archived ? await outreachArchiveApi.list(opts) : await outreachArchiveApi.listActive(opts);
        if (!cancelled) setRows(rowsFrom(res));
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load organisations.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [archived]);

  const label = labelFor(slug);

  const groupRows = useMemo(() => {
    const cat = slug === 'uncategorised' ? '' : slug;
    const inGroup = rows.filter(o => (o.category || '').trim() === cat);
    const needle = q.trim().toLowerCase();
    const filtered = inGroup.filter(o => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (!needle) return true;
      const hay = [o.organisation_name, o.contact_name, o.email, o.phone, o.suburb, o.state]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
    const sorted = filtered.slice();
    if (sort === 'name') {
      sorted.sort((a, b) => (a.organisation_name || '').localeCompare(b.organisation_name || ''));
    } else if (sort === 'status') {
      sorted.sort((a, b) => (a.status || '').localeCompare(b.status || ''));
    } else if (sort === 'last') {
      sorted.sort((a, b) => (b.last_contact_at || '').localeCompare(a.last_contact_at || ''));
    }
    return sorted;
  }, [rows, slug, q, statusFilter, sort]);

  const summary = useMemo(() => {
    const cat = slug === 'uncategorised' ? '' : slug;
    const inGroup = rows.filter(o => (o.category || '').trim() === cat);
    const contacted = inGroup.filter(o => o.status && o.status !== 'not_contacted').length;
    return { total: inGroup.length, contacted, notContacted: inGroup.length - contacted };
  }, [rows, slug]);

  return (
    <AdminShell title={`Organisation Outreach · ${label}`}>
      <div style={topBar}>
        <div>
          <button type="button" onClick={() => router.push('/admin/outreach')} style={backBtn}>
            ← All groups
          </button>
          <p style={intro}>
            {summary.total} organisation{summary.total === 1 ? '' : 's'} in this group ·{' '}
            <strong style={{ color: '#0F766E' }}>{summary.contacted}</strong> contacted ·{' '}
            <strong style={{ color: '#92400E' }}>{summary.notContacted}</strong> not contacted
            {archived && <span style={{ color: '#94A3B8' }}> · viewing archived</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/admin/outreach/new" style={{ ...adminStyles.primaryBtn, textDecoration: 'none' }}>
            + New organisation
          </Link>
        </div>
      </div>

      <div style={filters}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search this group…"
          style={{ ...adminStyles.input, marginBottom: 0, flex: '1 1 260px' }}
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter((e.target.value || '') as any)}
          style={{ ...adminStyles.input, marginBottom: 0, minWidth: 180 }}
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortKey)}
          style={{ ...adminStyles.input, marginBottom: 0, minWidth: 170 }}
        >
          <option value="name">Sort · Name (A→Z)</option>
          <option value="status">Sort · Status</option>
          <option value="last">Sort · Most recent contact</option>
        </select>
      </div>

      {error && <div style={errorBox}>{error}</div>}

      {loading ? (
        <div style={emptyState}>Loading organisations…</div>
      ) : !error && groupRows.length === 0 ? (
        <div style={emptyState}>
          <div style={{ fontSize: 48 }}>📮</div>
          <p style={{ fontWeight: 700, fontSize: 16, marginTop: 12, marginBottom: 6, color: '#0A2540' }}>
            {q || statusFilter
              ? 'No organisations match those filters.'
              : archived
              ? 'No archived organisations in this group.'
              : 'This group is empty.'}
          </p>
          <p style={{ color: '#64748B', fontSize: 13, margin: 0 }}>
            {q || statusFilter ? 'Try clearing the filters.' : 'Import a spreadsheet or add an organisation.'}
          </p>
        </div>
      ) : (
        !error && (
          <div style={tableCard}>
            <div style={tableHeader}>
              <div style={{ flex: '2 1 0' }}>Organisation</div>
              <div style={{ flex: '1.4 1 0' }}>Contact</div>
              <div style={{ flex: '1 1 0' }}>Status</div>
              <div style={{ flex: '1 1 0' }}>Last contact</div>
              <div style={{ flex: '0 0 86px', textAlign: 'right' }}>Action</div>
            </div>
            {groupRows.map(o => {
              const st = (o.status || 'not_contacted') as OutreachStatus;
              const stStyle = STATUS_STYLES[st] || STATUS_STYLES.not_contacted;
              const stLbl = STATUS_LABELS[st] || String(st);
              const lastLbl = o.last_contact_at
                ? new Date(o.last_contact_at).toLocaleDateString('en-AU', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                : '—';
              return (
                <Link
                  key={o.id}
                  href={`/admin/outreach/${o.id}`}
                  style={{ ...rowLine, textDecoration: 'none', color: 'inherit' }}
                >
                  <div style={{ flex: '2 1 0', minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: '#0A2540', fontSize: 15 }}>{o.organisation_name}</div>
                    {(o.suburb || o.state) && (
                      <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                        {[o.suburb, o.state].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: '1.4 1 0', fontSize: 13, color: '#475569', minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.contact_name || '—'}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#94A3B8',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {o.email || o.phone || ''}
                    </div>
                  </div>
                  <div style={{ flex: '1 1 0' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '4px 10px',
                        borderRadius: 999,
                        background: stStyle.bg,
                        color: stStyle.fg,
                        fontWeight: 800,
                        fontSize: 11,
                        letterSpacing: '0.03em',
                      }}
                    >
                      {stLbl}
                    </span>
                  </div>
                  <div style={{ flex: '1 1 0', fontSize: 13, color: '#475569' }}>{lastLbl}</div>
                  <div style={{ flex: '0 0 86px', textAlign: 'right' }}>
                    <span style={openLink}>View →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )
      )}
    </AdminShell>
  );
}

// ─── Styles ────────────────────────────────────────────────────────
const topBar: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
  marginTop: -8,
  marginBottom: 20,
};
const intro: React.CSSProperties = { margin: '10px 0 0', color: '#475569', fontSize: 14, lineHeight: 1.6 };
const backBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#0F766E',
  fontWeight: 800,
  padding: 0,
  fontSize: 13,
  cursor: 'pointer',
};
const filters: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
  marginBottom: 14,
};
const tableCard: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 18,
  overflow: 'hidden',
};
const tableHeader: React.CSSProperties = {
  display: 'flex',
  padding: '12px 18px',
  background: '#F8FAFC',
  borderBottom: '1px solid #E2E8F0',
  gap: 12,
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  fontWeight: 800,
  color: '#64748B',
};
const rowLine: React.CSSProperties = {
  display: 'flex',
  padding: '16px 18px',
  alignItems: 'center',
  gap: 12,
  borderTop: '1px solid #F1F5F9',
};
const openLink: React.CSSProperties = { color: '#0F766E', fontWeight: 800 };
const emptyState: React.CSSProperties = {
  padding: 48,
  textAlign: 'center',
  color: '#64748B',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 18,
};
const errorBox: React.CSSProperties = {
  background: '#FEF2F2',
  color: '#B91C1C',
  borderRadius: 10,
  padding: 12,
  marginBottom: 16,
  fontSize: 13,
};
