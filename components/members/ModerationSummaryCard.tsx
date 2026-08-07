'use client';

import type { MemberProfile } from '@/lib/cms-api';

/**
 * ModerationSummaryCard — the "one-glance headline" above the timeline.
 *
 * Six numbers on one row: Reports (open/total) · Warnings · Suspensions ·
 * Bans · Notes · Last action. A calm state chip on the right side calls
 * out the current standing (Good standing / Restricted / Suspended /
 * Banned) so the admin never has to hunt for it before acting.
 */
export function ModerationSummaryCard({
  counts,
  restricted,
  banned,
  suspendedActive,
}: {
  counts: MemberProfile['counts'];
  restricted: boolean;
  banned: boolean;
  suspendedActive: boolean;
}) {
  const status = banned
    ? { label: 'Banned',        bg: '#FEE2E2', fg: '#7F1D1D', border: '#FCA5A5' }
    : suspendedActive
    ? { label: 'Suspended',     bg: '#FEF2F2', fg: '#991B1B', border: '#FECACA' }
    : restricted
    ? { label: 'Restricted',    bg: '#FEF3C7', fg: '#78350F', border: '#FBBF24' }
    : { label: 'Good standing', bg: '#ECFDF5', fg: '#065F46', border: '#A7F3D0' };

  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <h2 style={h2}>Moderation summary</h2>
        <span style={{ marginLeft: 'auto' }}>
          <span style={{ ...statusChip, background: status.bg, color: status.fg, borderColor: status.border }}>
            {status.label}
          </span>
        </span>
      </div>

      <div style={grid}>
        <Stat label="Reports open" value={counts.reports_open} tone={counts.reports_open > 0 ? 'accent' : 'neutral'} sub={`${counts.reports_total} total`} />
        <Stat label="Warnings" value={counts.warnings} tone="warn" />
        <Stat label="Suspensions" value={counts.suspensions} tone="warn" />
        <Stat label="Bans" value={counts.bans} tone="danger" />
        <Stat label="Notes" value={counts.notes} tone="neutral" />
        <Stat label="Actions total" value={counts.actions_total} tone="neutral"
              sub={counts.last_action_at ? `Last: ${formatShort(counts.last_action_at)}` : 'None yet'} />
      </div>
    </section>
  );
}

function Stat({ label, value, tone, sub }: {
  label: string;
  value: number;
  tone: 'neutral' | 'accent' | 'warn' | 'danger';
  sub?: string;
}) {
  const palette: Record<string, { fg: string; bg: string; border: string }> = {
    neutral: { fg: '#0F172A', bg: '#F8FAFC', border: '#E2E8F0' },
    accent:  { fg: '#3730A3', bg: '#EEF2FF', border: '#C7D2FE' },
    warn:    { fg: '#78350F', bg: '#FFFBEB', border: '#FDE68A' },
    danger:  { fg: '#7F1D1D', bg: '#FEF2F2', border: '#FCA5A5' },
  };
  const p = palette[tone];
  return (
    <div style={{ background: p.bg, border: `1px solid ${p.border}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: p.fg, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: p.fg, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function formatShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
  } catch { return iso; }
}

// ─── styles ────────────────────────────────────────────────────────────
const card: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: 18 };
const h2: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 800, color: '#0F172A' };
const statusChip: React.CSSProperties = { padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, border: '1px solid', textTransform: 'uppercase', letterSpacing: '0.04em' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 };
