'use client';

/**
 * System Health — operational visibility for The Bridge.
 *
 * A lightweight status page (not analytics — no graphs, history, or
 * alerting) that pattern-matches Vercel/GitHub-style status boards.
 *
 * Data comes from `GET /api/mcgs/system-health` which parallel-probes
 * every operational surface and caches the result for 60 seconds. See
 * `services/system_health.py` for probe details.
 */

import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { AskGeorgeAboutThis } from '@/components/mcgs/AskGeorgeAboutThis';
import { mcgsApi, type Probe, type ProbeStatus, type SystemHealth } from '@/lib/mcgs-api';

// ---------------------------------------------------------------------------
// Palette — pattern-matches the rest of Mission Control (slate-blue text on
// warm off-white). Status colours are intentionally muted (this is an ops
// dashboard, not a war-room console).
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<ProbeStatus, string> = {
  ok: 'Operational',
  degraded: 'Degraded',
  unknown: 'Unknown',
  disabled: 'Not configured',
};

const STATUS_COLOR: Record<ProbeStatus, { bg: string; fg: string; dot: string }> = {
  ok:       { bg: '#ECFDF5', fg: '#065F46', dot: '#10B981' },
  degraded: { bg: '#FEF3C7', fg: '#78350F', dot: '#F59E0B' },
  unknown:  { bg: '#F1F5F9', fg: '#334155', dot: '#94A3B8' },
  disabled: { bg: '#F1F5F9', fg: '#64748B', dot: '#CBD5E1' },
};

const OVERALL_HEADLINE: Record<ProbeStatus, string> = {
  ok: 'All systems operational.',
  degraded: 'Some systems are degraded.',
  unknown: 'A probe result is unknown.',
  disabled: 'A component is not configured.',
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function relative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-AU', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtCount(n: number | undefined): string {
  if (n === undefined || n === null || n < 0) return '—';
  return n.toLocaleString('en-AU');
}

