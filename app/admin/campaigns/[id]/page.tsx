'use client';

/**
 * Campaign detail page — CRM Phase 2B (Delivery & Engagement).
 *
 * The permanent record of one campaign. Reopen it months later and see:
 *   - Delivery + engagement rollup (delivered / opened / clicked /
 *     bounced / complained + rates)
 *   - Recipient roster with rich status pills reflecting the LAST
 *     event Resend told us about (not just "sent yes/no")
 *   - Click any recipient → per-email timeline modal
 *     ("Every email is a timeline, not just a status" — Garry, 1 Aug 2026)
 *   - Archived subject + rendered HTML sample
 *   - Full audience filter that targeted them
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import {
  campaignsApi,
  type Campaign,
  type CampaignRecipient,
  type CampaignRecipientEvent,
} from '@/lib/cms-api';

// ── Filter tabs above the recipient roster ──────────────────────
type RecipientFilter = 'all' | 'opened' | 'clicked' | 'not_opened' | 'bounced';

const FILTER_LABEL: Record<RecipientFilter, string> = {
  all:        'All',
  opened:     'Opened',
  clicked:    'Clicked',
  not_opened: 'Not reached',
  bounced:    'Bounced / complained',
};

function matchesFilter(r: CampaignRecipient, f: RecipientFilter): boolean {
  const status = (r.status || '').toLowerCase();
  const opened = !!r.first_opened_at;
  const clicked = !!r.first_clicked_at;
  const bounced = !!r.bounced_at || !!r.complained_at || status === 'bounced' || status === 'complained';
  const delivered = !!r.delivered_at || status === 'delivered' || opened || clicked;
  switch (f) {
    case 'all':        return true;
    case 'opened':     return opened && !bounced;
    case 'clicked':    return clicked && !bounced;
    case 'not_opened': return delivered && !opened && !bounced;
    case 'bounced':    return bounced;
  }
}

// ── The page ───────────────────────────────────────────────────
export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const [campaign, setCampaign] = useState<(Campaign & { recipients: CampaignRecipient[] }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<RecipientFilter>('all');
  const [openTimelineFor, setOpenTimelineFor] = useState<CampaignRecipient | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const c = await campaignsApi.get(id);
        if (!cancelled) setCampaign(c);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Could not load campaign');
      }
    };
    void load();
    // Live poll while the send is in flight, and every 10s afterwards
    // so webhook-driven rollups tick through without a page reload.
    const t = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(t); };
  }, [id]);

  const filteredRecipients = useMemo(() => {
    if (!campaign) return [];
    return campaign.recipients.filter((r) => matchesFilter(r, filter));
  }, [campaign, filter]);

  if (err) return (
    <AdminShell title="Campaign"><p style={{ color: '#B91C1C' }}>{err}</p></AdminShell>
  );
  if (!campaign) return (
    <AdminShell title="Campaign"><p style={{ color: '#64748B' }}>Loading…</p></AdminShell>
  );

  const stats = campaign.stats || ({} as Campaign['stats']);
  const accepted = stats.accepted || 0;
  const uniqueOpens  = stats.unique_opens  ?? stats.opened  ?? 0;
  const uniqueClicks = stats.unique_clicks ?? stats.clicked ?? 0;
  const delivered = stats.delivered || 0;
  const bounced   = stats.bounced   || 0;
  const complained = stats.complained || 0;
  const deliveryRate = accepted ? delivered / accepted : 0;
  const openRate     = accepted ? uniqueOpens  / accepted : 0;
  const clickRate    = accepted ? uniqueClicks / accepted : 0;
  const bounceRate   = accepted ? bounced      / accepted : 0;
  const isDraft = campaign.status === 'draft';

  const counters = campaign.recipients.reduce(
    (acc, r) => {
      (['all', 'opened', 'clicked', 'not_opened', 'bounced'] as RecipientFilter[])
        .forEach((f) => { if (matchesFilter(r, f)) acc[f] += 1; });
      return acc;
    },
    { all: 0, opened: 0, clicked: 0, not_opened: 0, bounced: 0 } as Record<RecipientFilter, number>,
  );

  return (
    <AdminShell title="Campaign">
      <div style={{ marginTop: -8, marginBottom: 20 }}>
        <Link href="/admin/campaigns" style={{ color: '#0F766E', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
          ← All campaigns
        </Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 28, color: '#0A2540', fontWeight: 900 }}>{campaign.name}</h2>
          <div style={{ marginTop: 6, color: '#475569', fontSize: 14 }}>
            {campaign.template === 'announcement' ? 'Founding Member update' :
              campaign.template === 'invitation' ? 'Invitation' : 'Welcome letter'}
            {' · '}signed by {
              campaign.companion === 'team'    ? 'The FriendPlace Team' :
              campaign.companion === 'georgia' ? 'Georgia' :
              campaign.companion === 'none'    ? 'no additional sign-off' :
                                                 'George'
            }
            {campaign.sent_at && (
              <> · sent {new Date(campaign.sent_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
            )}
            {stats.last_event_at && (
              <> · last event {new Date(stats.last_event_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</>
            )}
          </div>
        </div>
        {isDraft && (
          <Link href={`/admin/campaigns/new?id=${campaign.id}`} style={{ ...s.primaryBtn, textDecoration: 'none' }}>
            Edit draft
          </Link>
        )}
      </div>

      {/* Row 1 — the four rates that matter most. */}
      <div style={{ ...statsGrid, marginBottom: 12 }}>
        <RateTile label="Delivered" rate={deliveryRate} counts={`${delivered} / ${accepted}`} tone="teal" />
        <RateTile label="Opened"    rate={openRate}     counts={`${uniqueOpens} unique`}       tone="teal" />
        <RateTile label="Clicked"   rate={clickRate}    counts={`${uniqueClicks} unique`}      tone="teal" />
        <RateTile label="Bounced"   rate={bounceRate}   counts={`${bounced} bounced`}
                  tone={bounced > 0 ? 'amber' : 'muted'} />
      </div>

      {/* Row 2 — raw counters (kept for CS + auditing). */}
      <div style={statsGrid}>
        <StatTile label="Targeted"  value={stats.targeted || 0}  tone="muted" />
        <StatTile label="Accepted"  value={accepted}              tone="muted" />
        <StatTile label="Failed"    value={stats.failed || 0}     tone={(stats.failed || 0) > 0 ? 'red' : 'muted'} />
        <StatTile label="Opens (raw)"  value={stats.opened  || 0} tone="muted" />
        <StatTile label="Clicks (raw)" value={stats.clicked || 0} tone="muted" />
        <StatTile label="Complaints"   value={complained}
                  tone={complained > 0 ? 'red' : 'muted'} />
      </div>
      <div style={{ ...s.helper, marginTop: 8, marginBottom: 20 }}>
        Rates use <strong>unique</strong> opens / clicks (each recipient
        counted once). Raw counts include repeat opens. Delivered / Opened /
        Clicked / Bounced / Complained update live from Resend webhooks.
      </div>

      {/* Two-column: recipient roster (with filters + timeline) + archived email */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20, marginTop: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <div style={s.label}>Recipients</div>
            <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>
              Click any recipient for their full timeline
            </div>
          </div>

          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0 10px' }}>
            {(['all','opened','clicked','not_opened','bounced'] as RecipientFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  cursor: 'pointer',
                  border: '1px solid ' + (filter === f ? '#0F766E' : '#E2E8F0'),
                  background: filter === f ? '#0F766E' : '#FFFFFF',
                  color: filter === f ? '#FFFFFF' : '#0A2540',
                  padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 800,
                }}
              >
                {FILTER_LABEL[f]} <span style={{ opacity: 0.75, marginLeft: 4 }}>({counters[f]})</span>
              </button>
            ))}
          </div>

          <div style={{ border: '1px solid #E2E8F0', borderRadius: 16, overflow: 'hidden', background: '#FFFFFF' }}>
            {filteredRecipients.length === 0 ? (
              <div style={{ padding: 24, color: '#64748B', textAlign: 'center' }}>
                {isDraft ? 'This campaign has not been sent yet.' :
                  filter === 'all' ? 'No recipients recorded.' : 'No recipients in this filter.'}
              </div>
            ) : (
              filteredRecipients.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setOpenTimelineFor(r)}
                  style={{
                    display: 'flex', width: '100%', textAlign: 'left', padding: '12px 16px',
                    gap: 10, alignItems: 'center', border: 'none',
                    background: '#FFFFFF', borderTop: '1px solid #F1F5F9', cursor: 'pointer',
                  }}
                >
                  <span style={{
                    padding: '2px 8px', borderRadius: 6,
                    background: '#F0FDFA', color: '#0F766E', border: '1px solid #99F6E4',
                    fontSize: 11, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
                  }}>
                    #{String(r.founder_number ?? 0).padStart(4, '0')}
                  </span>
                  <div style={{ flex: '1 1 0', minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#0A2540', fontSize: 14 }}>
                      {r.first_name || '(unnamed)'}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>{r.email}</div>
                  </div>
                  <RecipientPill r={r} />
                </button>
              ))
            )}
          </div>
        </div>

        <div>
          <div style={s.label}>What was sent</div>
          <div style={{
            border: '1px solid #E2E8F0', borderRadius: 16, overflow: 'hidden',
            background: '#FFFFFF', height: 640,
          }}>
            {campaign.sample_html ? (
              <iframe title="Campaign copy" srcDoc={campaign.sample_html} sandbox=""
                style={{ width: '100%', height: '100%', border: 'none' }} />
            ) : (
              <div style={{ padding: 24, color: '#94A3B8', fontStyle: 'italic' }}>
                Sample HTML will be captured when the campaign is sent.
              </div>
            )}
          </div>
          <div style={s.helper}>
            An archived copy of exactly what the first recipient received. Permanent record for
            future reference.
          </div>
        </div>
      </div>

      {/* Timeline drill-down modal */}
      {openTimelineFor && (
        <RecipientTimelineModal
          campaignId={id}
          recipient={openTimelineFor}
          onClose={() => setOpenTimelineFor(null)}
        />
      )}
    </AdminShell>
  );
}

