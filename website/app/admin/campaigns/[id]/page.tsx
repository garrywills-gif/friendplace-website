'use client';

/**
 * Campaign detail page.
 *
 * The permanent record of one campaign. Reopen months later and see:
 *   - who received it (recipient roster with founder number + status)
 *   - what they got (archived subject + rendered HTML sample)
 *   - delivery stats
 *   - full audience filter that targeted them
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { campaignsApi, type Campaign, type CampaignRecipient } from '@/lib/cms-api';

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const [campaign, setCampaign] = useState<(Campaign & { recipients: CampaignRecipient[] }) | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
    const t = setInterval(load, 3000);   // live poll while sending
    return () => { cancelled = true; clearInterval(t); };
  }, [id]);

  if (err) return (
    <AdminShell title="Campaign"><p style={{ color: '#B91C1C' }}>{err}</p></AdminShell>
  );
  if (!campaign) return (
    <AdminShell title="Campaign"><p style={{ color: '#64748B' }}>Loading…</p></AdminShell>
  );

  const stats = campaign.stats || { targeted: 0, accepted: 0, failed: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 };
  const isDraft = campaign.status === 'draft';

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
            {' · '}signed by {campaign.companion === 'georgia' ? 'Georgia' : 'George'}
            {campaign.sent_at && (
              <> · sent {new Date(campaign.sent_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
            )}
          </div>
        </div>
        {isDraft && (
          <Link href={`/admin/campaigns/new?id=${campaign.id}`} style={{ ...s.primaryBtn, textDecoration: 'none' }}>
            Edit draft
          </Link>
        )}
      </div>

      {/* Delivery stats */}
      <div style={statsGrid}>
        <StatTile label="Targeted"  value={stats.targeted}  tone="teal" />
        <StatTile label="Accepted"  value={stats.accepted}  tone="teal" />
        <StatTile label="Failed"    value={stats.failed}    tone={stats.failed > 0 ? 'red' : 'muted'} />
        <StatTile label="Delivered" value={stats.delivered} tone="muted" />
        <StatTile label="Opened"    value={stats.opened}    tone="muted" />
        <StatTile label="Bounced"   value={stats.bounced}   tone={stats.bounced > 0 ? 'amber' : 'muted'} />
      </div>
      <div style={{ ...s.helper, marginTop: 6 }}>
        Delivered / Opened / Bounced numbers come from Resend webhooks and land here in Iteration 3
        (the Delivery & engagement dashboard). Accepted = the Resend API accepted the message.
      </div>

      {/* Two-column: recipients + archived email */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20, marginTop: 24 }}>
        <div>
          <div style={s.label}>Recipients</div>
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 16, overflow: 'hidden', background: '#FFFFFF' }}>
            {campaign.recipients.length === 0 ? (
              <div style={{ padding: 24, color: '#64748B', textAlign: 'center' }}>
                {isDraft ? 'This campaign has not been sent yet.' : 'No recipients recorded.'}
              </div>
            ) : (
              campaign.recipients.map(r => (
                <div key={r.id} style={{
                  display: 'flex', padding: '12px 16px', gap: 10, alignItems: 'center',
                  borderTop: '1px solid #F1F5F9',
                }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 6,
                    background: '#F0FDFA', color: '#0F766E',
                    border: '1px solid #99F6E4',
                    fontSize: 11, fontWeight: 900,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    #{String(r.founder_number ?? 0).padStart(4, '0')}
                  </span>
                  <div style={{ flex: '1 1 0', minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#0A2540', fontSize: 14 }}>
                      {r.first_name || '(unnamed)'}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>{r.email}</div>
                  </div>
                  <span style={{
                    padding: '2px 10px', borderRadius: 999,
                    background: r.status === 'sent' ? '#DCFCE7' : r.status === 'failed' ? '#FEE2E2' : '#F1F5F9',
                    color:      r.status === 'sent' ? '#166534' : r.status === 'failed' ? '#991B1B' : '#475569',
                    fontSize: 11, fontWeight: 800,
                  }}>{r.status}</span>
                </div>
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
    </AdminShell>
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
      <div style={{ fontSize: 28, fontWeight: 900, color: '#0A2540', marginTop: 4, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

const statsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 10,
};
