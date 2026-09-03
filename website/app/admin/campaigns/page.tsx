'use client';

/**
 * Campaigns (Phase 2A) — list view.
 *
 * Drafts can be deleted after an explicit confirmation. Completed campaigns
 * are never hard-deleted: sent/failed campaigns can be archived and restored
 * without touching their delivery history or recipient records.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { API_BASE } from '@/lib/api-base';
import { getToken, clearAuth } from '@/lib/cms-auth';
import { campaignsApi, type Campaign, type CampaignStatus } from '@/lib/cms-api';

const STATUS_META: Record<CampaignStatus, { label: string; bg: string; fg: string }> = {
  draft:     { label: 'Draft',     bg: '#F1F5F9', fg: '#475569' },
  scheduled: { label: 'Scheduled', bg: '#EEF2FF', fg: '#3730A3' },
  sending:   { label: 'Sending',   bg: '#FEF3C7', fg: '#92400E' },
  sent:      { label: 'Sent',      bg: '#DCFCE7', fg: '#166534' },
  failed:    { label: 'Failed',    bg: '#FEE2E2', fg: '#991B1B' },
};

type CampaignWithArchive = Campaign & {
  is_archived?: boolean;
  archived_at?: string | null;
  archived_by?: string | null;
  archived_by_email?: string | null;
};

async function archiveRequest<T>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    cache: 'no-store',
  });

  if (res.status === 401) clearAuth();
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { detail: text }; }

  if (!res.ok) {
    const msg = json?.detail || json?.error || `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return json as T;
}

async function listArchivedCampaigns() {
  return archiveRequest<{ count: number; rows: CampaignWithArchive[] }>('/cms/campaigns?archived=true');
}

async function archiveCampaign(id: string) {
  return archiveRequest<{ ok: true; id: string; is_archived: true }>(
    `/cms/campaigns/${encodeURIComponent(id)}/archive`,
    'POST',
  );
}

async function restoreCampaign(id: string) {
  return archiveRequest<{ ok: true; id: string; is_archived: false }>(
    `/cms/campaigns/${encodeURIComponent(id)}/unarchive`,
    'POST',
  );
}

export default function CampaignsListPage() {
  const [rows, setRows] = useState<CampaignWithArchive[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CampaignWithArchive | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CampaignWithArchive | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = showArchived ? await listArchivedCampaigns() : await campaignsApi.list();
        if (!cancelled) {
          setRows((r.rows || []) as CampaignWithArchive[]);
          setErr(null);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Could not load campaigns');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const t = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [showArchived]);

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

  const confirmArchive = async () => {
    if (!archiveTarget || !['sent', 'failed'].includes(archiveTarget.status)) return;
    setArchiving(true);
    try {
      await archiveCampaign(archiveTarget.id);
      setRows(current => current.filter(c => c.id !== archiveTarget.id));
      setArchiveTarget(null);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || 'Could not archive campaign');
    } finally {
      setArchiving(false);
    }
  };

  const restore = async (campaign: CampaignWithArchive) => {
    setRestoringId(campaign.id);
    try {
      await restoreCampaign(campaign.id);
      setRows(current => current.filter(c => c.id !== campaign.id));
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || 'Could not restore campaign');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <AdminShell title="Campaigns">
      <div style={headerRow}>
        <div>
          <p style={{ color: '#475569', fontSize: 15, maxWidth: 640, margin: 0 }}>
            Send updates, invitations and announcements to your Founding Members. Sent campaigns are
            kept as part of your communication history so you can reopen them later and see exactly
            what was sent and how it performed.
          </p>
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            style={{ ...s.ghostBtn, marginTop: 12, padding: '7px 11px', fontSize: 12 }}
          >
            {showArchived ? '← Back to active campaigns' : 'Archived campaigns'}
          </button>
        </div>
        {!showArchived && (
          <Link href="/admin/campaigns/new" style={{ ...s.primaryBtn, textDecoration: 'none' }}>
            + New campaign
          </Link>
        )}
      </div>

      {showArchived && (
        <div style={archiveNotice}>
          <strong>Archived campaigns</strong>
          <span>These are hidden from the normal Campaigns list, but their delivery and recipient history is retained.</span>
        </div>
      )}

      {loading ? (
        <div style={emptyState}>Loading…</div>
      ) : err ? (
        <div style={{ ...emptyState, color: '#B91C1C' }}>{err}</div>
      ) : rows.length === 0 ? (
        <div style={emptyState}>
          <div style={{ fontSize: 48 }}>{showArchived ? '🗄️' : '📮'}</div>
          <p style={{ fontWeight: 700, fontSize: 16, marginTop: 12, marginBottom: 6, color: '#0A2540' }}>
            {showArchived ? 'No archived campaigns.' : 'No campaigns yet.'}
          </p>
          <p style={{ color: '#64748B', fontSize: 13, margin: 0 }}>
            {showArchived
              ? 'Archived sent campaigns will appear here and can be restored at any time.'
              : 'Your first Founding Member Update starts with the button above.'}
          </p>
        </div>
      ) : (
        <div style={tableCard}>
          <div style={tableHeader}>
            <div style={{ flex: '2 1 0' }}>Campaign</div>
            <div style={{ flex: '1.2 1 0' }}>Audience</div>
            <div style={{ flex: '0.9 1 0' }}>Status</div>
            <div style={{ flex: '1.4 1 0' }}>Delivery</div>
            <div style={{ flex: '1 1 0' }}>{showArchived ? 'Archived' : 'Sent'}</div>
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
                      {' · '}signed by {c.companion === 'georgia' ? 'Georgia' : c.companion === 'team' ? 'The FriendPlace Team' : 'George'}
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
                    {showArchived && c.archived_at ? (
                      new Date(c.archived_at).toLocaleString('en-AU', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })
                    ) : c.status === 'scheduled' && c.scheduled_at ? (
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
                  {showArchived ? (
                    <button
                      type="button"
                      disabled={restoringId === c.id}
                      onClick={() => void restore(c)}
                      style={{ ...restoreBtn, opacity: restoringId === c.id ? 0.6 : 1 }}
                      aria-label={`Restore ${c.name}`}
                    >
                      {restoringId === c.id ? 'Restoring…' : 'Restore'}
                    </button>
                  ) : c.status === 'draft' ? (
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(c)}
                      style={deleteBtn}
                      aria-label={`Delete ${c.name}`}
                    >
                      Delete
                    </button>
                  ) : c.status === 'sent' || c.status === 'failed' ? (
                    <button
                      type="button"
                      onClick={() => setArchiveTarget(c)}
                      style={archiveBtn}
                      aria-label={`Archive ${c.name}`}
                    >
                      Archive
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

      {archiveTarget && (
        <div style={modalBackdrop} role="presentation" onMouseDown={() => !archiving && setArchiveTarget(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-campaign-title"
            style={modalCard}
            onMouseDown={e => e.stopPropagation()}
          >
            <div id="archive-campaign-title" style={{ fontSize: 18, fontWeight: 900, color: '#0A2540' }}>
              Archive campaign?
            </div>
            <p style={{ margin: '10px 0 0', color: '#475569', fontSize: 14, lineHeight: 1.55 }}>
              <strong>{archiveTarget.name}</strong> will disappear from the normal Campaigns list, but its delivery history and recipient records will be kept. You can restore it later.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
              <button
                type="button"
                disabled={archiving}
                onClick={() => setArchiveTarget(null)}
                style={{ ...s.ghostBtn, opacity: archiving ? 0.6 : 1 }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={archiving}
                onClick={() => void confirmArchive()}
                style={{ ...archiveConfirmBtn, opacity: archiving ? 0.65 : 1 }}
              >
                {archiving ? 'Archiving…' : 'Archive campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function describeAudience(c: Campaign): string {
  const f: any = c.audience_filter || {};

  if (f.audience_kind === 'outreach_contacts' || f.outreach?.category) {
    const category = String(f.outreach?.category || '').trim();
    const categoryLabels: Record<string, string> = {
      library_council: 'Libraries',
      library: 'Libraries',
      community_organisation: 'Community Organisations',
      community_centre: 'Community Centres',
      mens_shed: "Men's Sheds",
      probus: 'Probus',
      retirement_village: 'Retirement Villages',
      seniors_organisation: 'Seniors Organisations',
      u3a: 'U3A',
    };
    const label = categoryLabels[category] || category
      .split('_')
      .filter(Boolean)
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ') || 'Outreach contacts';
    const outreachStatus = String(f.outreach?.status || '').trim();
    const statusLabel = outreachStatus === 'not_contacted' ? 'Not contacted' : outreachStatus
      .split('_')
      .filter(Boolean)
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    return statusLabel ? `${label} — ${statusLabel}` : label;
  }

  const bits: string[] = [];
  const statuses = f.statuses || [];
  if (statuses.length === 0) bits.push('All Founding Members');
  else bits.push(statuses.map((status: string) =>
    status === 'registered' ? 'Registered' :
    status === 'invited'    ? 'Invited' :
    status === 'joined'     ? 'Joined' : 'Opted out'
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
const archiveNotice: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap',
  marginBottom: 14, padding: '10px 12px', borderRadius: 12,
  background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#475569', fontSize: 12,
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
const archiveBtn: React.CSSProperties = {
  border: '1px solid #CBD5E1', background: '#F8FAFC', color: '#475569',
  borderRadius: 9, padding: '6px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
};
const restoreBtn: React.CSSProperties = {
  border: '1px solid #99F6E4', background: '#F0FDFA', color: '#0F766E',
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
const archiveConfirmBtn: React.CSSProperties = {
  border: '1px solid #475569', background: '#475569', color: '#FFFFFF',
  borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer',
};
const emptyState: React.CSSProperties = {
  padding: 48, textAlign: 'center', color: '#64748B',
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 18,
};
