'use client';

/**
 * Founding Members card — Bridge dashboard tile.
 *
 * Lives alongside Morning Briefing on The Bridge. Reads
 * /api/cms/crm/founding-members/stats and surfaces the four numbers
 * Garry looks at every morning: Total, New today, Awaiting contact,
 * Latest registration. Clicking anywhere on the card opens the
 * full CRM.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { foundingMembersCrmApi, type CRMFoundingMembersStats } from '@/lib/cms-api';

export function FoundingMembersCard() {
  const [stats, setStats] = useState<CRMFoundingMembersStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      try {
        const s = await foundingMembersCrmApi.stats();
        if (!cancelled) setStats(s);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load Founding Members');
      }
    };
    void load();
    interval = setInterval(load, 60_000); // gentle 1-min refresh
    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, []);

  const latest = stats?.latest;
  const latestDisplayName = latest?.name || (latest?.email?.split('@')[0]) || '';
  const latestWhen = latest?.created_at ? relTime(latest.created_at) : '';

  return (
    <Link href="/admin/crm/founding-members" style={cardLink}>
      <div style={header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🌟</span>
          <div>
            <div style={eyebrow}>Founding Members</div>
            <div style={title}>Register-your-interest CRM</div>
          </div>
        </div>
        <span style={{ color: '#94A3B8', fontSize: 12, fontWeight: 700 }}>Open →</span>
      </div>

      {error ? (
        <div style={{ padding: '20px 0', color: '#B91C1C', fontSize: 13 }}>{error}</div>
      ) : (
        <>
          <div style={statsGrid}>
            <StatTile
              tone="teal"
              label="Total"
              value={stats?.total}
            />
            <StatTile
              tone="teal"
              label="New today"
              value={stats?.new_today}
              accent={(stats?.new_today ?? 0) > 0}
            />
            <StatTile
              tone="amber"
              label="Awaiting contact"
              value={stats?.awaiting_contact}
              accent={(stats?.awaiting_contact ?? 0) > 0}
            />
          </div>

          <div style={latestRow}>
            <div style={{ minWidth: 0 }}>
              <div style={latestLabel}>Latest registration</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                {latest?.founder_number ? (
                  <span style={{
                    fontSize: 11, fontWeight: 900,
                    padding: '1px 6px', borderRadius: 5,
                    background: '#F0FDFA', color: '#0F766E',
                    border: '1px solid #99F6E4',
                    fontVariantNumeric: 'tabular-nums',
                  }}>#{String(latest.founder_number).padStart(4, '0')}</span>
                ) : null}
                <span style={latestName}>
                  {latestDisplayName || <span style={{ color: '#94A3B8', fontWeight: 500 }}>None yet</span>}
                </span>
              </div>
              {latest?.state_country && (
                <div style={latestMeta}>{latest.state_country}</div>
              )}
            </div>
            {latestWhen && (
              <div style={latestTime}>{latestWhen}</div>
            )}
          </div>
        </>
      )}
    </Link>
  );
}

function StatTile({
  tone, label, value, accent,
}: { tone: 'teal' | 'amber'; label: string; value: number | undefined; accent?: boolean }) {
  const palette = tone === 'teal'
    ? { bg: 'linear-gradient(140deg, #CCFBF1 0%, #F0FDFA 100%)', border: 'rgba(20,184,166,0.28)', accent: '#0F766E' }
    : { bg: 'linear-gradient(140deg, #FEF3C7 0%, #FEFCE8 100%)', border: 'rgba(217,119,6,0.28)', accent: '#B45309' };
  return (
    <div style={{
      background: palette.bg,
      border: `1px solid ${palette.border}`,
      borderRadius: 12,
      padding: 12,
    }}>
      <div style={{
        fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
        fontWeight: 800, color: palette.accent,
      }}>{label}</div>
      <div style={{
        fontSize: 26, fontWeight: 900, color: '#0A2540',
        marginTop: 2, lineHeight: 1.1,
        opacity: value === undefined ? 0.5 : 1,
      }}>{value === undefined ? '—' : value}</div>
    </div>
  );
}

function relTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const s = Math.round(diff / 1000);
  if (s < 30) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return '';
}

// ─── styles ────────────────────────────────────────
const cardLink: React.CSSProperties = {
  display: 'block',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 16,
  padding: 18,
  boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
  textDecoration: 'none',
  color: 'inherit',
  marginBottom: 16,
};
const header: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  gap: 8, marginBottom: 14,
};
const eyebrow: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
  fontWeight: 800, color: '#94A3B8',
};
const title: React.CSSProperties = {
  fontSize: 15, fontWeight: 800, color: '#0F172A', marginTop: 1,
};
const statsGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8,
};
const latestRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  gap: 12, marginTop: 14, paddingTop: 12,
  borderTop: '1px dashed #E2E8F0',
};
const latestLabel: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
  fontWeight: 800, color: '#94A3B8',
};
const latestName: React.CSSProperties = {
  fontSize: 14, fontWeight: 800, color: '#0A2540', marginTop: 2,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const latestMeta: React.CSSProperties = {
  fontSize: 12, color: '#64748B', marginTop: 2,
};
const latestTime: React.CSSProperties = {
  fontSize: 11, color: '#64748B', fontWeight: 700, whiteSpace: 'nowrap',
};
