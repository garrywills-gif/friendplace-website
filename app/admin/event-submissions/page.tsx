'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { cmsApi, type EventSubmissionRow } from '@/lib/cms-api';
import { AdminShell } from '@/components/admin/AdminShell';

/**
 * Mission Control — Public event submissions review.
 *
 * Sits alongside the existing /admin/events editor. Handles the
 * approve/reject loop for anything submitted via the public
 * /list-your-event form on the marketing website.
 *
 * Approving promotes into a DRAFT event so the admin can polish
 * timezone, cover asset, etc. before publishing from the normal
 * event editor. Rejecting captures a reason that lands in the
 * submitter's email.
 */
export default function EventSubmissionsPage() {
  const [items, setItems] = useState<EventSubmissionRow[]>([]);
  const [counts, setCounts] = useState<{ pending: number; approved: number; rejected: number }>({ pending: 0, approved: 0, rejected: 0 });
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<EventSubmissionRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cmsApi.listEventSubmissions(tab === 'all' ? undefined : tab);
      setItems(res.items || []);
      setCounts(res.counts);
    } finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const approve = async (sub: EventSubmissionRow) => {
    if (!confirm(`Promote "${sub.event_title}" to a draft event?`)) return;
    setBusyId(sub.id);
    try {
      const res = await cmsApi.approveEventSubmission(sub.id);
      flash('Approved — draft created. Edit and publish when ready.');
      await load();
      // Kick admin over to the newly created event editor.
      window.location.href = `/admin/events/${res.event_id}`;
    } catch (e: any) {
      flash(`Approve failed: ${e?.message || 'unknown'}`);
    } finally { setBusyId(null); }
  };

  const reject = async () => {
    if (!rejectFor) return;
    setBusyId(rejectFor.id);
    try {
      await cmsApi.rejectEventSubmission(rejectFor.id, rejectReason.trim() || undefined);
      flash('Rejected — submitter has been emailed.');
      setRejectFor(null);
      setRejectReason('');
      await load();
    } catch (e: any) {
      flash(`Reject failed: ${e?.message || 'unknown'}`);
    } finally { setBusyId(null); }
  };

  return (
    <AdminShell title="Event submissions">
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {([
          { key: 'pending', label: `Pending (${counts.pending})` },
          { key: 'approved', label: `Approved (${counts.approved})` },
          { key: 'rejected', label: `Rejected (${counts.rejected})` },
          { key: 'all', label: 'All' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 16px',
              borderRadius: 999,
              border: `1px solid ${tab === t.key ? '#0F766E' : '#CBD5E1'}`,
              background: tab === t.key ? '#F0FDFA' : '#FFFFFF',
              color: tab === t.key ? '#0F766E' : '#475569',
              fontWeight: 800,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#64748B' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748B', background: '#F8FAFC', borderRadius: 16, border: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#334155' }}>Nothing here right now.</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>New submissions from{' '}
            <Link href="/list-your-event" style={{ color: '#0F766E', fontWeight: 700, textDecoration: 'none' }}>the public form</Link>
            {' '}will appear here.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {items.map((sub) => (
            <div key={sub.id} style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: 20, display: 'grid', gridTemplateColumns: sub.cover_image_base64 ? '140px 1fr' : '1fr', gap: 16 }}>
              {sub.cover_image_base64 && (
                 
                <img src={sub.cover_image_base64} alt={sub.event_title} style={{ width: 140, height: 100, borderRadius: 10, objectFit: 'cover' }} />
              )}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, letterSpacing: '0.14em', color: '#0F766E', fontWeight: 800, textTransform: 'uppercase' }}>
                    {sub.organisation_name}
                  </span>
                  <StatusPill status={sub.status} />
                  <span style={{ fontSize: 11, color: '#94A3B8' }}>Ref: <strong style={{ color: '#0A2540', letterSpacing: 1 }}>{sub.submission_ref}</strong></span>
                </div>
                <h3 style={{ margin: '2px 0 8px', fontSize: 20, color: '#0A2540', fontWeight: 900 }}>{sub.event_title}</h3>
                <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
                  <div>📅 {formatWhen(sub.event_starts_at)}</div>
                  {(sub.venue_name || sub.venue_address) && (
                    <div>📍 {[sub.venue_name, sub.venue_address].filter(Boolean).join(' · ')}</div>
                  )}
                  <div>👤 {sub.contact_name} · <a href={`mailto:${sub.contact_email}`} style={{ color: '#0F766E', textDecoration: 'none' }}>{sub.contact_email}</a>{sub.contact_phone ? ` · ${sub.contact_phone}` : ''}</div>
                  {sub.capacity != null && <div>👥 Capacity: {sub.capacity}</div>}
                  {sub.cost_display && <div>💰 {sub.cost_display}</div>}
                </div>
                {sub.description && (
                  <p style={{ marginTop: 10, color: '#334155', fontSize: 14, lineHeight: 1.6 }}>{sub.description}</p>
                )}
                {sub.accessibility_info && (
                  <div style={{ marginTop: 8, padding: 10, background: '#F0FDFA', borderLeft: '3px solid #14B8A6', borderRadius: 6, fontSize: 13, color: '#134E4A' }}>
                    <strong>Accessibility: </strong>{sub.accessibility_info}
                  </div>
                )}
                {sub.reviewer_notes && (
                  <div style={{ marginTop: 8, padding: 10, background: '#FEF2F2', borderLeft: '3px solid #FCA5A5', borderRadius: 6, fontSize: 13, color: '#7F1D1D' }}>
                    <strong>Rejection reason: </strong>{sub.reviewer_notes}
                  </div>
                )}

                {sub.status === 'pending' && (
                  <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => approve(sub)}
                      disabled={busyId === sub.id}
                      style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: busyId === sub.id ? '#94A3B8' : '#0A2540', color: '#FFF', fontWeight: 800, cursor: busyId === sub.id ? 'default' : 'pointer', fontSize: 14 }}
                    >
                      Approve → draft
                    </button>
                    <button
                      onClick={() => setRejectFor(sub)}
                      disabled={busyId === sub.id}
                      style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B', fontWeight: 800, cursor: 'pointer', fontSize: 14 }}
                    >
                      Reject
                    </button>
                  </div>
                )}
                {sub.status === 'approved' && sub.resulting_event_id && (
                  <div style={{ marginTop: 12 }}>
                    <Link href={`/admin/events/${sub.resulting_event_id}`} style={{ color: '#0F766E', fontWeight: 800, textDecoration: 'none', fontSize: 14 }}>
                      Open the draft event →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {rejectFor && (
        <div
          role="dialog"
          onClick={() => !busyId && setRejectFor(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 100 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFF', borderRadius: 20, maxWidth: 520, width: '100%', padding: 24 }}>
            <div style={{ fontSize: 12, letterSpacing: '0.16em', color: '#991B1B', fontWeight: 800, textTransform: 'uppercase' }}>Reject submission</div>
            <h2 style={{ margin: '4px 0 6px', fontSize: 20, color: '#0A2540', fontWeight: 900 }}>{rejectFor.event_title}</h2>
            <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>{rejectFor.organisation_name} · {rejectFor.contact_email}</p>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#334155', marginTop: 16, marginBottom: 6 }}>Reason (shown in the rejection email — optional)</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder="e.g. Duplicate listing — this event has already been submitted."
              style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid #CBD5E1', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setRejectFor(null)} disabled={!!busyId} style={{ padding: '10px 18px', borderRadius: 12, border: '1px solid #CBD5E1', background: '#FFF', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              <button onClick={reject} disabled={!!busyId} style={{ padding: '10px 18px', borderRadius: 12, border: 'none', background: busyId ? '#94A3B8' : '#DC2626', color: '#FFF', fontWeight: 900, cursor: busyId ? 'default' : 'pointer' }}>
                {busyId ? 'Rejecting…' : 'Reject & email'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '10px 18px', background: '#0A2540', color: '#FFF', borderRadius: 999, fontWeight: 700, fontSize: 13, boxShadow: '0 6px 20px rgba(10,37,64,0.35)', zIndex: 100 }}>
          {toast}
        </div>
      )}
    </AdminShell>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    pending: { bg: '#FEF3C7', fg: '#92400E', label: 'Pending' },
    approved: { bg: '#DCFCE7', fg: '#166534', label: 'Approved' },
    rejected: { bg: '#FEE2E2', fg: '#991B1B', label: 'Rejected' },
  };
  const m = map[status] || map.pending;
  return <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', background: m.bg, color: m.fg }}>{m.label}</span>;
}

function formatWhen(iso: string | undefined | null): string {
  if (!iso) return 'Date TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date TBD';
  try {
    return d.toLocaleString('en-AU', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney', timeZoneName: 'short' });
  } catch { return d.toLocaleString('en-AU'); }
}