// ── Modal — per-recipient timeline drill-down ────────────────────
function RecipientTimelineModal({
  campaignId, recipient, onClose,
}: { campaignId: string; recipient: CampaignRecipient; onClose: () => void }) {
  const [events, setEvents] = useState<CampaignRecipientEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await campaignsApi.timeline(campaignId, recipient.id);
        if (!cancelled) setEvents(r.events);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Could not load timeline');
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId, recipient.id]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10, 37, 64, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FFFFFF', borderRadius: 20, padding: 28,
          maxWidth: 560, width: '100%', maxHeight: '80vh', overflow: 'auto',
          boxShadow: '0 20px 60px rgba(10, 37, 64, 0.35)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748B', fontWeight: 800, letterSpacing: '0.08em' }}>
              EMAIL TIMELINE
            </div>
            <h3 style={{ margin: '4px 0 2px', fontSize: 20, fontWeight: 900, color: '#0A2540' }}>
              {recipient.first_name || '(unnamed)'} · #{String(recipient.founder_number ?? 0).padStart(4, '0')}
            </h3>
            <div style={{ color: '#64748B', fontSize: 13 }}>{recipient.email}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            border: 'none', background: '#F1F5F9', color: '#64748B',
            width: 32, height: 32, borderRadius: 16, cursor: 'pointer',
            fontSize: 16, fontWeight: 900,
          }}>×</button>
        </div>

        <div style={{ marginTop: 20 }}>
          {err && <p style={{ color: '#B91C1C' }}>{err}</p>}
          {!err && events === null && <p style={{ color: '#64748B' }}>Loading…</p>}
          {events && events.length === 0 && (
            <p style={{ color: '#64748B' }}>No events recorded for this recipient yet.</p>
          )}
          {events && events.length > 0 && (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {events.map((e, i) => (
                <li key={`${e.type}-${e.at}-${i}`} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: 12,
                  background: '#FAFBFC',
                }}>
                  <TimelineDot type={e.type} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#0A2540' }}>
                      {prettyEventLabel(e.type)}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>
                      {new Date(e.at).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                    {e.meta?.link_url && (
                      <div style={{ fontSize: 12, color: '#0F766E', marginTop: 4, wordBreak: 'break-all' }}>
                        → {e.meta.link_url}
                      </div>
                    )}
                    {e.meta?.bounce_msg && (
                      <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 4 }}>
                        {e.meta.bounce_type ? `[${e.meta.bounce_type}] ` : ''}{e.meta.bounce_msg}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {recipient.open_count && recipient.open_count > 1 ? (
          <p style={{ marginTop: 16, color: '#64748B', fontSize: 12 }}>
            Opened {recipient.open_count} times total ({recipient.click_count || 0} clicks).
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Presentation helpers ─────────────────────────────────────────
function prettyEventLabel(type: string): string {
  switch (type) {
    case 'email.sent':             return 'Sent';
    case 'email.delivered':        return 'Delivered';
    case 'email.delivery_delayed': return 'Delivery delayed';
    case 'email.opened':           return 'Opened';
    case 'email.clicked':          return 'Clicked a link';
    case 'email.bounced':          return 'Bounced';
    case 'email.complained':       return 'Marked as spam';
    default: return type;
  }
}

function TimelineDot({ type }: { type: string }) {
  const c =
    type === 'email.delivered' ? '#0F766E' :
    type === 'email.opened'    ? '#2563EB' :
    type === 'email.clicked'   ? '#7C3AED' :
    type === 'email.bounced'   ? '#B91C1C' :
    type === 'email.complained' ? '#B91C1C' :
    type === 'email.delivery_delayed' ? '#B45309' :
    '#64748B';
  return (
    <span style={{
      width: 10, height: 10, borderRadius: 5, background: c,
      marginTop: 6, flexShrink: 0, boxShadow: `0 0 0 3px ${c}22`,
    }} />
  );
}

function RecipientPill({ r }: { r: CampaignRecipient }) {
  // The pill shows the LAST meaningful event, not the send-side status.
  const last = r.last_event_type || (
    r.first_clicked_at ? 'email.clicked' :
    r.first_opened_at ? 'email.opened' :
    r.bounced_at ? 'email.bounced' :
    r.complained_at ? 'email.complained' :
    r.delivered_at ? 'email.delivered' :
    r.status === 'failed' ? 'failed' : 'sent'
  );
  const palette =
    last === 'email.clicked'   ? { bg: '#EDE9FE', fg: '#5B21B6' } :
    last === 'email.opened'    ? { bg: '#DBEAFE', fg: '#1E3A8A' } :
    last === 'email.delivered' ? { bg: '#DCFCE7', fg: '#166534' } :
    last === 'email.bounced'   ? { bg: '#FEE2E2', fg: '#991B1B' } :
    last === 'email.complained' ? { bg: '#FEE2E2', fg: '#991B1B' } :
    last === 'email.delivery_delayed' ? { bg: '#FEF3C7', fg: '#B45309' } :
    last === 'failed'          ? { bg: '#FEE2E2', fg: '#991B1B' } :
                                 { bg: '#F1F5F9', fg: '#475569' };
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 999,
      background: palette.bg, color: palette.fg,
      fontSize: 11, fontWeight: 800,
    }}>
      {prettyEventLabel(last)}
    </span>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: 'teal' | 'amber' | 'red' | 'muted' }) {
  const palette = tone === 'teal'
    ? { bg: '#F0FDFA', border: '#99F6E4', accent: '#0F766E' }
    : tone === 'amber'
    ? { bg: '#FEF3C7', border: '#FDE68A', accent: '#B45309' }
    : tone === 'red'
    ? { bg: '#FEE2E2', border: '#FCA5A5', accent: '#B91C1C' }
    : { bg: '#F8FAFC', border: '#E2E8F0', accent: '#64748B' };
  return (
    <div style={{
      background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 14, padding: 14,
    }}>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 800, color: palette.accent }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: '#0A2540', marginTop: 4, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function RateTile({ label, rate, counts, tone }: { label: string; rate: number; counts: string; tone: 'teal' | 'amber' | 'red' | 'muted' }) {
  const palette = tone === 'teal'
    ? { bg: '#F0FDFA', border: '#99F6E4', accent: '#0F766E' }
    : tone === 'amber'
    ? { bg: '#FEF3C7', border: '#FDE68A', accent: '#B45309' }
    : tone === 'red'
    ? { bg: '#FEE2E2', border: '#FCA5A5', accent: '#B91C1C' }
    : { bg: '#F8FAFC', border: '#E2E8F0', accent: '#64748B' };
  return (
    <div style={{
      background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 14, padding: 14,
    }}>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 800, color: palette.accent }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color: '#0A2540', marginTop: 4, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {(rate * 100).toFixed(1)}%
      </div>
      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, marginTop: 4 }}>{counts}</div>
    </div>
  );
}

const statsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 10,
};