// Friendly plural collection labels for the operational-snapshot strip.
const COLLECTION_LABEL: Record<string, string> = {
  users: 'Members',
  events: 'Events',
  moments: 'Moments',
  interest_registrations: 'Registrations',
  campaigns: 'Campaigns',
  support_tickets: 'Support tickets',
  signals: 'Signals',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SystemHealthPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (fresh = false) => {
    try {
      if (fresh) setRefreshing(true); else setLoading(true);
      setError(null);
      const data = await mcgsApi.systemHealth({ fresh });
      setHealth(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load health data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  // Auto-tick "last checked" text every 30s so the relative labels
  // stay honest without extra network calls. Cheap re-render.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick(t => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const overall = health?.overall ?? 'unknown';
  const overallColor = STATUS_COLOR[overall];

  return (
    <AdminShell>
      <div style={container}>
        <header style={heroWrap}>
          <div>
            <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.01em', color: '#0F172A' }}>System health</h1>
            <p style={{ fontSize: 15, color: '#64748B', marginTop: 4, marginBottom: 0 }}>
              A live snapshot of every operational surface. Probes are cached to keep this page cheap; use Refresh for the latest read.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <AskGeorgeAboutThis context="System health page — I'm looking at operational status" />
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing || loading}
              style={refreshBtn(refreshing || loading)}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        {error && (
          <div style={errorBox}>
            {error}
          </div>
        )}

        {loading && !health && (
          <div style={loadingBox}>Checking every surface — one moment…</div>
        )}

        {health && (
          <>
            {/* Overall pill */}
            <section style={{ ...overallPill, background: overallColor.bg, color: overallColor.fg }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ ...dot, background: overallColor.dot, width: 14, height: 14 }} />
                <div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{OVERALL_HEADLINE[overall]}</div>
                  <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>
                    Last checked {relative(health.generated_at)}
                    {health.cached ? ' · served from cache' : ''}
                  </div>
                </div>
              </div>
            </section>

            {/* Probe grid */}
            <section style={grid}>
              {health.probes.map((p) => <ProbeCard key={p.name} probe={p} />)}
            </section>

            {/* Operational snapshot — basic DB counts */}
            <section style={snapshotWrap}>
              <div style={sectionTitle}>Operational snapshot</div>
              <div style={countsGrid}>
                {Object.entries(health.counts).map(([key, n]) => (
                  <div key={key} style={countCard}>
                    <div style={countValue}>{fmtCount(n)}</div>
                    <div style={countLabel}>{COLLECTION_LABEL[key] ?? key}</div>
                  </div>
                ))}
              </div>
              <div style={snapshotNote}>
                Counts are estimated from collection metadata (near-instant) — accurate to within one document.
              </div>
            </section>

            {/* Deployment footer */}
            <DeploymentFooter deployment={health.deployment} />
          </>
        )}
      </div>
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProbeCard({ probe }: { probe: Probe }) {
  const c = STATUS_COLOR[probe.status];
  return (
    <div style={probeCard}>
      <div style={probeHead}>
        <span style={{ ...dot, background: c.dot }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: '#0F172A' }}>{probe.name}</div>
      </div>
      <div style={{ ...probeStatusPill, background: c.bg, color: c.fg }}>
        {STATUS_LABEL[probe.status]}
      </div>
      <div style={probeNote}>{probe.note}</div>
      <div style={probeMeta}>
        <span>{probe.response_ms != null ? `${probe.response_ms} ms` : '—'}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>Checked {relative(probe.last_checked)}</span>
        {probe.details?.cached && (
          <>
            <span style={{ opacity: 0.5 }}>·</span>
            <span style={{ fontStyle: 'italic' }}>cached</span>
          </>
        )}
      </div>
    </div>
  );
}

function DeploymentFooter({ deployment }: { deployment: SystemHealth['deployment'] }) {
  return (
    <section style={deployFooter}>
      <div style={sectionTitle}>Deployment</div>
      <div style={deployGrid}>
        <div>
          <div style={deployLabel}>Website version</div>
          <div style={deployValue}>{deployment.website_version ?? '—'}</div>
        </div>
        <div>
          <div style={deployLabel}>Mobile app version</div>
          <div style={deployValue}>{deployment.frontend_version ?? '—'}</div>
        </div>
        <div>
          <div style={deployLabel}>Last commit</div>
          <div style={deployValue} title={deployment.commit_hash ?? undefined}>
            {deployment.commit_short ?? '—'}
          </div>
        </div>
        <div>
          <div style={deployLabel}>Committed</div>
          <div style={deployValue}>{fmtDate(deployment.commit_time)}</div>
        </div>
      </div>
      {deployment.commit_message && (
        <div style={commitMessage}>
          <span style={{ opacity: 0.6 }}>Latest change:</span> {deployment.commit_message}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Styles — kept inline so this page has zero style dependencies to keep
// happy during Stabilisation.
// ---------------------------------------------------------------------------

const container: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 20, padding: '8px 4px',
};

const heroWrap: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  flexWrap: 'wrap', gap: 12,
};

const refreshBtn = (disabled: boolean): React.CSSProperties => ({
  border: '1px solid #CBD5E1',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 14,
  color: disabled ? '#94A3B8' : '#334155',
  background: '#FFFFFF',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontWeight: 500,
});

const errorBox: React.CSSProperties = {
  background: '#FEE2E2', color: '#7F1D1D', padding: '12px 16px',
  borderRadius: 8, fontSize: 14,
};

const loadingBox: React.CSSProperties = {
  background: '#F8FAFC', color: '#64748B', padding: '32px 16px',
  borderRadius: 12, fontSize: 15, textAlign: 'center', border: '1px dashed #CBD5E1',
};

const overallPill: React.CSSProperties = {
  padding: '18px 24px', borderRadius: 12, display: 'flex',
  justifyContent: 'space-between', alignItems: 'center',
};

const dot: React.CSSProperties = {
  display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
  flexShrink: 0,
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 12,
};

const probeCard: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12,
  padding: 16, display: 'flex', flexDirection: 'column', gap: 8,
};

const probeHead: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
};

const probeStatusPill: React.CSSProperties = {
  alignSelf: 'flex-start', padding: '3px 10px', borderRadius: 999,
  fontSize: 12, fontWeight: 500,
};

const probeNote: React.CSSProperties = {
  fontSize: 13, color: '#475569', lineHeight: 1.4, minHeight: 34,
};

const probeMeta: React.CSSProperties = {
  fontSize: 12, color: '#64748B', display: 'flex', gap: 6, flexWrap: 'wrap',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase',
  letterSpacing: '0.05em', marginBottom: 12,
};

const snapshotWrap: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12,
  padding: 20,
};

const countsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 12,
};

const countCard: React.CSSProperties = {
  background: '#F8FAFC', borderRadius: 10, padding: '14px 16px',
  border: '1px solid #E2E8F0',
};

const countValue: React.CSSProperties = {
  fontSize: 24, fontWeight: 600, color: '#0F172A', letterSpacing: '-0.01em',
};

const countLabel: React.CSSProperties = {
  fontSize: 12, color: '#64748B', marginTop: 4,
};

const snapshotNote: React.CSSProperties = {
  fontSize: 12, color: '#94A3B8', marginTop: 12, fontStyle: 'italic',
};

const deployFooter: React.CSSProperties = {
  background: '#F8FAFC', borderRadius: 12, padding: 20,
  border: '1px solid #E2E8F0',
};

const deployGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: 20, marginBottom: 12,
};

const deployLabel: React.CSSProperties = {
  fontSize: 12, color: '#94A3B8', textTransform: 'uppercase',
  letterSpacing: '0.04em', marginBottom: 4,
};

const deployValue: React.CSSProperties = {
  fontSize: 15, color: '#0F172A', fontWeight: 500,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const commitMessage: React.CSSProperties = {
  fontSize: 13, color: '#334155', paddingTop: 12, borderTop: '1px solid #E2E8F0',
};
