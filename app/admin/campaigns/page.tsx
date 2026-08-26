'use client';

/**
 * Campaigns (Phase 2A) — list view.
 *
 * Drafts can be deleted after an explicit confirmation. Sent campaigns
 * remain part of FriendPlace's communication history and are never hard-
 * deleted from this screen.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { campaignsApi, type Campaign, type CampaignStatus } from '@/lib/cms-api';

const STATUS_META: Record<CampaignStatus, { label: string; bg: string; fg: string }> = {
  draft:     { label: 'Draft',     bg: '#F1F5F9', fg: '#475569' },
  scheduled: { label: 'Scheduled', bg: '#EEF2FF', fg: '#3730A3' },
  sending:   { label: 'Sending',   bg: '#FEF3C7', fg: '#92400E' },
  sent:      { label: 'Sent',      bg: '#DCFCE7', fg: '#166534' },
  failed:    { label: 'Failed',    bg: '#FEE2E2', fg: '#991B1B' },
};

export default function CampaignsListPage() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await campaignsApi.list();
        if (!cancelled) {
          setRows(r.rows || []);
          setErr(null);
        }
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

  const confirmDelete = async () => {
    if (!deleteTarget || deleteTarget.status !== 'draft') return;
    setDeleting(true);
    try {
      await campaignsApi.remove(deleteTarget.id);
      setRows(current => current.filter(c => c.id !== deleteTarget.id));
      setDeleteTarget(null);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || 'Could not delete campaign');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AdminShell title="Campaigns">
      <div style={headerRow}>
        <p style={{ color: '#475569', fontSize: 15, maxWidth: 640, margin: 0 }}>
          Send updates, invitations and announcements to your Founding Members. Sent campaigns are
          kept as part of your communication history so you can reopen them later and see exactly
          what was sent and how it performed.
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
            <div style={{ flex: '0 0 86px', textAlign: 'right' }}>Action</div>
          </div>
          {rows.map(c => {
            const meta = STATUS_META[c.status];
            const total = c.stats?.targeted || 0;
            const accepted = c.stats?.accepted || 0;
            const failed = c.stats?.failed || 0;
            return (
              <div key={c.id} style={rowLine}>
                <Link
                  href={`/admin/campaigns/${c.id}`}
                  style={{ ...rowMainLink, textDecoration: 'none', color: 'inherit' }}
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
                    {c.status === 'scheduled' && c.scheduled_at ? (
                      <span style={{ color: '#3730A3', fontWeight: 700 }}>
                        ⏰ {new Date(c.scheduled_at).toLocaleString('en-AU', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    ) : c.sent_at ? (
                      new Date(c.sent_at).toLocaleString('en-AU', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })
                    ) : (
                      <span style={{ color: '#94A3B8' }}>Draft</span>
                    )}
                  </div>
                </Link>

                <div style={{ flex: '0 0 86px', textAlign: 'right' }}>
                  {c.status === 'draft' ? (
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(c)}
                      style={deleteBtn}
                      aria-label={`Delete ${c.name}`}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deleteTarget && (
        <div style={modalBackdrop} role="presentation" onMouseDown={() => !deleting && setDeleteTarget(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-campaign-title"
            style={modalCard}
            onMouseDown={e => e.stopPropagation()}
          >
            <div id="delete-campaign-title" style={{ fontSize: 18, fontWeight: 900, color: '#0A2540' }}>
              Delete draft campaign?
            </div>
            <p style={{ margin: '10px 0 0', color: '#475569', fontSize: 14, lineHeight: 1.55 }}>
              <strong>{deleteTarget.name}</strong> will be permanently deleted. This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                style={{ ...s.ghostBtn, opacity: deleting ? 0.6 : 1 }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                style={{ ...deleteConfirmBtn, opacity: deleting ? 0.65 : 1 }}
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
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
  borderTop: '1px solid #F1F5F9',
};
const rowMainLink: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 auto',
};
const deleteBtn: React.CSSProperties = {
  border: '1px solid #FCA5A5', background: '#FFF7F7', color: '#B91C1C',
  borderRadius: 9, padding: '6px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
};
const modalBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.42)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modalCard: React.CSSProperties = {
  width: '100%', maxWidth: 460, background: '#FFFFFF', borderRadius: 18,
  border: '1px solid #E2E8F0', padding: 22, boxShadow: '0 24px 60px rgba(15,23,42,0.22)',
};
const deleteConfirmBtn: React.CSSProperties = {
  border: '1px solid #B91C1C', background: '#B91C1C', color: '#FFFFFF',
  borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer',
};
const emptyState: React.CSSProperties = {
  padding: 48, textAlign: 'center', color: '#64748B',
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 18,
};
