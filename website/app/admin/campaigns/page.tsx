'use client';

/**
 * Campaigns (Phase 2A) — list view.
 *
 * Every campaign, past and future, lives here. Drafts sit at the top
 * with an Edit button; sent campaigns stay forever as part of
 * FriendPlace's communication history and can be reopened months
 * later to see who received what, when, and with which template.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { campaignsApi, type Campaign, type CampaignStatus } from '@/lib/cms-api';

const STATUS_META: Record<CampaignStatus, { label: string; bg: string; fg: string }> = {
  draft:   { label: 'Draft',   bg: '#F1F5F9', fg: '#475569' },
  sending: { label: 'Sending', bg: '#FEF3C7', fg: '#92400E' },
  sent:    { label: 'Sent',    bg: '#DCFCE7', fg: '#166534' },
  failed:  { label: 'Failed',  bg: '#FEE2E2', fg: '#991B1B' },
};

export default function CampaignsListPage() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await campaignsApi.list();
        if (!cancelled) setRows(r.rows || []);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Could not load campaigns');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <AdminShell title="Campaigns">
      <div style={headerRow}>
        <p style={{ color: '#475569', fontSize: 15, maxWidth: 640, margin: 0 }}>
          Send updates, invitations and announcements to your Founding Members. Every campaign is
          kept permanently — reopen any of them to see the exact template, audience, subject and
          delivery record.
        </p>
        <Link href="/admin/campaigns/new" style={{ ...s.primaryBtn, textDecoration: 'none' }}>
          + New campaign
        </Link>
      </div>

      {loading ? (
        <div style={emptyState}>Loading…</div>
      ) : err ? (
        <div style={{ ...emptyState, color: '#B91C1C' }}>{err}</div>
      ) : rows.length === 0 ? (
        <div style={emptyState}>
          <div style={{ fontSize: 48 }}>📮</div>
          <p style={{ fontWeight: 700, fontSize: 16, marginTop: 12, marginBottom: 6, color: '#0A2540' }}>
            No campaigns yet.
          </p>
          <p style={{ color: '#64748B', fontSize: 13, margin: 0 }}>
            Your first Founding Member Update starts with the button above.
          </p>
        </div>
      ) : (
        <div style={tableCard}>
          <div style={tableHeader}>
            <div style={{ flex: '2 1 0' }}>Campaign</div>
            <div style={{ flex: '1.2 1 0' }}>Audience</div>
            <div style={{ flex: '0.9 1 0' }}>Status</div>
            <div style={{ flex: '1.4 1 0' }}>Delivery</div>
            <div style={{ flex: '1 1 0' }}>Sent</div>
          </div>
          {rows.map(c => {
            const meta = STATUS_META[c.status];
            const total = c.stats?.targeted || 0;
            const accepted = c.stats?.accepted || 0;
            const failed = c.stats?.failed || 0;
            return (
              <Link
                key={c.id}
                href={`/admin/campaigns/${c.id}`}
                style={{
                  ...rowLine,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{ flex: '2 1 0', minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: '#0A2540', fontSize: 15 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                    {c.template === 'announcement' ? 'Founding Member update' :
                      c.template === 'invitation'   ? 'Invitation' :
                      c.template === 'welcome'      ? 'Welcome letter' : c.template}
                    {' · '}signed by {c.companion === 'georgia' ? 'Georgia' : 'George'}
                  </div>
                </div>
                <div style={{ flex: '1.2 1 0', minWidth: 0, fontSize: 13, color: '#475569' }}>
                  {describeAudience(c)}
                </div>
                <div style={{ flex: '0.9 1 0' }}>
                  <span style={{
                    padding: '3px 10px', borderRadius: 999,
                    background: meta.bg, color: meta.fg,
                    fontSize: 11, fontWeight: 800, letterSpacing: '0.03em',
                  }}>{meta.label}</span>
                </div>
                <div style={{ flex: '1.4 1 0', fontSize: 13, color: '#475569' }}>
                  {c.status === 'sent' || c.status === 'sending' || c.status === 'failed' ? (
                    <span>
                      <strong style={{ color: '#0A2540' }}>{accepted}</strong> accepted
                      {failed > 0 && <span style={{ color: '#B91C1C' }}> · {failed} failed</span>}
                      <span style={{ color: '#94A3B8' }}> / {total}</span>
                    </span>
                  ) : (
                    <span style={{ color: '#94A3B8' }}>—</span>
                  )}
                </div>
                <div style={{ flex: '1 1 0', fontSize: 12, color: '#64748B' }}>
                  {c.sent_at ? new Date(c.sent_at).toLocaleString('en-AU', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  }) : <span style={{ color: '#94A3B8' }}>Draft</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}

function describeAudience(c: Campaign): string {
  const f = c.audience_filter || {};
  const bits: string[] = [];
  const statuses = f.statuses || [];
  if (statuses.length === 0) bits.push('All Founding Members');
  else bits.push(statuses.map(s =>
    s === 'registered' ? 'Registered' :
    s === 'invited'    ? 'Invited' :
    s === 'joined'     ? 'Joined' : 'Opted out'
  ).join(', '));
  const tagsAny = f.tags_any || [];
  if (tagsAny.length) bits.push(`tag: ${tagsAny.join(', ')}`);
  return bits.join(' · ');
}

// styles
const headerRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  gap: 16, flexWrap: 'wrap', marginTop: -8, marginBottom: 22,
};
const tableCard: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 18, overflow: 'hidden',
};
const tableHeader: React.CSSProperties = {
  display: 'flex', padding: '12px 18px', background: '#F8FAFC',
  borderBottom: '1px solid #E2E8F0', gap: 12,
  fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
  fontWeight: 800, color: '#64748B',
};
const rowLine: React.CSSProperties = {
  display: 'flex', padding: '16px 18px', alignItems: 'center', gap: 12,
  borderTop: '1px solid #F1F5F9', cursor: 'pointer',
};
const emptyState: React.CSSProperties = {
  padding: 48, textAlign: 'center', color: '#64748B',
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 18,
};
